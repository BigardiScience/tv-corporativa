import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_PERMISSIONS, PERMISSION_IDS, effectivePermissions, inScope, requireScope, authorize, validatePermissionList } from '../server/domain/permissions.mjs';
import { inProcess } from './helpers/http.mjs';
import { withApp, must, PASSWORD } from './helpers/app.mjs';

let counter = 0;
const unique = prefix => `${prefix}-${++counter}`;
const isOk = status => status >= 200 && status < 300;

async function team(kit) {
  const manager = await kit.createUser('manager');
  const editor = await kit.createUser('editor');
  const viewer = await kit.createUser('viewer');
  const outsider = await kit.createUser('manager', { unitIds: ['centro'], sectorIds: ['seguranca'] });
  // Escopo parcial: a unidade certa com o setor errado, e o setor certo com a unidade errada. Ter só uma das metades não basta.
  const wrongSector = await kit.createUser('manager', { unitIds: ['leste'], sectorIds: ['seguranca'] });
  const wrongUnit = await kit.createUser('manager', { unitIds: ['centro'], sectorIds: ['rh'] });
  return { admin: { session: kit.admin }, manager, editor, viewer, outsider, wrongSector, wrongUnit };
}

// Cada operação cria seus próprios recursos (como Administrador) e é tentada por cada perfil.
const OPERATIONS = [
  { name: 'criar pasta', allowed: ['admin', 'manager', 'editor'],
    run: (k, s) => k.call('/api/folders', { method: 'POST', session: s, body: { unitId: 'leste', sectorId: 'rh', name: unique('Pasta') } }) },
  { name: 'renomear pasta', allowed: ['admin', 'manager', 'editor'], prepare: k => k.folder(k.admin),
    run: (k, s, f) => k.call(`/api/folders/${f.id}`, { method: 'PATCH', session: s, body: { name: unique('Renomeada') } }) },
  { name: 'excluir pasta', allowed: ['admin', 'manager'], prepare: k => k.folder(k.admin),
    run: (k, s, f) => k.call(`/api/folders/${f.id}`, { method: 'DELETE', session: s }) },
  { name: 'enviar arquivo', allowed: ['admin', 'manager', 'editor'],
    run: (k, s) => k.call(`/api/media?name=${unique('envio')}.png&unitId=leste&sectorId=rh`, { method: 'POST', session: s, body: k.png(unique('bytes')) }) },
  { name: 'renomear arquivo', allowed: ['admin', 'manager', 'editor'], prepare: k => k.upload(k.admin),
    run: (k, s, m) => k.call(`/api/media/${m.id}`, { method: 'PATCH', session: s, body: { title: unique('Título') } }) },
  { name: 'excluir arquivo', allowed: ['admin', 'manager'], prepare: k => k.upload(k.admin),
    run: (k, s, m) => k.call(`/api/media/${m.id}`, { method: 'DELETE', session: s }) },
  { name: 'aprovar arquivo', allowed: ['admin', 'manager'], prepare: k => k.upload(k.admin),
    run: (k, s, m) => k.call(`/api/media/${m.id}/approve`, { method: 'POST', session: s, body: { acknowledgeUnscanned: true } }) },
  { name: 'rejeitar arquivo', allowed: ['admin', 'manager'], prepare: k => k.upload(k.admin),
    run: (k, s, m) => k.call(`/api/media/${m.id}/reject`, { method: 'POST', session: s, body: {} }) },
  { name: 'criar playlist', allowed: ['admin', 'manager', 'editor'],
    run: (k, s) => k.call('/api/playlists', { method: 'POST', session: s, body: { name: unique('PL'), unitId: 'leste', sectorId: 'rh' } }) },
  { name: 'editar rascunho da playlist', allowed: ['admin', 'manager', 'editor'], prepare: k => k.playlist(k.admin),
    run: (k, s, p) => k.call(`/api/playlists/${p.id}`, { method: 'PATCH', session: s, body: { name: unique('PL'), rev: p.draftRev } }) },
  { name: 'publicar versão da playlist', allowed: ['admin', 'manager'],
    prepare: async k => { const m = await k.approvedMedia(k.admin); return k.playlist(k.admin, { items: [{ mediaId: m.id }] }); },
    run: (k, s, p) => k.call(`/api/playlists/${p.id}/publish`, { method: 'POST', session: s, body: { rev: p.draftRev } }) },
  { name: 'excluir playlist', allowed: ['admin', 'manager'], prepare: k => k.playlist(k.admin),
    run: (k, s, p) => k.call(`/api/playlists/${p.id}`, { method: 'DELETE', session: s }) },
  { name: 'criar programação (rascunho)', allowed: ['admin', 'manager', 'editor'],
    prepare: async k => { const m = await k.approvedMedia(k.admin); return { playlist: await k.publishedPlaylist(k.admin, [m.id]), display: (await k.display(k.admin)).display }; },
    run: (k, s, { playlist, display }) => k.call('/api/schedules', { method: 'POST', session: s, body: { name: unique('Prog'), unitId: 'leste', sectorId: 'rh', playlistId: playlist.id, displayIds: [display.id] } }) },
  { name: 'publicar programação', allowed: ['admin', 'manager', 'editor'],
    prepare: async k => {
      const m = await k.approvedMedia(k.admin), playlist = await k.publishedPlaylist(k.admin, [m.id]), tv = await k.display(k.admin);
      return must(await k.call('/api/schedules', { method: 'POST', session: k.admin, body: { name: unique('Prog'), unitId: 'leste', sectorId: 'rh', playlistId: playlist.id, displayIds: [tv.display.id] } }), 201);
    },
    run: (k, s, schedule) => k.call(`/api/schedules/${schedule.id}/publish`, { method: 'POST', session: s, body: {} }) },
  { name: 'interromper programação', allowed: ['admin', 'manager', 'editor'],
    prepare: async k => {
      const m = await k.approvedMedia(k.admin), playlist = await k.publishedPlaylist(k.admin, [m.id]), tv = await k.display(k.admin);
      return k.liveSchedule(k.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    },
    run: (k, s, schedule) => k.call(`/api/schedules/${schedule.id}/stop`, { method: 'POST', session: s }) },
  { name: 'cadastrar TV', allowed: ['admin'],
    run: (k, s) => k.call('/api/displays', { method: 'POST', session: s, body: { name: unique('TV'), unitId: 'leste', sectorId: 'rh' } }) },
  { name: 'ativar TV', allowed: ['admin'], prepare: k => k.display(k.admin),
    run: async (k, s, pending) => {
      k.app.db.prepare("UPDATE displays SET status='pending',pair_hash=NULL,pair_expires=NULL WHERE id=?").run(pending.display.id);
      return k.call(`/api/displays/${pending.display.id}/activate`, { method: 'POST', session: s });
    } },
  { name: 'renomear TV', allowed: ['admin'], prepare: k => k.display(k.admin),
    run: (k, s, tv) => k.call(`/api/displays/${tv.display.id}`, { method: 'PATCH', session: s, body: { name: unique('TV') } }) },
  { name: 'renovar pareamento da TV', allowed: ['admin'], prepare: k => k.display(k.admin),
    run: (k, s, tv) => k.call(`/api/displays/${tv.display.id}/pairing`, { method: 'POST', session: s }) },
  { name: 'gerar código de pareamento (permissão própria, sem desconectar a TV)', allowed: ['admin', 'manager', 'editor'], prepare: k => k.display(k.admin),
    run: (k, s, tv) => k.call(`/api/displays/${tv.display.id}/pairing-code`, { method: 'POST', session: s }) },
  { name: 'revogar TV', allowed: ['admin'], prepare: k => k.display(k.admin),
    run: (k, s, tv) => k.call(`/api/displays/${tv.display.id}`, { method: 'DELETE', session: s }) },
  { name: 'criar usuário', allowed: ['admin'],
    run: (k, s) => k.call('/api/users', { method: 'POST', session: s, body: { name: 'Novo', email: `${unique('novo')}@example.invalid`, password: PASSWORD, role: 'viewer', unitIds: ['leste'], sectorIds: ['rh'] } }) },
  { name: 'criar unidade (configuração global)', allowed: ['admin'],
    run: (k, s) => k.call('/api/units', { method: 'POST', session: s, body: { name: unique('Unidade') } }) }
];

test('matriz de permissões por perfil é aplicada no BACKEND em todas as operações', async () => {
  await withApp(async kit => {
    const people = await team(kit);
    const session = role => people[role].session;
    for (const operation of OPERATIONS) {
      for (const role of ['admin', 'manager', 'editor', 'viewer']) {
        const target = operation.prepare ? await operation.prepare(kit) : undefined;
        const response = await operation.run(kit, session(role), target);
        const expected = operation.allowed.includes(role);
        assert.ok(expected ? isOk(response.status) : response.status === 403,
          `${operation.name} como ${role}: esperado ${expected ? '2xx' : '403'}, recebido ${response.status} ${JSON.stringify(response.data)}`);
      }
      // Quem é de outra unidade/setor nunca consegue agir sobre este espaço, nem com perfil de Gestor.
      const target = operation.prepare ? await operation.prepare(kit) : undefined;
      const foreign = await operation.run(kit, session('outsider'), target);
      assert.equal(foreign.status, 403, `${operation.name} por Gestor de OUTRA unidade/setor: recebido ${foreign.status} ${JSON.stringify(foreign.data)}`);
      for (const partial of ['wrongSector', 'wrongUnit']) {
        const again = operation.prepare ? await operation.prepare(kit) : undefined;
        const denied = await operation.run(kit, session(partial), again);
        assert.equal(denied.status, 403, `${operation.name} por Gestor com escopo PARCIAL (${partial}): recebido ${denied.status} ${JSON.stringify(denied.data)}`);
      }
    }
  });
});

test('listas e consultas respeitam unidade e setor; identificadores de outro escopo não vazam dados', async () => {
  await withApp(async kit => {
    const { outsider, editor } = await team(kit);
    const folder = await kit.folder(kit.admin), media = await kit.approvedMedia(kit.admin, { folderId: folder.id });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    const schedule = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    for (const route of ['/api/library?unitId=leste&sectorId=rh', '/api/folders?unitId=leste&sectorId=rh', '/api/playlists?unitId=leste&sectorId=rh',
      '/api/schedules?unitId=leste&sectorId=rh', `/api/folders/${folder.id}`, `/api/media/${media.id}`, `/api/media/${media.id}/file`,
      `/api/playlists/${playlist.id}`, `/api/playlists/${playlist.id}/versions/1`, `/api/schedules/${schedule.id}`]) {
      assert.equal((await kit.call(route, { session: outsider.session })).status, 403, route);
      assert.equal((await kit.call(route, { session: editor.session })).status, 200, route);
    }
    // Lista de TVs e estado: cada pessoa vê somente o que é do seu escopo.
    assert.equal(must(await kit.call('/api/displays', { session: outsider.session })).displays.length, 0);
    assert.equal(must(await kit.call('/api/displays', { session: editor.session })).displays.length, 1);
    const state = must(await kit.call('/api/state', { session: outsider.session }));
    assert.deepEqual(state.units.map(x => x.id), ['centro']);
    assert.deepEqual(state.sectors.map(x => x.id), ['seguranca']);
    // Mover para pasta/lote de outro espaço, ou montar playlist/programação cruzando espaços, é recusado.
    const foreignFolder = await kit.folder(outsider.session, { unitId: 'centro', sectorId: 'seguranca', name: 'Alheia' });
    assert.equal((await kit.call(`/api/media/${media.id}`, { method: 'PATCH', session: kit.admin, body: { folderId: foreignFolder.id } })).status, 400);
    assert.equal((await kit.call(`/api/folders/${folder.id}`, { method: 'PATCH', session: kit.admin, body: { parentId: foreignFolder.id } })).status, 400);
    const foreignMedia = await kit.upload(outsider.session, { unitId: 'centro', sectorId: 'seguranca' });
    assert.equal((await kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { name: 'Mistura', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: foreignMedia.id }] } })).status, 400);
    assert.equal((await kit.call('/api/schedules', { method: 'POST', session: kit.admin, body: { name: 'Mistura', unitId: 'centro', sectorId: 'seguranca', playlistId: playlist.id, displayIds: [] } })).status, 400);
    assert.equal((await kit.call('/api/library/batch', { method: 'POST', session: kit.admin, body: { action: 'move', mediaIds: [media.id, foreignMedia.id], targetFolderId: null } })).status, 400);
  });
});

