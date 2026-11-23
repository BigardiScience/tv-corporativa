// Desenho dos itens da Biblioteca: grade de cartões ou tabela. Aqui não há chamadas à API: tudo que a pessoa faz vira uma
// chamada a `handlers`, que quem monta a tela implementa. A seleção é só marcação visual do que está em `selection`.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, iconButton, tones } from '../../ui/components.js';
import { KIND_LABELS, MEDIA_STATUS_LABELS, SORT_LABELS, formatBytes, formatDateTime, plural } from '../../lib/format.js';
import { folderKey, mediaKey } from '../../lib/selection.js';
import { dropTarget } from './dnd.js';

const KIND_ICON = Object.freeze({ image: 'image', video: 'video', pdf: 'file', other: 'file' });

// Ordem em que os itens aparecem na tela (pastas primeiro). Usada pela seleção com Shift.
export const visibleKeys = data => [...data.folders.map(folder => folderKey(folder.id)), ...data.media.map(media => mediaKey(media.id))];

const placeholder = media => h('span.art-placeholder', icon(KIND_ICON[media.kind] ?? 'file'),
  media.kind === 'pdf' ? h('b', 'PDF') : media.kind === 'video' ? h('b', 'VÍDEO') : null);

// Miniatura só para imagens (gerada no navegador, sob demanda). Vídeo e PDF mostram um ícone: o conteúdo abre nos detalhes.
function art(media, thumbnails) {
  if (media.kind !== 'image' || !thumbnails) return placeholder(media);
  const img = h('img', { alt: '', decoding: 'async' });
  thumbnails.attach(img, `${media.id}:${media.sha256 ?? ''}`, media.url, () => img.replaceWith(placeholder(media)));
  return img;
}

const folderMeta = folder => {
  const parts = [];
  if (folder.childFolders) parts.push(plural(folder.childFolders, 'pasta', 'pastas'));
  if (folder.mediaCount) parts.push(plural(folder.mediaCount, 'arquivo', 'arquivos'));
  return parts.length ? parts.join(' · ') : 'Pasta vazia';
};

export const statusBadge = media => badge(MEDIA_STATUS_LABELS[media.status] ?? media.status, tones.media[media.status]);

function usageChip(usage) {
  if (!usage) return null;
  const total = (usage.playlists ?? 0) + (usage.schedules ?? 0);
  if (!total) return null;
  const parts = [];
  if (usage.playlists) parts.push(plural(usage.playlists, 'playlist', 'playlists'));
  if (usage.schedules) parts.push(plural(usage.schedules, 'programação', 'programações'));
  return h('span.chip', { class: { live: usage.liveSchedules > 0 }, title: `Usado em ${parts.join(' e ')}` }, icon(usage.liveSchedules > 0 ? 'play' : 'list'), usage.liveSchedules > 0 ? 'No ar' : 'Em playlist');
}

const pathText = media => (media.folderPath?.length ? media.folderPath.join(' / ') : 'Biblioteca');

// Casa de seleção. O clique carrega a tecla Shift (seleção em intervalo); o estado marcado vem sempre de `selection`.
function checkbox(key, label, handlers) {
  return h('label.item-check', { title: 'Selecionar (Shift para marcar um intervalo)' },
    h('input', { type: 'checkbox', aria: { label: `Selecionar ${label}` }, on: { click: event => { event.stopPropagation(); handlers.select(key, event); } } }));
}

// Um clique com Ctrl/Cmd/Shift seleciona; um clique simples abre.
const opener = (key, open, handlers) => event => {
  if (event.ctrlKey || event.metaKey || event.shiftKey) { event.preventDefault(); handlers.select(key, event); return; }
  open();
};

