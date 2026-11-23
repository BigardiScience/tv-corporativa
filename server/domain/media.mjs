import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fail } from '../lib/errors.mjs';
import { sha } from '../lib/crypto.mjs';
import { itemName, nowIso, safeId, searchKey } from '../lib/validate.mjs';
import { authorize } from './permissions.mjs';
import { MIME, UNSUPPORTED_FORMAT_MESSAGE, kindOf, signature } from './formats.mjs';
import { checkContent } from './content-check.mjs';

const scopeOf = row => ({ unitId: row.unit_id, sectorId: row.sector_id });

export const mediaDto = row => ({
  id: row.id, unitId: row.unit_id, sectorId: row.sector_id, folderId: row.folder_id, name: row.name, title: row.title,
  type: row.type, kind: kindOf(row.type), size: row.size, sha256: row.sha256, status: row.status, scanStatus: row.scan_status,
  createdAt: row.created_at, createdBy: row.created_by, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by, updatedAt: row.updated_at,
  url: `/api/media/${row.id}/file`
});

export function createMedia({ db, tx, audit, config, files, scanner, folders, usage }) {
  const find = id => (typeof id === 'string' && id.length <= 80 ? db.prepare('SELECT * FROM media WHERE id=?').get(id) : undefined);

  function load(id) {
    const row = find(id);
    if (!row) fail(404, 'Arquivo não encontrado.');
    return row;
  }

  // Liberado para exibição: aprovado e, em produção, também verificado pelo antimalware.
  const released = row => row?.status === 'approved' && (!config.production || row.scan_status === 'clean');

  function titleTaken(unitId, sectorId, folderId, title, exceptId = null) {
    const wanted = searchKey(title);
    return db.prepare('SELECT title FROM media WHERE unit_id=? AND sector_id=? AND folder_id IS ? AND id IS NOT ?')
      .all(unitId, sectorId, folderId ?? null, exceptId).some(row => searchKey(row.title) === wanted);
  }

  // Envio de vários arquivos com o mesmo título na mesma pasta: acrescenta (2), (3)… antes da extensão.
  function uniqueTitle(unitId, sectorId, folderId, title, extension) {
    if (!titleTaken(unitId, sectorId, folderId, title)) return title;
    const hasExtension = extension && title.toLowerCase().endsWith(extension);
    const base = hasExtension ? title.slice(0, -extension.length) : title, tail = hasExtension ? title.slice(-extension.length) : '';
    for (let n = 2; n < 1000; n++) {
      const suffix = ` (${n})${tail}`;
      const candidate = `${base.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
      if (!titleTaken(unitId, sectorId, folderId, candidate)) return candidate;
    }
    return fail(409, 'Já existem muitos arquivos com este nome nesta pasta.', 'NAME_CONFLICT');
  }

  function findDuplicate(unitId, sectorId, hash) {
    if (!hash) return null;
    return db.prepare('SELECT id, title, folder_id FROM media WHERE unit_id=? AND sector_id=? AND sha256=? ORDER BY created_at LIMIT 1').get(unitId, sectorId, hash) ?? null;
  }

  // Etapa 1 do envio: valida permissão, escopo, nome, formato e pasta ANTES de ler o corpo (que pode ser grande).
  function prepareUpload(actor, query) {
    const unitId = safeId(query.unitId, 'Unidade inválida.'), sectorId = safeId(query.sectorId, 'Setor inválido.');
    authorize(actor, 'media:upload', { unitId, sectorId });
    folders.assertSpace(unitId, sectorId);
    const name = itemName(query.name, { max: 200, what: 'nome do arquivo' });
    const extension = path.extname(name).toLowerCase();
    if (!MIME[extension]) fail(415, UNSUPPORTED_FORMAT_MESSAGE);
    const title = itemName(query.title || name, { max: 120, what: 'título' });
    const folderId = query.folderId ? String(query.folderId) : null;
    if (folderId) folders.parentIn(folderId, unitId, sectorId);
    return { unitId, sectorId, folderId, name, title, extension, allowDuplicate: query.duplicate === 'allow' };
  }

  // Etapa 2: confere o conteúdo, grava, verifica antimalware e registra. Se algo falhar, não sobra arquivo órfão.
  async function completeUpload(actor, ticket, bytes) {
    const { unitId, sectorId, folderId, name, extension } = ticket, scope = { unitId, sectorId };
    if (!bytes.length || !signature(bytes, extension)) fail(415, 'O conteúdo não corresponde ao formato do arquivo.');
    checkContent(bytes, extension); // JPEG e MOV: arquivo inteiro e codec; incompleto ou fora do que o player reproduz não entra na biblioteca
    const hash = sha(bytes);
    const duplicate = findDuplicate(unitId, sectorId, hash);
    if (duplicate && !ticket.allowDuplicate) fail(409, 'Este arquivo já existe na biblioteca.', 'DUPLICATE_MEDIA', { existing: { id: duplicate.id, title: duplicate.title, folderId: duplicate.folder_id } });
    const id = randomUUID(), storageName = id + extension;
    await files.write(storageName, bytes);
    let scanStatus;
    try { scanStatus = await scanner.scan(files.path(storageName)); } catch {
      await files.remove(storageName);
      audit.record(actor, 'media.scan.failed', { name }, scope);
      fail(422, 'O arquivo não passou pela verificação de segurança. Consulte a TI.');
    }
    try {
      tx(() => {
        // Verificação final, sem pausas entre conferir e gravar: dois envios simultâneos não furam a regra.
        if (!ticket.allowDuplicate && findDuplicate(unitId, sectorId, hash)) fail(409, 'Este arquivo já existe na biblioteca.', 'DUPLICATE_MEDIA');
        if (folderId && !folders.find(folderId)) fail(404, 'Pasta não encontrada.');
        const title = uniqueTitle(unitId, sectorId, folderId, ticket.title, extension), at = nowIso();
        db.prepare(`INSERT INTO media(id, unit_id, sector_id, folder_id, name, title, search_key, type, size, sha256, status, scan_status, storage_name,
          thumb_name, created_at, created_by, reviewed_at, reviewed_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?,NULL,?,?,NULL,NULL,?)`)
          .run(id, unitId, sectorId, folderId, name, title, searchKey(`${title} ${name}`), MIME[extension], bytes.length, hash, scanStatus, storageName, at, actor.id, at);
        audit.record(actor, 'media.uploaded', { mediaId: id, name, title, folderId, sha256: hash, scanStatus }, scope);
      });
    } catch (error) {
      await files.remove(storageName);
      throw error;
    }
    return mediaDto(find(id));
  }

  function update(actor, id, body) {
    const media = load(id);
    authorize(actor, 'media:update', scopeOf(media));
    const title = body.title !== undefined ? itemName(body.title, { max: 120, what: 'título' }) : media.title;
    let folderId = media.folder_id;
    if (Object.hasOwn(body, 'folderId')) {
      folderId = body.folderId ? String(body.folderId) : null;
      if (folderId) folders.parentIn(folderId, media.unit_id, media.sector_id);
    }
    if (title === media.title && folderId === media.folder_id) return mediaDto(media);
    if (titleTaken(media.unit_id, media.sector_id, folderId, title, media.id)) fail(409, 'Já existe um arquivo com este nome nesta pasta.', 'NAME_CONFLICT');
    tx(() => {
      db.prepare('UPDATE media SET title=?, folder_id=?, search_key=?, updated_at=? WHERE id=?').run(title, folderId, searchKey(`${title} ${media.name}`), nowIso(), media.id);
      if (title !== media.title) audit.record(actor, 'media.renamed', { mediaId: media.id, from: media.title, to: title }, scopeOf(media));
      if (folderId !== media.folder_id) audit.record(actor, 'media.moved', { mediaId: media.id, title, fromFolderId: media.folder_id, toFolderId: folderId }, scopeOf(media));
    });
    return mediaDto(find(media.id));
  }

  // Exclusão sem checagens (uso interno, dentro de transação): quem chama já autorizou e verificou o uso.
  function deleteRows(rows, actor, collector) {
    for (const media of rows) {
      db.prepare('DELETE FROM media WHERE id=?').run(media.id);
      collector.push(media.storage_name);
      audit.record(actor, 'media.deleted', { mediaId: media.id, title: media.title, name: media.name, sha256: media.sha256 }, scopeOf(media));
    }
  }

  function inUseError(blockers) {
    return fail(409, 'Este conteúdo está em uso por playlists ou programações publicadas. Retire-o de lá antes de excluir.', 'MEDIA_IN_USE', blockers);
  }

  async function remove(actor, id) {
    const media = load(id);
    authorize(actor, 'media:delete', scopeOf(media));
    const blockers = usage.blockers([media.id]);
    if (blockers.blocked) inUseError(blockers);
    const collector = [];
    tx(() => deleteRows([media], actor, collector));
    await Promise.all(collector.map(name => files.remove(name)));
    return { ok: true };
  }

  function review(actor, id, decision, body = {}) {
    const media = load(id);
    authorize(actor, 'media:approve', scopeOf(media));
    if (decision === 'approve' && media.scan_status !== 'clean' && (config.production || body.acknowledgeUnscanned !== true)) {
      fail(409, 'Verificação antivírus indisponível. Em ambiente local, a aprovação exige confirmação explícita.', 'SCAN_REQUIRED');
    }
    const status = decision === 'approve' ? 'approved' : 'rejected';
    tx(() => {
      db.prepare('UPDATE media SET status=?, reviewed_at=?, reviewed_by=?, updated_at=? WHERE id=?').run(status, nowIso(), actor.id, nowIso(), media.id);
      audit.record(actor, `media.${status}`, { mediaId: media.id, title: media.title, scanStatus: media.scan_status, localUnscannedAcknowledged: body.acknowledgeUnscanned === true }, scopeOf(media));
    });
    return mediaDto(find(media.id));
  }

  function detail(actor, id) {
    const media = load(id);
    authorize(actor, null, scopeOf(media));
    return { ...mediaDto(media), usage: usage.forMedia([media.id]).get(media.id), folderPath: media.folder_id ? folders.breadcrumbs(folders.load(media.folder_id)).map(x => x.name) : [] };
  }

  return { find, load, released, update, prepareUpload, completeUpload, remove, review, deleteRows, inUseError, detail, titleTaken, scopeOf };
}
