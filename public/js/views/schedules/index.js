// Programações: QUANDO e em QUAIS TVs uma versão publicada de playlist toca. O conteúdo vem da playlist (tela Playlists).
// A interface só oferece as ações que fazem sentido para o estado da programação; quem decide o que cada pessoa
// pode fazer é sempre o servidor (permissão + unidade + setor), que também confere tudo de novo ao publicar.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, button, emptyState, notice, pageHeading, tones } from '../../ui/components.js';
import { showError } from '../../ui/feedback.js';
import { toast } from '../../ui/toast.js';
import { SCHEDULE_STATE_LABELS, plural } from '../../lib/format.js';
import { STATE_FILTERS, matchesState, scheduleActions, tileOf, windowLabel } from '../../lib/schedule-model.js';
import { actionDialog, needSpace, selectBox, spaceLabel } from '../shared.js';
import { openScheduleForm } from './form.js';

const PAGE = 200, MAX_PAGES = 5;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const enc = encodeURIComponent;

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

// A situação "no ar / agendada / encerrada" depende da hora, então o filtro é feito aqui, sobre tudo o que o espaço tem (até 1000).
async function fetchAll(ctx, space, playlistId) {
  const schedules = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await ctx.api.get('/api/schedules', { query: { unitId: space.unitId, sectorId: space.sectorId, playlistId, limit: PAGE, offset: schedules.length } });
    schedules.push(...data.schedules);
    total = data.total;
    if (!data.schedules.length || schedules.length >= total) break;
  }
  return { schedules, total };
}

const tvNames = displays => displays.map(display => display.linkStatus === 'suspended'
  ? `${display.name} (vínculo suspenso)` : display.status === 'active' ? display.name : `${display.name} (aguardando ativação)`);

