// Programação feita pelo Editor (2.3.0). Quem aprova arquivos e publica VERSÕES de playlist continua sendo o Gestor ou a TI;
// o Editor escolhe, entre o que já foi liberado, quando e em quais TVs autorizadas a ele isso vai ao ar.
// Tudo aqui passa pela API de verdade (permissão + unidade + setor + acesso à TV são conferidos no servidor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_RESERVED, ROLE_PERMISSIONS } from '../server/domain/permissions.mjs';
import { withApp, must, PASSWORD } from './helpers/app.mjs';

const call = (k, session, method, url, body) => k.call(url, { method, session, body });
const manifestIds = async (k, tv) => must(await k.call('/api/player/manifest', { token: tv.token })).items.map(item => item.id);
const sequenceOf = async (k, tv, session = k.admin) => must(await k.call(`/api/displays/${tv.display.id}/sequence`, { session }));
const linkOf = async (k, tv, scheduleId) => (await sequenceOf(k, tv)).schedules.find(item => item.id === scheduleId);
const totalIn = async (k, session, sectorId = 'rh', unitId = 'leste') => must(await k.call(`/api/schedules?unitId=${unitId}&sectorId=${sectorId}`, { session })).total;

// TV pareada (já ativa), com as concessões pedidas. O padrão é o setor RH de Leste, o mesmo da pessoa de teste.
async function pairedTv(k, { name = 'TV de teste', unitId = 'leste', sectorIds = ['rh'], userIds = [] } = {}) {
  const created = must(await k.call('/api/displays', { method: 'POST', session: k.admin, body: { name, unitId, sectorIds, userIds } }), 201);
  const paired = must(await k.call('/api/player/pair', { method: 'POST', body: { code: created.pairingCode } }));
  return { ...created, token: paired.token };
}

// Arquivo aprovado e playlist com versão publicada: é o que a TI ou o Gestor deixa pronto para o Editor programar.
async function material(k, { unitId = 'leste', sectorId = 'rh', title = 'Aviso' } = {}) {
  const media = await k.approvedMedia(k.admin, { unitId, sectorId, title, name: `${title}.png` });
  const playlist = await k.publishedPlaylist(k.admin, [media.id], { unitId, sectorId, name: `Playlist ${title}` });
  return { media, playlist };
}

test('o Editor programa e publica por padrão, sem ganhar nenhum outro poder; as contas já existentes recebem o padrão sem migração', async () => {
  const defaults = new Set(ROLE_PERMISSIONS.editor);
  for (const id of ['schedule:create', 'schedule:publish', 'screen:pair']) assert.ok(defaults.has(id), `${id} é padrão do Editor`);
  for (const id of ['media:approve', 'media:delete', 'folder:delete', 'playlist:publish', 'playlist:delete', 'audit:read', ...ADMIN_RESERVED]) {
    assert.ok(!defaults.has(id), `${id} continua fora do padrão do Editor`);
  }
  assert.equal(defaults.size, 9, 'pastas (2), arquivos (2), playlists (2), programações (2) e código de pareamento');
  assert.equal(ROLE_PERMISSIONS.manager.length, 15, 'o padrão do Gestor não muda');
  assert.deepEqual(ROLE_PERMISSIONS.viewer, [], 'o Visualizador continua somente consultando');

  await withApp(async k => {
    const editor = await k.createUser('editor');
    const me = must(await k.call('/api/me', { session: editor.session })).user;
    assert.ok(me.permissions.includes('schedule:create') && me.permissions.includes('schedule:publish'));
    assert.ok(!me.permissions.includes('playlist:publish') && !me.permissions.includes('media:approve'));
    // O padrão vem do perfil, não de um dado gravado na conta. Uma conta de Editor criada antes desta versão tem o mesmo registro
    // (sem concessões nem retiradas) e, por isso, passa a ter o padrão sem migração de banco e sem ação da TI.
    const stored = k.app.services.users.byId(editor.user.id);
    assert.deepEqual([stored.grants, stored.revokes], [[], []]);
    const catalog = must(await k.call('/api/permissions', { session: editor.session }));
    assert.deepEqual([...catalog.rolePermissions.editor].sort(), [...ROLE_PERMISSIONS.editor].sort(), 'a interface recebe o mesmo padrão do servidor');
  });
});

