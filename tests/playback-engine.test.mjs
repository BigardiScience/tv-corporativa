// Fase 2 — motor do carrossel: ordem, tempo de cada conteúdo, vídeo, repetição, pausa e navegação.
// Roda em Node com um relógio de mentira: nenhum teste espera segundos de verdade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, sequence, make, permanent } from './helpers/playback-fakes.mjs';

const video = (id, extra = {}) => [id, { type: 'video/mp4', ...extra }];

// ---- ordem, tempo e transições -----------------------------------------------------------------------------------------------------
test('ordem e tempo: cada conteúdo fica o tempo definido, na ordem, e a sequência recomeça sozinha', async () => {
  const kit = rig();
  const list = sequence([
    ['a', { duration: 10 }],
    ['b', { duration: 20, transition: 'slide', transitionMs: 800 }],
    ['c', { type: 'application/pdf', duration: 5, transition: 'zoom', transitionMs: 500 }]
  ]);
  assert.equal(kit.carousel.load(list), 'started');
  assert.equal(kit.carousel.snapshot().state, 'loading', 'o primeiro conteúdo ainda está sendo preparado');
  await kit.clock.advance(0);
  assert.deepEqual(kit.timeline(), [['a', 0]]);
  assert.equal(kit.carousel.snapshot().state, 'running');

  await kit.clock.advance(9_999);
  assert.deepEqual(kit.ids(), ['a'], 'ainda não passou o tempo de "a"');
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 10_000]]);
  await kit.clock.advance(20_000);
  await kit.clock.advance(5_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 10_000], ['c', 30_000], ['a', 35_000]], 'depois do último volta ao primeiro');
  assert.equal(kit.carousel.snapshot().cycles, 1);
  // O primeiro conteúdo entra em corte seco; os demais usam o efeito configurado.
  assert.deepEqual(kit.renderer.shows.map(show => [show.effect, show.ms]), [['cut', 0], ['slide', 800], ['zoom', 500], ['cut', 0]]);
  await kit.close();
});

test('ordem e tempo: a duração de cada conteúdo é independente (cada um tem a sua)', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 5 }], ['b', { duration: 60 }], ['c', { duration: 7 }], ['d', { duration: 3600 }]]));
  await kit.clock.advance(72_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 5_000], ['c', 65_000], ['d', 72_000]]);
  await kit.clock.advance(3_599_999);
  assert.deepEqual(kit.ids(), ['a', 'b', 'c', 'd'], 'a hora cheia de "d" ainda não terminou');
  await kit.clock.advance(1);
  assert.deepEqual(kit.ids().slice(-1), ['a']);
  assert.equal(kit.renderer.shows.at(-1).at, 3_672_000);
  await kit.close();
});

test('ordem e tempo: o tempo conta desde o início da entrada, então a soma dos tempos é a duração do ciclo', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10, transition: 'fade', transitionMs: 2000 }], ['c', { duration: 10, transition: 'dissolve', transitionMs: 3000 }]]));
  await kit.clock.advance(60_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 10_000], ['c', 20_000], ['a', 30_000], ['b', 40_000], ['c', 50_000], ['a', 60_000]], 'ciclo de 30 s com ou sem efeito');
  await kit.close();
});

test('ordem e tempo: conteúdo mais curto que a própria transição espera a transição acabar (duas nunca se sobrepõem)', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { durationMs: 1000 }], ['b', { durationMs: 1000, transition: 'fade', transitionMs: 3000 }], ['c', { durationMs: 1000 }]]));
  await kit.clock.advance(5_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 1_000], ['c', 4_000], ['a', 5_000]]);
  await kit.close();
});

