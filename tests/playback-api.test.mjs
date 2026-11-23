// Fase 2 — lado do servidor: repetição da playlist (loop), duração natural de vídeo e o que as TVs recebem.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/db/migrator.mjs';
import { migrations } from '../server/db/migrations/index.mjs';
import { withApp, createTestApp, makeTempDir, removeTempDir, must } from './helpers/app.mjs';
import { sampleFile } from './helpers/http.mjs';
import { buildLegacyDatabase } from './helpers/legacy-db.mjs';

const PREFIX = 'tvcorp-fase2-';

async function media(kit) {
  const image = await kit.approvedMedia(kit.admin, { name: 'aviso.png', title: 'Aviso' });
  const video = await kit.approvedMedia(kit.admin, { name: 'video.mp4', title: 'Vídeo', bytes: sampleFile('.mp4', 'fase2-video') });
  const webm = await kit.approvedMedia(kit.admin, { name: 'clipe.webm', title: 'Clipe', bytes: sampleFile('.webm', 'fase2-webm') });
  const pdf = await kit.approvedMedia(kit.admin, { name: 'norma.pdf', title: 'Norma', bytes: sampleFile('.pdf', 'fase2-pdf') });
  return { image, video, webm, pdf };
}

const post = (kit, body) => kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: 'Sequência', ...body } });
const patch = (kit, id, body) => kit.call(`/api/playlists/${id}`, { method: 'PATCH', session: kit.admin, body });
const publish = (kit, playlist, note = '') => kit.call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: playlist.draftRev, note } });
const modes = playlist => playlist.items.map(item => item.durationMode);

test('duração: por padrão o tempo é definido (como na Fase 1); a duração natural só vale para vídeo', async () => {
  await withApp(async kit => {
    const { image, video, webm, pdf } = await media(kit);
    const created = must(await post(kit, { items: [{ mediaId: image.id }, { mediaId: video.id, durationMode: 'natural' }, { mediaId: webm.id, durationS: 20 }] }), 201);
    assert.deepEqual(modes(created), ['fixed', 'natural', 'fixed'], 'sem informar, o modo é "tempo definido"');
    assert.equal(created.items[1].durationS, 15, 'a duração natural guarda um valor de segurança (padrão 15 s)');

    // Imagem e PDF não têm duração natural; o servidor recusa e diz qual conteúdo é o problema.
    for (const target of [image, pdf]) {
      const response = await post(kit, { items: [{ mediaId: target.id, durationMode: 'natural' }] });
      assert.deepEqual([response.status, response.data.code], [400, 'DURATION_MODE_INVALID'], target.title);
      assert.match(response.data.error, new RegExp(target.title));
    }
    // (`null` equivale a "não informado" e usa o padrão, como nos demais campos do item.)
    for (const bad of ['natrual', 'NATURAL', '', 1, true, {}, []]) {
      const response = await post(kit, { items: [{ mediaId: video.id, durationMode: bad }] });
      assert.equal(response.status, 400, JSON.stringify(bad));
    }
    assert.equal(kit.app.db.prepare("SELECT COUNT(*) AS n FROM playlists WHERE name='Sequência'").get().n, 1, 'tentativas inválidas não deixam playlists pela metade');

    // O modo vai para a edição seguinte e para a versão publicada; trocar de natural para tempo definido também funciona.
    const edited = must(await patch(kit, created.id, { rev: created.draftRev, items: [
      { mediaId: video.id, durationMode: 'fixed', durationS: 45 }, { mediaId: webm.id, durationMode: 'natural' }
    ] }));
    assert.deepEqual([modes(edited), edited.items[0].durationS], [['fixed', 'natural'], 45]);
    const published = must(await publish(kit, edited), 201);
    const version = must(await kit.call(`/api/playlists/${created.id}/versions/${published.latestVersion}`, { session: kit.admin }));
    assert.deepEqual(modes(version), ['fixed', 'natural']);
    assert.equal(version.items[0].durationS, 45);

    // Restaurar a versão publicada devolve ao rascunho o modo de cada conteúdo: a duração natural não se perde na volta.
    const changed = must(await patch(kit, created.id, { rev: published.draftRev, items: [{ mediaId: video.id, durationMode: 'fixed', durationS: 30 }] }));
    assert.deepEqual(modes(changed), ['fixed']);
    const restored = must(await kit.call(`/api/playlists/${created.id}/restore`, { method: 'POST', session: kit.admin, body: { rev: changed.draftRev, version: published.latestVersion } }));
    assert.deepEqual(modes(restored), ['fixed', 'natural']);
    assert.deepEqual(restored.items.map(item => item.durationS), [45, 15]);
  });
});

