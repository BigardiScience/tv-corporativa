// Cache de arquivos baixados, SOMENTE em memória (Blob), com limite de tamanho: evita baixar de novo a cada volta do carrossel
// sem deixar a memória da TV crescer. O mais antigo sai primeiro. Nada é gravado em disco.

export const DEFAULT_CACHE_BYTES = 96 * 1024 * 1024;

export function createBlobCache({ budgetBytes = DEFAULT_CACHE_BYTES, maxEntries = 32 } = {}) {
  const entries = new Map(); // chave → Blob; a ordem do Map é a ordem de uso (o primeiro é o mais antigo)
  let bytes = 0;

  function drop(key) {
    const blob = entries.get(key);
    if (!blob) return false;
    entries.delete(key);
    bytes -= blob.size;
    return true;
  }

  return {
    get(key) {
      const blob = entries.get(key);
      if (!blob) return undefined;
      entries.delete(key);
      entries.set(key, blob); // usado agora: vai para o fim da fila
      return blob;
    },
    has: key => entries.has(key),
    // Devolve false quando o arquivo sozinho passa do limite (então ele não é guardado).
    set(key, blob) {
      if (!blob || !Number.isFinite(blob.size) || blob.size > budgetBytes) return false;
      drop(key);
      entries.set(key, blob);
      bytes += blob.size;
      while ((bytes > budgetBytes || entries.size > maxEntries) && entries.size > 1) drop(entries.keys().next().value);
      return true;
    },
    delete: drop,
    // Mantém somente as chaves informadas (a programação mudou: o resto não será mais usado).
    retain(keys) {
      const keep = new Set(keys);
      for (const key of [...entries.keys()]) if (!keep.has(key)) drop(key);
    },
    clear() { entries.clear(); bytes = 0; },
    stats: () => ({ entries: entries.size, bytes, budgetBytes })
  };
}
