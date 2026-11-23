import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTestApp, withApp, must, makeTempDir, removeTempDir, PASSWORD } from './helpers/app.mjs';
import { inProcess } from './helpers/http.mjs';
import { createLogger } from '../server/lib/logger.mjs';
import { loadConfig } from '../server/config.mjs';
import { clientIp, isLocalRequest, parseRequestUrl } from '../server/http/request.mjs';
import { bootstrapDevAdmin } from '../server/dev-admin.mjs';
import { createStaticServer } from '../server/http/static.mjs';

const HTTPS = 'https://tv.example.test';
const TOKEN = 'a'.repeat(40);

test('cabeçalhos de segurança em respostas da API e de arquivos estáticos', async () => {
  await withApp(async kit => {
    for (const route of ['/api/status', '/healthz', '/', '/index.html', '/api/nao-existe']) {
      const response = await kit.call(route);
      const h = name => response.headers.get(name);
      assert.equal(h('x-content-type-options'), 'nosniff', route);
      assert.equal(h('x-frame-options'), 'SAMEORIGIN', route);
      assert.equal(h('referrer-policy'), 'no-referrer', route);
      assert.equal(h('cross-origin-resource-policy'), 'same-origin', route);
      assert.match(h('permissions-policy'), /camera=\(\).*microphone=\(\).*geolocation=\(\)/, route);
      const csp = h('content-security-policy');
      for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", "form-action 'self'"]) assert.ok(csp.includes(directive), `${route}: ${directive}`);
      assert.ok(!/script-src[^;]*unsafe-inline/.test(csp) && !/script-src[^;]*unsafe-eval/.test(csp), 'sem script inline nem eval');
      assert.equal(h('x-powered-by'), undefined, route);
      assert.equal(h('strict-transport-security'), undefined, 'sem HSTS em http local');
    }
    assert.equal((await kit.call('/api/status')).headers.get('cache-control'), 'no-store', 'API nunca é guardada em cache');
    const page = await kit.call('/');
    assert.deepEqual([page.status, page.headers.get('content-type'), page.headers.get('cache-control')], [200, 'text/html; charset=utf-8', 'no-cache']);
  });
});

test('HSTS e cookie Secure sempre que a origem pública é HTTPS (inclusive homologação fora de produção)', async () => {
  await withApp(async kit => {
    const login = await kit.login(kit.adminUser.email, PASSWORD);
    assert.equal(login.status, 200);
    assert.match(login.setCookie, /^pwc_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/; Secure; Max-Age=28800$/);
    assert.equal(login.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal(kit.app.config.production, false, 'homologação com NODE_ENV diferente de production');
  }, { origin: HTTPS });
  await withApp(async kit => {
    const login = await kit.login(kit.adminUser.email, PASSWORD);
    assert.match(login.setCookie, /^pwc_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/);
    assert.ok(!/Secure/.test(login.setCookie), 'em http local o cookie não pode ser Secure (o navegador o descartaria)');
  });
});

test('encerrar sessão invalida o cookie no servidor, não só no navegador', async () => {
  await withApp(async kit => {
    const stolen = { ...kit.admin };
    const out = await kit.call('/api/logout', { method: 'POST', session: kit.admin });
    assert.equal(out.status, 200);
    assert.match(out.setCookie, /^pwc_session=; .*Max-Age=0$/);
    assert.equal((await kit.call('/api/me', { session: stolen })).status, 401, 'o cookie copiado antes do logout não funciona mais');
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    // Sessão expirada: recusada e removida.
    const again = (await kit.login(kit.adminUser.email, PASSWORD)).session;
    kit.app.db.prepare('UPDATE sessions SET expires=?').run(Date.now() - 1);
    assert.equal((await kit.call('/api/me', { session: again })).status, 401);
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0, 'sessão expirada é apagada');
  });
});

