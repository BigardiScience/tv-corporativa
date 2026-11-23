// Peças compartilhadas pelas telas que dependem do espaço de trabalho (unidade + setor).
import { h, mount } from '../ui/dom.js';
import { openModal } from '../ui/dialogs.js';
import { button, emptyState, pageHeading } from '../ui/components.js';
import { runBusy } from '../ui/feedback.js';

// Tela mostrada quando a pessoa ainda não escolheu unidade e setor.
export function needSpace(ctx, container, { title, description }) {
  mount(container,
    pageHeading({ title, description }),
    emptyState({
      iconName: 'building', title: 'Escolha onde trabalhar',
      text: 'Esta área é separada por unidade e setor. Escolha o espaço para continuar.',
      actions: [button('Escolher unidade e setor', { primary: true, icon: 'building', onClick: () => ctx.chooseSpace() })]
    }));
}

export const spaceLabel = (ctx, space) => `${ctx.unitName(space.unitId)} · ${ctx.sectorName(space.sectorId)}`;

// Chama `fn` só depois de `wait` ms sem novas chamadas (campos de busca).
export function debounce(fn, wait = 250) {
  let timer;
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  run.cancel = () => clearTimeout(timer);
  return run;
}

// Lista suspensa com rótulo acessível. O valor é definido DEPOIS de criar as opções (senão o navegador ignora).
export function selectBox({ id, label, value, options, onChange, disabled = false }) {
  const el = h('select', { id, aria: { label }, disabled, on: onChange ? { change: () => onChange(el.value) } : undefined },
    options.map(([optionValue, text]) => h('option', { value: optionValue }, text)));
  el.value = value;
  return el;
}

// Janela de confirmação que EXECUTA a ação (e mostra o erro do servidor dentro da própria janela, sem fechá-la).
// `run` devolve o resultado da ação; um valor diferente de undefined significa sucesso e fecha a janela.
// A promessa devolvida traz o resultado, ou undefined se a pessoa cancelar ou a ação falhar e ela desistir.
export function actionDialog({ title, subtitle = '', message, details = [], extra = [], confirmLabel, danger = false, iconName, size = 'small', run }) {
  let dialog;
  const confirm = button(confirmLabel, {
    primary: !danger, className: danger ? 'danger-solid' : '', icon: iconName ?? (danger ? 'trash' : 'check'),
    onClick: async () => {
      const result = await runBusy(confirm, run, { dialog });
      if (result !== undefined) dialog.close(result);
    }
  });
  dialog = openModal({
    title, subtitle, size,
    body: [message ? h('p.confirm-message', message) : null, details.length ? h('ul.confirm-list', details.map(item => h('li', item))) : null, extra],
    footer: [button('Cancelar', { onClick: () => dialog.close() }), confirm]
  });
  return dialog.closed;
}
