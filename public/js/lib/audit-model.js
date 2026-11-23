// Auditoria (sem DOM): categorias, filtros, resumo legível dos detalhes e junção de páginas de eventos.
// O servidor grava o que aconteceu e o escopo (unidade e setor); aqui só se traduz isso para quem lê a trilha.
import { SCAN_LABELS, auditActionLabel, fold, own, plural } from './format.js';
import { ROLE_LABELS } from './permissions.js';
import { windowLabel } from './schedule-model.js';

export const AUDIT_CATEGORIES = Object.freeze([
  ['', 'Todas as categorias'],
  ['access', 'Entradas e saídas'],
  ['users', 'Usuários e permissões'],
  ['organization', 'Unidades e setores'],
  ['library', 'Biblioteca'],
  ['playlists', 'Playlists'],
  ['schedules', 'Programações'],
  ['displays', 'Telas'],
  ['system', 'Sistema e outros']
]);

export const AUDIT_PERIODS = Object.freeze([
  ['', 'Todo o período'], ['24h', 'Últimas 24 horas'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias']
]);
const PERIOD_MS = Object.freeze({ '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3, '30d': 30 * 24 * 3600e3 });

const PREFIXES = Object.freeze([
  ['auth.', 'access'], ['setup.', 'users'], ['user.', 'users'], ['units.', 'organization'], ['sectors.', 'organization'],
  ['folder.', 'library'], ['media.', 'library'], ['library.', 'library'], ['playlist.', 'playlists'], ['schedule.', 'schedules'],
  ['device.', 'displays'], ['display.', 'displays'], ['db.', 'system']
]);

// Na versão 1.1.0 "playlist" era a programação: os registros antigos dessas ações pertencem à categoria Programações.
const LEGACY_CATEGORY = Object.freeze({ 'playlist.published': 'schedules', 'playlist.stopped': 'schedules' });

export function categoryOf(action) {
  const name = String(action ?? '');
  return own(LEGACY_CATEGORY, name) ?? PREFIXES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? 'system';
}

export const categoryLabel = category => AUDIT_CATEGORIES.find(([value]) => value === category)?.[1] ?? '';

// Início do período em milissegundos (ou null para "todo o período" / valor desconhecido).
export function periodStart(period, now = Date.now()) {
  return PERIOD_MS[period] ? now - PERIOD_MS[period] : null;
}

// "Quem fez": e-mail da pessoa, ou um texto claro para os responsáveis que não são pessoas.
export function actorLabel(actor) {
  const name = String(actor ?? '').trim();
  if (!name || name === 'system') return 'Sistema';
  if (name === 'anonymous') return 'Sem identificação';
  if (name.startsWith('player:')) return 'TV (player)';
  if (name.startsWith('local-console:')) return `Console do servidor (${name.slice('local-console:'.length) || 'operador'})`;
  return name;
}

export function placeLabel(event, { unitName = id => id, sectorName = id => id } = {}) {
  const parts = [event?.unitId ? unitName(event.unitId) : '', event?.sectorId ? sectorName(event.sectorId) : ''].filter(Boolean);
  return parts.join(' · ');
}

const BATCH_LABELS = Object.freeze({ move: 'mover', delete: 'excluir', approve: 'aprovar', reject: 'rejeitar' });
const DEVICE_STATUS = Object.freeze({ active: 'ativa', pending: 'aguardando ativação' });

const clean = value => (typeof value === 'string' ? value.trim() : '');
// Renomeações: com os dois nomes, "de A para B"; um registro incompleto mostra só o que existe (nunca aspas vazias).
const change = (from, to) => {
  if (from && to) return `de “${from}” para “${to}”`;
  if (from) return `de “${from}”`;
  if (to) return `para “${to}”`;
  return '';
};
const countOf = list => (Array.isArray(list) ? list.length : 0);

// Resumo curto do que o evento registra, sem hashes nem identificadores internos. Eventos antigos (sem os campos
// mais novos) continuam legíveis: o que faltar simplesmente não aparece.
export function describeAudit(event) {
  const d = event?.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? event.detail : {};
  const parts = [];
  const add = value => { if (value !== undefined && value !== null && value !== false && String(value).trim() !== '') parts.push(String(value).trim()); };
  const name = () => add(clean(d.name) || clean(d.title));
  const items = () => { if (Number.isInteger(d.items)) add(plural(d.items, 'item', 'itens')); };

  switch (event?.action) {
    case 'auth.login':
      add(d.ip && `rede ${d.ip}`);
      break;
    case 'auth.login.failed':
      add(d.email ? `e-mail informado: ${d.email}` : 'e-mail digitado fora do formato (não gravado)');
      add(d.ip && `rede ${d.ip}`);
      break;
    case 'setup.admin.created':
      add(d.email);
      break;
    case 'db.migrated':
      if (d.from !== undefined && d.to !== undefined) add(`esquema ${d.from} → ${d.to}`);
      add(d.backup && `cópia de segurança ${d.backup}`);
      break;
    case 'user.created':
    case 'user.updated': {
      add(d.email);
      add(d.role && `perfil ${own(ROLE_LABELS, d.role) ?? d.role}`);
      if (event.action === 'user.updated' && d.active === false) add('conta suspensa');
      if (d.role !== 'admin' && Array.isArray(d.unitIds)) add(`${plural(countOf(d.unitIds), 'unidade', 'unidades')} e ${plural(countOf(d.sectorIds), 'setor', 'setores')}`);
      const grants = countOf(d.grants), revokes = countOf(d.revokes);
      if (grants || revokes) add(`permissões individuais: ${[grants && plural(grants, 'concedida', 'concedidas'), revokes && plural(revokes, 'retirada', 'retiradas')].filter(Boolean).join(' e ')}`);
      if (d.passwordReset) add('senha redefinida');
      break;
    }
    case 'user.password.reset':
      add(d.email);
      if (Number.isInteger(d.sessionsRevoked)) add(plural(d.sessionsRevoked, 'sessão encerrada', 'sessões encerradas'));
      if (d.source === 'local-console') add('feita no console do servidor');
      break;
    case 'units.saved':
    case 'sectors.saved':
    case 'folder.created':
    case 'folder.moved':
    case 'folder.deleted':
    case 'playlist.deleted':
    case 'schedule.deleted':
    case 'device.activated':
    case 'device.paired':
    case 'device.pairing.renewed':
    case 'device.pairing.generated':
    case 'device.revoked':
      name();
      break;
    case 'folder.renamed':
    case 'media.renamed':
    case 'device.renamed':
      add(change(clean(d.from), clean(d.to)));
      break;
    case 'device.access.updated':
      if (d.fromUnitId && d.unitId && d.fromUnitId !== d.unitId) add('unidade da TV alterada');
      add(`acesso por ${plural(countOf(d.sectorIds), 'setor', 'setores')} e ${plural(countOf(d.userIds), 'pessoa', 'pessoas')}`);
      break;
    case 'device.queue.reordered':
      add(`${plural(countOf(d.scheduleIds), 'programação', 'programações')} na sequência global`);
      break;
    case 'display.link.suspended':
      add(clean(d.reason) || 'A autorização de exibição precisa ser revista pela TI.');
      break;
    case 'media.uploaded':
    case 'media.deleted':
      add(clean(d.title) || clean(d.name));
      if (clean(d.name) && clean(d.title) && clean(d.name) !== clean(d.title)) add(`arquivo ${clean(d.name)}`);
      if (event.action === 'media.uploaded') add(own(SCAN_LABELS, d.scanStatus)?.toLowerCase());
      break;
    case 'media.moved':
    case 'media.rejected':
    case 'media.scan.failed':
      add(clean(d.title) || clean(d.name));
      break;
    case 'media.approved':
      add(clean(d.title));
      add(d.scanStatus === 'clean' ? 'verificado pelo antivírus' : (d.localUnscannedAcknowledged ? 'aprovado ciente de que não houve verificação antivírus' : ''));
      break;
    case 'library.batch':
      add(`${own(BATCH_LABELS, d.action) ?? clean(d.action)}: ${plural(Number(d.folders) || 0, 'pasta', 'pastas')} e ${plural(Number(d.media) || 0, 'arquivo', 'arquivos')}`);
      break;
    case 'playlist.created':
      name(); items();
      break;
    case 'playlist.updated':
      name();
      if (d.renamed) add('renomeada');
      items();
      break;
    case 'playlist.version.published':
      name();
      add(d.version && `versão ${d.version}`);
      items();
      add(clean(d.note) && `nota: ${clean(d.note)}`);
      break;
    case 'playlist.version.restored':
      name();
      add(d.version && `versão ${d.version} copiada para o rascunho`);
      if (Number(d.skipped) > 0) add(`${plural(Number(d.skipped), 'item indisponível ficou de fora', 'itens indisponíveis ficaram de fora')}`);
      break;
    case 'schedule.created':
    case 'schedule.updated':
    case 'schedule.published':
      name();
      if (event.action === 'schedule.updated' && d.previousVersion && d.playlistVersion && d.previousVersion !== d.playlistVersion) add(`versão da playlist ${d.previousVersion} → ${d.playlistVersion}`);
      else add(d.playlistVersion && `playlist versão ${d.playlistVersion}`);
      if (Array.isArray(d.displayIds)) add(plural(d.displayIds.length, 'TV', 'TVs'));
      if (d.startAt !== undefined || d.endAt !== undefined) add(windowLabel({ startAt: d.startAt, endAt: d.endAt }));
      break;
    case 'schedule.stopped':
      name();
      add(clean(d.reason));
      break;
    case 'playlist.published': // registro da versão 1.1.0: conteúdos, TVs e período ficavam no mesmo registro
      if (Array.isArray(d.mediaIds)) add(plural(d.mediaIds.length, 'conteúdo', 'conteúdos'));
      if (Array.isArray(d.displayIds)) add(plural(d.displayIds.length, 'TV', 'TVs'));
      if (d.startAt !== undefined || d.endAt !== undefined) add(windowLabel({ startAt: d.startAt, endAt: d.endAt }));
      break;
    case 'device.created':
      name();
      add(own(DEVICE_STATUS, d.status));
      break;
    default:
      name();
      add(d.email);
  }
  return parts.join(' · ');
}

// Texto único (sem acentos, minúsculo) sobre o qual a busca da tela procura.
export function eventSearchText(event, names = {}) {
  return fold([
    event.actor, actorLabel(event.actor), event.action, auditActionLabel(event.action), categoryLabel(categoryOf(event.action)),
    describeAudit(event), placeLabel(event, names)
  ].join(' '));
}

// `period` só vale se conhecido; evento sem data válida nunca "cai" dentro de um período.
export function filterEvents(events, { q = '', category = '', period = '' } = {}, { now = Date.now(), names = {} } = {}) {
  const needle = fold(q).trim();
  const since = periodStart(period, now);
  return events.filter(event => {
    if (category && categoryOf(event.action) !== category) return false;
    if (since !== null) {
      const at = Date.parse(event.at);
      if (!Number.isFinite(at) || at < since) return false;
    }
    return !needle || eventSearchText(event, names).includes(needle);
  });
}

// Junta páginas sem repetir (o primeiro que aparece vale: eventos nunca mudam) e ordena do mais novo ao mais antigo.
export function mergeEvents(...lists) {
  const byId = new Map();
  for (const list of lists) for (const event of list ?? []) if (event && !byId.has(event.id)) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

// Para um período escolhido, é preciso ter carregado eventos até antes do início dele (ou esgotado o histórico).
export function coversPeriod(events, hasMore, period, now = Date.now()) {
  const since = periodStart(period, now);
  if (since === null || !hasMore) return true;
  const oldest = events.at(-1);
  const at = oldest ? Date.parse(oldest.at) : NaN;
  return Number.isFinite(at) && at < since;
}
