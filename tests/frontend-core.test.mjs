// Lógica do painel que roda no navegador, testada no Node sem simular nada do negócio: rotas, sessão, cliente da API,
// preferências, formatação e as regras de permissão da interface comparadas com as do SERVIDOR (que são as que valem).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, buildQuery, createApi, isAbort } from '../public/js/lib/api.js';
import { createPrefs } from '../public/js/lib/prefs.js';
import { createSession } from '../public/js/lib/session.js';
import { ROUTES, ROUTE_PERMISSION, buildHash, parseHash, routeAllowed, routeTitle } from '../public/js/lib/router-core.js';
import * as format from '../public/js/lib/format.js';
import * as clientPermissions from '../public/js/lib/permissions.js';
import * as serverPermissions from '../server/domain/permissions.mjs';
import { publicUser } from '../server/domain/users.mjs';
import { must, withApp } from './helpers/app.mjs';

// ---- rotas ----------------------------------------------------------------------------------------------------------------

test('rotas: cada tela vira um endereço e o endereço volta à mesma tela, com parâmetros e filtros', () => {
  const samples = [
    ['overview', {}, {}, '#/'], ['units', {}, {}, '#/unidades'], ['library', {}, {}, '#/biblioteca'],
    ['library', { folderId: 'abc-123' }, { q: 'regras', tipo: 'image' }, '#/biblioteca/abc-123?q=regras&tipo=image'],
    ['playlist', { id: 'p_1' }, {}, '#/playlists/p_1'], ['playlists', {}, {}, '#/playlists'], ['schedules', {}, {}, '#/programacoes'],
    ['displays', {}, {}, '#/telas'], ['users', {}, {}, '#/usuarios'], ['audit', {}, {}, '#/auditoria'], ['settings', {}, {}, '#/configuracoes']
  ];
  for (const [name, params, query, expected] of samples) {
    assert.equal(buildHash(name, params, query), expected);
    assert.deepEqual(parseHash(expected), { name, params, query }, expected);
  }
  assert.deepEqual(new Set(samples.map(item => item[0])), new Set(ROUTES.map(route => route.name)), 'toda rota do painel tem um exemplo neste teste');
  assert.equal(new Set(ROUTES.map(route => route.name)).size, ROUTES.length, 'nomes de rota não se repetem');
  for (const name of ['', '#', '#/', undefined, null]) assert.equal(parseHash(name).name, 'overview');
  assert.deepEqual(parseHash('#/biblioteca?q=a%20b&ordem=desc').query, { q: 'a b', ordem: 'desc' });
});

test('rotas: endereços inventados, identificadores perigosos e codificação quebrada não abrem tela nenhuma', () => {
  const bad = ['#biblioteca', '#/inexistente', '#/playlists/a%20b', `#/playlists/${'x'.repeat(81)}`, '#/biblioteca/%E0%A4%A', '#/usuarios/extra',
    '#/unidades/1', '#/playlists/../usuarios', '#/biblioteca/a/b', 'javascript:alert(1)', '#/playlists/<img>'];
  for (const hash of bad) assert.equal(parseHash(hash).name, 'notfound', hash);
  assert.throws(() => buildHash('inexistente'), /Rota desconhecida/);
  assert.throws(() => buildHash('playlist', { id: 'a/b' }), /Identificador inválido/);
  assert.throws(() => buildHash('library', { folderId: '<script>' }), /Identificador inválido/);
  assert.equal(buildHash('library', {}, { q: '', tipo: undefined, ordem: null }), '#/biblioteca', 'filtros vazios não entram no endereço');
  assert.equal(routeTitle('audit'), 'Auditoria');
  assert.equal(routeTitle('nao-existe'), 'Página não encontrada');
});

test('rotas: telas administrativas exigem a permissão certa e só elas', () => {
  assert.deepEqual(ROUTE_PERMISSION, { users: 'user:manage', audit: 'audit:read' });
  for (const name of Object.keys(ROUTE_PERMISSION)) assert.ok(ROUTES.some(route => route.name === name));
  const manager = { role: 'manager', permissions: ['user:manage', 'audit:read'] };
  assert.equal(routeAllowed(manager, 'users'), false, 'permissão legada não concede administração de pessoas');
  assert.equal(routeAllowed({ role: 'admin', permissions: ['user:manage'] }, 'users'), true);
  assert.equal(routeAllowed(manager, 'audit'), true);
  assert.equal(routeAllowed({ permissions: ['audit:read'] }, 'users'), false);
  assert.equal(routeAllowed({ permissions: ['user:manage'] }, 'audit'), false);
  assert.equal(routeAllowed({ permissions: [] }, 'users'), false);
  assert.equal(routeAllowed({}, 'audit'), false);
  assert.equal(routeAllowed(null, 'users'), false);
  for (const open of ROUTES.map(route => route.name).filter(name => !(name in ROUTE_PERMISSION))) assert.equal(routeAllowed({ permissions: [] }, open), true, open);
});

// ---- sessão ---------------------------------------------------------------------------------------------------------------

