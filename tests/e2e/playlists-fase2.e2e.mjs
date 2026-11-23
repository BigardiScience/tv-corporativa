// Painel de playlists (Fase 2) no Chromium, com servidor e arquivos de verdade: repetição contínua, tempo do vídeo (limite ou até o fim),
// "Ver efeito" (cada efeito animado pelo navegador e visto nos pixels da tela), "Usar este efeito", pré-visualização da playlist
// (rascunho, antes de publicar, versão publicada e programação), teclado e leitor de tela, movimento reduzido e perfis.
// Complementa playlists.e2e.mjs (Fase 1: montar, reordenar, salvar, publicar). Para desenvolver um trecho: E2E_STEPS="efeito" (expressão regular).
//
// O que isto NÃO prova: o comportamento de uma TV. O navegador é o Chromium do Playwright num computador.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, chooseSpace, expectNoIssues, loginAs, runScenario } from './harness.mjs';
import { PASSWORD } from '../helpers/app.mjs';
import { solidPng } from '../helpers/http.mjs';
import { COLORS, fixture, sampleFrames, startCapture } from './playback-kit.mjs';

const exact = text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// Cores da demonstração de efeitos (panel.css): "Conteúdo A" é liso (#273434) e "Conteúdo B" é um degradê laranja.
const FUNDO_A = [39, 52, 52];
const near = (color, target, tolerance) => color.every((value, index) => Math.abs(value - target[index]) <= tolerance);
const kind = color => (near(color, FUNDO_A, 32) ? 'A' : color[0] >= 190 && color[0] - color[2] >= 100 ? 'B' : 'mix');

// O que o navegador está animando de verdade na área de demonstração, lido no mesmo instante em que a animação aparece (ela só existe
// durante a troca). `properties` é o conjunto de propriedades animadas por cada animação.
const catchAnimations = (page, timeout = 10_000) => page.waitForFunction(() => {
  const list = document.getAnimations().filter(animation => animation.effect?.target?.closest?.('.preview-stage'));
  if (!list.length) return null;
  return list.map(animation => {
    const keyframes = animation.effect.getKeyframes().map(({ offset, computedOffset, easing, composite, ...rest }) => rest);
    return { duration: animation.effect.getTiming().duration, properties: [...new Set(keyframes.flatMap(frame => Object.keys(frame)))].sort().join('+'), keyframes };
  });
}, null, { timeout }).then(handle => handle.jsonValue());

const anyAnimation = () => document.getAnimations().some(animation => animation.effect?.target?.closest?.('.preview-stage'));

