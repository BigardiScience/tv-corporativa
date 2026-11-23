// Ponto de entrada do painel TV Corporativa.
//
// Responsabilidades: iniciar (ver se há servidor e sessão), entrar/sair, rotas por hash, ciclo de vida das telas
// (cada tela recebe um "view" que diz se ainda vale a pena desenhar), espaço de trabalho (unidade + setor) e atalhos.
// Nenhuma regra de negócio mora aqui: quem decide é o servidor.
import { createApi } from './lib/api.js';
import { createSession } from './lib/session.js';
import { createPrefs } from './lib/prefs.js';
import { buildHash, parseHash, routeAllowed, routeTitle } from './lib/router-core.js';
import { canIn, hasPermission } from './lib/permissions.js';
import { h, mount } from './ui/dom.js';
import { anyDialogOpen, closeAllDialogs, confirmDialog } from './ui/dialogs.js';
import { hideToast, toast } from './ui/toast.js';
import { button, emptyState } from './ui/components.js';
import { isHandled } from './ui/feedback.js';
import { createShell } from './ui/shell.js';
import { createThumbnailer } from './ui/thumbnails.js';
import { loginView } from './views/login.js';
import { accessibilityDialog, chooseSpace, formatsDialog, helpDialog, profileDialog } from './views/common-dialogs.js';
import { VIEWS } from './views/index.js';

const doc = globalThis.document;
const appRoot = doc.getElementById('app');
const prefs = createPrefs();
const session = createSession();
const api = createApi({ getCsrf: () => session.state.csrf, onUnauthorized: () => signedOut('Sua sessão expirou. Entre novamente.') });

let status = { configured: false };
let ready = false, unavailable = false;
let shell = null, currentRoute = null, currentView = null;
let navToken = 0, lastHash = '', reverting = false, confirming = false, pendingFocus = null;

// ---- preferências de leitura ------------------------------------------------------------------------------------------
function applyPrefs() {
  doc.body.classList.toggle('large-text', prefs.largeText());
  doc.body.classList.toggle('high-contrast', prefs.highContrast());
}

// ---- contexto entregue às telas ----------------------------------------------------------------------------------------
const nameOf = (list, id) => list.find(item => item.id === id)?.name ?? id;
const ctx = {
  api, session, prefs,
  thumbnails: null, // miniaturas em memória; criadas a cada entrada e descartadas ao sair (nada de uma sessão sobra para a próxima)
  get state() { return session.state; },
  get user() { return session.state.user; },
  can: permission => hasPermission(session.state.user, permission),
  canHere: permission => canIn(session.state.user, permission, session.state.space),
  unitName: id => nameOf(session.state.units, id),
  sectorName: id => nameOf(session.state.sectors, id),
  link: (name, params, query) => buildHash(name, params, query),
  navigate(name, params = {}, query = {}) {
    const target = buildHash(name, params, query);
    if (globalThis.location.hash === target) { showRoute(parseHash(target)); return; }
    globalThis.location.hash = target;
  },
  // Atualiza só o endereço (filtros, pasta aberta) sem redesenhar a tela.
  replaceUrl(name, params = {}, query = {}) {
    const target = buildHash(name, params, query);
    globalThis.history.replaceState(null, '', target);
    lastHash = globalThis.location.hash;
  },
  setSpace(space) {
    const { units, sectors, user } = session.state;
    if (!user || !units.some(unit => unit.id === space.unitId) || !sectors.some(sector => sector.id === space.sectorId)) return;
    session.setSpace({ unitId: space.unitId, sectorId: space.sectorId });
    prefs.setSpace(user.id, session.state.space);
    shell?.updateSpace();
    refreshPending();
    if (currentRoute?.name === 'library' && currentRoute.params.folderId) ctx.navigate('library'); else if (currentRoute) showRoute(currentRoute);
  },
  chooseSpace: () => chooseSpace(ctx),
  setLargeText(on) { prefs.setLargeText(on); applyPrefs(); },
  setHighContrast(on) { prefs.setHighContrast(on); applyPrefs(); },
  requestFocus(id) { pendingFocus = id; },
  takeFocusRequest(id) { if (pendingFocus === id) { pendingFocus = null; return true; } return false; },
  refreshPending: () => refreshPending(),
  async reloadWorkspace() {
    const epoch = session.epoch;
    const state = await api.get('/api/state');
    if (!session.alive(epoch)) return;
    session.fill(epoch, { user: state.user, units: state.units, sectors: state.sectors, limits: state.limits, mode: state.mode, scannerConfigured: state.scannerConfigured, version: state.version });
    const { space } = session.state;
    if (space && (!state.units.some(unit => unit.id === space.unitId) || !state.sectors.some(sector => sector.id === space.sectorId))) session.setSpace(null);
    shell?.updateSpace();
  },
  logout: () => logout(),
  // O servidor já encerrou a sessão (ex.: a própria conta foi alterada): só volta para a entrada, com uma explicação.
  endSession: message => signedOut(message),
  openFormats: () => formatsDialog(ctx),
  toast
};

