import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, must, PASSWORD, ADMIN_EMAIL } from './helpers/app.mjs';
import { sha } from '../server/lib/crypto.mjs';

const NEW_PASSWORD = 'Senha-renovada-teste-456';

// Tudo o que a pessoa que opera consegue ler pelo painel e pela API de auditoria, para provar que senha nenhuma aparece.
async function everythingReadable(kit, session) {
  const { call } = kit;
  const parts = [];
  for (const route of ['/api/state', '/api/users', '/api/audit?limit=500', '/api/me']) parts.push(JSON.stringify((await call(route, { session })).data));
  return parts.join('\n');
}

test('redefinir a senha de alguém encerra as sessões dela, vale só a nova senha e nada de senha vai para a trilha', async () => {
  await withApp(async kit => {
    const { call, login, admin, createUser } = kit;
    const { user, session: oldSession } = await createUser('editor');
    const second = (await login(user.email, PASSWORD)).session;
    assert.equal((await call('/api/me', { session: oldSession })).status, 200);

    const reset = await call(`/api/users/${user.id}`, { method: 'PATCH', session: admin, body: { password: NEW_PASSWORD } });
    assert.equal(reset.status, 200);
    assert.ok(!JSON.stringify(reset.data).includes(NEW_PASSWORD), 'a resposta não devolve a senha');
    assert.equal(Object.hasOwn(reset.data, 'password'), false);

    for (const session of [oldSession, second]) assert.equal((await call('/api/me', { session })).status, 401, 'todas as sessões antigas caem');
    assert.equal((await login(user.email, PASSWORD)).status, 401, 'a senha antiga deixa de valer');
    const renewed = await login(user.email, NEW_PASSWORD);
    assert.equal(renewed.status, 200);
    assert.equal((await call('/api/me', { session: renewed.session })).status, 200);
    // O administrador que fez a troca continua com a própria sessão.
    assert.equal((await call('/api/me', { session: admin })).status, 200);
    assert.ok(!(renewed.setCookie ?? '').includes('Max-Age=0'));

    const events = must(await call('/api/audit?limit=500', { session: admin })).events;
    const event = events.find(item => item.action === 'user.password.reset' && item.detail.userId === user.id);
    assert.ok(event, 'a troca de senha é registrada');
    assert.deepEqual([event.actor, event.detail.source, event.detail.sessionsRevoked], [kit.adminUser.email, 'admin-api', 2]);
    assert.ok(events.some(item => item.action === 'user.updated' && item.detail.userId === user.id && item.detail.passwordReset === true));

    const visible = await everythingReadable(kit, admin);
    for (const secret of [PASSWORD, NEW_PASSWORD]) assert.ok(!visible.includes(secret), 'a senha em texto claro nunca aparece');
    // No banco só existe o hash com sal (scrypt), nunca a senha.
    const stored = kit.app.services.users.byEmail(user.email).password;
    assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.ok(!JSON.stringify(kit.app.db.prepare('SELECT * FROM users').all()).includes(NEW_PASSWORD));
    assert.ok(!JSON.stringify(kit.app.db.prepare('SELECT payload FROM audit').all()).includes(NEW_PASSWORD));
    // Nem o hash (que permitiria quebrar a senha offline) pode sair do cadastro: trilha, API e listas só trazem dados públicos.
    const hashShape = /[0-9a-f]{32}:[0-9a-f]{128}/;
    assert.doesNotMatch(JSON.stringify(kit.app.db.prepare('SELECT payload FROM audit').all()), hashShape, 'trilha de auditoria sem hash de senha');
    assert.doesNotMatch(visible, hashShape, 'API sem hash de senha');
  });
});

test('senha nova precisa ter de 12 a 128 caracteres; a conta não muda quando a troca é recusada', async () => {
  await withApp(async kit => {
    const { call, login, admin, createUser } = kit;
    const { user, session } = await createUser('editor');
    for (const password of ['curta', '12345678901', 'x'.repeat(129), 123456789012, null, '']) {
      const response = await call(`/api/users/${user.id}`, { method: 'PATCH', session: admin, body: { password } });
      assert.equal(response.status, 400, `senha ${JSON.stringify(password)?.slice(0, 20)} deveria ser recusada`);
    }
    assert.equal(must(await call(`/api/users/${user.id}`, { method: 'PATCH', session: admin, body: { password: 'x'.repeat(128) } })).email, user.email, '128 caracteres é aceita');
    assert.equal((await call('/api/me', { session })).status, 401, 'só a troca válida encerrou a sessão');
    assert.equal((await login(user.email, 'x'.repeat(128))).status, 200);
    // Recusas anteriores não encerraram sessão nem registraram troca.
    const resets = must(await call('/api/audit?limit=500', { session: admin })).events.filter(item => item.action === 'user.password.reset');
    assert.equal(resets.length, 1);
  });
});

