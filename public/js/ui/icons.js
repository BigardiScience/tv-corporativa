// Ícones de traço (24×24), no mesmo estilo do painel original. São criados como elementos SVG, nunca como texto HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

export const ICONS = Object.freeze({
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  building: 'M4 21V7l8-4 8 4v14 M8 10h1 M15 10h1 M8 14h1 M15 14h1 M10 21v-4h4v4 M2 21h20',
  image: 'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M16 7h.01',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  rows: 'M3 5h18v4H3z M3 11h18v4H3z M3 17h18v4H3z',
  calendar: 'M4 5h16v16H4z M7 3v4 M17 3v4 M4 10h16 M8 14h2 M14 14h2 M8 18h2',
  monitor: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M15 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8',
  shield: 'M12 3l8 4v6c0 5-8 9-8 9S4 18 4 13V7z M8 12l3 3 5-6',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  chevron: 'M9 5l7 7-7 7',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  plus: 'M12 5v14 M5 12h14',
  search: 'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  play: 'M8 4l13 8-13 8z',
  pause: 'M8 5v14 M16 5v14',
  'skip-next': 'M5 4l10 8-10 8z M19 5v14',
  'skip-prev': 'M19 4L9 12l10 8z M5 5v14',
  upload: 'M12 16V3 M7 8l5-5 5 5 M3 15v6h18v-6',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5 M12 17h.01',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  check: 'M5 12l4 4L19 6',
  'check-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M8 12l3 3 5-6',
  'x-circle': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M9 9l6 6 M15 9l-6 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  close: 'M6 6l12 12 M6 18L18 6',
  folder: 'M3 7V4h6l3 3h9v14H3z',
  'folder-plus': 'M3 7V4h6l3 3h9v14H3z M12 11v6 M9 14h6',
  cloud: 'M6 18a5 5 0 1 1 0-10 7 7 0 0 1 13 0 5 5 0 0 1-1 10 M9 14l3-3 3 3 M12 11v10',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  key: 'M15 8a4 4 0 1 1-4 4 M11 12L3 20 M6 17l2 2',
  logout: 'M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5',
  download: 'M12 3v13 M7 11l5 5 5-5 M3 17v4h18v-4',
  menu: 'M3 5h18 M3 12h18 M3 19h18',
  access: 'M12 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3 M4 8l8 2 8-2 M12 10v5 M7 22l5-7 5 7',
  edit: 'M15 4l5 5 M3 21l5-1L21 7l-5-5L3 15z',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  file: 'M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 11v6 M12 7h.01',
  grip: 'M9 5h.01 M9 12h.01 M9 19h.01 M15 5h.01 M15 12h.01 M15 19h.01',
  move: 'M5 9l-3 3 3 3 M9 5l3-3 3 3 M15 19l-3 3-3-3 M19 9l3 3-3 3 M2 12h20 M12 2v20',
  video: 'M3 6h13v12H3z M16 10l5-3v10l-5-3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  refresh: 'M21 12a9 9 0 1 1-3-6.7 M21 4v5h-5',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  stop: 'M6 6h12v12H6z',
  alert: 'M12 3l10 18H2z M12 10v5 M12 18h.01'
});

export function icon(name, className = '') {
  const doc = globalThis.document;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = doc.createElementNS(SVG_NS, 'path');
  // hasOwn: nomes como "toString" ou "__proto__" não podem herdar nada do objeto; nome desconhecido usa o ícone de arquivo.
  path.setAttribute('d', Object.hasOwn(ICONS, name) ? ICONS[name] : ICONS.file);
  svg.appendChild(path);
  return svg;
}