test('repetição (loop): ligada por padrão; só aceita verdadeiro ou falso; a versão publicada guarda a sua própria', async () => {
  await withApp(async kit => {
    const { image } = await media(kit);
    const created = must(await post(kit, { items: [{ mediaId: image.id }] }), 201);
    assert.equal(created.loop, true);
    for (const bad of ['false', 'true', 0, 1, null, 'sim', [], {}]) {
      assert.deepEqual(await post(kit, { loop: bad, items: [{ mediaId: image.id }] }).then(r => [r.status, r.data.code]), [400, 'LOOP_INVALID'], JSON.stringify(bad));
      assert.deepEqual(await patch(kit, created.id, { rev: created.draftRev, loop: bad }).then(r => [r.status, r.data.code]), [400, 'LOOP_INVALID'], JSON.stringify(bad));
    }
    assert.equal(must(await kit.call(`/api/playlists/${created.id}`, { session: kit.admin })).draftRev, created.draftRev, 'pedidos recusados não mudam nada');

    // Editar sem informar `loop` mantém o que estava.
    const renamed = must(await patch(kit, created.id, { rev: created.draftRev, name: 'Outro nome' }));
    assert.equal(renamed.loop, true);

    const v1 = must(await publish(kit, renamed, 'com repetição'), 201);
    const off = must(await patch(kit, created.id, { rev: v1.draftRev, loop: false }));
    assert.deepEqual([off.loop, off.draftRev, off.hasUnpublishedChanges], [false, v1.draftRev + 1, true], 'mudar só a repetição já conta como alteração a publicar');
    const v2 = must(await publish(kit, off, 'sem repetição'), 201);
    assert.equal(v2.latestVersion, 2);

    const version = number => kit.call(`/api/playlists/${created.id}/versions/${number}`, { session: kit.admin }).then(r => must(r));
    assert.deepEqual([(await version(1)).loop, (await version(2)).loop], [true, false], 'cada versão publicada guarda o seu valor');
    // Ligar de novo no rascunho não altera a versão 2, que continua como foi publicada.
    // Editar outra coisa, sem informar `loop`, com a repetição desligada, não a liga de volta.
    const keep = must(await patch(kit, created.id, { rev: v2.draftRev, name: 'Renomeada sem repetição' }));
    assert.equal(keep.loop, false);
    const keepItems = must(await patch(kit, created.id, { rev: keep.draftRev, items: [{ mediaId: image.id, durationS: 12 }] }));
    assert.equal(keepItems.loop, false);
    const on = must(await patch(kit, created.id, { rev: keepItems.draftRev, loop: true }));
    assert.equal(on.loop, true);
    assert.equal((await version(2)).loop, false);
    // Restaurar uma versão antiga devolve também a repetição daquele momento.
    const restored = must(await kit.call(`/api/playlists/${created.id}/restore`, { method: 'POST', session: kit.admin, body: { rev: on.draftRev, version: 2 } }));
    assert.equal(restored.loop, false);
    assert.equal(must(await kit.call(`/api/playlists?unitId=leste&sectorId=rh`, { session: kit.admin })).playlists.find(p => p.id === created.id).loop, false, 'a lista também informa a repetição');

    // Criar já sem repetição.
    const single = must(await post(kit, { name: 'Uma vez', loop: false, items: [{ mediaId: image.id }] }), 201);
    assert.equal(single.loop, false);
  });
});

test('auditoria: a repetição só aparece no registro quando muda; nada de conteúdo sensível', async () => {
  await withApp(async kit => {
    const { image } = await media(kit);
    const created = must(await post(kit, { items: [{ mediaId: image.id }] }), 201);
    const renamed = must(await patch(kit, created.id, { rev: created.draftRev, name: 'Novo nome' }));
    must(await patch(kit, created.id, { rev: renamed.draftRev, loop: false }));
    const events = must(await kit.call('/api/audit?limit=50', { session: kit.admin })).events.filter(e => e.action === 'playlist.updated');
    const details = events.map(event => event.detail);
    assert.equal(details.length, 2);
    const withLoop = details.filter(detail => 'loop' in detail);
    assert.equal(withLoop.length, 1, 'só a alteração que mexeu na repetição a registra');
    assert.equal(withLoop[0].loop, false);

    // Criar e publicar já sem repetição também ficam registrados; com a repetição ligada (o padrão) o campo nem aparece.
    const once = must(await post(kit, { name: 'Uma vez', loop: false, items: [{ mediaId: image.id }] }), 201);
    must(await publish(kit, once, 'sem repetição'), 201);
    must(await publish(kit, must(await kit.call(`/api/playlists/${created.id}`, { session: kit.admin })), 'com repetição desligada depois'), 201);
    const all = must(await kit.call('/api/audit?limit=50', { session: kit.admin })).events;
    const loopOf = action => all.filter(event => event.action === action).map(event => ('loop' in event.detail ? event.detail.loop : 'ligada')).sort();
    assert.deepEqual(loopOf('playlist.created'), [false, 'ligada'], 'criada sem repetição: registrado; com repetição: sem o campo');
    assert.deepEqual(loopOf('playlist.version.published'), [false, false], 'publicada sem repetição: registrado');
    for (const event of all.filter(entry => entry.action.startsWith('playlist.'))) assert.ok(!/senha|token|password/i.test(JSON.stringify(event.detail)), event.action);
  });
});

