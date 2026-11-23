import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from '../server/db/migrations/index.mjs';
import { migrate } from '../server/db/migrator.mjs';
import { buildLegacyDatabase } from './helpers/legacy-db.mjs';
import { createTestApp,makeTempDir,removeTempDir,must } from './helpers/app.mjs';

test('migração 7→8 preserva todos os registros e credenciais; só autor realmente ausente recebe compatibilidade',async()=>{
  const prefix='tvcorp-shared-migration-',dataDir=makeTempDir(prefix);
  let app;
  try{
    const legacy=await buildLegacyDatabase(dataDir);
    const old=new DatabaseSync(path.join(dataDir,'tvcorp.sqlite'));
    const before={};
    try{
      migrate(old,{migrations:migrations.filter(m=>m.id<=7),backupDir:path.join(dataDir,'backups')});
      const source=old.prepare('SELECT * FROM schedules WHERE id=?').get(legacy.live.id);
      const columns=Object.keys(source);
      const insert=old.prepare(`INSERT INTO schedules(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
      for(const [id,author]of [['anonymous-legacy',null],['missing-author','user-no-longer-exists'],['inactive-author',legacy.inactive.id]]){
        const row={...source,id,name:id,published_by:author,updated_by:null,created_by:null};
        insert.run(...columns.map(k=>row[k]));
        old.prepare('INSERT INTO schedule_displays(schedule_id,display_id) VALUES(?,?)').run(id,legacy.tvPaired.display.id);
      }
      for(const table of ['users','sessions','media','playlists','playlist_versions','playlist_version_items','schedules','schedule_displays','displays','audit'])before[table]=old.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}));
    }finally{old.close();}
    const created=createTestApp({dataDir});app=created.app;const api=created.api;
    assert.deepEqual([app.migration.from,app.migration.to],[7,8]);assert.ok(existsSync(app.migration.backupFile));
    // Cada campo existente mantém exatamente o mesmo valor, incluindo hashes de senha/token e bytes de metadados.
    for(const [table,rows]of Object.entries(before)){
      const after=app.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      assert.equal(after.length,rows.length+(table==='audit'?1:0),table);
      rows.forEach((row,index)=>{for(const key of Object.keys(row))assert.equal(after[index][key],row[key],`${table}[${index}].${key}`);});
    }
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM display_grants WHERE active=1').get().n,before.displays.length);
    for(const display of before.displays){const grant=app.db.prepare('SELECT * FROM display_grants WHERE display_id=?').get(display.id);assert.equal(grant.principal_type,'sector');assert.equal(grant.principal_id,display.sector_id);}
    const links=Object.fromEntries(app.db.prepare('SELECT * FROM schedule_displays WHERE display_id=?').all(legacy.tvPaired.display.id).map(row=>[row.schedule_id,row]));
    assert.equal(links['anonymous-legacy'].legacy_authorized,1);
    assert.equal(links['missing-author'].legacy_authorized,0);
    assert.equal(links['inactive-author'].legacy_authorized,0);
    const manifest=must(await api.call('/api/player/manifest',{token:legacy.deviceToken}));
    assert.equal(manifest.items.length,legacy.legacyManifest.items.length*2,'publicação original + legado sem autor');
    for(const id of ['missing-author','inactive-author'])assert.equal(app.db.prepare('SELECT link_status FROM schedule_displays WHERE schedule_id=?').get(id).link_status,'suspended',id);
    const admin=(await api.login(legacy.admin.email,legacy.password)).session;
    const tv=must(await api.call(`/api/displays/${legacy.tvPaired.display.id}/sequence`,{session:admin}));
    must(await api.call(`/api/displays/${legacy.tvPaired.display.id}`,{method:'PATCH',session:admin,body:{rev:tv.display.accessRev,sectorIds:[],userIds:[]}}));
    assert.equal(app.db.prepare('SELECT link_status FROM schedule_displays WHERE schedule_id=?').get('anonymous-legacy').link_status,'suspended','compatibilidade depende da concessão migrada');
    assert.equal(must(await api.call('/api/player/manifest',{token:legacy.deviceToken})).items.length,legacy.legacyManifest.items.length,'autor administrativo ativo permanece autorizado');
  }finally{await app?.close();removeTempDir(dataDir,prefix);}
});
