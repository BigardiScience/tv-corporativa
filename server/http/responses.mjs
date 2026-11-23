export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

// O navegador recebe só `error` (texto para pessoas), `code` (estável, para a interface) e `details`.
// Falhas internas nunca expõem mensagem, pilha nem caminhos.
export function sendError(res, error, log) {
  const known = Number.isInteger(error?.status);
  if (!known) log?.error('Falha interna ao atender requisição', { error: String(error?.message ?? error).slice(0, 300) });
  if (res.headersSent) { res.end(); return; }
  const body = { error: known ? error.message : 'Falha interna. Consulte a equipe de TI.' };
  if (known && error.code) body.code = error.code;
  if (known && error.details !== undefined) body.details = error.details;
  sendJson(res, known ? error.status : 500, body);
}