test('sessão: respostas de uma sessão encerrada nunca são aceitas pela sessão seguinte', () => {
  const session = createSession();
  assert.equal(session.active, false);
  const first = session.start({ user: { id: 'ana' }, csrf: 'token-ana' });
  assert.equal(session.alive(first), true);
  assert.equal(session.fill(first, { units: [{ id: 'u1' }], version: '2.0' }), true);
  assert.deepEqual(session.state.units, [{ id: 'u1' }]);

  session.end();
  assert.equal(session.active, false);
  assert.equal(session.alive(first), false);
  assert.equal(session.state.csrf, '', 'o token anti-CSRF não sobra depois de sair');
  assert.equal(session.state.user, null);
  assert.deepEqual(session.state.units, []);

  const second = session.start({ user: { id: 'bia' }, csrf: 'token-bia' });
  assert.notEqual(second, first);
  assert.equal(session.active, true);
  assert.equal(session.alive(first), false, 'há uma sessão ativa, mas a operação pendente é da sessão anterior');
  assert.equal(session.alive(second), true);
  assert.equal(session.fill(first, { units: [{ id: 'da-ana' }] }), false, 'resposta atrasada da Ana não entra na sessão da Bia');
  assert.deepEqual(session.state.units, []);
  assert.equal(session.state.user.id, 'bia');
  assert.equal(session.state.csrf, 'token-bia');
  assert.equal(session.fill(second, { units: [{ id: 'da-bia' }] }), true);
});

test('sessão: entrar de novo sem sair antes (outra aba, outra conta) não herda nada e invalida o que estava pendente', () => {
  const session = createSession();
  const first = session.start({ user: { id: 'ana' }, csrf: 'token-ana' });
  session.fill(first, { units: [{ id: 'u1' }], sectors: [{ id: 's1' }], catalog: { roles: ['admin'] }, limits: { maxUploadMB: 50 }, version: '2.0', scannerConfigured: true, mode: 'production' });
  session.setSpace({ unitId: 'u1', sectorId: 's1' });
  const second = session.start({ user: { id: 'bia' }, csrf: 'token-bia' });
  assert.equal(session.alive(first), false);
  assert.equal(session.fill(first, { units: [{ id: 'atrasado' }] }), false);
  assert.deepEqual(session.state, {
    user: { id: 'bia' }, csrf: 'token-bia', catalog: null, units: [], sectors: [], limits: {}, mode: 'local', scannerConfigured: false, version: '', space: null
  }, 'nada da sessão anterior sobra: unidades, setores, catálogo, limites, modo, espaço escolhido');
  assert.equal(session.alive(second), true);
});

test('sessão: sair, entrar de novo e avisar quem acompanha; espaço e usuário só mudam com sessão ativa', () => {
  const session = createSession();
  const seen = [];
  const stop = session.subscribe((state, epoch) => seen.push([state.user?.id ?? null, epoch]));
  session.setSpace({ unitId: 'u', sectorId: 's' });
  session.setUser({ id: 'fantasma' });
  assert.equal(session.state.space, null, 'sem sessão não há espaço');
  assert.equal(session.state.user, null);
  assert.deepEqual(seen, []);

  session.start({ user: { id: 'ana' }, csrf: 'x' });
  session.setSpace({ unitId: 'u', sectorId: 's' });
  session.setUser({ id: 'ana', name: 'Ana' });
  assert.deepEqual(session.state.space, { unitId: 'u', sectorId: 's' });
  session.end();
  assert.deepEqual(seen.map(item => item[0]), ['ana', 'ana', 'ana', null]);
  assert.deepEqual(seen.map(item => item[1]), [1, 1, 1, 2], 'cada entrada ou saída muda o número da sessão');
  stop();
  session.start({ user: { id: 'bia' }, csrf: 'y' });
  assert.equal(seen.length, 4, 'quem cancelou a assinatura não é mais avisado');
});

// ---- cliente da API -------------------------------------------------------------------------------------------------------

const reply = (status, data, type = 'application/json') => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: name => (name.toLowerCase() === 'content-type' ? type : null) },
  json: async () => { if (data instanceof Error) throw data; return data; }
});
function recorder(handler) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, options }); return handler({ url, options }); } };
}

test('API: o token anti-CSRF vai só nas requisições que alteram dados; cookie, cache e corpo seguem o padrão seguro', async () => {
  const { calls, fetchImpl } = recorder(() => reply(200, { ok: true }));
  let csrf = 'token-1';
  const api = createApi({ fetchImpl, getCsrf: () => csrf });
  await api.get('/api/state');
  await api.post('/api/folders', { name: 'RH' });
  await api.patch('/api/users/1', { active: false });
  await api.delete('/api/folders/9');
  await api.post('/api/logout');
  csrf = '';
  await api.post('/api/login', { email: 'a@b.invalid', password: 'x' }, { public: true });

  assert.equal(calls[0].options.headers['X-CSRF-Token'], undefined, 'leitura não precisa de token');
  assert.deepEqual(calls.slice(1, 5).map(call => call.options.headers['X-CSRF-Token']), ['token-1', 'token-1', 'token-1', 'token-1']);
  assert.equal(calls[5].options.headers['X-CSRF-Token'], undefined, 'sem token na sessão, nenhum cabeçalho é inventado');
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Accept, 'application/json');
  }
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[1].options.body, '{"name":"RH"}');
  assert.equal(calls[4].options.body, '{}', 'POST sem corpo envia um objeto vazio');
  assert.equal(calls[3].options.body, undefined, 'DELETE não leva corpo');
  assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST', 'PATCH', 'DELETE', 'POST', 'POST']);
});

