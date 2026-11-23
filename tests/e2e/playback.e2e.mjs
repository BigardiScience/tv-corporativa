// Reprodução da TV no Chromium de verdade (servidor real, TV pareada pelo código, pixels capturados da tela):
// carrossel automático, tempo de cada conteúdo, vídeo inteiro e com limite, repetição, cada efeito de transição (e só ele), troca sem tela
// vazia, movimento reduzido, navegador sem animações, aparelho lento (simulado), falhas de arquivo e de rede, recuperação e acessibilidade.
//
// Para desenvolver um trecho: E2E_STEPS="efeitos" npm run test:e2e -- playback   (o texto é uma expressão regular sobre o nome da etapa).
//
// O que este teste NÃO prova: o comportamento de uma TV de verdade (LG webOS, Samsung Tizen, Android TV…). O navegador é o Chromium do
// Playwright, num computador. Ele prova o código; a homologação em cada modelo de TV é outra etapa (docs/VALIDACAO.md).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, runScenario } from './harness.mjs';
import {
  COLORS, STRIPE_MEAN, blankFrames, blendReport, blurReport, classifyEffect, connectTv, fixture, framesDuring, noteText, observe, overlapWindows,
  probeOff, probeOn, publishNextVersion, publishToNewTv, saveFrame, statusText, timeline, topTitle, waitForTop
} from './playback-kit.mjs';
import { solidPng, stripedPng } from '../helpers/http.mjs';

const between = (value, min, max, what) => assert.ok(value >= min && value <= max, `${what}: ${value} fora do esperado (${min} a ${max})`);
const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const percentile = (list, p) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const picture = name => path.join(OUTPUT_DIR, name);

// Quadros-chave que o navegador recebeu de cada efeito (o que a página de fato está animando), para conferir que cada efeito é ele mesmo.
const KEYFRAMES = Object.freeze({
  fade: { enter: [{ opacity: '0' }, { opacity: '1' }], exit: null },
  dissolve: { enter: [{ opacity: '0', filter: 'blur(28px)' }, { opacity: '1', filter: 'blur(0px)' }], exit: null },
  slide: { enter: [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }], exit: [{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }] },
  zoom: { enter: [{ opacity: '0', transform: 'scale(0.82)' }, { opacity: '1', transform: 'scale(1)' }], exit: [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }] }
});
const sameFrames = (actual, expected) => JSON.stringify(actual.map(frame => Object.fromEntries(Object.entries(frame).sort()))) === JSON.stringify(expected.map(frame => Object.fromEntries(Object.entries(frame).sort())));

