// Vídeo direto — TVs que não tocam o arquivo baixado (blob:) passam a tocar o MESMO arquivo por um link temporário assinado do servidor.
// Cobre: a conferência do endereço do link, a fonte da TV (dois caminhos, uma única troca, preferência lembrada), o palco (nova tentativa
// só por falha de decodificação) e o player inteiro (servidor de mentira, baixador real e um navegador que recusa vídeo por blob:).
// O servidor do link (assinatura, validade, programação) é provado em tests/player-media-link.test.mjs; o Chromium de verdade, em tests/e2e.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { LOAD_LIMITS, directPath, createTvSource } from '../public/js/playback/loader.js';
import { createBlobCache } from '../public/js/playback/media-cache.js';
import { createStage, STAGE_LIMITS } from '../public/js/playback/stage.js';
import { createFakeClock, createMemoryStorage, make } from './helpers/playback-fakes.mjs';
import { createMediaEnvironment } from './helpers/fake-media-dom.mjs';
import { VIDEO_WAY_KEY } from '../public/js/player/app.js';
import { createPlayerKit, entry, TOKEN_KEY } from './helpers/player-kit.mjs';

const fast = { ...LOAD_LIMITS, headersMs: 200, idleMs: 200, bodyMinMs: 300, bodyMaxMs: 300 };
const SIGNATURE = 'a'.repeat(43);
const TOKEN = `tv-1.1893456000000.${SIGNATURE}`;
const linkFor = id => ({ url: `/api/media/${id}/file?t=${TOKEN}`, expiresAt: '2030-01-01T00:00:00.000Z' });
const movie = (id, extra = {}) => make(id, { type: 'video/mp4', ...extra });
const picture = id => make(id, { type: 'image/png' });
const downloads = () => {
  const seen = [];
  return { seen, request: async path => { seen.push(path); return new Response(new Uint8Array(2048).fill(7), { status: 200, headers: { 'content-length': '2048' } }); } };
};

// ---- o endereço do link --------------------------------------------------------------------------------------------------------------
test('link direto: só o endereço local do MESMO arquivo, só com ?t= (o navegador nunca é mandado para fora)', () => {
  const good = `/api/media/m-1/file?t=${TOKEN}`;
  assert.equal(directPath('/api/media/m-1/file', { url: good }), good);
  const bad = [
    `https://evil.example/api/media/m-1/file?t=${TOKEN}`, `//evil.example/api/media/m-1/file?t=${TOKEN}`, `/api/media/outro/file?t=${TOKEN}`,
    `/api/media/m-1/file?t=${TOKEN}&x=1`, `/api/media/m-1/file?x=1&t=${TOKEN}`, `/api/media/m-1/file?t=${TOKEN}#a`, '/api/media/m-1/file?t=', '/api/media/m-1/file?t=curto',
    `/api/media/m-1/file?t=${TOKEN}%2F..`, `/api/media/m-1/file?t=${TOKEN}/`, '/api/media/m-1/file', `/api/displays/x?t=${TOKEN}`,
    `/api/media/m-1/file?t=${'a'.repeat(513)}`, `/api/media/m-1/file/?t=${TOKEN}`, ` /api/media/m-1/file?t=${TOKEN}`, '', null, undefined, 42, {}, ['x']
  ];
  for (const url of bad) assert.throws(() => directPath('/api/media/m-1/file', { url }), error => error.permanent === true && error.code === 'bad-url', String(url));
  for (const reply of [null, undefined, {}, 'texto', { url: 5 }]) assert.throws(() => directPath('/api/media/m-1/file', reply), error => error.code === 'bad-url');
  assert.throws(() => directPath('/api/media/x/other', { url: good }), error => error.code === 'bad-url', 'o arquivo de origem também tem de ser um caminho de mídia');
});

