import { loadConfig } from '../server/config.mjs';
import { openDatabase } from '../server/db/connection.mjs';
import { migrate } from '../server/db/migrator.mjs';
import { migrations } from '../server/db/migrations/index.mjs';

// Aplica as migrações pendentes sem iniciar o servidor (útil para ensaiar a atualização em uma CÓPIA do banco).
// Se o banco tiver dados, um backup é criado automaticamente ANTES de qualquer alteração.
let db;
try {
  const config = loadConfig();
  db = openDatabase(config);
  const report = migrate(db, { migrations, backupDir: config.backupDir, log: message => console.log(message) });
  if (!report.applied.length) console.log(`Banco já está na versão mais recente do esquema (${report.to}). Nada a fazer.`);
  else {
    console.log(`Esquema atualizado: ${report.from} → ${report.to}.`);
    for (const item of report.applied) console.log(`  ${item.id} ${item.name}: ${JSON.stringify(item.details)}`);
    if (report.backupFile) console.log(`Backup anterior à migração: ${report.backupFile}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
