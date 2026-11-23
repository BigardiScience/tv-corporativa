import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withApp, must, makeTempDir, removeTempDir, PASSWORD } from './helpers/app.mjs';
import { sampleFile, uniquePng } from './helpers/http.mjs';

const mediaFiles = kit => readdirSync(path.join(kit.dataDir, 'media'));
const names = items => items.map(item => item.name ?? item.title);

test('pastas: criação em níveis, nomes únicos sem diferenciar acento/caixa, limite de profundidade e validações', async () => {
  await withApp(async kit => {
    const rh = await kit.folder(kit.admin, { name: 'Novembro Azul' });
    assert.match(rh.id, /^[0-9a-f-]{36}$/, 'identificador permanente (UUID)');
    assert.deepEqual([rh.parentId, rh.depth], [null, 1]);
    const video = await kit.folder(kit.admin, { name: 'Vídeos', parentId: rh.id });
    assert.deepEqual([video.parentId, video.depth], [rh.id, 2]);
    // Mesmo nome em outro pai, ou em outro espaço, é permitido; no mesmo lugar não (ignora acento e caixa).
    must(await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: 'Vídeos' } }), 201);
    must(await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'centro', sectorId: 'rh', name: 'Novembro Azul' } }), 201);
    for (const clash of ['videos', 'VÍDEOS', ' Vídeos  ']) {
      const response = await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: clash, parentId: rh.id } });
      assert.equal(response.status, 409, clash);
      assert.equal(response.data.code, 'NAME_CONFLICT');
    }
    // Validações.
    for (const bad of ['', '   ', 'a/b', 'a\\b', 'x'.repeat(121), 'sino\u0007nome', 'nulo\u0000nome', 'del\u007fnome', '..', '.', 42, null]) {
      assert.equal((await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: bad } })).status, 400, JSON.stringify(bad));
    }
    // Tabulação e espaços repetidos não são "caracteres proibidos": viram um único espaço.
    assert.equal(must(await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: '  Duas\t\t palavras  ' } }), 201).name, 'Duas palavras');
    // Unidade/setor que não existem na organização.
    const unknownSector = await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'inexistente', name: 'X' } });
    assert.deepEqual([unknownSector.status, unknownSector.data.error], [400, 'Unidade ou setor inválido.']);
    assert.equal((await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'leste', sectorId: 'rh', name: 'Filha', parentId: 'nao-existe' } })).status, 404);
    // Até 8 níveis.
    let parent = null;
    for (let level = 1; level <= 8; level++) parent = await kit.folder(kit.admin, { name: `Nível ${level}`, parentId: parent?.id, unitId: 'oeste', sectorId: 'ti' });
    assert.equal(parent.depth, 8);
    const tooDeep = await kit.call('/api/folders', { method: 'POST', session: kit.admin, body: { unitId: 'oeste', sectorId: 'ti', name: 'Nível 9', parentId: parent.id } });
    assert.deepEqual([tooDeep.status, tooDeep.data.code], [400, 'FOLDER_DEPTH']);
  });
});

test('pastas: renomear e mover mantêm o identificador; ciclos, profundidade, conflitos e outro espaço são recusados', async () => {
  await withApp(async kit => {
    const a = await kit.folder(kit.admin, { name: 'A' });
    const b = await kit.folder(kit.admin, { name: 'B', parentId: a.id });
    const c = await kit.folder(kit.admin, { name: 'C', parentId: b.id });
    const other = await kit.folder(kit.admin, { name: 'Outra' });
    const patch = (id, body) => kit.call(`/api/folders/${id}`, { method: 'PATCH', session: kit.admin, body });

    const renamed = must(await patch(b.id, { name: 'Bê' }));
    assert.deepEqual([renamed.id, renamed.name, renamed.parentId], [b.id, 'Bê', a.id]);
    assert.equal((await patch(b.id, { name: 'a' })).status === 200, true, 'nome igual ao de OUTRO nível é permitido');
    must(await patch(b.id, { name: 'Bê' }));
    // Mover com a subárvore: caminhos e níveis dos descendentes são recalculados.
    const moved = must(await patch(a.id, { parentId: other.id }));
    assert.deepEqual([moved.id, moved.parentId, moved.depth], [a.id, other.id, 2]);
    const rows = Object.fromEntries(kit.app.db.prepare('SELECT id, depth, path FROM folders').all().map(r => [r.id, r]));
    assert.deepEqual([rows[b.id].depth, rows[c.id].depth], [3, 4]);
    assert.equal(rows[c.id].path, `/${other.id}/${a.id}/${b.id}/${c.id}/`);
    const crumbs = must(await kit.call(`/api/library?unitId=leste&sectorId=rh&folderId=${c.id}`, { session: kit.admin })).breadcrumbs;
    assert.deepEqual(crumbs.map(x => x.name), ['Outra', 'A', 'Bê', 'C']);
    // Ciclos.
    for (const [id, target] of [[a.id, a.id], [other.id, c.id], [other.id, b.id], [a.id, c.id]]) {
      const response = await patch(id, { parentId: target });
      assert.deepEqual([response.status, response.data.code], [400, 'FOLDER_CYCLE'], `${id} → ${target}`);
    }
    // Para a raiz.
    assert.equal(must(await patch(c.id, { parentId: null })).parentId, null);
    // Conflito de nome no destino.
    await kit.folder(kit.admin, { name: 'Bê', parentId: other.id });
    assert.equal((await patch(b.id, { parentId: other.id })).status, 409);
    // Profundidade: subárvore que passaria de 8 níveis não pode ser movida.
    let deep = null;
    for (let level = 1; level <= 7; level++) deep = await kit.folder(kit.admin, { name: `P${level}`, parentId: deep?.id, unitId: 'norte', sectorId: 'ti' });
    const group = await kit.folder(kit.admin, { name: 'Grupo', unitId: 'norte', sectorId: 'ti' });
    await kit.folder(kit.admin, { name: 'Filho', parentId: group.id, unitId: 'norte', sectorId: 'ti' });
    assert.equal((await patch(group.id, { parentId: deep.id })).data.code, 'FOLDER_DEPTH');
    // Nada acontece de forma parcial: renomear + mover inválido não renomeia.
    const before = rows[a.id];
    assert.equal((await patch(a.id, { name: 'Novo nome', parentId: a.id })).status, 400);
    assert.equal(kit.app.db.prepare('SELECT name FROM folders WHERE id=?').get(a.id).name, 'A');
    assert.equal(before.id, a.id);
  });
});

