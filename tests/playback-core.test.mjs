// Fase 2 — regras puras da reprodução (sem navegador): modelo do item, tempos, efeitos, desempenho, cache e memória de posição.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TRANSITION_NAMES, kindOfType, normalizeItem, normalizeItems, hashText, sequenceSignature, cycleEstimate } from '../public/js/playback/model.js';
import { dwellPlan, nextIndex, wrapIndex, pickPlayable, retryDelay, pollDelay, NATURAL_GRACE_MS } from '../public/js/playback/timing.js';
import {
  EFFECTS, EFFECT_LABELS, EFFECT_HELP, TIERS, resolveEffect, lowerTier, judgeFrames, FRAME_RULES, createTierKeeper, simplifiedReasonText, TIER_TTL_MS
} from '../public/js/playback/effects.js';
import { createBlobCache } from '../public/js/playback/media-cache.js';
import { saveProgress, loadProgress, clearProgress, RESUME_MAX_AGE_MS } from '../public/js/playback/recovery.js';
import { createMemoryStorage, make } from './helpers/playback-fakes.mjs';

const pick = item => ({ transition: item.transition, transitionMs: item.transitionMs });

// ---- modelo -----------------------------------------------------------------------------------------------------------------------
test('modelo: tipos de arquivo viram a espécie de conteúdo', () => {
  assert.equal(kindOfType('image/png'), 'image');
  assert.equal(kindOfType('image/webp'), 'image');
  assert.equal(kindOfType('video/mp4'), 'video');
  assert.equal(kindOfType('video/webm'), 'video');
  assert.equal(kindOfType('application/pdf'), 'pdf');
  assert.equal(kindOfType('application/x-tvcorp-html'), 'html');
  assert.equal(kindOfType('text/plain'), 'other');
  assert.equal(kindOfType(undefined), 'other');
});

test('modelo: o item do servidor (segundos) vira o item do carrossel (milissegundos) com limites e padrões', () => {
  const item = normalizeItem({ id: 'm1', title: 'Aviso', type: 'image/png', url: '/api/media/m1/file', duration: 12, transition: 'slide', transitionMs: 800 }, 3);
  assert.deepEqual(item, { key: '3:m1', id: 'm1', title: 'Aviso', type: 'image/png', kind: 'image', url: '/api/media/m1/file', durationMs: 12000, durationMode: 'fixed', transition: 'slide', transitionMs: 800 });

  // Limites: 5 s a 1 h; texto inválido usa o padrão de 15 s.
  assert.equal(normalizeItem({ type: 'image/png', duration: 1 }).durationMs, 5000);
  assert.equal(normalizeItem({ type: 'image/png', duration: 99999 }).durationMs, 3600000);
  assert.equal(normalizeItem({ type: 'image/png', duration: 'abc' }).durationMs, 15000);
  assert.equal(normalizeItem({ type: 'image/png' }).durationMs, 15000);
  // Transição: corte seco não tem duração; efeito sem duração informada usa 600 ms; limite de 3 s; nome desconhecido vira corte.
  assert.equal(normalizeItem({ type: 'image/png', transition: 'cut', transitionMs: 900 }).transitionMs, 0);
  assert.equal(normalizeItem({ type: 'image/png', transition: 'fade' }).transitionMs, 600);
  assert.equal(normalizeItem({ type: 'image/png', transition: 'zoom', transitionMs: 99999 }).transitionMs, 3000);
  assert.deepEqual(pick(normalizeItem({ type: 'image/png', transition: 'explodir', transitionMs: 500 })), { transition: 'cut', transitionMs: 0 }, 'efeito desconhecido vira corte seco');
  // Efeito com duração zero é corte seco (nunca "fade de 0 ms").
  assert.deepEqual(pick(normalizeItem({ type: 'image/png', transition: 'fade', transitionMs: 0 })), { transition: 'cut', transitionMs: 0 });
});

