import test from 'node:test';
import assert from 'node:assert/strict';
import { withApp, must, makeTempDir, removeTempDir, writeScanner } from './helpers/app.mjs';

const itemSummary = items => items.map(item => [item.position, item.mediaId, item.durationS, item.transition, item.transitionMs]);

async function threeMedia(kit, prefix = 'm') {
  const out = [];
  for (const letter of ['a', 'b', 'c']) out.push(await kit.approvedMedia(kit.admin, { name: `${prefix}${letter}.png`, title: `${prefix.toUpperCase()}${letter.toUpperCase()}` }));
  return out;
}

test('playlist: rascunho com ordem, tempo e transição por item; padrões e validações', async () => {
  await withApp(async kit => {
    const [a, b, c] = await threeMedia(kit);
    const created = await kit.playlist(kit.admin, { name: 'Boas-vindas', items: [
      { mediaId: b.id, durationS: 30, transition: 'fade', transitionMs: 1200 },
      { mediaId: a.id },
      { mediaId: c.id, durationS: 5, transition: 'slide' },
      { mediaId: a.id, transition: 'cut', transitionMs: 900 }
    ] });
    assert.deepEqual(itemSummary(created.items), [
      [0, b.id, 30, 'fade', 1200], [1, a.id, 15, 'cut', 0], [2, c.id, 5, 'slide', 600], [3, a.id, 15, 'cut', 0]
    ], 'padrões: 15 s, corte; transição com duração padrão; "corte" ignora a duração da transição; mesmo arquivo pode repetir');
    assert.deepEqual([created.draftRev, created.publishedRev, created.latestVersion, created.hasUnpublishedChanges], [1, 0, 0, true]);
    assert.deepEqual([created.items[0].media.url, created.items[0].readiness], [`/api/media/${b.id}/file`, 'ready']);

    const post = body => kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: 'X', ...body } });
    const item = extra => ({ items: [{ mediaId: a.id, ...extra }] });
    for (const bad of [
      item({ durationS: 4 }), item({ durationS: 3601 }), item({ durationS: 'abc' }), item({ durationS: 7.5 }),
      item({ transition: 'girar' }), item({ transition: 'fade', transitionMs: 3001 }), item({ transition: 'fade', transitionMs: -1 }),
      { items: 'não é lista' }, { items: [null] }, { items: ['texto'] }, { items: [{}] },
      { name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, { description: 'x'.repeat(501) }, { unitId: 'nao-existe' }, { sectorId: 'nao-existe' }, { unitId: 'a/b' }
    ]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
    assert.deepEqual(await post({ items: [{ mediaId: 'nao-existe' }] }).then(r => [r.status, r.data.code]), [400, 'MEDIA_NOT_FOUND']);
    // Conteúdo de outro espaço ou rejeitado não entra; pendente entra no RASCUNHO (só não publica).
    const foreign = await kit.upload(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'f.png' });
    assert.deepEqual(await post({ items: [{ mediaId: foreign.id }] }).then(r => [r.status, r.data.code]), [400, 'SCOPE_MISMATCH']);
    const rejected = await kit.upload(kit.admin, { name: 'r.png' });
    must(await kit.call(`/api/media/${rejected.id}/reject`, { method: 'POST', session: kit.admin, body: {} }));
    assert.deepEqual(await post({ items: [{ mediaId: rejected.id }] }).then(r => [r.status, r.data.code]), [400, 'MEDIA_REJECTED']);
    const pending = await kit.upload(kit.admin, { name: 'p.png' });
    const withPending = must(await post({ items: [{ mediaId: pending.id }] }), 201);
    assert.equal(withPending.items[0].readiness, 'pending');
    // Limite padrão de 6 itens.
    const six = Array.from({ length: 6 }, () => ({ mediaId: a.id }));
    must(await post({ items: six }), 201);
    const seven = await post({ items: [...six, { mediaId: b.id }] });
    assert.deepEqual([seven.status, seven.data.code], [400, 'PLAYLIST_LIMIT']);
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM playlists').get().n, 3, 'tentativas inválidas não deixam playlists pela metade');
  });
});

