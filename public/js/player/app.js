// Player da TV (Fase 2): pareamento, consulta da programação, exibição pelo carrossel e recuperação de falhas.
//
// Tudo o que pertence ao navegador (documento, rede, relógio, armazenamento) chega por parâmetro em startPlayer(); quem liga isso aos
// objetos reais é public/player.js. Assim o player inteiro roda nos testes do Node, com tempo e rede de mentira, e o mesmo código
// roda na TV. A credencial da TV é usada somente em /api/player/* e em /api/media/<id>/file do próprio servidor.
import { createCarousel, systemClock } from '../playback/carousel.js';
import { createStage, detectCapabilities } from '../playback/stage.js';
import { createTvSource } from '../playback/loader.js';
import { createBlobCache } from '../playback/media-cache.js';
import { createTierKeeper, simplifiedReasonText } from '../playback/effects.js';
import { skipReasonText } from '../playback/messages.js';
import { normalizeItems } from '../playback/model.js';
import { pollDelay } from '../playback/timing.js';

export const PLAYER_VERSION = '2.4.0';
export const TOKEN_KEY = 'tv-corporativa.device.v1';
export const VIDEO_WAY_KEY = 'tv-corporativa.video-way.v1'; // 'direct' | 'blob': por onde os vídeos tocam nesta TV (veja loader.js)
export const REVOKED_MESSAGE = 'O acesso desta TV foi revogado. Solicite um novo código à TI.';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_VALIDITY_MS = 60_000;      // a autorização de exibição vale, no máximo, 60 s depois de cada consulta bem-sucedida
const CONTROLS_HIDE_MS = 6_000;
const PROGRESS_EVERY_MS = 250;
const SKIP_MEMORY_MS = 35_000;       // quanto tempo um conteúdo pulado segue indicado na barra (o motor volta a tentá-lo em 30 s)
const SKIP_ANNOUNCE_MS = 10 * 60_000;

// Elementos de public/player.html que o player usa. Um teste confere que todos existem na página.
export const ELEMENT_IDS = Object.freeze([
  'pairing', 'pair-form', 'pair-code', 'pair-error', 'pair-submit', 'playback', 'stage', 'empty', 'empty-title', 'empty-description',
  'demo-badge', 'control-dock', 'status-dot', 'display-name', 'playback-status', 'playback-note', 'previous-slide', 'play-toggle',
  'next-slide', 'audio-toggle', 'audio-notice', 'fullscreen', 'disconnect', 'slide-progress', 'disconnect-dialog', 'cancel-disconnect', 'confirm-disconnect', 'announcement'
]);
const camel = id => id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const TEXT = Object.freeze({
  connecting: ['Conectando com segurança.', 'Buscando a programação desta TV…'],
  paired: ['Conexão realizada.', 'Buscando a programação desta TV…'],
  noSchedule: ['Tudo pronto por aqui.', 'Nenhum conteúdo aprovado está programado para esta TV neste momento.'],
  interrupted: ['Conexão interrompida.', 'A exibição foi pausada para proteger o conteúdo. A TV voltará a exibir quando a conexão segura for restabelecida.'],
  loading: ['Preparando a exibição…', 'Carregando o primeiro conteúdo desta TV.']
});

// Por que um conteúdo foi pulado, em palavras que a equipe de TI entende (os mesmos textos da pré-visualização do painel).
export { skipReasonText };

// Recursos do navegador sem os quais o player não funciona. Em vez de ficar parado sem explicação, a tela de pareamento diz o que falta.
export function missingFeatures(scope = globalThis, http = scope.fetch) {
  const missing = [];
  if (typeof http !== 'function') missing.push('fetch');
  if (typeof scope.AbortController !== 'function') missing.push('AbortController');
  if (typeof scope.Headers !== 'function') missing.push('Headers');
  if (typeof scope.Blob !== 'function') missing.push('Blob');
  if (typeof scope.URL?.createObjectURL !== 'function' || typeof scope.URL?.revokeObjectURL !== 'function') missing.push('URL.createObjectURL');
  return missing;
}

