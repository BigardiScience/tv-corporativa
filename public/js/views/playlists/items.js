// Lista de conteúdos de uma playlist em edição: cada linha tem tempo, transição e ações (subir, descer, remover).
// Reordenar funciona de dois jeitos: arrastando a alça (mouse) ou pelos botões ↑ ↓ (teclado, leitor de tela e toque).
// Aqui não há chamadas à API nem regras de negócio: tudo que a pessoa faz vira uma chamada a `handlers`.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, button, iconButton, tones } from '../../ui/components.js';
import { KIND_LABELS, READINESS_LABELS, TRANSITIONS, TRANSITION_LABELS } from '../../lib/format.js';
import { kindForMime } from '../../lib/media-validation.js';
import {
  DEFAULT_TRANSITION_MS, DURATION_MODES, DURATION_MODE_HELP, DURATION_MODE_LABELS, MAX_DURATION, MAX_TRANSITION_MS, MIN_DURATION,
  clampDuration, clampTransitionMs, isNaturalItem, timingSentence
} from '../../lib/playlist-model.js';
import { EFFECT_HELP } from '../../playback/effects.js';
import { selectBox } from '../shared.js';

const DRAG_TYPE = 'application/x-tvcorp-playlist-item';
const KIND_ICON = Object.freeze({ image: 'image', video: 'video', pdf: 'file', other: 'file' });

export const READINESS_HINTS = Object.freeze({
  pending: 'Precisa ser aprovado na biblioteca antes de publicar.',
  not_scanned: 'Aguardando a verificação antivírus antes de publicar.',
  rejected: 'Foi rejeitado: remova da playlist.',
  deleted: 'O arquivo foi excluído da biblioteca.'
});

function artOf(ctx, item) {
  const kind = kindForMime(item.media.type);
  const fallback = () => h('span.art-placeholder', icon(KIND_ICON[kind] ?? 'file'));
  if (kind !== 'image' || !ctx.thumbnails || !item.media.url) return fallback();
  const img = h('img', { alt: '', decoding: 'async' });
  ctx.thumbnails.attach(img, `${item.media.id}:`, item.media.url, () => img.replaceWith(fallback()));
  return img;
}

// Campo numérico com rótulo. O mesmo campo muda de papel conforme o conteúdo (tempo de uma imagem, limite ou reserva de um vídeo),
// por isso `describe` troca o rótulo e o nome acessível sem recriar o campo (o foco e o que foi digitado ficam).
function numberField({ id, label, ariaLabel, value, min, max, step = 1, disabled, hidden = false, onInput, onCommit }) {
  const input = h('input', { id, type: 'number', min: String(min), max: String(max), step: String(step), inputmode: 'numeric', disabled, value: String(value), aria: { label: ariaLabel } });
  input.addEventListener('input', () => { if (input.value.trim() !== '' && Number.isFinite(Number(input.value))) onInput(Number(input.value)); });
  input.addEventListener('change', () => onCommit(input));
  const text = h('span', label);
  return {
    input,
    el: h('label.pl-field', { for: id, hidden }, text, input),
    describe({ label: nextLabel, ariaLabel: nextAria }) {
      text.textContent = nextLabel;
      input.setAttribute('aria-label', nextAria);
    }
  };
}

// Como o tempo de um conteúdo é chamado na tela, conforme o tipo e o modo.
function durationWording(item, kind, title) {
  if (kind !== 'video') return { label: 'Duração (s)', ariaLabel: `Duração (s) de “${title}”` };
  if (isNaturalItem(item)) return { label: 'Reserva (s)', ariaLabel: `Reserva (s) do vídeo “${title}”` };
  return { label: 'Limite (s)', ariaLabel: `Limite (s) do vídeo “${title}”` };
}

// Explicação do que o tempo significa em PDF (a troca de páginas ainda não existe).
const PDF_HELP = 'PDF: o tempo vale para o documento inteiro; as páginas não passam sozinhas.';

