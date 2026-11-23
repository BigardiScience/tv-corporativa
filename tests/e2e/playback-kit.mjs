// Ferramentas dos cenários de reprodução no Chromium: TV pareada de verdade (servidor real), sonda quadro a quadro dentro da página e
// captura dos pixels que o navegador de fato APRESENTOU (screencast do DevTools), para provar o que o público veria na tela.
//
// O que isto NÃO é: uma TV. É o Chromium do Playwright num computador. Serve para provar o comportamento do código (ordem, tempo,
// efeitos, troca sem tela vazia, recuperação), não o desempenho nem os codecs de um aparelho específico.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE_BACKGROUND } from './frame-analysis.mjs';

export * from './frame-analysis.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const fixture = name => readFileSync(path.join(here, '..', 'fixtures', 'playback', name));

// Cores sólidas: com elas dá para saber, por um pixel, qual conteúdo está na tela e em que ponto da troca estamos. Bem separadas entre si,
// para que a mistura de duas delas nunca seja confundida com uma terceira.
export const COLORS = Object.freeze({
  laranja: [249, 114, 25], verde: [33, 131, 85], azul: [43, 108, 176], roxo: [128, 90, 213], turquesa: [13, 148, 136], amarelo: [202, 138, 4], cinza: [107, 114, 128],
  lima: [150, 200, 40], rosa: [219, 39, 119], claro: [250, 220, 120]
});
// Cores dos vídeos de apoio (tests/fixtures/playback): o VP8 muda um pouco a cor, por isso as comparações têm tolerância.
export const VIDEO_COLORS = Object.freeze({ 'video-azul-3s.webm': COLORS.azul, 'video-roxo-6s.webm': COLORS.roxo });
// Cor média das listras de tests/helpers/http.mjs#stripedPng com as cores padrão (branco e azul-marinho).
export const STRIPE_MEAN = Object.freeze([137, 141, 151]);

