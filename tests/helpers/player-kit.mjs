// Monta o player da TV inteiro para os testes: a página real (public/player.html), o código real (public/js/player/app.js e todo o
// carrossel), um servidor de mentira que responde como a API, um navegador de mentira (imagens, vídeos, animações) e um relógio que
// anda quando o teste manda. O que NÃO é real: o navegador. O desenho, os codecs e o desempenho são conferidos no Chromium (tests/e2e).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeEvent } from './fake-dom.mjs';
import { loadBody } from './html-dom.mjs';
import { createMediaEnvironment } from './fake-media-dom.mjs';
import { createFakeClock, createMemoryStorage, WALL_START } from './playback-fakes.mjs';
import { startPlayer, TOKEN_KEY } from '../../public/js/player/app.js';

export const PLAYER_HTML = readFileSync(new URL('../../public/player.html', import.meta.url), 'utf8');
export { TOKEN_KEY, WALL_START };

const aborted = () => Object.assign(new Error('abortado'), { name: 'AbortError' });

// Servidor de mentira: responde às rotas do player e registra cada pedido.
export function createFakeServer({ clock, wall, items = [], display = 'TV de teste', loop = true, code = '123456', token = 'device-token' } = {}) {
  const state = { items, display, loop, code, token, revoked: false, offline: false, heartbeatStatus: 200, validityMs: 60_000, delayMs: 0, mediaStatus: {}, mediaBytes: 64, linkStatus: 0, linkDelayMs: 0 };
  const requests = [];
  const downloads = [];
  const links = []; // ids dos vídeos para os quais a TV pediu o link temporário (/api/player/media/<id>/link)
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const pause = ms => new Promise(resolve => clock.setTimeout(resolve, ms));
  const mediaId = path => /^\/api\/media\/([^/]+)\/file$/.exec(path)?.[1] ?? null;
  const bearer = init => init.headers?.get?.('Authorization') ?? null;

  async function http(path, init = {}) {
    requests.push({ path, method: init.method ?? 'GET', authorization: bearer(init), body: init.body ?? null, signal: init.signal, init });
    if (init.signal?.aborted) throw aborted();
    if (state.delayMs) {
      await new Promise((resolve, reject) => { const id = clock.setTimeout(resolve, state.delayMs); init.signal?.addEventListener('abort', () => { clock.clearTimeout(id); reject(aborted()); }, { once: true }); });
    }
    if (state.offline) throw new TypeError('fetch failed');
    if (path === '/api/player/pair') {
      const body = JSON.parse(init.body ?? '{}');
      return body.code === state.code ? json(200, { token: state.token, display: { name: state.display } }) : json(400, { error: 'Código inválido ou expirado. Peça um novo código à TI.' });
    }
    const authorized = bearer(init) === `Bearer ${state.token}` && !state.revoked;
    if (path === '/api/player/manifest') {
      if (!authorized) return json(401, { error: 'Acesso negado.' });
      const now = wall();
      return json(200, { display: { name: state.display }, items: state.items, loop: state.loop, generatedAt: new Date(now).toISOString(), validUntil: new Date(now + state.validityMs).toISOString() });
    }
    if (path === '/api/player/heartbeat') {
      if (!authorized) return json(401, { error: 'Acesso negado.' });
      return json(state.heartbeatStatus, { ok: true });
    }
    const linkId = /^\/api\/player\/media\/([^/]+)\/link$/.exec(path)?.[1];
    if (linkId) {
      if (!authorized) return json(401, { error: 'Acesso negado.' });
      links.push(linkId);
      if (state.linkDelayMs) await new Promise((resolve, reject) => { const id = clock.setTimeout(resolve, state.linkDelayMs); init.signal?.addEventListener('abort', () => { clock.clearTimeout(id); reject(aborted()); }, { once: true }); });
      if (state.linkStatus) return json(state.linkStatus, { error: 'falha simulada' }); // ex.: 404 = servidor sem esta rota (versão anterior)
      return json(200, { url: `/api/media/${linkId}/file?t=${state.token}.1893456000000.${'a'.repeat(43)}`, expiresAt: '2030-01-01T00:00:00.000Z' });
    }
    const id = mediaId(path);
    if (id) {
      if (!authorized) return json(401, { error: 'Acesso negado.' });
      downloads.push(id);
      if (state.mediaStatus[id]) return json(state.mediaStatus[id], { error: 'falha simulada' });
      const bytes = new Uint8Array(state.mediaBytes).fill(7);
      return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength), 'content-type': 'application/octet-stream' } });
    }
    return json(404, { error: 'Não encontrado.' });
  }
  return { state, http, requests, downloads, links, pause, count: path => requests.filter(request => request.path === path).length };
}