test('API: filtros viram consulta sem valores vazios; a mesma regra monta o endereço da requisição', async () => {
  assert.equal(buildQuery(), '');
  assert.equal(buildQuery({ a: '', b: null, c: undefined, d: false }), '');
  assert.equal(buildQuery({ a: 1, b: '', f: true, g: 'x y', h: 0 }), '?a=1&f=1&g=x+y&h=0');
  const { calls, fetchImpl } = recorder(() => reply(200, {}));
  await createApi({ fetchImpl }).get('/api/library', { query: { unitId: 'u', q: 'a&b=c', flat: true } });
  assert.equal(calls[0].url, '/api/library?unitId=u&q=a%26b%3Dc&flat=1', 'texto digitado nunca vira outro parâmetro');
});

test('API: 401 avisa a sessão (menos no login), erros trazem mensagem, código e detalhes do servidor', async () => {
  const unauthorized = [];
  const { fetchImpl } = recorder(({ url }) => {
    if (url === '/api/expired') return reply(401, {});
    if (url === '/api/login') return reply(401, { error: 'E-mail ou senha inválidos.' });
    if (url === '/api/forbidden') return reply(403, { error: 'Seu perfil não permite esta ação.', code: 'PERMISSION_DENIED', details: { permission: 'media:approve' } });
    if (url === '/api/gateway') return reply(502, '<html>Bad Gateway</html>', 'text/html');
    if (url === '/api/empty') return reply(204, null, '');
    if (url === '/api/broken') return reply(200, new SyntaxError('JSON inválido'));
    return reply(200, { ok: true });
  });
  const api = createApi({ fetchImpl, onUnauthorized: error => unauthorized.push(error) });

  await assert.rejects(api.get('/api/expired'), error => error instanceof ApiError && error.status === 401 && error.message === 'Sua sessão expirou. Entre novamente.');
  assert.equal(unauthorized.length, 1);
  assert.equal(unauthorized[0].status, 401);
  await assert.rejects(api.post('/api/login', {}, { public: true }), error => error.message === 'E-mail ou senha inválidos.');
  assert.equal(unauthorized.length, 1, 'senha errada no login não é "sessão expirada"');
  await assert.rejects(api.get('/api/forbidden'), error => error.status === 403 && error.code === 'PERMISSION_DENIED' && error.details.permission === 'media:approve');
  assert.equal(unauthorized.length, 1);
  await assert.rejects(api.get('/api/gateway'), error => error.status === 502 && error.message === 'Não foi possível concluir (código 502).' && !/Bad Gateway/.test(error.message), 'página de erro do servidor nunca vai para a tela');
  assert.deepEqual(await api.get('/api/empty'), {});
  assert.deepEqual(await api.get('/api/broken'), {});
});

test('API: a reação ao 401 que falhe não esconde o erro original', async () => {
  const { fetchImpl } = recorder(() => reply(401, { error: 'Sessão inválida.' }));
  const api = createApi({ fetchImpl, onUnauthorized: () => { throw new Error('falha ao desenhar o login'); } });
  await assert.rejects(api.get('/api/state'), error => error instanceof ApiError && error.status === 401 && error.message === 'Sessão inválida.');
});

test('API: falha de rede, tempo esgotado e cancelamento têm mensagens claras e nunca vazam detalhe técnico', async () => {
  const network = createApi({ fetchImpl: async () => { throw new TypeError('connect ECONNREFUSED 10.1.2.3:3000'); } });
  await assert.rejects(network.get('/api/state'), error => error.status === 0 && error.code === 'NETWORK' && !/10\.1\.2\.3|ECONN/.test(error.message) && /Não foi possível conectar/.test(error.message));

  const waits = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new Error('abort')), { once: true }));
  // O cronômetro de AbortSignal.timeout() não mantém o Node vivo (no navegador não há esse problema): um intervalo comum o mantém.
  const keepAlive = setInterval(() => {}, 10);
  try {
    await assert.rejects(createApi({ fetchImpl: waits, timeoutMs: 30 }).get('/api/lento'), error => error.status === 0 && error.code === 'TIMEOUT' && /demorou/.test(error.message));
  } finally { clearInterval(keepAlive); }

  const controller = new AbortController();
  const pending = createApi({ fetchImpl: waits }).get('/api/lento', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => isAbort(error) && error.status === undefined, 'cancelar não é erro de rede');
  assert.equal(isAbort(new ApiError(500, 'x')), false);
});

class FakeXhr {
  constructor(script) { this.script = script; this.headers = {}; this.upload = {}; }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(body) { this.body = body; queueMicrotask(() => this.script(this)); }
  abort() { this.onabort?.(); }
}

