// Regras das telas de administração, testadas no Node: usuários e senhas, auditoria (resumos, filtros, CSV) e configurações.
// Os resumos da auditoria são conferidos também contra os eventos REAIS que o servidor grava, para que uma mudança nos
// campos gravados não transforme a trilha numa lista de identificadores ilegíveis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { AUDIT_ACTIONS, auditActionLabel } from '../public/js/lib/format.js';
import * as userModel from '../public/js/lib/user-model.js';
import * as auditModel from '../public/js/lib/audit-model.js';
import * as settingsModel from '../public/js/lib/settings-model.js';
import { auditCsvName, buildAuditCsv, csvCell } from '../public/js/lib/csv.js';
import { PASSWORD, must, projectRoot, withApp } from './helpers/app.mjs';

// ---- senhas ----------------------------------------------------------------------------------------------------------------

test('senha: inteiro aleatório vem só do gerador criptográfico, sem viés, e falha de forma clara onde ele não existe', () => {
  const { secureInt } = userModel;
  for (const invalid of [0, -1, 1.5, NaN, 0x100000001, '5']) assert.throws(() => secureInt(invalid), RangeError, String(invalid));
  assert.throws(() => secureInt(10, {}), /gerador seguro/);
  assert.throws(() => secureInt(10, null), /gerador seguro/);

  // Valores no "resto" final do intervalo são descartados (senão alguns números seriam mais prováveis que outros).
  const sequence = [4294967295, 4294967290, 4294967289];
  const drawn = [];
  const fake = { getRandomValues: buffer => { buffer[0] = sequence.shift(); drawn.push(buffer[0]); return buffer; } };
  assert.equal(secureInt(10, fake), 9);
  assert.equal(drawn.length, 3, 'dois sorteios descartados antes do aceito');

  const buckets = new Array(6).fill(0);
  for (let index = 0; index < 12000; index++) buckets[secureInt(6)]++;
  for (const count of buckets) assert.ok(count > 1700 && count < 2300, `distribuição fora do esperado: ${buckets}`);
  assert.equal(secureInt(1), 0);
});