test('endereços malformados ou hostis recebem 400/404 sem derrubar o servidor nem sair da pasta pública', async () => {
  await withApp(async kit => {
    for (const bad of ['/%E0%A4%A', '//evil.example/x', '/%00', '/api/%00', 'http://evil.example/', '', '/a%']) {
      const response = await inProcess(kit.app, bad);
      assert.equal(response.status, 400, JSON.stringify(bad));
      assert.deepEqual(Object.keys(JSON.parse(response.bytes)), ['error']);
    }
    for (const hidden of ['/..%2fpackage.json', '/..%2fserver/core.mjs', '/..%2f..%2fserver/core.mjs', '/%2e%2e%2fpackage.json', '/../../etc/passwd', '/.env', '/.git/config', '/package.json', '/server/core.mjs', '/data/tvcorp.sqlite', '/tests/helpers/app.mjs', '/%2e%2e/package.json', '/public/../package.json', '/scripts/backup.mjs']) {
      const response = await inProcess(kit.app, hidden);
      assert.equal(response.status, 404, hidden);
      assert.ok(!/tvcorp|DatabaseSync|SELECT/.test(response.bytes.toString()), hidden);
    }
    assert.equal((await inProcess(kit.app, '/', { method: 'POST' })).status, 405);
    assert.equal((await inProcess(kit.app, '/api/status', { method: 'OPTIONS' })).status, 405);
    assert.equal((await inProcess(kit.app, '/', { method: 'HEAD' })).bytes.length, 0, 'HEAD não devolve corpo');
    assert.equal((await kit.call('/api/status')).status, 200, 'continua respondendo');
    // Quem não entrou não consegue nem descobrir quais rotas existem.
    assert.equal((await kit.call('/api/nao-existe')).status, 401);
    assert.equal((await kit.call('/api/nao-existe', { session: kit.admin })).status, 404);
    assert.equal((await kit.call('/api/state', { method: 'DELETE', session: kit.admin })).status, 404);
    assert.throws(() => parseRequestUrl({ url: 'noslash' }, 'http://x.test'), { status: 400 });
  });
});

test('arquivos estáticos: revalidação por ETag e nada além da pasta pública', async () => {
  await withApp(async kit => {
    const first = await kit.call('/');
    const etag = first.headers.get('etag');
    assert.match(etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/);
    const cached = await kit.call('/', { headers: { 'If-None-Match': etag } });
    assert.deepEqual([cached.status, cached.bytes.length, cached.headers.get('etag')], [304, 0, etag]);
    assert.equal((await kit.call('/', { headers: { 'If-None-Match': 'W/"outro"' } })).status, 200);
    assert.equal((await kit.call('/arquivo-que-nao-existe.js')).status, 404);
    assert.equal((await kit.call('/logo')).status, 404, 'sem extensão conhecida não é servido');
  });
});

