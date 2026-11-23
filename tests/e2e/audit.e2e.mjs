// Auditoria de ponta a ponta no navegador: leitura dos eventos, busca e filtros (inclusive no endereço), detalhes e integridade,
// paginação por "carregar mais", exportação em CSV (com proteção contra fórmula) e o que cada perfil enxerga.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';

const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// O arquivo vem com BOM e células entre aspas separadas por ponto e vírgula.
function parseCsv(text) {
  assert.equal(text.charCodeAt(0), 0xFEFF, 'o arquivo começa com BOM (o Excel reconhece UTF-8)');
  return text.slice(1).split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"')));
}

export default () => runScenario('Auditoria: eventos legíveis, busca, filtros, detalhes, "carregar mais", CSV e perfis', async (s, step) => {
  const { page } = s;
  let kit, manager, editor, total;

  const rows = () => page.locator('.audit-table tbody tr');
  const row = action => page.locator(`.audit-table tbody tr[data-action="${action}"]`);
  const countText = () => page.locator('.library-count').innerText();
  const toastText = () => page.locator('#toast').innerText();
  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const rowTexts = () => rows().allInnerTexts();
  const apiTotal = async () => (await kit.call('/api/audit?limit=500', { session: kit.admin })).data.events.length;
  const settled = () => page.waitForFunction(() => !document.querySelector('.audit-results')?.hasAttribute('aria-busy'));
  const download = async trigger => {
    const [file] = await Promise.all([page.waitForEvent('download'), trigger()]);
    return { name: file.suggestedFilename(), text: readFileSync(await file.path(), 'utf8') };
  };

  await step('preparar eventos de várias categorias (pela API) e abrir a Auditoria como Administrador', async () => {
    kit = await s.seed();
    manager = await kit.createUser('manager', { email: 'gil.gestor@example.invalid' });
    editor = await kit.createUser('editor', { email: 'edu.editor@example.invalid' });
    const media = await kit.approvedMedia(kit.admin, { title: 'Comunicado de segurança' });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id], { name: 'Playlist da recepção' });
    const tv = await kit.pairedDisplay(kit.admin, { name: 'TV da recepção' });
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id], name: 'Programação de outubro' });
    await kit.folder(kit.admin, { name: '=1+1' });
    await kit.folder(kit.admin, { unitId: 'centro', sectorId: 'seguranca', name: 'Pasta da Segurança' });

    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'audit');
    await page.locator('.audit-table').waitFor();
    await page.getByText('Você vê os eventos de todas as unidades e de todos os setores.').waitFor();
    total = await apiTotal();
    assert.equal(await rows().count(), total, 'a tela mostra todos os eventos que a API devolve');

    // Cada evento diz QUEM e O QUÊ, não só o tipo da ação.
    assert.match(await row('user.created').filter({ hasText: 'gil.gestor@example.invalid' }).innerText(), /perfil Gestor/);
    assert.match(await row('media.approved').first().innerText(), /Comunicado de segurança/);
    const paired = await row('device.paired').innerText();
    assert.match(paired, /TV da recepção/);
    assert.match(paired, /TV \(player\)/, 'o responsável do pareamento é o player, não um e-mail');
    assert.match(await row('schedule.published').innerText(), /Programação de outubro[\s\S]*1 TV/);
    const outside = await row('folder.created').filter({ hasText: 'Pasta da Segurança' }).innerText();
    assert.match(outside, /Unidade Centro/, 'o Administrador vê também as outras unidades, com a unidade e o setor de cada evento');
    assert.match(await row('auth.login').first().locator('.audit-actor').innerText(), /@example\.invalid$/);
    const stamps = await page.locator('.audit-table time').evaluateAll(list => list.map(item => item.getAttribute('datetime')));
    assert.ok(stamps.length === total && stamps.every(value => !Number.isNaN(Date.parse(value)) && value.endsWith('Z')), 'cada evento traz a data em UTC');
    await s.shot('audit-01-lista');
  });

  await step('busca (sem acento), categoria e período; tudo vai para o endereço e volta ao recarregar', async () => {
    await page.locator('#audit-search').fill('programacao');
    await page.waitForFunction(() => document.querySelectorAll('.audit-table tbody tr').length < 30 && [...document.querySelectorAll('.audit-table tbody tr')].every(item => /programa/i.test(item.textContent)));
    assert.ok((await rows().count()) >= 2, 'a busca "programacao" acha "Programação criada" e "publicada"');
    await page.locator('#audit-search').fill('tv da recep');
    await page.waitForFunction(() => [...document.querySelectorAll('.audit-table tbody tr')].every(item => /tv da recep/i.test(item.textContent)) && document.querySelectorAll('.audit-table tbody tr').length > 0);
    assert.match(await countText(), /eventos? de \d+ carregados/);
    assert.match(page.url(), /q=tv\+da\+recep|q=tv%20da%20recep/);

    await page.locator('#audit-search').fill('');
    await page.locator('#audit-category').selectOption('displays');
    await page.waitForFunction(() => [...document.querySelectorAll('.audit-table tbody tr')].every(item => item.dataset.category === 'displays'));
    const displayRows = await rows().count();
    assert.ok(displayRows >= 3 && displayRows < total, 'só os eventos de telas');
    await page.locator('#audit-period').selectOption('24h');
    await settled();
    assert.equal(await rows().count(), displayRows, 'eventos recentes continuam dentro das últimas 24 horas');
    assert.match(page.url(), /categoria=displays/);
    assert.match(page.url(), /periodo=24h/);

    await page.reload();
    await page.locator('.audit-table').waitFor();
    assert.equal(await page.locator('#audit-category').inputValue(), 'displays', 'a categoria volta do endereço');
    assert.equal(await page.locator('#audit-period').inputValue(), '24h');
    assert.equal(await rows().count(), displayRows);

    await page.locator('#audit-search').fill('zzzzzz');
    await page.getByText('Nenhum evento encontrado').waitFor();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.audit-table tbody tr').length > 0);
    assert.equal(await page.locator('#audit-search').inputValue(), '');
    assert.equal(await page.locator('#audit-category').inputValue(), '');
    assert.equal(await page.locator('#audit-period').inputValue(), '');
    assert.equal(await rows().count(), total);
    assert.doesNotMatch(page.url(), /categoria|periodo|q=/);
  });

  await step('detalhes de um evento: data em UTC, o que foi gravado e a cadeia de hashes', async () => {
    const approved = row('media.approved').first();
    const eventId = await approved.getAttribute('data-event-id');
    const stamp = await approved.locator('time').getAttribute('datetime');
    await approved.getByRole('button', { name: `Ver detalhes do evento ${eventId}` }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'Arquivo aprovado' }).waitFor();
    await dialog.getByText(`Evento nº ${eventId}`).waitFor();
    assert.ok((await dialog.innerText()).includes(stamp), 'a janela mostra a mesma data em UTC da linha');
    const json = JSON.parse(await dialog.locator('.audit-json').innerText());
    assert.equal(json.title, 'Comunicado de segurança');
    assert.ok(json.mediaId && 'scanStatus' in json);
    const hashes = await dialog.locator('.audit-hash').allInnerTexts();
    assert.equal(hashes.length, 2);
    assert.ok(hashes.every(value => /^[0-9a-f]{64}$/.test(value)), 'hash do evento e do anterior (SHA-256)');
    await s.shot('audit-02-detalhes');
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).first().click();
    await closed();
  });

  await step('mais de uma página: "Carregar mais eventos", sem repetir e sem perder nenhum', async () => {
    for (let index = 0; index < 230; index++) await kit.folder(kit.admin, { name: `Lote ${index}` });
    total = await apiTotal();
    assert.ok(total > 200 && total < 500, `o cenário precisa de 2 páginas (total ${total})`);
    await page.getByRole('button', { name: 'Atualizar' }).click();
    await page.waitForFunction(() => /^200 eventos/.test(document.querySelector('.library-count')?.textContent ?? ''));
    assert.match(await countText(), /há registros mais antigos/);
    assert.equal(await rows().count(), 200, 'entraram mais eventos novos do que cabe numa página: a lista recomeça da mais nova');
    const more = page.getByRole('button', { name: 'Carregar mais eventos' });
    await more.waitFor();
    await more.click();
    await page.waitForFunction(count => document.querySelectorAll('.audit-table tbody tr').length === count, total);
    await page.waitForFunction(() => document.querySelector('.audit-more')?.hidden === true);
    const ids = await rows().evaluateAll(list => list.map(item => Number(item.dataset.eventId)));
    assert.equal(new Set(ids).size, total, 'nenhum evento repetido');
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'do mais novo ao mais antigo');
    assert.doesNotMatch(await countText(), /mais antigos/);
  });

  await step('período com histórico incompleto: a tela carrega o que falta antes de filtrar', async () => {
    await page.reload();
    await page.locator('.audit-table').waitFor();
    assert.equal(await rows().count(), 200, 'ao entrar, só a primeira página');
    await page.locator('#audit-period').selectOption('24h');
    await page.waitForFunction(count => document.querySelectorAll('.audit-table tbody tr').length === count, total);
    assert.equal(await page.locator('.audit-more').isHidden(), true, 'tudo carregado: não restam registros mais antigos');
    await page.locator('#audit-period').selectOption('');
  });

  await step('exportar CSV: tudo, só o filtrado e nada quando não há o que exportar; fórmulas viram texto', async () => {
    const all = await download(() => page.getByRole('button', { name: 'Exportar CSV' }).click());
    assert.match(all.name, /^tvcorp-auditoria-\d{4}-\d{2}-\d{2}\.csv$/);
    const table = parseCsv(all.text);
    assert.deepEqual(table[0], ['Data', 'Responsável', 'Ação', 'Detalhes', 'Descrição', 'Unidade', 'Setor', 'Resumo']);
    assert.equal(table.length - 1, total, 'todas as páginas entram na exportação, não só as que estavam na tela');
    assert.ok(table.slice(1).every(cells => cells.length === 8 && /Z$/.test(cells[0])), 'data ISO em UTC em todas as linhas');
    const formula = table.find(cells => cells[2] === 'folder.created' && cells[3].includes('"name":"=1+1"'));
    assert.ok(formula, 'o evento da pasta chamada =1+1 está no arquivo');
    assert.equal(formula[7], "'=1+1", 'o resumo que começaria com = é gravado como texto');
    assert.ok(table.slice(1).every(cells => cells.every(cell => !/^[=+\-@\t\r]/.test(cell))), 'nenhuma célula começa com = + - @');
    assert.match(await toastText(), new RegExp(`${total} eventos exportados\\.`));
    assert.ok(table.some(cells => cells[1] === s.adminEmail && cells[4] === 'Entrada no painel'), 'acentos preservados');

    await page.locator('#audit-category').selectOption('displays');
    await settled();
    const filtered = parseCsv((await download(() => page.getByRole('button', { name: 'Exportar CSV' }).click())).text);
    assert.ok(filtered.length > 1 && filtered.length < table.length);
    assert.ok(filtered.slice(1).every(cells => cells[2].startsWith('device.')), 'só os eventos de telas');
    assert.match(await toastText(), /com os filtros atuais/);

    await page.locator('#audit-search').fill('zzzzzz');
    await page.getByText('Nenhum evento encontrado').waitFor();
    const outcome = page.waitForEvent('download', { timeout: 1200 }).then(() => 'baixou', () => 'não baixou');
    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    assert.equal(await outcome, 'não baixou', 'sem eventos, nada é baixado');
    await page.getByText('Nenhum evento para exportar com os filtros atuais.').waitFor();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
  });

  await step('Gestor (audit:read) vê e exporta só o próprio escopo; Editor não tem a tela', async () => {
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, manager.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'audit');
    await page.locator('.audit-table').waitFor();
    await page.getByText('Você vê somente os eventos das unidades e dos setores que possui.').waitFor();
    const places = await page.locator('.audit-table .audit-place').allInnerTexts();
    assert.ok(places.length > 5);
    assert.ok(places.every(text => text === 'Unidade Leste · RH'), `só Leste · RH (recebido: ${[...new Set(places)].join(' | ')})`);
    assert.equal((await rowTexts()).some(text => /Pasta da Segurança|Centro/.test(text)), false);
    const exported = parseCsv((await download(() => page.getByRole('button', { name: 'Exportar CSV' }).click())).text);
    assert.ok(exported.length > 1 && exported.slice(1).every(cells => cells[5] === 'Unidade Leste' && cells[6] === 'RH'), 'a exportação respeita o escopo');
    await s.shot('audit-03-gestor');

    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, editor.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    assert.equal(await page.locator('.nav-btn[data-route="audit"]').count(), 0, 'o Editor não tem o item Auditoria no menu');
    await page.evaluate(() => { globalThis.location.hash = '#/auditoria'; });
    await page.getByText('Seu perfil não tem acesso a esta área.').waitFor();
    await page.waitForFunction(() => globalThis.location.hash === '#/');
    assert.deepEqual((await kit.call('/api/audit', { session: editor.session })).data, { events: [] }, 'e o servidor não entrega eventos a quem não tem a permissão');
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});
