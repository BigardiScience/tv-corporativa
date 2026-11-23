// Formulário de programação (criar e editar): QUANDO e ONDE uma versão de playlist toca.
// A programação aponta para uma VERSÃO publicada da playlist; editar o rascunho da playlist não muda o que está no ar.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { button, emptyState, field, notice } from '../../ui/components.js';
import { runBusy, showError } from '../../ui/feedback.js';
import { CONNECTION_LABELS, fromLocalInput, plural, toLocalInput } from '../../lib/format.js';
import { validateSchedule, versionOptionLabel } from '../../lib/schedule-model.js';
import { selectBox, spaceLabel } from '../shared.js';
import { previewVersion } from '../playlists/versions.js';
import { openDisplaySequence } from '../displays/sequence.js';
import { canManageDisplays } from '../../lib/permissions.js';

// Mensagem mais útil, dentro de uma janela, para quando outra pessoa alterou a programação enquanto ela estava aberta.
const friendly = error => (error?.code === 'REVISION_CONFLICT'
  ? Object.assign(error, { message: 'Esta programação foi alterada por outra pessoa. Feche esta janela para ver a versão mais recente e refaça a alteração.' })
  : error);

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

// Devolve (pela promessa) a programação salva pelo servidor, ou undefined se a pessoa cancelar.
//  schedule: programação existente (edição) · playlistId: playlist sugerida (criação) · preferLatest: já escolher a versão mais nova
export function openScheduleForm(ctx, { space, schedule = null, playlistId = null, preferLatest = false, canPublish = false }) {
  const editing = !!schedule;
  const live = editing && schedule.status !== 'draft';
  const title = editing ? (preferLatest ? 'Atualizar a versão da playlist' : 'Editar programação') : 'Nova programação';
  const dialog = openModal({
    title, subtitle: spaceLabel(ctx, space), size: 'normal',
    body: [h('div.loading', { role: 'status' }, h('span.spinner', { aria: { hidden: 'true' } }), ' Carregando…')],
    footer: [button('Cancelar', { onClick: () => dialog.close() })]
  });
  const alive = () => dialog.el.isConnected;

  const query = { unitId: space.unitId, sectorId: space.sectorId };
  (async () => {
    let playlists, displays;
    try {
      [playlists, displays] = await Promise.all([ctx.api.get('/api/playlists', { query: { ...query, limit: 200 } }), ctx.api.get('/api/displays', { query })]);
    } catch (error) { if (alive()) { mount(dialog.body, emptyState({ iconName: 'alert', title: 'Não foi possível carregar', text: error?.message })); } return; }
    if (!alive()) return;
    draw(playlists.playlists.filter(item => item.latestVersion > 0 || item.id === schedule?.playlistId), displays.displays.filter(item => item.permissions?.publish === true));
  })();

  function draw(playlists, displays) {
    if (!playlists.length) {
      dialog.setBody(emptyState({
        iconName: 'list', title: 'Nenhuma playlist publicada neste espaço',
        text: 'Uma programação usa uma versão publicada de uma playlist. Monte e publique uma playlist primeiro.',
        actions: [h('a.button.primary', { href: ctx.link('playlists'), on: { click: () => dialog.close() } }, icon('list'), 'Ir para Playlists')]
      }));
      dialog.setFooter(button('Fechar', { onClick: () => dialog.close() }));
      return;
    }
    const versionsCache = new Map();
    const chosenPlaylist = schedule?.playlistId ?? (playlists.some(item => item.id === playlistId) ? playlistId : playlists[0].id);
    const authorized = new Set(displays.map(item => item.id));
    const selected = new Set((schedule?.displayIds ?? []).filter(id => authorized.has(id)));
    const unavailableCount = (schedule?.displayIds ?? []).filter(id => !authorized.has(id)).length;

    const name = h('input#schedule-name', { name: 'name', type: 'text', maxlength: '120', value: schedule?.name ?? '', autocomplete: 'off', spellcheck: 'false' });
    const playlist = selectBox({ id: 'schedule-playlist', label: 'Playlist', value: chosenPlaylist, disabled: editing, options: playlists.map(item => [item.id, item.name]), onChange: () => loadVersions() });
    const version = h('select#schedule-version', { aria: { label: 'Versão da playlist' } });
    const start = h('input#schedule-start', { name: 'start', type: 'datetime-local', value: toLocalInput(schedule?.startAt) });
    const end = h('input#schedule-end', { name: 'end', type: 'datetime-local', value: toLocalInput(schedule?.endAt) });
    const versionNote = h('small.field-note');
    const versionField = field({ label: 'Versão da playlist', control: version });
    const previewButton = button('Pré-visualizar esta versão', {
      icon: 'play', className: 'small', disabled: true,
      onClick: () => previewVersion(ctx, { id: playlist.value, name: playlists.find(item => item.id === playlist.value)?.name ?? '' }, Number(version.value))
    });
    versionField.append(versionNote, h('div.field-actions', previewButton));

    async function loadVersions(preferred) {
      const id = playlist.value;
      version.disabled = true;
      previewButton.disabled = true;
      try {
        let info = versionsCache.get(id);
        if (!info) { info = await ctx.api.get(`/api/playlists/${encodeURIComponent(id)}`); versionsCache.set(id, info); }
        if (!alive() || playlist.value !== id) return;
        const latest = info.latestVersion;
        mount(version, info.versions.map(item => h('option', { value: String(item.version) }, versionOptionLabel(item, latest))));
        const wanted = preferred ?? (editing && !preferLatest ? schedule.playlistVersion : latest);
        version.value = String(info.versions.some(item => item.version === wanted) ? wanted : latest);
        versionNote.textContent = Number(version.value) < latest ? `Há uma versão mais nova (${latest}). Esta programação continuará com a versão escolhida.` : '';
        version.disabled = false;
        previewButton.disabled = !info.versions.length;
      } catch (error) { if (alive()) showError(error, dialog); }
    }
    version.addEventListener('change', () => {
      const info = versionsCache.get(playlist.value);
      versionNote.textContent = info && Number(version.value) < info.latestVersion ? `Há uma versão mais nova (${info.latestVersion}). Esta programação continuará com a versão escolhida.` : '';
    });

    const rows = displays.map(display => {
      const usable = display.status === 'active' || selected.has(display.id);
      const input = h('input', { type: 'checkbox', checked: selected.has(display.id), disabled: !usable, aria: { label: `Exibir na TV ${display.name}` },
        on: { change: () => { if (input.checked) selected.add(display.id); else selected.delete(display.id); count.textContent = plural(selected.size, 'TV selecionada', 'TVs selecionadas'); } } });
      return h('div.schedule-tv-choice',
        h('label.check-item', { class: { disabled: !usable } }, input, h('span', h('b', display.name),
          h('small', usable ? CONNECTION_LABELS[display.connection] ?? '' : 'Um administrador precisa ativar esta TV'))),
        button('Ver sequência', { icon: 'list', className: 'small', aria: { label: `Ver sequência da TV ${display.name}` }, onClick: () => openDisplaySequence(ctx, display) }));
    });
    const count = h('span.muted.small', { role: 'status' }, plural(selected.size, 'TV selecionada', 'TVs selecionadas'));

    dialog.setBody(
      editing && preferLatest ? notice('Escolha a versão da playlist que esta programação deve usar. Programações no ar continuam com a versão atual até você salvar.', { tone: 'info', className: 'mb' }) : null,
      live ? notice('Esta programação já foi publicada. As alterações valem a partir de agora e o servidor confere de novo se tudo está liberado.', { tone: 'info', iconName: 'info', className: 'mb' }) : null,
      h('div.form-grid',
        field({ label: 'Nome da programação', control: name, full: true, hint: 'Ex.: Avisos de agosto — Recepção.' }),
        field({ label: 'Playlist', control: playlist, hint: editing ? 'Para trocar de playlist, crie uma nova programação.' : 'Só aparecem playlists com versão publicada.' }),
        versionField,
        field({ label: 'Início (opcional)', control: start, hint: 'Vazio = começa assim que for publicada.' }),
        field({ label: 'Término (opcional)', control: end, hint: 'Vazio = sem data de término.' })),
      h('p.field-label.mt', 'TVs autorizadas da unidade'),
      notice('Uma TV pode exibir programações de vários setores. Sua programação entra na sequência compartilhada; administradores controlam a ordem global. Seus arquivos continuam restritos ao seu setor.', { tone: 'info', className: 'mb' }),
      unavailableCount ? notice(`${unavailableCount} TV(s) desta programação não estão mais autorizadas neste espaço e serão retiradas da seleção ao salvar. Peça a um administrador a revisão dos acessos, se necessário.`, { tone: 'warning', className: 'mb' }) : null,
      displays.length
        ? h('div.selection-list', rows)
        : notice(canManageDisplays(ctx.user)
          ? ['Nenhuma TV autorizada nesta unidade. ', h('a.subtle-link.inline', { href: ctx.link('displays'), on: { click: () => dialog.close() } }, 'Cadastre e compartilhe em Telas'), '.']
          : 'Nenhuma TV está autorizada para sua conta ou setor nesta unidade. Peça a um administrador o acesso à TV antes de publicar.', { tone: 'info', iconName: 'monitor' }),
      h('div.row-between', count),
      h('p.muted.small.mt', `Horários no fuso deste navegador${zone() ? ` (${zone()})` : ''}. Fora do período, o player deixa de exibir o conteúdo.`));

    const gather = publish => ({
      name: name.value, playlistId: playlist.value, startAt: fromLocalInput(start.value), endAt: fromLocalInput(end.value), displayIds: [...selected], publish
    });

    async function submit(publish, trigger) {
      const values = gather(publish);
      const problems = validateSchedule({ ...values, publish: publish || (editing && schedule.status === 'published') });
      if (problems.length) { dialog.setError(problems.join(' ')); return; }
      dialog.clearError();
      const send = () => (editing
        ? ctx.api.patch(`/api/schedules/${encodeURIComponent(schedule.id)}`, {
          rev: schedule.rev, name: values.name.trim(), playlistVersion: Number(version.value), startAt: values.startAt, endAt: values.endAt, displayIds: values.displayIds
        })
        : ctx.api.post('/api/schedules', {
          unitId: space.unitId, sectorId: space.sectorId, name: values.name.trim(), playlistId: values.playlistId, playlistVersion: Number(version.value),
          startAt: values.startAt, endAt: values.endAt, displayIds: values.displayIds, publish
        }));
      // A requisição só sai dentro de runBusy: com o botão já ocupado (duplo clique) nada é enviado duas vezes.
      const result = await runBusy(trigger, () => send().catch(error => { throw friendly(error); }), { dialog });
      if (result) dialog.close(result);
    }

    const save = button(editing ? (live ? 'Salvar alterações' : 'Salvar rascunho') : 'Salvar como rascunho', { primary: editing || !canPublish, icon: 'check', onClick: () => submit(false, save) });
    const publish = !editing && canPublish ? button('Publicar agora', { primary: true, icon: 'upload', onClick: () => submit(true, publish) }) : null;
    dialog.setFooter(button('Cancelar', { onClick: () => dialog.close() }), save, publish);
    name.focus();
    loadVersions();
  }

  return dialog.closed;
}
