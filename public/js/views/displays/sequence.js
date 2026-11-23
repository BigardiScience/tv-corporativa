// Resumo consolidado da TV. Nenhum endereço de mídia é lido ou transformado em elemento de reprodução aqui.
import { h } from '../../ui/dom.js';
import { openModal, confirmDialog } from '../../ui/dialogs.js';
import { badge, button, emptyState, notice } from '../../ui/components.js';
import { showError } from '../../ui/feedback.js';
import { toast } from '../../ui/toast.js';
import { canManageDisplays } from '../../lib/permissions.js';
import { moveItem } from '../../lib/reorder.js';
import { SCHEDULE_STATE_LABELS } from '../../lib/format.js';

export function openDisplaySequence(ctx, display) {
  const admin = canManageDisplays(ctx.user);
  let data = null, ids = [], original = '', loading = false, saving = false, conflict = false, request = 0;
  const dialog = openModal({ title: 'Sequência consolidada da TV', subtitle: `${display.name} · ${ctx.unitName(display.unitId)}`,
    body: [h('div.loading', { role: 'status' }, 'Carregando a sequência…')],
    footer: [button('Fechar', { onClick: () => dialog.close() })]
  });
  const alive = () => dialog.el.isConnected;
  const dirty = () => JSON.stringify(ids) !== original;
  const announcement = h('p.sr-only', { role: 'status', aria: { live: 'polite' } });

  async function load() {
    const current = ++request;
    loading = true;
    try {
      const next = await ctx.api.get(`/api/displays/${encodeURIComponent(display.id)}/sequence`);
      if (!alive() || current !== request) return;
      data = next;
      ids = next.schedules.map(item => item.id);
      original = JSON.stringify(ids);
      conflict = false;
      dialog.clearError();
    } catch (error) { if (alive() && current === request) showError(error, dialog); }
    finally { if (alive() && current === request) { loading = false; draw(); } }
  }

  async function reload() {
    if (dirty() && !(await confirmDialog({ title: 'Descartar a ordem não salva?', message: 'A sequência será recarregada do servidor e as mudanças desta janela serão descartadas.', confirmLabel: 'Recarregar ordem' }))) return;
    if (alive()) await load();
  }

  async function save() {
    if (!admin || !canManageDisplays(ctx.user) || saving || loading || conflict || !dirty()) return;
    const payload = { rev: data.revision, scheduleIds: [...ids] };
    saving = true; draw(); dialog.clearError();
    try {
      await ctx.api.put(`/api/displays/${encodeURIComponent(display.id)}/order`, payload);
      if (!alive()) return;
      toast('Ordem da TV salva. Ela será aplicada na próxima atualização do player.');
      await load();
    } catch (error) {
      if (!alive()) return;
      if (error?.status === 409 || error?.code === 'REVISION_CONFLICT') {
        conflict = true;
        dialog.setError('A sequência foi alterada por outra pessoa. Recarregue a ordem atual antes de reorganizar. Suas alterações não foram gravadas.');
      } else showError(error, dialog);
    } finally { saving = false; if (alive()) draw(); }
  }

  function move(id, offset) {
    if (!admin || saving || conflict || loading) return;
    const from = ids.indexOf(id), to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids = moveItem(ids, from, to);
    draw();
    const item = data.schedules.find(value => value.id === id);
    announcement.textContent = `${item?.accessible === false ? 'Programação de outro setor' : item?.name ?? 'Programação'} movida para a posição ${to + 1}. Salve para aplicar.`;
    // O botão usado pode ficar desabilitado ao chegar ao início/fim; mantenha o foco em uma ação do mesmo item.
    const controls = [...dialog.body.querySelectorAll('button[data-order-id]')].filter(control => control.dataset.orderId === id && !control.disabled);
    (controls.find(control => control.dataset.direction === String(offset)) ?? controls[0])?.focus();
  }

  function draw() {
    if (!data) {
      dialog.setBody(emptyState({ iconName: 'monitor', title: loading ? 'Carregando a sequência…' : 'Sequência indisponível', text: 'Consulte as programações autorizadas e a conexão com o servidor.' }));
      dialog.setFooter(button('Fechar', { onClick: () => dialog.close() }), button('Tentar novamente', { icon: 'refresh', disabled: loading, onClick: load }));
      return;
    }
    const schedules = new Map(data.schedules.map(item => [item.id, item]));
    const rows = ids.map((id, index) => {
      const item = schedules.get(id);
      const name = item.accessible === false ? 'Programação de outro setor' : item.name;
      const suspended = item.linkStatus === 'suspended';
      const active = !suspended && item.status === 'published' && item.state === 'live';
      return h('li.tv-sequence-row', { role: 'listitem', dataset: { scheduleId: id } },
        h('span.tv-sequence-position', { aria: { label: `Posição ${index + 1}` } }, String(index + 1).padStart(2, '0')),
        h('div.tv-sequence-description', h('h3', name),
          h('p', h('span.chip', item.sectorName ?? ctx.sectorName(item.sectorId)), ` · ${Number(item.itemCount) || 0} conteúdo(s)`,
            Number.isFinite(item.durationSeconds) ? ` · ${item.durationSeconds} s de referência` : ''),
          h('p', suspended ? 'Vínculo suspenso. Após revisar os acessos com um administrador, uma pessoa autorizada deve interromper a programação e publicá-la novamente.' : active ? 'Participa da exibição agora.' : 'Posição reservada. Só participa da exibição dentro do período e quando publicada.')),
        badge(suspended ? 'Acesso suspenso' : (SCHEDULE_STATE_LABELS[item.state] ?? 'Aguardando'), suspended ? 'warning' : active ? '' : 'neutral'),
        admin ? h('div.tv-sequence-actions',
          button('Subir', { icon: 'up', className: 'small', disabled: index === 0 || saving || conflict || loading, aria: { label: `Subir ${name}` }, dataset: { orderId: id, direction: '-1' }, onClick: () => move(id, -1) }),
          button('Descer', { icon: 'down', className: 'small', disabled: index === ids.length - 1 || saving || conflict || loading, aria: { label: `Descer ${name}` }, dataset: { orderId: id, direction: '1' }, onClick: () => move(id, 1) })) : null);
    });
    dialog.setBody(
      notice('Esta é a ordem compartilhada da TV: as programações dos setores se sucedem em um único ciclo. O resumo não abre arquivos nem concede acesso à biblioteca de outro setor.', { tone: 'info', className: 'mb' }),
      h('p.muted.small', 'As durações são referências. Vídeos configurados para tocar até o fim podem alterar o tempo real de exibição.'),
      h('div.row-between', h('p.muted.small', `Revisão da ordem: ${data.revision}`), h('p.muted.small', admin ? 'A ordem global é gerenciada pelo perfil Administrador.' : 'Somente administradores podem mudar esta ordem.')),
      rows.length ? h('ol.tv-sequence-list', { role: 'list', aria: { label: 'Ordem das programações desta TV' } }, rows)
        : emptyState({ iconName: 'list', title: 'Nenhuma programação vinculada', text: 'Publique uma programação autorizada para que ela apareça nesta sequência.' }),
      announcement);
    dialog.setFooter(
      button('Fechar', { onClick: () => dialog.close(), disabled: saving }),
      button('Recarregar ordem', { icon: 'refresh', disabled: saving || loading, onClick: reload }),
      admin ? button(saving ? 'Salvando…' : 'Salvar ordem da TV', { primary: true, icon: 'check', disabled: saving || loading || conflict || !dirty(), onClick: save }) : null);
  }
  load();
  return dialog.closed;
}
