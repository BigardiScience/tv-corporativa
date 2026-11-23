// Navegador de mentira com o que a tela do carrossel usa: imagens que decodificam (ou não), vídeos que carregam, tocam e terminam,
// PDFs em iframe e animações (Web Animations) que o teste faz andar. Aproveita o DOM de teste do painel (fake-dom.mjs).
//
// Não é um navegador: o desenho real, o desempenho e os codecs são validados no Chromium (tests/e2e) e em TV de verdade.
import { installFakeDom, FakeEvent } from './fake-dom.mjs';

export class FakeAnimation {
  constructor(target, keyframes, options) {
    this.target = target;
    this.keyframes = keyframes;
    this.options = options;
    this.playState = 'running';
    this.finished = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.finished.catch(() => {});
  }
  finish() { if (this.playState === 'running') { this.playState = 'finished'; this.resolve(this); } }
  cancel() {
    if (this.playState === 'running') { this.playState = 'canceled'; this.reject(Object.assign(new Error('cancelada'), { name: 'AbortError' })); }
    else this.playState = 'canceled';
  }
}

const domError = (name, message = name) => Object.assign(new Error(message), { name });

// `scripts[id]` define o que acontece com cada conteúdo (id do item):
//   imagem ... { decode: 'ok' | 'fail' | 'hang' }
//   vídeo .... { duration: segundos, error: 1..4, hang: true, readyState, videoWidth (0 = carrega e toca o som, mas não decodifica a imagem), autoplay: 'blocked' | 'blocked-once' | 'blocked-audible', play: fn(video) }
//   pdf ...... { load: false } (o visualizador nunca avisa)
// `refuseBlobVideo`: código de erro (1..4) com que o aparelho recusa QUALQUER vídeo carregado por um endereço blob: (TVs que não tocam o arquivo baixado).
// Endereços de vídeo direto do servidor (/api/media/<id>/file?t=…) usam o roteiro do id, como fake://<id>. `videoSources` guarda cada endereço dado ao <video>.
export function createMediaEnvironment({ clock, scripts = {}, animations = true, refuseBlobVideo = 0 } = {}) {
  const { document, restore } = installFakeDom();
  const log = [];
  const videoSources = [];
  const animationList = [];
  const originalCreate = document.createElement.bind(document);
  const scriptOf = element => {
    const src = element.getAttribute('src') ?? element.srcValue ?? element.src ?? '';
    const match = /fake:\/\/([^#]*)/.exec(src) ?? /^\/api\/media\/([^/?#]+)\/file\?t=/.exec(src);
    return { id: match?.[1] ?? '', ...(scripts[match?.[1]] ?? {}) };
  };

  function enhance(element) {
    const tag = element.localName;
    element.append = (...nodes) => { for (const node of nodes) element.appendChild(node); };
    if (animations) {
      element.animate = (keyframes, options) => {
        const animation = new FakeAnimation(element, keyframes, options);
        animation.hadStandby = element.classList.contains('is-standby');
        animationList.push(animation);
        log.push(['animate', element.getAttribute('data-kind') ?? tag, animation.hadStandby]);
        return animation;
      };
    }
    if (tag === 'img') {
      element.decode = () => {
        const { decode = 'ok' } = scriptOf(element);
        log.push(['decode', scriptOf(element).id]);
        if (decode === 'fail') return Promise.reject(domError('EncodingError', 'imagem inválida'));
        if (decode === 'hang') return new Promise(() => {});
        return Promise.resolve();
      };
    }
    if (tag === 'video') {
      let src = '', plays = 0, muted = false;
      Object.assign(element, { duration: NaN, currentTime: 0, readyState: 0, error: null, paused: true, plays: 0, pauses: 0, loads: 0, videoWidth: 0, videoHeight: 0 });
      // Como no navegador de verdade: `muted` é o estado atual do som e NÃO acompanha o atributo `muted` (que é só o valor inicial, `defaultMuted`).
      // Sem isto, escrever o atributo escondia um vídeo que ficou com som.
      Object.defineProperty(element, 'muted', { configurable: true, get: () => muted, set: value => { muted = Boolean(value); } });
      Object.defineProperty(element, 'defaultMuted', {
        configurable: true,
        get: () => element.hasAttribute('muted'),
        set: value => { if (value) element.setAttribute('muted', ''); else element.removeAttribute('muted'); }
      });
      Object.defineProperty(element, 'src', {
        configurable: true,
        get: () => src,
        set(value) {
          src = String(value);
          element.srcValue = src;
          videoSources.push(src);
          element.currentTime = 0; element.error = null; element.duration = NaN;
          const script = scriptOf(element);
          queueMicrotask(() => {
            if (refuseBlobVideo && src.startsWith('blob:')) { element.error = { code: refuseBlobVideo }; element.dispatchEvent(new FakeEvent('error')); return; }
            if (script.hang) { if (script.readyState !== undefined) element.readyState = script.readyState; return; }
            if (script.error) { element.error = { code: script.error }; element.dispatchEvent(new FakeEvent('error')); return; }
            element.videoWidth = script.videoWidth ?? 640; element.videoHeight = element.videoWidth ? 360 : 0;
            element.duration = script.duration ?? 10;
            element.readyState = script.readyState ?? 2;
            element.dispatchEvent(new FakeEvent('loadeddata'));
          });
        }
      });
      element.play = () => {
        const script = scriptOf(element);
        plays++; element.plays = plays;
        log.push(['play', script.id, element.muted, element.volume]);
        if (script.play) return script.play(element);
        if (script.autoplay === 'blocked' || (script.autoplay === 'blocked-once' && plays === 1) || (script.autoplay === 'blocked-audible' && !element.muted)) return Promise.reject(domError('NotAllowedError', 'autoplay bloqueado'));
        element.paused = false;
        return Promise.resolve();
      };
      element.pause = () => { log.push(['pause', scriptOf(element).id]); element.paused = true; element.pauses++; };
      element.load = () => { element.loads++; element.readyState = 0; };
      const remove = element.removeAttribute.bind(element);
      element.removeAttribute = name => { if (name === 'src') src = ''; remove(name); };
    }
    if (tag === 'iframe') {
      let src = '';
      Object.defineProperty(element, 'src', {
        configurable: true,
        get: () => src,
        set(value) {
          src = String(value);
          element.srcValue = src;
          if (scriptOf(element).load !== false && src !== 'about:blank') queueMicrotask(() => element.dispatchEvent(new FakeEvent('load')));
        }
      });
    }
    return element;
  }
  document.createElement = tag => enhance(originalCreate(tag));
  const root = enhance(document.createElement('div'));
  document.body.appendChild(root);

  const opened = [], released = [];
  const source = {
    opened, released, forgets: 0,
    async open(item) {
      const script = scripts[item.id] ?? {};
      if (script.openError) throw script.openError;
      const url = `fake://${item.id}`;
      opened.push(url);
      return { url, release: () => released.push(url) };
    },
    forget() { source.forgets++; }
  };

  return {
    document, root, source, log, videoSources, animations: animationList, restore,
    // Em vez do relógio do navegador: quadros a cada 16 ms do relógio de mentira.
    raf: callback => clock.setTimeout(() => callback(clock.now()), 16),
    cancelRaf: id => clock.clearTimeout(id),
    layers: () => root.querySelectorAll('.stage-layer'),
    running: () => animationList.filter(animation => animation.playState === 'running'),
    finishAll: () => { for (const animation of animationList) animation.finish(); }
  };
}
