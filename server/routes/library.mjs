import { fail } from '../lib/errors.mjs';
import { authorize } from '../domain/permissions.mjs';
import { sendFile } from '../http/send-file.mjs';

export function registerLibraryRoutes(router, s) {
  // ---- navegação e pesquisa ----
  router.get('/api/library', ctx => s.library.list(ctx.user, ctx.query));
  router.get('/api/folders', ctx => s.library.tree(ctx.user, ctx.query));
  router.post('/api/library/batch', async ctx => s.library.batch(ctx.user, await ctx.body()));

  // ---- pastas ----
  router.get('/api/folders/:id', ctx => ({ folder: s.folders.get(ctx.user, ctx.params.id), breadcrumbs: s.folders.breadcrumbs(s.folders.load(ctx.params.id)) }));
  router.post('/api/folders', async ctx => ctx.json(201, s.folders.create(ctx.user, await ctx.body())));
  router.patch('/api/folders/:id', async ctx => {
    const body = await ctx.body();
    // Renomear e mover na mesma chamada: tudo ou nada.
    return s.tx(() => {
      let folder = s.folders.get(ctx.user, ctx.params.id);
      if (body.name !== undefined) folder = s.folders.rename(ctx.user, ctx.params.id, body.name);
      if (Object.hasOwn(body, 'parentId')) folder = s.folders.move(ctx.user, ctx.params.id, body.parentId);
      return folder;
    });
  });
  router.delete('/api/folders/:id', ctx => s.library.removeFolder(ctx.user, ctx.params.id, { recursive: ctx.query.recursive === '1' }));

  // ---- arquivos ----
  router.post('/api/media', async ctx => {
    const ticket = s.media.prepareUpload(ctx.user, ctx.query);
    const bytes = await ctx.raw(s.config.maxUpload);
    return ctx.json(201, await s.media.completeUpload(ctx.user, ticket, bytes));
  });
  router.get('/api/media/:id', ctx => s.media.detail(ctx.user, ctx.params.id));
  router.patch('/api/media/:id', async ctx => s.media.update(ctx.user, ctx.params.id, await ctx.body()));
  router.delete('/api/media/:id', ctx => s.media.remove(ctx.user, ctx.params.id));
  router.post('/api/media/:id/approve', async ctx => s.media.review(ctx.user, ctx.params.id, 'approve', await ctx.optionalBody()));
  router.post('/api/media/:id/reject', async ctx => s.media.review(ctx.user, ctx.params.id, 'reject', await ctx.optionalBody()));

  // Conteúdo do arquivo: pessoa (dentro do escopo) ou TV (somente o que está na programação ativa dela).
  router.get('/api/media/:id/file', async ctx => {
    const row = s.media.load(ctx.params.id);
    if (ctx.device) { if (!s.player.mayFetch(ctx.device, row)) fail(403, 'Mídia indisponível para esta TV.'); }
    else authorize(ctx.user, null, s.media.scopeOf(row));
    const handle = await s.files.open(row.storage_name).catch(() => null);
    if (!handle) fail(404, 'Arquivo indisponível.');
    try {
      const { size } = await handle.stat();
      const extension = row.storage_name.slice(row.storage_name.lastIndexOf('.'));
      await sendFile(ctx.req, ctx.res, { handle, size, type: row.type, etag: `"${row.sha256 || row.id}"`, filename: `${row.id}${extension}` });
    } finally {
      await handle.close().catch(() => {});
    }
  }, { auth: 'device-or-session' });
}
