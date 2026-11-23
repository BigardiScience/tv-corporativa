// Estrutura fixa do painel depois do login: menu lateral, barra superior e área de conteúdo.
// Mantém as classes e o visual do painel original; só o conteúdo de cada tela muda.
import { h } from './dom.js';
import { icon } from './icons.js';
import { ROLE_LABELS, hasPermission } from '../lib/permissions.js';
import { buildHash } from '../lib/router-core.js';
import { initials } from './components.js';

// `group` abre um novo título no menu. `permission` esconde o item de quem não pode usá-lo.
const NAV = [
  { name: 'overview', label: 'Visão geral', icon: 'grid', group: 'COMUNICAÇÃO' },
  { name: 'units', label: 'Unidades', icon: 'building' },
  { name: 'library', label: 'Biblioteca', icon: 'folder', badge: true },
  { name: 'playlists', label: 'Playlists', icon: 'list' },
  { name: 'schedules', label: 'Programações', icon: 'calendar' },
  { name: 'displays', label: 'Telas', icon: 'monitor' },
  { name: 'users', label: 'Usuários', icon: 'users', permission: 'user:manage', group: 'ADMINISTRAÇÃO' },
  { name: 'audit', label: 'Auditoria', icon: 'shield', permission: 'audit:read', group: 'ADMINISTRAÇÃO' },
  { name: 'settings', label: 'Configurações', icon: 'settings', group: 'ADMINISTRAÇÃO' }
];

export function createShell(ctx, handlers) {
  const { user } = ctx;
  const links = new Map();
  const counts = new Map();
  const workspaceUnit = h('b'), workspaceSector = h('small');
  const crumbSpace = h('span'), crumbTitle = h('b');
  const dot = h('i.notification-dot', { hidden: true });
  const bell = h('button.icon-button', { type: 'button', aria: { label: 'Conteúdos aguardando aprovação' }, on: { click: handlers.notifications } }, icon('bell'), dot);
  const view = h('div#view');
  const main = h('main#main.main', { tabindex: '-1' }, view,
    h('footer.page-footer',
      h('span', `© ${new Date().getFullYear()} TV Corporativa · Comunicação que conecta.`),
      h('span', icon('shield'), 'Acesso com escopo por unidade e setor')));

  let lastGroup = '';
  const navItems = [];
  for (const item of NAV) {
    if (item.permission && !hasPermission(user, item.permission)) continue;
    if (item.group && item.group !== lastGroup) {
      lastGroup = item.group;
      navItems.push(h('div.nav-group', { class: { second: navItems.length > 0 } }, item.group));
    }
    const count = h('span.nav-count', { hidden: true });
    counts.set(item.name, count);
    const link = h('a.nav-btn', { href: buildHash(item.name), dataset: { route: item.name } }, icon(item.icon), item.label, item.badge ? count : null);
    links.set(item.name, link);
    navItems.push(link);
  }

  const toggleMenu = open => {
    const next = open ?? !globalThis.document.body.classList.contains('nav-open');
    globalThis.document.body.classList.toggle('nav-open', next);
    menuButton.setAttribute('aria-expanded', String(next));
  };
  const menuButton = h('button.icon-button.mobile-menu', { type: 'button', aria: { label: 'Abrir menu de navegação', controls: 'navigation', expanded: 'false' }, on: { click: () => toggleMenu() } }, icon('menu'));

  const sidebar = h('aside#navigation.sidebar', { aria: { label: 'Menu principal' } },
    h('a.brand', { href: buildHash('overview'), aria: { label: 'TV Corporativa — início' } }, h('img', { src: '/assets/logo.png', alt: 'TV Corporativa' }), h('span.tv', 'TV')),
    h('button.workspace', { type: 'button', aria: { label: 'Escolher unidade e setor' }, on: { click: handlers.chooseSpace } },
      h('span.workspace-mark', icon('building')), h('span', workspaceUnit, workspaceSector), icon('down')),
    h('nav', navItems),
    h('div.sidebar-bottom',
      h('div.help-card', icon('help'), h('b', 'Uma ajuda para começar?'), h('p', 'Da primeira publicação à sua TV.', h('br'), 'Vamos fazer isso juntos.'),
        h('button', { type: 'button', on: { click: handlers.help } }, 'Ver guia rápido ', icon('arrow'))),
      h('div.sidebar-footer', `TV CORPORATIVA `, h('span', { aria: { hidden: 'true' } }, '·'), ` V ${ctx.state.version || ''}`)));

  const topbar = h('header.topbar',
    menuButton,
    h('div.breadcrumbs', crumbSpace, icon('chevron'), crumbTitle),
    h('div.top-right',
      h('button.search-button', { type: 'button', aria: { label: 'Buscar conteúdo na biblioteca' }, on: { click: handlers.search } }, icon('search'), h('span', 'Buscar conteúdo...'), h('kbd.keycap', 'Ctrl K')),
      h('button.icon-button', { type: 'button', aria: { label: 'Recursos de acessibilidade' }, on: { click: handlers.accessibility } }, icon('access')),
      bell,
      h('button.profile', { type: 'button', aria: { label: `Perfil de ${user.name}` }, on: { click: handlers.profile } },
        h('span.avatar', initials(user.name)), h('span', h('b', user.name), h('small', ROLE_LABELS[user.role] ?? user.role)), icon('down'))));

  const strip = h('div.demo-strip.env-strip',
    h('span', icon('shield'), `Ambiente ${ctx.state.mode === 'production' ? 'corporativo' : 'local'} · ${user.email}`),
    h('button', { type: 'button', on: { click: handlers.logout } }, 'Sair com segurança'));

  const root = h('div.app-shell',
    h('div.mobile-overlay', { on: { click: () => toggleMenu(false) } }),
    sidebar,
    h('div.shell', topbar, strip, main));

  function updateSpace() {
    const { space } = ctx.state;
    workspaceUnit.textContent = space ? ctx.unitName(space.unitId) : 'Escolha onde trabalhar';
    workspaceSector.textContent = space ? ctx.sectorName(space.sectorId) : 'Unidade e setor';
    crumbSpace.textContent = space ? `${ctx.unitName(space.unitId)} · ${ctx.sectorName(space.sectorId)}` : 'Workspace';
  }
  updateSpace();

  return {
    root, main, view,
    updateSpace,
    setRoute(name, title) {
      const active = name === 'playlist' ? 'playlists' : name;
      for (const [route, link] of links) {
        link.classList.toggle('active', route === active);
        if (route === active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      }
      crumbTitle.textContent = title;
      toggleMenu(false);
    },
    setPending(count) {
      const badge = counts.get('library');
      if (badge) { badge.textContent = String(count); badge.hidden = !count; }
      dot.hidden = !count;
      bell.setAttribute('aria-label', count ? `${count} conteúdo(s) aguardando aprovação` : 'Nenhum conteúdo aguardando aprovação');
    },
    closeMenu: () => toggleMenu(false)
  };
}
