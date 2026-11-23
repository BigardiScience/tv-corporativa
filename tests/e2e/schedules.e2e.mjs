// Programações de ponta a ponta no navegador: rascunho, validações, publicar, agendar, filtros, atualizar versão,
// conflito de edição, interromper, excluir, playlist em uso e perfis (Gestor e Visualizador; o Editor tem cenário próprio em editor-programacao).
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

export default () => runScenario('Programações: rascunho, publicar, agendar, filtros, versão nova, conflito, interromper, excluir e perfis (Gestor e Visualizador)', async (s, step) => {
  const { page } = s;
  // Provocados de propósito: conflito de edição (409) e playlist em uso (409).
  s.allow(/status of 409/, /^HTTP 409 PATCH \/api\/schedules\//, /^HTTP 409 DELETE \/api\/playlists\//);
  let kit, playlist, viewer;

  const row = name => page.locator('article.schedule-row', { has: page.locator('h3', { hasText: exact(name) }) });
  const names = () => page.locator('article.schedule-row h3').allInnerTexts();
  const badgeOf = name => row(name).locator('.badge').innerText();
  const toastText = () => page.locator('#toast').innerText();
  const settled = () => page.waitForFunction(() => document.querySelector('.schedule-results')?.getAttribute('aria-busy') !== 'true');
  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const openNew = async () => {
    await page.getByRole('button', { name: 'Nova programação' }).click();
    await page.locator('#schedule-name').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#schedule-version option').length > 0);
  };
  const tv = name => page.locator('dialog[open]').getByLabel(`Exibir na TV ${name}`);

  await step('preparar playlist publicada, TVs e usuários (pela API) e abrir Programações vazia', async () => {
    kit = await s.seed();
    const a = await kit.approvedMedia(kit.admin, { title: 'Aviso A', name: 'aviso-a.png', bytes: solidPng({ color: [249, 114, 25], seed: 'A' }) });
    const b = await kit.approvedMedia(kit.admin, { title: 'Aviso B', name: 'aviso-b.png', bytes: solidPng({ color: [33, 131, 85], seed: 'B' }) });
    playlist = await kit.publishedPlaylist(kit.admin, [a.id, b.id], { name: 'Avisos da semana' });
    await kit.playlist(kit.admin, { name: 'Ainda sem versão', items: [{ mediaId: a.id }] });
    await kit.display(kit.admin, { name: 'TV Recepção' });
    await kit.display(kit.admin, { name: 'TV Refeitório' });
    viewer = await kit.createUser('viewer');
    const created = await kit.display(kit.admin, { name: 'TV Nova' });
    assert.equal(created.display.status, 'active', 'somente a TI cadastra e ativa TVs');
    kit.media = { a, b };

    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'schedules');
    await page.getByText('Sua próxima mensagem começa aqui.').waitFor();
    await page.getByText(/Horários exibidos no fuso deste navegador \(America\/Sao_Paulo\)/).waitFor();
    await s.shot('schedules-01-vazia');
  });

  await step('formulário: playlists publicadas, TVs autorizadas e validações antes de enviar', async () => {
    await openNew();
    const dialog = page.locator('dialog[open]');
    assert.deepEqual(await dialog.locator('#schedule-playlist option').allInnerTexts(), ['Avisos da semana'], 'playlist sem versão publicada não aparece');
    assert.match(await dialog.locator('#schedule-version option').first().innerText(), /^Versão 1 \(mais recente\) · 2 conteúdos/);
    assert.equal(await tv('TV Recepção').isEnabled(), true);
    assert.equal(await tv('TV Nova').isEnabled(), true, 'TV cadastrada pela TI pode ser escolhida');
    await dialog.getByText('TVs autorizadas da unidade').waitFor();
    assert.ok(await dialog.getByRole('button', { name: 'Ver sequência da TV TV Nova' }).count());
    await dialog.getByRole('button', { name: 'Salvar como rascunho' }).click();
    await dialog.getByText('Informe o nome da programação.').waitFor();
    await page.fill('#schedule-name', 'Avisos de outubro');
    await page.fill('#schedule-end', '2020-01-01T10:00');
    await dialog.getByRole('button', { name: 'Salvar como rascunho' }).click();
    await dialog.getByText('O término deve ser no futuro.').waitFor();
    await page.fill('#schedule-end', local(30));
    await page.fill('#schedule-start', local(31));
    await dialog.getByRole('button', { name: 'Salvar como rascunho' }).click();
    await dialog.getByText('O término deve ser depois do início.').waitFor();
    await s.shot('schedules-02-formulario-erros');
    await page.fill('#schedule-start', '');
    await tv('TV Recepção').check();
    await dialog.getByText('1 TV selecionada').waitFor();
    await dialog.getByRole('button', { name: 'Salvar como rascunho' }).click();
    await closed();
    await settled();
    assert.match(await toastText(), /Rascunho salvo/);
    assert.deepEqual(await names(), ['Avisos de outubro']);
    assert.equal(await badgeOf('Avisos de outubro'), 'Rascunho');
    assert.match(await row('Avisos de outubro').innerText(), /Playlist: Avisos da semana · versão 1/);
    assert.match(await row('Avisos de outubro').innerText(), /TV Recepção/);
    await s.shot('schedules-03-rascunho');
  });

  await step('publicar o rascunho: confirmação lista playlist, período e TVs; depois ele fica no ar', async () => {
    await page.getByRole('button', { name: 'Publicar a programação Avisos de outubro' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'Publicar esta programação?' }).waitFor();
    await dialog.getByText('Playlist: Avisos da semana, versão 1').waitFor();
    await dialog.getByText('TVs: TV Recepção').waitFor();
    await s.shot('schedules-04-confirmar-publicacao');
    await dialog.getByRole('button', { name: 'Publicar programação' }).click();
    await closed();
    await page.waitForFunction(() => document.querySelector('article.schedule-row .badge')?.textContent === 'No ar');
    assert.equal(await badgeOf('Avisos de outubro'), 'No ar');
    assert.equal(await page.getByRole('button', { name: 'Interromper a programação Avisos de outubro' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Excluir a programação Avisos de outubro' }).count(), 0, 'programação no ar não se exclui');
    const api = await kit.call(`/api/schedules?unitId=leste&sectorId=rh`, { session: kit.admin });
    assert.deepEqual(api.data.schedules.map(item => [item.name, item.status, item.state]), [['Avisos de outubro', 'published', 'live']], 'o servidor confirma: publicada e no ar');
  });

  await step('criar já publicada com início no futuro: fica "Agendada"', async () => {
    await openNew();
    const dialog = page.locator('dialog[open]');
    await page.fill('#schedule-name', 'Campanha de novembro');
    await page.fill('#schedule-start', local(2));
    await page.fill('#schedule-end', local(40));
    await tv('TV Recepção').check();
    await tv('TV Refeitório').check();
    await dialog.getByText('2 TVs selecionadas').waitFor();
    await dialog.getByRole('button', { name: 'Publicar agora' }).click();
    await closed();
    await page.waitForFunction(() => document.querySelectorAll('article.schedule-row').length === 2);
    assert.match(await toastText(), /Programação publicada\. Ela começa no horário definido\./);
    assert.equal(await badgeOf('Campanha de novembro'), 'Agendada');
    assert.match(await row('Campanha de novembro').innerText(), /TV Recepção, TV Refeitório/);
    // O texto do mês é escrito por CSS em maiúsculas; textContent devolve o texto original.
    assert.notEqual(await row('Campanha de novembro').locator('.schedule-date span').textContent(), 'Contínuo', 'com início definido o cartão mostra o mês');
    assert.equal(await row('Avisos de outubro').locator('.schedule-date span').textContent(), 'Contínuo', 'sem início, a programação é contínua');
    await s.shot('schedules-05-lista');
  });

  await step('filtro por situação (e no endereço): No ar, Agendadas, Rascunhos e Todas', async () => {
    await page.selectOption('#schedule-state', 'live');
    assert.deepEqual(await names(), ['Avisos de outubro']);
    assert.match(await page.evaluate(() => location.hash), /situacao=live/);
    await page.selectOption('#schedule-state', 'scheduled');
    assert.deepEqual(await names(), ['Campanha de novembro']);
    await page.selectOption('#schedule-state', 'draft');
    await page.getByText('Nenhuma programação nesta situação').waitFor();
    await page.selectOption('#schedule-state', '');
    assert.equal((await names()).length, 2);
    await page.selectOption('#schedule-state', 'live');
    await page.reload();
    await page.locator('article.schedule-row').first().waitFor();
    assert.equal(await page.locator('#schedule-state').inputValue(), 'live', 'o filtro sobrevive a recarregar a página');
    assert.deepEqual(await names(), ['Avisos de outubro']);
    await page.selectOption('#schedule-state', '');
  });

  await step('playlist ganha versão 2: a programação avisa e "Atualizar versão" troca só a versão', async () => {
    const edited = await kit.call(`/api/playlists/${playlist.id}`, { method: 'PATCH', session: kit.admin, body: { rev: playlist.draftRev, items: [{ mediaId: kit.media.b.id, durationS: 20 }] } });
    assert.equal(edited.status, 200);
    const v2 = await kit.call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: edited.data.draftRev, note: 'Só o aviso B' } });
    assert.equal(v2.status, 201);
    await goTo(page, 'playlists');
    await page.locator('.playlist-table').waitFor();
    await goTo(page, 'schedules');
    await page.locator('article.schedule-row').first().waitFor();
    await row('Avisos de outubro').locator('.chip.new-version').waitFor();
    assert.match(await row('Avisos de outubro').innerText(), /versão 1/);
    await s.shot('schedules-06-versao-nova');
    await page.getByRole('button', { name: 'Atualizar a versão da playlist da programação Avisos de outubro' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'Atualizar a versão da playlist' }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#schedule-version option').length === 2);
    assert.equal(await page.locator('#schedule-version').inputValue(), '2', 'a versão mais nova já vem escolhida');
    assert.equal(await page.locator('#schedule-playlist').isDisabled(), true, 'a playlist não muda na edição');
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await closed();
    await page.waitForFunction(() => /versão 2/.test(document.querySelector('article.schedule-row')?.textContent ?? ''));
    assert.match(await toastText(), /Versão da playlist atualizada/);
    assert.equal(await row('Avisos de outubro').locator('.chip.new-version').count(), 0);
    assert.equal(await badgeOf('Avisos de outubro'), 'No ar', 'continua no ar');
  });

  await step('conflito de edição: outra pessoa altera a programação enquanto esta tela está aberta', async () => {
    const list = await kit.call('/api/schedules?unitId=leste&sectorId=rh', { session: kit.admin });
    const target = list.data.schedules.find(item => item.name === 'Campanha de novembro');
    const changed = await kit.call(`/api/schedules/${target.id}`, { method: 'PATCH', session: kit.admin, body: { rev: target.rev, name: 'Campanha de novembro (RH)' } });
    assert.equal(changed.status, 200);
    await page.getByRole('button', { name: 'Editar a programação Campanha de novembro' }).click();
    const dialog = page.locator('dialog[open]');
    await page.waitForFunction(() => document.querySelectorAll('#schedule-version option').length > 0);
    assert.equal(await page.locator('#schedule-name').inputValue(), 'Campanha de novembro');
    await dialog.getByText('Esta programação já foi publicada.').waitFor();
    await page.fill('#schedule-name', 'Campanha de novembro (minha edição)');
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await dialog.getByText('foi alterada por outra pessoa').waitFor();
    await s.shot('schedules-07-conflito');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await closed();
    await row('Campanha de novembro (RH)').waitFor();
  });

  await step('interromper e excluir: só depois de interromper dá para excluir', async () => {
    await page.getByRole('button', { name: 'Interromper a programação Avisos de outubro' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'Interromper esta programação?' }).waitFor();
    await dialog.getByRole('button', { name: 'Interromper programação' }).click();
    await closed();
    await page.waitForFunction(() => [...document.querySelectorAll('article.schedule-row')].some(el => el.querySelector('h3')?.textContent === 'Avisos de outubro' && el.querySelector('.badge')?.textContent === 'Interrompida'));
    assert.equal(await badgeOf('Avisos de outubro'), 'Interrompida');
    assert.equal(await page.getByRole('button', { name: 'Publicar a programação Avisos de outubro' }).count(), 1, 'interrompida pode ser publicada de novo');
    await page.getByRole('button', { name: 'Excluir a programação Avisos de outubro' }).click();
    await dialog.getByRole('heading', { name: 'Excluir esta programação?' }).waitFor();
    await s.shot('schedules-08-excluir');
    await dialog.getByRole('button', { name: 'Excluir programação' }).click();
    await closed();
    await page.waitForFunction(() => document.querySelectorAll('article.schedule-row').length === 1);
    assert.deepEqual(await names(), ['Campanha de novembro (RH)']);
  });

  await step('playlist usada por programação não é excluída; "Programar esta playlist" abre o formulário já preenchido', async () => {
    await goTo(page, 'playlists');
    await page.locator('.playlist-table').waitFor();
    await page.getByRole('button', { name: 'Excluir a playlist Avisos da semana' }).click();
    await page.getByRole('button', { name: 'Excluir playlist' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'Esta playlist está em uso' }).waitFor();
    await dialog.getByText('Campanha de novembro (RH)').waitFor();
    await dialog.getByRole('button', { name: 'Entendi' }).click();
    await closed();

    await page.getByRole('link', { name: 'Editar a playlist Avisos da semana' }).click();
    await page.locator('.pl-item').first().waitFor();
    await page.getByRole('button', { name: 'Programar esta playlist' }).click();
    await page.locator('#schedule-name').waitFor();
    assert.equal(await page.locator('#schedule-playlist').inputValue(), playlist.id);
    assert.doesNotMatch(await page.evaluate(() => location.hash), /nova=1/, 'o aviso de "nova" some do endereço');
    await page.locator('.filter-note').getByText('Mostrando só as programações da playlist “Avisos da semana”.').waitFor();
    await s.shot('schedules-09-vinda-da-playlist');
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancelar' }).click();
    await closed();
    await page.locator('.filter-note').getByRole('button', { name: 'Ver todas' }).click();
    await page.waitForFunction(() => document.querySelector('.filter-note')?.hidden === true);
  });

  await step('Gestor publica; Visualizador só consulta', async () => {
    const manager = await kit.createUser('manager');
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, manager.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'schedules');
    await page.locator('article.schedule-row').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Nova programação' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Interromper a programação Campanha de novembro (RH)' }).count(), 1);

    // O Editor programa desde a 2.3.0 (ver editor-programacao.e2e.mjs); aqui só consulta quem tem o perfil Visualizador.
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, viewer.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'schedules');
    await page.locator('article.schedule-row').first().waitFor();
    await page.getByText('Seu perfil pode consultar as programações, mas não criá-las.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Nova programação' }).count(), 0);
    assert.equal(await page.locator('article.schedule-row .actions button').count(), 0, 'nenhuma ação de alteração para quem só consulta');
    await s.shot('schedules-10-visualizador');
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});
