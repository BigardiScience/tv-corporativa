import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, must } from './helpers/app.mjs';

const HOUR = 3600 * 1000;
const iso = ms => new Date(Date.now() + ms).toISOString();

// Cenário base: N conteúdos aprovados, uma playlist publicada (versão 1) e uma TV já pareada.
async function scenario(kit, { items = 2, name = 'Playlist base' } = {}) {
  const media = [];
  for (let i = 0; i < items; i++) media.push(await kit.approvedMedia(kit.admin, { name: `s${i}.png`, title: `Slide ${i + 1}` }));
  const playlist = await kit.publishedPlaylist(kit.admin, media.map(m => m.id), { name });
  const tv = await kit.pairedDisplay(kit.admin, { name: 'TV 1' });
  return { media, playlist, tv };
}
const manifestOf = (kit, tv) => kit.call('/api/player/manifest', { token: tv.token }).then(r => must(r));
const manifestIds = async (kit, tv) => (await manifestOf(kit, tv)).items.map(item => item.id);
const create = (kit, body, session = kit.admin) => kit.call('/api/schedules', { method: 'POST', session, body: { name: 'Programação', unitId: 'leste', sectorId: 'rh', ...body } });
const act = (kit, id, verb, body, session = kit.admin) => kit.call(`/api/schedules/${id}/${verb}`, { method: 'POST', session, body });
const patch = (kit, id, body, session = kit.admin) => kit.call(`/api/schedules/${id}`, { method: 'PATCH', session, body });
const read = (kit, id, session = kit.admin) => kit.call(`/api/schedules/${id}`, { session }).then(r => must(r));

test('programação: rascunho não vai ao ar, aceita TV ainda pendente e só publica com TVs ativas', async () => {
  await withApp(async kit => {
    const { media, playlist, tv } = await scenario(kit);
    const pending = await kit.display(kit.admin,{name:'TV nova'});
    kit.app.db.prepare("UPDATE displays SET status='pending',pair_hash=NULL,pair_expires=NULL WHERE id=?").run(pending.display.id);

    const draft = must(await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id, pending.display.id] }), 201);
    assert.deepEqual([draft.status, draft.state, draft.playlistVersion, draft.rev, draft.newerVersionAvailable, draft.playlistName], ['draft', 'draft', 1, 1, false, 'Playlist base']);
    assert.deepEqual(draft.displays.map(d => d.name).sort(), ['TV 1', 'TV nova']);
    assert.deepEqual(await manifestIds(kit, tv), [], 'rascunho nunca chega à TV');

    const early = await act(kit, draft.id, 'publish', {});
    assert.deepEqual([early.status, early.data.code], [400, 'DISPLAY_NOT_ACTIVE']);
    must(await kit.call(`/api/displays/${pending.display.id}/activate`, { method: 'POST', session: kit.admin }));
    const live = must(await act(kit, draft.id, 'publish', {}));
    assert.deepEqual([live.status, live.state, live.rev], ['published', 'live', 2]);
    assert.deepEqual(await manifestIds(kit, tv), media.map(m => m.id));
    assert.equal((await act(kit, draft.id, 'publish', {})).data.code, 'ALREADY_PUBLISHED');
    assert.equal((await act(kit, draft.id, 'publish', { rev: 1 })).data.code, 'REVISION_CONFLICT', 'revisão antiga é recusada antes de qualquer outra regra');

    const lonely = must(await create(kit, { playlistId: playlist.id, displayIds: [] }), 201);
    assert.deepEqual(await act(kit, lonely.id, 'publish', {}).then(r => [r.status, r.data.code]), [400, 'NO_DISPLAYS']);
  });
});