test('senha gerada: tamanho dentro dos limites, os quatro tipos de caractere, sem caracteres ambíguos, nunca Math.random', () => {
  const { generatePassword, validatePasswordValue, PASSWORD_MIN, PASSWORD_MAX } = userModel;
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random não pode ser usado para senhas'); };
  try {
    const seen = new Set();
    for (let index = 0; index < 300; index++) {
      const value = generatePassword();
      assert.equal(value.length, 16);
      assert.match(value, /[a-z]/); assert.match(value, /[A-Z]/); assert.match(value, /[2-9]/); assert.match(value, /[!#$%&*+\-=?@]/);
      assert.doesNotMatch(value, /[01OlI]/, 'sem 0/O e 1/l/I, que se confundem na leitura');
      assert.deepEqual(validatePasswordValue(value), []);
      seen.add(value);
    }
    assert.equal(seen.size, 300, 'senhas repetidas indicariam sorteio fraco');
    assert.equal(generatePassword({ length: 5 }).length, PASSWORD_MIN);
    assert.equal(generatePassword({ length: 40 }).length, 40);
    assert.equal(generatePassword({ length: 5000 }).length, PASSWORD_MAX);
    assert.equal(generatePassword({ length: Number.NaN }).length, 16);
    const deterministic = generatePassword({ length: 12, randomInt: () => 0 });
    assert.deepEqual([...new Set(deterministic)].sort(), ['!', '2', 'A', 'a'], 'mesmo com sorteio previsível os quatro grupos estão presentes');
  } finally { Math.random = original; }
});

test('senha: tamanho primeiro, depois a confirmação; os limites são os do servidor', () => {
  const { validatePasswordPair, validatePasswordValue } = userModel;
  const size = 'Entre 12 e 128 caracteres';
  assert.match(validatePasswordValue('a'.repeat(11))[0], new RegExp(size.replace('Entre', 'A senha deve ter entre')));
  assert.deepEqual(validatePasswordValue('a'.repeat(12)), []);
  assert.deepEqual(validatePasswordValue('a'.repeat(128)), []);
  assert.equal(validatePasswordValue('a'.repeat(129)).length, 1);
  assert.equal(validatePasswordValue(undefined).length, 1);
  assert.deepEqual(validatePasswordPair('curta', 'outra'), validatePasswordValue('curta'), 'senha curta e confirmação diferente: um aviso só, o de tamanho');
  assert.deepEqual(validatePasswordPair('Senha-longa-valida', 'Senha-longa-valida'), []);
  assert.deepEqual(validatePasswordPair('Senha-longa-valida', 'Senha-longa-valida '), ['As senhas não coincidem.']);
  assert.deepEqual(validatePasswordPair('Senha-longa-valida', undefined), ['As senhas não coincidem.']);
});

// ---- formulário e lista de usuários -----------------------------------------------------------------------------------------

test('usuário: o formulário aponta cada problema; edição não pede e-mail nem senha; Administrador não precisa de escopo', () => {
  const { validateUserForm } = userModel;
  const assignable = ['editor', 'viewer'];
  const valid = { mode: 'create', name: 'Maria Editora', email: 'maria@example.invalid', password: 'Senha-longa-valida', confirmPassword: 'Senha-longa-valida', role: 'editor', unitIds: ['u'], sectorIds: ['s'] };
  assert.deepEqual(validateUserForm(valid, { assignable }), []);
  assert.deepEqual(validateUserForm({ mode: 'create' }, { assignable }), [
    'Informe o nome da pessoa.', 'Informe o e-mail.', 'A senha deve ter entre 12 e 128 caracteres.', 'Escolha um perfil que você possa atribuir.'
  ]);
  assert.deepEqual(validateUserForm({ ...valid, name: 'x'.repeat(121) }, { assignable }), ['O nome pode ter até 120 caracteres.']);
  for (const email of ['sem-arroba', 'a@b', 'a b@c.d', `${'x'.repeat(250)}@a.bc`]) assert.deepEqual(validateUserForm({ ...valid, email }, { assignable }), ['Informe um e-mail válido.'], email);
  assert.deepEqual(validateUserForm({ ...valid, email: '  maria@example.invalid  ' }, { assignable }), [], 'espaços ao redor são ignorados');
  assert.deepEqual(validateUserForm({ ...valid, confirmPassword: 'outra' }, { assignable }), ['As senhas não coincidem.']);
  assert.deepEqual(validateUserForm({ ...valid, role: 'admin' }, { assignable }), ['Escolha um perfil que você possa atribuir.'], 'Gestor não atribui Administrador');
  assert.deepEqual(validateUserForm({ ...valid, unitIds: [] }, { assignable }), ['Escolha ao menos uma unidade e um setor.']);
  assert.deepEqual(validateUserForm({ ...valid, sectorIds: [] }, { assignable }), ['Escolha ao menos uma unidade e um setor.']);
  assert.deepEqual(validateUserForm({ ...valid, role: 'admin', unitIds: [], sectorIds: [] }, { assignable: ['admin', 'manager'] }), []);

  const edit = { mode: 'edit', name: 'Maria', role: 'viewer', unitIds: ['u'], sectorIds: ['s'] };
  assert.deepEqual(validateUserForm(edit, { assignable }), [], 'ao editar, e-mail e senha não são pedidos');
  assert.deepEqual(validateUserForm({ ...edit, name: ' ' }, { assignable }), ['Informe o nome da pessoa.']);
});

test('usuário: busca sem acento, filtros por perfil e situação, resumos de acesso e ações permitidas na lista', () => {
  const { filterUsers, roleLabel, customizationCount, accessSummary, userActions } = userModel;
  const users = [
    { id: '1', name: 'José Ação', email: 'jose@example.invalid', role: 'manager', active: true },
    { id: '2', name: 'Maria Editora', email: 'maria@example.invalid', role: 'editor', active: false },
    { id: '3', name: 'Vera Visão', email: 'vera@example.invalid', role: 'viewer' }
  ];
  assert.deepEqual(filterUsers(users, { q: 'jose acao' }).map(user => user.id), ['1'], 'sem acento, nome inteiro');
  assert.deepEqual(filterUsers(users, { q: 'acao maria' }).map(user => user.id), [], 'a busca é por trecho contínuo do nome + e-mail, não por palavras soltas');
  assert.deepEqual(filterUsers(users, { q: '   ' }).map(user => user.id), ['1', '2', '3'], 'busca só com espaços não filtra');
  assert.deepEqual(filterUsers(users, { q: 'josé' }).map(user => user.id), ['1']);
  assert.deepEqual(filterUsers(users, { q: 'JOSE' }).map(user => user.id), ['1']);
  assert.deepEqual(filterUsers(users, { q: 'EXAMPLE.invalid' }).map(user => user.id), ['1', '2', '3'], 'procura também no e-mail');
  assert.deepEqual(filterUsers(users, { role: 'editor' }).map(user => user.id), ['2']);
  assert.deepEqual(filterUsers(users, { status: 'active' }).map(user => user.id), ['1', '3'], 'sem o campo "active" a conta conta como ativa');
  assert.deepEqual(filterUsers(users, { status: 'inactive' }).map(user => user.id), ['2']);
  assert.deepEqual(filterUsers(users, { q: 'maria', status: 'active' }), []);
  assert.deepEqual(filterUsers(users).map(user => user.id), ['1', '2', '3']);

  assert.equal(roleLabel('manager'), 'Gestor');
  assert.equal(roleLabel('desconhecido'), 'desconhecido');
  assert.equal(customizationCount({ role: 'editor', grants: ['a'], revokes: ['b', 'c'] }), 3);
  assert.equal(customizationCount({ role: 'editor' }), 0);
  assert.equal(customizationCount({ role: 'admin', grants: ['a'], revokes: ['b'] }), 0, 'Administrador não tem personalização');
  assert.deepEqual(accessSummary({ role: 'admin' }), { units: ['Todas as unidades'], sectors: ['Todos os setores'] });
  assert.deepEqual(accessSummary({ role: 'editor', unitIds: ['a', 'b'], sectorIds: ['x'] }, { unitName: id => id.toUpperCase(), sectorName: id => `Setor ${id}` }), { units: ['A', 'B'], sectors: ['Setor x'] });
  assert.deepEqual(accessSummary({ role: 'viewer' }), { units: [], sectors: [] });

  assert.deepEqual(userActions({ id: '1', role: 'admin' }, { id: '1' }), { edit: true, resetPassword: true, self: true });
  assert.deepEqual(userActions({ id: '1', role: 'admin' }, { id: '2' }), { edit: true, resetPassword: true, self: false });
  assert.deepEqual(userActions({ id: '1', role: 'manager' }, { id: '2' }), { edit: false, resetPassword: false, self: false }, 'somente a TI edita contas e redefine senhas');
  assert.deepEqual(userActions({ id: '1', role: 'manager' }, { id: '1' }), { edit: false, resetPassword: false, self: true });
});

// ---- auditoria: resumos ---------------------------------------------------------------------------------------------------

const event = (action, detail = {}, extra = {}) => ({ id: 1, at: '2026-10-22T10:00:00.000Z', actor: 'admin@example.invalid', action, detail, ...extra });
const describe = (action, detail) => auditModel.describeAudit(event(action, detail));

test('auditoria: cada tipo de evento vira um resumo curto em português com quem/o quê, sem hashes nem identificadores internos', () => {
  assert.equal(describe('auth.login', { ip: '10.0.0.5' }), 'rede 10.0.0.5');
  assert.equal(describe('auth.login.failed', { email: 'x@y.invalid', ip: '1.2.3.4' }), 'e-mail informado: x@y.invalid · rede 1.2.3.4');
  assert.equal(describe('auth.login.failed', { email: null, ip: '1.2.3.4' }), 'e-mail digitado fora do formato (não gravado) · rede 1.2.3.4');
  assert.equal(describe('setup.admin.created', { email: 'ti@example.invalid' }), 'ti@example.invalid');
  assert.equal(describe('db.migrated', { from: 0, to: 6, backup: 'copia.sqlite' }), 'esquema 0 → 6 · cópia de segurança copia.sqlite');
  assert.equal(describe('user.created', { email: 'm@x.invalid', role: 'editor', unitIds: ['a', 'b'], sectorIds: ['s'], grants: ['x'], revokes: ['y', 'z'] }),
    'm@x.invalid · perfil Editor · 2 unidades e 1 setor · permissões individuais: 1 concedida e 2 retiradas');
  assert.equal(describe('user.updated', { email: 'v@x.invalid', role: 'viewer', active: false, unitIds: ['a'], sectorIds: ['b'], passwordReset: true }),
    'v@x.invalid · perfil Visualizador · conta suspensa · 1 unidade e 1 setor · senha redefinida');
  assert.equal(describe('user.created', { email: 'a@x.invalid', role: 'admin', unitIds: ['a'] }), 'a@x.invalid · perfil Administrador TI', 'Administrador não lista escopo');
  assert.equal(describe('user.password.reset', { email: 'x@y.invalid', sessionsRevoked: 3, source: 'local-console' }), 'x@y.invalid · 3 sessões encerradas · feita no console do servidor');
  assert.equal(describe('user.password.reset', { email: 'x@y.invalid', sessionsRevoked: 1 }), 'x@y.invalid · 1 sessão encerrada');
  assert.equal(describe('units.saved', { name: 'Unidade Centro' }), 'Unidade Centro');
  assert.equal(describe('folder.renamed', { from: 'Antiga', to: 'Nova' }), 'de “Antiga” para “Nova”');
  assert.equal(describe('device.renamed', { from: 'TV 1' }), 'de “TV 1”', 'registro incompleto mostra só o nome que existe, sem aspas vazias');
  assert.equal(describe('device.renamed', { to: 'TV 2' }), 'para “TV 2”');
  assert.equal(describe('media.renamed', { from: '  ', to: '' }), '');
  assert.equal(describe('media.uploaded', { title: 'Aviso', name: 'aviso.png', scanStatus: 'clean' }), 'Aviso · arquivo aviso.png · verificado');
  assert.equal(describe('media.uploaded', { title: 'aviso.png', name: 'aviso.png', scanStatus: 'not_configured' }), 'aviso.png · sem verificação antivírus');
  assert.equal(describe('media.deleted', { title: 'Aviso', name: 'aviso.png', sha256: 'f'.repeat(64) }), 'Aviso · arquivo aviso.png');
  assert.equal(describe('media.approved', { title: 'Aviso', scanStatus: 'clean' }), 'Aviso · verificado pelo antivírus');
  assert.equal(describe('media.approved', { title: 'Aviso', scanStatus: 'not_configured', localUnscannedAcknowledged: true }), 'Aviso · aprovado ciente de que não houve verificação antivírus');
  assert.equal(describe('media.approved', { title: 'Aviso' }), 'Aviso');
  assert.equal(describe('media.rejected', { name: 'cartaz.png' }), 'cartaz.png');
  assert.equal(describe('library.batch', { action: 'move', folders: 1, media: 3 }), 'mover: 1 pasta e 3 arquivos');
  assert.equal(describe('library.batch', { action: 'x' }), 'x: 0 pastas e 0 arquivos');
  assert.equal(describe('playlist.created', { name: 'Boas-vindas', items: 3 }), 'Boas-vindas · 3 itens');
  assert.equal(describe('playlist.updated', { name: 'Boas-vindas', renamed: true, items: 1 }), 'Boas-vindas · renomeada · 1 item');
  assert.equal(describe('playlist.version.published', { name: 'P', version: 2, items: 4, note: 'ok' }), 'P · versão 2 · 4 itens · nota: ok');
  assert.equal(describe('playlist.version.restored', { name: 'P', version: 1, skipped: 2 }), 'P · versão 1 copiada para o rascunho · 2 itens indisponíveis ficaram de fora');
  assert.equal(describe('playlist.version.restored', { name: 'P', version: 1, skipped: 1 }), 'P · versão 1 copiada para o rascunho · 1 item indisponível ficou de fora');
  assert.equal(describe('schedule.updated', { name: 'S', previousVersion: 1, playlistVersion: 2, displayIds: ['a', 'b'] }), 'S · versão da playlist 1 → 2 · 2 TVs');
  assert.equal(describe('schedule.published', { name: 'S', playlistVersion: 2, displayIds: ['a'], startAt: null, endAt: null }), 'S · playlist versão 2 · 1 TV · Início imediato → Sem data de término');
  assert.equal(describe('schedule.stopped', { name: 'S', reason: 'manual' }), 'S · manual');
  assert.equal(describe('device.created', { name: 'TV', status: 'pending' }), 'TV · aguardando ativação');
  assert.equal(describe('device.paired', { displayId: 'd1', name: 'TV da recepção' }), 'TV da recepção');
  assert.equal(describe('acao.desconhecida', { name: 'X', email: 'e@x.invalid' }), 'X · e@x.invalid');
});

test('auditoria: detalhes malformados ou antigos nunca quebram a tela nem inventam texto', () => {
  for (const detail of [null, undefined, [], 'texto', 42, true]) {
    for (const action of Object.keys(AUDIT_ACTIONS)) assert.doesNotThrow(() => auditModel.describeAudit({ action, detail }), `${action} com ${JSON.stringify(detail)}`);
    assert.equal(auditModel.describeAudit({ action: 'media.uploaded', detail }), '');
  }
  assert.equal(auditModel.describeAudit(null), '');
  assert.equal(auditModel.describeAudit({}), '');
  // Eventos gravados por versões anteriores (sem e-mail, título ou nome) continuam legíveis com o que existir.
  assert.equal(auditModel.describeAudit({ action: 'user.created', detail: { role: 'editor' } }), 'perfil Editor');
  assert.equal(auditModel.describeAudit({ action: 'media.approved', detail: { mediaId: 'abc' } }), '', 'identificador interno não é mostrado');
  assert.equal(auditModel.describeAudit({ action: 'schedule.created', detail: { scheduleId: 'abc' } }), '');
});

test('auditoria: registros da versão 1.1.0 (quando "playlist" era a programação) continuam legíveis e na categoria certa', () => {
  const { describeAudit, categoryOf, filterEvents } = auditModel;
  const published = {
    id: 7, at: '2026-10-01T12:00:00.000Z', actor: 'ana@example.invalid', action: 'playlist.published',
    detail: { playlistId: 'p1', unitId: 'centro', sectorId: 'rh', mediaIds: ['a', 'b', 'c'], displayIds: ['d1'], startAt: null, endAt: '2026-12-01T12:00:00.000Z' }
  };
  const stopped = { id: 8, at: '2026-10-02T12:00:00.000Z', actor: 'ana@example.invalid', action: 'playlist.stopped', detail: { playlistId: 'p1' } };
  assert.equal(auditActionLabel('playlist.published'), 'Programação publicada (registro da versão 1.1.0)');
  assert.equal(auditActionLabel('playlist.stopped'), 'Programação interrompida (registro da versão 1.1.0)');
  assert.equal(categoryOf('playlist.published'), 'schedules');
  assert.equal(categoryOf('playlist.stopped'), 'schedules');
  assert.equal(categoryOf('playlist.created'), 'playlists', 'as ações novas de playlist continuam em Playlists');
  assert.match(describeAudit(published), /^3 conteúdos · 1 TV · Início imediato → \d{2}\/\d{2}\/\d{4}/);
  assert.equal(describeAudit({ ...published, detail: { mediaIds: ['a'], displayIds: ['d1', 'd2'], startAt: null, endAt: null } }), '1 conteúdo · 2 TVs · Início imediato → Sem data de término');
  assert.equal(describeAudit({ action: 'playlist.published', detail: {} }), '');
  assert.equal(describeAudit({ action: 'playlist.published', detail: { mediaIds: 'não é lista', displayIds: 7 } }), '');
  assert.equal(describeAudit(stopped), '');
  // Aparecem ao filtrar por Programações e ao buscar pelo texto do rótulo.
  assert.deepEqual(filterEvents([published, stopped], { category: 'schedules' }).map(event => event.id), [7, 8]);
  assert.deepEqual(filterEvents([published, stopped], { category: 'playlists' }), []);
  assert.deepEqual(filterEvents([published, stopped], { q: 'interrompida' }).map(event => event.id), [8]);
});

test('auditoria: valores como "constructor" ou "__proto__" num registro adulterado não derrubam a tela nem viram função', () => {
  const { describeAudit } = auditModel;
  for (const odd of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(describeAudit({ action: 'media.uploaded', detail: { title: 'Arquivo', scanStatus: odd } }), 'Arquivo', `scanStatus ${odd}`);
    assert.equal(describeAudit({ action: 'user.created', detail: { role: odd } }), `perfil ${odd}`, `perfil ${odd}`);
    assert.equal(describeAudit({ action: 'library.batch', detail: { action: odd, folders: 1, media: 2 } }), `${odd}: 1 pasta e 2 arquivos`, `lote ${odd}`);
    assert.equal(describeAudit({ action: 'device.created', detail: { name: 'TV', status: odd } }), 'TV', `status ${odd}`);
    assert.equal(auditActionLabel(odd), odd, `rótulo de ${odd}`);
    assert.equal(auditModel.categoryOf(odd), 'system', `categoria de ${odd}`);
  }
});

test('auditoria: categorias, períodos, responsáveis e local do evento', () => {
  const { categoryOf, categoryLabel, AUDIT_CATEGORIES, periodStart, actorLabel, placeLabel } = auditModel;
  const known = new Set(AUDIT_CATEGORIES.map(([value]) => value).filter(Boolean));
  for (const action of Object.keys(AUDIT_ACTIONS)) {
    const category = categoryOf(action);
    assert.ok(known.has(category), `${action} → ${category}`);
    if (action !== 'db.migrated') assert.notEqual(category, 'system', `${action} deveria ter categoria própria`);
  }
  assert.equal(categoryOf('auth.login'), 'access');
  assert.equal(categoryOf('setup.admin.created'), 'users');
  assert.equal(categoryOf('user.password.reset'), 'users');
  assert.equal(categoryOf('units.saved'), 'organization');
  assert.equal(categoryOf('media.approved'), 'library');
  assert.equal(categoryOf('library.batch'), 'library');
  assert.equal(categoryOf('device.paired'), 'displays');
  assert.equal(categoryOf('algo.novo'), 'system');
  assert.equal(categoryOf(undefined), 'system');
  assert.equal(categoryLabel('displays'), 'Telas');
  assert.equal(categoryLabel('nada'), '');

  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(periodStart('24h', now), now - 86400e3);
  assert.equal(periodStart('7d', now), now - 7 * 86400e3);
  assert.equal(periodStart('30d', now), now - 30 * 86400e3);
  assert.equal(periodStart('', now), null);
  assert.equal(periodStart('1 ano', now), null);

  assert.equal(actorLabel('ana@example.invalid'), 'ana@example.invalid');
  assert.equal(actorLabel('system'), 'Sistema');
  assert.equal(actorLabel(''), 'Sistema');
  assert.equal(actorLabel(null), 'Sistema');
  assert.equal(actorLabel('anonymous'), 'Sem identificação');
  assert.equal(actorLabel('player:7f3e'), 'TV (player)');
  assert.equal(actorLabel('local-console:ana'), 'Console do servidor (ana)');
  assert.equal(actorLabel('local-console:'), 'Console do servidor (operador)');

  const names = { unitName: id => ({ u1: 'Unidade Centro' })[id] ?? id, sectorName: id => ({ s1: 'RH' })[id] ?? id };
  assert.equal(placeLabel({ unitId: 'u1', sectorId: 's1' }, names), 'Unidade Centro · RH');
  assert.equal(placeLabel({ unitId: 'u1' }, names), 'Unidade Centro');
  assert.equal(placeLabel({}, names), '');
  assert.equal(placeLabel(null), '');
});

test('auditoria: busca sem acento, categoria e período; evento sem data válida nunca cai dentro de um período', () => {
  const { filterEvents } = auditModel;
  const now = Date.parse('2026-10-22T12:00:00Z');
  const hoursAgo = hours => new Date(now - hours * 3600e3).toISOString();
  const events = [
    event('auth.login', { ip: '10.0.0.1' }, { id: 5, at: hoursAgo(1), actor: 'ana@example.invalid' }),
    event('media.uploaded', { title: 'Cartaz de Segurança', name: 'cartaz.png' }, { id: 4, at: hoursAgo(72), unitId: 'u1', sectorId: 's1' }),
    event('user.created', { email: 'maria@example.invalid', role: 'editor' }, { id: 3, at: hoursAgo(24 * 40) }),
    event('db.migrated', { from: 1, to: 2 }, { id: 2, at: 'não é data' })
  ];
  const names = { unitName: () => 'Unidade Centro', sectorName: () => 'Setor RH' };
  const ids = (filters, options) => filterEvents(events, filters, { now, names, ...options }).map(item => item.id);
  assert.deepEqual(ids({}), [5, 4, 3, 2]);
  assert.deepEqual(ids({ q: 'seguranca' }), [4], 'acha "Segurança" sem acento');
  assert.deepEqual(ids({ q: 'SEGURANÇA' }), [4]);
  assert.deepEqual(ids({ q: 'maria' }), [3]);
  assert.deepEqual(ids({ q: 'entrada no painel' }), [5], 'procura também no nome legível da ação');
  assert.deepEqual(ids({ q: 'centro' }), [4], 'e no local do evento');
  assert.deepEqual(ids({ q: 'ana@' }), [5]);
  assert.deepEqual(ids({ q: 'inexistente' }), []);
  assert.deepEqual(ids({ category: 'access' }), [5]);
  assert.deepEqual(ids({ category: 'library' }), [4]);
  assert.deepEqual(ids({ category: 'system' }), [2]);
  assert.deepEqual(ids({ period: '24h' }), [5]);
  assert.deepEqual(ids({ period: '7d' }), [5, 4]);
  assert.deepEqual(ids({ period: '30d' }), [5, 4]);
  assert.deepEqual(ids({ period: '99d' }), [5, 4, 3, 2], 'período desconhecido não filtra');
  assert.deepEqual(ids({ q: 'cartaz', category: 'library', period: '7d' }), [4]);
  assert.deepEqual(ids({ q: 'cartaz', category: 'access' }), []);
});

test('auditoria: juntar páginas não repete eventos, mantém a ordem e diz se o período escolhido já foi coberto', () => {
  const { mergeEvents, coversPeriod } = auditModel;
  const make = (id, at = '2026-10-22T10:00:00Z') => ({ id, at, action: 'auth.login', actor: 'a', detail: {} });
  const first = [make(9), make(8), make(7)], second = [make(7, 'versão repetida'), make(6), make(5)];
  const merged = mergeEvents(first, second, undefined, null, [null, make(10)]);
  assert.deepEqual(merged.map(item => item.id), [10, 9, 8, 7, 6, 5]);
  assert.equal(merged.find(item => item.id === 7).at, '2026-10-22T10:00:00Z', 'o primeiro que aparece vale: eventos nunca mudam');
  assert.deepEqual(mergeEvents(), []);

  const now = Date.parse('2026-10-22T12:00:00Z');
  const old = make(1, '2026-10-01T00:00:00Z'), recent = make(2, '2026-10-22T11:00:00Z');
  assert.equal(coversPeriod([recent], true, '', now), true, 'sem período não há o que cobrir');
  assert.equal(coversPeriod([recent], false, '7d', now), true, 'sem mais histórico, tudo o que existe foi carregado');
  assert.equal(coversPeriod([recent], true, '7d', now), false, 'ainda há eventos mais antigos por carregar dentro do período');
  assert.equal(coversPeriod([recent, old], true, '7d', now), true, 'o evento mais antigo carregado já saiu do período');
  assert.equal(coversPeriod([], true, '7d', now), false);
});

// ---- exportação CSV ----------------------------------------------------------------------------------------------------------

// Leitor mínimo de CSV: células entre aspas separadas por ";" e linhas por CRLF (aspas duplicadas dentro da célula).
function parseCsv(text) {
  assert.equal(text.charCodeAt(0), 0xFEFF, 'o arquivo começa com BOM para o Excel reconhecer UTF-8');
  const rows = [];
  let row = [], cell = '', quoted = false;
  const body = text.slice(1);
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ';') { row.push(cell); cell = ''; } else if (char === '\r' && body[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++; } else cell += char;
  }
  row.push(cell); rows.push(row);
  return rows;
}

test('CSV: células com aspas, ponto e vírgula e quebras de linha; fórmulas viram texto', () => {
  assert.equal(csvCell('texto simples'), '"texto simples"');
  assert.equal(csvCell('com "aspas"'), '"com ""aspas"""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(42), '"42"');
  assert.equal(csvCell('a;b\nc'), '"a;b\nc"');
  for (const dangerous of ['=1+1', '+SUM(A1)', '-2+3', '@SOMA(A1)', '\t=1', '\r=1']) assert.equal(csvCell(dangerous), `"'${dangerous}"`, JSON.stringify(dangerous));
  assert.equal(csvCell("'=ja-escapado"), `"'=ja-escapado"`, 'apóstrofo no começo já é texto');
  assert.equal(csvCell(' =com espaço antes'), '" =com espaço antes"');
  assert.equal(csvCell('meio=1'), '"meio=1"');
  assert.equal(auditCsvName(new Date('2026-10-22T10:00:00Z')), 'tvcorp-auditoria-2026-10-22.csv');
});

test('CSV: o arquivo da auditoria tem cabeçalho, uma linha por evento, escapes corretos e volta intacto ao ser lido', () => {
  const events = [
    event('media.uploaded', { title: 'Título; com "aspas"', name: 'a.png', scanStatus: 'clean' }, { id: 3, unitId: 'u1', sectorId: 's1' }),
    event('auth.login.failed', { email: null, ip: '1.2.3.4' }, { id: 2, actor: 'anonymous' }),
    event('folder.created', { name: '=HYPERLINK("http://exemplo.invalid","clique")' }, { id: 1, actor: '=cmd|\' /C calc\'!A0' })
  ];
  const text = buildAuditCsv(events, { unitName: () => 'Unidade Centro', sectorName: () => 'RH' });
  const rows = parseCsv(text);
  assert.deepEqual(rows[0], ['Data', 'Responsável', 'Ação', 'Detalhes', 'Descrição', 'Unidade', 'Setor', 'Resumo']);
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.length === 8));
  assert.equal(text.split('\r\n').length, 4, 'linhas separadas por CRLF');

  assert.equal(rows[1][0], '2026-10-22T10:00:00.000Z');
  assert.equal(rows[1][2], 'media.uploaded');
  assert.deepEqual(JSON.parse(rows[1][3]), { title: 'Título; com "aspas"', name: 'a.png', scanStatus: 'clean' }, 'os detalhes completos voltam sem perda');
  assert.equal(rows[1][4], 'Arquivo enviado');
  assert.deepEqual([rows[1][5], rows[1][6]], ['Unidade Centro', 'RH']);
  assert.equal(rows[1][7], 'Título; com "aspas" · arquivo a.png · verificado');
  assert.deepEqual([rows[2][5], rows[2][6]], ['', ''], 'evento sem escopo deixa unidade e setor em branco');

  assert.equal(rows[3][1], "'=cmd|' /C calc'!A0", 'responsável que começa com = vira texto (apóstrofo na frente, o resto intacto)');
  assert.equal(rows[3][7], '\'=HYPERLINK("http://exemplo.invalid","clique")', 'o resumo com fórmula também é neutralizado');
  for (const row of rows.slice(1)) for (const cell of row) assert.ok(!/^[=+\-@\t\r]/.test(cell), `célula perigosa sem neutralização: ${cell}`);
  assert.equal(buildAuditCsv([]).slice(1).split('\r\n').length, 1, 'sem eventos só o cabeçalho');
});

