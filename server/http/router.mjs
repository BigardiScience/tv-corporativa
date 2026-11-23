// Roteador mínimo: associa método + caminho a um tratador e à regra de autenticação da rota.
//   auth: 'session' (padrão) | 'device' | 'device-or-session' | 'none'
export function createRouter() {
  const routes = [];

  function compile(pattern) {
    const names = [];
    const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, name) => { names.push(name); return '([^/]+)'; });
    return { regex: new RegExp(`^${source}$`), names };
  }

  function add(method, pattern, handler, options = {}) {
    routes.push({ method, pattern, ...compile(pattern), handler, options: { auth: 'session', ...options } });
  }

  function match(method, pathname) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(pathname);
      if (found) return { handler: route.handler, options: route.options, params: Object.fromEntries(route.names.map((name, index) => [name, found[index + 1]])), pattern: route.pattern };
    }
    return null;
  }

  return {
    add, match,
    get: (pattern, handler, options) => add('GET', pattern, handler, options),
    post: (pattern, handler, options) => add('POST', pattern, handler, options),
    put: (pattern, handler, options) => add('PUT', pattern, handler, options),
    patch: (pattern, handler, options) => add('PATCH', pattern, handler, options),
    delete: (pattern, handler, options) => add('DELETE', pattern, handler, options),
    list: () => routes.map(({ method, pattern, options }) => ({ method, pattern, auth: options.auth }))
  };
}
