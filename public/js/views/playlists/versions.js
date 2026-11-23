// Histórico de versões publicadas de uma playlist: ver o conteúdo de uma versão e restaurá-la no rascunho.
// Restaurar copia a versão para o rascunho; não publica nada e não muda o que está no ar.
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { confirmDialog, openModal } from '../../ui/dialogs.js';
import { badge, button, emptyState, notice, tones } from '../../ui/components.js';
import { showError } from '../../ui/feedback.js';
import { toast } from '../../ui/toast.js';
import { READINESS_LABELS, SCHEDULE_STATE_LABELS, formatDateTime, plural } from '../../lib/format.js';
import { cycleLabel, describeItem } from '../../lib/playlist-model.js';
import { openPreview } from './preview.js';

const scheduleBadge = schedule => badge(SCHEDULE_STATE_LABELS[schedule.status] ?? schedule.status, tones.schedule[schedule.status] ?? 'neutral');

// Painel lateral com a lista de versões. `handlers`: view(versionNumber) · restore(versionNumber)
export function versionsPanel(ctx, { playlist, canRestore, handlers }) {
  const head = h('div.panel-head', h('div', h('h2', 'Versões publicadas'), h('small', 'Cada publicação gera uma cópia fixa.')), icon('history'));
  if (!playlist.versions.length) {
    return h('section.panel', head, h('div.panel-pad', h('p.muted.small', 'Nenhuma versão publicada ainda. Quando estiver pronta, use “Publicar versão”.')));
  }
  return h('section.panel', head, h('ul.version-list', playlist.versions.map(version => {
    const using = playlist.schedules.filter(schedule => schedule.version === version.version);
    return h('li.version-item',
      h('div.version-top', h('b', `Versão ${version.version}`),
        version.version === playlist.latestVersion ? badge('Mais recente') : null),
      h('small', `${formatDateTime(version.publishedAt)} · ${plural(version.itemCount, 'conteúdo', 'conteúdos')}`),
      version.note ? h('p.version-note', version.note) : null,
      using.length ? h('p.version-using', h('span', 'Usada em: '), using.map(schedule => [h('a.subtle-link.inline', { href: ctx.link('schedules', {}, { playlist: playlist.id }) }, schedule.name), ' ', scheduleBadge(schedule), ' '])) : null,
      h('div.version-actions',
        button('Ver conteúdo', { icon: 'eye', className: 'small', onClick: () => handlers.view(version.version), aria: { label: `Ver o conteúdo da versão ${version.version}` } }),
        canRestore ? button('Restaurar no rascunho', { icon: 'history', className: 'small', onClick: () => handlers.restore(version.version), aria: { label: `Restaurar a versão ${version.version} no rascunho` } }) : null));
  })));
}

const openVersionPreview = (ctx, playlist, number, data) => openPreview(ctx, {
  items: data.items, loop: data.loop !== false, title: `Pré-visualizar a versão ${number}`,
  subtitle: `${playlist.name} · sequência e tempo desta versão publicada, neste computador.`
});

// Abre a pré-visualização de uma versão publicada sem passar pela janela de detalhes (usada também ao criar uma programação).
export async function previewVersion(ctx, playlist, number) {
  let data;
  try {
    data = await ctx.api.get(`/api/playlists/${encodeURIComponent(playlist.id)}/versions/${number}`);
  } catch (error) {
    showError(error);
    return undefined;
  }
  return openVersionPreview(ctx, playlist, number, data);
}

export async function viewVersion(ctx, playlist, number) {
  const dialog = openModal({
    title: `Versão ${number}`, subtitle: playlist.name, size: 'normal',
    body: [h('div.loading', { role: 'status' }, h('span.spinner', { aria: { hidden: 'true' } }), ' Carregando…')],
    footer: [button('Fechar', { primary: true, onClick: () => dialog.close() })]
  });
  try {
    const data = await ctx.api.get(`/api/playlists/${encodeURIComponent(playlist.id)}/versions/${number}`);
    if (!dialog.el.isConnected) return;
    dialog.setBody(
      h('div.review-line', h('span', 'Publicada em'), h('b', formatDateTime(data.publishedAt))),
      h('div.review-line', h('span', 'Duração de um ciclo'), h('b', cycleLabel(data.items))),
      h('div.review-line', h('span', 'Repetição'), h('b', data.loop === false ? 'Uma vez, mantendo o último conteúdo' : 'Contínua')),
      data.note ? h('div.review-line', h('span', 'Nota'), h('b', data.note)) : null,
      h('ol.publish-list', data.items.map((item, index) => h('li.publish-item', { class: { bad: item.readiness !== 'ready' } },
        h('span.publish-num', String(index + 1)),
        h('span.publish-title', item.media.title),
        h('small', describeItem(item)),
        item.readiness !== 'ready' ? badge(READINESS_LABELS[item.readiness] ?? item.readiness, tones.readiness[item.readiness]) : null))),
      data.items.some(item => item.readiness !== 'ready')
        ? notice('Há conteúdos desta versão que não estão mais liberados (excluídos ou sem aprovação). Eles aparecem marcados e impedem publicar uma programação com esta versão.', { tone: 'warn', iconName: 'alert', className: 'mt' })
        : null);
    dialog.setFooter(
      button('Pré-visualizar', { icon: 'play', onClick: () => openVersionPreview(ctx, playlist, number, data) }),
      button('Fechar', { primary: true, onClick: () => dialog.close() }));
  } catch (error) {
    if (dialog.el.isConnected) dialog.setBody(emptyState({ iconName: 'alert', title: 'Não foi possível abrir a versão', text: error?.message }));
  }
  return dialog.closed;
}

// Devolve a playlist atualizada pelo servidor (ou undefined se a pessoa desistir ou houver erro).
export async function restoreVersion(ctx, playlist, number, { rev, dirty }) {
  const ok = await confirmDialog({
    title: `Restaurar a versão ${number} no rascunho?`, confirmLabel: 'Restaurar no rascunho', danger: true,
    message: dirty
      ? 'O rascunho atual, incluindo as alterações que você ainda não salvou, será substituído pelo conteúdo desta versão.'
      : 'O rascunho atual será substituído pelo conteúdo desta versão.',
    note: 'Nada é publicado: o que está no ar continua igual.'
  });
  if (!ok) return undefined;
  try {
    const result = await ctx.api.post(`/api/playlists/${encodeURIComponent(playlist.id)}/restore`, { rev, version: number });
    const skipped = result.restored?.skipped ?? 0;
    toast(skipped
      ? `Versão ${number} restaurada no rascunho. ${plural(skipped, 'conteúdo foi excluído', 'conteúdos foram excluídos')} da biblioteca e ficou de fora.`
      : `Versão ${number} restaurada no rascunho.`);
    return result;
  } catch (error) {
    if (error?.code === 'REVISION_CONFLICT') throw error;
    showError(error);
    return undefined;
  }
}