test('programação: validações na criação não deixam registros pela metade', async () => {
  await withApp(async kit => {
    const { playlist, tv } = await scenario(kit);
    const only = await kit.approvedMedia(kit.admin, { name: 'rascunho.png' });
    const unpublished = await kit.playlist(kit.admin, { name: 'Só rascunho', items: [{ mediaId: only.id }] });
    const centroMedia = await kit.approvedMedia(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'b.png' });
    const centroPlaylist = await kit.publishedPlaylist(kit.admin, [centroMedia.id], { unitId: 'centro', sectorId: 'rh', name: 'Centro' });
    const centroTv = await kit.display(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'TV Centro' });
    const base = { playlistId: playlist.id, displayIds: [tv.display.id] };
    const cases = [
      [{ ...base, playlistId: unpublished.id }, 409, 'PLAYLIST_NOT_PUBLISHED'],
      [{ ...base, playlistId: 'nao-existe' }, 404],
      [{ ...base, playlistId: centroPlaylist.id }, 400, 'SCOPE_MISMATCH'],
      [{ ...base, unitId: 'centro' }, 400, 'SCOPE_MISMATCH'],
      [{ ...base, playlistVersion: 5 }, 404],
      [{ ...base, playlistVersion: 0 }, 400],
      [{ ...base, startAt: 'ontem' }, 400],
      [{ ...base, endAt: iso(-HOUR) }, 400],
      [{ ...base, startAt: iso(2 * HOUR), endAt: iso(HOUR) }, 400],
      [{ ...base, name: '' }, 400],
      [{ ...base, name: 'x'.repeat(121) }, 400],
      [{ ...base, displayIds: ['nao-existe'] }, 400],
      [{ ...base, displayIds: [centroTv.display.id] }, 400, 'SCOPE_MISMATCH'],
      [{ ...base, displayIds: 'tv' }, 400]
    ];
    for (const [body, status, code] of cases) {
      const response = await create(kit, body);
      assert.equal(response.status, status, JSON.stringify(body));
      if (code) assert.equal(response.data.code, code, JSON.stringify(body));
    }
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM schedules').get().n, 0);
    // Duplicar TVs na lista não gera erro nem registros repetidos.
    const dup = must(await create(kit, { ...base, displayIds: [tv.display.id, tv.display.id] }), 201);
    assert.equal(dup.displays.length, 1);
  });
});

test('programação aponta para uma VERSÃO: publicar versão nova da playlist não muda o que está no ar', async () => {
  await withApp(async kit => {
    const { media: [m0, m1, m2], playlist, tv } = await scenario(kit, { items: 3 });
    const live = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    assert.deepEqual(await manifestIds(kit, tv), [m0.id, m1.id, m2.id]);
    must(await kit.call(`/api/playlists/${playlist.id}`, { method: 'PATCH', session: kit.admin, body: { rev: 1, items: [{ mediaId: m2.id, durationS: 7, transition: 'fade' }] } }));
    must(await kit.call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: 2 } }), 201);
    assert.deepEqual(await manifestIds(kit, tv), [m0.id, m1.id, m2.id], 'a TV continua na versão 1');
    const seen = await read(kit, live.id);
    assert.deepEqual([seen.playlistVersion, seen.newerVersionAvailable], [1, true]);

    assert.equal((await patch(kit, live.id, { playlistVersion: 2 })).status, 400, 'rev é obrigatório');
    assert.equal((await patch(kit, live.id, { rev: 99, playlistVersion: 2 })).data.code, 'REVISION_CONFLICT');
    assert.equal((await patch(kit, live.id, { rev: live.rev, playlistVersion: 9 })).status, 404);
    assert.equal((await patch(kit, live.id, { rev: live.rev, playlistId: 'outra' })).data.code, 'PLAYLIST_IMMUTABLE');
    const moved = must(await patch(kit, live.id, { rev: live.rev, playlistVersion: 2 }));
    assert.deepEqual([moved.playlistVersion, moved.newerVersionAvailable, moved.rev], [2, false, live.rev + 1]);
    assert.deepEqual((await manifestOf(kit, tv)).items.map(i => [i.id, i.duration, i.transition, i.transitionMs]), [[m2.id, 7, 'fade', 600]]);
    must(await patch(kit, live.id, { rev: moved.rev, playlistVersion: 1 }));
    assert.deepEqual(await manifestIds(kit, tv), [m0.id, m1.id, m2.id], 'voltar para a versão anterior (reversão)');
    const events = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events.filter(e => e.action === 'schedule.updated');
    assert.deepEqual(events.map(e => [e.detail.previousVersion, e.detail.playlistVersion]), [[2, 1], [1, 2]]);
  });
});

