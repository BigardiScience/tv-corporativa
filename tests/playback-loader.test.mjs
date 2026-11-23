// Fase 2 — como os arquivos chegam à tela: endereços aceitos, credencial, prazos, arquivo incompleto, erros e cache em memória.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDIA_PATH, LOAD_LIMITS, mediaPath, classifyStatus, downloadBlob, createTvSource, createDirectSource } from '../public/js/playback/loader.js';
import { createBlobCache } from '../public/js/playback/media-cache.js';

const fast = { ...LOAD_LIMITS, headersMs: 60, idleMs: 60, bodyMinMs: 80, bodyMaxMs: 80 };
const bytes = (size, fill = 7) => new Uint8Array(size).fill(fill);
const answer = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });
const withLength = (data, extra = {}) => answer(data, { headers: { 'content-length': String(data.byteLength), ...extra } });
const kind = error => ['transient', 'permanent', 'auth'].filter(name => error[name]).join('+') || 'nenhum';

// ---- endereços ------------------------------------------------------------------------------------------------------------------
test('endereços: só o caminho local /api/media/<id>/file é aceito (a credencial nunca sai do servidor da própria TV)', () => {
  assert.equal(mediaPath('/api/media/m_1/file'), '/api/media/m_1/file');
  assert.equal(mediaPath('/api/media/0f3c-aa/file'), '/api/media/0f3c-aa/file');
  for (const bad of [
    'https://evil.example/steal', '//evil.example/api/media/x/file', 'http://localhost/api/media/x/file',
    '/api/media/x/file?token=1', '/api/media/x/file#a', '/api/media/x/other', '/api/media//file', '/api/media/a/b/file',
    '/api/displays/x', '../api/media/x/file', 'api/media/x/file', '', null, undefined, 42, {}
  ]) {
    assert.throws(() => mediaPath(bad), error => error.permanent === true && error.code === 'bad-url', String(bad));
  }
  assert.ok(MEDIA_PATH.test('/api/media/abc/file'));
});

test('estados HTTP: acesso revogado, arquivo inexistente e falhas do servidor são tratados de formas diferentes', () => {
  assert.deepEqual([401, 403].map(status => kind(classifyStatus(status))), ['permanent+auth', 'permanent+auth']);
  assert.deepEqual([404, 410, 400, 415, 416].map(status => kind(classifyStatus(status))), Array(5).fill('permanent'));
  assert.deepEqual([408, 425, 429, 500, 502, 503, 504].map(status => kind(classifyStatus(status))), Array(7).fill('transient'));
  assert.equal(kind(classifyStatus(302)), 'transient');
});

// ---- download --------------------------------------------------------------------------------------------------------------------
test('download: pequeno chega pedaço a pedaço, com o tipo do conteúdo, e só pede o caminho informado', async () => {
  const seen = [];
  const request = async (path, options) => { seen.push([path, options.signal instanceof AbortSignal]); return withLength(bytes(4096)); };
  const blob = await downloadBlob(request, '/api/media/a/file', { limits: fast, mime: 'image/png' });
  assert.equal(blob.size, 4096);
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(seen, [['/api/media/a/file', true]]);
});

test('download: o tipo informado pelo servidor é respeitado; sem tipo (ou genérico), vale o do conteúdo', async () => {
  const served = await downloadBlob(async () => withLength(bytes(10), { 'content-type': 'image/webp' }), '/api/media/a/file', { limits: fast, mime: 'image/webp' });
  assert.equal(served.type, 'image/webp');
  const generic = await downloadBlob(async () => withLength(bytes(10), { 'content-type': 'application/octet-stream' }), '/api/media/a/file', { limits: fast, mime: 'video/mp4' });
  assert.equal(generic.type, 'video/mp4');
});