// ---- a fonte da TV --------------------------------------------------------------------------------------------------------------------
test('fonte: sem o recurso do link, vídeo continua só baixado e nada muda (servidor ou player sem a novidade)', async () => {
  const { request } = downloads();
  const source = createTvSource({ request, cache: createBlobCache(), limits: fast });
  const opened = await source.open(movie('a'), {});
  assert.ok(opened.url.startsWith('blob:'));
  assert.equal(opened.alternate, undefined);
  assert.equal(opened.confirm, undefined);
  opened.release();
});

test('fonte: só vídeo tem o segundo caminho; imagem e PDF seguem baixados mesmo com o link disponível', async () => {
  let asked = 0;
  const { request } = downloads();
  const source = createTvSource({ request, cache: createBlobCache(), limits: fast, directLink: async () => { asked++; return linkFor('a'); } });
  for (const item of [picture('a'), make('p', { type: 'application/pdf' })]) {
    const opened = await source.open(item, {});
    assert.ok(opened.url.startsWith('blob:'), item.kind);
    assert.equal(opened.alternate, undefined, item.kind);
    opened.release();
  }
  assert.equal(asked, 0);
});

test('fonte: vídeo que toca baixado segue baixado e o link nem é pedido (TV que funciona não muda em nada)', async () => {
  const asked = [];
  const { seen, request } = downloads();
  const source = createTvSource({ request, cache: createBlobCache(), limits: fast, directLink: async id => { asked.push(id); return linkFor(id); } });
  for (const id of ['a', 'b', 'a']) {
    const opened = await source.open(movie(id), {});
    assert.ok(opened.url.startsWith('blob:'), id);
    opened.confirm(); // a tela tocou
    opened.release();
  }
  assert.deepEqual(asked, []);
  assert.deepEqual(seen, ['/api/media/a/file', '/api/media/b/file'], 'o "a" voltou da memória');
});

test('fonte: vídeo recusado pela tela troca UMA vez pelo link, solta o arquivo baixado e os próximos já começam direto', async () => {
  const asked = [], signals = [];
  const { seen, request } = downloads();
  const cache = createBlobCache();
  const revoke = mock.method(URL, 'revokeObjectURL');
  try {
    const source = createTvSource({ request, cache, limits: fast, directLink: async (id, { signal }) => { asked.push(id); signals.push(signal); return linkFor(id); } });
    const controller = new AbortController();
    const opened = await source.open(movie('a'), { signal: controller.signal });
    const blobUrl = opened.url;
    assert.ok(blobUrl.startsWith('blob:'));
    assert.equal(cache.has('/api/media/a/file'), true);

    assert.equal(await opened.alternate({ signal: controller.signal }), true);
    assert.equal(opened.url, `/api/media/a/file?t=${TOKEN}`);
    assert.deepEqual(asked, ['a']);
    assert.equal(signals[0], controller.signal, 'o pedido do link acompanha o cancelamento do preparo');
    assert.deepEqual(revoke.mock.calls.map(call => call.arguments[0]), [blobUrl], 'o endereço blob: que não tocou foi liberado');
    assert.equal(cache.has('/api/media/a/file'), false, 'e o arquivo que não toca neste aparelho não fica ocupando a memória');
    assert.equal(await opened.alternate({ signal: controller.signal }), false, 'só uma troca por vídeo');
    assert.deepEqual(asked, ['a'], 'e sem pedir outro link');
    opened.confirm(); // a tela tocou pelo link
    opened.release(); // direto não tem o que soltar
    assert.equal(revoke.mock.callCount(), 1);

    // Os próximos vídeos começam direto: nada é baixado.
    const next = await source.open(movie('b'), {});
    assert.equal(next.url, `/api/media/b/file?t=${TOKEN}`);
    assert.deepEqual(seen, ['/api/media/a/file'], 'só a primeira tentativa (a que falhou) baixou o arquivo');
    // Imagens continuam baixadas.
    const still = await source.open(picture('i'), {});
    assert.ok(still.url.startsWith('blob:'));
    still.release();

    // O contrário também vale: se o direto não toca, tenta o arquivo baixado e passa a preferi-lo.
    assert.equal(await next.alternate({}), true);
    assert.ok(next.url.startsWith('blob:'));
    next.confirm();
    const third = await source.open(movie('c'), {});
    assert.ok(third.url.startsWith('blob:'), 'a preferência acompanha o que funcionou por último');
    assert.deepEqual(asked, ['a', 'b'], 'o link do "c" nem foi pedido');
    next.release(); third.release();
  } finally { revoke.mock.restore(); }
});

