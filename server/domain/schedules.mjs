import { randomUUID } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { idList, integer, label, nowIso, oneOf, parseTime, safeId } from '../lib/validate.mjs';
import { authorize } from './permissions.mjs';

const STATUSES = ['draft', 'published', 'stopped'];
const scopeOf = row => ({ unitId: row.unit_id, sectorId: row.sector_id });
const marks = ids => ids.map(() => '?').join(',');

// Programação = QUANDO e ONDE uma versão de playlist toca (telas + janela de datas).
// Ela aponta para uma VERSÃO fixa: editar o rascunho da playlist não muda o que está no ar.
// Estados: rascunho (draft) → publicada (published) → interrompida (stopped); interrompida pode ser publicada de novo.
export function createSchedules({ db, tx, audit, media, playlists, access }) {
  const find = id => (typeof id === 'string' && id.length <= 80 ? db.prepare('SELECT * FROM schedules WHERE id=?').get(id) : undefined);

  function load(id) {
    const row = find(id);
    if (!row) fail(404, 'Programação não encontrada.');
    return row;
  }

  const stateOf = (row, now = Date.now()) => {
    if (row.status !== 'published') return row.status;
    if (row.start_at && Date.parse(row.start_at) > now) return 'scheduled';
    if (row.end_at && Date.parse(row.end_at) <= now) return 'expired';
    return 'live';
  };

  function displaysFor(ids) {
    const map = new Map(ids.map(id => [id, []]));
    if (!ids.length) return map;
    const rows = db.prepare(`SELECT sd.schedule_id AS scheduleId, d.id AS id, d.name AS name, d.status AS status,sd.link_status AS linkStatus,sd.suspension_reason AS suspensionReason FROM schedule_displays sd JOIN displays d ON d.id=sd.display_id
      WHERE sd.schedule_id IN (${marks(ids)}) AND sd.link_status!='removed' ORDER BY d.name`).all(...ids);
    for (const row of rows) map.get(row.scheduleId).push({ id: row.id, name: row.name, status: row.status,linkStatus:row.linkStatus,suspensionReason:row.suspensionReason });
    return map;
  }

  function dto(row, displays, extra = {}) {
    return {
      id: row.id, unitId: row.unit_id, sectorId: row.sector_id, name: row.name, playlistId: row.playlist_id, playlistName: extra.playlistName ?? null,
      playlistVersion: row.playlist_version, newerVersionAvailable: extra.latestVersion ? extra.latestVersion > row.playlist_version : false,
      status: row.status, state: stateOf(row), startAt: row.start_at, endAt: row.end_at, rev: row.rev,
      displayIds: displays.map(d => d.id), displays,
      createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by,
      publishedAt: row.published_at, publishedBy: row.published_by, stoppedAt: row.stopped_at, stoppedBy: row.stopped_by
    };
  }

  function list(actor, query) {
    access.reconcile();
    const unitId = safeId(query.unitId, 'Unidade inválida.'), sectorId = safeId(query.sectorId, 'Setor inválido.');
    authorize(actor, null, { unitId, sectorId });
    const where = ['s.unit_id=?', 's.sector_id=?'], params = [unitId, sectorId];
    if (query.status) { where.push('s.status=?'); params.push(oneOf(query.status, STATUSES, 'Situação inválida.')); }
    if (query.playlistId) { where.push('s.playlist_id=?'); params.push(String(query.playlistId)); }
    const limit = integer(query.limit ?? 100, 1, 200, 'Limite inválido.'), offset = integer(query.offset ?? 0, 0, 1000000, 'Deslocamento inválido.');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM schedules s WHERE ${where.join(' AND ')}`).get(...params).n;
    const rows = db.prepare(`SELECT s.*, p.name AS playlist_name, p.latest_version AS latest_version FROM schedules s JOIN playlists p ON p.id=s.playlist_id
      WHERE ${where.join(' AND ')} ORDER BY CASE s.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, s.updated_at DESC, s.id LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const displays = displaysFor(rows.map(row => row.id));
    return { schedules: rows.map(row => dto(row, displays.get(row.id), { playlistName: row.playlist_name, latestVersion: row.latest_version })), total, limit, offset };
  }

  function view(row) {
    const playlist = db.prepare('SELECT name, latest_version FROM playlists WHERE id=?').get(row.playlist_id);
    return dto(row, displaysFor([row.id]).get(row.id), { playlistName: playlist?.name, latestVersion: playlist?.latest_version });
  }

  function get(actor, id) {
    access.reconcile();
    const row = load(id);
    authorize(actor, null, scopeOf(row));
    return view(row);
  }

  function checkWindow(startAt, endAt, { requireFuture }) {
    if (endAt && Date.parse(endAt) <= (startAt ? Date.parse(startAt) : Date.now())) fail(400, 'O término deve ser posterior ao início e ao momento atual.');
    if (requireFuture && endAt && Date.parse(endAt) <= Date.now()) fail(400, 'O término deve ser posterior ao início e ao momento atual.');
  }

  function checkDisplays(ids, row, { requireActive,actor }) {
    const list = idList(ids, { max: 200, message: 'Selecione as TVs da programação.' });
    const found = list.map(id => db.prepare('SELECT * FROM displays WHERE id=?').get(id));
    if (found.some(display => !display||display.removed_at)) fail(400, 'Uma das TVs selecionadas não foi encontrada.');
    if (found.some(display => display.unit_id !== row.unit_id)) fail(400, 'Selecione TVs da mesma unidade da programação.', 'SCOPE_MISMATCH');
    if(found.some(display=>!access.mayUse(actor,display,row.sector_id)))fail(403,'Sem autorização para publicar neste destino e setor.','DISPLAY_ACCESS_DENIED');
    if (requireActive && found.some(display => display.status !== 'active')) fail(400, 'Selecione somente TVs ativas. TVs aguardando ativação não recebem programação.', 'DISPLAY_NOT_ACTIVE');
    return list;
  }

  // Tudo o que precisa ser verdade para uma programação poder ir ao ar.
  function assertPublishable(row, displayIds,actor) {
    if (!displayIds.length) fail(400, 'Selecione ao menos uma TV para publicar.', 'NO_DISPLAYS');
    checkDisplays(displayIds, row, { requireActive: true,actor });
    checkWindow(row.start_at, row.end_at, { requireFuture: true });
    const version = db.prepare('SELECT id FROM playlist_versions WHERE playlist_id=? AND version=?').get(row.playlist_id, row.playlist_version);
    if (!version) fail(409, 'A versão da playlist não existe mais.', 'VERSION_MISSING');
    const items = playlists.versionItems(version.id);
    if (!items.length) fail(409, 'A versão da playlist está vazia.', 'PLAYLIST_EMPTY');
    const blocked = items.filter(item => {
      if (!item.mediaId) return true;
      const m = media.find(item.mediaId);
      return !m || !media.released(m) || m.unit_id !== row.unit_id || m.sector_id !== row.sector_id;
    });
    if (blocked.length) {
      fail(409, `Há conteúdos indisponíveis nesta versão da playlist: ${blocked.map(item => `"${item.media.title}"`).join(', ')}. Publique uma versão nova da playlist.`, 'MEDIA_NOT_READY',
        { items: blocked.map(item => ({ mediaId: item.mediaId, title: item.media.title })) });
    }
  }

  function resolvePlaylist(body, unitId, sectorId) {
    const playlist = playlists.find(String(body.playlistId ?? ''));
    if (!playlist) fail(404, 'Playlist não encontrada.');
    if (playlist.unit_id !== unitId || playlist.sector_id !== sectorId) fail(400, 'A playlist pertence a outra unidade ou setor.', 'SCOPE_MISMATCH');
    if (playlist.latest_version < 1) fail(409, 'Publique uma versão da playlist antes de programá-la.', 'PLAYLIST_NOT_PUBLISHED');
    const version = body.playlistVersion === undefined ? playlist.latest_version : integer(body.playlistVersion, 1, 1000000, 'Versão da playlist inválida.');
    if (!db.prepare('SELECT 1 AS ok FROM playlist_versions WHERE playlist_id=? AND version=?').get(playlist.id, version)) fail(404, 'Versão da playlist não encontrada.');
    return { playlist, version };
  }

  function create(actor, body) {
    const unitId = safeId(body.unitId, 'Unidade inválida.'), sectorId = safeId(body.sectorId, 'Setor inválido.');
    authorize(actor, 'schedule:create', { unitId, sectorId });
    const wantsPublish = body.publish === true;
    if (wantsPublish) authorize(actor, 'schedule:publish', { unitId, sectorId });
    const name = label(body.name);
    const { playlist, version } = resolvePlaylist(body, unitId, sectorId);
    const row = { unit_id: unitId, sector_id: sectorId, playlist_id: playlist.id, playlist_version: version, start_at: parseTime(body.startAt), end_at: parseTime(body.endAt) };
    checkWindow(row.start_at, row.end_at, { requireFuture: true });
    const displayIds = checkDisplays(body.displayIds ?? [], row, { requireActive: wantsPublish,actor });
    if (wantsPublish) assertPublishable(row, displayIds,actor);
    const id = randomUUID(), at = nowIso();
    tx(() => {
      db.prepare(`INSERT INTO schedules(id, unit_id, sector_id, name, playlist_id, playlist_version, status, start_at, end_at, rev, created_at, created_by, updated_at, updated_by,
        published_at, published_by) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)`)
        .run(id, unitId, sectorId, name, playlist.id, version, wantsPublish ? 'published' : 'draft', row.start_at, row.end_at, at, actor.id, at, actor.id, wantsPublish ? at : null, wantsPublish ? actor.id : null);
      access.bind(id,displayIds,actor);
      audit.record(actor, 'schedule.created', { scheduleId: id, name, playlistId: playlist.id, playlistVersion: version, displayIds, startAt: row.start_at, endAt: row.end_at }, { unitId, sectorId });
      if (wantsPublish) audit.record(actor, 'schedule.published', { scheduleId: id, name, playlistVersion: version, displayIds, startAt: row.start_at, endAt: row.end_at }, { unitId, sectorId });
    });
    return view(find(id));
  }

  function update(actor, id, body) {
    const row = load(id);
    const live = row.status !== 'draft';
    authorize(actor, live ? 'schedule:publish' : 'schedule:create', scopeOf(row));
    if (!Number.isInteger(body.rev)) fail(400, 'Informe a revisão (rev) da programação que você está editando.');
    if (body.rev !== row.rev) fail(409, 'Esta programação foi alterada por outra pessoa. Atualize a página para ver a versão mais recente.', 'REVISION_CONFLICT', { currentRev: row.rev });
    if (body.playlistId !== undefined && body.playlistId !== row.playlist_id) fail(400, 'Para trocar de playlist, crie uma nova programação.', 'PLAYLIST_IMMUTABLE');
    const next = { ...row };
    if (body.name !== undefined) next.name = label(body.name);
    if (body.playlistVersion !== undefined) next.playlist_version = resolvePlaylist({ playlistId: row.playlist_id, playlistVersion: body.playlistVersion }, row.unit_id, row.sector_id).version;
    if (body.startAt !== undefined) next.start_at = parseTime(body.startAt);
    if (body.endAt !== undefined) next.end_at = parseTime(body.endAt);
    checkWindow(next.start_at, next.end_at, { requireFuture: body.endAt !== undefined });
    const currentDisplays = db.prepare("SELECT display_id FROM schedule_displays WHERE schedule_id=? AND link_status!='removed'").all(row.id).map(item => item.display_id);
    const displayIds = checkDisplays(body.displayIds??currentDisplays, row, { requireActive: row.status === 'published',actor });
    if (row.status === 'published') assertPublishable(next, displayIds,actor);
    tx(() => {
      const changed=db.prepare('UPDATE schedules SET name=?, playlist_version=?, start_at=?, end_at=?, rev=rev+1, updated_at=?, updated_by=? WHERE id=? AND rev=?')
        .run(next.name, next.playlist_version, next.start_at, next.end_at, nowIso(), actor.id, row.id,body.rev).changes;
      if(!changed)fail(409,'Esta programação foi alterada por outra pessoa.','REVISION_CONFLICT');
      // Renomear ou ajustar a janela não transfere a autorização de vínculos existentes.
      // Uma retomada é explícita: interromper e publicar novamente. Novos destinos recebem seu próprio autor.
      access.bind(row.id,displayIds,actor,{reauthorize:false});
      audit.record(actor, 'schedule.updated', {
        scheduleId: row.id, name: next.name, status: row.status, playlistVersion: next.playlist_version, previousVersion: row.playlist_version,
        displayIds, startAt: next.start_at, endAt: next.end_at
      }, scopeOf(row));
    });
    return view(find(row.id));
  }

  function publish(actor, id, body = {}) {
    const row = load(id);
    authorize(actor, 'schedule:publish', scopeOf(row));
    if (body.rev !== undefined && body.rev !== row.rev) fail(409, 'Esta programação foi alterada por outra pessoa. Atualize a página.', 'REVISION_CONFLICT', { currentRev: row.rev });
    if (row.status === 'published') fail(409, 'Esta programação já está publicada.', 'ALREADY_PUBLISHED');
    const displayIds = db.prepare("SELECT display_id FROM schedule_displays WHERE schedule_id=? AND link_status!='removed'").all(row.id).map(item => item.display_id);
    assertPublishable(row, displayIds,actor);
    tx(() => {
      db.prepare("UPDATE schedules SET status='published', published_at=?, published_by=?, stopped_at=NULL, stopped_by=NULL, rev=rev+1, updated_at=?, updated_by=? WHERE id=?")
        .run(nowIso(), actor.id, nowIso(), actor.id, row.id);
      access.bind(row.id,displayIds,actor);
      audit.record(actor, 'schedule.published', { scheduleId: row.id, name: row.name, playlistVersion: row.playlist_version, displayIds, startAt: row.start_at, endAt: row.end_at }, scopeOf(row));
    });
    return view(find(row.id));
  }

  function stop(actor, id) {
    const row = load(id);
    authorize(actor, 'schedule:publish', scopeOf(row));
    if (row.status !== 'published') fail(409, 'Somente programações publicadas podem ser interrompidas.', 'NOT_PUBLISHED');
    tx(() => {
      db.prepare("UPDATE schedules SET status='stopped', stopped_at=?, stopped_by=?, rev=rev+1, updated_at=?, updated_by=? WHERE id=?").run(nowIso(), actor.id, nowIso(), actor.id, row.id);
      audit.record(actor, 'schedule.stopped', { scheduleId: row.id, name: row.name }, scopeOf(row));
    });
    return view(find(row.id));
  }

  function remove(actor, id) {
    const row = load(id);
    authorize(actor, row.status === 'draft' ? 'schedule:create' : 'schedule:publish', scopeOf(row));
    if (row.status === 'published') fail(409, 'Interrompa a programação antes de excluí-la.', 'SCHEDULE_LIVE');
    tx(() => {
      access.bind(row.id,[],actor);
      db.prepare('DELETE FROM schedules WHERE id=?').run(row.id);
      audit.record(actor, 'schedule.deleted', { scheduleId: row.id, name: row.name }, scopeOf(row));
    });
    return { ok: true };
  }

  return { find, load, list, get, create, update, publish, stop, remove, stateOf };
}
