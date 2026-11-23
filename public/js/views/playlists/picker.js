// Escolha de conteúdos da biblioteca para colocar na playlist. A lista é "plana" (todos os arquivos do espaço, com a pasta de cada um),
// com busca e filtros; assim não é preciso abrir pasta por pasta. A seleção continua valendo ao mudar a busca.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { badge, button, notice, tones } from '../../ui/components.js';
import { showError } from '../../ui/feedback.js';
import { KIND_LABELS, MEDIA_STATUS_LABELS, formatBytes, plural } from '../../lib/format.js';
import { kindForMime } from '../../lib/media-validation.js';
import { debounce, selectBox } from '../shared.js';

const PAGE = 40;
const KIND_ICON = Object.freeze({ image: 'image', video: 'video', pdf: 'file', other: 'file' });

// `inPlaylist`: Map(mediaId → quantas vezes já está na playlist). `remaining`: quantos conteúdos ainda cabem.
// Devolve (pela promessa) a lista de arquivos escolhidos, ou undefined se a pessoa cancelar.
export function openMediaPicker(ctx, { space, remaining, inPlaylist = new Map() }) {
  const chosen = new Map();
  let status = 'approved', type = '', query = '', data = null, requestId = 0, dialog;

  const search = h('input#picker-search', { type: 'search', placeholder: 'Buscar arquivo pelo nome…', maxlength: '100', autocomplete: 'off', aria: { label: 'Buscar arquivo na biblioteca' } });
  const statusBox = selectBox({ id: 'picker-status', label: 'Situação dos arquivos', value: status, options: [['approved', 'Aprovados'], ['pending', 'Aguardando aprovação']], onChange: value => { status = value; load(); } });
  const typeBox = selectBox({ id: 'picker-type', label: 'Tipo de arquivo', value: type, options: [['', 'Todos os tipos'], ['image', 'Imagens'], ['video', 'Vídeos'], ['pdf', 'PDFs']], onChange: value => { type = value; load(); } });
  const list = h('ul.picker-list', { role: 'list' });
  const counter = h('span.picker-counter', { role: 'status' });
  const hint = h('p.muted.small.picker-hint');
  const more = button('Carregar mais', { onClick: () => loadMore() });
  const moreBox = h('div.load-more', { hidden: true }, more);
  const confirm = button('Adicionar à playlist', { primary: true, icon: 'plus', disabled: true, onClick: () => dialog.close([...chosen.values()]) });

  const full = () => chosen.size >= remaining;

  function sync() {
    counter.textContent = chosen.size ? `${plural(chosen.size, 'arquivo selecionado', 'arquivos selecionados')}` : 'Nenhum arquivo selecionado';
    confirm.disabled = chosen.size === 0;
    hint.textContent = remaining <= 0
      ? 'A playlist já está com o número máximo de conteúdos. Remova algum item para adicionar outro.'
      : `Cabem mais ${plural(remaining, 'conteúdo', 'conteúdos')} nesta playlist. Os arquivos entram no fim da lista, na ordem em que você os marca.`;
    for (const input of list.querySelectorAll('input[type=checkbox]')) input.disabled = !input.checked && full();
  }

  function row(media) {
    const kind = media.kind ?? kindForMime(media.type);
    const already = inPlaylist.get(media.id) ?? 0;
    const input = h('input', {
      type: 'checkbox', checked: chosen.has(media.id), disabled: !chosen.has(media.id) && full(), aria: { label: `Selecionar ${media.title}` },
      on: { change: () => { if (input.checked) chosen.set(media.id, media); else chosen.delete(media.id); input.closest('label')?.classList.toggle('selected', input.checked); sync(); } }
    });
    const art = h('span.picker-art');
    if (kind === 'image' && ctx.thumbnails) {
      const img = h('img', { alt: '', decoding: 'async' });
      ctx.thumbnails.attach(img, `${media.id}:${media.sha256 ?? ''}`, media.url, () => img.replaceWith(h('span.art-placeholder', icon('image'))));
      art.appendChild(img);
    } else art.appendChild(h('span.art-placeholder', icon(KIND_ICON[kind] ?? 'file')));
    const path = media.folderPath?.length ? media.folderPath.join(' / ') : 'Biblioteca';
    return h('li', h('label.picker-row', { class: { selected: chosen.has(media.id) } },
      input, art,
      h('span.picker-text', h('b', media.title), h('small', `${KIND_LABELS[kind] ?? 'Arquivo'} · ${formatBytes(media.size)} · ${path}`)),
      h('span.picker-tags', badge(MEDIA_STATUS_LABELS[media.status] ?? media.status, tones.media[media.status]),
        already ? h('span.chip', { title: 'Já está nesta playlist; você pode adicionar de novo para repetir o conteúdo.' }, `Na playlist ×${already}`) : null)));
  }

  function draw() {
    const { media, total } = data;
    mount(list, ...media.map(row));
    moreBox.hidden = media.length >= total;
    if (!media.length) {
      mount(list, h('li.picker-empty', status === 'approved'
        ? 'Nenhum arquivo aprovado encontrado. Envie e aprove arquivos na Biblioteca; arquivos aguardando aprovação podem ser incluídos no rascunho, mas só vão ao ar depois de aprovados.'
        : 'Nenhum arquivo aguardando aprovação encontrado.'));
    }
    sync();
  }

  const fetchPage = offset => ctx.api.get('/api/library', {
    query: { unitId: space.unitId, sectorId: space.sectorId, flat: true, status, type, q: query, sort: 'name', order: 'asc', limit: PAGE, offset }
  });

  async function load() {
    const id = ++requestId;
    list.setAttribute('aria-busy', 'true');
    try {
      const next = await fetchPage(0);
      if (id !== requestId || !dialog.el.isConnected) return;
      data = next;
      draw();
    } catch (error) { if (id === requestId) showError(error, dialog); } finally { if (id === requestId) list.removeAttribute('aria-busy'); }
  }

  async function loadMore() {
    const id = requestId;
    more.disabled = true;
    try {
      const next = await fetchPage(data.media.length);
      if (id !== requestId || !dialog.el.isConnected) return;
      data = { ...next, media: [...data.media, ...next.media] };
      draw();
    } catch (error) { showError(error, dialog); } finally { more.disabled = false; }
  }

  const onSearch = debounce(() => { query = search.value.trim(); load(); }, 250);
  search.addEventListener('input', onSearch);

  dialog = openModal({
    title: 'Adicionar da biblioteca', subtitle: `${ctx.unitName(space.unitId)} · ${ctx.sectorName(space.sectorId)}. Marque os arquivos que vão entrar na playlist.`, size: 'large',
    body: [
      h('div.toolbar.picker-toolbar', h('div.field-search', icon('search'), search), statusBox, typeBox),
      remaining <= 0 ? notice('A playlist já está com o número máximo de conteúdos.', { tone: 'warn', iconName: 'alert' }) : null,
      list, moreBox, hint
    ],
    footer: [counter, button('Cancelar', { onClick: () => dialog.close() }), confirm]
  });
  dialog.closed.then(() => onSearch.cancel());
  sync();
  load();
  search.focus();
  return dialog.closed;
}
