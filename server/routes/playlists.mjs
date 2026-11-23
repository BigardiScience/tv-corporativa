export function registerPlaylistRoutes(router, s) {
  router.get('/api/playlists', ctx => s.playlists.list(ctx.user, ctx.query));
  router.post('/api/playlists', async ctx => ctx.json(201, s.playlists.create(ctx.user, await ctx.body())));
  router.get('/api/playlists/:id', ctx => s.playlists.get(ctx.user, ctx.params.id));
  router.patch('/api/playlists/:id', async ctx => s.playlists.update(ctx.user, ctx.params.id, await ctx.body()));
  router.delete('/api/playlists/:id', ctx => s.playlists.remove(ctx.user, ctx.params.id));
  router.post('/api/playlists/:id/publish', async ctx => ctx.json(201, s.playlists.publish(ctx.user, ctx.params.id, await ctx.body())));
  router.post('/api/playlists/:id/restore', async ctx => s.playlists.restore(ctx.user, ctx.params.id, await ctx.body()));
  router.get('/api/playlists/:id/versions/:version', ctx => s.playlists.version(ctx.user, ctx.params.id, ctx.params.version));

  router.get('/api/schedules', ctx => s.schedules.list(ctx.user, ctx.query));
  router.post('/api/schedules', async ctx => ctx.json(201, s.schedules.create(ctx.user, await ctx.body())));
  router.get('/api/schedules/:id', ctx => s.schedules.get(ctx.user, ctx.params.id));
  router.patch('/api/schedules/:id', async ctx => s.schedules.update(ctx.user, ctx.params.id, await ctx.body()));
  router.delete('/api/schedules/:id', ctx => s.schedules.remove(ctx.user, ctx.params.id));
  router.post('/api/schedules/:id/publish', async ctx => s.schedules.publish(ctx.user, ctx.params.id, await ctx.optionalBody()));
  router.post('/api/schedules/:id/stop', ctx => s.schedules.stop(ctx.user, ctx.params.id));
}
