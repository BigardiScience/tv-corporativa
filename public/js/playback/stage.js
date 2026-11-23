// A tela do carrossel (o "renderer" do motor): monta cada conteúdo numa camada própria, deixa o próximo pronto POR TRÁS
// (a imagem é decodificada e o vídeo carregado antes de aparecer) e faz a troca com o efeito escolhido.
//
// Como não existe tela preta entre conteúdos:
//   1. o conteúdo novo só aparece depois de pronto (decodificado), nunca vazio;
//   2. a camada nova entra POR CIMA e a antiga permanece opaca até o fim da transição;
//   3. só depois a antiga é removida — no mesmo quadro em que a nova termina de aparecer.
// Os efeitos usam a API de animações do navegador (Web Animations) com opacidade, deslocamento, escala e, no dissolver, desfoque.
//
// Não toca em `document` ao ser importado: tudo o que é do navegador chega por parâmetro (por isso é testado no Node com DOM de mentira).
import { EFFECTS } from './effects.js';
import { loadError } from './loader.js';

const abortError = () => Object.assign(new Error('cancelado'), { name: 'AbortError', cancelled: true });

export function detectCapabilities(win = globalThis) {
  const matches = query => { try { return !!win.matchMedia?.(query)?.matches; } catch { return false; } };
  return {
    // Sem a API de animações do navegador, toda troca vira corte seco (o motor já resolve isso).
    animations: () => typeof win.Element?.prototype?.animate === 'function',
    // Preferência do sistema por menos movimento. Muitas TVs não oferecem essa opção: o motor também reduz sozinho em aparelhos lentos.
    reducedMotion: () => matches('(prefers-reduced-motion: reduce)')
  };
}

// presentFrames: quantos quadros esperar para o navegador apresentar o primeiro quadro de um vídeo recém-revelado (presentWaitMs é o teto);
// warmOpacity: a opacidade da camada do vídeo durante essa espera (praticamente invisível, mas desenhada).
export const STAGE_LIMITS = Object.freeze({ videoReadyMs: 20_000, pdfReadyMs: 5_000, settleGraceMs: 1_500, presentFrames: 3, presentWaitMs: 300, warmOpacity: 0.01 });

const MEDIA_ERROR_TEXT = 'Este aparelho não consegue reproduzir este vídeo (formato ou codec não suportado).';

function mediaFailure(video) {
  const code = video.error?.code;
  if (code === 2) return loadError('O vídeo foi interrompido por falha de rede.', { transient: true, code: 'network' });
  return loadError(MEDIA_ERROR_TEXT, { permanent: true, code: 'decode' });
}

