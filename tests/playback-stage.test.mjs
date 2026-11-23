// Fase 2 — a tela do carrossel: camadas, preparo por trás, efeitos de verdade (Web Animations), liberação de memória e falhas.
// Usa um navegador de mentira (tests/helpers/fake-media-dom.mjs). O desenho real e o desempenho são conferidos no Chromium (tests/e2e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStage, detectCapabilities, STAGE_LIMITS } from '../public/js/playback/stage.js';
import { EFFECTS, resolveEffect } from '../public/js/playback/effects.js';
import { createFakeClock, make } from './helpers/playback-fakes.mjs';
import { createMediaEnvironment } from './helpers/fake-media-dom.mjs';

async function withStage(run, { scripts = {}, animations = true, limits, raf } = {}) {
  const clock = createFakeClock();
  const env = createMediaEnvironment({ clock, scripts, animations });
  const frames = raf === undefined ? { raf: env.raf, cancelRaf: env.cancelRaf } : { raf, cancelRaf: raf ? env.cancelRaf : null };
  const stage = createStage({ root: env.root, source: env.source, doc: env.document, timers: clock, ...frames, limits });
  try { await run({ clock, env, stage }); } finally { stage.clear(); env.restore(); }
}

const image = (id, extra = {}) => make(id, { type: 'image/png', ...extra });
const video = (id, extra = {}) => make(id, { type: 'video/mp4', ...extra });
const effect = (name, ms = 600) => resolveEffect({ requested: name, ms });
const classes = layer => (layer.getAttribute('class') ?? '').split(/\s+/);
// Como a animação acabou: "terminou" (chegou ao quadro final) ou "cancelada" (foi abortada no meio do caminho).
const outcome = animation => animation.finished.then(() => 'terminou', () => 'cancelada');

// ---- preparo ------------------------------------------------------------------------------------------------------------------------
test('preparo: a imagem é decodificada ANTES de aparecer e fica numa camada escondida', () => withStage(async ({ env, stage }) => {
  const prepared = await stage.prepare(image('a', { title: 'Aviso importante' }), {});
  assert.deepEqual(env.log.filter(entry => entry[0] === 'decode'), [['decode', 'a']], 'decodificou antes de devolver');
  assert.equal(env.layers().length, 1);
  assert.ok(classes(prepared.layer).includes('is-standby'), 'escondida enquanto espera a vez');
  assert.equal(prepared.layer.getAttribute('aria-hidden'), 'true');
  const img = prepared.layer.querySelector('img');
  assert.equal(img.alt, 'Aviso importante', 'texto alternativo para leitores de tela');
  assert.equal(img.src, 'fake://a');
  assert.equal(prepared.naturalMs(), null);
  assert.equal(prepared.progressMs(), null);
  prepared.dispose();
}));

test('preparo: imagem corrompida é erro definitivo e não deixa camada para trás', () => withStage(async ({ env, stage }) => {
  await assert.rejects(stage.prepare(image('quebrada'), {}), error => error.permanent === true && error.code === 'decode');
  assert.equal(env.layers().length, 0);
  assert.deepEqual(env.source.released, ['fake://quebrada'], 'o arquivo carregado foi solto');
}, { scripts: { quebrada: { decode: 'fail' } } }));

