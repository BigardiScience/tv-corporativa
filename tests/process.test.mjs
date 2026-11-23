import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { makeTempDir, removeTempDir, cleanEnv, projectRoot, writeScanner } from './helpers/app.mjs';
import { PNG } from './helpers/http.mjs';

const ADMIN = { TEST_ADMIN_NAME: 'Admin do teste', TEST_ADMIN_EMAIL: 'admin@processo.example', TEST_ADMIN_PASSWORD: 'Senha-do-processo-12345' };

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

// Executa o servidor de verdade (processo separado, portas reais), como o `npm start`.
function startServer(env) {
  const child = spawn(process.execPath, ['--no-warnings', path.join(projectRoot, 'server', 'index.mjs')], { cwd: projectRoot, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [], err = [];
  let buffered = '';
  child.stdout.on('data', chunk => { buffered += chunk; const parts = buffered.split('\n'); buffered = parts.pop(); out.push(...parts.filter(Boolean)); });
  child.stderr.on('data', chunk => err.push(String(chunk)));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`servidor não iniciou em 15 s. stdout=${out.join('|')} stderr=${err.join('')}`)), 15000);
    const poll = setInterval(() => { if (out.some(line => /TV Corporativa .* em http/.test(line))) { clearInterval(poll); clearTimeout(timer); resolve(); } }, 25);
    exited.then(result => { clearInterval(poll); clearTimeout(timer); reject(new Error(`servidor encerrou (${result.code}) antes de iniciar. stdout=${out.join('|')} stderr=${err.join('')}`)); });
  });
  const stop = async () => { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 8000); const result = await exited; clearTimeout(timer); return result; };
  return { child, out, err, ready, exited, stop };
}

async function api(base, route, { method = 'GET', body, session, headers = {} } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(10000) };
  if (session) { init.headers.Cookie = session.cookie; init.headers['X-CSRF-Token'] = session.csrf; }
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const response = await fetch(base + route, init);
  const text = Buffer.from(await response.arrayBuffer());
  let data; try { data = JSON.parse(text.toString()); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

test('servidor real: inicia, cria o administrador de homologação, atende por HTTP, encerra com SIGTERM e mantém os dados ao reiniciar', { timeout: 120000 }, async () => {
  const dir = makeTempDir('tvcorp-test-');
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env = { PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, NODE_ENV: 'development', APP_ORIGIN: base, ...ADMIN };
  let server = startServer(env);
  try {
    await server.ready;
    assert.equal((await api(base, '/healthz')).data.ok, true);
    const status = (await api(base, '/api/status')).data;
    assert.deepEqual([status.configured, status.mode], [true, 'local'], 'o administrador de homologação foi criado a partir do ambiente');
    const home = await api(base, '/');
    assert.deepEqual([home.status, home.headers.get('content-type'), home.headers.has('content-security-policy')], [200, 'text/html; charset=utf-8', true]);
    assert.equal((await api(base, '/api/state')).status, 401);

    const login = await api(base, '/api/login', { method: 'POST', body: { email: ADMIN.TEST_ADMIN_EMAIL, password: ADMIN.TEST_ADMIN_PASSWORD } });
    assert.equal(login.status, 200);
    const session = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: login.data.csrf };
    const me = await api(base, '/api/me', { session });
    assert.deepEqual([me.data.user.role, me.data.user.email], ['admin', ADMIN.TEST_ADMIN_EMAIL]);
    const folder = await api(base, '/api/folders', { method: 'POST', session, body: { unitId: 'leste', sectorId: 'rh', name: 'Pasta do processo' } });
    assert.equal(folder.status, 201);
    const upload = await api(base, `/api/media?name=p.png&unitId=leste&sectorId=rh&folderId=${folder.data.id}`, { method: 'POST', session, body: PNG });
    assert.equal(upload.status, 201);
    const file = await api(base, `/api/media/${upload.data.id}/file`, { session, headers: { Range: 'bytes=0-7' } });
    assert.deepEqual([file.status, file.headers.get('content-range')], [206, `bytes 0-7/${PNG.length}`]);
    assert.ok(Buffer.from(file.data).equals(PNG.subarray(0, 8)), 'os 8 primeiros bytes de um PNG, entregues por Range sobre HTTP real');

    const stopped = await server.stop();
    // No Windows, SIGTERM encerra o processo à força (não existe sinal POSIX); o desligamento ordenado é verificado onde ele existe.
    if (process.platform !== 'win32') assert.deepEqual([stopped.code, stopped.signal], [0, null], 'SIGTERM encerra com código 0 (desligamento ordenado)');
    const logs = server.out.join('\n') + server.err.join('');
    assert.ok(!logs.includes(ADMIN.TEST_ADMIN_PASSWORD), 'a senha do ambiente nunca aparece no registro');
    for (const line of server.out) assert.doesNotThrow(() => JSON.parse(line), 'o registro é JSON, uma linha por evento');

    // Reinício com os mesmos dados: conta, pasta e arquivo continuam lá, e o administrador de homologação não é recriado.
    server = startServer(env);
    await server.ready;
    const again = await api(base, '/api/login', { method: 'POST', body: { email: ADMIN.TEST_ADMIN_EMAIL, password: ADMIN.TEST_ADMIN_PASSWORD } });
    assert.equal(again.status, 200);
    const next = { cookie: again.headers.get('set-cookie').split(';')[0], csrf: again.data.csrf };
    const library = await api(base, `/api/library?unitId=leste&sectorId=rh&folderId=${folder.data.id}`, { session: next });
    assert.deepEqual(library.data.media.map(m => m.id), [upload.data.id]);
    const second = await server.stop();
    if (process.platform !== 'win32') assert.equal(second.code, 0);
  } finally {
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
    removeTempDir(dir);
  }
});