test('servidor de arquivos estáticos: confinado à pasta pública, sem arquivos ocultos nem tipos desconhecidos', async () => {
  const dir = makeTempDir('tvcorp-test-');
  try {
    const publicDir = path.join(dir, 'public');
    mkdirSync(path.join(publicDir, 'sub', '.escondida'), { recursive: true });
    writeFileSync(path.join(publicDir, 'index.html'), '<h1>inicio</h1>');
    writeFileSync(path.join(publicDir, 'ok.js'), 'export {}');
    writeFileSync(path.join(publicDir, '.segredo.html'), 'oculto');
    writeFileSync(path.join(publicDir, 'sub', '.escondida', 'x.html'), 'oculto');
    writeFileSync(path.join(publicDir, 'sub', 'dentro.html'), 'dentro');
    writeFileSync(path.join(publicDir, 'arquivo.exe'), 'MZ');
    writeFileSync(path.join(dir, 'fora.html'), 'fora da pasta pública');
    writeFileSync(path.join(publicDir, 'c:dados.json'), '{}');
    writeFileSync(path.join(dir, 'public-irmao.html'), 'pasta irmã com o mesmo prefixo');
    const serve = createStaticServer(publicDir);
    const run = async (pathname, method = 'GET') => {
      const res = { statusCode: 0, headers: {}, body: undefined, setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(body) { this.body = body; } };
      try { await serve({ method, headers: {} }, res, pathname); } catch (error) { return { status: error.status, body: undefined }; }
      return { status: res.statusCode, body: res.body?.toString(), type: res.headers['content-type'] };
    };
    assert.deepEqual(await run('/'), { status: 200, body: '<h1>inicio</h1>', type: 'text/html; charset=utf-8' });
    assert.equal((await run('/ok.js')).type, 'text/javascript; charset=utf-8');
    assert.equal((await run('/sub/dentro.html')).body, 'dentro');
    for (const hidden of ['/.segredo.html', '/sub/.escondida/x.html', '/sub/./.escondida/x.html']) assert.equal((await run(hidden)).status, 404, hidden);
    for (const outside of ['/../fora.html', '/sub/../../fora.html', '/../public-irmao.html', '/..\\fora.html', '/sub/..\\..\\fora.html']) {
      const result = await run(outside);
      assert.equal(result.status, 404, outside);
      assert.ok(!(result.body ?? '').includes('fora da pasta'), outside);
    }
    for (const drive of ['/C:/Windows/segredo.json', '/c:dados.json', '/sub/..\\ok.js', '/D:\\dados\\x.json']) assert.equal((await run(drive)).status, 404, `${drive}: letra de unidade/barra invertida não é aceita`);
    assert.equal((await run('/arquivo.exe')).status, 404, 'tipo desconhecido não é servido');
    assert.equal((await run('/sub')).status, 404, 'diretório não é listado');
    assert.equal((await run('/nao-existe.html')).status, 404);
    assert.equal((await run('/ok.js', 'POST')).status, 405);
    assert.equal((await run('/ok.js', 'DELETE')).status, 405);
  } finally { removeTempDir(dir); }
});

test('verificação de saúde e status públicos não revelam segredos nem dados', async () => {
  await withApp(async kit => {
    const health = must(await kit.call('/healthz'));
    assert.deepEqual(Object.keys(health).sort(), ['ok', 'schema', 'version']);
    const status = must(await kit.call('/api/status'));
    assert.deepEqual(Object.keys(status).sort(), ['configured', 'maxUploadMB', 'mode', 'scannerConfigured', 'setupEnabled', 'version']);
    assert.deepEqual([status.configured, status.mode, status.setupEnabled], [true, 'local', false]);
    const text = JSON.stringify([health, status]);
    assert.ok(!text.includes(kit.dataDir) && !text.includes('admin@'));
    assert.ok(!('setupToken' in kit.app.config) && Object.isFrozen(kit.app.config));
  }, { setupToken: TOKEN });
});