test('o Editor faz o ciclo completo: rascunho, ajuste, publicação, alteração no ar, interrupção, nova publicação e exclusão; a auditoria registra o nome dele', async () => {
  await withApp(async k => {
    const { media, playlist } = await material(k);
    const tv = await pairedTv(k);
    const editor = await k.createUser('editor');
    const body = { name: 'Avisos da semana', unitId: 'leste', sectorId: 'rh', playlistId: playlist.id, displayIds: [tv.display.id] };

    const draft = must(await call(k, editor.session, 'POST', '/api/schedules', body), 201);
    assert.deepEqual([draft.status, draft.state, draft.createdBy], ['draft', 'draft', editor.user.id]);
    assert.deepEqual(await manifestIds(k, tv), [], 'rascunho não vai à TV');
    const adjusted = must(await call(k, editor.session, 'PATCH', `/api/schedules/${draft.id}`, { rev: draft.rev, name: 'Avisos da semana (revisado)' }));
    const live = must(await call(k, editor.session, 'POST', `/api/schedules/${draft.id}/publish`, { rev: adjusted.rev }));
    assert.deepEqual([live.status, live.state, live.publishedBy], ['published', 'live', editor.user.id]);
    assert.deepEqual(await manifestIds(k, tv), [media.id], 'a TV passa a receber o conteúdo');
    assert.equal((await linkOf(k, tv, draft.id)).linkStatus, 'active');

    const renamed = must(await call(k, editor.session, 'PATCH', `/api/schedules/${draft.id}`, { rev: live.rev, name: 'Avisos no ar' }));
    assert.deepEqual([renamed.state, renamed.name], ['live', 'Avisos no ar'], 'ajustar o que está no ar não derruba a publicação');
    assert.equal((await call(k, editor.session, 'PATCH', `/api/schedules/${draft.id}`, { rev: live.rev, name: 'Revisão vencida' })).data.code, 'REVISION_CONFLICT');
    assert.equal((await call(k, editor.session, 'DELETE', `/api/schedules/${draft.id}`)).data.code, 'SCHEDULE_LIVE', 'excluir exige interromper antes');

    const stopped = must(await call(k, editor.session, 'POST', `/api/schedules/${draft.id}/stop`));
    assert.deepEqual([stopped.status, await manifestIds(k, tv)], ['stopped', []]);
    const again = must(await call(k, editor.session, 'POST', `/api/schedules/${draft.id}/publish`, {}));
    assert.deepEqual([again.state, await manifestIds(k, tv)], ['live', [media.id]]);

    const direct = must(await call(k, editor.session, 'POST', '/api/schedules', { ...body, name: 'Direto no ar', publish: true }), 201);
    assert.equal(direct.state, 'live', 'criar já publicando também é permitido');
    assert.deepEqual(await manifestIds(k, tv), [media.id, media.id], 'duas programações publicadas na mesma TV entram na sequência');
    for (const id of [direct.id, draft.id]) {
      must(await call(k, editor.session, 'POST', `/api/schedules/${id}/stop`));
      must(await call(k, editor.session, 'DELETE', `/api/schedules/${id}`));
    }
    assert.equal(await totalIn(k, editor.session), 0);
    assert.deepEqual(await manifestIds(k, tv), []);

    const events = must(await k.call('/api/audit?limit=200', { session: k.admin })).events.filter(event => event.action.startsWith('schedule.'));
    assert.deepEqual([...new Set(events.map(event => event.action))].sort(), ['schedule.created', 'schedule.deleted', 'schedule.published', 'schedule.stopped', 'schedule.updated']);
    for (const event of events) assert.deepEqual([event.actor, event.unitId, event.sectorId], [editor.email, 'leste', 'rh'], event.action);
  });
});

