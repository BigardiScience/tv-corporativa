// Rotas do painel por "hash" (#/biblioteca/ID?q=...). O servidor entrega somente /index.html e arquivos estáticos,
// então o hash é o jeito de ter endereços que sobrevivem a recarregar a página e funcionam com os botões Voltar/Avançar.
// Este módulo só converte texto em rota e rota em texto (sem tocar no DOM), por isso é testável no Node.
import { hasPermission } from './permissions.js';

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export const ROUTES = Object.freeze([
  { name: 'overview', segments: [], title: 'Visão geral' },
  { name: 'units', segments: ['unidades'], title: 'Unidades' },
  { name: 'library', segments: ['biblioteca'], param: 'folderId', optional: true, title: 'Biblioteca' },
  { name: 'playlist', segments: ['playlists'], param: 'id', title: 'Editor de playlist' },
  { name: 'playlists', segments: ['playlists'], title: 'Playlists' },
  { name: 'schedules', segments: ['programacoes'], title: 'Programações' },
  { name: 'displays', segments: ['telas'], title: 'Telas' },
  { name: 'users', segments: ['usuarios'], title: 'Usuários e permissões' },
  { name: 'audit', segments: ['auditoria'], title: 'Auditoria' },
  { name: 'settings', segments: ['configuracoes'], title: 'Configurações' }
]);

// Permissão exigida para abrir cada tela (a interface esconde o que a pessoa não pode usar; o servidor continua decidindo).
export const ROUTE_PERMISSION = Object.freeze({ users: 'user:manage', audit: 'audit:read' });

export function parseHash(hash) {
  const raw = String(hash ?? '');
  if (raw === '' || raw === '#' || raw === '#/') return { name: 'overview', params: {}, query: {} };
  if (!raw.startsWith('#/')) return { name: 'notfound', params: {}, query: {} };
  const [pathText, queryText = ''] = raw.slice(1).split('?');
  const parts = pathText.split('/').filter(Boolean).map(part => { try { return decodeURIComponent(part); } catch { return null; } });
  if (parts.includes(null)) return { name: 'notfound', params: {}, query: {} };
  const query = Object.fromEntries(new URLSearchParams(queryText));
  for (const route of ROUTES) {
    const expected = route.segments.length;
    if (parts.length < expected || parts.slice(0, expected).some((part, index) => part !== route.segments[index])) continue;
    const rest = parts.slice(expected);
    if (route.param) {
      if (rest.length === 0 && route.optional) return { name: route.name, params: {}, query };
      if (rest.length === 1 && ID.test(rest[0])) return { name: route.name, params: { [route.param]: rest[0] }, query };
      continue;
    }
    if (rest.length === 0) return { name: route.name, params: {}, query };
  }
  return { name: 'notfound', params: {}, query: {} };
}

export function buildHash(name, params = {}, query = {}) {
  const route = ROUTES.find(item => item.name === name);
  if (!route) throw new Error(`Rota desconhecida: ${name}`);
  const parts = [...route.segments];
  if (route.param && params[route.param]) {
    if (!ID.test(params[route.param])) throw new Error('Identificador inválido na rota.');
    parts.push(params[route.param]);
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  const text = search.toString();
  return `#/${parts.map(encodeURIComponent).join('/')}${text ? `?${text}` : ''}`;
}

export const routeTitle = name => ROUTES.find(route => route.name === name)?.title ?? 'Página não encontrada';

export function routeAllowed(user, name) {
  const permission = ROUTE_PERMISSION[name];
  return !permission || hasPermission(user, permission);
}