export default () => runScenario('Reprodução da TV: carrossel, tempos, vídeos, efeitos, falhas e recuperação (Chromium)', async (s, step) => {
  const only = process.env.E2E_STEPS ? new RegExp(process.env.E2E_STEPS, 'i') : null;
  const run = (name, body) => (only && !only.test(name) ? Promise.resolve() : step(name, body));
  const report = { limitacao: 'Chromium do Playwright num computador: prova o código, não uma TV.', etapas: {} };
  let kit, helper;
  const media = {};

  // Abre uma TV, executa o cenário e confere que o console dela ficou limpo (só passam as mensagens que o cenário declarou esperar).
  async function withTv(options, body) {
    const tv = await connectTv(s, options);
    try {
      const result = await body(tv);
      assert.deepEqual(tv.problems, [], `Mensagens inesperadas no console da TV:\n${tv.problems.join('\n')}`);
      return result;
    } finally { await tv.close(); }
  }

  const png = (title, color) => kit.approvedMedia(kit.admin, { title, name: `${title.toLowerCase().replace(/\W+/g, '-')}.png`, bytes: solidPng({ color, seed: title }) });
  const item = (title, extra = {}) => ({ media: media[title], durationS: 5, ...extra });
  const palette = (...titles) => Object.fromEntries(titles.map(title => [title, COLORS[PALETTE[title]]]));
  const PALETTE = { Laranja: 'laranja', Lima: 'lima', Turquesa: 'turquesa', Roxo: 'roxo', Rosa: 'rosa', Verde: 'verde', Claro: 'claro', 'Clipe azul': 'azul', 'Clipe roxo': 'roxo' };
  const EFFECT_COLORS = palette('Laranja', 'Lima', 'Turquesa', 'Roxo', 'Rosa');

  // As animações que a página registrou ao começar uma troca devem ser exatamente as do efeito (e só elas).
  function assertKeyframes(window, name, ms, what) {
    const expected = KEYFRAMES[name];
    assert.ok(expected, `${what}: efeito desconhecido ${name}`);
    const animations = window.animations;
    assert.equal(animations.length, expected.exit ? 2 : 1, `${what}: ${name} devia ter ${expected.exit ? 2 : 1} animação(ões), mas o navegador animou ${animations.length}: ${JSON.stringify(animations)}`);
    assert.ok(sameFrames(animations[0].frames, expected.enter), `${what}: quadros-chave de entrada de ${name}: ${JSON.stringify(animations[0].frames)}`);
    assert.equal(animations[0].duration, ms, `${what}: duração da entrada`);
    if (expected.exit) {
      assert.ok(sameFrames(animations[1].frames, expected.exit), `${what}: quadros-chave de saída de ${name}: ${JSON.stringify(animations[1].frames)}`);
      assert.equal(animations[1].duration, ms, `${what}: duração da saída`);
    }
  }

  // Conferências comuns a toda captura: nunca tela vazia, nunca uma faixa sem camada opaca, poucas camadas e poucos arquivos abertos.
  function assertNeverBlank(captured, what, { layers = 3, blobs = 4 } = {}) {
    const blank = blankFrames(captured.samples);
    if (blank.length) {
      const windows = overlapWindows(captured.probe.layers);
      const details = blank.slice(0, 5).map(sample => {
        const window = windows.find(entry => sample.t * 1000 >= entry.from - 100 && sample.t * 1000 <= entry.to + 100);
        return `t=${(sample.t - captured.samples[0].t).toFixed(3)} s, faixa vazia de ${sample.blankRun}px, pontos ${JSON.stringify({ c: sample.centro, e: sample.esquerda, d: sample.direita, se: sample.cantoSE, id: sample.cantoID })}, ${window ? `${Math.round(sample.t * 1000 - window.from)} ms depois do início de uma troca de ${window.ms} ms (${window.animations.map(animation => animation.target).join('/')})` : 'fora de qualquer troca'}`;
      });
      for (const sample of blank.slice(0, 3)) saveFrame(captured.frames, captured.samples.indexOf(sample), picture(`falha-tela-vazia-${captured.samples.indexOf(sample)}.jpg`));
    assert.fail(`${what}: ${blank.length} quadro(s) com tela vazia (fundo do palco) entre ${captured.samples.length} quadros apresentados:\n      ${details.join('\n      ')}`);
    }
    assert.deepEqual(captured.probe.uncovered, [], `${what}: o palco ficou sem camada opaca em algum quadro`);
    assert.ok(captured.probe.maxLayers <= layers, `${what}: ${captured.probe.maxLayers} camadas ao mesmo tempo (máximo ${layers})`);
    assert.ok(captured.probe.maxBlobs <= blobs, `${what}: ${captured.probe.maxBlobs} arquivos abertos ao mesmo tempo (máximo ${blobs})`);
  }
  const progressOf = (frames, from, to) => blendReport(frames, from, to).progress;

  // ---- preparação ---------------------------------------------------------------------------------------------------------------------
  await step('preparar a biblioteca (imagens, vídeos reais em WebM e um arquivo que não é vídeo de verdade) e uma página de apoio', async () => {
    kit = await s.seed();
    for (const title of ['Laranja', 'Lima', 'Turquesa', 'Roxo', 'Rosa', 'Verde', 'Claro']) media[title] = await png(title, COLORS[PALETTE[title]]);
    media.Listras = await kit.approvedMedia(kit.admin, { title: 'Listras', name: 'listras.png', bytes: stripedPng({ seed: 'listras' }) });
    media['Clipe azul'] = await kit.approvedMedia(kit.admin, { title: 'Clipe azul', name: 'clipe-azul.webm', bytes: fixture('video-azul-3s.webm') });
    media['Clipe roxo'] = await kit.approvedMedia(kit.admin, { title: 'Clipe roxo', name: 'clipe-roxo.webm', bytes: fixture('video-roxo-6s.webm') });
    // Passa pela conferência de formato do servidor (assinatura WebM), mas não há vídeo nenhum dentro: o navegador não consegue decodificar.
    media.Corrompido = await kit.approvedMedia(kit.admin, { title: 'Corrompido', name: 'corrompido.webm', bytes: Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(4000, 0x5a)]) });
    helper = await s.context.newPage();
    await helper.goto('about:blank');
  });

  // ---- 1. sequência, tempo, vídeo, repetição ---------------------------------------------------------------------------------------------
  await run('sequência automática, tempo de cada conteúdo, vídeo inteiro e com limite, repetição e nenhuma tela vazia (duas voltas)', async () => {
    const titles = ['Laranja', 'Clipe azul', 'Verde', 'Clipe roxo'];
    const tv0 = await publishToNewTv(kit, {
      name: 'TV sequência',
      items: [item('Laranja'), item('Clipe azul', { durationS: 30, durationMode: 'natural' }), item('Verde'), item('Clipe roxo', { durationS: 5, durationMode: 'fixed' })]
    });
    await withTv({ code: tv0.code }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      const captured = await observe(tv, helper, () => tv.page.waitForTimeout(38_500));
      const { samples, probe } = captured;
      assertNeverBlank(captured, 'sequência');

      // O que o público viu, pelos pixels: a ordem das cores é a da playlist, e ela recomeça (repetição ligada).
      const colors = palette(...titles);
      const { runs, transitions, dwellMs } = timeline(samples, colors, { tolerance: 45, minFrames: 12 });
      const order = runs.map(runItem => runItem.name);
      assert.ok(order.length >= 8, `só ${order.length} conteúdos vistos em 38 s: ${order.join(' > ')}`);
      order.forEach((name, index) => assert.equal(name, titles[(titles.indexOf(order[0]) + index) % titles.length], `ordem vista: ${order.join(' > ')}`));
      assert.ok(transitions.every(t => t.frames.length === 0), 'o corte seco não pode ter quadros intermediários');

      // O que a página registrou: a mesma ordem e os tempos do plano (5 s, vídeo inteiro de 3 s, 5 s, vídeo com limite de 5 s).
      const keys = probe.tops.map(top => top.key);
      assert.deepEqual(keys.slice(0, 5), ['Laranja', 'Clipe azul', 'Verde', 'Clipe roxo', 'Laranja'], 'ordem registrada pela página');
      const expected = { Laranja: [4_850, 5_150], 'Clipe azul': [2_750, 3_250], Verde: [4_850, 5_150], 'Clipe roxo': [4_850, 5_150] };
      const dwell = [];
      for (let index = 1; index < probe.tops.length - 1; index++) {
        const ms = Math.round(probe.tops[index + 1].wall - probe.tops[index].wall);
        const [min, max] = expected[probe.tops[index].key];
        between(ms, min, max, `tempo de "${probe.tops[index].key}" na tela`);
        dwell.push([probe.tops[index].key, ms]);
      }
      assert.ok(dwell.length >= 6, 'tempos conferidos em pelo menos 6 conteúdos (duas voltas)');
      // Pelos pixels (o que o público viu), os mesmos tempos, com a folga do primeiro quadro desenhado.
      dwellMs.forEach((ms, index) => { if (ms !== null) between(ms, ...expected[runs[index].name].map((v, i) => v + (i ? 200 : -200)), `tempo visto de "${runs[index].name}"`); });

      // Memória: cada arquivo foi baixado uma única vez em duas voltas; ficam abertos poucos arquivos; não sobra vídeo na página.
      const downloads = Object.groupBy(tv.media, entry => entry.id);
      for (const title of titles) assert.equal(downloads[media[title].id]?.length, 1, `"${title}" foi baixado ${downloads[media[title].id]?.length ?? 0} vez(es); devia ser 1`);
      assert.ok(tv.media.every(entry => entry.status === 200));
      assert.ok(probe.created >= 8, `só ${probe.created} arquivos abertos em duas voltas`);
      assert.ok(probe.outstanding <= 3, `${probe.outstanding} arquivos abertos ao final (máximo 3: atual, próximo e o que está saindo)`);
      assert.ok(probe.created - probe.revoked === probe.outstanding, 'todo arquivo aberto é solto');
      assert.ok(await tv.page.evaluate(() => document.querySelectorAll('#stage video').length) <= 2, 'vídeos demais na página');
      assert.match(await statusText(tv.page), /^\d de 4 · Em exibição$/);
      assert.ok(median(probe.gaps) < 40, `mediana de ${median(probe.gaps)} ms entre quadros`);

      await saveFrame(captured.frames, Math.floor(captured.frames.length / 2), picture('playback-sequencia.jpg'));
      report.etapas.sequencia = {
        quadrosApresentados: samples.length, conteudosVistos: order.length, temposMs: dwell, arquivosAbertosNoMaximo: probe.maxBlobs, camadasNoMaximo: probe.maxLayers,
        medianaEntreQuadrosMs: Math.round(median(probe.gaps) * 10) / 10, p95EntreQuadrosMs: Math.round(percentile(probe.gaps, 0.95) * 10) / 10
      };
    });
  });

  // ---- 2. cada efeito, um por conteúdo, na mesma sequência ----------------------------------------------------------------------------------
  await run('efeitos: esmaecer, deslizar, zoom e corte na mesma sequência, cada um com a sua assinatura nos pixels e a sua duração', async () => {
    const plan = [['Laranja', 'cut', 0], ['Lima', 'fade', 1200], ['Turquesa', 'slide', 1200], ['Roxo', 'zoom', 1200], ['Rosa', 'fade', 800]];
    const tv0 = await publishToNewTv(kit, { name: 'TV efeitos', items: plan.map(([title, transition, transitionMs]) => item(title, { transition, transitionMs })) });
    await withTv({ code: tv0.code }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      const captured = await observe(tv, helper, () => tv.page.waitForTimeout(27_000));
      const { samples, probe, frames } = captured;
      assertNeverBlank(captured, 'efeitos');

      const { runs, transitions } = timeline(samples, EFFECT_COLORS, { tolerance: 30, minFrames: 12 });
      assert.deepEqual(runs.map(runItem => runItem.name), ['Laranja', 'Lima', 'Turquesa', 'Roxo', 'Rosa', 'Laranja'], 'ordem vista na tela');

      const windows = overlapWindows(probe.layers);
      assert.equal(windows.length, 4, `4 transições com efeito (a 5ª é corte seco): ${windows.length}`);
      const names = [];
      for (let index = 0; index < 4; index++) {
        const [, effect, ms] = plan[index + 1], from = plan[index][0], to = plan[index + 1][0];
        const what = `${from} → ${to} (${effect} ${ms} ms)`;
        const window = windows[index];
        between(window.ms, ms, ms + 150, `duração real da troca ${what}`);
        assertKeyframes(window, effect, ms, what);
        const part = framesDuring(samples, window);
        assert.ok(part.length >= (ms / 1000) * 30, `${what}: só ${part.length} quadros capturados`);
        const verdict = classifyEffect(part, EFFECT_COLORS[from], EFFECT_COLORS[to]);
        assert.equal(verdict.effect, effect, `${what}: pelos pixels parece "${verdict.effect}" ${JSON.stringify({ off: verdict.reports.blend.maxOffLine, spread: verdict.reports.blend.edgeSpread, side: verdict.reports.slide.sideBySide, grow: verdict.reports.zoom.growing })}`);
        names.push(verdict.effect);
        if (effect === 'slide') {
          const slide = verdict.reports.slide;
          assert.ok(slide.travelled >= 40, `${what}: a divisa andou só ${slide.travelled} de 48 células`);
          assert.ok(slide.backwards <= 1, `${what}: a divisa voltou`);
          assert.equal(slide.wrongOrder, 0);
        } else {
          const progress = progressOf(part, EFFECT_COLORS[from], EFFECT_COLORS[to]);
          assert.ok(progress[0] <= 0.2, `${what}: começou já em ${progress[0]} do novo conteúdo (devia partir do antigo)`);
          assert.ok(progress.at(-1) >= 0.8, `${what}: terminou em ${progress.at(-1)} (devia chegar ao novo)`);
          let step = 0;
          for (let i = 1; i < progress.length; i++) step = Math.max(step, Math.abs(progress[i] - progress[i - 1]));
          assert.ok(step <= 0.3, `${what}: salto de ${step} entre dois quadros (não animou de forma contínua)`);
        }
        const middle = part[Math.floor(part.length / 2)];
        await saveFrame(frames, samples.indexOf(middle), picture(`playback-efeito-${index + 1}-${effect}.jpg`));
      }
      assert.deepEqual(names, ['fade', 'slide', 'zoom', 'fade']);
      // Independência: a duração é a de cada conteúdo (800 ms ≠ 1200 ms) e o último (corte seco) não tem nenhum quadro de transição.
      assert.ok(windows[3].ms < windows[0].ms - 250, 'o esmaecer de 800 ms devia ser mais curto que o de 1200 ms');
      assert.equal(transitions.at(-1).frames.length, 0, 'Rosa → Laranja é corte seco');
      // O tempo de cada conteúdo (5 s) inclui a transição de entrada, seja qual for o efeito.
      for (let index = 1; index < probe.tops.length - 1; index++) between(Math.round(probe.tops[index + 1].wall - probe.tops[index].wall), 4_850, 5_150, `tempo de "${probe.tops[index].key}"`);
      report.etapas.efeitos = { transicoesMs: windows.map(window => window.ms), reconhecidos: names, quadrosPorTransicao: windows.map(window => framesDuring(samples, window).length) };
    });
  });

  // ---- 3. dissolver (desfoque) ----------------------------------------------------------------------------------------------------------
  await run('dissolver: o novo conteúdo entra desfocado (listras finas somem e voltam); no esmaecer elas ficam nítidas', async () => {
    const outcome = {};
    for (const effect of ['dissolve', 'fade']) {
      const tv0 = await publishToNewTv(kit, { name: `TV listras ${effect}`, items: [item('Claro', { durationS: 60 }), item('Listras', { durationS: 60, transition: effect, transitionMs: 1200 })] });
      await withTv({ code: tv0.code }, async tv => {
        await waitForTop(tv.page, 'Claro');
        const captured = await observe(tv, helper, async () => { await tv.page.waitForTimeout(400); await tv.page.keyboard.press('n'); await tv.page.waitForTimeout(2_400); });
        const [window] = overlapWindows(captured.probe.layers);
        assert.ok(window, `${effect}: nenhuma troca registrada`);
        between(window.ms, 1200, 1350, `duração da troca (${effect})`);
        assertKeyframes(window, effect, 1200, effect);
        const part = framesDuring(captured.samples, window);
        const settled = captured.samples.slice(-4).map(sample => sample.sharp);
        const sharpFull = median(settled);
        assert.ok(sharpFull > 5, `listras nítidas ao final deviam variar bastante entre pixels vizinhos (${sharpFull})`);
        const profile = blurReport(part, COLORS.claro, STRIPE_MEAN, sharpFull).filter(entry => entry.norm !== null && entry.progress >= 0.3 && entry.progress <= 0.8);
        assert.ok(profile.length >= 8, `${effect}: só ${profile.length} quadros no meio da troca`);
        outcome[effect] = { min: Math.min(...profile.map(entry => entry.norm)), max: Math.max(...profile.map(entry => entry.norm)), quadros: profile.length };
        if (effect === 'dissolve') await saveFrame(captured.frames, captured.samples.indexOf(part[Math.floor(part.length * 0.35)]), picture('playback-efeito-dissolver.jpg'));
        assert.deepEqual(captured.probe.uncovered, []);
      });
    }
    assert.ok(outcome.dissolve.min < 0.5, `dissolver: listras deviam sumir no meio da troca (nitidez relativa mínima ${outcome.dissolve.min.toFixed(2)})`);
    assert.ok(outcome.fade.min > 0.75 && outcome.fade.max < 1.3, `esmaecer não pode desfocar (nitidez relativa ${outcome.fade.min.toFixed(2)}–${outcome.fade.max.toFixed(2)})`);
    report.etapas.dissolver = outcome;
  });

  // ---- 4. cada efeito entrando num vídeo ----------------------------------------------------------------------------------------------------
  await run('troca para um vídeo com cada efeito (e corte seco): sem tela vazia, sem piscada no primeiro quadro, vídeo tocando', async () => {
    const results = {};
    for (const effect of ['cut', 'fade', 'dissolve', 'slide', 'zoom']) {
      const ms = effect === 'cut' ? 0 : 1000;
      const tv0 = await publishToNewTv(kit, { name: `TV vídeo ${effect}`, items: [item('Laranja', { durationS: 60 }), item('Clipe azul', { durationS: 30, durationMode: 'natural', transition: effect, transitionMs: ms })] });
      await withTv({ code: tv0.code }, async tv => {
        await waitForTop(tv.page, 'Laranja');
        // O estado da tela é lido ao fim da janela observada: o vídeo dura 3 s ("até o fim") e, depois, a sequência volta ao primeiro conteúdo.
        const captured = await observe(tv, helper, async () => {
          await tv.page.waitForTimeout(500);
          await tv.page.keyboard.press('n');
          await tv.page.waitForTimeout(ms + 1_500);
          return {
            top: await topTitle(tv.page), status: await statusText(tv.page), note: await noteText(tv.page),
            video: await tv.page.evaluate(() => { const video = document.querySelector('#stage .stage-layer:not(.is-standby) video'); return video ? { time: video.currentTime, paused: video.paused, muted: video.muted, volume: video.volume, blocked: !document.querySelector('#audio-notice').hidden } : null; })
          };
        });
        assertNeverBlank(captured, `Laranja → vídeo (${effect})`);
        const { top, video: playing } = captured.result;
        assert.equal(top, 'Clipe azul', `${effect}: depois de avançar o topo é "${top}" (status: ${captured.result.status} | aviso: ${captured.result.note} | conteúdos no topo, em ordem: ${captured.probe.tops.map(entry => entry.key)} | arquivos pedidos: ${tv.media.map(entry => entry.status)})`);
        assert.ok(playing && !playing.paused && playing.time > 0.3, `${effect}: o vídeo devia estar tocando: ${JSON.stringify(playing)}`);
        assert.equal(playing.volume, 1, 'volume inicial máximo');
        assert.equal(playing.muted, playing.blocked, 'som habilitado; se a política o bloquear, fallback mudo precisa de aviso acessível');
        const last = captured.samples.at(-1);
        assert.ok(Math.max(...last.centro.map((value, index) => Math.abs(value - COLORS.azul[index]))) <= 45, `o fim da captura devia mostrar o vídeo azul: ${last.centro}`);
        const windows = overlapWindows(captured.probe.layers);
        if (effect === 'cut') {
          assert.equal(windows.length, 1, 'o corte para vídeo passa por uma espera curta com as duas camadas (aquecimento do primeiro quadro)');
          between(windows[0].ms, 20, 200, 'espera do primeiro quadro do vídeo');
          assert.deepEqual(windows[0].animations, [], 'corte seco não anima');
        } else {
          assert.equal(windows.length, 1);
          between(windows[0].ms, ms, ms + 150, `duração da troca (${effect})`);
          assertKeyframes(windows[0], effect, ms, `${effect} para vídeo`);
        }
        results[effect] = { janelaMs: windows[0].ms, quadros: captured.samples.length };
      });
    }
    report.etapas.efeitosParaVideo = results;
  });

  // ---- 5. movimento reduzido ---------------------------------------------------------------------------------------------------------------------
  const motionPlan = [['Laranja', 'cut', 0], ['Lima', 'slide', 1200], ['Turquesa', 'zoom', 1200], ['Roxo', 'dissolve', 1200], ['Rosa', 'fade', 800]];
  await run('movimento reduzido no sistema: deslizar, zoom e dissolver viram só esmaecer, avisam o motivo e continuam suaves', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV movimento reduzido', items: motionPlan.map(([title, transition, transitionMs]) => item(title, { durationS: 60, transition, transitionMs })) });
    await withTv({ code: tv0.code, reducedMotion: 'reduce' }, async tv => {
      assert.equal(await tv.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await waitForTop(tv.page, 'Laranja');
      const notes = [];
      const captured = await observe(tv, helper, async () => {
        for (let index = 1; index < motionPlan.length; index++) {
          await tv.page.keyboard.press('n');
          await tv.page.waitForTimeout(500);
          notes.push(await noteText(tv.page));
          await tv.page.waitForTimeout(motionPlan[index][2] + 700);
        }
      });
      assertNeverBlank(captured, 'movimento reduzido');
      const windows = overlapWindows(captured.probe.layers);
      assert.equal(windows.length, 4);
      windows.forEach((window, index) => {
        const [, requested, ms] = motionPlan[index + 1], from = motionPlan[index][0], to = motionPlan[index + 1][0], what = `${from} → ${to} (${requested} pedido)`;
        between(window.ms, ms, ms + 150, `duração ${what}`);
        assertKeyframes(window, 'fade', ms, what);
        const verdict = classifyEffect(framesDuring(captured.samples, window), EFFECT_COLORS[from], EFFECT_COLORS[to]);
        assert.equal(verdict.effect, 'fade', `${what}: com movimento reduzido só pode esmaecer, mas pelos pixels parece "${verdict.effect}"`);
      });
      assert.deepEqual(notes.slice(0, 3).map(note => note), Array(3).fill('Efeito simplificado: movimento reduzido ativo.'));
      assert.equal(notes[3], '', 'esmaecer pedido e esmaecer exibido: sem aviso de simplificação');
      report.etapas.movimentoReduzido = { avisos: notes, duracoesMs: windows.map(window => window.ms) };
    });
  });

  // ---- 6. navegador sem animações -------------------------------------------------------------------------------------------------------------
  await run('navegador sem a API de animações: toda troca vira corte seco, com aviso, sem erro e sem tela vazia', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV sem animações', items: motionPlan.map(([title, transition, transitionMs]) => item(title, { durationS: 60, transition, transitionMs })) });
    await withTv({ code: tv0.code, noAnimationApi: true }, async tv => {
      assert.equal(await tv.page.evaluate(() => typeof Element.prototype.animate), 'undefined');
      await waitForTop(tv.page, 'Laranja');
      const notes = [];
      const captured = await observe(tv, helper, async () => {
        await tv.page.waitForTimeout(900);               // o primeiro conteúdo também precisa aparecer na captura
        for (let index = 1; index < motionPlan.length; index++) {
          await tv.page.keyboard.press('n');
          await tv.page.waitForTimeout(500);
          notes.push(await noteText(tv.page));
          await tv.page.waitForTimeout(900);
        }
      });
      assertNeverBlank(captured, 'sem animações');
      assert.equal(overlapWindows(captured.probe.layers).length, 0, 'sem animações não há duas camadas ao mesmo tempo');
      // Só há cortes: uma tela parada gera poucos quadros na captura, então um trecho de cor só precisa de alguns quadros (não há mistura de cores para confundir).
      const { runs, transitions } = timeline(captured.samples, EFFECT_COLORS, { tolerance: 30, minFrames: 3 });
      assert.deepEqual(runs.map(runItem => runItem.name), motionPlan.map(([title]) => title));
      assert.ok(transitions.every(t => t.frames.length === 0), 'toda troca é corte seco');
      assert.deepEqual(notes.slice(0, 3), Array(3).fill('Efeito simplificado: este navegador não anima transições.'));
      report.etapas.semAnimacoes = { avisos: notes };
    });
  });

  // ---- 7. aparelho lento (simulado) -----------------------------------------------------------------------------------------------------------
  await run('aparelho lento (simulado): duas trocas travadas baixam o nível de efeitos, avisam, guardam o nível e continuam depois de recarregar', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV lenta', items: motionPlan.map(([title, transition, transitionMs]) => item(title, { durationS: 60, transition, transitionMs: transition === 'cut' ? 0 : 1200 })) });
    await withTv({ code: tv0.code }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      // Simulação: a thread principal da página fica ocupada ~90% do tempo, como numa TV fraca. Não é um aparelho de verdade.
      await tv.page.evaluate(() => { window.__jank = setInterval(() => { const end = performance.now() + 80; while (performance.now() < end); }, 8); });
      await tv.page.keyboard.press('n');                 // Laranja → Lima (deslizar): trava #1
      await waitForTop(tv.page, 'Lima', 15_000);
      await tv.page.waitForTimeout(2_600);
      assert.equal(await noteText(tv.page), '', 'uma única troca lenta ainda não baixa o nível');
      await tv.page.keyboard.press('n');                 // Lima → Turquesa (zoom): trava #2 → nível baixa
      await waitForTop(tv.page, 'Turquesa', 15_000);
      await tv.page.waitForFunction(() => /Efeitos simplificados para manter a exibição fluida/.test(document.querySelector('#playback-note')?.textContent ?? ''), null, { timeout: 15_000 });
      await tv.page.evaluate(() => clearInterval(window.__jank));
      const stored = await tv.page.evaluate(() => JSON.parse(localStorage.getItem('tv-corporativa.playback-tier.v1')));
      assert.equal(stored.tier, 'reduced', 'o nível aprendido é guardado');
      assert.match(await tv.page.locator('#announcement').textContent(), /Efeitos simplificados/);

      // Aparelho "recuperado": o efeito pedido (dissolver) passa a ser mostrado como esmaecer, com o motivo.
      await tv.page.waitForTimeout(500);
      const captured = await observe(tv, helper, async () => { await tv.page.keyboard.press('n'); await tv.page.waitForTimeout(1_800); });
      const [window] = overlapWindows(captured.probe.layers);
      assertKeyframes(window, 'fade', 1200, 'Turquesa → Roxo com o nível reduzido');
      assert.equal(classifyEffect(framesDuring(captured.samples, window), EFFECT_COLORS.Turquesa, EFFECT_COLORS.Roxo).effect, 'fade');
      assert.equal(await noteText(tv.page), 'Efeito simplificado: aparelho com desempenho limitado.');

      // Recarregar a página (a TV reinicia): o nível continua reduzido, então o deslizar pedido segue sendo esmaecer.
      await tv.page.reload();
      await tv.page.waitForSelector('#playback:not([hidden])');
      await tv.page.waitForFunction(() => document.querySelectorAll('#stage > .stage-layer:not(.is-standby)').length >= 1);
      await probeOn(tv.page);
      await tv.page.keyboard.press('p');
      await tv.page.keyboard.press('p');                 // volta até o deslizar (Lima)
      await waitForTop(tv.page, 'Lima', 15_000);
      await tv.page.waitForTimeout(1_600);
      const after = await probeOff(tv.page);
      const windowsAfter = overlapWindows(after.layers);
      assert.ok(windowsAfter.length >= 1);
      assert.ok(windowsAfter.every(entry => entry.animations.every(animation => animation.frames.every(frame => Object.keys(frame).join() === 'opacity'))), 'depois de recarregar, só esmaecer');
      // O nível pode ser refeito: apagado o que foi guardado, o deslizar volta a ser deslizar.
      await tv.page.evaluate(() => localStorage.removeItem('tv-corporativa.playback-tier.v1'));
      await tv.page.reload();
      await tv.page.waitForFunction(() => document.querySelectorAll('#stage > .stage-layer:not(.is-standby)').length >= 1);
      await probeOn(tv.page);
      await tv.page.keyboard.press('n');
      await tv.page.waitForTimeout(1_700);
      const restored = overlapWindows((await probeOff(tv.page)).layers);
      assert.ok(restored.length >= 1 && restored.some(entry => entry.animations.some(animation => animation.frames.some(frame => 'transform' in frame))), 'sem o nível guardado, os efeitos completos voltam');
      report.etapas.aparelhoLento = { nivelGuardado: stored.tier, simulacao: 'thread principal ocupada de propósito (não é uma TV)' };
    });
  });

  // ---- 8. falhas de arquivo ----------------------------------------------------------------------------------------------------------------------
  await run('arquivo ausente (404): o conteúdo é pulado com aviso, o resto continua sem tela vazia, e ele volta sozinho quando o arquivo volta', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV arquivo ausente', items: [item('Laranja'), item('Verde'), item('Lima')] });
    let missing = true;
    const toggle = { missing: () => missing };
    await withTv({
      code: tv0.code, tolerate: [/status of 404/],
      setup: async context => { await context.route(`**/api/media/${media.Verde.id}/file`, route => (toggle.missing() ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"não encontrado"}' }) : route.continue())); }
    }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      await tv.page.waitForFunction(() => /conteúdo pulado/.test(document.querySelector('#playback-status')?.textContent ?? ''), null, { timeout: 15_000 });
      assert.equal(await noteText(tv.page), 'Conteúdo pulado: Verde (arquivo não encontrado no servidor).');
      assert.match(await tv.page.locator('#announcement').textContent(), /Verde não pôde ser exibido \(arquivo não encontrado no servidor\) e foi pulado/);
      const captured = await observe(tv, helper, () => tv.page.waitForTimeout(13_000));
      assertNeverBlank(captured, 'com um arquivo ausente');
      assert.ok(captured.probe.tops.length >= 2, 'o carrossel segue girando');
      assert.ok(captured.probe.tops.every(top => top.key !== 'Verde'), 'o conteúdo ausente não aparece');
      assert.ok(captured.probe.tops.every(top => ['Laranja', 'Lima'].includes(top.key)));
      // O arquivo volta: o motor tenta de novo depois do tempo de espera (30 s) e o conteúdo retorna à sequência, sem ninguém mexer.
      missing = false;
      const back = Date.now();
      await waitForTop(tv.page, 'Verde', 60_000);
      await tv.page.waitForFunction(() => !/pulado/.test(document.querySelector('#playback-status')?.textContent ?? ''), null, { timeout: 5_000 });
      assert.equal(await noteText(tv.page), '');
      report.etapas.arquivoAusente = { voltouEmSegundos: Math.round((Date.now() - back) / 1000) };
    });
  });

  await run('falha passageira do servidor (503): o arquivo é pedido de novo e aparece, sem ser pulado', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV 503', items: [item('Laranja'), item('Verde'), item('Lima')] });
    let requests = 0;
    await withTv({
      code: tv0.code, tolerate: [/status of 503/],
      setup: async context => { await context.route(`**/api/media/${media.Verde.id}/file`, route => (++requests <= 2 ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"indisponível"}' }) : route.continue())); }
    }, async tv => {
      let everSkipped = false;
      const watcher = setInterval(async () => { try { if (/pulado/.test(await statusText(tv.page))) everSkipped = true; } catch { /* página trocando */ } }, 250);
      try { await waitForTop(tv.page, 'Verde', 30_000); } finally { clearInterval(watcher); }
      assert.equal(requests, 3, 'duas respostas 503 e a terceira tentativa deu certo');
      assert.equal(everSkipped, false, 'uma falha passageira não pode pular o conteúdo');
      assert.equal((Object.groupBy(tv.media, entry => entry.id)[media.Verde.id] ?? []).filter(entry => entry.status === 200).length, 1);
    });
  });

  await run('vídeo que o aparelho não consegue decodificar: é pulado com o motivo, e o resto da sequência segue sem tela vazia', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV vídeo corrompido', items: [item('Laranja'), item('Corrompido', { durationS: 30, durationMode: 'natural' }), item('Lima')] });
    await withTv({ code: tv0.code, tolerate: [/Failed to load resource/, /DEMUXER|PIPELINE|FFmpeg|decode/i] }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      await tv.page.waitForFunction(() => /conteúdo pulado/.test(document.querySelector('#playback-status')?.textContent ?? ''), null, { timeout: 20_000 });
      assert.equal(await noteText(tv.page), 'Conteúdo pulado: Corrompido (formato ou arquivo não suportado por esta TV).');
      const captured = await observe(tv, helper, () => tv.page.waitForTimeout(12_000));
      assertNeverBlank(captured, 'com vídeo corrompido');
      assert.ok(captured.probe.tops.length >= 2);
      assert.ok(captured.probe.tops.every(top => ['Laranja', 'Lima'].includes(top.key)), `apareceu ${captured.probe.tops.map(top => top.key)}`);
    });
  });

  // ---- 9. falhas de rede -----------------------------------------------------------------------------------------------------------------------
  await run('queda curta de rede (menos que a validade de 60 s): a exibição continua do que já foi baixado, avisa "Reconectando…", normaliza sozinha e o que faltou volta', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV queda curta', items: [item('Laranja'), item('Lima'), item('Turquesa')] });
    await withTv({ code: tv0.code, tolerate: [/ERR_INTERNET_DISCONNECTED|Failed to load resource/] }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      await tv.page.waitForTimeout(1_500);
      const reconnecting = () => tv.page.waitForFunction(() => /Reconectando…/.test(document.querySelector('#playback-status')?.textContent ?? ''), null, { timeout: 30_000 });
      // Tudo o que acontece com a rede fora do ar fica dentro da janela observada (a captura dos quadros demora e não pode deixar a TV sem rede).
      const captured = await observe(tv, helper, async () => {
        await tv.context.setOffline(true);
        const since = Date.now();
        await reconnecting();                              // a TV consulta a programação a cada 20 s: a primeira consulta sem rede acende o aviso
        // Sem rede a sequência continua: espera três conteúdos seguidos no topo (Laranja → Lima → Laranja), tudo já baixado ou em memória.
        await tv.page.waitForFunction(() => window.__pc.tops.length >= 3, null, { timeout: 25_000 });
        const offline = { status: await statusText(tv.page), note: await noteText(tv.page), seconds: Math.round((Date.now() - since) / 1000) };
        await tv.context.setOffline(false);
        await tv.page.waitForFunction(() => !/Reconectando/.test(document.querySelector('#playback-status')?.textContent ?? ''), null, { timeout: 20_000 });
        return { offline, back: { status: await statusText(tv.page) } };
      });
      assertNeverBlank(captured, 'sem rede');
      const { offline, back } = captured.result;
      assert.ok(offline.seconds < 40, `a queda de teste precisa ser mais curta que a validade (60 s): durou ${offline.seconds} s`);
      assert.ok(captured.probe.tops.length >= 3, `com a rede fora do ar a sequência devia continuar (${captured.probe.tops.map(top => top.key)})`);
      assert.ok(captured.probe.tops.every(top => ['Laranja', 'Lima', 'Turquesa'].includes(top.key)));
      assert.match(offline.status, /Reconectando…/);
      // O que o leitor de tela ouviu, em ordem (a região de avisos guarda só o último; o registro completo vem da sonda).
      const heard = captured.probe.announcements.map(entry => entry.text);
      const at = pattern => heard.findIndex(text => pattern.test(text));
      const down = at(/Sem rede\. A exibição continua|Sem resposta do servidor/);
      assert.ok(down >= 0, `avisos ouvidos: ${JSON.stringify(heard)}`);
      // Só o próximo conteúdo é baixado com antecedência: o terceiro não pôde ser baixado sem rede e fica de fora, com o motivo, até a rede voltar.
      assert.match(offline.status, /1 conteúdo pulado/);
      assert.equal(offline.note, 'Conteúdo pulado: Turquesa (falha de rede ao baixar o arquivo).');
      assert.ok(at(/Turquesa não pôde ser exibido \(falha de rede ao baixar o arquivo\) e foi pulado/) >= 0, `avisos ouvidos: ${JSON.stringify(heard)}`);
      assert.ok(at(/Conexão restabelecida/) > down, `o aviso de rede de volta devia vir depois do de queda: ${JSON.stringify(heard)}`);
      assert.match(back.status, /Em exibição/);
      // Rede de volta: o motor tenta de novo o conteúdo que faltou (depois do tempo de espera de 30 s) e ele volta à sequência sem ninguém mexer.
      await waitForTop(tv.page, 'Turquesa', 60_000);
      assert.doesNotMatch(await statusText(tv.page), /pulado|Reconectando/);
      report.etapas.quedaCurta = { segundosSemRede: offline.seconds, conteudoQueFaltou: 'Turquesa', voltouSozinho: true };
    });
  });

  await run('queda longa de rede (mais que a validade de 60 s): a TV para de exibir por segurança e, ao voltar, retoma do ponto em que estava (e de novo ao recarregar)', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV queda longa', items: [item('Laranja', { durationS: 600 }), item('Lima', { durationS: 600 }), item('Turquesa', { durationS: 600 })] });
    await withTv({ code: tv0.code, tolerate: [/ERR_INTERNET_DISCONNECTED|Failed to load resource/] }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      await tv.page.keyboard.press('n');
      await waitForTop(tv.page, 'Lima');
      await tv.context.setOffline(true);
      const since = Date.now();
      await tv.page.waitForFunction(() => !document.querySelector('#empty').hidden && /Conexão interrompida/.test(document.querySelector('#empty-title').textContent), null, { timeout: 90_000 });
      const seconds = Math.round((Date.now() - since) / 1000);
      between(seconds, 35, 75, 'tempo até a TV parar de exibir sem conexão (a autorização vale até 60 s)');
      assert.equal(await tv.page.locator('#stage > .stage-layer').count(), 0, 'o conteúdo sai da tela');
      assert.match(await tv.page.locator('#empty-description').textContent(), /pausada para proteger o conteúdo/);
      await tv.context.setOffline(false);
      await waitForTop(tv.page, 'Lima', 30_000);                          // retoma do mesmo conteúdo, não do primeiro
      assert.equal(await tv.page.locator('#empty').isHidden(), true);
      assert.match(await statusText(tv.page), /^2 de 3 · Em exibição/);
      // Recarregar a página (queda de energia, atualização do navegador da TV): continua do mesmo ponto.
      await tv.page.reload();
      await waitForTop(tv.page, 'Lima', 30_000);
      assert.match(await statusText(tv.page), /^2 de 3/);
      report.etapas.quedaLonga = { segundosAtePararDeExibir: seconds };
    });
  });

  // ---- 10. mudança de programação com a TV ligada -----------------------------------------------------------------------------------------------
  await run('nova versão da playlist publicada com a TV ligada: a TV passa para ela sozinha, sem tela vazia e soltando o que saiu', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV nova versão', items: [item('Laranja'), item('Lima')] });
    await withTv({ code: tv0.code }, async tv => {
      await waitForTop(tv.page, 'Laranja');
      const started = Date.now();
      await publishNextVersion(kit, tv0, { items: [item('Roxo', { transition: 'fade', transitionMs: 800 }), item('Rosa')] });
      const captured = await observe(tv, helper, async () => {
        await tv.page.waitForFunction(() => ['Roxo', 'Rosa'].includes([...document.querySelectorAll('#stage > .stage-layer:not(.is-standby) [alt]')].at(-1)?.getAttribute('alt')), null, { timeout: 40_000, polling: 250 });
        await tv.page.waitForTimeout(11_000);
      });
      const seconds = Math.round((Date.now() - started) / 1000);
      assertNeverBlank(captured, 'troca de versão');
      const keys = captured.probe.tops.map(top => top.key);
      const firstNew = keys.findIndex(key => ['Roxo', 'Rosa'].includes(key));
      assert.ok(firstNew >= 0, `a TV não passou para a nova versão: ${keys}`);
      assert.ok(keys.slice(firstNew).every(key => ['Roxo', 'Rosa'].includes(key)), `depois da troca só devia aparecer a versão nova: ${keys}`);
      assert.match(await statusText(tv.page), /^\d de 2 · Em exibição$/);
      const downloads = Object.groupBy(tv.media, entry => entry.id);
      for (const title of ['Roxo', 'Rosa']) assert.equal(downloads[media[title].id]?.length, 1, `"${title}" baixado uma vez`);
      assert.ok(captured.probe.outstanding <= 3, `${captured.probe.outstanding} arquivos ainda abertos`);
      report.etapas.novaVersao = { segundosAteAplicar: seconds, observacao: 'a TV consulta a programação a cada 20 s' };
    });
  });

  // ---- 11. acessibilidade e controles -----------------------------------------------------------------------------------------------------------
  await run('acessibilidade do player: teclado (K, N, P, espaço), pausa que guarda o tempo restante, anúncios, nomes dos botões e só o conteúdo visível exposto', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV acessibilidade', items: [item('Laranja', { durationS: 8 }), item('Lima', { durationS: 8, transition: 'fade', transitionMs: 1200 }), item('Turquesa', { durationS: 8 })] });
    await withTv({ code: tv0.code }, async tv => {
      const { page } = tv;
      // Depois de conectar, o foco já está num botão: dá para operar só com o controle remoto (setas/OK).
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'fullscreen');
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'pt-BR');
      await waitForTop(page, 'Laranja');
      // Nomes acessíveis dos botões e da região de status.
      for (const name of ['Conteúdo anterior', 'Pausar reprodução', 'Próximo conteúdo', 'Entrar em tela cheia']) assert.equal(await page.getByRole('button', { name }).count(), 1, `botão "${name}"`);
      assert.equal(await page.locator('#announcement').getAttribute('aria-live'), 'polite');
      assert.equal(await page.locator('#playback-status').getAttribute('role'), 'status');
      assert.equal(await page.locator('#stage').getAttribute('aria-live'), 'off', 'o palco não anuncia sozinho a cada troca');

      // Só o conteúdo que está na tela existe para o leitor de tela: o próximo, já preparado, fica escondido (aria-hidden).
      const tree = await page.locator('#stage').ariaSnapshot();
      assert.match(tree, /img "Laranja"/);
      assert.doesNotMatch(tree, /Lima|Turquesa/);
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('#stage > .stage-layer.is-standby')].every(layer => layer.getAttribute('aria-hidden') === 'true')));

      // Pausa por teclado: o conteúdo fica; ao retomar, só falta o tempo que restava (8 s − ~3 s).
      await page.waitForTimeout(3_000);
      await page.keyboard.press('k');
      assert.match(await statusText(page), /^1 de 3 · Pausado$/);
      assert.equal(await page.getByRole('button', { name: 'Reproduzir conteúdo' }).count(), 1);
      assert.equal(await page.locator('#announcement').textContent(), 'Reprodução pausada.');
      await page.waitForTimeout(9_000);                                    // mais que a duração inteira do conteúdo
      assert.equal(await topTitle(page), 'Laranja', 'em pausa o conteúdo não troca');
      const resumedAt = Date.now();
      await page.keyboard.press('k');
      assert.equal(await page.locator('#announcement').textContent(), 'Reprodução retomada.');
      await waitForTop(page, 'Lima', 10_000);
      between(Date.now() - resumedAt, 3_800, 6_600, 'tempo restante depois de retomar');

      // Durante o esmaecer, o leitor de tela já enxerga só o novo conteúdo (o que está saindo vira aria-hidden).
      await page.keyboard.press('n');
      await page.waitForTimeout(300);
      const during = await page.locator('#stage').ariaSnapshot();
      assert.match(during, /img "Turquesa"/);
      assert.doesNotMatch(during, /Lima|Laranja/);
      await page.keyboard.press('p');
      await waitForTop(page, 'Lima', 5_000);
      // Espaço alterna quando o foco não está num botão; num botão, o espaço aciona o botão (não pausa duas vezes).
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press(' ');
      assert.match(await statusText(page), /Pausado/);
      await page.keyboard.press(' ');
      assert.match(await statusText(page), /Em exibição/);
      // Os botões da tela fazem o mesmo que o teclado.
      await page.getByRole('button', { name: 'Próximo conteúdo' }).click();
      await waitForTop(page, 'Turquesa', 5_000);
      await page.getByRole('button', { name: 'Conteúdo anterior' }).click();
      await waitForTop(page, 'Lima', 5_000);
      await page.getByRole('button', { name: 'Pausar reprodução' }).click();
      assert.match(await statusText(page), /Pausado/);
      assert.equal(await page.getByRole('button', { name: 'Reproduzir conteúdo' }).count(), 1);
    });
  });

  await step('relatório das medições salvo em tests/e2e/output/playback-report.json', async () => {
    writeFileSync(path.join(OUTPUT_DIR, 'playback-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  });
});
