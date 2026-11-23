// A análise de quadros dos testes de ponta a ponta (tests/e2e/frame-analysis.mjs) decide se uma troca de conteúdo "passou". Aqui ela é
// testada SEM navegador, com quadros sintéticos de cada situação: uma análise que nunca enxergasse uma tela preta, um mergulho no
// escuro ou um efeito trocado por outro daria aprovação falsa nos testes do Chromium. Cada caso abaixo prova que ela enxerga.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGE_BACKGROUND, blankFrames, blendReport, blurReport, classifyEffect, colorOf, frameInterval, isBlank, isNear, labelFrames, luminance, mixColor,
  offLine, progressOf, slideReport, timeline, within, zoomReport
} from './e2e/frame-analysis.mjs';

const A = [249, 114, 25], B = [43, 108, 176], C = [33, 131, 85], BG = [...STAGE_BACKGROUND];
const CELLS = 48, STEP = 1 / 60;
const ease = x => x * x * (3 - 2 * x);

const shot = (t, cells, extra = {}) => ({ t, centro: cells[24], esquerda: cells[6], direita: cells[42], cantoSE: cells[0], cantoID: cells[47], cells, sharp: 0.4, blankRun: 0, ...extra });
const flat = color => Array.from({ length: CELLS }, () => color);
const frames = (clock, count, make) => Array.from({ length: count }, (_, index) => shot((clock.t += STEP), ...make(index, count)));
const hold = (clock, color, seconds) => frames(clock, Math.round(seconds * 60), () => [flat(color)]);
const flash = clock => [shot((clock.t += STEP), flat(BG), { blankRun: 960 })];
const span = ms => Math.round((ms / 1000) * 60);

const fade = (clock, from, to, ms, { through = null } = {}) => frames(clock, span(ms), (index, count) => {
  const p = ease((index + 1) / (count + 1));
  const color = through ? (p < 0.5 ? mixColor(from, through, p * 2) : mixColor(through, to, (p - 0.5) * 2)) : mixColor(from, to, p);
  return [flat(color)];
});
// A divisa anda da direita para a esquerda: A à esquerda dela, B à direita (sem mistura, só a célula da divisa).
const slide = (clock, from, to, ms) => frames(clock, span(ms), (index, count) => {
  const p = ease((index + 1) / (count + 1)), boundary = Math.round(CELLS * (1 - p));
  return [Array.from({ length: CELLS }, (_, cell) => (cell < boundary ? from : to))];
});
// O novo cresce a partir do centro (escala 0,82 → 1) enquanto aparece (opacidade 0 → 1); fora dele só se vê o antigo.
const zoom = (clock, from, to, ms) => frames(clock, span(ms), (index, count) => {
  const p = ease((index + 1) / (count + 1)), half = (CELLS * (0.82 + 0.18 * p)) / 2;
  return [Array.from({ length: CELLS }, (_, cell) => (Math.abs(cell + 0.5 - CELLS / 2) <= half ? mixColor(from, to, p) : from))];
});
const cut = (clock, color, seconds) => hold(clock, color, seconds);

const sequence = (...parts) => parts.flat();
const palette = { A, B, C };

test('timeline: ordem dos conteúdos, trocas e tempo de cada um (cortes secos)', () => {
  const clock = { t: 100 };
  const list = sequence(hold(clock, A, 2), cut(clock, B, 3), cut(clock, C, 4), cut(clock, A, 1));
  const { runs, transitions, dwellMs, stray } = timeline(list, palette);
  assert.deepEqual(runs.map(run => run.name), ['A', 'B', 'C', 'A']);
  assert.deepEqual(transitions.map(item => [item.from, item.to, item.frames.length, item.ms]), [['A', 'B', 0, 0], ['B', 'C', 0, 0], ['C', 'A', 0, 0]]);
  assert.equal(dwellMs[0], null, 'a primeira entrada não é conhecida');
  assert.ok(Math.abs(dwellMs[1] - 3000) <= 20, `B ficou ${dwellMs[1]} ms`);
  assert.ok(Math.abs(dwellMs[2] - 4000) <= 20, `C ficou ${dwellMs[2]} ms`);
  assert.equal(dwellMs[3], null, 'o último está incompleto');
  assert.deepEqual(stray, []);
});

test('timeline: os quadros da transição são os que não são de nenhum conteúdo, e têm duração', () => {
  const clock = { t: 100 };
  const list = sequence(hold(clock, A, 2), fade(clock, A, B, 1200), hold(clock, B, 2));
  const { runs, transitions } = timeline(list, palette);
  assert.deepEqual(runs.map(run => run.name), ['A', 'B']);
  assert.equal(transitions.length, 1);
  assert.ok(transitions[0].frames.length >= 20, `só ${transitions[0].frames.length} quadros de transição`);
  assert.ok(transitions[0].ms >= 300 && transitions[0].ms <= 1300, `transição de ${transitions[0].ms} ms`);
});