function actionButtons(kind, item, can, handlers) {
  const name = kind === 'folder' ? item.name : item.title;
  const buttons = [];
  if (kind === 'media' && can.approve && item.status !== 'approved') buttons.push(iconButton(`Aprovar “${name}”`, 'check-circle', () => handlers.review(item, 'approve'), { className: 'act-approve' }));
  if (kind === 'media' && can.approve && item.status === 'pending') buttons.push(iconButton(`Rejeitar “${name}”`, 'x-circle', () => handlers.review(item, 'reject'), { className: 'act-reject' }));
  if (can[kind].update) {
    buttons.push(iconButton(`Renomear “${name}”`, 'edit', () => handlers.rename(kind, item)));
    buttons.push(iconButton(`Mover “${name}” para outra pasta`, 'move', () => handlers.move(kind, item)));
  }
  if (can[kind].delete) buttons.push(iconButton(`Excluir “${name}”`, 'trash', () => handlers.remove(kind, item), { className: 'act-delete' }));
  return buttons.length ? h('div.item-actions', buttons) : null;
}

function wireDrag(el, key, kind, can, handlers) {
  if (!can[kind].update) return el;
  el.setAttribute('draggable', 'true');
  el.addEventListener('dragstart', event => handlers.dragStart(event, key));
  el.addEventListener('dragend', () => handlers.dragEnd?.());
  return el;
}

// ---- grade -----------------------------------------------------------------------------------------------------------------

function folderCard(folder, ctxInfo) {
  const { can, handlers } = ctxInfo, key = folderKey(folder.id);
  const card = h('article.item-card.folder', { dataset: { key } },
    checkbox(key, folder.name, handlers),
    h('button.item-open', { type: 'button', aria: { label: `Abrir a pasta ${folder.name}` }, on: { click: opener(key, () => handlers.openFolder(folder), handlers) } },
      h('span.item-art.folder-art', icon('folder')),
      h('span.item-title', folder.name),
      h('span.item-meta', folderMeta(folder)),
      folder.parents?.length ? h('span.item-path', `em ${folder.parents.join(' / ')}`) : null),
    actionButtons('folder', folder, can, handlers));
  dropTarget(card, { accept: event => handlers.drop.accept(event, folder.id), onDrop: event => handlers.drop.onDrop(event, folder.id) });
  return wireDrag(card, key, 'folder', can, handlers);
}

function mediaCard(media, ctxInfo) {
  const { can, handlers, thumbnails, flat } = ctxInfo, key = mediaKey(media.id);
  const card = h('article.item-card.media', { dataset: { key } },
    checkbox(key, media.title, handlers),
    h('button.item-open', { type: 'button', aria: { label: `Abrir detalhes de ${media.title}` }, on: { click: opener(key, () => handlers.openMedia(media), handlers) } },
      h('span.item-art', art(media, thumbnails)),
      h('span.item-title', media.title),
      h('span.item-meta', `${KIND_LABELS[media.kind] ?? 'Arquivo'} · ${formatBytes(media.size)}`),
      flat ? h('span.item-path', `em ${pathText(media)}`) : null),
    h('div.item-badges', statusBadge(media), usageChip(media.usage)),
    actionButtons('media', media, can, handlers));
  return wireDrag(card, key, 'media', can, handlers);
}

function renderGrid(ctxInfo) {
  const { data } = ctxInfo;
  return h('div.item-grid', { role: 'list', aria: { label: 'Pastas e arquivos' } },
    data.folders.map(folder => h('div', { role: 'listitem' }, folderCard(folder, ctxInfo))),
    data.media.map(media => h('div', { role: 'listitem' }, mediaCard(media, ctxInfo))));
}

// ---- tabela ----------------------------------------------------------------------------------------------------------------

function headerCell(label, sortKey, { sort, handlers }) {
  if (!sortKey) return h('th', { scope: 'col' }, label);
  const active = sort.key === sortKey;
  return h('th', { scope: 'col', aria: { sort: active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined } },
    h('button.sort-button', { type: 'button', title: `Ordenar por ${SORT_LABELS[sortKey].toLowerCase()}`, on: { click: () => handlers.sortBy(sortKey) } },
      label, active ? icon(sort.order === 'asc' ? 'up' : 'down') : null));
}

