// Painel de pastas (árvore de navegação) do espaço atual. Cada linha também é um destino para arrastar e soltar.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pathTo } from '../../lib/tree.js';
import { dropTarget } from './dnd.js';

// `onOpen(id|null)` abre a pasta; `drop` = { accept(event, folderId), onDrop(event, folderId) }.
export function createFolderTree({ onOpen, drop }) {
  const el = h('nav.folder-tree', { aria: { label: 'Pastas da biblioteca' } });
  const expanded = new Set();
  let tree = null, currentId = null;

  function row(node, level) {
    const hasChildren = node.children.length > 0;
    const open = expanded.has(node.id);
    const toggle = hasChildren
      ? h('button.tree-toggle', {
        type: 'button', aria: { expanded: String(open), label: `${open ? 'Recolher' : 'Expandir'} a pasta ${node.name}` },
        on: { click: () => { if (open) expanded.delete(node.id); else expanded.add(node.id); render(); } }
      }, icon('chevron', open ? 'turned' : ''))
      : h('span.tree-spacer');
    const line = h('div.tree-row', { class: { current: node.id === currentId }, style: { '--level': level } }, toggle,
      h('button.tree-label', { type: 'button', aria: { current: node.id === currentId ? 'page' : undefined }, title: node.name, on: { click: () => onOpen(node.id) } }, icon('folder'), h('span', node.name)));
    dropTarget(line, { accept: event => drop.accept(event, node.id), onDrop: event => drop.onDrop(event, node.id) });
    return h('li', line, hasChildren && open ? h('ul', node.children.map(child => row(child, level + 1))) : null);
  }

  function render() {
    if (!tree) { mount(el); return; }
    const rootRow = h('div.tree-row', { class: { current: currentId === null }, style: { '--level': 0 } }, h('span.tree-spacer'),
      h('button.tree-label', { type: 'button', aria: { current: currentId === null ? 'page' : undefined }, on: { click: () => onOpen(null) } }, icon('cloud'), h('span', 'Biblioteca')));
    dropTarget(rootRow, { accept: event => drop.accept(event, null), onDrop: event => drop.onDrop(event, null) });
    mount(el, h('ul', h('li', rootRow, h('ul', tree.roots.map(node => row(node, 1))))));
  }

  return {
    el,
    // Define a árvore e a pasta aberta; as pastas do caminho até ela são expandidas para ela ficar visível.
    set(nextTree, nextCurrent) {
      tree = nextTree; currentId = nextCurrent;
      for (const folder of pathTo(tree, currentId).slice(0, -1)) expanded.add(folder.id);
      render();
    }
  };
}