test('API: envio de arquivo leva o token e o tipo, informa progresso (nunca acima de 100%) e trata 401, rede e cancelamento', async () => {
  const unauthorized = [];
  const run = (script, options = {}, apiOptions = {}) => {
    const xhr = new FakeXhr(script);
    const api = createApi({ xhrFactory: () => xhr, getCsrf: () => 'csrf-up', onUnauthorized: error => unauthorized.push(error), ...apiOptions });
    return { xhr, promise: api.upload('/api/media', { query: { name: 'a.png', unitId: 'u' }, file: 'ARQUIVO', contentType: 'image/png', ...options }) };
  };

  const progress = [];
  const ok = run(xhr => {
    xhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.upload.onprogress({ lengthComputable: true, loaded: 150, total: 100 });
    xhr.upload.onprogress({ lengthComputable: false, loaded: 1, total: 0 });
    xhr.status = 201; xhr.responseText = '{"id":"m1"}'; xhr.onload();
  }, { onProgress: value => progress.push(value) });
  assert.deepEqual(await ok.promise, { id: 'm1' });
  assert.deepEqual(progress, [0.5, 1, 1], 'o progresso limita a 100% e termina em 100%');
  assert.equal(ok.xhr.method, 'POST');
  assert.equal(ok.xhr.url, '/api/media?name=a.png&unitId=u');
  assert.equal(ok.xhr.headers['X-CSRF-Token'], 'csrf-up');
  assert.equal(ok.xhr.headers['Content-Type'], 'image/png');
  assert.equal(ok.xhr.body, 'ARQUIVO', 'o corpo é o próprio arquivo, sem reembalar');
  assert.equal(ok.xhr.withCredentials, true);

  const expired = run(xhr => { xhr.status = 401; xhr.responseText = ''; xhr.onload(); });
  await assert.rejects(expired.promise, error => error.status === 401);
  assert.equal(unauthorized.length, 1);

  const refused = run(xhr => { xhr.status = 409; xhr.responseText = '{"error":"Este arquivo já existe na biblioteca.","code":"DUPLICATE_MEDIA","details":{"existing":{"title":"Aviso"}}}'; xhr.onload(); });
  await assert.rejects(refused.promise, error => error.code === 'DUPLICATE_MEDIA' && error.details.existing.title === 'Aviso' && error.message === 'Este arquivo já existe na biblioteca.');
  assert.equal(unauthorized.length, 1, 'só o 401 avisa a sessão');

  const html = run(xhr => { xhr.status = 500; xhr.responseText = '<html>erro</html>'; xhr.onload(); });
  await assert.rejects(html.promise, error => error.message === 'Falha no envio (código 500).');
  await assert.rejects(run(xhr => xhr.onerror()).promise, error => error.code === 'NETWORK');
  await assert.rejects(run(xhr => xhr.ontimeout()).promise, error => error.code === 'TIMEOUT');

  const controller = new AbortController();
  const aborted = run(() => { controller.abort(); }, { signal: controller.signal });
  await assert.rejects(aborted.promise, error => isAbort(error) && /cancelado/.test(error.message));
  const already = new AbortController(); already.abort();
  await assert.rejects(run(() => {}, { signal: already.signal }).promise, error => isAbort(error));
});

// ---- preferências ---------------------------------------------------------------------------------------------------------

test('preferências: valores padrão, leitura reforçada, último espaço por pessoa e remoção', () => {
  const store = new Map();
  const prefs = createPrefs({ getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) });
  assert.equal(prefs.largeText(), false);
  assert.equal(prefs.highContrast(), false);
  assert.equal(prefs.libraryView(), 'grid');
  assert.equal(prefs.space('u1'), null);
  prefs.setLargeText(true); prefs.setHighContrast(true); prefs.setLibraryView('list');
  assert.equal(prefs.largeText(), true);
  assert.equal(prefs.highContrast(), true);
  assert.equal(prefs.libraryView(), 'list');
  prefs.setLibraryView('qualquer'); assert.equal(prefs.libraryView(), 'grid', 'só "list" é lembrado; o resto volta ao padrão');
  store.set('tvcorp-library-view', 'tabela');
  assert.equal(prefs.libraryView(), 'grid', 'valor gravado por outra versão ou à mão também volta ao padrão');
  store.set('tvcorp-large-text', 'false');
  assert.equal(prefs.largeText(), false, 'o texto "false" não conta como ligado');
  prefs.setLargeText(false); assert.equal(prefs.largeText(), false);

  prefs.setSpace('u1', { unitId: 'leste', sectorId: 'rh' });
  prefs.setSpace('u2', { unitId: 'centro', sectorId: 'ti' });
  assert.deepEqual(prefs.space('u1'), { unitId: 'leste', sectorId: 'rh' });
  assert.deepEqual(prefs.space('u2'), { unitId: 'centro', sectorId: 'ti' }, 'cada pessoa tem o seu espaço');
  prefs.setSpace('u1', null);
  assert.equal(prefs.space('u1'), null);
  store.set('tvcorp-space:u3', 'so-um-pedaco');
  assert.equal(prefs.space('u3'), null, 'valor gravado incompleto é ignorado');
  assert.ok([...store.keys()].every(key => key.startsWith('tvcorp-')), 'o painel só grava chaves próprias');
});

test('preferências: armazenamento bloqueado, cheio ou ausente nunca derruba o painel', () => {
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('cheio'); }, removeItem() { throw new Error('bloqueado'); } };
  for (const storage of [broken, null]) {
    const prefs = createPrefs(storage);
    assert.equal(prefs.largeText(), false);
    assert.equal(prefs.libraryView(), 'grid');
    assert.equal(prefs.space('u1'), null);
    assert.equal(prefs.setLargeText(true), false, 'a gravação informa que não deu, sem lançar erro');
    assert.doesNotThrow(() => prefs.setSpace('u1', null));
    assert.equal(prefs.read('x', 'padrão'), 'padrão');
  }
});

// ---- formatação -----------------------------------------------------------------------------------------------------------

