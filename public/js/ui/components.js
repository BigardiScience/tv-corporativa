// Peças de interface reutilizadas por todas as telas. Mesmo visual e mesmas classes do painel original.
import { h } from './dom.js';
import { icon } from './icons.js';

export function button(label, { icon: iconName, primary = false, danger = false, onClick, type = 'button', title, disabled = false, aria, className = '', dataset } = {}) {
  return h(`button.button${primary ? '.primary' : ''}${danger ? '.danger' : ''}`, {
    type, title, disabled, aria, dataset, class: className, on: onClick ? { click: onClick } : undefined
  }, iconName ? icon(iconName) : null, label);
}

export function iconButton(label, iconName, onClick, { className = '', aria = {}, dataset } = {}) {
  return h('button.icon-button', { type: 'button', title: label, class: className, dataset, aria: { label, ...aria }, on: { click: onClick } }, icon(iconName));
}

export const badge = (label, tone = '') => h(`span.badge${tone ? `.${tone}` : ''}`, h('span.live-dot'), label);

export function notice(children, { tone = '', iconName = 'info', className = '' } = {}) {
  return h(`div.notice${tone ? `.${tone}` : ''}`, { class: className }, icon(iconName), h('div', children));
}

export function emptyState({ iconName = 'folder', title, text, actions = [] }) {
  return h('div.empty', icon(iconName), h('h3', title), text ? h('p', text) : null, actions.length ? h('div.actions.center', actions) : null);
}

export function pageHeading({ eyebrow = 'SEU PONTO DE CONEXÃO', title, description = '', actions = [] }) {
  return h('div.page-heading',
    h('div', h('div.eyebrow', eyebrow), h('h1', title), description ? h('p', description) : null),
    actions.length ? h('div.actions', actions) : null);
}

// Campo de formulário com rótulo associado ao controle (acessibilidade) e texto de apoio opcional.
export function field({ label, control, hint, full = false, className = '' }) {
  return h('div.field', { class: [full ? 'full' : '', className] }, h('label', { for: control.id }, label), control, hint ? h('small', hint) : null);
}

export function sectionTitle(title, description, actions = []) {
  return h('div.section-title', h('div', h('h2', title), description ? h('p', description) : null), actions);
}

// Marcas de situação (cores e textos padronizados em todo o painel).
const MEDIA_TONES = { approved: '', pending: 'warning', rejected: 'danger' };
const READINESS_TONES = { ready: '', pending: 'warning', rejected: 'danger', not_scanned: 'warning', deleted: 'danger' };
const SCHEDULE_TONES = { live: '', scheduled: 'warning', draft: 'neutral', stopped: 'danger', expired: 'neutral', published: '' };
const CONNECTION_TONES = { online: '', offline: 'danger', inactive: 'warning' };
export const tones = { media: MEDIA_TONES, readiness: READINESS_TONES, schedule: SCHEDULE_TONES, connection: CONNECTION_TONES };

export function initials(name) {
  return String(name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
}
