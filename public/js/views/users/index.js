// Usuários e permissões: administração exclusiva da TI.
// Esta tela só aparece para quem tem a permissão user:manage; mesmo assim, cada ação é validada de novo pelo servidor.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, button, emptyState, iconButton, initials, notice, pageHeading } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { plural } from '../../lib/format.js';
import { ROLE_LABELS, hasPermission } from '../../lib/permissions.js';
import { accessSummary, customizationCount, filterUsers, roleLabel, userActions } from '../../lib/user-model.js';
import { debounce, selectBox } from '../shared.js';
import { openUserForm } from './form.js';
import { openResetPassword } from './password.js';

const STATUS_OPTIONS = [['', 'Todas as situações'], ['active', 'Ativos'], ['inactive', 'Suspensos']];

export async function mountUsers(ctx, route, container, view) {
  if (!hasPermission(ctx.user, 'user:manage')) {
    mount(container, emptyState({ iconName: 'lock', title: 'Administração da TI', text: 'Somente o Administrador TI pode cadastrar pessoas, alterar acessos e redefinir senhas.' }));
    return;
  }
  const actor = ctx.user, catalog = ctx.state.catalog;
  const total = (catalog?.permissions ?? []).length;
  const filters = { q: '', role: '', status: '' };
  let users = null, requestId = 0;

  const search = h('input#user-search', { type: 'search', placeholder: 'Buscar por nome ou e-mail…', maxlength: '100', autocomplete: 'off', aria: { label: 'Buscar pessoa por nome ou e-mail' } });
  const roleFilter = selectBox({
    id: 'user-role-filter', label: 'Filtrar por perfil', value: '',
    options: [['', 'Todos os perfis'], ...Object.entries(ROLE_LABELS)], onChange: value => { filters.role = value; draw(); }
  });
  const statusFilter = selectBox({ id: 'user-status-filter', label: 'Filtrar por situação', value: '', options: STATUS_OPTIONS, onChange: value => { filters.status = value; draw(); } });
  const count = h('p.library-count', { role: 'status' });
  const results = h('div.user-results');

  async function load({ silent = false } = {}) {
    const id = ++requestId;
    if (!silent) results.setAttribute('aria-busy', 'true');
    try {
      const data = await ctx.api.get('/api/users');
      if (id !== requestId || !view.alive()) return;
      users = data.users;
      draw();
    } catch (error) {
      if (id !== requestId || !view.alive()) return;
      if (users) return;
      mount(results, emptyState({
        iconName: 'alert', title: 'Não foi possível carregar os usuários', text: error?.message,
        actions: [button('Tentar novamente', { primary: true, icon: 'refresh', onClick: () => load() })]
      }));
    } finally {
      if (id === requestId) results.removeAttribute('aria-busy');
    }
  }

  async function afterSave(finished, message, target) {
    const saved = await finished;
    if (!view.alive()) return;
    if (saved !== undefined) {
      // Alterar a própria conta encerra a própria sessão no servidor: volta para a tela de entrada.
      if (target?.id === actor.id) { ctx.endSession('Sua conta foi alterada. Entre novamente para continuar.'); return; }
      toast(message);
    }
    await load({ silent: true });
  }

  const create = () => afterSave(openUserForm(ctx), 'Usuário criado.');
  const edit = user => afterSave(openUserForm(ctx, { user }), 'Alterações salvas. A pessoa foi desconectada e entra de novo com o novo acesso.', user);
  const resetPassword = user => afterSave(openResetPassword(ctx, user), `Senha de ${user.name} redefinida. A pessoa foi desconectada.`, user);

  function accessCell(user) {
    const access = accessSummary(user, { unitName: ctx.unitName, sectorName: ctx.sectorName });
    return h('div', h('div.permission-chips', access.units.map(unit => h('span.chip', unit.replace(/^Unidade /, '')))),
      h('small', access.sectors.join(' · ')));
  }

  function permissionCell(user) {
    const custom = customizationCount(user);
    return h('div', h('span', `${user.permissions?.length ?? 0} de ${total}`),
      custom ? h('span.chip.custom', { title: `${user.grants.length} concedida(s) e ${user.revokes.length} retirada(s) em relação ao perfil` }, icon('key'), 'Personalizadas') : null);
  }

  function row(user) {
    const allowed = userActions(actor, user);
    return h('tr', { dataset: { userId: user.id } },
      h('td', h('div.table-name', h('span.avatar.small', initials(user.name)), h('div', h('b', user.name, allowed.self ? h('span.chip.you', 'você') : null), h('small', user.email)))),
      h('td', roleLabel(user.role)),
      h('td', accessCell(user)),
      h('td', permissionCell(user)),
      h('td', user.active === false ? badge('Suspenso', 'neutral') : badge('Ativo')),
      h('td.col-actions', h('div.item-actions',
        allowed.edit ? iconButton(`Editar ${user.name}`, 'edit', () => edit(user)) : null,
        allowed.resetPassword ? iconButton(`Redefinir a senha de ${user.name}`, 'lock', () => resetPassword(user)) : null)));
  }

  function draw() {
    const visible = filterUsers(users, filters);
    count.textContent = users.length ? `${plural(visible.length, 'pessoa', 'pessoas')}${visible.length !== users.length ? ` de ${users.length}` : ''}` : '';
    if (!users.length) {
      mount(results, emptyState({ iconName: 'users', title: 'Nenhum usuário por aqui', text: 'Crie o primeiro usuário para dar acesso ao painel.', actions: [button('Novo usuário', { primary: true, icon: 'plus', onClick: create })] }));
      return;
    }
    if (!visible.length) {
      mount(results, emptyState({ iconName: 'search', title: 'Ninguém encontrado', text: 'Ajuste a busca ou os filtros para ver as demais pessoas.' }));
      return;
    }
    mount(results, h('div.panel.table-wrap', h('table.data-table.user-table',
      h('thead', h('tr', ['Usuário', 'Perfil', 'Acesso', 'Permissões', 'Situação', ''].map(label => h('th', { scope: 'col' }, label)))),
      h('tbody', visible.map(row)))));
  }

  const onSearch = debounce(() => { filters.q = search.value.trim(); draw(); }, 150);
  search.addEventListener('input', onSearch);
  view.onDispose(() => onSearch.cancel());
  view.refresh = () => load({ silent: true });

  mount(container,
    pageHeading({
      eyebrow: 'ADMINISTRAÇÃO', title: 'Usuários e permissões',
      description: 'Quem acessa o painel, com qual perfil, em quais unidades e setores e com quais permissões.',
      actions: [button('Novo usuário', { primary: true, icon: 'plus', onClick: create })]
    }),
    notice('Os perfis definem o que cada pessoa pode fazer; as unidades e os setores definem onde. Somente a TI cadastra pessoas, altera acessos e redefine senhas. O compartilhamento de cada TV é definido em Telas.', { tone: 'info', iconName: 'shield', className: 'mb' }),
    h('div.toolbar', h('div.field-search', icon('search'), search), roleFilter, statusFilter),
    count, results);

  await load();
}
