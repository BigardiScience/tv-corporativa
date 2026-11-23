// Permissão "Gerar código de pareamento" (screen:pair): Editor e Gestor geram o código de TVs já cadastradas, separada da administração de TVs.
// Tudo é decidido no servidor (perfil, unidade, setor e vínculo de acesso à TV) e gerar o código NÃO desconecta a TV nem revoga a credencial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { withApp, must, PASSWORD } from './helpers/app.mjs';
import { ADMIN_RESERVED, PERMISSIONS, ROLE_PERMISSIONS, effectivePermissions } from '../server/domain/permissions.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const generate = (kit, session, id) => kit.call(`/api/displays/${id}/pairing-code`, { method: 'POST', session, body: {} });
const pair = (kit, code, remoteAddress) => kit.call('/api/player/pair', { method: 'POST', body: { code }, remoteAddress });
const row = (kit, id) => kit.app.db.prepare('SELECT * FROM displays WHERE id=?').get(id);
const manifestStatus = (kit, token) => kit.call('/api/player/manifest', { token }).then(response => response.status);
const events = async (kit, action) => must(await kit.call('/api/audit?limit=500', { session: kit.admin })).events.filter(event => event.action === action);
const refused = (response, status, code) => assert.deepEqual([response.status, response.data.code], [status, code], JSON.stringify(response.data));
const relogin = async (kit, person) => (await kit.login(person.user.email, PASSWORD)).session;

test('catálogo: a permissão é própria, fica no padrão de Editor e Gestor, não é do conjunto exclusivo do Administrador e o Visualizador não a tem', async () => {
  assert.equal(PERMISSIONS['screen:pair'].group, 'Telas');
  assert.match(PERMISSIONS['screen:pair'].label, /Gerar código de pareamento/);
  assert.equal(ADMIN_RESERVED.includes('screen:pair'), false, 'não é uma permissão de administração de TVs');
  assert.equal(PERMISSIONS['screen:activate'].label.includes('gerar códigos'), false, 'ativar TV deixou de prometer a geração de códigos');
  const has = role => ROLE_PERMISSIONS[role].includes('screen:pair');
  assert.deepEqual(['admin', 'manager', 'editor', 'viewer'].map(has), [true, true, true, false]);
  const effective = user => effectivePermissions({ active: true, ...user }).has('screen:pair');
  assert.equal(effective({ role: 'editor' }), true);
  assert.equal(effective({ role: 'manager' }), true);
  assert.equal(effective({ role: 'viewer' }), false);
  assert.equal(effective({ role: 'editor', revokes: ['screen:pair'] }), false, 'restrição individual explícita é respeitada');
  assert.equal(effective({ role: 'manager', revokes: ['screen:pair'] }), false);
  assert.equal(effective({ role: 'editor', active: false }), false);
  // Ter outras permissões de TV não leva a esta, e esta não leva às de administração.
  for (const id of ['screen:create', 'screen:activate', 'screen:update', 'screen:delete', 'user:manage', 'settings:manage']) {
    assert.equal(effectivePermissions({ active: true, role: 'editor', grants: [] }).has(id), false, id);
    assert.equal(effectivePermissions({ active: true, role: 'manager', grants: [] }).has(id), false, id);
  }
});

