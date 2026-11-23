import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/core.mjs';
import { silentLogger } from '../server/lib/logger.mjs';
import { MigrationError, migrate } from '../server/db/migrator.mjs';
import { migrations } from '../server/db/migrations/index.mjs';
import { createTestApp, makeTempDir, removeTempDir, must, PASSWORD } from './helpers/app.mjs';
import { buildLegacyDatabase } from './helpers/legacy-db.mjs';
import { apiClient, uniquePng } from './helpers/http.mjs';

const PREFIX = 'tvcorp-migr-';

function verifyChain(rows) {
  let previous = '0'.repeat(64), previousId = 0;
  for (const row of rows) {
    assert.equal(row.previousHash, previous, `evento ${row.id}: hash anterior`);
    assert.equal(row.hash, createHash('sha256').update(previous + row.payload).digest('hex'), `evento ${row.id}: hash`);
    assert.equal(row.id, previousId + 1);
    previous = row.hash; previousId = row.id;
  }
}

test('atualização de um banco real da 1.1.0 preserva contas, mídias, TV pareada, programações e auditoria', async () => {
  const dataDir = makeTempDir(PREFIX);
  const legacy = await buildLegacyDatabase(dataDir);
  const { app, api } = createTestApp({ dataDir });
  try {
    const report = app.migration;
    assert.deepEqual([report.from, report.to, report.fresh], [0, 8, false]);
    assert.ok(report.backupFile && existsSync(report.backupFile), 'backup criado antes de migrar');
    assert.match(path.basename(report.backupFile), /^tvcorp-antes-da-migracao-.*-v0-para-v8\.sqlite$/);
    const backup = new DatabaseSync(report.backupFile, { readOnly: true });
    assert.equal(backup.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='media'").get().n, 5);
    assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM users').get().n, 5);
    const backupAudit = backup.prepare('SELECT * FROM audit ORDER BY id').all();
    backup.close();

    // Contas: perfis, escopos, senhas (hash) e situação preservados.
    for (const [who, role] of [[legacy.admin, 'admin'], [legacy.manager, 'manager'], [legacy.editor, 'editor'], [legacy.viewer, 'viewer']]) {
      const login = await api.login(who.email, legacy.password);
      assert.equal(login.status, 200, who.email);
      assert.equal(login.data.user.id, who.id);
      assert.equal(login.data.user.role, role);
      assert.deepEqual(login.data.user.unitIds, who.unitIds);
      assert.deepEqual(login.data.user.sectorIds, who.sectorIds);
    }
    assert.equal((await api.login(legacy.inactive.email, legacy.password)).status, 401, 'conta inativa continua inativa');
    const admin = (await api.login(legacy.admin.email, legacy.password)).session;

    // Biblioteca: mesmos arquivos, mesmos identificadores e conteúdo idêntico.
    const leste = must(await api.call('/api/library?unitId=leste&sectorId=rh', { session: admin }));
    const legacyMedia = legacy.legacyState.media.filter(m => m.unitId === 'leste' && m.sectorId === 'rh');
    assert.equal(leste.total, legacyMedia.length);
    for (const original of legacyMedia) {
      const migrated = leste.media.find(m => m.id === original.id);
      assert.ok(migrated, `mídia ${original.id} presente`);
      for (const field of ['title', 'name', 'type', 'size', 'sha256', 'status', 'scanStatus', 'unitId', 'sectorId', 'createdAt', 'createdBy']) assert.equal(migrated[field], original[field], field);
      assert.equal(migrated.folderId, null, 'mídias antigas ficam na raiz do espaço');
      const file = await api.call(`/api/media/${original.id}/file`, { session: admin });
      assert.equal(file.status, 200);
      assert.equal(createHash('sha256').update(file.data).digest('hex'), original.sha256);
    }
    assert.equal(must(await api.call('/api/library?unitId=centro&sectorId=seguranca', { session: admin })).total, 1);

    // TV já pareada: a credencial antiga continua valendo e o manifesto é equivalente ao da 1.1.0.
    const manifest = must(await api.call('/api/player/manifest', { token: legacy.deviceToken }));
    const pick = item => ({ id: item.id, title: item.title, name: item.name, type: item.type, url: item.url, duration: item.duration });
    assert.deepEqual(manifest.items.map(pick), legacy.legacyManifest.items.map(pick));
    assert.equal(manifest.display.name, legacy.legacyManifest.display.name);
    assert.ok(Date.parse(manifest.validUntil) - Date.parse(manifest.generatedAt) <= 60000);
    assert.equal((await api.call(`/api/media/${manifest.items[0].id}/file`, { token: legacy.deviceToken })).status, 200);
    // TV cadastrada e ainda não pareada: o código de pareamento emitido na 1.1.0 ainda vale.
    const pairedLater = must(await api.call('/api/player/pair', { method: 'POST', body: { code: legacy.tvWaiting.pairingCode } }));
    assert.equal(must(await api.call('/api/player/manifest', { token: pairedLater.token })).items.length, 3);

    // Programações: cada publicação virou playlist (versão 1) + programação com o MESMO identificador.
    const schedules = must(await api.call('/api/schedules?unitId=leste&sectorId=rh', { session: admin })).schedules;
    const live = schedules.find(s => s.id === legacy.live.id), stopped = schedules.find(s => s.id === legacy.stopped.id);
    assert.equal(schedules.length, 2);
    assert.deepEqual([live.status, live.state, live.name, live.playlistVersion, live.displayIds.length, live.endAt], ['published', 'live', 'Comunicados da semana', 1, 2, legacy.live.endAt]);
    assert.deepEqual([stopped.status, stopped.name], ['stopped', 'Campanha encerrada']);
    const playlist = must(await api.call(`/api/playlists/${live.playlistId}`, { session: admin }));
    assert.deepEqual([playlist.items.length, playlist.latestVersion, playlist.hasUnpublishedChanges], [3, 1, false]);
    assert.ok(playlist.items.every(item => item.durationS === 20 && item.transition === 'cut'));
    assert.deepEqual(playlist.items.map(item => item.mediaId), legacy.live.mediaIds);

    // Permissões: ninguém perde nada e ninguém ganha poder administrativo sem decisão do Administrador.
    const manager = (await api.login(legacy.manager.email, legacy.password)).session;
    const editor = (await api.login(legacy.editor.email, legacy.password)).session;
    assert.equal((await api.call('/api/displays', { method: 'POST', session: manager, body: { name: 'TV', unitId: 'leste', sectorId: 'rh' } })).status, 403);
    assert.deepEqual(must(await api.call('/api/users', { session: manager })).users, []);
    assert.deepEqual(must(await api.call('/api/audit', { session: manager })).events, []);
    must(await api.call(`/api/media/${legacy.pending.id}/approve`, { method: 'POST', session: manager, body: { acknowledgeUnscanned: true } }));
    const created = must(await api.call('/api/playlists', { method: 'POST', session: manager, body: { name: 'Nova', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: legacy.pending.id }] } }), 201);
    const version = must(await api.call(`/api/playlists/${created.id}/publish`, { method: 'POST', session: manager, body: { rev: created.draftRev } }), 201);
    assert.equal(version.latestVersion, 1);
    must(await api.call('/api/schedules', { method: 'POST', session: manager, body: { name: 'Gestor publica', unitId: 'leste', sectorId: 'rh', playlistId: created.id, displayIds: [legacy.tvPaired.display.id], publish: true } }), 201);
    assert.equal((await api.call('/api/displays', { method: 'POST', session: editor, body: { name: 'TV', unitId: 'leste', sectorId: 'rh' } })).status, 403);
    assert.equal((await api.call(`/api/media/${legacy.other.id}/approve`, { method: 'POST', session: editor, body: { acknowledgeUnscanned: true } })).status, 403);
    // Retirar revokes legados não devolve poderes administrativos exclusivos da TI.
    must(await api.call(`/api/users/${legacy.manager.id}`, { method: 'PATCH', session: admin, body: { revokes: [] } }));
    const restored = (await api.login(legacy.manager.email, legacy.password)).session;
    assert.equal((await api.call('/api/displays', { method: 'POST', session: restored, body: { name: 'TV liberada', unitId: 'leste', sectorId: 'rh' } })).status, 403);

    // Auditoria: eventos antigos intactos (mesmo conteúdo e hash) + registro da migração; cadeia íntegra.
    const rows = app.db.prepare('SELECT * FROM audit ORDER BY id').all();
    verifyChain(rows);
    assert.deepEqual(rows.slice(0, backupAudit.length).map(r => [r.id, r.payload, r.hash]), backupAudit.map(r => [r.id, r.payload, r.hash]));
    const migratedEvent = JSON.parse(rows[backupAudit.length].payload);
    assert.equal(migratedEvent.action, 'db.migrated');
    assert.deepEqual([migratedEvent.detail.from, migratedEvent.detail.to], [0, 8]);

    // Segunda inicialização: nada a migrar, sem novo backup.
    await app.close();
    const again = createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger });
    try {
      assert.deepEqual([again.migration.applied.length, again.migration.backupFile], [0, null]);
      assert.equal(readdirSync(path.join(dataDir, 'backups')).length, 1);
      assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM media').get().n, 5);
    } finally { await again.close(); }
  } finally {
    await app.close();
    removeTempDir(dataDir, PREFIX);
  }
});