// ---- demonstração (?demo=1): exemplos que passam pelo mesmo carrossel, sem servidor nem credencial --------------------------------
const DEMO_SLIDES = Object.freeze([
  { title: 'Juntos, damos vida ao futuro.', eyebrow: 'NOSSA GENTE. NOSSA FORÇA.', description: 'Uma empresa conectada começa com pessoas bem informadas. Bem-vindo à nossa TV corporativa.', tag: 'Comunicação interna · Exemplo', art: 'P', dark: false },
  { title: 'Segurança começa com você.', eyebrow: 'CUIDAR É RESPONSABILIDADE DE TODOS', description: 'Use os equipamentos de proteção indicados para a sua atividade. Na dúvida, fale com Segurança do Trabalho.', tag: 'Segurança do Trabalho · Exemplo', art: 'shield', dark: true },
  { title: 'Sua ideia faz a diferença.', eyebrow: 'ESPAÇO PARA O QUE NOS MOVE', description: 'Compartilhe sugestões com seu setor. Pequenas melhorias constroem grandes resultados.', tag: 'Recursos Humanos · Exemplo', art: '+', dark: false }
]);

function demoNode(doc, slide) {
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const wrapper = make('article', `demo-slide${slide.dark ? ' dark' : ''}`);
  const copy = make('div', 'demo-copy');
  const brand = make('div', 'brand official-brand');
  const mark = make('img', 'brand-logo');
  mark.src = '/assets/logo.png'; mark.alt = 'TV Corporativa'; mark.width = 163; mark.height = 130;
  const word = make('span', '', 'TV CORPORATIVA');
  word.append(make('span', 'brand-caption', 'CONECTANDO PESSOAS'));
  brand.append(mark, word);
  copy.append(brand, make('p', 'eyebrow', slide.eyebrow), make('h2', '', slide.title), make('p', '', slide.description), make('span', 'tag', slide.tag));
  const art = make('div', 'demo-art');
  art.setAttribute('aria-hidden', 'true');
  art.append(make('span', 'big-word', slide.art === 'shield' ? '✓' : slide.art));
  wrapper.append(copy, art);
  return wrapper;
}

export const demoItems = doc => normalizeItems(DEMO_SLIDES.map((slide, index) => ({
  id: `demo-${index + 1}`, title: slide.title, type: 'application/x-tvcorp-html', durationMs: 15_000, transition: 'fade', transitionMs: 800,
  render: () => demoNode(doc, slide)
})));

const isInside = (container, node) => { for (let current = node; current; current = current.parentNode) if (current === container) return true; return false; };