test('o Editor só programa onde a TI liberou: TV sem concessão, TV de outra unidade, outro setor e identificadores manipulados são recusados', async () => {
  await withApp(async k => {
    const own = await material(k), other = await material(k, { sectorId: 'ti', title: 'Aviso TI' });
    const editor = await k.createUser('editor'), colleague = await k.createUser('manager');
    const tvRh = await pairedTv(k, { name: 'TV RH' });
    const tvTi = await pairedTv(k, { name: 'TV TI', sectorIds: ['ti'] });
    const tvPersonal = await pairedTv(k, { name: 'TV de uma pessoa', sectorIds: [], userIds: [colleague.user.id] });
    const tvCentro = await k.display(k.admin, { name: 'TV Centro', unitId: 'centro', sectorId: 'rh' });
    const base = { name: 'Tentativa', unitId: 'leste', sectorId: 'rh', playlistId: own.playlist.id };
    const create = (extra, session = editor.session) => call(k, session, 'POST', '/api/schedules', { ...base, ...extra });
    const denied = (response, status, code, what) => assert.deepEqual([response.status, response.data.code], [status, code], `${what}: ${JSON.stringify(response.data)}`);

    // TV sem concessão para o setor ou para a pessoa: nem rascunho, nem publicação, nem misturada com uma TV permitida.
    denied(await create({ displayIds: [tvTi.display.id] }), 403, 'DISPLAY_ACCESS_DENIED', 'TV de outro setor (rascunho)');
    denied(await create({ displayIds: [tvTi.display.id], publish: true }), 403, 'DISPLAY_ACCESS_DENIED', 'TV de outro setor (publicando)');
    denied(await create({ displayIds: [tvPersonal.display.id] }), 403, 'DISPLAY_ACCESS_DENIED', 'TV liberada a outra pessoa');
    denied(await create({ displayIds: [tvRh.display.id, tvTi.display.id] }), 403, 'DISPLAY_ACCESS_DENIED', 'uma TV permitida e uma proibida');
    assert.equal(await totalIn(k, k.admin), 0, 'nenhum pedido recusado deixou registro pela metade');
    denied(await create({ displayIds: [tvCentro.display.id] }), 400, 'SCOPE_MISMATCH', 'TV de outra unidade');
    // Concessão pessoal feita pela TI vale para o Editor (e só para ele).
    const personal = await sequenceOf(k, tvPersonal);
    must(await call(k, k.admin, 'PATCH', `/api/displays/${tvPersonal.display.id}`, { rev: personal.display.accessRev, sectorIds: [], userIds: [colleague.user.id, editor.user.id] }));
    must(await create({ displayIds: [tvPersonal.display.id], publish: true }), 201);
    assert.equal((await sequenceOf(k, tvPersonal, editor.session)).display.permissions.publish, true);
    // Revogada a concessão, a programação que ele publicou é suspensa na hora (o vínculo depende de quem autorizou).
    const mine = (await sequenceOf(k, tvPersonal)).schedules[0];
    must(await call(k, k.admin, 'PATCH', `/api/displays/${tvPersonal.display.id}`, { rev: (await sequenceOf(k, tvPersonal)).display.accessRev, sectorIds: [], userIds: [colleague.user.id] }));
    assert.deepEqual([(await linkOf(k, tvPersonal, mine.id)).linkStatus, await manifestIds(k, tvPersonal)], ['suspended', []]);

    // Unidade ou setor diferentes do dele: mesmo com a permissão, o escopo vale.
    denied(await create({ unitId: 'centro', displayIds: [] }), 403, 'SCOPE_DENIED', 'outra unidade');
    denied(await create({ sectorId: 'ti', playlistId: other.playlist.id, displayIds: [tvTi.display.id] }), 403, 'SCOPE_DENIED', 'outro setor');
    denied(await create({ playlistId: other.playlist.id, displayIds: [tvRh.display.id] }), 400, 'SCOPE_MISMATCH', 'playlist de outro setor no meu setor');
    // Programações de outros espaços: nem ler, nem alterar, nem publicar, nem interromper, nem excluir.
    const theirs = await k.liveSchedule(k.admin, { sectorId: 'ti', playlistId: other.playlist.id, displayIds: [tvTi.display.id], name: 'Do setor TI' });
    const centroMaterial = await material(k, { unitId: 'centro', title: 'Aviso Centro' });
    const abroad = await k.liveSchedule(k.admin, { unitId: 'centro', playlistId: centroMaterial.playlist.id, displayIds: [tvCentro.display.id], name: 'De Centro' });
    for (const schedule of [theirs, abroad]) {
      for (const [method, suffix, payload] of [['GET', '', undefined], ['PATCH', '', { rev: schedule.rev, name: 'Invasão' }], ['POST', '/publish', {}], ['POST', '/stop', undefined], ['DELETE', '', undefined]]) {
        denied(await call(k, editor.session, method, `/api/schedules/${schedule.id}${suffix}`, payload), 403, 'SCOPE_DENIED', `${method} ${schedule.name}${suffix}`);
      }
    }
    assert.deepEqual(await manifestIds(k, tvTi), [other.media.id], 'a programação do outro setor segue intacta');
    // Identificadores inventados ou malformados nunca viram erro 500.
    assert.equal((await call(k, editor.session, 'GET', '/api/schedules/nao-existe')).status, 404);
    assert.equal((await call(k, editor.session, 'POST', '/api/schedules/nao-existe/publish', {})).status, 404);
    assert.equal((await create({ playlistId: 'nao-existe', displayIds: [] })).status, 404);
    assert.equal((await create({ displayIds: ['nao-existe'] })).status, 400);
    assert.equal((await create({ displayIds: 'nao-e-lista' })).status, 400);
    assert.equal((await create({ displayIds: [{ id: tvRh.display.id }] })).status, 400);
    assert.equal((await create({ unitId: '../centro', displayIds: [] })).status, 400);
    assert.equal((await create({ sectorId: 'x'.repeat(200), displayIds: [] })).status, 400);
    // Sem sessão não há programação.
    assert.equal((await call(k, undefined, 'POST', '/api/schedules', { ...base, displayIds: [tvRh.display.id] })).status, 401);
    assert.equal(await totalIn(k, k.admin), 1, 'só a programação publicada com a concessão pessoal existe');
  });
});

