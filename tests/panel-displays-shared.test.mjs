// Interface real, DOM simulado e API controlada: complementa as regras de autorização testadas no servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanelKit } from './helpers/panel-kit.mjs';
import { FakeEvent } from './helpers/fake-dom.mjs';
import { closeAllDialogs } from '../public/js/ui/dialogs.js';
import { hideToast } from '../public/js/ui/toast.js';
import { canIn, hasPermission, canManageDisplays, assignableRoles } from '../public/js/lib/permissions.js';
import { mountDisplays } from '../public/js/views/displays/index.js';
import { openDisplayForm } from '../public/js/views/displays/form.js';
import { openDisplaySequence } from '../public/js/views/displays/sequence.js';
import { openScheduleForm } from '../public/js/views/schedules/form.js';
import { mountSchedules } from '../public/js/views/schedules/index.js';
import { createApi } from '../public/js/lib/api.js';
import { ROLE_PERMISSIONS } from '../server/domain/permissions.mjs';
import { mountUsers } from '../public/js/views/users/index.js';
import { openUserForm } from '../public/js/views/users/form.js';
import { openResetPassword } from '../public/js/views/users/password.js';
import { mountOverview } from '../public/js/views/overview.js';

const settle = async () => { for (let n = 0; n < 12; n++) await new Promise(resolve => setImmediate(resolve)); };
const SPACE = { unitId: 'leste', sectorId: 'rh' };
const ADMIN = { id: 'admin', role: 'admin', active: true, permissions: ['screen:create', 'screen:activate', 'screen:update', 'screen:delete', 'user:manage', 'schedule:create', 'schedule:publish'] };
const MANAGER = { id: 'ana', role: 'manager', active: true, unitIds: ['leste'], sectorIds: ['rh'], permissions: ['schedule:create', 'schedule:publish'] };
const USERS = [
  { ...MANAGER, name: 'Ana RH', email: 'ana@example.invalid' },
  { id: 'beto', name: 'Beto Centro', email: 'beto@example.invalid', role: 'editor', active: true, unitIds: ['centro'], sectorIds: ['rh'] },
  { ...ADMIN, name: 'TI', email: 'ti@example.invalid' }
];
const tv = (extra = {}) => ({ id: 'tv1', name: 'TV Recepção', unitId: 'leste', sectorIds: ['rh', 'seguranca'], userIds: ['ana'], accessRev: 4, orderRev: 8,
  status: 'active', connection: 'online', paired: true, createdAt: '2026-10-26T12:00:00Z', permissions: { view: true, publish: true, manage: true }, ...extra });
const sequence = () => ({ display: tv(), revision: 8, schedules: [
  { id: 'agenda-rh', name: 'Avisos RH', sectorId: 'rh', sectorName: 'RH', position: 0, status: 'published', state: 'live', accessible: true, linkStatus: 'active', itemCount: 2, durationSeconds: 20 },
  { id: 'agenda-seguranca', name: 'SIPAT confidencial', sectorId: 'seguranca', sectorName: 'Segurança do Trabalho', position: 1, status: 'published', state: 'live', accessible: false, linkStatus: 'active', itemCount: 3, durationSeconds: 30 },
  { id: 'agenda-suspensa', name: 'Campanha', sectorId: 'rh', sectorName: 'RH', position: 2, status: 'draft', state: 'draft', accessible: true, linkStatus: 'suspended', itemCount: 1, durationSeconds: 10 }
], items: [{ mediaId: 'secret-file', url: 'https://secret.invalid/arquivo.mp4', title: 'Arquivo sigiloso' }] });