test('formatação: tamanhos, durações, plural e busca sem acento', () => {
  assert.equal(format.formatBytes(0), '0 B');
  assert.equal(format.formatBytes(1023), '1023 B');
  assert.equal(format.formatBytes(1024), '1,0 KB');
  assert.equal(format.formatBytes(1536), '1,5 KB');
  assert.equal(format.formatBytes(50 * 1024 * 1024), '50 MB');
  assert.equal(format.formatBytes(5 * 1024 ** 3), '5,0 GB');
  for (const invalid of [-1, NaN, Infinity, undefined, 'abc']) assert.equal(format.formatBytes(invalid), '—', String(invalid));
  assert.equal(format.formatDuration(45), '45 s');
  assert.equal(format.formatDuration(60), '1 min');
  assert.equal(format.formatDuration(75), '1 min 15 s');
  assert.equal(format.formatDuration(3600), '1 h');
  assert.equal(format.formatDuration(3720), '1 h 02 min');
  assert.equal(format.formatDuration(-5), '0 s');
  assert.equal(format.plural(1, 'arquivo', 'arquivos'), '1 arquivo');
  assert.equal(format.plural(0, 'arquivo', 'arquivos'), '0 arquivos');
  assert.equal(format.plural(2, 'arquivo', 'arquivos'), '2 arquivos');
  assert.equal(format.fold('  Ação DE Atenção  '), '  acao de atencao  ');
  assert.equal(format.fold(null), '');
});

test('formatação: datas inválidas viram traço, o horário respeita o fuso pedido e os campos de data fazem ida e volta', () => {
  assert.equal(format.formatDateTime('lixo'), '—');
  assert.equal(format.formatDateTime(null), '—');
  assert.equal(format.formatDate(undefined), '—');
  assert.match(format.formatDateTime('2026-10-05T14:30:00Z', { timeZone: 'UTC' }), /^05\/10\/2026,? 14:30$/);
  assert.match(format.formatDateTime('2026-10-05T14:30:00Z', { timeZone: 'America/Sao_Paulo' }), /^05\/10\/2026,? 11:30$/);
  assert.match(format.formatDateTimeSeconds('2026-10-05T14:30:07Z', { timeZone: 'UTC' }), /^05\/10\/2026,? 14:30:07$/);
  assert.match(format.formatDate('2026-10-05T23:59:00Z', { timeZone: 'UTC' }), /^05\/10\/2026$/);

  const iso = '2026-10-05T14:30:00.000Z';
  assert.equal(format.fromLocalInput(format.toLocalInput(iso)), iso, 'o campo "data e hora" devolve o mesmo instante (ao minuto)');
  assert.equal(format.toLocalInput('lixo'), '');
  assert.equal(format.fromLocalInput(''), null);
  assert.equal(format.fromLocalInput('não é data'), null);

  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(format.relativeTime('2026-10-22T11:59:30Z', now), 'agora há pouco');
  assert.equal(format.relativeTime('2026-10-22T11:30:00Z', now), 'há 30 min');
  assert.equal(format.relativeTime('2026-10-22T09:00:00Z', now), 'há 3 h');
  assert.equal(format.relativeTime('2026-10-21T12:00:00Z', now), 'há 1 dia');
  assert.equal(format.relativeTime('2026-10-19T12:00:00Z', now), 'há 3 dias');
  assert.match(format.relativeTime('2026-09-01T12:00:00Z', now), /^\d{2}\/\d{2}\/2026$/);
  assert.equal(format.relativeTime(null, now), 'nunca');
});

test('formatação: todo rótulo de auditoria, situação e transição é texto em português e eventos desconhecidos aparecem como estão', () => {
  assert.equal(format.auditActionLabel('media.approved'), 'Arquivo aprovado');
  assert.equal(format.auditActionLabel('acao.nova.do.futuro'), 'acao.nova.do.futuro');
  assert.equal(format.auditActionLabel(undefined), '');
  assert.equal(format.auditActionLabel('playlist.published'), 'Programação publicada (registro da versão 1.1.0)', 'registros antigos continuam com rótulo');
  for (const odd of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) assert.equal(format.auditActionLabel(odd), odd, `${odd} não herda nada do objeto`);
  assert.equal(format.own({ a: 1 }, 'a'), 1);
  assert.equal(format.own({ a: 1 }, 'toString'), undefined);
  assert.equal(format.own({ a: 1 }, 42), undefined);
  assert.equal(format.own({ a: 1 }, undefined), undefined);
  for (const table of [format.KIND_LABELS, format.MEDIA_STATUS_LABELS, format.SCAN_LABELS, format.READINESS_LABELS, format.SCHEDULE_STATE_LABELS, format.CONNECTION_LABELS, format.TRANSITION_LABELS, format.SORT_LABELS, format.AUDIT_ACTIONS, format.LEGACY_AUDIT_ACTIONS]) {
    for (const [key, label] of Object.entries(table)) assert.ok(typeof label === 'string' && label.trim() && label !== key, `rótulo vazio ou igual à chave: ${key}`);
  }
  assert.deepEqual(Object.keys(format.TRANSITION_LABELS), [...format.TRANSITIONS], 'toda transição tem rótulo');
  assert.deepEqual(format.ROLE_OPTIONS, ['admin', 'manager', 'editor', 'viewer']);
});

// ---- permissões da interface x servidor -----------------------------------------------------------------------------------

const GRANT_SAMPLES = [
  {}, { grants: ['audit:read'] }, { revokes: ['media:upload'] }, { grants: ['media:approve', 'screen:delete'], revokes: ['folder:create', 'media:upload'] },
  { grants: ['inexistente:x'] }, { revokes: ['user:manage', 'audit:read'] }, { grants: ['media:upload'], revokes: ['media:upload'] }
];