test('arquivos: envio para pasta, títulos únicos, duplicados, renomear, mover e validações do conteúdo', async () => {
  await withApp(async kit => {
    const folder = await kit.folder(kit.admin, { name: 'Cartazes' });
    const first = await kit.upload(kit.admin, { folderId: folder.id, name: 'aviso.png', title: 'Aviso', seed: 'um' });
    assert.deepEqual([first.folderId, first.status, first.kind, first.title, first.type], [folder.id, 'pending', 'image', 'Aviso', 'image/png']);
    assert.match(first.sha256, /^[0-9a-f]{64}$/);
    // Mesmo título na mesma pasta com conteúdo diferente: acrescenta (2), (3)…
    const second = await kit.upload(kit.admin, { folderId: folder.id, name: 'aviso.png', title: 'Aviso', seed: 'dois' });
    const third = await kit.upload(kit.admin, { folderId: folder.id, name: 'aviso.png', title: 'Aviso', seed: 'tres' });
    assert.deepEqual([second.title, third.title], ['Aviso (2)', 'Aviso (3)']);
    const named = await kit.upload(kit.admin, { folderId: folder.id, name: 'logo.png', seed: 'logo' });
    const namedAgain = await kit.upload(kit.admin, { folderId: folder.id, name: 'logo.png', seed: 'logo2' });
    assert.deepEqual([named.title, namedAgain.title], ['logo.png', 'logo (2).png']);
    // Conteúdo idêntico no mesmo espaço = duplicado; só entra se a pessoa confirmar.
    const duplicate = await kit.call(`/api/media?name=copia.png&unitId=leste&sectorId=rh`, { method: 'POST', session: kit.admin, body: uniquePng('um') });
    assert.deepEqual([duplicate.status, duplicate.data.code, duplicate.data.details.existing.id], [409, 'DUPLICATE_MEDIA', first.id]);
    assert.equal(mediaFiles(kit).length, 5, 'duplicado recusado não deixa arquivo no disco');
    const confirmed = await kit.upload(kit.admin, { name: 'copia.png', seed: 'um', duplicate: 'allow' });
    assert.equal(confirmed.sha256, first.sha256);
    // Em outro espaço, o mesmo conteúdo não é duplicado.
    await kit.upload(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'outro.png', seed: 'um' });

    // Renomear e mover.
    const renamed = must(await kit.call(`/api/media/${first.id}`, { method: 'PATCH', session: kit.admin, body: { title: 'Aviso importante' } }));
    assert.deepEqual([renamed.id, renamed.title, renamed.name], [first.id, 'Aviso importante', 'aviso.png']);
    assert.equal((await kit.call(`/api/media/${second.id}`, { method: 'PATCH', session: kit.admin, body: { title: 'aviso importante' } })).status, 409, 'conflito ignora caixa');
    const moved = must(await kit.call(`/api/media/${first.id}`, { method: 'PATCH', session: kit.admin, body: { folderId: null } }));
    assert.equal(moved.folderId, null);
    assert.equal((await kit.call(`/api/media/${second.id}`, { method: 'PATCH', session: kit.admin, body: { folderId: 'inexistente' } })).status, 404);
    for (const title of ['', 'a/b', 'x'.repeat(121)]) assert.equal((await kit.call(`/api/media/${second.id}`, { method: 'PATCH', session: kit.admin, body: { title } })).status, 400, JSON.stringify(title));
    const detail = must(await kit.call(`/api/media/${second.id}`, { session: kit.admin }));
    assert.deepEqual(detail.folderPath, ['Cartazes']);
    assert.deepEqual(detail.usage, { playlists: [], schedules: [], versions: 0 });
  });
});

