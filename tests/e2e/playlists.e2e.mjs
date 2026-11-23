// Playlists de ponta a ponta no navegador: criar, montar, reordenar, salvar, publicar, versões, restaurar, prévia e perfis.
import assert from 'node:assert/strict';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';
import { solidPng } from '../helpers/http.mjs';

const exact = text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export default () => runScenario('Playlists: montar, reordenar, salvar, publicar, versões, prévia e perfis', async (s, step) => {
  const { page } = s;
  // Provocados de propósito: conflito de edição (409 no PATCH).
  s.allow(/status of 409/, /^HTTP 409 PATCH \/api\/playlists\//);
  let kit, playlistId;
  const titles = () => page.locator('.pl-item .pl-title').allInnerTexts();
  const row = title => page.locator('.pl-item', { has: page.locator('.pl-title', { hasText: exact(title) }) });
  const state = () => page.locator('.save-state').innerText();
  const toastText = () => page.locator('#toast').innerText();

  async function addFromLibrary(names, { status } = {}) {
    await page.getByRole('button', { name: 'Adicionar da biblioteca' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('.picker-row').first().waitFor();
    if (status) {
      await dialog.locator('#picker-status').selectOption(status);
      await page.waitForFunction(() => document.querySelector('.picker-list')?.getAttribute('aria-busy') !== 'true');
    }
    for (const name of names) await dialog.getByLabel(`Selecionar ${name}`).check();
    await dialog.getByRole('button', { name: 'Adicionar à playlist' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
  }

  async function save() {
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.waitForFunction(() => document.querySelector('.save-state')?.textContent === 'Tudo salvo');
  }

  await step('preparar arquivos aprovados na biblioteca (pela API) e abrir Playlists vazia', async () => {
    kit = await kitSetup(s);
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'playlists');
    await page.getByText('Nenhuma playlist neste espaço ainda').waitFor();
    await s.shot('playlists-01-vazia');
  });

  await step('criar a playlist e cair no editor vazio', async () => {
    await page.getByRole('button', { name: 'Criar a primeira playlist' }).click();
    await page.fill('#playlist-name', 'Avisos da semana');
    await page.fill('#playlist-description', 'Comunicados do RH');
    await page.getByRole('button', { name: 'Criar playlist' }).click();
    await page.waitForFunction(() => /^#\/playlists\/[A-Za-z0-9_-]+$/.test(location.hash));
    playlistId = (await page.evaluate(() => location.hash)).split('/').pop();
    await page.getByRole('heading', { level: 1, name: 'Avisos da semana' }).waitFor();
    await page.getByText('Nenhum conteúdo ainda').waitFor();
    assert.equal(await state(), 'Tudo salvo');
    assert.equal(await page.getByRole('button', { name: 'Publicar versão', exact: true }).isDisabled(), true, 'sem conteúdo não publica');
    await s.shot('playlists-02-editor-vazio');
  });

  await step('adicionar da biblioteca: só aprovados por padrão, e o limite de seleção vale', async () => {
    await page.getByRole('button', { name: 'Adicionar da biblioteca' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('.picker-row').first().waitFor();
    assert.equal(await dialog.locator('.picker-row').count(), 7, 'somente os 7 aprovados');
    assert.equal(await dialog.getByText('Pendente H').count(), 0);
    await s.shot('playlists-03-seletor');
    // Busca por nome (sem acento/caixa) e volta.
    await dialog.locator('#picker-search').fill('aviso b');
    await page.waitForFunction(() => document.querySelectorAll('.picker-row').length === 1);
    await dialog.getByLabel('Selecionar Aviso B').check();
    await dialog.locator('#picker-search').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.picker-row').length === 7);
    assert.equal(await dialog.getByLabel('Selecionar Aviso B').isChecked(), true, 'a seleção continua depois de mudar a busca');
    await dialog.getByLabel('Selecionar Aviso A').check();
    await dialog.getByLabel('Selecionar Aviso C').check();
    assert.match(await dialog.locator('.picker-counter').innerText(), /3 arquivos selecionados/);
    await dialog.getByRole('button', { name: 'Adicionar à playlist' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    // Os arquivos entram na ordem em que foram marcados (B, A, C), não na ordem alfabética da lista.
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso A', 'Aviso C']);
    assert.equal(await state(), 'Alterações não salvas');
  });

  await step('reordenar com os botões (foco acompanha) e arrastando a alça', async () => {
    await page.getByRole('button', { name: 'Mover “Aviso C” para cima' }).click();
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso C', 'Aviso A']);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Mover “Aviso C” para cima');
    await page.keyboard.press('Enter');
    assert.deepEqual(await titles(), ['Aviso C', 'Aviso B', 'Aviso A']);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Mover “Aviso C” para baixo', 'no limite, o foco vai para o botão oposto');
    assert.equal(await page.getByRole('button', { name: 'Mover “Aviso C” para cima' }).isDisabled(), true);
    await row('Aviso B').locator('.pl-handle').dragTo(row('Aviso C'), { targetPosition: { x: 220, y: 4 } });
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso C', 'Aviso A']);
    await s.shot('playlists-04-reordenada');
  });

  await step('tempo e transição por item; valores fora do limite são corrigidos', async () => {
    const duration = page.getByLabel('Duração (s) de “Aviso B”');
    await duration.fill('2');
    await duration.blur();
    assert.equal(await duration.inputValue(), '5', 'mínimo de 5 s');
    await duration.fill('20');
    await duration.blur();
    assert.equal(await page.getByLabel('Efeito (ms) de “Aviso B”').isVisible(), false, 'corte seco não tem duração de efeito');
    await page.getByLabel('Transição de “Aviso B”').selectOption('fade');
    assert.equal(await page.getByLabel('Efeito (ms) de “Aviso B”').inputValue(), '600');
    assert.equal(await page.getByLabel('Transição de “Aviso C”').inputValue(), 'cut');
    assert.match(await page.locator('.pl-summary').innerText(), /3 de 6 conteúdos · um ciclo completo dura 50 s/);
    await s.shot('playlists-05-tempos');
  });

  await step('sair com alterações pede confirmação; "continuar editando" mantém tudo', async () => {
    await goTo(page, 'overview');
    await page.getByText('Sair sem salvar?').waitFor();
    await page.getByRole('button', { name: 'Continuar editando' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => location.hash.startsWith('#/playlists/'));
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso C', 'Aviso A']);
  });

  await step('salvar; recarregar a página mantém ordem, tempo e transição', async () => {
    await save();
    assert.match(await toastText(), /Rascunho salvo/);
    await page.reload();
    await page.locator('.pl-item').first().waitFor();
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso C', 'Aviso A']);
    assert.equal(await page.getByLabel('Duração (s) de “Aviso B”').inputValue(), '20');
    assert.equal(await page.getByLabel('Transição de “Aviso B”').inputValue(), 'fade');
    assert.equal(await state(), 'Tudo salvo');
  });

  await step('publicar a versão 1 com nota', async () => {
    await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('Publicar a versão 1').waitFor();
    assert.equal(await dialog.locator('.publish-item').count(), 3);
    assert.equal(await dialog.locator('.publish-item.bad').count(), 0);
    await dialog.locator('#publish-note').fill('Primeira versão');
    await s.shot('playlists-06-publicar');
    await dialog.getByRole('button', { name: 'Publicar versão 1' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.locator('.version-item').first().waitFor();
    assert.equal(await page.locator('.version-item').count(), 1);
    assert.match(await page.locator('.version-item').first().innerText(), /Primeira versão/);
    assert.match(await page.locator('.pl-status .badge').first().innerText(), /Versão 1 publicada/);
    assert.equal(await page.getByRole('button', { name: 'Publicar versão', exact: true }).isDisabled(), true, 'sem alterações novas não há o que publicar');
    await s.shot('playlists-07-publicada');
  });

  await step('editar, publicar a versão 2, ver a versão 1 e restaurá-la no rascunho', async () => {
    await page.getByRole('button', { name: 'Remover “Aviso A” da playlist' }).click();
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso C']);
    await save();
    assert.match(await page.locator('.pl-status .badge').first().innerText(), /Rascunho com alterações/);
    await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Publicar versão 2' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.version-item').length === 2);

    await page.getByRole('button', { name: 'Ver o conteúdo da versão 1' }).click();
    const view = page.locator('dialog[open]');
    await view.locator('.publish-item').first().waitFor();
    assert.equal(await view.locator('.publish-item').count(), 3);
    await view.getByRole('button', { name: 'Fechar' }).first().click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });

    await page.getByRole('button', { name: 'Restaurar a versão 1 no rascunho' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Restaurar no rascunho' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.pl-item').length === 3);
    assert.deepEqual(await titles(), ['Aviso B', 'Aviso C', 'Aviso A']);
    assert.equal(await state(), 'Tudo salvo', 'a restauração já foi gravada no rascunho');
    assert.match(await page.locator('.pl-status .badge').first().innerText(), /Rascunho com alterações/, 'restaurar não publica nada');
  });

  await step('conteúdo aguardando aprovação entra no rascunho, mas impede a publicação', async () => {
    await addFromLibrary(['Pendente H'], { status: 'pending' });
    assert.equal(await row('Pendente H').locator('.badge').first().innerText(), 'Aguardando aprovação');
    await row('Pendente H').getByText('Precisa ser aprovado na biblioteca antes de publicar.').waitFor();
    await save();
    await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('Há conteúdos que ainda não foram liberados').waitFor();
    assert.equal(await dialog.getByRole('button', { name: /^Publicar versão \d/ }).isDisabled(), true);
    await s.shot('playlists-08-bloqueio-publicacao');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.getByRole('button', { name: 'Remover “Pendente H” da playlist' }).click();
    await save();
  });

  await step('o limite de conteúdos por playlist é respeitado na seleção e no botão', async () => {
    // 3 itens + limite 6 → cabem mais 3.
    await page.getByRole('button', { name: 'Adicionar da biblioteca' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('.picker-row').first().waitFor();
    for (const name of ['Aviso D', 'Aviso E', 'Aviso F']) await dialog.getByLabel(`Selecionar ${name}`).check();
    assert.equal(await dialog.getByLabel('Selecionar Aviso G').isDisabled(), true, 'não cabe mais nenhum');
    await dialog.getByRole('button', { name: 'Adicionar à playlist' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    assert.equal((await titles()).length, 6);
    assert.equal(await page.getByRole('button', { name: 'Adicionar da biblioteca' }).first().isDisabled(), true);
    assert.match(await page.locator('.pl-summary').innerText(), /6 de 6 conteúdos/);
    await save();
  });

  await step('pré-visualização percorre os conteúdos na ordem e pode pausar', async () => {
    await page.getByRole('button', { name: 'Pré-visualizar' }).click();
    const dialog = page.locator('dialog[open]');
    // Fase 2: o motor da TV prepara o próximo conteúdo em segundo plano (camada escondida), então só a camada visível conta, e o texto
    // da posição muda quando o novo conteúdo é de fato exibido (não no instante do clique).
    const shown = pattern => page.waitForFunction(source => new RegExp(source).test(document.querySelector('dialog[open] .preview-label')?.textContent ?? ''), pattern.source);
    await dialog.locator('.preview-stage .stage-layer:not(.is-standby) img').waitFor();
    assert.match(await dialog.locator('.preview-label').innerText(), /^1 de 6 · Aviso B · 20 s$/);
    await dialog.getByRole('button', { name: 'Próximo' }).click();
    await shown(/^2 de 6 · Aviso C/);
    await dialog.getByRole('button', { name: 'Pausar' }).click();
    await dialog.getByRole('button', { name: 'Reproduzir' }).waitFor();
    await dialog.getByRole('button', { name: 'Anterior' }).click();
    await shown(/^1 de 6/);
    await s.shot('playlists-09-previa');
    await dialog.getByRole('button', { name: 'Fechar' }).last().click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
  });

  await step('conflito de edição: a tela oferece carregar a versão mais recente', async () => {
    const other = await s.api.adminSession();
    const current = await s.api.call(`/api/playlists/${playlistId}`, { session: other });
    assert.equal(current.status, 200);
    const changed = await s.api.call(`/api/playlists/${playlistId}`, { method: 'PATCH', session: other, body: { rev: current.data.draftRev, name: 'Avisos (outra pessoa)' } });
    assert.equal(changed.status, 200);
    await page.fill('#playlist-description', 'minha alteração');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.getByText('Outra pessoa alterou esta playlist').waitFor();
    await s.shot('playlists-10-conflito');
    await page.getByRole('button', { name: 'Carregar a versão mais recente' }).click();
    await page.waitForFunction(() => document.querySelector('#playlist-name')?.value === 'Avisos (outra pessoa)');
    assert.equal(await page.locator('#playlist-description').inputValue(), 'Comunicados do RH', 'a edição local foi descartada');
    assert.equal(await state(), 'Tudo salvo');
  });

  await step('Editor prepara o rascunho, mas não publica; Visualizador só consulta', async () => {
    const editor = await kit.createUser('editor');
    const viewer = await kit.createUser('viewer');
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, editor.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await page.goto(`${s.origin}/#/playlists/${playlistId}`);
    await page.locator('.pl-item').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Salvar rascunho' }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Publicar versão', exact: true }).count(), 0);
    await page.getByText('Você prepara o rascunho; a publicação de versões é feita por um Gestor').waitFor();
    assert.equal(await page.locator('.nav-btn[data-route="users"]').count(), 0, 'Editor não vê Usuários');
    await s.shot('playlists-11-editor');

    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, viewer.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await page.goto(`${s.origin}/#/playlists/${playlistId}`);
    await page.locator('.pl-item').first().waitFor();
    await page.getByText('Você pode consultar esta playlist, mas seu perfil não permite editá-la.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Salvar rascunho' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Adicionar da biblioteca' }).count(), 0);
    assert.equal(await page.locator('#playlist-name').isDisabled(), true);
    assert.equal(await page.locator('.pl-handle').count(), 0, 'sem alça de arrastar');
    await goTo(page, 'playlists');
    await page.locator('.playlist-table').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Nova playlist' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Excluir a playlist/ }).count(), 0);
    await s.shot('playlists-12-visualizador');
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});

// Cria os arquivos de apoio: 7 aprovados e 1 aguardando aprovação, no espaço Leste / RH.
async function kitSetup(s) {
  const kit = await s.seed();
  const colors = { A: [249, 114, 25], B: [33, 131, 85], C: [43, 108, 176], D: [128, 90, 213], E: [13, 148, 136], F: [202, 138, 4], G: [107, 114, 128] };
  for (const [letter, color] of Object.entries(colors)) await kit.approvedMedia(kit.admin, { title: `Aviso ${letter}`, name: `aviso-${letter}.png`, bytes: solidPng({ color, seed: letter }) });
  await kit.upload(kit.admin, { title: 'Pendente H', name: 'pendente-h.png', bytes: solidPng({ color: [190, 24, 93], seed: 'H' }) });
  return kit;
}