test('transição: o novo conteúdo é mostrado ANTES de o antigo sair, e a tela nunca é limpa entre conteúdos', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10, transition: 'fade', transitionMs: 1000 }], ['c', { duration: 10, transition: 'slide', transitionMs: 1000 }]]));
  await kit.clock.advance(60_000);
  const log = kit.renderer.log;
  assert.equal(kit.renderer.count('clear'), 0, 'nenhuma limpeza de tela durante a exibição normal');
  let checked = 0;
  log.forEach((entry, shownAt) => {
    if (entry[0] !== 'show' || entry[4] === null) return;
    const disposedAt = log.findIndex((other, position) => position > shownAt && other[0] === 'dispose' && other[1] === entry[4]);
    assert.ok(disposedAt > shownAt, `${entry[1]}: o anterior (${entry[4]}) só é solto depois de o novo ser mostrado`);
    checked++;
  });
  assert.ok(checked >= 5, `conferidas ${checked} trocas`);
  assert.ok(kit.renderer.maxLive <= 3, `no máximo atual + anterior + próximo (viu ${kit.renderer.maxLive})`);
  await kit.close();
});

// ---- pré-carregamento ------------------------------------------------------------------------------------------------------------
test('pré-carregamento: o próximo conteúdo já está pronto quando chega a hora, mesmo que demore para baixar', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 6_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(100);
  assert.equal(kit.renderer.count('prepare', '1:b'), 1, '"b" começa a ser preparado assim que "a" aparece');
  await kit.clock.advance(9_900);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 10_000]], 'sem atraso: a troca acontece exatamente na hora');
  assert.equal(kit.renderer.count('prepare', '1:b'), 1, 'e "b" não é baixado de novo');
  await kit.close();
});

test('pré-carregamento: se o próximo demora mais que o tempo do atual, o atual continua na tela (sem tela preta) até ele ficar pronto', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 15_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(14_999);
  assert.deepEqual(kit.ids(), ['a']);
  assert.equal(kit.renderer.shown.item.id, 'a', 'o antigo segue na tela esperando');
  assert.equal(kit.renderer.count('clear'), 0);
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 15_000]]);
  await kit.close();
});

test('pré-carregamento: nunca mais de três conteúdos vivos ao mesmo tempo, e sem baixar a mesma coisa duas vezes por volta', async () => {
  const kit = rig({ renderer: { latency: () => 300 } });
  kit.carousel.load(sequence([['a', { duration: 5, transition: 'fade', transitionMs: 1000 }], ['b', { duration: 5, transition: 'slide', transitionMs: 1000 }], ['c', { duration: 5, transition: 'zoom', transitionMs: 1000 }], ['d', { duration: 5 }]]));
  await kit.clock.advance(5 * 5 * 4 * 5);
  assert.ok(kit.renderer.maxLive <= 3, `vivos ao mesmo tempo: ${kit.renderer.maxLive}`);
  const shows = kit.renderer.shows.length;
  assert.ok(kit.renderer.count('prepare') - shows <= 1, `preparos (${kit.renderer.count('prepare')}) = exibições (${shows}) + no máximo o próximo`);
  await kit.close();
});

test('limite máximo: 15 conteúdos (o teto configurável da playlist) percorrem a ordem inteira, volta após volta, cada um no seu tempo', async () => {
  const kit = rig({ renderer: { latency: () => 200 } });
  const ids = Array.from({ length: 15 }, (_, index) => `c${String(index + 1).padStart(2, '0')}`);
  const list = sequence(ids.map((id, index) => [id, { duration: 5 + index, transition: index % 2 ? 'fade' : 'slide', transitionMs: 500 }]));
  assert.equal(list.length, 15);
  kit.carousel.load(list);
  const lapMs = ids.reduce((sum, _, index) => sum + (5 + index) * 1000, 0); // 5 + 6 + … + 19 = 180 s
  await kit.clock.advance(200 + lapMs * 2);
  const timeline = kit.timeline();
  assert.deepEqual(timeline.slice(0, 15).map(([id]) => id), ids, 'primeira volta, na ordem');
  assert.deepEqual(timeline.slice(15, 30).map(([id]) => id), ids, 'segunda volta, na mesma ordem');
  let expected = 200; // o primeiro conteúdo aparece quando fica pronto; os demais já estavam prontos por trás
  timeline.slice(0, 30).forEach(([id, at], index) => {
    assert.equal(at, expected, `${id} (posição ${index + 1}): hora de entrada`);
    expected += (5 + (index % 15)) * 1000;
  });
  assert.equal(kit.carousel.snapshot().cycles, 2, 'duas voltas completas');
  assert.ok(kit.renderer.maxLive <= 3, `vivos ao mesmo tempo: ${kit.renderer.maxLive}`);
  await kit.close();
});