test('configuração inicial: só no próprio servidor, com token, origem correta e senha forte', async () => {
  const { app, dataDir, api } = createTestApp({ setupToken: TOKEN });
  try {
    const body = { token: TOKEN, name: 'TI', email: 'ti@example.invalid', password: 'Senha-valida-12345' };
    const setup = (extra = {}) => api.call('/api/setup', { method: 'POST', body, ...extra });
    assert.equal((await api.call('/api/status')).data.setupEnabled, true);
    assert.equal((await setup({ remoteAddress: '10.1.2.3' })).status, 403, 'de outra máquina não vale como acesso local (contado à parte, por endereço)');
    // As demais tentativas partem do próprio servidor (mesmo endereço): o limite é de 5 por 15 minutos.
    assert.equal((await setup({ headers: { 'X-Forwarded-For': '203.0.113.7' } })).status, 403, 'atrás de proxy não vale como acesso local');
    assert.equal((await setup({ headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await api.call('/api/setup', { method: 'POST', body: { ...body, token: 'b'.repeat(40) } })).status, 403);
    assert.equal((await api.call('/api/setup', { method: 'POST', body: { ...body, token: '' } })).status, 403);
    assert.equal((await api.call('/api/setup', { method: 'POST', body: { ...body, password: 'curta' } })).status, 400);
    assert.equal((await setup()).status, 429, 'a sexta tentativa do mesmo endereço é barrada, mesmo correta');
    assert.equal((await setup({ remoteAddress: '10.1.2.3' })).status, 403, 'outro endereço continua sendo avaliado normalmente');
    assert.equal(app.configured(), false, 'nenhuma tentativa inválida criou conta');
  } finally { await app.close(); removeTempDir(dataDir); }

  const second = createTestApp({ setupToken: TOKEN });
  try {
    const body = { token: TOKEN, name: 'TI', email: 'ti@example.invalid', password: 'Senha-valida-12345' };
    const first = await second.api.call('/api/setup', { method: 'POST', body });
    assert.equal(first.status, 201);
    assert.match(first.setCookie, /^pwc_session=/);
    assert.equal((await second.api.call('/api/me', { session: { cookie: first.cookie, csrf: first.data.csrf } })).data.user.role, 'admin');
    assert.equal((await second.api.call('/api/setup', { method: 'POST', body: { ...body, email: 'outro@example.invalid' } })).status, 409, 'só existe um primeiro administrador');
    assert.deepEqual(await second.api.call('/api/status').then(r => [r.data.configured, r.data.setupEnabled]), [true, false]);
  } finally { await second.app.close(); removeTempDir(second.dataDir); }

  const disabled = createTestApp({ setupToken: 'curto' });
  try {
    const response = await disabled.api.call('/api/setup', { method: 'POST', body: { token: 'curto', name: 'TI', email: 'ti@example.invalid', password: 'Senha-valida-12345' } });
    assert.equal(response.status, 403, 'token com menos de 32 caracteres desabilita a configuração por HTTP');
  } finally { await disabled.app.close(); removeTempDir(disabled.dataDir); }
});

test('CSRF e origem: mutações exigem o token da sessão e a origem esperada', async () => {
  await withApp(async kit => {
    const body = { name: 'Pasta', unitId: 'leste', sectorId: 'rh' };
    const post = (extra = {}) => kit.call('/api/folders', { method: 'POST', body, ...extra });
    assert.equal((await post({ headers: { Cookie: kit.admin.cookie } })).status, 403, 'cookie sem token CSRF');
    assert.equal((await post({ headers: { Cookie: kit.admin.cookie, 'X-CSRF-Token': 'errado' } })).status, 403);
    assert.equal((await post({ session: kit.admin, headers: { Origin: 'https://evil.example' } })).status, 403, 'origem diferente');
    assert.equal((await post({ session: kit.admin, headers: { Origin: kit.app.config.origin } })).status, 201, 'origem correta');
    assert.equal((await post({ session: { cookie: kit.admin.cookie, csrf: 'x'.repeat(43) } })).status, 403);
    const login = await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: PASSWORD }, headers: { Origin: 'https://evil.example' } });
    assert.equal(login.status, 403, 'login também confere a origem');
    assert.equal((await kit.call('/api/state', { headers: { Cookie: kit.admin.cookie } })).status, 200, 'leitura (GET) não exige token CSRF');
    const other = await kit.createUser('manager');
    assert.equal((await post({ session: { cookie: kit.admin.cookie, csrf: other.session.csrf } })).status, 403, 'token CSRF de outra sessão não vale');
  });
});