// ---- sonda dentro da página --------------------------------------------------------------------------------------------------------------
// Instalada antes do código da TV (addInitScript). A cada quadro que o navegador apresenta, confere que o palco está inteiramente coberto
// por camadas opacas e registra quando o conteúdo do topo muda, quantas camadas estão visíveis e em que estado a camada nova apareceu pela
// primeira vez. Conta os endereços blob: criados e ainda não liberados (a memória que a TV guarda) e anota o que o leitor de tela anunciaria.
export function installProbe() {
  const probe = window.__pc = {
    on: false, frames: 0, gaps: [], tops: [], layers: [], uncovered: [], maxLayers: 0, lastTop: null, lastVisible: -1,
    blobs: new Set(), maxBlobs: 0, created: 0, revoked: 0, announcements: []
  };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = blob => { const url = create(blob); probe.blobs.add(url); probe.created++; probe.maxBlobs = Math.max(probe.maxBlobs, probe.blobs.size); return url; };
  URL.revokeObjectURL = url => { probe.blobs.delete(url); probe.revoked++; return revoke(url); };
  const wall = now => performance.timeOrigin + now;

  const watchAnnouncements = () => {
    const live = document.getElementById('announcement');
    if (!live) return;
    new MutationObserver(() => { if (live.textContent) probe.announcements.push({ wall: wall(performance.now()), text: live.textContent }); }).observe(live, { childList: true, characterData: true, subtree: true });
  };
  if (document.getElementById('announcement')) watchAnnouncements(); else document.addEventListener('DOMContentLoaded', watchAnnouncements, { once: true });

  const keyOf = layer => {
    const media = layer.querySelector('img, video, iframe');
    return media ? (media.getAttribute('alt') ?? media.getAttribute('aria-label') ?? media.getAttribute('title') ?? '?') : (layer.getAttribute('data-kind') ?? '?');
  };
  // O palco está coberto quando as camadas opacas, juntas, ocupam todo o retângulo (deslizar usa duas camadas lado a lado).
  const covered = (stage, rects) => {
    const full = rects.filter(r => r.top <= stage.top + 1 && r.bottom >= stage.bottom - 1).sort((a, b) => a.left - b.left);
    let x = stage.left;
    for (const r of full) {
      if (r.left > x + 1) break;
      x = Math.max(x, r.right);
      if (x >= stage.right - 1) return true;
    }
    return x >= stage.right - 1;
  };
  let last = 0;
  const frame = now => {
    const stageEl = probe.on ? document.getElementById('stage') : null;
    if (stageEl) {
      const S = stageEl.getBoundingClientRect();
      const layers = [...stageEl.children].filter(el => el.classList.contains('stage-layer'));
      probe.maxLayers = Math.max(probe.maxLayers, layers.length);
      const info = layers.map(layer => {
        const r = layer.getBoundingClientRect(), style = getComputedStyle(layer);
        return { key: keyOf(layer), standby: layer.classList.contains('is-standby'), opacity: Number(style.opacity), z: Number(layer.style.zIndex || 0), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      const visible = info.filter(item => !item.standby);
      if (visible.length !== probe.lastVisible) {
        const entry = { wall: wall(now), visible: visible.length };
        // Quando duas camadas passam a aparecer juntas, anota o que o navegador está animando (efeito, duração e quadros-chave de verdade).
        if (visible.length >= 2) {
          entry.animations = document.getAnimations().filter(animation => animation.effect?.target?.closest?.('#stage')).map(animation => {
            const timing = animation.effect.getTiming();
            return {
              duration: timing.duration, easing: timing.easing, target: keyOf(animation.effect.target),
              frames: animation.effect.getKeyframes().map(({ offset, computedOffset, easing, composite, ...rest }) => rest)
            };
          });
        }
        probe.layers.push(entry);
        probe.lastVisible = visible.length;
      }
      if (visible.length) {
        if (!covered(S, visible.filter(item => item.opacity >= 0.999)) && probe.uncovered.length < 40) probe.uncovered.push({ t: now, layers: info });
        const top = visible.reduce((a, b) => (b.z >= a.z ? b : a));
        if (top.key !== probe.lastTop) {
          probe.tops.push({ t: now, wall: wall(now), key: top.key, opacity: top.opacity, left: top.left - S.left, width: S.width, visible: visible.length });
          probe.lastTop = top.key;
        }
      }
      if (last) probe.gaps.push(now - last);
      probe.frames++;
      last = now;
    } else last = 0;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export const probeOn = page => page.evaluate(() => {
  const probe = window.__pc;
  Object.assign(probe, { on: true, frames: 0, gaps: [], tops: [], layers: [], uncovered: [], maxLayers: 0, lastTop: null, lastVisible: -1, maxBlobs: probe.blobs.size, announcements: [] });
});
export const probeOff = page => page.evaluate(() => {
  const probe = window.__pc;
  probe.on = false;
  return {
    frames: probe.frames, gaps: probe.gaps, tops: probe.tops, layers: probe.layers, uncovered: probe.uncovered, maxLayers: probe.maxLayers,
    maxBlobs: probe.maxBlobs, outstanding: probe.blobs.size, created: probe.created, revoked: probe.revoked, announcements: probe.announcements
  };
});
export const blobCount = page => page.evaluate(() => ({ outstanding: window.__pc.blobs.size, created: window.__pc.created, revoked: window.__pc.revoked }));

// Animações em andamento DENTRO DO PALCO (o que o navegador está animando de verdade para o público; a barra de progresso fica de fora).
export const runningAnimations = page => page.evaluate(() => document.getAnimations()
  .filter(animation => animation.effect?.target?.closest?.('#stage'))
  .map(animation => {
    const timing = animation.effect.getTiming();
    const frames = animation.effect.getKeyframes().map(({ offset, computedOffset, easing, composite, ...rest }) => rest);
    return { duration: timing.duration, state: animation.playState, frames, target: animation.effect.target?.getAttribute('data-kind') ?? '' };
  }));

// Duração (ms) em que mais de uma camada ficou visível ao mesmo tempo: é a duração da transição, medida na página.
export function overlapWindows(layers) {
  const windows = [];
  let begin = null;
  for (const entry of layers) {
    if (entry.visible >= 2 && begin === null) begin = entry;
    else if (entry.visible < 2 && begin !== null) { windows.push({ from: begin.wall, to: entry.wall, ms: Math.round(entry.wall - begin.wall), animations: begin.animations ?? [] }); begin = null; }
  }
  return windows;
}

// Quadros capturados durante uma janela de transição (os relógios da página e da captura são o mesmo: segundos desde 1970).
export const framesDuring = (samples, window, pad = 0.05) => samples.filter(sample => sample.t * 1000 >= window.from - pad * 1000 && sample.t * 1000 <= window.to + pad * 1000);

// ---- captura dos quadros apresentados ------------------------------------------------------------------------------------------------------
// Page.startScreencast entrega cada quadro que o navegador de fato desenhou (com a hora). Aqui eles viram amostras de cor.
// `maxWidth`/`maxHeight`: reduzem o tamanho dos quadros (em janelas grandes, o navegador entrega bem menos quadros por segundo).
export async function startCapture(page, { quality = 80, maxWidth, maxHeight } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ t: metadata.timestamp, data });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, everyNthFrame: 1, ...(maxWidth ? { maxWidth } : {}), ...(maxHeight ? { maxHeight } : {}) });
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      return frames;
    }
  };
}

