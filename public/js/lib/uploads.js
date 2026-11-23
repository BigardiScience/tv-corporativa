// Fila de envio de arquivos: validação prévia, execução com concorrência limitada, progresso e tratamento de duplicados.
// A fila não conhece a tela nem o servidor: recebe uma função `send` (que usa o cliente de API), por isso é testável sozinha.
import { isAbort } from './api.js';
import { mimeForName, validateMediaFile } from './media-validation.js';

const FORBIDDEN_IN_TITLE = /[\\/\u0000-\u001f\u007f]/g;
const FORBIDDEN_IN_TITLE_TEST = /[\\/\u0000-\u001f\u007f]/;

// "Comunicado RH.png" → "Comunicado RH" (o servidor aceita títulos livres de até 120 caracteres, sem barras).
export function titleFromFileName(name) {
  const withoutExtension = String(name ?? '').replace(/\.[^.]+$/, '');
  const clean = withoutExtension.replace(FORBIDDEN_IN_TITLE, ' ').replace(/\s+/g, ' ').trim();
  return (clean || String(name ?? '').replace(FORBIDDEN_IN_TITLE, ' ').trim() || 'Arquivo').slice(0, 120);
}

// Mensagem de problema no título digitado pela pessoa (vazio = ok). O servidor valida de novo.
export function checkTitle(title) {
  const text = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Informe um título.';
  if (text.length > 120) return 'O título pode ter até 120 caracteres.';
  if (FORBIDDEN_IN_TITLE_TEST.test(text)) return 'O título não pode conter barras (/ ou \\).';
  return '';
}

let sequence = 0;
const fingerprint = file => `${file.name}|${file.size}|${file.lastModified ?? 0}`;

// Valida cada arquivo e devolve itens prontos para a fila. Nada é enviado aqui.
export async function prepareFiles(files, { maxMB = 50, existing = [] } = {}) {
  const seen = new Set(existing.map(item => fingerprint(item.file)));
  const items = [];
  for (const file of files) {
    const item = { id: `upload-${++sequence}`, file, name: file.name, title: titleFromFileName(file.name), mime: mimeForName(file.name), status: 'ready', progress: 0, message: '', allowDuplicate: false, result: null, existing: null };
    if (seen.has(fingerprint(file))) { item.status = 'invalid'; item.message = 'Este arquivo já está na lista.'; items.push(item); continue; }
    seen.add(fingerprint(file));
    try { item.mime = await validateMediaFile(file, maxMB); } catch (error) { item.status = 'invalid'; item.message = error.message; }
    items.push(item);
  }
  return items;
}

export const isPending = item => item.status === 'ready';
export const summarize = items => ({
  total: items.length,
  ready: items.filter(item => item.status === 'ready').length,
  done: items.filter(item => item.status === 'done').length,
  duplicate: items.filter(item => item.status === 'duplicate').length,
  failed: items.filter(item => item.status === 'failed' || item.status === 'invalid').length,
  canceled: items.filter(item => item.status === 'canceled').length,
  running: items.filter(item => item.status === 'uploading').length
});

// Envia os itens "ready" com no máximo `concurrency` envios ao mesmo tempo. `send(item, { onProgress, signal })` devolve a mídia criada.
export async function runUploads(items, { send, concurrency = 2, signal, onChange = () => {} } = {}) {
  const queue = items.filter(isPending);
  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (signal?.aborted) { item.status = 'canceled'; item.message = 'Envio cancelado.'; onChange(item); continue; }
      item.status = 'uploading'; item.progress = 0; item.message = ''; onChange(item);
      try {
        item.result = await send(item, { signal, onProgress: value => { item.progress = value; onChange(item); } });
        item.status = 'done'; item.progress = 1;
      } catch (error) {
        if (isAbort(error)) { item.status = 'canceled'; item.message = 'Envio cancelado.'; }
        else if (error?.code === 'DUPLICATE_MEDIA') {
          item.status = 'duplicate'; item.existing = error.details?.existing ?? null;
          item.message = item.existing?.title ? `Já existe na biblioteca como “${item.existing.title}”.` : 'Este arquivo já existe na biblioteca.';
        } else { item.status = 'failed'; item.message = error?.message || 'Não foi possível enviar este arquivo.'; }
      }
      onChange(item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length || 1)) }, worker));
  return summarize(items);
}

// A pessoa confirmou que quer enviar mesmo sendo duplicado: volta o item para a fila com a autorização explícita.
export function allowDuplicate(item) {
  item.allowDuplicate = true; item.status = 'ready'; item.message = ''; item.progress = 0;
}

// Tentar de novo um envio que falhou ou foi cancelado.
export function retryItem(item) {
  item.status = 'ready'; item.message = ''; item.progress = 0; item.result = null;
}