test('fonte: link que não vem (401, 404, 403, rede) ou vem errado deixa tudo como estava, sem tentar de novo nem derrubar o arquivo baixado', async () => {
  const revoke = mock.method(URL, 'revokeObjectURL');
  try {
    for (const failure of [
      () => Promise.reject(Object.assign(new Error('O servidor respondeu 401.'), { status: 401 })),
      () => Promise.reject(Object.assign(new Error('O servidor respondeu 404.'), { status: 404 })),
      () => Promise.reject(Object.assign(new Error('O servidor respondeu 403.'), { status: 403 })),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve({ url: 'https://evil.example/steal' }),
      () => Promise.resolve({ url: `/api/media/b/file?t=${TOKEN}` }),
      () => Promise.resolve(null)
    ]) {
      const { request } = downloads();
      const cache = createBlobCache();
      let asked = 0;
      const source = createTvSource({ request, cache, limits: fast, directLink: () => { asked++; return failure(); } });
      const opened = await source.open(movie('a'), {});
      const url = opened.url;
      assert.equal(await opened.alternate({}), false);
      assert.equal(opened.url, url, 'segue com o endereço blob:');
      assert.equal(cache.has('/api/media/a/file'), true, 'o arquivo baixado continua na memória');
      assert.equal(await opened.alternate({}), false);
      assert.equal(asked, 1, 'uma tentativa só');
      opened.release();
    }
    assert.equal(revoke.mock.callCount(), 7, 'só o release final soltou cada endereço blob:');
  } finally { revoke.mock.restore(); }
});

test('fonte: preferindo o direto, link que não vem faz o vídeo cair para o arquivo baixado sem ninguém notar', async () => {
  let works = true;
  const { seen, request } = downloads();
  const source = createTvSource({ request, cache: createBlobCache(), limits: fast, directLink: async id => { if (!works) throw Object.assign(new Error('O servidor respondeu 503.'), { status: 503 }); return linkFor(id); } });
  const first = await source.open(movie('a'), {});
  assert.equal(await first.alternate({}), true);
  first.confirm();
  works = false; // o servidor deixou de entregar links
  const second = await source.open(movie('b'), {});
  assert.ok(second.url.startsWith('blob:'), 'caiu para o arquivo baixado');
  assert.deepEqual(seen, ['/api/media/a/file', '/api/media/b/file']);
  second.release();
});

