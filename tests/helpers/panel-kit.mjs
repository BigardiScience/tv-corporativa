// Painel de mentira para testar, no Node, as telas de playlist que usam o motor de reprodução: DOM de teste com <dialog>,
// navegador de mentira (imagens, vídeos, animações) e um relógio que anda quando o teste manda.
//
// O que NÃO é real: o navegador. Desenho, foco de verdade, codecs e desempenho são conferidos no Chromium (tests/e2e).
import { FakeEvent } from './fake-dom.mjs';
import { createMediaEnvironment } from './fake-media-dom.mjs';
import { createFakeClock } from './playback-fakes.mjs';

export function createPanelKit({ scripts = {}, animations = true, reducedMotion = false } = {}) {
  const clock = createFakeClock();
  const media = createMediaEnvironment({ clock, scripts, animations });
  const { document } = media;

  const dialogs = document.createElement('div');
  dialogs.id = 'dialogs';
  document.body.appendChild(dialogs);

  // O <dialog> do navegador: showModal() abre; close() fecha e avisa com o evento "close".
  const create = document.createElement.bind(document);
  document.createElement = tag => {
    const element = create(tag);
    if (element.localName === 'dialog') {
      element.showModal = () => { element.open = true; };
      element.close = () => { if (!element.open) return; element.open = false; element.dispatchEvent(new FakeEvent('close')); };
    }
    return element;
  };

  const win = Object.assign(new EventTarget(), {
    Element: { prototype: animations ? { animate() {} } : {} },
    matchMedia: query => ({ matches: reducedMotion && query.includes('prefers-reduced-motion') })
  });
  const env = { clock, doc: document, win, source: media.source, raf: media.raf, cancelRaf: media.cancelRaf, wall: () => 1_000_000 + clock.now() };

  const all = (root, selector) => root.querySelectorAll(selector);
  const textOf = element => element.textContent.replace(/\s+/g, ' ').trim();

  const kit = {
    clock, document, media, env, win, scripts,
    textOf,
    open: () => dialogs.querySelectorAll('dialog').filter(dialog => dialog.open),
    top: () => kit.open().at(-1) ?? null,
    all,
    one: (root, selector) => root.querySelector(selector),
    // Botão pelo texto visível (exato).
    button: (root, text) => all(root, 'button').find(item => textOf(item) === text) ?? null,
    // Nome acessível, na ordem do navegador: aria-label, rótulo associado (for) ou texto.
    nameOf(element) {
      const own = element.getAttribute('aria-label');
      if (own) return own;
      const id = element.id;
      const labelled = id ? all(document.body, 'label').find(label => label.getAttribute('for') === id) : null;
      return labelled ? textOf(labelled) : textOf(element);
    },
    change(element, value) {
      if (value !== undefined) element.value = String(value);
      element.dispatchEvent(new FakeEvent('input', { bubbles: true }));
      element.dispatchEvent(new FakeEvent('change', { bubbles: true }));
    },
    // Termina as animações em andamento e deixa as promessas correrem.
    async finishMotion() { for (let turn = 0; turn < 4; turn++) { media.finishAll(); await clock.advance(0); } },
    layers: root => all(root, '.stage-layer'),
    shown: root => all(root, '.stage-layer').filter(layer => !layer.classList.contains('is-standby')),
    // Encerra o teste: todo prazo cancelado, nenhuma camada e todo arquivo aberto foi solto.
    release() { media.restore(); }
  };
  return kit;
}