test('banco novo nasce no esquema mais recente, com unidades e setores padrão e sem backup', async () => {
  const { app, dataDir } = createTestApp();
  try {
    assert.deepEqual([app.migration.from, app.migration.to, app.migration.fresh, app.migration.backupFile], [0, 8, true, null]);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, migrations.length);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM units').get().n, 4);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sectors').get().n, 4);
    assert.equal(app.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(existsSync(path.join(dataDir, 'backups')), false);
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

test('recusa iniciar com banco de uma versão mais nova e não altera nada', async () => {
  const { app, dataDir } = createTestApp();
  await app.close();
  const db = new DatabaseSync(path.join(dataDir, 'tvcorp.sqlite'));
  db.prepare("INSERT INTO schema_migrations(id, name, applied_at, checksum, details) VALUES(999, 'versao-futura', ?, 'x', '{}')").run(new Date().toISOString());
  const before = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n;
  db.close();
  assert.throws(() => createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger }), error => error instanceof MigrationError && /mais nova/.test(error.message) && /Nada foi alterado/.test(error.message));
  const check = new DatabaseSync(path.join(dataDir, 'tvcorp.sqlite'), { readOnly: true });
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n, before);
  check.close();
  removeTempDir(dataDir);
});

test('falha no meio da migração desfaz TUDO, mantém o backup e permite tentar de novo', async () => {
  const dataDir = makeTempDir(PREFIX);
  const legacy = await buildLegacyDatabase(dataDir);
  const broken = [...migrations.slice(0, 4), { id: 5, name: 'quebrada', up(db) { db.exec('CREATE TABLE sera_desfeita(x)'); throw new Error('falha proposital'); } }];
  let failure;
  try { createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger, migrations: broken }); } catch (error) { failure = error; }
  assert.ok(failure instanceof MigrationError);
  assert.match(failure.message, /Falha na migração 5 \(quebrada\): falha proposital/);
  assert.match(failure.message, /Nada foi alterado/);
  assert.ok(failure.backupFile && existsSync(failure.backupFile));
  const db = new DatabaseSync(path.join(dataDir, 'tvcorp.sqlite'), { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  assert.ok(!tables.includes('units') && !tables.includes('sera_desfeita'), 'nenhuma tabela nova sobrou');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='media'").get().n, 5, 'dados antigos intactos');
  db.close();
  // Corrigido o problema, a atualização completa funciona sobre o mesmo banco.
  const { app, api } = createTestApp({ dataDir });
  try {
    assert.equal(app.migration.to, 8);
    const admin = (await api.login(legacy.admin.email, legacy.password)).session;
    assert.equal(must(await api.call('/api/library?unitId=leste&sectorId=rh', { session: admin })).total, 4);
  } finally { await app.close(); removeTempDir(dataDir, PREFIX); }
});

