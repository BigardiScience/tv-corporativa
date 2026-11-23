// Biblioteca em pastas, de ponta a ponta no navegador: criar pastas, enviar, aprovar, renomear, mover (arrastando), buscar e excluir.
import assert from 'node:assert/strict';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { sampleFile, solidPng } from '../helpers/http.mjs';

const MIME = { '.png': 'image/png', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
// Imagens de verdade, com uma cor por nome: as miniaturas da biblioteca ficam visíveis nas capturas de tela. O mesmo nome gera
// os mesmos bytes, então o teste de arquivo duplicado continua valendo.
const COLORS = [[249, 114, 25], [37, 99, 235], [22, 163, 74], [147, 51, 234], [225, 29, 72]];
const colorOf = name => COLORS[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COLORS.length];
const file = (name, seed = name) => {
  const extension = name.slice(name.lastIndexOf('.'));
  return { name, mimeType: MIME[extension], buffer: extension === '.png' ? solidPng({ color: colorOf(name), seed }) : sampleFile(extension, seed) };
};

export default () => runScenario('Biblioteca: pastas, envio, aprovação, mover, buscar e excluir', async (s, step) => {
  const { page } = s;
  // Este cenário provoca de propósito: duplicado (409 no envio) e pasta não vazia (409 na primeira tentativa de exclusão).
  s.allow(/^HTTP 409 POST \/api\/media\?/, /^HTTP 409 POST \/api\/library\/batch$/, /status of 409/);
  // Títulos exatos: "Comunicado RH" e "Comunicado RH (2)" (duplicado confirmado) são itens diferentes.
  const exact = text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const card = title => page.locator('.item-card', { has: page.locator('.item-title', { hasText: exact(title) }) });
  const folderCard = name => page.locator('.item-card.folder', { has: page.locator('.item-title', { hasText: exact(name) }) });

  async function newFolder(name) {
    await page.getByRole('button', { name: 'Nova pasta' }).first().click();
    await page.fill('#name-input', name);
    await page.getByRole('button', { name: 'Criar pasta' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
  }

  await step('entrar, escolher o espaço e abrir a biblioteca vazia', async () => {
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'library');
    await page.getByText('A biblioteca está vazia').waitFor();
    await s.shot('biblioteca-01-vazia');
  });

  await step('criar pastas e abrir uma pasta (endereço e caminho de navegação)', async () => {
    await newFolder('Comunicados');
    await newFolder('Treinamentos');
    await folderCard('Comunicados').waitFor();
    await s.shot('biblioteca-02-pastas');
    await folderCard('Comunicados').locator('.item-open').click();
    await page.waitForFunction(() => location.hash.startsWith('#/biblioteca/'));
    await page.getByText('Esta pasta está vazia').waitFor();
    assert.equal(await page.locator('.crumb.current').innerText(), 'Comunicados');
    await newFolder('Benefícios');
    await folderCard('Benefícios').waitFor();
  });

  await step('enviar três arquivos pela janela de envio, com progresso e conclusão', async () => {
    await page.getByRole('button', { name: 'Enviar arquivos' }).first().click();
    await page.setInputFiles('#upload-input', [file('Comunicado RH.png'), file('Regras de uso.pdf'), file('Boas vindas.png')]);
    await page.locator('.upload-row').nth(2).waitFor();
    assert.equal(await page.locator('#upload-folder option:checked').innerText(), 'Comunicados');
    await s.shot('biblioteca-03-envio-fila');
    await page.getByRole('button', { name: /^Enviar 3 arquivos/ }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await card('Comunicado RH').waitFor();
    assert.equal(await page.locator('.item-card.media').count(), 3);
    assert.equal(await card('Comunicado RH').locator('.badge').first().innerText(), 'Aguardando aprovação');
    await s.shot('biblioteca-04-arquivos-pendentes');
  });

  await step('a contagem de pendentes aparece no menu e no sino', async () => {
    await page.waitForFunction(() => document.querySelector('.nav-btn[data-route="library"] .nav-count')?.textContent === '3');
    assert.match(await page.locator('button[aria-label*="aguardando aprovação"]').first().getAttribute('aria-label'), /3 conteúdo/);
  });

  await step('duplicado é avisado e só entra com confirmação', async () => {
    await page.getByRole('button', { name: 'Enviar arquivos' }).first().click();
    await page.setInputFiles('#upload-input', [file('Comunicado RH.png')]);
    await page.getByRole('button', { name: /^Enviar 1 arquivo/ }).click();
    await page.getByText(/Já existe na biblioteca como/).waitFor();
    assert.equal(await page.locator('.item-card.media').count(), 3, 'nada novo deve entrar sem confirmação');
    await page.getByRole('button', { name: 'Enviar mesmo assim' }).click();
    await page.getByRole('button', { name: /^Enviar 1 arquivo/ }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.item-card.media').length === 4);
  });

  await step('arquivos que não podem ser enviados são recusados na própria janela, antes de qualquer envio', async () => {
    const uploads = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/media')) uploads.push(request.url()); });
    await page.getByRole('button', { name: 'Enviar arquivos' }).first().click();
    const octets = name => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('dados') });
    const hostileName = '<img src=x onerror=window.__xss=9>.PNG';
    await page.setInputFiles('#upload-input', [
      octets('slides.pptx'), octets('tabela.xlsm'), octets('projeto.psd'), octets('aplicativo.exe'),
      { name: 'vazio.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
      { name: 'disfarce.png', mimeType: 'image/png', buffer: Buffer.from('<!doctype html><script>alert(1)</script>') },
      { name: 'declarado-html.png', mimeType: 'text/html', buffer: sampleFile('.png', 'declarado') },
      { name: hostileName, mimeType: 'image/png', buffer: sampleFile('.png', 'nome-hostil') }
    ]);
    await page.locator('.upload-row').nth(7).waitFor();
    const row = name => page.locator('.upload-row', { hasText: name });
    const status = name => row(name).getAttribute('data-status');

    for (const name of ['slides.pptx', 'tabela.xlsm', 'projeto.psd', 'aplicativo.exe']) {
      assert.equal(await status(name), 'invalid', `${name} não é um formato aceito`);
      await row(name).getByText('Exporte o arquivo original para PDF, imagem ou vídeo antes de enviar.').waitFor();
    }
    assert.equal(await status('vazio.png'), 'invalid');
    await row('vazio.png').getByText('O arquivo está vazio.').waitFor();
    assert.equal(await status('disfarce.png'), 'invalid', 'HTML com nome de PNG é reconhecido pelo conteúdo');
    await row('disfarce.png').getByText(/O conteúdo do arquivo não corresponde ao formato informado/).waitFor();
    assert.equal(await status('declarado-html.png'), 'invalid');
    await row('declarado-html.png').getByText(/O tipo do arquivo não corresponde à extensão/).waitFor();

    // Um PNG verdadeiro com nome cheio de marcação passa, e o nome aparece como texto.
    const hostile = page.locator('.upload-row[data-status="ready"]');
    assert.equal(await hostile.count(), 1);
    await hostile.locator('small', { hasText: hostileName }).waitFor();
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('dialog[open] img[src="x"], dialog[open] [onerror]').count(), 0);

    const dialog = page.locator('dialog[open]');
    await dialog.getByText(/1 arquivo pronto/).waitFor();
    await dialog.getByText(/7 com problemas/).waitFor();
    await s.shot('biblioteca-05b-arquivos-recusados');
    await hostile.getByRole('button', { name: 'Remover' }).click();
    assert.equal(await dialog.getByRole('button', { name: 'Enviar', exact: true }).isDisabled(), true, 'sem arquivo válido não há o que enviar');
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    assert.deepEqual(uploads, [], 'nenhum arquivo recusado chegou a ser enviado ao servidor');
    assert.equal(await page.locator('.item-card.media').count(), 4);
  });

  await step('renomear um arquivo', async () => {
    await page.locator('button[aria-label^="Renomear “Boas vindas”"]').click();
    await page.fill('#name-input', 'Boas-vindas 2026');
    await page.getByRole('button', { name: 'Renomear', exact: true }).click();
    await card('Boas-vindas 2026').waitFor();
  });

  await step('selecionar e aprovar em lote (com ciência da ausência de antivírus)', async () => {
    await card('Comunicado RH').locator('.item-check input').click();
    await card('Boas-vindas 2026').locator('.item-check input').click();
    const bar = page.locator('.selection-bar');
    await bar.waitFor();
    assert.match(await bar.innerText(), /2 itens selecionados/);
    await bar.getByRole('button', { name: 'Aprovar' }).click();
    const approve = page.locator('dialog[open]').getByRole('button', { name: 'Aprovar', exact: true });
    assert.equal(await approve.isDisabled(), true, 'sem a ciência marcada o botão deve estar desabilitado');
    await page.locator('#ack-scan').check();
    await approve.click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => [...document.querySelectorAll('.item-card.media .badge')].filter(b => b.textContent.trim() === 'Aprovado').length === 2);
    await s.shot('biblioteca-05-aprovados');
  });

  await step('mover um arquivo arrastando-o para outra pasta', async () => {
    await card('Regras de uso').dragTo(folderCard('Benefícios'));
    await page.waitForFunction(() => ![...document.querySelectorAll('.item-title')].some(t => t.textContent === 'Regras de uso'));
    await folderCard('Benefícios').locator('.item-open').click();
    await card('Regras de uso').waitFor();
    assert.equal(await page.locator('.crumb.current').innerText(), 'Benefícios');
  });

  await step('mover pela janela "Mover para…" (inclui a árvore de pastas)', async () => {
    await page.locator('button[aria-label^="Mover “Regras de uso”"]').click();
    await page.locator('.dest-option', { hasText: 'Treinamentos' }).click();
    await page.getByRole('button', { name: 'Mover', exact: true }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => !document.querySelector('.item-card.media'));
    await page.locator('.folder-tree').getByRole('button', { name: 'Treinamentos' }).click();
    await card('Regras de uso').waitFor();
  });

  await step('buscar em toda a biblioteca mostra o caminho de cada resultado', async () => {
    await page.locator('.folder-tree').getByRole('button', { name: 'Biblioteca' }).click();
    await folderCard('Comunicados').waitFor(); // a tela é redesenhada ao trocar de pasta: espera terminar antes de digitar
    await page.fill('#library-search', 'comunicado');
    await card('Comunicado RH').first().waitFor();
    assert.ok((await page.locator('.item-path').first().innerText()).includes('Comunicados'));
    await s.shot('biblioteca-06-busca');
    await page.getByRole('button', { name: 'Limpar filtros' }).first().click();
    await folderCard('Treinamentos').waitFor();
  });

  await step('filtrar apenas os pendentes de todo o espaço (lista plana)', async () => {
    await page.click('button[aria-label*="aguardando aprovação"]');
    await page.waitForFunction(() => location.hash.includes('situacao=pending'));
    // Aprovados nos passos anteriores: "Comunicado RH" e "Boas-vindas 2026". Pendentes: a cópia confirmada "(2)" e o PDF.
    await card('Comunicado RH (2)').waitFor();
    assert.equal(await card('Comunicado RH').count(), 0, 'aprovado não aparece no filtro de pendentes');
    for (const badge of await page.locator('.item-card.media .badge').allInnerTexts()) assert.equal(badge.trim(), 'Aguardando aprovação');
    assert.equal(await page.locator('.item-path').count() >= 1, true, 'lista plana indica a pasta de cada arquivo');
  });

  await step('alternar para a lista e ordenar pela coluna Nome', async () => {
    await goTo(page, 'library');
    await page.getByRole('button', { name: 'Ver em lista' }).click();
    await page.locator('table.library-table').waitFor();
    await page.locator('th button', { hasText: 'Nome' }).click();
    await page.waitForFunction(() => location.hash.includes('ordenar') === false && document.querySelector('th[aria-sort]'));
    await s.shot('biblioteca-07-lista');
    await page.getByRole('button', { name: 'Ver em grade' }).click();
  });

  await step('detalhes de um arquivo: pré-visualização e informações', async () => {
    await folderCard('Comunicados').locator('.item-open').click();
    await card('Comunicado RH').waitFor();
    await card('Comunicado RH').locator('.item-open').click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('img.detail-preview').waitFor();
    assert.match(await dialog.innerText(), /Aprovado/);
    await s.shot('biblioteca-08-detalhes');
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
  });

  await step('excluir pasta com conteúdo exige segunda confirmação', async () => {
    await page.locator('.folder-tree').getByRole('button', { name: 'Biblioteca' }).click();
    await folderCard('Comunicados').waitFor();
    await page.locator('button[aria-label^="Excluir “Comunicados”"]').click();
    await page.getByRole('button', { name: 'Excluir', exact: true }).click();
    await page.getByText('A pasta não está vazia').waitFor();
    await page.getByRole('button', { name: 'Excluir tudo' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => ![...document.querySelectorAll('.item-title')].some(t => t.textContent === 'Comunicados'));
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => expectNoIssues(s));
});