test('playlist: edição concorrente — a revisão (rev) impede sobrescrever o trabalho de outra pessoa', async () => {
  await withApp(async kit => {
    const [a, b] = await threeMedia(kit);
    const manager = await kit.createUser('manager');
    const base = await kit.playlist(kit.admin, { name: 'Original', items: [{ mediaId: a.id }] });
    const patch = (session, body) => kit.call(`/api/playlists/${base.id}`, { method: 'PATCH', session, body });
    const theirs = must(await patch(manager.session, { rev: 1, name: 'Da outra pessoa' }));
    assert.deepEqual([theirs.name, theirs.draftRev, theirs.items.length], ['Da outra pessoa', 2, 1], 'alterar só o nome mantém os itens');
    const mine = await patch(kit.admin, { rev: 1, name: 'Minha versão', items: [] });
    assert.deepEqual([mine.status, mine.data.code, mine.data.details], [409, 'REVISION_CONFLICT', { currentRev: 2 }]);
    const unchanged = must(await kit.call(`/api/playlists/${base.id}`, { session: kit.admin }));
    assert.deepEqual([unchanged.name, unchanged.items.length, unchanged.draftRev], ['Da outra pessoa', 1, 2]);
    for (const rev of [undefined, null, '2', 2.5, [], {}]) assert.equal((await patch(kit.admin, { rev, name: 'Sem rev válido' })).status, 400, JSON.stringify(rev));
    // Reordenar, trocar tempo/transição e voltar a editar com a revisão nova.
    const reordered = must(await patch(kit.admin, { rev: 2, items: [{ mediaId: b.id, durationS: 40 }, { mediaId: a.id, transition: 'dissolve', transitionMs: 300 }] }));
    assert.deepEqual(itemSummary(reordered.items), [[0, b.id, 40, 'cut', 0], [1, a.id, 15, 'dissolve', 300]]);
    assert.equal(reordered.draftRev, 3);
    // Edição inválida é tudo-ou-nada: nem o nome muda, nem a revisão avança.
    const invalid = await patch(kit.admin, { rev: 3, name: 'Não deve gravar', items: [{ mediaId: a.id, durationS: 1 }] });
    assert.equal(invalid.status, 400);
    const after = must(await kit.call(`/api/playlists/${base.id}`, { session: kit.admin }));
    assert.deepEqual([after.name, after.draftRev, itemSummary(after.items)], ['Da outra pessoa', 3, itemSummary(reordered.items)]);
    // Descrição pode ser limpa.
    must(await patch(kit.admin, { rev: 3, description: 'Texto' }));
    assert.equal(must(await patch(kit.admin, { rev: 4, description: '' })).description, '');
    assert.equal((await kit.call('/api/playlists/nao-existe', { method: 'PATCH', session: kit.admin, body: { rev: 1 } })).status, 404);
  });
});

