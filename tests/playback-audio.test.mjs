// Exercita as Promises reais de start()/play(), com políticas de autoplay e relógio injetados.
// O DOM simula o navegador: a autorização do navegador e o áudio da TV exigem validação no aparelho.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStage } from '../public/js/playback/stage.js';
import { createMediaEnvironment } from './helpers/fake-media-dom.mjs';
import { createFakeClock, make } from './helpers/playback-fakes.mjs';
import { createPlayerKit, entry } from './helpers/player-kit.mjs';
import { FakeEvent } from './helpers/fake-dom.mjs';

const denied = () => Object.assign(new Error('autoplay bloqueado'), { name: 'NotAllowedError' });
const video = (id, extra = {}) => entry(id, { name: `${id}.mp4`, type: 'video/mp4', ...extra });
const clip = id => make(id, { type: 'video/mp4' });
const cut = { name: 'cut', ms: 0 };

async function stageKit(run, scripts = {}) {
  const clock = createFakeClock(), env = createMediaEnvironment({ clock, scripts }), states = [];
  const stage = createStage({ root: env.root, doc: env.document, source: env.source, timers: clock, raf: env.raf, cancelRaf: env.cancelRaf, onAudioState: state => states.push(state) });
  try { await run({ stage, env, clock, states }); }
  finally { stage.clear(); await clock.advance(0); assert.equal(clock.pending(), 0); env.restore(); }
}

async function playerKit(options, run) {
  const kit = createPlayerKit(options);
  try { await kit.settle(0); await run(kit); } finally { await kit.close(); }
}

test('áudio: bloqueio faz um fallback mudo; gesto chama play síncrono e libera o som', async () => {
  let gesture = false;
  await stageKit(async ({ stage, env, states, clock }) => {
    const current = await stage.prepare(clip('v'));
    await stage.show(current, { effect: cut });
    await current.start();
    const node = current.layer.querySelector('video');
    assert.deepEqual(env.log.filter(row => row[0] === 'play').map(row => row.slice(2)), [[false, 1], [true, 1]]);
    assert.equal(node.paused, false);
    assert.deepEqual(stage.audioState(), { muted: true, userMuted: false, blocked: true, hasVideo: true, volume: 1 });
    await clock.advance(60_000);
    assert.equal(node.plays, 2, 'não tenta novamente em temporizador');
    gesture = true;
    const activation = stage.activateAudio();
    assert.equal(node.plays, 3, 'play é chamado antes de qualquer await, dentro do gesto');
    gesture = false;
    await activation;
    assert.equal(node.muted, false);
    assert.equal(node.volume, 1);
    assert.equal(stage.audioState().blocked, false);
    assert.ok(states.some(state => state.blocked));
  }, { v: { play(node) { if (!gesture && !node.muted) return Promise.reject(denied()); node.paused = false; return Promise.resolve(); } } });
});

test('áudio: silenciar é preferência da sessão, inclusive no próximo vídeo, repetição e atualização', () => stageKit(async ({ stage, env }) => {
  const first = await stage.prepare(clip('a'));
  const oldNode = first.layer.querySelector('video');
  await first.start();
  await stage.setMuted(true);
  assert.equal(oldNode.muted, true);
  const second = await stage.prepare(clip('b'));
  const node = second.layer.querySelector('video');
  assert.equal(node.paused, true, 'pré-carregamento não toca');
  first.dispose();
  await stage.show(second, { effect: cut });
  await second.start();
  await second.restart();
  assert.ok(env.log.filter(row => row[0] === 'play' && row[1] === 'b').every(row => row[2]));
  stage.clear();
  const third = await stage.prepare(clip('c'));
  assert.ok([oldNode, node].includes(third.layer.querySelector('video')), 'elemento liberado é reutilizado');
  await third.start();
  assert.equal(third.layer.querySelector('video').muted, true);
  assert.equal(stage.audioState().userMuted, true);
}));

test('áudio: ativar o som não retoma vídeo pausado', () => stageKit(async ({ stage }) => {
  const current = await stage.prepare(clip('a'));
  const node = current.layer.querySelector('video');
  await current.start();
  await stage.setMuted(true);
  current.pause();
  const plays = node.plays;
  await stage.activateAudio();
  assert.equal(node.muted, false);
  assert.equal(node.paused, true);
  assert.equal(node.plays, plays);
}));

