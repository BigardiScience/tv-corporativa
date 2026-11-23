// Entrega ao navegador um arquivo montado na própria página (CSV da auditoria). O conteúdo não passa por nenhum servidor:
// vira um endereço blob: temporário que é revogado logo depois.
import { h } from './dom.js';

export function downloadBlob(name, blob, { urlApi = globalThis.URL, doc = globalThis.document, later = (fn, ms) => setTimeout(fn, ms) } = {}) {
  const url = urlApi.createObjectURL(blob);
  const link = h('a', { href: url, download: name, hidden: true });
  doc.body.appendChild(link);
  link.click();
  link.remove();
  later(() => urlApi.revokeObjectURL(url), 1000);
}