test('programação: janela de datas — agendada, no ar, expirada; o manifesto expira junto com o término', async () => {
  await withApp(async kit => {
    const { media, playlist, tv } = await scenario(kit);
    const scheduled = must(await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id], publish: true, startAt: iso(HOUR) }), 201);
    assert.equal(scheduled.state, 'scheduled');
    assert.deepEqual(await manifestIds(kit, tv), []);
    assert.equal((await kit.call(`/api/media/${media[0].id}/file`, { token: tv.token })).status, 403);
    const listed = must(await kit.call('/api/displays?unitId=leste&sectorId=rh', { session: kit.admin })).displays.find(d => d.id === tv.display.id);
    assert.deepEqual(listed.activeSchedules, [], 'TV não mostra programação futura como ativa');

    const started = must(await patch(kit, scheduled.id, { rev: scheduled.rev, startAt: null }));
    assert.equal(started.state, 'live');
    assert.equal((await kit.call(`/api/media/${media[0].id}/file`, { token: tv.token })).status, 200);
    assert.deepEqual(must(await kit.call('/api/displays?unitId=leste&sectorId=rh', { session: kit.admin })).displays.find(d => d.id === tv.display.id).activeSchedules.map(s => s.id), [scheduled.id]);

    // Término daqui a 30 s: a autorização do manifesto nunca passa do término (regra da 1.1.0).
    const endAt = iso(30000);
    const ending = must(await patch(kit, scheduled.id, { rev: started.rev, endAt }));
    assert.equal((await manifestOf(kit, tv)).validUntil, endAt);
    // Sem término, a autorização dura no máximo 60 s.
    const open = must(await patch(kit, scheduled.id, { rev: ending.rev, endAt: null }));
    const long = await manifestOf(kit, tv), span = Date.parse(long.validUntil) - Date.parse(long.generatedAt);
    assert.ok(span > 59000 && span <= 60000, `validade de ${span} ms`);

    for (const bad of [{ endAt: iso(-HOUR) }, { startAt: iso(2 * HOUR), endAt: iso(HOUR) }, { startAt: 'amanhã' }]) assert.equal((await patch(kit, scheduled.id, { rev: open.rev, ...bad })).status, 400, JSON.stringify(bad));

    kit.app.db.prepare('UPDATE schedules SET end_at=? WHERE id=?').run(iso(-1000), scheduled.id);
    const expired = await read(kit, scheduled.id);
    assert.deepEqual([expired.status, expired.state], ['published', 'expired']);
    assert.deepEqual(await manifestIds(kit, tv), []);
    assert.equal((await kit.call(`/api/media/${media[0].id}/file`, { token: tv.token })).status, 403);
    assert.equal((await patch(kit, scheduled.id, { rev: expired.rev, name: 'Novo nome' })).status, 400, 'expirada: é preciso informar um novo término');
    const extended = must(await patch(kit, scheduled.id, { rev: expired.rev, endAt: iso(HOUR) }));
    assert.equal(extended.state, 'live');
    assert.equal((await manifestOf(kit, tv)).items.length, 2);
  });
});

test('programação: interromper, publicar de novo e excluir', async () => {
  await withApp(async kit => {
    const { media, playlist, tv } = await scenario(kit);
    const live = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    assert.deepEqual(await act(kit, live.id, 'stop').then(r => [r.status, r.data.state, r.data.status]), [200, 'stopped', 'stopped']);
    assert.deepEqual(await manifestIds(kit, tv), []);
    assert.equal((await kit.call(`/api/media/${media[0].id}/file`, { token: tv.token })).status, 403, 'interromper tira do ar imediatamente');
    assert.equal((await act(kit, live.id, 'stop')).data.code, 'NOT_PUBLISHED');
    const republished = must(await act(kit, live.id, 'publish', {}));
    assert.deepEqual([republished.state, republished.stoppedAt], ['live', null]);
    assert.equal((await manifestOf(kit, tv)).items.length, 2);
    assert.deepEqual(await kit.call(`/api/schedules/${live.id}`, { method: 'DELETE', session: kit.admin }).then(r => [r.status, r.data.code]), [409, 'SCHEDULE_LIVE']);
    must(await act(kit, live.id, 'stop'));
    must(await kit.call(`/api/schedules/${live.id}`, { method: 'DELETE', session: kit.admin }));
    assert.equal((await kit.call(`/api/schedules/${live.id}`, { session: kit.admin })).status, 404);
    const draft = must(await create(kit, { playlistId: playlist.id, displayIds: [] }), 201);
    assert.equal((await act(kit, draft.id, 'stop')).data.code, 'NOT_PUBLISHED');
    must(await kit.call(`/api/schedules/${draft.id}`, { method: 'DELETE', session: kit.admin }));
    assert.equal((await act(kit, 'nao-existe', 'stop')).status, 404);
    // Rascunho cujo término já passou não pode ser publicado (é preciso informar um novo término).
    const timed = must(await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id], endAt: iso(HOUR) }), 201);
    kit.app.db.prepare('UPDATE schedules SET end_at=? WHERE id=?').run(iso(-1000), timed.id);
    assert.equal((await act(kit, timed.id, 'publish', {})).status, 400);
    assert.equal(kit.app.db.prepare('SELECT status FROM schedules WHERE id=?').get(timed.id).status, 'draft');
  });
});

