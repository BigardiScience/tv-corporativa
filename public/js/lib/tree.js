// Árvore de pastas de um espaço (unidade + setor), montada a partir da lista plana entregue pela API.

const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base', numeric: true });

export function buildTree(flat) {
  const nodes = new Map(flat.map(folder => [folder.id, { ...folder, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    (parent ? parent.children : roots).push(node);
  }
  const sortAll = list => { list.sort(byName); for (const node of list) sortAll(node.children); };
  sortAll(roots);
  return { roots, byId: nodes };
}

// Pastas da raiz até a indicada (inclusive). Vazio para a raiz da biblioteca.
export function pathTo(tree, id) {
  const path = [];
  for (let node = id ? tree.byId.get(id) : null; node; node = node.parentId ? tree.byId.get(node.parentId) : null) path.unshift(node);
  return path;
}

// `id` está dentro de `ancestorId` (ou é a própria pasta)?
export function isInside(tree, ancestorId, id) {
  for (let node = tree.byId.get(id); node; node = node.parentId ? tree.byId.get(node.parentId) : null) if (node.id === ancestorId) return true;
  return false;
}

export function descendantIds(tree, id) {
  const result = [];
  const visit = node => { for (const child of node.children) { result.push(child.id); visit(child); } };
  const node = tree.byId.get(id);
  if (node) visit(node);
  return result;
}

// Lista plana e indentada para menus de escolha de destino. `blocked` = pastas que não podem ser destino (e suas subpastas).
export function destinationOptions(tree, { blocked = [], maxDepth = 8, movingDepth = 0 } = {}) {
  const forbidden = new Set();
  for (const id of blocked) { forbidden.add(id); for (const child of descendantIds(tree, id)) forbidden.add(child); }
  const options = [];
  const visit = (list, level) => {
    for (const node of list) {
      options.push({ id: node.id, name: node.name, level, disabled: forbidden.has(node.id) || node.depth + movingDepth > maxDepth });
      visit(node.children, level + 1);
    }
  };
  visit(tree.roots, 1);
  return options;
}

// Altura da subárvore (1 para uma pasta sem filhas).
export function subtreeHeight(tree, id) {
  const height = node => 1 + Math.max(0, ...node.children.map(height));
  const node = tree.byId.get(id);
  return node ? height(node) : 0;
}
