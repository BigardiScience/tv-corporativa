export function registerDisplayRoutes(router, s) {
  router.get('/api/displays', ctx => s.displays.list(ctx.user, ctx.query));
  router.post('/api/displays', async ctx => ctx.json(201, s.displays.create(ctx.user, await ctx.body())));
  router.post('/api/displays/:id/activate', ctx => s.displays.activate(ctx.user, ctx.params.id));
  router.post('/api/displays/:id/pairing', ctx => s.displays.renewPairing(ctx.user, ctx.params.id));
  router.post('/api/displays/:id/pairing-code', ctx => s.displays.generatePairingCode(ctx.user, ctx.params.id));
  router.patch('/api/displays/:id', async ctx => s.displays.update(ctx.user, ctx.params.id, await ctx.body()));
  router.get('/api/displays/:id/sequence',ctx=>s.displays.sequence(ctx.user,ctx.params.id));
  router.put('/api/displays/:id/order',async ctx=>s.displays.order(ctx.user,ctx.params.id,await ctx.body()));
  router.delete('/api/displays/:id', ctx => s.displays.remove(ctx.user, ctx.params.id));

  // ---- lado da TV ----
  router.post('/api/player/pair', async ctx => {
    s.limit(`pair:${ctx.ip}`, 6, 15 * 60000);
    const body = await ctx.body();
    return s.player.pair(body.code);
  }, { auth: 'none' });
  router.get('/api/player/manifest', ctx => s.player.manifest(ctx.device), { auth: 'device' });
  router.post('/api/player/heartbeat', ctx => s.player.heartbeat(ctx.device), { auth: 'device' });
  router.get('/api/player/media/:id/link', ctx => s.player.mediaLink(ctx.device, s.media.load(ctx.params.id)), { auth: 'device' });
}