test('arquivos: validações herdadas da 1.1.0 (formato, assinatura, tamanho, escopo) sem deixar arquivo órfão', async () => {
  await withApp(async kit => {
    const png = uniquePng('valido');
    const post = (query, body = png, session = kit.admin) => kit.call(`/api/media?${query}`, { method: 'POST', session, body });
    assert.equal((await post('name=evil.html&unitId=leste&sectorId=rh')).status, 415);
    assert.equal((await post('name=macro.pptx&unitId=leste&sectorId=rh')).status, 415);
    assert.equal((await post('name=fake.png&unitId=leste&sectorId=rh', Buffer.from('not png'))).status, 415);
    assert.equal((await post('name=pdf-disfarçado.png&unitId=leste&sectorId=rh', sampleFile('.pdf'))).status, 415, 'assinatura de outro formato');
    assert.equal((await post('name=vazio.png&unitId=leste&sectorId=rh', Buffer.alloc(0))).status, 415);
    assert.equal((await post(`name=valid.png&title=${'a'.repeat(121)}&unitId=leste&sectorId=rh`)).status, 400);
    assert.equal((await post('name=a%2Fb.png&unitId=leste&sectorId=rh')).status, 400);
    assert.equal((await post('name=ok.png&unitId=leste&sectorId=nao-existe')).status, 400);
    assert.equal((await post('name=ok.png')).status, 400);
    assert.equal(mediaFiles(kit).length, 0, 'nenhum arquivo órfão');
    const editor = await kit.createUser('editor');
    assert.equal((await post('name=demo.png&unitId=centro&sectorId=rh', png, editor.session)).status, 403);
    assert.equal((await post('name=demo.png&unitId=leste&sectorId=rh', png, editor.session)).status, 201);
    // Todos os formatos aceitos, cada um com sua assinatura.
    for (const extension of ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.mp4', '.mov', '.webm']) {
      const item = await kit.upload(kit.admin, { name: `exemplo${extension}`, bytes: sampleFile(extension === '.jpeg' ? '.jpg' : extension, `s${extension}`) });
      assert.equal(item.name, `exemplo${extension}`);
    }
  });
});

test('arquivos: limite de tamanho do envio (413) e verificação antimalware (produção exige varredura)', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTempDir('tvcorp-scan-');
  try {
    const clean = path.join(dir, 'scanner-limpo.sh'), infected = path.join(dir, 'scanner-infectado.sh');
    writeFileSync(clean, '#!/bin/sh\nexit 0\n'); writeFileSync(infected, '#!/bin/sh\nexit 1\n');
    chmodSync(clean, 0o755); chmodSync(infected, 0o755);
    await withApp(async kit => {
      const big = Buffer.concat([uniquePng('grande'), Buffer.alloc(20 * 1024, 1)]);
      assert.equal((await kit.call('/api/media?name=grande.png&unitId=leste&sectorId=rh', { method: 'POST', session: kit.admin, body: big })).status, 413);
      assert.equal(mediaFiles(kit).length, 0);
    }, { maxUpload: 0.01 });
    await withApp(async kit => {
      const item = await kit.upload(kit.admin, { name: 'limpo.png' });
      assert.equal(item.scanStatus, 'clean');
      // Em produção, só aprova quem foi varrido e dispensa a confirmação "sem antivírus".
      assert.equal(must(await kit.call(`/api/media/${item.id}/approve`, { method: 'POST', session: kit.admin, body: {} })).status, 'approved');
      kit.app.db.prepare("UPDATE media SET scan_status='not_configured', status='pending' WHERE id=?").run(item.id);
      assert.equal((await kit.call(`/api/media/${item.id}/approve`, { method: 'POST', session: kit.admin, body: { acknowledgeUnscanned: true } })).status, 409, 'produção ignora a confirmação local');
    }, { production: true, origin: 'https://tv.example.test', scanner: clean });
    await withApp(async kit => {
      const refused = await kit.call('/api/media?name=virus.png&unitId=leste&sectorId=rh', { method: 'POST', session: kit.admin, body: uniquePng('virus') });
      assert.equal(refused.status, 422);
      assert.equal(mediaFiles(kit).length, 0, 'arquivo reprovado é apagado');
      const events = must(await kit.call('/api/audit', { session: kit.admin })).events;
      assert.ok(events.some(e => e.action === 'media.scan.failed'));
    }, { production: true, origin: 'https://tv.example.test', scanner: infected });
  } finally { removeTempDir(dir, 'tvcorp-scan-'); }
});

