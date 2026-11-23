// Visão geral: números do espaço escolhido, unidades, telas e atividade recente.
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge, button, notice, pageHeading, tones } from '../ui/components.js';
import { CONNECTION_LABELS, auditActionLabel, formatDateTime } from '../lib/format.js';
import { contactLabel } from '../lib/display-model.js';
import { unitCards } from './units.js';

// Falha de uma consulta isolada não derruba a tela inteira (401 já foi tratado pela sessão).
const attempt = promise => promise.catch(() => null);

function metric({ label, value, sub, iconName, color = '', good = false }) {
  return h('article.metric',
    h('div', h('div.metric-label', label), h('div.metric-value', String(value).padStart(2, '0')), h('div.metric-sub', { class: { good } }, good ? '↗ ' : '', sub)),
    h('span.metric-icon', { class: color }, icon(iconName)));
}

async function load(ctx) {
  const { space } = ctx.state;
  const query = space ? { unitId: space.unitId, sectorId: space.sectorId } : null;
  const [displays, library, approved, playlists, schedules, audit, scopedDisplays] = await Promise.all([
    attempt(ctx.api.get('/api/displays')),
    query ? attempt(ctx.api.get('/api/library', { query: { ...query, flat: true, limit: 1 } })) : null,
    query ? attempt(ctx.api.get('/api/library', { query: { ...query, flat: true, status: 'approved', limit: 1 } })) : null,
    query ? attempt(ctx.api.get('/api/playlists', { query: { ...query, limit: 1 } })) : null,
    query ? attempt(ctx.api.get('/api/schedules', { query: { ...query, limit: 200 } })) : null,
    ctx.can('audit:read') ? attempt(ctx.api.get('/api/audit', { query: { limit: 5 } })) : null,
    query ? attempt(ctx.api.get('/api/displays', { query: { unitId: space.unitId, sectorId: ctx.user.role === 'admin' ? undefined : space.sectorId } })) : null
  ]);
  return {
    displays: (displays?.displays ?? []).filter(display => display.permissions?.view === true),
    here: (scopedDisplays?.displays ?? []).filter(display => display.permissions?.view === true), library, approved, playlists,
    schedules: schedules?.schedules ?? [], events: audit?.events ?? null
  };
}

function draw(ctx, container, data) {
  const { space } = ctx.state;
  const here = space ? data.here : data.displays;
  const online = here.filter(display => display.connection === 'online').length;
  const live = data.schedules.filter(schedule => schedule.state === 'live');

  mount(container,
    pageHeading({
      title: 'Visão geral',
      eyebrow: space ? `${ctx.unitName(space.unitId)} · ${ctx.sectorName(space.sectorId)}`.toUpperCase() : 'SEU PONTO DE CONEXÃO',
      description: 'Acompanhe a comunicação das suas unidades e telas.',
      actions: [button('Pré-visualizar TV', { icon: 'play', onClick: () => globalThis.open('/player.html?demo=1', '_blank', 'noopener') })]
    }),
    space ? null : notice(['Escolha a unidade e o setor para ver os números do seu espaço de trabalho. ',
      h('button.subtle-link.inline', { type: 'button', on: { click: () => ctx.chooseSpace() } }, 'Escolher agora')], { tone: 'info', iconName: 'building' }),
    h('section.hero', { aria: { label: 'Comunicação corporativa' } },
      h('img', { src: '/assets/destaque.jpg', alt: 'Ilustração de telas exibindo comunicados' }),
      h('div', h('div.hero-eyebrow', h('i.live-dot'), 'COMUNICAÇÃO QUE TRANSFORMA'),
        h('h2', 'Conecte pessoas.', h('br'), h('span', 'Em todas as unidades.')),
        h('p', 'Uma plataforma. Muitas telas. O mesmo propósito.', h('br'), 'Leve informação a quem faz a sua empresa acontecer.')),
      h('span.hero-tag', icon('building'), 'Uma empresa, muitas conexões.')),
    h('section.metrics', { aria: { label: 'Indicadores do espaço de trabalho' } },
      metric({ label: 'Telas neste espaço', value: here.length, sub: `${online} online neste momento`, iconName: 'monitor', color: 'orange', good: true }),
      metric({ label: 'Arquivos na biblioteca', value: data.library?.total ?? 0, sub: `${data.approved?.total ?? 0} aprovados para exibição`, iconName: 'folder', color: 'blue' }),
      metric({ label: 'Playlists', value: data.playlists?.total ?? 0, sub: 'O que vai passar, em ordem', iconName: 'list', color: 'green' }),
      metric({ label: 'Programações no ar', value: live.length, sub: 'Quando e onde cada playlist toca', iconName: 'calendar' })),
    h('section',
      h('div.section-title', h('div', h('h2', 'Suas unidades'), h('p', 'Selecione uma unidade para começar.')),
        h('a.subtle-link', { href: ctx.link('units') }, 'Ver unidades ', icon('arrow'))),
      unitCards(ctx, data.displays)),
    h('div.lower-grid',
      h('section.panel',
        h('div.panel-head', h('div', h('h2', 'O que está nas telas'), h('small', 'Telas do espaço escolhido e a programação no ar.')), h('a.subtle-link', { href: ctx.link('displays') }, 'Ver todas ', icon('arrow'))),
        displayTable(here.slice(0, 5), ctx)),
      h('section.panel',
        h('div.panel-head', h('div', h('h2', data.events ? 'Últimas atividades' : 'Próximos passos'), h('small', data.events ? 'Atualizações da plataforma' : 'Do arquivo até a TV')), icon('clock')),
        data.events ? activity(data.events.slice(0, 4)) : nextSteps(ctx))),
    h('section.integration-bar',
      h('div', h('h3', 'Crie onde você já está acostumado.'), h('p', 'Exporte o conteúdo. A gente ajuda você a levar para as telas.')),
      h('div.integration-apps',
        h('span.app-logo', h('span', 'P'), 'PowerPoint'), h('span.app-logo.excel', h('span', 'X'), 'Excel'), h('span.app-logo.powerbi', h('span', '▥'), 'Power BI'),
        h('span.app-logo.canva', h('span', 'C'), 'Canva'), h('span.app-logo.photoshop', h('span', 'Ps'), 'Photoshop')),
      h('button.icon-button', { type: 'button', aria: { label: 'Ver formatos e orientações de exportação' }, on: { click: () => ctx.openFormats() } }, icon('arrow'))));
}

