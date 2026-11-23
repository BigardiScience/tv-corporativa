// Configurações de ponta a ponta no navegador: o que todas as pessoas veem (acessibilidade, segurança, integrações honestas,
// ambiente) e, só para o Administrador, o cadastro de unidades e setores (criar, renomear, nome repetido, efeito no painel).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD, projectRoot } from '../helpers/app.mjs';

// A versão que o painel mostra é a do pacote: o teste lê de lá, em vez de repetir o número.
const PACKAGE_VERSION = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;

export default () => runScenario('Configurações: preferências, segurança e ambiente para todos; unidades e setores só para o Administrador', async (s, step) => {
  const { page } = s;
  s.allow(/status of 409/, /^HTTP 409 POST \/api\/units$/);
  let kit, editor, manager;

  const card = title => page.locator('.setting-card', { has: page.getByRole('heading', { name: title }) });
  const control = label => page.locator(`.setting-row[data-control="${label}"] .chip`);
  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const toastText = () => page.locator('#toast').innerText();
  const unitRows = () => page.locator('.org-list[data-kind="units"] .org-row b').allInnerTexts();
  const sectorRows = () => page.locator('.org-list[data-kind="sectors"] .org-row b').allInnerTexts();

  await step('Editor abre Configurações: vê preferências, controles, integrações e ambiente — sem o cadastro de unidades', async () => {
    kit = await s.seed();
    editor = await kit.createUser('editor', { email: 'edu.editor@example.invalid' });
    manager = await kit.createUser('manager', { email: 'gil.gestor@example.invalid' });
    await loginAs(page, s.origin, editor.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'settings');
    await page.getByRole('heading', { name: 'Configurações', level: 1 }).waitFor();
    assert.equal(await page.locator('.setting-card').count(), 4);

    assert.equal(await control('Controle por unidade e setor').innerText(), 'Ativo');
    assert.equal(await control('Trilha de auditoria encadeada').innerText(), 'Ativa');
    assert.equal(await control('Verificação antivírus dos arquivos').innerText(), 'Não configurada (ambiente local)', 'em ambiente local sem antivírus a tela diz isso, sem esconder');
    assert.equal(await control('Login único Microsoft Entra ID (SSO)').innerText(), 'Integração pendente');
    const security = await card('Segurança e governança').innerText();
    assert.match(security, /não é certificada nem avaliada/, 'nenhuma alegação de certificação ISO 27001 / TISAX');
    assert.doesNotMatch(security.toLowerCase(), /certificad[oa] iso|compat[ií]vel com iso|conforme (a )?iso/);

    const microsoft = await card('Microsoft e ferramentas de criação').innerText();
    assert.match(microsoft, /SharePoint \/ OneDrive\s*Não conectado/);
    assert.match(microsoft, /Power BI Embedded\s*Não conectado/);

    const environment = card('Ambiente e suporte');
    await environment.getByText('Ambiente local de testes').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.setting-row')].some(row => /Esquema do banco de dados/.test(row.textContent) && /\d+$/.test(row.textContent.trim())));
    const text = await environment.innerText();
    assert.ok(new RegExp(`Versão da plataforma\\s*${PACKAGE_VERSION.replace(/\./g, '\\.')}`).test(text), `a versão do pacote (${PACKAGE_VERSION}) aparece em Ambiente e suporte`);
    assert.match(text, /Tamanho máximo por arquivo\s*\d+ MB/);
    assert.match(text, /Conteúdos por playlist \(máximo\)\s*\d+/);

    assert.equal(await page.locator('.org-panel').count(), 0, 'o Editor não vê o cadastro de unidades e setores');
    await page.getByText('O cadastro de unidades e setores é feito pelo Administrador TI.').waitFor();
    await s.shot('settings-01-editor');
  });

  await step('texto ampliado e contraste reforçado: ligam, ficam salvos ao recarregar e desligam', async () => {
    const large = page.getByRole('button', { name: /^Texto ampliado/ });
    const contrast = page.getByRole('button', { name: /^Contraste reforçado/ });
    assert.equal(await large.getAttribute('aria-pressed'), 'false');
    await large.click();
    assert.equal(await large.getAttribute('aria-pressed'), 'true');
    assert.equal(await large.innerText(), 'Desativar');
    assert.equal(await page.evaluate(() => document.body.classList.contains('large-text')), true);
    await contrast.click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('high-contrast')), true);

    await page.reload();
    await page.getByRole('heading', { name: 'Configurações', level: 1 }).waitFor();
    assert.equal(await page.evaluate(() => [document.body.classList.contains('large-text'), document.body.classList.contains('high-contrast')].join()), 'true,true', 'as preferências voltam depois de recarregar');
    assert.equal(await page.getByRole('button', { name: /^Texto ampliado/ }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: /^Texto ampliado/ }).click();
    await page.getByRole('button', { name: /^Contraste reforçado/ }).click();
    assert.equal(await page.evaluate(() => [document.body.classList.contains('large-text'), document.body.classList.contains('high-contrast')].join()), 'false,false');
  });

  await step('Administrador: cria unidade e setor, e o painel inteiro passa a conhecê-los', async () => {
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'settings');
    await page.locator('.org-panel').waitFor();
    assert.equal(await page.locator('.setting-card').count(), 4);
    assert.deepEqual((await unitRows()).sort(), ['Unidade Centro', 'Unidade Leste', 'Unidade Oeste', 'Vila Norte'].sort(), 'as unidades de origem');
    const before = (await sectorRows()).length;

    await page.locator('.org-column', { has: page.getByRole('heading', { name: 'Unidades' }) }).getByRole('button', { name: 'Nova unidade' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#org-name').fill('Unidade Sorocaba');
    await dialog.locator('#org-city').fill('Sorocaba');
    await dialog.getByRole('button', { name: 'Criar unidade' }).click();
    await closed();
    await page.locator('.org-row', { hasText: 'Unidade Sorocaba' }).getByText('Sorocaba', { exact: true }).waitFor();
    assert.match(await toastText(), /Unidade criada\./);

    await page.locator('.org-column', { has: page.getByRole('heading', { name: 'Setores' }) }).getByRole('button', { name: 'Novo setor' }).click();
    await page.locator('dialog[open] #org-name').fill('Qualidade');
    assert.equal(await page.locator('dialog[open] #org-city').count(), 0, 'setor não tem cidade');
    await page.locator('dialog[open]').getByRole('button', { name: 'Criar setor' }).click();
    await closed();
    await page.waitForFunction(count => document.querySelectorAll('.org-list[data-kind="sectors"] .org-row').length === count + 1, before);
    assert.ok((await sectorRows()).includes('Qualidade'));

    // O seletor de espaço do painel já conhece a unidade nova (o Administrador enxerga tudo).
    await page.click('.workspace');
    await page.locator('dialog[open]').getByRole('button', { name: 'Unidade Sorocaba', exact: true }).waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Qualidade', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await closed();
    await s.shot('settings-02-admin');
  });

  await step('renomear: o nome novo aparece no menu lateral e nada se perde (a API confirma o mesmo identificador)', async () => {
    await page.getByRole('button', { name: 'Editar o setor RH' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('Renomear não perde nada').waitFor();
    await dialog.locator('#org-name').fill('Recursos Humanos');
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await closed();
    await page.locator('.workspace small', { hasText: 'Recursos Humanos' }).waitFor();
    assert.match(await toastText(), /Setor salvo\./);
    const state = (await kit.call('/api/state', { session: kit.admin })).data;
    assert.equal(state.sectors.find(item => item.id === 'rh').name, 'Recursos Humanos', 'o identificador rh continua o mesmo');

    await page.getByRole('button', { name: 'Editar a unidade Unidade Sorocaba' }).click();
    const unit = page.locator('dialog[open]');
    assert.equal(await unit.locator('#org-city').inputValue(), 'Sorocaba', 'a cidade vem preenchida');
    await unit.locator('#org-city').fill('');
    await unit.getByRole('button', { name: 'Salvar alterações' }).click();
    await closed();
    await page.locator('.org-row', { hasText: 'Unidade Sorocaba' }).getByText('Cidade não informada').waitFor();
  });

  await step('validações: nome vazio, nome repetido (na tela e no servidor) e o aviso de que não há exclusão', async () => {
    await page.locator('.org-column', { has: page.getByRole('heading', { name: 'Unidades' }) }).getByRole('button', { name: 'Nova unidade' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('button', { name: 'Criar unidade' }).click();
    await dialog.getByText('Informe o nome da unidade.').waitFor();
    await dialog.locator('#org-name').fill('  UNIDADE LESTÉ ');
    await dialog.getByRole('button', { name: 'Criar unidade' }).click();
    await dialog.getByText('Já existe uma unidade com este nome.').waitFor();
    assert.equal((await unitRows()).filter(name => /leste/i.test(name)).length, 1, 'nada foi criado');

    // Outra pessoa cria o mesmo nome enquanto esta tela está aberta: a tela ainda não sabe, o servidor recusa e a janela mostra o motivo.
    const taken = await kit.call('/api/units', { method: 'POST', session: kit.admin, body: { name: 'Unidade Campinas' } });
    assert.equal(taken.status, 201);
    await dialog.locator('#org-name').fill('unidade campinas');
    await dialog.getByRole('button', { name: 'Criar unidade' }).click();
    await dialog.getByText('Já existe uma unidade com este nome.').waitFor();
    assert.equal(await dialog.count(), 1, 'a janela continua aberta para corrigir');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await closed();
    await page.getByText('Unidades e setores não são excluídos').waitFor();
    assert.equal(await page.getByRole('button', { name: /^Excluir/ }).count(), 0, 'não existe exclusão de unidade ou setor');
  });

  await step('Gestor abre Configurações: sem o cadastro de unidades e setores, e o servidor recusa se tentar pela API', async () => {
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, manager.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'Recursos Humanos');
    await goTo(page, 'settings');
    await page.getByRole('heading', { name: 'Configurações', level: 1 }).waitFor();
    assert.equal(await page.locator('.org-panel').count(), 0);
    assert.equal((await kit.call('/api/units', { method: 'POST', session: manager.session, body: { name: 'Tentativa do Gestor' } })).status, 403);
    assert.equal((await kit.call('/api/sectors/rh', { method: 'PATCH', session: manager.session, body: { name: 'Tentativa' } })).status, 403);
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});