test('timeline: um quadro fora de lugar não vira conteúdo, e conteúdos iguais separados por ele continuam sendo um só', () => {
  const clock = { t: 100 };
  const list = sequence(hold(clock, A, 1), flash(clock), hold(clock, A, 1), cut(clock, B, 1));
  const { runs, transitions } = timeline(list, palette);
  assert.deepEqual(runs.map(run => run.name), ['A', 'B']);
  assert.equal(transitions.length, 1);
  // …mas a piscada não passa batida: a detecção de tela vazia a encontra.
  assert.equal(blankFrames(list).length, 1);
});

test('timeline: uma cor da paleta aparecendo por 1–2 quadros é "lixo", não um conteúdo', () => {
  const clock = { t: 100 };
  const list = sequence(hold(clock, A, 1), hold(clock, C, 2 / 60), hold(clock, A, 1));
  const { runs, stray } = timeline(list, palette, { minFrames: 3 });
  assert.deepEqual(runs.map(run => run.name), ['A']);
  assert.equal(stray.length, 2);
});

test('blankFrames: acha a piscada de tela vazia entre dois cortes e a faixa vazia entre camadas, mas não conteúdo escuro', () => {
  const clock = { t: 100 };
  const cutWithFlash = sequence(hold(clock, A, 1), flash(clock), hold(clock, B, 1));
  assert.equal(blankFrames(cutWithFlash).length, 1);
  assert.equal(blankFrames(sequence(hold(clock, A, 1), cut(clock, B, 1))).length, 0);

  const strip = shot(1, flat(A), { blankRun: 12 });   // uma faixa vazia de 12 px entre duas camadas que deslizam
  const sliver = shot(2, flat(A), { blankRun: 3 });   // 3 px de ruído de borda não contam
  assert.deepEqual(blankFrames([strip, sliver]), [strip]);

  const dark = [20, 28, 48];                           // listra escura de uma imagem: escura, mas não é o fundo do palco
  assert.equal(isBlank(dark), false);
  assert.equal(isBlank([30, 40, 60]), false);
  assert.equal(isBlank([10, 11, 13]), true);
  assert.equal(blankFrames([shot(3, flat(dark))]).length, 0);
});

test('blankFrames: um ponto vazio só em um canto (camada que não cobre a tela inteira) também é pego', () => {
  const cells = flat(A);
  const frame = shot(1, cells, { cantoID: BG });
  assert.equal(blankFrames([frame]).length, 1);
});

test('esmaecer: mistura igual em toda a tela, sobre a reta A→B, sem passar por escuro', () => {
  const clock = { t: 100 };
  const part = fade(clock, A, B, 1200);
  const { effect, reports } = classifyEffect(part, A, B);
  assert.equal(effect, 'fade');
  assert.ok(reports.blend.maxOffLine <= 4, `fora da reta: ${reports.blend.maxOffLine}`);
  assert.ok(reports.blend.edgeSpread < 0.02);
  assert.ok(reports.blend.backwards < 0.02, 'o progresso nunca anda para trás');
  assert.ok(reports.blend.minLuminance >= Math.min(luminance(A), luminance(B)) - 1);
  assert.equal(reports.slide.sideBySide, 0);
  assert.equal(reports.zoom.growing, 0);
});

test('esmaecer passando por escuro (mergulho no preto) NÃO é aceito como esmaecer', () => {
  const clock = { t: 100 };
  assert.equal(classifyEffect(fade(clock, A, B, 1200, { through: [0, 0, 0] }), A, B).effect, 'dip');
  assert.equal(classifyEffect(fade(clock, A, B, 1200, { through: BG }), A, B).effect, 'dip');
});

test('deslizar: duas cores lado a lado, A sempre à esquerda, divisa indo da direita para a esquerda', () => {
  const clock = { t: 100 };
  const part = slide(clock, A, B, 1200);
  const { effect, reports } = classifyEffect(part, A, B);
  assert.equal(effect, 'slide');
  assert.ok(reports.slide.sideBySide >= 25, `só ${reports.slide.sideBySide} quadros com as duas cores lado a lado`);
  assert.equal(reports.slide.wrongOrder, 0);
  assert.ok(reports.slide.backwards <= 1, 'a divisa não volta');
  assert.ok(reports.slide.travelled >= 36, `a divisa andou só ${reports.slide.travelled} células`);
  assert.equal(reports.slide.mixedMax, 0);
  // Um deslize para o lado errado (B à esquerda) é reprovado.
  const wrong = part.map(sample => ({ ...sample, cells: [...sample.cells].reverse() }));
  assert.equal(slideReport(wrong, A, B).wrongOrder > 0, true);
  assert.notEqual(classifyEffect(wrong, A, B).effect, 'slide');
});