function context(kit, { user = ADMIN, get, post, patch, put } = {}) {
  const calls = [];
  const ctx = {
    user, state: { space: SPACE, units: [{ id: 'leste', name: 'Unidade Leste' }, { id: 'centro', name: 'Unidade Centro' }],
      sectors: [{ id: 'rh', name: 'RH' }, { id: 'seguranca', name: 'Segurança do Trabalho' }] },
    can: permission => hasPermission(user, permission), canHere: permission => canIn(user, permission, SPACE),
    unitName: id => id === 'centro' ? 'Unidade Centro' : 'Unidade Leste', sectorName: id => id === 'rh' ? 'RH' : 'Segurança do Trabalho',
    link: name => `#/${name}`, replaceUrl() {}, api: {}
  };
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) ctx.api[method] = async (url, body) => {
    calls.push([method, url, structuredClone(body)]);
    const custom = { get, post, patch, put }[method];
    if (custom) return custom(url, body);
    if (url === '/api/users') return { users: structuredClone(USERS) };
    if (url.endsWith('/sequence')) return sequence();
    if (url === '/api/displays') return method === 'get' ? { displays: [tv()] } : { display: tv() };
    return { display: tv() };
  };
  const container = kit.document.createElement('main'); kit.document.body.appendChild(container);
  return { ctx, calls, container, view: { alive: () => true }, writes: () => calls.filter(([method]) => method !== 'get') };
}
function withPanel(run) {
  return async () => {
    const kit = createPanelKit();
    const region = kit.document.createElement('div'); region.id = 'toast'; kit.document.body.appendChild(region);
    try { await run(kit); } finally { closeAllDialogs(); hideToast(); kit.release(); }
  };
}
const control = (root, label) => root.querySelectorAll('input, select, button').find(node => node.getAttribute('aria-label') === label);
const check = (node, value) => { assert.ok(node, 'controle acessível existe'); node.checked = value; node.dispatchEvent(new FakeEvent('change', { bubbles: true })); };
const rowIds = dialog => dialog.querySelectorAll('.tv-sequence-row').map(row => row.dataset.scheduleId);

test('TV: perfil comum vê só TVs autorizadas e não recebe controles TI mesmo com permissões antigas', withPanel(async kit => {
  const actor = { ...MANAGER, permissions: [...MANAGER.permissions, ...ADMIN.permissions] };
  const app = context(kit, { user: actor, get: () => ({ displays: [tv(), tv({ id: 'hidden', name: 'TV não autorizada', permissions: { view: false } }), tv({ id: 'legacy', name: 'TV sem decisão' , permissions: undefined })] }) });
  await mountDisplays(app.ctx, {}, app.container, app.view);
  assert.deepEqual(app.container.querySelectorAll('tr[data-display-id]').map(row => row.dataset.displayId), ['tv1']);
  assert.equal(canManageDisplays(actor), false);
  assert.equal(hasPermission(actor, 'screen:create'), false);
  assert.equal(hasPermission(actor, 'user:manage'), false);
  assert.deepEqual(assignableRoles(actor, { roles: ['admin'], manageableRoles: { manager: ['editor'] } }), []);
  assert.equal(kit.button(app.container, 'Cadastrar TV'), null);
  assert.equal(control(app.container, 'Editar TV e acessos de TV Recepção'), undefined);
  assert.equal(control(app.container, 'Remover a TV TV Recepção'), undefined);
  assert.ok(control(app.container, 'Ver sequência consolidada da TV TV Recepção'));
  assert.match(kit.textOf(app.container), /Gestão de administradores/);
  assert.deepEqual(app.calls[0][2].query, SPACE);
  assert.equal(await openDisplayForm(app.ctx, { space: SPACE }), undefined);
  assert.equal(kit.top(), null); assert.equal(app.calls.length, 1);
}));

test('TV: TI lista a unidade inteira e tem edição explícita de compartilhamento', withPanel(async kit => {
  const app = context(kit);
  await mountDisplays(app.ctx, {}, app.container, app.view);
  assert.equal(app.calls[0][2].query.unitId, 'leste');
  assert.equal(app.calls[0][2].query.sectorId, undefined);
  assert.ok(kit.button(app.container, 'Cadastrar TV'));
  assert.ok(control(app.container, 'Editar TV e acessos de TV Recepção'));
  assert.match(kit.textOf(app.container), /RH · Segurança do Trabalho/);
  assert.match(kit.textOf(app.container), /1 pessoa\(s\) com acesso individual/);
}));

