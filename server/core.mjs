import http from 'node:http';
import path from 'node:path';
import { loadConfig, root } from './config.mjs';
import { openDatabase, createTransaction } from './db/connection.mjs';
import { migrate } from './db/migrator.mjs';
import { migrations as defaultMigrations } from './db/migrations/index.mjs';
import { createLogger } from './lib/logger.mjs';
import { createLimiter } from './lib/rate-limit.mjs';
import { createAudit } from './domain/audit.mjs';
import { createOrganization } from './domain/organization.mjs';
import { createUsers } from './domain/users.mjs';
import { createSessions } from './domain/sessions.mjs';
import { createFileStore } from './domain/files.mjs';
import { createScanner } from './domain/scanner.mjs';
import { createUsage } from './domain/usage.mjs';
import { createFolders } from './domain/folders.mjs';
import { createMedia } from './domain/media.mjs';
import { createLibrary } from './domain/library.mjs';
import { createPlaylists } from './domain/playlists.mjs';
import { createSchedules } from './domain/schedules.mjs';
import { createDisplays } from './domain/displays.mjs';
import { createDisplayAccess } from './domain/display-access.mjs';
import { createPlayer } from './domain/player.mjs';
import { createRouter } from './http/router.mjs';
import { createContext } from './http/context.mjs';
import { parseRequestUrl } from './http/request.mjs';
import { sendError, sendJson } from './http/responses.mjs';
import { applySecurityHeaders } from './http/security.mjs';
import { createStaticServer } from './http/static.mjs';
import { registerSystemRoutes } from './routes/system.mjs';
import { registerAuthRoutes } from './routes/auth.mjs';
import { registerUserRoutes } from './routes/users.mjs';
import { registerLibraryRoutes } from './routes/library.mjs';
import { registerPlaylistRoutes } from './routes/playlists.mjs';
import { registerDisplayRoutes } from './routes/displays.mjs';

export { passwordHash } from './lib/crypto.mjs';

// Ponto de composição: abre o banco, aplica as migrações, monta os serviços e liga as rotas.
export function createApp(options = {}) {
  const config = loadConfig(options);
  const log = options.logger ?? createLogger();
  const db = openDatabase(config);

  let migration;
  try {
    migration = migrate(db, { migrations: options.migrations ?? defaultMigrations, backupDir: config.backupDir, now: options.now, log: message => log.info(message) });
  } catch (error) {
    try { db.close(); } catch { /* já fechado */ }
    throw error;
  }

  const tx = createTransaction(db);
  const audit = createAudit(db);
  const limit = createLimiter();
  const files = createFileStore(config.mediaDir, log);
  const scanner = createScanner(config.scanner);
  const organization = createOrganization({ db, audit });
  const displayAccess = createDisplayAccess({ db, tx, audit });
  const users = createUsers({ db, tx, audit, organization, displayAccess });
  const sessions = createSessions({ db, users, config });
  const usage = createUsage({ db });
  const folders = createFolders({ db, tx, audit, organization });
  const media = createMedia({ db, tx, audit, config, files, scanner, folders, usage });
  const library = createLibrary({ db, tx, audit, files, folders, media, usage });
  const playlists = createPlaylists({ db, tx, audit, config, media, organization });
  const schedules = createSchedules({ db, tx, audit, media, playlists, access: displayAccess });
  const displays = createDisplays({ db, tx, audit, organization, access: displayAccess });
  const player = createPlayer({ db, audit, config, media, displays, access: displayAccess });
  const services = { config, db, tx, log, audit, limit, files, scanner, organization, users, sessions, usage, folders, media, library, playlists, schedules, displays, player, displayAccess };

  if (migration.applied.length && !migration.fresh) {
    audit.record('system', 'db.migrated', {
      from: migration.from, to: migration.to, migrations: migration.applied.map(item => item.id),
      backup: migration.backupFile ? path.basename(migration.backupFile) : null
    });
  }

  const router = createRouter();
  registerSystemRoutes(router, services);
  registerAuthRoutes(router, services);
  registerUserRoutes(router, services);
  registerLibraryRoutes(router, services);
  registerPlaylistRoutes(router, services);
  registerDisplayRoutes(router, services);
  const serveStatic = createStaticServer(path.join(root, 'public'));

  async function handle(req, res) {
    applySecurityHeaders(res, config);
    try {
      const { url, pathname } = parseRequestUrl(req, config.origin);
      if (req.method === 'OPTIONS') return sendJson(res, 405, { error: 'Método não permitido.' });
      const route = router.match(req.method, pathname);
      if (!route && !pathname.startsWith('/api/')) return await serveStatic(req, res, pathname);
      const ctx = createContext({ req, res, url, pathname, params: route?.params ?? {}, config });
      const auth = route?.options.auth ?? 'session';
      if (auth === 'device-or-session' && !req.headers.authorization && url.searchParams.has('t')) {
        // Link temporário de um vídeo (emitido em /api/player/media/:id/link): vale só para este arquivo e só para a TV que o pediu.
        const tokens = url.searchParams.getAll('t');
        ctx.device = player.authenticateLink(tokens.length === 1 ? tokens[0] : '', ctx.params.id);
      } else if (auth === 'session' || (auth === 'device-or-session' && !req.headers.authorization)) {
        ctx.session = sessions.resolve(req);
        ctx.user = ctx.session.user;
        if (!['GET', 'HEAD'].includes(req.method)) sessions.verifyMutation(req, ctx.session);
      } else if (auth === 'device' || auth === 'device-or-session') {
        ctx.device = player.authenticate(req);
      }
      if (!route) return sendJson(res, 404, { error: 'Endpoint não encontrado.' });
      const result = await route.handler(ctx);
      if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
    } catch (error) {
      sendError(res, error, log);
    }
  }

  const server = http.createServer(handle);
  server.requestTimeout = 150000; server.headersTimeout = 10000; server.maxHeadersCount = 50;

  let closed = false;
  const close = () => new Promise(resolve => {
    const finish = () => { if (!closed) { closed = true; try { db.close(); } catch { /* já fechado */ } } resolve(); };
    if (!server.listening) { finish(); return; }
    server.close(finish);
    server.closeIdleConnections();
  });

  const { setupToken, ...exposedConfig } = config;
  return {
    server, close, config: Object.freeze(exposedConfig), db, migration, services, handle, routes: router.list(),
    configured: users.configured,
    createAdmin: users.createAdmin,
    resetAdminPassword: users.resetAdminPassword
  };
}
