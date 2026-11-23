// Criar e editar pessoas: dados, perfil, unidades e setores, e permissões individuais.
// O servidor decide: perfis que cada pessoa pode atribuir, escopo, escalada de privilégio e "pelo menos um administrador ativo".
import { h, mount } from '../../ui/dom.js';
import { openModal } from '../../ui/dialogs.js';
import { button, field, notice } from '../../ui/components.js';
import { runBusy } from '../../ui/feedback.js';
import { ROLE_SUMMARIES, assignableRoles, hasPermission } from '../../lib/permissions.js';
import { customizationCount, roleLabel, validateUserForm } from '../../lib/user-model.js';
import { selectBox } from '../shared.js';
import { passwordField } from './password-field.js';
import { createPermissionEditor } from './permission-editor.js';

function checkList({ items, selected, label, onChange }) {
  return h('div.selection-list', items.map(item => {
    const input = h('input', {
      type: 'checkbox', checked: selected.has(item.id), aria: { label: `${label} ${item.name}` },
      on: { change: () => { if (input.checked) selected.add(item.id); else selected.delete(item.id); onChange?.(); } }
    });
    return h('label.check-item', input, h('span', item.name));
  }));
}

// Devolve (pela promessa) a pessoa salva, ou undefined se a janela for cancelada.
export function openUserForm(ctx, { user = null } = {}) {
  if (!hasPermission(ctx.user, 'user:manage')) return Promise.resolve(undefined);
  const editing = !!user, self = editing && user.id === ctx.user.id;
  const { catalog, units, sectors } = ctx.state;
  const roles = assignableRoles(ctx.user, catalog);
  const initialRole = user?.role ?? (roles.includes('editor') ? 'editor' : roles[0]);

  const unitIds = new Set(user?.unitIds ?? []), sectorIds = new Set(user?.sectorIds ?? []);
  const name = h('input#user-name', { name: 'name', type: 'text', maxlength: '120', value: user?.name ?? '', autocomplete: 'off', spellcheck: 'false' });
  const email = h('input#user-email', { name: 'email', type: 'email', maxlength: '254', value: user?.email ?? '', autocomplete: 'off', spellcheck: 'false', readOnly: editing });
  const roleSummary = h('small.role-summary', ROLE_SUMMARIES[initialRole] ?? '');
  const permissions = createPermissionEditor({ actor: ctx.user, catalog, role: initialRole, target: user });
  const scopeBox = h('div.scope-box');
  const adminScope = notice('O Administrador TI tem acesso a todas as unidades e a todos os setores.', { tone: 'info', iconName: 'shield' });
  let role = initialRole;

  const roleSelect = selectBox({
    id: 'user-role', label: 'Perfil', value: initialRole, options: roles.map(item => [item, roleLabel(item)]),
    onChange: value => { role = value; roleSummary.textContent = ROLE_SUMMARIES[value] ?? ''; permissions.setRole(value); drawScope(); }
  });
  const active = h('input#user-active', { type: 'checkbox', checked: user ? user.active !== false : true, disabled: self });
  let dialog;
  const password = editing ? null : passwordField({ id: 'user-password', label: 'Senha inicial', onInput: () => dialog?.clearError() });

  function drawScope() {
    mount(scopeBox, role === 'admin' ? adminScope : [
      h('div.scope-columns',
        h('div', h('p.field-label', 'Unidades autorizadas'), checkList({ items: units, selected: unitIds, label: 'Unidade' })),
        h('div', h('p.field-label', 'Setores autorizados'), checkList({ items: sectors, selected: sectorIds, label: 'Setor' }))),
      h('small.field-note.neutral', 'A pessoa atua em qualquer combinação das unidades e dos setores marcados.')
    ]);
  }
  drawScope();

  async function submit() {
    const everyUnit = units.map(item => item.id), everySector = sectors.map(item => item.id);
    const values = {
      mode: editing ? 'edit' : 'create', name: name.value, email: email.value, password: password?.value() ?? '', confirmPassword: password?.confirmValue() ?? '', role,
      unitIds: role === 'admin' ? everyUnit : [...unitIds], sectorIds: role === 'admin' ? everySector : [...sectorIds]
    };
    const problems = validateUserForm(values, { assignable: roles });
    if (problems.length) { dialog.setError(problems.join(' ')); return; }
    dialog.clearError();
    const { grants, revokes } = permissions.grants();
    const common = { name: values.name.trim(), role, unitIds: values.unitIds, sectorIds: values.sectorIds, grants, revokes };
    const saved = await runBusy(confirm, () => (editing
      ? ctx.api.patch(`/api/users/${encodeURIComponent(user.id)}`, { ...common, active: active.checked })
      : ctx.api.post('/api/users', { ...common, email: values.email.trim(), password: values.password })), { dialog });
    if (saved === undefined) return;
    dialog.close(saved);
  }
  const confirm = button(editing ? 'Salvar alterações' : 'Criar usuário', { primary: true, icon: 'check', onClick: submit });

  const custom = user ? customizationCount(user) : 0;
  dialog = openModal({
    title: editing ? 'Editar usuário' : 'Novo usuário', size: 'large',
    subtitle: editing ? `${user.name} · ${user.email}` : 'Defina o perfil, onde a pessoa atua e o que ela pode fazer.',
    body: [
      self ? notice('Você está editando a sua própria conta. Ao salvar, sua sessão será encerrada e você precisará entrar de novo.', { tone: 'warning', iconName: 'alert', className: 'mb' })
        : (editing ? notice('Ao salvar, a pessoa é desconectada e precisa entrar de novo para que as mudanças de acesso passem a valer.', { tone: 'info', iconName: 'info', className: 'mb' }) : null),
      h('div.form-grid',
        field({ label: 'Nome', control: name, hint: 'Como a pessoa aparece no painel e na auditoria.' }),
        field({ label: 'E-mail', control: email, hint: editing ? 'O e-mail é o login e não pode ser alterado.' : 'É o login da pessoa. Use o e-mail corporativo.' }),
        h('div.field', h('label', { for: 'user-role' }, 'Perfil'), roleSelect, roleSummary),
        editing ? h('div.field', h('label', { for: 'user-active' }, 'Situação da conta'),
          h('label.check-inline.active-toggle', active, 'Conta ativa (pode entrar no painel)'),
          h('small', self ? 'Você não pode desativar a própria conta.' : 'Desmarque para suspender o acesso sem apagar o histórico.')) : null,
        password ? password.el : null),
      password ? notice('Copie ou anote a senha antes de salvar: ela não é exibida de novo e ninguém, nem a TI, consegue consultá-la depois. Entregue-a à pessoa por um canal seguro.', { tone: 'info', iconName: 'lock', className: 'mt' }) : null,
      h('h3.form-section', 'Onde a pessoa atua'), scopeBox,
      h('h3.form-section', 'O que a pessoa pode fazer'),
      h('details.perm-details', { open: custom > 0 },
        h('summary', 'Permissões individuais'),
        h('p.muted.small', 'O perfil define o padrão. Marque ou desmarque para dar ou retirar uma permissão só desta pessoa. A unidade e o setor continuam valendo em todas elas.'),
        permissions.el)
    ],
    footer: [button('Cancelar', { onClick: () => dialog.close() }), confirm]
  });
  return dialog.closed;
}