test('contas: Editor e Gestor, novos ou já cadastrados (inclusive migrados), recebem a permissão; a retirada individual vale e pode ser desfeita; o Visualizador não a recebe nem por concessão', async () => {
  await withApp(async kit => {
    const catalog = must(await kit.call('/api/permissions', { session: kit.admin }));
    assert.ok(catalog.permissions.some(item => item.id === 'screen:pair' && item.group === 'Telas'));
    assert.equal(catalog.rolePermissions.editor.includes('screen:pair'), true);
    assert.equal(catalog.rolePermissions.manager.includes('screen:pair'), true);
    assert.equal(catalog.rolePermissions.viewer.includes('screen:pair'), false);

    const editor = await kit.createUser('editor'), manager = await kit.createUser('manager'), viewer = await kit.createUser('viewer');
    const permissionsOf = async session => must(await kit.call('/api/me', { session })).user.permissions;
    assert.equal((await permissionsOf(editor.session)).includes('screen:pair'), true);
    assert.equal((await permissionsOf(manager.session)).includes('screen:pair'), true);
    assert.equal((await permissionsOf(viewer.session)).includes('screen:pair'), false);

    // Conta já existente de antes desta permissão (aqui, a de um Gestor migrado da 1.1.0, com suas retiradas): ganha o padrão do perfil sem migração de dados.
    const legacy = await kit.createUser('manager');
    const raw = JSON.parse(kit.app.db.prepare('SELECT data FROM users WHERE id=?').get(legacy.user.id).data);
    raw.revokes = ['user:manage', 'audit:read', 'screen:create', 'screen:activate', 'screen:update', 'screen:delete'];
    kit.app.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(raw), legacy.user.id);
    const legacyPermissions = await permissionsOf(legacy.session);
    assert.equal(legacyPermissions.includes('screen:pair'), true);
    assert.equal(legacyPermissions.includes('audit:read'), false, 'as demais retiradas da conta continuam valendo');

    // Restrição individual explícita: o Administrador retira de uma pessoa; as outras do mesmo perfil continuam com a permissão.
    const tv = await kit.display(kit.admin, { name: 'TV Recepção' });
    must(await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { revokes: ['screen:pair'] } }));
    const restricted = await relogin(kit, editor);
    assert.equal((await permissionsOf(restricted)).includes('screen:pair'), false);
    refused(await generate(kit, restricted, tv.display.id), 403, 'PERMISSION_DENIED');
    assert.equal((await generate(kit, manager.session, tv.display.id)).status, 200, 'o Gestor não foi afetado');
    must(await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { revokes: [] } }));
    assert.equal((await generate(kit, await relogin(kit, editor), tv.display.id)).status, 200, 'sem a restrição, volta ao padrão do perfil');

    // O Visualizador continua somente consultando: a API recusa a concessão individual e, sem ela, a chamada é negada.
    const grant = await kit.call(`/api/users/${viewer.user.id}`, { method: 'PATCH', session: kit.admin, body: { grants: ['screen:pair'] } });
    refused(grant, 400, 'PERMISSION_DENIED');
    assert.match(grant.data.error, /Editor e Gestor.*Visualizador não a recebe/);
    const created = await kit.call('/api/users', { method: 'POST', session: kit.admin, body: { name: 'Outro', email: 'outro.viewer@example.invalid', password: PASSWORD, role: 'viewer', unitIds: ['leste'], sectorIds: ['rh'], grants: ['screen:pair'] } });
    refused(created, 400, 'PERMISSION_DENIED');
    assert.ok(!kit.app.services.users.byEmail('outro.viewer@example.invalid'), 'a conta recusada não foi criada');
    refused(await generate(kit, viewer.session, tv.display.id), 403, 'PERMISSION_DENIED');
    // Quem muda de Editor para Visualizador perde a permissão.
    must(await kit.call(`/api/users/${editor.user.id}`, { method: 'PATCH', session: kit.admin, body: { role: 'viewer' } }));
    refused(await generate(kit, await relogin(kit, editor), tv.display.id), 403, 'PERMISSION_DENIED');
  });
});

