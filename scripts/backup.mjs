import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/config.mjs';
import { backupDatabase } from '../server/db/migrator.mjs';

// Cópia consistente do banco (mesmo com o servidor em execução) e, opcionalmente, dos arquivos de mídia.
//   npm run backup                 → somente o banco
//   npm run backup -- --media      → banco + pasta de mídias
//   npm run backup -- --keep 14    → mantém só os 14 backups de banco mais recentes
const args = process.argv.slice(2);
const withMedia = args.includes('--media');
const keepIndex = args.indexOf('--keep');
const keep = keepIndex >= 0 ? Number(args[keepIndex + 1]) : 0;
let db;
try {
  const config = loadConfig();
  if (!existsSync(config.dbPath)) throw new Error(`Banco não encontrado em ${config.dbPath}.`);
  if (keepIndex >= 0 && (!Number.isInteger(keep) || keep < 1)) throw new Error('--keep exige um número inteiro maior que zero.');
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA busy_timeout=5000');
  // Carimbo com milissegundos: duas execuções seguidas nunca geram o mesmo nome de arquivo.
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const file = backupDatabase(db, path.join(config.backupDir, `tvcorp-${stamp}.sqlite`));
  console.log(`Backup do banco criado e verificado: ${file}`);
  if (withMedia) {
    const target = path.join(config.backupDir, `tvcorp-${stamp}-midias`);
    cpSync(config.mediaDir, target, { recursive: true });
    console.log(`Mídias copiadas para: ${target}`);
  }
  if (keep) {
    const old = readdirSync(config.backupDir).filter(name => /^tvcorp-\d{8}T\d{6,9}Z\.sqlite$/.test(name)).sort().slice(0, -keep);
    for (const name of old) {
      rmSync(path.join(config.backupDir, name), { force: true });
      const media = path.join(config.backupDir, name.replace(/\.sqlite$/, '-midias'));
      if (existsSync(media) && statSync(media).isDirectory()) rmSync(media, { recursive: true, force: true });
    }
    if (old.length) console.log(`${old.length} backup(s) antigo(s) removido(s) (mantidos os ${keep} mais recentes).`);
  }
  console.log('Guarde uma cópia FORA deste servidor. Backup que mora no mesmo disco não protege contra falha do disco.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