test('modelo: servidor da versão anterior (sem os campos novos) continua funcionando como antes', () => {
  const old = normalizeItem({ id: 'm9', title: 'Antigo', type: 'video/mp4', url: '/api/media/m9/file', duration: 30 });
  assert.equal(old.durationMode, 'fixed');
  assert.equal(old.transition, 'cut');
  assert.equal(old.transitionMs, 0);
  assert.equal(old.durationMs, 30000);
});

test('modelo: duração natural só vale para vídeo; internamente aceita tempos curtos (demonstração)', () => {
  assert.equal(normalizeItem({ type: 'video/mp4', durationMode: 'natural' }).durationMode, 'natural');
  assert.equal(normalizeItem({ type: 'image/png', durationMode: 'natural' }).durationMode, 'fixed');
  assert.equal(normalizeItem({ type: 'application/pdf', durationMode: 'natural' }).durationMode, 'fixed');
  assert.equal(normalizeItem({ type: 'image/png', durationMs: 1500 }).durationMs, 1500);
  assert.equal(normalizeItem({ type: 'image/png', durationMs: 10 }).durationMs, 500, 'nunca menos de meio segundo');
  const render = () => {};
  assert.equal(normalizeItem({ type: 'application/x-tvcorp-html', render }).render, render);
  assert.equal(normalizeItem(null).title, 'Conteúdo');
  assert.equal(normalizeItem({ title: 'x'.repeat(500) }).title.length, 160);
  assert.deepEqual(normalizeItems(undefined), []);
  assert.deepEqual(normalizeItems([{ id: 'a' }, { id: 'b' }]).map(item => item.key), ['0:a', '1:b']);
});

test('modelo: assinatura da sequência muda com qualquer coisa que altere a exibição, e não com a repetição', () => {
  const base = [make('a', { duration: 10 }), make('b', { duration: 20, transition: 'fade', transitionMs: 500 })];
  const same = [make('a', { duration: 10 }), make('b', { duration: 20, transition: 'fade', transitionMs: 500 })];
  assert.equal(sequenceSignature(base), sequenceSignature(same));
  for (const changed of [
    [make('a', { duration: 11 }), base[1]],
    [base[0], make('b', { duration: 20, transition: 'zoom', transitionMs: 500 })],
    [base[0], make('b', { duration: 20, transition: 'fade', transitionMs: 900 })],
    [base[0], make('b', { type: 'video/mp4', duration: 20, transition: 'fade', transitionMs: 500 })],
    [base[0], make('b', { type: 'video/mp4', durationMode: 'natural', duration: 20, transition: 'fade', transitionMs: 500 })],
    [base[1], base[0]]
  ]) assert.notEqual(sequenceSignature(changed), sequenceSignature(base));
  // Isolado: o mesmo vídeo, só com outro modo de duração (limite × até o fim), é outra exibição.
  const videoLimit = make('b', { type: 'video/mp4', duration: 20, transition: 'fade', transitionMs: 500 });
  const videoNatural = make('b', { type: 'video/mp4', durationMode: 'natural', duration: 20, transition: 'fade', transitionMs: 500 });
  assert.notEqual(sequenceSignature([base[0], videoLimit]), sequenceSignature([base[0], videoNatural]), 'só o modo de duração mudou');
  assert.notEqual(hashText('a'), hashText('b'));
  assert.equal(hashText('tvcorp'), hashText('tvcorp'));
  assert.match(hashText('x'), /^[0-9a-f]{8}$/);
});

test('modelo: estimativa do ciclo soma os tempos definidos e conta os vídeos em duração natural à parte', () => {
  const list = [make('a', { duration: 10 }), make('v', { type: 'video/mp4', durationMode: 'natural', duration: 15 }), make('b', { duration: 25 })];
  assert.deepEqual(cycleEstimate(list), { fixedMs: 35000, naturalVideos: 1 });
  assert.deepEqual(cycleEstimate([]), { fixedMs: 0, naturalVideos: 0 });
});