test('fonte: o caminho que funcionou é lembrado entre aberturas da página, só é gravado quando muda, e dica velha ou armazenamento quebrado não atrapalham', async () => {
  const memory = { value: null, writes: [] };
  const remember = { get: () => memory.value, set: value => { memory.writes.push(value); memory.value = value; } };
  const { seen, request } = downloads();
  const asked = [];
  let works = true;
  const build = (hint = remember) => createTvSource({ request, cache: createBlobCache(), limits: fast, remember: hint, directLink: async id => { asked.push(id); if (!works) throw Object.assign(new Error('O servidor respondeu 404.'), { status: 404 }); return linkFor(id); } });

  // TV que toca o arquivo baixado: nada é gravado, nunca.
  let source = build();
  let opened = await source.open(movie('a'), {});
  opened.confirm(); opened.release();
  assert.deepEqual(memory.writes, []);

  // A tela recusa o arquivo baixado e toca pelo link: grava "direct" uma única vez, por mais que confirme depois.
  opened = await source.open(movie('b'), {});
  assert.equal(await opened.alternate({}), true);
  opened.confirm(); opened.confirm();
  (await source.open(movie('c'), {})).confirm();
  assert.deepEqual(memory.writes, ['direct']);

  // A TV reinicia (página nova, mesma lembrança): o primeiro vídeo já vai direto, sem baixar o arquivo para falhar de novo.
  const downloadsBefore = seen.length;
  source = build();
  opened = await source.open(movie('d'), {});
  assert.equal(opened.url, `/api/media/d/file?t=${TOKEN}`);
  assert.equal(seen.length, downloadsBefore, 'nada foi baixado');
  opened.confirm();
  assert.deepEqual(memory.writes, ['direct'], 'e nada foi regravado');

  // Dica velha (o servidor deixou de entregar links): o arquivo baixado assume sozinho e a lembrança é corrigida.
  works = false;
  source = build();
  opened = await source.open(movie('e'), {});
  assert.ok(opened.url.startsWith('blob:'));
  opened.confirm(); opened.release();
  assert.deepEqual(memory.writes, ['direct', 'blob']);
  works = true;
  source = build();
  opened = await source.open(movie('f'), {});
  assert.ok(opened.url.startsWith('blob:'), 'a correção valeu para a abertura seguinte');
  opened.release();

  // Armazenamento bloqueado ou que falha: ninguém percebe; vale até a página recarregar.
  const broken = { get() { throw new Error('bloqueado'); }, set() { throw new Error('bloqueado'); } };
  source = build(broken);
  opened = await source.open(movie('g'), {});
  assert.ok(opened.url.startsWith('blob:'));
  assert.equal(await opened.alternate({}), true);
  opened.confirm();
  const next = await source.open(movie('h'), {});
  assert.equal(next.url, `/api/media/h/file?t=${TOKEN}`, 'a lembrança em memória segue valendo');
  assert.ok(asked.includes('h'));
});

test('fonte: cancelar no meio do pedido do link cancela de verdade (nada de troca, nada de fallback para baixar)', async () => {
  const { seen, request } = downloads();
  const hold = (id, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('abortado'), { name: 'AbortError' })), { once: true }));
  const source = createTvSource({ request, cache: createBlobCache(), limits: fast, directLink: hold });
  const opened = await source.open(movie('a'), {});
  const controller = new AbortController();
  const swapping = opened.alternate({ signal: controller.signal });
  controller.abort();
  await assert.rejects(swapping, error => error.cancelled === true);
  assert.ok(opened.url.startsWith('blob:'));
  opened.release();

  // Preferindo o direto e cancelado durante o pedido: não é motivo para ir baixar o arquivo.
  const fastSource = createTvSource({ request, cache: createBlobCache(), limits: fast, directLink: async id => linkFor(id) });
  const warm = await fastSource.open(movie('w'), {});
  await warm.alternate({}); warm.confirm();
  const stopped = new AbortController();
  const slow = createTvSource({ request, cache: null, limits: fast, directLink: hold });
  const before = seen.length;
  const pending = slow.open(movie('z'), { signal: stopped.signal }); // (este source não prefere o direto: baixa)
  await pending.then(opened2 => opened2.release());
  assert.equal(seen.length, before + 1);
  const already = new AbortController(); already.abort();
  await assert.rejects(fastSource.open(movie('y'), { signal: already.signal }), error => error.cancelled === true);
  assert.equal(seen.length, before + 1, 'cancelado antes de começar: nada foi baixado');
});

// ---- o palco -------------------------------------------------------------------------------------------------------------------------
function twoWays({ first = 'fake://clip-blob', second = 'fake://clip-direct', swap } = {}) {
  const calls = { alternate: 0, confirm: 0, released: [], options: [] };
  const opened = {
    url: first,
    release: () => calls.released.push(opened.url),
    alternate: async options => { calls.alternate++; calls.options.push(options); return swap ? swap(opened, options) : ((opened.url = second), true); },
    confirm: () => { calls.confirm++; }
  };
  return { opened, calls, source: { open: async () => opened, forget() {} } };
}
async function withStage(source, scripts, run) {
  const clock = createFakeClock();
  const env = createMediaEnvironment({ clock, scripts });
  const stage = createStage({ root: env.root, source, doc: env.document, timers: clock, raf: env.raf, cancelRaf: env.cancelRaf });
  try { await run({ clock, env, stage }); } finally { stage.clear(); env.restore(); }
}

