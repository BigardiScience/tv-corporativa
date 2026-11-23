// Regras de apoio da tela de Usuários (sem DOM): validação do formulário, gerador de senha, filtros e resumos.
// O servidor valida e autoriza de novo (perfil, escopo, escalada de privilégio, último administrador); aqui se evita
// o vai-e-volta e se explica o problema logo.
import { fold } from './format.js';
import { ROLE_LABELS } from './permissions.js';

export const PASSWORD_MIN = 12, PASSWORD_MAX = 128;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- senha -----------------------------------------------------------------------------------------------------------------

// Inteiro uniforme em [0, max) pelo gerador criptográfico do navegador (sem viés de "módulo"). Math.random NUNCA é usado.
export function secureInt(max, cryptoApi = globalThis.crypto) {
  if (!Number.isInteger(max) || max < 1 || max > 0x100000000) throw new RangeError('Intervalo inválido.');
  if (typeof cryptoApi?.getRandomValues !== 'function') throw new Error('Este navegador não oferece um gerador seguro de números aleatórios.');
  const limit = Math.floor(0x100000000 / max) * max, buffer = new Uint32Array(1);
  do { cryptoApi.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % max;
}

// Sem caracteres que se confundem na leitura (0/O, 1/l/I). Pelo menos um de cada grupo, depois embaralhado.
const GROUPS = ['abcdefghijkmnpqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!#$%&*+-=?@'];

export function generatePassword({ length = 16, randomInt = secureInt } = {}) {
  const size = Math.min(Math.max(Math.trunc(length) || 16, PASSWORD_MIN), PASSWORD_MAX);
  const everything = GROUPS.join('');
  const chars = GROUPS.map(group => group[randomInt(group.length)]);
  while (chars.length < size) chars.push(everything[randomInt(everything.length)]);
  for (let index = chars.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [chars[index], chars[other]] = [chars[other], chars[index]];
  }
  return chars.join('');
}

export function validatePasswordValue(password) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) return [`A senha deve ter entre ${PASSWORD_MIN} e ${PASSWORD_MAX} caracteres.`];
  return [];
}

// Tamanho primeiro; só depois a confirmação (assim o aviso não vem empilhado com outro).
export function validatePasswordPair(password, confirmation) {
  const problems = validatePasswordValue(password);
  if (problems.length) return problems;
  return String(confirmation ?? '') === String(password) ? [] : ['As senhas não coincidem.'];
}

// ---- formulário ------------------------------------------------------------------------------------------------------------

// mode: 'create' | 'edit'.  assignable: perfis que a pessoa logada pode atribuir.
export function validateUserForm({ mode, name, email, password, confirmPassword, role, unitIds = [], sectorIds = [] }, { assignable = [] } = {}) {
  const problems = [];
  const title = String(name ?? '').trim();
  if (!title) problems.push('Informe o nome da pessoa.');
  else if (title.length > 120) problems.push('O nome pode ter até 120 caracteres.');
  if (mode === 'create') {
    const address = String(email ?? '').trim();
    if (!address) problems.push('Informe o e-mail.');
    else if (address.length > 254 || !EMAIL.test(address)) problems.push('Informe um e-mail válido.');
    problems.push(...validatePasswordPair(password, confirmPassword));
  }
  if (!role || !assignable.includes(role)) problems.push('Escolha um perfil que você possa atribuir.');
  else if (role !== 'admin' && (!unitIds.length || !sectorIds.length)) problems.push('Escolha ao menos uma unidade e um setor.');
  return problems;
}

// ---- lista -----------------------------------------------------------------------------------------------------------------


// status: '' | 'active' | 'inactive'
export function filterUsers(users, { q = '', role = '', status = '' } = {}) {
  const needle = fold(q).trim();
  return users.filter(user => {
    if (role && user.role !== role) return false;
    if (status === 'active' && user.active === false) return false;
    if (status === 'inactive' && user.active !== false) return false;
    return !needle || fold(`${user.name} ${user.email}`).includes(needle);
  });
}

export const roleLabel = role => ROLE_LABELS[role] ?? String(role ?? '');

// Quantas permissões a pessoa tem a mais ou a menos do que o padrão do perfil.
export const customizationCount = user => (user.role === 'admin' ? 0 : (user.grants?.length ?? 0) + (user.revokes?.length ?? 0));

// Texto curto das unidades e dos setores de uma pessoa. Administrador: tudo.
export function accessSummary(user, { unitName = id => id, sectorName = id => id } = {}) {
  if (user.role === 'admin') return { units: ['Todas as unidades'], sectors: ['Todos os setores'] };
  return { units: (user.unitIds ?? []).map(unitName), sectors: (user.sectorIds ?? []).map(sectorName) };
}

// Só interface: administrar contas e redefinir senhas são funções exclusivas da TI.
export function userActions(actor, target) {
  const isAdmin = actor?.role === 'admin' && actor.active !== false;
  return {
    edit: isAdmin,
    resetPassword: isAdmin,
    self: actor?.id === target.id
  };
}
