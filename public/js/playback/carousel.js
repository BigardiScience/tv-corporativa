// Motor do carrossel: decide QUAL conteúdo aparece, QUANDO ele sai, COMO a troca acontece e o que fazer quando algo dá errado.
// É o mesmo motor no player da TV e na pré-visualização do painel; o que muda é só quem desenha (renderer) e quem baixa (loader).
//
// O motor não conhece DOM, rede nem armazenamento: recebe tudo por injeção (renderer, relógio, memória). Por isso o tempo, a ordem,
// a repetição, as falhas e a recuperação são testados em Node, com um relógio de mentira, sem esperar segundos de verdade.
//
// Contrato do renderer:
//   prepare(item, { signal }) → Promise<Prepared>   baixa e decodifica ANTES de aparecer (nunca mostra tela vazia)
//   show(prepared, { effect, outgoing }) → Promise<{ frames }>   troca na tela; resolve quando a transição termina
//   clear()                                          solta tudo
// Prepared: item · naturalMs() · start() · pause() · restart() · progressMs() · onEnded(cb) · onError(cb) · dispose()
//
// Estados (`snapshot().state`): idle (nada carregado) · loading (preparando o primeiro conteúdo) · running · finished (a sequência
// acabou e não repete; o último conteúdo continua na tela) · unavailable (nenhum conteúdo pôde ser exibido; tenta de novo sozinho) ·
// stopped (parado pelo player, por exemplo sem conexão).
import { dwellPlan, pickPlayable, retryDelay, wrapIndex } from './timing.js';
import { resolveEffect, judgeFrames } from './effects.js';
import { sequenceSignature } from './model.js';
import { loadProgress, saveProgress, clearProgress } from './recovery.js';

export const systemClock = () => ({
  now: () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: id => globalThis.clearTimeout(id)
});

export const DEFAULT_TIMING = Object.freeze({
  prepareWaitMs: 120000,     // quanto esperar um conteúdo ficar pronto antes de desistir dele (o atual continua na tela enquanto isso)
  blockMs: 30000,            // quanto tempo um conteúdo que falhou fica de fora (ele volta a ser tentado depois)
  unavailableRetryMs: 10000, // com nada para exibir, de quanto em quanto tempo tentar de novo
  stallMs: 15000,            // vídeo sem avançar por tanto tempo é considerado travado
  watchEveryMs: 1000,
  autoplayRetryMs: 400
});

const cancelled = () => Object.assign(new Error('cancelado'), { name: 'AbortError', cancelled: true });

