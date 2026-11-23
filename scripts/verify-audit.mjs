import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { loadConfig } from '../server/config.mjs';

const file=loadConfig().dbPath;
let db;
try {
  db=new DatabaseSync(file,{readOnly:true});
  const rows=db.prepare('SELECT * FROM audit ORDER BY id').all();
  let previous='0'.repeat(64),previousId=0;
  for(const row of rows){
    const expected=createHash('sha256').update(previous+row.payload).digest('hex');
    if(row.previousHash!==previous||row.hash!==expected||row.id!==previousId+1)throw new Error(`Inconsistência no evento ${row.id}. Preserve o banco para investigação.`);
    previous=row.hash;previousId=row.id;
  }
  console.log(`Cadeia consistente: ${rows.length} eventos. Último hash: ${previous}`);
  console.log('Este resultado detecta inconsistências; não comprova imutabilidade. Preserve uma cópia externa do hash e dos eventos.');
} catch(error){console.error(error.message);process.exitCode=1;}
finally {db?.close();}
