import { legacyRecords, countOf } from './legacy.mjs';
import { searchKey } from '../../lib/validate.mjs';

const STATUSES = new Set(['pending', 'approved', 'rejected']);

// Biblioteca hierárquica: pastas com identificador permanente e mídias em tabela própria.
// Regras de integridade ficam também no banco (gatilhos), não só no servidor:
//  - pasta e mídia nunca mudam de unidade/setor;
//  - o pai de uma pasta é da mesma unidade/setor;
//  - uma pasta nunca vira filha de si mesma nem de um descendente (sem ciclos).
export default {
  id: 3,
  name: 'biblioteca-pastas-e-midias',
  up(db) {
    db.exec(`
      CREATE TABLE folders(
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL REFERENCES units(id),
        sector_id TEXT NOT NULL REFERENCES sectors(id),
        parent_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        search_key TEXT NOT NULL,
        depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 8),
        path TEXT NOT NULL,
        created_at TEXT NOT NULL, created_by TEXT,
        updated_at TEXT NOT NULL, updated_by TEXT
      );
      CREATE UNIQUE INDEX folders_unique_name ON folders(unit_id, sector_id, ifnull(parent_id, ''), name_key);
      CREATE INDEX folders_parent ON folders(parent_id);
      CREATE INDEX folders_scope ON folders(unit_id, sector_id);

      CREATE TRIGGER folders_guard_insert BEFORE INSERT ON folders
      WHEN NEW.parent_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'folder_scope_mismatch')
        WHERE NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = NEW.parent_id AND p.unit_id = NEW.unit_id AND p.sector_id = NEW.sector_id);
      END;

      CREATE TRIGGER folders_guard_update BEFORE UPDATE OF parent_id, unit_id, sector_id ON folders
      BEGIN
        SELECT RAISE(ABORT, 'folder_scope_immutable')
        WHERE NEW.unit_id <> OLD.unit_id OR NEW.sector_id <> OLD.sector_id;
        SELECT RAISE(ABORT, 'folder_cycle')
        WHERE NEW.parent_id IS NOT NULL
          AND (NEW.parent_id = NEW.id
            OR EXISTS (SELECT 1 FROM folders p WHERE p.id = NEW.parent_id AND instr(p.path, '/' || NEW.id || '/') > 0));
        SELECT RAISE(ABORT, 'folder_scope_mismatch')
        WHERE NEW.parent_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM folders p WHERE p.id = NEW.parent_id AND p.unit_id = NEW.unit_id AND p.sector_id = NEW.sector_id);
      END;

      CREATE TABLE media(
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL REFERENCES units(id),
        sector_id TEXT NOT NULL REFERENCES sectors(id),
        folder_id TEXT REFERENCES folders(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        search_key TEXT NOT NULL,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
        scan_status TEXT NOT NULL,
        storage_name TEXT NOT NULL,
        thumb_name TEXT,
        created_at TEXT NOT NULL, created_by TEXT,
        reviewed_at TEXT, reviewed_by TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX media_folder ON media(unit_id, sector_id, folder_id);
      CREATE INDEX media_hash ON media(unit_id, sector_id, sha256);

      CREATE TRIGGER media_guard_insert BEFORE INSERT ON media
      WHEN NEW.folder_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'media_folder_scope_mismatch')
        WHERE NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = NEW.folder_id AND f.unit_id = NEW.unit_id AND f.sector_id = NEW.sector_id);
      END;

      CREATE TRIGGER media_guard_update BEFORE UPDATE OF folder_id, unit_id, sector_id ON media
      BEGIN
        SELECT RAISE(ABORT, 'media_scope_immutable')
        WHERE NEW.unit_id <> OLD.unit_id OR NEW.sector_id <> OLD.sector_id;
        SELECT RAISE(ABORT, 'media_folder_scope_mismatch')
        WHERE NEW.folder_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = NEW.folder_id AND f.unit_id = NEW.unit_id AND f.sector_id = NEW.sector_id);
      END;
    `);

    const legacy = legacyRecords(db, 'media');
    const insert = db.prepare(`INSERT INTO media(id, unit_id, sector_id, folder_id, name, title, search_key, type, size, sha256, status, scan_status,
      storage_name, thumb_name, created_at, created_by, reviewed_at, reviewed_by, updated_at) VALUES(?,?,?,NULL,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`);
    for (const m of legacy) {
      for (const field of ['unitId', 'sectorId', 'name', 'type', 'storageName']) {
        if (typeof m[field] !== 'string' || !m[field]) throw new Error(`a mídia ${m.id} não tem o campo ${field}`);
      }
      const title = typeof m.title === 'string' && m.title.trim() ? m.title : m.name;
      const createdAt = typeof m.createdAt === 'string' ? m.createdAt : new Date(0).toISOString();
      insert.run(m.id, m.unitId, m.sectorId, m.name, title, searchKey(`${title} ${m.name}`), m.type, Number(m.size) || 0, String(m.sha256 ?? ''),
        STATUSES.has(m.status) ? m.status : 'pending', String(m.scanStatus ?? 'not_configured'), m.storageName,
        createdAt, m.createdBy ?? null, m.reviewedAt ?? null, m.reviewedBy ?? null, createdAt);
    }
    if (countOf(db, 'media') !== legacy.length) throw new Error('contagem de mídias divergente após a cópia');
    return { media: legacy.length };
  }
};