test('manifesto da TV: cada item informa o modo de duração e `loop` só é falso se TODAS as playlists ativas pararam de repetir', async () => {
  await withApp(async kit => {
    const { image, video, webm } = await media(kit);
    const tv = await kit.pairedDisplay(kit.admin, { name: 'Recepção' });
    const manifest = async () => must(await kit.call('/api/player/manifest', { token: tv.token }));
    assert.equal((await manifest()).loop, true, 'sem programação: repetição ligada (nada a exibir)');

    const make = async (name, items, loop) => {
      const created = must(await post(kit, { name, loop, items }), 201);
      return must(await publish(kit, created), 201);
    };
    const once = await make('Uma vez', [{ mediaId: image.id, durationS: 7 }, { mediaId: video.id, durationMode: 'natural', transition: 'slide', transitionMs: 900 }], false);
    const first = await kit.liveSchedule(kit.admin, { playlistId: once.id, displayIds: [tv.display.id], name: 'A' });
    const one = await manifest();
    assert.equal(one.loop, false);
    assert.deepEqual(one.items.map(item => [item.title, item.duration, item.durationMode, item.transition, item.transitionMs]), [['Aviso', 7, 'fixed', 'cut', 0], ['Vídeo', 15, 'natural', 'slide', 900]]);

    // Uma segunda programação ativa, esta com repetição: a sequência inteira passa a repetir (a ordem é a da publicação).
    const loops = await make('Repete', [{ mediaId: webm.id }], true);
    await kit.liveSchedule(kit.admin, { playlistId: loops.id, displayIds: [tv.display.id], name: 'B' });
    const both = await manifest();
    assert.equal(both.loop, true);
    assert.deepEqual(both.items.map(item => item.title), ['Aviso', 'Vídeo', 'Clipe']);

    // Interrompendo a que repete, volta a valer "uma vez só".
    const schedules = must(await kit.call('/api/schedules?unitId=leste&sectorId=rh', { session: kit.admin })).schedules;
    const b = schedules.find(s => s.name === 'B');
    must(await kit.call(`/api/schedules/${b.id}/stop`, { method: 'POST', session: kit.admin, body: {} }));
    assert.equal((await manifest()).loop, false);
    assert.ok(first.id);
  });
});