test('preparo: cancelar no meio do preparo remove tudo o que foi montado', () => withStage(async ({ env, stage }) => {
  const controller = new AbortController();
  const preparing = stage.prepare(image('lenta'), { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(preparing, error => error.name === 'AbortError');
  assert.equal(env.layers().length, 0);
  assert.deepEqual(env.source.released, ['fake://lenta']);
  assert.equal(stage.stats().alive, 0);
  const already = new AbortController();
  already.abort();
  await assert.rejects(stage.prepare(image('x'), { signal: already.signal }), error => error.name === 'AbortError');
  assert.equal(env.source.opened.length, 1, 'cancelado antes de começar: nem abre o arquivo');
}, { scripts: { lenta: { decode: 'hang' } } }));

test('preparo: erro ao abrir o arquivo (acesso revogado, sem rede) passa adiante intacto e não deixa nada', () => {
  const denied = Object.assign(new Error('acesso revogado'), { auth: true, permanent: true });
  return withStage(async ({ env, stage }) => {
    await assert.rejects(stage.prepare(image('negado'), {}), error => error === denied, 'o erro original chega ao motor, com as marcas de acesso');
    assert.equal(env.layers().length, 0);
    assert.equal(stage.stats().alive, 0);
    assert.deepEqual(env.source.released, [], 'nada foi aberto, nada a soltar');
  }, { scripts: { negado: { openError: denied } } });
});

test('preparo: formato desconhecido é recusado sem nem abrir o arquivo', () => withStage(async ({ env, stage }) => {
  await assert.rejects(stage.prepare(make('z', { type: 'text/plain' }), {}), error => error.permanent === true && error.code === 'unsupported');
  assert.equal(env.source.opened.length, 0);
}));

test('preparo: conteúdo interno (demonstração) é desenhado por quem o criou, sem tocar no servidor', () => withStage(async ({ env, stage }) => {
  const item = make('demo-1', { type: 'application/x-tvcorp-html', render: () => env.document.createElement('article') });
  const prepared = await stage.prepare(item, {});
  assert.equal(prepared.layer.querySelector('article') !== null, true);
  assert.equal(env.source.opened.length, 0);
  prepared.dispose();
  const bare = make('demo-2', { type: 'application/x-tvcorp-html' });
  await assert.rejects(stage.prepare(bare, {}), error => error.permanent === true);
}));

test('preparo: PDF usa o visualizador do aparelho, sem barras, e segue mesmo que o visualizador nunca avise', () => withStage(async ({ clock, env, stage }) => {
  const ready = await stage.prepare(make('norma', { type: 'application/pdf', title: 'Norma' }), {});
  const frame = ready.layer.querySelector('iframe');
  assert.equal(frame.title, 'Norma');
  assert.match(frame.src, /^fake:\/\/norma#toolbar=0&navpanes=0&scrollbar=0&view=Fit$/);
  ready.dispose();
  assert.equal(frame.src, 'about:blank', 'o documento é descarregado ao soltar');

  let done = false;
  const silent = stage.prepare(make('muda', { type: 'application/pdf' }), {}).then(prepared => { done = true; return prepared; });
  await clock.advance(STAGE_LIMITS.pdfReadyMs - 1);
  assert.equal(done, false);
  await clock.advance(1);
  const prepared = await silent;
  assert.equal(done, true, 'passado o prazo, segue sem esperar para sempre');
  prepared.dispose();
}, { scripts: { muda: { load: false } } }));

// ---- vídeo -------------------------------------------------------------------------------------------------------------------------
test('vídeo: prepara parado, com som no volume máximo e sem controles; informa duração e obedece aos comandos', () => withStage(async ({ env, stage }) => {
  const prepared = await stage.prepare(video('clipe', { title: 'Clipe da segurança' }), {});
  const element = prepared.layer.querySelector('video');
  assert.equal(element.muted, false);
  assert.equal(element.defaultMuted, false);
  assert.equal(element.volume, 1);
  assert.equal(element.getAttribute('muted'), null);
  assert.equal(element.getAttribute('playsinline'), '');
  assert.equal(element.controls, false);
  assert.equal(element.preload, 'auto');
  assert.equal(element.getAttribute('aria-label'), 'Clipe da segurança');
  assert.equal(prepared.naturalMs(), 8_500);
  assert.equal(element.paused, true, 'preparado, mas parado até a vez dele');

  await prepared.start();
  assert.equal(element.paused, false);
  element.currentTime = 2.5;
  assert.equal(prepared.progressMs(), 2_500);
  prepared.pause();
  assert.equal(element.paused, true);
  prepared.restart();
  assert.equal(element.currentTime, 0);
  assert.equal(element.paused, false);

  let ended = 0, errors = [];
  const stopEnded = prepared.onEnded(() => ended++);
  prepared.onError(error => errors.push(error));
  element.dispatchEvent(new (await import('./helpers/fake-dom.mjs')).FakeEvent('ended'));
  assert.equal(ended, 1);
  stopEnded();
  element.dispatchEvent(new (await import('./helpers/fake-dom.mjs')).FakeEvent('ended'));
  assert.equal(ended, 1, 'depois de cancelar a assinatura, não avisa mais');
  element.error = { code: 3 };
  element.dispatchEvent(new (await import('./helpers/fake-dom.mjs')).FakeEvent('error'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].permanent, true);
  prepared.dispose();
  assert.equal(element.pauses >= 1 && element.loads, 1, 'solto: parado e descarregado para devolver a memória');
  assert.equal(element.getAttribute('src'), null);
  assert.deepEqual(env.source.released, ['fake://clipe']);
}, { scripts: { clipe: { duration: 8.5 } } }));

test('vídeo: duração desconhecida (transmissão, metadado ausente) vira "não sei", nunca zero ou infinito', () => withStage(async ({ stage }) => {
  for (const id of ['live', 'nan']) {
    const prepared = await stage.prepare(video(id), {});
    assert.equal(prepared.naturalMs(), null, id);
    prepared.dispose();
  }
}, { scripts: { live: { duration: Infinity }, nan: { duration: NaN } } }));

test('vídeo: formato que a TV não toca é erro definitivo; falha de rede é passageira', () => withStage(async ({ env, stage }) => {
  await assert.rejects(stage.prepare(video('codec'), {}), error => error.permanent === true && error.code === 'decode' && /codec/.test(error.message));
  await assert.rejects(stage.prepare(video('rede'), {}), error => error.transient === true && error.code === 'network');
  assert.equal(env.layers().length, 0);
  assert.deepEqual(env.source.released.sort(), ['fake://codec', 'fake://rede']);
}, { scripts: { codec: { error: 4 }, rede: { error: 2 } } }));

test('vídeo MOV: arquivo que carrega e toca o som, mas não tem imagem decodificada (largura 0), é erro definitivo de decodificação', () => withStage(async ({ env, stage }) => {
  const mov = (id, extra) => make(id, { type: 'video/quicktime', ...extra });
  await assert.rejects(stage.prepare(mov('sem-imagem'), {}), error => error.permanent === true && error.code === 'decode' && /codec/.test(error.message));
  assert.equal(env.layers().length, 0, 'nenhuma camada preta ficou na tela');
  assert.deepEqual(env.source.released, ['fake://sem-imagem'], 'o arquivo carregado foi solto');
  assert.equal(stage.stats().alive, 0);

  const prepared = await stage.prepare(mov('com-imagem'), {});
  assert.equal(prepared.layer.querySelector('video').videoWidth, 640);
  assert.equal(prepared.naturalMs(), 10_000);
  prepared.dispose();

  // A conferência é só do MOV: MP4 e WebM se comportam como antes da inclusão do MOV.
  for (const type of ['video/mp4', 'video/webm']) {
    const legacy = await stage.prepare(make(`${type}-sem-largura`, { type }), {});
    assert.ok(legacy, type);
    legacy.dispose();
  }
}, { scripts: { 'sem-imagem': { videoWidth: 0 }, 'video/mp4-sem-largura': { videoWidth: 0 }, 'video/webm-sem-largura': { videoWidth: 0 } } }));

test('vídeo: se o aparelho não avisa que carregou, segue quando já conhece a duração; senão desiste depois do prazo', () => withStage(async ({ clock, stage }) => {
  const known = stage.prepare(video('metadados'), {});
  await clock.advance(STAGE_LIMITS.videoReadyMs);
  const prepared = await known;
  assert.ok(prepared);
  prepared.dispose();

  const never = stage.prepare(video('nada'), {});
  const failure = assert.rejects(never, error => error.transient === true && error.code === 'timeout');
  await clock.advance(STAGE_LIMITS.videoReadyMs);
  await failure;
}, { scripts: { metadados: { hang: true, readyState: 1 }, nada: { hang: true } } }));

test('vídeo: recusa de autoplay com áudio faz uma única tentativa muda e informa necessidade de gesto', () => withStage(async ({ env, stage }) => {
  const prepared = await stage.prepare(video('mudo'), {});
  await prepared.start();
  assert.deepEqual(env.log.filter(row => row[0] === 'play'), [['play', 'mudo', false, 1], ['play', 'mudo', true, 1]]);
  assert.equal(stage.audioState().blocked, true);
  prepared.dispose();
}, { scripts: { mudo: { autoplay: 'blocked-once' } } }));

// ---- troca ---------------------------------------------------------------------------------------------------------------------
test('troca em corte seco: a nova camada aparece e a antiga sai no mesmo instante, sem animação', () => withStage(async ({ env, stage }) => {
  const first = await stage.prepare(image('a'), {});
  await stage.show(first, { effect: effect('cut'), outgoing: null });
  const second = await stage.prepare(image('b'), {});
  assert.equal(env.layers().length, 2, 'a próxima já está pronta por trás');
  const result = await stage.show(second, { effect: effect('cut'), outgoing: first });
  assert.deepEqual(result, { frames: null });
  assert.equal(env.animations.length, 0);
  assert.equal(first.disposed, true);
  assert.deepEqual(env.layers().map(layer => classes(layer).includes('is-standby')), [false]);
  assert.equal(env.layers()[0].getAttribute('aria-hidden'), null, 'a camada visível é lida por leitores de tela');
  assert.deepEqual(env.source.released, ['fake://a']);
}));

test('troca com efeito: anima a camada que entra, mantém a que sai até o fim e só então a solta', () => withStage(async ({ clock, env, stage }) => {
  const first = await stage.prepare(image('a'), {});
  await stage.show(first, { effect: effect('cut'), outgoing: null });
  const second = await stage.prepare(image('b'), {});
  const showing = stage.show(second, { effect: effect('fade', 800), outgoing: first });
  await clock.advance(0);

  assert.equal(env.animations.length, 1, 'esmaecer anima só a que entra');
  const [animation] = env.animations;
  assert.equal(animation.target, second.layer);
  assert.deepEqual(animation.keyframes, EFFECTS.fade.enter.keyframes);
  assert.deepEqual(animation.options, { duration: 800, easing: EFFECTS.fade.enter.easing, fill: 'both' });
  assert.equal(animation.hadStandby, true, 'a animação começa ANTES de a camada ficar visível (sem piscar)');
  assert.equal(classes(second.layer).includes('is-standby'), false);
  assert.equal(first.disposed, false, 'a camada que sai continua inteira durante a troca');
  assert.equal(env.layers().length, 2);
  assert.ok(Number(second.layer.style.zIndex) > Number(first.layer.style.zIndex), 'a nova fica por cima');

  await clock.advance(799);
  assert.equal(first.disposed, false);
  env.finishAll();
  const result = await showing;
  assert.equal(first.disposed, true, 'terminou: a antiga sai');
  assert.equal(animation.playState, 'canceled', 'efeito encerrado (a camada volta ao estado natural, igual ao quadro final)');
  assert.equal(env.layers().length, 1);
  assert.ok(Array.isArray(result.frames) && result.frames.length >= 40, `amostra de quadros (${result.frames.length})`);
  assert.ok(result.frames.every(interval => interval === 16));
}));

test('troca: deslizar e ampliar também movem a camada que sai; dissolver e esmaecer não', () => withStage(async ({ clock, env, stage }) => {
  const expected = { fade: 1, dissolve: 1, slide: 2, zoom: 2 };
  let outgoing = await stage.prepare(image('inicio'), {});
  await stage.show(outgoing, { effect: effect('cut'), outgoing: null });
  for (const name of Object.keys(expected)) {
    const incoming = await stage.prepare(image(name), {});
    const before = env.animations.length;
    const showing = stage.show(incoming, { effect: effect(name, 500), outgoing });
    await clock.advance(0);
    const created = env.animations.slice(before);
    assert.equal(created.length, expected[name], name);
    assert.deepEqual(created[0].keyframes, EFFECTS[name].enter.keyframes, `${name}: entrada`);
    assert.equal(created[0].target, incoming.layer);
    if (expected[name] === 2) {
      assert.equal(created[1].target, outgoing.layer, `${name}: a que sai também se move`);
      assert.deepEqual(created[1].keyframes, EFFECTS[name].exit.keyframes);
    }
    env.finishAll();
    await showing;
    outgoing = incoming;
  }
  assert.equal(env.layers().length, 1);
}));

test('troca: nunca existe um momento sem camada visível (tela preta) em nenhum efeito', () => withStage(async ({ clock, env, stage }) => {
  const visible = () => env.layers().filter(layer => !classes(layer).includes('is-standby'));
  let outgoing = await stage.prepare(image('inicio'), {});
  await stage.show(outgoing, { effect: effect('cut'), outgoing: null });
  for (const name of ['cut', 'fade', 'dissolve', 'slide', 'zoom']) {
    const incoming = await stage.prepare(image(`i-${name}`), {});
    assert.equal(visible().length, 1, `${name}: antes da troca há exatamente uma camada visível`);
    const showing = stage.show(incoming, { effect: effect(name, 400), outgoing });
    assert.ok(visible().length >= 1, `${name}: logo depois de começar`);
    assert.equal(visible().length, name === 'cut' ? 1 : 2, `${name}: durante a troca as duas estão presentes, a nova por cima`);
    await clock.advance(200);
    assert.ok(visible().length >= 1, `${name}: no meio`);
    env.finishAll();
    await showing;
    assert.equal(visible().length, 1, `${name}: no fim só a nova`);
    outgoing = incoming;
  }
}));

test('troca: uma troca que começa antes da anterior terminar a conclui na hora (a camada que sai está sempre inteira)', () => withStage(async ({ clock, env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const b = await stage.prepare(image('b'), {});
  const firstShow = stage.show(b, { effect: effect('slide', 1000), outgoing: a });
  await clock.advance(100);
  const c = await stage.prepare(image('c'), {});
  const secondShow = stage.show(c, { effect: effect('zoom', 1000), outgoing: b });
  await clock.advance(0);
  assert.equal(a.disposed, true, 'a primeira troca foi concluída e "a" saiu');
  assert.equal(b.disposed, false, '"b" é agora a que sai da segunda');
  const stale = env.animations.slice(0, 2);
  assert.ok(stale.every(animation => animation.playState === 'canceled'), 'as animações da primeira não ficam penduradas');
  assert.deepEqual(await Promise.all(stale.map(outcome)), ['terminou', 'terminou'], 'e chegaram ao quadro final antes de serem encerradas (não foram abortadas no meio)');
  assert.equal(env.running().length, 2, 'só as duas da segunda estão em andamento');
  assert.ok(Number(c.layer.style.zIndex) > Number(b.layer.style.zIndex));
  env.finishAll();
  await Promise.all([firstShow, secondShow]);
  assert.equal(b.disposed, true);
  assert.equal(env.layers().length, 1);
}));

test('troca: se o navegador não termina a animação, um prazo de segurança conclui a troca', () => withStage(async ({ clock, env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const b = await stage.prepare(image('b'), {});
  const showing = stage.show(b, { effect: effect('fade', 500), outgoing: a });
  await clock.advance(500 + STAGE_LIMITS.settleGraceMs - 1);
  assert.equal(a.disposed, false);
  await clock.advance(1);
  await showing;
  assert.equal(a.disposed, true);
  assert.equal(env.running().length, 0);
  assert.deepEqual(await Promise.all(env.animations.map(outcome)), ['terminou'], 'o prazo leva a animação ao quadro final em vez de abortá-la');
}));

test('troca: sem suporte a animações a troca é imediata (o motor já avisa corte; aqui é a última proteção)', () => withStage(async ({ env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const b = await stage.prepare(image('b'), {});
  const result = await stage.show(b, { effect: { name: 'zoom', ms: 500 }, outgoing: a });
  assert.deepEqual(result, { frames: null });
  assert.equal(a.disposed, true);
  assert.equal(env.layers().length, 1);
}, { animations: false }));

test('troca: se o navegador recusa criar a animação, vira corte seco — a nova camada aparece e a tela nunca fica preta', () => withStage(async ({ env, stage }) => {
  const visible = () => env.layers().filter(layer => !classes(layer).includes('is-standby'));
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });

  // A camada que entra não consegue animar (aparelho antigo que expõe animate() mas lança erro).
  const b = await stage.prepare(image('b'), {});
  b.layer.animate = () => { throw new Error('animação não suportada'); };
  const result = await stage.show(b, { effect: effect('fade', 600), outgoing: a });
  assert.deepEqual(result, { frames: null });
  assert.equal(visible().length, 1);
  assert.equal(visible()[0], b.layer, 'a nova camada ficou visível (sem isto a tela ficaria preta)');
  assert.equal(b.layer.getAttribute('aria-hidden'), null);
  assert.equal(a.disposed, true, 'a antiga saiu');
  assert.equal(env.running().length, 0);

  // Só a animação da camada que sai falha: a da que entra, já criada, é cancelada e nada fica pendurado.
  const c = await stage.prepare(image('c'), {});
  b.layer.animate = () => { throw new Error('animação de saída não suportada'); };
  const before = env.animations.length;
  const second = await stage.show(c, { effect: effect('slide', 600), outgoing: b });
  assert.deepEqual(second, { frames: null });
  const created = env.animations.slice(before);
  assert.equal(created.length, 1, 'a de entrada chegou a ser criada');
  assert.equal(created[0].playState, 'canceled', 'e foi cancelada, para não deixar a camada presa num quadro do efeito');
  assert.equal(env.running().length, 0);
  assert.deepEqual(visible(), [c.layer]);
  assert.equal(b.disposed, true);
  assert.equal(stage.stats().alive, 1);

  // Uma troca normal logo depois continua funcionando.
  const d = await stage.prepare(image('d'), {});
  const showing = stage.show(d, { effect: effect('fade', 300), outgoing: c });
  await Promise.resolve();
  assert.equal(env.running().length, 1);
  env.finishAll();
  await showing;
  assert.deepEqual(visible(), [d.layer]);
}));

// ---- corte seco para um vídeo: a camada nova entra quase transparente e a antiga só sai depois -----------------------------------------
// Achado no Chromium (tests/e2e/playback.e2e.mjs): trocar uma imagem por um vídeo em corte seco mostrava, por um quadro, o fundo vazio do palco
// antes do primeiro quadro do vídeo. Medido: por baixo da camada antiga, ou a 0% de opacidade, o navegador não desenha o vídeo; a 1% sim.
// Aqui se confere a regra; que o quadro vazio não existe mais, conferem os pixels no Chromium.
test('corte seco para um vídeo: o vídeo entra por cima, quase transparente, e a camada antiga só sai 3 quadros depois (nunca um quadro com o palco vazio)', () => withStage(async ({ clock, env, stage }) => {
  const visible = () => env.layers().filter(layer => !classes(layer).includes('is-standby'));
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const v = await stage.prepare(video('v'), {});
  const showing = stage.show(v, { effect: effect('cut'), outgoing: a });
  await clock.advance(0);
  assert.equal(visible().length, 2, 'o vídeo já está na tela, para o navegador desenhá-lo');
  assert.ok(Number(v.layer.style.zIndex) > Number(a.layer.style.zIndex), 'por cima: uma camada coberta não é desenhada pelo navegador');
  assert.equal(v.layer.style.opacity, String(STAGE_LIMITS.warmOpacity), 'mas quase transparente: o que o público vê continua sendo a camada antiga');
  assert.equal(v.layer.getAttribute('aria-hidden'), null, 'para leitores de tela o conteúdo atual já é o novo');
  assert.equal(a.layer.getAttribute('aria-hidden'), 'true');
  await clock.advance(47);
  assert.equal(a.disposed, false, 'antes do terceiro quadro (48 ms) ainda é cedo');
  assert.equal(visible().length, 2);
  assert.equal(v.layer.style.opacity, String(STAGE_LIMITS.warmOpacity));
  await clock.advance(1);
  assert.deepEqual(await showing, { frames: null });
  assert.equal(a.disposed, true);
  assert.deepEqual(visible(), [v.layer]);
  assert.equal(v.layer.style.opacity, '', 'a camada do vídeo fica opaca no mesmo instante em que a antiga sai');
  assert.equal(clock.pending(), 0, 'nenhum quadro nem prazo ficou pendente');
  // O seguinte entra por cima de qualquer jeito.
  const b = await stage.prepare(image('b'), {});
  await stage.show(b, { effect: effect('cut'), outgoing: v });
  assert.ok(Number(b.layer.style.zIndex) > Number(v.layer.style.zIndex));
  assert.equal(env.layers().length, 1);
}));

test('corte seco entre vídeos também espera; para imagem e para o primeiro conteúdo a troca continua imediata', () => withStage(async ({ clock, env, stage }) => {
  const first = await stage.prepare(video('v1'), {});
  assert.deepEqual(await stage.show(first, { effect: effect('cut'), outgoing: null }), { frames: null }, 'primeiro conteúdo: não há o que cobrir');
  assert.equal(first.layer.style.opacity ?? '', '', 'e entra opaco');
  const second = await stage.prepare(video('v2'), {});
  const showing = stage.show(second, { effect: effect('cut'), outgoing: first });
  await clock.advance(0);
  assert.equal(first.disposed, false);
  await clock.advance(48);
  await showing;
  assert.equal(first.disposed, true);
  const picture = await stage.prepare(image('i'), {});
  await stage.show(picture, { effect: effect('cut'), outgoing: second });
  assert.equal(second.disposed, true, 'a imagem já foi decodificada: sai na hora, sem esperar quadros');
  assert.equal(picture.layer.style.opacity ?? '', '');
  assert.equal(clock.pending(), 0);
}));

test('corte seco para vídeo: uma nova troca (ou limpar a tela) durante a espera encerra a anterior na hora, deixa o vídeo opaco e não deixa nada pendente', () => withStage(async ({ clock, env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const v = await stage.prepare(video('v'), {});
  const firstShow = stage.show(v, { effect: effect('cut'), outgoing: a });
  await clock.advance(10);
  assert.equal(v.layer.style.opacity, String(STAGE_LIMITS.warmOpacity));
  const c = await stage.prepare(image('c'), {});
  const secondShow = stage.show(c, { effect: effect('cut'), outgoing: v });
  await Promise.all([firstShow, secondShow]);
  assert.equal(a.disposed, true, 'a primeira troca foi concluída ao começar a segunda');
  assert.equal(v.disposed, true);
  assert.equal(v.layer.style.opacity, '', 'nenhuma camada fica presa em 1% de opacidade');
  assert.deepEqual(env.layers().filter(layer => !classes(layer).includes('is-standby')), [c.layer]);
  assert.equal(clock.pending(), 0);

  const w = await stage.prepare(video('w'), {});
  const lastShow = stage.show(w, { effect: effect('cut'), outgoing: c });
  await clock.advance(5);
  stage.clear();
  await lastShow;
  assert.equal(w.layer.style.opacity, '');
  assert.equal(env.layers().length, 0);
  assert.equal(stage.stats().alive, 0);
  assert.equal(clock.pending(), 0, 'limpar a tela cancela os quadros esperados');
}));

test('corte seco para vídeo: sem quadros do navegador (aba escondida) a espera tem teto de tempo; sem requestAnimationFrame usa prazos', async () => {
  // O navegador nunca entrega quadros: vale o teto (presentWaitMs).
  await withStage(async ({ clock, stage }) => {
    const a = await stage.prepare(image('a'), {});
    await stage.show(a, { effect: effect('cut'), outgoing: null });
    const v = await stage.prepare(video('v'), {});
    const showing = stage.show(v, { effect: effect('cut'), outgoing: a });
    await clock.advance(STAGE_LIMITS.presentWaitMs - 1);
    assert.equal(a.disposed, false);
    await clock.advance(1);
    await showing;
    assert.equal(a.disposed, true);
    assert.equal(v.layer.style.opacity, '');
    assert.equal(clock.pending(), 0);
  }, { raf: () => 0 });
  // Sem a função de quadros: três prazos de ~17 ms.
  await withStage(async ({ clock, stage }) => {
    const a = await stage.prepare(image('a'), {});
    await stage.show(a, { effect: effect('cut'), outgoing: null });
    const v = await stage.prepare(video('v'), {});
    const showing = stage.show(v, { effect: effect('cut'), outgoing: a });
    await clock.advance(50);
    assert.equal(a.disposed, false);
    await clock.advance(1);
    await showing;
    assert.equal(a.disposed, true);
    assert.equal(clock.pending(), 0);
  }, { raf: null });
});

test('troca com efeito para um vídeo não espera: a camada nova entra por cima, ainda transparente, e a antiga fica inteira', () => withStage(async ({ clock, env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const v = await stage.prepare(video('v'), {});
  const showing = stage.show(v, { effect: effect('fade', 600), outgoing: a });
  await clock.advance(0);
  assert.ok(Number(v.layer.style.zIndex) > Number(a.layer.style.zIndex));
  assert.equal(env.animations.length, 1);
  assert.equal(env.animations[0].hadStandby, true, 'a animação começa antes de a camada aparecer');
  env.finishAll();
  await showing;
  assert.equal(a.disposed, true);
}));

test('troca que cai em corte seco por falha da animação também protege a chegada do vídeo', () => withStage(async ({ clock, env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const v = await stage.prepare(video('v'), {});
  v.layer.animate = () => { throw new Error('animação não suportada'); };
  const showing = stage.show(v, { effect: effect('fade', 600), outgoing: a });
  await clock.advance(0);
  assert.equal(a.disposed, false, 'a antiga continua à vista enquanto o vídeo é apresentado');
  assert.equal(v.layer.style.opacity, String(STAGE_LIMITS.warmOpacity));
  await clock.advance(48);
  await showing;
  assert.equal(a.disposed, true);
  assert.equal(v.layer.style.opacity, '');
  assert.equal(env.layers().filter(layer => !classes(layer).includes('is-standby')).length, 1);
}));

test('troca: mostrar algo já solto não faz nada', () => withStage(async ({ stage }) => {
  const a = await stage.prepare(image('a'), {});
  a.dispose();
  assert.deepEqual(await stage.show(a, { effect: effect('fade'), outgoing: null }), { frames: null });
}));

// ---- liberar memória -----------------------------------------------------------------------------------------------------------
test('soltar duas vezes é inofensivo; cada arquivo é liberado uma única vez', () => withStage(async ({ env, stage }) => {
  const prepared = await stage.prepare(video('v'), {});
  prepared.dispose();
  prepared.dispose();
  assert.deepEqual(env.source.released, ['fake://v']);
  assert.equal(env.layers().length, 0);
  assert.equal(stage.stats().alive, 0);
}));

test('limpar a tela solta todas as camadas (visível, saindo e pré-carregadas) e zera o empilhamento', () => withStage(async ({ clock, env, stage }) => {
  const a = await stage.prepare(image('a'), {});
  await stage.show(a, { effect: effect('cut'), outgoing: null });
  const b = await stage.prepare(video('b'), {});
  const c = await stage.prepare(image('c'), {});
  const showing = stage.show(b, { effect: effect('fade', 800), outgoing: a });
  await clock.advance(100);
  stage.clear();
  await showing;
  assert.equal(env.layers().length, 0);
  assert.deepEqual([a, b, c].map(prepared => prepared.disposed), [true, true, true]);
  assert.equal(env.running().length, 0);
  assert.deepEqual(env.source.released.sort(), ['fake://a', 'fake://b', 'fake://c']);
  const next = await stage.prepare(image('d'), {});
  await stage.show(next, { effect: effect('cut'), outgoing: null });
  assert.equal(next.layer.style.zIndex, '1', 'o empilhamento recomeça');
}));

test('uso prolongado: centenas de trocas não acumulam camadas nem arquivos abertos', () => withStage(async ({ clock, env, stage }) => {
  let outgoing = null;
  for (let turn = 0; turn < 300; turn++) {
    const next = await stage.prepare(turn % 3 === 0 ? video(`v${turn}`) : image(`i${turn}`), {});
    const showing = stage.show(next, { effect: effect(['fade', 'slide', 'zoom', 'dissolve', 'cut'][turn % 5], 300), outgoing });
    await clock.advance(0);
    env.finishAll();
    await clock.advance(STAGE_LIMITS.presentWaitMs); // corte seco para um vídeo espera o navegador apresentá-lo
    await showing;
    outgoing = next;
    assert.ok(env.layers().length <= 2, `volta ${turn}: ${env.layers().length} camadas`);
  }
  assert.equal(stage.stats().alive, 1);
  assert.equal(env.source.opened.length - env.source.released.length, 1, 'só o que está na tela continua aberto');
  assert.equal(env.running().length, 0);
}));

// ---- capacidades do aparelho ---------------------------------------------------------------------------------------------------
test('capacidades: animações dependem do navegador; movimento reduzido vem da preferência do sistema', () => {
  const modern = detectCapabilities({ Element: { prototype: { animate() {} } }, matchMedia: query => ({ matches: query.includes('reduce') }) });
  assert.equal(modern.animations(), true);
  assert.equal(modern.reducedMotion(), true);
  const old = detectCapabilities({ Element: { prototype: {} }, matchMedia: () => ({ matches: false }) });
  assert.equal(old.animations(), false);
  assert.equal(old.reducedMotion(), false);
  const bare = detectCapabilities({});
  assert.deepEqual([bare.animations(), bare.reducedMotion()], [false, false]);
  const broken = detectCapabilities({ matchMedia() { throw new Error('indisponível'); } });
  assert.equal(broken.reducedMotion(), false);
});

// ---- o desenho é o mesmo na TV e na pré-visualização ---------------------------------------------------------------------------------
// A prévia do painel usa o mesmo motor e as mesmas camadas do player. Se as regras de desenho se afastarem (por exemplo, a camada de
// espera escondida de outro jeito), a prévia deixaria de mostrar o que a TV mostra.
const stylesheet = name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const declarationsOf = (text, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&');
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(text);
  assert.ok(match, `regra não encontrada: ${selector}`);
  return match[1].split(';').map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();
};

test('estilo: as camadas da exibição são desenhadas igual no player e na pré-visualização do painel', async () => {
  const [player, panel] = await Promise.all([stylesheet('player.css'), stylesheet('panel.css')]);
  const pairs = [
    ['.stage-layer', '.preview-stage .stage-layer'],
    ['.stage-layer.is-standby', '.preview-stage .stage-layer.is-standby'],
    ['.stage-layer>img,.stage-layer>video,.stage-layer>iframe', '.preview-stage .stage-layer>img,.preview-stage .stage-layer>video,.preview-stage .stage-layer>iframe']
  ];
  for (const [tv, preview] of pairs) assert.deepEqual(declarationsOf(panel, preview), declarationsOf(player, tv), `${tv} × ${preview}`);
  // Decisão de projeto: a camada de espera fica só transparente (nada de display:none), para já estar desenhada quando a troca acontecer.
  // O efeito disso na tela é conferido no Chromium (tests/e2e/playback.e2e.mjs).
  assert.deepEqual(declarationsOf(player, '.stage-layer.is-standby'), ['opacity:0', 'pointer-events:none']);
});
