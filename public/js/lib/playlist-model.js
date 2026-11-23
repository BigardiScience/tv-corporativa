// Modelo do rascunho de playlist no editor: conversão de/para a API, validações e resumo. Sem DOM.
import { TRANSITION_LABELS, formatDuration, own } from './format.js';
import { kindForMime } from './media-validation.js';

export const DEFAULT_DURATION = 15;
export const DEFAULT_TRANSITION_MS = 600;
export const MIN_DURATION = 5, MAX_DURATION = 3600, MAX_TRANSITION_MS = 3000;

// Tempo de exibição: "fixed" = o tempo definido (em vídeo, um limite: toca até o fim ou até o limite); "natural" = o vídeo toca até o fim.
export const DURATION_MODES = Object.freeze(['fixed', 'natural']);
export const DURATION_MODE_LABELS = Object.freeze({ fixed: 'Tempo definido (limite)', natural: 'Até o fim do vídeo' });
export const DURATION_MODE_HELP = Object.freeze({
  fixed: 'O vídeo toca até o fim ou até o limite definido, o que vier primeiro.',
  natural: 'O vídeo toca inteiro, qualquer que seja a duração dele. O tempo ao lado só vale como reserva se a TV não conseguir ler a duração.'
});
export const LOOP_HELP = Object.freeze({
  on: 'Ao terminar o último conteúdo, a TV volta ao primeiro e segue em ciclo.',
  off: 'A TV exibe a sequência uma vez e mantém o último conteúdo na tela.'
});

let counter = 0;
const newKey = () => `item-${++counter}`;

export function clampDuration(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_DURATION;
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, number));
}

export function clampTransitionMs(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_TRANSITION_MS;
  return Math.max(0, Math.min(MAX_TRANSITION_MS, number));
}

export const isVideoItem = item => kindForMime(item?.media?.type) === 'video';
// A duração natural só existe para vídeo (o servidor recusa nos demais).
export const isNaturalItem = item => item?.durationMode === 'natural' && isVideoItem(item);

export function fromServer(playlist) {
  return {
    id: playlist.id, rev: playlist.draftRev, name: playlist.name, description: playlist.description ?? '', loop: playlist.loop !== false,
    items: (playlist.items ?? []).map(item => ({
      key: newKey(), mediaId: item.mediaId, durationS: item.durationS, durationMode: item.durationMode === 'natural' ? 'natural' : 'fixed',
      transition: item.transition, transitionMs: item.transitionMs, media: item.media, readiness: item.readiness
    }))
  };
}

// Situação do conteúdo para publicar (mesma regra do servidor): em ambiente corporativo, também exige a verificação antivírus.
export function readinessOf(media, { production = false } = {}) {
  if (media.status === 'rejected') return 'rejected';
  if (media.status !== 'approved') return 'pending';
  if (production && media.scanStatus !== 'clean') return 'not_scanned';
  return 'ready';
}

// Item novo vindo da biblioteca.
export function newItem(media, { durationS = DEFAULT_DURATION, production = false } = {}) {
  const readiness = readinessOf(media, { production });
  return {
    key: newKey(), mediaId: media.id, durationS: clampDuration(durationS), durationMode: 'fixed', transition: 'cut', transitionMs: 0,
    media: { id: media.id, title: media.title, name: media.name, type: media.type, status: media.status, scanStatus: media.scanStatus, folderId: media.folderId, url: media.url },
    readiness
  };
}

export const toPayloadItems = items => items.map(item => ({
  mediaId: item.mediaId, durationS: clampDuration(item.durationS), durationMode: isNaturalItem(item) ? 'natural' : 'fixed', transition: item.transition,
  transitionMs: item.transition === 'cut' ? 0 : clampTransitionMs(item.transitionMs)
}));

export const snapshot = draft => JSON.stringify({
  name: draft.name.trim(), description: (draft.description ?? '').trim(), loop: draft.loop !== false, items: toPayloadItems(draft.items)
});

// ---- tempo ------------------------------------------------------------------------------------------------------------------------

// Soma dos tempos conhecidos. Vídeo em "até o fim" não tem tempo conhecido aqui (depende do arquivo), então não entra na soma.
export const totalSeconds = items => items.reduce((sum, item) => (isNaturalItem(item) ? sum : sum + clampDuration(item.durationS)), 0);
export const notReady = items => items.filter(item => item.readiness !== 'ready');

