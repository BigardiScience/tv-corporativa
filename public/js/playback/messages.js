// Textos do motor de reprodução em português: por que um conteúdo foi pulado. Usados pelo player da TV e pela pré-visualização do
// painel (o mesmo motor nos dois lugares). `where` diz onde o conteúdo foi tentado: "por esta TV" ou "neste navegador".

const SKIP_REASONS = Object.freeze({
  decode: where => `formato ou arquivo não suportado ${where}`,
  unsupported: () => 'formato não suportado por este player',
  'not-found': () => 'arquivo não encontrado no servidor',
  timeout: () => 'demorou demais para carregar',
  network: () => 'falha de rede ao baixar o arquivo',
  server: () => 'o servidor não conseguiu entregar o arquivo',
  incomplete: () => 'o arquivo chegou incompleto',
  empty: () => 'o arquivo veio vazio',
  'bad-url': () => 'endereço de mídia não permitido',
  stalled: () => 'o vídeo parou de avançar',
  autoplay: () => 'o navegador não permitiu iniciar o vídeo',
  'media-error': () => 'erro durante a reprodução do vídeo',
  'transition-failed': () => 'falha na transição'
});

export const SKIP_REASON_CODES = Object.freeze(Object.keys(SKIP_REASONS));

export function skipReasonText(code, where = 'por esta TV') {
  const reason = typeof code === 'string' && Object.prototype.hasOwnProperty.call(SKIP_REASONS, code) ? SKIP_REASONS[code] : null;
  return reason ? reason(where) : 'falha ao carregar o conteúdo';
}