// `manifestItems`: itens como o servidor os entrega. `scripts`: o que o navegador de mentira faz com cada arquivo.
// `fakeSource`: usa arquivos de mentira (fake://id) em vez do baixador real; com `false`, o baixador real roda contra o servidor de mentira.
export function createPlayerKit({
  search = '', token = 'device-token', manifestItems = [], loop = true, scripts = {}, animations = true, reducedMotion = false,
  fakeSource = true, storage = createMemoryStorage(), clock = createFakeClock(), start = true, scope, http: httpOverride = null, serverOptions = {}, refuseBlobVideo = 0
} = {}) {
  let skew = 0; // quanto o relógio de parede andou sem que nenhum prazo do navegador disparasse (aparelho suspenso)
  const wall = () => WALL_START + clock.now() + skew;
  const env = createMediaEnvironment({ clock, scripts, animations, refuseBlobVideo });
  const { document } = env;
  loadBody(document, PLAYER_HTML);
  const server = createFakeServer({ clock, wall, items: manifestItems, loop, ...serverOptions });
  if (token) storage.set(TOKEN_KEY, token);

  // Elementos que o navegador de verdade ofereceria e o DOM de teste não tem.
  const byId = id => document.getElementById(id);
  const dialog = byId('disconnect-dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  document.hidden = false;
  document.fullscreenElement = null;
  document.documentElement = { requestFullscreen: async () => { document.fullscreenElement = {}; document.dispatchEvent(new FakeEvent('fullscreenchange')); } };
  document.exitFullscreen = async () => { document.fullscreenElement = null; document.dispatchEvent(new FakeEvent('fullscreenchange')); };

  const win = Object.assign(new EventTarget(), {
    Element: { prototype: animations ? { animate() {} } : {} },
    matchMedia: query => ({ matches: reducedMotion && query.includes('prefers-reduced-motion') })
  });
  const navigations = [];
  const kit = {
    clock, env, document, win, storage, server, scripts, navigations, byId,
    player: null,
    // ---- leitura da tela ------------------------------------------------------------------------------------------------------------
    text: id => byId(id).textContent,
    visible: id => !byId(id).hidden,
    layers: () => byId('stage').querySelectorAll('.stage-layer'),
    shownLayers: () => kit.layers().filter(layer => !layer.classList.contains('is-standby')),
    // O conteúdo que o público vê agora: a camada visível mais alta.
    topLayer() {
      const layers = kit.shownLayers();
      return layers.sort((a, b) => Number(a.style.zIndex ?? 0) - Number(b.style.zIndex ?? 0)).at(-1) ?? null;
    },
    topId() {
      const layer = kit.topLayer();
      if (!layer) return null;
      const media = layer.querySelector('img') ?? layer.querySelector('video') ?? layer.querySelector('iframe');
      const src = media?.getAttribute?.('src') ?? media?.srcValue ?? media?.src ?? '';
      return /^fake:\/\/([^#]*)/.exec(src)?.[1] ?? (layer.querySelector('article') ? layer.getAttribute('data-kind') : (src || null));
    },
    topTitle() { return kit.topLayer()?.querySelector('h2')?.textContent ?? null; },
    status: () => byId('playback-status').textContent,
    // ---- ações ----------------------------------------------------------------------------------------------------------------------
    click: id => byId(id).click(),
    type(id, value) { const input = byId(id); input.value = value; input.dispatchEvent(new FakeEvent('input', { bubbles: true })); },
    async submitPair(code) {
      kit.type('pair-code', code);
      const form = byId('pair-form');
      const submitted = new FakeEvent('submit', { cancelable: true });
      form.dispatchEvent(submitted);
      await clock.advance(0);
      return submitted;
    },
    key(key, { target = document.body, ...modifiers } = {}) {
      const event = Object.assign(new FakeEvent('keydown', { bubbles: true, cancelable: true }), { key, ...modifiers });
      target.dispatchEvent(event);
      return event;
    },
    winEvent(type, extra = {}) { win.dispatchEvent(Object.assign(new Event(type), extra)); },
    settle: ms => clock.advance(ms),
    // Simula o aparelho suspenso (TV em espera, aba escondida): o relógio de parede anda, mas nenhum prazo do navegador dispara.
    suspend(ms) { skew += ms; },
    // Gira o relógio e o fim das animações até a tela ficar parada (nada em movimento).
    async finishMotion() { for (let turn = 0; turn < 4; turn++) { env.finishAll(); await clock.advance(0); } },
    // Encerra o player e confere que não ficou nada para trás: prazos, camadas, arquivos abertos, pedidos e erros internos.
    async close() {
      kit.player?.destroy();
      await clock.advance(0);
      assert.equal(clock.pending(), 0, 'nenhum prazo pendente depois de encerrar o player');
      assert.equal(kit.layers().length, 0, 'nenhuma camada de exibição sobrou');
      if (fakeSource) assert.equal(env.source.opened.length, env.source.released.length, 'todo arquivo aberto foi liberado');
      assert.equal(env.running().length, 0, 'nenhuma animação em andamento');
      env.restore();
    }
  };
  if (start) kit.start = () => kit.player;
  kit.begin = () => {
    kit.player = startPlayer({
      doc: document, win, search, navigate: url => navigations.push(url), storage, http: httpOverride ?? server.http, scope,
      clock, wall, random: () => 0.5, raf: env.raf, cancelRaf: env.cancelRaf, source: fakeSource ? env.source : null
    });
    return kit.player;
  };
  if (start) kit.begin();
  return kit;
}

// Item como o servidor o entrega no manifesto.
export const entry = (id, extra = {}) => ({ id, title: id.toUpperCase(), name: `${id}.png`, type: 'image/png', url: `/api/media/${id}/file`, duration: 10, durationMode: 'fixed', transition: 'cut', transitionMs: 0, ...extra });
