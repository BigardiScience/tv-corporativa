// Regras de permissão no navegador.
//
// ATENÇÃO: isto existe só para a interface mostrar ou esconder botões e explicar por que algo está desabilitado.
// A decisão de verdade é SEMPRE do servidor (cada rota valida permissão + unidade + setor). Os testes comparam estas funções
// com as do servidor para que as duas não se afastem.

export const ROLE_LABELS = Object.freeze({ admin: 'Administrador TI', manager: 'Gestor', editor: 'Editor', viewer: 'Visualizador' });
export const ROLE_SUMMARIES = Object.freeze({
  admin: 'Acesso total: usuários, configurações, auditoria e todas as unidades e setores.',
  manager: 'Aprova conteúdo e publica programações nas TVs autorizadas do próprio escopo e gera o código de pareamento dessas TVs. Usuários e TVs são gerenciados pelo perfil Administrador.',
  editor: 'Envia e organiza arquivos, monta playlists em rascunho, cria e publica programações e gera o código de pareamento das TVs autorizadas. Não aprova arquivos nem publica versões de playlist por padrão.',
  viewer: 'Somente consulta. Não altera nada.'
});

export const ADMIN_ONLY_PERMISSIONS = Object.freeze(['screen:create', 'screen:activate', 'screen:update', 'screen:delete', 'user:manage', 'settings:manage']);
export const hasPermission = (user, permission) => !!user && user.active !== false &&
  (!ADMIN_ONLY_PERMISSIONS.includes(permission) || user.role === 'admin') && (user.permissions ?? []).includes(permission);

// TVs são equipamentos compartilhados da unidade. Concessões legadas de screen:* não tornam um usuário administrador.
export const canManageDisplays = user => user?.active !== false && user?.role === 'admin';

export function inScope(user, target) {
  if (!user || user.active === false || !target) return false;
  if (user.role === 'admin') return true;
  return (user.unitIds ?? []).includes(target.unitId) && (user.sectorIds ?? []).includes(target.sectorId);
}

export const canIn = (user, permission, space) => hasPermission(user, permission) && inScope(user, space);

// Somente a TI administra contas e atribui perfis, inclusive quando um catálogo antigo sugeria delegação.
export function assignableRoles(actor, catalog) {
  if (!actor || actor.active === false || !catalog || actor.role !== 'admin') return [];
  return [...catalog.roles];
}

// ---- catálogo de permissões -----------------------------------------------------------------------------------------

export function groupPermissions(catalog) {
  const groups = [];
  for (const permission of catalog?.permissions ?? []) {
    let group = groups.find(item => item.group === permission.group);
    if (!group) { group = { group: permission.group, items: [] }; groups.push(group); }
    group.items.push(permission);
  }
  return groups;
}

export function defaultPermissions(role, catalog) {
  if (role === 'admin') return new Set((catalog?.permissions ?? []).map(permission => permission.id));
  return new Set((catalog?.rolePermissions?.[role] ?? []).filter(id => !ADMIN_ONLY_PERMISSIONS.includes(id)));
}

// Permissões efetivas = padrão do perfil + concedidas − retiradas (mesma conta do servidor).
export function effectivePermissionSet(role, grants, revokes, catalog) {
  const known = new Set((catalog?.permissions ?? []).map(permission => permission.id));
  const set = defaultPermissions(role, catalog);
  if (role === 'admin') return set;
  for (const id of grants ?? []) if (known.has(id) && !ADMIN_ONLY_PERMISSIONS.includes(id)) set.add(id);
  for (const id of revokes ?? []) set.delete(id);
  return set;
}

// Transforma a lista marcada na tela em { grants, revokes } em relação ao perfil.
export function diffAgainstRole(role, checked, catalog) {
  if (role === 'admin') return { grants: [], revokes: [] };
  const defaults = defaultPermissions(role, catalog), marked = new Set(checked);
  return {
    grants: (catalog?.permissions ?? []).map(permission => permission.id).filter(id => marked.has(id) && !defaults.has(id) && !ADMIN_ONLY_PERMISSIONS.includes(id)),
    revokes: (catalog?.permissions ?? []).map(permission => permission.id).filter(id => defaults.has(id) && !marked.has(id))
  };
}

// Estado de cada caixa de seleção do editor de permissões: marcada? desabilitada? por quê?
export function permissionStates({ actor, role, catalog, checked, existingGrants = [] }) {
  const defaults = defaultPermissions(role, catalog), marked = new Set(checked), result = new Map();
  for (const permission of catalog?.permissions ?? []) {
    const id = permission.id, on = role === 'admin' || (!ADMIN_ONLY_PERMISSIONS.includes(permission.id) && marked.has(id));
    let disabled = false, note = '';
    if (role === 'admin') { disabled = true; note = 'O Administrador TI tem acesso total.'; }
    else if (ADMIN_ONLY_PERMISSIONS.includes(id)) { disabled = true; note = 'Exclusivo do Administrador TI.'; }
    // O servidor só aceita esta permissão no padrão dos perfis Editor e Gestor (pode ser retirada de uma pessoa, não concedida ao Visualizador).
    else if (id === 'screen:pair' && !defaults.has(id)) { disabled = true; note = 'Disponível para os perfis Editor e Gestor.'; }
    else if (!on && actor.role !== 'admin') {
      // Quem não é Administrador só liga (concede) o que o próprio perfil possui e não é indelegável.
      const mayTurnOn = defaults.has(id) || existingGrants.includes(id) || (!permission.nonDelegable && hasPermission(actor, id));
      if (!mayTurnOn) { disabled = true; note = permission.nonDelegable ? 'Somente o Administrador TI concede esta permissão.' : 'Você não pode conceder uma permissão que não possui.'; }
    }
    result.set(id, { checked: on, disabled, note, origin: on ? (defaults.has(id) ? 'role' : 'grant') : (defaults.has(id) ? 'revoke' : 'none') });
  }
  return result;
}
