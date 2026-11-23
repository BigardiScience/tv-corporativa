import { fail } from '../lib/errors.mjs';
import { safeEqual } from '../lib/crypto.mjs';
import { isLocalRequest } from '../http/request.mjs';
import { MANAGEABLE_ROLES, NON_DELEGABLE, PERMISSIONS, ROLES, ROLE_PERMISSIONS } from '../domain/permissions.mjs';
import { MAX_DEPTH } from '../domain/folders.mjs';
import { LATEST_SCHEMA } from '../db/migrations/index.mjs';
import { publicUser } from '../domain/users.mjs';

export function registerSystemRoutes(router, s) {
  const { config } = s;

  // Verificação de saúde para balanceadores/monitoramento. Sem autenticação e sem dados sensíveis.
  router.get('/healthz', () => {
    s.db.prepare('SELECT 1 AS ok').get();
    return { ok: true, version: config.version, schema: LATEST_SCHEMA };
  }, { auth: 'none' });

  router.get('/api/status', () => ({
    configured: s.users.configured(), mode: config.production ? 'production' : 'local',
    setupEnabled: config.setupToken.length >= 32 && !s.users.configured(),
    maxUploadMB: config.maxUpload / 1024 / 1024, scannerConfigured: s.scanner.configured, version: config.version
  }), { auth: 'none' });

  router.post('/api/setup', async ctx => {
    s.limit(`setup:${ctx.ip}`, 5, 15 * 60000);
    if (!isLocalRequest(ctx.req) || config.setupToken.length < 32) fail(403, 'Configuração inicial disponível somente no servidor com SETUP_TOKEN.');
    if (ctx.req.headers.origin && ctx.req.headers.origin !== config.origin) fail(403, 'Origem inválida.');
    const body = await ctx.body();
    if (!safeEqual(body.token ?? '', config.setupToken)) fail(403, 'Token de configuração inválido.');
    const user = s.users.createAdmin(body.name, body.email, body.password);
    const started = s.sessions.start(user);
    ctx.setCookie(started.cookie);
    return ctx.json(201, { user, csrf: started.csrf });
  }, { auth: 'none' });

  router.get('/api/permissions', () => ({
    permissions: Object.entries(PERMISSIONS).map(([id, info]) => ({ id, ...info, nonDelegable: NON_DELEGABLE.includes(id) })),
    roles: ROLES, rolePermissions: ROLE_PERMISSIONS, manageableRoles: MANAGEABLE_ROLES
  }));

  // Dados iniciais do painel: quem é a pessoa, o que ela pode, e as unidades/setores que enxerga.
  router.get('/api/state', ctx => ({
    user: publicUser(ctx.user), ...s.organization.visibleTo(ctx.user),
    limits: { playlistMaxItems: config.playlistMaxItems, maxUploadMB: config.maxUpload / 1024 / 1024, folderMaxDepth: MAX_DEPTH },
    mode: config.production ? 'production' : 'local', scannerConfigured: s.scanner.configured, version: config.version
  }));

  router.get('/api/audit', ctx => ({ events: s.audit.list(ctx.user, ctx.query) }));
}