test('TV: cadastro informa quem pode publicar e envia concessões explícitas por setor e pessoa', withPanel(async kit => {
  const app = context(kit); const done = openDisplayForm(app.ctx, { space: SPACE }); await settle();
  const dialog = kit.top(); assert.match(kit.textOf(dialog), /Quem pode publicar nesta TV\?/);
  assert.equal(control(dialog, 'Autorizar pessoa: TI'), undefined, 'administrador tem autoridade global e não precisa de grant');
  assert.equal(control(dialog, 'Autorizar pessoa: Beto Centro'), undefined, 'pessoa fora da unidade não é sugerida');
  kit.change(dialog.querySelector('#display-name'), 'Recepção compartilhada');
  check(control(dialog, 'Autorizar setor: RH'), false);
  check(control(dialog, 'Autorizar setor: Segurança do Trabalho'), true);
  check(control(dialog, 'Autorizar pessoa: Ana RH'), true);
  kit.button(dialog, 'Cadastrar TV').click(); await settle(); await done;
  assert.deepEqual(app.writes(), [['post', '/api/displays', { name: 'Recepção compartilhada', unitId: 'leste', sectorIds: ['seguranca'], userIds: ['ana'] }]]);
}));

test('TV: edição usa accessRev e mudança de unidade remove pessoa incompatível e explica suspensão', withPanel(async kit => {
  const app = context(kit); const done = openDisplayForm(app.ctx, { space: SPACE, display: tv() }); await settle();
  const dialog = kit.top(); kit.change(dialog.querySelector('#display-unit'), 'centro');
  assert.match(kit.textOf(dialog), /Mudar a unidade suspende/);
  assert.equal(control(dialog, 'Autorizar pessoa: Ana RH'), undefined);
  check(control(dialog, 'Autorizar pessoa: Beto Centro'), true);
  kit.button(dialog, 'Salvar TV e acessos').click(); await settle(); await done;
  assert.deepEqual(app.writes(), [['patch', '/api/displays/tv1', { name: 'TV Recepção', unitId: 'centro', sectorIds: ['rh', 'seguranca'], userIds: ['beto'], rev: 4 }]]);
}));

test('TV: conflito de compartilhamento permanece aberto, explica revisão e não repete gravação', withPanel(async kit => {
  const app = context(kit, { patch: () => { throw Object.assign(new Error('conflict'), { status: 409 }); } });
  openDisplayForm(app.ctx, { space: SPACE, display: tv() }); await settle();
  const dialog = kit.top(); kit.button(dialog, 'Salvar TV e acessos').click(); await settle();
  assert.equal(kit.top(), dialog); assert.match(kit.textOf(dialog.querySelector('[role="alert"]')), /alterada por outra pessoa/);
  assert.equal(app.writes().length, 1);
}));

test('sequência: consulta por setor exibe ordem e setor, oculta nome alheio e nunca monta mídias', withPanel(async kit => {
  const app = context(kit, { user: MANAGER }); openDisplaySequence(app.ctx, tv()); await settle();
  const dialog = kit.top(), text = kit.textOf(dialog);
  assert.deepEqual(rowIds(dialog), ['agenda-rh', 'agenda-seguranca', 'agenda-suspensa']);
  assert.match(text, /Segurança do Trabalho/); assert.match(text, /Programação de outro setor/);
  assert.match(text, /20 s de referência/); assert.match(text, /Vídeos configurados para tocar até o fim/);
  assert.equal(dialog.querySelectorAll('[role="listitem"]').length, 3);
  assert.doesNotMatch(text, /SIPAT confidencial|secret-file|secret\.invalid|Arquivo sigiloso/);
  assert.equal(dialog.querySelectorAll('img, video, iframe, a').length, 0);
  assert.equal(kit.button(dialog, 'Subir'), null); assert.equal(kit.button(dialog, 'Salvar ordem da TV'), null);
  assert.match(text, /Vínculo suspenso/); assert.equal(app.writes().length, 0);
}));

