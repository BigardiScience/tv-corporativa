// Playlists: O QUE passa nas telas (conteúdos, ordem, tempo e transição). Aqui ficam a lista, a criação e a exclusão;
// a edição de uma playlist está em editor.js. Quem decide o que cada pessoa pode fazer é sempre o servidor.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal, confirmDialog } from '../../ui/dialogs.js';
import { badge, button, emptyState, field, iconButton, notice, pageHeading } from '../../ui/components.js';
import { runBusy, showError } from '../../ui/feedback.js';
import { toast } from '../../ui/toast.js';
import { SCHEDULE_STATE_LABELS, plural, relativeTime } from '../../lib/format.js';
import { debounce, needSpace, spaceLabel } from '../shared.js';

const PAGE = 50;

// Situação resumida da playlist para quem está olhando a lista.
export function playlistStatus(playlist) {
  if (!playlist.latestVersion) return badge('Nunca publicada', 'warning');
  if (playlist.hasUnpublishedChanges) return badge('Rascunho com alterações', 'warning');
  return badge(`Versão ${playlist.latestVersion} publicada`);
}

function createDialog(ctx, space) {
  const name = h('input#playlist-name', { name: 'name', type: 'text', maxlength: '120', required: true, autocomplete: 'off', spellcheck: 'false' });
  const description = h('textarea#playlist-description', { name: 'description', rows: '3', maxlength: '500' });
  let dialog;
  const save = async () => {
    const value = name.value.trim();
    if (!value) { dialog.setError('Informe o nome da playlist.'); name.focus(); return; }
    dialog.clearError();
    const created = await runBusy(confirm, () => ctx.api.post('/api/playlists', { unitId: space.unitId, sectorId: space.sectorId, name: value, description: description.value.trim() }), { dialog });
    if (created) dialog.close(created);
  };
  const confirm = button('Criar playlist', { primary: true, icon: 'check', onClick: save });
  const form = h('form.form-grid', { on: { submit: event => { event.preventDefault(); save(); } } },
    field({ label: 'Nome da playlist', control: name, hint: 'Ex.: Avisos da semana, Segurança do Trabalho.', full: true }),
    field({ label: 'Descrição (opcional)', control: description, hint: 'Ajuda a equipe a saber para que serve.', full: true }));
  dialog = openModal({
    title: 'Nova playlist', subtitle: `${spaceLabel(ctx, space)}. Você monta o rascunho e só publica quando estiver pronta.`, size: 'small',
    body: [form], footer: [button('Cancelar', { onClick: () => dialog.close() }), confirm]
  });
  return dialog.closed;
}

// Playlist em uso não pode ser excluída: mostra quais programações dependem dela.
function inUseDialog(ctx, details) {
  const dialog = openModal({
    title: 'Esta playlist está em uso', subtitle: 'Programações dependem dela.', size: 'small',
    body: [
      h('ul.link-list', (details.schedules ?? []).map(item => h('li',
        h('a.subtle-link', { href: ctx.link('schedules'), on: { click: () => dialog.close() } }, icon('calendar'), item.name), ' ',
        badge(SCHEDULE_STATE_LABELS[item.status] ?? item.status, item.status === 'published' ? '' : 'neutral')))),
      notice('Exclua ou interrompa essas programações antes de excluir a playlist.', { tone: 'info', className: 'mt' })
    ],
    footer: [button('Entendi', { primary: true, icon: 'check', onClick: () => dialog.close() })]
  });
  return dialog.closed;
}

