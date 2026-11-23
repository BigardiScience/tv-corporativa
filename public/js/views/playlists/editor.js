// Editor de playlist: monta o RASCUNHO (conteúdos da biblioteca, ordem, tempo e transição), salva com controle de conflito
// e publica versões. O rascunho nunca afeta uma TV: só uma programação publicada, apontando para uma versão, vai ao ar.
// A tela esconde o que a pessoa não pode usar, mas cada chamada é conferida de novo pelo servidor.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { anyDialogOpen, confirmDialog } from '../../ui/dialogs.js';
import { badge, button, emptyState, field, notice, pageHeading, tones } from '../../ui/components.js';
import { runBusy, showError } from '../../ui/feedback.js';
import { toast } from '../../ui/toast.js';
import { canIn } from '../../lib/permissions.js';
import { SCHEDULE_STATE_LABELS, plural } from '../../lib/format.js';
import { LOOP_HELP, clampTransitionMs, cycleSentence, fromServer, newItem, snapshot, toPayloadItems, validateDraft } from '../../lib/playlist-model.js';
import { EFFECT_LABELS } from '../../playback/effects.js';
import { moveItem, removeAt } from '../../lib/reorder.js';
import { spaceLabel } from '../shared.js';
import { playlistStatus } from './index.js';
import { focusItemAction, renderItems } from './items.js';
import { openMediaPicker } from './picker.js';
import { openPublishDialog } from './publish.js';
import { restoreVersion, versionsPanel, viewVersion } from './versions.js';
import { openPreview } from './preview.js';
import { openEffectDemo } from './effect-demo.js';