test('gerar o código NÃO desconecta a TV: a credencial atual continua valendo até o código ser usado, uma única vez, dentro da validade', async () => {
  await withApp(async kit => {
    const editor = await kit.createUser('editor');
    const tv = await kit.pairedDisplay(kit.admin, { name: 'TV Recepção' });
    const before = row(kit, tv.display.id);
    assert.equal(await manifestStatus(kit, tv.token), 200);

    const made = must(await generate(kit, editor.session, tv.display.id));
    assert.match(made.pairingCode, /^\d{6}$/);
    const minutes = (Date.parse(made.expiresAt) - Date.now()) / 60000;
    assert.ok(minutes > 9 && minutes <= 10, `vale ~10 minutos (${minutes.toFixed(2)})`);
    assert.deepEqual([made.display.id, made.display.paired, made.display.pairingOpen, made.display.connection], [tv.display.id, true, true, 'online']);
    // Desde a 2.3.0 o Editor também programa nas TVs autorizadas; gerar o código e programar são permissões separadas (veja a "separação de poderes").
    assert.deepEqual(made.display.permissions, { view: true, publish: true, manage: false, pair: true });

    // A TV continua conectada: credencial, cadastro, acessos e ordem intactos.
    assert.equal(await manifestStatus(kit, tv.token), 200);
    assert.equal((await kit.call('/api/player/heartbeat', { method: 'POST', token: tv.token })).status, 200);
    const after = row(kit, tv.display.id);
    assert.equal(after.token_hash, before.token_hash, 'a credencial da TV não foi revogada');
    for (const column of ['name', 'unit_id', 'sector_id', 'status', 'access_rev', 'order_rev', 'removed_at']) assert.equal(after[column], before[column], column);
    // O servidor guarda só o hash do código, com a validade.
    assert.equal(after.pair_hash, sha(made.pairingCode));
    assert.ok(Math.abs(after.pair_expires - Date.parse(made.expiresAt)) < 1000);
    assert.equal(JSON.stringify(after).includes(made.pairingCode), false, 'o código não fica em texto claro no cadastro da TV');

    // Outro código no lugar do primeiro: o primeiro deixa de valer.
    const second = must(await generate(kit, editor.session, tv.display.id));
    assert.notEqual(second.pairingCode, made.pairingCode);
    assert.equal((await pair(kit, made.pairingCode)).status, 400, 'o código substituído não vale mais');
    // Usar o código é o que pareia (e troca a credencial); uso único.
    const used = must(await pair(kit, second.pairingCode));
    assert.notEqual(used.token, tv.token);
    assert.equal(await manifestStatus(kit, used.token), 200);
    assert.equal(await manifestStatus(kit, tv.token), 401, 'a credencial antiga só morre quando o código novo é usado');
    assert.equal((await pair(kit, second.pairingCode)).status, 400, 'uso único');

    // Validade de 10 minutos e limite de tentativas por endereço continuam valendo para códigos gerados por esta permissão.
    const expired = must(await generate(kit, editor.session, tv.display.id));
    kit.app.db.prepare('UPDATE displays SET pair_expires=? WHERE id=?').run(Date.now() - 1000, tv.display.id);
    assert.equal((await pair(kit, expired.pairingCode)).status, 400, 'expirou');
    const fresh = must(await generate(kit, editor.session, tv.display.id));
    for (let attempt = 1; attempt <= 6; attempt++) assert.equal((await pair(kit, '000000', '10.55.0.1')).status, 400, `tentativa ${attempt}`);
    assert.equal((await pair(kit, fresh.pairingCode, '10.55.0.1')).status, 429, 'depois do limite, até o código certo é recusado');
    assert.equal(await manifestStatus(kit, used.token), 200, 'e a TV segue conectada');
    assert.equal((await pair(kit, fresh.pairingCode, '10.55.0.2')).status, 200, 'outro endereço não é afetado');
  });
});

