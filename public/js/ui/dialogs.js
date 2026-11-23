// Janelas de diálogo (elemento nativo <dialog>): foco preso dentro da janela, Esc fecha, foco volta para quem abriu.
// Várias janelas podem ficar empilhadas (ex.: uma confirmação sobre os detalhes de um arquivo).
import { h } from './dom.js';
import { icon } from './icons.js';

const open = new Set();
let counter = 0;
const usable = list => list.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== true);

export function openModal({ title, subtitle = '', body = [], footer = [], note = '', size = 'normal', dismissible = true, onClose } = {}) {
  const titleId = `dialog-title-${++counter}`;
  const opener = globalThis.document.activeElement;
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  let result;

  const error = h('div.error-box', { role: 'alert', tabindex: '-1', hidden: true });
  const content = h('div.dialog-body', error, body);
  const closeButton = h('button.icon-button', { type: 'button', aria: { label: 'Fechar janela' }, on: { click: () => dialog.close() } }, icon('close'));
  const actions = h('div.dialog-actions', footer);
  const footerEl = (footer.length || note) ? h('div.dialog-footer', note ? h('small', note) : h('span'), actions) : null;
  const titleEl = h('h2', { id: titleId }, title), subtitleEl = h('p', { hidden: !subtitle }, subtitle);
  const dialog = h(`dialog.modal.${size}`, { aria: { labelledby: titleId } },
    h('div.dialog-head', h('div', titleEl, subtitleEl), dismissible ? closeButton : null),
    content, footerEl);

  if (!dismissible) dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('close', () => {
    open.delete(handle);
    dialog.remove();
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
    onClose?.(result);
    resolveClosed(result);
  });

  const handle = {
    el: dialog, body: content, actions, closed,
    close(value) { result = value; if (dialog.open) dialog.close(); else dialog.dispatchEvent(new Event('close')); },
    setError(message) { error.textContent = message; error.hidden = false; error.scrollIntoView?.({ block: 'nearest' }); },
    clearError() { error.hidden = true; error.textContent = ''; },
    setBusy(busy) {
      for (const control of actions.querySelectorAll('button')) control.disabled = busy;
      dialog.toggleAttribute('aria-busy', busy);
    },
    setTitle(nextTitle, nextSubtitle = '') { titleEl.textContent = nextTitle; subtitleEl.textContent = nextSubtitle; subtitleEl.hidden = !nextSubtitle; },
    // Troca o conteúdo da janela (ex.: etapas de um assistente) sem fechá-la. Valores vazios (null, false) são ignorados.
    setBody(...children) { content.replaceChildren(error, ...usable(children)); },
    setFooter(...children) { actions.replaceChildren(...usable(children)); }
  };
  open.add(handle);
  globalThis.document.getElementById('dialogs').appendChild(dialog);
  dialog.showModal();
  // O primeiro campo ou botão da janela recebe o foco (em vez do botão de fechar).
  const first = content.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? actions.querySelector('button.primary, button');
  first?.focus();
  return handle;
}

export function closeAllDialogs() {
  for (const handle of [...open]) handle.close();
}

export const anyDialogOpen = () => open.size > 0;

// Confirmação simples: devolve true/false.
export function confirmDialog({ title, message, details = [], confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, note = '' } = {}) {
  let handle;
  const answer = value => handle.close(value);
  handle = openModal({
    title, size: 'small',
    body: [h('p.confirm-message', message), details.length ? h('ul.confirm-list', details.map(item => h('li', item))) : null],
    note,
    footer: [
      h('button.button', { type: 'button', on: { click: () => answer(false) } }, cancelLabel),
      h(`button.button.${danger ? 'danger-solid' : 'primary'}`, { type: 'button', on: { click: () => answer(true) } }, confirmLabel)
    ]
  });
  return handle.closed.then(value => value === true);
}
