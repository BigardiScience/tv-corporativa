// Unidades e setores visíveis para a pessoa. Escolher uma unidade leva à escolha do setor (o espaço de trabalho).
import { h, mount } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { badge, pageHeading } from '../ui/components.js';
import { plural } from '../lib/format.js';
import { chooseSpace } from './common-dialogs.js';

const SECTOR_ICONS = { rh: 'users', ti: 'monitor', seguranca: 'shield' };

// `displays`: telas visíveis (para contar online por unidade). Opcional.
export function unitCards(ctx, displays = []) {
  const { units, space } = ctx.state;
  return h('div.units', units.map(unit => {
    const own = displays.filter(display => display.unitId === unit.id);
    const online = own.filter(display => display.connection === 'online').length;
    const tone = !own.length ? 'neutral' : online === own.length ? '' : 'warning';
    const label = !own.length ? 'Sem telas' : online === own.length ? 'Conectada' : online ? 'Parcial' : 'Sem conexão';
    return h('button.unit-card', {
      type: 'button', class: { selected: space?.unitId === unit.id }, aria: { label: `Selecionar ${unit.name}` },
      on: { click: () => chooseSpace(ctx, { unitId: unit.id }) }
    },
    h('div.unit-top', h('span.unit-icon', icon('building')), badge(label, tone)),
    h('h3', unit.name),
    h('div.unit-city', icon('pin'), unit.city || 'Unidade corporativa'),
    h('div.unit-bottom', h('span', icon('monitor'), `${plural(own.length, 'tela', 'telas')} · ${online} online`), icon('arrow')));
  }));
}

export async function mountUnits(ctx, route, container, view) {
  const displays = (await ctx.api.get('/api/displays').catch(() => ({ displays: [] }))).displays;
  if (!view.alive()) return;
  const { sectors } = ctx.state;
  mount(container,
    pageHeading({ eyebrow: 'SEU PONTO DE CONEXÃO', title: 'Unidades', description: 'Selecione uma unidade para começar.' }),
    unitCards(ctx, displays),
    h('div.panel',
      h('div.panel-head', h('div', h('h2', 'Cada equipe, no seu espaço'), h('small', 'O setor escolhido organiza os arquivos, as playlists, as programações e as permissões.'))),
      h('div.dialog-body.sector-grid', sectors.map(sector => h('div.sector-choice', icon(SECTOR_ICONS[sector.id] ?? 'settings'), sector.name)))));
}
