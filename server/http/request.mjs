import { fail } from '../lib/errors.mjs';

export function parseRequestUrl(req, origin) {
  const raw = req.url ?? '';
  if (!raw.startsWith('/') || raw.startsWith('//')) fail(400, 'Endereço inválido.');
  try {
    const url = new URL(raw, origin);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0')) fail(400, 'Endereço inválido.');
    return { url, pathname };
  } catch (error) {
    if (error.status) throw error;
    return fail(400, 'Endereço inválido.');
  }
}

const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

// Requisição que de fato nasceu no próprio servidor (sem passar por proxy reverso).
export const isLocalRequest = req => isLoopback(req.socket?.remoteAddress)
  && !req.headers['x-forwarded-for'] && !req.headers.forwarded && !req.headers['x-real-ip'];

// Endereço do cliente para limites de tentativas e registros.
// Com TRUST_PROXY=N, o cliente é o N-ésimo endereço contado da DIREITA em X-Forwarded-For;
// o que estiver à esquerda pode ter sido forjado e é ignorado. Sem proxy confiável, usa o endereço da conexão.
export function clientIp(req, trustProxy = 0) {
  const direct = req.socket?.remoteAddress ?? 'unknown';
  if (!trustProxy) return direct;
  const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map(part => part.trim()).filter(Boolean);
  if (!chain.length) return direct;
  const candidate = chain[Math.max(0, chain.length - trustProxy)];
  return /^[0-9a-fA-F:.]{2,64}$/.test(candidate) ? candidate : direct;
}

export function cookieValue(req, name) {
  const prefix = `${name}=`;
  const found = (req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

export async function readBody(req, max = 64 * 1024) {
  if (Number(req.headers['content-length']) > max) fail(413, 'Arquivo ou requisição excede o limite permitido.');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) fail(413, 'Arquivo ou requisição excede o limite permitido.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) fail(415, 'Envie JSON.');
  let value;
  try { value = JSON.parse((await readBody(req)).toString('utf8')); } catch (error) {
    if (error.status) throw error;
    fail(400, 'JSON inválido.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Envie um objeto JSON válido.');
  return value;
}