function folderRow(folder, ctxInfo) {
  const { can, handlers } = ctxInfo, key = folderKey(folder.id);
  const row = h('tr', { dataset: { key } },
    h('td.col-check', checkbox(key, folder.name, handlers)),
    h('td', h('button.row-open', { type: 'button', aria: { label: `Abrir a pasta ${folder.name}` }, on: { click: opener(key, () => handlers.openFolder(folder), handlers) } },
      h('span.row-art.folder-art', icon('folder')),
      h('span', h('b', folder.name), folder.parents?.length ? h('small', `em ${folder.parents.join(' / ')}`) : null))),
    h('td', 'Pasta'),
    h('td', folderMeta(folder)),
    h('td', h('span.muted', '—')),
    h('td', h('span.muted', '—')),
    h('td', formatDateTime(folder.createdAt)),
    h('td.col-actions', actionButtons('folder', folder, can, handlers)));
  dropTarget(row, { accept: event => handlers.drop.accept(event, folder.id), onDrop: event => handlers.drop.onDrop(event, folder.id) });
  return wireDrag(row, key, 'folder', can, handlers);
}

function mediaRow(media, ctxInfo) {
  const { can, handlers, thumbnails, flat } = ctxInfo, key = mediaKey(media.id);
  const row = h('tr', { dataset: { key } },
    h('td.col-check', checkbox(key, media.title, handlers)),
    h('td', h('button.row-open', { type: 'button', aria: { label: `Abrir detalhes de ${media.title}` }, on: { click: opener(key, () => handlers.openMedia(media), handlers) } },
      h('span.row-art', art(media, thumbnails)),
      h('span', h('b', media.title), h('small', flat ? `${media.name} · em ${pathText(media)}` : media.name)))),
    h('td', KIND_LABELS[media.kind] ?? 'Arquivo'),
    h('td', formatBytes(media.size)),
    h('td', statusBadge(media)),
    h('td', usageChip(media.usage) ?? h('span.muted', '—')),
    h('td', formatDateTime(media.createdAt)),
    h('td.col-actions', actionButtons('media', media, can, handlers)));
  return wireDrag(row, key, 'media', can, handlers);
}

function renderTable(ctxInfo) {
  const { data } = ctxInfo;
  return h('div.panel.table-panel', h('div.table-wrap', h('table.data-table.library-table',
    h('caption.sr-only', 'Pastas e arquivos da biblioteca'),
    h('thead', h('tr',
      h('th.col-check', { scope: 'col' }, h('span.sr-only', 'Seleção')),
      headerCell('Nome', 'name', ctxInfo), headerCell('Tipo', 'type', ctxInfo), headerCell('Tamanho', 'size', ctxInfo),
      headerCell('Situação', 'status', ctxInfo), headerCell('Uso', null, ctxInfo), headerCell('Enviado em', 'date', ctxInfo), h('th', { scope: 'col' }, h('span.sr-only', 'Ações')))),
    h('tbody', data.folders.map(folder => folderRow(folder, ctxInfo)), data.media.map(media => mediaRow(media, ctxInfo))))));
}

// ---- API do módulo ----------------------------------------------------------------------------------------------------------

// `can` = { folder: {update, delete}, media: {update, delete}, approve } (a interface esconde botões; o servidor decide).
export function renderItems({ data, mode, selection, thumbnails, can, sort, handlers }) {
  const ctxInfo = { data, selection, thumbnails, can, sort, handlers, flat: !!data.query?.flat };
  const root = mode === 'list' ? renderTable(ctxInfo) : renderGrid(ctxInfo);
  syncSelection(root, selection);
  return root;
}

// Marca visualmente o que está selecionado, sem redesenhar a lista (o foco do teclado não se perde).
export function syncSelection(root, selection) {
  for (const el of root.querySelectorAll('[data-key]')) {
    const on = selection.has(el.dataset.key);
    el.classList.toggle('selected', on);
    const input = el.querySelector('.item-check input');
    if (input) input.checked = on;
  }
}