// ---- vídeo -------------------------------------------------------------------------------------------------------------------------
test('vídeo em duração natural: avança quando o vídeo termina', async () => {
  const kit = rig({ renderer: { natural: { v: 7_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural', duration: 30 }), ['b', { duration: 10 }]]));
  await kit.clock.advance(6_999);
  assert.deepEqual(kit.ids(), ['v']);
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['v', 0], ['b', 7_000]], 'saiu ao fim dos 7 s do vídeo, não aos 30 s do tempo definido');
  assert.equal(kit.renderer.count('start', '0:v'), 1);
  await kit.close();
});

test('vídeo em duração natural: se o fim não for avisado, o prazo de segurança (duração + 2 s) libera o carrossel', async () => {
  const kit = rig({ renderer: { natural: { v: 7_000 }, autoEnd: false } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural', duration: 30 }), ['b', { duration: 10 }]]));
  await kit.clock.advance(8_999);
  assert.deepEqual(kit.ids(), ['v']);
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['v', 0], ['b', 9_000]]);
  await kit.close();
});

test('vídeo em duração natural: se o aparelho não sabe a duração, vale o tempo definido como prazo', async () => {
  const kit = rig();
  kit.carousel.load(sequence([video('v', { durationMode: 'natural', duration: 9 }), ['b', { duration: 10 }]]));
  await kit.clock.advance(9_000);
  assert.deepEqual(kit.timeline(), [['v', 0], ['b', 9_000]]);
  await kit.close();
});

test('vídeo com tempo definido: o tempo é um limite (vídeo mais longo é cortado, mais curto termina antes)', async () => {
  const longer = rig({ renderer: { natural: { v: 60_000 } } });
  longer.carousel.load(sequence([video('v', { duration: 12 }), ['b', { duration: 10 }]]));
  await longer.clock.advance(12_000);
  assert.deepEqual(longer.timeline(), [['v', 0], ['b', 12_000]], 'vídeo de 60 s com limite de 12 s');
  await longer.close();

  const shorter = rig({ renderer: { natural: { v: 7_000 } } });
  shorter.carousel.load(sequence([video('v', { duration: 20 }), ['b', { duration: 10 }]]));
  await shorter.clock.advance(7_000);
  assert.deepEqual(shorter.timeline(), [['v', 0], ['b', 7_000]], 'vídeo de 7 s com limite de 20 s');
  await shorter.close();

  const unknown = rig();
  unknown.carousel.load(sequence([video('v', { duration: 12 }), ['b', { duration: 10 }]]));
  await unknown.clock.advance(12_000);
  assert.deepEqual(unknown.timeline(), [['v', 0], ['b', 12_000]], 'duração desconhecida: vale o limite');
  await unknown.close();
});

test('vídeo mais curto que a transição de entrada: espera a transição acabar antes de seguir', async () => {
  const kit = rig({ renderer: { natural: { v: 1_000 } } });
  kit.carousel.load(sequence([['a', { duration: 5 }], video('v', { durationMode: 'natural', transition: 'fade', transitionMs: 2500 }), ['b', { duration: 10 }]]));
  await kit.clock.advance(20_000);
  assert.deepEqual(kit.timeline().slice(0, 3), [['a', 0], ['v', 5_000], ['b', 7_500]], 'vídeo de 1 s com transição de 2,5 s sai aos 2,5 s');
  await kit.close();
});

test('vídeo: o vídeo só começa a tocar quando é mostrado, e é solto ao sair', async () => {
  const kit = rig({ renderer: { natural: { v: 4_000 } } });
  kit.carousel.load(sequence([['a', { duration: 5 }], video('v', { durationMode: 'natural' }), ['b', { duration: 5 }]]));
  await kit.clock.advance(4_999);
  assert.equal(kit.renderer.count('start', '1:v'), 0, 'preparado, mas parado, enquanto "a" está na tela');
  await kit.clock.advance(1);
  assert.equal(kit.renderer.count('start', '1:v'), 1);
  await kit.clock.advance(4_000);
  assert.deepEqual(kit.ids(), ['a', 'v', 'b']);
  assert.equal(kit.renderer.log.some(entry => entry[0] === 'dispose' && entry[1] === '1:v'), true, 'o vídeo que saiu foi liberado');
  await kit.close();
});

test('vídeo: o motor só ouve o fim e o erro do conteúdo que está na tela — o que sai, o que é adotado e o que é parado não ficam com ouvintes sobrando', async () => {
  const kit = rig({ renderer: { natural: { v: 6_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await kit.clock.advance(0);
  const first = kit.renderer.preparedOf('v');
  assert.equal(first.listeners, 2, 'na tela: ouve o fim e o erro');
  assert.equal(kit.renderer.preparedOf('b').listeners, 0, 'pré-carregado, mas ainda fora da tela: ninguém o ouve');
  assert.equal(kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['c', { duration: 10 }]])), 'adopted');
  assert.equal(first.listeners, 2, 'programação nova que mantém o conteúdo da tela: continua com um par de ouvintes, não dois');
  await kit.clock.advance(6_000);
  assert.deepEqual(kit.ids(), ['v', 'c']);
  assert.equal(first.listeners, 0, 'o vídeo saiu da tela: deixa de ser ouvido');
  const second = kit.renderer.preparedOf('c');
  assert.equal(second.listeners, 2);
  kit.carousel.stop();
  assert.equal(second.listeners, 0, 'parar também solta os ouvintes');
  await kit.close();
});

// ---- repetição ---------------------------------------------------------------------------------------------------------------------
test('repetição desligada: ao fim da sequência o último conteúdo permanece e a exibição fica "finalizada"', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 5 }], ['b', { duration: 5 }]]), { loop: false });
  await kit.clock.advance(10_000);
  const snapshot = kit.carousel.snapshot();
  assert.equal(snapshot.state, 'finished');
  assert.equal(snapshot.loop, false);
  assert.equal(snapshot.progress, 1);
  assert.equal(kit.of('finished').length, 1);
  assert.equal(kit.renderer.shown.item.id, 'b', 'o último conteúdo continua na tela');
  assert.equal(kit.renderer.count('clear'), 0);
  await kit.clock.advance(300_000);
  assert.deepEqual(kit.ids(), ['a', 'b'], 'nada acontece sozinho depois do fim');
  assert.equal(kit.renderer.live, 1, 'e nada fica pré-carregado à toa');
  await kit.close();
});