test('permissões: a interface calcula exatamente o que o servidor calcula (perfis, concessões, retiradas, conta suspensa, escopo)', async () => {
  await withApp(async kit => {
    const catalog = must(await kit.call('/api/permissions', { session: kit.admin }));
    assert.deepEqual(catalog.permissions.map(item => item.id), serverPermissions.PERMISSION_IDS);
    assert.deepEqual(catalog.permissions.filter(item => item.nonDelegable).map(item => item.id).sort(), [...serverPermissions.NON_DELEGABLE].sort());
    assert.deepEqual(catalog.roles, serverPermissions.ROLES);

    for (const role of catalog.roles) {
      for (const sample of GRANT_SAMPLES) {
        const user = { id: 'u1', role, unitIds: ['leste'], sectorIds: ['rh'], active: true, ...sample };
        const expected = serverPermissions.effectivePermissions(user);
        const client = clientPermissions.effectivePermissionSet(role, sample.grants, sample.revokes, catalog);
        assert.deepEqual([...client].sort(), [...expected].sort(), `${role} ${JSON.stringify(sample)}`);

        // O que o servidor entrega ao painel ("permissions" do usuário) é a mesma lista, e é nela que a interface se apoia.
        const exposed = publicUser({ ...user, email: 'x@example.invalid', name: 'X' });
        assert.deepEqual([...exposed.permissions].sort(), [...expected].sort());
        for (const id of serverPermissions.PERMISSION_IDS) assert.equal(clientPermissions.hasPermission(exposed, id), serverPermissions.hasPermission(user, id), `${role} ${id}`);
      }
    }

    // Conta suspensa: nada é permitido, nos dois lados.
    const suspended = { id: 's', role: 'admin', active: false, permissions: serverPermissions.PERMISSION_IDS, unitIds: [], sectorIds: [] };
    assert.equal(clientPermissions.hasPermission(suspended, 'media:upload'), false);
    assert.equal(serverPermissions.hasPermission(suspended, 'media:upload'), false);
    assert.equal(clientPermissions.inScope(suspended, { unitId: 'a', sectorId: 'b' }), false);
    assert.equal(serverPermissions.inScope(suspended, { unitId: 'a', sectorId: 'b' }), false);

    // Escopo: administrador em tudo; os demais só onde têm a unidade E o setor.
    const targets = [{ unitId: 'leste', sectorId: 'rh' }, { unitId: 'leste', sectorId: 'ti' }, { unitId: 'centro', sectorId: 'rh' }, { unitId: 'centro', sectorId: 'ti' }];
    for (const role of catalog.roles) {
      const user = { role, unitIds: ['leste'], sectorIds: ['rh'], active: true, permissions: [...serverPermissions.effectivePermissions({ role })] };
      for (const target of targets) {
        assert.equal(clientPermissions.inScope(user, target), serverPermissions.inScope(user, target), `${role} ${JSON.stringify(target)}`);
        for (const id of ['media:upload', 'user:manage']) {
          assert.equal(clientPermissions.canIn(user, id, target), serverPermissions.hasPermission(user, id) && serverPermissions.inScope(user, target));
        }
      }
    }
    assert.equal(clientPermissions.inScope({ role: 'editor', unitIds: ['a'], sectorIds: ['b'] }, null), false);

    // Perfis que cada pessoa pode atribuir.
    assert.deepEqual(clientPermissions.assignableRoles({ role: 'admin' }, catalog), serverPermissions.MANAGEABLE_ROLES.admin);
    assert.deepEqual(clientPermissions.assignableRoles({ role: 'manager' }, catalog), serverPermissions.MANAGEABLE_ROLES.manager ?? []);
    assert.deepEqual(clientPermissions.assignableRoles({ role: 'editor' }, catalog), []);
    assert.deepEqual(clientPermissions.assignableRoles({ role: 'viewer' }, catalog), []);
    assert.deepEqual(clientPermissions.assignableRoles({ role: 'admin' }, null), []);
    assert.deepEqual(clientPermissions.assignableRoles(null, catalog), []);
  });
});

test('permissões: marcar e desmarcar caixas vira concessões e retiradas que reproduzem exatamente a seleção (qualquer combinação)', async () => {
  await withApp(async kit => {
    const catalog = must(await kit.call('/api/permissions', { session: kit.admin }));
    const ids = catalog.permissions.map(item => item.id);
    // Sorteio determinístico (gerador congruencial simples): o teste repete sempre os mesmos 150 casos por perfil.
    let seed = 20261022;
    const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    for (const role of ['manager', 'editor', 'viewer']) {
      const defaults = clientPermissions.defaultPermissions(role, catalog);
      assert.deepEqual([...defaults].sort(), [...serverPermissions.ROLE_PERMISSIONS[role]].sort());
      for (let round = 0; round < 150; round++) {
        const checked = ids.filter(id => !clientPermissions.ADMIN_ONLY_PERMISSIONS.includes(id) && next() < 0.5);
        const { grants, revokes } = clientPermissions.diffAgainstRole(role, checked, catalog);
        assert.ok(grants.every(id => !defaults.has(id) && checked.includes(id)));
        assert.ok(revokes.every(id => defaults.has(id) && !checked.includes(id)));
        const effective = clientPermissions.effectivePermissionSet(role, grants, revokes, catalog);
        assert.deepEqual([...effective].sort(), [...checked].sort(), `${role} #${round}`);
        assert.deepEqual([...serverPermissions.effectivePermissions({ role, grants, revokes })].sort(), [...checked].sort(), 'e o servidor chega ao mesmo resultado');
      }
    }
    assert.deepEqual(clientPermissions.diffAgainstRole('admin', [], catalog), { grants: [], revokes: [] }, 'o Administrador não tem concessões nem retiradas');
    assert.equal(clientPermissions.effectivePermissionSet('admin', [], ['media:upload'], catalog).size, ids.length);

    const groups = clientPermissions.groupPermissions(catalog);
    assert.deepEqual(groups.map(group => group.group), ['Biblioteca', 'Playlists', 'Programações', 'Telas', 'Administração']);
    assert.equal(groups.reduce((sum, group) => sum + group.items.length, 0), ids.length);
    assert.deepEqual(clientPermissions.groupPermissions(null), []);
  });
});

