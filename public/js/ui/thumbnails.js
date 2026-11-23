// Miniaturas de imagens da biblioteca, geradas no navegador e guardadas SOMENTE em memória (blob:), nunca em disco.
// O servidor ainda não gera miniaturas (previsto para a Fase 4, junto com as conversões): aqui cada original é baixado uma vez, reduzido e reaproveitado.
// Carregamento sob demanda (só o que aparece na tela) e no máximo poucos downloads ao mesmo tempo.

export function createThumbnailer({
  fetchBlob = async url => { const response = await globalThis.fetch(url, { credentials: 'same-origin', cache: 'no-store' }); if (!response.ok) throw new Error('indisponível'); return response.blob(); },
  maxWidth = 360, concurrency = 3, limit = 240
} = {}) {
  const cache = new Map();
  const queue = [];
  let active = 0, observer = null;

  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      job().finally(() => { active--; pump(); });
    }
  }

  async function render(url) {
    const original = URL.createObjectURL(await fetchBlob(url));
    try {
      const image = new globalThis.Image();
      image.src = original;
      await image.decode();
      const scale = Math.min(1, maxWidth / image.naturalWidth);
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(result => (result ? resolve(result) : reject(new Error('sem miniatura'))), 'image/jpeg', 0.82));
      return URL.createObjectURL(blob);
    } finally {
      URL.revokeObjectURL(original);
    }
  }

  function get(key, url) {
    if (cache.has(key)) return cache.get(key);
    const promise = new Promise((resolve, reject) => { queue.push(async () => { try { resolve(await render(url)); } catch (error) { reject(error); } }); });
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
    if (cache.size > limit) {
      const oldest = cache.keys().next().value;
      cache.get(oldest)?.then(address => URL.revokeObjectURL(address), () => {});
      cache.delete(oldest);
    }
    pump();
    return promise;
  }

  // Liga uma <img> à miniatura: só começa a baixar quando o elemento fica visível.
  function attach(img, key, url, onFail) {
    const load = () => get(key, url).then(address => { img.src = address; }, () => onFail?.());
    if (typeof globalThis.IntersectionObserver !== 'function') { load(); return; }
    observer ??= new globalThis.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        entry.target.__thumbnailLoad?.();
      }
    }, { rootMargin: '300px' });
    img.__thumbnailLoad = load;
    observer.observe(img);
  }

  function dispose() {
    for (const promise of cache.values()) promise.then(address => URL.revokeObjectURL(address), () => {});
    cache.clear();
    queue.length = 0;
    observer?.disconnect();
    observer = null;
  }

  return { get, attach, dispose, get size() { return cache.size; } };
}
