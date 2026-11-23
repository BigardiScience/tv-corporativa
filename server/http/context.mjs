import { clientIp, readBody, readJson } from './request.mjs';
import { sendJson } from './responses.mjs';

// Objeto entregue a cada tratador de rota: tudo o que a rota precisa, sem expor req/res crus por todo lado.
export function createContext({ req, res, url, pathname, params, config }) {
  return {
    req, res, url, pathname, params,
    query: Object.fromEntries(url.searchParams),
    ip: clientIp(req, config.trustProxy),
    user: null, session: null, device: null,
    body: () => readJson(req),
    // Para ações que não precisam de corpo (ou o aceitam opcional): sem JSON, devolve objeto vazio.
    optionalBody: async () => ((req.headers['content-type'] ?? '').startsWith('application/json') ? readJson(req) : {}),
    raw: max => readBody(req, max),
    json: (status, body) => sendJson(res, status, body),
    setCookie: value => res.setHeader('Set-Cookie', value)
  };
}
