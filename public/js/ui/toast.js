// Aviso curto no rodapé da tela. É uma região "aria-live": leitores de tela anunciam a mensagem sem mover o foco.
let timer;

export function toast(message, { kind = 'info', duration = 4800 } = {}) {
  const region = globalThis.document?.getElementById('toast');
  if (!region) return;
  region.textContent = String(message ?? '');
  region.dataset.kind = kind;
  region.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  region.classList.add('visible');
  clearTimeout(timer);
  timer = setTimeout(() => region.classList.remove('visible'), kind === 'error' ? Math.max(duration, 7000) : duration);
}

export function hideToast() {
  clearTimeout(timer);
  globalThis.document?.getElementById('toast')?.classList.remove('visible');
}