test('o Editor não ultrapassa a aprovação: playlist sem versão publicada e arquivo rejeitado não vão ao ar, e ele não aprova nem publica versões nem mexe na sequência da TV', async () => {
  await withApp(async k => {
    const editor = await k.createUser('editor');
    const tv = await pairedTv(k, { sectorIds: ['rh', 'ti'] });
    // (1) O Editor monta o rascunho de uma playlist com um arquivo que ele mesmo enviou (aguardando aprovação).
    const pending = await k.upload(editor.session, { name: 'enviado-pelo-editor.png' });
    const draftPlaylist = await k.playlist(editor.session, { name: 'Rascunho do Editor', items: [{ mediaId: pending.id }] });
    const create = (playlistId, extra = {}) => call(k, editor.session, 'POST', '/api/schedules', { name: 'Programação', unitId: 'leste', sectorId: 'rh', playlistId, displayIds: [tv.display.id], ...extra });
    assert.equal((await create(draftPlaylist.id)).data.code, 'PLAYLIST_NOT_PUBLISHED', 'sem versão publicada não há o que programar');
    assert.equal((await call(k, editor.session, 'POST', `/api/playlists/${draftPlaylist.id}/publish`, { rev: draftPlaylist.draftRev })).status, 403, 'publicar versão continua com o Gestor ou a TI');
    assert.equal((await call(k, editor.session, 'POST', `/api/media/${pending.id}/approve`, { acknowledgeUnscanned: true })).status, 403, 'aprovar arquivo também');
    // (2) A versão foi publicada por quem pode, o Editor agenda; depois um arquivo é rejeitado: publicar passa a ser recusado.
    const { media, playlist } = await material(k, { title: 'Aviso aprovado' });
    const draft = must(await create(playlist.id), 201);
    must(await call(k, k.admin, 'POST', `/api/media/${media.id}/reject`, {}));
    const blocked = await call(k, editor.session, 'POST', `/api/schedules/${draft.id}/publish`, {});
    assert.deepEqual([blocked.status, blocked.data.code, blocked.data.details.items.map(item => item.mediaId)], [409, 'MEDIA_NOT_READY', [media.id]]);
    assert.deepEqual([(await call(k, editor.session, 'GET', `/api/schedules/${draft.id}`)).data.status, await manifestIds(k, tv)], ['draft', []]);
    assert.equal((await create(playlist.id, { publish: true })).data.code, 'MEDIA_NOT_READY', 'criar já publicando passa pela mesma conferência');
    assert.equal(await totalIn(k, k.admin), 1, 'a tentativa recusada não deixou registro');
    // (3) A sequência global da TV, o cadastro, os acessos e a credencial continuam com o Administrador.
    const { media: second, playlist: secondPlaylist } = await material(k, { title: 'Segundo aviso' });
    const live = must(await create(secondPlaylist.id, { name: 'No ar', publish: true }), 201);
    const current = await sequenceOf(k, tv, editor.session);
    assert.deepEqual([current.schedules.at(-1).id, current.schedules.at(-1).linkStatus], [live.id, 'active'], 'a programação do Editor entra no fim da sequência compartilhada');
    for (const [method, url, payload] of [
      ['PUT', `/api/displays/${tv.display.id}/order`, { rev: current.revision, scheduleIds: [live.id] }],
      ['PATCH', `/api/displays/${tv.display.id}`, { rev: current.display.accessRev, sectorIds: ['rh'], userIds: [] }],
      ['PATCH', `/api/displays/${tv.display.id}`, { name: 'Invasão' }],
      ['POST', `/api/displays/${tv.display.id}/pairing`, undefined],
      ['POST', `/api/displays/${tv.display.id}/activate`, undefined],
      ['DELETE', `/api/displays/${tv.display.id}`, undefined],
      ['POST', '/api/displays', { name: 'Nova TV', unitId: 'leste', sectorIds: ['rh'], userIds: [] }]
    ]) assert.equal((await call(k, editor.session, method, url, payload)).status, 403, `${method} ${url}`);
    assert.deepEqual(await manifestIds(k, tv), [second.id], 'nada disso derrubou a programação');
    assert.deepEqual(must(await k.call('/api/audit', { session: editor.session })).events, [], 'a auditoria continua restrita a quem tem audit:read');
  });
});

