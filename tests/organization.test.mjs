import test from 'node:test';
import assert from 'node:assert/strict';
import { must, withApp } from './helpers/app.mjs';

// Unidades e setores são cadastro global (permissão settings:manage, só do Administrador). Arquivos, playlists, programações,
// TVs, pessoas e auditoria apontam para o IDENTIFICADOR, nunca para o nome: renomear não pode soltar nada de lugar nenhum.
test('Administrador cadastra e renomeia unidades e setores; acessos e histórico seguem o identificador', async () => {
  await withApp(async kit => {
    const person = await kit.createUser('editor');
    const media = await kit.upload(person.session, { title: 'Arquivo da Leste' });

    const unit = must(await kit.call('/api/units', { method: 'POST', session: kit.admin, body: { name: '  Unidade Sorocaba ', city: 'Sorocaba' } }), 201);
    const sector = must(await kit.call('/api/sectors', { method: 'POST', session: kit.admin, body: { name: 'Qualidade' } }), 201);
    assert.deepEqual([unit.name, unit.city, typeof unit.id], ['Unidade Sorocaba', 'Sorocaba', 'string'], 'o nome é gravado sem os espaços das pontas');
    const state = must(await kit.call('/api/state', { session: kit.admin }));
    assert.ok(state.units.some(item => item.id === unit.id) && state.sectors.some(item => item.id === sector.id), 'o Administrador enxerga o que criou');

    const renamed = must(await kit.call('/api/units/leste', { method: 'PATCH', session: kit.admin, body: { name: 'Unidade Leste SP', city: 'Leste' } }));
    assert.deepEqual([renamed.id, renamed.name], ['leste', 'Unidade Leste SP']);
    must(await kit.call('/api/sectors/rh', { method: 'PATCH', session: kit.admin, body: { name: 'Recursos Humanos' } }));

    const mine = must(await kit.call('/api/state', { session: person.session }));
    assert.deepEqual(mine.units.map(item => item.name), ['Unidade Leste SP'], 'a pessoa continua com acesso, agora com o nome novo');
    assert.deepEqual(mine.sectors.map(item => item.name), ['Recursos Humanos']);
    assert.ok(!mine.units.some(item => item.id === unit.id) && !mine.sectors.some(item => item.id === sector.id), 'o que foi criado depois não aparece para quem não recebeu acesso');
    const library = must(await kit.call('/api/library?unitId=leste&sectorId=rh', { session: person.session }));
    assert.ok(library.media.some(item => item.id === media.id), 'o arquivo continua no mesmo espaço depois de renomear');

    const events = must(await kit.call('/api/audit?limit=50', { session: kit.admin })).events;
    for (const [action, name] of [['units.saved', 'Unidade Sorocaba'], ['units.saved', 'Unidade Leste SP'], ['sectors.saved', 'Qualidade'], ['sectors.saved', 'Recursos Humanos']]) {
      assert.ok(events.some(event => event.action === action && event.detail.name === name), `${action} ${name}`);
    }
  });
});

test('só quem tem settings:manage altera unidades e setores (Gestor, Editor e Visualizador recebem 403)', async () => {
  await withApp(async kit => {
    for (const role of ['manager', 'editor', 'viewer']) {
      const { session } = await kit.createUser(role);
      const calls = [
        kit.call('/api/units', { method: 'POST', session, body: { name: `Unidade de ${role}` } }),
        kit.call('/api/sectors', { method: 'POST', session, body: { name: `Setor de ${role}` } }),
        kit.call('/api/units/centro', { method: 'PATCH', session, body: { name: 'Outro nome' } }),
        kit.call('/api/sectors/ti', { method: 'PATCH', session, body: { name: 'Outro nome' } })
      ];
      assert.deepEqual((await Promise.all(calls)).map(response => response.status), [403, 403, 403, 403], role);
    }
    const state = must(await kit.call('/api/state', { session: kit.admin }));
    assert.ok(!state.units.some(item => /^Unidade de /.test(item.name)) && !state.sectors.some(item => /^Setor de /.test(item.name)), 'nada foi criado');
    assert.equal(state.units.find(item => item.id === 'centro').name, 'Unidade Centro', 'nada foi renomeado');
  });
});

test('nome vazio, grande demais ou repetido (sem diferenciar maiúsculas e acentos) é recusado', async () => {
  await withApp(async kit => {
    const post = (kind, body) => kit.call(`/api/${kind}`, { method: 'POST', session: kit.admin, body });
    for (const kind of ['units', 'sectors']) {
      for (const name of [undefined, null, 42, '', '   ', 'x'.repeat(121)]) assert.equal((await post(kind, { name })).status, 400, `${kind} ${JSON.stringify(name)?.slice(0, 20)}`);
    }
    const before = must(await kit.call('/api/state', { session: kit.admin }));
    const leste = before.units.find(item => item.id === 'leste').name;
    for (const name of [leste, leste.toUpperCase(), `  ${leste}  `, leste.replace('Leste', 'Lesté')]) {
      const response = await post('units', { name });
      assert.deepEqual([response.status, response.data.code], [409, 'NAME_TAKEN'], name);
    }
    const sector = must(await kit.call('/api/sectors', { method: 'POST', session: kit.admin, body: { name: 'Manutenção' } }), 201);
    assert.deepEqual([(await post('sectors', { name: 'manutencao' })).status, (await post('sectors', { name: 'MANUTENÇÃO' })).data.code], [409, 'NAME_TAKEN']);

    // Renomear para o nome de OUTRO registro é recusado; mudar só maiúsculas do próprio nome é permitido.
    const clash = await kit.call('/api/units/centro', { method: 'PATCH', session: kit.admin, body: { name: leste } });
    assert.deepEqual([clash.status, clash.data.code], [409, 'NAME_TAKEN']);
    assert.equal(must(await kit.call('/api/units/centro', { method: 'PATCH', session: kit.admin, body: { name: 'UNIDADE CENTRO' } })).name, 'UNIDADE CENTRO');
    assert.equal(must(await kit.call(`/api/sectors/${sector.id}`, { method: 'PATCH', session: kit.admin, body: { name: 'Manutenção' } })).name, 'Manutenção', 'salvar sem mudar o nome não conflita consigo mesmo');

    assert.equal((await kit.call('/api/units/nao-existe', { method: 'PATCH', session: kit.admin, body: { name: 'Qualquer' } })).status, 404);
    assert.equal((await kit.call('/api/sectors/nao-existe', { method: 'PATCH', session: kit.admin, body: { name: 'Qualquer' } })).status, 404);
    const after = must(await kit.call('/api/state', { session: kit.admin }));
    assert.equal(after.units.length, before.units.length, 'as tentativas recusadas não criaram unidade');
    assert.equal(after.sectors.length, before.sectors.length + 1, 'só o setor válido foi criado');
  });
});

test('unidades e setores não podem ser excluídos pela API (o histórico fica ligado a eles)', async () => {
  await withApp(async kit => {
    for (const route of ['/api/units/centro', '/api/sectors/rh']) {
      const response = await kit.call(route, { method: 'DELETE', session: kit.admin });
      assert.ok([404, 405].includes(response.status), `${route}: ${response.status}`);
    }
    const state = must(await kit.call('/api/state', { session: kit.admin }));
    assert.ok(state.units.some(item => item.id === 'centro') && state.sectors.some(item => item.id === 'rh'));
  });
});
