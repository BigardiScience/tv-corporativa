// Formatação e rótulos em português. Nada aqui toca o DOM.

export const ROLE_OPTIONS = Object.freeze(['admin', 'manager', 'editor', 'viewer']);

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value, { timeZone } = {}) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone }).format(date) : '—';
}

// Data e hora com segundos (trilha de auditoria: a ordem dos eventos no mesmo minuto importa).
export function formatDateTimeSeconds(value, { timeZone } = {}) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone }).format(date) : '—';
}

export function formatDate(value, { timeZone } = {}) {
  const date = validDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone }).format(date) : '—';
}

export function relativeTime(value, now = Date.now()) {
  const date = validDate(value);
  if (!date) return 'nunca';
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 45) return 'agora há pouco';
  if (seconds < 3600) return `há ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `há ${Math.round(seconds / 3600)} h`;
  if (seconds < 86400 * 7) { const days = Math.round(seconds / 86400); return `há ${days} ${days === 1 ? 'dia' : 'dias'}`; }
  return formatDate(value);
}

export function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = size, index = -1;
  do { value /= 1024; index++; } while (value >= 1024 && index < units.length - 1);
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: value < 10 ? 1 : 0 })} ${units[index]}`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), rest = total % 60;
  if (hours) return minutes ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${hours} h`;
  if (minutes) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  return `${rest} s`;
}

export const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// Texto para comparar em buscas: minúsculas e sem acentos ("Ação" encontra "acao").
export const fold = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// ---- datas dos formulários (datetime-local usa a hora do computador, sem fuso) ---------------------------------------

const pad = number => String(number).padStart(2, '0');

export function toLocalInput(iso) {
  const date = validDate(iso);
  if (!date) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(text) {
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---- rótulos --------------------------------------------------------------------------------------------------------

export const KIND_LABELS = Object.freeze({ image: 'Imagem', video: 'Vídeo', pdf: 'PDF', other: 'Arquivo' });
export const MEDIA_STATUS_LABELS = Object.freeze({ pending: 'Aguardando aprovação', approved: 'Aprovado', rejected: 'Rejeitado' });
export const SCAN_LABELS = Object.freeze({ clean: 'Verificado', not_configured: 'Sem verificação antivírus' });
export const READINESS_LABELS = Object.freeze({
  ready: 'Liberado', pending: 'Aguardando aprovação', rejected: 'Rejeitado', not_scanned: 'Aguardando verificação', deleted: 'Arquivo excluído'
});
export const SCHEDULE_STATE_LABELS = Object.freeze({
  draft: 'Rascunho', scheduled: 'Agendada', live: 'No ar', expired: 'Encerrada', stopped: 'Interrompida', published: 'Publicada'
});
export const CONNECTION_LABELS = Object.freeze({ online: 'Online', offline: 'Offline', inactive: 'Aguardando ativação' });
export const TRANSITIONS = Object.freeze(['cut', 'fade', 'dissolve', 'slide', 'zoom']);
export const TRANSITION_LABELS = Object.freeze({ cut: 'Corte seco', fade: 'Esmaecer', dissolve: 'Dissolver', slide: 'Deslizar', zoom: 'Zoom' });
export const SORT_LABELS = Object.freeze({ name: 'Nome', date: 'Data de envio', type: 'Tipo', size: 'Tamanho', status: 'Situação' });

export const AUDIT_ACTIONS = Object.freeze({
  'auth.login': 'Entrada no painel', 'auth.login.failed': 'Tentativa de entrada recusada', 'auth.logout': 'Saída do painel',
  'setup.admin.created': 'Primeiro administrador criado', 'db.migrated': 'Banco de dados atualizado',
  'user.created': 'Usuário criado', 'user.updated': 'Usuário ou permissões alterados', 'user.password.reset': 'Senha redefinida',
  'units.saved': 'Unidade salva', 'sectors.saved': 'Setor salvo',
  'folder.created': 'Pasta criada', 'folder.renamed': 'Pasta renomeada', 'folder.moved': 'Pasta movida', 'folder.deleted': 'Pasta excluída',
  'media.uploaded': 'Arquivo enviado', 'media.renamed': 'Arquivo renomeado', 'media.moved': 'Arquivo movido', 'media.deleted': 'Arquivo excluído',
  'media.approved': 'Arquivo aprovado', 'media.rejected': 'Arquivo rejeitado', 'media.scan.failed': 'Verificação de segurança falhou',
  'library.batch': 'Ação em lote na biblioteca',
  'playlist.created': 'Playlist criada', 'playlist.updated': 'Playlist editada (rascunho)', 'playlist.deleted': 'Playlist excluída',
  'playlist.version.published': 'Versão de playlist publicada', 'playlist.version.restored': 'Versão restaurada no rascunho',
  'schedule.created': 'Programação criada', 'schedule.updated': 'Programação alterada', 'schedule.published': 'Programação publicada',
  'schedule.stopped': 'Programação interrompida', 'schedule.deleted': 'Programação excluída',
  'device.created': 'Tela cadastrada', 'device.activated': 'Tela ativada', 'device.paired': 'Tela pareada', 'device.pairing.renewed': 'Novo código de pareamento', 'device.pairing.generated': 'Código de pareamento gerado',
  'device.renamed': 'Tela renomeada', 'device.revoked': 'Tela removida (acesso revogado)',
  'device.access.updated': 'Compartilhamento da TV alterado', 'device.queue.reordered': 'Ordem da TV alterada',
  'display.link.suspended': 'Vínculo da TV suspenso'
});
// Ações que só existem em registros gravados pela versão 1.1.0 (quando "playlist" era a programação: conteúdos + TVs + período).
// O servidor novo não as grava mais, mas os eventos antigos continuam na trilha depois da migração e precisam aparecer legíveis.
export const LEGACY_AUDIT_ACTIONS = Object.freeze({
  'playlist.published': 'Programação publicada (registro da versão 1.1.0)',
  'playlist.stopped': 'Programação interrompida (registro da versão 1.1.0)'
});

// Consulta em tabela de rótulos só por chave PRÓPRIA: um valor como "constructor" ou "__proto__" (de um registro adulterado)
// não pode herdar funções do objeto nem derrubar a tela. Texto sem rótulo conhecido volta como está.
export const own = (table, key) => (typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined);
export const auditActionLabel = action => own(AUDIT_ACTIONS, action) ?? own(LEGACY_AUDIT_ACTIONS, action) ?? String(action ?? '');