test('a TI restringe uma pessoa quando quiser: sem publicar só rascunha, sem as duas só consulta, e a retirada tira do ar o que ela publicou', async () => {
  await withApp(async k => {
    const { media, playlist } = await material(k);
    const tv = await pairedTv(k);
    const ana = await k.createUser('editor');
    const live = await k.liveSchedule(ana.session, { playlistId: playlist.id, displayIds: [tv.display.id], name: 'Da Ana' });
    assert.deepEqual(await manifestIds(k, tv), [media.id]);

    // Retirar a publicação: a sessão cai, o que ela havia publicado sai do ar e o motivo fica visível para a TI.
    must(await call(k, k.admin, 'PATCH', `/api/users/${ana.user.id}`, { revokes: ['schedule:publish'] }));
    assert.equal((await k.call('/api/me', { session: ana.session })).status, 401);
    assert.deepEqual(await manifestIds(k, tv), [], 'sem a permissão, a TV deixa de receber na hora');
    const suspended = await linkOf(k, tv, live.id);
    assert.deepEqual([suspended.linkStatus, suspended.suspensionReason], ['suspended', 'Responsável sem permissão para programar']);
    const drafter = (await k.login(ana.email, PASSWORD)).session;
    const me = must(await k.call('/api/me', { session: drafter })).user;
    assert.deepEqual([me.permissions.includes('schedule:create'), me.permissions.includes('schedule:publish'), me.revokes], [true, false, ['schedule:publish']]);
    const body = { name: 'Rascunho da Ana', unitId: 'leste', sectorId: 'rh', playlistId: playlist.id, displayIds: [tv.display.id] };
    const draft = must(await call(k, drafter, 'POST', '/api/schedules', body), 201);
    assert.equal(draft.status, 'draft');
    assert.equal((await call(k, drafter, 'POST', '/api/schedules', { ...body, publish: true })).status, 403, 'criar não implica publicar');
    assert.equal((await call(k, drafter, 'POST', `/api/schedules/${draft.id}/publish`, {})).status, 403);
    for (const [method, suffix, payload] of [['PATCH', '', { rev: live.rev, name: 'Mexendo no ar' }], ['POST', '/stop', undefined], ['DELETE', '', undefined]]) {
      assert.equal((await call(k, drafter, method, `/api/schedules/${live.id}${suffix}`, payload)).status, 403, `${method} no que está publicado`);
    }
    assert.equal((await call(k, drafter, 'PATCH', `/api/schedules/${draft.id}`, { rev: draft.rev, name: 'Ajustado' })).status, 200, 'rascunho continua editável');
    assert.equal((await sequenceOf(k, tv, drafter)).display.permissions.publish, true, 'ainda é destino autorizado para rascunhos');

    // Devolver a permissão não religa sozinho: é preciso interromper e publicar de novo (decisão consciente).
    must(await call(k, k.admin, 'PATCH', `/api/users/${ana.user.id}`, { revokes: [] }));
    const back = (await k.login(ana.email, PASSWORD)).session;
    assert.deepEqual(await manifestIds(k, tv), [], 'o vínculo suspenso não volta sozinho');
    must(await call(k, back, 'POST', `/api/schedules/${live.id}/stop`));
    must(await call(k, back, 'POST', `/api/schedules/${live.id}/publish`, {}));
    assert.deepEqual([await manifestIds(k, tv), (await linkOf(k, tv, live.id)).linkStatus], [[media.id], 'active']);

    // Sem as duas permissões a pessoa só consulta, e a TV mostra "consulta" em vez de "destino".
    const reader = await k.createUser('editor', { revokes: ['schedule:create', 'schedule:publish'] });
    assert.equal(await totalIn(k, reader.session), 2, 'consultar continua permitido');
    assert.equal((await call(k, reader.session, 'POST', '/api/schedules', body)).status, 403);
    assert.equal((await call(k, reader.session, 'POST', `/api/schedules/${live.id}/publish`, {})).status, 403);
    assert.equal((await sequenceOf(k, tv, reader.session)).display.permissions.publish, false);
    // Mudar o perfil para Visualizador também tira do ar o que a pessoa publicava.
    must(await call(k, k.admin, 'PATCH', `/api/users/${ana.user.id}`, { role: 'viewer' }));
    assert.deepEqual(await manifestIds(k, tv), []);
  });
});