// ---- entrada e saída ----------------------------------------------------------------------------------------------------
function showLogin({ message = '' } = {}) {
  doc.title = 'Entrar · TV Corporativa';
  mount(appRoot, loginView({ ready, configured: !!status.configured, unavailable, message }, {
    submit: async ({ email, password }) => { await enter(await api.post('/api/login', { email, password }, { public: true })); },
    retry: async () => { ready = false; showLogin(); await boot(); },
    accessibility: () => accessibilityDialog(ctx)
  }));
  if (ready && !unavailable && status.configured) doc.getElementById('login-email')?.focus();
}

function resetUi() {
  closeAllDialogs();
  hideToast();
  disposeView();
  ctx.thumbnails?.dispose();
  ctx.thumbnails = null;
  shell = null; currentRoute = null; pendingFocus = null; lastHash = '';
  doc.body.classList.remove('nav-open');
}

function signedOut(message) {
  if (!session.active) return;
  session.end();
  resetUi();
  showLogin({ message });
}

async function logout() {
  let notified = true;
  try { await api.post('/api/logout', {}); } catch (error) { notified = isHandled(error); }
  if (session.active) { session.end(); resetUi(); showLogin(); }
  toast(notified ? 'Sessão encerrada com segurança.' : 'A tela foi encerrada, mas o servidor não confirmou a saída. Feche o navegador se o computador for compartilhado.', { kind: notified ? 'info' : 'error' });
}

function initialSpace(state, user) {
  const valid = space => space && state.units.some(unit => unit.id === space.unitId) && state.sectors.some(sector => sector.id === space.sectorId);
  const stored = prefs.space(user.id);
  if (valid(stored)) return stored;
  return state.units.length === 1 && state.sectors.length === 1 ? { unitId: state.units[0].id, sectorId: state.sectors[0].id } : null;
}

async function enter({ user, csrf }) {
  const epoch = session.start({ user, csrf });
  try {
    const [state, catalog] = await Promise.all([api.get('/api/state'), api.get('/api/permissions')]);
    if (!session.alive(epoch)) return;
    session.fill(epoch, {
      user: state.user, units: state.units, sectors: state.sectors, limits: state.limits, mode: state.mode, scannerConfigured: state.scannerConfigured,
      version: state.version, catalog, space: initialSpace(state, state.user)
    });
  } catch (error) {
    if (session.alive(epoch)) { session.end(); }
    throw error;
  }
  ctx.thumbnails = createThumbnailer();
  buildApp();
}

function buildApp() {
  shell = createShell(ctx, {
    chooseSpace: () => chooseSpace(ctx),
    help: () => helpDialog(ctx),
    accessibility: () => accessibilityDialog(ctx),
    profile: () => profileDialog(ctx),
    logout: () => logout(),
    search: () => {
      if (currentRoute?.name === 'library') doc.getElementById('library-search')?.focus(); else { ctx.requestFocus('library-search'); ctx.navigate('library'); }
    },
    notifications: () => ctx.navigate('library', {}, { situacao: 'pending', plano: '1' })
  });
  mount(appRoot, shell.root);
  lastHash = globalThis.location.hash;
  showRoute(parseHash(globalThis.location.hash)).then(() => {
    if (!session.state.space && session.state.units.length && session.state.sectors.length && !anyDialogOpen()) chooseSpace(ctx);
  });
  refreshPending();
}

async function refreshPending() {
  const { space } = session.state, epoch = session.epoch;
  if (!space || !shell) return;
  try {
    const data = await api.get('/api/library', { query: { unitId: space.unitId, sectorId: space.sectorId, status: 'pending', flat: true, limit: 1 } });
    if (session.alive(epoch)) shell?.setPending(data.total);
  } catch { /* mantém o último valor; o próximo ciclo tenta de novo */ }
}

// ---- telas --------------------------------------------------------------------------------------------------------------
function disposeView() {
  navToken++;
  const view = currentView;
  currentView = null;
  for (const cleanup of view?.cleanups ?? []) { try { cleanup(); } catch { /* limpeza nunca derruba o painel */ } }
}