// ---- tempos ----------------------------------------------------------------------------------------------------------------------
test('tempos: imagem, PDF e conteúdo interno ficam o tempo definido, nunca menos que a própria transição', () => {
  for (const type of ['image/png', 'application/pdf', 'application/x-tvcorp-html']) {
    assert.deepEqual(dwellPlan(make('x', { type, duration: 10 }), { transitionMs: 600 }), { mode: 'timer', ms: 10000, capMs: null }, type);
  }
  // Conteúdo mais curto que a transição (só possível em itens internos): espera a transição acabar.
  const short = normalizeItem({ type: 'image/png', durationMs: 500 });
  assert.equal(dwellPlan(short, { transitionMs: 3000 }).ms, 3000);
});

test('tempos: vídeo com tempo definido é um LIMITE; sem duração conhecida vale o tempo definido', () => {
  const limited = make('v', { type: 'video/mp4', duration: 20 });
  assert.equal(dwellPlan(limited, { naturalMs: 60000 }).ms, 20000, 'vídeo de 60 s com limite de 20 s sai aos 20 s');
  assert.equal(dwellPlan(limited, { naturalMs: 8000 }).ms, 8000, 'vídeo de 8 s com limite de 20 s sai ao terminar (8 s)');
  assert.equal(dwellPlan(limited, { naturalMs: null }).ms, 20000, 'sem saber a duração do vídeo, vale o limite');
  assert.equal(dwellPlan(limited, { naturalMs: NaN }).ms, 20000);
  assert.equal(dwellPlan(limited, { naturalMs: 0 }).ms, 20000);
  assert.equal(dwellPlan(limited, { naturalMs: 1000, transitionMs: 2500 }).ms, 2500, 'vídeo mais curto que a transição espera a transição');
});

test('tempos: vídeo em duração natural toca até o fim, com prazo de segurança sempre definido', () => {
  const natural = make('v', { type: 'video/mp4', durationMode: 'natural', duration: 15 });
  assert.deepEqual(dwellPlan(natural, { naturalMs: 42000 }), { mode: 'media', ms: null, capMs: 42000 + NATURAL_GRACE_MS });
  assert.deepEqual(dwellPlan(natural, { naturalMs: 1000, transitionMs: 2500 }), { mode: 'media', ms: null, capMs: 2500 + NATURAL_GRACE_MS });
  // Aparelho que não consegue ler a duração: o tempo definido no item vira o prazo (nada prende o carrossel).
  assert.deepEqual(dwellPlan(natural, { naturalMs: null }), { mode: 'media', ms: null, capMs: 15000 });
  assert.deepEqual(dwellPlan(natural, { naturalMs: Infinity }), { mode: 'media', ms: null, capMs: 15000 });
});

test('tempos: navegação — a repetição decide se a sequência recomeça; Anterior/Próximo sempre dão a volta', () => {
  assert.equal(nextIndex(0, 3, true), 1);
  assert.equal(nextIndex(2, 3, true), 0);
  assert.equal(nextIndex(2, 3, false), null);
  assert.equal(nextIndex(0, 0, true), null);
  assert.equal(wrapIndex(-1, 3), 2);
  assert.equal(wrapIndex(3, 3), 0);
  assert.equal(wrapIndex(7, 3), 1);
  assert.equal(wrapIndex(5, 0), 0);
});

test('tempos: o próximo a exibir pula os bloqueados; sem repetição a sequência termina; sem alternativa devolve "none"', () => {
  const none = () => false;
  assert.equal(pickPlayable(0, 3, true, none), 1);
  assert.equal(pickPlayable(2, 3, true, none), 0);
  assert.equal(pickPlayable(2, 3, false, none), 'end');
  assert.equal(pickPlayable(0, 3, true, index => index === 1), 2, 'pula o bloqueado');
  assert.equal(pickPlayable(1, 3, true, index => index === 2), 0, 'pula o bloqueado dando a volta');
  assert.equal(pickPlayable(0, 3, true, index => index !== 0), 'none', 'todos os outros bloqueados');
  assert.equal(pickPlayable(0, 3, false, index => index === 1 || index === 2), 'end', 'sem repetição, o fim vem antes de voltar ao começo');
  assert.equal(pickPlayable(0, 1, true, none), 'none', 'um único conteúdo não tem "próximo"');
});