test('aviso quando o código de uma migração já aplicada mudou depois de aplicada', async () => {
  const { app, dataDir } = createTestApp();
  await app.close();
  const messages = [];
  const edited = migrations.map(m => (m.id === 2 ? { ...m, up(db, ctx) { return m.up(db, ctx); } } : m));
  const again = createApp({ dataDir, port: 0, production: false, scanner: '', logger: { ...silentLogger, info: message => messages.push(message) }, migrations: edited });
  await again.close();
  assert.ok(messages.some(message => /migração 2 .* mudou desde que foi aplicada/.test(message)), messages.join(' | '));
  removeTempDir(dataDir);
});

test('migração real aguenta volume realista de dados em tempo aceitável', async () => {
  // Constrói, direto em SQL, um banco 1.1.0 grande (sem passar pelo servidor antigo, que seria lento demais).
  const dataDir = makeTempDir(PREFIX);
  const legacyDb = new DatabaseSync(path.join(dataDir, 'tvcorp.sqlite'));
  legacyDb.exec(`
    CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,data TEXT NOT NULL);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,userId TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,previousHash TEXT NOT NULL,hash TEXT NOT NULL);`);
  const put = legacyDb.prepare('INSERT INTO records(kind,id,data) VALUES(?,?,?)');
  put.run('units', 'u1', JSON.stringify({ id: 'u1', name: 'Unidade 1', city: 'X' }));
  put.run('sectors', 's1', JSON.stringify({ id: 's1', name: 'Setor 1' }));
  legacyDb.exec('BEGIN');
  const MEDIA = 5000, PLAYLISTS = 400;
  for (let i = 0; i < MEDIA; i++) put.run('media', `m${i}`, JSON.stringify({ id: `m${i}`, name: `arquivo${i}.png`, title: `Arquivo ${i}`, unitId: 'u1', sectorId: 's1', type: 'image/png', size: 100, sha256: `h${i}`, status: 'approved', scanStatus: 'clean', storageName: `m${i}.png`, createdAt: new Date().toISOString() }));
  for (let i = 0; i < 20; i++) put.run('displays', `d${i}`, JSON.stringify({ id: `d${i}`, name: `TV ${i}`, unitId: 'u1', sectorId: 's1', active: true, createdAt: new Date().toISOString() }));
  for (let i = 0; i < PLAYLISTS; i++) put.run('playlists', `p${i}`, JSON.stringify({ id: `p${i}`, name: `Publicação ${i}`, unitId: 'u1', sectorId: 's1', mediaIds: [`m${i}`, `m${i + 1}`, `m${i + 2}`], displayIds: [`d${i % 20}`], active: true, duration: 15, createdAt: new Date().toISOString() }));
  legacyDb.exec('COMMIT');
  legacyDb.close();
  const started = Date.now();
  const app = createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger });
  const elapsed = Date.now() - started;
  try {
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n, MEDIA);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM schedules').get().n, PLAYLISTS);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM playlist_version_items').get().n, PLAYLISTS * 3);
    assert.ok(elapsed < 20000, `migração levou ${elapsed} ms`);
  } finally { await app.close(); removeTempDir(dataDir, PREFIX); }
});

