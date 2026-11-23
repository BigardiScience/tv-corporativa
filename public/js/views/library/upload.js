// Janela de envio de arquivos: escolha da pasta, fila com título editável, progresso por arquivo, duplicados e cancelamento.
// A fila (lib/uploads.js) cuida de validar e enviar; aqui só se desenha o andamento e se atende ao que a pessoa decide.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { button, field, notice } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { ACCEPT, kindForMime } from '../../lib/media-validation.js';
import { allowDuplicate, checkTitle, isPending, prepareFiles, retryItem, runUploads, summarize } from '../../lib/uploads.js';
import { destinationOptions } from '../../lib/tree.js';
import { formatBytes, plural } from '../../lib/format.js';

const MAX_QUEUE = 50;
const KIND_ICON = { image: 'image', video: 'video', pdf: 'file' };
const indent = level => '  '.repeat(Math.max(0, level - 1));

// `files`: arquivos já escolhidos (por exemplo, soltos na tela). `onDone(enviados)` roda uma vez ao fechar, se algo foi enviado.
export function openUploadDialog(ctx, { space, tree, folderId = null, files = [], onDone } = {}) {
  const maxMB = ctx.state.limits?.maxUploadMB ?? 50;
  const items = [];
  let running = false, controller = null, closed = false, notified = false;

  const select = h('select#upload-folder', { name: 'folder' },
    h('option', { value: '' }, 'Biblioteca (raiz)'),
    destinationOptions(tree, {}).map(option => h('option', { value: option.id }, `${indent(option.level)}${option.name}`)));
  select.value = folderId && tree.byId.has(folderId) ? folderId : '';

  const input = h('input#upload-input', { type: 'file', multiple: true, accept: ACCEPT, aria: { label: 'Escolher arquivos para enviar' } });
  const zone = h('div.dropzone', icon('upload'), h('b', 'Arraste os arquivos até aqui ou clique para escolher'),
    h('p', `PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM ou PDF · até ${maxMB} MB por arquivo`), input);
  const list = h('ul.upload-list', { aria: { label: 'Arquivos para enviar' } });
  const summary = h('p.upload-summary', { role: 'status', aria: { live: 'polite' } });
  let dialog, send, cancel, close;

  // ---- desenho -------------------------------------------------------------------------------------------------------
  function statusCell(item) {
    if (item.status === 'uploading') {
      return h('div.upload-progress', h('progress', { max: '100', value: String(Math.round(item.progress * 100)), aria: { label: `Enviando ${item.title}` } }), h('span', `${Math.round(item.progress * 100)}%`));
    }
    if (item.status === 'done') return h('span.upload-state.ok', icon('check-circle'), item.result?.status === 'approved' ? 'Enviado' : 'Enviado · aguarda aprovação');
    if (item.status === 'ready') return h('span.upload-state', 'Pronto para enviar');
    return h('span.upload-state.bad', icon('alert'), item.message || 'Não foi possível enviar.');
  }

  function rowActions(item) {
    if (running && item.status === 'uploading') return null;
    const remove = button('Remover', { icon: 'close', onClick: () => { items.splice(items.indexOf(item), 1); draw(); } });
    if (item.status === 'duplicate') {
      return [button('Enviar mesmo assim', { onClick: () => { allowDuplicate(item); draw(); } }), remove];
    }
    if (item.status === 'failed' || item.status === 'canceled') return [button('Tentar de novo', { icon: 'refresh', onClick: () => { retryItem(item); draw(); } }), remove];
    if (item.status === 'done') return null;
    return remove;
  }

  function row(item) {
    const editable = item.status === 'ready';
    const problem = h('small.field-error', { hidden: !item.titleError }, item.titleError ?? '');
    const titleInput = h('input', {
      type: 'text', value: item.title, maxlength: '120', spellcheck: 'false', autocomplete: 'off', disabled: !editable,
      aria: { label: `Título de ${item.name}` },
      on: { input: event => { item.title = event.currentTarget.value; item.titleError = ''; problem.hidden = true; } }
    });
    return h('li.upload-row', { dataset: { id: item.id, status: item.status }, class: { invalid: item.status === 'invalid' || item.status === 'failed' || !!item.titleError } },
      h('span.upload-icon', icon(KIND_ICON[kindForMime(item.mime)] ?? 'file')),
      h('div.upload-main', titleInput, problem, h('small', `${item.name} · ${formatBytes(item.file.size)}`)),
      h('div.upload-status', statusCell(item)),
      h('div.upload-actions', rowActions(item)));
  }

  function drawRow(item) {
    const current = list.querySelector(`[data-id="${item.id}"]`);
    if (current) current.replaceWith(row(item)); else draw();
    drawSummary();
  }

  // Durante o envio o andamento muda várias vezes por segundo: só a barra é atualizada, sem refazer a linha.
  function update(item) {
    const current = list.querySelector(`[data-id="${item.id}"]`);
    if (item.status === 'uploading' && current?.dataset.status === 'uploading') {
      const percent = Math.round(item.progress * 100);
      const bar = current.querySelector('progress'), label = current.querySelector('.upload-progress span');
      if (bar) bar.value = percent;
      if (label) label.textContent = `${percent}%`;
      return;
    }
    drawRow(item);
  }

  function drawSummary() {
    const count = summarize(items);
    const size = items.filter(isPending).reduce((sum, item) => sum + item.file.size, 0);
    const parts = [];
    if (count.ready) parts.push(`${plural(count.ready, 'arquivo pronto', 'arquivos prontos')} (${formatBytes(size)})`);
    if (count.running) parts.push(`${count.running} enviando`);
    if (count.done) parts.push(`${count.done} enviado${count.done === 1 ? '' : 's'}`);
    if (count.duplicate) parts.push(`${plural(count.duplicate, 'duplicado', 'duplicados')}`);
    if (count.failed) parts.push(`${plural(count.failed, 'com problema', 'com problemas')}`);
    if (count.canceled) parts.push(`${plural(count.canceled, 'cancelado', 'cancelados')}`);
    summary.textContent = parts.join(' · ');
    if (send) {
      send.disabled = running || count.ready === 0;
      mount(send, icon('upload'), running ? 'Enviando…' : count.ready ? `Enviar ${plural(count.ready, 'arquivo', 'arquivos')}` : 'Enviar');
    }
    if (cancel) cancel.hidden = !running;
    if (close) close.textContent = count.done && !running ? 'Concluir' : 'Fechar';
    select.disabled = running;
  }

  function draw() {
    mount(list, ...items.map(row));
    list.hidden = items.length === 0;
    drawSummary();
  }

  // ---- ações ---------------------------------------------------------------------------------------------------------
  async function addFiles(chosen) {
    const incoming = [...chosen];
    if (!incoming.length) return;
    const room = MAX_QUEUE - items.length;
    if (room <= 0) { toast(`A fila aceita até ${MAX_QUEUE} arquivos por vez. Envie estes e adicione os próximos.`, { kind: 'error' }); return; }
    if (incoming.length > room) toast(`Foram adicionados os primeiros ${room} arquivos. A fila aceita até ${MAX_QUEUE} por vez.`, { kind: 'error' });
    const prepared = await prepareFiles(incoming.slice(0, room), { maxMB, existing: items });
    if (closed) return;
    items.push(...prepared);
    dialog.clearError();
    draw();
  }

  function notifyDone() {
    if (notified) return;
    const sent = items.filter(item => item.status === 'done');
    if (!sent.length) return;
    notified = true;
    onDone?.(sent.map(item => item.result));
  }

  async function start() {
    const ready = items.filter(isPending);
    let firstBad = null;
    for (const item of ready) {
      item.titleError = checkTitle(item.title);
      if (item.titleError && !firstBad) firstBad = item;
    }
    if (firstBad) {
      draw();
      dialog.setError('Corrija os títulos indicados e envie de novo.');
      list.querySelector(`[data-id="${firstBad.id}"] input`)?.focus();
      return;
    }
    dialog.clearError();
    const destination = select.value || null;
    running = true; controller = new AbortController();
    draw();
    const request = (item, { onProgress, signal }) => ctx.api.upload('/api/media', {
      query: { name: item.name, title: item.title.replace(/\s+/g, ' ').trim(), unitId: space.unitId, sectorId: space.sectorId, folderId: destination, duplicate: item.allowDuplicate ? 'allow' : undefined },
      file: item.file, contentType: item.mime, onProgress, signal
    });
    const result = await runUploads(items, { send: request, concurrency: 2, signal: controller.signal, onChange: item => { if (!closed) update(item); } });
    running = false; controller = null;
    if (closed) { notifyDone(); return; }
    draw();
    if (result.failed === 0 && result.duplicate === 0 && result.ready === 0 && result.done > 0) {
      toast(`${plural(result.done, 'arquivo enviado', 'arquivos enviados')}. Aprove os conteúdos antes de publicar nas TVs.`);
      dialog.close(true);
    } else if (result.done > 0) {
      toast(`${plural(result.done, 'arquivo enviado', 'arquivos enviados')}. Veja abaixo o que precisa de atenção.`);
    }
  }

  // ---- montagem ------------------------------------------------------------------------------------------------------
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  for (const name of ['dragenter', 'dragover']) zone.addEventListener(name, event => { event.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('dragover'); addFiles(event.dataTransfer?.files ?? []); });

  send = button('Enviar', { primary: true, icon: 'upload', disabled: true, onClick: () => start() });
  cancel = button('Cancelar envios', { icon: 'stop', onClick: () => controller?.abort() });
  cancel.hidden = true;
  close = button('Fechar', { onClick: () => dialog.close(false) });

  dialog = openModal({
    title: 'Enviar arquivos', subtitle: 'Os arquivos entram na biblioteca como “aguardando aprovação”. Só conteúdos aprovados vão para as TVs.', size: 'large',
    body: [
      h('div.form-grid', field({ label: 'Enviar para a pasta', control: select, full: true })),
      zone, list, summary,
      ctx.state.scannerConfigured ? null : notice('Este ambiente não tem verificação antivírus configurada. Em produção, a TI deve habilitá-la.', { iconName: 'shield', tone: 'info', className: 'mt' })
    ],
    footer: [cancel, close, send],
    onClose: () => { closed = true; controller?.abort(); if (!running) notifyDone(); }
  });
  draw();
  if (files.length) addFiles(files);
  return dialog.closed;
}
