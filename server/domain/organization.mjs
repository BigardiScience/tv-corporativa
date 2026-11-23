import { randomUUID } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { label, nowIso, oneOf, searchKey } from '../lib/validate.mjs';
import { authorize } from './permissions.mjs';

// Unidades e setores: cadastro global (somente quem tem `settings:manage`).
export function createOrganization({ db, audit }) {
  const unit = row => ({ id: row.id, name: row.name, city: row.city });
  const sector = row => ({ id: row.id, name: row.name });

  const units = () => db.prepare('SELECT id, name, city FROM units ORDER BY name COLLATE NOCASE, id').all().map(unit);
  const sectors = () => db.prepare('SELECT id, name FROM sectors ORDER BY name COLLATE NOCASE, id').all().map(sector);
  const unitExists = id => typeof id === 'string' && !!db.prepare('SELECT 1 AS ok FROM units WHERE id=?').get(id);
  const sectorExists = id => typeof id === 'string' && !!db.prepare('SELECT 1 AS ok FROM sectors WHERE id=?').get(id);

  // Cada pessoa vê apenas as unidades e os setores que pode usar.
  function visibleTo(user) {
    if (user.role === 'admin') return { units: units(), sectors: sectors() };
    const unitIds = new Set(user.unitIds ?? []), sectorIds = new Set(user.sectorIds ?? []);
    return { units: units().filter(x => unitIds.has(x.id)), sectors: sectors().filter(x => sectorIds.has(x.id)) };
  }

  function save(actor, kind, id, body) {
    authorize(actor, 'settings:manage');
    oneOf(kind, ['units', 'sectors']);
    const name = label(body.name);
    if (id !== null) {
      const exists = kind === 'units' ? unitExists(id) : sectorExists(id);
      if (!exists) fail(404, 'Registro inexistente.');
    }
    // Duas unidades (ou dois setores) com o mesmo nome, ignorando maiúsculas e acentos, confundem quem escolhe o espaço de trabalho.
    const clash = (kind === 'units' ? units() : sectors()).find(item => item.id !== id && searchKey(item.name) === searchKey(name));
    if (clash) fail(409, `Já existe ${kind === 'units' ? 'uma unidade' : 'um setor'} com este nome.`, 'NAME_TAKEN');
    const recordId = id ?? randomUUID();
    if (kind === 'units') {
      const city = typeof body.city === 'string' ? body.city.slice(0, 120) : '';
      if (id === null) db.prepare('INSERT INTO units(id, name, city, created_at) VALUES(?,?,?,?)').run(recordId, name, city, nowIso());
      else db.prepare('UPDATE units SET name=?, city=? WHERE id=?').run(name, city, recordId);
      audit.record(actor, 'units.saved', { id: recordId, name });
      return { id: recordId, name, city };
    }
    if (id === null) db.prepare('INSERT INTO sectors(id, name, created_at) VALUES(?,?,?)').run(recordId, name, nowIso());
    else db.prepare('UPDATE sectors SET name=? WHERE id=?').run(name, recordId);
    audit.record(actor, 'sectors.saved', { id: recordId, name });
    return { id: recordId, name };
  }

  return { units, sectors, unitExists, sectorExists, visibleTo, save };
}