test('tempos: espera entre tentativas cresce e espalha as TVs; consulta da programação recua e volta ao normal', () => {
  assert.equal(retryDelay(0, { random: () => 0.5 }), 1000);
  assert.equal(retryDelay(1, { random: () => 0.5 }), 3000);
  assert.equal(retryDelay(9, { random: () => 0.5 }), 3000, 'depois da última da lista, repete a última');
  assert.equal(retryDelay(0, { random: () => 0 }), 800);
  assert.equal(retryDelay(0, { random: () => 1 }), 1200);
  assert.equal(pollDelay(0), 20000);
  assert.equal(pollDelay(1, { random: () => 0.5 }), 5000);
  assert.equal(pollDelay(2, { random: () => 0.5 }), 10000);
  assert.equal(pollDelay(3, { random: () => 0.5 }), 20000);
  assert.equal(pollDelay(30, { random: () => 0.5 }), 20000, 'nunca passa do intervalo normal');
  assert.ok(pollDelay(1, { random: () => 0 }) < pollDelay(1, { random: () => 1 }));
});

// ---- efeitos ---------------------------------------------------------------------------------------------------------------------
test('efeitos: os cinco efeitos existem, com nome, ajuda e movimento definidos', () => {
  assert.deepEqual([...TRANSITION_NAMES].sort(), Object.keys(EFFECTS).sort());
  assert.deepEqual(Object.keys(EFFECT_LABELS).sort(), [...TRANSITION_NAMES].sort());
  assert.deepEqual(Object.keys(EFFECT_HELP).sort(), [...TRANSITION_NAMES].sort());
  assert.equal(EFFECTS.cut, null);
  for (const name of TRANSITION_NAMES.filter(name => name !== 'cut')) {
    const effect = EFFECTS[name];
    assert.ok(effect.enter.keyframes.length >= 2, `${name}: a camada que entra anima`);
    assert.ok(effect.enter.easing, name);
    // Nada de tela preta: a camada que SAI nunca fica transparente durante a troca.
    for (const frame of effect.exit?.keyframes ?? []) assert.equal(frame.opacity, undefined, `${name}: a camada que sai não muda de opacidade`);
    // A camada que entra termina totalmente visível e no lugar.
    const last = effect.enter.keyframes.at(-1);
    assert.ok(last.opacity === undefined || last.opacity === 1, name);
    assert.ok(last.transform === undefined || last.transform === 'translateX(0%)' || last.transform === 'scale(1)', name);
  }
  // Cada efeito é visivelmente diferente dos outros.
  const looks = TRANSITION_NAMES.filter(name => name !== 'cut').map(name => JSON.stringify(EFFECTS[name]));
  assert.equal(new Set(looks).size, looks.length);
  assert.ok(JSON.stringify(EFFECTS.dissolve).includes('blur'), 'dissolver usa desfoque, esmaecer não');
  assert.ok(!JSON.stringify(EFFECTS.fade).includes('blur'));
});

