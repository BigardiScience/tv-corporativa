import { randomUUID } from 'node:crypto';
import { fail } from '../lib/errors.mjs';
import { passwordHash, passwordValid } from '../lib/crypto.mjs';
import { email as validEmail, label, nowIso, oneOf, validatePassword } from '../lib/validate.mjs';
import {
  ROLES, ROLE_PERMISSIONS, MANAGEABLE_ROLES, NON_DELEGABLE,
  authorize, effectivePermissions, hasPermission, validatePermissionList
} from './permissions.mjs';

// Senha fictícia usada para gastar o mesmo tempo quando o e-mail não existe (evita revelar contas pelo tempo de resposta).
const DUMMY_HASH = '00000000000000000000000000000000:0'.padEnd(161, '0');

const subset = (values, allowed) => (values ?? []).every(value => (allowed ?? []).includes(value));

export function publicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return { ...rest, grants: rest.grants ?? [], revokes: rest.revokes ?? [], permissions: [...effectivePermissions(user)].sort() };
}

export function createUsers({ db, tx, audit, organization, displayAccess }) {
  const parse = row => (row ? JSON.parse(row.data) : null);
  const byId = id => parse(db.prepare('SELECT data FROM users WHERE id=?').get(id));
  const byEmail = address => parse(db.prepare('SELECT data FROM users WHERE email=?').get(address));
  const all = () => db.prepare('SELECT data FROM users').all().map(parse);
  const save = user => db.prepare('INSERT INTO users(id,email,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,data=excluded.data')
    .run(user.id, user.email, JSON.stringify(user));
  const configured = () => db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
  const activeAdmins = () => all().filter(user => user.active && user.role === 'admin').length;

  function validateAssignments(unitIds, sectorIds) {
    if (!Array.isArray(unitIds) || !Array.isArray(sectorIds) || unitIds.length > 50 || sectorIds.length > 50) fail(400, 'Informe unidades e setores autorizados.');
    if (unitIds.some(id => !organization.unitExists(id)) || sectorIds.some(id => !organization.sectorExists(id))) fail(400, 'Unidade ou setor inexistente.');
    return { unitIds: [...new Set(unitIds)], sectorIds: [...new Set(sectorIds)] };
  }

  // Quem não é administrador só concede acesso a unidades e setores que ele próprio possui.
  function assertWithinScope(actor, unitIds, sectorIds) {
    if (actor.role === 'admin') return;
    if (!subset(unitIds, actor.unitIds) || !subset(sectorIds, actor.sectorIds)) fail(403, 'Você só pode conceder acesso às unidades e aos setores que você mesmo possui.', 'SCOPE_DENIED');
  }

  function assertCanAssignRole(actor, role) {
    if (actor.role === 'admin') return;
    if (!(MANAGEABLE_ROLES[actor.role] ?? []).includes(role)) fail(403, 'Seu perfil não pode atribuir este perfil de acesso.', 'ROLE_ESCALATION');
  }

  function assertCanManage(actor, target) {
    if (actor.role === 'admin') return;
    if (target.id === actor.id) fail(403, 'Você não pode alterar a própria conta por esta tela.', 'PERMISSION_DENIED');
    if (!(MANAGEABLE_ROLES[actor.role] ?? []).includes(target.role)) fail(403, 'Seu perfil não pode gerenciar este usuário.', 'PERMISSION_DENIED');
    if (!subset(target.unitIds, actor.unitIds) || !subset(target.sectorIds, actor.sectorIds)) fail(403, 'Este usuário tem acesso a unidades ou setores fora do seu escopo.', 'SCOPE_DENIED');
  }

  // Permissões por pessoa = padrão do perfil + concedidas - retiradas. Impede escalada de privilégio.
  function permissionChanges(actor, role, body, existing) {
    if (role === 'admin') return { grants: [], revokes: [] };
    const grants = validatePermissionList(body.grants, { what: 'permissões concedidas' }) ?? existing?.grants ?? [];
    const revokes = validatePermissionList(body.revokes, { what: 'permissões retiradas' }) ?? existing?.revokes ?? [];
    if (grants.some(id => revokes.includes(id))) fail(400, 'Uma permissão não pode ser concedida e retirada ao mesmo tempo.');
    const defaults = new Set(ROLE_PERMISSIONS[role]);
    const cleanGrants = grants.filter(id => !defaults.has(id)), cleanRevokes = revokes.filter(id => defaults.has(id));
    for (const id of cleanGrants.filter(id => !(existing?.grants ?? []).includes(id))) {
      if (id === 'settings:manage') fail(400, 'As configurações globais são exclusivas do Administrador.', 'PERMISSION_DENIED');
      if (id === 'screen:pair') fail(400, 'Gerar código de pareamento é uma permissão dos perfis Editor e Gestor. O Visualizador não a recebe.', 'PERMISSION_DENIED');
      if (id === 'user:manage'||id.startsWith('screen:')) fail(400, 'A gestão de usuários, TVs e acessos é exclusiva do Administrador.', 'PERMISSION_DENIED');
      if (actor.role !== 'admin' && (NON_DELEGABLE.includes(id) || !hasPermission(actor, id))) fail(403, 'Você não pode conceder uma permissão que não possui.', 'ROLE_ESCALATION');
    }
    return { grants: cleanGrants, revokes: cleanRevokes };
  }

  function commit(actor, next, { passwordReset = false, source = 'admin-api', profileChanged = true } = {}) {
    tx(() => {
      save(next);
      displayAccess?.reconcile(actor);
      const revoked = db.prepare('DELETE FROM sessions WHERE userId=?').run(next.id).changes;
      if (profileChanged) audit.record(actor, 'user.updated', { userId: next.id, email: next.email, role: next.role, active: next.active, unitIds: next.unitIds, sectorIds: next.sectorIds, grants: next.grants, revokes: next.revokes, passwordReset });
      if (passwordReset) audit.record(actor, 'user.password.reset', { userId: next.id, email: next.email, source, sessionsRevoked: revoked });
    });
    return publicUser(next);
  }

  function createAdmin(name, address, password) {
    if (configured()) fail(409, 'O administrador inicial já foi configurado.');
    const user = {
      id: randomUUID(), name: label(name), email: validEmail(address), password: passwordHash(validatePassword(password)), role: 'admin',
      unitIds: organization.units().map(x => x.id), sectorIds: organization.sectors().map(x => x.id), grants: [], revokes: [], active: true, createdAt: nowIso()
    };
    tx(() => { save(user); audit.record(user, 'setup.admin.created', { userId: user.id, email: user.email }); });
    return publicUser(user);
  }

  function create(actor, body) {
    authorize(actor, 'user:manage');
    const address = validEmail(body.email);
    if (byEmail(address)) fail(409, 'Este e-mail já está cadastrado.');
    const role = oneOf(body.role, ROLES, 'Perfil inválido.');
    assertCanAssignRole(actor, role);
    const { unitIds, sectorIds } = validateAssignments(body.unitIds ?? [], body.sectorIds ?? []);
    assertWithinScope(actor, unitIds, sectorIds);
    const { grants, revokes } = permissionChanges(actor, role, body, null);
    const user = {
      id: randomUUID(), name: label(body.name), email: address, password: passwordHash(validatePassword(body.password)), role,
      unitIds, sectorIds, grants, revokes, active: true, createdAt: nowIso(), createdBy: actor.id
    };
    tx(() => { save(user); audit.record(actor, 'user.created', { userId: user.id, email: address, role, unitIds, sectorIds, grants, revokes }); });
    return publicUser(user);
  }

  function update(actor, id, body) {
    authorize(actor, 'user:manage');
    const target = byId(id);
    if (!target) fail(404, 'Usuário não encontrado.');
    assertCanManage(actor, target);
      // Gestão de contas e redefinição de senha são exclusivas da Administração.
    if (body.password !== undefined && actor.role !== 'admin') fail(403, 'Somente a TI (Administrador) redefine senhas.', 'PERMISSION_DENIED');
    const next = { ...target };
    if (body.name !== undefined) next.name = label(body.name);
    if (body.role !== undefined) { next.role = oneOf(body.role, ROLES, 'Perfil inválido.'); assertCanAssignRole(actor, next.role); }
    if (body.active !== undefined) { if (typeof body.active !== 'boolean') fail(400, 'Situação inválida.'); next.active = body.active; }
    if (body.unitIds !== undefined || body.sectorIds !== undefined) {
      Object.assign(next, validateAssignments(body.unitIds ?? target.unitIds, body.sectorIds ?? target.sectorIds));
      assertWithinScope(actor, next.unitIds, next.sectorIds);
    }
    if (body.role !== undefined || body.grants !== undefined || body.revokes !== undefined) Object.assign(next, permissionChanges(actor, next.role, body, target));
    if (body.password !== undefined) next.password = passwordHash(validatePassword(body.password));
    if (target.role === 'admin' && target.active && (!next.active || next.role !== 'admin') && activeAdmins() <= 1) fail(409, 'Mantenha ao menos um administrador ativo.');
    return commit(actor, next, { passwordReset: body.password !== undefined });
  }

  // Recuperação local no servidor. Deliberadamente SEM rota HTTP.
  function resetAdminPassword(address, password, operator = 'local-console') {
    const user = byEmail(validEmail(address));
    if (!user || !user.active || user.role !== 'admin') fail(403, 'A recuperação local exige uma conta administrativa existente e ativa.');
    const next = { ...user, password: passwordHash(validatePassword(password)) };
    return commit(`local-console:${label(operator, 160)}`, next, { passwordReset: true, source: 'local-console', profileChanged: false });
  }

    // A relação de usuários e sua gestão são exclusivas do Administrador.
  function listFor(actor) {
    if (actor.role === 'admin') return all().map(publicUser);
    if (!hasPermission(actor, 'user:manage')) return [];
    return all().filter(user => {
      try { assertCanManage(actor, user); return true; } catch { return false; }
    }).map(publicUser);
  }

  function authenticate(address, password) {
    const user = byEmail(address);
    const valid = passwordValid(typeof password === 'string' ? password.slice(0, 129) : '', user?.password ?? DUMMY_HASH);
    return user && user.active && valid ? user : null;
  }

  return { byId, byEmail, all, configured, createAdmin, create, update, resetAdminPassword, listFor, authenticate, publicUser };
}