test('permissões individuais: conceder e retirar por pessoa, com escopo preservado', async () => {
  await withApp(async kit => {
    const media = await kit.approvedMedia(kit.admin);
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    const tv = await kit.display(kit.admin);
    const body = { name: 'Prog', unitId: 'leste', sectorId: 'rh', playlistId: playlist.id, displayIds: [tv.display.id] };

    // Quem só deve preparar rascunhos: Editor com a publicação retirada (o padrão do Editor, desde a 2.3.0, é programar e publicar).
    const scheduler = await kit.createUser('editor', { revokes: ['schedule:publish'] });
    const draft = must(await kit.call('/api/schedules', { method: 'POST', session: scheduler.session, body }), 201);
    assert.equal(draft.status, 'draft');
    assert.equal((await kit.call('/api/schedules', { method: 'POST', session: scheduler.session, body: { ...body, publish: true } })).status, 403, 'criar não implica publicar');
    assert.equal((await kit.call(`/api/schedules/${draft.id}/publish`, { method: 'POST', session: scheduler.session, body: {} })).status, 403);
    assert.deepEqual([scheduler.user.grants, scheduler.user.revokes], [[], ['schedule:publish']]);
    assert.ok(scheduler.user.permissions.includes('schedule:create') && !scheduler.user.permissions.includes('schedule:publish'));

    // Publicar versões de playlist continua sendo concessão individual (não está no padrão do Editor); programar e publicar programações está.
    const publisher = await kit.createUser('editor', { grants: ['playlist:publish'] });
    must(await kit.call(`/api/schedules/${draft.id}/publish`, { method: 'POST', session: publisher.session, body: {} }));
    const pl2 = await kit.playlist(kit.admin, { items: [{ mediaId: media.id }] });
    must(await kit.call(`/api/playlists/${pl2.id}/publish`, { method: 'POST', session: publisher.session, body: { rev: pl2.draftRev } }), 201);

    const cautious = await kit.createUser('manager', { revokes: ['media:delete', 'media:approve'] });
    const doomed = await kit.upload(kit.admin);
    assert.equal((await kit.call(`/api/media/${doomed.id}`, { method: 'DELETE', session: cautious.session })).status, 403);
    assert.equal((await kit.call(`/api/media/${doomed.id}/approve`, { method: 'POST', session: cautious.session, body: { acknowledgeUnscanned: true } })).status, 403);
    assert.equal((await kit.call('/api/folders', { method: 'POST', session: cautious.session, body: { unitId: 'leste', sectorId: 'rh', name: 'Ainda pode' } })).status, 201);
    assert.ok(!cautious.user.permissions.includes('media:delete') && cautious.user.permissions.includes('folder:delete'));

    const uploader = await kit.createUser('viewer', { grants: ['media:upload'] });
    must(await kit.call('/api/media?name=x.png&unitId=leste&sectorId=rh', { method: 'POST', session: uploader.session, body: kit.png('viewer-upload') }), 201);
    assert.equal((await kit.call('/api/media?name=y.png&unitId=centro&sectorId=seguranca', { method: 'POST', session: uploader.session, body: kit.png('fora') })).status, 403, 'permissão não amplia o escopo');
  });
});

