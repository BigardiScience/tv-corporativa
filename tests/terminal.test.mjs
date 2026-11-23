import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createApp } from '../server/core.mjs';
import { silentLogger } from '../server/lib/logger.mjs';
import { apiClient } from './helpers/http.mjs';
import { cleanEnv, makeTempDir, projectRoot, removeTempDir, must } from './helpers/app.mjs';

// Assistentes de terminal (primeira configuração e recuperação do administrador). Rodam em um TTY de verdade,
// criado por um pequeno auxiliar em Python; sem Python (ou no Windows) os cenários de TTY são pulados e fica dito.
const driver = path.join(projectRoot, 'tests', 'helpers', 'pty-driver.py');
const hasPython = process.platform !== 'win32' && spawnSync('python3', ['--version']).status === 0;
const ttyOptions = { skip: hasPython ? false : 'precisa de Linux/macOS com python3 para abrir um terminal de verdade' };

const NAME = 'Pessoa da TI', EMAIL = 'ti@example.invalid';
const PASSWORD_ONE = 'Senha-do-assistente-123', PASSWORD_TWO = 'Outra-senha-assistente-456';

function inTerminal(script, dataDir, steps, { timeout = 30 } = {}) {
  const result = spawnSync('python3', ['-I', driver, JSON.stringify({
    argv: [process.execPath, '--no-warnings', path.join(projectRoot, 'scripts', script)], cwd: projectRoot,
    env: cleanEnv({ DATA_DIR: dataDir, TERM: 'xterm', PATH: process.env.PATH }), steps, timeout
  })], { encoding: 'utf8', timeout: (timeout + 10) * 1000 });
  assert.equal(result.status, 0, `auxiliar de terminal falhou: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const open = dataDir => createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger });

test('sem terminal interativo (entrada redirecionada), os assistentes se recusam a pedir senha', async () => {
  const dataDir = makeTempDir('tvcorp-test-');
  try {
    for (const script of ['configure.mjs', 'reset-admin.mjs']) {
      const child = spawn(process.execPath, ['--no-warnings', path.join(projectRoot, 'scripts', script)], { cwd: projectRoot, env: cleanEnv({ DATA_DIR: dataDir }), stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
      child.stdin.end(`${NAME}\n${EMAIL}\n${PASSWORD_ONE}\n${PASSWORD_ONE}\n`);
      const code = await new Promise(resolve => child.once('exit', resolve));
      assert.equal(code, 1, script);
      assert.match(err, /terminal interativo/, script);
      assert.ok(!(out + err).includes(PASSWORD_ONE), `${script}: a senha não pode ser repetida na saída`);
    }
    const app = open(dataDir);
    try { assert.equal(app.configured(), false, 'nada foi criado sem passar pelo terminal'); } finally { await app.close(); }
  } finally { removeTempDir(dataDir); }
});

test('assistente de primeira configuração: cria o administrador, oculta a senha e recusa repetir', ttyOptions, async () => {
  const dataDir = makeTempDir('tvcorp-test-');
  try {
    const steps = (password, confirm) => [
      { expect: 'Seu nome: ', send: `${NAME}\r` }, { expect: 'E-mail corporativo: ', send: `${EMAIL}\r` },
      { expect: 'Senha \\(mínimo 12 caracteres\\): ', send: `${password}\r` }, { expect: 'Confirme a senha: ', send: `${confirm}\r` }
    ];
    // Senhas diferentes: recusa e não cria nada.
    const mismatch = inTerminal('configure.mjs', dataDir, steps(PASSWORD_ONE, 'diferente-diferente-1'));
    assert.equal(mismatch.exit, 1);
    assert.match(mismatch.output, /As senhas não coincidem/);
    // Senha curta: recusa pela mesma regra do servidor.
    const weak = inTerminal('configure.mjs', dataDir, steps('curta', 'curta'));
    assert.equal(weak.exit, 1);
    assert.match(weak.output, /entre 12 e 128 caracteres/);
    let app = open(dataDir);
    try { assert.equal(app.configured(), false); } finally { await app.close(); }

    const done = inTerminal('configure.mjs', dataDir, steps(PASSWORD_ONE, PASSWORD_ONE));
    assert.equal(done.exit, 0, done.output);
    assert.match(done.output, /Administrador criado/);
    assert.ok(!done.output.includes(PASSWORD_ONE), 'a senha digitada nunca aparece no terminal');
    assert.equal(done.failedStep, null);

    app = open(dataDir);
    try {
      const api = apiClient(app);
      const login = await api.login(EMAIL, PASSWORD_ONE);
      assert.equal(login.status, 200);
      assert.equal(login.data.user.name, NAME);
      assert.equal(login.data.user.role, 'admin');
      const events = must(await api.call('/api/audit', { session: login.session })).events;
      assert.ok(events.some(event => event.action === 'setup.admin.created'));
    } finally { await app.close(); }

    // Segunda execução: o administrador já existe, então o assistente nem pergunta nada.
    const again = inTerminal('configure.mjs', dataDir, []);
    assert.equal(again.exit, 1);
    assert.match(again.output, /Um administrador já existe/);
    assert.ok(!again.output.includes('Seu nome'));
  } finally { removeTempDir(dataDir); }
});

test('recuperação local do administrador: só conta administrativa ativa, senha oculta, sessões encerradas', ttyOptions, async () => {
  const dataDir = makeTempDir('tvcorp-test-');
  try {
    let app = open(dataDir);
    let oldSession, editorEmail = 'editor@example.invalid';
    try {
      const admin = app.createAdmin(NAME, EMAIL, PASSWORD_ONE);
      const api = apiClient(app);
      oldSession = (await api.login(EMAIL, PASSWORD_ONE)).session;
      must(await api.call('/api/users', { method: 'POST', session: oldSession, body: { name: 'Editor', email: editorEmail, password: PASSWORD_ONE, role: 'editor', unitIds: ['leste'], sectorIds: ['rh'] } }), 201);
      assert.ok(admin.id);
    } finally { await app.close(); }

    const steps = (email, password, confirm) => [
      { expect: 'E-mail da conta administrativa: ', send: `${email}\r` },
      { expect: 'Nova senha \\(mínimo 12 caracteres\\): ', send: `${password}\r` }, { expect: 'Confirme a nova senha: ', send: `${confirm}\r` }
    ];
    // Conta que não é de administrador: recusada.
    const refused = inTerminal('reset-admin.mjs', dataDir, steps(editorEmail, PASSWORD_TWO, PASSWORD_TWO));
    assert.equal(refused.exit, 1);
    assert.match(refused.output, /exige uma conta administrativa existente e ativa/);
    // Senhas diferentes: recusada.
    const mismatch = inTerminal('reset-admin.mjs', dataDir, steps(EMAIL, PASSWORD_TWO, 'nao-confere-nao-confere'));
    assert.equal(mismatch.exit, 1);
    assert.match(mismatch.output, /As senhas não coincidem/);

    const done = inTerminal('reset-admin.mjs', dataDir, steps(EMAIL, PASSWORD_TWO, PASSWORD_TWO));
    assert.equal(done.exit, 0, done.output);
    assert.match(done.output, /Senha redefinida e sessões encerradas/);
    for (const secret of [PASSWORD_ONE, PASSWORD_TWO]) assert.ok(!done.output.includes(secret), 'nenhuma senha aparece no terminal');

    app = open(dataDir);
    try {
      const api = apiClient(app);
      assert.equal((await api.call('/api/me', { session: oldSession })).status, 401, 'a sessão anterior foi encerrada');
      assert.equal((await api.login(EMAIL, PASSWORD_ONE)).status, 401, 'a senha antiga não vale mais');
      const renewed = await api.login(EMAIL, PASSWORD_TWO);
      assert.equal(renewed.status, 200);
      assert.equal((await api.login(editorEmail, PASSWORD_ONE)).status, 200, 'outras contas não foram tocadas');
      const events = must(await api.call('/api/audit?limit=500', { session: renewed.session })).events;
      const reset = events.find(event => event.action === 'user.password.reset');
      assert.equal(reset.detail.source, 'local-console');
      assert.match(reset.actor, /^local-console:/);
      assert.ok(!JSON.stringify(events).includes(PASSWORD_TWO));
    } finally { await app.close(); }
  } finally { removeTempDir(dataDir); }
});
