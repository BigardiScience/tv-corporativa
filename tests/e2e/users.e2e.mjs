// Usuários e permissões de ponta a ponta no navegador: criar, permissões individuais, editar, suspender, redefinir senha
// (só Administrador), limites do Gestor (confirmados também na API) e alteração da própria conta.
// Cada afirmação sobre "o que a pessoa consegue fazer" é conferida entrando de verdade com a conta criada.
import assert from 'node:assert/strict';
import { chooseSpace, expectNoIssues, goTo, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';

const exact = text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

export default () => runScenario('Usuários e permissões: criar, permissões individuais, editar, suspender, senha e limites do Gestor', async (s, step) => {
  const { page } = s;
  let kit, generated, manager;

  const row = name => page.locator('tr', { has: page.locator('b', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }) });
  const names = () => page.locator('.user-table tbody tr b').allInnerTexts().then(list => list.map(text => text.replace(/voc[êe]$/, '').trim()));
  const toastText = () => page.locator('#toast').innerText();
  const closed = () => page.waitForSelector('#dialogs dialog', { state: 'detached' });
  const perm = id => page.locator(`dialog[open] .perm-item[data-permission="${id}"]`);
  const permInput = id => perm(id).locator('input');
  const loginApi = (email, password) => kit.login(email, password);
  const listApi = async () => (await kit.call('/api/users', { session: kit.admin })).data.users;

  await step('preparar contas (pela API) e abrir Usuários como Administrador', async () => {
    kit = await s.seed();
    await kit.createUser('viewer', { email: 'vera.visualizadora@example.invalid' });
    manager = await kit.createUser('manager', { email: 'gil.gestor@example.invalid' });
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await goTo(page, 'users');
    await page.locator('.user-table').waitFor();
    assert.equal((await names()).length, 3, 'administrador, gestor e visualizadora');
    assert.match(await row('Administrador E2E').innerText(), /você/);
    assert.equal(await page.getByRole('button', { name: /^Redefinir a senha de/ }).count(), 3, 'o Administrador redefine a senha de qualquer pessoa da lista');
    await s.shot('users-01-lista');
  });

  await step('novo usuário: validações do formulário antes de enviar', async () => {
    await page.getByRole('button', { name: 'Novo usuário' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#user-name').waitFor();
    await dialog.getByRole('button', { name: 'Criar usuário' }).click();
    await dialog.getByText(/Informe o nome da pessoa\. Informe o e-mail\./).waitFor();
    await dialog.locator('#user-name').fill('Maria Editora');
    await dialog.locator('#user-email').fill('maria.editora@example.invalid');
    await dialog.locator('#user-password').fill('curta');
    await dialog.getByRole('button', { name: 'Criar usuário' }).click();
    await dialog.getByText(/A senha deve ter entre 12 e 128 caracteres\. Escolha ao menos uma unidade e um setor\./).waitFor();
    await dialog.locator('#user-password').fill('Senha-inicial-valida-1');
    await dialog.locator('#user-password-confirm').fill('Senha-inicial-valida-2');
    await dialog.getByRole('button', { name: 'Criar usuário' }).click();
    await dialog.getByText(/As senhas não coincidem\. Escolha ao menos uma unidade e um setor\./).waitFor();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await closed();
  });

  await step('criar Editora com senha gerada, uma permissão concedida (publicar versões de playlist) e uma retirada (publicar programações)', async () => {
    await page.getByRole('button', { name: 'Novo usuário' }).first().click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#user-name').fill('Maria Editora');
    await dialog.locator('#user-email').fill('maria.editora@example.invalid');
    await dialog.getByRole('button', { name: 'Gerar senha segura' }).click();
    generated = await dialog.locator('#user-password').inputValue();
    assert.equal(await dialog.locator('#user-password').getAttribute('type'), 'text', 'a senha gerada fica visível para ser copiada');
    assert.ok(generated.length >= 12 && /[a-z]/.test(generated) && /[A-Z]/.test(generated) && /[0-9]/.test(generated) && /[^A-Za-z0-9]/.test(generated), 'senha forte');
    await dialog.getByLabel('Unidade Unidade Leste').check();
    await dialog.getByLabel('Setor RH').check();
    await dialog.locator('summary', { hasText: 'Permissões individuais' }).click();
    // Padrão do Editor: programa e publica nas TVs liberadas a ele (2.3.0), mas não publica versões de playlist.
    assert.equal(await permInput('folder:create').isChecked(), true);
    assert.equal(await permInput('media:upload').isChecked(), true);
    assert.equal(await permInput('schedule:create').isChecked(), true);
    assert.equal(await permInput('schedule:publish').isChecked(), true, 'o Editor publica programações por padrão');
    assert.equal(await permInput('playlist:publish').isChecked(), false);
    assert.equal(await permInput('user:manage').isDisabled(), true, 'gestão de usuários é exclusiva da TI');
    assert.equal(await permInput('settings:manage').isDisabled(), true);
    await dialog.locator('.perm-summary-line').getByText(/igual ao padrão do perfil/).waitFor();
    // Ajustes individuais: uma concedida e uma retirada em relação ao padrão.
    await permInput('playlist:publish').check();
    await permInput('schedule:publish').uncheck();
    assert.equal(await permInput('screen:create').isDisabled(), true, 'gestão de TVs é exclusiva da TI');
    assert.equal(await permInput('screen:create').isChecked(), false);
    await dialog.locator('.perm-summary-line').getByText(/2 diferentes do padrão do perfil/).waitFor();
    assert.equal(await perm('playlist:publish').locator('.perm-tag').innerText(), 'Concedida');
    assert.equal(await perm('schedule:publish').locator('.perm-tag').innerText(), 'Retirada');
    assert.equal(await perm('schedule:create').locator('.perm-tag').innerText(), 'Padrão do perfil', 'criar rascunhos segue o padrão');
    await s.shot('users-02-formulario');
    await dialog.getByRole('button', { name: 'Criar usuário' }).click();
    await closed();
    await row('Maria Editora').waitFor();
    assert.match(await toastText(), /Usuário criado\./);
    assert.match(await row('Maria Editora').innerText(), /Personalizadas/);
    const maria = (await listApi()).find(user => user.email === 'maria.editora@example.invalid');
    assert.deepEqual([maria.role, maria.grants, maria.revokes], ['editor', ['playlist:publish'], ['schedule:publish']]);
    assert.equal(maria.permissions.includes('playlist:publish') && maria.permissions.includes('schedule:create') && !maria.permissions.includes('schedule:publish') && !maria.permissions.includes('screen:create'), true);
    assert.equal(JSON.stringify(maria).includes(generated), false, 'a senha não volta em nenhuma resposta');
    await s.shot('users-03-lista-com-maria');
  });

  await step('a conta criada funciona de verdade: o que foi concedido vale, o que foi retirado e o que é do Gestor não', async () => {
    const maria = (await loginApi('maria.editora@example.invalid', generated)).session;
    const base = { unitId: 'leste', sectorId: 'rh' };
    assert.equal((await kit.call('/api/displays', { method: 'POST', session: maria, body: { name: 'TV X', ...base } })).status, 403, 'cadastrar telas exige Administrador TI');
    assert.equal((await kit.call('/api/folders', { method: 'POST', session: maria, body: { name: 'Pasta da Maria', ...base } })).status, 201, 'criar pastas continua (padrão do Editor)');
    assert.deepEqual((await kit.call('/api/users', { session: maria })).data.users, [], 'sem user:manage a lista de usuários vem vazia');
    assert.equal((await kit.call('/api/users', { method: 'POST', session: maria, body: {} })).status, 403, 'e não cria usuários');
    // Concedida (publicar versão de playlist) vale; retirada (publicar programação) não vale; criar rascunho segue valendo.
    const media = await kit.approvedMedia(kit.admin, { title: 'Aviso da Maria', name: 'aviso-maria.png' });
    const draft = await kit.playlist(kit.admin, { name: 'Playlist da Maria', items: [{ mediaId: media.id }] });
    const published = await kit.call(`/api/playlists/${draft.id}/publish`, { method: 'POST', session: maria, body: { rev: draft.draftRev } });
    assert.equal(published.status, 201, 'a permissão concedida vale: Maria publica a versão da playlist');
    const tv = await kit.display(kit.admin, { name: 'TV da Maria' });
    const planned = { name: 'Programação da Maria', ...base, playlistId: draft.id, displayIds: [tv.display.id] };
    const sketch = await kit.call('/api/schedules', { method: 'POST', session: maria, body: planned });
    assert.deepEqual([sketch.status, sketch.data.status], [201, 'draft'], 'criar rascunho continua (padrão do Editor)');
    const refused = await kit.call('/api/schedules', { method: 'POST', session: maria, body: { ...planned, name: 'Tentativa de publicar', publish: true } });
    assert.deepEqual([refused.status, refused.data.code], [403, 'PERMISSION_DENIED'], 'a permissão retirada vale: publicar programação é recusado');
    assert.equal((await kit.call(`/api/schedules/${sketch.data.id}/publish`, { method: 'POST', session: maria, body: {} })).status, 403);
    // Na interface.
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, 'maria.editora@example.invalid', generated);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    assert.equal(await page.locator('.nav-btn[data-route="users"]').count(), 0, 'sem Usuários no menu');
    await goTo(page, 'schedules');
    await page.getByRole('button', { name: 'Nova programação' }).waitFor();
    await page.getByText('Você cria rascunhos, mas a publicação depende de quem tem essa permissão.').waitFor();
    assert.equal(await page.getByRole('button', { name: /^Publicar a programação/ }).count(), 0, 'sem o botão de publicar para quem teve a publicação retirada');
    await goTo(page, 'displays');
    await page.getByText(/Você vê somente as TVs autorizadas para seu espaço/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cadastrar TV' }).count(), 0);
    await page.goto(`${s.origin}/#/usuarios`);
    await page.getByText('Seu perfil não tem acesso a esta área.').waitFor();
    // O resumo do próprio acesso (janela do perfil) reflete a conta.
    await page.getByRole('button', { name: /^Perfil de Maria Editora/ }).click();
    await page.locator('dialog[open] details.perm-details summary').click();
    await page.locator('dialog[open] .perm-summary li.on', { hasText: 'Criar programações (rascunho)' }).waitFor();
    await page.locator('dialog[open] .perm-summary li.on', { hasText: 'Publicar versões de playlist' }).waitFor();
    await page.locator('dialog[open] .perm-summary li.off', { hasText: 'Publicar, alterar e interromper programações' }).waitFor();
    await page.locator('dialog[open] .perm-summary li.off', { hasText: 'Cadastrar telas' }).waitFor();
    await s.shot('users-04-perfil-da-maria');
    await page.locator('dialog[open]').getByRole('button', { name: 'Sair com segurança' }).click();
    await page.locator('#login-email').waitFor();
  });

  await step('editar: trocar o perfil volta ao padrão; suspender impede a entrada; busca e filtros', async () => {
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await goTo(page, 'users');
    await row('Maria Editora').waitFor();
    await page.getByRole('button', { name: 'Editar Maria Editora' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#user-role').waitFor();
    assert.equal(await dialog.locator('#user-email').getAttribute('readonly') !== null, true, 'o e-mail (login) não muda');
    await dialog.getByText('Ao salvar, a pessoa é desconectada').waitFor();
    assert.equal(await permInput('playlist:publish').isChecked(), true, 'edição mostra a permissão concedida');
    assert.equal(await permInput('schedule:publish').isChecked(), false, 'edição mostra a permissão retirada');
    assert.equal(await permInput('schedule:create').isChecked(), true, 'e o que segue o padrão do perfil');
    await dialog.locator('#user-role').selectOption('viewer');
    await dialog.locator('.perm-summary-line').getByText(/0 de 21 permissões ativas · igual ao padrão do perfil/).waitFor();
    await dialog.locator('#user-active').uncheck();
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await closed();
    await page.waitForFunction(() => /Suspenso/.test([...document.querySelectorAll('.user-table tr')].find(tr => tr.textContent.includes('Maria Editora'))?.textContent ?? ''));
    assert.match(await row('Maria Editora').innerText(), /Visualizador/);
    assert.equal((await loginApi('maria.editora@example.invalid', generated)).status, 401, 'conta suspensa não entra');
    // Filtros e busca.
    await page.selectOption('#user-status-filter', 'inactive');
    assert.deepEqual(await names(), ['Maria Editora']);
    await page.selectOption('#user-status-filter', '');
    await page.selectOption('#user-role-filter', 'viewer');
    assert.deepEqual((await names()).sort(), ['Maria Editora', 'Teste viewer 1'].sort());
    await page.selectOption('#user-role-filter', '');
    await page.fill('#user-search', 'GÍL');
    await page.waitForFunction(() => document.querySelectorAll('.user-table tbody tr').length === 1);
    assert.deepEqual(await names(), ['Teste manager 2'], 'busca sem acento e sem diferenciar maiúsculas');
    await page.fill('#user-search', 'zzzz');
    await page.getByText('Ninguém encontrado').waitFor();
    await page.fill('#user-search', '');
  });

  await step('reativar e redefinir a senha (só Administrador): a antiga deixa de valer, a nova entra', async () => {
    await page.getByRole('button', { name: 'Editar Maria Editora' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('#user-active').check();
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await closed();
    await page.waitForFunction(() => /Ativo/.test([...document.querySelectorAll('.user-table tr')].find(tr => tr.textContent.includes('Maria Editora'))?.textContent ?? ''));

    await page.getByRole('button', { name: 'Redefinir a senha de Maria Editora' }).click();
    const reset = page.locator('dialog[open]');
    await reset.locator('#reset-password').fill('curta');
    await reset.getByRole('button', { name: 'Redefinir senha' }).click();
    await reset.getByText('A senha deve ter entre 12 e 128 caracteres.').waitFor();
    // A confirmação existia na versão 1.1.0: senhas diferentes nem saem do navegador.
    let patches = 0;
    const countPatches = request => { if (request.method() === 'PATCH' && /\/api\/users\//.test(request.url())) patches++; };
    page.on('request', countPatches);
    await reset.locator('#reset-password').fill('Senha-nova-valida-123');
    await reset.locator('#reset-password-confirm').fill('Senha-nova-valida-124');
    await reset.getByRole('button', { name: 'Redefinir senha' }).click();
    await reset.getByText('As senhas não coincidem.').waitFor();
    assert.equal(patches, 0, 'senhas diferentes não chegam ao servidor');
    page.off('request', countPatches);
    await reset.getByRole('button', { name: 'Gerar senha segura' }).click();
    assert.equal(await reset.locator('#reset-password-confirm').inputValue(), await reset.locator('#reset-password').inputValue(), 'gerar preenche a senha e a confirmação');
    const renewed = await reset.locator('#reset-password').inputValue();
    assert.notEqual(renewed, generated);
    assert.equal(await reset.getByText('A senha deve ter entre 12 e 128 caracteres.').count(), 0, 'o aviso velho some quando a senha muda');
    await s.shot('users-05-redefinir-senha');
    await reset.getByRole('button', { name: 'Redefinir senha' }).click();
    await closed();
    assert.match(await toastText(), /Senha de Maria Editora redefinida/);
    assert.equal((await loginApi('maria.editora@example.invalid', generated)).status, 401, 'a senha antiga não vale mais');
    assert.equal((await loginApi('maria.editora@example.invalid', renewed)).status, 200, 'a nova senha entra');
    const audit = (await kit.call('/api/audit?limit=100', { session: kit.admin })).data.events;
    assert.equal(audit.some(event => event.action === 'user.password.reset'), true, 'a redefinição foi auditada');
    assert.equal(JSON.stringify(audit).includes(renewed) || JSON.stringify(audit).includes(generated), false, 'nenhuma senha aparece na auditoria');
  });

  await step('Gestor: não administra contas nem redefine senhas, inclusive por chamada direta', async () => {
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, manager.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    assert.equal(await page.locator('.nav-btn[data-route="users"]').count(), 0);
    await page.goto(`${s.origin}/#/usuarios`);
    await page.getByText('Seu perfil não tem acesso a esta área.').waitFor();
    assert.equal(await page.locator('.user-table').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Novo usuário' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Redefinir a senha de/ }).count(), 0);
    await s.shot('users-06-gestor');
    assert.deepEqual((await kit.call('/api/users', { session: manager.session })).data.users, []);
    assert.equal((await kit.call('/api/users', { method: 'POST', session: manager.session, body: {} })).status, 403);
    const maria = (await listApi()).find(user => user.email === 'maria.editora@example.invalid');
    for (const body of [{ role: 'manager' }, { password: 'Outra-senha-12345' }, { unitIds: ['centro'] }, { grants: ['audit:read'] }]) {
      assert.equal((await kit.call(`/api/users/${maria.id}`, { method: 'PATCH', session: manager.session, body })).status, 403);
    }
  });

  await step('o Administrador altera a própria conta: é desconectado e entra de novo', async () => {
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await goTo(page, 'users');
    await page.getByRole('button', { name: 'Editar Administrador E2E' }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('Você está editando a sua própria conta.').waitFor();
    assert.equal(await dialog.locator('#user-active').isDisabled(), true, 'não dá para desativar a si mesmo');
    await dialog.locator('#user-name').fill('Administrador E2E (TI)');
    await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
    await page.locator('#login-email').waitFor();
    await page.getByText('Sua conta foi alterada. Entre novamente para continuar.').waitFor();
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await page.getByText('Administrador E2E (TI)').first().waitFor();
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
});