test('palco: vídeo recusado por decodificação é tentado pelo outro caminho (uma vez) e só então vira falha', async () => {
  const { opened, calls, source } = twoWays();
  await withStage(source, { 'clip-blob': { error: 4 }, 'clip-direct': { duration: 8 } }, async ({ env, stage }) => {
    const controller = new AbortController();
    const prepared = await stage.prepare(movie('clip'), { signal: controller.signal });
    assert.deepEqual(env.videoSources, ['fake://clip-blob', 'fake://clip-direct']);
    assert.equal(calls.alternate, 1);
    assert.equal(calls.options[0].signal, controller.signal, 'o cancelamento do preparo chega à fonte');
    assert.equal(calls.confirm, 1, 'a fonte é avisada de que tocou por este caminho');
    assert.equal(prepared.naturalMs(), 8000);
    assert.equal(env.root.querySelectorAll('video').length, 1, 'um único <video> na tela');
    // O som é do elemento, não do caminho: depois da troca o vídeo toca com som e volume cheio, como qualquer outro (nada de áudio foi tocado).
    await prepared.start();
    assert.deepEqual(env.log.filter(row => row[0] === 'play'), [['play', 'clip-direct', false, 1]]);
    assert.equal(stage.audioState().muted, false);
    prepared.dispose();
    assert.deepEqual(calls.released, [opened.url], 'solta o que está em uso agora');
    assert.equal(env.root.querySelectorAll('.stage-layer').length, 0);
  });
  // E quem silenciou continua silenciado depois da troca.
  const silent = twoWays();
  await withStage(silent.source, { 'clip-blob': { error: 4 }, 'clip-direct': { duration: 8 } }, async ({ env, stage }) => {
    stage.setMuted(true);
    const prepared = await stage.prepare(movie('clip'), {});
    await prepared.start();
    assert.deepEqual(env.videoSources, ['fake://clip-blob', 'fake://clip-direct']);
    assert.deepEqual(env.log.filter(row => row[0] === 'play'), [['play', 'clip-direct', true, 1]]);
    assert.equal(stage.audioState().userMuted, true);
    prepared.dispose();
  });
});

test('palco: sem outro caminho (ou se o outro também falha) o erro é o de sempre e nada fica para trás', async () => {
  for (const [name, options, scripts, expectedSources] of [
    ['a fonte não tem outro caminho', { swap: async () => false }, { 'clip-blob': { error: 4 } }, ['fake://clip-blob']],
    ['o outro caminho também é recusado', {}, { 'clip-blob': { error: 4 }, 'clip-direct': { error: 4 } }, ['fake://clip-blob', 'fake://clip-direct']]
  ]) {
    const { calls, source } = twoWays(options);
    await withStage(source, scripts, async ({ env, stage }) => {
      await assert.rejects(stage.prepare(movie('clip'), {}), error => error.permanent === true && error.code === 'decode' && /não consegue reproduzir/.test(error.message), name);
      assert.deepEqual(env.videoSources, expectedSources, name);
      assert.equal(calls.alternate, 1, `${name}: uma tentativa só`);
      assert.equal(calls.confirm, 0, `${name}: ninguém toca, ninguém confirma`);
      assert.equal(calls.released.length, 1, `${name}: o arquivo aberto foi solto`);
      assert.equal(env.layers().length, 0);
      assert.equal(stage.stats().alive, 0);
    });
  }
});

