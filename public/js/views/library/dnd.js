// Arrastar e soltar na biblioteca. O conteúdo arrastado é só uma lista de identificadores; quem recebe confere tudo no servidor.
export const ITEMS_TYPE = 'application/x-tvcorp-items';

export function startDrag(event, payload, label) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(ITEMS_TYPE, JSON.stringify(payload));
  event.dataTransfer.setData('text/plain', label); // alguns navegadores só iniciam o arrasto com um tipo de texto
}

export const hasItems = event => [...(event.dataTransfer?.types ?? [])].includes(ITEMS_TYPE);
export const hasFiles = event => [...(event.dataTransfer?.types ?? [])].includes('Files');

export function readPayload(event) {
  try {
    const value = JSON.parse(event.dataTransfer.getData(ITEMS_TYPE));
    const ids = list => (Array.isArray(list) ? list.filter(id => typeof id === 'string').slice(0, 200) : []);
    return { space: value.space, folderIds: ids(value.folderIds), mediaIds: ids(value.mediaIds) };
  } catch { return null; }
}

// Marca um elemento como destino de soltura. `accept(event)` decide se aquele arrasto vale para este destino.
export function dropTarget(element, { accept, onDrop }) {
  let depth = 0;
  const on = (name, handler) => element.addEventListener(name, handler);
  on('dragenter', event => { if (accept(event)) { depth++; element.classList.add('drop-over'); } });
  on('dragover', event => { if (accept(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
  on('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) element.classList.remove('drop-over'); });
  on('drop', event => {
    depth = 0;
    element.classList.remove('drop-over');
    if (!accept(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onDrop(event);
  });
  return element;
}
