import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export class MigrationError extends Error {
  constructor(message, { backupFile = null, migration = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MigrationError';
    this.backupFile = backupFile;
    this.migration = migration;
  }
}

const hasTable = (db, name) => !!db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?").get(name);
const countRows = (db, table) => hasTable(db, table) ? db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count : 0;
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// Cópia consistente do banco (mesmo em modo WAL) feita pelo próprio SQLite.
export function backupDatabase(db, file) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (existsSync(file)) throw new Error(`O arquivo de backup já existe: ${file}`);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  try { chmodSync(file, 0o600); } catch { /* Windows não aplica permissões POSIX. */ }
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA quick_check').get();
    if (Object.values(check)[0] !== 'ok') throw new Error('O backup gerado não passou na verificação de integridade.');
  } finally { copy.close(); }
  return file;
}

/**
 * Aplica as migrações pendentes em UMA transação (tudo ou nada).
 * - Banco com dados: backup automático ANTES de qualquer alteração.
 * - Falha em qualquer migração: ROLLBACK de todas e erro claro (o servidor não inicia com o banco pela metade).
 * - Banco criado por versão mais nova do sistema: recusa iniciar (evita corromper dados).
 */
export function migrate(db, { migrations, backupDir, log = () => {}, now = () => new Date() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL, checksum TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}')`);
  const known = new Map(migrations.map(m => [m.id, m]));
  const applied = db.prepare('SELECT id, name, checksum FROM schema_migrations ORDER BY id').all().map(row => ({ ...row }));
  const unknown = applied.filter(row => !known.has(row.id));
  if (unknown.length) {
    throw new MigrationError(`O banco de dados foi atualizado por uma versão mais nova da TV Corporativa (migração ${unknown.at(-1).id}: ${unknown.at(-1).name}). Use a versão correspondente ou restaure um backup anterior. Nada foi alterado.`);
  }
  const appliedIds = new Set(applied.map(row => row.id));
  const pending = migrations.filter(m => !appliedIds.has(m.id)).sort((a, b) => a.id - b.id);
  const from = applied.at(-1)?.id ?? 0, to = pending.at(-1)?.id ?? from;
  const report = { from, to, applied: [], backupFile: null, fresh: false };
  for (const row of applied) {
    const current = createHash('sha256').update(String(known.get(row.id).up)).digest('hex');
    if (current !== row.checksum) log(`Aviso: a migração ${row.id} (${row.name}) mudou desde que foi aplicada. Confira se o código corresponde ao banco.`);
  }
  if (!pending.length) return report;

  const hasUserData = ['users', 'records', 'audit'].some(table => countRows(db, table) > 0);
  report.fresh = !hasUserData && !applied.length;
  if (hasUserData) {
    const file = path.join(backupDir, `tvcorp-antes-da-migracao-${stamp(now())}-v${from}-para-v${to}.sqlite`);
    report.backupFile = backupDatabase(db, file);
    log(`Backup do banco criado antes da migração: ${report.backupFile}`);
  }

  // Tudo ou nada: todas as migrações pendentes rodam na MESMA transação. Se qualquer uma falhar, o banco volta
  // exatamente ao estado anterior (nenhuma tabela nova, nenhum registro copiado pela metade).
  db.exec('BEGIN IMMEDIATE');
  let current = null;
  try {
    for (const migration of pending) {
      current = migration;
      log(`Aplicando migração ${migration.id}: ${migration.name}`);
      const details = migration.up(db, { now: () => now().toISOString(), log }) ?? {};
      db.prepare('INSERT INTO schema_migrations(id, name, applied_at, checksum, details) VALUES(?,?,?,?,?)')
        .run(migration.id, migration.name, now().toISOString(), createHash('sha256').update(String(migration.up)).digest('hex'), JSON.stringify(details));
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Integridade referencial violada em ${broken.length} registro(s) (tabela ${broken[0].table}).`);
      report.applied.push({ id: migration.id, name: migration.name, details });
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* já encerrada */ }
    report.applied = [];
    const where = report.backupFile ? ` Nada foi alterado no banco; há também um backup em: ${report.backupFile}` : ' Nada foi alterado no banco.';
    throw new MigrationError(`Falha na migração ${current?.id} (${current?.name}): ${error.message}.${where}`, { backupFile: report.backupFile, migration: current?.id, cause: error });
  }
  const check = db.prepare('PRAGMA quick_check').get();
  if (Object.values(check)[0] !== 'ok') throw new MigrationError('O banco não passou na verificação de integridade após a migração. Restaure o backup.', { backupFile: report.backupFile });
  return report;
}
