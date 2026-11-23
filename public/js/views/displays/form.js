// Uma TV pertence à unidade. Administradores escolhem os setores e as pessoas que podem usá-la.
import { h, mount } from '../../ui/dom.js';
import { openModal } from '../../ui/dialogs.js';
import { button, emptyState, field, notice } from '../../ui/components.js';
import { runBusy } from '../../ui/feedback.js';
import { canManageDisplays } from '../../lib/permissions.js';
import { validateDisplayName } from '../../lib/display-model.js';
import { selectBox } from '../shared.js';

export function openDisplayForm(ctx, { space, display = null }) {
  if (!canManageDisplays(ctx.user)) return Promise.resolve(undefined);
  let unitId = display?.unitId ?? space.unitId;
  const sectorIds = new Set(display?.sectorIds ?? (display?.sectorId ? [display.sectorId] : [space.sectorId]));
  const userIds = new Set(display?.userIds ?? []);
  const dialog = openModal({
    title: display ? 'Editar TV e compartilhamento' : 'Cadastrar TV', subtitle: 'Equipamento da unidade · gestão pelo perfil Administrador',
    body: [h('div.loading', { role: 'status' }, 'Carregando pessoas e permissões…')],
    footer: [button('Cancelar', { onClick: () => dialog.close() })]
  });
  const alive = () => dialog.el.isConnected;

  (async () => {
    let users;
    try { users = (await ctx.api.get('/api/users')).users; }
    catch (error) {
      if (alive()) dialog.setBody(emptyState({ iconName: 'alert', title: 'Não foi possível carregar os acessos', text: error?.message }));
      return;
    }
    if (!alive()) return;

    const name = h('input#display-name', { name: 'name', type: 'text', maxlength: '120', required: true, value: display?.name ?? '', autocomplete: 'off' });
    const audience = h('div.display-audience');
    const unitWarning = notice('Mudar a unidade suspende as programações vinculadas à TV. Revise os acessos abaixo antes de salvar. O pareamento do equipamento é preservado.', { tone: 'warning', className: 'mb' });
    unitWarning.hidden = true;
    const unit = selectBox({ id: 'display-unit', label: 'Unidade da TV', value: unitId,
      options: ctx.state.units.map(item => [item.id, item.name]),
      onChange: value => {
        unitId = value;
        for (const id of userIds) if (!users.some(person => person.id === id && person.unitIds?.includes(unitId))) userIds.delete(id);
        unitWarning.hidden = !!display && display.unitId === unitId;
        if (!display) unitWarning.hidden = true;
        drawAudience();
      }
    });

    function checkbox(item, selected, kind, detail = '') {
      const input = h('input', { type: 'checkbox', checked: selected.has(item.id), value: item.id,
        aria: { label: `Autorizar ${kind}: ${item.name}` },
        on: { change: () => { if (input.checked) selected.add(item.id); else selected.delete(item.id); } }
      });
      return h('label.check-item', input, h('span', h('b', item.name), detail ? h('small', detail) : null));
    }
    function drawAudience() {
      const candidates = users.filter(person => person.role !== 'admin' && (person.unitIds?.includes(unitId) || userIds.has(person.id)));
      mount(audience,
        h('fieldset.display-grant-group', h('legend', 'Por setor'),
          h('p.muted.small', 'Pessoas autorizadas neste setor e nesta unidade poderão usar a TV, conforme o perfil.'),
          h('div.selection-list', ctx.state.sectors.filter(item => item.active !== false || sectorIds.has(item.id)).map(item => checkbox(item, sectorIds, 'setor', item.active === false ? 'Setor desativado' : '')))),
        h('fieldset.display-grant-group', h('legend', 'Por pessoa'),
          h('p.muted.small', 'Acrescente pessoas específicas. O acesso por setor continua valendo independentemente desta lista.'),
          candidates.length ? h('div.selection-list', candidates.map(person => checkbox(person, userIds, 'pessoa', `${person.email}${person.active === false ? ' · Conta suspensa' : ''}`)))
            : h('p.muted.small', 'Nenhuma pessoa com acesso a esta unidade. Cadastre os usuários antes de conceder acesso individual.')));
    }
    drawAudience();
    const form = h('form.form-grid', { on: { submit: event => { event.preventDefault(); save(); } } },
      field({ label: 'Nome da TV', control: name, full: true, hint: 'Ex.: TV Recepção · compartilhada entre RH e Segurança.' }),
      field({ label: 'Unidade da TV', control: unit, full: true }));
    dialog.setBody(form, unitWarning,
      h('h3.form-section', 'Quem pode publicar nesta TV?'),
      notice('A autorização desta TV não amplia o perfil: publicar exige também permissão de publicação e acesso ao setor do conteúdo. Administradores TI têm acesso global.', { tone: 'info', className: 'mb' }),
      audience,
      h('p.muted.small.mt', 'Se nenhum setor ou pessoa for selecionado, somente administradores poderão usar esta TV. Retirar um acesso suspende os vínculos de programação que dependem dele; conceder novamente não os retoma automaticamente.'));

    async function save() {
      if (!canManageDisplays(ctx.user)) return;
      const problems = validateDisplayName(name.value);
      if (problems.length) { dialog.setError(problems.join(' ')); name.focus(); return; }
      const values = { name: name.value.trim(), unitId, sectorIds: [...sectorIds], userIds: [...userIds] };
      const result = await runBusy(confirm, async () => {
        try {
          return display
            ? await ctx.api.patch(`/api/displays/${encodeURIComponent(display.id)}`, { ...values, rev: display.accessRev })
            : await ctx.api.post('/api/displays', values);
        } catch (error) {
          if (error?.status === 409 || error?.code === 'REVISION_CONFLICT') error.message = 'Esta TV foi alterada por outra pessoa. Feche a janela, confira a lista atualizada e abra a edição novamente.';
          throw error;
        }
      }, { dialog });
      if (result !== undefined && alive()) dialog.close(result);
    }
    const confirm = button(display ? 'Salvar TV e acessos' : 'Cadastrar TV', { primary: true, icon: 'check', onClick: save });
    dialog.setFooter(button('Cancelar', { onClick: () => dialog.close() }), confirm);
    name.focus();
  })();
  return dialog.closed;
}