test('palco: rede, tempo esgotado, cancelamento e MOV sem imagem NÃO trocam de caminho', async () => {
  // rede (erro 2) e tempo esgotado: o fluxo de repetição do motor cuida deles
  for (const [name, scripts, wait] of [['rede', { 'clip-blob': { error: 2 } }, 0], ['tempo esgotado', { 'clip-blob': { hang: true } }, STAGE_LIMITS.videoReadyMs + 100]]) {
    const { calls, source } = twoWays();
    await withStage(source, scripts, async ({ clock, stage }) => {
      const preparing = assert.rejects(stage.prepare(movie('clip'), {}), error => error.transient === true && !error.permanent, name);
      await clock.advance(wait);
      await preparing;
      assert.equal(calls.alternate, 0, name);
    });
  }
  // MOV que carrega mas não decodifica a imagem: trocar de caminho não conserta o decodificador
  const mov = twoWays();
  await withStage(mov.source, { 'clip-blob': { videoWidth: 0 } }, async ({ stage }) => {
    await assert.rejects(stage.prepare(movie('clip', { type: 'video/quicktime' }), {}), error => error.permanent === true && error.code === 'decode');
    assert.equal(mov.calls.alternate, 0);
    assert.equal(mov.calls.confirm, 0, 'não tocou de verdade: não confirma');
  });
  // cancelado durante a troca
  let release;
  const slow = twoWays({ swap: () => new Promise((_, reject) => { release = () => reject(Object.assign(new Error('cancelado'), { name: 'AbortError', cancelled: true })); }) });
  await withStage(slow.source, { 'clip-blob': { error: 4 } }, async ({ env, stage }) => {
    const controller = new AbortController();
    const preparing = assert.rejects(stage.prepare(movie('clip'), { signal: controller.signal }), error => error.name === 'AbortError');
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    release();
    await preparing;
    assert.equal(env.layers().length, 0);
    assert.equal(slow.calls.confirm, 0);
    assert.equal(slow.calls.released.length, 1);
  });
});

test('palco: vídeo que toca no primeiro caminho confirma sem trocar nada, e fontes antigas (sem alternate/confirm) seguem iguais', async () => {
  const { calls, source } = twoWays({ first: 'fake://clip' });
  await withStage(source, { clip: { duration: 5 } }, async ({ env, stage }) => {
    const prepared = await stage.prepare(movie('clip'), {});
    assert.deepEqual(env.videoSources, ['fake://clip']);
    assert.deepEqual([calls.alternate, calls.confirm], [0, 1]);
    prepared.dispose();
  });
  await withStage({ open: async () => ({ url: 'fake://velho', release() {} }), forget() {} }, { velho: { error: 4 } }, async ({ stage }) => {
    await assert.rejects(stage.prepare(movie('velho'), {}), error => error.permanent === true && error.code === 'decode');
  });
});

// ---- o player inteiro ----------------------------------------------------------------------------------------------------------------
async function withKit(options, run) {
  const kit = createPlayerKit(options);
  let finished = false;
  try { await run(kit); finished = true; } finally {
    if (finished) await kit.close(); // confere que nada ficou para trás
    else { try { await kit.close(); } catch { /* o erro que importa é o do teste */ } }
  }
}
const video = (id, extra = {}) => entry(id, { type: 'video/mp4', name: `${id}.mp4`, ...extra });
const DIRECT = id => `/api/media/${id}/file?t=device-token.1893456000000.${SIGNATURE}`;