test('acesso à TV: unidade, setor e vínculo individual são conferidos no servidor; ids manipulados e TVs inválidas são recusados sem efeito', async () => {
  await withApp(async kit => {
    const editor = await kit.createUser('editor'), manager = await kit.createUser('manager');
    const otherSector = await kit.createUser('manager', { unitIds: ['leste'], sectorIds: ['seguranca'] });
    const otherUnit = await kit.createUser('manager', { unitIds: ['centro'], sectorIds: ['rh'] });
    const outsider = await kit.createUser('editor', { unitIds: ['centro'], sectorIds: ['seguranca'] });
    const viewer = await kit.createUser('viewer');
    const tv = await kit.display(kit.admin, { name: 'TV do RH' });           // compartilhada com o setor RH da unidade
    const other = await kit.display(kit.admin, { name: 'Outra TV do RH' });  // para conferir que nenhuma outra TV é tocada

    for (const person of [editor, manager]) assert.equal((await generate(kit, person.session, tv.display.id)).status, 200);
    const touched = () => row(kit, other.display.id).pair_hash;
    const baseline = touched();
    const pairingFor = id => row(kit, id).pair_hash;
    const events0 = (await events(kit, 'device.pairing.generated')).length;

    // Mesmo perfil, mas outro setor da mesma unidade, ou a mesma sigla de setor em outra unidade, ou tudo de outra unidade, ou Visualizador.
    const hold = pairingFor(tv.display.id);
    for (const person of [otherSector, otherUnit, outsider]) refused(await generate(kit, person.session, tv.display.id), 403, 'DISPLAY_ACCESS_DENIED');
    refused(await generate(kit, viewer.session, tv.display.id), 403, 'PERMISSION_DENIED');
    assert.equal((await kit.call(`/api/displays/${tv.display.id}/pairing-code`, { method: 'POST' })).status, 401, 'sem sessão');
    assert.equal(pairingFor(tv.display.id), hold, 'nenhuma recusa mexeu no código da TV');
    assert.equal((await events(kit, 'device.pairing.generated')).length, events0, 'recusas não viram "código gerado" na auditoria');

    // Identificadores manipulados: inexistente, comprido demais, com caracteres de caminho ou SQL, ou o id de outra TV no corpo e na consulta.
    for (const id of ['nao-existe', 'x'.repeat(81), '..%2F..%2Fetc%2Fpasswd', encodeURIComponent("' OR 1=1; DROP TABLE displays;--"), '%00', '0'.repeat(36)]) {
      const response = await kit.call(`/api/displays/${id}/pairing-code`, { method: 'POST', session: editor.session, body: {} });
      assert.ok([400, 404].includes(response.status), `${id}: ${response.status}`);
    }
    assert.ok(kit.app.db.prepare('SELECT COUNT(*) AS n FROM displays').get().n >= 2, 'a tabela de TVs segue intacta');
    const confused = await kit.call(`/api/displays/${tv.display.id}/pairing-code?id=${other.display.id}&displayId=${other.display.id}`, { method: 'POST', session: editor.session, body: { id: other.display.id, displayId: other.display.id, unitId: 'centro' } });
    assert.equal(confused.status, 200);
    assert.equal(confused.data.display.id, tv.display.id, 'vale o id do caminho, nunca o do corpo ou da consulta');
    assert.equal(touched(), baseline, 'a outra TV não foi tocada');

    // Vínculo individual: uma TV liberada só para uma pessoa não serve a quem é só do mesmo setor.
    const personal = must(await kit.call('/api/displays', { method: 'POST', session: kit.admin, body: { name: 'TV pessoal', unitId: 'leste', sectorIds: [], userIds: [manager.user.id] } }), 201);
    assert.equal((await generate(kit, manager.session, personal.display.id)).status, 200);
    refused(await generate(kit, editor.session, personal.display.id), 403, 'DISPLAY_ACCESS_DENIED');

    // Acesso retirado pelo Administrador vale na hora: a pessoa perde a TV e o código.
    must(await kit.call(`/api/displays/${tv.display.id}`, { method: 'PATCH', session: kit.admin, body: { sectorIds: ['seguranca'], rev: row(kit, tv.display.id).access_rev } }));
    refused(await generate(kit, editor.session, tv.display.id), 403, 'DISPLAY_ACCESS_DENIED');
    refused(await generate(kit, manager.session, tv.display.id), 403, 'DISPLAY_ACCESS_DENIED');
    assert.equal((await generate(kit, otherSector.session, tv.display.id)).status, 200, 'e quem passou a ter o vínculo, ganha');
    // A TV transferida para outra unidade sai do alcance de quem era da unidade antiga.
    must(await kit.call(`/api/displays/${tv.display.id}`, { method: 'PATCH', session: kit.admin, body: { unitId: 'centro', sectorIds: ['seguranca'], userIds: [], rev: row(kit, tv.display.id).access_rev } }));
    refused(await generate(kit, otherSector.session, tv.display.id), 403, 'DISPLAY_ACCESS_DENIED');
    assert.equal((await generate(kit, outsider.session, tv.display.id)).status, 200);

    // TV ainda não ativada e TV removida não geram código por esta via.
    const pending = await kit.display(kit.admin, { name: 'TV pendente' });
    kit.app.db.prepare("UPDATE displays SET status='pending',pair_hash=NULL,pair_expires=NULL WHERE id=?").run(pending.display.id);
    refused(await generate(kit, editor.session, pending.display.id), 409, 'NOT_ACTIVE');
    assert.equal(row(kit, pending.display.id).pair_hash, null);
    const gone = await kit.display(kit.admin, { name: 'TV removida' });
    must(await kit.call(`/api/displays/${gone.display.id}`, { method: 'DELETE', session: kit.admin }));
    assert.equal((await generate(kit, editor.session, gone.display.id)).status, 404);
    assert.equal((await generate(kit, kit.admin, gone.display.id)).status, 404);
  });
});