test('várias programações ativas na mesma TV somam conteúdos; Administrador pode compartilhar destinos na mesma unidade', async () => {
  await withApp(async kit => {
    const [a, b] = [await kit.approvedMedia(kit.admin, { name: 'a.png' }), await kit.approvedMedia(kit.admin, { name: 'b.png' })];
    const [pa, pb] = [await kit.publishedPlaylist(kit.admin, [a.id], { name: 'A' }), await kit.publishedPlaylist(kit.admin, [b.id], { name: 'B' })];
    const tv1 = await kit.pairedDisplay(kit.admin, { name: 'TV 1' }), tv2 = await kit.pairedDisplay(kit.admin, { name: 'TV 2' });
    const sa = await kit.liveSchedule(kit.admin, { playlistId: pa.id, displayIds: [tv1.display.id, tv2.display.id], name: 'Primeira' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const sb = await kit.liveSchedule(kit.admin, { playlistId: pb.id, displayIds: [tv1.display.id], name: 'Segunda' });
    assert.deepEqual(await manifestIds(kit, tv1), [a.id, b.id]);
    assert.deepEqual(await manifestIds(kit, tv2), [a.id], 'TV 2 só está na primeira');
    must(await act(kit, sa.id, 'stop'));
    assert.deepEqual(await manifestIds(kit, tv1), [b.id]);
    assert.deepEqual(await manifestIds(kit, tv2), []);
    assert.equal((await kit.call(`/api/media/${a.id}/file`, { token: tv1.token })).status, 403);
    assert.equal((await kit.call(`/api/media/${b.id}/file`, { token: tv2.token })).status, 403, 'TV 2 não baixa o que não é dela');
    // O Administrador pode direcionar conteúdo a outra TV da mesma unidade; não amplia o acesso de usuários às mídias.
    const tiTv = await kit.pairedDisplay(kit.admin, { sectorId: 'ti', name: 'TV TI' });
    must(await patch(kit, sb.id, { rev: sb.rev, displayIds: [tiTv.display.id] }));
    assert.deepEqual(await manifestIds(kit,tiTv),[b.id]);
    assert.deepEqual(await manifestIds(kit,tv1),[]);
  });
});

test('rejeitar um conteúdo o tira do ar na hora, mesmo com a programação publicada', async () => {
  await withApp(async kit => {
    const { media: [m0, m1], playlist, tv } = await scenario(kit);
    const live = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    must(await kit.call(`/api/media/${m0.id}/reject`, { method: 'POST', session: kit.admin, body: {} }));
    assert.deepEqual(await manifestIds(kit, tv), [m1.id]);
    assert.equal((await kit.call(`/api/media/${m0.id}/file`, { token: tv.token })).status, 403);
    assert.equal((await read(kit, live.id)).state, 'live', 'a programação segue publicada com o restante');
    assert.equal((await act(kit, (await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id] })).data.id, 'publish', {})).data.code, 'MEDIA_NOT_READY');
  });
});

test('trocar as TVs de uma programação: publicadas só aceitam TVs ativas e nunca ficam sem TV', async () => {
  await withApp(async kit => {
    const { media, playlist, tv } = await scenario(kit);
    const second = await kit.pairedDisplay(kit.admin, { name: 'TV 2' });
    const pending = await kit.display(kit.admin,{name:'TV pendente'});
    kit.app.db.prepare("UPDATE displays SET status='pending',pair_hash=NULL,pair_expires=NULL WHERE id=?").run(pending.display.id);
    const live = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    assert.deepEqual(await patch(kit, live.id, { rev: live.rev, displayIds: [pending.display.id] }).then(r => [r.status, r.data.code]), [400, 'DISPLAY_NOT_ACTIVE']);
    assert.deepEqual(await patch(kit, live.id, { rev: live.rev, displayIds: [] }).then(r => [r.status, r.data.code]), [400, 'NO_DISPLAYS']);
    const both = must(await patch(kit, live.id, { rev: live.rev, displayIds: [tv.display.id, second.display.id] }));
    assert.deepEqual((await manifestOf(kit, second)).items.map(i => i.id), media.map(m => m.id));
    must(await patch(kit, live.id, { rev: both.rev, displayIds: [second.display.id] }));
    assert.deepEqual(await manifestIds(kit, tv), [], 'TV retirada deixa de receber');
    assert.equal((await manifestOf(kit, second)).items.length, 2);
    assert.equal((await patch(kit, live.id, { rev: both.rev, name: 'Revisão antiga' })).data.code, 'REVISION_CONFLICT');
    assert.equal((await patch(kit, live.id, { name: 'Sem revisão' })).status, 400);
  });
});