test('registros antigos continuam valendo: concessão individual redundante e retirada de quem não tinha o padrão são normalizadas pelo servidor', async () => {
  await withApp(async k => {
    const veteran = await k.createUser('editor');
    // Conta da 2.2.0 cuja programação foi concedida individualmente pela TI (hoje isso já é o padrão do perfil).
    const raw = k.app.services.users.byId(veteran.user.id);
    raw.grants = ['schedule:create'];
    k.app.db.prepare('UPDATE users SET data=? WHERE id=?').run(JSON.stringify(raw), raw.id);
    const session = (await k.login(veteran.email, PASSWORD)).session;
    const me = must(await k.call('/api/me', { session })).user;
    assert.deepEqual(me.permissions.filter(id => id.startsWith('schedule:')), ['schedule:create', 'schedule:publish'], 'sem duplicar e sem perder nada');
    // Ao salvar a conta, a concessão que virou padrão deixa de ser gravada; a retirada de algo que é padrão é gravada.
    const saved = must(await call(k, k.admin, 'PATCH', `/api/users/${veteran.user.id}`, { grants: ['schedule:create', 'playlist:publish'], revokes: ['schedule:publish'] }));
    assert.deepEqual([saved.grants, saved.revokes], [['playlist:publish'], ['schedule:publish']]);
    const cleaned = must(await call(k, k.admin, 'PATCH', `/api/users/${veteran.user.id}`, { grants: [], revokes: [] }));
    assert.deepEqual([cleaned.grants, cleaned.revokes], [[], []], 'voltar ao padrão do perfil limpa as exceções');
    // Retirar o que o perfil nunca teve não grava nada (continua sendo recusado quem pede concessão e retirada ao mesmo tempo).
    const viewer = await k.createUser('viewer');
    const untouched = must(await call(k, k.admin, 'PATCH', `/api/users/${viewer.user.id}`, { revokes: ['schedule:publish'] }));
    assert.deepEqual(untouched.revokes, []);
    assert.equal((await call(k, k.admin, 'PATCH', `/api/users/${veteran.user.id}`, { grants: ['schedule:publish'], revokes: ['schedule:publish'] })).status, 400);
  });
});