test('biblioteca: navegação, subpastas com contagem, pesquisa, filtros, ordenação e paginação', async () => {
  await withApp(async kit => {
    const rh = await kit.folder(kit.admin, { name: 'RH' });
    const nov = await kit.folder(kit.admin, { name: 'Novembro Azul', parentId: rh.id });
    const set = await kit.folder(kit.admin, { name: 'Setembro Amarelo', parentId: rh.id });
    const a = await kit.upload(kit.admin, { folderId: nov.id, name: 'cartaz-azul.png', title: 'Cartaz azul', seed: 'a' });
    const b = await kit.upload(kit.admin, { folderId: nov.id, name: 'treinamento.mp4', title: 'Treinamento', bytes: sampleFile('.mp4', 'b'.repeat(500)) });
    const c = await kit.upload(kit.admin, { folderId: set.id, name: 'orientações.pdf', title: 'Orientações de saúde', bytes: sampleFile('.pdf', 'c'.repeat(50)) });
    const d = await kit.upload(kit.admin, { name: 'raiz.png', title: 'Logotipo na raiz', seed: 'd' });
    await kit.approve(kit.admin, a.id);
    const list = query => kit.call(`/api/library?unitId=leste&sectorId=rh${query ? `&${query}` : ''}`, { session: kit.admin });

    const root = must(await list());
    assert.deepEqual(root.folders.map(f => [f.name, f.childFolders, f.mediaCount]), [['RH', 2, 0]]);
    assert.deepEqual(root.media.map(m => m.title), ['Logotipo na raiz']);
    assert.deepEqual([root.breadcrumbs, root.folder, root.total], [[], null, 1]);
    const level2 = must(await list(`folderId=${rh.id}`));
    assert.deepEqual(level2.folders.map(f => [f.name, f.mediaCount]), [['Novembro Azul', 2], ['Setembro Amarelo', 1]]);
    assert.deepEqual(level2.breadcrumbs.map(x => x.name), ['RH']);

    // Pesquisa: dentro da pasta (e subpastas) ou no espaço todo; sem diferenciar acento/caixa.
    assert.deepEqual(must(await list(`q=ORIENTACOES`)).media.map(m => m.id), [c.id]);
    assert.deepEqual(must(await list(`q=orienta%C3%A7%C3%B5es&folderId=${nov.id}`)).media.map(m => m.id), [], 'dentro de outra pasta não encontra');
    assert.deepEqual(must(await list(`q=orienta&folderId=${nov.id}&search=space`)).media.map(m => m.id), [c.id]);
    const found = must(await list(`q=cartaz&folderId=${rh.id}`));
    assert.deepEqual([found.media.map(m => m.id), found.media[0].folderPath], [[a.id], ['RH', 'Novembro Azul']]);
    assert.deepEqual(must(await list('q=novembro')).folders.map(f => [f.name, f.parents]), [['Novembro Azul', ['RH']]]);
    assert.deepEqual(must(await list('q=%25')).media, [], 'curinga % é tratado como texto');
    assert.equal(must(await list('q=_')).total, 0);
    // Filtros.
    assert.deepEqual(must(await list(`q=a&type=video`)).media.map(m => m.id), [b.id]);
    assert.deepEqual(must(await list(`q=%20&type=pdf`)).media, [], 'busca em branco volta a navegar na raiz');
    assert.deepEqual(must(await list(`folderId=${nov.id}&status=approved`)).media.map(m => m.id), [a.id]);
    assert.deepEqual(must(await list(`folderId=${nov.id}&status=pending`)).media.map(m => m.id), [b.id]);
    assert.deepEqual(must(await list(`folderId=${nov.id}&type=image`)).folders, [], 'com filtro, pastas somem');
    // Ordenação.
    const sorted = async (sort, order) => must(await list(`folderId=${nov.id}&sort=${sort}&order=${order}`)).media.map(m => m.id);
    assert.deepEqual(await sorted('name', 'asc'), [a.id, b.id]);
    assert.deepEqual(await sorted('name', 'desc'), [b.id, a.id]);
    assert.deepEqual(await sorted('size', 'desc'), [b.id, a.id]);
    assert.deepEqual(await sorted('type', 'asc'), [a.id, b.id], 'image/png antes de video/mp4');
    kit.app.db.prepare("UPDATE media SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(b.id);
    assert.deepEqual(await sorted('date', 'asc'), [b.id, a.id]);
    // Paginação.
    for (let i = 0; i < 7; i++) await kit.upload(kit.admin, { name: `p${i}.png`, title: `Pagina ${String(i).padStart(2, '0')}`, seed: `pagina${i}`, folderId: set.id });
    const page1 = must(await list(`folderId=${set.id}&limit=3&offset=0`)), page2 = must(await list(`folderId=${set.id}&limit=3&offset=3`)), page3 = must(await list(`folderId=${set.id}&limit=3&offset=6`));
    assert.deepEqual([page1.total, page1.media.length, page2.media.length, page3.media.length], [8, 3, 3, 2]);
    assert.equal(new Set([...page1.media, ...page2.media, ...page3.media].map(m => m.id)).size, 8);
    assert.equal(page2.folders.length, 0, 'pastas só na primeira página');
    // Parâmetros inválidos.
    for (const query of ['sort=cor', 'order=lado', 'type=zip', 'status=x', 'limit=0', 'limit=1000', 'offset=-1', 'folderId=nao-existe']) assert.ok((await list(query)).status >= 400, query);
    // Pasta de OUTRO espaço (adulterando o identificador) não pode ser navegada: 404, sem revelar que existe.
    const foreign = await kit.call(`/api/library?unitId=centro&sectorId=rh&folderId=${rh.id}`, { session: kit.admin });
    assert.deepEqual([foreign.status, foreign.data.code ?? null], [404, null]);
    assert.deepEqual(root.media.map(m => m.id), [d.id]);
  });
});

test('biblioteca: lista plana (flat=1) mostra tudo da pasta e subpastas, ou do espaço, sem pastas e com o caminho de cada arquivo', async () => {
  await withApp(async kit => {
    const rh = await kit.folder(kit.admin, { name: 'RH' });
    const nov = await kit.folder(kit.admin, { name: 'Novembro Azul', parentId: rh.id });
    const outra = await kit.folder(kit.admin, { name: 'Outra' });
    const raiz = await kit.upload(kit.admin, { name: 'raiz.png', title: 'Na raiz', seed: 'flat-raiz' });
    const dentro = await kit.upload(kit.admin, { folderId: nov.id, name: 'dentro.png', title: 'Dentro', seed: 'flat-dentro' });
    const lateral = await kit.upload(kit.admin, { folderId: outra.id, name: 'lateral.png', title: 'Lateral', seed: 'flat-lateral' });
    await kit.approve(kit.admin, dentro.id);
    const list = query => kit.call(`/api/library?unitId=leste&sectorId=rh&${query}`, { session: kit.admin });

    // Sem flat, a raiz mostra só o primeiro nível (comportamento de navegação).
    assert.deepEqual(must(await list('')).media.map(m => m.id), [raiz.id]);
    // Com flat, na raiz: o espaço inteiro, sem pastas, com o caminho de cada arquivo.
    const everything = must(await list('flat=1&sort=name'));
    assert.deepEqual(everything.media.map(m => m.id).sort(), [raiz.id, dentro.id, lateral.id].sort());
    assert.deepEqual(everything.folders, [], 'a lista plana não mostra pastas');
    assert.equal(everything.query.flat, true);
    const paths = Object.fromEntries(everything.media.map(m => [m.title, m.folderPath]));
    assert.deepEqual(paths, { 'Na raiz': [], Dentro: ['RH', 'Novembro Azul'], Lateral: ['Outra'] });
    // Filtro de situação vale para todas as pastas: é o que alimenta o aviso de "aguardando aprovação".
    const pending = must(await list('flat=1&status=pending&limit=1'));
    assert.deepEqual([pending.total, pending.media.length], [2, 1]);
    assert.deepEqual(must(await list('flat=1&status=approved')).media.map(m => m.id), [dentro.id]);
    // Dentro de uma pasta: ela e suas subpastas, nada de fora.
    assert.deepEqual(must(await list(`flat=1&folderId=${rh.id}`)).media.map(m => m.id), [dentro.id]);
    assert.deepEqual(must(await list(`flat=1&folderId=${outra.id}`)).media.map(m => m.id), [lateral.id]);
    // flat=0 e valores estranhos não ligam o modo plano; pesquisa continua plana por natureza.
    assert.equal(must(await list('flat=0')).query.flat, false);
    assert.equal(must(await list('flat=sim')).query.flat, false);
    assert.equal(must(await list('q=dentro')).query.flat, true);

    // O escopo continua valendo: quem não tem o espaço não lista nada, nem em modo plano.
    const outsider = await kit.createUser('editor', { unitIds: ['centro'], sectorIds: ['ti'] });
    assert.equal((await kit.call('/api/library?unitId=leste&sectorId=rh&flat=1', { session: outsider.session })).status, 403);
    const partial = await kit.createUser('editor', { unitIds: ['leste'], sectorIds: ['rh'] });
    assert.equal(must(await kit.call('/api/library?unitId=leste&sectorId=rh&flat=1', { session: partial.session })).media.length, 3);
    assert.equal((await kit.call('/api/library?unitId=leste&sectorId=ti&flat=1', { session: partial.session })).status, 403);
  });
});

test('mover arquivos e pastas NÃO quebra playlists nem programações; excluir é bloqueado enquanto estiver no ar', async () => {
  await withApp(async kit => {
    const origem = await kit.folder(kit.admin, { name: 'Origem' }), destino = await kit.folder(kit.admin, { name: 'Destino' });
    const media = await kit.approvedMedia(kit.admin, { folderId: origem.id, title: 'Cartaz' });
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    const tv = await kit.pairedDisplay(kit.admin);
    const schedule = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    const manifestIds = async () => must(await kit.call('/api/player/manifest', { token: tv.token })).items.map(i => i.id);
    assert.deepEqual(await manifestIds(), [media.id]);

    must(await kit.call(`/api/media/${media.id}`, { method: 'PATCH', session: kit.admin, body: { folderId: destino.id } }));
    assert.deepEqual(await manifestIds(), [media.id], 'arquivo movido continua na TV');
    must(await kit.call(`/api/folders/${destino.id}`, { method: 'PATCH', session: kit.admin, body: { parentId: origem.id, name: 'Destino renomeado' } }));
    assert.deepEqual(await manifestIds(), [media.id], 'pasta movida/renomeada continua na TV');
    const detail = must(await kit.call(`/api/playlists/${playlist.id}`, { session: kit.admin }));
    assert.deepEqual(detail.items.map(i => [i.mediaId, i.media.folderId]), [[media.id, destino.id]]);
    assert.equal(must(await kit.call(`/api/schedules/${schedule.id}`, { session: kit.admin })).state, 'live');

    // Indicador de uso na biblioteca e proteção contra exclusão.
    const listed = must(await kit.call(`/api/library?unitId=leste&sectorId=rh&folderId=${destino.id}`, { session: kit.admin })).media[0];
    assert.deepEqual(listed.usage, { playlists: 1, schedules: 1, liveSchedules: 1, versions: 1 });
    const blocked = await kit.call(`/api/media/${media.id}`, { method: 'DELETE', session: kit.admin });
    assert.deepEqual([blocked.status, blocked.data.code], [409, 'MEDIA_IN_USE']);
    assert.deepEqual(blocked.data.details.schedules.map(s => s.id), [schedule.id]);
    assert.deepEqual(blocked.data.details.playlists.map(p => p.id), [playlist.id]);
    const folderBlocked = await kit.call(`/api/folders/${origem.id}?recursive=1`, { method: 'DELETE', session: kit.admin });
    assert.deepEqual([folderBlocked.status, folderBlocked.data.code], [409, 'MEDIA_IN_USE']);
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM folders').get().n, 2, 'nada foi excluído');
    assert.equal(mediaFiles(kit).length, 1);

    // Interrompida a programação e retirado o item do rascunho, o arquivo pode ser excluído e o histórico segue legível.
    must(await kit.call(`/api/schedules/${schedule.id}/stop`, { method: 'POST', session: kit.admin }));
    assert.equal((await kit.call(`/api/media/${media.id}`, { method: 'DELETE', session: kit.admin })).status, 409, 'ainda está no rascunho da playlist');
    const current = must(await kit.call(`/api/playlists/${playlist.id}`, { session: kit.admin }));
    must(await kit.call(`/api/playlists/${playlist.id}`, { method: 'PATCH', session: kit.admin, body: { items: [], rev: current.draftRev } }));
    must(await kit.call(`/api/media/${media.id}`, { method: 'DELETE', session: kit.admin }));
    assert.equal(mediaFiles(kit).length, 0, 'arquivo removido do disco');
    const history = must(await kit.call(`/api/playlists/${playlist.id}/versions/1`, { session: kit.admin }));
    assert.deepEqual(history.items.map(i => [i.media.title, i.mediaId, i.readiness]), [['Cartaz', null, 'deleted']]);
    // Programação parada que apontava para a versão antiga não pode voltar ao ar com conteúdo apagado.
    const republish = await kit.call(`/api/schedules/${schedule.id}/publish`, { method: 'POST', session: kit.admin, body: {} });
    assert.deepEqual([republish.status, republish.data.code], [409, 'MEDIA_NOT_READY']);
  });
});

test('excluir pasta: confirmação para pasta não vazia, exclusão em cascata e tudo-ou-nada', async () => {
  await withApp(async kit => {
    const empty = await kit.folder(kit.admin, { name: 'Vazia' });
    must(await kit.call(`/api/folders/${empty.id}`, { method: 'DELETE', session: kit.admin }));
    assert.equal((await kit.call(`/api/folders/${empty.id}`, { session: kit.admin })).status, 404);

    const root = await kit.folder(kit.admin, { name: 'Raiz' }), child = await kit.folder(kit.admin, { name: 'Filha', parentId: root.id });
    await kit.upload(kit.admin, { folderId: root.id, name: 'um.png' });
    await kit.upload(kit.admin, { folderId: child.id, name: 'dois.png' });
    const needs = await kit.call(`/api/folders/${root.id}`, { method: 'DELETE', session: kit.admin });
    assert.deepEqual([needs.status, needs.data.code, needs.data.details], [409, 'FOLDER_NOT_EMPTY', { folders: 1, media: 2 }]);
    assert.equal(mediaFiles(kit).length, 2);
    const editor = await kit.createUser('editor');
    assert.equal((await kit.call(`/api/folders/${root.id}?recursive=1`, { method: 'DELETE', session: editor.session })).status, 403);
    const done = must(await kit.call(`/api/folders/${root.id}?recursive=1`, { method: 'DELETE', session: kit.admin }));
    assert.deepEqual(done.deleted, { folders: 2, media: 2 });
    assert.equal(mediaFiles(kit).length, 0);
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM folders').get().n, 0);
    const events = must(await kit.call('/api/audit?limit=50', { session: kit.admin })).events.map(e => e.action);
    assert.ok(['folder.deleted', 'media.deleted'].every(action => events.includes(action)));
    assert.equal((await kit.call('/api/folders/inexistente', { method: 'DELETE', session: kit.admin })).status, 404);
  });
});

test('ações em lote são tudo-ou-nada: mover, excluir, aprovar e rejeitar', async () => {
  await withApp(async kit => {
    const a = await kit.folder(kit.admin, { name: 'A' }), b = await kit.folder(kit.admin, { name: 'B' }), inside = await kit.folder(kit.admin, { name: 'Dentro de A', parentId: a.id });
    const m1 = await kit.upload(kit.admin, { name: 'm1.png' }), m2 = await kit.upload(kit.admin, { name: 'm2.png' }), m3 = await kit.upload(kit.admin, { name: 'm3.png' });
    const batch = body => kit.call('/api/library/batch', { method: 'POST', session: kit.admin, body });
    // Mover vários de uma vez (arquivos e pastas juntos).
    const moved = must(await batch({ action: 'move', mediaIds: [m1.id, m2.id], folderIds: [a.id], targetFolderId: b.id }));
    assert.deepEqual([moved.media, moved.folders], [2, 1]);
    assert.equal(kit.app.db.prepare('SELECT folder_id FROM media WHERE id=?').get(m1.id).folder_id, b.id);
    assert.equal(kit.app.db.prepare('SELECT parent_id FROM folders WHERE id=?').get(a.id).parent_id, b.id);
    // m4 nasce na raiz DEPOIS de m1 sair de lá, então mantém o título "m1.png" e colide com m1 no destino.
    const m4 = await kit.upload(kit.admin, { name: 'outro.png', title: 'm1.png' });
    assert.equal(m4.title, 'm1.png');
    // Um item inválido derruba o lote inteiro: m3 (válido) também NÃO é movido.
    const snapshot = () => kit.app.db.prepare('SELECT id, folder_id FROM media ORDER BY id').all().map(r => [r.id, r.folder_id]);
    const before = snapshot();
    const failed = await batch({ action: 'move', mediaIds: [m3.id, m4.id], targetFolderId: b.id });
    assert.deepEqual([failed.status, failed.data.code], [409, 'NAME_CONFLICT']);
    assert.deepEqual(snapshot(), before, 'nenhum item do lote foi movido');
    assert.equal((await batch({ action: 'move', folderIds: [b.id], targetFolderId: inside.id })).status, 400, 'ciclo');
    assert.equal((await batch({ action: 'move', mediaIds: [m3.id], targetFolderId: 'nao-existe' })).status, 404);
    assert.equal((await batch({ action: 'move', mediaIds: [] })).status, 400);
    assert.equal((await batch({ action: 'explodir', mediaIds: [m1.id] })).status, 400);
    assert.equal((await batch({ action: 'move', mediaIds: Array.from({ length: 201 }, (_, i) => `id${i}`) })).status, 400);
    assert.equal((await batch({ action: 'approve', folderIds: [a.id] })).status, 400, 'aprovar só se aplica a arquivos');
    assert.deepEqual(snapshot(), before);
    // Aprovar / rejeitar em lote.
    assert.equal((await batch({ action: 'approve', mediaIds: [m1.id, m2.id] })).status, 409, 'sem confirmação de varredura local');
    assert.equal(kit.app.db.prepare("SELECT COUNT(*) AS n FROM media WHERE status='approved'").get().n, 0);
    must(await batch({ action: 'approve', mediaIds: [m1.id, m2.id], acknowledgeUnscanned: true }));
    assert.deepEqual(kit.app.db.prepare('SELECT status FROM media').all().map(r => r.status).sort(), ['approved', 'approved', 'pending', 'pending']);
    must(await batch({ action: 'reject', mediaIds: [m1.id] }));
    assert.equal(kit.app.db.prepare('SELECT status FROM media WHERE id=?').get(m1.id).status, 'rejected');
    // Excluir: pasta não vazia exige confirmação; arquivo em uso bloqueia o lote inteiro.
    assert.equal((await batch({ action: 'delete', folderIds: [b.id] })).status, 409);
    const playlist = await kit.playlist(kit.admin, { items: [{ mediaId: m2.id }] });
    const blocked = await batch({ action: 'delete', mediaIds: [m1.id, m2.id] });
    assert.deepEqual([blocked.status, blocked.data.code], [409, 'MEDIA_IN_USE']);
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n, 4, 'm1 (livre) também foi preservado');
    assert.equal(mediaFiles(kit).length, 4);
    must(await kit.call(`/api/playlists/${playlist.id}`, { method: 'DELETE', session: kit.admin }));
    const deleted = must(await batch({ action: 'delete', folderIds: [b.id], mediaIds: [m3.id, m4.id], recursive: true }));
    assert.deepEqual(deleted.deleted, { folders: 3, media: 4 });
    assert.equal(mediaFiles(kit).length, 0);
    // Itens de unidades/setores diferentes não podem ir no mesmo lote (nem mover, nem excluir).
    const here = await kit.upload(kit.admin, { name: 'aqui.png' }), there = await kit.upload(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'la.png' });
    for (const action of ['move', 'delete']) {
      const mixed = await batch({ action, mediaIds: [here.id, there.id], targetFolderId: null });
      assert.deepEqual([mixed.status, mixed.data.code], [400, 'SCOPE_MISMATCH'], action);
    }
    assert.equal(kit.app.db.prepare('SELECT COUNT(*) AS n FROM media WHERE id IN (?,?)').get(here.id, there.id).n, 2);
    // Permissão por item: Editor não exclui nem aprova, mas organiza (mover).
    const editor = await kit.createUser('editor'), extra = await kit.upload(kit.admin, { name: 'x.png' });
    const asEditor = body => kit.call('/api/library/batch', { method: 'POST', session: editor.session, body });
    assert.equal((await asEditor({ action: 'delete', mediaIds: [extra.id] })).status, 403);
    assert.equal((await asEditor({ action: 'approve', mediaIds: [extra.id], acknowledgeUnscanned: true })).status, 403);
    assert.equal((await asEditor({ action: 'move', mediaIds: [extra.id], targetFolderId: null })).status, 200);
  });
});