test('permissões efetivas dos perfis seguem o catálogo e o catálogo é exposto à interface', async () => {
  await withApp(async kit => {
    const people = await team(kit);
    for (const role of ['manager', 'editor', 'viewer']) {
      const me = must(await kit.call('/api/me', { session: people[role].session })).user;
      assert.deepEqual(me.permissions, [...ROLE_PERMISSIONS[role]].sort(), role);
    }
    assert.deepEqual(must(await kit.call('/api/me', { session: kit.admin })).user.permissions, [...PERMISSION_IDS].sort());
    const catalog = must(await kit.call('/api/permissions', { session: people.editor.session }));
    assert.deepEqual(catalog.permissions.map(item => item.id).sort(), [...PERMISSION_IDS].sort());
    assert.equal(catalog.manageableRoles.manager, undefined);
    for (const id of ['screen:create', 'screen:activate', 'screen:update', 'screen:delete', 'playlist:create', 'playlist:update', 'playlist:publish', 'schedule:create', 'schedule:publish', 'user:manage', 'audit:read']) {
      assert.ok(PERMISSION_IDS.includes(id), `permissão exigida pelo requisito: ${id}`);
    }
  });
});

test('Gestor, Editor e Visualizador não gerenciam contas, permissões ou senhas; Administração centralizada', async () => {
  await withApp(async kit => {
    const people=await team(kit);
    const target=await kit.createUser('editor');
    for(const role of ['manager','editor','viewer']) {
      const session=people[role].session;
      assert.deepEqual(must(await kit.call('/api/users',{session})).users,[]);
      const create=await kit.call('/api/users',{method:'POST',session,body:{name:'Nova pessoa',email:role+'-new@example.invalid',password:PASSWORD,role:'viewer',unitIds:['leste'],sectorIds:['rh']}});
      assert.equal(create.status,403,role+' criar');
      for(const body of [{name:'Alterado'},{active:false},{role:'admin'},{unitIds:['centro']},{grants:['schedule:create']},{password:PASSWORD}]) {
        assert.equal((await kit.call('/api/users/'+target.user.id,{method:'PATCH',session,body})).status,403,role+' '+JSON.stringify(body));
      }
    }
    assert.equal((await kit.login(target.email,PASSWORD)).status,200,'negações não alteram a conta');
    must(await kit.call('/api/users/'+target.user.id,{method:'PATCH',session:kit.admin,body:{name:'Editor renomeado',grants:['playlist:publish']}}));
    assert.equal((await kit.call('/api/me',{session:target.session})).status,401,'alteração administrativa revoga sessões');
    const updated=kit.app.services.users.byId(target.user.id);
    assert.equal(updated.name,'Editor renomeado');
    assert.deepEqual(updated.grants,['playlist:publish']);
  });
});