test('quem não administra usuários não troca senha de ninguém, nem a própria por este caminho', async () => {
  await withApp(async kit => {
    const { call, login, admin, adminUser, createUser } = kit;
    const victim = await createUser('viewer', { email: 'vitima@example.invalid' });
    for (const role of ['manager', 'editor', 'viewer']) {
      const { user, session } = await createUser(role);
      for (const target of [adminUser.id, user.id, victim.user.id]) {
        const response = await call(`/api/users/${target}`, { method: 'PATCH', session, body: { password: NEW_PASSWORD } });
        assert.equal(response.status, 403, `${role} alterando ${target === user.id ? 'a própria conta' : 'outra conta'}`);
      }
      assert.equal((await call('/api/me', { session })).status, 200, `${role}: tentativa recusada não derruba a sessão`);
    }
    assert.equal((await login(adminUser.email, PASSWORD)).status, 200, 'senha do administrador intacta');
    assert.equal((await login(victim.user.email, PASSWORD)).status, 200, 'senha da vítima intacta');
    assert.equal((await login(victim.user.email, NEW_PASSWORD)).status, 401);
    assert.equal(must(await call('/api/users', { session: admin })).users.length, 5);
  });
});

test('administrador que troca a própria senha tem o cookie apagado e precisa entrar de novo', async () => {
  await withApp(async kit => {
    const { call, login, admin, adminUser } = kit;
    const other = (await login(adminUser.email, PASSWORD)).session;
    const reset = await call(`/api/users/${adminUser.id}`, { method: 'PATCH', session: admin, body: { password: NEW_PASSWORD } });
    assert.equal(reset.status, 200);
    assert.match(reset.setCookie, /^pwc_session=; .*Max-Age=0/, 'o navegador recebe a ordem de apagar o cookie');
    assert.equal((await call('/api/me', { session: admin })).status, 401);
    assert.equal((await call('/api/me', { session: other })).status, 401, 'outras sessões do mesmo administrador também caem');
    assert.equal((await login(adminUser.email, PASSWORD)).status, 401);
    const renewed = await login(adminUser.email, NEW_PASSWORD);
    assert.equal(renewed.status, 200);
    assert.equal((await call('/api/me', { session: renewed.session })).status, 200);
    // Alterar OUTRA conta não apaga o cookie de quem alterou.
    const { user } = await kit.createUser('viewer', { by: renewed.session });
    const change = await call(`/api/users/${user.id}`, { method: 'PATCH', session: renewed.session, body: { name: 'Novo nome' } });
    assert.equal(change.status, 200);
    assert.equal(change.setCookie, undefined);
  });
});

test('recuperação pelo terminal (resetAdminPassword): só conta de administrador ativa, encerra sessões e registra a origem', async () => {
  await withApp(async kit => {
    const { app, call, login, admin, adminUser, createUser } = kit;
    const editor = await createUser('editor');
    const inactive = await createUser('admin', { email: 'admin-inativo@example.invalid' });
    must(await call(`/api/users/${inactive.user.id}`, { method: 'PATCH', session: admin, body: { active: false } }));
    for (const address of [editor.user.email, inactive.user.email, 'inexistente@example.invalid']) {
      assert.throws(() => app.resetAdminPassword(address, NEW_PASSWORD), { status: 403 }, address);
    }
    assert.throws(() => app.resetAdminPassword(adminUser.email, 'curta'), { status: 400 });
    assert.equal((await call('/api/me', { session: admin })).status, 200, 'recusas não encerram sessões');
    assert.equal((await login(adminUser.email, PASSWORD)).status, 200);

    app.resetAdminPassword(adminUser.email.toUpperCase(), NEW_PASSWORD, 'operador.ti');
    assert.equal((await call('/api/me', { session: admin })).status, 401);
    assert.equal((await login(adminUser.email, PASSWORD)).status, 401);
    const renewed = await login(adminUser.email, NEW_PASSWORD);
    assert.equal(renewed.status, 200);
    const events = must(await call('/api/audit?limit=500', { session: renewed.session })).events;
    const event = events.find(item => item.action === 'user.password.reset' && item.detail.userId === adminUser.id);
    assert.deepEqual([event.actor, event.detail.source], ['local-console:operador.ti', 'local-console']);
    assert.ok(!JSON.stringify(events).includes(NEW_PASSWORD));
    // Não existe caminho HTTP para a recuperação local (só o terminal do servidor).
    const reachable = app.routes.map(route => `${route.method} ${route.pattern}`).join('\n');
    assert.ok(reachable.includes('POST /api/login'), 'a lista de rotas foi lida');
    assert.ok(!/reset|recover|recuper|forgot/i.test(reachable), 'sem rota HTTP de recuperação');
  });
});

