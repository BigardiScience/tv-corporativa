import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/core.mjs';
import { silentLogger } from '../server/lib/logger.mjs';
import { buildKit, createTestApp, listenOnFreePort, must, PASSWORD, removeTempDir } from './helpers/app.mjs';
import { PNG } from './helpers/http.mjs';

const SETUP_TOKEN = 'a'.repeat(40);

// A história inteira do produto, do primeiro acesso à TV: a mesma sequência em processo e por HTTP de verdade.
for (const transport of ['em processo', 'HTTP real']) {
  test(`fluxo completo (${transport}): configuração, perfis, envio, aprovação, TV, programação, revogação e reinício`, { timeout: 90000 }, async () => {
    const http = transport === 'HTTP real';
    const first = createTestApp({ setupToken: SETUP_TOKEN });
    const { dataDir } = first;
    let app = first.app, api = http ? await listenOnFreePort(app) : first.api;
    const call = (...args) => api.call(...args);
    try {
      // ---- primeiro acesso -----------------------------------------------------------------------------
      assert.equal((await call('/api/state')).status, 401);
      assert.equal(must(await call('/api/status')).configured, false);
      const setup = await call('/api/setup', { method: 'POST', body: { token: SETUP_TOKEN, name: 'TI', email: 'ti@example.invalid', password: PASSWORD } });
      assert.equal(setup.status, 201);
      const admin = { cookie: setup.cookie, csrf: setup.data.csrf };
      assert.match(admin.cookie, /^pwc_session=/);
      assert.equal((await call('/api/setup', { method: 'POST', body: { token: SETUP_TOKEN, name: 'TI', email: 'outra@example.invalid', password: PASSWORD } })).status, 409, 'só existe um primeiro administrador');
      assert.equal(must(await call('/api/status')).configured, true);
      const kit = buildKit({ app, api, dataDir, adminUser: setup.data.user, admin });

      let state = must(await call('/api/state', { session: admin }));
      assert.deepEqual(state.units.map(unit => unit.name).sort(), ['Unidade Centro', 'Unidade Leste', 'Unidade Oeste', 'Vila Norte'].sort());
      assert.equal((await call('/api/users', { method: 'POST', headers: { Cookie: admin.cookie }, body: {} })).status, 403, 'cookie sozinho não altera nada: falta o token CSRF');

      // ---- Editor: escopo próprio, sem poderes de administração ---------------------------------------
      const editorAccount = await kit.createUser('editor', { email: 'editor@example.invalid' });
      const editor = editorAccount.session;
      assert.equal((await call('/api/users', { method: 'POST', session: editor, body: {} })).status, 403);
      state = must(await call('/api/state', { session: editor }));
      assert.deepEqual(state.units.map(unit => unit.id), ['leste']);
      assert.deepEqual(state.sectors.map(sector => sector.id), ['rh']);
      assert.deepEqual(must(await call('/api/users', { session: editor })).users, []);
      assert.deepEqual(must(await call('/api/audit', { session: editor })).events, []);

      // ---- biblioteca: pasta e envio com todas as validações ------------------------------------------
      const folder = must(await call('/api/folders', { method: 'POST', session: editor, body: { unitId: 'leste', sectorId: 'rh', name: 'Comunicados' } }), 201);
      assert.equal((await call('/api/folders', { method: 'POST', session: editor, body: { unitId: 'centro', sectorId: 'rh', name: 'Fora do escopo' } })).status, 403);
      const upload = (name, extra = '', body = PNG, session = editor) => call(`/api/media?name=${name}&unitId=leste&sectorId=rh&folderId=${folder.id}${extra}`, { method: 'POST', session, body });
      assert.equal((await upload('evil.html')).status, 415, 'extensão não permitida');
      assert.equal((await upload('fake.png', '', Buffer.from('not png'))).status, 415, 'conteúdo que não é PNG');
      assert.equal((await upload('valid.png', `&title=${encodeURIComponent('a'.repeat(121))}`)).status, 400, 'título longo demais');
      assert.equal(readdirSync(path.join(dataDir, 'media')).length, 0, 'envio recusado não deixa arquivo órfão no disco');
      assert.equal((await call('/api/media?name=demo.png&unitId=centro&sectorId=rh', { method: 'POST', session: editor, body: PNG })).status, 403, 'outra unidade');
      const media = must(await upload('demo.png', '&title=Comunicado'), 201);
      assert.deepEqual([media.status, media.folderId], ['pending', folder.id]);
      const foreign = must(await call('/api/media?name=centro.png&unitId=centro&sectorId=rh', { method: 'POST', session: admin, body: PNG }), 201);
      assert.equal((await call(`/api/media/${foreign.id}/file`, { session: editor })).status, 403, 'arquivo de outra unidade');
      assert.equal(must(await call(`/api/library?unitId=leste&sectorId=rh&folderId=${folder.id}`, { session: editor })).media.length, 1);
      assert.equal((await call('/api/library?unitId=centro&sectorId=rh', { session: editor })).status, 403);

      // ---- aprovação ---------------------------------------------------------------------------------
      assert.equal((await call(`/api/media/${media.id}/approve`, { method: 'POST', session: editor, body: { acknowledgeUnscanned: true } })).status, 403, 'Editor não aprova');
      assert.equal((await call(`/api/media/${media.id}/approve`, { method: 'POST', session: admin, body: {} })).status, 409, 'sem antivírus, é preciso confirmar de forma explícita');

      // ---- TV: cadastro e pareamento de uso único ------------------------------------------------------
      const created = must(await call('/api/displays', { method: 'POST', session: admin, body: { name: 'TV RH', unitId: 'leste', sectorId: 'rh' } }), 201);
      const display = created.display;
      const paired = must(await call('/api/player/pair', { method: 'POST', body: { code: created.pairingCode } }));
      const token = paired.token;
      assert.equal((await call('/api/player/pair', { method: 'POST', body: { code: created.pairingCode } })).status, 400, 'o código de pareamento só vale uma vez');
      assert.equal((await call(`/api/media/${media.id}/file`, { token })).status, 403, 'a TV não recebe arquivo não aprovado');

      // ---- playlist, versão publicada e programação ----------------------------------------------------
      const body = { name: 'Comunicados', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: media.id }] };
      const playlist = must(await call('/api/playlists', { method: 'POST', session: admin, body }), 201);
      assert.equal(playlist.items[0].readiness, 'pending', 'o rascunho aceita arquivo pendente, mas ele ainda não está liberado');
      const early = await call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: admin, body: { rev: playlist.draftRev } });
      assert.deepEqual([early.status, early.data.code], [409, 'MEDIA_NOT_READY'], 'versão publicada só com arquivos aprovados');
      must(await call(`/api/media/${media.id}/approve`, { method: 'POST', session: admin, body: { acknowledgeUnscanned: true } }));
      assert.equal(must(await call('/api/player/manifest', { token })).items.length, 0, 'rascunho não vai ao ar');
      must(await call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: admin, body: { rev: playlist.draftRev } }), 201);
      const endAt = new Date(Date.now() + 30000).toISOString();
      const schedule = await kit.liveSchedule(admin, { playlistId: playlist.id, displayIds: [display.id], endAt, name: 'Comunicados da semana' });
      const manifest = must(await call('/api/player/manifest', { token }));
      assert.equal(manifest.items.length, 1);
      assert.equal(manifest.validUntil, endAt, 'o manifesto nunca vale além do término da programação');
      assert.equal((await call(`/api/media/${media.id}/file`, { token })).status, 200);
      assert.equal((await call('/api/player/heartbeat', { method: 'POST', token, body: {} })).status, 200);

      // ---- interromper, desativar, revogar ------------------------------------------------------------
      must(await call(`/api/schedules/${schedule.id}/stop`, { method: 'POST', session: admin, body: {} }));
      assert.equal(must(await call('/api/player/manifest', { token })).items.length, 0, 'programação interrompida: a TV fica sem conteúdo');
      assert.equal((await call(`/api/media/${media.id}/file`, { token })).status, 403, 'e deixa de poder baixar o arquivo');
      must(await call(`/api/users/${editorAccount.user.id}`, { method: 'PATCH', session: admin, body: { active: false } }));
      assert.equal((await call('/api/state', { session: editor })).status, 401, 'conta desativada perde a sessão');
      assert.equal((await call(`/api/users/${setup.data.user.id}`, { method: 'PATCH', session: admin, body: { active: false } })).status, 409, 'o último administrador não sai');
      must(await call(`/api/displays/${display.id}`, { method: 'DELETE', session: admin }));
      assert.equal((await call('/api/player/manifest', { token })).status, 401, 'TV removida perde a credencial na hora');

      // ---- o que o painel enxerga no final --------------------------------------------------------------
      state = must(await call('/api/state', { session: admin }));
      const events = must(await call('/api/audit?limit=500', { session: admin })).events;
      assert.ok(events.length >= 10);
      assert.ok(events.every(event => event.hash.length === 64));
      const everything = JSON.stringify([state, must(await call('/api/users', { session: admin })), must(await call('/api/displays?unitId=leste&sectorId=rh', { session: admin }))]);
      assert.ok(!/"password"|tokenHash|token_hash|pairHash|pair_hash/.test(everything), 'nenhuma senha, hash ou credencial de TV chega ao navegador');
      assert.ok(!everything.includes(token), 'o token da TV nunca volta pela API');

      // ---- reinício: tudo continua lá, inclusive as sessões --------------------------------------------
      await app.close();
      app = createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger });
      api = http ? await listenOnFreePort(app) : (await import('./helpers/http.mjs')).apiClient(app);
      assert.equal(must(await call('/api/status')).configured, true);
      assert.equal((await call('/api/me', { session: admin })).status, 200, 'a sessão do administrador sobrevive ao reinício');
      const afterRestart = must(await call(`/api/library?unitId=leste&sectorId=rh&folderId=${folder.id}`, { session: admin }));
      assert.deepEqual(afterRestart.media.map(item => item.id), [media.id]);
      assert.equal(must(await call('/api/library?unitId=centro&sectorId=rh', { session: admin })).media.length, 1);
    } finally {
      await app.close();
      removeTempDir(dataDir);
    }
  });
}
