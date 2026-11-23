// O Editor programa de ponta a ponta no navegador (2.3.0): cria e publica nas TVs que a TI liberou, rascunha, interrompe e exclui;
// continua sem aprovar arquivos, sem publicar versões de playlist e sem administrar TVs; e a TI pode retirar a publicação de uma pessoa.
// Aviso honesto: aqui não existe TV de verdade. O que se confirma é o painel e a API; a exibição na TV é outro teste.
import assert from 'node:assert/strict';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';
import { solidPng } from '../helpers/http.mjs';

const exact = text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const pad = number => String(number).padStart(2, '0');
// Valor de um campo datetime-local daqui a `days` dias (a diferença de dias não depende do fuso).
const local = (days, hour = 9) => {
  const date = new Date(Date.now() + days * 86400000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:00`;
};

export default () => runScenario('Editor programa: criar, publicar, interromper e excluir nas TVs liberadas; sem aprovar nem publicar playlist; a TI pode retirar a publicação', async (s, step) => {
  const { page } = s;
  let kit, editor, drafter, reception, media;

  const row = name => page.locator('article.schedule-row', { has: page.locator('h3', { hasText: exact(name) }) });
  const names = () => page.locator('article.schedule-row h3').allInnerTexts();
  const badgeOf = name => row(name).locator('.badge').innerText();
  const toastText = () => page.locator('#toast').innerText();
  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const tv = name => page.locator('dialog[open]').getByLabel(`Exibir na TV ${name}`);
  const manifest = async () => (await kit.call('/api/player/manifest', { token: reception.token })).data.items.map(item => item.id);
  const openNew = async () => {
    await page.getByRole('button', { name: 'Nova programação' }).click();
    await page.locator('#schedule-name').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#schedule-version option').length > 0);
  };
  const signInAs = async (email, password = PASSWORD) => {
    if (await page.getByRole('button', { name: 'Sair com segurança' }).count()) await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, email, password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
  };

  await step('preparar pela API: playlist publicada pela TI, duas TVs (só uma liberada ao RH) e duas contas de Editor', async () => {
    kit = await s.seed();
    const a = await kit.approvedMedia(kit.admin, { title: 'Aviso A', name: 'aviso-a.png', bytes: solidPng({ color: [249, 114, 25], seed: 'EA' }) });
    const b = await kit.approvedMedia(kit.admin, { title: 'Aviso B', name: 'aviso-b.png', bytes: solidPng({ color: [33, 131, 85], seed: 'EB' }) });
    media = [a.id, b.id];
    await kit.publishedPlaylist(kit.admin, media, { name: 'Avisos da semana' });
    await kit.playlist(kit.admin, { name: 'Ainda sem versão', items: [{ mediaId: a.id }] });
    reception = await kit.pairedDisplay(kit.admin, { name: 'TV Recepção' });
    await kit.display(kit.admin, { name: 'TV da TI', sectorId: 'ti' });
    editor = await kit.createUser('editor');
    // Editor a quem a TI retirou a publicação: só prepara rascunhos.
    drafter = await kit.createUser('editor', { revokes: ['schedule:publish'] });
    assert.deepEqual(editor.user.permissions.filter(id => id.startsWith('schedule:')), ['schedule:create', 'schedule:publish'], 'o padrão do Editor');
  });

  await step('o Editor abre Programações: pode criar, e a tela não o trata como alguém que só consulta', async () => {
    await signInAs(editor.email);
    await goTo(page, 'schedules');
    await page.getByRole('button', { name: 'Nova programação' }).waitFor();
    await page.getByText('Sua próxima mensagem começa aqui.').waitFor();
    assert.equal(await page.getByText(/Seu perfil pode consultar as programações/).count(), 0);
    assert.equal(await page.getByText(/Você cria rascunhos, mas a publicação/).count(), 0);
    await s.shot('editor-programacao-01-vazia');
  });

  await step('formulário: só playlists publicadas e só TVs liberadas; "Publicar agora" coloca no ar', async () => {
    await openNew();
    const dialog = page.locator('dialog[open]');
    assert.deepEqual(await dialog.locator('#schedule-playlist option').allInnerTexts(), ['Avisos da semana'], 'playlist sem versão publicada não aparece');
    assert.equal(await tv('TV Recepção').count(), 1);
    assert.equal(await tv('TV da TI').count(), 0, 'TV liberada a outro setor não é oferecida');
    // Publicar sem nome e sem TV é recusado antes de qualquer envio; depois o formulário é reaberto limpo.
    await dialog.getByRole('button', { name: 'Publicar agora' }).click();
    await dialog.getByText('Informe o nome da programação.').waitFor();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await closed();
    assert.equal(await page.locator('article.schedule-row').count(), 0, 'nada foi criado pela tentativa vazia');
    await openNew();
    await page.fill('#schedule-name', 'Avisos do Editor');
    await page.fill('#schedule-end', local(30));
    await tv('TV Recepção').check();
    await s.shot('editor-programacao-02-formulario');
    await dialog.getByRole('button', { name: 'Publicar agora' }).click();
    await closed();
    await row('Avisos do Editor').waitFor();
    assert.match(await toastText(), /Programação publicada\./);
    assert.equal(await badgeOf('Avisos do Editor'), 'No ar');
    assert.deepEqual(await manifest(), media, 'a TV passa a receber os dois conteúdos');
    await s.shot('editor-programacao-03-no-ar');
  });

  await step('rascunho: salvar, conferir que não vai à TV e publicar pelo botão da linha, com confirmação', async () => {
    await openNew();
    const dialog = page.locator('dialog[open]');
    await page.fill('#schedule-name', 'Campanha de novembro');
    await tv('TV Recepção').check();
    await dialog.getByRole('button', { name: 'Salvar como rascunho' }).click();
    await closed();
    await row('Campanha de novembro').waitFor();
    assert.equal(await badgeOf('Campanha de novembro'), 'Rascunho');
    assert.deepEqual(await manifest(), media, 'rascunho não muda o que a TV recebe');
    await page.getByRole('button', { name: 'Publicar a programação Campanha de novembro' }).click();
    await page.locator('dialog[open]').getByRole('heading', { name: 'Publicar esta programação?' }).waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Publicar programação' }).click();
    await closed();
    await page.waitForFunction(() => [...document.querySelectorAll('article.schedule-row')].some(el => el.querySelector('h3')?.textContent === 'Campanha de novembro' && el.querySelector('.badge')?.textContent === 'No ar'));
    assert.deepEqual(await manifest(), [...media, ...media], 'duas programações no ar na mesma TV entram na sequência');
  });

  await step('interromper e excluir o que ele publicou (excluir só depois de interromper)', async () => {
    assert.equal(await page.getByRole('button', { name: 'Excluir a programação Avisos do Editor' }).count(), 0, 'no ar não se exclui');
    await page.getByRole('button', { name: 'Interromper a programação Avisos do Editor' }).click();
    await page.locator('dialog[open]').getByRole('heading', { name: 'Interromper esta programação?' }).waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Interromper programação' }).click();
    await closed();
    await page.waitForFunction(() => [...document.querySelectorAll('article.schedule-row')].some(el => el.querySelector('h3')?.textContent === 'Avisos do Editor' && el.querySelector('.badge')?.textContent === 'Interrompida'));
    assert.deepEqual(await manifest(), media, 'só a outra programação continua na TV');
    await page.getByRole('button', { name: 'Excluir a programação Avisos do Editor' }).click();
    await page.locator('dialog[open]').getByRole('heading', { name: 'Excluir esta programação?' }).waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Excluir programação' }).click();
    await closed();
    await page.waitForFunction(() => document.querySelectorAll('article.schedule-row').length === 1);
    assert.deepEqual(await names(), ['Campanha de novembro']);
  });

  await step('o que continua com o Gestor e a TI: aprovar arquivos, publicar versões de playlist, administrar TVs e usuários', async () => {
    const pending = await kit.upload(editor.session, { title: 'Enviado pelo Editor', name: 'enviado.png' });
    await goTo(page, 'library');
    await page.getByText('Enviado pelo Editor').first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^Aprovar/ }).count(), 0, 'o Editor não aprova arquivos');
    assert.equal((await kit.call(`/api/media/${pending.id}/approve`, { method: 'POST', session: editor.session, body: { acknowledgeUnscanned: true } })).status, 403);

    await goTo(page, 'playlists');
    await page.locator('.playlist-table').waitFor();
    await page.getByRole('link', { name: 'Editar a playlist Avisos da semana' }).click();
    await page.locator('.pl-item').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Publicar versão' }).count(), 0, 'o Editor não publica versões de playlist');
    await page.getByText('Você prepara o rascunho; a publicação de versões é feita por um Gestor ou pela TI.').waitFor();
    await page.getByRole('button', { name: 'Programar esta playlist' }).waitFor();

    await goTo(page, 'displays');
    await page.locator('.display-table').waitFor();
    assert.equal(await page.locator('.display-table tbody tr').count(), 1, 'só a TV liberada ao RH aparece');
    await page.locator('.display-table').getByText('Destino autorizado').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cadastrar TV' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /Editar TV e acessos|Remover a TV|Ativar a TV/ }).count(), 0);
    assert.equal(await page.locator('.nav-btn[data-route="users"]').count(), 0, 'sem Usuários no menu');
    await s.shot('editor-programacao-04-telas');
  });

  await step('Editor sem a publicação (retirada pela TI): cria e ajusta rascunhos, vê o aviso e não encontra "Publicar"', async () => {
    await signInAs(drafter.email);
    await goTo(page, 'schedules');
    await row('Campanha de novembro').waitFor();
    await page.getByText('Você cria rascunhos, mas a publicação depende de quem tem essa permissão.').waitFor();
    assert.equal(await page.getByRole('button', { name: /^(Publicar|Interromper|Editar|Excluir) a programação Campanha de novembro/ }).count(), 0, 'o que está no ar só muda com quem publica');
    await openNew();
    const dialog = page.locator('dialog[open]');
    assert.equal(await dialog.getByRole('button', { name: 'Publicar agora' }).count(), 0, 'o formulário não oferece publicar');
    await page.fill('#schedule-name', 'Rascunho sem publicar');
    await tv('TV Recepção').check();
    await dialog.getByRole('button', { name: 'Salvar como rascunho' }).click();
    await closed();
    await row('Rascunho sem publicar').waitFor();
    assert.equal(await badgeOf('Rascunho sem publicar'), 'Rascunho');
    assert.equal(await page.getByRole('button', { name: 'Publicar a programação Rascunho sem publicar' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Editar a programação Rascunho sem publicar' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Excluir a programação Rascunho sem publicar' }).count(), 1);
    await s.shot('editor-programacao-05-so-rascunho');
  });

  await step('a TI retira a publicação do primeiro Editor: o que ele publicou sai do ar e a tela da TI mostra o vínculo suspenso', async () => {
    const response = await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { revokes: ['schedule:publish'] } });
    assert.equal(response.status, 200);
    assert.deepEqual(await manifest(), [], 'a TV deixa de receber o que foi publicado por quem perdeu a permissão');
    await signInAs(s.adminEmail, s.password);
    await goTo(page, 'schedules');
    await row('Campanha de novembro').waitFor();
    await row('Campanha de novembro').getByText(/1 vínculo suspenso: não exibem esta programação/).waitFor();
    await s.shot('editor-programacao-06-vinculo-suspenso');
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});