test('áudio: autorização de um elemento não presume autorização para o próximo', () => stageKit(async ({ stage, clock }) => {
  const first = await stage.prepare(clip('a'));
  await stage.show(first, { effect: cut });
  await first.start();
  await stage.activateAudio();
  const second = await stage.prepare(clip('b'));
  const showing = stage.show(second, { effect: cut, outgoing: first });
  await second.start();
  await clock.advance(48);
  await showing;
  assert.equal(stage.audioState().blocked, true, 'novo elemento também respeita o bloqueio do navegador');
  const node = second.layer.querySelector('video');
  assert.equal(node.plays, 2);
  assert.equal(node.muted, true);
  await second.restart();
  assert.equal(node.plays, 3, 'repetição só faz a tentativa já muda, sem ciclo de áudio bloqueado');
  assert.equal(stage.audioState().blocked, true);
}, { b: { autoplay: 'blocked-audible' } }));

test('áudio: troca pausa o anterior antes de tocar o novo, mantendo o quadro durante o efeito', () => stageKit(async ({ stage, env }) => {
  const first = await stage.prepare(clip('a'));
  await stage.show(first, { effect: cut });
  await first.start();
  const node = first.layer.querySelector('video');
  const second = await stage.prepare(clip('b'));
  const showing = stage.show(second, { effect: { name: 'fade', ms: 800 }, outgoing: first });
  assert.equal(node.paused, true, 'som cessa no início do efeito');
  assert.equal(first.disposed, false, 'quadro permanece até terminar o efeito');
  await second.start();
  const playIndex = env.log.findIndex(row => row[0] === 'play' && row[1] === 'b');
  const pauseIndex = env.log.findIndex(row => row[0] === 'pause' && row[1] === 'a');
  assert.ok(pauseIndex >= 0 && pauseIndex < playIndex);
  env.finishAll();
  await showing;
  assert.equal(first.disposed, true);
}));

test('áudio: resolução atrasada de play após pausar não religa som', async () => {
  let resolvePlay;
  await stageKit(async ({ stage }) => {
    const current = await stage.prepare(clip('v'));
    const node = current.layer.querySelector('video');
    const pending = current.start();
    current.pause();
    node.paused = false; // simula implementação que confirma início depois de pause()
    resolvePlay();
    await pending;
    assert.equal(node.paused, true);
  }, { v: { play() { return new Promise(resolve => { resolvePlay = resolve; }); } } });
});

test('áudio: rejeição atrasada de conteúdo descartado não inicia fallback nem altera o próximo', async () => {
  let rejectPlay;
  await stageKit(async ({ stage }) => {
    const first = await stage.prepare(clip('a'));
    const node = first.layer.querySelector('video');
    const pending = first.start();
    first.dispose();
    const second = await stage.prepare(clip('b'));
    await second.start();
    const plays = node.plays;
    rejectPlay(denied());
    await pending;
    assert.equal(node.plays, plays);
    assert.equal(second.layer.querySelector('video').paused, false);
    assert.equal(stage.audioState().blocked, false);
  }, { a: { play() { return new Promise((_, reject) => { rejectPlay = reject; }); } } });
});

test('player: fallback fica visível, M e tecla de controle remoto ativam/silenciam o áudio', () => playerKit({
  manifestItems: [video('v', { duration: 120 })], scripts: { v: { duration: 120, autoplay: 'blocked-audible' } }
}, async kit => {
  const node = kit.topLayer().querySelector('video');
  assert.equal(kit.text('audio-toggle'), 'Ativar áudio');
  assert.equal(kit.visible('audio-notice'), true);
  assert.equal(node.muted, true);
  await kit.settle(6_100);
  assert.equal(kit.byId('control-dock').classList.contains('quiet'), false, 'aviso não desaparece sozinho');
  kit.scripts.v.autoplay = undefined;
  const oldPlays = node.plays;
  const key = kit.key('M');
  assert.equal(key.defaultPrevented, true);
  assert.equal(node.plays, oldPlays + 1);
  await kit.settle(0);
  assert.equal(node.muted, false);
  assert.equal(kit.text('audio-toggle'), 'Silenciar');
  assert.equal(kit.visible('audio-notice'), false);
  kit.key('AudioVolumeMute');
  assert.equal(node.muted, true);
  assert.equal(kit.text('audio-toggle'), 'Ativar som');
  kit.click('play-toggle');
  kit.click('audio-toggle');
  assert.equal(node.muted, false);
  assert.equal(node.paused, true, 'ativar som não muda a pausa');
}));