test('Administrador: concede permissões a qualquer perfil e nunca fica sem administrador ativo', async () => {
  await withApp(async kit => {
    const editor = await kit.createUser('editor');
    assert.equal((await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { grants: ['settings:manage'] } })).status, 400);
    assert.equal((await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { grants: ['inexistente:acao'] } })).status, 400);
    assert.equal((await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { grants: ['playlist:publish'], revokes: ['playlist:publish'] } })).status, 400);
    const granted = must(await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { grants: ['audit:read', 'playlist:publish'], revokes: ['media:update'] } }));
    assert.deepEqual([granted.grants, granted.revokes], [['audit:read', 'playlist:publish'], ['media:update']]);
    // Último administrador: não pode ser desativado nem rebaixado.
    assert.equal((await kit.call(`/api/users/${kit.adminUser.id}`, { method: 'PATCH', session: kit.admin, body: { active: false } })).status, 409);
    assert.equal((await kit.call(`/api/users/${kit.adminUser.id}`, { method: 'PATCH', session: kit.admin, body: { role: 'manager' } })).status, 409);
    const second = await kit.createUser('admin', { unitIds: [], sectorIds: [] });
    assert.equal((await kit.call(`/api/users/${second.user.id}`, { method: 'PATCH', session: kit.admin, body: { active: false } })).status, 200);
  });
});