test('player: a TV recusa o vídeo baixado (erro 4), o player pede o link e o vídeo toca direto, sem pular nem avisar', () => withKit({
  fakeSource: false, refuseBlobVideo: 4, manifestItems: [video('v', { duration: 30 })]
}, async kit => {
  await kit.settle(1_000);
  assert.equal(kit.shownLayers().length, 1, 'o vídeo está na tela');
  assert.equal(kit.visible('empty'), false, 'sem aviso de conteúdo indisponível');
  assert.equal(kit.status(), '1 de 1 · Em exibição');
  assert.deepEqual(kit.server.downloads, ['v'], 'o arquivo baixado foi tentado uma vez');
  assert.deepEqual(kit.server.links, ['v']);
  assert.equal(kit.env.videoSources.length, 2);
  assert.ok(kit.env.videoSources[0].startsWith('blob:'));
  assert.equal(kit.env.videoSources[1], DIRECT('v'));
  assert.equal(kit.topLayer().querySelector('video').src, DIRECT('v'));
  const ask = kit.server.requests.find(request => request.path === '/api/player/media/v/link');
  assert.deepEqual([ask.method, ask.authorization, ask.init.credentials, ask.init.cache], ['GET', 'Bearer device-token', 'omit', 'no-store'], 'a credencial da TV vai só no pedido à API');
  assert.deepEqual(kit.server.requests.filter(request => request.path.includes('?t=')), [], 'o endereço com ?t= é do <video>: o player nunca o busca com a credencial');
  assert.equal(kit.player.cacheStats().entries, 0, 'o arquivo que não tocava foi tirado da memória da TV');
  assert.equal(kit.text('announcement'), '', 'e ninguém foi avisado de falha');
}));

test('player: depois da primeira vez, os próximos vídeos e as próximas voltas já vão direto, sem baixar o arquivo', () => withKit({
  fakeSource: false, refuseBlobVideo: 4, manifestItems: [video('a', { duration: 5 }), video('b', { duration: 5 })]
}, async kit => {
  await kit.settle(14_000); // a → b → a → …
  assert.deepEqual(kit.server.downloads, ['a'], 'só a primeira tentativa baixou algo');
  assert.ok(kit.server.links.length >= 3, `um link a cada exibição (${kit.server.links.join(',')})`);
  assert.deepEqual(kit.env.videoSources.filter(src => src.startsWith('blob:')).length, 1);
  assert.ok(kit.env.videoSources.slice(2).every(src => /^\/api\/media\/[ab]\/file\?t=/.test(src)), kit.env.videoSources.join(' | '));
  assert.equal(kit.visible('empty'), false);
}));

test('player: o caminho que funcionou fica gravado na TV e a próxima abertura da página já começa por ele, sem baixar o vídeo para falhar de novo', async () => {
  const storage = createMemoryStorage();
  await withKit({ storage, fakeSource: false, refuseBlobVideo: 4, manifestItems: [video('v', { duration: 30 })] }, async kit => {
    await kit.settle(1_000);
    assert.equal(storage.get(VIDEO_WAY_KEY), 'direct');
    assert.deepEqual(kit.server.downloads, ['v'], 'a primeira vez paga uma tentativa com o arquivo baixado');
  });
  // A TV reinicia: página nova, mesmo armazenamento.
  await withKit({ storage, fakeSource: false, refuseBlobVideo: 4, manifestItems: [video('v', { duration: 30 })] }, async kit => {
    await kit.settle(1_000);
    assert.deepEqual(kit.server.downloads, [], 'o arquivo nem foi baixado');
    assert.deepEqual(kit.server.links, ['v']);
    assert.deepEqual(kit.env.videoSources, [DIRECT('v')]);
    assert.equal(kit.visible('empty'), false);
  });
  // Dica velha (o servidor voltou a uma versão sem o link): o arquivo baixado assume e a lembrança é corrigida.
  await withKit({ storage, fakeSource: false, manifestItems: [video('v', { duration: 30 })] }, async kit => {
    kit.server.state.linkStatus = 404;
    await kit.settle(1_000);
    assert.equal(kit.shownLayers().length, 1, 'o vídeo está na tela');
    assert.equal(kit.visible('empty'), false, 'sem aviso de conteúdo indisponível');
    assert.deepEqual(kit.server.links, ['v'], 'o link foi pedido e recusado');
    assert.equal(kit.env.videoSources.length, 1, 'o <video> nunca recebeu o endereço direto');
    assert.ok(kit.env.videoSources[0].startsWith('blob:'));
    assert.equal(storage.get(VIDEO_WAY_KEY), 'blob', 'a lembrança foi corrigida');
    assert.deepEqual(kit.server.downloads, ['v']);
  });
});

