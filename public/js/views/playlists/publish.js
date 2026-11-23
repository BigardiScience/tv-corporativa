// Publicar uma versão da playlist. Publicar cria uma cópia fixa ("versão") do rascunho. Programações apontam para uma versão
// específica, então publicar uma versão nova não muda, sozinho, o que já está no ar.
import { h } from '../../ui/dom.js';
import { openModal } from '../../ui/dialogs.js';
import { badge, button, field, notice, tones } from '../../ui/components.js';
import { runBusy } from '../../ui/feedback.js';
import { READINESS_LABELS, plural } from '../../lib/format.js';
import { cycleLabel, describeItem, notReady } from '../../lib/playlist-model.js';
import { openPreview } from './preview.js';

// `playlist`: resposta atual do servidor (já com o rascunho salvo). Devolve a playlist atualizada, ou undefined se a pessoa desistir.
export function openPublishDialog(ctx, { playlist }) {
  const items = playlist.items;
  const pending = notReady(items);
  const nextVersion = playlist.latestVersion + 1;
  const unchanged = playlist.latestVersion > 0 && !playlist.hasUnpublishedChanges;
  const reason = !items.length ? 'Adicione ao menos um conteúdo para publicar.'
    : pending.length ? 'Há conteúdos que ainda não foram liberados. Aprove-os na biblioteca e tente de novo.'
      : unchanged ? 'Não há alterações novas desde a última versão publicada.' : '';

  const note = h('input#publish-note', { name: 'note', type: 'text', maxlength: '200', autocomplete: 'off', disabled: !!reason });
  let dialog;
  const submit = async () => {
    dialog.clearError();
    const result = await runBusy(confirm, () => ctx.api.post(`/api/playlists/${encodeURIComponent(playlist.id)}/publish`, { rev: playlist.draftRev, note: note.value.trim() }), { dialog });
    if (result) dialog.close(result);
  };
  const confirm = button(`Publicar versão ${nextVersion}`, { primary: true, icon: 'check', disabled: !!reason, onClick: submit });

  const rows = items.map((item, index) => h('li.publish-item', { class: { bad: item.readiness !== 'ready' } },
    h('span.publish-num', String(index + 1)),
    h('span.publish-title', item.media.title),
    h('small', describeItem(item)),
    badge(READINESS_LABELS[item.readiness] ?? item.readiness, tones.readiness[item.readiness])));

  dialog = openModal({
    title: `Publicar a versão ${nextVersion}`, subtitle: playlist.name, size: 'normal',
    body: [
      h('div.review-line', h('span', 'Conteúdos'), h('b', plural(items.length, 'conteúdo', 'conteúdos'))),
      h('div.review-line', h('span', 'Duração de um ciclo'), h('b', cycleLabel(items))),
      h('div.review-line', h('span', 'Repetição'), h('b', playlist.loop === false ? 'Uma vez, mantendo o último conteúdo' : 'Contínua')),
      h('ol.publish-list', rows),
      reason ? notice(reason, { tone: 'danger', iconName: 'alert', className: 'mt' }) : null,
      field({ label: 'Nota da versão (opcional)', control: note, hint: 'Ex.: “Inclui o aviso da campanha de agosto”. Aparece no histórico.', full: true }),
      notice('Programações que já usam uma versão anterior continuam com ela. Para colocar esta versão no ar, escolha-a na programação.', { tone: 'info', className: 'mt' })
    ],
    footer: [
      button('Pré-visualizar', { icon: 'play', disabled: !items.length, onClick: () => openPreview(ctx, { items, loop: playlist.loop !== false, title: 'Pré-visualização antes de publicar', subtitle: `${playlist.name} · exatamente o que será publicado, neste computador.` }) }),
      button('Cancelar', { onClick: () => dialog.close() }), confirm
    ]
  });
  return dialog.closed;
}