test('sequência: TI envia a ordem exata com revisão, incluindo rascunhos e suspensos', withPanel(async kit => {
  let server = sequence(); server.schedules[1].accessible = true;
  const app = context(kit, { get: () => structuredClone(server), put: (url, values) => {
    server.schedules = values.scheduleIds.map(id => server.schedules.find(item => item.id === id)); server.revision++;
    return { ok: true };
  } });
  openDisplaySequence(app.ctx, tv()); await settle();
  let dialog = kit.top(); assert.equal(kit.button(dialog, 'Salvar ordem da TV').disabled, true);
  control(dialog, 'Subir Campanha').click(); await settle();
  assert.deepEqual(rowIds(dialog), ['agenda-rh', 'agenda-suspensa', 'agenda-seguranca']);
  assert.match(kit.textOf(dialog.querySelector('.sr-only')), /posição 2/);
  kit.button(dialog, 'Salvar ordem da TV').click(); await settle();
  assert.deepEqual(app.writes(), [['put', '/api/displays/tv1/order', { rev: 8, scheduleIds: ['agenda-rh', 'agenda-suspensa', 'agenda-seguranca'] }]]);
  dialog = kit.top(); assert.match(kit.textOf(dialog), /Revisão da ordem: 9/);
  assert.equal(kit.button(dialog, 'Salvar ordem da TV').disabled, true);
}));

test('sequência: revisão vencida bloqueia nova gravação até recarregamento confirmado', withPanel(async kit => {
  const app = context(kit, { put: () => { throw Object.assign(new Error('ordem mudou'), { status: 409, code: 'REVISION_CONFLICT' }); } });
  openDisplaySequence(app.ctx, tv()); await settle(); const dialog = kit.top();
  control(dialog, 'Subir Campanha').click(); kit.button(dialog, 'Salvar ordem da TV').click(); await settle();
  assert.match(kit.textOf(dialog.querySelector('[role="alert"]')), /Recarregue a ordem atual/);
  assert.equal(kit.button(dialog, 'Salvar ordem da TV').disabled, true);
  assert.equal(control(dialog, 'Subir Campanha').disabled, true);
  assert.equal(app.writes().length, 1); assert.equal(app.calls.filter(([method]) => method === 'get').length, 1);
  kit.button(dialog, 'Recarregar ordem').click(); await settle();
  const confirm = kit.top(); assert.notEqual(confirm, dialog); kit.button(confirm, 'Recarregar ordem').click(); await settle();
  assert.deepEqual(rowIds(dialog), ['agenda-rh', 'agenda-seguranca', 'agenda-suspensa']);
  assert.equal(dialog.querySelector('[role="alert"]').hidden, true);
  assert.equal(app.writes().length, 1);
}));

test('programação: seletor oferece só TVs autorizadas e retira destinos revogados ao salvar', withPanel(async kit => {
  const get = url => {
    if (url === '/api/playlists') return { playlists: [{ id: 'pl1', name: 'Avisos', latestVersion: 1 }] };
    if (url === '/api/playlists/pl1') return { latestVersion: 1, versions: [{ version: 1, itemCount: 1 }] };
    if (url === '/api/displays') return { displays: [tv(), tv({ id: 'blocked', name: 'TV Restrita', permissions: { view: false, publish: false } }), tv({ id: 'read', name: 'TV Consulta', permissions: { view: true, publish: false } })] };
    throw new Error(`Consulta não prevista: ${url}`);
  };
  const app = context(kit, { user: MANAGER, get });
  const done = openScheduleForm(app.ctx, { space: SPACE, schedule: { id: 'sch1', name: 'Programação RH', status: 'draft', playlistId: 'pl1', playlistVersion: 1, rev: 3, displayIds: ['tv1', 'blocked'] } });
  await settle(); const dialog = kit.top();
  assert.ok(control(dialog, 'Exibir na TV TV Recepção')); assert.equal(control(dialog, 'Exibir na TV TV Restrita'), undefined);
  assert.equal(control(dialog, 'Exibir na TV TV Consulta'), undefined);
  assert.match(kit.textOf(dialog), /1 TV\(s\).*não estão mais autorizadas/);
  assert.ok(control(dialog, 'Ver sequência da TV TV Recepção'));
  kit.button(dialog, 'Salvar rascunho').click(); await settle(); await done;
  assert.deepEqual(app.writes()[0][2].displayIds, ['tv1']); assert.equal(app.writes()[0][2].rev, 3);
}));