test('player: TV que toca o arquivo baixado não grava nada e não muda em nada: o link nunca é pedido', () => withKit({
  fakeSource: false, manifestItems: [video('a', { duration: 5 }), video('b', { duration: 5 })]
}, async kit => {
  await kit.settle(12_000);
  assert.deepEqual(kit.server.links, []);
  assert.equal(kit.storage.get(VIDEO_WAY_KEY), null, 'nada foi gravado na TV');
  assert.deepEqual(kit.server.downloads, ['a', 'b'], 'cada arquivo baixado uma vez e depois vem da memória');
  assert.ok(kit.env.videoSources.every(src => src.startsWith('blob:')));
  assert.equal(kit.player.cacheStats().entries, 2);
}));

test('player: servidor sem a rota do link (versão anterior: 401 ou 404) ou que recusa o link: o comportamento é o de antes — vídeo pulado como "formato não suportado" e a TV continua pareada', async () => {
  for (const linkStatus of [401, 404, 403, 500]) {
    await withKit({ fakeSource: false, refuseBlobVideo: 4, manifestItems: [video('v', { duration: 30 })] }, async kit => {
      kit.server.state.linkStatus = linkStatus; // antes de a TV pedir qualquer coisa
      await kit.settle(1_000);
      assert.equal(kit.shownLayers().length, 0, `status ${linkStatus}`);
      assert.equal(kit.visible('empty'), true);
      assert.equal(kit.text('empty-title'), 'Conteúdo indisponível nesta TV');
      assert.match(kit.text('empty-description'), /V não pôde ser exibido \(formato ou arquivo não suportado por esta TV\)/);
      assert.deepEqual(kit.server.links, ['v'], 'o link foi pedido uma vez');
      assert.equal(kit.env.videoSources.length, 1, 'e o <video> não recebeu outro endereço');
      // Só o manifesto e o batimento (nunca o pedido do link) podem desparear a TV: a credencial segue guardada e a tela de pareamento não aparece.
      assert.equal(kit.storage.get(TOKEN_KEY), 'device-token', `status ${linkStatus}: a TV continua pareada`);
      assert.equal(kit.visible('pairing'), false);
    });
  }
});

test('player: imagens e PDF não são afetados por uma TV que recusa vídeo por blob:', () => withKit({
  fakeSource: false, refuseBlobVideo: 4, manifestItems: [entry('i', { duration: 5 }), entry('j', { duration: 5 })]
}, async kit => {
  await kit.settle(6_000);
  assert.deepEqual(kit.server.links, []);
  assert.equal(kit.visible('empty'), false);
  assert.deepEqual(kit.server.downloads, ['i', 'j']);
}));

test('player: a programação muda enquanto o link é pedido: o pedido é cancelado e a nova programação aparece', () => withKit({
  fakeSource: false, refuseBlobVideo: 4, manifestItems: [video('v', { duration: 30 })]
}, async kit => {
  kit.server.state.linkDelayMs = 50_000; // o servidor demora para responder o link (antes de a TV pedir qualquer coisa)
  await kit.settle(1_000);
  const ask = kit.server.requests.find(request => request.path === '/api/player/media/v/link');
  assert.ok(ask, 'o link está sendo pedido');
  assert.equal(ask.signal.aborted, false);
  assert.equal(kit.clock.now() < 15_000, true, 'antes do prazo de 15 s do próprio pedido: só um cancelamento de fora pode abortá-lo');
  kit.server.state.items = [entry('x', { duration: 10 })];
  await kit.player.poll(); // a consulta traz outra programação e o preparo do vídeo é cancelado
  await kit.settle(500);
  assert.equal(ask.signal.aborted, true, 'o pedido do link foi cancelado junto com o preparo');
  assert.equal(kit.topLayer().querySelector('img').alt, 'X');
  assert.equal(kit.visible('empty'), false);
}));
