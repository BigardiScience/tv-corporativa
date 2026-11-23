import { randomUUID } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { itemName, nowIso, safeId, searchKey } from '../lib/validate.mjs';
import { authorize } from './permissions.mjs';

export const MAX_DEPTH = 8;
const scopeOf = row => ({ unitId: row.unit_id, sectorId: row.sector_id });

export const folderDto = row => ({
  id: row.id, unitId: row.unit_id, sectorId: row.sector_id, parentId: row.parent_id, name: row.name, depth: row.depth,
  createdAt: row.created_at, createdBy: row.created_by, updatedAt: row.updated_at, updatedBy: row.updated_by
});

// Pastas da biblioteca. Cada pasta tem identificador permanente (UUID) e mora em um espaço = unidade + setor.
// Mover ou renomear uma pasta NÃO altera o identificador, portanto não quebra playlists nem programações.
export function createFolders({ db, tx, audit, organization }) {
  const find = id => (typeof id === 'string' && id.length <= 80 ? db.prepare('SELECT * FROM folders WHERE id=?').get(id) : undefined);

  function load(id) {
    const row = find(id);
    if (!row) fail(404, 'Pasta não encontrada.');
    return row;
  }

  function assertSpace(unitId, sectorId) {
    if (!organization.unitExists(unitId) || !organization.sectorExists(sectorId)) fail(400, 'Unidade ou setor inválido.');
  }

  // Pasta de destino/pai precisa existir e pertencer ao MESMO espaço.
  function parentIn(parentId, unitId, sectorId) {
    const parent = find(parentId);
    if (!parent) fail(404, 'Pasta de destino não encontrada.');
    if (parent.unit_id !== unitId || parent.sector_id !== sectorId) fail(400, 'A pasta de destino pertence a outra unidade ou setor.', 'SCOPE_MISMATCH');
    return parent;
  }

  const conflict = (unitId, sectorId, parentId, key, exceptId = null) => !!db.prepare(
    'SELECT 1 AS ok FROM folders WHERE unit_id=? AND sector_id=? AND parent_id IS ? AND name_key=? AND id IS NOT ?').get(unitId, sectorId, parentId ?? null, key, exceptId);

  function create(actor, body) {
    const unitId = safeId(body.unitId, 'Unidade inválida.'), sectorId = safeId(body.sectorId, 'Setor inválido.');
    authorize(actor, 'folder:create', { unitId, sectorId });
    assertSpace(unitId, sectorId);
    const name = itemName(body.name, { what: 'nome da pasta' });
    const parentId = body.parentId ? String(body.parentId) : null;
    const parent = parentId ? parentIn(parentId, unitId, sectorId) : null;
    if ((parent?.depth ?? 0) >= MAX_DEPTH) fail(400, `O limite é de ${MAX_DEPTH} níveis de pastas.`, 'FOLDER_DEPTH');
    const key = searchKey(name);
    if (conflict(unitId, sectorId, parent?.id, key)) fail(409, 'Já existe uma pasta com este nome neste local.', 'NAME_CONFLICT');
    const id = randomUUID(), at = nowIso();
    tx(() => {
      db.prepare(`INSERT INTO folders(id, unit_id, sector_id, parent_id, name, name_key, search_key, depth, path, created_at, created_by, updated_at, updated_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, unitId, sectorId, parent?.id ?? null, name, key, key, (parent?.depth ?? 0) + 1, `${parent?.path ?? '/'}${id}/`, at, actor.id, at, actor.id);
      audit.record(actor, 'folder.created', { folderId: id, name, parentId: parent?.id ?? null }, { unitId, sectorId });
    });
    return folderDto(find(id));
  }

  function rename(actor, id, value) {
    const folder = load(id);
    authorize(actor, 'folder:update', scopeOf(folder));
    const name = itemName(value, { what: 'nome da pasta' }), key = searchKey(name);
    if (conflict(folder.unit_id, folder.sector_id, folder.parent_id, key, folder.id)) fail(409, 'Já existe uma pasta com este nome neste local.', 'NAME_CONFLICT');
    if (name === folder.name) return folderDto(folder);
    tx(() => {
      db.prepare('UPDATE folders SET name=?, name_key=?, search_key=?, updated_at=?, updated_by=? WHERE id=?').run(name, key, key, nowIso(), actor.id, folder.id);
      audit.record(actor, 'folder.renamed', { folderId: folder.id, from: folder.name, to: name }, scopeOf(folder));
    });
    return folderDto(find(folder.id));
  }

  function move(actor, id, parentId) {
    const folder = load(id);
    authorize(actor, 'folder:update', scopeOf(folder));
    const parent = parentId ? parentIn(String(parentId), folder.unit_id, folder.sector_id) : null;
    if (parent && (parent.id === folder.id || parent.path.includes(`/${folder.id}/`))) {
      fail(400, 'Não é possível mover uma pasta para dentro dela mesma ou de uma de suas subpastas.', 'FOLDER_CYCLE');
    }
    if ((folder.parent_id ?? null) === (parent?.id ?? null)) return folderDto(folder);
    const depth = (parent?.depth ?? 0) + 1, delta = depth - folder.depth;
    const deepest = db.prepare('SELECT MAX(depth) AS depth FROM folders WHERE substr(path, 1, ?) = ?').get(folder.path.length, folder.path).depth;
    if (deepest + delta > MAX_DEPTH) fail(400, `O limite é de ${MAX_DEPTH} níveis de pastas.`, 'FOLDER_DEPTH');
    if (conflict(folder.unit_id, folder.sector_id, parent?.id, folder.name_key, folder.id)) fail(409, 'Já existe uma pasta com este nome no destino.', 'NAME_CONFLICT');
    const path = `${parent?.path ?? '/'}${folder.id}/`;
    tx(() => {
      db.prepare('UPDATE folders SET parent_id=?, path=?, depth=?, updated_at=?, updated_by=? WHERE id=?').run(parent?.id ?? null, path, depth, nowIso(), actor.id, folder.id);
      db.prepare('UPDATE folders SET path = ? || substr(path, ?), depth = depth + ? WHERE substr(path, 1, ?) = ? AND id <> ?')
        .run(path, folder.path.length + 1, delta, folder.path.length, folder.path, folder.id);
      audit.record(actor, 'folder.moved', { folderId: folder.id, name: folder.name, fromParentId: folder.parent_id, toParentId: parent?.id ?? null }, scopeOf(folder));
    });
    return folderDto(find(folder.id));
  }

  // Pasta + todas as descendentes, das mais profundas para as mais rasas (ordem segura para excluir).
  const subtree = folder => db.prepare('SELECT * FROM folders WHERE substr(path, 1, ?) = ? ORDER BY depth DESC, path DESC').all(folder.path.length, folder.path);

  function breadcrumbs(folder) {
    const ids = folder.path.split('/').filter(Boolean);
    if (!ids.length) return [];
    const rows = db.prepare(`SELECT id, name FROM folders WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const byId = new Map(rows.map(row => [row.id, row.name]));
    return ids.filter(item => byId.has(item)).map(item => ({ id: item, name: byId.get(item) }));
  }

  // Todas as pastas de um espaço (para árvore de navegação e nomes de caminho).
  const inSpace = (unitId, sectorId) => db.prepare('SELECT * FROM folders WHERE unit_id=? AND sector_id=? ORDER BY depth, search_key').all(unitId, sectorId);

  function get(actor, id) {
    const folder = load(id);
    authorize(actor, null, scopeOf(folder));
    return folderDto(folder);
  }

  return { find, load, create, rename, move, subtree, breadcrumbs, inSpace, get, assertSpace, parentIn, scopeOf, conflict };
}