test('publicar playlist: versão imutável, regras de publicação e histórico que não muda com o arquivo', async () => {
  await withApp(async kit => {
    const [a, b] = await threeMedia(kit);
    const empty = await kit.playlist(kit.admin, { name: 'Vazia' });
    const publish = (id, body) => kit.call(`/api/playlists/${id}/publish`, { method: 'POST', session: kit.admin, body });
    assert.deepEqual(await publish(empty.id, { rev: 1 }).then(r => [r.status, r.data.code]), [400, 'PLAYLIST_EMPTY']);

    const pendingMedia = await kit.upload(kit.admin, { name: 'espera.png', title: 'Em revisão' });
    const draft = await kit.playlist(kit.admin, { name: 'Campanha', items: [{ mediaId: a.id, durationS: 20 }, { mediaId: pendingMedia.id }] });
    const notReady = await publish(draft.id, { rev: 1 });
    assert.deepEqual([notReady.status, notReady.data.code, notReady.data.details.items], [409, 'MEDIA_NOT_READY', [{ mediaId: pendingMedia.id, title: 'Em revisão', readiness: 'pending' }]]);
    assert.match(notReady.data.error, /Em revisão/);
    assert.equal(must(await kit.call(`/api/playlists/${draft.id}`, { session: kit.admin })).latestVersion, 0, 'nada foi publicado');

    await kit.approve(kit.admin, pendingMedia.id);
    assert.equal((await publish(draft.id, {})).status, 400, 'rev é obrigatório');
    assert.equal((await publish(draft.id, { rev: 99 })).data.code, 'REVISION_CONFLICT');
    const v1 = must(await publish(draft.id, { rev: 1, note: 'Primeira versão' }), 201);
    assert.deepEqual([v1.latestVersion, v1.publishedRev, v1.draftRev, v1.hasUnpublishedChanges], [1, 1, 1, false]);
    assert.deepEqual(v1.versions.map(v => [v.version, v.note, v.itemCount]), [[1, 'Primeira versão', 2]]);
    assert.deepEqual(await publish(draft.id, { rev: 1 }).then(r => [r.status, r.data.code]), [409, 'NO_CHANGES']);
    assert.equal((await publish(draft.id, { rev: 1, note: 'n'.repeat(201) })).status, 400);

    // Editar o rascunho NÃO altera a versão publicada; publicar de novo cria a versão 2.
    const edited = must(await kit.call(`/api/playlists/${draft.id}`, { method: 'PATCH', session: kit.admin, body: { rev: 1, items: [{ mediaId: b.id, durationS: 60 }] } }));
    assert.deepEqual([edited.hasUnpublishedChanges, edited.latestVersion], [true, 1]);
    const snapshot = must(await kit.call(`/api/playlists/${draft.id}/versions/1`, { session: kit.admin }));
    assert.deepEqual(snapshot.items.map(i => [i.media.title, i.durationS]), [['MA', 20], ['Em revisão', 15]]);
    const v2 = must(await publish(draft.id, { rev: 2 }), 201);
    assert.deepEqual(v2.versions.map(v => v.version), [2, 1]);
    // O histórico guarda o título da época, mesmo que o arquivo seja renomeado ou excluído depois.
    must(await kit.call(`/api/media/${a.id}`, { method: 'PATCH', session: kit.admin, body: { title: 'Título novo' } }));
    assert.equal(must(await kit.call(`/api/playlists/${draft.id}/versions/1`, { session: kit.admin })).items[0].media.title, 'MA');
    assert.equal((await kit.call(`/api/playlists/${draft.id}/versions/9`, { session: kit.admin })).status, 404);
    for (const bad of ['0', 'x', '-1', '1.5']) assert.equal((await kit.call(`/api/playlists/${draft.id}/versions/${bad}`, { session: kit.admin })).status, 400, bad);
    // Conteúdo rejeitado depois da edição também impede publicar.
    must(await kit.call(`/api/playlists/${draft.id}`, { method: 'PATCH', session: kit.admin, body: { rev: 2, items: [{ mediaId: a.id }] } }));
    must(await kit.call(`/api/media/${a.id}/reject`, { method: 'POST', session: kit.admin, body: {} }));
    const rejected = await publish(draft.id, { rev: 3 });
    assert.deepEqual([rejected.status, rejected.data.details.items[0].readiness], [409, 'rejected']);
  });
});

test('publicar playlist em produção exige arquivo verificado pelo antivírus', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTempDir('tvcorp-scan-');
  try {
    await withApp(async kit => {
      const media = await kit.approvedMedia(kit.admin, { name: 'ok.png' });
      const draft = await kit.playlist(kit.admin, { items: [{ mediaId: media.id }] });
      assert.equal(draft.items[0].readiness, 'ready');
      kit.app.db.prepare("UPDATE media SET scan_status='not_configured' WHERE id=?").run(media.id);
      const blocked = await kit.call(`/api/playlists/${draft.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: 1 } });
      assert.deepEqual([blocked.status, blocked.data.details.items[0].readiness], [409, 'not_scanned']);
    }, { production: true, origin: 'https://tv.example.test', scanner: writeScanner(dir, 'clean') });
  } finally { removeTempDir(dir, 'tvcorp-scan-'); }
});

test('restaurar versão: copia para o rascunho sem publicar nem mexer nas programações; ignora o que foi excluído', async () => {
  await withApp(async kit => {
    const [a, b, c] = await threeMedia(kit);
    const base = await kit.publishedPlaylist(kit.admin, [a.id, b.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    const edit = (rev, ids) => kit.call(`/api/playlists/${base.id}`, { method: 'PATCH', session: kit.admin, body: { rev, items: ids.map(mediaId => ({ mediaId })) } });
    must(await edit(1, [c.id]));
    must(await kit.call(`/api/playlists/${base.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: 2 } }), 201);
    await kit.liveSchedule(kit.admin, { playlistId: base.id, displayIds: [tv.display.id] });
    const manifest = async () => must(await kit.call('/api/player/manifest', { token: tv.token })).items.map(i => i.id);
    assert.deepEqual(await manifest(), [c.id]);

    const restore = body => kit.call(`/api/playlists/${base.id}/restore`, { method: 'POST', session: kit.admin, body });
    const restored = must(await restore({ rev: 2, version: 1 }));
    assert.deepEqual(restored.items.map(i => i.mediaId), [a.id, b.id]);
    assert.deepEqual([restored.restored, restored.latestVersion, restored.draftRev, restored.hasUnpublishedChanges], [{ version: 1, skipped: 0 }, 2, 3, true]);
    assert.deepEqual(await manifest(), [c.id], 'restaurar não muda o que está no ar');
    assert.equal((await restore({ rev: 2, version: 1 })).data.code, 'REVISION_CONFLICT');
    assert.equal((await restore({ rev: 3, version: 9 })).status, 404);
    assert.equal((await restore({ rev: 3, version: 0 })).status, 400);
    assert.equal((await restore({ rev: 3 })).status, 400);

    // Se um dos arquivos da versão antiga foi excluído, ele fica de fora (e o aviso informa quantos).
    must(await edit(3, [c.id]));
    must(await kit.call(`/api/media/${b.id}`, { method: 'DELETE', session: kit.admin }));
    const partial = must(await restore({ rev: 4, version: 1 }));
    assert.deepEqual([partial.items.map(i => i.mediaId), partial.restored.skipped], [[a.id], 1]);
    assert.equal(must(await kit.call(`/api/playlists/${base.id}/versions/1`, { session: kit.admin })).items[1].readiness, 'deleted');
  });
});

