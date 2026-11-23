// Peças de mentira para testar o motor do carrossel sem navegador e sem esperar segundos de verdade:
// um relógio que anda quando o teste manda e um "renderer" que registra tudo o que o motor pede.
import assert from 'node:assert/strict';
import { normalizeItem } from '../../public/js/playback/model.js';
import { createCarousel } from '../../public/js/playback/carousel.js';

const flush = async () => { for (let turn = 0; turn < 60; turn++) await Promise.resolve(); };

export function createFakeClock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { id, at: now + Math.max(0, ms), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    // Anda `ms` milissegundos, disparando os prazos em ordem e deixando as promessas se resolverem entre um e outro.
    async advance(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        let next = null;
        for (const timer of timers.values()) if (timer.at <= end && (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) next = timer;
        if (!next) break;
        timers.delete(next.id);
        now = Math.max(now, next.at);
        next.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    pending: () => timers.size,
    flush
  };
}

export const transient = (message = 'rede indisponível') => Object.assign(new Error(message), { transient: true });
export const permanent = (message = 'arquivo inexistente') => Object.assign(new Error(message), { permanent: true });
export const authFailure = () => Object.assign(new Error('acesso revogado'), { auth: true, permanent: true });

// `latency(item)`: milissegundos para preparar. `failures[id]`: erro fixo, ou função (item, tentativa) → erro | null.
// `natural[id]`: duração natural do vídeo em ms. `stall`: ids de vídeos que não avançam. `frames(effect)`: amostra de quadros da transição.
export function createFakeRenderer({ clock, latency = () => 0, failures = {}, natural = {}, stall = new Set(), frames = () => null, startFailures = {}, autoEnd = true } = {}) {
  const log = [];
  const shows = []; // cada troca pedida ao renderer: { id, key, effect, ms, outgoing, at }
  const alive = new Set();
  const attempts = new Map();
  let maxLive = 0, shown = null;

  function makePrepared(item) {
    const listeners = { ended: new Set(), error: new Set() };
    let startedAt = null, base = 0, paused = true, disposed = false, startCalls = 0, endTimer = null;
    const duration = natural[item.id] ?? null;
    // Como um vídeo de verdade: ao tocar, avisa "terminou" quando chega ao fim (a menos que o teste peça que nunca termine).
    const scheduleEnd = () => {
      if (endTimer !== null) clock.clearTimeout(endTimer);
      endTimer = null;
      if (duration === null || !autoEnd || stall.has(item.id)) return;
      endTimer = clock.setTimeout(() => { endTimer = null; base = duration; paused = true; log.push(['ended', item.key]); prepared.fireEnded(); }, Math.max(0, duration - base));
    };
    const prepared = {
      item,
      naturalMs: () => duration,
      async start() {
        startCalls++;
        const failure = startFailures[item.id];
        if (failure && startCalls <= failure.times) throw failure.error ?? new Error('autoplay bloqueado');
        log.push(['start', item.key]);
        if (paused) { paused = false; startedAt = clock.now(); scheduleEnd(); }
      },
      pause() {
        if (!paused) { base += clock.now() - startedAt; paused = true; if (endTimer !== null) { clock.clearTimeout(endTimer); endTimer = null; } log.push(['pause', item.key]); }
      },
      restart() { base = 0; startedAt = clock.now(); paused = false; scheduleEnd(); log.push(['restart', item.key]); },
      progressMs() {
        if (item.kind !== 'video') return null;
        if (stall.has(item.id)) return base;
        return base + (paused || startedAt === null ? 0 : clock.now() - startedAt);
      },
      onEnded(callback) { listeners.ended.add(callback); return () => listeners.ended.delete(callback); },
      onError(callback) { listeners.error.add(callback); return () => listeners.error.delete(callback); },
      dispose() {
        if (disposed) throw new Error(`dispose duplo de ${item.key}`);
        disposed = true; alive.delete(prepared); log.push(['dispose', item.key]);
        if (endTimer !== null) { clock.clearTimeout(endTimer); endTimer = null; }
      },
      // ações do teste
      fireEnded() { for (const callback of [...listeners.ended]) callback(); },
      fireError(error = new Error('erro de decodificação')) { for (const callback of [...listeners.error]) callback(error); },
      // Quantos avisos (fim e erro do vídeo) o motor ainda está ouvindo neste conteúdo.
      get listeners() { return listeners.ended.size + listeners.error.size; },
      get disposed() { return disposed; }
    };
    return prepared;
  }

  return {
    log, alive, shows,
    preparedOf: id => [...alive].find(prepared => prepared.item.id === id),
    get live() { return alive.size; },
    get maxLive() { return maxLive; },
    get shown() { return shown; },
    count: (type, key) => log.filter(entry => entry[0] === type && (key === undefined || entry[1] === key)).length,
    async prepare(item, { signal }) {
      const attempt = (attempts.get(item.key) ?? 0) + 1;
      attempts.set(item.key, attempt);
      log.push(['prepare', item.key, attempt]);
      const wait = latency(item, attempt);
      if (wait) {
        await new Promise((resolve, reject) => {
          const id = clock.setTimeout(resolve, wait);
          signal.addEventListener('abort', () => { clock.clearTimeout(id); reject(Object.assign(new Error('abortado'), { name: 'AbortError' })); }, { once: true });
        });
      }
      if (signal.aborted) throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      const failure = typeof failures[item.id] === 'function' ? failures[item.id](item, attempt) : failures[item.id];
      if (failure) throw failure;
      const prepared = makePrepared(item);
      alive.add(prepared);
      maxLive = Math.max(maxLive, alive.size);
      return prepared;
    },
    async show(prepared, { effect, outgoing }) {
      log.push(['show', prepared.item.key, effect.name, effect.ms, outgoing?.item.key ?? null]);
      shows.push({ id: prepared.item.id, key: prepared.item.key, effect: effect.name, ms: effect.ms, outgoing: outgoing?.item.id ?? null, at: clock.now() });
      shown = prepared;
      if (effect.ms) await new Promise(resolve => clock.setTimeout(resolve, effect.ms));
      if (outgoing && !outgoing.disposed) outgoing.dispose();
      return { frames: frames(effect) };
    },
    clear() {
      log.push(['clear']);
      for (const prepared of [...alive]) prepared.dispose();
      shown = null;
    }
  };
}

// Item como chega do servidor, já normalizado.
export function make(id, extra = {}, index = 0) {
  const { type = 'image/png', duration = 10, ...rest } = extra;
  return normalizeItem({ id, title: id.toUpperCase(), type, url: `/api/media/${id}/file`, duration, ...rest }, index);
}
export const sequence = specs => specs.map((spec, index) => (Array.isArray(spec) ? make(spec[0], spec[1], index) : make(spec, {}, index)));

// Armazenamento de mentira com a interface { get, set, remove }.
export function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { get: key => data.get(key) ?? null, set: (key, value) => { data.set(key, String(value)); }, remove: key => { data.delete(key); }, data };
}