test('desativar a conta derruba as sessões na hora; o último administrador ativo nunca sai', async () => {
  await withApp(async kit => {
    const { app, call, login, admin, adminUser, createUser } = kit;
    const { user, session } = await createUser('manager');
    assert.equal((await call('/api/me', { session })).status, 200);
    must(await call(`/api/users/${user.id}`, { method: 'PATCH', session: admin, body: { active: false } }));
    assert.equal((await call('/api/me', { session })).status, 401, 'a sessão aberta cai');
    const refused = await login(user.email, PASSWORD);
    assert.equal(refused.status, 401, 'e a conta não entra mais');
    assert.equal(refused.data.error, 'E-mail ou senha inválidos.', 'mesma mensagem de senha errada: não revela que a conta existe');
    must(await call(`/api/users/${user.id}`, { method: 'PATCH', session: admin, body: { active: true } }));
    assert.equal((await login(user.email, PASSWORD)).status, 200, 'reativada, volta a entrar');

    // Último administrador ativo: não desativa nem muda de perfil, nem por quem é o próprio administrador.
    for (const body of [{ active: false }, { role: 'manager' }]) {
      const response = await call(`/api/users/${adminUser.id}`, { method: 'PATCH', session: admin, body });
      assert.equal(response.status, 409, JSON.stringify(body));
      assert.match(response.data.error, /ao menos um administrador ativo/);
    }
    assert.equal((await call('/api/me', { session: admin })).status, 200, 'a recusa não derruba a sessão');

    // Defesa em profundidade: se uma conta ficar inativa sem passar pela API (ex.: edição direta do banco), a sessão não vale.
    const { user: ghost, session: ghostSession } = await createUser('viewer');
    const row = app.db.prepare('SELECT data FROM users WHERE id=?').get(ghost.id);
    app.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.data), active: false }), ghost.id);
    const blocked = await call('/api/me', { session: ghostSession });
    assert.equal(blocked.status, 401);
    assert.match(blocked.data.error, /Conta desativada/);
  });
});

test('sessão: token aleatório só existe no cookie (no banco fica o hash), CSRF próprio e validade de 8 horas', async () => {
  await withApp(async kit => {
    const { app, call, login, adminUser } = kit;
    const a = await login(adminUser.email, PASSWORD), b = await login(adminUser.email, PASSWORD);
    assert.notEqual(a.cookie, b.cookie);
    assert.notEqual(a.session.csrf, b.session.csrf);
    assert.match(a.setCookie, /^pwc_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/);
    const token = a.cookie.split('=')[1];
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE hash=?').get(token).n, 0, 'o token em si não é guardado');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE hash=?').get(sha(token)).n, 1, 'só o seu hash');
    assert.equal(app.db.prepare('SELECT csrf FROM sessions WHERE hash=?').get(sha(token)).csrf, a.session.csrf);

    // Sessão vencida: recusada e apagada do banco.
    app.db.prepare('UPDATE sessions SET expires=? WHERE hash=?').run(Date.now() - 1, sha(token));
    const expired = await call('/api/me', { session: a.session });
    assert.equal(expired.status, 401);
    assert.match(expired.data.error, /sessão expirou/);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE hash=?').get(sha(token)).n, 0);
    assert.equal((await call('/api/me', { session: b.session })).status, 200, 'a outra sessão segue válida');
    // Cookie adulterado, vazio ou de outra pessoa não abre nada.
    for (const cookie of ['pwc_session=', 'pwc_session=zzz', `pwc_session=${'A'.repeat(43)}`, 'outro=1']) {
      assert.equal((await call('/api/me', { session: { cookie, csrf: b.session.csrf } })).status, 401, cookie);
    }
  });
});

test('usuários: dados obrigatórios validados, e-mail único sem diferenciar maiúsculas, e a conta do administrador de teste não é especial', async () => {
  await withApp(async kit => {
    const { call, admin, createUser } = kit;
    const base = { name: 'Pessoa', email: 'pessoa@example.invalid', password: PASSWORD, role: 'viewer', unitIds: ['leste'], sectorIds: ['rh'] };
    for (const [label, patch] of [
      ['sem nome', { name: '' }], ['nome só com espaços', { name: '   ' }], ['e-mail inválido', { email: 'sem-arroba' }], ['perfil inexistente', { role: 'dono' }],
      ['senha curta', { password: 'curta' }], ['unidade inexistente', { unitIds: ['marte'] }], ['setor inexistente', { sectorIds: ['inexistente'] }],
      ['unidades que não são lista', { unitIds: 'leste' }], ['permissão desconhecida', { grants: ['tudo:pode'] }]
    ]) {
      const response = await call('/api/users', { method: 'POST', session: admin, body: { ...base, ...patch } });
      assert.equal(response.status, 400, label);
    }
    must(await call('/api/users', { method: 'POST', session: admin, body: base }), 201);
    for (const email of ['pessoa@example.invalid', 'PESSOA@Example.Invalid', '  pessoa@example.invalid ']) {
      const response = await call('/api/users', { method: 'POST', session: admin, body: { ...base, email } });
      assert.equal(response.status, 409, `"${email}" repete um e-mail já cadastrado`);
    }
    const listed = must(await call('/api/users', { session: admin })).users;
    assert.equal(listed.filter(user => user.email === 'pessoa@example.invalid').length, 1);
    assert.ok(listed.every(user => !Object.hasOwn(user, 'password')), 'a lista nunca traz a senha nem o hash');
    assert.equal(listed.find(user => user.email === ADMIN_EMAIL).role, 'admin');
    assert.ok(kit.adminUser.id);
    await createUser('editor');
  });
});