export async function mountPlaylists(ctx, route, container, view) {
  const { space } = ctx.state;
  if (!space) { needSpace(ctx, container, { title: 'Playlists', description: 'O que passa nas telas, em ordem.' }); return; }

  const canCreate = ctx.canHere('playlist:create'), canEdit = ctx.canHere('playlist:update'), canDelete = ctx.canHere('playlist:delete');
  let query = '', data = null, requestId = 0;

  const search = h('input#playlist-search', { type: 'search', placeholder: 'Buscar playlist…', maxlength: '100', autocomplete: 'off', aria: { label: 'Buscar playlist pelo nome' } });
  const count = h('p.library-count', { role: 'status' });
  const results = h('div.playlist-results');
  const more = button('Carregar mais', { onClick: () => loadMore() });
  const moreBox = h('div.load-more', { hidden: true }, more);

  const fetchPage = offset => ctx.api.get('/api/playlists', { query: { unitId: space.unitId, sectorId: space.sectorId, q: query, limit: PAGE, offset } });

  async function load({ silent = false } = {}) {
    const id = ++requestId;
    if (!silent) results.setAttribute('aria-busy', 'true');
    try {
      const next = await fetchPage(0);
      if (id !== requestId || !view.alive()) return;
      data = next;
      draw();
    } catch (error) {
      if (id === requestId && view.alive() && !silent) showError(error);
    } finally {
      if (id === requestId) results.removeAttribute('aria-busy');
    }
  }

  async function loadMore() {
    const id = requestId;
    more.disabled = true;
    try {
      const next = await fetchPage(data.playlists.length);
      if (id !== requestId || !view.alive()) return;
      data = { ...next, playlists: [...data.playlists, ...next.playlists] };
      draw();
    } catch (error) { if (view.alive()) showError(error); } finally { more.disabled = false; }
  }

  const create = async () => {
    const created = await createDialog(ctx, space);
    if (created && view.alive()) { toast('Playlist criada. Adicione os conteúdos da biblioteca.'); ctx.navigate('playlist', { id: created.id }); }
  };

  async function remove(playlist) {
    const ok = await confirmDialog({
      title: 'Excluir esta playlist?', danger: true, confirmLabel: 'Excluir playlist', message: `“${playlist.name}” e o histórico de versões serão excluídos. Os arquivos da biblioteca não são afetados.`,
      note: 'Não há como desfazer.'
    });
    if (!ok) return;
    try {
      await ctx.api.delete(`/api/playlists/${encodeURIComponent(playlist.id)}`);
      toast('Playlist excluída.');
      await load({ silent: true });
    } catch (error) {
      if (error?.code === 'PLAYLIST_IN_USE') await inUseDialog(ctx, error.details ?? {});
      else showError(error);
    }
  }

  function row(playlist) {
    const schedules = playlist.scheduleCount
      ? [plural(playlist.scheduleCount, 'programação', 'programações'), playlist.liveScheduleCount ? ` · ${playlist.liveScheduleCount} publicada(s)` : ''].join('')
      : null;
    return h('tr',
      h('td', h('div.table-name', h('span.screen-thumb', icon('list')),
        h('div', h('a.row-link', { href: ctx.link('playlist', { id: playlist.id }) }, playlist.name),
          playlist.description ? h('small', playlist.description) : null))),
      h('td', `${playlist.itemCount} de ${data.maxItems}`),
      h('td', playlistStatus(playlist)),
      h('td', schedules ?? h('span.muted', 'Nenhuma')),
      h('td', h('time', { datetime: playlist.updatedAt }, relativeTime(playlist.updatedAt))),
      h('td.col-actions', h('div.item-actions',
        h('a.button.small', { href: ctx.link('playlist', { id: playlist.id }), aria: { label: `${canEdit ? 'Editar' : 'Abrir'} a playlist ${playlist.name}` } }, icon(canEdit ? 'edit' : 'eye'), canEdit ? 'Editar' : 'Abrir'),
        canDelete ? iconButton(`Excluir a playlist ${playlist.name}`, 'trash', () => remove(playlist), { className: 'act-delete' }) : null)));
  }

  function draw() {
    const { playlists, total } = data;
    count.textContent = total ? `${plural(total, 'playlist', 'playlists')}${query ? ` para “${query}”` : ''}` : '';
    moreBox.hidden = playlists.length >= total;
    if (!playlists.length) {
      mount(results, query
        ? emptyState({ iconName: 'search', title: 'Nenhuma playlist encontrada', text: `Não há playlists com “${query}” neste espaço.` })
        : emptyState({
          iconName: 'list', title: 'Nenhuma playlist neste espaço ainda',
          text: canCreate ? 'Crie a primeira playlist, escolha os conteúdos da biblioteca e publique uma versão.' : 'Quando alguém criar uma playlist neste espaço, ela aparecerá aqui.',
          actions: canCreate ? [button('Criar a primeira playlist', { primary: true, icon: 'plus', onClick: create })] : []
        }));
      return;
    }
    mount(results, h('div.table-wrap', h('table.data-table.playlist-table',
      h('thead', h('tr', ['Playlist', 'Conteúdos', 'Situação', 'Programações', 'Atualizada', ''].map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', playlists.map(row)))));
  }

  const onSearch = debounce(() => { query = search.value.trim(); load(); }, 250);
  search.addEventListener('input', onSearch);
  view.onDispose(() => onSearch.cancel());
  view.refresh = () => load({ silent: true });

  mount(container,
    pageHeading({
      eyebrow: spaceLabel(ctx, space).toUpperCase(), title: 'Playlists',
      description: 'A playlist define o que passa nas telas: conteúdos, ordem, tempo e transição.',
      actions: canCreate ? [button('Nova playlist', { primary: true, icon: 'plus', onClick: create })] : []
    }),
    notice(['A playlist é só o “o quê”. Para decidir ', h('b', 'quando'), ' e em ', h('b', 'quais TVs'), ' ela toca, publique uma versão e use ',
      h('a.subtle-link.inline', { href: ctx.link('schedules') }, 'Programações'), '. Editar o rascunho nunca muda o que já está no ar.'], { tone: 'info', iconName: 'info', className: 'mb' }),
    h('div.toolbar', h('div.field-search', icon('search'), search)),
    count, results, moreBox);

  await load();
}
