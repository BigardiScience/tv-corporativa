// Telas de ponta a ponta no navegador: cadastrar, ativar, código de pareamento, novo código, renomear, remover e perfis
// (inclusive Editor e Gestor gerando o código de pareamento sem desconectar a TV, e a auditoria desse registro).
// Aviso honesto: aqui NÃO existe TV de verdade. O "player" é simulado chamando a API de pareamento, como o player.js faria.
// O que se comprova é o painel e as regras do servidor; a exibição em televisores é outro tipo de teste.
import assert from 'node:assert/strict';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';
import { solidPng } from '../helpers/http.mjs';

const exact = text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export default () => runScenario('Telas: cadastrar, ativar, parear, novo código, renomear, remover e perfis', async (s, step) => {
  const { page } = s;
  let kit, portaria, editor, manager, firstToken, schedule;
  const generated = [];

  const row = name => page.locator('tr', { has: page.locator('b', { hasText: exact(name) }) });
  const names = () => page.locator('.display-table tbody tr b').allInnerTexts();
  const toastText = () => page.locator('#toast').innerText();
  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const code = () => page.locator('dialog[open] .pair-code').innerText();
  const pairWith = pairingCode => kit.call('/api/player/pair', { method: 'POST', body: { code: pairingCode } });
  const manifestStatus = token => kit.call('/api/player/manifest', { token }).then(response => response.status);
  const asUser = async (user, password = PASSWORD) => {
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, user.email, password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'displays');
    await page.locator('.display-table, .empty').first().waitFor();
  };

  await step('preparar TV pareada com programação no ar (pela API) e abrir Telas', async () => {
    kit = await s.seed();
    const media = await kit.approvedMedia(kit.admin, { title: 'Aviso', name: 'aviso.png', bytes: solidPng({ color: [249, 114, 25], seed: 'tv' }) });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id], { name: 'Avisos da portaria' });
    portaria = await kit.pairedDisplay(kit.admin, { name: 'TV Portaria' });
    schedule = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [portaria.display.id], name: 'Programação da portaria' });
    await kit.call('/api/player/heartbeat', { method: 'POST', token: portaria.token, body: {} });
    editor = await kit.createUser('editor');
    manager = await kit.createUser('manager');

    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'displays');
    await row('TV Portaria').waitFor();
    assert.match(await row('TV Portaria').innerText(), /Online/);
    assert.match(await row('TV Portaria').innerText(), /Pareada/);
    await row('TV Portaria').getByRole('button', { name: 'Ver sequência consolidada da TV TV Portaria' }).click();
    await page.locator('dialog[open]').getByText('Programação da portaria', { exact: true }).waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Fechar', exact: true }).click();
    await closed();
    await page.getByText(/“Online” significa que a TV falou com o servidor há poucos instantes/).waitFor();
    await s.shot('displays-01-lista');
  });

  await step('cadastrar TV (Administrador): nasce ativa e mostra o código de pareamento uma vez', async () => {
    await page.getByRole('button', { name: 'Cadastrar TV' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#display-name').waitFor();
    await dialog.getByRole('button', { name: 'Cadastrar TV' }).click();
    await dialog.getByText('Informe o nome da TV.').waitFor();
    await dialog.locator('#display-name').fill('TV Refeitório');
    await dialog.getByRole('button', { name: 'Cadastrar TV' }).click();
    await dialog.getByRole('heading', { name: 'Código de pareamento' }).waitFor();
    const first = await code();
    assert.match(first, /^\d{6}$/);
    assert.equal(await page.locator('#player-address').inputValue(), `${s.origin}/player.html`);
    await s.shot('displays-02-codigo');
    // O "player" usa o código como o player.js faz: recebe a credencial própria da TV.
    const paired = await pairWith(first);
    assert.equal(paired.status, 200);
    firstToken = paired.data.token;
    assert.equal(await manifestStatus(firstToken), 200, 'a credencial recebida abre o manifesto da TV');
    assert.equal((await pairWith(first)).status, 400, 'o código só vale uma vez');
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await closed();
    await page.reload();
    await row('TV Refeitório').waitFor();
    assert.match(await row('TV Refeitório').innerText(), /Pareada/);
    assert.deepEqual(await names(), ['TV Portaria', 'TV Refeitório']);
  });

  await step('novo código para TV pareada: avisa que desconecta e a credencial antiga deixa de valer', async () => {
    await page.getByRole('button', { name: 'Gerar código de pareamento da TV TV Refeitório' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText(/já está pareada\. Um código novo desconecta a TV atual/).waitFor();
    await s.shot('displays-03-novo-codigo');
    await dialog.getByRole('button', { name: 'Gerar código' }).click();
    await dialog.getByRole('heading', { name: 'Código de pareamento' }).waitFor();
    const second = await code();
    assert.match(second, /^\d{6}$/);
    assert.equal(await manifestStatus(firstToken), 401, 'a credencial anterior foi revogada');
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await closed();
    await page.waitForFunction(() => /Código aberto, aguardando a TV/.test(document.querySelector('.display-table')?.textContent ?? ''));
    assert.match(await row('TV Refeitório').innerText(), /Código aberto, aguardando a TV/);
  });

  await step('renomear a TV (com validação de nome vazio)', async () => {
    await page.getByRole('button', { name: 'Editar TV e acessos de TV Refeitório' }).click();
    const dialog = page.locator('dialog[open]');
    assert.equal(await dialog.locator('#display-name').inputValue(), 'TV Refeitório');
    await dialog.locator('#display-name').fill('   ');
    await dialog.getByRole('button', { name: 'Salvar TV e acessos' }).click();
    await dialog.getByText('Informe o nome da TV.').waitFor();
    await dialog.locator('#display-name').fill('TV Refeitório Central');
    await dialog.getByRole('button', { name: 'Salvar TV e acessos' }).click();
    await closed();
    await row('TV Refeitório Central').waitFor();
    assert.match(await toastText(), /TV e acessos atualizados/);
    assert.deepEqual(await names(), ['TV Portaria', 'TV Refeitório Central']);
  });

  // Gera o código pelo botão de pareamento de quem não administra TVs (Editor ou Gestor): a TV continua conectada e o código aparece uma vez.
  async function generateAsDelegate(person) {
    await row('TV Portaria').getByRole('button', { name: 'Gerar código de pareamento da TV TV Portaria' }).click();
    const confirm = page.locator('dialog[open]');
    await confirm.getByText(/A TV atual continua conectada até alguém digitar o código nela/).waitFor();
    assert.equal(await confirm.getByText(/desconecta/).count(), 0, 'este botão não desconecta a TV e não diz que desconecta');
    await confirm.getByRole('button', { name: 'Gerar código' }).click();
    await page.locator('dialog[open] .pair-code').waitFor();
    const value = await code();
    assert.match(value, /^\d{6}$/);
    generated.push(value);
    assert.equal(await manifestStatus(portaria.token), 200, 'a TV continua conectada com a credencial de antes');
    await s.shot(`displays-codigo-${person}`);
    await page.locator('dialog[open]').getByRole('button', { name: 'Concluir' }).click();
    await closed();
    await row('TV Portaria').getByText('Código aberto, aguardando a TV').waitFor();
    return value;
  }

  await step('Editor consulta TVs compartilhadas, gera o código de pareamento sem desconectar a TV e não vê ações de gestão', async () => {
    await asUser(editor);
    await row('TV Portaria').waitFor();
    await page.getByText(/Você vê somente as TVs autorizadas para seu espaço/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cadastrar TV' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /Editar TV e acessos|Remover a TV|Ativar a TV/ }).count(), 0);
    assert.ok(await page.getByRole('button', { name: /Ver sequência consolidada/ }).count());
    assert.equal(await row('TV Portaria').getByRole('button', { name: 'Gerar código de pareamento da TV TV Portaria' }).count(), 1, 'o botão de pareamento está no lugar de sempre');
    assert.equal(await page.locator('button', { hasText: /^Código de pareamento$/ }).count(), await page.locator('.display-table tbody tr').count(), 'um botão por TV autorizada, igual ao do Administrador');
    assert.equal((await kit.call('/api/displays', { method: 'POST', session: editor.session, body: { name: 'TV negada', unitId: 'leste', sectorIds: ['rh'], userIds: [] } })).status, 403);
    await s.shot('displays-04-editor');

    const value = await generateAsDelegate('editor');
    // Só quem digita o código na TV a (re)conecta: o código vale uma vez e troca a credencial.
    const repaired = await pairWith(value);
    assert.equal(repaired.status, 200);
    assert.equal(await manifestStatus(portaria.token), 401, 'a credencial antiga só deixa de valer quando o código novo é usado');
    portaria.token = repaired.data.token;
    assert.equal(await manifestStatus(portaria.token), 200);
    assert.equal((await pairWith(value)).status, 400, 'uso único');
  });

  await step('Gestor também gera o código, mas depende da TI para administrar TVs, acessos e a ordem global', async () => {
    await asUser(manager);
    await row('TV Portaria').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cadastrar TV' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /Editar TV e acessos|Remover a TV|Ativar a TV/ }).count(), 0);
    await row('TV Portaria').getByRole('button', { name: 'Ver sequência consolidada da TV TV Portaria' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('Programação da portaria', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Salvar ordem da TV' }).count(), 0);
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await closed();
    await generateAsDelegate('gestor');
    assert.equal((await kit.call(`/api/displays/${portaria.display.id}/pairing`, { method: 'POST', session: manager.session, body: {} })).status, 403, 'renovar o pareamento (que desconecta) segue só com a TI');
    assert.equal(await manifestStatus(portaria.token), 200, 'e a TV segue conectada');
    await s.shot('displays-05-gestor');
  });

  await step('a TI vê na auditoria quem gerou cada código, em qual TV e quando, sem o código', async () => {
    await asUser({ email: s.adminEmail }, s.password);
    await goTo(page, 'audit');
    await page.locator('.audit-table').waitFor();
    const events = page.locator('.audit-table tbody tr[data-action="device.pairing.generated"]');
    await events.first().waitFor();
    assert.equal(await events.count(), 2);
    for (const [index, person] of [manager, editor].entries()) {
      const text = await events.nth(index).innerText();
      assert.match(text, /Código de pareamento gerado/);
      assert.match(text, /TV Portaria/);
      assert.ok(text.includes(person.user.email), `responsável ${person.user.email}: ${text}`);
    }
    const screen = await page.locator('main').innerText();
    for (const secret of generated) assert.equal(screen.includes(secret), false, 'o código não aparece na auditoria');
    await s.shot('displays-audit-codigo-gerado');
  });

  await step('remover TV: revoga credencial e suspende vínculos preservando a programação', async () => {
    await asUser({ email: s.adminEmail }, s.password);
    await page.getByRole('button', { name: 'Remover a TV TV Portaria' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('No ar agora nesta TV: Programação da portaria.').waitFor();
    await dialog.getByText('Os arquivos e as programações são preservados. Esta TV deixa de exibi-los.').waitFor();
    await s.shot('displays-06-remover');
    await dialog.getByRole('button', { name: 'Remover TV' }).click();
    await closed();
    await page.waitForFunction(() => ![...document.querySelectorAll('.display-table b')].some(b => b.textContent === 'TV Portaria'));
    assert.match(await toastText(), /TV removida\. O acesso dela foi revogado\./);
    assert.equal(await manifestStatus(portaria.token), 401, 'a credencial da TV removida deixa de valer na hora');
    const after = await kit.call(`/api/schedules/${schedule.id}`, { session: kit.admin });
    assert.equal(after.data.displays.find(display => display.id === portaria.display.id)?.linkStatus, 'suspended', 'histórico do vínculo preservado e suspenso');
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});