test('programação: cartão sinaliza vínculo suspenso mesmo quando a situação geral é no ar', withPanel(async kit => {
  const app = context(kit, { user: MANAGER, get: () => ({ total: 1, schedules: [{ id: 'sch1', name: 'Avisos RH', status: 'published', state: 'live', playlistId: 'pl1', playlistName: 'Avisos', playlistVersion: 1,
    displays: [{ id: 'tv1', name: 'TV Recepção', status: 'active', linkStatus: 'suspended' }] }] }) });
  await mountSchedules(app.ctx, { query: {} }, app.container, app.view);
  assert.match(kit.textOf(app.container), /TV Recepção \(vínculo suspenso\)/);
  assert.match(kit.textOf(app.container), /não exibem esta programação/);
}));

// ---- Editor programa e publica (2.3.0): a interface acompanha a permissão que o servidor aplica ----------------------------------------------
// O usuário de teste usa o padrão REAL do perfil (o mesmo arquivo do servidor), então mudar o padrão sem mudar a tela reprova aqui.
const editorWith = permissions => ({ id: 'edu', role: 'editor', active: true, unitIds: ['leste'], sectorIds: ['rh'], permissions });
const PLANNED = [
  { id: 'sch-live', name: 'Avisos no ar', status: 'published', state: 'live', playlistId: 'pl1', playlistName: 'Avisos', playlistVersion: 1, rev: 2, displays: [{ id: 'tv1', name: 'TV Recepção', status: 'active', linkStatus: 'active' }] },
  { id: 'sch-draft', name: 'Rascunho do mês', status: 'draft', state: 'draft', playlistId: 'pl1', playlistName: 'Avisos', playlistVersion: 1, rev: 1, displays: [{ id: 'tv1', name: 'TV Recepção', status: 'active', linkStatus: 'active' }] },
  { id: 'sch-stopped', name: 'Campanha encerrada', status: 'stopped', state: 'stopped', playlistId: 'pl1', playlistName: 'Avisos', playlistVersion: 1, rev: 3, displays: [{ id: 'tv1', name: 'TV Recepção', status: 'active', linkStatus: 'active' }] }
];
const plannerGet = url => {
  if (url === '/api/schedules') return { total: PLANNED.length, schedules: structuredClone(PLANNED) };
  if (url === '/api/playlists') return { playlists: [{ id: 'pl1', name: 'Avisos', latestVersion: 1 }] };
  if (url === '/api/playlists/pl1') return { latestVersion: 1, versions: [{ version: 1, itemCount: 1 }] };
  if (url === '/api/displays') return { displays: [tv({ permissions: { view: true, publish: true, manage: false, pair: true } })] };
  throw new Error(`Consulta não prevista: ${url}`);
};
const without = (...ids) => ROLE_PERMISSIONS.editor.filter(id => !ids.includes(id));
const mountAs = async (kit, permissions) => {
  const app = context(kit, { user: editorWith(permissions), get: plannerGet });
  await mountSchedules(app.ctx, { query: {} }, app.container, app.view);
  return app;
};
const actionLabels = app => app.container.querySelectorAll('article.schedule-row button').map(node => node.getAttribute('aria-label')).filter(Boolean).sort();

