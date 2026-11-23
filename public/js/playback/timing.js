// Regras de tempo e de sequência do carrossel. Funções puras: não usam relógio, DOM nem rede, e por isso são testadas sozinhas.

// Quanto tempo o conteúdo fica na tela, contado desde o INÍCIO da transição de entrada (assim a soma dos tempos é a duração do ciclo).
//   - imagem, PDF e conteúdo interno: o tempo definido.
//   - vídeo com tempo definido: é um LIMITE. Toca até o fim ou até o limite, o que vier primeiro.
//   - vídeo em duração natural: toca até o fim (o evento "ended" decide). Há sempre um prazo de segurança: a duração do vídeo mais
//     uma folga, ou, se o aparelho não conseguir ler a duração, o tempo definido no item (assim nada prende o carrossel).
// Em todos os casos o conteúdo fica ao menos o tempo da própria transição de entrada, para duas transições nunca se sobreporem.
export const NATURAL_GRACE_MS = 2000;

export function dwellPlan(item, { naturalMs = null, transitionMs = 0 } = {}) {
  const known = Number.isFinite(naturalMs) && naturalMs > 0 ? naturalMs : null;
  const floor = Math.max(0, transitionMs);
  if (item.kind !== 'video') return { mode: 'timer', ms: Math.max(item.durationMs, floor), capMs: null };
  if (item.durationMode === 'natural') {
    if (known === null) return { mode: 'media', ms: null, capMs: Math.max(item.durationMs, floor) };
    return { mode: 'media', ms: null, capMs: Math.max(known, floor) + NATURAL_GRACE_MS };
  }
  const limit = known === null ? item.durationMs : Math.min(item.durationMs, known);
  return { mode: 'timer', ms: Math.max(limit, floor), capMs: null };
}

export function nextIndex(index, count, loop) {
  if (count <= 0) return null;
  const next = index + 1;
  return next < count ? next : (loop ? 0 : null);
}

// Navegação manual (Anterior/Próximo): sempre dá a volta, mesmo com a repetição desligada.
export const wrapIndex = (index, count) => (count <= 0 ? 0 : ((index % count) + count) % count);

// Próximo conteúdo que pode ser exibido depois de `from`, pulando os bloqueados (que falharam há pouco).
// Devolve o índice, 'end' (a sequência acabou e não repete) ou 'none' (todos os outros estão bloqueados).
export function pickPlayable(from, count, loop, isBlocked) {
  let cursor = from;
  for (let step = 0; step < count; step++) {
    cursor = nextIndex(cursor, count, loop);
    if (cursor === null) return 'end';
    if (cursor === from) return 'none';
    if (!isBlocked(cursor)) return cursor;
  }
  return 'none';
}

// Espera entre as tentativas de baixar um conteúdo. `random` entra para espalhar as TVs quando a rede volta.
export function retryDelay(attempt, { delaysMs = [1000, 3000], random = () => 0.5 } = {}) {
  const base = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 1000;
  return Math.round(base * (0.8 + 0.4 * random()));
}

// Espera entre as consultas da programação: normal quando tudo vai bem, e mais curta (com recuo) quando falha,
// para a TV voltar logo depois de uma queda de rede.
export function pollDelay(failures, { okMs = 20000, firstRetryMs = 5000, random = () => 0.5 } = {}) {
  if (failures <= 0) return okMs;
  return Math.round(Math.min(okMs, firstRetryMs * 2 ** (failures - 1)) * (0.8 + 0.4 * random()));
}