// ---- configurações ----------------------------------------------------------------------------------------------------------

test('configurações: nomes de unidade e setor — vazio, tamanho, repetido sem considerar acento/caixa/espaços, e o próprio registro', () => {
  const { validateOrganizationForm, nameKey, ORG_KINDS } = settingsModel;
  const units = [{ id: 'u1', name: 'Unidade Centro' }, { id: 'u2', name: 'Vila Norte' }];
  const sectors = [{ id: 's1', name: 'Segurança do Trabalho' }];
  assert.deepEqual(validateOrganizationForm('units', { name: 'Unidade Contagem', city: 'Contagem · MG' }, { existing: units }), []);
  assert.deepEqual(validateOrganizationForm('units', { name: '  ' }, { existing: units }), ['Informe o nome da unidade.']);
  assert.deepEqual(validateOrganizationForm('sectors', { name: undefined }), ['Informe o nome do setor.']);
  assert.deepEqual(validateOrganizationForm('units', { name: 'x'.repeat(121) }, { existing: units }), ['O nome da unidade pode ter até 120 caracteres.']);
  assert.deepEqual(validateOrganizationForm('units', { name: 'UNIDADE   centro' }, { existing: units }), ['Já existe uma unidade com este nome.']);
  assert.deepEqual(validateOrganizationForm('sectors', { name: 'seguranca DO trabalho' }, { existing: sectors }), ['Já existe um setor com este nome.']);
  assert.deepEqual(validateOrganizationForm('units', { name: 'Unidade Centro' }, { existing: units, selfId: 'u1' }), [], 'editar a própria unidade sem mudar o nome não é conflito');
  assert.deepEqual(validateOrganizationForm('units', { name: 'Vila Norte' }, { existing: units, selfId: 'u1' }), ['Já existe uma unidade com este nome.']);
  assert.deepEqual(validateOrganizationForm('units', { name: 'Nova', city: 'c'.repeat(121) }), ['A cidade pode ter até 120 caracteres.']);
  assert.deepEqual(validateOrganizationForm('sectors', { name: 'Nova', city: 'c'.repeat(500) }), [], 'setor não tem cidade');
  assert.throws(() => validateOrganizationForm('departamentos', { name: 'x' }), RangeError);
  assert.equal(nameKey('  Ação   Rápida '), 'acao rapida');
  assert.equal(ORG_KINDS.units.edit('Centro'), 'Editar a unidade Centro');
  assert.equal(ORG_KINDS.sectors.edit('RH'), 'Editar o setor RH');
  for (const spec of Object.values(ORG_KINDS)) for (const [key, value] of Object.entries(spec)) assert.ok(typeof value === 'function' || String(value).trim(), `texto vazio: ${key}`);
});

