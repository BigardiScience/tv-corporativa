// Regras de apoio da tela de Programações (sem DOM): rótulos de período, filtros e validação do formulário.
// O servidor valida tudo de novo; aqui a ideia é só evitar idas e vindas e explicar o problema logo.
import { formatDateTime } from './format.js';

// Situação "calculada" (state) devolvida pelo servidor: draft · scheduled · live · expired · stopped.
export const STATE_FILTERS = Object.freeze([
  ['', 'Todas'], ['live', 'No ar'], ['scheduled', 'Agendadas'], ['draft', 'Rascunhos'], ['stopped', 'Interrompidas'], ['expired', 'Encerradas']
]);

export const matchesState = (schedule, filter) => !filter || schedule.state === filter;

export function windowLabel(schedule, options = {}) {
  const start = schedule.startAt ? formatDateTime(schedule.startAt, options) : 'Início imediato';
  const end = schedule.endAt ? formatDateTime(schedule.endAt, options) : 'Sem data de término';
  return `${start} → ${end}`;
}

// Dia e mês do "calendário" no cartão. Sem data de início, a programação é contínua.
export function tileOf(schedule, { timeZone } = {}) {
  const date = schedule.startAt ? new Date(schedule.startAt) : null;
  if (!date || Number.isNaN(date.getTime())) return { day: null, month: 'Contínuo' };
  const parts = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone }).formatToParts(date);
  return { day: parts.find(part => part.type === 'day')?.value ?? '', month: (parts.find(part => part.type === 'month')?.value ?? '').replace('.', '') };
}

// `startAt` / `endAt`: texto ISO ou vazio. `publish`: a pessoa pediu para ir ao ar agora.
export function validateSchedule({ name, playlistId, startAt, endAt, displayIds = [], publish = false }, now = Date.now()) {
  const problems = [];
  const title = String(name ?? '').trim();
  if (!title) problems.push('Informe o nome da programação.');
  else if (title.length > 120) problems.push('O nome pode ter até 120 caracteres.');
  if (!playlistId) problems.push('Escolha a playlist.');
  const start = startAt ? Date.parse(startAt) : null, end = endAt ? Date.parse(endAt) : null;
  if (startAt && Number.isNaN(start)) problems.push('A data de início é inválida.');
  if (endAt && Number.isNaN(end)) problems.push('A data de término é inválida.');
  if (end !== null && !Number.isNaN(end)) {
    if (end <= now) problems.push('O término deve ser no futuro.');
    else if (start !== null && !Number.isNaN(start) && end <= start) problems.push('O término deve ser depois do início.');
  }
  if (publish && !displayIds.length) problems.push('Escolha ao menos uma TV para publicar.');
  return problems;
}

// Texto de uma opção da lista de versões da playlist.
export function versionOptionLabel(version, latest) {
  const parts = [`Versão ${version.version}${version.version === latest ? ' (mais recente)' : ''}`, `${version.itemCount} ${version.itemCount === 1 ? 'conteúdo' : 'conteúdos'}`];
  if (version.note) parts.push(version.note);
  return parts.join(' · ');
}

// Quais ações o cartão oferece para esta programação, dado o que a pessoa pode fazer. Só interface: o servidor decide.
export function scheduleActions(schedule, { canCreate, canPublish }) {
  const isDraft = schedule.status === 'draft';
  return {
    publish: canPublish && (isDraft || schedule.status === 'stopped'),
    stop: canPublish && schedule.status === 'published',
    edit: isDraft ? canCreate : canPublish,
    remove: schedule.status === 'published' ? false : (isDraft ? canCreate : canPublish),
    updateVersion: schedule.newerVersionAvailable && (isDraft ? canCreate : canPublish)
  };
}
