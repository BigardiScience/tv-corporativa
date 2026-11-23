import test from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, must, withApp } from './helpers/app.mjs';

// A tela de Auditoria mostra o texto dos detalhes gravados; se o servidor deixar de dizer QUEM ou QUAL arquivo, a trilha
// vira uma lista de identificadores que ninguém consegue ler. Este teste trava os campos legíveis de cada evento.
test('a trilha de auditoria identifica a pessoa, o arquivo, a TV e a playlist de cada evento', async () => {
  await withApp(async kit => {
    const events = async () => must(await kit.call('/api/audit?limit=500', { session: kit.admin })).events;
    const last = async action => (await events()).find(event => event.action === action);

    const person = await kit.createUser('editor', { email: 'pessoa.legivel@example.invalid' });
    assert.equal((await last('user.created')).detail.email, 'pessoa.legivel@example.invalid');

    must(await kit.call(`/api/users/${person.user.id}`, { method: 'PATCH', session: kit.admin, body: { role: 'viewer' } }));
    assert.equal((await last('user.updated')).detail.email, 'pessoa.legivel@example.invalid');

    must(await kit.call(`/api/users/${person.user.id}`, { method: 'PATCH', session: kit.admin, body: { password: 'Outra-senha-12345' } }));
    const reset = await last('user.password.reset');
    assert.equal(reset.detail.email, 'pessoa.legivel@example.invalid');
    assert.ok(!JSON.stringify(await events()).includes('Outra-senha-12345') && !JSON.stringify(await events()).includes(PASSWORD), 'nenhuma senha na trilha');

    const approved = await kit.upload(kit.admin, { title: 'Comunicado aprovado' });
    await kit.approve(kit.admin, approved.id);
    assert.equal((await last('media.approved')).detail.title, 'Comunicado aprovado');
    const rejected = await kit.upload(kit.admin, { title: 'Comunicado rejeitado' });
    must(await kit.call(`/api/media/${rejected.id}/reject`, { method: 'POST', session: kit.admin, body: {} }));
    assert.equal((await last('media.rejected')).detail.title, 'Comunicado rejeitado');

    const playlist = await kit.publishedPlaylist(kit.admin, [approved.id], { name: 'Playlist legível' });
    must(await kit.call(`/api/playlists/${playlist.id}/restore`, { method: 'POST', session: kit.admin, body: { rev: playlist.draftRev, version: 1 } }));
    assert.equal((await last('playlist.version.restored')).detail.name, 'Playlist legível');

    const tv = await kit.pairedDisplay(kit.admin, { name: 'TV legível' });
    const paired = await last('device.paired');
    assert.equal(paired.detail.name, 'TV legível');
    assert.equal(paired.actor, `player:${tv.display.id}`, 'o responsável é o próprio player, identificado pelo id');
    must(await kit.call(`/api/displays/${tv.display.id}/pairing`, { method: 'POST', session: kit.admin, body: {} }));
    assert.equal((await last('device.pairing.renewed')).detail.name, 'TV legível');
  });
});

// Sem o escopo, a TI (Gestor com audit:read) leria eventos de outras unidades e setores pela mesma tela.
test('a consulta da trilha pagina por "before" e nunca devolve mais que o limite pedido nem eventos de fora do escopo', async () => {
  await withApp(async kit => {
    const manager = await kit.createUser('manager');
    for (let index = 0; index < 7; index++) await kit.folder(kit.admin, { name: `Pasta ${index}` });
    for (let index = 0; index < 3; index++) await kit.folder(kit.admin, { unitId: 'centro', sectorId: 'seguranca', name: `Fora ${index}` });
    const everything = [];
    let before;
    for (let guard = 0; guard < 20; guard++) {
      const page = must(await kit.call(`/api/audit?limit=3${before ? `&before=${before}` : ''}`, { session: manager.session })).events;
      assert.ok(page.length <= 3);
      everything.push(...page);
      if (page.length < 3) break;
      before = page.at(-1).id;
    }
    assert.ok(everything.every(event => event.unitId === 'leste' && event.sectorId === 'rh'), 'só o escopo do Gestor');
    assert.equal(new Set(everything.map(event => event.id)).size, everything.length, 'sem repetição entre páginas');
    assert.deepEqual(everything.map(event => event.id), [...everything.map(event => event.id)].sort((a, b) => b - a), 'do mais novo ao mais antigo');
    assert.equal(everything.filter(event => event.action === 'folder.created').length, 7);
    assert.equal(must(await kit.call('/api/audit?limit=100000', { session: kit.admin })).events.length <= 500, true, 'limite máximo de 500 por página');
  });
});
