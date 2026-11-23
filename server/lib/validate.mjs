import { fail } from './errors.mjs';

export const nowIso = () => new Date().toISOString();

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'A senha deve ter entre 12 e 128 caracteres.');
  return value;
}

export function label(value, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `Informe um texto válido de até ${max} caracteres.`);
  return value.trim();
}

export function email(value) {
  const result = label(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'Informe um e-mail válido.');
  return result;
}

export function parseTime(value) {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(400, 'Data e hora inválidas.');
  return new Date(value).toISOString();
}

export function integer(value, min, max, message) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number) || number < min || number > max) fail(400, message ?? `Informe um número inteiro entre ${min} e ${max}.`);
  return number;
}

export function oneOf(value, allowed, message) {
  if (!allowed.includes(value)) fail(400, message ?? 'Valor inválido.');
  return value;
}

export function idList(value, { max = 200, message = 'Lista de identificadores inválida.' } = {}) {
  if (!Array.isArray(value) || value.length > max || value.some(id => typeof id !== 'string' || !id || id.length > 80)) fail(400, message);
  return [...new Set(value)];
}

// Identificadores são UUID gerados pelo servidor, mas unidades e setores pré-cadastrados usam slugs.
export const isSafeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);

export function safeId(value, message = 'Identificador inválido.') {
  if (!isSafeId(value)) fail(400, message);
  return value;
}

// Chave de busca/unicidade: minúsculas, sem acentos e com espaços normalizados.
export const searchKey = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();

const FORBIDDEN_NAME_CHARS = /[\\/\u0000-\u001f\u007f]/;

// Nome de pasta ou título de arquivo na biblioteca: texto livre e legível, sem barras (caminho) nem caracteres de controle.
export function itemName(value, { max = 120, what = 'nome' } = {}) {
  if (typeof value !== 'string') fail(400, `Informe um ${what} válido.`);
  const result = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!result || result.length > max) fail(400, `O ${what} deve ter de 1 a ${max} caracteres.`);
  if (FORBIDDEN_NAME_CHARS.test(result)) fail(400, `O ${what} não pode conter barras (/ ou \\) nem caracteres de controle.`);
  if (result === '.' || result === '..') fail(400, `Escolha outro ${what}.`);
  return result;
}
