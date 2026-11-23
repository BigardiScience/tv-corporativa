import { sha } from '../lib/crypto.mjs';
import { nowIso } from '../lib/validate.mjs';
import { effectivePermissions } from './permissions.mjs';

const ZERO_HASH = '0'.repeat(64);

// Trilha com hashes encadeados (formato da 1.1.0 preservado: scripts/verify-audit.mjs continua válido).
// Eventos novos carregam a unidade e o setor, o que permite ao Gestor consultar somente o próprio escopo.
export function createAudit(db) {
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1');
  const insert = db.prepare('INSERT INTO audit(payload, previousHash, hash) VALUES(?,?,?)');

  function record(actor, action, detail = {}, scope = null) {
    const previousHash = last.get()?.hash ?? ZERO_HASH;
    const payload = JSON.stringify({
      at: nowIso(), actor: actor?.email ?? actor ?? 'system', action, detail,
      ...(scope ? { unitId: scope.unitId, sectorId: scope.sectorId } : {})
    });
    insert.run(payload, previousHash, sha(previousHash + payload));
  }

  const toEvent = row => ({ id: row.id, ...JSON.parse(row.payload), previousHash: row.previousHash, hash: row.hash });

  // Administrador: tudo. Quem tem `audit:read`: somente eventos do próprio escopo. Demais: nada.
  function list(user, { limit = 200, before = null } = {}) {
    const max = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const permissions = effectivePermissions(user);
    if (!permissions.has('audit:read')) return [];
    const params = [], where = [];
    if (before) { where.push('id < ?'); params.push(Number(before)); }
    if (user.role !== 'admin') {
      const units = user.unitIds ?? [], sectors = user.sectorIds ?? [];
      if (!units.length || !sectors.length) return [];
      where.push(`json_extract(payload, '$.unitId') IN (${units.map(() => '?').join(',')})`, `json_extract(payload, '$.sectorId') IN (${sectors.map(() => '?').join(',')})`);
      params.push(...units, ...sectors);
    }
    const sql = `SELECT id, payload, previousHash, hash FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${max}`;
    return db.prepare(sql).all(...params).map(toEvent);
  }

  return { record, list };
}