test('limites de tentativa de login: por endereço e por conta; X-Forwarded-For não vale sem proxy confiável', async () => {
  // Sem TRUST_PROXY: girar o cabeçalho não dá endereços novos.
  await withApp(async kit => {
    // O limite é de 12 tentativas (certas ou erradas) por endereço; a entrada do administrador no preparo do teste já usou uma.
    for (let i = 1; i <= 11; i++) {
      const response = await kit.call('/api/login', { method: 'POST', body: { email: `ninguem${i}@example.invalid`, password: 'errada-errada-12' }, headers: { 'X-Forwarded-For': `198.51.100.${i}` } });
      assert.equal(response.status, 401, `tentativa ${i}`);
    }
    const blocked = await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: PASSWORD }, headers: { 'X-Forwarded-For': '198.51.100.99' } });
    assert.equal(blocked.status, 429);
    assert.equal((await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: PASSWORD }, remoteAddress: '10.9.9.9' })).status, 200, 'outro endereço real não é afetado');
  });
  // Com TRUST_PROXY=1: vale o último endereço da cadeia (o que o proxy confiável acrescentou); o que vem antes é forjável.
  await withApp(async kit => {
    const attempt = (forwarded, email) => kit.call('/api/login', { method: 'POST', body: { email, password: 'errada-errada-12' }, headers: { 'X-Forwarded-For': forwarded }, remoteAddress: '10.0.0.1' });
    for (let i = 1; i <= 12; i++) assert.equal((await attempt(`forjado-${i}, 203.0.113.9`, `x${i}@example.invalid`)).status, 401);
    assert.equal((await attempt('outro-forjado, 203.0.113.9', 'x13@example.invalid')).status, 429, 'mesmo cliente real, apesar do prefixo forjado');
    assert.equal((await attempt('198.51.100.4', 'y1@example.invalid')).status, 401, 'outro cliente real');
  }, { trustProxy: 1 });
  // Limite por conta: 12 erros bloqueiam a conta mesmo vindo de endereços diferentes (comportamento herdado da 1.1.0).
  await withApp(async kit => {
    // 12 tentativas por conta: a entrada do preparo do teste já contou uma.
    for (let i = 1; i <= 11; i++) assert.equal((await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: 'errada-errada-12' }, remoteAddress: `10.1.0.${i}` })).status, 401);
    assert.equal((await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: PASSWORD }, remoteAddress: '10.1.0.200' })).status, 429, 'conta bloqueada mesmo com a senha certa e outro endereço');
    assert.equal((await kit.call('/api/login', { method: 'POST', body: { email: 'outra@example.invalid', password: PASSWORD }, remoteAddress: '10.1.0.200' })).status, 401, 'outras contas seguem normais');
  });
});

test('clientIp e isLocalRequest: contagem a partir da direita e recusa de entradas estranhas', () => {
  const req = (forwarded, remoteAddress = '10.0.0.1', extra = {}) => ({ socket: { remoteAddress }, headers: { ...(forwarded === undefined ? {} : { 'x-forwarded-for': forwarded }), ...extra } });
  assert.equal(clientIp(req('1.1.1.1, 2.2.2.2'), 0), '10.0.0.1', 'sem proxy confiável, ignora o cabeçalho');
  assert.equal(clientIp(req('1.1.1.1, 2.2.2.2'), 1), '2.2.2.2');
  assert.equal(clientIp(req('1.1.1.1, 2.2.2.2, 3.3.3.3'), 2), '2.2.2.2');
  assert.equal(clientIp(req('9.9.9.9'), 3), '9.9.9.9', 'cadeia menor que o número de proxies usa o primeiro');
  assert.equal(clientIp(req('lixo<script>'), 1), '10.0.0.1', 'valor fora do formato de endereço é descartado');
  assert.equal(clientIp(req(undefined), 1), '10.0.0.1');
  assert.equal(clientIp({ headers: {}, socket: {} }, 0), 'unknown');
  assert.equal(isLocalRequest(req(undefined, '127.0.0.1')), true);
  assert.equal(isLocalRequest(req(undefined, '::1')), true);
  assert.equal(isLocalRequest(req(undefined, '::ffff:127.0.0.1')), true);
  assert.equal(isLocalRequest(req('8.8.8.8', '127.0.0.1')), false, 'proxy local repassando cliente externo não é local');
  assert.equal(isLocalRequest(req(undefined, '127.0.0.1', { forwarded: 'for=8.8.8.8' })), false);
  assert.equal(isLocalRequest(req(undefined, '127.0.0.1', { 'x-real-ip': '8.8.8.8' })), false);
  assert.equal(isLocalRequest(req(undefined, '192.168.0.10')), false);
});