export function startPlayer(env) {
  const {
    doc, win = {}, search = '', navigate = () => {}, storage = null, http, scope = globalThis,
    clock = systemClock(), wall = () => Date.now(), random = () => 0.5, raf, cancelRaf, source: customSource = null
  } = env;
  const demo = new URLSearchParams(search).get('demo') === '1';

  const ui = {};
  for (const id of ELEMENT_IDS) {
    const element = doc.getElementById(id);
    if (!element) throw new Error(`player.html: falta o elemento #${id}.`);
    ui[camel(id)] = element;
  }

  const missing = demo ? [] : missingFeatures(scope, http);
  if (missing.length) {
    ui.pairError.textContent = `Este navegador não tem recursos necessários para o player (${missing.join(', ')}). Atualize o navegador da TV ou peça apoio à TI.`;
    ui.pairError.hidden = false;
    ui.pairSubmit.disabled = true;
    ui.pairCode.disabled = true;
    return { unsupported: missing, destroy() {}, poll: async () => {}, carousel: null, cacheStats: () => ({ entries: 0, bytes: 0 }) };
  }

  let token = '';
  try { token = demo ? '' : (storage?.get(TOKEN_KEY) || ''); } catch { token = ''; }
  let validUntil = 0, expired = false, link = 'ok', failures = 0, polling = false, disposed = false, scheduleKnown = false;
  let pollTimer = null, expiryTimer = null, hideTimer = null, progressTimer = null;
  let lastPlaying = true, effectNote = '', lastRatio = 0;
  const skipped = new Map();      // id do conteúdo → { title, reason, at }
  const lastSkipped = () => { let last; for (const entry of skipped.values()) last = entry; return last; }; // o mais recente (undefined se vazio)
  const announcedAt = new Map();  // id do conteúdo → quando o aviso de "pulado" foi dado
  const inflight = new Set();     // pedidos à API em andamento (cancelados ao encerrar)
  const listeners = [];

  const clearTimer = id => { if (id !== null) clock.clearTimeout(id); };
  const listen = (target, type, handler, options) => {
    if (typeof target?.addEventListener !== 'function') return; // ambiente sem este tipo de evento
    target.addEventListener(type, handler, options);
    listeners.push([target, type, handler]);
  };
  const announce = message => { ui.announcement.textContent = message; };

  // ---- rede ----------------------------------------------------------------------------------------------------------------------
  // Pedidos à API: prazo total de 15 s (cabeçalhos e corpo) e credencial da TV. O servidor nunca recebe outra coisa além disso.
  async function call(path, { method = 'GET', body, auth = true, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
    const controller = new AbortController();
    inflight.add(controller);
    const timer = clock.setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const headers = new Headers();
      if (auth && token) headers.set('Authorization', `Bearer ${token}`);
      let payload;
      if (body !== undefined) { headers.set('Content-Type', 'application/json'); payload = JSON.stringify(body); }
      const response = await http(path, { method, headers, body: payload, cache: 'no-store', credentials: 'omit', signal: controller.signal });
      let data = null;
      try { data = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; }
      return { status: response.status, ok: response.ok, data };
    } finally {
      clock.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      inflight.delete(controller);
    }
  }

  // Arquivos de mídia: quem baixa (loader) controla os prazos e o cancelamento; aqui só entra a credencial da TV.
  const fetchMedia = (path, { signal } = {}) => {
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return http(path, { headers, cache: 'no-store', credentials: 'omit', signal });
  };

  // Link temporário e assinado de um vídeo, para o <video> pedir o arquivo direto ao servidor (sem a credencial no endereço de rede).
  // Só é usado nas TVs que não tocam o arquivo baixado (veja loader.js); a credencial da TV vai apenas neste pedido à API.
  const directLink = async (id, { signal } = {}) => {
    const reply = await call(`/api/player/media/${encodeURIComponent(id)}/link`, { signal });
    if (!reply.ok) throw Object.assign(new Error(`O servidor respondeu ${reply.status}.`), { status: reply.status });
    return reply.data;
  };

  // ---- carrossel -----------------------------------------------------------------------------------------------------------------
  const cache = createBlobCache();
  const remember = demo || !storage ? null : { get: () => storage.get(VIDEO_WAY_KEY), set: value => storage.set(VIDEO_WAY_KEY, value) };
  const source = customSource ?? createTvSource({ request: fetchMedia, cache, directLink, remember });
  const stage = createStage({ root: ui.stage, source, doc, timers: clock, raf, cancelRaf, onAudioState: renderAudio });
  const tierStorage = demo ? null : storage;
  const tiers = createTierKeeper({ storage: tierStorage, now: wall });
  const carousel = createCarousel({
    renderer: stage, clock, wallClock: wall, tiers, capability: detectCapabilities(win), storage: tierStorage, random, onEvent: handleEvent
  });

  // ---- o que aparece na tela ------------------------------------------------------------------------------------------------------
  function showEmpty(title, description) {
    ui.emptyTitle.textContent = title;
    ui.emptyDescription.textContent = description;
    ui.empty.hidden = false;
  }
  const hideEmpty = () => { ui.empty.hidden = true; };

  function pendingSkips() {
    const now = clock.now();
    for (const [key, entry] of skipped) if (now - entry.at > SKIP_MEMORY_MS) skipped.delete(key);
    return skipped.size;
  }

  function renderStatus() {
    const shot = carousel.snapshot();
    let text = 'Conectando', warn = false;
    if (!demo && expired) { text = 'Aguardando conexão'; warn = true; } else {
      if (shot.state === 'unavailable') { text = 'Conteúdo indisponível'; warn = true; }
      else if (shot.state === 'loading') text = 'Carregando';
      else if (shot.state === 'idle') text = scheduleKnown ? 'Aguardando programação' : 'Conectando';
      else if (shot.state === 'finished') text = `${shot.count} de ${shot.count} · Sequência concluída`;
      else if (shot.state === 'running' && shot.index >= 0) text = `${demo ? 'Exemplo ' : ''}${shot.index + 1} de ${shot.count} · ${shot.playing ? 'Em exibição' : 'Pausado'}`;
      else if (shot.state === 'running') text = 'Carregando';
      const pending = shot.state === 'unavailable' ? 0 : pendingSkips(); // sem nada para exibir, o aviso da tela já explica
      if (pending > 0) { text += ` · ${pending} ${pending === 1 ? 'conteúdo pulado' : 'conteúdos pulados'}`; warn = true; }
      if (!demo && link !== 'ok') { text += ' · Reconectando…'; warn = true; }
    }
    ui.playbackStatus.textContent = text;
    ui.statusDot.classList.toggle('warning', warn);
  }

  function renderNote() {
    let text = effectNote;
    if (pendingSkips() > 0) {
      const last = lastSkipped();
      text = `Conteúdo pulado: ${last.title} (${skipReasonText(last.reason)}).`;
    }
    ui.playbackNote.textContent = text;
    ui.playbackNote.hidden = !text;
  }

  function renderControls() {
    const shot = carousel.snapshot();
    const finished = shot.state === 'finished';
    const active = shot.state === 'running' || finished;
    ui.playToggle.disabled = !active;
    ui.previousSlide.disabled = !active || shot.count < 2;
    ui.nextSlide.disabled = !active || shot.count < 2;
    const label = finished ? 'Reiniciar' : (shot.playing ? 'Pausar' : 'Reproduzir');
    const description = finished ? 'Reiniciar a sequência' : (shot.playing ? 'Pausar reprodução' : 'Reproduzir conteúdo');
    ui.playToggle.textContent = label;
    ui.playToggle.setAttribute('aria-label', description);
    ui.playToggle.title = `${description} (K)`;
  }

  function renderAudio(audio = stage.audioState()) {
    const label = audio.blocked ? 'Ativar áudio' : (audio.muted ? 'Ativar som' : 'Silenciar');
    ui.audioToggle.textContent = label;
    ui.audioToggle.disabled = !audio.hasVideo;
    ui.audioToggle.setAttribute('aria-label', `${label} do vídeo`);
    ui.audioToggle.title = `${label} (M)`;
    ui.audioNotice.hidden = !audio.blocked || !audio.hasVideo;
    ui.controlDock.classList.toggle('audio-required', audio.blocked && audio.hasVideo);
    ui.audioNotice.textContent = audio.blocked && audio.hasVideo ? 'O navegador bloqueou o som. Selecione Ativar áudio ou pressione M.' : '';
    if (audio.blocked && audio.hasVideo && !disposed) reveal();
  }

  function toggleAudio() {
    const audio = stage.audioState();
    if (!audio.hasVideo) return;
    // A chamada ocorre dentro do clique/tecla: não aguardar nada antes de pedir a reprodução com som.
    const requested = audio.muted ? stage.activateAudio() : stage.setMuted(true);
    Promise.resolve(requested).catch(() => announce('O navegador ainda bloqueou a reprodução. Use Reproduzir para iniciar ou consulte as configurações de som.'));
    reveal();
  }

  function refresh() {
    if (disposed) return;
    renderStatus();
    renderNote();
    renderControls();
    renderAudio();
  }

  // Barra de progresso: só transform (a placa de vídeo anima), atualizada 4 vezes por segundo enquanto exibe.
  function tickProgress() {
    progressTimer = null;
    if (disposed) return;
    const shot = carousel.snapshot();
    const running = shot.state === 'running' || shot.state === 'finished';
    const ratio = running ? Math.max(0, Math.min(1, shot.progress ?? 0)) : 0;
    ui.slideProgress.style.transition = ratio >= lastRatio ? '' : 'none'; // voltar ao início não "rebobina" a barra
    ui.slideProgress.style.transform = `scaleX(${ratio.toFixed(3)})`;
    lastRatio = ratio;
    if (shot.state === 'running' && shot.playing) progressTimer = clock.setTimeout(tickProgress, PROGRESS_EVERY_MS);
  }
  const startProgress = () => { if (progressTimer === null) tickProgress(); };

  function reveal() {
    ui.controlDock.classList.remove('quiet');
    clearTimer(hideTimer);
    hideTimer = clock.setTimeout(() => {
      hideTimer = null;
      const shot = carousel.snapshot();
      const audio = stage.audioState();
      if (!(audio.blocked && audio.hasVideo) && !isInside(ui.controlDock, doc.activeElement) && shot.count > 0 && shot.playing) ui.controlDock.classList.add('quiet');
    }, CONTROLS_HIDE_MS);
  }

  function showPlayback() {
    ui.pairing.hidden = true;
    ui.playback.hidden = false;
    ui.demoBadge.hidden = !demo;
    ui.disconnect.textContent = demo ? 'Voltar ao painel' : 'Desconectar';
    reveal();
  }

  // ---- eventos do motor --------------------------------------------------------------------------------------------------------------
  function handleEvent(event) {
    if (disposed) return;
    switch (event.type) {
      case 'autoplay-blocked':
        announce('O navegador bloqueou a reprodução. Use Reproduzir para iniciar.');
        reveal();
        break;
      case 'auth':
        // O acesso foi revogado durante um download. Sai do fluxo do motor antes de desfazer o pareamento.
        clock.setTimeout(() => { if (token && !disposed) resetPairing(REVOKED_MESSAGE); }, 0);
        return;
      case 'state':
        if (event.state === 'loading') showEmpty(...TEXT.loading);
        if (event.playing !== undefined && event.playing !== lastPlaying) {
          lastPlaying = event.playing;
          announce(event.playing ? 'Reprodução retomada.' : 'Reprodução pausada.');
        }
        if (event.state === 'finished') announce('A sequência terminou.');
        startProgress();
        break;
      case 'change':
        skipped.delete(event.item.id);
        effectNote = event.effect?.simplified && simplifiedReasonText(event.effect.reason) ? `Efeito simplificado: ${simplifiedReasonText(event.effect.reason)}.` : '';
        hideEmpty();
        startProgress();
        break;
      case 'skip': {
        const item = event.item ?? {};
        const key = item.id ?? String(event.index);
        skipped.delete(key); // sai e entra de novo: a ordem do Map é a ordem de quem foi pulado por último
        skipped.set(key, { title: item.title ?? 'Conteúdo', reason: event.reason, at: clock.now() });
        const previous = announcedAt.get(key);
        if (previous === undefined || clock.now() - previous > SKIP_ANNOUNCE_MS) {
          announcedAt.set(key, clock.now());
          announce(`${item.title ?? 'Um conteúdo'} não pôde ser exibido (${skipReasonText(event.reason)}) e foi pulado.`);
        }
        break;
      }
      case 'unavailable': {
        const last = lastSkipped();
        const why = last ? `${last.title} não pôde ser exibido (${skipReasonText(last.reason)}). ` : '';
        showEmpty('Conteúdo indisponível nesta TV', `${why}A TV tentará novamente em alguns segundos. Para documentos, peça à TI uma versão em imagens ou vídeo.`);
        announce('Nenhum conteúdo pôde ser exibido. A TV tentará novamente.');
        break;
      }
      case 'empty':
        showEmpty(...TEXT.noSchedule);
        break;
      case 'recovered':
        announce('A exibição foi retomada.');
        break;
      case 'tier':
        effectNote = 'Efeitos simplificados para manter a exibição fluida neste aparelho.';
        announce(effectNote);
        break;
      default:
        break;
    }
    refresh();
  }

  // ---- pareamento e acesso ----------------------------------------------------------------------------------------------------------
  function resetPairing(message) {
    clearTimer(pollTimer); clearTimer(expiryTimer); pollTimer = expiryTimer = null;
    carousel.stop();
    source.forget?.();
    token = ''; validUntil = 0; expired = false; link = 'ok'; failures = 0; scheduleKnown = false; effectNote = '';
    skipped.clear();
    try { storage?.remove(TOKEN_KEY); } catch { /* sem armazenamento */ }
    ui.playback.hidden = true;
    ui.pairing.hidden = false;
    ui.pairError.textContent = message || '';
    ui.pairError.hidden = !message;
    ui.pairCode.value = '';
    ui.pairCode.focus();
    if (message) announce(message);
  }

  async function pair(event) {
    event.preventDefault();
    const code = ui.pairCode.value.trim();
    if (!/^\d{6}$/.test(code)) { ui.pairError.textContent = 'Digite os 6 números do código.'; ui.pairError.hidden = false; return; }
    ui.pairSubmit.disabled = true;
    ui.pairSubmit.textContent = 'Conectando…';
    ui.pairError.hidden = true;
    try {
      let response;
      try { response = await call('/api/player/pair', { method: 'POST', body: { code }, auth: false }); } catch { throw new Error('Não foi possível conectar. Verifique a rede desta TV.'); }
      if (!response.ok || !response.data?.token) throw new Error(response.data?.error || 'Código inválido ou expirado. Peça um novo código à TI.');
      token = response.data.token;
      try { storage.set(TOKEN_KEY, token); } catch { announce('A conexão ficará ativa apenas enquanto esta página estiver aberta.'); }
      ui.displayName.textContent = response.data.display?.name || 'TV corporativa';
      showPlayback();
      showEmpty(...TEXT.paired);
      refresh();
      await poll();
      ui.fullscreen.focus();
    } catch (error) {
      ui.pairError.textContent = error.message;
      ui.pairError.hidden = false;
    } finally {
      ui.pairSubmit.disabled = false;
      ui.pairSubmit.textContent = 'Conectar esta TV →';
    }
  }

  // ---- validade da exibição ------------------------------------------------------------------------------------------------------------
  function armExpiry() {
    clearTimer(expiryTimer);
    expiryTimer = clock.setTimeout(expire, Math.max(0, validUntil - wall()));
  }

  // Sem uma consulta bem-sucedida nos últimos 60 s a TV para de exibir (protege o conteúdo) e guarda o ponto onde estava.
  function expire() {
    if (demo || disposed || !token) return;
    if (wall() < validUntil) { armExpiry(); return; }
    if (expired) return;
    expired = true;
    carousel.stop({ remember: true });
    source.forget?.();
    showEmpty(...TEXT.interrupted);
    refresh();
    reveal();
  }

  // ---- consulta da programação -------------------------------------------------------------------------------------------------------
  function applyManifest(manifest) {
    scheduleKnown = true;
    const list = normalizeItems(manifest.items);
    carousel.load(list, { loop: manifest.loop !== false });
    cache.retain(list.map(item => item.url).filter(Boolean)); // arquivos que saíram da programação saem da memória
  }

  async function poll() {
    if (!token || disposed || demo || polling) return;
    polling = true;
    clearTimer(pollTimer); pollTimer = null;
    const requestToken = token;
    const requestedAt = wall();
    const stale = () => disposed || token !== requestToken;
    try {
      const response = await call('/api/player/manifest');
      if (stale()) return;
      if (response.status === 401 || response.status === 403) { resetPairing(REVOKED_MESSAGE); return; }
      const manifest = response.data;
      if (!response.ok) throw new Error('Conexão indisponível.');
      if (!manifest || !Array.isArray(manifest.items) || !manifest.display || !Number.isFinite(Date.parse(manifest.validUntil))) throw new Error('Programação inválida.');
      // Usa o intervalo informado pelo servidor, sem depender do relógio local da TV.
      const serverGenerated = Date.parse(manifest.generatedAt);
      const remaining = Number.isFinite(serverGenerated) ? Date.parse(manifest.validUntil) - serverGenerated : Date.parse(manifest.validUntil) - wall();
      validUntil = wall() + Math.max(0, Math.min(MAX_VALIDITY_MS, remaining - (wall() - requestedAt)));
      armExpiry();
      ui.displayName.textContent = manifest.display.name || 'TV corporativa';
      const wasOffline = link !== 'ok';
      expired = false; link = 'ok'; failures = 0;
      if (wasOffline) announce('Conexão restabelecida.');
      applyManifest(manifest);
      refresh();
      const heartbeat = await call('/api/player/heartbeat', { method: 'POST', body: { version: PLAYER_VERSION } });
      if (stale()) return;
      if (heartbeat.status === 401 || heartbeat.status === 403) { resetPairing(REVOKED_MESSAGE); return; }
    } catch {
      if (stale()) return;
      failures++;
      if (link === 'ok') announce('Sem resposta do servidor. Tentando reconectar.');
      link = 'retrying';
      if (!validUntil || wall() >= validUntil) expire();
      refresh();
    } finally {
      polling = false;
      // Falhou? tenta de novo logo (5 s, 10 s, 20 s), em vez de esperar o intervalo normal de 20 s.
      if (token && !disposed) pollTimer = clock.setTimeout(poll, token === requestToken ? pollDelay(failures, { random }) : 0);
    }
  }

  // ---- teclado e botões ------------------------------------------------------------------------------------------------------------------
  function onKey(event) {
    reveal();
    if (disposed || ui.playback.hidden || ui.disconnectDialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
    const tag = event.target?.localName ?? '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (['m', 'M', 'AudioVolumeMute', 'VolumeMute'].includes(event.key)) { event.preventDefault(); toggleAudio(); return; }
    let action = null;
    switch (event.key) {
      case 'MediaPlayPause': case 'k': case 'K': action = 'toggle'; break;
      case ' ': case 'Spacebar': if (tag !== 'button' && tag !== 'a') action = 'toggle'; break; // em um botão, o espaço aciona o botão
      case 'MediaTrackNext': case 'n': case 'N': action = 'next'; break;
      case 'MediaTrackPrevious': case 'p': case 'P': action = 'previous'; break;
      default: break;
    }
    if (!action) return;
    event.preventDefault();
    carousel[action]();
  }

  async function toggleFullscreen() {
    try { if (doc.fullscreenElement) await doc.exitFullscreen(); else await doc.documentElement.requestFullscreen(); } catch {
      announce('Este navegador não permite tela cheia automática. Use o modo de tela cheia nas configurações da TV.');
    }
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    for (const id of [pollTimer, expiryTimer, hideTimer, progressTimer]) clearTimer(id);
    pollTimer = expiryTimer = hideTimer = progressTimer = null;
    for (const controller of inflight) controller.abort();
    inflight.clear();
    carousel.destroy();
    source.forget?.();
    for (const [target, type, handler] of listeners.splice(0)) target.removeEventListener(type, handler);
  }

  listen(ui.pairForm, 'submit', pair);
  listen(ui.pairCode, 'input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });
  listen(ui.playToggle, 'click', () => { carousel.toggle(); reveal(); });
  listen(ui.audioToggle, 'click', toggleAudio);
  listen(ui.previousSlide, 'click', () => { carousel.previous(); reveal(); });
  listen(ui.nextSlide, 'click', () => { carousel.next(); reveal(); });
  listen(ui.fullscreen, 'click', toggleFullscreen);
  listen(doc, 'fullscreenchange', () => {
    ui.fullscreen.textContent = doc.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia ⛶';
    ui.fullscreen.setAttribute('aria-label', doc.fullscreenElement ? 'Sair da tela cheia' : 'Entrar em tela cheia');
  });
  listen(ui.disconnect, 'click', () => { if (demo) navigate('/'); else ui.disconnectDialog.showModal(); });
  listen(ui.cancelDisconnect, 'click', () => ui.disconnectDialog.close());
  listen(ui.confirmDisconnect, 'click', () => { ui.disconnectDialog.close(); resetPairing(); announce('Esta TV foi desconectada deste navegador.'); });
  listen(doc, 'pointermove', reveal, { passive: true });
  listen(doc, 'pointerdown', reveal, { passive: true });
  listen(doc, 'keydown', onKey);
  listen(doc, 'visibilitychange', () => { if (!doc.hidden && !demo && token) { if (wall() >= validUntil) expire(); poll(); } });
  // Voltou a rede: consulta já, sem esperar o próximo intervalo.
  listen(win, 'online', () => { if (token && !demo) { failures = 0; poll(); } });
  listen(win, 'offline', () => { if (token && !demo && link === 'ok') { link = 'retrying'; announce('Sem rede. A exibição continua até a autorização expirar.'); refresh(); } });
  listen(win, 'pageshow', event => { if (event?.persisted && token && !demo) poll(); });
  listen(win, 'pagehide', event => { if (!event?.persisted) destroy(); });

  if (demo) {
    ui.displayName.textContent = 'TV Corporativa · Demonstração';
    showPlayback();
    refresh();
    carousel.load(demoItems(doc), { loop: true });
  } else if (token) {
    showPlayback();
    showEmpty(...TEXT.connecting);
    refresh();
    poll();
  }

  return { carousel, destroy, poll, cacheStats: () => cache.stats(), unsupported: [] };
}
