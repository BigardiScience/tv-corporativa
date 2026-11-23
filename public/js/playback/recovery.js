// Memória da posição da exibição, para a TV retomar de onde estava depois de uma queda de energia, de uma recarga da página
// ou de uma reconexão. Guarda só a posição (um número) e uma assinatura curta da programação, nunca conteúdo nem credencial.
// `storage` é opcional ({ get, set, remove }); sem ele nada é lembrado.
import { hashText } from './model.js';

const KEY = 'tv-corporativa.playback.v1';
export const RESUME_MAX_AGE_MS = 10 * 60 * 1000;

export function saveProgress(storage, { signature, index, at }) {
  if (!storage || !Number.isInteger(index) || index < 0) return;
  try { storage.set(KEY, JSON.stringify({ s: hashText(signature), i: index, t: at })); } catch { /* sem armazenamento */ }
}

// Devolve o índice a retomar, ou null: programação diferente, registro antigo demais, hora que voltou no tempo ou texto inválido.
export function loadProgress(storage, signature, { now, count, maxAgeMs = RESUME_MAX_AGE_MS }) {
  if (!storage) return null;
  try {
    const saved = JSON.parse(storage.get(KEY) ?? 'null');
    if (!saved || saved.s !== hashText(signature) || !Number.isInteger(saved.i) || !Number.isFinite(saved.t)) return null;
    const age = now - saved.t;
    if (age < 0 || age > maxAgeMs || saved.i < 0 || saved.i >= count) return null;
    return saved.i;
  } catch { return null; }
}

export function clearProgress(storage) {
  try { storage?.remove(KEY); } catch { /* ignorado */ }
}
