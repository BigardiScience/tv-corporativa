import { Readable, Writable } from 'node:stream';
import { deflateSync } from 'node:zlib';
import { JPEG, buildMov, jpegWith } from './media-files.mjs';

// Resposta simulada: um Writable de verdade (aceita pipeline/streams), com a parte de cabeçalhos do ServerResponse.
class FakeResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200; this.headersSent = false; this.chunks = []; this.headers = new Map();
  }
  setHeader(key, value) { this.headers.set(key.toLowerCase(), value); }
  getHeader(key) { return this.headers.get(key.toLowerCase()); }
  removeHeader(key) { this.headers.delete(key.toLowerCase()); }
  _write(chunk, encoding, callback) { this.headersSent = true; this.chunks.push(Buffer.from(chunk)); callback(); }
  end(...args) { this.headersSent = true; return super.end(...args); }
}

// Executa o tratador HTTP real do servidor com streams, sem abrir portas.
export async function inProcess(app, route, { method = 'GET', headers = {}, body, remoteAddress = '127.0.0.1' } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]);
  Object.assign(req, {
    url: route, method,
    headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    socket: { remoteAddress }
  });
  const res = new FakeResponse();
  const finished = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('A requisição não terminou a resposta.')), 10000);
    res.once('finish', () => { clearTimeout(timer); resolve(); });
    res.once('error', error => { clearTimeout(timer); reject(error); });
  });
  await app.server.listeners('request')[0](req, res);
  await finished;
  return { bytes: Buffer.concat(res.chunks), status: res.statusCode, headers: res.headers };
}

// Cliente de API para os testes: cuida de cookie, CSRF e JSON.
export function apiClient(app, defaults = {}) {
  async function call(route, { method = 'GET', body, session, token, headers = {}, remoteAddress } = {}) {
    const requestHeaders = { ...headers };
    if (session) { requestHeaders.Cookie = session.cookie; requestHeaders['X-CSRF-Token'] = session.csrf; }
    if (token) requestHeaders.Authorization = `Bearer ${token}`;
    let payload;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) payload = body;
      else { payload = JSON.stringify(body); requestHeaders['Content-Type'] = 'application/json'; }
    }
    const result = await inProcess(app, route, { method, headers: requestHeaders, body: payload, remoteAddress: remoteAddress ?? defaults.remoteAddress });
    let data;
    try { data = JSON.parse(result.bytes.toString()); } catch { data = result.bytes; }
    const setCookie = result.headers.get('set-cookie');
    // `data` tenta interpretar JSON (até um arquivo cujo conteúdo seja "6789" vira número); `bytes` é sempre o corpo bruto.
    return { status: result.status, data, bytes: result.bytes, headers: result.headers, setCookie, cookie: setCookie?.split(';')[0] };
  }
  async function login(email, password, { remoteAddress } = {}) {
    const response = await call('/api/login', { method: 'POST', body: { email, password }, remoteAddress });
    return { ...response, session: response.status === 200 ? { cookie: response.cookie, csrf: response.data.csrf } : null };
  }
  return { call, login };
}

// Mesmo contrato do `apiClient`, mas por HTTP de verdade (soquete local + fetch): cobre cabeçalhos, cookies e corpo em fluxo.
// `remoteAddress` (opcional) vai no cabeçalho X-Forwarded-For: só tem efeito se o servidor de teste foi iniciado com `trustProxy: 1`.
// Assim cada entrada preparatória parte de um endereço fictício próprio e não consome o limite de tentativas de login.
export function httpClient(base) {
  async function call(route, { method = 'GET', body, session, token, headers = {}, remoteAddress } = {}) {
    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(15000) };
    if (remoteAddress) init.headers['X-Forwarded-For'] = remoteAddress;
    if (session) { init.headers.Cookie = session.cookie; init.headers['X-CSRF-Token'] = session.csrf; }
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) init.body = body;
      else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    }
    const response = await fetch(base + route, init);
    const bytes = Buffer.from(await response.arrayBuffer());
    const received = new Map([...response.headers].map(([key, value]) => [key.toLowerCase(), value]));
    let data;
    try { data = JSON.parse(bytes.toString()); } catch { data = bytes; }
    const setCookie = response.headers.get('set-cookie') ?? undefined;
    return { status: response.status, data, bytes, headers: received, setCookie, cookie: setCookie?.split(';')[0] };
  }
  async function login(email, password, { remoteAddress } = {}) {
    const response = await call('/api/login', { method: 'POST', body: { email, password }, remoteAddress });
    return { ...response, session: response.status === 200 ? { cookie: response.cookie, csrf: response.data.csrf } : null };
  }
  return { call, login };
}

// PNG 1x1 válido (assinatura + IHDR + IDAT + IEND).
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fS8AAAAASUVORK5CYII=', 'base64');

// PNGs distintos (mesma imagem com um bloco ancilar diferente), para testes que precisam de conteúdos não duplicados.
export function uniquePng(seed) {
  const text = Buffer.from(String(seed));
  const length = Buffer.alloc(4); length.writeUInt32BE(text.length);
  const chunk = Buffer.concat([length, Buffer.from('tEXt'), text, Buffer.alloc(4)]);
  const iend = PNG.length - 12;
  return Buffer.concat([PNG.subarray(0, iend), chunk, PNG.subarray(iend)]);
}

// Arquivos mínimos com a assinatura correta de cada formato aceito (o servidor confere o conteúdo, não só a extensão).
// JPEG e MOV são conferidos por inteiro no envio: o JPEG é uma imagem de verdade e o MOV tem a estrutura completa (ver media-files.mjs).
export const SAMPLE_FILES = Object.freeze({
  '.png': PNG,
  '.jpg': JPEG,
  '.webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 teste')]),
  '.pdf': Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  '.mp4': Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32, 7)]),
  '.mov': buildMov(),
  '.webm': Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32, 9)])
});

// Variação do arquivo de exemplo (conteúdo distinto → hash distinto) preservando a assinatura.
export function sampleFile(extension, seed = '') {
  const base = SAMPLE_FILES[extension];
  if (extension === '.png') return uniquePng(seed || 'x');
  if (extension === '.jpg' || extension === '.jpeg') return jpegWith(seed); // comentário dentro do JPEG: continua sendo uma imagem completa
  if (extension === '.mov') return buildMov({ seed }); // átomo "free" ao final: continua coberto exatamente pelos blocos do arquivo
  return Buffer.concat([base, Buffer.from(String(seed))]);
}

// PNG de verdade (o navegador consegue desenhar) com uma cor sólida, para testes de tela com miniaturas e prévias visíveis.
// `seed` entra num bloco de texto do PNG: mesma cor com `seed` diferente = arquivo diferente (sem acusar duplicidade).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
export function solidPng({ width = 320, height = 180, color = [249, 114, 25], seed = '' } = {}) {
  return encodePng(width, height, () => color, seed);
}

// PNG de listras verticais (cada listra tem `stripe` pixels de largura, alternando as duas cores). Serve para MEDIR desfoque na tela:
// uma imagem de cor sólida não muda ao ser desfocada, mas listras finas viram uma cor lisa.
export function stripedPng({ width = 960, height = 540, stripe = 20, colors = [[255, 255, 255], [20, 28, 48]], seed = '' } = {}) {
  return encodePng(width, height, x => colors[Math.floor(x / stripe) % colors.length], seed);
}

function encodePng(width, height, colorAt, seed) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(colorAt(x), 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header), pngChunk('tEXt', Buffer.from(`seed\0${seed}`)), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))
  ]);
}
