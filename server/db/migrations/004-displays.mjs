import { legacyRecords, countOf } from './legacy.mjs';

// TVs em tabela própria: o token do aparelho passa a ter índice (autenticação do player sem varrer tudo)
// e o cadastro ganha estado ('pending' aguarda ativação) e responsáveis pelo cadastro e pela ativação.
export default {
  id: 4,
  name: 'telas',
  up(db) {
    db.exec(`
      CREATE TABLE displays(
        id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL REFERENCES units(id),
        sector_id TEXT NOT NULL REFERENCES sectors(id),
        name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'active')),
        created_at TEXT NOT NULL, created_by TEXT,
        activated_at TEXT, activated_by TEXT,
        last_seen TEXT,
        token_hash TEXT, pair_hash TEXT, pair_expires INTEGER,
        player_version TEXT
      );
      CREATE UNIQUE INDEX displays_token ON displays(token_hash) WHERE token_hash IS NOT NULL;
      CREATE INDEX displays_pair ON displays(pair_hash) WHERE pair_hash IS NOT NULL;
      CREATE INDEX displays_scope ON displays(unit_id, sector_id);
    `);
    const legacy = legacyRecords(db, 'displays');
    const insert = db.prepare(`INSERT INTO displays(id, unit_id, sector_id, name, status, created_at, created_by, activated_at, activated_by,
      last_seen, token_hash, pair_hash, pair_expires) VALUES(?,?,?,?,?,?,NULL,?,NULL,?,?,?,?)`);
    for (const d of legacy) {
      for (const field of ['unitId', 'sectorId', 'name']) if (typeof d[field] !== 'string' || !d[field]) throw new Error(`a tela ${d.id} não tem o campo ${field}`);
      const createdAt = typeof d.createdAt === 'string' ? d.createdAt : new Date(0).toISOString();
      const active = d.active !== false;
      insert.run(d.id, d.unitId, d.sectorId, d.name, active ? 'active' : 'pending', createdAt, active ? createdAt : null,
        d.lastSeen ?? null, d.tokenHash ?? null, d.pairHash ?? null, Number.isFinite(d.pairExpires) ? d.pairExpires : null);
    }
    if (countOf(db, 'displays') !== legacy.length) throw new Error('contagem de telas divergente após a cópia');
    return { displays: legacy.length, withDeviceToken: legacy.filter(d => d.tokenHash).length };
  }
};