export async function mountPlaylistEditor(ctx, route, container, view) {
  const id = route.params.id;
  let server;
  try {
    server = await ctx.api.get(`/api/playlists/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error?.status === 404 && view.alive()) { toast('Esta playlist não existe mais.', { kind: 'error' }); ctx.navigate('playlists'); return; }
    throw error;
  }
  if (!view.alive()) return;

  const scope = () => ({ unitId: server.unitId, sectorId: server.sectorId });
  const can = permission => canIn(ctx.user, permission, scope());
  const editable = can('playlist:update'), canPublish = can('playlist:publish'), canSchedule = can('schedule:create');
  const production = ctx.state.mode === 'production';

  let draft, saved, savedCount;
  const adopt = next => { server = next; draft = fromServer(next); saved = snapshot(draft); savedCount = draft.items.length; };
  adopt(server);
  const dirty = () => editable && snapshot(draft) !== saved;
  const limit = () => Math.max(server.maxItems, savedCount);

  // ---- peças da tela -----------------------------------------------------------------------------------------------------
  const nameInput = h('input#playlist-name', { name: 'name', type: 'text', maxlength: '120', value: draft.name, disabled: !editable, autocomplete: 'off', spellcheck: 'false' });
  const descriptionInput = h('textarea#playlist-description', { name: 'description', rows: '2', maxlength: '500', value: draft.description, disabled: !editable });
  const loopInput = h('input#playlist-loop', { name: 'loop', type: 'checkbox', checked: draft.loop, disabled: !editable, aria: { describedby: 'playlist-loop-note' } });
  const loopNote = h('small#playlist-loop-note', LOOP_HELP[draft.loop ? 'on' : 'off']);
  const problemsBox = h('div.notice.danger', { role: 'alert', hidden: true });
  const live = h('div.sr-only', { role: 'status', aria: { live: 'polite' } });
  const saveState = h('span.save-state');
  const summary = h('p.pl-summary');
  const itemsHost = h('div.pl-host');
  const sideHost = h('aside.pl-side');
  const statusHost = h('div.pl-status');

  const saveButton = button('Salvar rascunho', { icon: 'check', onClick: () => save(), aria: { keyshortcuts: 'Control+S' } });
  const publishButton = button('Publicar versão', { icon: 'upload', onClick: () => publish() });
  const previewButton = button('Pré-visualizar', { icon: 'play', className: 'keep', onClick: () => openPreview(ctx, { items: draft.items, loop: draft.loop }) });
  const addButton = button('Adicionar da biblioteca', { primary: true, icon: 'plus', onClick: () => addFromLibrary() });

  const heading = pageHeading({
    eyebrow: spaceLabel(ctx, scope()).toUpperCase(), title: server.name,
    description: 'Monte o rascunho, confira e publique uma versão. Só uma programação publicada leva a playlist às TVs.',
    actions: [editable ? saveButton : null, canPublish ? publishButton : null, previewButton].filter(Boolean)
  });
  const titleEl = heading.querySelector('h1');

  // ---- estado visual -----------------------------------------------------------------------------------------------------
  function showProblems(list) {
    mount(problemsBox, icon('alert'), h('div', h('b', 'Corrija antes de salvar:'), h('ul', list.map(text => h('li', text)))));
    problemsBox.hidden = false;
    problemsBox.scrollIntoView?.({ block: 'nearest' });
  }
  const hideProblems = () => { problemsBox.hidden = true; mount(problemsBox); };

  function updateStatus() {
    const isDirty = dirty();
    saveButton.disabled = !editable || !isDirty;
    saveButton.classList.toggle('primary', isDirty);
    saveState.textContent = !editable ? 'Somente leitura' : isDirty ? 'Alterações não salvas' : 'Tudo salvo';
    saveState.classList.toggle('dirty', isDirty);
    summary.textContent = `${draft.items.length} de ${server.maxItems} ${server.maxItems === 1 ? 'conteúdo' : 'conteúdos'} · ${cycleSentence(draft.items)}`;
    addButton.disabled = !editable || draft.items.length >= limit();
    addButton.title = addButton.disabled && editable ? `Esta playlist já tem o máximo de ${server.maxItems} conteúdos.` : '';
    previewButton.disabled = draft.items.length === 0;
    const nothingNew = !isDirty && server.latestVersion > 0 && !server.hasUnpublishedChanges;
    publishButton.disabled = !draft.items.length || nothingNew;
    publishButton.title = nothingNew ? 'Não há alterações novas desde a última versão publicada.' : '';
    publishButton.classList.toggle('primary', !isDirty && !publishButton.disabled);
    if (!isDirty) hideProblems();
  }

  const announce = message => { live.textContent = ''; setTimeout(() => { live.textContent = message; }, 20); };

  const handlers = {
    edit: () => updateStatus(),
    move(from, to, focus) {
      const item = draft.items[from];
      if (!item) return;
      draft.items = moveItem(draft.items, from, to);
      drawItems(focus ? { key: item.key, action: focus } : null);
      updateStatus();
      announce(`“${item.media.title}” agora é o item ${draft.items.indexOf(item) + 1} de ${draft.items.length}.`);
    },
    remove(index) {
      const item = draft.items[index];
      if (!item) return;
      draft.items = removeAt(draft.items, index);
      drawItems();
      updateStatus();
      announce(`“${item.media.title}” removido da playlist.`);
      const removers = itemsHost.querySelectorAll('[data-action="remove"]');
      (removers[Math.min(index, removers.length - 1)] ?? addButton).focus?.();
    },
    // Abre a demonstração dos efeitos começando pelo efeito deste conteúdo; se a pessoa escolher "Usar este efeito", ele vale para o conteúdo.
    async demo(index) {
      const item = draft.items[index];
      if (!item) return;
      const picked = await openEffectDemo(ctx, { effect: item.transition, ms: item.transitionMs, canApply: editable });
      if (!picked || !view.alive() || !draft.items.includes(item)) return;
      item.transition = picked.effect;
      item.transitionMs = picked.effect === 'cut' ? 0 : clampTransitionMs(picked.ms);
      drawItems({ key: item.key, action: 'demo' });
      updateStatus();
      announce(`Efeito de “${item.media.title}”: ${EFFECT_LABELS[item.transition]}${item.transition === 'cut' ? '' : `, ${item.transitionMs} ms`}.`);
    }
  };

  function drawItems(focus) {
    if (!draft.items.length) {
      mount(itemsHost, emptyState({
        iconName: 'list', title: 'Nenhum conteúdo ainda',
        text: editable ? 'Adicione imagens, vídeos ou PDFs aprovados da biblioteca. Você define a ordem, o tempo e a transição de cada um.' : 'Esta playlist ainda não tem conteúdos.',
        actions: editable ? [button('Adicionar da biblioteca', { primary: true, icon: 'plus', onClick: () => addFromLibrary() })] : []
      }));
      return;
    }
    const list = renderItems(ctx, { items: draft.items, editable, handlers });
    mount(itemsHost, list);
    if (focus) focusItemAction(list, focus.key, focus.action);
  }

  function drawStatus() {
    mount(statusHost,
      playlistStatus(server),
      server.latestVersion && server.hasUnpublishedChanges ? h('small.muted', `O rascunho tem alterações em relação à versão ${server.latestVersion}.`) : null,
      saveState,
      canSchedule && server.latestVersion > 0
        ? button('Programar esta playlist', { icon: 'calendar', className: 'small', onClick: () => ctx.navigate('schedules', {}, { playlist: server.id, nova: '1' }) })
        : null);
  }

  function drawSide() {
    const using = server.schedules;
    mount(sideHost,
      versionsPanel(ctx, {
        playlist: server, canRestore: editable,
        handlers: { view: number => viewVersion(ctx, server, number), restore: number => restore(number) }
      }),
      h('section.panel',
        h('div.panel-head', h('div', h('h2', 'Programações'), h('small', 'Quando e onde esta playlist toca.')), icon('calendar')),
        using.length
          ? h('ul.version-list', using.map(schedule => h('li.version-item',
            h('div.version-top', h('a.row-link', { href: ctx.link('schedules', {}, { playlist: server.id }) }, schedule.name),
              badge(SCHEDULE_STATE_LABELS[schedule.status] ?? schedule.status, tones.schedule[schedule.status] ?? 'neutral')),
            h('small', `Usa a versão ${schedule.version}`))))
          : h('div.panel-pad', h('p.muted.small', 'Nenhuma programação usa esta playlist ainda.'))));
  }

  function drawAll() {
    titleEl.textContent = server.name;
    nameInput.value = draft.name;
    descriptionInput.value = draft.description;
    loopInput.checked = draft.loop;
    loopNote.textContent = LOOP_HELP[draft.loop ? 'on' : 'off'];
    drawStatus();
    drawItems();
    drawSide();
    updateStatus();
  }

  // ---- ações -------------------------------------------------------------------------------------------------------------
  async function reloadFromServer() {
    const fresh = await ctx.api.get(`/api/playlists/${encodeURIComponent(id)}`);
    if (!view.alive()) return;
    adopt(fresh);
    drawAll();
    toast('Playlist atualizada com a versão mais recente.');
  }

  async function conflictDialog() {
    const reload = await confirmDialog({
      title: 'Outra pessoa alterou esta playlist', danger: true, confirmLabel: 'Carregar a versão mais recente', cancelLabel: 'Manter minha edição na tela',
      message: 'Para não apagar o trabalho dela, o servidor não aceitou o seu salvamento. Você pode carregar a versão mais recente (suas alterações não salvas serão descartadas) ou manter sua edição na tela para copiar o que for necessário.'
    });
    if (reload) {
      try { await reloadFromServer(); } catch (error) { showError(error); }
    }
  }

  async function save() {
    if (!editable) return false;
    draft.name = nameInput.value;
    draft.description = descriptionInput.value;
    const problems = validateDraft(draft, limit());
    if (problems.length) { showProblems(problems); (nameInput.value.trim() ? saveButton : nameInput).focus(); return false; }
    hideProblems();
    const result = await runBusy(saveButton, async () => {
      try {
        return await ctx.api.patch(`/api/playlists/${encodeURIComponent(id)}`, {
          rev: server.draftRev, name: draft.name.trim(), description: draft.description.trim(), loop: draft.loop, items: toPayloadItems(draft.items)
        });
      } catch (error) {
        if (error?.code === 'REVISION_CONFLICT') { await conflictDialog(); return null; }
        throw error;
      }
    });
    if (!result || !view.alive()) return false;
    adopt(result);
    drawAll();
    toast('Rascunho salvo.');
    return true;
  }

  async function addFromLibrary() {
    if (!editable) return;
    const inPlaylist = new Map();
    for (const item of draft.items) inPlaylist.set(item.mediaId, (inPlaylist.get(item.mediaId) ?? 0) + 1);
    const chosen = await openMediaPicker(ctx, { space: scope(), remaining: Math.max(0, limit() - draft.items.length), inPlaylist });
    if (!chosen?.length || !view.alive()) return;
    for (const media of chosen) draft.items.push(newItem(media, { production }));
    drawItems();
    updateStatus();
    announce(`${plural(chosen.length, 'conteúdo adicionado', 'conteúdos adicionados')} ao fim da playlist.`);
  }

  async function publish() {
    if (!canPublish) return;
    if (dirty() && !(await save())) return;
    if (!view.alive()) return;
    const result = await openPublishDialog(ctx, { playlist: server });
    if (!result || !view.alive()) return;
    adopt(result);
    drawAll();
    toast(`Versão ${result.latestVersion} publicada. Use “Programar esta playlist” para levá-la às TVs.`);
  }

  async function restore(number) {
    let result;
    try {
      result = await restoreVersion(ctx, server, number, { rev: server.draftRev, dirty: dirty() });
    } catch (error) {
      if (error?.code === 'REVISION_CONFLICT') await conflictDialog(); else showError(error);
      return;
    }
    if (!result || !view.alive()) return;
    adopt(result);
    drawAll();
  }

  // ---- montagem ----------------------------------------------------------------------------------------------------------
  nameInput.addEventListener('input', () => { draft.name = nameInput.value; updateStatus(); });
  descriptionInput.addEventListener('input', () => { draft.description = descriptionInput.value; updateStatus(); });
  loopInput.addEventListener('change', () => {
    draft.loop = loopInput.checked;
    loopNote.textContent = LOOP_HELP[draft.loop ? 'on' : 'off'];
    updateStatus();
    announce(draft.loop ? 'Repetição contínua ligada.' : 'Repetição contínua desligada. A TV exibirá a sequência uma vez.');
  });
  const onKey = event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editable && !anyDialogOpen()) { event.preventDefault(); if (!saveButton.disabled) save(); }
  };
  globalThis.document.addEventListener('keydown', onKey);
  view.onDispose(() => globalThis.document.removeEventListener('keydown', onKey));
  view.setBlocker(() => (dirty() ? 'Há alterações não salvas nesta playlist. Se você sair agora, elas serão perdidas.' : null));

  const current = ctx.state.space;
  const elsewhere = current && (current.unitId !== server.unitId || current.sectorId !== server.sectorId);

  mount(container,
    h('a.back-link', { href: ctx.link('playlists') }, icon('arrow', 'turned'), 'Todas as playlists'),
    heading,
    statusHost,
    problemsBox,
    elsewhere ? notice(`Esta playlist é de ${spaceLabel(ctx, scope())}, diferente do espaço escolhido no menu. Os arquivos disponíveis para adicionar são os desse espaço.`, { tone: 'info', iconName: 'building', className: 'mb' }) : null,
    !editable ? notice('Você pode consultar esta playlist, mas seu perfil não permite editá-la.', { tone: 'info', iconName: 'lock', className: 'mb' })
      : !canPublish ? notice('Você prepara o rascunho; a publicação de versões é feita por um Gestor ou pela TI.', { tone: 'info', iconName: 'lock', className: 'mb' }) : null,
    live,
    h('div.pl-layout',
      h('div.pl-main',
        h('section.panel',
          h('div.panel-head', h('div', h('h2', 'Dados da playlist'), h('small', 'Nome e descrição ajudam a equipe a reconhecer o que é cada playlist.'))),
          h('div.panel-pad', h('div.form-grid',
            field({ label: 'Nome', control: nameInput, full: true }),
            field({ label: 'Descrição (opcional)', control: descriptionInput, full: true })))),
        h('section.panel',
          h('div.panel-head', h('div', h('h2', 'Conteúdos'), summary), editable ? addButton : null),
          h('div.panel-pad',
            notice('A transição é a forma como cada conteúdo entra, depois do anterior. Use “Ver efeito” para comparar os efeitos e “Pré-visualizar” para ver a playlist inteira. Em aparelhos lentos, ou quando o sistema pede menos movimento, o player simplifica o efeito (esmaecer ou corte seco) para manter a exibição fluida. Teste sempre em uma TV antes de divulgar.', { tone: 'info', iconName: 'info', className: 'mb' }),
            h('div.pl-loop',
              h('label.pl-loop-label', { for: 'playlist-loop' }, loopInput, h('span', 'Repetir a playlist continuamente')),
              loopNote),
            itemsHost))),
      sideHost));

  drawAll();
}