test('fluxo de aprovação: quem só cria rascunha, quem pode publicar coloca no ar', async () => {
  await withApp(async kit => {
    const { playlist, tv } = await scenario(kit);
    const drafter = await kit.createUser('editor', { revokes: ['schedule:publish'] }); // o padrão do Editor publica; a TI retira de quem só deve rascunhar
    const manager = await kit.createUser('manager');
    const draft = must(await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id] }, drafter.session), 201);
    assert.equal(draft.status, 'draft');
    assert.equal((await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id], publish: true }, drafter.session)).status, 403, 'não pode criar já publicando');
    assert.equal((await act(kit, draft.id, 'publish', {}, drafter.session)).status, 403);
    assert.equal((await patch(kit, draft.id, { rev: draft.rev, name: 'Ajustada' }, drafter.session)).status, 200, 'rascunho pode ser ajustado por quem criou');
    const live = must(await act(kit, draft.id, 'publish', {}, manager.session));
    assert.equal(live.state, 'live');
    assert.equal((await patch(kit, draft.id, { rev: live.rev, name: 'Mexendo no ar' }, drafter.session)).status, 403, 'depois de publicada, só quem publica altera');
    assert.equal((await act(kit, draft.id, 'stop', undefined, drafter.session)).status, 403);
    assert.equal((await kit.call(`/api/schedules/${draft.id}`, { method: 'DELETE', session: drafter.session })).status, 403);
    assert.equal(live.publishedBy, manager.user.id);
  });
});

test('listar programações: filtros, ordem, paginação e isolamento', async () => {
  await withApp(async kit => {
    const { playlist, tv } = await scenario(kit);
    const other = await kit.publishedPlaylist(kit.admin, [(await kit.approvedMedia(kit.admin, { name: 'o.png' })).id], { name: 'Outra' });
    const draft = must(await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id], name: 'Rascunho' }), 201);
    const live = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id], name: 'No ar' });
    const stopped = await kit.liveSchedule(kit.admin, { playlistId: other.id, displayIds: [tv.display.id], name: 'Parada' });
    must(await act(kit, stopped.id, 'stop'));
    const list = (query = '', session = kit.admin) => kit.call(`/api/schedules?unitId=leste&sectorId=rh${query ? `&${query}` : ''}`, { session });
    const all = must(await list());
    assert.deepEqual(all.schedules.map(s => s.name), ['No ar', 'Rascunho', 'Parada'], 'publicadas, depois rascunhos, depois paradas');
    assert.equal(all.total, 3);
    assert.deepEqual(must(await list('status=draft')).schedules.map(s => s.id), [draft.id]);
    assert.deepEqual(must(await list(`playlistId=${other.id}`)).schedules.map(s => s.id), [stopped.id]);
    const page = must(await list('limit=2&offset=2'));
    assert.deepEqual([page.schedules.length, page.total], [1, 3]);
    assert.equal(all.schedules[0].id, live.id);
    for (const bad of ['status=x', 'limit=0', 'offset=-1']) assert.equal((await list(bad)).status, 400, bad);
    const viewer = await kit.createUser('viewer');
    assert.equal(must(await list('', viewer.session)).total, 3);
    assert.equal((await kit.call('/api/schedules?unitId=centro&sectorId=rh', { session: viewer.session })).status, 403);
    assert.equal((await kit.call(`/api/schedules/${live.id}`, { session: (await kit.createUser('viewer', { unitIds: ['centro'], sectorIds: ['rh'] })).session })).status, 403, 'ID de outro espaço não vaza dados');
  });
});

test('programações registram a trilha de auditoria com quem, o quê e onde', async () => {
  await withApp(async kit => {
    const { playlist, tv } = await scenario(kit);
    const draft = must(await create(kit, { playlistId: playlist.id, displayIds: [tv.display.id] }), 201);
    must(await act(kit, draft.id, 'publish', {}));
    must(await patch(kit, draft.id, { rev: 2, name: 'Renomeada' }));
    must(await act(kit, draft.id, 'stop'));
    must(await kit.call(`/api/schedules/${draft.id}`, { method: 'DELETE', session: kit.admin }));
    const events = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events.filter(e => e.action.startsWith('schedule.'));
    assert.deepEqual(events.map(e => e.action).reverse(), ['schedule.created', 'schedule.published', 'schedule.updated', 'schedule.stopped', 'schedule.deleted']);
    for (const event of events) assert.deepEqual([event.actor, event.unitId, event.sectorId, event.detail.scheduleId], ['admin@example.invalid', 'leste', 'rh', draft.id]);
  });
});