export function createStage({
  root, source, doc = globalThis.document, timers = null,
  raf = globalThis.requestAnimationFrame?.bind(globalThis), cancelRaf = globalThis.cancelAnimationFrame?.bind(globalThis), limits = STAGE_LIMITS,
  onAudioState = () => {}
}) {
  const clock = timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: id => globalThis.clearTimeout(id) };
  const alive = new Set();
  let stacking = 0, inflight = null;
  // A preferência dura pela sessão deste palco, inclusive entre manifestos. Pré-carregamentos nunca tocam.
  // Reutilizamos elementos já liberados: alguns navegadores autorizam áudio por elemento, outros por página.
  const videos = new Set(), videoPool = [], videoOwners = new WeakMap();
  let activeVideo = null, userMuted = false, audioBlocked = false;
  const audioState = () => ({ muted: userMuted || audioBlocked, userMuted, blocked: audioBlocked, hasVideo: !!activeVideo, volume: 1 });
  const reportAudio = () => { try { onAudioState(audioState()); } catch { /* a interface não interrompe a exibição */ } };
  function applyAudio() {
    for (const entry of videos) { entry.video.volume = 1; entry.video.muted = userMuted || audioBlocked; }
    reportAudio();
  }
  function activateAudio() {
    userMuted = false; audioBlocked = false;
    applyAudio();
    // Não adiar play() a uma microtarefa: a ativação transitória do clique/tecla deve chegar ao navegador.
    // Mudar o som de uma exibição pausada não retoma o vídeo por conta própria.
    return activeVideo?.wantsPlayback ? activeVideo.start() : Promise.resolve();
  }
  function setMuted(value) {
    if (!value) return activateAudio();
    userMuted = true; audioBlocked = false;
    applyAudio();
    return Promise.resolve();
  }

  // Espera o primeiro de `ok` (resolve) ou de `fail` (rejeita), até `ms`. Cancelável.
  function waitFor(target, { ok, fail = [], signal, ms, onFail, onTimeout }) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const cleanup = () => {
        if (timer !== null) clock.clearTimeout(timer);
        for (const name of ok) target.removeEventListener(name, onOk);
        for (const name of fail) target.removeEventListener(name, onBad);
        signal?.removeEventListener('abort', onAbort);
      };
      const onOk = event => { cleanup(); resolve(event); };
      const onBad = event => { cleanup(); reject(onFail ? onFail(event) : loadError('Falha ao preparar o conteúdo.', { transient: true })); };
      const onAbort = () => { cleanup(); reject(abortError()); };
      for (const name of ok) target.addEventListener(name, onOk);
      for (const name of fail) target.addEventListener(name, onBad);
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = clock.setTimeout(() => {
        cleanup();
        // Uma exceção dentro de um temporizador não rejeitaria a promessa: o preparo ficaria pendurado até o prazo geral do motor.
        try {
          if (onTimeout) resolve(onTimeout());
          else reject(loadError('O conteúdo demorou para ficar pronto.', { transient: true, code: 'timeout' }));
        } catch (error) { reject(error); }
      }, ms);
    });
  }

  const raceAbort = (promise, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const onAbort = () => reject(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal?.removeEventListener('abort', onAbort); resolve(value); }, error => { signal?.removeEventListener('abort', onAbort); reject(error); });
  });

  // ---- cada tipo de conteúdo ---------------------------------------------------------------------------------------------------
  async function buildImage(item, opened, layer, signal) {
    const image = doc.createElement('img');
    image.alt = item.title;
    image.decoding = 'async';
    image.draggable = false;
    image.src = opened.url;
    layer.append(image);
    try {
      if (typeof image.decode === 'function') await raceAbort(image.decode(), signal);
      else await waitFor(image, { ok: ['load'], fail: ['error'], signal, ms: limits.videoReadyMs });
    } catch (error) {
      if (signal?.aborted || error?.cancelled || error?.transient) throw error;
      throw loadError('A imagem não pôde ser exibida (arquivo corrompido ou formato não suportado).', { permanent: true, code: 'decode' });
    }
    return {};
  }

  async function buildVideo(item, opened, layer, signal) {
    const video = videoPool.pop() ?? doc.createElement('video');
    video.volume = 1; video.muted = userMuted || audioBlocked; video.defaultMuted = false;
    video.playsInline = true; video.controls = false; video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.removeAttribute('muted'); video.setAttribute('playsinline', ''); video.setAttribute('aria-label', item.title);
    const listeners = [];
    const listen = (name, callback) => { video.addEventListener(name, callback); listeners.push([name, callback]); return () => video.removeEventListener(name, callback); };
    let serial = 0, released = false;
    const entry = { video, wantsPlayback: false, start };
    videoOwners.set(video, entry);
    videos.add(entry);
    function pause() { entry.wantsPlayback = false; serial++; video.pause(); }
    function release() {
      if (released) return;
      released = true;
      pause();
      for (const [name, callback] of listeners.splice(0)) video.removeEventListener(name, callback);
      videos.delete(entry);
      if (activeVideo === entry) { activeVideo = null; reportAudio(); }
      video.removeAttribute('src'); video.load(); video.remove();
      if (videoPool.length < 2) videoPool.push(video);
    }
    function start() {
      if (released) return Promise.resolve();
      // Uma promessa atrasada de play() não pode religar o áudio de um conteúdo que já saiu.
      const attempt = ++serial;
      entry.wantsPlayback = true;
      if (activeVideo && activeVideo !== entry) activeVideo.pause();
      activeVideo = entry;
      video.volume = 1; video.muted = userMuted || audioBlocked;
      reportAudio();
      const valid = () => !released && serial === attempt && entry.wantsPlayback && activeVideo === entry;
      const invoke = () => { try { return Promise.resolve(video.play()); } catch (error) { return Promise.reject(error); } };
      const settled = () => {
        if (!valid() && videoOwners.get(video) === entry && !entry.wantsPlayback) video.pause();
      };
      const audible = !video.muted;
      // Uma única tentativa muda como fallback. Bloqueio por política exige gesto, nunca repetição em temporizador.
      return invoke().catch(error => {
        if (!valid()) return;
        if (error?.name !== 'NotAllowedError') throw error;
        audioBlocked = !userMuted;
        applyAudio();
        if (!audible) throw error;
        return invoke();
      }).then(settled, error => { settled(); if (valid()) throw error; });
    }
    entry.pause = pause;
    video.src = opened.url;
    layer.append(video);
    const ready = () => waitFor(video, {
      ok: ['loadeddata', 'canplay'], fail: ['error'], signal, ms: limits.videoReadyMs,
      onFail: () => mediaFailure(video),
      onTimeout: () => { if (video.readyState >= 1) return null; throw loadError('O vídeo não ficou pronto a tempo.', { transient: true, code: 'timeout' }); }
    });
    try {
      try { await ready(); } catch (error) {
        // Há TVs que recusam o vídeo baixado (blob:) mas tocam o mesmo arquivo direto do servidor, e o contrário. Antes de desistir por decodificação,
        // a fonte oferece o outro caminho (uma vez). Cancelamento, rede e tempo esgotado seguem o fluxo de sempre.
        if (signal?.aborted || error?.code !== 'decode' || typeof opened.alternate !== 'function' || !(await opened.alternate({ signal }))) throw error;
        video.removeAttribute('src'); video.load();
        video.src = opened.url;
        await ready();
      }
    } catch (error) { release(); throw error; }
    // MOV: o aparelho pode carregar o arquivo e tocar o som sem decodificar a imagem (por exemplo HEVC sem suporte). O navegador não dá erro nesse caso,
    // só deixa a largura do vídeo em 0; sem esta conferência a TV mostraria um quadro preto com som. O conteúdo é tratado como falha de decodificação.
    if (item.type === 'video/quicktime' && !video.videoWidth) { release(); throw loadError(MEDIA_ERROR_TEXT, { permanent: true, code: 'decode' }); }
    opened.confirm?.(); // o vídeo ficou pronto por este caminho: a fonte passa a preferi-lo
    return {
      audio: entry,
      naturalMs: () => (Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : null),
      start, pause,
      restart() { pause(); video.currentTime = 0; return start(); },
      progressMs: () => Math.round((video.currentTime || 0) * 1000),
      onEnded: callback => listen('ended', callback),
      onError: callback => listen('error', () => callback(mediaFailure(video))),
      release
    };
  }

  async function buildPdf(item, opened, layer, signal) {
    const frame = doc.createElement('iframe');
    frame.title = item.title;
    frame.setAttribute('tabindex', '-1');
    frame.src = `${opened.url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`;
    layer.append(frame);
    // O visualizador de PDF do aparelho nem sempre avisa quando terminou: depois do prazo segue assim mesmo.
    await waitFor(frame, { ok: ['load'], fail: ['error'], signal, ms: limits.pdfReadyMs, onTimeout: () => null });
    return { release() { frame.src = 'about:blank'; } };
  }

  async function buildHtml(item, layer) {
    if (typeof item.render !== 'function') throw loadError('Conteúdo interno sem desenho.', { permanent: true, code: 'unsupported' });
    layer.append(item.render());
    return {};
  }

  const BUILDERS = { image: buildImage, video: buildVideo, pdf: buildPdf };

  // ---- renderer ----------------------------------------------------------------------------------------------------------------
  async function prepare(item, { signal } = {}) {
    if (item.kind !== 'html' && !BUILDERS[item.kind]) throw loadError(`Formato incompatível com este player (${item.type || 'desconhecido'}).`, { permanent: true, code: 'unsupported' });
    if (signal?.aborted) throw abortError();
    const layer = doc.createElement('div');
    layer.className = 'stage-layer is-standby';
    layer.setAttribute('data-kind', item.kind);
    layer.setAttribute('aria-hidden', 'true');
    let opened = null, parts = {};
    try {
      if (item.kind === 'html') parts = await buildHtml(item, layer);
      else {
        opened = await source.open(item, { signal });
        if (signal?.aborted) throw abortError();
        root.append(layer); // precisa estar na página para o navegador carregar e decodificar
        parts = await BUILDERS[item.kind](item, opened, layer, signal);
      }
    } catch (error) {
      parts.release?.();
      layer.remove();
      opened?.release();
      throw error;
    }
    if (!layer.parentNode) root.append(layer);

    let disposed = false;
    const prepared = {
      item, layer,
      audio: parts.audio ?? null,
      naturalMs: parts.naturalMs ?? (() => null),
      start: parts.start ?? (() => Promise.resolve()),
      pause: parts.pause ?? (() => {}),
      restart: parts.restart ?? (() => {}),
      progressMs: parts.progressMs ?? (() => null),
      onEnded: parts.onEnded ?? (() => () => {}),
      onError: parts.onError ?? (() => () => {}),
      get disposed() { return disposed; },
      dispose() {
        if (disposed) return;
        disposed = true;
        alive.delete(prepared);
        parts.release?.();
        layer.remove();
        opened?.release();
      }
    };
    alive.add(prepared);
    return prepared;
  }

  // Termina na hora o que ainda estiver se movendo (pulando para o quadro final) e solta a camada que saiu.
  function finishRun(run, jump) {
    if (run.finished) return;
    run.finished = true;
    for (const animation of run.animations) {
      try { if (jump) animation.finish(); } catch { /* já terminou */ }
      try { animation.cancel(); } catch { /* já cancelada */ }
    }
    if (run.timer !== null) clock.clearTimeout(run.timer);
    run.cancelWait?.();
    if (run.warmLayer) run.warmLayer.style.opacity = '';
    run.outgoing?.dispose();
    if (inflight === run) inflight = null;
  }

  function sampleFrames() {
    if (typeof raf !== 'function') return { stop: () => null };
    const intervals = [];
    let last = null, id = 0, stopped = false;
    const tick = time => { if (stopped) return; if (last !== null) intervals.push(time - last); last = time; id = raf(tick); };
    id = raf(tick);
    return { stop() { stopped = true; if (typeof cancelRaf === 'function') cancelRaf(id); return intervals; } };
  }

  // Espera alguns quadros do navegador (ou o teto de tempo, se ele não os entregar: aba escondida, aparelho parado). Cancelável por `run.cancelWait`.
  function waitFrames(run) {
    return new Promise(resolve => {
      let left = limits.presentFrames, pending = null, cap = null;
      const done = () => {
        if (cap !== null) clock.clearTimeout(cap);
        if (pending !== null && typeof cancelRaf === 'function') cancelRaf(pending);
        cap = pending = null;
        run.cancelWait = null;
        resolve();
      };
      const step = () => { pending = null; if (--left <= 0) done(); else pending = typeof raf === 'function' ? raf(step) : clock.setTimeout(step, 17); };
      run.cancelWait = done;
      cap = clock.setTimeout(done, limits.presentWaitMs);
      pending = typeof raf === 'function' ? raf(step) : clock.setTimeout(step, 17);
    });
  }

  const settled = animation => (animation.finished ?? new Promise(resolve => {
    animation.addEventListener('finish', resolve, { once: true });
    animation.addEventListener('cancel', resolve, { once: true });
  }));

  async function show(prepared, { effect, outgoing = null } = {}) {
    if (prepared.disposed) return { frames: null };
    // O quadro antigo continua visível durante o efeito, mas seu som termina antes de iniciar o próximo.
    if (outgoing && outgoing !== prepared) outgoing.pause();
    if (inflight) finishRun(inflight, true); // uma troca anterior ainda em andamento termina antes: a camada que sai está sempre inteira
    activeVideo = prepared.audio;
    reportAudio();
    const entering = prepared.layer, leaving = outgoing && !outgoing.disposed ? outgoing : null;
    entering.style.zIndex = String(++stacking);
    const definition = EFFECTS[effect?.name] ?? null;
    let animated = !!definition && effect.ms > 0 && typeof entering.animate === 'function';
    const run = { animations: [], outgoing: leaving, finished: false, timer: null, cancelWait: null, warmLayer: null };
    if (animated) {
      const timing = part => ({ duration: effect.ms, easing: part.easing, fill: 'both' });
      try {
        run.animations.push(entering.animate(definition.enter.keyframes, timing(definition.enter)));
        if (definition.exit && leaving && typeof leaving.layer.animate === 'function') run.animations.push(leaving.layer.animate(definition.exit.keyframes, timing(definition.exit)));
      } catch {
        // O navegador recusou a animação (aparelho antigo): a troca vira corte seco. Sem isto a camada nova ficaria escondida (tela preta).
        for (const animation of run.animations.splice(0)) { try { animation.cancel(); } catch { /* já cancelada */ } }
        animated = false;
      }
    }
    // Troca sem efeito para um vídeo: o navegador só desenha o primeiro quadro de um vídeo que está visível e não coberto por outra camada
    // (medido no Chromium: por baixo da antiga, ou a 0% de opacidade, o quadro não chega à tela). Se a camada antiga saísse no mesmo instante,
    // haveria um quadro com o fundo vazio do palco (piscada preta). Por isso a nova entra por cima, quase transparente (1%), por alguns quadros;
    // só então fica opaca e a antiga sai. Com efeito não há risco: a camada nova começa transparente ou fora da tela.
    const warmUp = !animated && !!leaving && !!entering.querySelector?.('video');
    if (warmUp) { entering.style.opacity = String(limits.warmOpacity); run.warmLayer = entering; }
    // A camada só fica visível DEPOIS de a animação começar: o primeiro quadro já é o inicial do efeito (sem "piscar").
    entering.classList.remove('is-standby');
    entering.removeAttribute('aria-hidden');
    leaving?.layer.setAttribute('aria-hidden', 'true');
    if (!animated) {
      if (warmUp) {
        inflight = run; // uma nova troca, ou limpar a tela, encerra a espera e solta a camada antiga na hora
        await waitFrames(run);
      }
      finishRun(run, false);
      return { frames: null };
    }
    inflight = run;
    run.timer = clock.setTimeout(() => finishRun(run, true), effect.ms + limits.settleGraceMs);
    const sampler = sampleFrames();
    await Promise.all(run.animations.map(animation => settled(animation).catch(() => {})));
    finishRun(run, false);
    return { frames: sampler.stop() };
  }

  function clear() {
    if (inflight) finishRun(inflight, false);
    for (const prepared of [...alive]) prepared.dispose();
    for (const layer of [...(root.querySelectorAll?.('.stage-layer') ?? [])]) layer.remove();
    stacking = 0;
  }

  return { prepare, show, clear, audioState, setMuted, activateAudio, stats: () => ({ alive: alive.size, layers: root.querySelectorAll?.('.stage-layer').length ?? alive.size }) };
}