test('configurações: situação dos controles de segurança sem alegar certificação, e linhas do ambiente', () => {
  const { securityRows, environmentRows, modeLabel } = settingsModel;
  const local = securityRows({ scannerConfigured: false, mode: 'local' });
  const byLabel = rows => Object.fromEntries(rows.map(row => [row.label, row]));
  assert.deepEqual(local.map(row => row.label), [
    'Controle por unidade e setor', 'Permissões conferidas no servidor', 'Sessão e proteção CSRF', 'Trilha de auditoria encadeada',
    'Verificação antivírus dos arquivos', 'Login único Microsoft Entra ID (SSO)'
  ]);
  assert.equal(byLabel(local)['Verificação antivírus dos arquivos'].status, 'Não configurada (ambiente local)');
  assert.equal(byLabel(local)['Verificação antivírus dos arquivos'].tone, 'pending');
  assert.equal(byLabel(securityRows({ scannerConfigured: false, mode: 'production' }))['Verificação antivírus dos arquivos'].status, 'Configuração necessária');
  assert.deepEqual([byLabel(securityRows({ scannerConfigured: true, mode: 'production' }))['Verificação antivírus dos arquivos'].status, byLabel(securityRows({ scannerConfigured: true }))['Verificação antivírus dos arquivos'].tone], ['Configurada', 'ok']);
  assert.equal(byLabel(local)['Login único Microsoft Entra ID (SSO)'].tone, 'pending', 'o que ainda não existe aparece como pendente, não como ativo');
  assert.equal(byLabel(local)['Login único Microsoft Entra ID (SSO)'].status, 'Integração pendente');
  for (const row of local) assert.ok(['ok', 'pending'].includes(row.tone));
  assert.doesNotMatch(JSON.stringify(local), /certific|ISO|TISAX|conforme/i, 'a tela não afirma certificação nem conformidade');

  assert.equal(modeLabel('production'), 'Ambiente corporativo (produção)');
  assert.equal(modeLabel('local'), 'Ambiente local de testes');
  assert.deepEqual(environmentRows({ mode: 'local', version: '2.0.0-fase2', schema: 7, limits: { maxUploadMB: 50, playlistMaxItems: 100, folderMaxDepth: 8 } }), [
    ['Modo', 'Ambiente local de testes'], ['Versão da plataforma', '2.0.0-fase2'], ['Esquema do banco de dados', '7'],
    ['Tamanho máximo por arquivo', '50 MB'], ['Conteúdos por playlist (máximo)', '100'], ['Níveis de pastas (máximo)', '8']
  ]);
  assert.deepEqual(environmentRows({ mode: 'production' }), [['Modo', 'Ambiente corporativo (produção)'], ['Versão da plataforma', '—'], ['Esquema do banco de dados', '—']]);
  assert.equal(environmentRows({ schema: 'seis' })[2][1], '—');
});

