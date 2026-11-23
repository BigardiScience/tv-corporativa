// Biblioteca: explorador de pastas e arquivos de um espaço (unidade + setor).
// Esta tela junta as peças: árvore de pastas, busca e filtros, grade/tabela, seleção em lote, arrastar e soltar, envio e detalhes.
// Ela não decide nada sobre permissões: esconde o que a pessoa não pode usar, mas cada chamada é conferida pelo servidor.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { anyDialogOpen } from '../../ui/dialogs.js';
import { button, emptyState, pageHeading } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { showError } from '../../ui/feedback.js';
import { buildTree, isInside, pathTo } from '../../lib/tree.js';
import { createSelection, folderKey, mediaKey } from '../../lib/selection.js';
import { defaultFilters, hasActiveFilters, parseLibraryQuery, toApiQuery, toRouteQuery } from '../../lib/library-query.js';
import { SORT_LABELS, plural } from '../../lib/format.js';
import { createFolderTree } from './tree.js';
import { dropTarget, hasFiles, hasItems, readPayload, startDrag } from './dnd.js';
import { renderItems, syncSelection, visibleKeys } from './items.js';
import { createFolder, deleteItems, moveItems, renameFolder, renameMedia, reviewItems } from './actions.js';
import { openUploadDialog } from './upload.js';
import { openMediaDetails } from './details.js';

// Lista suspensa com rótulo acessível. O valor é definido DEPOIS de criar as opções (senão o navegador ignora).
function selectBox({ label, value, options, onChange }) {
  const el = h('select', { aria: { label }, on: { change: () => onChange(el.value) } }, options.map(([optionValue, text]) => h('option', { value: optionValue }, text)));
  el.value = value;
  return el;
}

function checkOption(id, label, checked, onChange) {
  const input = h('input', { id, type: 'checkbox', checked, on: { change: () => onChange(input.checked) } });
  return { input, el: h('label.check-inline', { for: id }, input, label) };
}

function withoutSpace(ctx, container) {
  mount(container,
    pageHeading({ title: 'Biblioteca', description: 'Pastas e arquivos de cada unidade e setor.' }),
    emptyState({
      iconName: 'building', title: 'Escolha onde trabalhar',
      text: 'A biblioteca é separada por unidade e setor. Escolha o espaço para ver as pastas e enviar arquivos.',
      actions: [button('Escolher unidade e setor', { primary: true, icon: 'building', onClick: () => ctx.chooseSpace() })]
    }));
}

