import { fail } from '../lib/errors.mjs';
import { idList, integer, oneOf, safeId, searchKey } from '../lib/validate.mjs';
import { authorize } from './permissions.mjs';
import { folderDto } from './folders.mjs';
import { mediaDto } from './media.mjs';
import { KINDS } from './formats.mjs';

const SORTS = Object.freeze({ name: 'search_key', date: 'created_at', type: 'type', size: 'size', status: 'status' });
const STATUSES = ['pending', 'approved', 'rejected'];
const MAX_BATCH = 200;
const likeText = text => `%${text.replace(/[\\%_]/g, match => `\\${match}`)}%`;
const marks = ids => ids.map(() => '?').join(',');

// Operações da biblioteca que envolvem pastas E arquivos ao mesmo tempo: listagem/pesquisa e ações em lote.
// Toda ação em lote é "tudo ou nada": se um item falhar, nada é alterado.
export function createLibrary({ db, tx, audit, files, folders, media, usage }) {
  function list(actor, query) {
    const unitId = safeId(query.unitId, 'Unidade inválida.'), sectorId = safeId(query.sectorId, 'Setor inválido.');
    authorize(actor, null, { unitId, sectorId });
    folders.assertSpace(unitId, sectorId);
    const folder = query.folderId ? folders.load(String(query.folderId)) : null;
    if (folder && (folder.unit_id !== unitId || folder.sector_id !== sectorId)) fail(404, 'Pasta não encontrada.');
    const original = String(query.q ?? '').trim().slice(0, 100), text = searchKey(original);
    const kind = query.type ? oneOf(query.type, KINDS, 'Tipo inválido.') : '';
    const status = query.status ? oneOf(query.status, STATUSES, 'Situação inválida.') : '';
    const sort = oneOf(query.sort ?? 'name', Object.keys(SORTS), 'Ordenação inválida.');
    const order = oneOf(query.order ?? 'asc', ['asc', 'desc'], 'Ordem inválida.');
    const limit = integer(query.limit ?? 60, 1, 200, 'Limite inválido.'), offset = integer(query.offset ?? 0, 0, 1000000, 'Deslocamento inválido.');
    const searching = text !== '', wholeSpace = query.search === 'space' || !folder;
    // Lista plana (flat=1): ignora a hierarquia e devolve os arquivos da pasta e de todas as subpastas (ou do espaço inteiro, na raiz).
    // Serve para "todos os pendentes", "todos os vídeos" e para escolher arquivos sem navegar pastas. A pesquisa por texto também é plana.
    const flat = searching || query.flat === '1' || query.flat === 'true';

    const where = ['unit_id = ?', 'sector_id = ?'], params = [unitId, sectorId];
    if (flat) {
      if (!wholeSpace) { where.push('folder_id IN (SELECT id FROM folders WHERE substr(path, 1, ?) = ?)'); params.push(folder.path.length, folder.path); }
      if (searching) { where.push("search_key LIKE ? ESCAPE '\\'"); params.push(likeText(text)); }
    } else {
      where.push('folder_id IS ?'); params.push(folder?.id ?? null);
    }
    if (kind === 'image') where.push("type LIKE 'image/%'");
    if (kind === 'video') where.push("type LIKE 'video/%'");
    if (kind === 'pdf') where.push("type = 'application/pdf'");
    if (status) { where.push('status = ?'); params.push(status); }

    const total = db.prepare(`SELECT COUNT(*) AS n FROM media WHERE ${where.join(' AND ')}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM media WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sort]} ${order}, id LIMIT ? OFFSET ?`).all(...params, limit, offset);

    // Pastas aparecem na primeira página e somem quando um filtro de tipo/situação está ativo.
    let folderRows = [];
    if (!kind && !status && offset === 0) {
      const direction = sort === 'name' || sort === 'date' ? order : 'asc', column = sort === 'date' ? 'created_at' : 'search_key';
      if (searching) {
        const scope = wholeSpace ? '' : 'AND substr(path, 1, ?) = ? AND id <> ?';
        const extra = wholeSpace ? [] : [folder.path.length, folder.path, folder.id];
        folderRows = db.prepare(`SELECT * FROM folders WHERE unit_id=? AND sector_id=? AND search_key LIKE ? ESCAPE '\\' ${scope} ORDER BY depth, ${column} ${direction} LIMIT 100`)
          .all(unitId, sectorId, likeText(text), ...extra);
      } else if (!flat) {
        folderRows = db.prepare(`SELECT * FROM folders WHERE unit_id=? AND sector_id=? AND parent_id IS ? ORDER BY ${column} ${direction}, id`).all(unitId, sectorId, folder?.id ?? null);
      }
    }

    const counts = { children: new Map(), media: new Map() };
    if (folderRows.length) {
      const ids = folderRows.map(row => row.id);
      for (const row of db.prepare(`SELECT parent_id AS id, COUNT(*) AS n FROM folders WHERE parent_id IN (${marks(ids)}) GROUP BY parent_id`).all(...ids)) counts.children.set(row.id, row.n);
      for (const row of db.prepare(`SELECT folder_id AS id, COUNT(*) AS n FROM media WHERE folder_id IN (${marks(ids)}) GROUP BY folder_id`).all(...ids)) counts.media.set(row.id, row.n);
    }
    let names = null;
    if (flat) names = new Map(folders.inSpace(unitId, sectorId).map(row => [row.id, row]));
    const pathNames = row => {
      if (!names || !row.path) return null;
      return row.path.split('/').filter(Boolean).slice(0, -1).map(id => names.get(id)?.name).filter(Boolean);
    };
    const use = usage.forMedia(rows.map(row => row.id));

    return {
      space: { unitId, sectorId },
      folder: folder ? folderDto(folder) : null,
      breadcrumbs: folder ? folders.breadcrumbs(folder) : [],
      folders: folderRows.map(row => ({ ...folderDto(row), childFolders: counts.children.get(row.id) ?? 0, mediaCount: counts.media.get(row.id) ?? 0, parents: pathNames(row) })),
      media: rows.map(row => {
        const u = use.get(row.id);
        return {
          ...mediaDto(row),
          usage: { playlists: u.playlists.length, schedules: u.schedules.length, liveSchedules: u.schedules.filter(s => s.status === 'published').length, versions: u.versions },
          folderPath: flat ? (row.folder_id ? [...(pathNames(names.get(row.folder_id)) ?? []), names.get(row.folder_id)?.name].filter(Boolean) : []) : null
        };
      }),
      total, limit, offset,
      query: { q: original, type: kind, status, sort, order, flat, search: flat ? (wholeSpace ? 'space' : 'tree') : null }
    };
  }

  function tree(actor, query) {
    const unitId = safeId(query.unitId, 'Unidade inválida.'), sectorId = safeId(query.sectorId, 'Setor inválido.');
    authorize(actor, null, { unitId, sectorId });
    folders.assertSpace(unitId, sectorId);
    return { space: { unitId, sectorId }, folders: folders.inSpace(unitId, sectorId).map(folderDto) };
  }

  // ---- exclusão (pasta e/ou arquivos) -------------------------------------------------------------------
  function deleteItems(actor, { folderIds = [], mediaIds = [], recursive = false }) {
    const folderRows = folderIds.map(id => folders.load(id)), mediaRows = mediaIds.map(id => media.load(id));
    for (const row of folderRows) authorize(actor, 'folder:delete', folders.scopeOf(row));
    for (const row of mediaRows) authorize(actor, 'media:delete', media.scopeOf(row));
    const allFolders = new Map();
    for (const row of folderRows) for (const sub of folders.subtree(row)) allFolders.set(sub.id, sub);
    const inside = allFolders.size ? db.prepare(`SELECT * FROM media WHERE folder_id IN (${marks([...allFolders.keys()])})`).all(...allFolders.keys()) : [];
    const subfolders = [...allFolders.values()].filter(row => !folderRows.some(selected => selected.id === row.id)).length;
    if ((subfolders || inside.length) && !recursive) {
      fail(409, 'A pasta não está vazia. Confirme para excluir a pasta e tudo o que há dentro dela.', 'FOLDER_NOT_EMPTY', { folders: subfolders, media: inside.length });
    }
    for (const row of inside) authorize(actor, 'media:delete', media.scopeOf(row));
    const everyMedia = new Map([...mediaRows, ...inside].map(row => [row.id, row]));
    const blockers = usage.blockers([...everyMedia.keys()]);
    if (blockers.blocked) {
      fail(409, 'Há conteúdos em uso por playlists ou programações publicadas. Retire-os de lá antes de excluir.', 'MEDIA_IN_USE',
        { ...blockers, media: blockers.mediaIds.map(id => ({ id, title: everyMedia.get(id).title })) });
    }
    const collector = [];
    tx(() => {
      media.deleteRows([...everyMedia.values()], actor, collector);
      for (const row of [...allFolders.values()].sort((a, b) => b.depth - a.depth)) {
        db.prepare('DELETE FROM folders WHERE id=?').run(row.id);
        audit.record(actor, 'folder.deleted', { folderId: row.id, name: row.name }, folders.scopeOf(row));
      }
    });
    return { collector, deleted: { folders: allFolders.size, media: everyMedia.size } };
  }

  async function removeFolder(actor, id, { recursive = false } = {}) {
    const { collector, deleted } = deleteItems(actor, { folderIds: [id], recursive });
    await Promise.all(collector.map(name => files.remove(name)));
    return { ok: true, deleted };
  }

  // ---- ações em lote ------------------------------------------------------------------------------------
  async function batch(actor, body) {
    const action = oneOf(body.action, ['move', 'delete', 'approve', 'reject'], 'Ação inválida.');
    const mediaIds = idList(body.mediaIds ?? [], { max: MAX_BATCH }), folderIds = idList(body.folderIds ?? [], { max: MAX_BATCH });
    if (!mediaIds.length && !folderIds.length) fail(400, 'Selecione ao menos um item.');
    if (mediaIds.length + folderIds.length > MAX_BATCH) fail(400, `Selecione no máximo ${MAX_BATCH} itens por vez.`);
    if ((action === 'approve' || action === 'reject') && folderIds.length) fail(400, 'Aprovar e rejeitar valem somente para arquivos.');
    const rows = [...folderIds.map(id => folders.load(id)), ...mediaIds.map(id => media.load(id))];
    const spaces = new Set(rows.map(row => `${row.unit_id}/${row.sector_id}`));
    if (spaces.size > 1) fail(400, 'Selecione itens de uma única unidade e setor.', 'SCOPE_MISMATCH');
    const scope = folders.scopeOf(rows[0]);
    authorize(actor, null, scope);

    let collector = [];
    let deleted;
    tx(() => {
      if (action === 'move') {
        const target = body.targetFolderId ? String(body.targetFolderId) : null;
        if (target) folders.parentIn(target, scope.unitId, scope.sectorId);
        for (const id of folderIds) folders.move(actor, id, target);
        for (const id of mediaIds) media.update(actor, id, { folderId: target });
      } else if (action === 'delete') {
        const result = deleteItems(actor, { folderIds, mediaIds, recursive: body.recursive === true });
        collector = result.collector; deleted = result.deleted;
      } else {
        for (const id of mediaIds) media.review(actor, id, action, body);
      }
      audit.record(actor, 'library.batch', { action, folders: folderIds.length, media: mediaIds.length }, scope);
    });
    await Promise.all(collector.map(name => files.remove(name)));
    return { ok: true, action, folders: folderIds.length, media: mediaIds.length, ...(deleted ? { deleted } : {}) };
  }

  return { list, tree, removeFolder, batch };
}