function createView(token, epoch) {
  const view = {
    cleanups: [], blocker: null, refresh: null,
    alive: () => token === navToken && session.alive(epoch),
    onDispose(fn) { view.cleanups.push(fn); },
    // Tela com alterações não salvas: devolve texto de aviso (ou null). Usado ao sair da tela.
    setBlocker(fn) { view.blocker = fn; }
  };
  return view;
}

const loading = () => h('div.loading', { role: 'status' }, h('span.spinner', { aria: { hidden: 'true' } }), ' Carregando…');

async function showRoute(route) {
  if (!session.active || !shell) return;
  disposeView();
  let target = route;
  if (target.name === 'notfound') { target = { name: 'overview', params: {}, query: {} }; globalThis.history.replaceState(null, '', buildHash('overview')); }
  if (!routeAllowed(session.state.user, target.name)) {
    toast('Seu perfil não tem acesso a esta área.', { kind: 'error' });
    target = { name: 'overview', params: {}, query: {} };
    globalThis.history.replaceState(null, '', buildHash('overview'));
  }
  lastHash = globalThis.location.hash;
  currentRoute = target;
  const token = navToken, epoch = session.epoch;
  const view = createView(token, epoch);
  currentView = view;
  shell.setRoute(target.name, routeTitle(target.name));
  doc.title = `${routeTitle(target.name)} · TV Corporativa`;
  mount(shell.view, loading());
  try {
    await VIEWS[target.name](ctx, target, shell.view, view);
  } catch (error) {
    if (view.alive() && !isHandled(error)) {
      mount(shell.view, emptyState({
        iconName: 'alert', title: 'Não foi possível carregar esta tela', text: error?.message || 'Tente novamente em instantes.',
        actions: [button('Tentar novamente', { primary: true, icon: 'refresh', onClick: () => showRoute(target) })]
      }));
    }
  }
  if (view.alive()) {
    shell.main.focus({ preventScroll: true });
    globalThis.scrollTo({ top: 0 });
  }
}

// Sair de uma tela com alterações não salvas pede confirmação. Voltar/Avançar do navegador também passa por aqui:
// se a pessoa desistir, o endereço anterior é restaurado.
async function onHashChange() {
  if (reverting) { reverting = false; return; }
  if (!session.active || !shell) return;
  if (confirming) { return; }
  const target = globalThis.location.hash;
  const warning = currentView?.blocker?.();
  if (warning) {
    confirming = true;
    const stay = !(await confirmDialog({ title: 'Sair sem salvar?', message: warning, confirmLabel: 'Sair e descartar', cancelLabel: 'Continuar editando', danger: true }));
    confirming = false;
    if (stay) { reverting = true; globalThis.location.hash = lastHash; return; }
    currentView.setBlocker(null);
  }
  await showRoute(parseHash(target));
}

globalThis.addEventListener('hashchange', onHashChange);
globalThis.addEventListener('beforeunload', event => {
  if (session.active && currentView?.blocker?.()) { event.preventDefault(); event.returnValue = ''; }
});

doc.addEventListener('keydown', event => {
  if (event.key === 'Escape' && doc.body.classList.contains('nav-open')) { shell?.closeMenu(); }
  if (session.active && shell && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    closeAllDialogs();
    if (currentRoute?.name === 'library') doc.getElementById('library-search')?.focus(); else { ctx.requestFocus('library-search'); ctx.navigate('library'); }
  }
});

doc.querySelector('.skip')?.addEventListener('click', event => { event.preventDefault(); (doc.getElementById('main') ?? doc.body).focus(); });

// Atualização periódica (TVs online, pendências). Só com a aba visível e sem janela aberta, para não atrapalhar quem está digitando.
setInterval(() => {
  if (!session.active || doc.hidden || anyDialogOpen()) return;
  currentView?.refresh?.();
  refreshPending();
}, 30000);

// ---- início -------------------------------------------------------------------------------------------------------------
async function boot() {
  applyPrefs();
  try {
    status = await api.get('/api/status', { public: true });
    unavailable = false;
    if (status.configured) {
      const me = await api.get('/api/me', { public: true }).catch(() => null);
      if (me?.user) { ready = true; await enter(me); return; }
    }
  } catch {
    unavailable = true;
  }
  ready = true;
  showLogin();
}

showLogin();
boot().catch(() => { unavailable = true; ready = true; if (!session.active) showLogin(); });