test('repetição desligada: tocar em "Reproduzir" depois do fim recomeça do primeiro; ligar a repetição também recomeça', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 5 }], ['b', { duration: 5 }]]), { loop: false });
  await kit.clock.advance(10_000);
  assert.equal(kit.carousel.snapshot().state, 'finished');
  kit.carousel.play();
  await kit.clock.advance(0);
  assert.deepEqual(kit.ids(), ['a', 'b', 'a']);
  assert.equal(kit.carousel.snapshot().state, 'running');
  await kit.clock.advance(5_000);
  assert.deepEqual(kit.ids(), ['a', 'b', 'a', 'b']);
  await kit.clock.advance(5_000);
  assert.equal(kit.carousel.snapshot().state, 'finished');

  kit.carousel.setLoop(true);
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().state, 'running', 'ligar a repetição tira a exibição do fim');
  assert.deepEqual(kit.ids().slice(-1), ['a']);
  await kit.clock.advance(60_000);
  assert.ok(kit.ids().length > 6, 'e segue repetindo');
  await kit.close();
});

test('repetição: ligar ou desligar durante a exibição vale para a volta seguinte, sem reiniciar o que está na tela', async () => {
  const kit = rig();
  const list = sequence([['a', { duration: 5 }], ['b', { duration: 5 }]]);
  kit.carousel.load(list, { loop: true });
  await kit.clock.advance(2_000);
  assert.equal(kit.carousel.load(list, { loop: false }), 'unchanged', 'mesma sequência, só a repetição mudou');
  assert.equal(kit.carousel.snapshot().loop, false);
  assert.equal(kit.carousel.snapshot().elapsedMs, 2_000, 'o conteúdo na tela não foi reiniciado');
  await kit.clock.advance(8_000);
  assert.equal(kit.carousel.snapshot().state, 'finished');
  assert.deepEqual(kit.ids(), ['a', 'b']);
  await kit.close();
});