test('banco local da 1.1.0 aberto em PRODUÇÃO: mídia aprovada sem varredura nunca chega à TV, e a credencial da TV continua valendo', async () => {
  const dataDir = makeTempDir(PREFIX);
  const legacy = await buildLegacyDatabase(dataDir);
  try {
    // Mesmo banco, primeiro em modo local (tudo aprovado e sem antivírus configurado)…
    const local = createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger });
    try {
      assert.equal(must(await apiClient(local).call('/api/player/manifest', { token: legacy.deviceToken })).items.length, 3);
    } finally { await local.close(); }
    // …e depois em produção: aprovado ≠ liberado. Só o que foi varrido (scan_status = clean) vai ao ar.
    const production = createApp({ dataDir, port: 0, production: true, origin: 'https://tv.example.test', scanner: 'scanner-nao-usado-neste-teste', logger: silentLogger });
    try {
      const api = apiClient(production);
      const manifest = await api.call('/api/player/manifest', { token: legacy.deviceToken });
      assert.equal(manifest.status, 200, 'a credencial antiga da TV segue válida');
      assert.equal(manifest.data.items.length, 0, 'nada sem varredura é exibido em produção');
      for (const media of legacy.media) assert.equal((await api.call(`/api/media/${media.id}/file`, { token: legacy.deviceToken })).status, 403, media.id);
      const admin = (await api.login(legacy.admin.email, legacy.password)).session;
      const listed = must(await api.call('/api/library?unitId=leste&sectorId=rh', { session: admin })).media.filter(item => legacy.media.some(m => m.id === item.id));
      assert.deepEqual(listed.map(item => [item.status, item.scanStatus]), [['approved', 'not_configured'], ['approved', 'not_configured'], ['approved', 'not_configured']], 'o estado antigo é preservado e visível para a TI');
      // A TI também não consegue "forçar" a aprovação de um arquivo sem varredura em produção.
      const forced = await api.call(`/api/media/${legacy.pending.id}/approve`, { method: 'POST', session: admin, body: { acknowledgeUnscanned: true } });
      assert.equal(forced.status, 409);
      assert.equal(forced.data.code, 'SCAN_REQUIRED');
      // Programação nova com arquivo sem varredura não publica.
      const draft = must(await api.call('/api/playlists', { method: 'POST', session: admin, body: { name: 'Nova', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: legacy.media[0].id }] } }), 201);
      const publish = await api.call(`/api/playlists/${draft.id}/publish`, { method: 'POST', session: admin, body: { rev: draft.draftRev } });
      assert.deepEqual([publish.status, publish.data.code], [409, 'MEDIA_NOT_READY']);
    } finally { await production.close(); }
  } finally { removeTempDir(dataDir, PREFIX); }
});