test('corpo da requisição: tipo, tamanho e formato do JSON são validados', async () => {
  await withApp(async kit => {
    const send = (body, headers = {}) => kit.call('/api/folders', { method: 'POST', session: kit.admin, body, headers });
    const raw = (text, type = 'application/json') => kit.call('/api/folders', { method: 'POST', session: kit.admin, body: Buffer.from(text), headers: { 'Content-Type': type } });
    assert.equal((await raw('{"name":', 'application/json')).status, 400, 'JSON truncado');
    assert.equal((await raw('[1,2]')).status, 400, 'lista no lugar de objeto');
    assert.equal((await raw('"texto"')).status, 400);
    assert.equal((await raw('null')).status, 400);
    assert.equal((await raw('{"name":"x"}', 'text/plain')).status, 415);
    assert.equal((await raw(JSON.stringify({ name: 'x'.repeat(70 * 1024) }))).status, 413, 'mais de 64 KB de JSON');
    assert.equal((await send({ name: 'ok', unitId: 'leste', sectorId: 'rh', extra: { __proto__: { polluted: true } } })).status, 201, 'campos extras são ignorados');
    assert.equal(({}).polluted, undefined, 'sem poluição de protótipo');
    assert.equal((await raw('{"__proto__":{"polluted":true},"name":"p","unitId":"leste","sectorId":"rh"}')).status, 201);
    assert.equal(({}).polluted, undefined);
  });
});

test('falhas internas devolvem mensagem genérica; o registro técnico nunca leva senha, token nem cookie', async () => {
  const lines = [];
  const logger = createLogger({ level: 'debug', sink: line => lines.push(line) });
  await withApp(async kit => {
    const secret = 'senha-super-secreta-do-teste';
    await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: secret } });
    const tv = await kit.pairedDisplay(kit.admin);
    await kit.upload(kit.admin, { name: 'a.png' });
    const original = kit.app.services.audit.list;
    kit.app.services.audit.list = () => { throw new Error('/home/servidor/segredo.sqlite: SQLITE_CORRUPT'); };
    const crashed = await kit.call('/api/audit', { session: kit.admin });
    kit.app.services.audit.list = original;
    assert.deepEqual([crashed.status, crashed.data], [500, { error: 'Falha interna. Consulte a equipe de TI.' }]);
    assert.ok(!JSON.stringify(crashed.data).includes('segredo'));
    assert.equal((await kit.call('/api/audit', { session: kit.admin })).status, 200, 'o servidor segue de pé');
    const written = lines.join('\n');
    assert.ok(written.includes('Falha interna'), 'o erro técnico foi registrado para a TI');
    for (const forbidden of [secret, PASSWORD, kit.admin.csrf, kit.admin.cookie.split('=')[1], tv.token]) assert.ok(!written.includes(forbidden), 'segredo fora dos registros');
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), 'uma linha JSON por evento');
  }, { logger });
});

