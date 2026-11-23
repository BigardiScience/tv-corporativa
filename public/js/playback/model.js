// Modelo da reprodução: como um conteúdo da programação (manifesto da TV ou rascunho do painel) vira um item do carrossel.
// Código puro (sem DOM, sem rede, sem relógio): é o mesmo no player da TV e na pré-visualização do painel.

export const TRANSITION_NAMES = Object.freeze(['cut', 'fade', 'dissolve', 'slide', 'zoom']);
export const MIN_DURATION_S = 5, MAX_DURATION_S = 3600, DEFAULT_DURATION_S = 15;
export const MAX_TRANSITION_MS = 3000, DEFAULT_TRANSITION_MS = 600;
// Item criado por código interno (demonstração e teste de efeito): não passa pelo limite mínimo de 5 s dos conteúdos reais.
const MIN_INTERNAL_MS = 500;

export function kindOfType(type) {
  if (typeof type !== 'string') return 'other';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf') return 'pdf';
  if (type === 'application/x-tvcorp-html') return 'html';
  return 'other';
}

const clamp = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

// Aceita o item como o servidor o entrega (duration em segundos) e devolve o formato interno (milissegundos).
// Campos ausentes (servidor da versão 1.1.0) viram os padrões antigos: corte seco, tempo definido, 15 s.
export function normalizeItem(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const type = typeof source.type === 'string' ? source.type : '';
  const kind = kindOfType(type);
  const internalMs = Number.isFinite(source.durationMs) ? Math.max(MIN_INTERNAL_MS, Math.round(source.durationMs)) : null;
  const durationMs = internalMs ?? clamp(source.duration ?? source.durationS, MIN_DURATION_S, MAX_DURATION_S, DEFAULT_DURATION_S) * 1000;
  const transition = TRANSITION_NAMES.includes(source.transition) ? source.transition : 'cut';
  const transitionMs = transition === 'cut' ? 0 : clamp(source.transitionMs, 0, MAX_TRANSITION_MS, DEFAULT_TRANSITION_MS);
  const title = String(source.title || source.name || 'Conteúdo').slice(0, 160);
  const item = {
    key: `${index}:${source.id ?? ''}`, id: source.id == null ? '' : String(source.id), title, type, kind, url: typeof source.url === 'string' ? source.url : '',
    durationMs,
    // A duração natural só existe para vídeo; em qualquer outro conteúdo vale o tempo definido.
    durationMode: source.durationMode === 'natural' && kind === 'video' ? 'natural' : 'fixed',
    transition: transitionMs === 0 ? 'cut' : transition, transitionMs
  };
  if (typeof source.render === 'function') item.render = source.render;
  return item;
}

export const normalizeItems = list => (Array.isArray(list) ? list : []).map((raw, index) => normalizeItem(raw, index));

// FNV-1a de 32 bits: identificador curto e estável de um texto (não é segurança, só comparação).
export function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Duas listas com a mesma assinatura tocam exatamente igual. A repetição (loop) não entra: mudar só ela não reinicia a exibição.
export const sequenceSignature = items => JSON.stringify(items.map(item => [item.id, item.url, item.type, item.durationMs, item.durationMode, item.transition, item.transitionMs, item.title]));

// Estimativa do ciclo para a tela de edição: soma dos tempos definidos; vídeos em duração natural não têm tempo conhecido.
export function cycleEstimate(items) {
  let fixedMs = 0, naturalVideos = 0;
  for (const item of items) {
    if (item.durationMode === 'natural') naturalVideos++;
    else fixedMs += item.durationMs;
  }
  return { fixedMs, naturalVideos };
}