// Espera o processo terminar sozinho. Se ele subir normalmente, o teste falha (em vez de ficar pendurado).
async function expectStartupFailure(server, label) {
  server.ready.then(() => { throw new Error(`${label}: o servidor deveria ter recusado iniciar`); }).catch(() => {});
  let timer;
  const verdict = await Promise.race([
    server.exited.then(result => ({ result })),
    new Promise(resolve => { timer = setTimeout(() => resolve({ hung: true }), 10000); })
  ]);
  clearTimeout(timer);
  if (verdict.hung) { server.child.kill('SIGKILL'); assert.fail(`${label}: o servidor continuou rodando, mas deveria ter recusado iniciar. stdout=${server.out.join('|')}`); }
  return verdict.result;
}

test('servidor real: porta ocupada e configuração inválida terminam com mensagem clara, sem pilha de erro', { timeout: 120000 }, async () => {
  const dir = makeTempDir('tvcorp-test-');
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const first = startServer({ PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, NODE_ENV: 'development', APP_ORIGIN: base });
  try {
    await first.ready;
    const dir2 = makeTempDir('tvcorp-test-');
    try {
      const second = startServer({ PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir2, NODE_ENV: 'development', APP_ORIGIN: base });
      const result = await expectStartupFailure(second, 'porta ocupada');
      assert.equal(result.code, 1, 'processo termina com erro');
      const text = second.out.join('\n');
      assert.match(text, /já está em uso/);
      assert.match(text, new RegExp(`porta ${port}`));
      assert.ok(!/at .*\.mjs:\d+/.test(text + second.err.join('')), 'sem pilha de erro para a pessoa que opera');
    } finally { removeTempDir(dir2); }
    for (const [name, env, pattern] of [
      ['produção sem HTTPS', { NODE_ENV: 'production', APP_ORIGIN: 'http://127.0.0.1:1', MALWARE_SCANNER: '/bin/true' }, /Produção exige/],
      ['produção sem antivírus', { NODE_ENV: 'production', APP_ORIGIN: 'https://tv.example.test' }, /Produção exige/],
      ['limite de itens inválido', { NODE_ENV: 'development', PLAYLIST_MAX_ITEMS: '99' }, /PLAYLIST_MAX_ITEMS/],
      ['origem inválida', { NODE_ENV: 'development', APP_ORIGIN: 'tv.example.com' }, /APP_ORIGIN/]
    ]) {
      const scratch = makeTempDir('tvcorp-test-');
      try {
        const bad = startServer({ DATA_DIR: scratch, PORT: String(await freePort()), HOST: '127.0.0.1', ...env });
        const result = await expectStartupFailure(bad, name);
        assert.equal(result.code, 1, name);
        assert.match(bad.out.join('\n'), pattern, name);
        assert.ok(!/at .*\.mjs:\d+/.test(bad.out.join('\n') + bad.err.join('')), `${name}: sem pilha de erro`);
      } finally { removeTempDir(scratch); }
    }
  } finally {
    if (first.child.exitCode === null) { await first.stop(); }
    removeTempDir(dir);
  }
});

test('servidor real: as variáveis TEST_ADMIN_* só valem em NODE_ENV=development (nem sem NODE_ENV, nem em produção)', { timeout: 120000 }, async t => {
  const credentials = { TEST_ADMIN_NAME: 'Admin do teste', TEST_ADMIN_EMAIL: 'admin@processo.example', TEST_ADMIN_PASSWORD: 'Senha-do-processo-12345' };
  const dir = makeTempDir('tvcorp-test-');
  const scanner = writeScanner(dir, 'clean');
  try {
    for (const [name, extra] of [
      ['sem NODE_ENV', {}],
      ['NODE_ENV=test', { NODE_ENV: 'test' }],
      ['produção', { NODE_ENV: 'production', MALWARE_SCANNER: scanner, APP_ORIGIN: 'https://tv.example.test' }]
    ]) {
      const data = makeTempDir('tvcorp-test-');
      const port = await freePort(), base = `http://127.0.0.1:${port}`;
      const server = startServer({ PORT: String(port), HOST: '127.0.0.1', DATA_DIR: data, APP_ORIGIN: base, ...extra, ...credentials });
      try {
        await server.ready;
        const status = await api(base, '/api/status');
        assert.equal(status.data.configured, false, `${name}: nenhuma conta é criada a partir do ambiente`);
        const login = await api(base, '/api/login', { method: 'POST', body: { email: credentials.TEST_ADMIN_EMAIL, password: credentials.TEST_ADMIN_PASSWORD } });
        assert.equal(login.status, 401, `${name}: as credenciais do ambiente não abrem sessão`);
        assert.ok(!(server.out.join('\n') + server.err.join('')).includes(credentials.TEST_ADMIN_PASSWORD), `${name}: a senha não aparece no registro`);
      } finally {
        await server.stop();
        removeTempDir(data);
      }
    }
  } finally { removeTempDir(dir); }
});