test('programação: o Editor com o padrão do perfil cria, publica, interrompe e exclui, sem aviso de "só consulta" nem de "só rascunho"', withPanel(async kit => {
  const app = await mountAs(kit, [...ROLE_PERMISSIONS.editor]);
  assert.ok(kit.button(app.container, 'Nova programação'), 'cria programações');
  assert.deepEqual(actionLabels(app), [
    'Editar a programação Avisos no ar', 'Editar a programação Campanha encerrada', 'Editar a programação Rascunho do mês',
    'Excluir a programação Campanha encerrada', 'Excluir a programação Rascunho do mês',
    'Interromper a programação Avisos no ar', 'Publicar a programação Campanha encerrada', 'Publicar a programação Rascunho do mês'
  ]);
  assert.doesNotMatch(kit.textOf(app.container), /Seu perfil pode consultar|Você cria rascunhos/);
  // O formulário oferece publicar já na criação, e a publicação enviada leva a revisão que a pessoa estava vendo.
  kit.button(app.container, 'Nova programação').click(); await settle();
  assert.ok(kit.button(kit.top(), 'Publicar agora'), 'o formulário oferece "Publicar agora"');
  closeAllDialogs();
  control(app.container, 'Publicar a programação Rascunho do mês').click(); await settle();
  kit.button(kit.top(), 'Publicar programação').click(); await settle();
  assert.deepEqual(app.writes().map(([method, url, body]) => [method, url, body]), [['post', '/api/schedules/sch-draft/publish', { rev: 1 }]]);
}));

test('programação: o Editor sem a publicação só prepara rascunhos, e a tela diz isso', withPanel(async kit => {
  const app = await mountAs(kit, without('schedule:publish'));
  assert.ok(kit.button(app.container, 'Nova programação'));
  assert.deepEqual(actionLabels(app), ['Editar a programação Rascunho do mês', 'Excluir a programação Rascunho do mês'], 'só o rascunho pode ser alterado; o que está publicado ou parado exige publicar');
  assert.match(kit.textOf(app.container), /Você cria rascunhos, mas a publicação depende de quem tem essa permissão/);
  kit.button(app.container, 'Nova programação').click(); await settle();
  assert.equal(kit.button(kit.top(), 'Publicar agora'), null, 'o formulário não oferece publicar');
  assert.ok(kit.button(kit.top(), 'Salvar como rascunho'));
}));

test('programação: o Editor sem as permissões de programar só consulta, e a tela diz isso', withPanel(async kit => {
  const app = await mountAs(kit, without('schedule:create', 'schedule:publish'));
  assert.equal(kit.button(app.container, 'Nova programação'), null);
  assert.deepEqual(actionLabels(app), [], 'nenhuma ação de alteração');
  assert.match(kit.textOf(app.container), /Seu perfil pode consultar as programações, mas não criá-las/);
  assert.equal(canIn(editorWith(without('schedule:publish')), 'schedule:publish', SPACE), false);
  assert.equal(canIn(editorWith([...ROLE_PERMISSIONS.editor]), 'schedule:publish', { unitId: 'centro', sectorId: 'rh' }), false, 'a permissão não amplia o escopo');
}));

test('API: PUT da ordem envia revisão e lista com CSRF, cookie e sem cache', async () => {
  let received;
  const api = createApi({ getCsrf: () => 'token-da-sessao', fetchImpl: async (url, options) => {
    received = { url, options }; return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  } });
  await api.put('/api/displays/tv1/order', { rev: 8, scheduleIds: ['a', 'b'] });
  assert.equal(received.options.method, 'PUT');
  assert.equal(received.options.headers['X-CSRF-Token'], 'token-da-sessao');
  assert.equal(received.options.credentials, 'same-origin'); assert.equal(received.options.cache, 'no-store');
  assert.deepEqual(JSON.parse(received.options.body), { rev: 8, scheduleIds: ['a', 'b'] });
});

