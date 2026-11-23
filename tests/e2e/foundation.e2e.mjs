// Fundação do painel, em navegador de verdade: o que protege a sessão e os dados em QUALQUER tela.
//
// Estes cenários substituem os testes antigos do painel (que simulavam o navegador dentro do Node) por testes no navegador real:
//  - sem sessão só existe a tela de acesso, e rastros antigos guardados no navegador não voltam a aparecer;
//  - entrar mostra só o que a pessoa pode ver; sair limpa tela, janelas, miniaturas e armazenamento;
//  - o menu e as rotas seguem o perfil e as permissões individuais (o servidor continua sendo quem decide);
//  - sessão que acaba no meio do uso (HTTP 401) volta ao acesso sem deixar conteúdo privado nem o que estava sendo digitado;
//  - resposta que chega atrasada, depois da saída, não traz os dados de volta nem aparece para quem entrou em seguida;
//  - texto vindo de arquivos, playlists e pessoas nunca vira HTML.
import assert from 'node:assert/strict';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';

const SECRET_MEDIA = 'CONTEÚDO CONFIDENCIAL ZETA';
const SECRET_PLAYLIST = 'PLAYLIST PRIVADA ZETA';
// Textos que, se virassem HTML, executariam código. Não têm barras porque o servidor não aceita barras em nomes de arquivos e playlists.
const XSS_MEDIA = '<img src=x onerror=window.__xss=1> imagem';
const XSS_PLAYLIST = '<svg onload=window.__xss=2> playlist';
const XSS_USER = '<img src=x onerror=window.__xss=3> pessoa';

const ALL_ROUTES = ['overview', 'units', 'library', 'playlists', 'schedules', 'displays', 'users', 'audit', 'settings'];
const WITHOUT_ADMIN = ALL_ROUTES.filter(route => route !== 'users' && route !== 'audit');
// Desde a 2.1.0 somente o Administrador gerencia usuários: o Gestor vê a auditoria do escopo, mas não a área de usuários.
const MANAGER_ROUTES = ALL_ROUTES.filter(route => route !== 'users');

// Repete uma conferência por alguns instantes (coisas que o navegador faz logo depois, como liberar uma miniatura).
async function eventually(check, message, timeout = 4000) {
  const limit = Date.now() + timeout;
  let last;
  while (Date.now() < limit) {
    last = await check();
    if (last === true) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`${message} (último valor: ${JSON.stringify(last)})`);
}