test('zoom: o meio já mostra o novo enquanto as bordas ainda mostram só o antigo', () => {
  const clock = { t: 100 };
  const part = zoom(clock, A, B, 1200);
  const { effect, reports } = classifyEffect(part, A, B);
  assert.equal(effect, 'zoom');
  assert.ok(reports.zoom.growing >= 6, `só ${reports.zoom.growing} quadros crescendo`);
  assert.ok(reports.zoom.maxLag >= 0.3);
  // Um esmaecer não tem essa assinatura.
  assert.equal(zoomReport(fade(clock, A, B, 1200), A, B).growing, 0);
});

test('corte seco: nenhum quadro entre os conteúdos', () => {
  assert.equal(classifyEffect([], A, B).effect, 'cut');
  assert.equal(classifyEffect([shot(1, flat(mixColor(A, B, 0.5)))], A, B).effect, 'cut');
});

test('cada efeito sintético é reconhecido só como ele mesmo (as assinaturas não se confundem)', () => {
  const clock = { t: 100 };
  const made = { fade: fade(clock, A, B, 900), slide: slide(clock, A, B, 900), zoom: zoom(clock, A, B, 900) };
  for (const [name, part] of Object.entries(made)) assert.equal(classifyEffect(part, A, B).effect, name, `${name} foi reconhecido como outro`);
  // …também com outras cores e com ruído de compressão (JPEG): ±3 em cada canal.
  const noisy = list => list.map((sample, index) => {
    const jitter = color => color.map((value, channel) => Math.max(0, Math.min(255, value + ((index * 7 + channel * 3) % 7) - 3)));
    const cells = sample.cells.map(jitter);
    return shot(sample.t, cells);
  });
  for (const [name, part] of Object.entries(made)) assert.equal(classifyEffect(noisy(part), A, B).effect, name, `${name} com ruído foi reconhecido como outro`);
  const other = { fade: fade(clock, C, A, 900), slide: slide(clock, C, A, 900), zoom: zoom(clock, C, A, 900) };
  for (const [name, part] of Object.entries(other)) assert.equal(classifyEffect(part, C, A).effect, name);
});

test('dissolver: com listras, o desfoque apaga as listras no começo; no esmaecer elas ficam nítidas', () => {
  const MEAN = [137, 141, 151], FULL = 11.4, OUT = [250, 220, 120];
  const attenuation = progress => Math.min(1, progress ** 2.2);   // o desfoque diminui conforme o novo aparece
  const make = blurred => {
    const clock = { t: 100 };
    return frames(clock, 72, (index, count) => {
      const p = ease((index + 1) / (count + 1));
      return [flat(mixColor(OUT, MEAN, p)), {}];
    }).map((sample, index, all) => {
      const p = ease((index + 1) / (all.length + 1));
      return { ...sample, sharp: FULL * p * (blurred ? attenuation(p) : 1) + 0.4 };
    });
  };
  const middle = report => report.filter(item => item.progress >= 0.3 && item.progress <= 0.8);
  const dissolve = middle(blurReport(make(true), OUT, MEAN, FULL)), plain = middle(blurReport(make(false), OUT, MEAN, FULL));
  assert.ok(dissolve.length >= 10 && plain.length >= 10);
  assert.ok(Math.min(...dissolve.map(item => item.norm)) < 0.5, 'o dissolver devia apagar as listras no meio da troca');
  assert.ok(Math.min(...plain.map(item => item.norm)) > 0.85, 'o esmaecer não deve desfocar');
  assert.ok(Math.max(...plain.map(item => item.norm)) < 1.25);
});

test('funções de cor: projeção sobre a reta, distância da reta, tolerância e rótulos', () => {
  assert.equal(Math.round(progressOf(mixColor(A, B, 0.25), A, B) * 100), 25);
  assert.equal(progressOf([1, 2, 3], A, A), 0);
  assert.ok(offLine(mixColor(A, B, 0.5), A, B) <= 1);
  assert.ok(offLine([0, 0, 0], A, B) > 60, 'o preto está longe da reta A→B');
  assert.equal(isNear([40, 108, 176], B, 5), true);
  assert.equal(isNear([40, 108, 200], B, 5), false);
  assert.deepEqual(colorOf(shot(1, flat(A)), 'meio'), A);
  assert.deepEqual(labelFrames([shot(1, flat(A)), shot(2, flat(mixColor(A, B, 0.5)))], palette), ['A', null]);
  assert.deepEqual(labelFrames([{ t: 1, centro: B }], palette), ['B'], 'sem varredura de linha, usa o ponto central');
});

test('frameInterval e within: intervalo típico entre quadros e recorte por tempo', () => {
  const clock = { t: 10 };
  const list = hold(clock, A, 1);
  assert.ok(Math.abs(frameInterval(list) - 1 / 60) < 1e-9);
  assert.equal(frameInterval([]), 1 / 60);
  assert.equal(within(list, list[10].t, list[19].t).length, 10);
});