// Pontos amostrados em cada quadro (fração da largura e da altura). Evitam a faixa de baixo, onde ficam os controles e a barra de progresso.
export const POINTS = Object.freeze({
  centro: [0.5, 0.45], esquerda: [0.12, 0.45], direita: [0.88, 0.45], cantoSE: [0.02, 0.06], cantoID: [0.98, 0.6]
});
export const ROW_Y = 0.45;   // altura da linha varrida em cada quadro
export const ROW_CELLS = 48; // em quantas células a linha é resumida

// Lê as cores de cada quadro numa página em branco (a decodificação do JPEG é do navegador): média de 7×7 pixels em cada ponto fixo,
// 48 cores médias ao longo de uma linha, a variação entre pixels vizinhos (nitidez) e o maior trecho com a cor do fundo do palco.
export async function sampleFrames(helper, frames, { points = POINTS, rowY = ROW_Y, cells = ROW_CELLS, chunk = 150 } = {}) {
  const names = Object.keys(points), coordinates = Object.values(points);
  const out = [];
  for (let offset = 0; offset < frames.length; offset += chunk) {
    const part = frames.slice(offset, offset + chunk);
    const rows = await helper.evaluate(async ({ list, coordinates: spots, rowY: y, cellCount, background }) => {
      let canvas = null, context = null;
      const result = [];
      for (const frame of list) {
        const bytes = Uint8Array.from(atob(frame.data), char => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const { width, height } = bitmap;
        if (!canvas || canvas.width !== width || canvas.height !== height) { canvas = new OffscreenCanvas(width, height); context = canvas.getContext('2d', { willReadFrequently: true }); }
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const points = spots.map(([fx, fy]) => {
          const x = Math.min(width - 4, Math.max(3, Math.round(fx * (width - 1)))), py = Math.min(height - 4, Math.max(3, Math.round(fy * (height - 1))));
          const data = context.getImageData(x - 3, py - 3, 7, 7).data;
          let r = 0, g = 0, b = 0;
          for (let k = 0; k < data.length; k += 4) { r += data[k]; g += data[k + 1]; b += data[k + 2]; }
          const n = data.length / 4;
          return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        });
        const line = context.getImageData(0, Math.round(y * (height - 1)), width, 1).data;
        const size = width / cellCount, cellColors = [];
        for (let c = 0; c < cellCount; c++) {
          const from = Math.floor(c * size), to = Math.max(from + 1, Math.floor((c + 1) * size));
          let r = 0, g = 0, b = 0;
          for (let x = from; x < to; x++) { r += line[x * 4]; g += line[x * 4 + 1]; b += line[x * 4 + 2]; }
          const n = to - from;
          cellColors.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
        }
        let ripple = 0, steps = 0, previous = null;
        for (let x = Math.floor(width * 0.25); x < Math.floor(width * 0.75); x++) {
          const luma = 0.2126 * line[x * 4] + 0.7152 * line[x * 4 + 1] + 0.0722 * line[x * 4 + 2];
          if (previous !== null) { ripple += Math.abs(luma - previous); steps++; }
          previous = luma;
        }
        let run = 0, longest = 0;
        for (let x = 0; x < width; x++) {
          const same = Math.abs(line[x * 4] - background[0]) <= 14 && Math.abs(line[x * 4 + 1] - background[1]) <= 14 && Math.abs(line[x * 4 + 2] - background[2]) <= 14;
          run = same ? run + 1 : 0;
          if (run > longest) longest = run;
        }
        result.push({ points, cells: cellColors, sharp: steps ? ripple / steps : 0, blankRun: longest });
      }
      return result;
    }, { list: part.map(frame => ({ data: frame.data })), coordinates, rowY, cellCount: cells, background: [...STAGE_BACKGROUND] });
    rows.forEach((row, index) => out.push({ t: part[index].t, ...Object.fromEntries(names.map((name, position) => [name, row.points[position]])), cells: row.cells, sharp: row.sharp, blankRun: row.blankRun }));
  }
  return out;
}

// Espera o navegador APRESENTAR o que a página já montou. O DOM muda um ou dois quadros antes de a tela mostrar a mudança e o primeiro quadro
// entregue pelo screencast pode ser o anterior: numa rodada de repetição ele foi a tela "Preparando a exibição…" (a que aparece antes do
// primeiro conteúdo), mesmo com o conteúdo já no topo do DOM. A foto dessa tela ficou em tests/e2e/output e é a prova de que não era
// falha de troca: a captura nunca pode começar antes de a tela ter sido atualizada.
export const settle = (page, ms = 350) => page.evaluate(wait => new Promise(resolve => {
  let frames = 0;
  const tick = () => { if (++frames >= 3) setTimeout(resolve, wait); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), ms);

// Liga a sonda e a captura, executa `during()` e devolve tudo já medido: o que o público viu (samples) e o que a página registrou (probe).
export async function observe(tv, helper, during, { settleMs = 350 } = {}) {
  if (settleMs) await settle(tv.page, settleMs);
  await probeOn(tv.page);
  const capture = await startCapture(tv.page);
  let result, failure = null;
  try { result = await during(); } catch (error) { failure = error; }
  const frames = await capture.stop();
  const probe = await probeOff(tv.page);
  if (failure) throw failure;
  const samples = await sampleFrames(helper, frames);
  return { frames, samples, probe, result };
}

// Salva um quadro capturado (JPEG) para conferência visual em tests/e2e/output.
export async function saveFrame(frames, index, file) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(frames[index].data, 'base64'));
}

// ---- preparação: TV, playlist e programação pela API ------------------------------------------------------------------------------------------
// `items`: [{ media, durationS, durationMode, transition, transitionMs }]. Devolve o código de pareamento da TV.
export async function publishToNewTv(kit, { name, items, loop = true }) {
  const created = await kit.playlist(kit.admin, {
    name: `Playlist ${name}`,
    items: items.map(({ media, durationS = 5, durationMode = 'fixed', transition = 'cut', transitionMs = 0 }) => ({ mediaId: media.id, durationS, durationMode, transition, transitionMs }))
  });
  let current = created;
  if (loop === false) {
    const response = await kit.call(`/api/playlists/${created.id}`, { method: 'PATCH', session: kit.admin, body: { rev: created.draftRev, loop: false } });
    assert.equal(response.status, 200);
    current = response.data;
  }
  const published = await kit.call(`/api/playlists/${created.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: current.draftRev } });
  assert.equal(published.status, 201, JSON.stringify(published.data));
  const { display, pairingCode } = await kit.display(kit.admin, { name });
  const schedule = await kit.liveSchedule(kit.admin, { playlistId: created.id, displayIds: [display.id], name: `Programação ${name}` });
  return { playlistId: created.id, displayId: display.id, scheduleId: schedule.id, scheduleRev: schedule.rev, code: pairingCode, version: published.data.latestVersion, draftRev: current.draftRev };
}

// Publica uma nova versão da playlist (troca os conteúdos) e passa a programação para ela: o que o gestor faz para mudar o que a TV mostra.
export async function publishNextVersion(kit, tv, { items }) {
  const current = await kit.call(`/api/playlists/${tv.playlistId}`, { session: kit.admin });
  assert.equal(current.status, 200);
  const changed = await kit.call(`/api/playlists/${tv.playlistId}`, {
    method: 'PATCH', session: kit.admin,
    body: { rev: current.data.draftRev, items: items.map(({ media, durationS = 5, durationMode = 'fixed', transition = 'cut', transitionMs = 0 }) => ({ mediaId: media.id, durationS, durationMode, transition, transitionMs })) }
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const published = await kit.call(`/api/playlists/${tv.playlistId}/publish`, { method: 'POST', session: kit.admin, body: { rev: changed.data.draftRev } });
  assert.equal(published.status, 201, JSON.stringify(published.data));
  const schedule = await kit.call(`/api/schedules/${tv.scheduleId}`, { session: kit.admin });
  assert.equal(schedule.status, 200);
  const moved = await kit.call(`/api/schedules/${tv.scheduleId}`, { method: 'PATCH', session: kit.admin, body: { rev: schedule.data.rev, playlistVersion: published.data.latestVersion } });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  return { version: published.data.latestVersion };
}

// Endereço fictício diferente a cada TV: o servidor limita as tentativas de pareamento por ENDEREÇO (o limite continua valendo e é testado
// nos testes do servidor); o ambiente de teste confia no cabeçalho X-Forwarded-For (trustProxy: 1), como o de login em harness.mjs.
let pairings = 0;

// Abre uma TV (contexto próprio: armazenamento, rede e preferências de movimento independentes) e a conecta pelo código, como na TV de verdade.
// `tolerate`: mensagens de console esperadas neste cenário (ex.: 404 que o cenário provoca de propósito); o resto continua sendo falha.
export async function connectTv(s, { code, reducedMotion = 'no-preference', viewport = { width: 960, height: 540 }, noAnimationApi = false, probe = true, tolerate = [], pair = true, setup = null } = {}) {
  const context = await s.browser.newContext({ viewport, locale: 'pt-BR', reducedMotion });
  if (probe) await context.addInitScript(installProbe);
  if (noAnimationApi) await context.addInitScript(() => { delete Element.prototype.animate; });
  if (setup) await setup(context); // ex.: interceptar o pedido de um arquivo para simular uma falha (antes de a TV pedir qualquer coisa)
  pairings++;
  await context.route('**/api/player/pair', route => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.66.${(pairings >> 8) & 255}.${pairings & 255}` } }));
  const page = await context.newPage();
  const problems = [];
  const accept = text => !tolerate.some(pattern => pattern.test(text));
  page.on('console', message => { if (['error', 'warning'].includes(message.type()) && accept(message.text())) problems.push(`console.${message.type()}: ${message.text()}`); });
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  // O que a TV pediu ao servidor: cada arquivo de mídia (para provar que baixa uma vez só) e cada consulta da programação.
  const media = [], manifests = [];
  page.on('response', response => {
    const url = new URL(response.url());
    const file = /^\/api\/media\/([^/]+)\/file$/.exec(url.pathname);
    if (file) media.push({ id: file[1], status: response.status(), at: Date.now() });
    else if (url.pathname === '/api/player/manifest') manifests.push({ status: response.status(), at: Date.now() });
  });
  await page.goto(`${s.origin}/player.html`);
  if (pair) {
    await page.fill('#pair-code', code);
    await page.click('#pair-submit');
    await page.waitForSelector('#playback:not([hidden])');
  }
  return { page, context, problems, media, manifests, async close() { await context.close().catch(() => {}); } };
}