// ---- montagem pronta para os testes do motor ---------------------------------------------------------------------------------------
export const WALL_START = 5_000_000;

// `renderer`: opções do renderer de mentira. `carousel`: opções extras do motor. Tudo anda no relógio de mentira.
export function rig({ renderer: rendererOptions = {}, carousel: options = {} } = {}) {
  const clock = createFakeClock();
  const renderer = createFakeRenderer({ clock, ...rendererOptions });
  const events = [];
  const carousel = createCarousel({ renderer, clock, wallClock: () => WALL_START + clock.now(), onEvent: event => events.push(event), ...options });
  // Qualquer promessa rejeitada sem tratamento (por exemplo, soltar o mesmo conteúdo duas vezes) reprova o teste.
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(String(reason?.message ?? reason));
  process.on('unhandledRejection', onUnhandled);
  return {
    clock, renderer, carousel, events,
    of: type => events.filter(event => event.type === type),
    // [id, instante] de cada conteúdo que entrou na tela
    timeline: () => renderer.shows.map(show => [show.id, show.at]),
    ids: () => renderer.shows.map(show => show.id),
    // Encerra e confere que nada ficou para trás: sem conteúdo vivo, sem prazo pendente, sem nova atividade e sem erro interno.
    async close() {
      carousel.stop();
      await clock.advance(0);
      const before = renderer.log.length, eventsBefore = events.length;
      await clock.advance(180_000);
      assert.equal(renderer.alive.size, 0, 'nenhum conteúdo vivo depois de parar');
      assert.equal(clock.pending(), 0, 'nenhum prazo pendente depois de parar');
      assert.equal(renderer.log.length, before, 'nada novo é pedido ao renderer depois de parar');
      assert.deepEqual(events.slice(eventsBefore).map(event => event.type), [], 'nenhum evento depois de parar');
      assert.deepEqual(events.filter(event => event.type === 'error'), [], 'nenhum erro interno do motor');
      await new Promise(resolve => setImmediate(resolve));
      process.off('unhandledRejection', onUnhandled);
      assert.deepEqual(unhandled, [], 'nenhuma promessa rejeitada sem tratamento');
    }
  };
}