test('efeitos: o efeito pedido só é trocado por outro mais simples quando há motivo, e o motivo é informado', () => {
  const ask = (requested, extra = {}) => resolveEffect({ requested, ms: 700, ...extra });
  for (const name of ['fade', 'dissolve', 'slide', 'zoom']) {
    assert.deepEqual(ask(name), { name, ms: 700, requested: name, simplified: false, reason: '' }, name);
  }
  assert.deepEqual(ask('cut'), { name: 'cut', ms: 0, requested: 'cut', simplified: false, reason: '' });
  assert.deepEqual(resolveEffect({ requested: 'fade', ms: 0 }), { name: 'cut', ms: 0, requested: 'fade', simplified: false, reason: '' }, 'sem duração é corte');
  assert.deepEqual(ask('inexistente'), { name: 'cut', ms: 0, requested: 'cut', simplified: false, reason: '' });

  // Pessoa pediu menos movimento → só esmaecer.
  assert.deepEqual(ask('slide', { reducedMotion: true }), { name: 'fade', ms: 700, requested: 'slide', simplified: true, reason: 'reduced-motion' });
  assert.deepEqual(ask('zoom', { reducedMotion: true }).name, 'fade');
  assert.deepEqual(ask('dissolve', { reducedMotion: true }).name, 'fade');
  assert.deepEqual(ask('fade', { reducedMotion: true }), { name: 'fade', ms: 700, requested: 'fade', simplified: false, reason: '' }, 'esmaecer já é o efeito mais suave');
  // Aparelho com desempenho limitado.
  assert.deepEqual(ask('slide', { tier: 'reduced' }), { name: 'fade', ms: 700, requested: 'slide', simplified: true, reason: 'device-limited' });
  assert.deepEqual(ask('slide', { tier: 'minimal' }), { name: 'cut', ms: 0, requested: 'slide', simplified: true, reason: 'device-slow' });
  assert.deepEqual(ask('fade', { tier: 'minimal' }).name, 'cut');
  // Navegador sem animações.
  assert.deepEqual(ask('zoom', { animations: false }), { name: 'cut', ms: 0, requested: 'zoom', simplified: true, reason: 'no-animation-api' });
  // Todas as combinações terminam num efeito que existe, com duração coerente.
  for (const requested of TRANSITION_NAMES) for (const tier of TIERS) for (const reducedMotion of [false, true]) for (const animations of [false, true]) {
    const effect = resolveEffect({ requested, ms: 900, tier, reducedMotion, animations });
    assert.ok(Object.hasOwn(EFFECTS, effect.name));
    assert.equal(effect.ms === 0, effect.name === 'cut');
  }
  for (const reason of ['reduced-motion', 'device-limited', 'device-slow', 'no-animation-api']) assert.ok(simplifiedReasonText(reason).length > 5, reason);
  assert.equal(simplifiedReasonText(''), '');
});

test('desempenho: níveis descem um a um e param no último', () => {
  assert.deepEqual(TIERS, ['full', 'reduced', 'minimal']);
  assert.equal(lowerTier('full'), 'reduced');
  assert.equal(lowerTier('reduced'), 'minimal');
  assert.equal(lowerTier('minimal'), 'minimal');
  assert.equal(lowerTier('qualquer'), 'reduced');
});

test('desempenho: a TV é considerada lenta pela mediana dos quadros ou por engasgos, e amostra pequena não decide', () => {
  const steady = ms => Array.from({ length: 30 }, () => ms);
  assert.equal(judgeFrames([16, 17]).enough, false, 'poucos quadros: sem veredito');
  assert.equal(judgeFrames(steady(16.7)).slow, false, '60 quadros por segundo');
  assert.equal(judgeFrames(steady(33.3)).slow, false, '30 quadros por segundo ainda é aceitável');
  assert.equal(judgeFrames(steady(66)).slow, true, '15 quadros por segundo');
  const stutter = [...steady(16), ...Array.from({ length: 12 }, () => 120)];
  assert.equal(judgeFrames(stutter).slow, true, 'um quarto dos quadros muito lentos');
  const rare = [...steady(16), 120, 120];
  assert.equal(judgeFrames(rare).slow, false, 'um engasgo isolado não conta');
  assert.equal(judgeFrames([NaN, -1, 0, ...steady(16)]).slow, false, 'valores inválidos são ignorados');
  assert.ok(FRAME_RULES.minFrames >= 5);
  const verdict = judgeFrames(steady(50));
  assert.equal(verdict.medianMs, 50);
  assert.equal(verdict.stutterRatio, 0);
});