test('permissões: o editor de permissões só deixa ligar o que quem edita pode conceder, e explica o motivo', async () => {
  await withApp(async kit => {
    const catalog = must(await kit.call('/api/permissions', { session: kit.admin }));
    const states = (actor, role, checked, existingGrants) => clientPermissions.permissionStates({ actor, role, catalog, checked, existingGrants });
    const admin = { role: 'admin', permissions: serverPermissions.PERMISSION_IDS };
    const manager = { role: 'manager', permissions: serverPermissions.ROLE_PERMISSIONS.manager };
    const defaultsOf = role => [...serverPermissions.ROLE_PERMISSIONS[role]];

    const forAdmin = states(admin, 'admin', [], []);
    for (const [id, state] of forAdmin) assert.deepEqual([state.checked, state.disabled], [true, true], `Administrador: ${id} sempre ligada e travada`);

    const adminEditsEditor = states(admin, 'editor', defaultsOf('editor'), []);
    assert.equal(adminEditsEditor.get('media:upload').checked, true);
    assert.equal(adminEditsEditor.get('media:upload').origin, 'role');
    assert.equal(adminEditsEditor.get('media:approve').disabled, false, 'o Administrador pode conceder aprovação ao Editor');
    assert.equal(adminEditsEditor.get('audit:read').disabled, false, 'e consulta de auditoria também');
    assert.equal(adminEditsEditor.get('settings:manage').disabled, true, 'configurações globais nunca são delegadas');
    assert.match(adminEditsEditor.get('settings:manage').note, /Exclusivo do Administrador TI/);
    assert.equal(adminEditsEditor.get('user:manage').disabled, true, 'gestão de usuários é exclusiva da TI');
    assert.equal(states(admin, 'manager', defaultsOf('manager'), []).get('user:manage').disabled, true);

    const managerEditsEditor = states(manager, 'editor', defaultsOf('editor'), []);
    assert.equal(managerEditsEditor.get('media:approve').disabled, false, 'o Gestor concede o que ele mesmo tem');
    assert.equal(managerEditsEditor.get('audit:read').disabled, true);
    assert.match(managerEditsEditor.get('audit:read').note, /Somente o Administrador TI concede esta permissão/);

    const limitedManager = { role: 'manager', permissions: serverPermissions.ROLE_PERMISSIONS.manager.filter(id => id !== 'screen:delete') };
    const limited = states(limitedManager, 'editor', defaultsOf('editor'), []);
    assert.equal(limited.get('screen:delete').disabled, true);
    assert.match(limited.get('screen:delete').note, /Exclusivo do Administrador TI/);
    // Concessões antigas reservadas à TI não podem ser preservadas ou concedidas a perfis comuns.
    const legacyScreen = states(limitedManager, 'editor', [...defaultsOf('editor'), 'screen:delete'], ['screen:delete']).get('screen:delete');
    assert.equal(legacyScreen.disabled, true);
    assert.equal(legacyScreen.checked, false);

    const revoked = states(admin, 'editor', defaultsOf('editor').filter(id => id !== 'media:upload'), []);
    assert.deepEqual([revoked.get('media:upload').checked, revoked.get('media:upload').origin], [false, 'revoke']);
    const granted = states(admin, 'editor', [...defaultsOf('editor'), 'media:approve'], []);
    assert.deepEqual([granted.get('media:approve').checked, granted.get('media:approve').origin], [true, 'grant']);
    assert.equal(granted.size, catalog.permissions.length, 'toda permissão do catálogo aparece');
  });
});

test('permissões: textos de perfil estão completos para todos os perfis do servidor', () => {
  for (const role of serverPermissions.ROLES) {
    assert.ok(clientPermissions.ROLE_LABELS[role], `rótulo do perfil ${role}`);
    assert.ok(clientPermissions.ROLE_SUMMARIES[role], `resumo do perfil ${role}`);
  }
  assert.equal(clientPermissions.ROLE_LABELS.admin, 'Administrador TI');
  assert.deepEqual(Object.keys(clientPermissions.ROLE_LABELS), serverPermissions.ROLES);
});