test('entrega de arquivos: Range, ETag/304, escopo e credencial da TV', async () => {
  await withApp(async kit => {
    const media = await kit.approvedMedia(kit.admin, { name: 'video.mp4', bytes: sampleFile('.mp4', 'conteudo-do-video-0123456789') });
    const bytes = sampleFile('.mp4', 'conteudo-do-video-0123456789');
    const file = (headers = {}, extra = {}) => kit.call(`/api/media/${media.id}/file`, { session: kit.admin, headers, ...extra });
    const whole = await file();
    assert.equal(whole.status, 200);
    assert.deepEqual([whole.headers.get('content-type'), whole.headers.get('accept-ranges'), Number(whole.headers.get('content-length'))], ['video/mp4', 'bytes', bytes.length]);
    assert.ok(whole.bytes.equals(bytes));
    assert.equal(whole.headers.get('etag'), `"${createHash('sha256').update(bytes).digest('hex')}"`);
    assert.equal((await file({ 'If-None-Match': whole.headers.get('etag') })).status, 304);
    const range = await file({ Range: 'bytes=2-9' });
    assert.deepEqual([range.status, range.headers.get('content-range'), range.bytes.equals(bytes.subarray(2, 10))], [206, `bytes 2-9/${bytes.length}`, true]);
    const open = await file({ Range: `bytes=${bytes.length - 4}-` });
    assert.ok(open.bytes.equals(bytes.subarray(-4)));
    const suffix = await file({ Range: 'bytes=-5' });
    assert.ok(suffix.bytes.equals(bytes.subarray(-5)));
    assert.equal((await file({ Range: `bytes=${bytes.length + 10}-` })).status, 416);
    assert.equal((await file({ Range: 'bytes=abc' })).status, 200, 'Range malformado é ignorado');
    assert.equal((await kit.call(`/api/media/${media.id}/file`)).status, 401);
    assert.equal((await kit.call('/api/media/inexistente/file', { session: kit.admin })).status, 404);
    assert.equal((await kit.call(`/api/media/${media.id}/file`, { token: 'token-invalido' })).status, 401);
    // A TV só baixa o que está na programação ativa dela.
    const tv = await kit.pairedDisplay(kit.admin);
    assert.equal((await kit.call(`/api/media/${media.id}/file`, { token: tv.token })).status, 403);
    const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    assert.equal((await kit.call(`/api/media/${media.id}/file`, { token: tv.token })).status, 200);
    const partial = await kit.call(`/api/media/${media.id}/file`, { token: tv.token, headers: { Range: 'bytes=0-3' } });
    assert.equal(partial.status, 206);
    // Arquivo sumiu do disco: resposta clara, sem derrubar o servidor.
    for (const name of mediaFiles(kit)) await import('node:fs').then(fs => fs.unlinkSync(path.join(kit.dataDir, 'media', name)));
    assert.equal((await file()).status, 404);
  });
});

test('PASSWORD de teste não é credencial real e não aparece em respostas', async () => {
  await withApp(async kit => {
    const everything = JSON.stringify([
      must(await kit.call('/api/users', { session: kit.admin })), must(await kit.call('/api/state', { session: kit.admin })), must(await kit.call('/api/audit?limit=500', { session: kit.admin }))
    ]);
    assert.ok(!everything.includes(PASSWORD) && !everything.includes('scrypt') && !/"password"/.test(everything));
    assert.ok(!existsSync(path.join(kit.dataDir, 'senha.txt')));
  });
});