// Espera o conteúdo `title` aparecer no topo do palco (camada visível mais alta).
export const waitForTop = (page, title, timeout = 30_000) => page.waitForFunction(expected => {
  const layers = [...document.querySelectorAll('#stage > .stage-layer:not(.is-standby)')];
  if (!layers.length) return false;
  const top = layers.reduce((a, b) => (Number(b.style.zIndex || 0) >= Number(a.style.zIndex || 0) ? b : a));
  const media = top.querySelector('img, video, iframe');
  return media && (media.getAttribute('alt') ?? media.getAttribute('aria-label') ?? media.getAttribute('title')) === expected;
}, title, { timeout });

export const statusText = page => page.locator('#playback-status').innerText();
export const noteText = page => page.locator('#playback-note').innerText().catch(() => '');
// Título do conteúdo que está por cima no palco agora.
export const topTitle = page => page.evaluate(() => {
  const layers = [...document.querySelectorAll('#stage > .stage-layer:not(.is-standby)')];
  if (!layers.length) return null;
  const top = layers.reduce((a, b) => (Number(b.style.zIndex || 0) >= Number(a.style.zIndex || 0) ? b : a));
  const media = top.querySelector('img, video, iframe');
  return media ? (media.getAttribute('alt') ?? media.getAttribute('aria-label') ?? media.getAttribute('title')) : null;
});