test('permissões: "Gerar código de pareamento" está ligada no padrão de Editor e Gestor e pode ser retirada de uma pessoa; no Visualizador fica travada com o motivo', async () => {
  await withApp(async kit => {
    const catalog = must(await kit.call('/api/permissions', { session: kit.admin }));
    const admin = { role: 'admin', permissions: serverPermissions.PERMISSION_IDS };
    const defaultsOf = role => [...serverPermissions.ROLE_PERMISSIONS[role]];
    const states = (role, checked) => clientPermissions.permissionStates({ actor: admin, role, catalog, checked, existingGrants: [] });

    for (const role of ['editor', 'manager']) {
      const state = states(role, defaultsOf(role)).get('screen:pair');
      assert.deepEqual([state.checked, state.disabled, state.origin], [true, false, 'role'], `${role}: ligada no padrão do perfil e editável`);
      // Restrição individual: desmarcar vira "retirada" em relação ao perfil; marcar de novo volta ao padrão.
      const without = defaultsOf(role).filter(id => id !== 'screen:pair');
      assert.equal(states(role, without).get('screen:pair').origin, 'revoke');
      assert.deepEqual(clientPermissions.diffAgainstRole(role, without, catalog), { grants: [], revokes: ['screen:pair'] });
      assert.deepEqual(clientPermissions.diffAgainstRole(role, defaultsOf(role), catalog), { grants: [], revokes: [] });
    }
    const viewer = states('viewer', []).get('screen:pair');
    assert.deepEqual([viewer.checked, viewer.disabled], [false, true], 'o Visualizador não recebe a permissão nem por concessão');
    assert.match(viewer.note, /Editor e Gestor/);
    // As de administração de TVs continuam exclusivas, com o motivo de sempre; a nova não é uma delas.
    assert.equal(clientPermissions.ADMIN_ONLY_PERMISSIONS.includes('screen:pair'), false);
    assert.match(states('editor', defaultsOf('editor')).get('screen:activate').note, /Exclusivo do Administrador TI/);
    assert.equal(clientPermissions.hasPermission({ role: 'editor', active: true, permissions: ['screen:pair'] }, 'screen:pair'), true);
    assert.equal(clientPermissions.hasPermission({ role: 'editor', active: true, permissions: [] }, 'screen:pair'), false);
    assert.equal(clientPermissions.canIn({ role: 'editor', active: true, permissions: ['screen:pair'], unitIds: ['leste'], sectorIds: ['rh'] }, 'screen:pair', { unitId: 'centro', sectorId: 'rh' }), false);
    // O resumo de cada perfil, mostrado no formulário de usuário, diz o que o perfil faz com TVs.
    assert.match(clientPermissions.ROLE_SUMMARIES.editor, /gera o código de pareamento das TVs autorizadas/);
    assert.match(clientPermissions.ROLE_SUMMARIES.manager, /gera o código de pareamento dessas TVs/);
    assert.doesNotMatch(clientPermissions.ROLE_SUMMARIES.viewer, /pareamento/);
  });
});

test('permissões: criar e publicar programações estão ligadas no padrão do Editor e podem ser retiradas de uma pessoa; aprovar arquivos e publicar playlists continuam desligadas', async () => {
  await withApp(async kit => {
    const catalog = must(await kit.call('/api/permissions', { session: kit.admin }));
    const admin = { role: 'admin', permissions: serverPermissions.PERMISSION_IDS };
    const defaultsOf = role => [...serverPermissions.ROLE_PERMISSIONS[role]];
    const states = (role, checked) => clientPermissions.permissionStates({ actor: admin, role, catalog, checked, existingGrants: [] });
    const shown = (state, id) => [state.get(id).checked, state.get(id).disabled, state.get(id).origin];

    const editor = states('editor', defaultsOf('editor'));
    for (const id of ['schedule:create', 'schedule:publish']) assert.deepEqual(shown(editor, id), [true, false, 'role'], `${id}: ligada no padrão do Editor e editável`);
    for (const id of ['media:approve', 'playlist:publish']) assert.deepEqual(shown(editor, id), [false, false, 'none'], `${id}: continua fora do padrão do Editor`);
    // Quem só deve preparar rascunhos: desmarcar a publicação vira "retirada" em relação ao perfil; marcar de novo volta ao padrão.
    const drafterOnly = defaultsOf('editor').filter(id => id !== 'schedule:publish');
    assert.equal(states('editor', drafterOnly).get('schedule:publish').origin, 'revoke');
    assert.deepEqual(clientPermissions.diffAgainstRole('editor', drafterOnly, catalog), { grants: [], revokes: ['schedule:publish'] });
    assert.deepEqual(clientPermissions.diffAgainstRole('editor', defaultsOf('editor'), catalog), { grants: [], revokes: [] });
    // Conta que recebeu a programação como concessão individual antes de ela virar padrão: aparece como "do perfil" e a gravação não a repete.
    const legacy = clientPermissions.effectivePermissionSet('editor', ['schedule:create'], [], catalog);
    assert.deepEqual([...legacy].sort(), defaultsOf('editor').sort());
    assert.equal(states('editor', [...legacy]).get('schedule:create').origin, 'role');
    assert.deepEqual(clientPermissions.diffAgainstRole('editor', [...legacy], catalog), { grants: [], revokes: [] });
    // Gestor e Visualizador não mudam: o Gestor segue com as duas e o Visualizador com nenhuma.
    for (const id of ['schedule:create', 'schedule:publish']) {
      assert.deepEqual(shown(states('manager', defaultsOf('manager')), id), [true, false, 'role']);
      assert.deepEqual(shown(states('viewer', []), id), [false, false, 'none']);
    }
    // O resumo do perfil, mostrado no formulário de usuário, diz o que o Editor faz e o que continua com Gestor e TI.
    assert.match(clientPermissions.ROLE_SUMMARIES.editor, /cria e publica programações/);
    assert.match(clientPermissions.ROLE_SUMMARIES.editor, /Não aprova arquivos nem publica versões de playlist/);
    assert.match(clientPermissions.ROLE_SUMMARIES.editor, /gera o código de pareamento das TVs autorizadas/);
    assert.doesNotMatch(clientPermissions.ROLE_SUMMARIES.viewer, /programa/i);
  });
});