test('migrador: falha desfaz a transação e libera a conexão; nada fica pela metade e uma nova tentativa funciona', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  const backupDir = makeTempDir(PREFIX);
  try {
    const first = { id: 1, name: 'primeira', up: handle => { handle.exec('CREATE TABLE t1(x)'); return { ok: true }; } };
    const broken = { id: 2, name: 'defeituosa', up: handle => { handle.exec('CREATE TABLE t2(x)'); handle.exec('INSERT INTO t1 VALUES(1)'); throw new Error('defeito proposital'); } };
    assert.throws(() => migrate(db, { migrations: [first, broken], backupDir }), error => error instanceof MigrationError && error.migration === 2 && /defeito proposital/.test(error.message));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('t1','t2')").all();
    assert.deepEqual(tables, [], 'nem a migração 1 (que tinha corrido sem erro) fica aplicada: é tudo ou nada');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
    // A conexão ficou livre: se a transação anterior continuasse aberta, o BEGIN abaixo falharia.
    db.exec('BEGIN'); db.exec('ROLLBACK');
    const fixed = { ...broken, up: handle => { handle.exec('CREATE TABLE t2(x)'); } };
    const report = migrate(db, { migrations: [first, fixed], backupDir });
    assert.deepEqual([report.from, report.to, report.applied.map(item => item.id)], [0, 2, [1, 2]]);
  } finally { db.close(); removeTempDir(backupDir, PREFIX); }
});

