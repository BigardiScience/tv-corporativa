import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withApp, must } from './helpers/app.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const listDisplays = (kit, session = kit.admin, query = 'unitId=leste&sectorId=rh') => kit.call(`/api/displays?${query}`, { session }).then(r => must(r).displays);
const pair = (kit, code, remoteAddress) => kit.call('/api/player/pair', { method: 'POST', body: { code }, remoteAddress });

test('TV: somente Administrador cadastra/ativa e TVs pendentes legadas continuam ativáveis', async () => {
  await withApp(async kit => {
    const created = await kit.display(kit.admin, { name: 'TV Recepção' });
    assert.match(created.pairingCode, /^\d{6}$/);
    assert.deepEqual(
      [created.display.status, created.display.connection, created.display.paired, created.display.pairingOpen, created.display.createdBy, created.display.activatedBy],
      ['active', 'offline', false, true, kit.adminUser.id, kit.adminUser.id]);
    const minutes = (Date.parse(created.expiresAt) - Date.now()) / 60000;
    assert.ok(minutes > 9 && minutes <= 10, `o código vale ~10 minutos (${minutes.toFixed(2)})`);

    const editor = await kit.createUser('editor'), manager = await kit.createUser('manager');
    for (const person of [editor,manager]) assert.equal((await kit.call('/api/displays',{method:'POST',session:person.session,body:{name:'TV não autorizada',unitId:'leste',sectorId:'rh'}})).status,403);
    const mine = await kit.display(kit.admin, { name: 'TV legada pendente' });
    kit.app.db.prepare("UPDATE displays SET status='pending',activated_at=NULL,activated_by=NULL,created_by=?,pair_hash=NULL,pair_expires=NULL WHERE id=?").run(editor.user.id,mine.display.id);
    assert.equal((await kit.call(`/api/displays/${mine.display.id}/activate`, { method: 'POST', session: editor.session })).status, 403, 'quem cadastra não se auto-aprova');
    assert.equal((await kit.call(`/api/displays/${mine.display.id}/pairing`, { method: 'POST', session: editor.session })).status, 403);
    assert.deepEqual(await kit.call(`/api/displays/${mine.display.id}/pairing`, { method: 'POST', session: kit.admin }).then(r => [r.status, r.data.code]), [409, 'NOT_ACTIVE'], 'TV pendente não gera código');

    assert.equal((await kit.call(`/api/displays/${mine.display.id}/activate`,{method:'POST',session:manager.session})).status,403);
    const activated = must(await kit.call(`/api/displays/${mine.display.id}/activate`, { method: 'POST', session: kit.admin }));
    assert.deepEqual([activated.display.status, activated.display.activatedBy, activated.display.createdBy], ['active', kit.adminUser.id, editor.user.id], 'ficam registrados quem cadastrou e quem ativou');
    assert.match(activated.pairingCode, /^\d{6}$/);
    assert.equal((await kit.call(`/api/displays/${mine.display.id}/activate`, { method: 'POST', session: kit.admin })).data.code, 'ALREADY_ACTIVE');

    const post = body => kit.call('/api/displays', { method: 'POST', session: kit.admin, body });
    for (const bad of [{ name: '' }, { name: 'x'.repeat(121) }, { unitId: 'nao-existe' }, { sectorId: 'nao-existe' }, { unitId: 'a/b' }, { name: undefined }]) {
      assert.equal((await post({ unitId: 'leste', sectorId: 'rh', name: 'TV', ...bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await kit.call('/api/displays', { method: 'POST', session: editor.session, body: { name: 'Fora do escopo', unitId: 'centro', sectorId: 'rh' } })).status, 403);
    assert.equal((await kit.call('/api/displays/nao-existe/activate', { method: 'POST', session: kit.admin })).status, 404);
    const events = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events.filter(e => e.action.startsWith('device.')).map(e => [e.action, e.detail.status ?? e.detail.registeredBy ?? null]);
    assert.ok(events.some(([action, extra]) => action === 'device.created' && extra === 'active'));
    assert.ok(events.some(([action, extra]) => action === 'device.activated' && extra === editor.user.id), 'a ativação registra quem havia cadastrado');
  });
});

test('pareamento: formato do código, uso único e credencial guardada somente como hash', async () => {
  await withApp(async kit => {
    const created = await kit.display(kit.admin, { name: 'TV 1' });
    // (limite de 6 tentativas por endereço: 3 malformadas + 1 errada + 1 válida + 1 reutilização)
    for (const bad of ['12345', 'abcdef', null]) {
      const response = await pair(kit, bad);
      assert.deepEqual([response.status, response.data.error], [400, 'Código de pareamento inválido.'], JSON.stringify(bad));
    }
    const wrong = created.pairingCode === '123456' ? '654321' : '123456';
    assert.deepEqual(await pair(kit, wrong).then(r => [r.status, r.data.error]), [400, 'Código inválido ou expirado. Solicite outro à TI.']);
    const before = kit.app.db.prepare('SELECT pair_hash, token_hash FROM displays WHERE id=?').get(created.display.id);
    assert.deepEqual([before.pair_hash, before.token_hash], [sha(created.pairingCode), null], 'só o hash do código fica no banco');

    const paired = must(await pair(kit, created.pairingCode));
    assert.match(paired.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.deepEqual([paired.display.id, paired.display.paired, paired.display.pairingOpen, paired.display.connection], [created.display.id, true, false, 'online']);
    const after = kit.app.db.prepare('SELECT pair_hash, pair_expires, token_hash FROM displays WHERE id=?').get(created.display.id);
    assert.deepEqual([after.pair_hash, after.pair_expires, after.token_hash], [null, null, sha(paired.token)], 'código é consumido; a credencial é guardada como hash');
    assert.equal((await pair(kit, created.pairingCode)).status, 400, 'código de uso único');
    const everything = JSON.stringify([await listDisplays(kit), must(await kit.call('/api/state', { session: kit.admin })), must(await kit.call('/api/audit?limit=200', { session: kit.admin }))]);
    assert.ok(!everything.includes(paired.token) && !everything.includes(sha(paired.token)), 'nenhuma resposta traz a credencial da TV nem o seu hash');
    const audit = must(await kit.call('/api/audit?limit=200', { session: kit.admin })).events.find(e => e.action === 'device.paired');
    assert.deepEqual([audit.actor, audit.unitId, audit.sectorId], [`player:${created.display.id}`, 'leste', 'rh']);
  });
});

test('pareamento: código expirado é recusado e a renovação invalida a credencial anterior', async () => {
  await withApp(async kit => {
    const created = await kit.display(kit.admin, { name: 'TV 1' });
    kit.app.db.prepare('UPDATE displays SET pair_expires=? WHERE id=?').run(Date.now() - 1000, created.display.id);
    assert.equal((await pair(kit, created.pairingCode)).status, 400, 'expirou');
    assert.equal((await listDisplays(kit))[0].pairingOpen, false);

    const renewed = must(await kit.call(`/api/displays/${created.display.id}/pairing`, { method: 'POST', session: kit.admin }));
    assert.notEqual(renewed.pairingCode, created.pairingCode);
    const first = must(await pair(kit, renewed.pairingCode));
    assert.equal((await kit.call('/api/player/manifest', { token: first.token })).status, 200);
    // Novo código: a TV precisa parear de novo e a credencial antiga morre na hora.
    const again = must(await kit.call(`/api/displays/${created.display.id}/pairing`, { method: 'POST', session: kit.admin }));
    assert.equal((await kit.call('/api/player/manifest', { token: first.token })).status, 401);
    assert.equal((await listDisplays(kit))[0].paired, false);
    const second = must(await pair(kit, again.pairingCode));
    assert.notEqual(second.token, first.token);
    assert.equal((await kit.call('/api/player/manifest', { token: second.token })).status, 200);
    assert.equal((await kit.call('/api/player/manifest', { token: first.token })).status, 401);
  });
});

test('pareamento: tentativas limitadas por endereço (6 em 15 minutos), sem travar outras TVs', async () => {
  await withApp(async kit => {
    const created = await kit.display(kit.admin, { name: 'TV 1' });
    for (let attempt = 1; attempt <= 6; attempt++) assert.equal((await pair(kit, '000000')).status, 400, `tentativa ${attempt}`);
    const blocked = await pair(kit, created.pairingCode);
    assert.equal(blocked.status, 429, 'depois do limite, até o código certo é recusado');
    assert.equal(kit.app.db.prepare('SELECT token_hash FROM displays WHERE id=?').get(created.display.id).token_hash, null);
    assert.equal((await pair(kit, created.pairingCode, '10.20.30.40')).status, 200, 'outro endereço não é afetado');
  });
});

test('estado de conexão: online só com comunicação recente; pendente é "inativa"', async () => {
  await withApp(async kit => {
    const tv = await kit.pairedDisplay(kit.admin, { name: 'TV 1' });
    const pending = await kit.display(kit.admin, { name: 'TV pendente' });
    kit.app.db.prepare("UPDATE displays SET status='pending' WHERE id=?").run(pending.display.id);
    const connection = async id => (await listDisplays(kit)).find(d => d.id === id).connection;
    const seen = ms => kit.app.db.prepare('UPDATE displays SET last_seen=? WHERE id=?').run(new Date(Date.now() - ms).toISOString(), tv.display.id);
    assert.equal(await connection(tv.display.id), 'online', 'acabou de parear');
    seen(89000); assert.equal(await connection(tv.display.id), 'online');
    seen(91000); assert.equal(await connection(tv.display.id), 'offline');
    const beat = must(await kit.call('/api/player/heartbeat', { method: 'POST', token: tv.token, body: {} }));
    assert.equal(beat.ok, true); assert.ok(Math.abs(Date.parse(beat.serverTime) - Date.now()) < 5000);
    assert.equal(await connection(tv.display.id), 'online');
    assert.equal(await connection(pending.display.id), 'inactive');
    kit.app.db.prepare('UPDATE displays SET last_seen=? WHERE id=?').run(new Date().toISOString(), pending.display.id);
    assert.equal(await connection(pending.display.id), 'inactive', 'cadastrada não é o mesmo que online');
  });
});

test('renomear TV: exige permissão, valida o nome e registra a mudança', async () => {
  await withApp(async kit => {
    const tv = await kit.display(kit.admin, { name: 'TV antiga' });
    const rename = (id, name, session = kit.admin) => kit.call(`/api/displays/${id}`, { method: 'PATCH', session, body: { name } });
    assert.equal(must(await rename(tv.display.id, '  TV nova  ')).name, 'TV nova');
    for (const bad of ['', '   ', 'x'.repeat(121), null, 7]) assert.equal((await rename(tv.display.id, bad)).status, 400, JSON.stringify(bad));
    const editor = await kit.createUser('editor'), granted = await kit.createUser('editor');
    const legacy=kit.app.services.users.byId(granted.user.id);legacy.grants=['screen:update'];
    kit.app.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
    assert.equal((await rename(tv.display.id, 'Invasão', editor.session)).status, 403);
    assert.equal((await rename(tv.display.id, 'Com permissão extra', granted.session)).status, 403);
    assert.equal((await rename('nao-existe', 'X')).status, 404);
    const events = must(await kit.call('/api/audit?limit=50', { session: kit.admin })).events.filter(e => e.action === 'device.renamed');
    assert.deepEqual(events.map(e => [e.detail.from, e.detail.to]).reverse(), [['TV antiga', 'TV nova']]);
  });
});

test('remover (revogar) TV: credencial morre e vínculos são suspensos preservando histórico', async () => {
  await withApp(async kit => {
    const [a, b] = [await kit.approvedMedia(kit.admin, { name: 'a.png' }), await kit.approvedMedia(kit.admin, { name: 'b.png' })];
    const [playlistA, playlistB] = [await kit.publishedPlaylist(kit.admin, [a.id], { name: 'A' }), await kit.publishedPlaylist(kit.admin, [b.id], { name: 'B' })];
    const tv1 = await kit.pairedDisplay(kit.admin, { name: 'TV 1' }), tv2 = await kit.pairedDisplay(kit.admin, { name: 'TV 2' });
    const alone = await kit.liveSchedule(kit.admin, { playlistId: playlistA.id, displayIds: [tv1.display.id], name: 'Só TV 1' });
    const shared = await kit.liveSchedule(kit.admin, { playlistId: playlistB.id, displayIds: [tv1.display.id, tv2.display.id], name: 'As duas' });
    const draft = must(await kit.call('/api/schedules', { method: 'POST', session: kit.admin, body: { name: 'Rascunho', unitId: 'leste', sectorId: 'rh', playlistId: playlistA.id, displayIds: [tv1.display.id] } }), 201);
    const editor = await kit.createUser('editor'), manager = await kit.createUser('manager');
    assert.equal((await kit.call(`/api/displays/${tv1.display.id}`, { method: 'DELETE', session: editor.session })).status, 403);
    const idsFor = async tv => (await kit.call('/api/player/manifest', { token: tv.token })).data.items.map(item => item.id);
    assert.deepEqual(await idsFor(tv1), [a.id, b.id]);
    assert.deepEqual(await idsFor(tv2), [b.id]);

    assert.equal((await kit.call(`/api/displays/${tv1.display.id}`, { method: 'DELETE', session: manager.session })).status,403);
    must(await kit.call(`/api/displays/${tv1.display.id}`, { method: 'DELETE', session: kit.admin }));
    for (const [route, method] of [['/api/player/manifest', 'GET'], ['/api/player/heartbeat', 'POST'], [`/api/media/${a.id}/file`, 'GET']]) {
      assert.equal((await kit.call(route, { method, token: tv1.token, body: method === 'POST' ? {} : undefined })).status, 401, route);
    }
    assert.deepEqual(await idsFor(tv2), [b.id], 'a outra TV não é afetada');
    const schedules = Object.fromEntries(must(await kit.call('/api/schedules?unitId=leste&sectorId=rh', { session: kit.admin })).schedules.map(s => [s.id, s]));
    assert.deepEqual([schedules[alone.id].status, schedules[alone.id].displayIds], ['published', [tv1.display.id]], 'programação preservada; transmissão suspensa');
    assert.deepEqual([schedules[shared.id].status, schedules[shared.id].displayIds], ['published', [tv1.display.id,tv2.display.id]]);
    assert.deepEqual([schedules[draft.id].status, schedules[draft.id].displayIds], ['draft', [tv1.display.id]]);
    for(const s of [alone,shared,draft])assert.equal(schedules[s.id].displays.find(d=>d.id===tv1.display.id).linkStatus,'suspended');
    assert.deepEqual((await listDisplays(kit)).map(d => d.id), [tv2.display.id]);
    assert.equal((await kit.call(`/api/displays/${tv1.display.id}`, { method: 'PATCH', session: kit.admin, body: { name: 'Fantasma' } })).status, 404);
    const events = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events;
    assert.ok(events.some(e => e.action === 'device.revoked' && e.detail.displayId === tv1.display.id));
    assert.ok(events.some(e => e.action === 'display.link.suspended' && e.detail.scheduleId === alone.id));
  });
});

test('credencial da TV só vale no lado da TV; credencial de pessoa não vale no lado da TV', async () => {
  await withApp(async kit => {
    const own = await kit.approvedMedia(kit.admin, { name: 'minha.png' });
    const foreign = await kit.approvedMedia(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'alheia.png' });
    const playlist = await kit.publishedPlaylist(kit.admin, [own.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    for (const headers of [{}, { Authorization: '' }, { Authorization: 'Bearer ' }, { Authorization: 'Bearer invalido' }, { Authorization: `Basic ${tv.token}` }, { Authorization: tv.token }]) {
      assert.equal((await kit.call('/api/player/manifest', { headers })).status, 401, JSON.stringify(headers));
    }
    assert.equal((await kit.call('/api/player/manifest', { session: kit.admin })).status, 401, 'cookie de administrador não abre o lado da TV');
    assert.equal((await kit.call('/api/player/heartbeat', { method: 'POST', session: kit.admin, body: {} })).status, 401);
    for (const route of ['/api/state', '/api/users', '/api/audit', '/api/displays?unitId=leste&sectorId=rh', '/api/library?unitId=leste&sectorId=rh', '/api/playlists?unitId=leste&sectorId=rh', '/api/schedules?unitId=leste&sectorId=rh']) {
      assert.equal((await kit.call(route, { token: tv.token })).status, 401, `${route} não aceita credencial de TV`);
    }
    assert.equal((await kit.call('/api/displays', { method: 'POST', token: tv.token, body: { name: 'X', unitId: 'leste', sectorId: 'rh' } })).status, 401);
    assert.equal((await kit.call(`/api/media/${own.id}/file`, { token: tv.token })).status, 200);
    assert.equal((await kit.call(`/api/media/${foreign.id}/file`, { token: tv.token })).status, 403, 'mídia de outra unidade');
    assert.equal((await kit.call('/api/media/nao-existe/file', { token: tv.token })).status, 404);
  });
});

test('manifesto da TV mantém o formato da versão 1.1.0 (acréscimos apenas)', async () => {
  await withApp(async kit => {
    const media = await kit.approvedMedia(kit.admin, { name: 'a.png', title: 'Comunicado' });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    const tv = await kit.pairedDisplay(kit.admin, { name: 'Recepção' });
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    const manifest = must(await kit.call('/api/player/manifest', { token: tv.token }));
    assert.deepEqual(Object.keys(manifest).sort(), ['display', 'generatedAt', 'items', 'loop', 'validUntil']);
    assert.deepEqual(Object.keys(manifest.items[0]).sort(), ['duration', 'durationMode', 'id', 'name', 'title', 'transition', 'transitionMs', 'type', 'url']);
    assert.deepEqual([manifest.items[0].title, manifest.items[0].name, manifest.items[0].type, manifest.items[0].url, manifest.items[0].duration], ['Comunicado', 'a.png', 'image/png', `/api/media/${media.id}/file`, 15]);
    assert.equal(manifest.display.name, 'Recepção');
    assert.ok(!Object.keys(manifest.display).some(key => /token|hash/i.test(key)));
    for (const field of ['generatedAt', 'validUntil']) assert.equal(new Date(manifest[field]).toISOString(), manifest[field]);
  });
});

test('lista de TVs respeita unidade e setor de quem consulta', async () => {
  await withApp(async kit => {
    await kit.display(kit.admin, { name: 'Leste RH' });
    await kit.display(kit.admin, { sectorId: 'ti', name: 'Leste TI' });
    await kit.display(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'Centro RH' });
    const names = displays => displays.map(d => d.name).sort();
    assert.deepEqual(names(await listDisplays(kit, kit.admin, '')), ['Centro RH', 'Leste RH', 'Leste TI']);
    assert.deepEqual(names(await listDisplays(kit, kit.admin, 'unitId=centro')), ['Centro RH']);
    assert.deepEqual(names(await listDisplays(kit, kit.admin, 'sectorId=ti')), ['Leste TI']);
    const scoped = await kit.createUser('manager', { unitIds: ['leste'], sectorIds: ['rh'] });
    assert.deepEqual(names(await listDisplays(kit, scoped.session, '')), ['Leste RH']);
    assert.deepEqual(names(await listDisplays(kit, scoped.session, 'unitId=centro')), [], 'filtrar por espaço alheio não revela nada');
    const wide = await kit.createUser('viewer', { unitIds: ['leste', 'centro'], sectorIds: ['rh'] });
    assert.deepEqual(names(await listDisplays(kit, wide.session, '')), ['Centro RH', 'Leste RH']);
    assert.equal((await kit.call('/api/displays?unitId=a/b', { session: kit.admin })).status, 400);
  });
});

test('defesa em profundidade: o banco alterado por fora não faz a TV receber arquivo de outro espaço nem usar credencial de TV não ativa', async () => {
  await withApp(async kit => {
    const own = await kit.approvedMedia(kit.admin, { name: 'minha.png', seed: 'dp1' });
    const foreign = await kit.approvedMedia(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'alheia.png', seed: 'dp2' });
    const playlist = await kit.publishedPlaylist(kit.admin, [own.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    assert.deepEqual(must(await kit.call('/api/player/manifest', { token: tv.token })).items.map(item => item.id), [own.id]);

    // Alguém com acesso ao arquivo do banco injeta, na versão publicada, um item de OUTRA unidade.
    const version = kit.app.db.prepare('SELECT v.id AS id FROM playlist_versions v WHERE v.playlist_id=?').get(playlist.id);
    kit.app.db.prepare(`INSERT INTO playlist_version_items(version_id, position, media_id, title, name, type, duration_s, transition, transition_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(version.id, 1, foreign.id, 'Alheia', 'alheia.png', 'image/png', 15, 'cut', 0);
    const injected = must(await kit.call('/api/player/manifest', { token: tv.token }));
    assert.deepEqual(injected.items.map(item => item.id), [own.id], 'o manifesto só entrega arquivos do espaço da própria TV');
    assert.equal((await kit.call(`/api/media/${foreign.id}/file`, { token: tv.token })).status, 403, 'e o download também é recusado');
    assert.equal((await kit.call(`/api/media/${own.id}/file`, { token: tv.token })).status, 200);

    // TV que volta a ficar "aguardando ativação" no banco perde o acesso mesmo que a credencial continue gravada.
    kit.app.db.prepare("UPDATE displays SET status='pending' WHERE id=?").run(tv.display.id);
    assert.equal((await kit.call('/api/player/manifest', { token: tv.token })).status, 401);
    assert.equal((await kit.call('/api/player/heartbeat', { method: 'POST', token: tv.token, body: {} })).status, 401);
    assert.equal((await kit.call(`/api/media/${own.id}/file`, { token: tv.token })).status, 401);
  });
});