test('repetição: um único conteúdo repete no lugar, sem trocar nem baixar de novo; sem repetição, termina', async () => {
  const looping = rig();
  looping.carousel.load(sequence([['a', { duration: 5, transition: 'fade', transitionMs: 1000 }]]));
  await looping.clock.advance(5_000 * 7);
  assert.deepEqual(looping.ids(), ['a'], 'um conteúdo só: nenhuma nova entrada');
  assert.equal(looping.renderer.count('prepare'), 1);
  assert.equal(looping.carousel.snapshot().cycles, 7);
  assert.equal(looping.of('cycle').length, 7);
  assert.equal(looping.carousel.snapshot().state, 'running');
  await looping.close();

  const once = rig();
  once.carousel.load(sequence([['a', { duration: 5 }]]), { loop: false });
  await once.clock.advance(5_000);
  assert.equal(once.carousel.snapshot().state, 'finished');
  await once.close();
});

test('repetição: um único vídeo recomeça do início a cada volta', async () => {
  const kit = rig({ renderer: { natural: { v: 4_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' })]));
  await kit.clock.advance(4_000 * 5);
  assert.equal(kit.renderer.count('restart', '0:v'), 5);
  assert.deepEqual(kit.ids(), ['v']);
  assert.equal(kit.carousel.snapshot().cycles, 5);
  await kit.close();
});

// ---- pausa, retomada e navegação ---------------------------------------------------------------------------------------------------
test('pausa: congela o tempo restante e, ao retomar, completa só o que faltava', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(4_000);
  kit.carousel.pause();
  assert.equal(kit.carousel.snapshot().playing, false);
  await kit.clock.advance(100_000);
  assert.deepEqual(kit.ids(), ['a'], 'pausado: não troca');
  assert.equal(kit.carousel.snapshot().elapsedMs, 4_000);
  kit.carousel.play();
  await kit.clock.advance(5_999);
  assert.deepEqual(kit.ids(), ['a']);
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 110_000]], 'faltavam 6 s dos 10 s');
  assert.equal(kit.carousel.snapshot().playing, true);
  await kit.close();
});

test('pausa: "alternar" pausa e retoma, e pausar duas vezes é inofensivo', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(1_000);
  kit.carousel.toggle();
  kit.carousel.pause();
  assert.equal(kit.carousel.snapshot().playing, false);
  kit.carousel.toggle();
  kit.carousel.play();
  assert.equal(kit.carousel.snapshot().playing, true);
  await kit.clock.advance(9_000);
  assert.deepEqual(kit.ids(), ['a', 'b']);
  await kit.close();
});

test('pausa: vídeo também pausa e retoma do ponto onde parou, sem passar do limite', async () => {
  const kit = rig({ renderer: { natural: { v: 20_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await kit.clock.advance(5_000);
  kit.carousel.pause();
  assert.equal(kit.renderer.count('pause', '0:v'), 1);
  await kit.clock.advance(60_000);
  assert.deepEqual(kit.ids(), ['v']);
  assert.equal(kit.carousel.snapshot().progress, 0.25, 'o vídeo está em 5 s de 20 s');
  kit.carousel.play();
  await kit.clock.advance(14_999);
  assert.deepEqual(kit.ids(), ['v']);
  await kit.clock.advance(1);
  assert.deepEqual(kit.ids(), ['v', 'b'], 'terminou os 20 s depois de somar o que já tinha tocado');
  await kit.close();
});

test('pausa: pausar enquanto o próximo conteúdo ainda está sendo preparado cancela a troca; ao retomar a troca é imediata', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 8_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 5 }], ['b', { duration: 5 }]]));
  await kit.clock.advance(6_000); // "a" já deveria ter saído, mas "b" só fica pronto aos 8 s
  assert.deepEqual(kit.ids(), ['a']);
  kit.carousel.pause();
  await kit.clock.advance(30_000);
  assert.deepEqual(kit.ids(), ['a'], '"b" ficou pronto, mas a exibição está pausada: não troca');
  kit.carousel.play();
  await kit.clock.advance(0);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 36_000]], 'ao retomar, troca na hora usando o que já estava preparado');
  assert.equal(kit.renderer.count('prepare', '1:b'), 1, 'sem baixar outra vez');
  await kit.close();
});

