import { randomUUID } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { integer, label, nowIso, oneOf, safeId, searchKey } from '../lib/validate.mjs';
import { authorize } from './permissions.mjs';
import { kindOf } from './formats.mjs';

export const TRANSITIONS = Object.freeze(['cut', 'fade', 'dissolve', 'slide', 'zoom']);
// 'fixed' = tempo definido (em vídeo, um limite); 'natural' = o vídeo toca até o fim (só vale para vídeo).
export const DURATION_MODES = Object.freeze(['fixed', 'natural']);
const DEFAULT_DURATION = 15, DEFAULT_TRANSITION_MS = 600;
const scopeOf = row => ({ unitId: row.unit_id, sectorId: row.sector_id });

// Playlist = O QUE tocar (conteúdos em ordem, tempo e transição de cada um).
//  - O RASCUNHO (playlist_items) pode ser editado à vontade e nunca afeta uma TV.
//  - PUBLICAR cria uma VERSÃO imutável (playlist_versions). Programações apontam para uma versão específica,
//    então editar o rascunho ou publicar uma versão nova não muda o que já está no ar.
export function createPlaylists({ db, tx, audit, config, media, organization }) {
  const find = id => (typeof id === 'string' && id.length <= 80 ? db.prepare('SELECT * FROM playlists WHERE id=?').get(id) : undefined);

  function load(id) {
    const row = find(id);
    if (!row) fail(404, 'Playlist não encontrada.');
    return row;
  }

  const dto = (row, extra = {}) => ({
    id: row.id, unitId: row.unit_id, sectorId: row.sector_id, name: row.name, description: row.description,
    loop: row.loop_enabled === 1, draftRev: row.draft_rev, publishedRev: row.published_rev, latestVersion: row.latest_version,
    hasUnpublishedChanges: row.latest_version === 0 || row.draft_rev !== row.published_rev,
    createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by, ...extra
  });

  // Situação de cada conteúdo para a pessoa saber o que impede a publicação.
  const readiness = row => {
    if (row.status === 'rejected') return 'rejected';
    if (row.status !== 'approved') return 'pending';
    if (config.production && row.scan_status !== 'clean') return 'not_scanned';
    return 'ready';
  };

  function draftItems(playlistId) {
    return db.prepare(`SELECT i.id, i.position, i.media_id, i.duration_s, i.duration_mode, i.transition, i.transition_ms, m.title, m.name, m.type, m.status, m.scan_status, m.folder_id
      FROM playlist_items i JOIN media m ON m.id=i.media_id WHERE i.playlist_id=? ORDER BY i.position`).all(playlistId).map(row => ({
      id: row.id, position: row.position, mediaId: row.media_id, durationS: row.duration_s, durationMode: row.duration_mode, transition: row.transition, transitionMs: row.transition_ms,
      media: { id: row.media_id, title: row.title, name: row.name, type: row.type, status: row.status, scanStatus: row.scan_status, folderId: row.folder_id, url: `/api/media/${row.media_id}/file` },
      readiness: readiness(row)
    }));
  }

  function versionItems(versionId) {
    return db.prepare(`SELECT vi.position, vi.media_id, vi.title, vi.name, vi.type, vi.duration_s, vi.duration_mode, vi.transition, vi.transition_ms, m.status, m.scan_status
      FROM playlist_version_items vi LEFT JOIN media m ON m.id=vi.media_id WHERE vi.version_id=? ORDER BY vi.position`).all(versionId).map(row => ({
      position: row.position, mediaId: row.media_id, durationS: row.duration_s, durationMode: row.duration_mode, transition: row.transition, transitionMs: row.transition_ms,
      media: { id: row.media_id, title: row.title, name: row.name, type: row.type, url: row.media_id ? `/api/media/${row.media_id}/file` : null },
      readiness: row.media_id ? readiness(row) : 'deleted'
    }));
  }

  function versionsOf(playlistId) {
    return db.prepare(`SELECT v.id, v.version, v.note, v.published_at, v.published_by, (SELECT COUNT(*) FROM playlist_version_items WHERE version_id=v.id) AS item_count
      FROM playlist_versions v WHERE v.playlist_id=? ORDER BY v.version DESC`).all(playlistId)
      .map(row => ({ id: row.id, version: row.version, note: row.note, publishedAt: row.published_at, publishedBy: row.published_by, itemCount: row.item_count }));
  }

  const schedulesOf = playlistId => db.prepare('SELECT id, name, status, playlist_version AS version FROM schedules WHERE playlist_id=? ORDER BY name').all(playlistId)
    .map(row => ({ id: row.id, name: row.name, status: row.status, version: row.version }));

  // Limite por playlist (configurável, 6 por padrão). Playlists antigas que já passavam do limite podem
  // continuar como estão ou encolher, mas não crescer.
  function assertLimit(count, current) {
    if (count > Math.max(config.playlistMaxItems, current)) fail(400, `Uma playlist aceita até ${config.playlistMaxItems} conteúdos.`, 'PLAYLIST_LIMIT');
  }

  function normalizeItems(items, playlist, current) {
    if (!Array.isArray(items)) fail(400, 'Informe a lista de conteúdos da playlist.');
    assertLimit(items.length, current);
    return items.map((item, index) => {
      if (!item || typeof item !== 'object') fail(400, `O item ${index + 1} é inválido.`);
      const row = media.find(item.mediaId);
      if (!row) fail(400, `O conteúdo do item ${index + 1} não foi encontrado.`, 'MEDIA_NOT_FOUND');
      if (row.unit_id !== playlist.unit_id || row.sector_id !== playlist.sector_id) fail(400, `O conteúdo "${row.title}" pertence a outra unidade ou setor.`, 'SCOPE_MISMATCH');
      if (row.status === 'rejected') fail(400, `O conteúdo "${row.title}" foi rejeitado e não pode entrar em playlists.`, 'MEDIA_REJECTED');
      const transition = oneOf(item.transition ?? 'cut', TRANSITIONS, 'Transição inválida.');
      const transitionMs = transition === 'cut' ? 0 : integer(item.transitionMs ?? DEFAULT_TRANSITION_MS, 0, 3000, 'A duração da transição deve ficar entre 0 e 3000 ms.');
      const durationMode = oneOf(item.durationMode ?? 'fixed', DURATION_MODES, 'Modo de duração inválido.');
      if (durationMode === 'natural' && kindOf(row.type) !== 'video') fail(400, `A duração natural só vale para vídeos. Defina o tempo de exibição de "${row.title}".`, 'DURATION_MODE_INVALID');
      return { mediaId: row.id, durationS: integer(item.durationS ?? DEFAULT_DURATION, 5, 3600, 'A duração deve ficar entre 5 e 3600 segundos.'), durationMode, transition, transitionMs };
    });
  }

  function requireRev(playlist, rev) {
    if (!Number.isInteger(rev)) fail(400, 'Informe a revisão (rev) da playlist que você está editando.');
    if (rev !== playlist.draft_rev) fail(409, 'Esta playlist foi alterada por outra pessoa. Atualize a página para ver a versão mais recente.', 'REVISION_CONFLICT', { currentRev: playlist.draft_rev });
  }

  // A repetição (loop) é um sim/não explícito: "true"/"false" em texto, 0 ou 1 e outros valores são recusados.
  function repeatFlag(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail(400, 'A repetição da playlist deve ser verdadeira ou falsa.', 'LOOP_INVALID');
    return value;
  }

  function writeItems(playlistId, items) {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id=?').run(playlistId);
    const insert = db.prepare('INSERT INTO playlist_items(id, playlist_id, position, media_id, duration_s, duration_mode, transition, transition_ms) VALUES(?,?,?,?,?,?,?,?)');
    items.forEach((item, position) => insert.run(randomUUID(), playlistId, position, item.mediaId, item.durationS, item.durationMode ?? 'fixed', item.transition, item.transitionMs));
  }

  const countItems = playlistId => db.prepare('SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id=?').get(playlistId).n;

  function list(actor, query) {
    const unitId = safeId(query.unitId, 'Unidade inválida.'), sectorId = safeId(query.sectorId, 'Setor inválido.');
    authorize(actor, null, { unitId, sectorId });
    const key = searchKey(String(query.q ?? '').slice(0, 100));
    const limit = integer(query.limit ?? 100, 1, 200, 'Limite inválido.'), offset = integer(query.offset ?? 0, 0, 1000000, 'Deslocamento inválido.');
    const select = `SELECT p.*, (SELECT COUNT(*) FROM playlist_items WHERE playlist_id=p.id) AS item_count,
      (SELECT COUNT(*) FROM schedules WHERE playlist_id=p.id) AS schedule_count,
      (SELECT COUNT(*) FROM schedules WHERE playlist_id=p.id AND status='published') AS live_count
      FROM playlists p WHERE p.unit_id=? AND p.sector_id=? ORDER BY p.updated_at DESC, p.id`;
    // Sem busca, a paginação é feita no banco. Com busca, o filtro ignora acentos e caixa (como na biblioteca),
    // então é aplicado aqui: o número de playlists por unidade/setor é pequeno.
    let rows, total;
    if (key) {
      const matching = db.prepare(select).all(unitId, sectorId).filter(row => searchKey(row.name).includes(key));
      total = matching.length; rows = matching.slice(offset, offset + limit);
    } else {
      total = db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE unit_id=? AND sector_id=?').get(unitId, sectorId).n;
      rows = db.prepare(`${select} LIMIT ? OFFSET ?`).all(unitId, sectorId, limit, offset);
    }
    return { playlists: rows.map(row => dto(row, { itemCount: row.item_count, scheduleCount: row.schedule_count, liveScheduleCount: row.live_count })), total, limit, offset, maxItems: config.playlistMaxItems };
  }

  function get(actor, id) {
    const row = load(id);
    authorize(actor, null, scopeOf(row));
    return { ...dto(row), items: draftItems(row.id), versions: versionsOf(row.id), schedules: schedulesOf(row.id), maxItems: config.playlistMaxItems };
  }

  function create(actor, body) {
    const unitId = safeId(body.unitId, 'Unidade inválida.'), sectorId = safeId(body.sectorId, 'Setor inválido.');
    authorize(actor, 'playlist:create', { unitId, sectorId });
    if (!organization.unitExists(unitId) || !organization.sectorExists(sectorId)) fail(400, 'Unidade ou setor inválido.');
    const name = label(body.name);
    const description = body.description === undefined || body.description === '' ? '' : label(body.description, 500);
    const id = randomUUID(), at = nowIso();
    const draft = { id, unit_id: unitId, sector_id: sectorId };
    const items = body.items === undefined ? [] : normalizeItems(body.items, draft, 0);
    const loop = repeatFlag(body.loop, true);
    tx(() => {
      db.prepare(`INSERT INTO playlists(id, unit_id, sector_id, name, description, loop_enabled, draft_rev, published_rev, latest_version, created_at, created_by, updated_at, updated_by)
        VALUES(?,?,?,?,?,?,1,0,0,?,?,?,?)`).run(id, unitId, sectorId, name, description, loop ? 1 : 0, at, actor.id, at, actor.id);
      writeItems(id, items);
      audit.record(actor, 'playlist.created', { playlistId: id, name, items: items.length, ...(loop ? {} : { loop: false }) }, { unitId, sectorId });
    });
    return get(actor, id);
  }

  function update(actor, id, body) {
    const row = load(id);
    authorize(actor, 'playlist:update', scopeOf(row));
    requireRev(row, body.rev);
    const name = body.name !== undefined ? label(body.name) : row.name;
    const description = body.description !== undefined ? (body.description === '' ? '' : label(body.description, 500)) : row.description;
    const current = countItems(row.id);
    const items = body.items !== undefined ? normalizeItems(body.items, row, current) : null;
    const loop = repeatFlag(body.loop, row.loop_enabled === 1);
    tx(() => {
      if (items) writeItems(row.id, items);
      db.prepare('UPDATE playlists SET name=?, description=?, loop_enabled=?, draft_rev=draft_rev+1, updated_at=?, updated_by=? WHERE id=?').run(name, description, loop ? 1 : 0, nowIso(), actor.id, row.id);
      audit.record(actor, 'playlist.updated', { playlistId: row.id, name, renamed: name !== row.name, items: items ? items.length : undefined, loop: loop !== (row.loop_enabled === 1) ? loop : undefined }, scopeOf(row));
    });
    return get(actor, row.id);
  }

  function publish(actor, id, body = {}) {
    const row = load(id);
    authorize(actor, 'playlist:publish', scopeOf(row));
    requireRev(row, body.rev);
    const note = body.note === undefined || body.note === '' ? '' : label(body.note, 200);
    const items = draftItems(row.id);
    if (!items.length) fail(400, 'A playlist precisa ter ao menos um conteúdo para ser publicada.', 'PLAYLIST_EMPTY');
    const latestCount = row.latest_version ? db.prepare('SELECT COUNT(*) AS n FROM playlist_version_items WHERE version_id=(SELECT id FROM playlist_versions WHERE playlist_id=? AND version=?)').get(row.id, row.latest_version).n : 0;
    assertLimit(items.length, latestCount);
    const notReady = items.filter(item => item.readiness !== 'ready');
    if (notReady.length) {
      fail(409, `Há conteúdos que ainda não foram liberados: ${notReady.map(item => `"${item.media.title}"`).join(', ')}. Aprove-os na biblioteca antes de publicar.`, 'MEDIA_NOT_READY',
        { items: notReady.map(item => ({ mediaId: item.mediaId, title: item.media.title, readiness: item.readiness })) });
    }
    if (row.latest_version > 0 && row.published_rev === row.draft_rev) fail(409, 'Não há alterações novas para publicar.', 'NO_CHANGES');
    const version = row.latest_version + 1, versionId = randomUUID();
    tx(() => {
      db.prepare('INSERT INTO playlist_versions(id, playlist_id, version, note, published_at, published_by, loop_enabled) VALUES(?,?,?,?,?,?,?)').run(versionId, row.id, version, note, nowIso(), actor.id, row.loop_enabled);
      const insert = db.prepare(`INSERT INTO playlist_version_items(version_id, position, media_id, title, name, type, duration_s, duration_mode, transition, transition_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`);
      for (const item of items) insert.run(versionId, item.position, item.mediaId, item.media.title, item.media.name, item.media.type, item.durationS, item.durationMode, item.transition, item.transitionMs);
      db.prepare('UPDATE playlists SET latest_version=?, published_rev=draft_rev, updated_at=?, updated_by=? WHERE id=?').run(version, nowIso(), actor.id, row.id);
      audit.record(actor, 'playlist.version.published', { playlistId: row.id, name: row.name, version, items: items.length, note, ...(row.loop_enabled === 1 ? {} : { loop: false }) }, scopeOf(row));
    });
    return get(actor, row.id);
  }

  // Copia uma versão antiga para o rascunho (não publica nada). Conteúdos excluídos desde então ficam de fora.
  function restore(actor, id, body) {
    const row = load(id);
    authorize(actor, 'playlist:update', scopeOf(row));
    requireRev(row, body.rev);
    const version = integer(body.version, 1, 1000000, 'Informe a versão a restaurar.');
    const found = db.prepare('SELECT id, loop_enabled FROM playlist_versions WHERE playlist_id=? AND version=?').get(row.id, version);
    if (!found) fail(404, 'Versão não encontrada.');
    const snapshot = versionItems(found.id);
    const usable = snapshot.filter(item => item.mediaId && media.find(item.mediaId));
    const skipped = snapshot.length - usable.length;
    const items = usable.map(item => ({ mediaId: item.mediaId, durationS: item.durationS, durationMode: item.durationMode, transition: item.transition, transitionMs: item.transitionMs }));
    assertLimit(items.length, countItems(row.id));
    tx(() => {
      writeItems(row.id, items);
      db.prepare('UPDATE playlists SET loop_enabled=?, draft_rev=draft_rev+1, updated_at=?, updated_by=? WHERE id=?').run(found.loop_enabled, nowIso(), actor.id, row.id);
      audit.record(actor, 'playlist.version.restored', { playlistId: row.id, name: row.name, version, items: items.length, skipped }, scopeOf(row));
    });
    return { ...get(actor, row.id), restored: { version, skipped } };
  }

  function version(actor, id, number) {
    const row = load(id);
    authorize(actor, null, scopeOf(row));
    const found = db.prepare('SELECT * FROM playlist_versions WHERE playlist_id=? AND version=?').get(row.id, integer(Number(number), 1, 1000000, 'Versão inválida.'));
    if (!found) fail(404, 'Versão não encontrada.');
    return { playlistId: row.id, version: found.version, note: found.note, loop: found.loop_enabled === 1, publishedAt: found.published_at, publishedBy: found.published_by, items: versionItems(found.id) };
  }

  function remove(actor, id) {
    const row = load(id);
    authorize(actor, 'playlist:delete', scopeOf(row));
    const schedules = schedulesOf(row.id);
    if (schedules.length) fail(409, 'Esta playlist é usada por programações. Exclua ou troque as programações antes de excluir a playlist.', 'PLAYLIST_IN_USE', { schedules });
    tx(() => {
      db.prepare('DELETE FROM playlists WHERE id=?').run(row.id);
      audit.record(actor, 'playlist.deleted', { playlistId: row.id, name: row.name }, scopeOf(row));
    });
    return { ok: true };
  }

  return { find, load, list, get, create, update, publish, restore, version, remove, versionItems, scopeOf };
}