test('auditoria: Administrador vê tudo; quem tem audit:read vê só o próprio escopo; os demais nada', async () => {
  await withApp(async kit => {
    const { manager, editor, viewer } = await team(kit);
    const mine = await kit.upload(kit.admin), theirs = await kit.upload(kit.admin, { unitId: 'centro', sectorId: 'seguranca' });
    const sameUnitOtherSector = await kit.upload(kit.admin, { sectorId: 'seguranca' }), otherUnitSameSector = await kit.upload(kit.admin, { unitId: 'centro', sectorId: 'rh' });
    await kit.approve(kit.admin, mine.id);
    const adminEvents = must(await kit.call('/api/audit', { session: kit.admin })).events;
    assert.ok(adminEvents.some(e => e.action === 'auth.login') && adminEvents.some(e => e.unitId === 'centro'));
    const managerEvents = must(await kit.call('/api/audit', { session: manager.session })).events;
    assert.ok(managerEvents.length >= 2);
    assert.ok(managerEvents.every(e => e.unitId === 'leste' && e.sectorId === 'rh'), 'somente eventos do escopo');
    assert.ok(managerEvents.some(e => e.action === 'media.uploaded' && e.detail.mediaId === mine.id));
    assert.ok(!managerEvents.some(e => e.detail?.mediaId === theirs.id));
    for (const hidden of [sameUnitOtherSector, otherUnitSameSector]) assert.ok(!managerEvents.some(e => e.detail?.mediaId === hidden.id), 'metade do escopo não basta para ver o evento');
    assert.ok(adminEvents.some(e => e.detail?.mediaId === sameUnitOtherSector.id) && adminEvents.some(e => e.detail?.mediaId === otherUnitSameSector.id), 'o Administrador vê os dois');
    assert.deepEqual(must(await kit.call('/api/audit', { session: editor.session })).events, []);
    assert.deepEqual(must(await kit.call('/api/audit', { session: viewer.session })).events, []);
    // Concedida por pessoa, a consulta também respeita o escopo.
    must(await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { grants: ['audit:read'] } }));
    const editorAgain = (await kit.login(editor.email, PASSWORD)).session;
    assert.ok(must(await kit.call('/api/audit', { session: editorAgain })).events.every(e => e.unitId === 'leste'));
    // Paginação.
    const page1 = must(await kit.call('/api/audit?limit=2', { session: kit.admin })).events;
    const page2 = must(await kit.call(`/api/audit?limit=2&before=${page1.at(-1).id}`, { session: kit.admin })).events;
    assert.equal(page1.length, 2);
    assert.ok(page2.every(e => e.id < page1.at(-1).id));
    // A cadeia de hashes continua íntegra com os campos novos de escopo.
    assert.ok(adminEvents.every(e => e.hash.length === 64));
  });
});