test('usuários: gestor com concessão legada não abre formulário, redefine senha ou consulta pessoas', withPanel(async kit => {
  const app = context(kit, { user: { ...MANAGER, permissions: [...MANAGER.permissions, 'user:manage'] } });
  await mountUsers(app.ctx, {}, app.container, app.view);
  assert.match(kit.textOf(app.container), /Somente o Administrador TI/);
  assert.equal(await openUserForm(app.ctx), undefined);
  assert.equal(await openResetPassword(app.ctx, USERS[0]), undefined);
  assert.equal(kit.top(), null); assert.equal(app.calls.length, 0);
}));

test('visão geral: TV compartilhada aparece por autorização do servidor sem filtro sectorId legado', withPanel(async kit => {
  const shared = tv({ sectorId: 'seguranca', sectorIds: ['rh', 'seguranca'] });
  const app = context(kit, { user: MANAGER, get: url => {
    if (url === '/api/displays') return { displays: [shared] };
    if (url === '/api/schedules') return { schedules: [] };
    return { total: 0 };
  } });
  await mountOverview(app.ctx, {}, app.container, app.view);
  assert.match(kit.textOf(app.container), /TV Recepção/);
  assert.ok(app.calls.some(([method, url, body]) => method === 'get' && url === '/api/displays' && body?.query?.sectorId === 'rh'));
}));

// ---- permissão "Gerar código de pareamento" (Editor e Gestor) -----------------------------------------------------------------------------
const EDITOR = { id: 'edu', role: 'editor', active: true, unitIds: ['leste'], sectorIds: ['rh'], permissions: ['media:upload', 'screen:pair'] };
const withPair = (pair, extra = {}) => tv({ permissions: { view: true, publish: false, manage: false, pair }, ...extra });
const PAIRED = { pairingCode: '482913', expiresAt: '2026-10-27T18:30:00.000Z' };
const pairButton = (root, name = 'TV Recepção') => control(root, `Gerar código de pareamento da TV ${name}`);
// O diálogo do código usa o endereço da página para mostrar onde digitar o código; o navegador de mentira não tem `location`.
const withLocation = async run => {
  const had = Object.hasOwn(globalThis, 'location');
  if (!had) globalThis.location = { origin: 'http://127.0.0.1:3000' };
  try { await run(); } finally { if (!had) delete globalThis.location; }
};

test('TV: Editor e Gestor com a permissão geram o código no mesmo botão de pareamento, com o aviso de que a TV continua conectada e sem nenhum outro controle de administração', withPanel(async kit => {
  await withLocation(async () => {
    for (const user of [EDITOR, { ...MANAGER, permissions: [...MANAGER.permissions, 'screen:pair'] }]) {
      const app = context(kit, { user, get: () => ({ displays: [withPair(true)] }), post: () => ({ display: withPair(true), ...PAIRED }) });
      await mountDisplays(app.ctx, {}, app.container, app.view);
      const button = pairButton(app.container);
      assert.ok(button, `${user.role}: o botão de pareamento aparece`);
      assert.equal(kit.textOf(button), 'Código de pareamento');
      assert.match(kit.textOf(app.container), /Pareada/, 'a situação do pareamento aparece para quem gera o código');
      assert.doesNotMatch(kit.textOf(app.container), /Gestão de administradores/);
      assert.match(kit.textOf(app.container), /pode gerar o código de pareamento delas\. O cadastro, os acessos e a ordem global são exclusivos do perfil Administrador\./);
      assert.doesNotMatch(kit.textOf(app.container), /o pareamento, os acessos/, 'o aviso não diz mais que o pareamento é exclusivo da TI para quem tem a permissão');
      // O restante da tela de quem não administra TVs continua igual.
      assert.equal(kit.button(app.container, 'Cadastrar TV'), null);
      assert.equal(kit.button(app.container, 'Ativar'), null);
      assert.equal(control(app.container, 'Editar TV e acessos de TV Recepção'), undefined);
      assert.equal(control(app.container, 'Remover a TV TV Recepção'), undefined);
      assert.ok(control(app.container, 'Ver sequência consolidada da TV TV Recepção'));

      button.click(); await settle();
      const confirm = kit.top();
      assert.match(kit.textOf(confirm), /Gerar um código de pareamento\?/);
      assert.match(kit.textOf(confirm), /A TV atual continua conectada até alguém digitar o código nela/);
      assert.doesNotMatch(kit.textOf(confirm), /desconecta/);
      kit.button(confirm, 'Gerar código').click(); await settle();
      assert.deepEqual(app.writes(), [['post', '/api/displays/tv1/pairing-code', {}]], `${user.role}: usa a rota própria, nunca a de renovação do Administrador`);
      const dialog = kit.top();
      assert.match(kit.textOf(dialog), /482913/);
      assert.match(kit.textOf(dialog), /vale por 10 minutos e só pode ser usado uma vez/);
      closeAllDialogs();
    }
  });
}));