test('excluir playlist: bloqueada se houver programação; some junto com versões e itens', async () => {
  await withApp(async kit => {
    const [a] = await threeMedia(kit);
    const base = await kit.publishedPlaylist(kit.admin, [a.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    const schedule = await kit.liveSchedule(kit.admin, { playlistId: base.id, displayIds: [tv.display.id] });
    const blocked = await kit.call(`/api/playlists/${base.id}`, { method: 'DELETE', session: kit.admin });
    assert.deepEqual([blocked.status, blocked.data.code, blocked.data.details.schedules.map(s => s.id)], [409, 'PLAYLIST_IN_USE', [schedule.id]]);
    must(await kit.call(`/api/schedules/${schedule.id}/stop`, { method: 'POST', session: kit.admin }));
    assert.equal((await kit.call(`/api/playlists/${base.id}`, { method: 'DELETE', session: kit.admin })).status, 409, 'programação parada ainda referencia a playlist');
    must(await kit.call(`/api/schedules/${schedule.id}`, { method: 'DELETE', session: kit.admin }));
    must(await kit.call(`/api/playlists/${base.id}`, { method: 'DELETE', session: kit.admin }));
    const count = table => kit.app.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.deepEqual(['playlists', 'playlist_items', 'playlist_versions', 'playlist_version_items'].map(count), [0, 0, 0, 0]);
    assert.equal((await kit.call(`/api/playlists/${base.id}`, { session: kit.admin })).status, 404);
    must(await kit.call(`/api/media/${a.id}`, { method: 'DELETE', session: kit.admin }));
  });
});

test('listar playlists: busca, paginação, contagens e isolamento por unidade/setor', async () => {
  await withApp(async kit => {
    const [a] = await threeMedia(kit);
    const names = ['Avisos gerais', 'Avisos de segurança', 'Cardápio', 'Campanha de vacinação'];
    const created = [];
    for (const name of names) created.push(await kit.playlist(kit.admin, { name, items: [{ mediaId: a.id }] }));
    const published = must(await kit.call(`/api/playlists/${created[0].id}/publish`, { method: 'POST', session: kit.admin, body: { rev: 1 } }), 201);
    const tv = await kit.pairedDisplay(kit.admin);
    await kit.liveSchedule(kit.admin, { playlistId: published.id, displayIds: [tv.display.id] });
    const list = query => kit.call(`/api/playlists?unitId=leste&sectorId=rh${query ? `&${query}` : ''}`, { session: kit.admin });

    const all = must(await list());
    assert.deepEqual([all.total, all.playlists.length, all.maxItems], [4, 4, 6]);
    const first = all.playlists.find(p => p.id === created[0].id);
    assert.deepEqual([first.itemCount, first.scheduleCount, first.liveScheduleCount, first.latestVersion], [1, 1, 1, 1]);
    assert.deepEqual(must(await list('q=AVISOS')).playlists.map(p => p.name).sort(), ['Avisos de segurança', 'Avisos gerais']);
    assert.deepEqual(must(await list('q=SEGURANCA')).playlists.map(p => p.name), ['Avisos de segurança'], 'a busca ignora acento e caixa, como na biblioteca');
    assert.deepEqual(must(await list('q=vacina&limit=1&offset=0')).playlists.map(p => p.name), ['Campanha de vacinação']);
    assert.deepEqual([must(await list('q=avisos&limit=1&offset=1')).total, must(await list('q=avisos&limit=1&offset=1')).playlists.length], [2, 1], 'paginação da busca');
    assert.equal(must(await list('q=%25')).total, 0, 'curinga % é texto');
    const page = must(await list('limit=3&offset=3'));
    assert.deepEqual([page.total, page.playlists.length, page.limit, page.offset], [4, 1, 3, 3]);
    for (const bad of ['limit=0', 'limit=201', 'offset=-1', 'limit=x']) assert.equal((await list(bad)).status, 400, bad);
    // Espaços diferentes não se misturam; quem não tem acesso ao espaço leva 403.
    assert.equal(must(await kit.call('/api/playlists?unitId=centro&sectorId=rh', { session: kit.admin })).total, 0);
    const viewer = await kit.createUser('viewer');
    assert.equal(must(await kit.call('/api/playlists?unitId=leste&sectorId=rh', { session: viewer.session })).total, 4);
    assert.equal((await kit.call('/api/playlists?unitId=centro&sectorId=rh', { session: viewer.session })).status, 403);
    assert.equal((await kit.call('/api/playlists', { session: viewer.session })).status, 400);
  });
});

test('limite de itens é configurável; playlists antigas acima do limite podem encolher, mas não crescer', async () => {
  const dir = makeTempDir('tvcorp-test-');
  try {
    let playlistId, media;
    await withApp(async kit => {
      media = await kit.approvedMedia(kit.admin, { name: 'm.png' });
      const created = await kit.playlist(kit.admin, { name: 'Longa', items: Array.from({ length: 8 }, () => ({ mediaId: media.id })) });
      playlistId = created.id;
      must(await kit.call(`/api/playlists/${playlistId}/publish`, { method: 'POST', session: kit.admin, body: { rev: 1 } }), 201);
      assert.equal(must(await kit.call('/api/playlists?unitId=leste&sectorId=rh', { session: kit.admin })).maxItems, 10);
    }, { dataDir: dir, playlistMaxItems: 10 });
    await withApp(async kit => {
      const patch = (rev, count) => kit.call(`/api/playlists/${playlistId}`, { method: 'PATCH', session: kit.admin, body: { rev, items: Array.from({ length: count }, () => ({ mediaId: media.id })) } });
      assert.equal(must(await kit.call(`/api/playlists/${playlistId}`, { session: kit.admin })).items.length, 8, 'nada é cortado ao reduzir o limite');
      assert.deepEqual(await patch(1, 9).then(r => [r.status, r.data.code]), [400, 'PLAYLIST_LIMIT'], 'não cresce além do que já tinha');
      assert.equal((await patch(1, 8)).status, 200, 'pode manter o tamanho');
      const publishNow = rev => kit.call(`/api/playlists/${playlistId}/publish`, { method: 'POST', session: kit.admin, body: { rev } });
      assert.equal((await publishNow(2)).status, 201, 'publicar com o mesmo tamanho da versão anterior continua permitido');
      must(await patch(2, 5));
      assert.equal((await patch(3, 6)).status, 200, 'volta a crescer até o limite novo');
      assert.equal((await patch(4, 7)).data.code, 'PLAYLIST_LIMIT');
      assert.equal((await publishNow(4)).status, 201);
      const nova = await kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: 'Nova', items: Array.from({ length: 7 }, () => ({ mediaId: media.id })) } });
      assert.equal(nova.data.code, 'PLAYLIST_LIMIT');
    }, { dataDir: dir, playlistMaxItems: 6, reuseAdmin: true });
  } finally { removeTempDir(dir); }
});

test('playlists registram quem fez o quê na auditoria, com unidade e setor', async () => {
  await withApp(async kit => {
    const [a, b] = await threeMedia(kit);
    const base = await kit.publishedPlaylist(kit.admin, [a.id]);
    must(await kit.call(`/api/playlists/${base.id}`, { method: 'PATCH', session: kit.admin, body: { rev: 1, items: [{ mediaId: b.id }] } }));
    must(await kit.call(`/api/playlists/${base.id}/restore`, { method: 'POST', session: kit.admin, body: { rev: 2, version: 1 } }));
    must(await kit.call(`/api/playlists/${base.id}`, { method: 'DELETE', session: kit.admin }));
    const events = must(await kit.call('/api/audit?limit=100', { session: kit.admin })).events.filter(e => e.action.startsWith('playlist.'));
    assert.deepEqual(events.map(e => e.action).reverse(), ['playlist.created', 'playlist.version.published', 'playlist.updated', 'playlist.version.restored', 'playlist.deleted']);
    for (const event of events) assert.deepEqual([event.actor, event.unitId, event.sectorId], ['admin@example.invalid', 'leste', 'rh']);
    assert.equal(events.find(e => e.action === 'playlist.version.published').detail.version, 1);
  });
});
