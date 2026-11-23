import { legacyRecords, countOf } from './legacy.mjs';

const DEFAULT_UNITS = [
  { id: 'centro', name: 'Unidade Centro', city: 'Belo Horizonte · MG' },
  { id: 'leste', name: 'Unidade Leste', city: 'Campinas · SP' },
  { id: 'norte', name: 'Vila Norte', city: 'Unidade Vila Norte' },
  { id: 'oeste', name: 'Unidade Oeste', city: 'São Paulo · SP' }
];
const DEFAULT_SECTORS = [
  { id: 'rh', name: 'RH' }, { id: 'ti', name: 'TI' },
  { id: 'seguranca', name: 'SEGURANÇA DO TRABALHO' }, { id: 'teste', name: 'TESTE' }
];

// Unidades e setores passam de JSON genérico para tabelas com chave estrangeira.
export default {
  id: 2,
  name: 'unidades-e-setores',
  up(db, { now }) {
    db.exec(`
      CREATE TABLE units(id TEXT PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE sectors(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    let units = legacyRecords(db, 'units'), sectors = legacyRecords(db, 'sectors');
    const seeded = !units.length && !sectors.length;
    if (seeded) { units = DEFAULT_UNITS; sectors = DEFAULT_SECTORS; }
    const at = now();
    const insertUnit = db.prepare('INSERT INTO units(id, name, city, created_at) VALUES(?,?,?,?)');
    const insertSector = db.prepare('INSERT INTO sectors(id, name, created_at) VALUES(?,?,?)');
    for (const unit of units) insertUnit.run(String(unit.id), String(unit.name), String(unit.city ?? ''), at);
    for (const sector of sectors) insertSector.run(String(sector.id), String(sector.name), at);
    if (countOf(db, 'units') !== units.length || countOf(db, 'sectors') !== sectors.length) throw new Error('contagem de unidades/setores divergente após a cópia');
    return { units: units.length, sectors: sectors.length, defaultsCreated: seeded };
  }
};
