// Erros de negócio com status HTTP. O corpo devolvido ao navegador contém somente
// `error` (texto para pessoas), `code` (estável, para a interface) e `details`.
export class HttpError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (code) this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function fail(status, message, code, details) {
  throw new HttpError(status, message, code, details);
}
