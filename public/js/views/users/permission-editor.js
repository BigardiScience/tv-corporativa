// Editor de permissões por pessoa: parte do padrão do perfil e permite conceder ou retirar permissões individuais.
// Quem edita só liga o que ele próprio possui (e nunca as exclusivas do Administrador); o servidor confere de novo.
import { h, mount } from '../../ui/dom.js';
import { button } from '../../ui/components.js';
import {
  defaultPermissions, diffAgainstRole, effectivePermissionSet, groupPermissions, permissionStates
} from '../../lib/permissions.js';

const ORIGIN_LABELS = { role: 'Padrão do perfil', grant: 'Concedida', revoke: 'Retirada', none: '' };

// `target`: pessoa editada (null ao criar). Devolve { el, grants(), reset(), setRole(role) }.
export function createPermissionEditor({ actor, catalog, role, target = null }) {
  let currentRole = role;
  let checked = target && target.role === role ? effectivePermissionSet(role, target.grants, target.revokes, catalog) : defaultPermissions(role, catalog);
  const existingGrants = target?.grants ?? [];
  const rows = new Map();

  const summary = h('p.perm-summary-line', { role: 'status' });
  const reset = button('Restaurar o padrão do perfil', { icon: 'refresh', className: 'small', onClick: () => { checked = defaultPermissions(currentRole, catalog); sync(); } });
  const groups = h('div.perm-groups');
  const el = h('div.perm-editor', h('div.perm-head', summary, reset), groups);

  function build() {
    rows.clear();
    mount(groups, groupPermissions(catalog).map(group => h('fieldset.perm-group',
      h('legend', group.group),
      group.items.map(item => {
        const input = h('input', {
          type: 'checkbox', name: 'permission', value: item.id,
          on: { change: () => { if (input.checked) checked.add(item.id); else checked.delete(item.id); sync(); } }
        });
        const tag = h('span.perm-tag');
        const note = h('small.perm-note');
        rows.set(item.id, { input, tag, note });
        return h('label.perm-item', { dataset: { permission: item.id } }, input, h('span.perm-label', item.label), tag, note);
      }))));
    sync();
  }

  function sync() {
    const states = permissionStates({ actor, role: currentRole, catalog, checked: [...checked], existingGrants });
    let custom = 0, active = 0;
    for (const [id, state] of states) {
      const row = rows.get(id);
      row.input.checked = state.checked;
      row.input.disabled = state.disabled;
      row.tag.textContent = ORIGIN_LABELS[state.origin] ?? '';
      row.tag.className = `perm-tag ${state.origin}`;
      row.note.textContent = state.disabled ? state.note : '';
      if (state.checked) active++;
      if (state.origin === 'grant' || state.origin === 'revoke') custom++;
    }
    summary.textContent = currentRole === 'admin'
      ? 'O Administrador TI tem todas as permissões.'
      : `${active} de ${states.size} permissões ativas${custom ? ` · ${custom} ${custom === 1 ? 'diferente' : 'diferentes'} do padrão do perfil` : ' · igual ao padrão do perfil'}`;
    reset.hidden = currentRole === 'admin' || !custom;
  }

  build();
  return {
    el,
    // Concedidas e retiradas em relação ao perfil escolhido (é o que o servidor recebe).
    grants: () => diffAgainstRole(currentRole, [...checked], catalog),
    reset() { checked = defaultPermissions(currentRole, catalog); sync(); },
    // Trocar o perfil volta ao padrão do novo perfil: as permissões individuais do perfil anterior não fazem mais sentido.
    setRole(next) { currentRole = next; checked = defaultPermissions(next, catalog); sync(); }
  };
}