function tvSummary(displays) {
  if (!displays.length) return 'Nenhuma TV selecionada';
  const names = tvNames(displays);
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}`;
}

export async function mountSchedules(ctx, route, container, view) {
  const { space } = ctx.state;
  if (!space) { needSpace(ctx, container, { title: 'Programações', description: 'Quando e em quais TVs cada playlist é exibida.' }); return; }

  const canCreate = ctx.canHere('schedule:create'), canPublish = ctx.canHere('schedule:publish');
  let playlistFilter = ID.test(route.query.playlist ?? '') ? route.query.playlist : null, playlistName = '';
  let stateFilter = STATE_FILTERS.some(([value]) => value === route.query.situacao) ? route.query.situacao : '';
  let data = null, requestId = 0;

  const results = h('div.schedule-results');
  const count = h('p.library-count', { role: 'status' });
  const filterNote = h('div.filter-note', { hidden: true });
  const stateSelect = selectBox({
    id: 'schedule-state', label: 'Filtrar por situação', value: stateFilter, options: STATE_FILTERS,
    onChange: value => { stateFilter = value; syncUrl(); draw(); }
  });

  const syncUrl = () => ctx.replaceUrl('schedules', {}, { playlist: playlistFilter, situacao: stateFilter });

  async function load({ silent = false } = {}) {
    const id = ++requestId;
    if (!silent) results.setAttribute('aria-busy', 'true');
    try {
      const [next, playlist] = await Promise.all([
        fetchAll(ctx, space, playlistFilter),
        playlistFilter ? ctx.api.get(`/api/playlists/${enc(playlistFilter)}`).catch(() => null) : null
      ]);
      if (id !== requestId || !view.alive()) return;
      data = next;
      playlistName = playlist?.name ?? data.schedules[0]?.playlistName ?? '';
      draw();
    } catch (error) {
      if (id !== requestId || !view.alive()) return;
      if (data) { if (!silent) showError(error); return; }
      mount(results, emptyState({
        iconName: 'alert', title: 'Não foi possível carregar as programações', text: error?.message,
        actions: [button('Tentar novamente', { primary: true, icon: 'refresh', onClick: () => load() })]
      }));
    } finally {
      if (id === requestId) results.removeAttribute('aria-busy');
    }
  }

  // Depois de qualquer ação (mesmo cancelada ou recusada) a lista é relida: outra pessoa pode ter alterado a programação.
  async function afterAction(finished, message) {
    const result = await finished;
    if (!view.alive()) return;
    if (result !== undefined && message) toast(typeof message === 'function' ? message(result) : message);
    await load({ silent: true });
  }

  const create = () => afterAction(
    openScheduleForm(ctx, { space, playlistId: playlistFilter, canPublish }),
    saved => (saved.status === 'published'
      ? (saved.state === 'scheduled' ? 'Programação publicada. Ela começa no horário definido.' : 'Programação publicada. As TVs passam a exibi-la na próxima atualização do player.')
      : 'Rascunho salvo. Publique quando estiver pronta.')
  );

  const edit = (schedule, { preferLatest = false } = {}) => afterAction(
    openScheduleForm(ctx, { space, schedule, preferLatest, canPublish }),
    preferLatest ? 'Versão da playlist atualizada nesta programação.' : 'Alterações salvas.'
  );

  const publish = schedule => afterAction(actionDialog({
    title: 'Publicar esta programação?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Publicar programação', iconName: 'upload', size: 'normal',
    message: `“${schedule.name}” será enviada às TVs abaixo. O servidor confere de novo se os conteúdos e as TVs estão liberados.`,
    details: [`Playlist: ${schedule.playlistName ?? '—'}, versão ${schedule.playlistVersion}`, `Período: ${windowLabel(schedule)}`, `TVs: ${tvSummary(schedule.displays)}`],
    run: () => ctx.api.post(`/api/schedules/${enc(schedule.id)}/publish`, { rev: schedule.rev })
  }), saved => (saved.state === 'scheduled' ? 'Programação publicada. Ela começa no horário definido.' : 'Programação publicada.'));

  const stop = schedule => afterAction(actionDialog({
    title: 'Interromper esta programação?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Interromper programação', iconName: 'stop', danger: true,
    message: `“${schedule.name}” deixa de ser exibida nas TVs. Você pode publicá-la de novo depois, sem perder nada.`,
    details: [`TVs: ${tvSummary(schedule.displays)}`],
    run: () => ctx.api.post(`/api/schedules/${enc(schedule.id)}/stop`, {})
  }), 'Programação interrompida.');

  const remove = schedule => afterAction(actionDialog({
    title: 'Excluir esta programação?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Excluir programação', danger: true,
    message: `“${schedule.name}” será excluída. A playlist e os arquivos da biblioteca não são afetados.`,
    run: () => ctx.api.delete(`/api/schedules/${enc(schedule.id)}`)
  }), 'Programação excluída.');

  function row(schedule) {
    const allowed = scheduleActions(schedule, { canCreate, canPublish });
    const tile = tileOf(schedule);
    const label = text => `${text} a programação ${schedule.name}`;
    const suspended = schedule.displays.filter(display => display.linkStatus === 'suspended').length;
    const buttons = [
      allowed.publish ? button('Publicar', { primary: true, icon: 'upload', className: 'small', aria: { label: label('Publicar') }, onClick: () => publish(schedule) }) : null,
      allowed.stop ? button('Interromper', { icon: 'stop', className: 'small', aria: { label: label('Interromper') }, onClick: () => stop(schedule) }) : null,
      allowed.updateVersion ? button('Atualizar versão', { icon: 'refresh', className: 'small', aria: { label: `Atualizar a versão da playlist da programação ${schedule.name}` }, onClick: () => edit(schedule, { preferLatest: true }) }) : null,
      allowed.edit ? button('Editar', { icon: 'edit', className: 'small', aria: { label: label('Editar') }, onClick: () => edit(schedule) }) : null,
      allowed.remove ? h('button.icon-button.act-delete', { type: 'button', title: 'Excluir', aria: { label: label('Excluir') }, on: { click: () => remove(schedule) } }, icon('trash')) : null
    ];
    return h('article.schedule-row', { dataset: { scheduleId: schedule.id, state: schedule.state } },
      h('div.schedule-date', h('b', tile.day ?? icon('play')), h('span', tile.month)),
      h('div.schedule-details',
        h('h3', schedule.name),
        h('p', 'Playlist: ', h('a.subtle-link.inline', { href: ctx.link('playlist', { id: schedule.playlistId }) }, schedule.playlistName ?? '—'), ` · versão ${schedule.playlistVersion}`,
          schedule.newerVersionAvailable ? h('span.chip.new-version', { title: 'A playlist já tem uma versão mais nova. Esta programação continua com a versão escolhida.' }, icon('refresh'), 'Há versão mais nova') : null),
        h('p.sched-line', icon('clock'), windowLabel(schedule)),
        h('p.sched-line', icon('monitor'), tvSummary(schedule.displays)),
        suspended ? h('p.sched-suspension', `${plural(suspended, 'vínculo suspenso', 'vínculos suspensos')}: não exibem esta programação. Revise os acessos com um administrador, interrompa a programação e publique novamente com uma conta autorizada. Editar o nome ou período não retoma o vínculo. A situação geral não confirma a exibição em cada TV.`) : null),
      h('div.actions', badge(SCHEDULE_STATE_LABELS[schedule.state] ?? schedule.state, tones.schedule[schedule.state]), buttons));
  }

  function drawFilterNote() {
    filterNote.hidden = !playlistFilter;
    mount(filterNote, playlistFilter ? [icon('list'), h('span', playlistName ? `Mostrando só as programações da playlist “${playlistName}”.` : 'Mostrando só as programações de uma playlist.'),
      button('Ver todas', { className: 'small', onClick: () => { playlistFilter = null; playlistName = ''; syncUrl(); load(); } })] : []);
  }

  function draw() {
    drawFilterNote();
    const all = data.schedules, visible = all.filter(item => matchesState(item, stateFilter));
    const stateLabel = STATE_FILTERS.find(([value]) => value === stateFilter)?.[1]?.toLowerCase();
    count.textContent = all.length
      ? `${plural(visible.length, 'programação', 'programações')}${stateFilter ? ` (${stateLabel})` : ''}${data.total > all.length ? ` · mostrando as primeiras ${all.length} de ${data.total}` : ''}`
      : '';
    if (!all.length) {
      mount(results, emptyState({
        iconName: 'calendar', title: 'Sua próxima mensagem começa aqui.',
        text: canCreate
          ? 'Escolha uma versão publicada de playlist, as TVs de destino e o período de exibição.'
          : 'Quando alguém criar uma programação neste espaço, ela aparecerá aqui.',
        actions: canCreate ? [button('Criar programação', { primary: true, icon: 'plus', onClick: create })] : []
      }));
      return;
    }
    if (!visible.length) {
      mount(results, emptyState({ iconName: 'search', title: 'Nenhuma programação nesta situação', text: 'Escolha outra situação no filtro para ver as demais.' }));
      return;
    }
    mount(results, h('div.calendar-list', visible.map(row)));
  }

  view.refresh = () => load({ silent: true });

  mount(container,
    pageHeading({
      eyebrow: spaceLabel(ctx, space).toUpperCase(), title: 'Programações',
      description: 'Defina quando e em quais TVs cada playlist publicada é exibida.',
      actions: canCreate ? [button('Nova programação', { primary: true, icon: 'plus', onClick: create })] : []
    }),
    notice(`Horários exibidos no fuso deste navegador${zone() ? ` (${zone()})` : ''}. Fora do período, o player deixa de exibir o conteúdo.`, { tone: 'info', iconName: 'clock', className: 'mb' }),
    !canCreate ? notice('Seu perfil pode consultar as programações, mas não criá-las. Peça a um Gestor do seu setor.', { tone: 'info', iconName: 'info', className: 'mb' })
      : (!canPublish ? notice('Você cria rascunhos, mas a publicação depende de quem tem essa permissão.', { tone: 'info', iconName: 'info', className: 'mb' }) : null),
    h('div.toolbar', stateSelect),
    filterNote, count, results);

  await load();
  if (route.query.nova === '1' && canCreate && view.alive()) {
    ctx.replaceUrl('schedules', {}, { playlist: playlistFilter, situacao: stateFilter });
    create();
  }
}