test('desempenho: duas transições lentas seguidas descem o nível; uma boa zera a contagem; o nível aprendido é lembrado por 7 dias', () => {
  let clock = 1_000_000;
  const storage = createMemoryStorage();
  const keeper = createTierKeeper({ storage, now: () => clock });
  const slow = { enough: true, slow: true }, good = { enough: true, slow: false };
  assert.equal(keeper.tier(), 'full');
  assert.equal(keeper.report(slow), null, 'a primeira não basta');
  assert.equal(keeper.report(good), null, 'uma boa zera');
  assert.equal(keeper.report(slow), null);
  assert.equal(keeper.report({ enough: false, slow: true }), null, 'amostra insuficiente é ignorada');
  assert.equal(keeper.report(slow), 'reduced');
  assert.equal(keeper.tier(), 'reduced');
  assert.equal(keeper.report(slow), null);
  assert.equal(keeper.report(slow), 'minimal');
  assert.equal(keeper.report(slow), null, 'já está no último nível');
  assert.equal(keeper.report(slow), null);
  assert.equal(keeper.tier(), 'minimal');
  assert.equal(JSON.parse(storage.get('tv-corporativa.playback-tier.v1')).tier, 'minimal');

  // Outra "ligação" da TV dentro de 7 dias: já começa no nível aprendido.
  clock += TIER_TTL_MS - 1000;
  assert.equal(createTierKeeper({ storage, now: () => clock }).tier(), 'minimal');
  // Passados 7 dias, testa de novo desde o nível completo.
  clock += 2000;
  assert.equal(createTierKeeper({ storage, now: () => clock }).tier(), 'full');
  // Um registro "do futuro" (o relógio da TV voltou no tempo) não vale: a idade dele seria negativa.
  storage.set('tv-corporativa.playback-tier.v1', JSON.stringify({ tier: 'minimal', at: clock + 60_000 }));
  assert.equal(createTierKeeper({ storage, now: () => clock }).tier(), 'full', 'registro gravado no futuro é ignorado');
  keeper.reset();
  assert.equal(keeper.tier(), 'full');
  assert.equal(storage.get('tv-corporativa.playback-tier.v1'), null);
});

test('desempenho: memória indisponível ou com lixo não derruba nada', () => {
  assert.equal(createTierKeeper({ storage: null }).tier(), 'full');
  assert.equal(createTierKeeper({ storage: createMemoryStorage({ 'tv-corporativa.playback-tier.v1': '{not json' }) }).tier(), 'full');
  assert.equal(createTierKeeper({ storage: createMemoryStorage({ 'tv-corporativa.playback-tier.v1': JSON.stringify({ tier: 'turbo', at: Date.now() }) }) }).tier(), 'full');
  const broken = { get: () => { throw new Error('bloqueado'); }, set: () => { throw new Error('bloqueado'); }, remove: () => { throw new Error('bloqueado'); } };
  const keeper = createTierKeeper({ storage: broken });
  assert.equal(keeper.report({ enough: true, slow: true }), null);
  assert.equal(keeper.report({ enough: true, slow: true }), 'reduced', 'o nível vale nesta exibição mesmo sem poder gravar');
  keeper.reset();
});

// ---- cache de arquivos -----------------------------------------------------------------------------------------------------------
const blob = size => new Blob([new Uint8Array(size)]);

test('cache: guarda arquivos na memória até o limite e descarta o menos usado primeiro', () => {
  const cache = createBlobCache({ budgetBytes: 100, maxEntries: 10 });
  assert.equal(cache.set('a', blob(40)), true);
  assert.equal(cache.set('b', blob(40)), true);
  assert.equal(cache.get('a').size, 40, 'usar "a" o torna o mais recente');
  assert.equal(cache.set('c', blob(40)), true);
  assert.equal(cache.has('b'), false, '"b" era o menos usado e saiu');
  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('c'), true);
  assert.deepEqual(cache.stats(), { entries: 2, bytes: 80, budgetBytes: 100 });
  assert.equal(cache.get('b'), undefined);
});