test('separação de poderes: com a permissão de pareamento, Editor e Gestor continuam sem nenhuma outra ação de administração de TVs, usuários ou acessos', async () => {
  await withApp(async kit => {
    const people = { editor: await kit.createUser('editor'), manager: await kit.createUser('manager') };
    const tv = await kit.pairedDisplay(kit.admin, { name: 'TV Recepção' });
    const snapshot = () => JSON.stringify(row(kit, tv.display.id));
    const baseline = snapshot();
    for (const [role, person] of Object.entries(people)) {
      const call = (route, method, body = {}) => kit.call(route, { method, session: person.session, body });
      const id = tv.display.id;
      refused(await call(`/api/displays/${id}/pairing`, 'POST'), 403, 'ADMIN_REQUIRED');           // renovar pareamento (desconecta a TV)
      refused(await call(`/api/displays/${id}/activate`, 'POST'), 403, 'ADMIN_REQUIRED');
      refused(await call('/api/displays', 'POST', { name: 'Nova', unitId: 'leste', sectorId: 'rh' }), 403, 'ADMIN_REQUIRED');
      refused(await call(`/api/displays/${id}`, 'PATCH', { name: 'Renomeada' }), 403, 'ADMIN_REQUIRED');
      refused(await call(`/api/displays/${id}`, 'PATCH', { unitId: 'centro', sectorIds: ['rh'], userIds: [], rev: 0 }), 403, 'ADMIN_REQUIRED'); // mudar unidade/acessos
      refused(await call(`/api/displays/${id}`, 'PATCH', { sectorIds: ['seguranca'], rev: 0 }), 403, 'ADMIN_REQUIRED');
      refused(await call(`/api/displays/${id}/order`, 'PUT', { rev: 0, scheduleIds: [] }), 403, 'ADMIN_REQUIRED');       // ordem global da fila
      refused(await call(`/api/displays/${id}`, 'DELETE'), 403, 'ADMIN_REQUIRED');
      assert.equal((await call('/api/users', 'POST', { name: 'X', email: `${role}.x@example.invalid`, password: PASSWORD, role: 'viewer', unitIds: ['leste'], sectorIds: ['rh'] })).status, 403);
      assert.equal((await call('/api/units', 'POST', { name: 'Unidade X' })).status, 403);
      const listed = must(await kit.call('/api/displays?unitId=leste&sectorId=rh', { session: person.session })).displays.find(item => item.id === id);
      assert.deepEqual(listed.permissions, { view: true, publish: true, manage: false, pair: true }, 'Editor e Gestor programam nas TVs autorizadas');
      assert.deepEqual(listed.userIds, [], 'a lista de pessoas com acesso individual segue exclusiva do Administrador');
    }
    // Gerar o código e programar são permissões independentes: sem as de programação, a pessoa ainda gera o código, mas a TV não é "destino" para ela.
    const withoutScheduling = await kit.createUser('editor', { revokes: ['schedule:create', 'schedule:publish'] });
    const asReader = must(await kit.call('/api/displays?unitId=leste&sectorId=rh', { session: withoutScheduling.session })).displays.find(item => item.id === tv.display.id);
    assert.deepEqual(asReader.permissions, { view: true, publish: false, manage: false, pair: true });
    assert.equal(snapshot(), baseline, 'nenhuma tentativa alterou a TV');
    assert.equal(await manifestStatus(kit, tv.token), 200, 'e a TV segue conectada');

    // Poderes do Administrador preservados: renovar o pareamento continua desconectando; gerar o código por esta via nunca desconecta.
    must(await generate(kit, kit.admin, tv.display.id));
    assert.equal(await manifestStatus(kit, tv.token), 200);
    must(await kit.call(`/api/displays/${tv.display.id}/pairing`, { method: 'POST', session: kit.admin }));
    assert.equal(await manifestStatus(kit, tv.token), 401, 'a renovação do Administrador continua revogando a credencial');
    assert.equal(row(kit, tv.display.id).token_hash, null);
  });
});

