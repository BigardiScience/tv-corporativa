export function registerUserRoutes(router, s) {
  router.get('/api/users', ctx => ({ users: s.users.listFor(ctx.user) }));

  router.post('/api/users', async ctx => ctx.json(201, s.users.create(ctx.user, await ctx.body())));

  router.patch('/api/users/:id', async ctx => {
    const result = s.users.update(ctx.user, ctx.params.id, await ctx.body());
    // Quem altera a própria conta tem as sessões revogadas e precisa entrar de novo.
    if (ctx.params.id === ctx.user.id) ctx.setCookie(s.sessions.clearCookie());
    return result;
  });

  router.post('/api/units', async ctx => ctx.json(201, s.organization.save(ctx.user, 'units', null, await ctx.body())));
  router.patch('/api/units/:id', async ctx => s.organization.save(ctx.user, 'units', ctx.params.id, await ctx.body()));
  router.post('/api/sectors', async ctx => ctx.json(201, s.organization.save(ctx.user, 'sectors', null, await ctx.body())));
  router.patch('/api/sectors/:id', async ctx => s.organization.save(ctx.user, 'sectors', ctx.params.id, await ctx.body()));
}
