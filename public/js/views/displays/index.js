// Telas (TVs): cadastrar, ativar, conectar com o código de pareamento, renomear e remover.
// A TV só recebe conteúdo depois de ativada e pareada. "Online" quer dizer contato recente com o servidor; não garante
// que o conteúdo esteja visível na tela, por isso a conferência final é sempre olhando a TV.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, button, emptyState, iconButton, notice, pageHeading, tones } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { CONNECTION_LABELS, plural } from '../../lib/format.js';
import { contactLabel, displayActions, pairingState } from '../../lib/display-model.js';
import { canManageDisplays } from '../../lib/permissions.js';
import { actionDialog, needSpace, spaceLabel } from '../shared.js';
import { openPairingDialog } from './pairing.js';
import { openDisplayForm } from './form.js';
import { openDisplaySequence } from './sequence.js';

const enc = encodeURIComponent;

export async function mountDisplays(ctx, route, container, view) {
  const { space } = ctx.state;
  if (!space) { needSpace(ctx, container, { title: 'Telas', description: 'As TVs compartilhadas de cada unidade.' }); return; }

  const admin = canManageDisplays(ctx.user);
  const can = { activate: admin && ctx.canHere('screen:activate'), update: admin && ctx.canHere('screen:update'), delete: admin && ctx.canHere('screen:delete'), pair: ctx.canHere('screen:pair') };
  const canCreate = admin && ctx.canHere('screen:create');
  let data = null, requestId = 0;

  const results = h('div.display-results');
  const count = h('p.library-count', { role: 'status' });

  async function load({ silent = false } = {}) {
    const id = ++requestId;
    if (!silent) results.setAttribute('aria-busy', 'true');
    try {
      const next = await ctx.api.get('/api/displays', { query: { unitId: space.unitId, sectorId: admin ? undefined : space.sectorId } });
      if (id !== requestId || !view.alive()) return;
      data = { ...next, displays: next.displays.filter(display => display.permissions?.view === true) };
      draw();
    } catch (error) {
      if (id !== requestId || !view.alive()) return;
      if (data) return;
      mount(results, emptyState({
        iconName: 'alert', title: 'Não foi possível carregar as TVs', text: error?.message,
        actions: [button('Tentar novamente', { primary: true, icon: 'refresh', onClick: () => load() })]
      }));
    } finally {
      if (id === requestId) results.removeAttribute('aria-busy');
    }
  }

  // Depois de qualquer ação a lista é relida (outra pessoa pode ter mexido nas TVs).
  async function afterAction(finished, message) {
    const result = await finished;
    if (!view.alive()) return result;
    if (result !== undefined && message) toast(message);
    await load({ silent: true });
    return result;
  }

  const showCode = done => openPairingDialog(ctx, { display: done.display, code: done.pairingCode, expiresAt: done.expiresAt });

  async function create() {
    if (!canCreate) return;
    const done = await afterAction(openDisplayForm(ctx, { space }), null);
    if (!done || !view.alive()) return;
    toast(done.display.status === 'active' ? 'TV cadastrada e ativada.' : 'TV cadastrada. Um administrador precisa ativá-la para conectar.');
    if (done.pairingCode) await showCode(done);
  }

  async function activate(display) {
    const done = await afterAction(actionDialog({
      title: 'Ativar esta TV?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Ativar e gerar código', iconName: 'check',
      message: `“${display.name}” foi cadastrada e aguarda ativação. Depois de ativada, ela pode ser conectada com um código de pareamento e receber programações.`,
      run: () => ctx.api.post(`/api/displays/${enc(display.id)}/activate`, {})
    }), 'TV ativada.');
    if (done && view.alive()) await showCode(done);
  }

  async function renewCode(display) {
    const done = await afterAction(actionDialog({
      title: 'Gerar um código de pareamento?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Gerar código', iconName: 'key', danger: display.paired,
      message: display.paired
        ? `“${display.name}” já está pareada. Um código novo desconecta a TV atual: ela deixa de receber conteúdo até alguém digitar o código novo nela.`
        : `Será gerado um código de 6 números para conectar “${display.name}”. Se já havia outro código aberto, ele deixa de valer.`,
      run: () => ctx.api.post(`/api/displays/${enc(display.id)}/pairing`, {})
    }), null);
    if (done && view.alive()) await showCode(done);
  }

  // Editor e Gestor (permissão própria): o código novo não desconecta a TV; ela só troca de credencial quando alguém digita o código nela.
  async function generateCode(display) {
    const done = await afterAction(actionDialog({
      title: 'Gerar um código de pareamento?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Gerar código', iconName: 'key',
      message: `Será gerado um código de 6 números para conectar “${display.name}”. A TV atual continua conectada até alguém digitar o código nela. Se já havia outro código aberto, ele deixa de valer.`,
      run: () => ctx.api.post(`/api/displays/${enc(display.id)}/pairing-code`, {})
    }), null);
    if (done && view.alive()) await showCode(done);
  }

  const edit = display => afterAction(openDisplayForm(ctx, { space, display }), 'TV e acessos atualizados.');

  const remove = display => afterAction(actionDialog({
    title: 'Remover esta TV?', subtitle: spaceLabel(ctx, space), confirmLabel: 'Remover TV', danger: true,
    message: `“${display.name}” perde o acesso ao servidor na hora. Seus vínculos de programação ficam suspensos e são preservados no histórico. Para usar o aparelho de novo, cadastre-o outra vez.`,
    details: [
      'Os arquivos e as programações são preservados. Esta TV deixa de exibi-los.',
      display.activeSchedules?.length ? `No ar agora nesta TV: ${display.activeSchedules.map(schedule => schedule.name).join(', ')}.` : null
    ].filter(Boolean),
    run: () => ctx.api.delete(`/api/displays/${enc(display.id)}`)
  }), 'TV removida. O acesso dela foi revogado.');

  function row(display) {
    const pairing = pairingState(display), allowed = displayActions(display, { ...(display.permissions?.manage === false ? {} : can), pair: can.pair && display.permissions?.pair === true });
    const sectors = display.sectorIds ?? (display.sectorId ? [display.sectorId] : []);
    return h('tr', { dataset: { displayId: display.id } },
      h('td', h('div.table-name', h('span.screen-thumb', icon('monitor')), h('div', h('b', display.name), h('small', contactLabel(display))))),
      h('td', badge(CONNECTION_LABELS[display.connection] ?? display.connection, tones.connection[display.connection])),
      h('td', admin ? h('div.display-share-summary',
        h('span', sectors.length ? sectors.map(ctx.sectorName).join(' · ') : 'Nenhum setor'),
        h('small', `${display.userIds?.length ?? 0} pessoa(s) com acesso individual`))
        : h('span', display.permissions?.publish ? 'Destino autorizado' : 'Consulta autorizada')),
      h('td', admin || allowed.generateCode ? (display.status === 'active' ? h('span', { class: { 'pair-open': pairing.key === 'open' } }, pairing.label) : h('span.muted', '—'))
        : h('span.muted', 'Gestão de administradores')),
      h('td.col-actions', h('div.item-actions',
        button('Ver sequência', { icon: 'list', className: 'small', aria: { label: `Ver sequência consolidada da TV ${display.name}` }, onClick: () => openDisplaySequence(ctx, display) }),
        allowed.activate ? button('Ativar', { primary: true, icon: 'check', className: 'small', aria: { label: `Ativar a TV ${display.name}` }, onClick: () => activate(display) }) : null,
        allowed.pairing ? button('Código de pareamento', { icon: 'key', className: 'small', aria: { label: `Gerar código de pareamento da TV ${display.name}` }, onClick: () => renewCode(display) }) : null,
        allowed.generateCode ? button('Código de pareamento', { icon: 'key', className: 'small', aria: { label: `Gerar código de pareamento da TV ${display.name}` }, onClick: () => generateCode(display) }) : null,
        allowed.rename ? iconButton(`Editar TV e acessos de ${display.name}`, 'edit', () => edit(display)) : null,
        allowed.remove ? iconButton(`Remover a TV ${display.name}`, 'trash', () => remove(display), { className: 'act-delete' }) : null)));
  }

  function draw() {
    const { displays } = data;
    const online = displays.filter(display => display.connection === 'online').length;
    count.textContent = displays.length ? `${plural(displays.length, 'TV', 'TVs')} · ${online} online` : '';
    if (!displays.length) {
      mount(results, emptyState({
        iconName: 'monitor', title: admin ? 'Nenhuma TV nesta unidade ainda' : 'Nenhuma TV autorizada neste espaço',
        text: canCreate ? 'Cadastre a primeira TV e escolha quem pode publicar nela.' : 'Peça a um administrador acesso a uma TV desta unidade. Ela aparecerá aqui quando seu setor ou sua conta estiver autorizado.',
        actions: canCreate ? [button('Cadastrar a primeira TV', { primary: true, icon: 'plus', onClick: create })] : []
      }));
      return;
    }
    mount(results,
      h('div.table-wrap', h('table.data-table.display-table',
        h('thead', h('tr', ['TV DA UNIDADE', 'SITUAÇÃO', admin ? 'QUEM PODE USAR' : 'SEU ACESSO', 'PAREAMENTO', 'AÇÕES'].map(label => h('th', { scope: 'col' }, label)))),
        h('tbody', displays.map(row)))),
      h('p.muted.small.mt', '“Online” significa que a TV falou com o servidor há poucos instantes. Isso não garante que o conteúdo esteja visível: confira na tela da TV.'));
  }

  view.refresh = () => load({ silent: true });

  mount(container,
    pageHeading({
      eyebrow: ctx.unitName(space.unitId).toUpperCase(), title: 'Telas compartilhadas',
      description: 'Uma TV da unidade pode receber programações de vários setores, em uma sequência única.',
      actions: canCreate ? [button('Cadastrar TV', { primary: true, icon: 'plus', onClick: create })] : []
    }),
    can.activate
      ? notice('Administradores cadastram, pareiam e compartilham as TVs. Em “Editar TV e acessos”, escolha os setores ou pessoas autorizados. Em “Ver sequência”, organize a ordem global de exibição.', { tone: 'info', iconName: 'info', className: 'mb' })
      : notice(can.pair
        ? 'Você vê somente as TVs autorizadas para seu espaço e pode gerar o código de pareamento delas. O cadastro, os acessos e a ordem global são exclusivos do perfil Administrador.'
        : 'Você vê somente as TVs autorizadas para seu espaço. O cadastro, o pareamento, os acessos e a ordem global são exclusivos do perfil Administrador.', { tone: 'info', iconName: 'info', className: 'mb' }),
    count, results);

  await load();
}