test('auditoria: registra responsável, TV, unidade e horário; nunca o código nem o hash dele; a cadeia continua íntegra', async () => {
  await withApp(async kit => {
    const editor = await kit.createUser('editor'), manager = await kit.createUser('manager');
    const tv = await kit.display(kit.admin, { name: 'TV Recepção' });
    const start = Date.now();
    const first = must(await generate(kit, editor.session, tv.display.id));
    const second = must(await generate(kit, manager.session, tv.display.id));
    const listed = (await events(kit, 'device.pairing.generated')).sort((a, b) => a.id - b.id);
    assert.equal(listed.length, 2);
    assert.deepEqual(listed.map(event => event.actor), [editor.user.email, manager.user.email], 'responsável');
    for (const event of listed) {
      assert.deepEqual(event.detail, { displayId: tv.display.id, name: 'TV Recepção' }, 'TV');
      assert.equal(event.unitId, 'leste', 'unidade');
      assert.ok(Date.parse(event.at) >= start - 1000 && Date.parse(event.at) <= Date.now() + 1000, 'horário');
    }
    // Nem o código nem o hash dele aparecem em nenhum registro (auditoria inteira, como o Administrador a vê).
    const everything = JSON.stringify(must(await kit.call('/api/audit?limit=500', { session: kit.admin })).events) + JSON.stringify(kit.app.db.prepare('SELECT payload FROM audit').all());
    for (const secret of [first.pairingCode, second.pairingCode, sha(first.pairingCode), sha(second.pairingCode)]) assert.equal(everything.includes(secret), false, 'segredo na auditoria');
    // A cadeia de hashes (formato da 1.1.0) confere do primeiro ao último evento.
    let previous = '0'.repeat(64);
    for (const entry of kit.app.db.prepare('SELECT payload, previousHash, hash FROM audit ORDER BY id').all()) {
      assert.equal(entry.previousHash, previous);
      assert.equal(entry.hash, sha(previous + entry.payload));
      previous = entry.hash;
    }
    // A renovação do Administrador continua com o próprio evento, distinto do de geração.
    must(await kit.call(`/api/displays/${tv.display.id}/pairing`, { method: 'POST', session: kit.admin }));
    assert.equal((await events(kit, 'device.pairing.renewed')).length, 1);
    assert.equal((await events(kit, 'device.pairing.generated')).length, 2);
  });
});