test('player: bloqueio também sem som pausa sem pular item, sem retries; Reproduzir retoma após gesto', () => playerKit({
  manifestItems: [video('v', { duration: 60 }), entry('next')], scripts: { v: { duration: 60, autoplay: 'blocked' } }
}, async kit => {
  const node = kit.topLayer().querySelector('video');
  assert.equal(node.plays, 2);
  assert.equal(kit.player.carousel.snapshot().playing, false);
  assert.match(kit.text('announcement'), /Use Reproduzir/);
  await kit.settle(30_000);
  assert.equal(kit.topId(), 'v');
  assert.equal(node.plays, 2);
  assert.equal(kit.status().includes('pulado'), false);
  kit.scripts.v.autoplay = undefined;
  kit.click('audio-toggle');
  kit.click('play-toggle');
  assert.equal(node.plays, 3);
  assert.equal(node.muted, false);
  assert.equal(node.paused, false);
}));

test('player: ao expirar o tempo ou navegar, áudio para enquanto o próximo conteúdo ainda carrega', () => playerKit({
  manifestItems: [video('v', { duration: 5 }), entry('slow')], scripts: { v: { duration: 30 }, slow: { decode: 'hang' } }
}, async kit => {
  const node = kit.topLayer().querySelector('video');
  await kit.settle(5_000);
  assert.equal(kit.topId(), 'v', 'último quadro permanece');
  assert.equal(node.paused, true, 'áudio não continua durante carregamento');
  kit.click('play-toggle');
  kit.click('play-toggle');
  await kit.settle(0);
  assert.equal(node.paused, true, 'ao retomar após fim do tempo o próximo continua sendo aguardado');
}));

test('player: final sem repetição preserva imagem e interrompe vídeo longo imediatamente', () => playerKit({
  loop: false, manifestItems: [video('v', { duration: 5 })], scripts: { v: { duration: 30 } }
}, async kit => {
  const node = kit.topLayer().querySelector('video');
  await kit.settle(5_000);
  assert.equal(kit.player.carousel.snapshot().state, 'finished');
  assert.equal(node.paused, true);
  assert.equal(kit.topId(), 'v');
  kit.click('audio-toggle');
  kit.click('audio-toggle');
  assert.equal(node.paused, true);
}));

test('player: atualização após fim sem repetição reinicia o vídeo adotado na nova programação', () => playerKit({
  loop: false, manifestItems: [video('v', { duration: 5 })], scripts: { v: { duration: 30 } }
}, async kit => {
  const node = kit.topLayer().querySelector('video');
  node.currentTime = 5;
  await kit.settle(5_000);
  assert.equal(node.paused, true);
  kit.server.state.items = [video('v', { duration: 8 })];
  await kit.player.poll();
  assert.equal(kit.player.carousel.snapshot().state, 'running');
  assert.equal(node.currentTime, 0);
  assert.equal(node.paused, false);
}));

test('player: fim natural pausa na hora, e revogação retira vídeo e som', () => playerKit({
  manifestItems: [video('v', { durationMode: 'natural' }), video('w')], scripts: { v: { duration: 30 }, w: { duration: 30 } }
}, async kit => {
  const first = kit.topLayer().querySelector('video');
  first.dispatchEvent(new FakeEvent('ended'));
  assert.equal(first.paused, true);
  await kit.settle(0);
  const second = kit.topLayer().querySelector('video');
  assert.equal(second.paused, false);
  kit.server.state.revoked = true;
  await kit.player.poll();
  assert.equal(second.paused, true);
  assert.equal(kit.layers().length, 0);
  assert.equal(kit.visible('pairing'), true);
}));