test('TV: sem a permissão, sem acesso àquela TV ou com a TV ainda não ativada, o botão de código não aparece', withPanel(async kit => {
  // [situação, pessoa, TV, a pessoa tem a permissão neste espaço? (o aviso da página depende disso, não da TV)]
  const cases = [
    ['Editor com a permissão retirada', { ...EDITOR, permissions: ['media:upload'] }, withPair(true), false],
    ['Visualizador', { ...EDITOR, role: 'viewer', permissions: [] }, withPair(false), false],
    ['TV sem acesso para esta pessoa (decisão do servidor)', EDITOR, withPair(false), true],
    ['TV ainda não ativada', EDITOR, withPair(true, { status: 'pending', paired: false }), true],
    ['TV de outra unidade (fora do espaço da pessoa)', { ...EDITOR, unitIds: ['centro'] }, withPair(true), false]
  ];
  for (const [what, user, display, mayPair] of cases) {
    const app = context(kit, { user, get: () => ({ displays: [display] }) });
    await mountDisplays(app.ctx, {}, app.container, app.view);
    assert.equal(pairButton(app.container), undefined, what);
    assert.equal(kit.button(app.container, 'Código de pareamento'), null, what);
    assert.match(kit.textOf(app.container), /Gestão de administradores/, `${what}: a coluna segue como era`);
    assert.match(kit.textOf(app.container), mayPair ? /pode gerar o código de pareamento delas/ : /O cadastro, o pareamento, os acessos e a ordem global são exclusivos do perfil Administrador\./, `${what}: aviso da página`);
  }
}));

test('TV: o Administrador mantém o botão de sempre, que avisa que a TV é desconectada, e continua usando a rota de renovação', withPanel(async kit => {
  await withLocation(async () => {
    // Como o servidor responde ao Administrador: ele também tem a permissão de pareamento, e mesmo assim o botão é um só.
    const admin = { ...ADMIN, permissions: [...ADMIN.permissions, 'screen:pair'] };
    const app = context(kit, { user: admin, get: () => ({ displays: [tv({ permissions: { view: true, publish: true, manage: true, pair: true } })] }), post: () => ({ display: tv(), ...PAIRED }) });
    await mountDisplays(app.ctx, {}, app.container, app.view);
    assert.equal(app.container.querySelectorAll('button').filter(node => kit.textOf(node) === 'Código de pareamento').length, 1, 'um só botão, não dois');
    pairButton(app.container).click(); await settle();
    const confirm = kit.top();
    assert.match(kit.textOf(confirm), /Um código novo desconecta a TV atual/);
    kit.button(confirm, 'Gerar código').click(); await settle();
    assert.deepEqual(app.writes(), [['post', '/api/displays/tv1/pairing', {}]]);
    closeAllDialogs();
  });
}));