test('download: arquivo grande (ou sem tamanho declarado) é montado pelo navegador, e o tamanho é conferido', async () => {
  const big = { ...fast, streamMaxBytes: 1000, bodyMinMs: 500, bodyMaxMs: 500 };
  const blob = await downloadBlob(async () => withLength(bytes(5000)), '/api/media/a/file', { limits: big, mime: 'video/mp4' });
  assert.equal(blob.size, 5000);
  assert.equal(blob.type, 'video/mp4');
  const unknownSize = await downloadBlob(async () => answer(bytes(300)), '/api/media/a/file', { limits: { ...fast, bodyMaxMs: 500 }, mime: 'image/png' });
  assert.equal(unknownSize.size, 300);
});

test('download: arquivo que chega pela metade é recusado (e a TV tenta de novo), nunca exibido cortado', async () => {
  const truncated = async () => answer(bytes(1000), { headers: { 'content-length': '2000' } });
  await assert.rejects(downloadBlob(truncated, '/api/media/a/file', { limits: fast }), error => kind(error) === 'transient' && error.code === 'incomplete');
  await assert.rejects(downloadBlob(truncated, '/api/media/a/file', { limits: { ...fast, streamMaxBytes: 10, bodyMinMs: 500, bodyMaxMs: 500 } }), error => kind(error) === 'transient' && error.code === 'incomplete');
  // Com compressão o tamanho declarado não é o do arquivo: não há como conferir, e não pode recusar um arquivo bom.
  const compressed = await downloadBlob(async () => answer(bytes(1000), { headers: { 'content-length': '300', 'content-encoding': 'gzip' } }), '/api/media/a/file', { limits: fast });
  assert.equal(compressed.size, 1000);
});

test('download: resposta vazia é recusada', async () => {
  await assert.rejects(downloadBlob(async () => answer(new Uint8Array(0), { headers: { 'content-length': '0' } }), '/api/media/a/file', { limits: fast }), error => kind(error) === 'transient' && error.code === 'empty');
});

test('download: erros do servidor viram o tipo certo de erro, sem baixar nada', async () => {
  const status = code => downloadBlob(async () => answer('x', { status: code }), '/api/media/a/file', { limits: fast });
  await assert.rejects(status(401), error => kind(error) === 'permanent+auth' && error.status === 401);
  await assert.rejects(status(403), error => kind(error) === 'permanent+auth');
  await assert.rejects(status(404), error => kind(error) === 'permanent' && error.status === 404);
  await assert.rejects(status(503), error => kind(error) === 'transient');
  await assert.rejects(downloadBlob(async () => { throw new TypeError('fetch failed'); }, '/api/media/a/file', { limits: fast }), error => kind(error) === 'transient' && error.code === 'network');
});

test('download: servidor que não responde estoura o prazo e pode ser repetido', async () => {
  const silent = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(downloadBlob(silent, '/api/media/a/file', { limits: fast }), error => kind(error) === 'transient' && error.code === 'timeout' && /responder/.test(error.message));
  assert.ok(Date.now() - started < 1000, 'e não espera para sempre');
});

test('download: arquivo que para de chegar no meio é considerado travado', async () => {
  const stalls = async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes(100)); }, pull: () => new Promise(() => {}) });
    return new Response(stream, { headers: { 'content-length': '5000' } });
  };
  await assert.rejects(downloadBlob(stalls, '/api/media/a/file', { limits: fast }), error => kind(error) === 'transient' && error.code === 'timeout' && /parou/.test(error.message));
});

test('download: o prazo de "travado" só conta enquanto nada chega — arquivo lento mas contínuo termina', async () => {
  const slow = async () => {
    let sent = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        await new Promise(resolve => setTimeout(resolve, 25));
        controller.enqueue(bytes(100));
        if (++sent === 8) controller.close();
      }
    });
    return new Response(stream, { headers: { 'content-length': '800' } });
  };
  const started = Date.now();
  const blob = await downloadBlob(slow, '/api/media/a/file', { limits: { ...fast, idleMs: 120 } });
  assert.equal(blob.size, 800);
  assert.ok(Date.now() - started >= 150, 'levou mais que o prazo de "parado", e mesmo assim chegou');
});