export default () => runScenario('Playlists (Fase 2): repetição, tempo do vídeo, escolha de efeito, pré-visualização e acessibilidade', async (s, step) => {
  const { page } = s;
  const only = process.env.E2E_STEPS ? new RegExp(process.env.E2E_STEPS, 'i') : null;
  const run = (name, body) => (only && !only.test(name) ? Promise.resolve() : step(name, body));
  let kit, helper, playlistId;
  const media = {};
  const report = { limitacao: 'Chromium do Playwright num computador, sem placa de vídeo: prova o código, não uma TV.', etapas: {} };

  const row = title => page.locator('.pl-item', { has: page.locator('.pl-title', { hasText: exact(title) }) });
  const state = () => page.locator('.save-state').innerText();
  const saved = async () => {
    const response = await kit.call(`/api/playlists/${playlistId}`, { session: kit.admin });
    assert.equal(response.status, 200);
    return response.data;
  };
  const save = async () => {
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.waitForFunction(() => document.querySelector('.save-state')?.textContent === 'Tudo salvo');
  };
  const openEditor = async () => {
    await page.goto(`${s.origin}/#/playlists/${playlistId}`);
    await page.locator('.pl-item').first().waitFor();
  };
  // Rola a página até o resumo da lista, para as capturas de tela das documentações mostrarem os conteúdos e não só o início da página.
  const showContents = () => page.locator('.pl-summary').evaluate(element => element.closest('.panel-head').scrollIntoView({ block: 'start' }));
  // Aviso falado (região role="status"): o leitor de tela lê cada mudança de texto dela.
  const announced = (text, timeout = 5_000) => page.waitForFunction(expected => [...document.querySelectorAll('[role="status"]')].some(node => node.textContent.includes(expected)), text, { timeout });
  const dialogs = count => page.waitForFunction(expected => document.querySelectorAll('#dialogs dialog').length === expected, count);
  const closeTop = async remaining => { await page.keyboard.press('Escape'); await dialogs(remaining); };
  const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '');
  const described = label => page.evaluate(text => {
    const element = [...document.querySelectorAll('select, input')].find(node => node.getAttribute('aria-label') === text);
    return element ? (document.getElementById(element.getAttribute('aria-describedby'))?.textContent ?? '') : null;
  }, label);

  // Abre "Ver efeito" de um conteúdo. Devolve a janela.
  async function openDemo(title) {
    await page.getByRole('button', { name: `Ver efeito de “${title}”` }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: 'Ver efeito de transição' }).waitFor();
    return dialog;
  }

  // Filma a área de demonstração (a tela de verdade, quadro a quadro) durante UMA troca e resume o que se viu nos três pontos de uma linha
  // perto do topo (longe da letra e da legenda): esquerda, centro e direita. Cada efeito deixa uma assinatura diferente nesses pontos.
  async function filmOneTransition() {
    const box = await page.locator('.preview-stage').boundingBox();
    const viewport = page.viewportSize();
    const at = (fx, fy) => [(box.x + fx * box.width) / viewport.width, (box.y + fy * box.height) / viewport.height];
    const capture = await startCapture(page, { quality: 60, maxWidth: 720, maxHeight: 450 });   // metade do tamanho: o navegador entrega mais quadros por segundo
    let animations, frames;
    try {
      animations = await catchAnimations(page);
      await page.waitForTimeout(animations[0].duration + 500);
    } finally { frames = await capture.stop(); }
    const samples = await sampleFrames(helper, frames, { points: { esq: at(0.025, 0.12), c: at(0.5, 0.12), dir: at(0.975, 0.12) }, rowY: at(0.5, 0.12)[1], cells: 1 });
    const seen = { side: 0, edges: 0, uniform: 0, frames: samples.length, trace: [] };
    for (const sample of samples) {
      const [left, centre, right] = [kind(sample.esq), kind(sample.c), kind(sample.dir)];
      const code = `${left}${centre}${right}`;
      if (seen.trace.at(-1)?.[0] === code) seen.trace.at(-1)[1]++; else seen.trace.push([code, 1]);       // sequência vista, comprimida (ex.: AAA×12, AmA×3…)
      if (left !== right && left !== 'mix' && right !== 'mix') seen.side++;                       // um conteúdo de cada lado (deslizar)
      else if (left === right && left !== 'mix' && centre !== left) seen.edges++;                // bordas do conteúdo antigo, centro já no novo (zoom)
      if (left === 'mix' && centre === 'mix' && right === 'mix') seen.uniform++;                 // mistura uniforme (esmaecer)
    }
    return { animations, seen };
  }

  await step('preparar: arquivos aprovados (imagens e vídeos WebM de verdade), uma playlist com os cinco e o editor aberto', async () => {
    kit = await s.seed();
    const image = (title, color) => kit.approvedMedia(kit.admin, { title, name: `${title.toLowerCase().replace(/\W+/g, '-')}.png`, bytes: solidPng({ color, seed: title }) });
    media['Aviso A'] = await image('Aviso A', COLORS.laranja);
    media['Aviso B'] = await image('Aviso B', COLORS.verde);
    media['Aviso C'] = await image('Aviso C', COLORS.azul);
    media['Clipe azul'] = await kit.approvedMedia(kit.admin, { title: 'Clipe azul', name: 'clipe-azul.webm', bytes: fixture('video-azul-3s.webm') });
    media['Clipe roxo'] = await kit.approvedMedia(kit.admin, { title: 'Clipe roxo', name: 'clipe-roxo.webm', bytes: fixture('video-roxo-6s.webm') });
    const created = await kit.playlist(kit.admin, {
      name: 'Carrossel da recepção',
      items: [
        { mediaId: media['Aviso A'].id, durationS: 5, durationMode: 'fixed', transition: 'cut', transitionMs: 0 },
        { mediaId: media['Clipe azul'].id, durationS: 30, durationMode: 'natural', transition: 'fade', transitionMs: 600 },
        { mediaId: media['Aviso B'].id, durationS: 8, durationMode: 'fixed', transition: 'cut', transitionMs: 0 },
        { mediaId: media['Clipe roxo'].id, durationS: 5, durationMode: 'fixed', transition: 'slide', transitionMs: 900 },
        { mediaId: media['Aviso C'].id, durationS: 5, durationMode: 'fixed', transition: 'zoom', transitionMs: 700 }
      ]
    });
    playlistId = created.id;
    helper = await s.context.newPage();
    await helper.goto('about:blank');
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await openEditor();
  });

  await run('cada conteúdo mostra o tempo certo para o seu tipo (imagem: duração; vídeo: limite ou reserva), com a ajuda ligada ao campo', async () => {
    assert.equal(await page.getByLabel('Duração (s) de “Aviso A”').inputValue(), '5');
    assert.equal(await page.getByLabel('Limite (s) do vídeo “Clipe roxo”').inputValue(), '5');
    assert.equal(await page.getByLabel('Reserva (s) do vídeo “Clipe azul”').inputValue(), '30');
    assert.equal(await page.getByLabel('Tempo do vídeo “Clipe azul”').inputValue(), 'natural');
    assert.equal(await page.getByLabel('Tempo do vídeo “Clipe roxo”').inputValue(), 'fixed');
    assert.deepEqual(await page.getByLabel('Tempo do vídeo “Clipe roxo”').locator('option').allInnerTexts(), ['Tempo definido (limite)', 'Até o fim do vídeo']);
    assert.equal(await page.getByLabel('Tempo do vídeo “Aviso A”').count(), 0, 'imagem não tem modo de vídeo');
    // A explicação de cada escolha é lida junto com o nome do campo (aria-describedby).
    assert.match(await described('Transição de “Clipe roxo”'), /entra pela direita empurrando o anterior/);
    assert.match(await described('Transição de “Aviso C”'), /cresce até ocupar a tela/);
    assert.match(await described('Tempo do vídeo “Clipe roxo”'), /até o fim ou até o limite definido/);
    assert.match(await described('Tempo do vídeo “Clipe azul”'), /toca inteiro/);
    assert.match(await row('Clipe azul').innerText(), /toca até o fim do vídeo/);
    assert.match(await row('Clipe roxo').innerText(), /toca por até 5 s/);
    assert.match(await row('Aviso A').innerText(), /exibe por 5 s/);
    // 23 s conhecidos (5 + 8 + 5 + o limite de 5 do vídeo roxo) e um vídeo que toca até o fim.
    assert.match(await page.locator('.pl-summary').innerText(), /5 de 6 conteúdos · um ciclo completo dura até 23 s mais a duração do vídeo/);
    await showContents();
    await s.shot('playlists2-01-editor');
  });

  await run('limites dos números: o tempo fica entre 5 s e 1 hora e o efeito entre 0 e 3000 ms, e o campo mostra o valor que valeu', async () => {
    const duration = page.getByLabel('Duração (s) de “Aviso A”');
    await duration.fill('2'); await duration.blur();
    assert.equal(await duration.inputValue(), '5');
    await duration.fill('9999'); await duration.blur();
    assert.equal(await duration.inputValue(), '3600');
    await duration.fill('5'); await duration.blur();
    const effect = page.getByLabel('Efeito (ms) de “Clipe roxo”');
    await effect.fill('9000'); await effect.blur();
    assert.equal(await effect.inputValue(), '3000');
    await effect.fill('900'); await effect.blur();
    assert.equal(await state(), 'Tudo salvo', 'voltar aos valores de antes desfaz a alteração');
  });

  await run('repetição contínua: liga/desliga por teclado, avisa, só vale depois de salvar e continua depois de recarregar', async () => {
    const loop = page.locator('#playlist-loop');
    assert.equal(await loop.isChecked(), true);
    assert.equal(await loop.getAttribute('aria-describedby'), 'playlist-loop-note');
    assert.match(await page.locator('#playlist-loop-note').innerText(), /volta ao primeiro e segue em ciclo/);
    await loop.focus();
    await page.keyboard.press('Space');
    assert.equal(await loop.isChecked(), false);
    assert.match(await page.locator('#playlist-loop-note').innerText(), /exibe a sequência uma vez e mantém o último conteúdo na tela/);
    assert.equal(await state(), 'Alterações não salvas');
    await announced('Repetição contínua desligada. A TV exibirá a sequência uma vez.');
    assert.equal((await saved()).loop, true, 'sem salvar, o servidor continua com a repetição ligada');
    await save();
    assert.equal((await saved()).loop, false);
    await page.reload();
    await page.locator('.pl-item').first().waitFor();
    assert.equal(await loop.isChecked(), false, 'depois de recarregar a repetição continua desligada');
    await showContents();
    await s.shot('playlists2-02-repeticao-desligada');
    await loop.check();
    await announced('Repetição contínua ligada.');
    await save();
    assert.equal((await saved()).loop, true);
  });

  await run('tempo do vídeo: trocar entre limite e "até o fim" muda o rótulo, a ajuda e o resumo, e é gravado', async () => {
    const mode = page.getByLabel('Tempo do vídeo “Clipe roxo”');
    await mode.selectOption('natural');
    await page.getByLabel('Reserva (s) do vídeo “Clipe roxo”').waitFor();
    assert.equal(await page.getByLabel('Limite (s) do vídeo “Clipe roxo”').count(), 0);
    assert.match(await row('Clipe roxo').innerText(), /toca até o fim do vídeo/);
    assert.match(await row('Clipe roxo').locator('.pl-helps').innerText(), /O tempo ao lado só vale como reserva/);
    assert.match(await page.locator('.pl-summary').innerText(), /um ciclo completo dura 18 s mais a duração dos 2 vídeos/);
    assert.equal(await state(), 'Alterações não salvas');
    await save();
    assert.deepEqual((await saved()).items.map(item => [item.media.title, item.durationMode]), [['Aviso A', 'fixed'], ['Clipe azul', 'natural'], ['Aviso B', 'fixed'], ['Clipe roxo', 'natural'], ['Aviso C', 'fixed']]);
    await page.reload();
    await page.locator('.pl-item').first().waitFor();
    assert.equal(await page.getByLabel('Tempo do vídeo “Clipe roxo”').inputValue(), 'natural');
    // Volta ao limite (agora de 6 s): o rótulo volta a ser "Limite" e o resumo conta o limite como tempo máximo.
    await page.getByLabel('Tempo do vídeo “Clipe roxo”').selectOption('fixed');
    await page.getByLabel('Limite (s) do vídeo “Clipe roxo”').fill('6');
    await page.getByLabel('Limite (s) do vídeo “Clipe roxo”').blur();
    assert.match(await page.locator('.pl-summary').innerText(), /um ciclo completo dura até 24 s mais a duração do vídeo/);
    await save();
    const items = (await saved()).items;
    assert.deepEqual([items[3].durationMode, items[3].durationS], ['fixed', 6]);
  });

  await run('"Ver efeito": cada efeito é animado de verdade pelo navegador, com a duração escolhida, e um não depende do outro', async () => {
    const dialog = await openDemo('Aviso B');
    const effect = dialog.getByLabel('Efeito de transição');
    assert.equal(await effect.inputValue(), 'cut', 'abre no efeito do conteúdo (Aviso B está em corte seco)');
    assert.equal(await dialog.getByLabel('Duração do efeito (ms)').isVisible(), false, 'corte seco não tem duração');
    const helps = { fade: 'aparece aos poucos', dissolve: 'surge desfocado', slide: 'entra pela direita', zoom: 'cresce até ocupar a tela' };
    const expected = {                                          // o que o navegador deve animar em cada efeito (propriedades de cada animação)
      fade: ['opacity'], dissolve: ['filter+opacity'], slide: ['transform', 'transform'], zoom: ['opacity+transform', 'transform']
    };
    const labels = { fade: 'Esmaecer', dissolve: 'Dissolver', slide: 'Deslizar', zoom: 'Zoom' };
    for (const [name, properties] of Object.entries(expected)) {
      await effect.selectOption(name);
      assert.match(await dialog.locator('.fx-help').innerText(), new RegExp(helps[name]));
      const duration = dialog.getByLabel('Duração do efeito (ms)');
      assert.equal(await duration.isVisible(), true);
      assert.equal(await duration.inputValue(), '600', 'ao sair do corte seco o efeito começa com 600 ms');
      const animations = await catchAnimations(page);
      assert.deepEqual(animations.map(animation => animation.properties).sort(), [...properties].sort(), `${name}: o navegador animou ${JSON.stringify(animations)}`);
      assert.ok(animations.every(animation => animation.duration === 600), `${name}: duração ${JSON.stringify(animations.map(animation => animation.duration))}`);
      assert.equal(await dialog.locator('.preview-label').innerText(), `Efeito: ${labels[name]} · 600 ms.`);
    }
    // Quadros-chave exatos de cada efeito (o mesmo que o player usa): deslizar empurra, dissolver desfoca, zoom aproxima.
    await effect.selectOption('dissolve');
    const dissolve = await catchAnimations(page);
    assert.deepEqual(dissolve[0].keyframes, [{ opacity: '0', filter: 'blur(28px)' }, { opacity: '1', filter: 'blur(0px)' }]);
    await effect.selectOption('slide');
    const slide = await catchAnimations(page);
    assert.deepEqual(slide.map(animation => animation.keyframes).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      [[{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }], [{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }]]);
    // A duração escolhida vale para a animação (1800 ms, e não os 600 de antes).
    await dialog.getByLabel('Duração do efeito (ms)').fill('1800');
    await dialog.getByLabel('Duração do efeito (ms)').blur();
    assert.equal(await dialog.locator('.preview-label').innerText(), 'Efeito: Deslizar · 1800 ms.');
    assert.ok((await catchAnimations(page)).every(animation => animation.duration === 1800), 'a duração digitada vale para a animação');
    await s.shot('playlists2-03-ver-efeito');
    // Corte seco: o conteúdo troca (A ↔ B), mas nada é animado.
    await effect.selectOption('cut');
    assert.equal(await dialog.getByLabel('Duração do efeito (ms)').isVisible(), false);
    const watched = await page.evaluate(() => new Promise(resolve => {
      const seen = new Set();
      let animated = 0;
      const end = performance.now() + 3_600;
      const tick = () => {
        for (const caption of document.querySelectorAll('.preview-stage .stage-layer:not(.is-standby) .fx-caption')) seen.add(caption.textContent);
        if (document.getAnimations().some(animation => animation.effect?.target?.closest?.('.preview-stage'))) animated++;
        if (performance.now() < end) requestAnimationFrame(tick); else resolve({ seen: [...seen].sort(), animated });
      };
      requestAnimationFrame(tick);
    }));
    assert.deepEqual(watched.seen, ['Conteúdo A', 'Conteúdo B'], 'o corte seco troca os conteúdos');
    assert.equal(watched.animated, 0, 'o corte seco não anima nada');
    await closeTop(0);
  });

  await run('"Ver efeito" nos pixels da tela: deslizar mostra um conteúdo de cada lado, zoom cresce do centro, esmaecer mistura tudo por igual', async () => {
    const dialog = await openDemo('Aviso B');
    const found = {};
    for (const name of ['slide', 'zoom', 'fade']) {
      await dialog.getByLabel('Efeito de transição').selectOption(name);
      await dialog.getByLabel('Duração do efeito (ms)').fill('3000');          // a máxima: o Chromium sem placa de vídeo entrega poucos quadros por segundo
      await dialog.getByLabel('Duração do efeito (ms)').blur();
      found[name] = await filmOneTransition();
    }
    const show = name => `${name}: ${JSON.stringify({ ...found[name].seen, trace: found[name].seen.trace.map(([code, count]) => `${code}×${count}`).join(' ') })}`;
    assert.ok(found.slide.seen.frames >= 20, `poucos quadros capturados: ${show('slide')}`);
    assert.ok(found.slide.seen.side >= 6, `deslizar: faltaram quadros com um conteúdo de cada lado (${show('slide')})`);
    assert.equal(found.slide.seen.edges, 0, `deslizar não cresce do centro (${show('slide')})`);
    assert.equal(found.slide.seen.uniform, 0, `deslizar não mistura os conteúdos (${show('slide')})`);
    assert.ok(found.zoom.seen.edges >= 3, `zoom: faltaram quadros com o centro novo e as bordas antigas (${show('zoom')})`);
    assert.equal(found.zoom.seen.side, 0, `zoom não separa esquerda e direita (${show('zoom')})`);
    assert.ok(found.fade.seen.uniform >= 3, `esmaecer: faltaram quadros com mistura uniforme (${show('fade')})`);
    assert.equal(found.fade.seen.side, 0, `esmaecer não põe um conteúdo de cada lado (${show('fade')})`);
    assert.equal(found.fade.seen.edges, 0, `esmaecer não cresce do centro (${show('fade')})`);
    report.etapas.pixelsDaDemonstracao = Object.fromEntries(Object.entries(found).map(([name, { seen }]) => [name, { ...seen, trace: seen.trace.map(([code, count]) => `${code}×${count}`).join(' ') }]));
    await closeTop(0);
  });

  await run('"Ver de novo" e "Pausar" na demonstração: pausar para a animação, reproduzir retoma, rever recomeça', async () => {
    const dialog = await openDemo('Aviso C');                      // Aviso C está em zoom (700 ms)
    assert.equal(await dialog.getByLabel('Efeito de transição').inputValue(), 'zoom');
    assert.equal(await dialog.getByLabel('Duração do efeito (ms)').inputValue(), '700');
    await catchAnimations(page);                                    // a primeira troca aconteceu
    await dialog.getByRole('button', { name: 'Pausar' }).click();
    await dialog.getByRole('button', { name: 'Reproduzir' }).waitFor();
    await page.waitForTimeout(3_600);                              // mais que o tempo de cada conteúdo (1,9 s)
    assert.equal(await page.evaluate(anyAnimation), false, 'em pausa nada é animado');
    await dialog.getByRole('button', { name: 'Reproduzir' }).click();
    await dialog.getByRole('button', { name: 'Pausar' }).waitFor();
    assert.equal((await catchAnimations(page)).length, 2, 'depois de retomar, a troca acontece de novo');
    await dialog.getByRole('button', { name: 'Ver de novo' }).click();
    assert.equal((await catchAnimations(page)).length, 2, '"Ver de novo" recomeça e mostra o efeito outra vez');
    await closeTop(0);
  });

  await run('"Usar este efeito": vale só para o conteúdo escolhido, devolve o foco, avisa, fica como alteração a salvar e é gravado; fechar não aplica nada', async () => {
    const snapshot = () => page.locator('.pl-item').evaluateAll(rows => rows.map(node => [node.querySelector('.pl-title').textContent, node.querySelector('select[id^="tr-"]').value, node.querySelector('input[id^="ms-"]')?.value ?? null]));
    const before = await snapshot();
    let dialog = await openDemo('Aviso B');
    await dialog.getByLabel('Efeito de transição').selectOption('zoom');
    await dialog.getByLabel('Duração do efeito (ms)').fill('900');
    await dialog.getByLabel('Duração do efeito (ms)').blur();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await dialogs(0);
    assert.equal(await page.getByLabel('Transição de “Aviso B”').inputValue(), 'cut', 'fechar não escolhe o efeito');
    assert.equal(await state(), 'Tudo salvo');
    assert.equal(await focusedLabel(), 'Ver efeito de “Aviso B”', 'o foco volta ao botão que abriu a janela');

    dialog = await openDemo('Aviso B');
    await dialog.getByLabel('Efeito de transição').selectOption('zoom');
    await dialog.getByLabel('Duração do efeito (ms)').fill('900');
    await dialog.getByLabel('Duração do efeito (ms)').blur();
    await dialog.getByRole('button', { name: 'Usar este efeito' }).click();
    await dialogs(0);
    assert.equal(await page.getByLabel('Transição de “Aviso B”').inputValue(), 'zoom');
    assert.equal(await page.getByLabel('Efeito (ms) de “Aviso B”').inputValue(), '900');
    assert.match(await described('Transição de “Aviso B”'), /cresce até ocupar a tela/, 'a ajuda acompanha a escolha');
    assert.equal(await state(), 'Alterações não salvas');
    assert.equal(await focusedLabel(), 'Ver efeito de “Aviso B”', 'o foco volta ao botão da linha que mudou');
    await announced('Efeito de “Aviso B”: Zoom, 900 ms.');
    const after = await snapshot();
    after.forEach((entry, index) => { if (entry[0] !== 'Aviso B') assert.deepEqual(entry, before[index], `"${entry[0]}" não podia mudar`); });
    await save();
    assert.deepEqual((await saved()).items.map(item => [item.media.title, item.transition, item.transitionMs]),
      [['Aviso A', 'cut', 0], ['Clipe azul', 'fade', 600], ['Aviso B', 'zoom', 900], ['Clipe roxo', 'slide', 900], ['Aviso C', 'zoom', 700]]);
    await s.shot('playlists2-04-efeito-aplicado');

    // E o corte seco também pode ser escolhido na demonstração (a duração do efeito volta a zero).
    dialog = await openDemo('Aviso B');
    await dialog.getByLabel('Efeito de transição').selectOption('cut');
    await dialog.getByRole('button', { name: 'Usar este efeito' }).click();
    await dialogs(0);
    assert.equal(await page.getByLabel('Transição de “Aviso B”').inputValue(), 'cut');
    assert.equal(await page.getByLabel('Efeito (ms) de “Aviso B”').isVisible(), false);
    await announced('Efeito de “Aviso B”: Corte seco.');
    await save();
    assert.deepEqual((await saved()).items.slice(2, 3).map(item => [item.media.title, item.transition, item.transitionMs]), [['Aviso B', 'cut', 0]]);
  });

  await run('só com o teclado: abrir "Ver efeito", escolher o efeito e a duração, aplicar e voltar ao ponto de partida', async () => {
    await page.getByRole('button', { name: 'Ver efeito de “Aviso C”' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'demo-effect', 'o foco vai para o primeiro campo da janela');
    assert.equal(await page.locator('dialog[open]').getAttribute('aria-labelledby') !== null, true, 'a janela tem nome');
    await page.keyboard.press('ArrowUp');                          // zoom → deslizar
    assert.match(await page.locator('dialog[open] .fx-help').innerText(), /entra pela direita/);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'demo-ms');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1100');
    await page.keyboard.press('Tab');                              // confirma o valor (change) e segue para os botões
    assert.equal(await page.locator('dialog[open] .preview-label').innerText(), 'Efeito: Deslizar · 1100 ms.');
    for (let presses = 0; presses < 8 && (await focusedLabel()) !== 'Usar este efeito'; presses++) await page.keyboard.press('Tab');
    assert.equal(await focusedLabel(), 'Usar este efeito');
    await page.keyboard.press('Enter');
    await dialogs(0);
    assert.equal(await page.getByLabel('Transição de “Aviso C”').inputValue(), 'slide');
    assert.equal(await page.getByLabel('Efeito (ms) de “Aviso C”').inputValue(), '1100');
    assert.equal(await focusedLabel(), 'Ver efeito de “Aviso C”');
    // Esc fecha sem aplicar e o foco volta.
    await page.keyboard.press('Enter');
    await page.locator('dialog[open]').waitFor();
    await page.keyboard.press('ArrowDown');
    await closeTop(0);
    assert.equal(await page.getByLabel('Transição de “Aviso C”').inputValue(), 'slide', 'Esc não aplica');
    assert.equal(await focusedLabel(), 'Ver efeito de “Aviso C”');
    await save();
  });

  await run('"Ver efeito" com movimento reduzido no sistema: tudo vira esmaecer e a tela explica o motivo', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      const dialog = await openDemo('Clipe roxo');                 // Clipe roxo está em deslizar (900 ms)
      assert.equal(await dialog.getByLabel('Efeito de transição').inputValue(), 'slide');
      const animations = await catchAnimations(page);
      assert.deepEqual(animations.map(animation => animation.properties), ['opacity'], 'deslizar vira só esmaecer');
      await dialog.locator('.preview-note').filter({ hasText: 'Efeito simplificado' }).waitFor();
      assert.equal(await dialog.locator('.preview-note').innerText(), 'Efeito simplificado: movimento reduzido ativo. Aparece como Esmaecer.');
      for (const name of ['zoom', 'dissolve']) {
        await dialog.getByLabel('Efeito de transição').selectOption(name);
        assert.deepEqual((await catchAnimations(page)).map(animation => animation.properties), ['opacity'], `${name} vira só esmaecer`);
      }
      await dialog.getByLabel('Efeito de transição').selectOption('fade');
      await catchAnimations(page);
      assert.equal(await dialog.locator('.preview-note').isHidden(), true, 'esmaecer pedido e exibido: nada a avisar');
      await closeTop(0);
    } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
  });

  await run('pré-visualizar o rascunho: ordem, tempo e efeito de cada conteúdo, vídeo tocando com a política de áudio da TV, pausa, saltar e fechar solta tudo', async () => {
    await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    const label = () => dialog.locator('.preview-label').innerText();
    await dialog.locator('.preview-stage img').first().waitFor();
    assert.equal(await focusedLabel(), 'Fechar', 'o foco começa no botão principal da janela');
    await page.waitForFunction(() => document.querySelector('.preview-label')?.textContent === '1 de 5 · Aviso A · 5 s'); // a imagem entra na tela um instante antes do aviso de posição
    assert.equal(await label(), '1 de 5 · Aviso A · 5 s');
    assert.deepEqual(await dialog.locator('.preview-step-title').allInnerTexts(), ['Aviso A', 'Clipe azul', 'Aviso B', 'Clipe roxo', 'Aviso C']);
    assert.match(await dialog.locator('.preview-notes').innerText(), /Os vídeos tentam iniciar com som\./); // desde a 2.1.0 a prévia segue a política de áudio da TV
    assert.match(await dialog.locator('.preview-notes').innerText(), /Teste sempre em uma TV antes de divulgar\./);
    // Próximo: o vídeo entra (esmaecer, 600 ms), toca de verdade e a linha de efeito explica a entrada.
    await dialog.getByRole('button', { name: 'Próximo' }).click();
    await page.waitForFunction(() => document.querySelector('.preview-label')?.textContent === '2 de 5 · Clipe azul · até o fim do vídeo');
    await dialog.locator('.preview-note').filter({ hasText: 'Entrada deste conteúdo' }).waitFor();
    // Desde a 2.1.0 a janela tem um segundo aviso (o do áudio, oculto enquanto o navegador não bloqueia o som): a linha de efeito é achada pelo texto.
    assert.equal(await dialog.locator('.preview-note').filter({ hasText: 'Entrada deste conteúdo' }).innerText(), 'Entrada deste conteúdo: Esmaecer (600 ms).');
    await page.waitForFunction(() => { const element = document.querySelector('.preview-stage .stage-layer:not(.is-standby) video'); return element && !element.paused && element.currentTime > 0.3; }, null, { timeout: 10_000 });
    // Som: o navegador decide (com som quando permite, mudo quando bloqueia); o volume interno é sempre o máximo e o do aparelho não é tocado.
    assert.equal(await dialog.locator('.preview-stage .stage-layer:not(.is-standby) video').evaluate(element => element.volume), 1, 'volume interno máximo');
    // Pausa e retoma; saltar pela lista de conteúdos; a posição atual aparece na lista (aria-current).
    await dialog.getByRole('button', { name: 'Pausar' }).click();
    await dialog.getByRole('button', { name: 'Reproduzir' }).waitFor();
    await dialog.locator('.preview-step', { hasText: 'Clipe roxo' }).click();
    await page.waitForFunction(() => document.querySelector('.preview-label')?.textContent === '4 de 5 · Clipe roxo · até 6 s');
    assert.equal(await dialog.locator('.preview-step[aria-current="true"] .preview-step-title').innerText(), 'Clipe roxo');
    assert.equal(await dialog.locator('.preview-step[aria-current="true"]').count(), 1);
    await s.shot('playlists2-05-previa');
    await dialog.getByRole('button', { name: 'Anterior' }).click();
    await page.waitForFunction(() => document.querySelector('.preview-label')?.textContent.startsWith('3 de 5 · Aviso B'));
    await closeTop(0);
    // Fechar solta tudo: nenhuma camada, nenhum vídeo e nenhum pedido novo de arquivo.
    assert.equal(await page.locator('.stage-layer, .preview-stage video').count(), 0);
    const requests = [];
    const watch = request => { if (request.url().includes('/api/media/')) requests.push(request.url()); };
    page.on('request', watch);
    await page.waitForTimeout(2_500);
    page.off('request', watch);
    assert.deepEqual(requests, [], 'a prévia fechada não pode continuar baixando arquivos');
  });

  await run('pré-visualização sem repetição: percorre tudo, para no último ("sequência concluída") e permite reiniciar', async () => {
    await page.locator('#playlist-loop').uncheck();
    await save();
    await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.locator('.preview-stage img').first().waitFor();
    assert.match(await dialog.locator('.preview-notes').innerText(), /A repetição está desligada: ao terminar o último conteúdo, a exibição para nele, como na TV\./);
    await dialog.locator('.preview-step', { hasText: 'Aviso C' }).click();
    await page.waitForFunction(() => /sequência concluída$/.test(document.querySelector('.preview-label')?.textContent ?? ''), null, { timeout: 20_000 });
    assert.equal(await dialog.locator('.preview-label').innerText(), '5 de 5 · Aviso C · 5 s · sequência concluída');
    await dialog.getByRole('button', { name: 'Reiniciar' }).click();
    await page.waitForFunction(() => /^1 de 5/.test(document.querySelector('.preview-label')?.textContent ?? ''));
    await closeTop(0);
    await page.locator('#playlist-loop').check();
    await save();
  });

  await run('publicar: a pré-visualização aparece antes de publicar, na versão publicada e no formulário da programação', async () => {
    await page.getByRole('button', { name: 'Publicar versão', exact: true }).click();
    await page.getByText('Publicar a versão 1').waitFor();
    await page.locator('dialog[open]').getByRole('button', { name: 'Pré-visualizar' }).click();
    await dialogs(2);
    await page.getByText('Pré-visualização antes de publicar').waitFor();
    await page.locator('dialog[open]').last().locator('.preview-stage img').first().waitFor();
    await closeTop(1);                                            // fecha só a prévia; a janela de publicar continua
    await page.getByRole('button', { name: 'Publicar versão 1' }).click();
    await dialogs(0);
    await page.locator('.version-item').first().waitFor();
    // Versão publicada: ver o conteúdo e pré-visualizar a partir daí.
    await page.getByRole('button', { name: 'Ver o conteúdo da versão 1' }).click();
    await page.locator('dialog[open] .publish-item').first().waitFor();
    assert.equal(await page.locator('dialog[open] .publish-item').count(), 5);
    await page.locator('dialog[open]').getByRole('button', { name: 'Pré-visualizar' }).click();
    await dialogs(2);
    await page.getByText('Pré-visualizar a versão 1', { exact: true }).waitFor();
    await page.locator('dialog[open]').last().locator('.preview-stage img').first().waitFor();
    await closeTop(1);
    await closeTop(0);
    // Programação: a playlist já vem escolhida e a versão pode ser vista antes de salvar.
    await page.getByRole('button', { name: 'Programar esta playlist' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/programacoes'));
    const form = page.locator('dialog[open]');
    await form.getByRole('button', { name: 'Pré-visualizar esta versão' }).click();   // o clique espera o botão ser liberado (versões carregadas)
    await dialogs(2);
    await page.getByText('Pré-visualizar a versão 1', { exact: true }).waitFor();
    await page.locator('dialog[open]').last().locator('.preview-stage img').first().waitFor();
    await closeTop(1);
    await closeTop(0);
    await openEditor();
  });

  await run('quem só consulta (Visualizador) vê os efeitos e a pré-visualização, mas não altera nada', async () => {
    const viewer = await kit.createUser('viewer');
    await page.getByRole('button', { name: 'Sair com segurança' }).click();
    await loginAs(page, s.origin, viewer.email, PASSWORD);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await openEditor();
    assert.equal(await page.locator('#playlist-loop').isDisabled(), true);
    assert.equal(await page.getByLabel('Tempo do vídeo “Clipe roxo”').isDisabled(), true);
    assert.equal(await page.getByLabel('Duração (s) de “Aviso A”').isDisabled(), true);
    assert.equal(await page.getByLabel('Transição de “Aviso B”').isDisabled(), true);
    const dialog = await openDemo('Clipe roxo');                    // Clipe roxo está em deslizar: a demonstração anima
    assert.equal(await dialog.getByLabel('Efeito de transição').inputValue(), 'slide');
    assert.equal(await dialog.getByRole('button', { name: 'Usar este efeito' }).count(), 0, 'quem não edita não pode aplicar o efeito');
    assert.equal((await catchAnimations(page)).length, 2, 'mas vê a demonstração funcionando');
    await closeTop(0);
    await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).click();
    await page.locator('dialog[open] .preview-stage img').first().waitFor();
    await closeTop(0);
    await s.shot('playlists2-06-visualizador');
  });

  await step('nenhum erro ou aviso inesperado no console do navegador', async () => { expectNoIssues(s); });
  if (!only) writeFileSync(path.join(OUTPUT_DIR, 'playlists-fase2-report.json'), `${JSON.stringify(report, null, 2)}\n`);
});
