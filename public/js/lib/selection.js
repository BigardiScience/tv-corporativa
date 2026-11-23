// Seleção de itens da biblioteca (pastas e arquivos). Sem DOM: só a regra de quem está marcado.
// Chaves: "f:<id>" para pasta e "m:<id>" para arquivo, assim um mesmo identificador nunca se confunde entre os dois tipos.

export const folderKey = id => `f:${id}`;
export const mediaKey = id => `m:${id}`;

export function createSelection() {
  const keys = new Set();
  let anchor = null;

  return {
    has: key => keys.has(key),
    get size() { return keys.size; },
    get keys() { return [...keys]; },
    toggle(key) {
      if (keys.has(key)) keys.delete(key); else keys.add(key);
      anchor = key;
      return keys.has(key);
    },
    // Shift + clique: marca tudo entre a última marcação e a atual, na ordem em que os itens aparecem na tela.
    range(order, key) {
      const to = order.indexOf(key);
      const from = anchor === null ? -1 : order.indexOf(anchor);
      if (to < 0) return;
      if (from < 0) { keys.add(key); anchor = key; return; }
      const [start, end] = from < to ? [from, to] : [to, from];
      for (const item of order.slice(start, end + 1)) keys.add(item);
    },
    set(list) { keys.clear(); for (const key of list) keys.add(key); anchor = null; },
    selectAll(order) { for (const key of order) keys.add(key); },
    clear() { keys.clear(); anchor = null; },
    // Depois de recarregar a lista, some da seleção o que não existe mais.
    prune(valid) {
      const allowed = new Set(valid);
      for (const key of [...keys]) if (!allowed.has(key)) keys.delete(key);
      if (anchor !== null && !keys.has(anchor)) anchor = null;
    },
    ids() {
      const folderIds = [], mediaIds = [];
      for (const key of keys) (key.startsWith('f:') ? folderIds : mediaIds).push(key.slice(2));
      return { folderIds, mediaIds };
    }
  };
}
