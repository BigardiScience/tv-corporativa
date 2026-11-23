// Fase 2 — recuperação da reprodução: rede que cai, arquivo que some, vídeo que trava, programação que muda,
// retomada depois de reconexão e exibição prolongada sem crescimento de memória.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rig, sequence, createMemoryStorage, transient, permanent, authFailure, WALL_START } from './helpers/playback-fakes.mjs';
import { createTierKeeper } from '../public/js/playback/effects.js';

const video = (id, extra = {}) => [id, { type: 'video/mp4', ...extra }];
const abc = (extra = {}) => sequence([['a', { duration: 10, ...extra }], ['b', { duration: 10, ...extra }], ['c', { duration: 10, ...extra }]]);

// ---- falhas ao baixar ----------------------------------------------------------------------------------------------------------------
test('falha de rede: tenta de novo com espera crescente enquanto o conteúdo anterior segue na tela', async () => {
  const kit = rig({ renderer: { failures: { b: (item, attempt) => (attempt < 3 ? transient() : null) } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 10_000]], 'a espectadora não percebe: "b" estava pronto antes da hora');
  assert.deepEqual(kit.of('retry').map(event => event.attempt), [1, 2]);
  assert.equal(kit.of('skip').length, 0);
  assert.equal(kit.renderer.count('prepare', '1:b'), 3);
  await kit.close();
});

test('falha de rede persistente: depois de três tentativas o conteúdo é pulado e o seguinte já estava sendo preparado', async () => {
  const kit = rig({ renderer: { failures: { b: () => transient() } } });
  kit.carousel.load(abc());
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['c', 10_000]], '"b" fica de fora e "c" entra na hora');
  assert.equal(kit.renderer.count('prepare', '1:b'), 3);
  const skips = kit.of('skip');
  assert.deepEqual(skips.map(event => [event.index, event.reason]), [[1, 'load-failed']]);
  assert.equal(skips[0].item.id, 'b');
  await kit.close();
});

test('arquivo inexistente (erro definitivo): não insiste, pula e só volta a tentar depois de 30 s — sem baixar de novo a cada volta', async () => {
  const kit = rig({ renderer: { failures: { b: permanent() } } });
  kit.carousel.load(abc());
  await kit.clock.advance(60_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['c', 10_000], ['a', 20_000], ['c', 30_000], ['a', 40_000], ['c', 50_000], ['a', 60_000]]);
  assert.equal(kit.renderer.count('prepare', '1:b'), 3, 'tentado em 0 s, 30 s e 60 s — e não a cada volta');
  assert.equal(kit.renderer.count('clear'), 0, 'e a tela nunca ficou vazia');
  await kit.close();
});

test('acesso revogado (401/403): não repete a tentativa e avisa o player', async () => {
  const kit = rig({ renderer: { failures: { b: authFailure() } } });
  kit.carousel.load(abc());
  await kit.clock.advance(10_000);
  assert.equal(kit.renderer.count('prepare', '1:b'), 1, 'sem tentativas repetidas');
  assert.ok(kit.of('auth').length >= 1);
  assert.equal(kit.of('skip')[0].reason, 'auth');
  assert.deepEqual(kit.ids(), ['a', 'c']);
  await kit.close();
});

test('conteúdo que demora demais para ficar pronto é abandonado depois do prazo, sem tela preta', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 500_000 : 0) }, carousel: { timing: { prepareWaitMs: 5_000 } } });
  kit.carousel.load(abc());
  await kit.clock.advance(14_999);
  assert.deepEqual(kit.ids(), ['a'], '"a" segue na tela enquanto espera "b"');
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['a', 0], ['c', 15_000]]);
  assert.equal(kit.of('skip')[0].reason, 'timeout');
  assert.equal(kit.renderer.count('clear'), 0);
  assert.ok(kit.renderer.live <= 3);
  await kit.close();
});

test('o último conteúdo que falha não derruba os outros: a sequência segue com o que funciona', async () => {
  const kit = rig({ renderer: { failures: { c: permanent() } } });
  kit.carousel.load(abc());
  await kit.clock.advance(40_000);
  assert.deepEqual(kit.ids(), ['a', 'b', 'a', 'b', 'a']);
  assert.equal(kit.carousel.snapshot().state, 'running');
  await kit.close();
});

test('a troca falha e o único outro conteúdo é o que já está na tela: ele segue, sem ser refeito por cima de si mesmo', async () => {
  // "b" demora 15 s para chegar e então se revela inexistente; o tempo de "a" (10 s) acaba antes, e a troca fica esperando por "b".
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 15_000 : 0), failures: { b: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(14_999);
  assert.deepEqual(kit.ids(), ['a'], 'a troca para "b" ainda espera');
  await kit.clock.advance(1);
  assert.deepEqual(kit.of('skip').map(event => event.item.id), ['b']);
  assert.deepEqual(kit.ids(), ['a'], '"a" não é preparado nem mostrado de novo por cima de si mesmo');
  assert.equal(kit.renderer.count('prepare', '0:a'), 1);
  assert.equal(kit.renderer.count('dispose', '0:a'), 0, 'e continua vivo na tela');
  assert.deepEqual([kit.carousel.snapshot().state, kit.carousel.snapshot().index], ['running', 0]);
  // "a" volta a contar o tempo do início; "b" está de fora por 30 s, então "a" recomeça no lugar.
  await kit.clock.advance(10_000);
  assert.equal(kit.of('cycle').length, 1, 'a volta seguinte é "a" recomeçando no lugar');
  assert.deepEqual(kit.ids(), ['a']);
  await kit.close();
});

