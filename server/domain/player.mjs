import { createHmac, randomBytes } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { randomToken, safeEqual, sha } from '../lib/crypto.mjs';
import { nowIso } from '../lib/validate.mjs';

const MANIFEST_VALIDITY_MS = 60 * 1000;
// Validade do link temporário de um vídeo (mediaLink). O navegador segue pedindo trechos do arquivo com o mesmo link enquanto o vídeo toca.
export const MEDIA_LINK_TTL_MS = 6 * 60 * 60 * 1000;
const LINK_TOKEN = /^([A-Za-z0-9_-]{1,64})\.(\d{10,15})\.([A-Za-z0-9_-]{43})$/; // <id da TV>.<validade em ms>.<assinatura>

// Lado das TVs: pareamento, programação (manifesto) e batimento. Formato do manifesto compatível com a versão 1.1.0:
//   { display, items:[{id,title,name,type,url,duration}], generatedAt, validUntil }   (campos novos são só acréscimos)
// Fase 2: cada item também traz durationMode ('fixed' | 'natural'), transition e transitionMs; o manifesto traz `loop`.
// `loop` é falso somente quando TODAS as playlists ativas nesta TV estão com a repetição desligada.
export function createPlayer({ db, audit, config, media, displays, access }) {
  function authenticate(req) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) fail(401, 'Player não autenticado.');
    const row = db.prepare("SELECT * FROM displays WHERE token_hash=? AND status='active' AND removed_at IS NULL").get(sha(header.slice(7)));
    if (!row) fail(401, 'Player revogado ou não pareado.');
    return row;
  }

  function pair(code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) fail(400, 'Código de pareamento inválido.');
    const row = db.prepare("SELECT * FROM displays WHERE status='active' AND removed_at IS NULL AND pair_hash=? AND pair_expires>?").get(sha(code), Date.now());
    if (!row) fail(400, 'Código inválido ou expirado. Solicite outro à TI.');
    const token = randomToken();
    db.prepare('UPDATE displays SET token_hash=?, pair_hash=NULL, pair_expires=NULL, last_seen=? WHERE id=?').run(sha(token), nowIso(), row.id);
    audit.record(`player:${row.id}`, 'device.paired', { displayId: row.id, name: row.name }, { unitId: row.unit_id, sectorId: row.sector_id });
    return { token, display: displays.dto(displays.find(row.id)) };
  }

  function manifest(display) {
    const nowMs=Date.now(),now=new Date(nowMs).toISOString(),items=[];let until=nowMs+MANIFEST_VALIDITY_MS,loops=[];
    for(const link of access.activeLinks(display)){
      if((link.start_at&&Date.parse(link.start_at)>nowMs)||(link.end_at&&Date.parse(link.end_at)<=nowMs))continue;
      if(link.end_at)until=Math.min(until,Date.parse(link.end_at));
      const rows=db.prepare(`SELECT vi.*,v.loop_enabled,m.status,m.scan_status,m.unit_id,m.sector_id FROM playlist_versions v JOIN playlist_version_items vi ON vi.version_id=v.id JOIN media m ON m.id=vi.media_id WHERE v.playlist_id=? AND v.version=? ORDER BY vi.position`).all(link.playlist_id,link.playlist_version);
      for(const row of rows)if(media.released(row)&&row.unit_id===display.unit_id&&row.sector_id===link.sector_id){items.push({id:row.media_id,title:row.title,name:row.name,type:row.type,url:`/api/media/${row.media_id}/file`,duration:row.duration_s,durationMode:row.duration_mode,transition:row.transition,transitionMs:row.transition_ms});loops.push(row.loop_enabled===1);}
    }
    return {display:displays.dto(displays.find(display.id)),items,loop:loops.length?loops.some(Boolean):true,generatedAt:now,validUntil:new Date(until).toISOString()};
  }

  function heartbeat(display) {
    db.prepare('UPDATE displays SET last_seen=? WHERE id=?').run(nowIso(), display.id);
    return { ok: true, serverTime: nowIso() };
  }

  // Uma TV só baixa mídia liberada da sua unidade, no setor de um vínculo autorizado e ativo agora.
  function mayFetch(display, mediaRow) {
    if(!media.released(mediaRow)||mediaRow.unit_id!==display.unit_id)return false;
    const now=Date.now();return access.activeLinks(display).some(link=>link.sector_id===mediaRow.sector_id&&(!link.start_at||Date.parse(link.start_at)<=now)&&(!link.end_at||Date.parse(link.end_at)>now)&&!!db.prepare('SELECT 1 FROM playlist_versions v JOIN playlist_version_items vi ON vi.version_id=v.id WHERE v.playlist_id=? AND v.version=? AND vi.media_id=?').get(link.playlist_id,link.playlist_version,mediaRow.id));
  }

  // Link temporário e assinado para o navegador da TV tocar UM vídeo direto, sem baixar o arquivo inteiro antes (algumas TVs não tocam o
  // arquivo baixado). A TV pede o link com a credencial dela; a assinatura cobre o arquivo, a TV, a validade e a credencial atual da TV
  // (trocar ou revogar a credencial invalida os links). A chave nasce a cada início do servidor: reiniciar invalida os links e a TV pede outro.
  // Quem usa o link não ganha nada além do arquivo: cada pedido continua passando por mayFetch (programação, setor e unidade da TV).
  const linkKey = randomBytes(32);
  const sign = (mediaId, displayId, expires, tokenHash) => createHmac('sha256', linkKey).update(`${mediaId}\n${displayId}\n${expires}\n${tokenHash}`).digest('base64url');

  function mediaLink(display, mediaRow) {
    if (!mayFetch(display, mediaRow)) fail(403, 'Mídia indisponível para esta TV.');
    const expires = Date.now() + MEDIA_LINK_TTL_MS;
    return { url: `/api/media/${mediaRow.id}/file?t=${display.id}.${expires}.${sign(mediaRow.id, display.id, expires, display.token_hash)}`, expiresAt: new Date(expires).toISOString() };
  }

  function authenticateLink(token, mediaId) {
    const match = LINK_TOKEN.exec(typeof token === 'string' ? token : '');
    const expires = match ? Number(match[2]) : 0;
    const row = match && expires > Date.now() ? db.prepare("SELECT * FROM displays WHERE id=? AND status='active' AND removed_at IS NULL").get(match[1]) : null;
    if (!row?.token_hash || !safeEqual(sign(mediaId, row.id, expires, row.token_hash), match[3])) fail(401, 'Link de mídia inválido ou expirado.');
    return row;
  }

  return { authenticate, pair, manifest, heartbeat, mayFetch, mediaLink, authenticateLink };
}
