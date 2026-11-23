import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { withApp, must, makeTempDir, removeTempDir, cleanEnv, projectRoot } from './helpers/app.mjs';
import { buildLegacyDatabase } from './helpers/legacy-db.mjs';

const NOW = '2026-01-01T00:00:00.000Z';

function rawFolder(db, { id, unit = 'leste', sector = 'rh', parent = null, name, depth = 1, folderPath }) {
  const key = name.toLowerCase();
  db.prepare(`INSERT INTO folders(id, unit_id, sector_id, parent_id, name, name_key, search_key, depth, path, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, unit, sector, parent, name, key, key, depth, folderPath ?? `/${id}/`, NOW, NOW);
}

function rawMedia(db, { id, unit = 'leste', sector = 'rh', folder = null, status = 'pending' }) {
  db.prepare(`INSERT INTO media(id, unit_id, sector_id, folder_id, name, title, search_key, type, size, sha256, status, scan_status, storage_name, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, unit, sector, folder, `${id}.png`, id, id, 'image/png', 10, id.padEnd(64, '0'), status, 'clean', `${id}.png`, NOW, NOW);
}

const run = (script, dataDir, args = [], extraEnv = {}) => spawnSync(process.execPath, ['--no-warnings', path.join(projectRoot, 'scripts', script), ...args],
  { cwd: projectRoot, env: cleanEnv({ DATA_DIR: dataDir, ...extraEnv }), encoding: 'utf8', timeout: 60000 });

test('banco: chaves estrangeiras, WAL e integridade intactos depois de um uso completo', async () => {
  await withApp(async kit => {
    const folder = await kit.folder(kit.admin, { name: 'Campanhas' });
    const media = await kit.approvedMedia(kit.admin, { name: 'a.png', folderId: folder.id });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    const schedule = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    must(await kit.call(`/api/schedules/${schedule.id}/stop`, { method: 'POST', session: kit.admin }));
    const { db } = kit.app;
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row => row.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

test('banco: pastas — gatilhos e restrições valem mesmo para quem escreve direto no SQL', async () => {
  await withApp(async kit => {
    const { db } = kit.app;
    const a = await kit.folder(kit.admin, { name: 'A' }), b = await kit.folder(kit.admin, { name: 'B', parentId: a.id }), c = await kit.folder(kit.admin, { name: 'C', parentId: b.id });
    const other = await kit.folder(kit.admin, { name: 'Outra', unitId: 'centro', sectorId: 'rh' });
    const update = (sql, ...params) => () => db.prepare(sql).run(...params);

    assert.throws(update("UPDATE folders SET unit_id='centro' WHERE id=?", a.id), /folder_scope_immutable/);
    assert.throws(update("UPDATE folders SET sector_id='ti' WHERE id=?", a.id), /folder_scope_immutable/);
    assert.throws(update('UPDATE folders SET parent_id=? WHERE id=?', c.id, a.id), /folder_cycle/, 'pasta dentro de uma descendente');
    assert.throws(update('UPDATE folders SET parent_id=? WHERE id=?', a.id, a.id), /folder_cycle/, 'pasta dentro dela mesma');
    assert.throws(update('UPDATE folders SET parent_id=? WHERE id=?', other.id, b.id), /folder_scope_mismatch/, 'pai de outra unidade');
    assert.throws(() => rawFolder(db, { id: 'x1', parent: other.id, name: 'Filha de fora', depth: 2 }), /folder_scope_mismatch/);
    assert.throws(() => rawFolder(db, { id: 'x2', parent: a.id, name: 'b', depth: 2 }), /UNIQUE/, 'mesmo nome sob o mesmo pai');
    assert.throws(() => rawFolder(db, { id: 'x3', name: 'a' }), /UNIQUE/, 'mesmo nome na raiz');
    assert.doesNotThrow(() => rawFolder(db, { id: 'x4', unit: 'centro', name: 'a' }), 'o mesmo nome em outro espaço é permitido');
    assert.throws(() => rawFolder(db, { id: 'x5', name: 'fundo', depth: 9 }), /CHECK/);
    assert.throws(() => rawFolder(db, { id: 'x6', name: 'raso', depth: 0 }), /CHECK/);
    assert.throws(() => rawFolder(db, { id: 'x7', unit: 'nao-existe', name: 'sem unidade' }), /FOREIGN KEY/);
    assert.throws(update('DELETE FROM folders WHERE id=?', a.id), /FOREIGN KEY/, 'pasta com subpastas não é apagada');
    await kit.upload(kit.admin, { folderId: c.id, name: 'a.png' });
    assert.throws(update('DELETE FROM folders WHERE id=?', c.id), /FOREIGN KEY/, 'pasta com arquivos não é apagada');
    assert.equal(db.prepare('SELECT parent_id FROM folders WHERE id=?').get(b.id).parent_id, a.id, 'nada mudou depois das tentativas');
  });
});

test('banco: mídias — escopo imutável e pasta sempre do mesmo espaço', async () => {
  await withApp(async kit => {
    const { db } = kit.app;
    const here = await kit.folder(kit.admin, { name: 'Aqui' }), there = await kit.folder(kit.admin, { name: 'Lá', unitId: 'centro', sectorId: 'rh' });
    const media = await kit.upload(kit.admin, { name: 'm.png', folderId: here.id });
    const update = (sql, ...params) => () => db.prepare(sql).run(...params);
    assert.throws(update("UPDATE media SET unit_id='centro' WHERE id=?", media.id), /media_scope_immutable/);
    assert.throws(update("UPDATE media SET sector_id='ti' WHERE id=?", media.id), /media_scope_immutable/);
    assert.throws(update('UPDATE media SET folder_id=? WHERE id=?', there.id, media.id), /media_folder_scope_mismatch/);
    assert.throws(() => rawMedia(db, { id: 'm-x', folder: there.id }), /media_folder_scope_mismatch/);
    assert.throws(update("UPDATE media SET status='arquivado' WHERE id=?", media.id), /CHECK/);
    assert.throws(() => rawMedia(db, { id: 'm-y', status: 'liberado' }), /CHECK/);
    assert.doesNotThrow(() => rawMedia(db, { id: 'm-ok', folder: here.id }));
    assert.equal(db.prepare('SELECT folder_id FROM media WHERE id=?').get(media.id).folder_id, here.id);
  });
});

test('banco: versões publicadas são imutáveis; só o vínculo com o arquivo pode ser desfeito', async () => {
  await withApp(async kit => {
    const { db } = kit.app;
    const media = await kit.approvedMedia(kit.admin, { name: 'v.png' });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    const update = (sql, ...params) => () => db.prepare(sql).run(...params);
    const version = db.prepare('SELECT id FROM playlist_versions WHERE playlist_id=?').get(playlist.id).id;
    assert.throws(update("UPDATE playlist_versions SET note='alterada' WHERE id=?", version), /playlist_version_immutable/);
    assert.throws(update('UPDATE playlist_versions SET version=9 WHERE id=?', version), /playlist_version_immutable/);
    for (const [column, value] of [['title', "'outro'"], ['name', "'outro.png'"], ['type', "'video/mp4'"], ['duration_s', 99], ['transition', "'fade'"], ['transition_ms', 500], ['position', 5], ['version_id', "'x'"]]) {
      assert.throws(update(`UPDATE playlist_version_items SET ${column}=${value} WHERE version_id=?`, version), /playlist_version_immutable/, column);
    }
    assert.equal(db.prepare('SELECT title FROM playlist_version_items WHERE version_id=?').get(version).title, media.title);
    assert.doesNotThrow(update('UPDATE playlist_version_items SET media_id=NULL WHERE version_id=?', version), 'o histórico sobrevive à exclusão do arquivo');
  });
});

test('banco: restrições dos itens de playlist, programações e vínculos com TVs', async () => {
  await withApp(async kit => {
    const { db } = kit.app;
    const media = await kit.approvedMedia(kit.admin, { name: 'r.png' });
    const playlist = await kit.playlist(kit.admin, { items: [{ mediaId: media.id }] });
    const published = await kit.publishedPlaylist(kit.admin, [media.id], { name: 'Publicada' });
    const tv = await kit.display(kit.admin);
    const item = (position, extra = {}) => () => db.prepare('INSERT INTO playlist_items(id, playlist_id, position, media_id, duration_s, transition, transition_ms) VALUES(?,?,?,?,?,?,?)')
      .run(`i-${position}-${Math.random()}`, extra.playlist ?? playlist.id, position, extra.media ?? media.id, extra.duration ?? 15, extra.transition ?? 'cut', extra.ms ?? 0);
    assert.throws(item(1, { duration: 4 }), /CHECK/);
    assert.throws(item(1, { duration: 3601 }), /CHECK/);
    assert.throws(item(1, { transition: 'girar' }), /CHECK/);
    assert.throws(item(1, { ms: 3001 }), /CHECK/);
    assert.throws(item(1, { ms: -1 }), /CHECK/);
    assert.throws(item(0), /UNIQUE/, 'posição repetida na mesma playlist');
    assert.throws(item(1, { media: 'nao-existe' }), /FOREIGN KEY/);
    assert.throws(item(1, { playlist: 'nao-existe' }), /FOREIGN KEY/);
    assert.doesNotThrow(item(1));
    assert.throws(() => db.prepare('DELETE FROM media WHERE id=?').run(media.id), /FOREIGN KEY/, 'arquivo em rascunho de playlist não é apagado');

    const schedule = (status, version = 1, playlistId = published.id) => () => db.prepare(`INSERT INTO schedules(id, unit_id, sector_id, name, playlist_id, playlist_version, status, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(`s-${Math.random()}`, 'leste', 'rh', 'S', playlistId, version, status, NOW, NOW);
    assert.throws(schedule('rascunho'), /CHECK/);
    assert.throws(schedule('draft', 7), /FOREIGN KEY/, 'versão inexistente');
    assert.throws(schedule('draft', 1, playlist.id), /FOREIGN KEY/, 'playlist sem a versão 1 publicada');
    assert.doesNotThrow(schedule('draft'));
    assert.throws(() => db.prepare('INSERT INTO schedule_displays(schedule_id, display_id) VALUES(?,?)').run('nao-existe', tv.display.id), /FOREIGN KEY/);
    const existing = db.prepare('SELECT id FROM schedules LIMIT 1').get().id;
    assert.throws(() => db.prepare('INSERT INTO schedule_displays(schedule_id, display_id) VALUES(?,?)').run(existing, 'nao-existe'), /FOREIGN KEY/);
    db.prepare('INSERT INTO schedule_displays(schedule_id, display_id) VALUES(?,?)').run(existing, tv.display.id);
    assert.throws(() => db.prepare('INSERT INTO schedule_displays(schedule_id, display_id) VALUES(?,?)').run(existing, tv.display.id), /UNIQUE|PRIMARY/);
    assert.throws(() => db.prepare('DELETE FROM displays WHERE id=?').run(tv.display.id), /FOREIGN KEY/, 'histórico de concessões impede apagar fisicamente uma TV compartilhada');
    kit.app.services.displays.remove(kit.app.services.users.byId(kit.adminUser.id), tv.display.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_displays').get().n, 1, 'revogar a TV preserva o vínculo histórico');
    assert.equal(db.prepare('SELECT link_status FROM schedule_displays WHERE display_id=?').get(tv.display.id).link_status, 'suspended');
  });
});

test('transações: aninhamento por SAVEPOINT, reversão e recusa de corpo assíncrono', async () => {
  await withApp(async kit => {
    const { db, services: { tx } } = kit.app;
    db.exec('CREATE TABLE tx_probe(id TEXT PRIMARY KEY)');
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM tx_probe').get().n;
    const add = id => db.prepare('INSERT INTO tx_probe(id) VALUES(?)').run(id);
    tx(() => {
      add('tx-a');
      assert.throws(() => tx(() => { add('tx-b'); throw new Error('falha interna'); }), /falha interna/);
      add('tx-c');
    });
    assert.deepEqual(db.prepare('SELECT id FROM tx_probe ORDER BY id').all().map(r => r.id), ['tx-a', 'tx-c'], 'só a parte interna foi revertida');
    assert.throws(() => tx(() => { add('tx-d'); throw new Error('falha externa'); }), /falha externa/);
    assert.equal(count(), 2, 'falha na transação externa reverte tudo dela');
    assert.throws(() => tx(async () => { add('tx-e'); }), /não podem ser assíncronas/);
    assert.equal(count(), 2, 'corpo assíncrono é recusado e revertido');
    assert.equal(tx(() => { add('tx-f'); return 7; }), 7, 'continua funcionando depois das falhas');
    assert.equal(count(), 3);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  });
});

test('auditoria: cadeia de hashes confere; o script detecta alteração, remoção e inserção', async () => {
  const dir = makeTempDir('tvcorp-test-');
  try {
    await withApp(async kit => {
      await kit.upload(kit.admin, { name: 'a.png' });
      await kit.pairedDisplay(kit.admin);
      const { db } = kit.app;
      const events = db.prepare('SELECT * FROM audit ORDER BY id').all();
      let previous = '0'.repeat(64);
      for (const row of events) {
        assert.equal(row.previousHash, previous);
        previous = createHash('sha256').update(previous + row.payload).digest('hex');
        assert.equal(row.hash, previous);
      }
      const ok = run('verify-audit.mjs', dir);
      assert.equal(ok.status, 0, ok.stderr);
      assert.match(ok.stdout, new RegExp(`Cadeia consistente: ${events.length} eventos`));
      assert.ok(!/imutabilidade comprovada/i.test(ok.stdout), 'a mensagem não promete mais do que a verificação garante');

      db.exec("UPDATE audit SET payload = replace(payload, 'media.uploaded', 'media.approved') WHERE payload LIKE '%media.uploaded%'");
      const tampered = run('verify-audit.mjs', dir);
      assert.equal(tampered.status, 1);
      assert.match(tampered.stderr, /Inconsistência no evento \d+/);
      db.exec("UPDATE audit SET payload = replace(payload, 'media.approved', 'media.uploaded') WHERE payload LIKE '%media.approved%'");
      assert.equal(run('verify-audit.mjs', dir).status, 0, 'restaurado o conteúdo, a cadeia volta a conferir');

      const middle = events[Math.floor(events.length / 2)].id;
      const saved = db.prepare('SELECT * FROM audit WHERE id=?').get(middle);
      db.prepare('DELETE FROM audit WHERE id=?').run(middle);
      assert.equal(run('verify-audit.mjs', dir).status, 1, 'evento removido do meio');
      db.prepare('INSERT INTO audit(id, payload, previousHash, hash) VALUES(?,?,?,?)').run(saved.id, saved.payload, saved.previousHash, saved.hash);
      db.prepare("INSERT INTO audit(payload, previousHash, hash) VALUES('{\"forjado\":true}', ?, ?)").run('f'.repeat(64), 'e'.repeat(64));
      assert.equal(run('verify-audit.mjs', dir).status, 1, 'evento forjado no fim');
      db.exec("DELETE FROM audit WHERE payload='{\"forjado\":true}'");
      assert.equal(run('verify-audit.mjs', dir).status, 0, 'removido o evento forjado, a cadeia confere de novo');

      // Adulteração sofisticada: apagar um evento E recalcular os hashes seguintes. A cadeia fica coerente,
      // mas o buraco na numeração dos eventos continua denunciando a remoção.
      const following = db.prepare('SELECT * FROM audit WHERE id > ? ORDER BY id').all(middle);
      let chain = db.prepare('SELECT hash FROM audit WHERE id < ? ORDER BY id DESC LIMIT 1').get(middle).hash;
      db.prepare('DELETE FROM audit WHERE id=?').run(middle);
      for (const row of following) {
        const hash = createHash('sha256').update(chain + row.payload).digest('hex');
        db.prepare('UPDATE audit SET previousHash=?, hash=? WHERE id=?').run(chain, hash, row.id);
        chain = hash;
      }
      const rechained = run('verify-audit.mjs', dir);
      assert.equal(rechained.status, 1, 'evento removido com a cadeia recalculada');
      assert.match(rechained.stderr, new RegExp(`Inconsistência no evento ${following[0].id}`));
    }, { dataDir: dir });
  } finally { removeTempDir(dir); }
});

test('script de backup: cópia verificada com o servidor ligado, mídias opcionais e retenção', async () => {
  const dir = makeTempDir('tvcorp-test-');
  try {
    await withApp(async kit => {
      await kit.approvedMedia(kit.admin, { name: 'a.png' });
      const backups = () => readdirSync(path.join(dir, 'backups')).filter(name => name.endsWith('.sqlite')).sort();
      const first = run('backup.mjs', dir);
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /Backup do banco criado e verificado/);
      assert.match(first.stdout, /FORA deste servidor/);
      const [file] = backups();
      assert.match(file, /^tvcorp-\d{8}T\d{6,9}Z\.sqlite$/);
      const copy = new DatabaseSync(path.join(dir, 'backups', file), { readOnly: true });
      try {
        assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        for (const table of ['users', 'media', 'audit', 'units']) assert.equal(copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, kit.app.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, table);
      } finally { copy.close(); }
      const withMedia = run('backup.mjs', dir, ['--media']);
      assert.equal(withMedia.status, 0, withMedia.stderr);
      const mediaCopy = readdirSync(path.join(dir, 'backups')).find(name => name.endsWith('-midias'));
      assert.ok(mediaCopy && readdirSync(path.join(dir, 'backups', mediaCopy)).length === 1, 'cópia da pasta de mídias');
      for (let i = 0; i < 3; i++) assert.equal(run('backup.mjs', dir).status, 0);
      assert.equal(backups().length, 5);
      const kept = run('backup.mjs', dir, ['--keep', '2']);
      assert.equal(kept.status, 0, kept.stderr);
      assert.equal(backups().length, 2, 'só os 2 mais recentes');
      assert.ok(!readdirSync(path.join(dir, 'backups')).some(name => name.endsWith('-midias')), 'a cópia de mídias de um backup removido também sai');
      assert.match(kept.stdout, /4 backup\(s\) antigo\(s\) removido\(s\)/);
      for (const bad of ['0', '-1', 'x', '1.5']) { const result = run('backup.mjs', dir, ['--keep', bad]); assert.equal(result.status, 1, bad); assert.match(result.stderr, /--keep/); }
    }, { dataDir: dir });
    const empty = makeTempDir('tvcorp-test-');
    try { const missing = run('backup.mjs', empty); assert.equal(missing.status, 1); assert.match(missing.stderr, /Banco não encontrado/); } finally { removeTempDir(empty); }
  } finally { removeTempDir(dir); }
});

test('script de migração: atualiza uma cópia do banco da 1.1.0 com backup e depois não tem mais nada a fazer', async () => {
  const dir = makeTempDir('tvcorp-test-');
  try {
    const legacy = await buildLegacyDatabase(dir);
    const first = run('migrate.mjs', dir);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Esquema atualizado: 0 → 8/);
    assert.match(first.stdout, /Backup anterior à migração/);
    const backups = readdirSync(path.join(dir, 'backups'));
    assert.equal(backups.length, 1);
    const old = new DatabaseSync(path.join(dir, 'backups', backups[0]), { readOnly: true });
    try { assert.ok(old.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='media'").get().n >= legacy.media.length, 'o backup guarda o banco como estava'); } finally { old.close(); }
    const again = run('migrate.mjs', dir);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /Nada a fazer/);
    assert.equal(readdirSync(path.join(dir, 'backups')).length, 1, 'sem novas migrações, sem novo backup');
    // Outro caminho de banco = banco novo naquele lugar; o original não é tocado.
    const elsewhere = path.join(dir, 'outro', 'novo.sqlite');
    const fresh = run('migrate.mjs', dir, [], { DB_PATH: elsewhere });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.match(fresh.stdout, /Esquema atualizado: 0 → 8/);
    assert.ok(existsSync(elsewhere));
    assert.equal(readdirSync(path.join(dir, 'backups')).length, 1, 'banco vazio não gera backup');
    const original = new DatabaseSync(path.join(dir, 'tvcorp.sqlite'), { readOnly: true });
    try { assert.equal(original.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 8); } finally { original.close(); }
  } finally { removeTempDir(dir); }
});