test('navegação: Próximo e Anterior dão a volta; funcionam também com a repetição desligada', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 30 }], ['b', { duration: 30 }], ['c', { duration: 30 }]]), { loop: false });
  await kit.clock.advance(0);
  kit.carousel.next(); await kit.clock.advance(0);
  kit.carousel.next(); await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 2);
  kit.carousel.next(); await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 0, 'do último volta ao primeiro');
  kit.carousel.previous(); await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 2, 'do primeiro volta ao último');
  kit.carousel.previous(); await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 1);
  assert.deepEqual(kit.ids(), ['a', 'b', 'c', 'a', 'c', 'b']);
  // Depois de navegar, o tempo do conteúdo recomeça do zero.
  await kit.clock.advance(29_999);
  assert.equal(kit.carousel.snapshot().index, 1);
  await kit.close();
});

test('navegação: ir direto a um conteúdo (linha do tempo); tocar no que já está na tela recomeça esse conteúdo', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 30 }], ['b', { duration: 30 }], ['c', { duration: 30 }]]));
  await kit.clock.advance(10_000);
  kit.carousel.goTo(2);
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 2);
  assert.equal(kit.carousel.snapshot().elapsedMs, 0);
  await kit.clock.advance(20_000);
  kit.carousel.goTo(2);
  assert.equal(kit.carousel.snapshot().elapsedMs, 0, 'recomeçou o mesmo conteúdo');
  assert.deepEqual(kit.ids(), ['a', 'c'], 'sem trocar de conteúdo');
  kit.carousel.goTo(1.5); kit.carousel.goTo('x'); kit.carousel.goTo(NaN); kit.carousel.goTo(undefined);
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 2, 'posição inválida é ignorada');
  kit.carousel.goTo(4); await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 1, 'posição fora da lista dá a volta (4 em 3 conteúdos = o segundo)');
  kit.carousel.goTo(-3); await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().index, 0);
  await kit.close();
});

test('navegação: apertar "Próximo" várias vezes seguidas anda de um em um, mesmo com o conteúdo ainda sendo preparado', async () => {
  const kit = rig({ renderer: { latency: () => 2_000 } });
  kit.carousel.load(sequence([['a', { duration: 60 }], ['b', { duration: 60 }], ['c', { duration: 60 }], ['d', { duration: 60 }]]));
  await kit.clock.advance(2_000);
  assert.deepEqual(kit.ids(), ['a']);
  kit.carousel.next(); kit.carousel.next(); kit.carousel.next();
  await kit.clock.advance(10_000);
  assert.equal(kit.carousel.snapshot().index, 3, 'três toques a partir de "a" chegam em "d"');
  assert.ok(!kit.ids().includes('b') || kit.ids().at(-1) === 'd');
  assert.ok(kit.renderer.live <= 3);
  await kit.close();
});

test('navegação: pedir duas vezes o mesmo conteúdo não solta o conteúdo que a segunda troca está esperando', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 3_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 60 }], ['b', { duration: 60 }]]));
  await kit.clock.advance(100);
  kit.carousel.goTo(1);
  kit.carousel.goTo(1);
  await kit.clock.advance(3_000);
  assert.deepEqual(kit.ids(), ['a', 'b'], '"b" aparece uma vez só');
  assert.equal(kit.renderer.preparedOf('b')?.disposed, false, 'e continua vivo na tela');
  assert.equal(kit.renderer.count('dispose', '1:b'), 0);
  await kit.close();
});

