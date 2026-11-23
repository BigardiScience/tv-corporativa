// Cliente da API do painel.
//  - Envia o token CSRF em toda requisição que altera dados (o cookie de sessão é HttpOnly e viaja sozinho).
//  - Trata 401 em um único lugar: quem criou o cliente decide o que fazer (voltar ao login, limpar a tela).
//  - Traduz falhas de rede e tempo esgotado em mensagens claras, sem vazar detalhes técnicos.
//  - Funciona no navegador e no Node (fetch e XMLHttpRequest são injetáveis), o que permite testar sem simular regras de negócio.

export class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const isAbort = error => error?.name === 'AbortError';
export const abortError = (message = 'Operação cancelada.') => Object.assign(new Error(message), { name: 'AbortError' });

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const WITH_BODY = new Set(['POST', 'PATCH', 'PUT']);
const NETWORK_MESSAGE = 'Não foi possível conectar ao servidor. Verifique a rede e tente novamente.';
const TIMEOUT_MESSAGE = 'O servidor demorou para responder. Tente novamente em instantes.';
const EXPIRED_MESSAGE = 'Sua sessão expirou. Entre novamente.';

export function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    params.set(key, value === true ? '1' : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function linkSignals(signals) {
  const list = signals.filter(Boolean);
  if (list.length <= 1) return list[0];
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list);
  const controller = new AbortController();
  for (const signal of list) {
    if (signal.aborted) { controller.abort(); break; }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export function createApi({
  fetchImpl = (...args) => globalThis.fetch(...args),
  xhrFactory = () => new globalThis.XMLHttpRequest(),
  getCsrf = () => '',
  onUnauthorized = () => {},
  timeoutMs = 30000
} = {}) {
  function unauthorized(error) {
    try { onUnauthorized(error); } catch { /* a reação à sessão expirada nunca pode esconder o erro original */ }
  }

  async function parse(response) {
    const type = response.headers?.get?.('content-type') ?? '';
    if (response.status === 204 || !type.includes('json')) return {};
    try { return await response.json(); } catch { return {}; }
  }

  async function request(method, path, { query, body, signal, public: isPublic = false, timeout = timeoutMs } = {}) {
    const headers = { Accept: 'application/json' };
    let payload;
    if (body !== undefined || WITH_BODY.has(method)) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body ?? {}); }
    if (MUTATING.has(method)) { const csrf = getCsrf(); if (csrf) headers['X-CSRF-Token'] = csrf; }
    const timer = typeof AbortSignal.timeout === 'function' && timeout ? AbortSignal.timeout(timeout) : undefined;
    let response;
    try {
      response = await fetchImpl(`${path}${buildQuery(query)}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal: linkSignals([signal, timer]) });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (error?.name === 'TimeoutError' || timer?.aborted) throw new ApiError(0, TIMEOUT_MESSAGE, { code: 'TIMEOUT' });
      throw new ApiError(0, NETWORK_MESSAGE, { code: 'NETWORK' });
    }
    const data = await parse(response);
    if (response.ok) return data;
    const message = typeof data?.error === 'string' && data.error ? data.error : `Não foi possível concluir (código ${response.status}).`;
    const error = new ApiError(response.status, response.status === 401 && !data?.error ? EXPIRED_MESSAGE : message, { code: data?.code, details: data?.details });
    if (response.status === 401 && !isPublic) unauthorized(error);
    throw error;
  }

  // Envio de arquivo com progresso (fetch não informa o andamento do envio). O corpo é o próprio arquivo, sem carregar tudo em memória.
  function upload(path, { query, file, contentType, onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = xhrFactory();
      xhr.open('POST', `${path}${buildQuery(query)}`);
      xhr.responseType = 'text';
      xhr.timeout = 10 * 60 * 1000;
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json');
      if (contentType) xhr.setRequestHeader('Content-Type', contentType);
      const csrf = getCsrf();
      if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
      let settled = false;
      const finish = (action, value) => { if (settled) return; settled = true; signal?.removeEventListener?.('abort', onAbort); action(value); };
      const onAbort = () => { xhr.abort(); };
      if (signal) {
        if (signal.aborted) { finish(reject, abortError('Envio cancelado.')); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (xhr.upload && onProgress) xhr.upload.onprogress = event => { if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total)); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch { data = {}; }
        if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(1); finish(resolve, data); return; }
        const error = new ApiError(xhr.status, typeof data?.error === 'string' && data.error ? data.error : `Falha no envio (código ${xhr.status}).`, { code: data?.code, details: data?.details });
        if (xhr.status === 401) unauthorized(error);
        finish(reject, error);
      };
      xhr.onerror = () => finish(reject, new ApiError(0, NETWORK_MESSAGE, { code: 'NETWORK' }));
      xhr.ontimeout = () => finish(reject, new ApiError(0, TIMEOUT_MESSAGE, { code: 'TIMEOUT' }));
      xhr.onabort = () => finish(reject, abortError('Envio cancelado.'));
      xhr.send(file);
    });
  }

  return {
    request, upload,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options)
  };
}