// `handlers`: edit() · move(from, to, focus) · remove(index) · demo(index)
export function renderItems(ctx, { items, editable, handlers }) {
  let dragIndex = null;
  const list = h('ol.pl-items', { aria: { label: 'Conteúdos da playlist, em ordem de exibição' } });

  const clearMarks = () => { for (const el of list.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after'); };

  items.forEach((item, index) => {
    const { media } = item, title = media.title, kind = kindForMime(media.type);
    const video = kind === 'video';
    const timeText = h('span', timingSentence(item));
    const effectHelp = h('small.pl-help', { id: `eh-${item.key}` }, EFFECT_HELP[item.transition] ?? '');
    const modeHelp = video ? h('small.pl-help', { id: `dh-${item.key}` }, DURATION_MODE_HELP[isNaturalItem(item) ? 'natural' : 'fixed']) : null;
    const pdfHelp = kind === 'pdf' ? h('small.pl-help', { id: `dp-${item.key}` }, PDF_HELP) : null;

    const ms = numberField({
      id: `ms-${item.key}`, label: 'Efeito (ms)', ariaLabel: `Efeito (ms) de “${title}”`, value: item.transitionMs || DEFAULT_TRANSITION_MS, min: 0, max: MAX_TRANSITION_MS, step: 50,
      disabled: !editable, hidden: item.transition === 'cut',
      onInput: value => { item.transitionMs = value; handlers.edit(); },
      onCommit: input => { item.transitionMs = input.value.trim() === '' ? clampTransitionMs(item.transitionMs) : clampTransitionMs(input.value); input.value = String(item.transitionMs); handlers.edit(); }
    });
    const duration = numberField({
      id: `dur-${item.key}`, ...durationWording(item, kind, title), value: item.durationS, min: MIN_DURATION, max: MAX_DURATION, disabled: !editable,
      onInput: value => { item.durationS = value; timeText.textContent = timingSentence(item); handlers.edit(); },
      onCommit: input => {
        item.durationS = input.value.trim() === '' ? clampDuration(item.durationS) : clampDuration(input.value);
        input.value = String(item.durationS);
        timeText.textContent = timingSentence(item);
        handlers.edit();
      }
    });
    // Só vídeo escolhe entre o tempo definido (limite) e tocar até o fim.
    const mode = video ? selectBox({
      id: `dm-${item.key}`, label: `Tempo do vídeo “${title}”`, value: isNaturalItem(item) ? 'natural' : 'fixed', disabled: !editable,
      options: DURATION_MODES.map(name => [name, DURATION_MODE_LABELS[name]]),
      onChange: value => {
        item.durationMode = value;
        duration.describe(durationWording(item, kind, title));
        modeHelp.textContent = DURATION_MODE_HELP[value];
        timeText.textContent = timingSentence(item);
        handlers.edit();
      }
    }) : null;
    if (mode) mode.setAttribute('aria-describedby', modeHelp.id);
    if (pdfHelp) duration.input.setAttribute('aria-describedby', pdfHelp.id);

    const transition = selectBox({
      id: `tr-${item.key}`, label: `Transição de “${title}”`, value: item.transition, disabled: !editable,
      options: TRANSITIONS.map(name => [name, TRANSITION_LABELS[name]]),
      onChange: value => {
        item.transition = value;
        if (value === 'cut') item.transitionMs = 0; else if (!item.transitionMs) item.transitionMs = DEFAULT_TRANSITION_MS;
        ms.input.value = String(item.transitionMs || DEFAULT_TRANSITION_MS);
        ms.el.hidden = value === 'cut';
        effectHelp.textContent = EFFECT_HELP[value] ?? '';
        handlers.edit();
      }
    });
    transition.setAttribute('aria-describedby', effectHelp.id);

    const preview = button('Ver efeito', {
      icon: 'play', className: 'small', dataset: { action: 'demo' }, aria: { label: `Ver efeito de “${title}”` }, onClick: () => handlers.demo(index)
    });

    const up = iconButton(`Mover “${title}” para cima`, 'up', () => handlers.move(index, index - 1, 'up'), { dataset: { action: 'up' } });
    const down = iconButton(`Mover “${title}” para baixo`, 'down', () => handlers.move(index, index + 1, 'down'), { dataset: { action: 'down' } });
    up.disabled = index === 0;
    down.disabled = index === items.length - 1;
    const remove = iconButton(`Remover “${title}” da playlist`, 'trash', () => handlers.remove(index), { className: 'act-delete', dataset: { action: 'remove' } });

    const hint = READINESS_HINTS[item.readiness];
    const handle = editable ? h('span.pl-handle', { title: 'Arraste para reordenar' }, icon('grip')) : null;

    const row = h('li.pl-item', { class: { 'not-ready': item.readiness !== 'ready' }, dataset: { key: item.key } },
      handle,
      h('span.pl-num', { aria: { hidden: 'true' } }, String(index + 1)),
      h('span.pl-art', artOf(ctx, item)),
      h('div.pl-body',
        h('b.pl-title', title),
        h('span.pl-meta', `${KIND_LABELS[kind] ?? 'Arquivo'} · `, timeText, ' ', badge(READINESS_LABELS[item.readiness] ?? item.readiness, tones.readiness[item.readiness])),
        hint ? h('small.pl-hint', hint) : null,
        h('div.pl-controls',
          mode ? h('label.pl-field', { for: `dm-${item.key}` }, h('span', 'Tempo do vídeo'), mode) : null,
          duration.el,
          h('label.pl-field', { for: `tr-${item.key}` }, h('span', 'Transição'), transition),
          ms.el,
          preview),
        h('div.pl-helps', modeHelp, pdfHelp, effectHelp)),
      editable ? h('div.pl-actions', up, down, remove) : null);

    if (editable) {
      // A linha só vira "arrastável" enquanto o mouse está na alça: assim os campos numéricos continuam selecionáveis.
      handle.addEventListener('mousedown', () => {
        row.draggable = true;
        // Um clique na alça sem arrastar não pode deixar a linha "arrastável" para sempre.
        globalThis.addEventListener('mouseup', () => { if (dragIndex === null) row.draggable = false; }, { once: true });
      });
      row.addEventListener('dragstart', event => {
        dragIndex = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, String(index));
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => { dragIndex = null; row.draggable = false; row.classList.remove('dragging'); clearMarks(); });
      row.addEventListener('dragover', event => {
        if (dragIndex === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const box = row.getBoundingClientRect(), after = event.clientY > box.top + box.height / 2;
        clearMarks();
        row.classList.add(after ? 'drop-after' : 'drop-before');
      });
      row.addEventListener('dragleave', event => { if (!row.contains(event.relatedTarget)) row.classList.remove('drop-before', 'drop-after'); });
      row.addEventListener('drop', event => {
        if (dragIndex === null) return;
        event.preventDefault();
        const box = row.getBoundingClientRect(), after = event.clientY > box.top + box.height / 2;
        let to = index + (after ? 1 : 0);
        if (dragIndex < to) to -= 1;
        const from = dragIndex;
        dragIndex = null;
        clearMarks();
        if (from !== to) handlers.move(from, to, null);
      });
    }
    list.appendChild(row);
  });
  return list;
}

// Depois de redesenhar a lista, devolve o foco ao botão que a pessoa usou (ou ao oposto, se ele ficou desabilitado no limite).
export function focusItemAction(list, key, action) {
  const row = [...list.querySelectorAll('.pl-item')].find(el => el.dataset.key === key);
  if (!row) return;
  const first = row.querySelector(`[data-action="${action}"]`);
  const other = row.querySelector(`[data-action="${action === 'up' ? 'down' : 'up'}"]`);
  (first && !first.disabled ? first : other && !other.disabled ? other : row.querySelector('input, select'))?.focus();
}