export function createCarousel({
  renderer, clock = systemClock(), wallClock = () => Date.now(), tiers = null, capability = {}, storage = null, random = () => 0.5,
  retry = { attempts: 3, delaysMs: [1000, 3000] }, timing = {}, onEvent = () => {}
}) {
  const limits = { ...DEFAULT_TIMING, ...timing };
  const reducedMotion = () => (capability.reducedMotion ? !!capability.reducedMotion() : false);
  const animations = () => (capability.animations ? !!capability.animations() : true);
  const tierNow = () => (tiers ? tiers.tier() : 'full');

  let items = [], loop = true, signature = '';
  let index = -1, current = null, state = 'idle', playing = true, generation = 0, cycles = 0;
  let heading = null;     // posição para onde uma troca em andamento está indo (vários toques em "Próximo" andam de um em um)
  let inflight = null;    // troca em andamento: { my, auto } (auto = decidida pelo tempo, não por um toque da pessoa)
  let recovering = false; // a exibição ficou sem conteúdo ("unavailable") e ainda não voltou
  let resumeHint = null, unavailableTimer = null, destroyed = false;
  const standby = new Map(); // índice → { promise, abort, cancelled, awaited, reported }: conteúdos sendo preparados com antecedência
  const blocked = new Map(); // índice → instante (relógio do motor) em que volta a ser tentado

  const emit = event => { try { onEvent(event); } catch { /* uma falha na tela nunca derruba a exibição */ } };
  // Fluxos assíncronos soltos nunca deixam uma exceção escapar: viram um evento de erro.
  const spawn = promise => { promise.catch(error => emit({ type: 'error', error: String(error?.message ?? error) })); };
  const isBlocked = position => (blocked.get(position) ?? 0) > clock.now();
  const block = position => blocked.set(position, clock.now() + limits.blockMs);
  const setState = (next, extra = {}) => { if (state !== next) { state = next; emit({ type: 'state', state, playing, ...extra }); } };
  const cancelUnavailableRetry = () => { if (unavailableTimer !== null) { clock.clearTimeout(unavailableTimer); unavailableTimer = null; } };
  const settle = () => { heading = null; inflight = null; };

  // ---- tempo do conteúdo em exibição ---------------------------------------------------------------------------------------------
  const elapsedOf = cur => cur.elapsed + (cur.startedAt === null ? 0 : clock.now() - cur.startedAt);

  function clearTimers(cur) {
    if (!cur) return;
    if (cur.timer !== null) { clock.clearTimeout(cur.timer); cur.timer = null; }
    if (cur.watch !== null) { clock.clearTimeout(cur.watch); cur.watch = null; }
    if (cur.retryTimer != null) { clock.clearTimeout(cur.retryTimer); cur.retryTimer = null; }
  }

  // Liga os prazos do conteúdo na tela. Não faz nada se a exibição está pausada ou se uma troca já está em andamento ("parked").
  function arm(cur) {
    clearTimers(cur);
    if (cur !== current || cur.parked || !playing || state !== 'running') return;
    if (cur.startedAt === undefined || cur.startedAt === null) cur.startedAt = clock.now();
    const target = cur.plan.ms ?? cur.plan.capMs;
    if (target !== null) cur.timer = clock.setTimeout(() => { if (cur === current) advance('time'); }, Math.max(0, target - elapsedOf(cur)));
    if (cur.item.kind === 'video') watchVideo(cur);
  }

  // Vídeo que para de avançar (rede, decodificação, aparelho) não pode prender o carrossel.
  function watchVideo(cur) {
    let last = cur.prepared.progressMs?.() ?? null, lastAt = clock.now();
    const tick = () => {
      if (cur !== current || cur.parked || !playing || state !== 'running') return;
      const position = cur.prepared.progressMs?.() ?? null;
      if (position !== last) { last = position; lastAt = clock.now(); }
      else if (clock.now() - lastAt >= limits.stallMs && !cur.ended) { failCurrent('stalled', new Error('O vídeo parou de avançar.')); return; }
      cur.watch = clock.setTimeout(tick, limits.watchEveryMs);
    };
    cur.watch = clock.setTimeout(tick, limits.watchEveryMs);
  }

  function startMedia(cur, attempt = 0, restart = false) {
    if (cur.item.kind !== 'video' || cur.parked) return;
    let started;
    try { started = Promise.resolve(restart ? cur.prepared.restart() : cur.prepared.start()); } catch (error) { started = Promise.reject(error); }
    started.catch(error => {
      if (cur !== current || cur.parked || !playing || state !== 'running') return;
      // O palco já tentou uma vez sem som. Política de autoplay precisa de interação, não de recarregamentos ou repetição.
      if (error?.name === 'NotAllowedError') {
        pause();
        emit({ type: 'autoplay-blocked', index, item: cur.item });
        return;
      }
      if (attempt === 0) cur.retryTimer = clock.setTimeout(() => { cur.retryTimer = null; if (cur === current && !cur.parked && playing) startMedia(cur, 1); }, limits.autoplayRetryMs);
      else failCurrent('autoplay', error);
    });
  }

  function startDwell(cur, effectMs) {
    cur.minHoldMs = effectMs;
    cur.plan = dwellPlan(cur.item, { naturalMs: cur.prepared.naturalMs?.() ?? null, transitionMs: effectMs });
    cur.elapsed = 0; cur.startedAt = null; cur.ended = false; cur.parked = false;
    cur.unsubscribe = [
      cur.prepared.onEnded?.(() => onEnded(cur)) ?? (() => {}),
      cur.prepared.onError?.(error => { if (cur === current) failCurrent('media-error', error); }) ?? (() => {})
    ];
    arm(cur);
  }

  function onEnded(cur) {
    if (cur !== current) return;
    cur.prepared.pause();
    cur.ended = true;
    if (state !== 'running') return;
    // Terminou: avança já, mas só depois que a transição de entrada acabou (duas transições nunca se sobrepõem).
    cur.plan = { ...cur.plan, ms: Math.max(elapsedOf(cur), cur.minHoldMs), capMs: null };
    arm(cur);
  }

  // ---- avançar -------------------------------------------------------------------------------------------------------------------
  function advance(reason) {
    if (state !== 'running' || !current) return;
    if (reason !== 'failure' && items.length === 1) {
      if (!loop) { finish(); return; }
      restartCurrent(); // um único conteúdo repetindo: recomeça no lugar, sem transição
      return;
    }
    const next = items.length === 1 ? 'none' : pickPlayable(index, items.length, loop, isBlocked);
    if (next === 'end') { finish(); return; }
    if (next === 'none') {
      if (reason === 'failure') { // o que está na tela falhou e não há outro: não fica uma imagem quebrada, mostra o aviso
        clearTimers(current); dropStandby(); renderer.clear(); current = null; index = -1;
        enterUnavailable();
      } else restartCurrent(); // os outros estão bloqueados: continua com o que está na tela
      return;
    }
    if (next <= index) cycles++;
    spawn(goto(next, { reason }));
  }

  function restartCurrent() {
    const cur = current;
    clearTimers(cur);
    cur.elapsed = 0; cur.startedAt = null; cur.ended = false; cur.parked = false;
    cur.plan = dwellPlan(cur.item, { naturalMs: cur.prepared.naturalMs?.() ?? null, transitionMs: 0 });
    cycles++;
    emit({ type: 'cycle', cycles, index });
    if (cur.item.kind === 'video' && playing) startMedia(cur, 0, true);
    arm(cur);
  }

  function finish() {
    clearTimers(current);
    current?.prepared.pause();
    setState('finished');
    emit({ type: 'finished', index });
  }

  function failCurrent(reason, error) {
    if (!current || current.stale) return;
    const failedIndex = index;
    block(failedIndex);
    emit({ type: 'skip', index: failedIndex, item: items[failedIndex], reason, error: String(error?.message ?? error ?? '') });
    advance('failure');
  }

  // ---- preparar conteúdos ---------------------------------------------------------------------------------------------------------
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const id = clock.setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clock.clearTimeout(id); reject(cancelled()); }, { once: true });
    });
  }

  async function prepareWithRetry(item, signal) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await renderer.prepare(item, { signal });
      } catch (error) {
        if (signal.aborted) throw cancelled();
        if (error?.auth) { emit({ type: 'auth' }); throw error; }
        if (error?.permanent || attempt >= retry.attempts - 1) throw error;
        emit({ type: 'retry', item, attempt: attempt + 1, reason: String(error?.message ?? '') });
        await sleep(retryDelay(attempt, { delaysMs: retry.delaysMs, random }), signal);
      }
    }
  }

  function reportFailure(entry, error) {
    if (entry.reported) return;
    entry.reported = true;
    if (standby.get(entry.position) === entry) standby.delete(entry.position);
    block(entry.position);
    emit({ type: 'skip', index: entry.position, item: items[entry.position], reason: error?.auth ? 'auth' : (error?.code ?? 'load-failed'), error: String(error?.message ?? '') });
  }

  function startPrepare(position) {
    const abort = new AbortController();
    const entry = { position, abort, cancelled: false, awaited: false, reported: false, prepared: null, promise: null };
    entry.promise = prepareWithRetry(items[position], abort.signal).then(prepared => {
      entry.prepared = prepared;
      if (entry.cancelled) { entry.prepared = null; prepared?.dispose?.(); } // ficou pronto depois de descartado: solta agora
      return prepared;
    });
    entry.promise.catch(error => {
      // Falhou ainda no pré-carregamento (ninguém esperava por ele): sai da fila, fica de fora por um tempo e o seguinte já começa a ser preparado.
      if (entry.cancelled || entry.awaited || destroyed) return;
      reportFailure(entry, error);
      if (state === 'running' && heading === null) preloadNext();
    });
    standby.set(position, entry);
    return entry;
  }

  // Descarta um preparo que não será usado. Se o conteúdo já chegou, é solto agora (uma vez só); se ainda está a caminho, é solto ao chegar.
  function discard(entry) {
    if (entry.cancelled) return;
    entry.cancelled = true;
    entry.abort.abort();
    if (entry.prepared) { const prepared = entry.prepared; entry.prepared = null; prepared.dispose?.(); }
  }

  function dropStandby(except = -1) {
    for (const [position, entry] of [...standby]) {
      if (position === except) continue;
      standby.delete(position);
      discard(entry);
    }
  }

  function waitFor(promise, ms) {
    return new Promise((resolve, reject) => {
      const id = clock.setTimeout(() => reject(Object.assign(new Error('O conteúdo demorou demais para ficar pronto.'), { code: 'timeout' })), ms);
      promise.then(value => { clock.clearTimeout(id); resolve(value); }, error => { clock.clearTimeout(id); reject(error); });
    });
  }

  // Entrega o conteúdo pronto (e passa a ser dono dele) ou null. Uma troca que já ficou para trás NÃO descarta o que preparou: outra troca
  // pode estar esperando pelo mesmo conteúdo, e o que sobrar na fila é solto por dropStandby().
  async function obtain(position, my) {
    const entry = standby.get(position) ?? startPrepare(position);
    entry.awaited = true;
    try {
      const prepared = await waitFor(entry.promise, limits.prepareWaitMs);
      if (my !== generation || entry.cancelled) return null;
      standby.delete(position);
      entry.prepared = null; // a partir daqui o conteúdo é de quem pediu
      return prepared;
    } catch (error) {
      if (standby.get(position) === entry) standby.delete(position);
      if (!entry.cancelled) discard(entry);
      if (my !== generation) return null;
      reportFailure(entry, error);
      return null;
    }
  }

  // Prepara o próximo conteúdo enquanto o atual está na tela (pré-carregamento): quando chegar a hora, a troca é imediata.
  function preloadNext() {
    if (items.length < 2) { dropStandby(); return; }
    const next = pickPlayable(index, items.length, loop, isBlocked);
    dropStandby(typeof next === 'number' ? next : -1);
    if (typeof next === 'number' && !standby.has(next)) startPrepare(next);
  }

  // ---- ir para um conteúdo ---------------------------------------------------------------------------------------------------------
  async function goto(target, { first = false, manual = false } = {}) {
    const my = ++generation;
    inflight = { my, auto: !manual && !first };
    if (current) {
      current.elapsed = elapsedOf(current); current.startedAt = null;
      clearTimers(current); current.parked = true;
      current.prepared.pause(); // preserva o último quadro, sem continuar o som enquanto espera o próximo
    }
    cancelUnavailableRetry();
    let position = wrapIndex(target, items.length);
    for (let tried = 0; tried < items.length; tried++) {
      if (manual && tried === 0) blocked.delete(position);
      heading = position;
      const prepared = await obtain(position, my);
      if (my !== generation) { prepared?.dispose?.(); return; }
      if (prepared) { await commit(position, prepared, { first }, my); return; }
      const next = pickPlayable(position, items.length, loop || manual, isBlocked);
      if (next === 'end' || next === 'none' || (current && !current.stale && next === index)) break; // voltou ao que já está na tela
      position = next;
    }
    if (my !== generation) return;
    settle();
    if (current && !current.stale) { // nenhum outro ficou pronto: o que está na tela continua e volta a contar o tempo
      current.parked = false;
      current.elapsed = 0; current.startedAt = null;
      arm(current);
      if (playing) startMedia(current);
      return;
    }
    // Nada pode ser exibido (ou o que está na tela pertence a uma programação que já foi trocada): tela limpa e aviso.
    dropStandby();
    if (current) { clearTimers(current); renderer.clear(); current = null; index = -1; }
    enterUnavailable();
  }

  function enterUnavailable() {
    recovering = true;
    setState('unavailable');
    emit({ type: 'unavailable' });
    cancelUnavailableRetry();
    unavailableTimer = clock.setTimeout(() => {
      unavailableTimer = null;
      if (state !== 'unavailable') return;
      blocked.clear();
      spawn(goto(0, { first: true }));
    }, limits.unavailableRetryMs);
  }

  async function commit(position, prepared, { first }, my) {
    const item = items[position], previous = current;
    clearTimers(previous);
    previous?.unsubscribe?.forEach(unsubscribe => unsubscribe());
    const effect = resolveEffect({
      requested: first || !previous ? 'cut' : item.transition, ms: item.transitionMs,
      tier: tierNow(), reducedMotion: reducedMotion(), animations: animations()
    });
    index = position;
    const cur = { prepared, item, index: position, effect, elapsed: 0, startedAt: null, timer: null, watch: null, plan: null, minHoldMs: 0, ended: false, parked: true, stale: false, unsubscribe: [] };
    current = cur;
    settle();
    blocked.delete(position);
    setState('running');
    if (recovering) { recovering = false; emit({ type: 'recovered' }); }
    emit({ type: 'change', index: position, item, effect, previous: previous?.item ?? null });
    saveProgress(storage, { signature, index: position, at: wallClock() });
    let showing;
    try { showing = renderer.show(prepared, { effect, outgoing: previous?.prepared ?? null }); } catch (error) { showing = Promise.reject(error); }
    startDwell(cur, effect.ms);
    if (playing) startMedia(cur);
    preloadNext();
    let result = null;
    try { result = await showing; } catch (error) {
      emit({ type: 'skip', index: position, item, reason: 'transition-failed', error: String(error?.message ?? '') });
      try { previous?.prepared?.dispose?.(); } catch { /* já solto */ } // o conteúdo que saiu não pode ficar preso se a troca falhou
    }
    if (my !== generation || destroyed) return;
    if (result?.frames && tiers) {
      const lowered = tiers.report(judgeFrames(result.frames));
      if (lowered) emit({ type: 'tier', tier: lowered });
    }
  }

  // ---- interface pública -----------------------------------------------------------------------------------------------------------
  // Define a sequência. Se for a mesma que já está tocando, não faz nada (a TV consulta a programação a cada poucos segundos).
  function load(list, { loop: nextLoop = true, resumeIndex = null } = {}) {
    if (destroyed) return 'destroyed';
    const nextSignature = sequenceSignature(list);
    if (nextSignature === signature && state !== 'stopped') { setLoop(nextLoop); return 'unchanged'; }
    items = list; signature = nextSignature; loop = nextLoop; blocked.clear();
    dropStandby();
    ++generation;
    settle();
    cancelUnavailableRetry();
    if (!items.length) {
      clearTimers(current);
      renderer.clear();
      current = null; index = -1; recovering = false;
      setState('idle');
      emit({ type: 'empty' });
      return 'empty';
    }
    let start = 0;
    const hint = resumeHint; resumeHint = null;
    if (Number.isInteger(resumeIndex) && resumeIndex >= 0 && resumeIndex < items.length) start = resumeIndex;
    else if (hint && hint.signature === nextSignature && hint.index < items.length) start = hint.index;
    else if (!current) start = loadProgress(storage, nextSignature, { now: wallClock(), count: items.length }) ?? 0;
    const same = current && current.item.id === items[start].id && current.item.url === items[start].url && current.item.type === items[start].type;
    if (same) { // o conteúdo na tela continua sendo o primeiro da nova sequência: segue sem refazer a troca
      const restartFinished = state === 'finished', resumeParked = current.parked;
      clearTimers(current);
      current.unsubscribe.forEach(unsubscribe => unsubscribe());
      index = start; current.index = start; current.item = items[start]; current.stale = false;
      setState('running');
      startDwell(current, 0);
      if (playing && (restartFinished || resumeParked)) startMedia(current, 0, restartFinished);
      preloadNext();
      return 'adopted';
    }
    if (current) current.stale = true; // o que está na tela é da programação anterior
    else setState('loading');
    spawn(goto(start, { first: !current }));
    return 'started';
  }

  function setLoop(next) {
    if (next === loop) return;
    loop = next;
    if (state === 'finished' && loop) { setState('running'); spawn(goto(0, {})); } else if (state === 'running' && heading === null) preloadNext();
  }

  function pause() {
    if (!playing) return;
    playing = false;
    // Uma troca decidida pelo tempo, ainda esperando o próximo conteúdo ficar pronto, é cancelada: pausar é parar onde está.
    // O conteúdo preparado fica guardado e, ao retomar, a troca acontece na hora.
    if (inflight?.auto && inflight.my === generation && current && !current.stale) {
      ++generation;
      settle();
      current.parked = false;
    }
    if (current) {
      current.elapsed = elapsedOf(current); current.startedAt = null;
      clearTimers(current);
      try { current.prepared.pause(); } catch { /* ignorado */ }
    }
    emit({ type: 'state', state, playing });
  }

  function play() {
    if (playing && state !== 'finished') return;
    playing = true;
    if (state === 'finished') { setState('running'); spawn(goto(0, {})); emit({ type: 'state', state, playing }); return; }
    if (current) { current.startedAt = null; arm(current); startMedia(current); }
    emit({ type: 'state', state, playing });
  }

  const toggle = () => { if (playing && state !== 'finished') pause(); else play(); };

  function step(delta) {
    if (!items.length || destroyed || state === 'unavailable' || state === 'idle' || state === 'loading' || state === 'stopped') return;
    if (items.length === 1) { if (current) restartCurrent(); return; }
    if (state === 'finished') setState('running');
    const from = heading ?? index;
    spawn(goto(wrapIndex(from + delta, items.length), { manual: true }));
  }

  function goTo(position) {
    if (!items.length || destroyed || state === 'stopped' || state === 'idle' || !Number.isInteger(position)) return;
    const target = wrapIndex(position, items.length);
    if (current && !current.stale && target === index && heading === null) { // tocar no que já está na tela: recomeça este conteúdo
      if (state === 'finished') setState('running');
      restartCurrent();
      return;
    }
    if (state === 'finished') setState('running');
    spawn(goto(target, { manual: true }));
  }

  // `remember`: a exibição foi interrompida por uma queda de conexão; ao receber a mesma programação de novo, retoma deste conteúdo.
  function stop({ remember = false } = {}) {
    const wasStopped = state === 'stopped';
    ++generation;
    settle();
    recovering = false;
    // Parar de novo uma exibição que já estava parada (queda de conexão que se repete) não pode apagar o ponto a retomar.
    if (remember) resumeHint = signature && index >= 0 ? { signature, index } : (wasStopped ? resumeHint : null);
    else resumeHint = null;
    if (!remember) clearProgress(storage);
    clearTimers(current);
    current?.unsubscribe.forEach(unsubscribe => unsubscribe());
    cancelUnavailableRetry();
    dropStandby();
    renderer.clear();
    current = null; index = -1; items = []; signature = ''; // depois de parar, a mesma sequência é aceita de novo por load()
    setState('stopped');
  }

  // Encerrar a página (ou a pré-visualização) não apaga a posição guardada: é ela que permite retomar depois de uma recarga.
  function destroy() { stop({ remember: true }); destroyed = true; }

  function progress() {
    if (state === 'finished') return 1;
    if (!current?.plan) return null;
    const elapsed = elapsedOf(current);
    if (current.plan.ms !== null) return Math.min(1, elapsed / current.plan.ms);
    const natural = current.prepared.naturalMs?.() ?? null, position = current.prepared.progressMs?.() ?? null;
    return natural && position !== null ? Math.min(1, position / natural) : null;
  }

  function snapshot() {
    const shown = current && !current.stale;
    return {
      state, playing, count: items.length, index: shown ? index : -1, item: shown ? current.item : null, loop, tier: tierNow(),
      effect: shown ? current.effect : null, cycles, elapsedMs: shown ? elapsedOf(current) : 0, dwellMs: shown ? (current.plan?.ms ?? null) : null,
      progress: shown ? progress() : null
    };
  }

  return {
    load, play, pause, toggle, next: () => step(1), previous: () => step(-1), goTo,
    stop, destroy, snapshot, progress, setLoop
  };
}