export default () => runScenario('Fundação: sessão, perfis, sessão expirada, resposta atrasada e texto nunca vira HTML', async (s, step) => {
  const { page } = s;
  // Respostas 401 acontecem de propósito (sem sessão, senha errada, sessão que acaba). Qualquer outro erro continua sendo falha.
  s.allow(/^HTTP 401 (?:GET|POST) \/api\//);
  let kit, editor, manager, otherAdmin, viewer, outsider, adminCsrf, blobUrls;

  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const bodyText = () => page.evaluate(() => document.body.innerText);
  const navRoutes = () => page.$$eval('.nav-btn[data-route]', links => links.map(link => link.dataset.route));
  const logoutFromStrip = async () => {
    await page.locator('.env-strip button', { hasText: 'Sair com segurança' }).click();
    await page.locator('#login-form').waitFor();
  };
  // Conteúdo do armazenamento do navegador (somente o que o painel poderia ter gravado) como um texto só.
  const storageDump = () => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const imagesLoad = urls => page.evaluate(list => Promise.all(list.map(url => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  }))), urls);
  // Tenta carregar miniaturas que o painel já liberou. O navegador registra um "arquivo não encontrado" para cada uma: é a PROVA de que foram
  // liberadas, não um problema do painel. Por isso esses avisos, e só eles, produzidos por esta sonda são retirados da lista de problemas.
  const probeReleased = async urls => {
    const from = s.issues.length;
    const loaded = await imagesLoad(urls);
    await new Promise(resolve => setTimeout(resolve, 150));
    for (let index = s.issues.length - 1; index >= from; index--) if (/Failed to load resource: net::ERR_FILE_NOT_FOUND/.test(s.issues[index])) s.issues.splice(index, 1);
    return loaded;
  };
  const freshLoginPage = async () => {
    await page.goto('about:blank');
    await page.goto(s.origin);
    await page.locator('#login-submit', { hasText: 'Entrar na plataforma' }).waitFor();
  };

  await step('sem sessão só existe a tela de acesso: rastros antigos no navegador não voltam e a API recusa', async () => {
    kit = await s.seed();
    const secretMedia = await kit.approvedMedia(kit.admin, { title: SECRET_MEDIA, name: 'zeta.png' });
    await kit.publishedPlaylist(kit.admin, [secretMedia.id], { name: SECRET_PLAYLIST });
    editor = await kit.createUser('editor', { email: 'edu.editor@example.invalid' });
    manager = await kit.createUser('manager', { email: 'gil.gestor@example.invalid' });
    otherAdmin = await kit.createUser('admin', { email: 'ada.admin@example.invalid' });
    viewer = await kit.createUser('viewer', { email: 'vera.visualizadora@example.invalid' });
    outsider = await kit.createUser('editor', { email: 'otavio.outro@example.invalid', unitIds: ['centro'], sectorIds: ['rh'] });

    const first = await page.goto(s.origin);
    assert.match(first.headers()['content-security-policy'], /script-src 'self'/, 'a página é entregue com a política de segurança de conteúdo');
    assert.match(first.headers()['content-security-policy'], /frame-ancestors 'self'/);
    // Rastro de uma versão antiga do painel (modo de demonstração) que ficou neste navegador.
    await page.evaluate(() => localStorage.setItem('tvcorp-demo-v1', JSON.stringify({
      units: [{ name: 'UNIDADE PRIVADA ANTIGA' }], media: [{ title: 'CONTEÚDO PRIVADO ANTIGO' }], users: [{ email: 'antigo@example.invalid' }]
    })));

    for (const hash of ['', '#/usuarios', '#/biblioteca', '#/auditoria', '#/configuracoes', '#/playlists/qualquer-id']) {
      await page.goto('about:blank');
      await page.goto(`${s.origin}/${hash}`);
      await page.locator('#login-submit', { hasText: 'Entrar na plataforma' }).waitFor();
      assert.equal(await page.locator('.app-shell').count(), 0, `${hash || 'raiz'}: sem sessão não existe o painel`);
      assert.equal(await page.locator('.nav-btn').count(), 0);
      assert.equal(await page.locator('#dialogs dialog').count(), 0);
      assert.equal(await page.title(), 'Entrar · TV Corporativa');
      const text = await bodyText();
      for (const forbidden of ['CONTEÚDO PRIVADO ANTIGO', 'UNIDADE PRIVADA ANTIGA', 'antigo@example.invalid', 'ZETA', 'Usuários e permissões', 'Auditoria']) {
        assert.ok(!text.includes(forbidden), `${hash || 'raiz'}: "${forbidden}" não pode aparecer sem sessão`);
      }
    }
    // O servidor é quem decide: sem sessão nenhuma rota de dados responde.
    const statuses = await page.evaluate(async () => Promise.all(
      ['/api/state', '/api/library?unitId=leste&sectorId=rh', '/api/users', '/api/audit', '/api/displays', '/api/playlists?unitId=leste&sectorId=rh', '/api/schedules']
        .map(url => fetch(url).then(response => response.status))
    ));
    assert.deepEqual(statuses, [401, 401, 401, 401, 401, 401, 401]);
    await s.shot('fundacao-01-sem-sessao');
  });

  await step('tela de acesso: campos obrigatórios, falha sem pista do que errou, mostrar/ocultar senha e acessibilidade', async () => {
    await freshLoginPage();
    let attempts = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/login')) attempts++; });

    await page.click('#login-submit');
    assert.equal(attempts, 0, 'com os campos vazios nada é enviado');
    assert.equal(await page.locator('#login-error').isVisible(), false);

    // E-mail que existe com senha errada e e-mail que não existe: a mesma resposta, para não revelar quem tem conta.
    await page.fill('#login-email', s.adminEmail);
    await page.fill('#login-password', 'senha-errada-123456');
    await page.click('#login-submit');
    await page.locator('#login-error').waitFor();
    const known = await page.locator('#login-error').innerText();
    assert.equal(known, 'E-mail ou senha inválidos.');
    assert.equal(await page.inputValue('#login-password'), '', 'a senha digitada é apagada do campo depois da falha');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'login-error', 'o foco vai para o aviso, para leitores de tela');

    await page.fill('#login-email', 'ninguem@example.invalid');
    await page.fill('#login-password', 'senha-errada-123456');
    await page.click('#login-submit');
    await page.waitForFunction(() => document.querySelector('#login-submit:not([aria-busy])') && !document.querySelector('#login-password').value);
    assert.equal(await page.locator('#login-error').innerText(), known, 'e-mail inexistente recebe exatamente a mesma mensagem');
    assert.equal(attempts, 2);
    assert.equal(await page.locator('.app-shell').count(), 0);

    await page.fill('#login-password', 'qualquer-coisa-123');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    assert.equal(await page.getAttribute('#login-password', 'type'), 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    assert.equal(await page.getAttribute('#login-password', 'type'), 'password');

    // Acessibilidade existe antes de entrar (texto ampliado) e não deixa a preferência ligada para o resto dos testes.
    await page.getByRole('button', { name: 'Recursos de acessibilidade' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Alternar' }).first().click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('large-text')), true);
    await dialog.getByRole('button', { name: 'Alternar' }).first().click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('large-text')), false);
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await closed();
    await s.shot('fundacao-02-acesso-com-erro');
  });

  await step('Administrador entra e vê tudo; ao sair somem tela, janelas, miniaturas e qualquer rastro no armazenamento', async () => {
    await freshLoginPage();
    await page.fill('#login-email', s.adminEmail);
    await page.fill('#login-password', s.password);
    const answered = page.waitForResponse(response => response.url().endsWith('/api/login') && response.request().method() === 'POST');
    await page.click('#login-submit');
    adminCsrf = (await (await answered).json()).csrf;
    await page.waitForSelector('.app-shell');
    assert.ok(typeof adminCsrf === 'string' && adminCsrf.length >= 16, 'o servidor entrega um token anti-CSRF');
    await chooseSpace(page, 'Unidade Leste', 'RH');
    assert.deepEqual(await navRoutes(), ALL_ROUTES, 'o Administrador vê todas as áreas');

    await goTo(page, 'library');
    await page.locator('.item-title', { hasText: SECRET_MEDIA }).first().waitFor();
    await page.waitForSelector('#view img[src^="blob:"]');
    blobUrls = await page.$$eval('#view img[src^="blob:"]', images => images.map(image => image.src));
    assert.ok(blobUrls.length >= 1);
    assert.deepEqual(await imagesLoad(blobUrls), blobUrls.map(() => true), 'enquanto a sessão vale, as miniaturas existem');

    // Cookie de sessão: protegido contra script e contra envio entre sites; nada de sessão acessível ao JavaScript da página.
    const cookie = (await s.context.cookies(s.origin)).find(item => item.name === 'pwc_session');
    assert.ok(cookie, 'a sessão vive em um cookie');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Strict');
    assert.equal(await page.evaluate(() => document.cookie), '', 'o JavaScript da página não enxerga o cookie de sessão');
    const stored = await storageDump();
    for (const secret of [s.password, adminCsrf, cookie.value]) assert.ok(!stored.includes(secret), 'nenhuma senha, token ou sessão no armazenamento do navegador');
    const { local, session } = JSON.parse(stored);
    assert.deepEqual(session, {}, 'sessionStorage não é usado');
    assert.deepEqual(Object.keys(local).filter(key => key !== 'tvcorp-demo-v1' && !key.startsWith('tvcorp-')), [], 'só preferências do painel em localStorage');

    // Uma janela com dados da pessoa aberta na hora de sair (o botão de sair da própria janela também funciona).
    await page.getByRole('button', { name: /^Perfil de / }).click();
    const profile = page.locator('dialog[open]');
    await profile.getByText(s.adminEmail).waitFor();
    await profile.getByRole('button', { name: 'Sair com segurança' }).click();
    await page.locator('#login-form').waitFor();

    assert.equal(await page.locator('.app-shell').count(), 0);
    assert.equal(await page.locator('#dialogs dialog').count(), 0, 'nenhuma janela da sessão anterior sobra');
    assert.equal(await page.title(), 'Entrar · TV Corporativa');
    const text = await bodyText();
    for (const secret of [SECRET_MEDIA, SECRET_PLAYLIST, s.adminEmail, 'Administrador E2E']) assert.ok(!text.includes(secret), `"${secret}" não pode sobrar na tela depois de sair`);
    await eventually(async () => (await probeReleased(blobUrls)).every(loaded => loaded === false), 'as miniaturas (blob:) da sessão deveriam ter sido liberadas');
    assert.equal((await s.context.cookies(s.origin)).some(item => item.name === 'pwc_session' && item.value), false, 'o cookie de sessão foi apagado');
    assert.ok(!(await storageDump()).includes(s.adminEmail), 'o e-mail não fica gravado no navegador');
    // O token antigo não vale mais no servidor.
    assert.equal((await kit.call('/api/library?unitId=leste&sectorId=rh', { session: { cookie: `pwc_session=${cookie.value}`, csrf: adminCsrf } })).status, 401, 'a sessão encerrada não funciona mais');
    await s.shot('fundacao-03-depois-de-sair');
  });

  await step('menu e rotas seguem o perfil e as permissões individuais; link direto para área proibida volta ao início', async () => {
    const auditor = await kit.createUser('editor', { email: 'ana.auditora@example.invalid', grants: ['audit:read'] });
    const limited = await kit.createUser('manager', { email: 'lia.limitada@example.invalid', revokes: ['audit:read'] });
    const cases = [
      { who: manager, label: 'Gestor', routes: MANAGER_ROUTES },
      { who: editor, label: 'Editor', routes: WITHOUT_ADMIN },
      { who: viewer, label: 'Visualizador', routes: WITHOUT_ADMIN },
      { who: auditor, label: 'Editor com permissão individual de auditoria', routes: ['overview', 'units', 'library', 'playlists', 'schedules', 'displays', 'audit', 'settings'] },
      { who: limited, label: 'Gestor sem a permissão de auditoria', routes: MANAGER_ROUTES.filter(route => route !== 'audit') }
    ];
    for (const { who, label, routes } of cases) {
      await loginAs(page, s.origin, who.email, PASSWORD);
      assert.deepEqual(await navRoutes(), routes, `${label}: áreas do menu`);
      // Itens do menu e a marca são links (<a>): o navegador os sublinha por padrão, e o visual do painel não tem esse sublinhado.
      const decorations = await page.$$eval('a.nav-btn, a.brand', links => links.map(link => getComputedStyle(link).textDecorationLine));
      assert.ok(decorations.length > routes.length && decorations.every(line => line === 'none'), `${label}: menu e marca sem sublinhado (${decorations.join(', ')})`);

      // O que o menu esconde, o endereço digitado à mão também não abre.
      for (const [hash, route] of [['#/usuarios', 'users'], ['#/auditoria', 'audit']]) {
        if (routes.includes(route)) continue;
        await page.evaluate(target => { location.hash = target; }, hash);
        await page.waitForFunction(() => document.querySelector('#toast')?.textContent === 'Seu perfil não tem acesso a esta área.');
        assert.equal(await page.evaluate(() => location.hash), '#/', `${label}: ${hash} volta para o início`);
        assert.equal(await page.locator('.nav-btn.active[data-route="overview"]').count(), 1);
      }
      await logoutFromStrip();
    }

    // O servidor também decide: o que a interface esconde, a API recusa ou devolve vazio.
    assert.equal((await kit.call('/api/units', { method: 'POST', session: editor.session, body: { name: 'Unidade clandestina' } })).status, 403);
    assert.deepEqual((await kit.call('/api/users', { session: editor.session })).data.users, []);
    assert.deepEqual((await kit.call('/api/audit', { session: viewer.session })).data.events, []);
  });

  await step('sessão que acaba no meio do uso (401): volta ao acesso, fecha a janela e não deixa nada do que estava aberto ou digitado', async () => {
    await loginAs(page, s.origin, otherAdmin.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH'); // a segunda conta de Administrador ainda não escolheu o espaço de trabalho
    await goTo(page, 'users');
    await page.locator('.user-table').waitFor();
    assert.match(await bodyText(), /vera\.visualizadora@example\.invalid/, 'a lista de usuários estava na tela');

    await page.getByRole('button', { name: 'Novo usuário' }).first().click();
    const dialog = page.locator('dialog[open]');
    const typed = 'Digitada-na-janela-77';
    await dialog.locator('#user-name').fill('Pessoa Nova');
    await dialog.locator('#user-email').fill('nova.pessoa@example.invalid');
    await dialog.locator('#user-password').fill(typed);
    await dialog.locator('#user-password-confirm').fill(typed);
    await dialog.getByLabel('Unidade Unidade Leste').check();
    await dialog.getByLabel('Setor RH').check();

    // Enquanto a janela está aberta, o servidor encerra a sessão (aqui: a TI redefine a senha de outra conta de Administrador).
    const NEW_PASSWORD = 'Nova-senha-do-gestor-1';
    assert.equal((await kit.call(`/api/users/${otherAdmin.user.id}`, { method: 'PATCH', session: kit.admin, body: { password: NEW_PASSWORD } })).status, 200);
    await dialog.getByRole('button', { name: 'Criar usuário' }).click();

    await page.locator('#login-form').waitFor();
    assert.equal(await page.locator('#login-error').innerText(), 'Sua sessão expirou. Entre novamente.');
    assert.equal(await page.locator('.app-shell').count(), 0);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'a janela aberta foi fechada junto com a sessão');
    await closed(); // o navegador tira a janela fechada da página logo em seguida (evento "close")
    const text = await bodyText();
    for (const secret of ['vera.visualizadora@example.invalid', 'Pessoa Nova', 'nova.pessoa@example.invalid', otherAdmin.email]) assert.ok(!text.includes(secret), `"${secret}" não pode sobrar na tela`);
    assert.ok(!(await storageDump()).includes(typed), 'a senha digitada nunca foi gravada no navegador');
    assert.equal(await page.inputValue('#login-password'), '');
    assert.equal(await page.inputValue('#login-email'), '', 'o formulário de acesso começa limpo');
    const created = (await kit.call('/api/users', { session: kit.admin })).data.users;
    assert.ok(!created.some(user => user.email === 'nova.pessoa@example.invalid'), 'o servidor não criou ninguém com a sessão inválida');

    // Entrar de novo (com a senha nova) começa do zero: nada da janela anterior reaparece.
    await page.fill('#login-email', otherAdmin.email);
    await page.fill('#login-password', NEW_PASSWORD);
    await page.click('#login-submit');
    await page.waitForSelector('.app-shell');
    assert.equal(await page.locator('#dialogs dialog').count(), 0, 'a janela e o que estava digitado nela não voltam');
    // O endereço da tela é mantido (#/usuarios), mas a lista é lida do servidor de novo: ninguém foi criado.
    await page.locator('.user-table').waitFor();
    assert.ok(!(await bodyText()).includes('Pessoa Nova'));
    await logoutFromStrip();
    await s.shot('fundacao-05-sessao-expirada');
  });

  await step('resposta atrasada que chega depois de sair não traz os dados de volta nem aparece para quem entrou em seguida', async () => {
    await loginAs(page, s.origin, editor.email, PASSWORD);
    await page.locator('.metric').first().waitFor();

    // A resposta REAL (200, com a playlist privada) é recebida pelo teste e segurada; a página só a recebe depois que a pessoa saiu.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let announce;
    const arrived = new Promise(resolve => { announce = resolve; });
    let held = false;
    await page.route('**/api/playlists?*', async route => {
      if (held) { await route.continue(); return; }
      held = true;
      const response = await route.fetch();
      announce({ status: response.status(), body: await response.text() });
      await gate;
      await route.fulfill({ response });
    });
    await goTo(page, 'playlists');
    const real = await arrived;
    assert.equal(real.status, 200);
    assert.match(real.body, new RegExp(SECRET_PLAYLIST), 'a resposta segurada realmente traz a playlist privada');

    await logoutFromStrip();
    // Outra pessoa (de outra unidade) entra NA MESMA PÁGINA, sem recarregar (recarregar descartaria a requisição pendente), e abre as
    // playlists dela. SÓ ENTÃO a resposta antiga chega: nada dela pode aparecer.
    await page.fill('#login-email', outsider.email);
    await page.fill('#login-password', PASSWORD);
    await page.click('#login-submit');
    await page.waitForSelector('.app-shell');
    await goTo(page, 'playlists');
    const delivered = page.waitForResponse(response => response.url().includes('/api/playlists?') && response.status() === 200 && response.request().method() === 'GET' && response.url().includes('unitId=leste'));
    release();
    await delivered;
    await page.getByText('Nenhuma playlist neste espaço ainda').waitFor();
    await page.waitForTimeout(500);
    const text = await bodyText();
    assert.ok(!text.includes(SECRET_PLAYLIST), 'a playlist de outra unidade não pode aparecer para quem entrou depois');
    assert.ok(!text.includes(SECRET_MEDIA));
    assert.equal(await page.locator('.playlist-table').count(), 0);
    await page.unroute('**/api/playlists?*');
    await logoutFromStrip();
  });

  await step('texto de arquivos, playlists e pessoas aparece como texto: nenhum HTML é criado nem script roda', async () => {
    const xssMedia = await kit.approvedMedia(kit.admin, { title: XSS_MEDIA, name: 'xss.png' });
    await kit.playlist(kit.admin, { name: XSS_PLAYLIST, items: [{ mediaId: xssMedia.id }] });
    assert.equal((await kit.call('/api/users', {
      method: 'POST', session: kit.admin, body: { name: XSS_USER, email: 'xss.pessoa@example.invalid', password: PASSWORD, role: 'viewer', unitIds: ['leste'], sectorIds: ['rh'] }
    })).status, 201);

    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    const clean = async where => {
      assert.equal(await page.evaluate(() => window.__xss), undefined, `${where}: nenhum código do texto foi executado`);
      assert.equal(await page.locator('#app img[src="x"], #app svg[onload], #app [onerror], #app [onload], #app script').count(), 0, `${where}: nenhum elemento foi criado a partir do texto`);
    };

    await goTo(page, 'library');
    await page.locator('.item-title', { hasText: XSS_MEDIA }).first().waitFor();
    await clean('biblioteca');
    await page.locator('.item-card', { has: page.locator('.item-title', { hasText: XSS_MEDIA }) }).locator('.item-open').click();
    await page.locator('dialog[open]').getByText(XSS_MEDIA).first().waitFor();
    await clean('detalhes do arquivo');
    await page.locator('dialog[open]').getByRole('button', { name: 'Fechar janela' }).click();
    await closed();

    await goTo(page, 'playlists');
    await page.locator('.row-link', { hasText: XSS_PLAYLIST }).waitFor();
    await clean('playlists');

    await goTo(page, 'users');
    await page.locator('.user-table b', { hasText: XSS_USER }).waitFor();
    await clean('usuários');

    await goTo(page, 'audit');
    await page.locator('.audit-table').waitFor();
    await page.locator('.audit-detail', { hasText: XSS_MEDIA }).first().waitFor();
    await clean('auditoria');
    await s.shot('fundacao-07-texto-seguro');
    await logoutFromStrip();
    expectNoIssues(s);
  });
});