test('login não revela se a conta existe, registra a tentativa sem a senha e respeita contas desativadas', async () => {
  await withApp(async kit => {
    const unknown = await kit.call('/api/login', { method: 'POST', body: { email: 'ninguem@example.invalid', password: 'qualquer-senha-123' } });
    const wrong = await kit.call('/api/login', { method: 'POST', body: { email: kit.adminUser.email, password: 'senha-errada-12345' } });
    assert.deepEqual([unknown.status, wrong.status], [401, 401]);
    assert.deepEqual(unknown.data, wrong.data, 'mesma resposta para conta inexistente e senha errada');
    const user = await kit.createUser('editor');
    must(await kit.call(`/api/users/${user.user.id}`, { method: 'PATCH', session: kit.admin, body: { active: false } }));
    const inactive = await kit.call('/api/login', { method: 'POST', body: { email: user.email, password: PASSWORD } });
    assert.deepEqual([inactive.status, inactive.data], [401, unknown.data]);
    for (const body of [{}, { email: 1, password: 2 }, { email: kit.adminUser.email }, { password: PASSWORD }, { email: { $ne: null }, password: { $ne: null } }]) {
      assert.equal((await kit.call('/api/login', { method: 'POST', body })).status, 401, JSON.stringify(body));
    }
    const failed = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events.filter(e => e.action === 'auth.login.failed');
    assert.ok(failed.length >= 3 && failed.every(e => e.detail.ip === '127.0.0.1' && !JSON.stringify(e).includes('senha-errada')));
    assert.ok(failed.some(e => e.detail.email === 'ninguem@example.invalid'));
  });
});

test('senha digitada por engano no campo e-mail não fica gravada na trilha de auditoria', async () => {
  await withApp(async kit => {
    const slipped = 'Minha-Senha-Secreta-2026!';
    const attempts = [slipped, `${slipped} com espaço`, 'sem-arroba.example.invalid', 'a@b', `${'x'.repeat(300)}@example.invalid`, 'x@y.z'];
    for (const email of attempts) {
      const response = await kit.call('/api/login', { method: 'POST', body: { email, password: email === slipped ? slipped : 'senha-errada-12345' } });
      assert.equal(response.status, 401, email.slice(0, 30));
    }
    const events = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events.filter(e => e.action === 'auth.login.failed');
    assert.equal(events.length, attempts.length);
    const text = JSON.stringify(events);
    assert.ok(!text.includes(slipped) && !text.includes('sem-arroba') && !text.includes('xxxxxxxx'), 'texto sem formato de e-mail nunca é gravado');
    assert.equal(events.filter(e => e.detail.email === null).length, 5, 'cinco tentativas sem formato de e-mail: nada gravado');
    assert.equal(events.filter(e => e.detail.email === 'x@y.z').length, 1, 'e-mail de verdade continua registrado');
    assert.ok(events.every(e => e.detail.ip === '127.0.0.1'), 'o endereço de rede continua registrado para a investigação');
  });
});

