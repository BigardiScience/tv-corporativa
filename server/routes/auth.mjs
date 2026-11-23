import { fail } from '../lib/errors.mjs';
import { publicUser } from '../domain/users.mjs';

// O que foi digitado no campo e-mail só entra na trilha de auditoria se tiver formato de e-mail: quem digita a senha
// ali por engano não pode ter essa senha gravada em texto puro (a trilha é consultável e exportável).
const EMAIL_SHAPE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/;
const recordable = address => (address.length <= 254 && EMAIL_SHAPE.test(address) ? address : null);

export function registerAuthRoutes(router, s) {
  const { config } = s;

  router.post('/api/login', async ctx => {
    if (ctx.req.headers.origin && ctx.req.headers.origin !== config.origin) fail(403, 'Origem inválida.');
    s.limit(`login:${ctx.ip}`, 12, 15 * 60000);
    const body = await ctx.body();
    const address = typeof body.email === 'string' ? body.email.toLowerCase().trim() : '';
    s.limit(`account:${address}`, 12, 15 * 60000);
    const user = s.users.authenticate(address, body.password);
    if (!user) {
      s.audit.record('anonymous', 'auth.login.failed', { email: recordable(address), ip: ctx.ip });
      fail(401, 'E-mail ou senha inválidos.');
    }
    s.audit.record(user, 'auth.login', { ip: ctx.ip });
    const started = s.sessions.start(user);
    ctx.setCookie(started.cookie);
    return ctx.json(200, { user: publicUser(user), csrf: started.csrf });
  }, { auth: 'none' });

  router.post('/api/logout', ctx => {
    s.sessions.end(ctx.session.hash);
    s.audit.record(ctx.user, 'auth.logout', {});
    ctx.setCookie(s.sessions.clearCookie());
    return { ok: true };
  });

  router.get('/api/me', ctx => ({ user: publicUser(ctx.user), csrf: ctx.session.csrf }));
}