export async function mountLibrary(ctx, route, container, view) {
  const space = ctx.state.space;
  if (!space) { withoutSpace(ctx, container); return; }

  const folderId = route.params.folderId ?? null;
  const filters = parseLibraryQuery(route.query);
  const selection = createSelection();
  let mode = ctx.prefs.libraryView();
  let tree = buildTree([]);
  let data = null;
  let requestId = 0, searchTimer = null;

  const can = {
    folder: { update: ctx.canHere('folder:update'), delete: ctx.canHere('folder:delete') },
    media: { update: ctx.canHere('media:update'), delete: ctx.canHere('media:delete') },
    approve: ctx.canHere('media:approve')
  };
  const canCreateFolder = ctx.canHere('folder:create'), canUpload = ctx.canHere('media:upload');
  const canMoveSomething = can.folder.update || can.media.update;

  const fetchListing = (offset = 0) => ctx.api.get('/api/library', { query: toApiQuery({ space, folderId, filters, offset }) });
  const fetchTree = () => ctx.api.get('/api/folders', { query: { unitId: space.unitId, sectorId: space.sectorId } });

  let first;
  try {
    first = await Promise.all([fetchTree(), fetchListing()]);
  } catch (error) {
    if (error?.status === 404 && folderId && view.alive()) { toast('Esta pasta não existe mais.', { kind: 'error' }); ctx.navigate('library'); return; }
    throw error;
  }
  if (!view.alive()) return;
  tree = buildTree(first[0].folders);
  data = first[1];
  if (folderId && !tree.byId.has(folderId)) { toast('Esta pasta não existe mais.', { kind: 'error' }); ctx.navigate('library'); return; }

  // ---- navegação ---------------------------------------------------------------------------------------------------------
  const keepSort = () => toRouteQuery({ ...defaultFilters(), sort: filters.sort, order: filters.order });
  const openFolder = id => ctx.navigate('library', id ? { folderId: id } : {}, keepSort());
  const syncUrl = () => ctx.replaceUrl('library', folderId ? { folderId } : {}, toRouteQuery(filters));

  // ---- recarregar --------------------------------------------------------------------------------------------------------
  async function reload() {
    const id = ++requestId;
    itemsEl.setAttribute('aria-busy', 'true');
    try {
      const next = await fetchListing();
      if (id !== requestId || !view.alive()) return;
      data = next;
      selection.prune(visibleKeys(data));
      drawResults();
    } catch (error) {
      if (id === requestId && view.alive()) showError(error);
    } finally {
      if (id === requestId) itemsEl.removeAttribute('aria-busy');
    }
  }

  async function reloadTree() {
    try {
      const next = await fetchTree();
      if (!view.alive()) return;
      tree = buildTree(next.folders);
      treePanel.set(tree, folderId);
      drawBreadcrumbs();
    } catch (error) { if (view.alive()) showError(error); }
  }

  const afterChange = async () => {
    await Promise.all([reloadTree(), reload()]);
    ctx.refreshPending();
  };

  async function loadMore() {
    const id = requestId;
    more.disabled = true;
    try {
      const next = await fetchListing(data.media.length);
      if (id !== requestId || !view.alive()) return;
      data = { ...data, media: [...data.media, ...next.media], total: next.total };
      drawResults();
    } catch (error) { if (view.alive()) showError(error); } finally { more.disabled = false; }
  }

  // ---- arrastar e soltar -------------------------------------------------------------------------------------------------------
  async function moveByDrop(payload, targetId) {
    if (payload.space?.unitId !== space.unitId || payload.space?.sectorId !== space.sectorId) { toast('Estes itens pertencem a outra unidade ou setor.', { kind: 'error' }); return; }
    if ((payload.folderIds.length && !can.folder.update) || (payload.mediaIds.length && !can.media.update)) { toast('Seu perfil não pode mover estes itens.', { kind: 'error' }); return; }
    if (targetId && payload.folderIds.some(id => id === targetId || isInside(tree, id, targetId))) { toast('Uma pasta não pode ser movida para dentro dela mesma.', { kind: 'error' }); return; }
    // Itens que já estão no destino não precisam de chamada (só dá para saber dos que estão na tela).
    const where = new Map([...data.folders.map(item => [folderKey(item.id), item.parentId ?? null]), ...data.media.map(item => [mediaKey(item.id), item.folderId ?? null])]);
    const needed = [...payload.folderIds.map(folderKey), ...payload.mediaIds.map(mediaKey)].filter(key => where.get(key) !== (targetId ?? null));
    if (!needed.length) { toast('Os itens já estão nesta pasta.'); return; }
    try {
      await ctx.api.post('/api/library/batch', { action: 'move', folderIds: payload.folderIds, mediaIds: payload.mediaIds, targetFolderId: targetId });
      toast(`${plural(payload.folderIds.length + payload.mediaIds.length, 'item movido', 'itens movidos')}.`);
      selection.clear();
      await afterChange();
    } catch (error) { showError(error); }
  }

  const dropApi = {
    accept: (event, targetId) => (hasItems(event) && canMoveSomething) || (hasFiles(event) && canUpload),
    onDrop: (event, targetId) => {
      if (hasFiles(event)) { openUpload(event.dataTransfer.files, targetId); return; }
      const payload = readPayload(event);
      if (payload) moveByDrop(payload, targetId);
    }
  };

  function openUpload(files = [], destination = folderId) {
    if (!canUpload) { toast('Seu perfil não pode enviar arquivos neste espaço.', { kind: 'error' }); return; }
    openUploadDialog(ctx, { space, tree, folderId: destination, files: [...files], onDone: () => afterChange() });
  }

  // ---- seleção e ações ---------------------------------------------------------------------------------------------------------
  function selectedItems() {
    const { folderIds, mediaIds } = selection.ids();
    return { folders: data.folders.filter(item => folderIds.includes(item.id)), media: data.media.filter(item => mediaIds.includes(item.id)) };
  }

  function refreshSelection() {
    syncSelection(itemsEl, selection);
    const { folders, media } = selectedItems();
    const total = folders.length + media.length;
    selectionBar.hidden = total === 0;
    selectionText.textContent = total === 1 ? '1 item selecionado' : `${total} itens selecionados`;
    // Cada tipo de item selecionado exige a sua permissão; o servidor confere de novo.
    const allows = (kind, action) => !(kind === 'folder' ? folders : media).length || can[kind][action];
    batchApprove.hidden = batchReject.hidden = !(can.approve && media.length > 0);
    batchMove.hidden = !(allows('folder', 'update') && allows('media', 'update'));
    batchDelete.hidden = !(allows('folder', 'delete') && allows('media', 'delete'));
    const keys = visibleKeys(data);
    selectAll.checked = keys.length > 0 && keys.every(key => selection.has(key));
    selectAll.indeterminate = !selectAll.checked && selection.size > 0;
  }

  const handlers = {
    select(key, event) {
      if (event.shiftKey) selection.range(visibleKeys(data), key); else selection.toggle(key);
      refreshSelection();
    },
    openFolder: folder => openFolder(folder.id),
    openMedia: media => openMediaDetails(ctx, { mediaId: media.id, tree, onChanged: afterChange }),
    async rename(kind, item) { if (await (kind === 'folder' ? renameFolder(ctx, item) : renameMedia(ctx, item))) afterChange(); },
    async move(kind, item) {
      const moved = await moveItems(ctx, { tree, folders: kind === 'folder' ? [item] : [], media: kind === 'media' ? [item] : [], fromFolderId: kind === 'folder' ? item.parentId ?? null : item.folderId ?? null });
      if (moved) afterChange();
    },
    async remove(kind, item) { if (await deleteItems(ctx, { folders: kind === 'folder' ? [item] : [], media: kind === 'media' ? [item] : [] })) { selection.clear(); afterChange(); } },
    async review(media, decision) { if (await reviewItems(ctx, { media: [media], decision })) afterChange(); },
    sortBy(key) {
      if (filters.sort === key) filters.order = filters.order === 'asc' ? 'desc' : 'asc'; else { filters.sort = key; filters.order = 'asc'; }
      changed();
    },
    dragStart(event, key) {
      const keys = selection.has(key) ? selection.keys : [key];
      const ids = prefix => keys.filter(item => item.startsWith(prefix)).map(item => item.slice(2));
      startDrag(event, { space, folderIds: ids('f:'), mediaIds: ids('m:') }, keys.length === 1 ? 'item' : `${keys.length} itens`);
      main.classList.add('dragging');
    },
    dragEnd: () => main.classList.remove('dragging'),
    drop: dropApi
  };

  async function batchRun(work) {
    const done = await work();
    if (done) { selection.clear(); await afterChange(); }
  }

  // ---- filtros -----------------------------------------------------------------------------------------------------------------
  function changed() {
    selection.clear();
    syncUrl();
    drawControls();
    reload();
  }

  function setFilter(patch) { Object.assign(filters, patch); changed(); }

  function clearFilters() {
    searchInput.value = '';
    Object.assign(filters, { q: '', type: '', status: '', flat: false, wholeSpace: false });
    changed();
  }

  // ---- peças fixas da tela ----------------------------------------------------------------------------------------------------
  const searchInput = h('input#library-search', {
    type: 'search', value: filters.q, placeholder: 'Buscar pelo nome…', maxlength: '100', autocomplete: 'off', aria: { label: 'Buscar arquivos e pastas pelo nome' },
    on: {
      input: () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (searchInput.value.trim() !== filters.q) setFilter({ q: searchInput.value.trim() }); }, 300); },
      keydown: event => { if (event.key === 'Enter') { clearTimeout(searchTimer); if (searchInput.value.trim() !== filters.q) setFilter({ q: searchInput.value.trim() }); } }
    }
  });
  const typeSelect = selectBox({ label: 'Filtrar por tipo', value: filters.type, options: [['', 'Todos os tipos'], ['image', 'Imagens'], ['video', 'Vídeos'], ['pdf', 'PDF']], onChange: value => setFilter({ type: value }) });
  const statusSelect = selectBox({ label: 'Filtrar por situação', value: filters.status, options: [['', 'Todas as situações'], ['pending', 'Aguardando aprovação'], ['approved', 'Aprovados'], ['rejected', 'Rejeitados']], onChange: value => setFilter({ status: value }) });
  const sortSelect = selectBox({ label: 'Ordenar por', value: filters.sort, options: Object.entries(SORT_LABELS), onChange: value => setFilter({ sort: value }) });
  const orderButton = h('button.icon-button', { type: 'button', on: { click: () => setFilter({ order: filters.order === 'asc' ? 'desc' : 'asc' }) } });
  const flat = checkOption('library-flat', 'Mostrar arquivos das subpastas', filters.flat, value => setFilter({ flat: value }));
  const whole = checkOption('library-whole', 'Buscar em toda a biblioteca', filters.wholeSpace, value => setFilter({ wholeSpace: value }));
  const gridButton = h('button.icon-button', { type: 'button', title: 'Ver em grade', aria: { label: 'Ver em grade' }, on: { click: () => setMode('grid') } }, icon('grid'));
  const listButton = h('button.icon-button', { type: 'button', title: 'Ver em lista', aria: { label: 'Ver em lista' }, on: { click: () => setMode('list') } }, icon('rows'));

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    ctx.prefs.setLibraryView(mode);
    drawControls();
    drawResults();
  }

  function drawControls() {
    mount(orderButton, icon(filters.order === 'asc' ? 'up' : 'down'));
    orderButton.title = filters.order === 'asc' ? 'Ordem crescente (clique para inverter)' : 'Ordem decrescente (clique para inverter)';
    orderButton.setAttribute('aria-label', orderButton.title);
    typeSelect.value = filters.type; statusSelect.value = filters.status; sortSelect.value = filters.sort;
    flat.input.checked = filters.flat; whole.input.checked = filters.wholeSpace;
    whole.el.hidden = !(folderId && filters.q);
    gridButton.setAttribute('aria-pressed', String(mode === 'grid')); listButton.setAttribute('aria-pressed', String(mode === 'list'));
    gridButton.classList.toggle('active', mode === 'grid'); listButton.classList.toggle('active', mode === 'list');
    clearButton.hidden = !hasActiveFilters(filters);
  }

  const clearButton = button('Limpar filtros', { icon: 'close', onClick: clearFilters });
  const selectAll = h('input', { type: 'checkbox', aria: { label: 'Selecionar todos os itens da lista' }, on: { click: event => {
    const keys = visibleKeys(data);
    if (keys.every(key => selection.has(key))) selection.clear(); else selection.selectAll(keys);
    event.stopPropagation(); refreshSelection();
  } } });
  const selectionText = h('b');
  const batchMove = button('Mover', { icon: 'move', onClick: () => batchRun(() => moveItems(ctx, { tree, ...selectedItems(), fromFolderId: data.query?.flat ? undefined : folderId })) });
  const batchApprove = button('Aprovar', { icon: 'check-circle', primary: true, onClick: () => batchRun(() => reviewItems(ctx, { media: selectedItems().media, decision: 'approve' })) });
  const batchReject = button('Rejeitar', { icon: 'x-circle', onClick: () => batchRun(() => reviewItems(ctx, { media: selectedItems().media, decision: 'reject' })) });
  const batchDelete = button('Excluir', { icon: 'trash', danger: true, onClick: () => batchRun(() => deleteItems(ctx, selectedItems())) });
  const selectionBar = h('div.selection-bar', { role: 'region', aria: { label: 'Ações para os itens selecionados' }, hidden: true },
    selectionText, h('div.actions', batchApprove, batchReject, batchMove, batchDelete, button('Limpar seleção', { onClick: () => { selection.clear(); refreshSelection(); } })));

  const breadcrumbs = h('nav.breadcrumb-bar', { aria: { label: 'Caminho da pasta' } });
  const countEl = h('p.library-count', { role: 'status', aria: { live: 'polite' } });
  const itemsEl = h('div#library-items');
  const more = button('Mostrar mais arquivos', { icon: 'down', onClick: () => loadMore() });
  const moreWrap = h('div.load-more', { hidden: true }, more);
  const overlay = h('div.drop-overlay', { hidden: true, aria: { hidden: 'true' } }, icon('upload'), h('b', 'Solte os arquivos para enviar'));

  const treePanel = createFolderTree({ onOpen: openFolder, drop: dropApi });
  const side = h('aside.library-side', h('div.panel', h('div.panel-head', h('h2', 'Pastas')), treePanel.el));

  const toolbar = h('div.toolbar.library-toolbar',
    h('div.field-search', icon('search'), searchInput),
    typeSelect, statusSelect, sortSelect, orderButton,
    h('div.view-toggle', { role: 'group', aria: { label: 'Modo de exibição' } }, gridButton, listButton));
  const options = h('div.library-options', h('label.check-inline.select-all', selectAll, 'Selecionar todos'), flat.el, whole.el, clearButton);

  const main = h('div.library-main', breadcrumbs, toolbar, options, selectionBar, countEl, itemsEl, moreWrap, overlay);

  // Arquivos arrastados do computador: soltar em qualquer ponto da área principal abre o envio para a pasta aberta.
  main.addEventListener('dragover', event => { if (hasFiles(event) && canUpload) { event.preventDefault(); overlay.hidden = false; } });
  main.addEventListener('dragleave', event => { if (!main.contains(event.relatedTarget)) overlay.hidden = true; });
  main.addEventListener('drop', event => { overlay.hidden = true; if (hasFiles(event)) { event.preventDefault(); openUpload(event.dataTransfer.files, folderId); } });
  // Fora da área principal um arquivo solto faria o navegador abrir o arquivo e sair do painel: isso é impedido.
  const guardDrop = event => { if (hasFiles(event)) event.preventDefault(); };
  globalThis.addEventListener('dragover', guardDrop);
  globalThis.addEventListener('drop', guardDrop);
  const onKey = event => { if (event.key === 'Escape' && selection.size && !anyDialogOpen()) { selection.clear(); refreshSelection(); } };
  globalThis.document.addEventListener('keydown', onKey);
  view.onDispose(() => {
    clearTimeout(searchTimer);
    globalThis.removeEventListener('dragover', guardDrop);
    globalThis.removeEventListener('drop', guardDrop);
    globalThis.document.removeEventListener('keydown', onKey);
  });

  // ---- desenho -----------------------------------------------------------------------------------------------------------------
  function drawBreadcrumbs() {
    const path = pathTo(tree, folderId);
    const crumb = (label, id, current) => {
      if (current) return h('span.crumb.current', { aria: { current: 'page' } }, label);
      const link = h('a.crumb', { href: ctx.link('library', id ? { folderId: id } : {}, keepSort()) }, label);
      return dropTarget(link, { accept: event => dropApi.accept(event, id), onDrop: event => dropApi.onDrop(event, id) });
    };
    mount(breadcrumbs, crumb('Biblioteca', null, path.length === 0),
      ...path.flatMap((folder, index) => [icon('chevron'), crumb(folder.name, folder.id, index === path.length - 1)]));
  }

  function emptyView() {
    const actions = [];
    if (canUpload) actions.push(button('Enviar arquivos', { primary: true, icon: 'upload', onClick: () => openUpload() }));
    if (canCreateFolder) actions.push(button('Nova pasta', { icon: 'folder-plus', onClick: () => newFolder() }));
    if (hasActiveFilters(filters)) {
      return emptyState({ iconName: 'search', title: 'Nada encontrado', text: 'Nenhum item corresponde à busca ou aos filtros escolhidos.', actions: [button('Limpar filtros', { primary: true, icon: 'close', onClick: clearFilters })] });
    }
    if (!folderId) {
      return emptyState({ iconName: 'folder', title: 'A biblioteca está vazia', text: canUpload ? 'Envie imagens, vídeos ou PDFs exportados das suas ferramentas. Depois organize tudo em pastas.' : 'Ainda não há arquivos neste espaço.', actions });
    }
    return emptyState({ iconName: 'folder', title: 'Esta pasta está vazia', text: canUpload ? 'Envie arquivos para cá ou arraste arquivos de outra pasta.' : 'Ainda não há itens nesta pasta.', actions });
  }

  function drawResults() {
    drawBreadcrumbs();
    const folderCount = data.folders.length, shown = data.media.length;
    if (!folderCount && !shown) countEl.textContent = '';
    else {
      const parts = [];
      if (folderCount) parts.push(plural(folderCount, 'pasta', 'pastas'));
      parts.push(shown < data.total ? `${shown} de ${plural(data.total, 'arquivo', 'arquivos')}` : plural(data.total, 'arquivo', 'arquivos'));
      countEl.textContent = parts.join(' · ');
    }
    if (!folderCount && !shown) mount(itemsEl, emptyView());
    else mount(itemsEl, renderItems({ data, mode, selection, thumbnails: ctx.thumbnails, can, sort: { key: filters.sort, order: filters.order }, handlers }));
    moreWrap.hidden = shown >= data.total;
    refreshSelection();
  }

  async function newFolder() {
    const folder = await createFolder(ctx, { space, parentId: folderId });
    if (folder) afterChange();
  }

  const headingActions = [];
  if (canCreateFolder) headingActions.push(button('Nova pasta', { icon: 'folder-plus', onClick: () => newFolder() }));
  if (canUpload) headingActions.push(button('Enviar arquivos', { primary: true, icon: 'upload', onClick: () => openUpload() }));

  mount(container,
    pageHeading({
      eyebrow: `${ctx.unitName(space.unitId)} · ${ctx.sectorName(space.sectorId)}`.toUpperCase(),
      title: 'Biblioteca',
      description: canUpload || canCreateFolder ? 'Organize arquivos em pastas, revise e aprove o que vai para as telas.' : 'Consulte as pastas e os arquivos deste espaço. Seu perfil é somente de leitura.',
      actions: headingActions
    }),
    h('div.library-layout', side, main));

  treePanel.set(tree, folderId);
  drawControls();
  drawResults();
  view.refresh = async () => { await Promise.all([reloadTree(), reload()]); };
  if (ctx.takeFocusRequest('library-search')) searchInput.focus();
}