test('navegação: tocar no conteúdo que está na tela, com uma troca ainda em andamento, desiste dessa troca (vale a última escolha)', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 5_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }], ['c', { duration: 10 }]]));
  await kit.clock.advance(1_000);
  kit.carousel.next();   // vai para "b", que só fica pronto aos 5 s...
  kit.carousel.goTo(0);  // ...mas a pessoa toca em "a", que está na tela: a escolha mais recente vence
  await kit.clock.advance(9_000);
  assert.ok(!kit.ids().includes('b'), '"b" nunca entra: a troca para ele foi abandonada');
  assert.equal(kit.carousel.snapshot().index, 0);
  assert.equal(kit.carousel.snapshot().state, 'running');
  assert.ok(kit.renderer.maxLive <= 3);
  await kit.clock.advance(10_000);
  assert.ok(kit.ids().includes('b'), 'e a sequência segue normalmente: "b" vem na vez dele');
  await kit.close();
});

test('navegação: a troca que a pessoa abandonou não registra falha de um conteúdo que ela deixou de esperar', async () => {
  // "b" falha só depois de 8 s e "c" demora 20 s. A pessoa pede "b", desiste e pede "c" enquanto "b" ainda baixa.
  const kit = rig({ renderer: { latency: item => ({ b: 8_000, c: 20_000 })[item.id] ?? 0, failures: { b: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 60 }], ['b', { duration: 60 }], ['c', { duration: 60 }]]));
  await kit.clock.advance(1_000);
  kit.carousel.next();
  await kit.clock.advance(1_000);
  kit.carousel.next();   // a partir da troca em andamento: vai para "c"
  await kit.clock.advance(7_000);   // t = 9 s: "b" já falhou
  assert.equal(kit.renderer.count('prepare', '1:b'), 1);
  assert.deepEqual(kit.of('skip'), [], 'ninguém mais esperava por "b": nenhum "conteúdo pulado" que a pessoa nunca viu');
  assert.deepEqual(kit.ids(), ['a'], '"a" segue na tela enquanto "c" não chega');
  await kit.clock.advance(13_000);   // "c" começou a baixar aos 2 s e leva 20 s
  assert.deepEqual(kit.timeline(), [['a', 0], ['c', 22_000]]);
  await kit.close();
});

test('navegação: escolher à mão um conteúdo que tinha falhado zera a penalidade dele, mesmo que a pessoa mude de ideia antes de ele ficar pronto', async () => {
  // "b" falha na primeira tentativa (fica de fora por 30 s), demora 5 s na segunda e funciona sempre depois.
  const kit = rig({ renderer: { latency: (item, attempt) => (item.id === 'b' && attempt === 2 ? 5_000 : 0), failures: { b: (item, attempt) => (attempt === 1 ? permanent() : null) } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }], ['c', { duration: 10 }]]));
  await kit.clock.advance(1_000);
  assert.equal(kit.of('skip').length, 1, '"b" falhou ao ser pré-carregado e está de fora');
  kit.carousel.goTo(1);   // a pessoa pede "b" de novo (a segunda tentativa leva 5 s)...
  await kit.clock.advance(1_000);
  kit.carousel.goTo(2);   // ...e muda de ideia antes de ele ficar pronto
  await kit.clock.advance(60_000);
  // "b" não ficou de fora por causa da primeira falha: voltou à sequência assim que a pessoa pediu por ele.
  const order = kit.ids();
  assert.deepEqual(order.slice(0, 4), ['a', 'c', 'a', 'b'], `ordem das primeiras exibições: ${order.join(',')}`);
  await kit.close();
});

test('navegação: pausar e retomar enquanto uma troca escolhida à mão ainda espera não rearma o tempo do conteúdo que está saindo', async () => {
  // A pessoa pede "Anterior" (vai para "c", que leva 5 s para chegar), pausa e retoma antes de ele chegar.
  // "c" demora 15 s para ficar pronto, mais que os 9 s que faltavam a "a": se o tempo de "a" voltasse a correr, ele acabaria antes e mandaria a exibição para "b".
  const kit = rig({ renderer: { latency: item => (item.id === 'c' ? 15_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }], ['c', { duration: 10 }]]));
  await kit.clock.advance(1_000);
  kit.carousel.previous();
  kit.carousel.pause();
  kit.carousel.play();
  await kit.clock.advance(30_000);
  assert.deepEqual(kit.timeline().slice(0, 3), [['a', 0], ['c', 16_000], ['a', 26_000]],
    'o destino escolhido ("c") vence: o tempo de "a" não volta a correr e não manda a exibição para "b" no meio do caminho');
  await kit.close();
});