test('versões publicadas continuam imutáveis, inclusive o novo modo de duração e a repetição', async () => {
  await withApp(async kit => {
    const { video } = await media(kit);
    const created = must(await post(kit, { items: [{ mediaId: video.id, durationMode: 'natural' }] }), 201);
    must(await publish(kit, created), 201);
    const db = kit.app.db;
    assert.throws(() => db.prepare("UPDATE playlist_version_items SET duration_mode='fixed'").run(), /playlist_version_immutable/);
    assert.throws(() => db.prepare('UPDATE playlist_version_items SET duration_s=30').run(), /playlist_version_immutable/);
    assert.throws(() => db.prepare('UPDATE playlist_versions SET loop_enabled=0').run(), /playlist_version_immutable/);
    // Os valores recusados não mudaram.
    assert.deepEqual(db.prepare('SELECT duration_mode FROM playlist_version_items').all().map(r => r.duration_mode), ['natural']);
    // A restrição de valores também vale para o banco, não só para a API.
    assert.throws(() => db.prepare("UPDATE playlist_items SET duration_mode='qualquer'").run(), /CHECK/i);
    assert.throws(() => db.prepare('UPDATE playlists SET loop_enabled=2').run(), /CHECK/i);
    // E a criação de uma versão (que a imutabilidade não impede) também só aceita os valores permitidos.
    const published = db.prepare('SELECT * FROM playlist_versions').get();
    const insertVersion = loop => db.prepare('INSERT INTO playlist_versions (id, playlist_id, version, note, published_at, published_by, loop_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('versao-de-teste', published.playlist_id, 99, '', published.published_at, published.published_by, loop);
    const insertItem = mode => db.prepare('INSERT INTO playlist_version_items (version_id, position, media_id, title, name, type, duration_s, transition, transition_ms, duration_mode) VALUES (?, 0, NULL, ?, ?, ?, 10, ?, 0, ?)')
      .run('versao-de-teste', 'Teste', 'teste.mp4', 'video/mp4', 'cut', mode);
    assert.throws(() => insertVersion(2), /CHECK/i);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playlist_versions WHERE id='versao-de-teste'").get().n, 0, 'a versão recusada não ficou pela metade');
    insertVersion(0);
    assert.throws(() => insertItem('qualquer'), /CHECK/i);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playlist_version_items WHERE version_id='versao-de-teste'").get().n, 0);
    insertItem('natural');
    assert.equal(db.prepare("SELECT duration_mode FROM playlist_version_items WHERE version_id='versao-de-teste'").get().duration_mode, 'natural');
  });
});

test('migração 7: banco da Fase 1 com playlists, versões e programações ganha os padrões e nada muda de comportamento', async () => {
  const dataDir = makeTempDir(PREFIX);
  try {
    const legacy = await buildLegacyDatabase(dataDir);
    // Leva o banco até o esquema 6 (Fase 1) com o migrador real, para só depois a aplicação aplicar a migração 7.
    const dbFile = path.join(dataDir, 'tvcorp.sqlite');
    const raw = new DatabaseSync(dbFile);
    raw.exec('PRAGMA foreign_keys = ON');
    migrate(raw, { migrations: migrations.slice(0, 6), backupDir: path.join(dataDir, 'backups-fase1') });
    assert.equal(raw.prepare('SELECT MAX(id) AS id FROM schema_migrations').get().id, 6);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('playlists') WHERE name='loop_enabled'").get().n, 0, 'ainda não existe no esquema 6');
    const before = {
      playlists: raw.prepare('SELECT COUNT(*) AS n FROM playlists').get().n,
      versions: raw.prepare('SELECT COUNT(*) AS n FROM playlist_versions').get().n,
      items: raw.prepare('SELECT COUNT(*) AS n FROM playlist_items').get().n,
      versionItems: raw.prepare('SELECT COUNT(*) AS n FROM playlist_version_items').get().n,
      rows: raw.prepare('SELECT version_id, position, media_id, duration_s, transition, transition_ms FROM playlist_version_items ORDER BY version_id, position').all().map(row => ({ ...row }))
    };
    assert.ok(before.playlists >= 2 && before.items >= 4);
    raw.close();

    const { app, api } = createTestApp({ dataDir });
    try {
      assert.deepEqual([app.migration.from, app.migration.to], [6, 8]);
      assert.ok(app.migration.backupFile, 'a migração faz backup antes de alterar');
      const applied = app.migration.applied.find(item => item.id === 7);
      assert.deepEqual(applied.details, { playlists: before.playlists, versions: before.versions, items: before.items, versionItems: before.versionItems });
      const db = app.db;
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE loop_enabled=1').get().n, before.playlists);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlist_versions WHERE loop_enabled=1').get().n, before.versions);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playlist_items WHERE duration_mode='fixed'").get().n, before.items);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playlist_version_items WHERE duration_mode='fixed'").get().n, before.versionItems);
      const after = db.prepare('SELECT version_id, position, media_id, duration_s, transition, transition_ms FROM playlist_version_items ORDER BY version_id, position').all().map(row => ({ ...row }));
      assert.deepEqual(after, before.rows, 'itens das versões publicadas idênticos');
      assert.throws(() => db.prepare("UPDATE playlist_version_items SET duration_mode='natural'").run(), /playlist_version_immutable/, 'a versão antiga continua imutável');

      // A TV pareada na Fase 1 recebe a mesma programação, agora com os campos novos nos valores padrão.
      const admin = (await api.login(legacy.admin.email, legacy.password)).session;
      const manifest = must(await api.call('/api/player/manifest', { token: legacy.deviceToken }));
      assert.equal(manifest.loop, true);
      assert.ok(manifest.items.length >= 3);
      assert.ok(manifest.items.every(item => item.durationMode === 'fixed'));
      assert.deepEqual(manifest.items.map(item => [item.id, item.duration]), legacy.legacyManifest.items.map(item => [item.id, item.duration]), 'mesmos conteúdos e tempos da programação da versão 1.1.0');
      assert.ok(admin);
    } finally { await app.close(); }
  } finally { removeTempDir(dataDir, PREFIX); }
});