test('validação da configuração (variáveis de ambiente) falha cedo e com mensagem clara', () => {
  const env = overrides => loadConfig({ env: { NODE_ENV: 'development', ...overrides } });
  assert.throws(() => env({ TRUST_PROXY: 'banana' }), /TRUST_PROXY/);
  assert.throws(() => env({ TRUST_PROXY: '6' }), /TRUST_PROXY/);
  assert.deepEqual(['true', '2', 'false', '', '0', undefined].map(value => env({ TRUST_PROXY: value }).trustProxy), [1, 2, 0, 0, 0, 0]);
  for (const value of ['0', '16', '2.5', 'abc']) assert.throws(() => env({ PLAYLIST_MAX_ITEMS: value }), /PLAYLIST_MAX_ITEMS/, value);
  assert.deepEqual(['1', '6', '15'].map(value => env({ PLAYLIST_MAX_ITEMS: value }).playlistMaxItems), [1, 6, 15]);
  assert.equal(env({}).playlistMaxItems, 6, 'padrão: 6 itens');
  for (const value of ['0', '0.5', '0.001', '251', 'abc', '-5']) assert.throws(() => env({ MAX_UPLOAD_MB: value }), /MAX_UPLOAD_MB/, value);
  assert.deepEqual(['1', '50', '250'].map(value => env({ MAX_UPLOAD_MB: value }).maxUpload / 1024 / 1024), [1, 50, 250]);
  assert.equal(env({}).maxUpload, 50 * 1024 * 1024, 'padrão: 50 MB');
  // Somente a opção explícita, usada pelos testes, aceita limites abaixo de 1 MB.
  assert.equal(loadConfig({ env: { NODE_ENV: 'development' }, maxUpload: 0.01 }).maxUpload, 0.01 * 1024 * 1024);
  assert.throws(() => loadConfig({ env: { NODE_ENV: 'development' }, maxUpload: 0 }), /MAX_UPLOAD_MB/, 'nem a opção explícita aceita zero');
  for (const origin of ['http://x.test/app', 'http://x.test/', 'ftp://x.test', 'tv.example.com', 'htp://x.test', '']) assert.throws(() => env({ APP_ORIGIN: origin }), /APP_ORIGIN/, JSON.stringify(origin));
  assert.throws(() => loadConfig({ env: { NODE_ENV: 'production', APP_ORIGIN: 'http://x.test', MALWARE_SCANNER: '/usr/bin/clamscan' } }), /Produção exige/);
  assert.throws(() => loadConfig({ env: { NODE_ENV: 'production', APP_ORIGIN: HTTPS } }), /Produção exige/);
  const production = loadConfig({ env: { NODE_ENV: 'production', APP_ORIGIN: HTTPS, MALWARE_SCANNER: '/usr/bin/clamscan' } });
  assert.deepEqual([production.production, production.secureCookies], [true, true]);
  const custom = env({ DATA_DIR: '/var/lib/tvcorp', DB_PATH: '/srv/db/tvcorp.sqlite', BACKUP_DIR: '/srv/backups' });
  assert.deepEqual([custom.dbPath, custom.mediaDir, custom.backupDir], ['/srv/db/tvcorp.sqlite', '/var/lib/tvcorp/media', '/srv/backups'].map(value => path.resolve(value)));
  assert.deepEqual([env({ DATA_DIR: '/var/lib/tvcorp' }).dbPath, env({}).secureCookies, env({ APP_ORIGIN: HTTPS }).secureCookies], [path.resolve('/var/lib/tvcorp/tvcorp.sqlite'), false, true]);
  assert.ok(Object.isFrozen(env({})));
});

test('administrador de homologação: só com NODE_ENV=development e variáveis TEST_ADMIN_*; nunca em produção', () => {
  const calls = [];
  const app = configured => ({ configured: () => configured, createAdmin: (...args) => calls.push(args) });
  const quiet = { info() {} };
  const full = { TEST_ADMIN_NAME: 'Teste', TEST_ADMIN_EMAIL: 'teste@example.invalid', TEST_ADMIN_PASSWORD: 'Senha-do-ambiente-123' };
  assert.equal(bootstrapDevAdmin(app(false), { NODE_ENV: 'production', ...full }, quiet), false, 'produção ignora as variáveis');
  assert.equal(bootstrapDevAdmin(app(false), { ...full }, quiet), false, 'sem NODE_ENV=development não cria');
  assert.equal(bootstrapDevAdmin(app(false), { NODE_ENV: 'development' }, quiet), false, 'sem variáveis não cria');
  assert.equal(bootstrapDevAdmin(app(false), { NODE_ENV: 'development', TEST_ADMIN_NAME: 'x', TEST_ADMIN_EMAIL: 'y' }, quiet), false, 'variáveis incompletas');
  assert.equal(bootstrapDevAdmin(app(true), { NODE_ENV: 'development', ...full }, quiet), false, 'já configurado');
  assert.deepEqual(calls, []);
  assert.equal(bootstrapDevAdmin(app(false), { NODE_ENV: 'development', ...full }, quiet), true);
  assert.deepEqual(calls, [['Teste', 'teste@example.invalid', 'Senha-do-ambiente-123']]);
});
