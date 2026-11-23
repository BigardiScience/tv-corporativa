import { fail } from '../lib/errors.mjs';

export const ROLES = ['admin', 'manager', 'editor', 'viewer'];

// Catálogo de permissões granulares. Cada uma é avaliada NO SERVIDOR, sempre junto com a unidade e o setor
// do recurso. Esconder um botão na interface nunca é a proteção: é só conveniência.
export const PERMISSIONS = Object.freeze({
  'folder:create':     { group: 'Biblioteca', label: 'Criar pastas' },
  'folder:update':     { group: 'Biblioteca', label: 'Renomear e mover pastas' },
  'folder:delete':     { group: 'Biblioteca', label: 'Excluir pastas' },
  'media:upload':      { group: 'Biblioteca', label: 'Enviar arquivos' },
  'media:update':      { group: 'Biblioteca', label: 'Renomear e mover arquivos' },
  'media:delete':      { group: 'Biblioteca', label: 'Excluir arquivos' },
  'media:approve':     { group: 'Biblioteca', label: 'Aprovar ou rejeitar arquivos' },
  'playlist:create':   { group: 'Playlists', label: 'Criar playlists' },
  'playlist:update':   { group: 'Playlists', label: 'Editar playlists (rascunho)' },
  'playlist:delete':   { group: 'Playlists', label: 'Excluir playlists' },
  'playlist:publish':  { group: 'Playlists', label: 'Publicar versões de playlist' },
  'schedule:create':   { group: 'Programações', label: 'Criar programações (rascunho)' },
  'schedule:publish':  { group: 'Programações', label: 'Publicar, alterar e interromper programações' },
  'screen:create':     { group: 'Telas', label: 'Cadastrar telas' },
  'screen:activate':   { group: 'Telas', label: 'Ativar telas e renovar o pareamento (desconecta a TV)' },
  'screen:pair':       { group: 'Telas', label: 'Gerar código de pareamento de TVs já cadastradas' },
  'screen:update':     { group: 'Telas', label: 'Renomear telas' },
  'screen:delete':     { group: 'Telas', label: 'Revogar e remover telas' },
  'user:manage':       { group: 'Administração', label: 'Gerenciar usuários' },
  'audit:read':        { group: 'Administração', label: 'Consultar a auditoria' },
  'settings:manage':   { group: 'Administração', label: 'Configurações globais (unidades e setores)' }
});
export const PERMISSION_IDS = Object.freeze(Object.keys(PERMISSIONS));
export const ADMIN_RESERVED = Object.freeze(['screen:create','screen:activate','screen:update','screen:delete','user:manage','settings:manage']);

// Padrão de cada perfil. Pessoas específicas podem receber (grants) ou perder (revokes) permissões.
// O Editor programa e publica nas TVs que a TI liberou a ele (schedule:*), mas não aprova arquivos nem publica versões de playlist.
// Quem só deve preparar rascunhos recebe a retirada individual de schedule:publish.
export const ROLE_PERMISSIONS = Object.freeze({
  admin: PERMISSION_IDS,
  manager: [
    'folder:create', 'folder:update', 'folder:delete', 'media:upload', 'media:update', 'media:delete', 'media:approve',
    'playlist:create', 'playlist:update', 'playlist:delete', 'playlist:publish', 'schedule:create', 'schedule:publish',
    'screen:pair', 'audit:read'
  ],
  editor: ['folder:create', 'folder:update', 'media:upload', 'media:update', 'playlist:create', 'playlist:update', 'schedule:create', 'schedule:publish', 'screen:pair'],
  viewer: []
});

// Um Gestor nunca delega estas permissões (evita criar "gestores" por baixo dos panos).
export const NON_DELEGABLE = Object.freeze([...ADMIN_RESERVED, 'audit:read']);

// Somente o Administrador cria ou altera contas, independentemente de concessões antigas.
export const MANAGEABLE_ROLES = Object.freeze({ admin: ROLES });

export function effectivePermissions(user) {
  if (!user || user.active === false) return new Set();
  if (user.role === 'admin') return new Set(PERMISSION_IDS);
  const set = new Set(ROLE_PERMISSIONS[user.role] ?? []);
  for (const id of user.grants ?? []) if (PERMISSIONS[id] && !ADMIN_RESERVED.includes(id)) set.add(id);
  for (const id of user.revokes ?? []) set.delete(id);
  return set;
}

export const hasPermission = (user, permission) => effectivePermissions(user).has(permission);

// Administrador tem alcance global. Os demais precisam ter a unidade E o setor do recurso em suas listas.
export function inScope(user, target) {
  if (!user || user.active === false) return false;
  if (user.role === 'admin') return true;
  return (user.unitIds ?? []).includes(target.unitId) && (user.sectorIds ?? []).includes(target.sectorId);
}

export function requireScope(user, target) {
  if (!target) fail(404, 'Registro não encontrado.');
  if (!inScope(user, target)) fail(403, 'Acesso não permitido a esta unidade e setor.', 'SCOPE_DENIED');
  return target;
}

// Ponto único de autorização: permissão E escopo. `target` = { unitId, sectorId }.
export function authorize(user, permission, target) {
  if (!user || user.active === false) fail(401, 'Entre com sua conta para continuar.');
  if (permission && !hasPermission(user, permission)) fail(403, 'Seu perfil não permite esta ação.', 'PERMISSION_DENIED');
  if (target) requireScope(user, target);
}

export function validatePermissionList(value, { what = 'permissões' } = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > PERMISSION_IDS.length || value.some(id => !PERMISSIONS[id])) fail(400, `Lista de ${what} inválida.`);
  return [...new Set(value)];
}