test('cache: arquivo maior que o limite não é guardado; limite de quantidade; regravar não soma duas vezes', () => {
  const cache = createBlobCache({ budgetBytes: 100, maxEntries: 2 });
  assert.equal(cache.set('grande', blob(101)), false);
  assert.equal(cache.has('grande'), false);
  assert.equal(cache.set('x', blob(10)), true);
  assert.equal(cache.set('x', blob(20)), true);
  assert.equal(cache.stats().bytes, 20);
  cache.set('y', blob(10));
  cache.set('z', blob(10));
  assert.equal(cache.stats().entries, 2, 'no máximo duas entradas');
  assert.equal(cache.has('x'), false);
  assert.equal(cache.set('nulo', null), false);
  assert.equal(cache.set('sem-tamanho', {}), false);
});

test('cache: a programação mudou → só ficam as chaves ainda usadas; limpar zera tudo', () => {
  const cache = createBlobCache();
  for (const key of ['a', 'b', 'c']) cache.set(key, blob(10));
  cache.retain(['b']);
  assert.deepEqual([cache.has('a'), cache.has('b'), cache.has('c')], [false, true, false]);
  assert.equal(cache.stats().bytes, 10);
  assert.equal(cache.delete('b'), true);
  assert.equal(cache.delete('b'), false);
  cache.set('d', blob(10));
  cache.clear();
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0, budgetBytes: 96 * 1024 * 1024 });
});

// ---- memória da posição ----------------------------------------------------------------------------------------------------------
test('retomada: guarda só posição e assinatura (nunca conteúdo) e só retoma a mesma programação, recente', () => {
  const storage = createMemoryStorage();
  const signature = sequenceSignature([make('a'), make('b'), make('c')]);
  saveProgress(storage, { signature, index: 2, at: 1_000_000 });
  const raw = storage.get('tv-corporativa.playback.v1');
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['i', 's', 't']);
  assert.ok(!raw.includes('/api/media'), 'nenhum endereço de arquivo é gravado');

  const at = now => loadProgress(storage, signature, { now, count: 3 });
  assert.equal(at(1_000_000 + 5000), 2);
  assert.equal(at(1_000_000 + RESUME_MAX_AGE_MS), 2);
  assert.equal(at(1_000_000 + RESUME_MAX_AGE_MS + 1), null, 'registro antigo demais');
  assert.equal(at(999_000), null, 'o relógio voltou no tempo');
  assert.equal(loadProgress(storage, sequenceSignature([make('a'), make('b'), make('x')]), { now: 1_000_100, count: 3 }), null, 'programação diferente, do mesmo tamanho: só a assinatura difere');
  assert.equal(loadProgress(storage, sequenceSignature([make('a'), make('b')]), { now: 1_000_100, count: 2 }), null, 'programação diferente e menor');
  assert.equal(loadProgress(storage, signature, { now: 1_000_100, count: 2 }), null, 'posição fora da lista');
  clearProgress(storage);
  assert.equal(at(1_000_100), null);
});

test('retomada: sem armazenamento, com armazenamento quebrado ou com lixo, nada acontece', () => {
  const signature = 'x';
  assert.doesNotThrow(() => saveProgress(null, { signature, index: 1, at: 1 }));
  assert.equal(loadProgress(null, signature, { now: 1, count: 3 }), null);
  const storage = createMemoryStorage();
  saveProgress(storage, { signature, index: -1, at: 1 });
  saveProgress(storage, { signature, index: 1.5, at: 1 });
  assert.equal(storage.data.size, 0, 'posições inválidas não são gravadas');
  storage.set('tv-corporativa.playback.v1', 'isto não é json');
  assert.equal(loadProgress(storage, signature, { now: 1, count: 3 }), null);
  storage.set('tv-corporativa.playback.v1', JSON.stringify({ s: 'a', i: 'dois', t: 'x' }));
  assert.equal(loadProgress(storage, signature, { now: 1, count: 3 }), null);
  const broken = { get: () => { throw new Error('bloqueado'); }, set: () => { throw new Error('bloqueado'); }, remove: () => { throw new Error('bloqueado'); } };
  assert.doesNotThrow(() => saveProgress(broken, { signature, index: 1, at: 1 }));
  assert.equal(loadProgress(broken, signature, { now: 1, count: 3 }), null);
  assert.doesNotThrow(() => clearProgress(broken));
});