test('todos os outros conteúdos estão de fora por falha: o da tela recomeça no lugar a cada volta, e os outros voltam a ser tentados passados 30 s', async () => {
  const kit = rig({ renderer: { failures: { b: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(9_999);
  assert.deepEqual(kit.of('skip').map(event => event.item.id), ['b'], '"b" falhou ao ser pré-carregado e ficou de fora');
  assert.equal(kit.of('cycle').length, 0);
  await kit.clock.advance(1);
  assert.equal(kit.of('cycle').length, 1, 'acabou o tempo de "a" e não há outro conteúdo: recomeça no lugar');
  await kit.clock.advance(10_000);
  assert.equal(kit.of('cycle').length, 2, 'e continua recomeçando, volta após volta (não fica parado para sempre)');
  assert.deepEqual(kit.ids(), ['a'], 'sem nova troca');
  assert.equal(kit.renderer.count('clear'), 0, 'e sem limpar a tela');
  assert.equal(kit.renderer.count('prepare', '1:b'), 1, '"b" não é baixado de novo a cada volta');
  assert.equal(kit.carousel.snapshot().state, 'running');
  await kit.clock.advance(10_000);
  assert.equal(kit.renderer.count('prepare', '1:b'), 2, 'passados 30 s, "b" é tentado de novo (e, falhando, "a" segue)');
  assert.equal(kit.of('skip').length, 2);
  await kit.clock.advance(10_000);
  assert.equal(kit.of('cycle').length, 3, 'de fora outra vez: "a" volta a recomeçar no lugar');
  assert.deepEqual(kit.ids(), ['a']);
  await kit.close();
});

// ---- sem nada para exibir ------------------------------------------------------------------------------------------------------------
test('nenhum conteúdo disponível: mostra o aviso, tenta de novo sozinho e se recupera quando volta', async () => {
  const fails = (item, attempt) => (attempt <= 2 ? permanent() : null);
  const kit = rig({ renderer: { failures: { a: fails, b: fails } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  assert.equal(kit.carousel.snapshot().item, null);
  assert.equal(kit.of('unavailable').length, 1);
  assert.equal(kit.renderer.shows.length, 0);

  await kit.clock.advance(9_999);
  assert.equal(kit.of('unavailable').length, 1, 'ainda esperando');
  await kit.clock.advance(1);
  assert.equal(kit.of('unavailable').length, 2, 'segunda tentativa aos 10 s: ainda sem conteúdo');
  assert.equal(kit.of('recovered').length, 0);

  await kit.clock.advance(10_000);
  assert.deepEqual(kit.timeline(), [['a', 20_000]], 'terceira tentativa deu certo');
  assert.equal(kit.carousel.snapshot().state, 'running');
  assert.equal(kit.of('recovered').length, 1);
  await kit.close();
});

test('depois do aviso, a nova tentativa considera todos os conteúdos de novo — o primeiro pode continuar quebrado e o segundo voltar', async () => {
  // "a" está sempre quebrado; "b" falha só na primeira tentativa (por exemplo, uma queda de rede) e depois funciona.
  const kit = rig({ renderer: { failures: { a: permanent(), b: (item, attempt) => (attempt === 1 ? permanent() : null) } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  await kit.clock.advance(9_999);
  assert.equal(kit.carousel.snapshot().state, 'unavailable', 'ainda esperando a nova tentativa');
  await kit.clock.advance(1);
  assert.deepEqual([kit.carousel.snapshot().state, kit.carousel.snapshot().item?.id], ['running', 'b'], 'aos 10 s "b" já volta, sem esperar os 30 s de "a" e "b" de fora');
  assert.deepEqual(kit.timeline(), [['b', 10_000]]);
  assert.equal(kit.of('recovered').length, 1);
  await kit.close();
});

test('o conteúdo da tela quebra e não há outro: some a imagem quebrada, aparece o aviso, e volta sozinho', async () => {
  const kit = rig({ renderer: { natural: { v: 20_000 }, failures: { b: (item, attempt) => (attempt === 1 ? permanent() : null) } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await kit.clock.advance(2_000);
  kit.renderer.preparedOf('v').fireError(new Error('decodificação'));
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  assert.equal(kit.renderer.count('clear'), 1);
  assert.equal(kit.renderer.live, 0);
  assert.deepEqual(kit.of('skip').map(event => event.reason).sort(), ['load-failed', 'media-error']);
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.timeline(), [['v', 0], ['v', 12_000]], 'depois de 10 s tenta de novo e o vídeo volta');
  assert.equal(kit.of('recovered').length, 1);
  await kit.close();
});

test('com a exibição "indisponível", chegar uma programação nova mostra o conteúdo imediatamente', async () => {
  const kit = rig({ renderer: { failures: { a: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 10 }]]));
  await kit.clock.advance(5_000);
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  kit.carousel.load(sequence([['z', { duration: 10 }]]));
  await kit.clock.advance(0);
  assert.deepEqual(kit.timeline(), [['z', 5_000]]);
  assert.equal(kit.carousel.snapshot().state, 'running');
  await kit.close();
});

// ---- problemas durante a reprodução ----------------------------------------------------------------------------------------------
test('erro de reprodução do vídeo: pula para o próximo na hora, com o efeito do próximo, e solta o vídeo', async () => {
  const kit = rig({ renderer: { natural: { v: 20_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10, transition: 'fade', transitionMs: 500 }]]));
  await kit.clock.advance(2_000);
  kit.renderer.preparedOf('v').fireError(new Error('erro de decodificação'));
  await kit.clock.advance(500);
  assert.deepEqual(kit.timeline(), [['v', 0], ['b', 2_000]]);
  assert.deepEqual(kit.renderer.shows[1], { id: 'b', key: '1:b', effect: 'fade', ms: 500, outgoing: 'v', at: 2_000 });
  assert.equal(kit.of('skip')[0].reason, 'media-error');
  assert.equal(kit.renderer.count('dispose', '0:v'), 1);
  await kit.close();
});

test('o vídeo da tela falha e há outros conteúdos: a sequência segue e o vídeo fica de fora por 30 s, em vez de falhar de novo na volta seguinte', async () => {
  const kit = rig({ renderer: { natural: { v: 20_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }], ['c', { duration: 10 }]]));
  await kit.clock.advance(2_000);
  kit.renderer.preparedOf('v').fireError(new Error('erro de decodificação'));
  await kit.clock.advance(20_000);
  assert.deepEqual(kit.timeline(), [['v', 0], ['b', 2_000], ['c', 12_000], ['b', 22_000]], 'na volta seguinte o vídeo que falhou é pulado');
  assert.equal(kit.renderer.count('prepare', '0:v'), 1, 'e nem chega a ser baixado de novo');
  await kit.clock.advance(20_000);
  assert.deepEqual(kit.ids(), ['v', 'b', 'c', 'b', 'c', 'v'], 'passados 30 s da falha, o vídeo volta a ser tentado');
  assert.equal(kit.of('skip').length, 1, 'e esta vez ele toca (não houve nova falha)');
  await kit.close();
});

test('vídeo travado (não avança): depois de 15 s é pulado em vez de prender o carrossel', async () => {
  const kit = rig({ renderer: { natural: { v: 60_000 }, stall: new Set(['v']) } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await kit.clock.advance(14_999);
  assert.deepEqual(kit.ids(), ['v']);
  await kit.clock.advance(1);
  assert.deepEqual(kit.timeline(), [['v', 0], ['b', 15_000]]);
  assert.equal(kit.of('skip')[0].reason, 'stalled');
  await kit.close();
});

test('vídeo que avança normalmente nunca é considerado travado, nem em exibições longas', async () => {
  const kit = rig({ renderer: { natural: { v: 600_000 } } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await kit.clock.advance(599_999);
  assert.deepEqual(kit.ids(), ['v']);
  assert.equal(kit.of('skip').length, 0);
  await kit.close();
});

test('erro transitório no início do vídeo: tenta mais uma vez e, se continuar falhando, pula', async () => {
  const once = rig({ renderer: { natural: { v: 8_000 }, startFailures: { v: { times: 1 } } } });
  once.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await once.clock.advance(8_400);
  assert.deepEqual(once.timeline(), [['v', 0], ['b', 8_400]], 'começou 0,4 s depois e tocou até o fim');
  assert.equal(once.of('skip').length, 0);
  await once.close();

  const twice = rig({ renderer: { natural: { v: 8_000 }, startFailures: { v: { times: 2 } } } });
  twice.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await twice.clock.advance(400);
  assert.deepEqual(twice.timeline(), [['v', 0], ['b', 400]]);
  assert.equal(twice.of('skip')[0].reason, 'autoplay');
  await twice.close();
});

test('navegação manual para um conteúdo que tinha falhado tenta de novo na hora', async () => {
  const kit = rig({ renderer: { failures: { b: (item, attempt) => (attempt === 1 ? permanent() : null) } } });
  kit.carousel.load(abc());
  await kit.clock.advance(1_000);
  assert.equal(kit.of('skip').length, 1);
  kit.carousel.goTo(1);
  await kit.clock.advance(0);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 1_000]]);
  await kit.close();
});

// ---- troca de programação --------------------------------------------------------------------------------------------------------
test('programação nova: o conteúdo antigo fica na tela até o novo estar pronto, e o que estava pré-carregado é solto', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'x' ? 2_000 : 0) } });
  kit.carousel.load(sequence([['a', { duration: 30 }], ['b', { duration: 30 }]]));
  await kit.clock.advance(5_000);
  assert.equal(kit.carousel.load(sequence([['x', { duration: 10, transition: 'fade', transitionMs: 500 }], ['y', { duration: 10 }]])), 'started');
  const waiting = kit.carousel.snapshot();
  assert.equal(waiting.index, -1, 'nenhum conteúdo da nova programação está na tela ainda');
  assert.equal(waiting.item, null);
  assert.equal(kit.renderer.shown.item.id, 'a', 'o antigo continua visível');
  assert.equal(kit.renderer.preparedOf('b'), undefined, 'o "b" pré-carregado da programação antiga foi solto');
  await kit.clock.advance(1_999);
  assert.deepEqual(kit.ids(), ['a']);
  await kit.clock.advance(1);
  assert.deepEqual(kit.renderer.shows.map(show => [show.id, show.effect, show.outgoing, show.at]), [['a', 'cut', null, 0], ['x', 'fade', 'a', 7_000]]);
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.ids(), ['a', 'x', 'y']);
  assert.equal(kit.renderer.count('clear'), 0);
  await kit.close();
});

test('programação nova: o conteúdo que só termina de ser preparado depois de descartado é solto assim que chega', async () => {
  const kit = rig({ renderer: { latency: item => (item.id === 'b' ? 5_000 : 0) } });
  // Um renderer que demora a perceber o cancelamento: termina o preparo mesmo depois de abortado.
  const prepare = kit.renderer.prepare.bind(kit.renderer);
  kit.renderer.prepare = (item, options) => prepare(item, { ...options, signal: new AbortController().signal });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(1_000);   // "b" está sendo preparado (pronto aos 5 s)
  assert.equal(kit.carousel.load(sequence([['a', { duration: 10 }], ['x', { duration: 10 }]])), 'adopted');   // programação nova: "b" é descartado
  await kit.clock.advance(6_000);   // "b" chegou, mas ninguém mais o quer
  assert.equal(kit.renderer.count('prepare', '1:b'), 1, '"b" chegou a ser preparado até o fim');
  assert.equal(kit.renderer.preparedOf('b'), undefined, 'e foi solto ao chegar, em vez de ficar vivo à toa');
  assert.equal(kit.renderer.count('dispose', '1:b'), 1, 'uma vez só');
  await kit.close();
});

test('programação nova: o que falhou na anterior não continua de fora na nova (as posições são outras, e o bloqueio era só do conteúdo antigo)', async () => {
  const kit = rig({ renderer: { failures: { b: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(1_000);
  assert.deepEqual(kit.of('skip').map(event => event.index), [1], '"b", na posição 1, falhou e ficou de fora por 30 s');
  assert.equal(kit.carousel.load(sequence([['x', { duration: 10 }], ['y', { duration: 10 }], ['z', { duration: 10 }]])), 'started');
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['x', 1_000], ['y', 11_000]], 'a posição 1 da programação nova ("y") é exibida normalmente');
  assert.equal(kit.of('skip').length, 1, 'nenhum conteúdo da programação nova foi pulado');
  await kit.close();
});

test('programação nova que não carrega: não deixa o conteúdo da programação antiga como se fosse atual — mostra o aviso', async () => {
  const kit = rig({ renderer: { failures: { x: permanent(), y: permanent() } } });
  kit.carousel.load(sequence([['a', { duration: 30 }], ['b', { duration: 30 }]]));
  await kit.clock.advance(5_000);
  kit.carousel.load(sequence([['x', { duration: 10 }], ['y', { duration: 10 }]]));
  await kit.clock.advance(0);
  assert.equal(kit.carousel.snapshot().state, 'unavailable');
  assert.equal(kit.renderer.live, 0);
  assert.equal(kit.renderer.count('clear'), 1);
  await kit.close();
});

test('programação igual (a TV consulta o servidor toda hora): não reinicia nem baixa nada de novo', async () => {
  const kit = rig();
  const make = () => sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]);
  kit.carousel.load(make());
  await kit.clock.advance(4_000);
  const prepares = kit.renderer.count('prepare');
  for (let poll = 0; poll < 50; poll++) assert.equal(kit.carousel.load(make()), 'unchanged');
  await kit.clock.advance(0);
  assert.equal(kit.renderer.count('prepare'), prepares);
  assert.equal(kit.carousel.snapshot().elapsedMs, 4_000);
  await kit.clock.advance(6_000);
  assert.deepEqual(kit.timeline(), [['a', 0], ['b', 10_000]], 'o relógio do "a" não foi reiniciado pelas consultas');
  await kit.close();
});

test('programação mudou mas o primeiro conteúdo é o mesmo: continua na tela sem refazer a troca', async () => {
  const kit = rig();
  kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
  await kit.clock.advance(4_000);
  assert.equal(kit.carousel.load(sequence([['a', { duration: 10 }], ['c', { duration: 10 }]])), 'adopted');
  assert.equal(kit.carousel.snapshot().index, 0);
  assert.equal(kit.renderer.count('show', '0:a'), 1, '"a" não foi mostrado de novo');
  assert.equal(kit.renderer.count('clear'), 0);
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.ids(), ['a', 'c'], 'depois de "a" vem o "c" da programação nova');
  assert.equal(kit.renderer.preparedOf('b'), undefined, '"b" pré-carregado foi solto');
  await kit.close();
});

test('programação mudou e o conteúdo na tela tem o mesmo código, mas outro endereço ou outro tipo: não é o mesmo conteúdo, e a troca é refeita', async () => {
  for (const change of [{ url: '/api/media/a/arquivo-novo' }, { type: 'image/jpeg' }]) {
    const kit = rig();
    kit.carousel.load(sequence([['a', { duration: 10 }], ['b', { duration: 10 }]]));
    await kit.clock.advance(4_000);
    assert.equal(kit.carousel.load(sequence([['a', { duration: 10, ...change }], ['b', { duration: 10 }]])), 'started', JSON.stringify(change));
    await kit.clock.advance(0);
    assert.equal(kit.renderer.count('show', '0:a'), 2, `o conteúdo novo é mostrado de verdade (${JSON.stringify(change)})`);
    assert.ok(kit.renderer.live <= 3, 'sem conteúdo vivo sobrando');
    await kit.close();
  }
});

test('programação esvaziada: a tela é liberada; quando voltar a ter conteúdo, começa do início', async () => {
  const kit = rig();
  kit.carousel.load(abc());
  await kit.clock.advance(15_000);
  assert.equal(kit.carousel.load([]), 'empty');
  assert.equal(kit.carousel.snapshot().state, 'idle');
  assert.equal(kit.renderer.live, 0);
  assert.equal(kit.of('empty').length, 1);
  await kit.clock.advance(60_000);
  assert.deepEqual(kit.ids(), ['a', 'b'], 'nada acontece sozinho');
  assert.equal(kit.carousel.load(abc()), 'started');
  await kit.clock.advance(0);
  assert.deepEqual(kit.renderer.shows.at(-1).effect, 'cut');
  assert.equal(kit.carousel.snapshot().index, 0);
  await kit.close();
});

test('pausado: uma programação nova aparece, mas só avança quando a exibição for retomada', async () => {
  const kit = rig();
  kit.carousel.load(abc());
  await kit.clock.advance(3_000);
  kit.carousel.pause();
  kit.carousel.load(sequence([['x', { duration: 10 }], ['y', { duration: 10 }]]));
  await kit.clock.advance(60_000);
  assert.deepEqual(kit.ids(), ['a', 'x']);
  assert.equal(kit.carousel.snapshot().playing, false);
  kit.carousel.play();
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.ids(), ['a', 'x', 'y']);
  await kit.close();
});

test('o erro de um vídeo da programação antiga, ainda na tela, não confunde a programação nova', async () => {
  const kit = rig({ renderer: { natural: { v: 60_000 }, latency: item => (item.id === 'x' ? 3_000 : 0) } });
  kit.carousel.load(sequence([video('v', { durationMode: 'natural' }), ['b', { duration: 10 }]]));
  await kit.clock.advance(1_000);
  kit.carousel.load(sequence([['x', { duration: 10 }], ['y', { duration: 10 }]]));
  kit.renderer.preparedOf('v').fireError(new Error('erro tardio'));
  await kit.clock.advance(3_000);
  assert.deepEqual(kit.ids(), ['v', 'x']);
  assert.equal(kit.of('skip').length, 0, 'nenhum conteúdo da programação nova foi marcado como falho');
  await kit.close();
});

test('início em uma posição escolhida (por exemplo, "ver a partir deste conteúdo" na pré-visualização)', async () => {
  const kit = rig();
  kit.carousel.load(abc(), { resumeIndex: 2 });
  await kit.clock.advance(10_000);
  assert.deepEqual(kit.timeline(), [['c', 0], ['a', 10_000]]);
  await kit.close();
});

// ---- reconexão e retomada --------------------------------------------------------------------------------------------------------
test('queda de conexão: parar guardando a posição e, ao reconectar com a mesma programação, retomar de onde estava', async () => {
  const kit = rig();
  const list = abc();
  kit.carousel.load(list);
  await kit.clock.advance(25_000);
  assert.equal(kit.carousel.snapshot().index, 2);
  kit.carousel.stop({ remember: true });
  assert.equal(kit.carousel.snapshot().state, 'stopped');
  assert.equal(kit.renderer.live, 0);
  await kit.clock.advance(30_000);
  assert.deepEqual(kit.ids(), ['a', 'b', 'c'], 'parado: nada acontece');
  assert.equal(kit.carousel.load(abc()), 'started');
  await kit.clock.advance(0);
  assert.deepEqual(kit.renderer.shows.at(-1), { id: 'c', key: '2:c', effect: 'cut', ms: 0, outgoing: null, at: 55_000 });
  await kit.close();
});

test('queda de conexão que se repete: parar de novo uma exibição já parada não apaga o ponto de retomada', async () => {
  const kit = rig();
  kit.carousel.load(abc());
  await kit.clock.advance(25_000);
  assert.equal(kit.carousel.snapshot().index, 2);
  kit.carousel.stop({ remember: true });
  kit.carousel.stop({ remember: true }); // o player confere a validade mais de uma vez
  kit.carousel.stop({ remember: true });
  assert.equal(kit.carousel.load(abc()), 'started');
  await kit.clock.advance(0);
  assert.equal(kit.renderer.shows.at(-1).id, 'c', 'retoma no mesmo conteúdo');
  // Já parar sem "lembrar" esquece de vez (desconexão ou acesso revogado).
  kit.carousel.stop({ remember: true });
  kit.carousel.stop();
  assert.equal(kit.carousel.load(abc()), 'started');
  await kit.clock.advance(0);
  assert.equal(kit.renderer.shows.at(-1).id, 'a', 'depois de esquecer, recomeça do primeiro');
  await kit.close();
});

test('queda de conexão: se a programação mudou enquanto estava fora, recomeça do primeiro', async () => {
  const kit = rig();
  kit.carousel.load(abc());
  await kit.clock.advance(25_000);
  assert.equal(kit.carousel.snapshot().index, 2, 'estava no terceiro conteúdo');
  kit.carousel.stop({ remember: true });
  // A sequência nova também tem um terceiro conteúdo: a posição guardada existiria nela, mas é de outra programação.
  kit.carousel.load(sequence([['x', { duration: 10 }], ['y', { duration: 10 }], ['z', { duration: 10 }], ['w', { duration: 10 }]]));
  await kit.clock.advance(0);
  assert.equal(kit.renderer.shows.at(-1).id, 'x');
  await kit.close();
});

test('queda de energia ou recarga da página: a posição é recuperada da memória do aparelho, só se for a mesma programação e recente', async () => {
  const storage = createMemoryStorage();
  const before = rig({ carousel: { storage } });
  before.carousel.load(abc());
  await before.clock.advance(25_000);
  assert.equal(before.carousel.snapshot().index, 2);
  const saved = storage.get('tv-corporativa.playback.v1');
  assert.ok(saved, 'a posição foi gravada a cada troca');
  assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['i', 's', 't'], 'só posição e assinatura');

  // A página "morreu" sem avisar (nenhum stop): só a memória do aparelho sobrevive. Cada "religada" começa com uma cópia dela.
  const reload = (wall, list = abc()) => {
    const memory = createMemoryStorage({ 'tv-corporativa.playback.v1': saved });
    const kit = rig({ carousel: { storage: memory, wallClock: () => wall } });
    kit.carousel.load(list);
    return kit;
  };
  const resumed = reload(WALL_START + 40_000);
  await resumed.clock.advance(0);
  assert.equal(resumed.renderer.shows[0].id, 'c', 'voltou no conteúdo em que estava');
  assert.equal(resumed.renderer.shows[0].effect, 'cut');
  await resumed.close();

  const other = reload(WALL_START + 40_000, sequence([['x', { duration: 10 }], ['c', { duration: 10 }]]));
  await other.clock.advance(0);
  assert.equal(other.renderer.shows[0].id, 'x', 'programação diferente: do começo');
  await other.close();

  const late = reload(WALL_START + 25_000 + 10 * 60 * 1000 + 1);
  await late.clock.advance(0);
  assert.equal(late.renderer.shows[0].id, 'a', 'mais de 10 minutos depois: do começo');
  await late.close();

  const clockWentBack = reload(WALL_START);
  await clockWentBack.clock.advance(0);
  assert.equal(clockWentBack.renderer.shows[0].id, 'a', 'relógio do aparelho voltou no tempo: não confia na posição');
  await clockWentBack.close();
  await before.close();
});

test('parada definitiva (sem guardar posição) apaga a memória; uma exibição nova começa do início', async () => {
  const storage = createMemoryStorage();
  const first = rig({ carousel: { storage } });
  first.carousel.load(abc());
  await first.clock.advance(25_000);
  first.carousel.stop();
  assert.equal(storage.get('tv-corporativa.playback.v1'), null);
  const second = rig({ carousel: { storage } });
  second.carousel.load(abc());
  await second.clock.advance(0);
  assert.equal(second.renderer.shows[0].id, 'a');
  await second.close();
  await first.close();
});

test('memória do aparelho indisponível: a exibição funciona do mesmo jeito', async () => {
  const broken = { get: () => { throw new Error('bloqueado'); }, set: () => { throw new Error('bloqueado'); }, remove: () => { throw new Error('bloqueado'); } };
  const kit = rig({ carousel: { storage: broken } });
  kit.carousel.load(abc());
  await kit.clock.advance(20_000);
  assert.deepEqual(kit.ids(), ['a', 'b', 'c']);
  kit.carousel.stop({ remember: true });
  await kit.close();
});

// ---- desempenho do aparelho e movimento reduzido ----------------------------------------------------------------------------------
const slowFrames = effect => (effect.ms ? Array.from({ length: 14 }, () => 90) : null);
const effectsList = () => sequence([['a', { duration: 5 }], ['b', { duration: 5, transition: 'slide', transitionMs: 600 }], ['c', { duration: 5, transition: 'zoom', transitionMs: 600 }], ['d', { duration: 5, transition: 'dissolve', transitionMs: 600 }]]);

test('aparelho lento: duas transições lentas seguidas simplificam os efeitos (fade) e mais duas desligam (corte), e isso é lembrado', async () => {
  const storage = createMemoryStorage();
  const tiers = createTierKeeper({ storage, now: () => WALL_START });
  const kit = rig({ renderer: { frames: slowFrames }, carousel: { tiers } });
  kit.carousel.load(effectsList());
  await kit.clock.advance(5_000 * 4 * 2); // duas voltas
  const effects = kit.renderer.shows.map(show => show.effect);
  assert.deepEqual(effects.slice(0, 4), ['cut', 'slide', 'zoom', 'fade'], 'depois de duas lentas, o dissolver já sai como esmaecer');
  assert.equal(effects[4], 'cut', 'volta ao primeiro (sem efeito)');
  assert.equal(effects[5], 'fade', 'slide simplificado para esmaecer');
  assert.equal(effects[6], 'cut', 'duas lentas de novo: o aparelho só aguenta corte seco');
  assert.deepEqual(kit.of('tier').map(event => event.tier), ['reduced', 'minimal']);
  assert.equal(kit.carousel.snapshot().tier, 'minimal');
  assert.equal(JSON.parse(storage.get('tv-corporativa.playback-tier.v1')).tier, 'minimal');
  const simplified = kit.of('change').filter(event => event.effect.simplified).map(event => [event.item.id, event.effect.name, event.effect.reason]);
  assert.deepEqual(simplified.slice(0, 2), [['d', 'fade', 'device-limited'], ['b', 'fade', 'device-limited']]);
  await kit.close();

  // Ao ligar de novo, a TV já sabe o que aguenta.
  const again = rig({ carousel: { tiers: createTierKeeper({ storage, now: () => WALL_START + 1000 }) } });
  again.carousel.load(effectsList());
  await again.clock.advance(5_000 * 4 - 1);
  assert.deepEqual(again.renderer.shows.map(show => show.effect), ['cut', 'cut', 'cut', 'cut']);
  await again.close();
});

test('aparelho bom: transições fluidas não reduzem nada', async () => {
  const tiers = createTierKeeper({ storage: createMemoryStorage() });
  const kit = rig({ renderer: { frames: effect => (effect.ms ? Array.from({ length: 40 }, () => 16.7) : null) }, carousel: { tiers } });
  kit.carousel.load(effectsList());
  await kit.clock.advance(5_000 * 4 * 5);
  assert.equal(tiers.tier(), 'full');
  assert.deepEqual(kit.renderer.shows.slice(0, 4).map(show => show.effect), ['cut', 'slide', 'zoom', 'dissolve']);
  assert.equal(kit.of('tier').length, 0);
  await kit.close();
});

test('movimento reduzido: só esmaecer (sem deslizar, ampliar nem desfocar), e vale já na troca seguinte se a preferência mudar', async () => {
  let reduced = true;
  const kit = rig({ carousel: { capability: { reducedMotion: () => reduced } } });
  kit.carousel.load(effectsList());
  await kit.clock.advance(5_000 * 3);
  assert.deepEqual(kit.renderer.shows.map(show => show.effect), ['cut', 'fade', 'fade', 'fade']);
  assert.deepEqual(kit.of('change').slice(1).map(event => [event.effect.simplified, event.effect.reason]), [[true, 'reduced-motion'], [true, 'reduced-motion'], [true, 'reduced-motion']]);
  reduced = false;
  await kit.clock.advance(5_000 * 4);
  assert.deepEqual(kit.renderer.shows.slice(4, 8).map(show => show.effect), ['cut', 'slide', 'zoom', 'dissolve'], 'preferência desligada: efeitos completos');
  await kit.close();
});

test('navegador sem animações: tudo vira corte seco, com o motivo registrado', async () => {
  const kit = rig({ carousel: { capability: { animations: () => false } } });
  kit.carousel.load(effectsList());
  await kit.clock.advance(5_000 * 4 - 1);
  assert.deepEqual(kit.renderer.shows.map(show => show.effect), ['cut', 'cut', 'cut', 'cut']);
  assert.equal(kit.of('change')[1].effect.reason, 'no-animation-api');
  await kit.close();
});

// ---- exibição prolongada ---------------------------------------------------------------------------------------------------------
test('exibição prolongada: 300 voltas com imagem, vídeo e PDF não acumulam conteúdos, prazos nem preparos repetidos', async () => {
  const kit = rig({
    renderer: { natural: { v: 6_000 }, latency: item => (item.id === 'v' ? 800 : 200), frames: effect => (effect.ms ? Array.from({ length: 30 }, () => 16.7) : null) },
    carousel: { tiers: createTierKeeper({ storage: createMemoryStorage() }) }
  });
  kit.carousel.load(sequence([
    ['a', { duration: 8, transition: 'fade', transitionMs: 700 }],
    video('v', { durationMode: 'natural', transition: 'slide', transitionMs: 900 }),
    ['p', { type: 'application/pdf', duration: 10, transition: 'zoom', transitionMs: 600 }],
    ['d', { duration: 5, transition: 'dissolve', transitionMs: 500 }]
  ]));
  const cycleMs = 8_000 + 6_000 + 10_000 + 5_000;
  let maxAlive = 0, maxPending = 0;
  for (let cycle = 0; cycle < 300; cycle++) {
    await kit.clock.advance(cycleMs);
    maxAlive = Math.max(maxAlive, kit.renderer.alive.size);
    maxPending = Math.max(maxPending, kit.clock.pending());
  }
  assert.ok(maxAlive <= 3, `conteúdos vivos: no máximo 3 (viu ${maxAlive})`);
  assert.ok(kit.renderer.maxLive <= 3);
  assert.ok(maxPending <= 8, `prazos pendentes: ${maxPending}`);
  // O primeiro conteúdo leva 0,2 s para ficar pronto; por isso a 301ª volta ainda não começou ao fim das 300.
  assert.equal(kit.renderer.shows.length, 1200, '4 conteúdos × 300 voltas, nem um a mais nem um a menos');
  assert.equal(kit.carousel.snapshot().cycles, 299);
  assert.ok(kit.renderer.count('prepare') - kit.renderer.shows.length <= 1, 'cada exibição preparou o conteúdo uma única vez');
  assert.equal(kit.renderer.count('clear'), 0);
  assert.equal(kit.of('skip').length, 0);
  // Tudo o que foi criado foi liberado, exceto o que ainda está em uso (na tela, saindo e pré-carregado).
  const created = kit.renderer.count('prepare'), released = kit.renderer.count('dispose');
  assert.ok(created - released <= 3, `criados ${created}, liberados ${released}`);
  await kit.close();
});

test('exibição prolongada com falhas intermitentes: nada se acumula e a exibição nunca fica parada', async () => {
  let toggle = 0;
  const kit = rig({ renderer: { failures: { b: () => ((++toggle % 3 === 0) ? permanent() : (toggle % 3 === 1 ? transient() : null)) } } });
  kit.carousel.load(abc());
  for (let step = 0; step < 200; step++) {
    await kit.clock.advance(30_000);
    assert.ok(kit.renderer.alive.size <= 3, `volta ${step}: ${kit.renderer.alive.size} vivos`);
    assert.notEqual(kit.carousel.snapshot().state, 'unavailable');
  }
  assert.ok(kit.renderer.shows.length >= 400);
  assert.ok(kit.clock.pending() <= 8);
  await kit.close();
});

// ---- encerramento ----------------------------------------------------------------------------------------------------------------
test('encerrar libera tudo: sem conteúdo vivo, sem prazo pendente e sem nenhuma atividade depois', async () => {
  const kit = rig({ renderer: { natural: { v: 30_000 }, latency: () => 700 } });
  kit.carousel.load(sequence([['a', { duration: 5, transition: 'fade', transitionMs: 500 }], video('v', { durationMode: 'natural', transition: 'slide', transitionMs: 500 }), ['b', { duration: 5 }]]));
  await kit.clock.advance(7_000); // no meio de uma transição, com próximo pré-carregando
  await kit.close();
  assert.equal(kit.carousel.load(abc()), 'started', 'e a exibição pode ser iniciada de novo depois de parar');
  await kit.clock.advance(0);
  kit.carousel.destroy();
  assert.equal(kit.carousel.load(abc()), 'destroyed', 'depois de destruir, não aceita mais nada');
  await kit.clock.advance(120_000);
  assert.equal(kit.renderer.alive.size, 0);
  assert.equal(kit.clock.pending(), 0);
});

test('fechar a página (destroy) mantém a posição gravada para a recarga; parar sem lembrar (desconectar) apaga', async () => {
  const storage = createMemoryStorage();
  const kit = rig({ carousel: { storage } });
  kit.carousel.load(abc());
  await kit.clock.advance(25_000);
  assert.ok(storage.get('tv-corporativa.playback.v1'));
  kit.carousel.destroy();
  assert.ok(storage.get('tv-corporativa.playback.v1'), 'a posição sobrevive ao fim da página');
  const reloaded = rig({ carousel: { storage, wallClock: () => WALL_START + 30_000 } }); // a hora seguiu andando enquanto a página estava fechada
  reloaded.carousel.load(abc());
  await reloaded.clock.advance(0);
  assert.equal(reloaded.renderer.shows.at(-1).id, 'c');
  reloaded.carousel.stop(); // a TV foi desconectada: não há o que retomar
  assert.equal(storage.get('tv-corporativa.playback.v1'), null);
  await reloaded.close();
});

test('parar no meio do preparo do primeiro conteúdo descarta o que chegar depois', async () => {
  const kit = rig({ renderer: { latency: () => 5_000 } });
  kit.carousel.load(abc());
  await kit.clock.advance(1_000);
  kit.carousel.stop();
  await kit.clock.advance(20_000);
  assert.equal(kit.renderer.shows.length, 0);
  await kit.close();
});