// Quanto dura um ciclo: tempo conhecido (imagens, PDFs e vídeos com limite — nestes, o tempo é um máximo) e a quantidade de vídeos
// que tocam até o fim.
export function cycleOf(items) {
  let naturalVideos = 0, limitedVideos = 0;
  for (const item of items) {
    if (isNaturalItem(item)) naturalVideos++;
    else if (isVideoItem(item)) limitedVideos++;
  }
  return { seconds: totalSeconds(items), naturalVideos, limitedVideos };
}

// Texto curto da duração do ciclo: "50 s" · "até 50 s" (há vídeo com limite) · "50 s mais a duração do vídeo" · "duração dos 2 vídeos".
export function cycleLabel(items) {
  const { seconds, naturalVideos, limitedVideos } = cycleOf(items);
  const known = `${limitedVideos ? 'até ' : ''}${formatDuration(seconds)}`;
  if (!naturalVideos) return known;
  const videos = naturalVideos === 1 ? 'duração do vídeo' : `duração dos ${naturalVideos} vídeos`;
  return seconds > 0 ? `${known} mais a ${videos}` : videos;
}

export function cycleSentence(items) {
  const { seconds, naturalVideos } = cycleOf(items);
  return seconds === 0 && naturalVideos > 0 ? `um ciclo completo equivale à ${cycleLabel(items)}` : `um ciclo completo dura ${cycleLabel(items)}`;
}

// Quanto tempo o conteúdo fica na tela, em poucas palavras: "20 s" · "até 20 s" (vídeo com limite) · "até o fim do vídeo".
export function timingText(item) {
  if (isNaturalItem(item)) return 'até o fim do vídeo';
  const base = formatDuration(clampDuration(item.durationS));
  return isVideoItem(item) ? `até ${base}` : base;
}

// A mesma informação em frase, para a linha do conteúdo no editor.
export function timingSentence(item) {
  if (isNaturalItem(item)) return 'toca até o fim do vídeo';
  const base = formatDuration(clampDuration(item.durationS));
  return isVideoItem(item) ? `toca por até ${base}` : `exibe por ${base}`;
}

// "Esmaecer 600 ms" (vazio para corte seco).
export function effectText(item) {
  if (!item || item.transition === 'cut' || !item.transition) return '';
  return `${own(TRANSITION_LABELS, item.transition) ?? item.transition} ${clampTransitionMs(item.transitionMs)} ms`;
}

// Resumo de um conteúdo para listas de revisão: "20 s · Esmaecer 600 ms".
export const describeItem = item => [timingText(item), effectText(item)].filter(Boolean).join(' · ');

// ---- pré-visualização ------------------------------------------------------------------------------------------------------------

// Conteúdos rejeitados ou excluídos (ou sem arquivo) nunca tocam: nem na TV nem na pré-visualização.
export const isPlayable = item => item.readiness !== 'rejected' && item.readiness !== 'deleted' && !!item.media?.url;

// O que o motor de reprodução recebe: o mesmo formato do manifesto que a TV consulta.
export function toPlaybackItems(items) {
  return items
    .filter(isPlayable)
    .map(item => ({
      id: item.mediaId, title: item.media.title, name: item.media.name, type: item.media.type, url: item.media.url,
      duration: clampDuration(item.durationS), durationMode: isNaturalItem(item) ? 'natural' : 'fixed',
      transition: item.transition, transitionMs: item.transition === 'cut' ? 0 : clampTransitionMs(item.transitionMs)
    }));
}

// Problemas que impedem salvar (a API valida de novo; isto evita idas e vindas).
export function validateDraft(draft, maxItems) {
  const problems = [];
  if (!draft.name.trim()) problems.push('Informe o nome da playlist.');
  if (draft.name.trim().length > 120) problems.push('O nome pode ter até 120 caracteres.');
  if (draft.items.length > maxItems) problems.push(`Uma playlist aceita até ${maxItems} conteúdos.`);
  for (const [index, item] of draft.items.entries()) {
    if (item.readiness === 'rejected') problems.push(`O item ${index + 1} (“${item.media.title}”) foi rejeitado e precisa sair da playlist.`);
  }
  return problems;
}