test('download: cancelar interrompe na hora e não gera nova tentativa', async () => {
  const controller = new AbortController();
  const waiting = downloadBlob(() => new Promise(() => {}), '/api/media/a/file', { signal: controller.signal, limits: { ...fast, headersMs: 5000 } });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, error => error.name === 'AbortError' && error.cancelled === true && !error.transient);

  const before = new AbortController();
  before.abort();
  let called = 0;
  await assert.rejects(downloadBlob(async () => { called++; return withLength(bytes(1)); }, '/api/media/a/file', { signal: before.signal, limits: fast }), error => error.name === 'AbortError');
  assert.equal(called, 0, 'já cancelado: nem faz o pedido');

  const midway = new AbortController();
  const stalls = async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes(10)); }, pull: () => new Promise(() => {}) }), { headers: { 'content-length': '1000' } });
  const reading = downloadBlob(stalls, '/api/media/a/file', { signal: midway.signal, limits: { ...fast, idleMs: 5000 } });
  setTimeout(() => midway.abort(), 20);
  await assert.rejects(reading, error => error.name === 'AbortError');
});

// ---- fontes ------------------------------------------------------------------------------------------------------------------------
test('fonte da TV: baixa uma vez, guarda na memória e entrega um endereço blob: que é revogado ao soltar', async () => {
  let downloads = 0;
  const request = async () => { downloads++; return withLength(bytes(2048)); };
  const cache = createBlobCache();
  const source = createTvSource({ request, cache, limits: fast });
  const item = { url: '/api/media/a/file', type: 'image/png' };

  // O navegador só libera a memória de um endereço blob: quando alguém o revoga: o teste anota cada revogação pedida.
  const revoked = [], revokeOriginal = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(url); return revokeOriginal.call(URL, url); };
  try {
    const first = await source.open(item, {});
    assert.match(first.url, /^blob:/);
    assert.equal(downloads, 1);
    assert.deepEqual(revoked, [], 'em uso: ainda não foi revogado');
    first.release();
    first.release(); // soltar duas vezes é inofensivo
    assert.deepEqual(revoked, [first.url], 'revogado ao soltar, uma única vez');
    const second = await source.open(item, {});
    assert.equal(downloads, 1, 'a segunda volta usa a memória, sem baixar de novo');
    assert.notEqual(second.url, first.url, 'cada exibição ganha o próprio endereço');
    second.release();
    assert.deepEqual(revoked, [first.url, second.url]);

    source.forget();
    assert.equal(cache.stats().entries, 0);
    (await source.open(item, {})).release();
    assert.equal(downloads, 2, 'depois de esquecer, baixa de novo');
    assert.equal(revoked.length, 3);
  } finally {
    URL.revokeObjectURL = revokeOriginal;
  }
});

test('fonte da TV: endereço fora do padrão nunca chega à rede, e erro de acesso não é guardado', async () => {
  let called = 0;
  const source = createTvSource({ request: async () => { called++; return withLength(bytes(10)); }, cache: createBlobCache(), limits: fast });
  await assert.rejects(source.open({ url: 'https://evil.example/steal', type: 'image/png' }, {}), error => error.permanent && error.code === 'bad-url');
  await assert.rejects(source.open({ url: '/api/displays/1', type: 'image/png' }, {}), error => error.permanent);
  assert.equal(called, 0, 'nenhum pedido (e portanto nenhuma credencial) saiu');
  const revoked = createTvSource({ request: async () => answer('no', { status: 403 }), cache: createBlobCache(), limits: fast });
  await assert.rejects(revoked.open({ url: '/api/media/a/file', type: 'image/png' }, {}), error => error.auth === true);
});

test('fonte do painel: usa o endereço do servidor direto, sem baixar nada, e também só aceita o caminho de mídia', async () => {
  const source = createDirectSource();
  const opened = await source.open({ url: '/api/media/a/file' });
  assert.equal(opened.url, '/api/media/a/file');
  assert.doesNotThrow(() => opened.release());
  await assert.rejects(source.open({ url: 'https://evil.example/x' }), error => error.permanent === true);
  assert.doesNotThrow(() => source.forget());
});