test('migrador: confere a integridade referencial e a integridade do arquivo, e desfaz se algo estiver errado', () => {
  const backupDir = makeTempDir(PREFIX);
  try {
    // Conexão com chaves estrangeiras desligadas (como um banco antigo): a migração cria um registro órfão.
    const raw = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
    const orphan = { id: 1, name: 'orfao', up: handle => { handle.exec('CREATE TABLE pai(id INTEGER PRIMARY KEY); CREATE TABLE filho(pai_id INTEGER REFERENCES pai(id)); INSERT INTO filho VALUES(42);'); } };
    assert.throws(() => migrate(raw, { migrations: [orphan], backupDir }), error => error instanceof MigrationError && /Integridade referencial violada/.test(error.message));
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('pai','filho')").get().n, 0, 'o órfão não fica gravado');
    raw.close();

    // Verificação final do arquivo: o SQLite acusa corrupção depois do commit.
    const real = new DatabaseSync(':memory:');
    const damaged = new Proxy(real, {
      get(target, property) {
        if (property === 'prepare') return sql => (sql === 'PRAGMA quick_check' ? { get: () => ({ quick_check: 'database disk image is malformed' }) } : target.prepare(sql));
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const simple = { id: 1, name: 'simples', up: handle => { handle.exec('CREATE TABLE simples(x)'); } };
    assert.throws(() => migrate(damaged, { migrations: [simple], backupDir }), error => error instanceof MigrationError && /verificação de integridade/.test(error.message));
    real.close();
  } finally { removeTempDir(backupDir, PREFIX); }
});

test('migração 6: não sobrescreve permissões já definidas e normaliza contas com escopo ausente ou malformado', async () => {
  const dataDir = makeTempDir(PREFIX);
  const legacy = await buildLegacyDatabase(dataDir);
  // Simula um banco que já passou por uma versão intermediária (permissões por pessoa) e uma conta com cadastro incompleto.
  const raw = new DatabaseSync(path.join(dataDir, 'tvcorp.sqlite'));
  const patch = (id, change) => {
    const row = raw.prepare('SELECT data FROM users WHERE id=?').get(id);
    raw.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(change(JSON.parse(row.data))), id);
  };
  patch(legacy.editor.id, user => ({ ...user, grants: ['audit:read'], revokes: ['media:delete'] }));
  patch(legacy.viewer.id, ({ unitIds, sectorIds, ...rest }) => rest);
  patch(legacy.inactive.id, user => ({ ...user, unitIds: 'leste', sectorIds: null }));
  raw.close();
  const { app } = createTestApp({ dataDir });
  try {
    const user = id => app.services.users.byId(id);
    assert.deepEqual([user(legacy.editor.id).grants, user(legacy.editor.id).revokes], [['audit:read'], ['media:delete']], 'o que já estava definido é preservado, sem recalcular');
    for (const id of [legacy.viewer.id, legacy.inactive.id]) assert.deepEqual([user(id).unitIds, user(id).sectorIds], [[], []], 'escopo ausente vira lista vazia (nenhum acesso)');
    assert.deepEqual(user(legacy.manager.id).revokes, ['user:manage', 'audit:read', 'screen:create', 'screen:activate', 'screen:update', 'screen:delete'], 'conta da 1.1.0 mantém exatamente os poderes que tinha');
    assert.deepEqual(user(legacy.inactive.id).revokes, ['screen:create']);
    assert.deepEqual(user(legacy.admin.id).revokes, []);
    const details = app.migration.applied.find(item => item.id === 6).details;
    assert.equal(details.users, 5);
    assert.equal(details.withPreservedPrivileges, 2, 'só as contas antigas de Gestor e Editor sem campos de permissão (a inativa e o Gestor)');
    // Quem ficou sem escopo entra, mas não enxerga nem altera nada.
    const api = apiClient(app);
    const viewer = await api.login(legacy.viewer.email, legacy.password);
    assert.equal(viewer.status, 200);
    assert.deepEqual(must(await api.call('/api/state', { session: viewer.session })).units, []);
    assert.equal((await api.call('/api/library?unitId=centro&sectorId=seguranca', { session: viewer.session })).status, 403);
  } finally { await app.close(); removeTempDir(dataDir, PREFIX); }
});