export async function mountOverview(ctx, route, container, view) {
  const data = await load(ctx);
  if (!view.alive()) return;
  draw(ctx, container, data);
  view.refresh = async () => {
    const fresh = await load(ctx);
    if (view.alive()) draw(ctx, container, fresh);
  };
}

function displayTable(displays, ctx) {
  if (!displays.length) return h('div.empty.compact', h('p', ctx.user.role === 'admin' ? 'Nenhuma TV nesta unidade ainda. Cadastre e compartilhe em Telas.' : 'Nenhuma TV autorizada neste espaço. Peça a um administrador o compartilhamento com seu setor ou sua conta.'));
  return h('div.table-wrap', h('table.data-table',
    h('thead', h('tr', ['Tela', 'Situação', 'No ar agora'].map(label => h('th', { scope: 'col' }, label)))),
    h('tbody', displays.map(display => h('tr',
      h('td', h('div.table-name', h('span.screen-thumb', icon('monitor')), h('div', display.name, h('small', contactLabel(display))))),
      h('td', badge(CONNECTION_LABELS[display.connection], tones.connection[display.connection])),
      h('td', display.activeSchedules?.length ? display.activeSchedules.map(schedule => schedule.name).join(', ') : h('span.muted', 'Nada programado')))))));
}

function activity(events) {
  if (!events.length) return h('div.activity-list', h('p.muted', 'Nenhuma atividade recente.'));
  const icons = ['check', 'monitor', 'calendar', 'folder'];
  return h('div.activity-list', events.map((event, index) => h('div.activity',
    h('span.activity-icon', icon(icons[index % icons.length])),
    h('div', h('b', auditActionLabel(event.action)), h('p', event.actor), h('time', { datetime: event.at }, formatDateTime(event.at))))));
}

function nextSteps(ctx) {
  const steps = [['folder', 'Envie arquivos para a Biblioteca', 'library'], ['list', 'Monte uma playlist', 'playlists'], ['calendar', 'Programe quando e onde exibir', 'schedules'], ['monitor', ctx.user.role === 'admin' ? 'Cadastre e compartilhe as TVs' : 'Consulte as TVs autorizadas', 'displays']];
  return h('div.activity-list', steps.map(([iconName, label, route]) => h('div.activity',
    h('span.activity-icon', icon(iconName)), h('div', h('a.subtle-link', { href: ctx.link(route) }, label)))));
}