// ---- tudo junto: eventos reais do servidor ------------------------------------------------------------------------------------

test('auditoria: todo evento que o servidor grava tem rótulo, categoria e resumo legíveis, e o CSV deles volta intacto', async () => {
  // 1) Estático: toda ação gravada no código do servidor tem rótulo em português e vice-versa (sem rótulos órfãos).
  const recorded = new Set(['media.approved', 'media.rejected']); // gravadas com nome montado: `media.${decisão}`
  const walk = directory => readdirSync(path.join(projectRoot, directory), { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.posix.join(directory, entry.name)) : [path.posix.join(directory, entry.name)]));
  for (const file of [...walk('server'), ...walk('scripts')].filter(name => name.endsWith('.mjs'))) {
    for (const match of readFileSync(path.join(projectRoot, file), 'utf8').matchAll(/['"`]((?:auth|setup|db|user|units|sectors|folder|media|library|playlist|schedule|device|display)\.[a-z]+(?:\.[a-z]+)?)['"`]/g)) recorded.add(match[1]);
  }
  assert.deepEqual([...recorded].filter(action => !AUDIT_ACTIONS[action]).sort(), [], 'ação gravada pelo servidor sem rótulo na tela');
  assert.deepEqual(Object.keys(AUDIT_ACTIONS).filter(action => !recorded.has(action)).sort(), [], 'rótulo de uma ação que o servidor não grava mais');

  // 2) Dinâmico: eventos de verdade, de um uso variado do sistema.
  await withApp(async kit => {
    const person = await kit.createUser('editor', { email: 'pessoa@example.invalid', grants: ['media:approve'] });
    must(await kit.call(`/api/users/${person.user.id}`, { method: 'PATCH', session: kit.admin, body: { active: false } }));
    must(await kit.call(`/api/users/${person.user.id}`, { method: 'PATCH', session: kit.admin, body: { password: 'Outra-senha-12345' } }));
    must(await kit.call('/api/units', { method: 'POST', session: kit.admin, body: { name: 'Unidade Nova', city: 'Cidade · UF' } }), 201);
    must(await kit.call('/api/sectors', { method: 'POST', session: kit.admin, body: { name: 'Setor Novo' } }), 201);
    const folder = await kit.folder(kit.admin, { name: 'Comunicados' });
    must(await kit.call(`/api/folders/${folder.id}`, { method: 'PATCH', session: kit.admin, body: { name: 'Comunicados 2026' } }));
    const media = await kit.approvedMedia(kit.admin, { title: 'Cartaz', name: 'cartaz.png', folderId: folder.id });
    const rejected = await kit.upload(kit.admin, { title: 'Rascunho', name: 'rascunho.png' });
    must(await kit.call(`/api/media/${rejected.id}/reject`, { method: 'POST', session: kit.admin, body: {} }));
    must(await kit.call(`/api/media/${rejected.id}`, { method: 'PATCH', session: kit.admin, body: { title: 'Rascunho 2' } }));
    must(await kit.call(`/api/media/${rejected.id}`, { method: 'DELETE', session: kit.admin }));
    must(await kit.call('/api/library/batch', { method: 'POST', session: kit.admin, body: { action: 'move', mediaIds: [media.id], folderIds: [], targetFolderId: null, unitId: 'leste', sectorId: 'rh' } }));
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id], { name: 'Boas-vindas' });
    const tv = await kit.pairedDisplay(kit.admin, { name: 'TV da recepção' });
    const schedule = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id], name: 'Semana 1' });
    must(await kit.call(`/api/schedules/${schedule.id}/stop`, { method: 'POST', session: kit.admin, body: {} }));
    must(await kit.call(`/api/displays/${tv.display.id}`, { method: 'PATCH', session: kit.admin, body: { name: 'TV da recepção (nova)', rev: tv.display.accessRev, sectorIds: ['rh'], userIds: [] } }));
    const queue = must(await kit.call(`/api/displays/${tv.display.id}/sequence`, { session: kit.admin }));
    must(await kit.call(`/api/displays/${tv.display.id}/order`, { method: 'PUT', session: kit.admin, body: { rev: queue.revision, scheduleIds: queue.schedules.map(item => item.id) } }));
    await kit.api.login('pessoa@example.invalid', 'senha-errada-qualquer');

    const events = must(await kit.call('/api/audit?limit=500', { session: kit.admin })).events;
    const actions = new Set(events.map(item => item.action));
    for (const expected of ['auth.login', 'auth.login.failed', 'user.created', 'user.updated', 'user.password.reset', 'units.saved', 'sectors.saved', 'folder.created', 'folder.renamed',
      'media.uploaded', 'media.approved', 'media.rejected', 'media.renamed', 'media.deleted', 'library.batch', 'playlist.created', 'playlist.version.published', 'device.created',
      'device.paired', 'device.renamed', 'device.access.updated', 'device.queue.reordered', 'schedule.created', 'schedule.published', 'schedule.stopped']) assert.ok(actions.has(expected), `o cenário não gerou ${expected}`);

    const names = { unitName: id => id, sectorName: id => id };
    const known = new Set(auditModel.AUDIT_CATEGORIES.map(([value]) => value).filter(Boolean));
    for (const item of events) {
      assert.ok(known.has(auditModel.categoryOf(item.action)), item.action);
      assert.notEqual(auditActionLabel(item.action), item.action, `${item.action} sem rótulo`);
      const summary = auditModel.describeAudit(item);
      assert.doesNotMatch(summary, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, `identificador interno no resumo de ${item.action}: ${summary}`);
      assert.doesNotMatch(summary, /\b[0-9a-f]{64}\b/i, `hash no resumo de ${item.action}`);
      assert.doesNotMatch(summary, new RegExp(`${PASSWORD}|Outra-senha-12345|senha-errada-qualquer`), 'nenhuma senha na trilha');
      if (!['auth.logout', 'auth.login'].includes(item.action)) assert.ok(summary.length > 0, `resumo vazio para ${item.action}: ${JSON.stringify(item.detail)}`);
    }
    const summaries = Object.fromEntries(events.map(item => [item.action, auditModel.describeAudit(item)]));
    assert.match(summaries['user.created'], /pessoa@example\.invalid · perfil Editor · 1 unidade e 1 setor · permissões individuais: 1 concedida/);
    assert.match(summaries['auth.login.failed'], /^e-mail informado: pessoa@example\.invalid/);
    assert.match(summaries['playlist.version.published'], /^Boas-vindas · versão 1 · 1 item/);
    assert.match(summaries['schedule.published'], /^Semana 1 · playlist versão 1 · 1 TV/);
    assert.equal(summaries['device.renamed'], 'de “TV da recepção” para “TV da recepção (nova)”');
    assert.equal(summaries['folder.renamed'], 'de “Comunicados” para “Comunicados 2026”');
    assert.equal(summaries['media.renamed'], 'de “Rascunho” para “Rascunho 2”');

    const rows = parseCsv(buildAuditCsv(events, names));
    assert.equal(rows.length, events.length + 1);
    assert.ok(rows.every(row => row.length === 8));
    assert.deepEqual(rows.slice(1).map(row => JSON.parse(row[3])), events.map(item => item.detail), 'os detalhes completos de todos os eventos voltam sem perda do CSV');
    assert.deepEqual(rows.slice(1).map(row => row[2]), events.map(item => item.action));
  });
});
