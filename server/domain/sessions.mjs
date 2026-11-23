import { fail } from '../lib/errors.mjs';
import { randomToken, safeEqual, sha } from '../lib/crypto.mjs';
import { cookieValue } from '../http/request.mjs';

const SESSION_MS = 8 * 60 * 60 * 1000;
export const COOKIE_NAME = 'pwc_session';

export function createSessions({ db, users, config }) {
  const attributes = `HttpOnly; SameSite=Strict; Path=/${config.secureCookies ? '; Secure' : ''}`;
  const cookieFor = token => `${COOKIE_NAME}=${token}; ${attributes}; Max-Age=${SESSION_MS / 1000}`;
  const clearCookie = () => `${COOKIE_NAME}=; ${attributes}; Max-Age=0`;

  function start(user) {
    const token = randomToken(), csrf = randomToken();
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(token), user.id, csrf, Date.now() + SESSION_MS);
    return { csrf, cookie: cookieFor(token) };
  }

  function resolve(req) {
    const token = cookieValue(req, COOKIE_NAME);
    if (!token) fail(401, 'Entre com sua conta para continuar.');
    const session = db.prepare('SELECT * FROM sessions WHERE hash=?').get(sha(token));
    if (!session || session.expires < Date.now()) {
      if (session) db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
      fail(401, 'Sua sessão expirou. Entre novamente.');
    }
    const user = users.byId(session.userId);
    if (!user?.active) fail(401, 'Conta desativada. Consulte a equipe de TI.');
    return { user, csrf: session.csrf, hash: session.hash };
  }

  const end = hash => db.prepare('DELETE FROM sessions WHERE hash=?').run(hash);

  // Proteção contra requisições forjadas: origem esperada + token CSRF por sessão.
  function verifyMutation(req, session) {
    if (req.headers.origin && req.headers.origin !== config.origin) fail(403, 'Origem de requisição inválida.');
    if (!safeEqual(req.headers['x-csrf-token'] ?? '', session.csrf)) fail(403, 'A sessão de segurança mudou. Atualize a página.');
  }

  return { start, resolve, end, clearCookie, verifyMutation };
}
