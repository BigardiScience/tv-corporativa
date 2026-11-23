// Reordenação sem alterar a lista original.
export function moveItem(list, from, to) {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item);
  return copy;
}

export function insertAt(list, index, item) {
  const copy = [...list];
  copy.splice(Math.max(0, Math.min(index, copy.length)), 0, item);
  return copy;
}

export function removeAt(list, index) {
  return list.filter((_, position) => position !== index);
}