test('varredura de rotas: nenhuma rota fica aberta por engano e toda alteração exige CSRF', async () => {
  await withApp(async kit => {
    const publicRoutes = new Set(['GET /healthz', 'GET /api/status', 'POST /api/setup', 'POST /api/login', 'POST /api/player/pair']);
    assert.ok(kit.app.routes.length > 40, 'a varredura precisa enxergar as rotas');
    for (const route of kit.app.routes) {
      const key = `${route.method} ${route.pattern}`;
      const url = route.pattern.replace(/:[A-Za-z]+/g, 'x');
      if (route.auth === 'none') { assert.ok(publicRoutes.has(key), `rota pública não prevista: ${key}`); continue; }
      const anonymous = await inProcess(kit.app, url, { method: route.method, headers: route.method === 'GET' ? {} : { 'Content-Type': 'application/json' }, body: route.method === 'GET' ? undefined : '{}' });
      assert.equal(anonymous.status, 401, `${key} sem credencial deveria responder 401`);
      if (route.auth !== 'device' && route.method !== 'GET') {
        const noCsrf = await inProcess(kit.app, url, { method: route.method, headers: { Cookie: kit.admin.cookie, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(noCsrf.status, 403, `${key} sem token CSRF deveria responder 403`);
      }
    }
    assert.equal((await kit.call('/api/inexistente')).status, 401);
    assert.equal((await kit.call('/api/inexistente', { session: kit.admin })).status, 404);
  });
});

test('primitivas de autorização (sem HTTP): perfil, permissões individuais, conta inativa e escopo unidade × setor', () => {
  const person = (extra = {}) => ({ id: 'u', role: 'manager', active: true, unitIds: ['leste'], sectorIds: ['rh'], grants: [], revokes: [], ...extra });
  const here = { unitId: 'leste', sectorId: 'rh' };

  // Conta inativa não tem permissão nenhuma, nem a de Administrador.
  for (const role of ['admin', 'manager', 'editor', 'viewer']) assert.equal(effectivePermissions(person({ role, active: false })).size, 0, role);
  assert.equal(effectivePermissions(null).size, 0);
  assert.equal(effectivePermissions(undefined).size, 0);
  // Administrador sempre tem tudo, mesmo que o cadastro traga "retiradas" (registro antigo ou editado à mão).
  assert.deepEqual([...effectivePermissions(person({ role: 'admin', revokes: ['user:manage', 'media:delete'] }))].sort(), [...PERMISSION_IDS].sort());
  // Perfil + concedidas − retiradas; identificadores desconhecidos nunca viram permissão.
  const editor = effectivePermissions(person({ role: 'editor', grants: ['audit:read', 'permissao:inventada'], revokes: ['media:upload'] }));
  assert.ok(editor.has('audit:read') && !editor.has('media:upload') && !editor.has('permissao:inventada') && editor.has('folder:create'));
  assert.equal(effectivePermissions(person({ role: 'perfil-inexistente' })).size, 0);

  // Escopo: precisa da unidade E do setor; o Administrador não depende de listas.
  const table = [
    [{ unitIds: ['leste'], sectorIds: ['rh'] }, here, true],
    [{ unitIds: ['leste'], sectorIds: ['seguranca'] }, here, false],
    [{ unitIds: ['centro'], sectorIds: ['rh'] }, here, false],
    [{ unitIds: ['centro'], sectorIds: ['seguranca'] }, here, false],
    [{ unitIds: [], sectorIds: ['rh'] }, here, false],
    [{ unitIds: ['leste'], sectorIds: [] }, here, false],
    [{ unitIds: undefined, sectorIds: undefined }, here, false],
    [{ unitIds: ['leste', 'centro'], sectorIds: ['rh', 'seguranca'] }, { unitId: 'centro', sectorId: 'rh' }, true],
    [{ role: 'admin', unitIds: [], sectorIds: [] }, { unitId: 'qualquer', sectorId: 'coisa' }, true],
    [{ active: false }, here, false],
    [{ role: 'admin', active: false }, here, false]
  ];
  for (const [patch, target, expected] of table) assert.equal(inScope(person(patch), target), expected, JSON.stringify(patch));
  assert.equal(inScope(null, here), false);

  // authorize: 401 sem conta válida, 403 sem a permissão, 403 fora do escopo; as duas condições valem juntas.
  assert.throws(() => authorize(null, 'media:upload', here), { status: 401 });
  assert.throws(() => authorize(person({ active: false }), 'media:upload', here), { status: 401 });
  assert.throws(() => authorize(person({ role: 'viewer' }), 'media:upload', here), { status: 403, code: 'PERMISSION_DENIED' });
  assert.throws(() => authorize(person(), 'media:upload', { unitId: 'centro', sectorId: 'rh' }), { status: 403, code: 'SCOPE_DENIED' });
  assert.throws(() => authorize(person(), 'media:upload', { unitId: 'leste', sectorId: 'seguranca' }), { status: 403, code: 'SCOPE_DENIED' });
  assert.doesNotThrow(() => authorize(person(), 'media:upload', here));
  assert.doesNotThrow(() => authorize(person(), null, here), 'sem permissão específica basta estar no escopo (consulta)');
  assert.throws(() => authorize(person(), null, { unitId: 'centro', sectorId: 'rh' }), { status: 403 });
  assert.doesNotThrow(() => authorize(person(), 'media:upload'), 'sem alvo só a permissão é exigida (ações globais)');
  assert.throws(() => authorize(person({ role: 'viewer' }), 'media:upload'), { status: 403 });
  assert.throws(() => requireScope(person(), undefined), { status: 404 });
  assert.equal(requireScope(person(), here), here);

  // Lista de permissões recebida pela API: só identificadores do catálogo, sem repetição, tamanho limitado.
  assert.equal(validatePermissionList(undefined), undefined);
  assert.deepEqual(validatePermissionList(['audit:read', 'audit:read', 'media:upload']), ['audit:read', 'media:upload']);
  for (const bad of ['audit:read', ['inexistente'], [1], [...PERMISSION_IDS, 'audit:read'], {}, null]) assert.throws(() => validatePermissionList(bad), { status: 400 }, JSON.stringify(bad));
});
