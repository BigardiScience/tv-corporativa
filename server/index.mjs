import { createApp } from './core.mjs';
import { bootstrapDevAdmin } from './dev-admin.mjs';
import { createLogger } from './lib/logger.mjs';

const log = createLogger();

// Erros de configuração ou de banco encerram o processo com uma mensagem objetiva (e não com uma pilha de erro).
let app = null;
try {
  app = createApp({ logger: log });
  bootstrapDevAdmin(app, process.env, log);
} catch (error) {
  log.error('TV Corporativa não iniciou.', { motivo: error.message });
  process.exitCode = 1;
  app?.close();
  app = null;
}

if (app) {
  app.server.on('error', error => {
    const reason = error.code === 'EADDRINUSE'
      ? `A porta ${app.config.port} já está em uso. Feche a outra execução da TV Corporativa ou defina outra porta (variável PORT).`
      : error.code === 'EACCES' ? `Sem permissão para usar a porta ${app.config.port}. Use uma porta acima de 1024 (variável PORT).` : error.message;
    log.error('TV Corporativa não iniciou.', { motivo: reason });
    process.exitCode = 1;
    app.close();
  });

  app.server.listen(app.config.port, app.config.host, () => {
    log.info(`TV Corporativa ${app.config.version} em ${app.config.origin}`, {
      modo: app.config.production ? 'produção' : 'local', dados: app.config.dataDir, banco: app.config.dbPath, midias: app.config.mediaDir,
      backups: app.config.backupDir, esquema: app.migration.to
    });
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => app.close().then(() => process.exit(0)));
  }
}