test('navegação: com o aviso de indisponível na tela, Anterior e Próximo não fazem nada — quem tenta de novo é o motor, a cada 10 s', async () => {
  const kit = rig({ renderer: { failures: { a: permanent(), b: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  const attempts = kit.renderer.count('prepare');
  kit.carousel.next(); kit.carousel.previous();
  await kit.clock.advance(0);
  assert.equal(kit.renderer.count('prepare'), attempts, 'os botões não provocam tentativa nenhuma');
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  await kit.clock.advance(9_999);
  assert.equal(kit.renderer.count('prepare'), attempts, 'a próxima tentativa segue marcada para os 10 s');
  await kit.clock.advance(1);
  assert.ok(kit.renderer.count('prepare') > attempts, 'e acontece na hora marcada');
  await kit.close();
});

test('navegação: não faz nada quando não há o que navegar (sem programação, carregando, parado)', async () => {
  const kit = rig({ renderer: { latency: () => 1_000 } });
  kit.carousel.next(); kit.carousel.previous(); kit.carousel.goTo(0);
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  kit.carousel.next(); // ainda carregando o primeiro
  await kit.clock.advance(1_000);
  assert.deepEqual(kit.ids(), ['a']);
  kit.carousel.stop();
  kit.carousel.next(); kit.carousel.goTo(1);
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.ids(), ['a']);
  await kit.close();
});

// ---- acompanhamento para a tela --------------------------------------------------------------------------------------------------
test('acompanhamento: o motor informa o estado, a posição e o progresso do conteúdo na tela', async () => {
  const kit = rig({ renderer: { natural: { v: 20_000 } } });
  const list = sequence([['a', { duration: 10 }], video('v', { durationMode: 'natural', transition: 'fade', transitionMs: 500 })]);
  kit.carousel.load(list);
  await kit.clock.advance(5_000);
  const first = kit.carousel.snapshot();
  assert.deepEqual([first.state, first.playing, first.count, first.index, first.item.id, first.loop, first.tier, first.dwellMs], ['running', true, 2, 0, 'a', true, 'full', 10_000]);
  assert.equal(first.progress, 0.5);
  assert.equal(first.elapsedMs, 5_000);
  await kit.clock.advance(5_000 + 5_000);
  const second = kit.carousel.snapshot();
  assert.equal(second.item.id, 'v');
  assert.equal(second.dwellMs, null, 'vídeo em duração natural não tem tempo fixo');
  assert.equal(second.progress, 0.25, '5 s dos 20 s do vídeo');
  assert.deepEqual([second.effect.name, second.effect.ms], ['fade', 500]);

  const changes = kit.of('change');
  assert.deepEqual(changes.map(event => [event.index, event.item.id, event.previous?.id ?? null]), [[0, 'a', null], [1, 'v', 'a']]);
  assert.deepEqual(kit.of('state').map(event => event.state), ['loading', 'running']);
  await kit.close();
});

test('acompanhamento: erros dos ouvintes da tela não derrubam a exibição', async () => {
  const kit = rig({ carousel: { onEvent: () => { throw new Error('a tela quebrou'); } } });
  kit.carousel.load(sequence([['a', { duration: 5 }], ['b', { duration: 5 }]]));
  await kit.clock.advance(5_000);
  assert.deepEqual(kit.ids(), ['a', 'b']);
  await kit.close();
});

test('acompanhamento: um erro inesperado no renderer vira evento e a exibição segue', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 5 }], ['b', { duration: 5 }]]));
  await kit.clock.advance(0);
  const original = kit.renderer.show;
  kit.renderer.show = async () => { throw new Error('falha ao desenhar'); };
  await kit.clock.advance(5_000);
  assert.equal(kit.of('skip').some(event => event.reason === 'transition-failed'), true);
  kit.renderer.show = original;
  await kit.clock.advance(5_000);
  assert.ok(kit.renderer.shows.length >= 2, 'a exibição continua depois da falha');
  await kit.close();
});
