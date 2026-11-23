// Formatos de envio (PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM, PDF) pela API: tipo, caixa das extensões, JPG = JPEG, arquivos renomeados,
// inválidos ou incompletos, entrega à TV somente depois da aprovação (e da varredura, em produção) e arquivos já cadastrados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withApp, must, makeTempDir, removeTempDir, writeScanner } from './helpers/app.mjs';
import { sampleFile, uniquePng } from './helpers/http.mjs';
import { JPEG, buildMov } from './helpers/media-files.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url));
const mediaFiles = kit => readdirSync(path.join(kit.dataDir, 'media'));
const mediaRows = kit => kit.app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
const post = (kit, name, body, { session = kit.admin, headers = {}, query = {} } = {}) =>
  kit.call(`/api/media?${new URLSearchParams({ unitId: 'leste', sectorId: 'rh', name, ...query })}`, { method: 'POST', session, body, headers });

test('formatos: os oito formatos, em maiúsculas ou minúsculas, entram com o tipo e a categoria definidos pelo servidor', async () => {
  await withApp(async kit => {
    const image = 'image', video = 'video';
    const cases = [
      ['logo.png', '.png', 'image/png', image], ['LOGO.PNG', '.png', 'image/png', image],
      ['foto.jpg', '.jpg', 'image/jpeg', image], ['FOTO.JPG', '.jpg', 'image/jpeg', image],
      ['foto.jpeg', '.jpg', 'image/jpeg', image], ['FOTO.JPEG', '.jpg', 'image/jpeg', image], ['Foto.JpEg', '.jpg', 'image/jpeg', image],
      ['arte.webp', '.webp', 'image/webp', image], ['ARTE.WEBP', '.webp', 'image/webp', image],
      ['clip.mp4', '.mp4', 'video/mp4', video], ['CLIP.MP4', '.mp4', 'video/mp4', video],
      ['filme.mov', '.mov', 'video/quicktime', video], ['FILME.MOV', '.mov', 'video/quicktime', video], ['Filme.Mov', '.mov', 'video/quicktime', video],
      ['anim.webm', '.webm', 'video/webm', video], ['ANIM.WEBM', '.webm', 'video/webm', video],
      ['aviso.pdf', '.pdf', 'application/pdf', 'pdf'], ['AVISO.PDF', '.pdf', 'application/pdf', 'pdf']
    ];
    for (const [name, sample, type, kind] of cases) {
      const media = await kit.upload(kit.admin, { name, bytes: sampleFile(sample, name) });
      assert.deepEqual([media.name, media.type, media.kind, media.status], [name, type, kind, 'pending'], name);
      const row = kit.app.db.prepare('SELECT storage_name FROM media WHERE id=?').get(media.id);
      assert.equal(row.storage_name, media.id + name.slice(name.lastIndexOf('.')).toLowerCase(), `${name}: o arquivo é guardado com a extensão em minúsculas`);
    }
    assert.equal(mediaFiles(kit).length, cases.length);

    // Arquivos reais de um codificador de vídeo e de imagem.
    const mov = await kit.upload(kit.admin, { name: 'REAL.MOV', bytes: fixture('h264-aac.mov') });
    const hevc = await kit.upload(kit.admin, { name: 'celular.mov', bytes: fixture('hevc-aac.mov') });
    assert.deepEqual([mov.type, hevc.type], ['video/quicktime', 'video/quicktime']);
    for (const name of ['progressive.jpg', 'gray.jpg', 'cmyk.jpg', 'restart.jpg']) assert.equal((await kit.upload(kit.admin, { name, bytes: fixture(name) })).type, 'image/jpeg', name);

    // O tipo vem da extensão e do conteúdo, nunca do que o navegador declara.
    const lying = await post(kit, 'declarado-errado.mov', fixture('h264-aac.mov'), { headers: { 'Content-Type': 'text/html' }, query: { duplicate: 'allow' } });
    assert.deepEqual([lying.status, lying.data.type], [201, 'video/quicktime']);
    const html = await post(kit, 'pagina.mov', Buffer.from('<!doctype html><script>alert(1)</script>'), { headers: { 'Content-Type': 'video/quicktime' } });
    assert.equal(html.status, 415, 'conteúdo que não é vídeo é recusado mesmo com o tipo "certo" declarado');

    // A categoria da biblioteca (filtro "Tipo") inclui MOV entre os vídeos e JPEG entre as imagens.
    const library = type => kit.call(`/api/library?unitId=leste&sectorId=rh&type=${type}&pageSize=100`, { session: kit.admin });
    const videos = must(await library('video')).media, images = must(await library('image')).media;
    assert.ok(videos.some(item => item.name === 'FILME.MOV') && videos.some(item => item.name === 'REAL.MOV'));
    assert.ok(images.some(item => item.name === 'FOTO.JPEG') && images.some(item => item.name === 'foto.jpg'));
    assert.ok(videos.every(item => item.kind === 'video') && images.every(item => item.kind === 'image'));
  });
});

test('formatos: JPG e JPEG são o mesmo formato de imagem (mesmo tipo e mesma detecção de duplicados)', async () => {
  await withApp(async kit => {
    const first = await kit.upload(kit.admin, { name: 'cartaz.jpg', bytes: JPEG });
    const again = await post(kit, 'CARTAZ-COPIA.JPEG', JPEG);
    assert.deepEqual([again.status, again.data.code, again.data.details.existing.id], [409, 'DUPLICATE_MEDIA', first.id]);
    const allowed = must(await post(kit, 'cartaz.jpeg', JPEG, { query: { duplicate: 'allow' } }), 201);
    assert.deepEqual([allowed.type, allowed.kind, allowed.sha256], ['image/jpeg', 'image', first.sha256]);
    // O mesmo vale para MOV: o conteúdo igual com outra caixa de extensão também é duplicado.
    const mov = await kit.upload(kit.admin, { name: 'a.mov', bytes: fixture('h264-aac.mov') });
    assert.equal((await post(kit, 'A.MOV', fixture('h264-aac.mov'))).data.details.existing.id, mov.id);
  });
});

test('formatos: arquivos renomeados, inválidos ou incompletos são recusados no envio, sem deixar arquivo nem registro', async () => {
  await withApp(async kit => {
    const png = uniquePng('renomeado'), movBytes = fixture('h264-aac.mov'), prores = fixture('prores-pcm.mov');
    const refused = async (name, body, status, code) => {
      const response = await post(kit, name, body);
      assert.deepEqual([response.status, response.data.code ?? null], [status, code ?? null], `${name}: ${JSON.stringify(response.data)}`);
      assert.ok(typeof response.data.error === 'string' && response.data.error.length > 10, `${name}: mensagem para a pessoa`);
      return response.data.error;
    };
    // Outro formato com a extensão trocada (a assinatura não confere).
    await refused('imagem.jpg', png, 415);
    await refused('imagem.JPEG', png, 415);
    await refused('video.mov', png, 415);
    await refused('video.MOV', JPEG, 415);
    await refused('foto.jpg', movBytes, 415);
    await refused('foto.png', JPEG, 415);
    await refused('dados.mov', Buffer.from('MZ\x90\x00 executável do Windows'), 415);
    await refused('pagina.jpeg', Buffer.from('<html><body>oi</body></html>'), 415);
    await refused('vazio.mov', Buffer.alloc(0), 415);
    await refused('vazio.jpg', Buffer.alloc(0), 415);
    // Começa como o formato, mas não é o formato (o que só a assinatura aceitaria).
    await refused('so-cabecalho.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-teste-jpg')]), 415, 'MEDIA_INCOMPLETE');
    await refused('so-cabecalho.mov', Buffer.concat([Buffer.alloc(4, 0), Buffer.from('ftypqt  '), Buffer.from('isto não é um vídeo')]), 415, 'MEDIA_INCOMPLETE');
    // Incompletos: o envio foi cortado.
    await refused('cortado.jpg', JPEG.subarray(0, JPEG.length - 2), 415, 'MEDIA_INCOMPLETE');
    await refused('cortado.JPEG', fixture('progressive.jpg').subarray(0, 400), 415, 'MEDIA_INCOMPLETE');
    for (const cut of [20, 1000, Math.floor(movBytes.length / 2), movBytes.length - 1]) await refused('cortado.mov', movBytes.subarray(0, cut), 415, 'MEDIA_INCOMPLETE');
    // Estrutura completa, mas sem imagem reproduzível: o motivo e o que fazer vêm na mensagem.
    assert.match(await refused('profissional.mov', prores, 415, 'MEDIA_UNSUPPORTED'), /codec Apple ProRes\. O sistema aceita MOV com vídeo H\.264 ou HEVC/);
    assert.match(await refused('antigo.mov', fixture('mpeg4-video-only.mov'), 415, 'MEDIA_UNSUPPORTED'), /codec MPEG-4 Visual/);
    assert.match(await refused('som.mov', fixture('audio-only.mov'), 415, 'MEDIA_UNSUPPORTED'), /não tem imagem/);
    assert.match(await refused('externo.mov', buildMov({ external: true }), 415, 'MEDIA_UNSUPPORTED'), /fora do arquivo/);
    // Formato que não é aceito.
    const message = await refused('video.avi', movBytes, 415);
    assert.match(message, /PNG, JPG, JPEG, WebP, PDF, MP4, MOV ou WebM/);

    assert.equal(mediaFiles(kit).length, 0, 'nenhum arquivo órfão no disco');
    assert.equal(mediaRows(kit), 0, 'nenhum registro criado');
    const events = must(await kit.call('/api/audit', { session: kit.admin })).events;
    assert.ok(!events.some(event => event.action === 'media.uploaded' || event.action === 'media.scan.failed'), 'recusa de conteúdo não gera registro de envio');

    // Depois das recusas, os arquivos corretos continuam entrando normalmente.
    assert.equal((await post(kit, 'certo.mov', movBytes)).status, 201);
    assert.equal((await post(kit, 'certo.jpeg', JPEG)).status, 201);
  });
});

test('formatos: MOV e JPEG recém-enviados ficam pendentes e só chegam à TV depois de aprovados, como os demais', async () => {
  await withApp(async kit => {
    const movBytes = fixture('h264-aac.mov');
    const mov = await kit.upload(kit.admin, { name: 'abertura.MOV', bytes: movBytes }), jpeg = await kit.upload(kit.admin, { name: 'cartaz.JPEG', bytes: JPEG });
    const tv = await kit.pairedDisplay(kit.admin);
    for (const media of [mov, jpeg]) {
      assert.equal(media.status, 'pending');
      assert.equal((await kit.call(`/api/media/${media.id}/file`, { token: tv.token })).status, 403, `${media.name}: a TV não recebe arquivo não aprovado`);
    }
    const draft = must(await kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { name: 'Formatos', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: mov.id }, { mediaId: jpeg.id }] } }), 201);
    assert.deepEqual(draft.items.map(item => item.readiness), ['pending', 'pending']);
    const early = await kit.call(`/api/playlists/${draft.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: draft.draftRev } });
    assert.deepEqual([early.status, early.data.code], [409, 'MEDIA_NOT_READY'], 'não publica versão com arquivo pendente');

    // Rejeitado também não chega.
    must(await kit.call(`/api/media/${jpeg.id}/reject`, { method: 'POST', session: kit.admin, body: {} }));
    assert.equal((await kit.call(`/api/media/${jpeg.id}/file`, { token: tv.token })).status, 403);

    await kit.approve(kit.admin, mov.id);
    const jpegAgain = await kit.approve(kit.admin, (await kit.upload(kit.admin, { name: 'cartaz2.jpeg', bytes: jpegWithSeed('2') })).id);
    const playlist = must(await kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { name: 'Formatos 2', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: mov.id }, { mediaId: jpegAgain.id }] } }), 201);
    must(await kit.call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: playlist.draftRev } }), 201);
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });

    const manifest = must(await kit.call('/api/player/manifest', { token: tv.token }));
    assert.deepEqual(manifest.items.map(item => [item.name, item.type]), [['abertura.MOV', 'video/quicktime'], ['cartaz2.jpeg', 'image/jpeg']]);
    const file = await kit.call(manifest.items[0].url, { token: tv.token });
    assert.equal(file.status, 200);
    assert.ok(file.bytes.equals(movBytes), 'a TV recebe exatamente o arquivo enviado');
    assert.equal(file.headers.get('content-type'), 'video/quicktime');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    const range = await kit.call(manifest.items[0].url, { token: tv.token, headers: { Range: 'bytes=0-99' } });
    assert.deepEqual([range.status, range.headers.get('content-range'), range.bytes.length], [206, `bytes 0-99/${movBytes.length}`, 100], 'trechos do vídeo (Range) são entregues');
    assert.equal((await kit.call(manifest.items[1].url, { token: tv.token })).headers.get('content-type'), 'image/jpeg');
  });
});

test('formatos: em produção, MOV e JPEG só chegam à TV com a verificação do antivírus concluída e limpa', { skip: process.platform === 'win32' }, async () => {
  const dir = makeTempDir('tvcorp-scan-');
  try {
    await withApp(async kit => {
      const mov = await kit.upload(kit.admin, { name: 'seguro.mov', bytes: fixture('h264-aac.mov') });
      assert.equal(mov.scanStatus, 'clean');
      must(await kit.call(`/api/media/${mov.id}/approve`, { method: 'POST', session: kit.admin, body: {} }));
      const tv = await kit.pairedDisplay(kit.admin);
      const playlist = must(await kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { name: 'Produção', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: mov.id }] } }), 201);
      must(await kit.call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: playlist.draftRev } }), 201);
      await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
      assert.equal((await kit.call(`/api/media/${mov.id}/file`, { token: tv.token })).status, 200);
      // A verificação deixa de constar como concluída e limpa: o arquivo sai do alcance da TV, mesmo aprovado.
      kit.app.db.prepare("UPDATE media SET scan_status='not_configured' WHERE id=?").run(mov.id);
      assert.equal((await kit.call(`/api/media/${mov.id}/file`, { token: tv.token })).status, 403);
      assert.equal(must(await kit.call('/api/player/manifest', { token: tv.token })).items.length, 0);
      kit.app.db.prepare("UPDATE media SET scan_status='clean' WHERE id=?").run(mov.id);
      assert.equal((await kit.call(`/api/media/${mov.id}/file`, { token: tv.token })).status, 200);
    }, { production: true, origin: 'https://tv.example.test', scanner: writeScanner(dir, 'clean') });
    // Conteúdo recusado pela conferência não chega a ser enviado ao antivírus nem gravado.
    await withApp(async kit => {
      assert.equal((await post(kit, 'cortado.mov', fixture('h264-aac.mov').subarray(0, 3000))).status, 415);
      assert.equal(mediaFiles(kit).length, 0);
    }, { production: true, origin: 'https://tv.example.test', scanner: writeScanner(dir, 'clean') });
  } finally { removeTempDir(dir, 'tvcorp-scan-'); }
});

test('formatos: arquivos já cadastrados antes desta versão continuam sendo entregues, sem nova avaliação do conteúdo', async () => {
  await withApp(async kit => {
    // JPEG registrado por uma versão anterior, quando só a assinatura era conferida (hoje seria recusado no envio).
    const legacy = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-cadastrado-antes')]);
    assert.equal((await post(kit, 'antigo.jpg', legacy)).status, 415, 'o envio de hoje recusa este conteúdo');
    const id = randomUUID(), at = new Date().toISOString();
    writeFileSync(path.join(kit.dataDir, 'media', `${id}.jpg`), legacy);
    kit.app.db.prepare(`INSERT INTO media(id, unit_id, sector_id, folder_id, name, title, search_key, type, size, sha256, status, scan_status, storage_name,
      thumb_name, created_at, created_by, reviewed_at, reviewed_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`)
      .run(id, 'leste', 'rh', null, 'antigo.jpg', 'Cartaz antigo', 'cartaz antigo antigo.jpg', 'image/jpeg', legacy.length, 'a'.repeat(64), 'approved', 'not_configured', `${id}.jpg`, at, kit.adminUser.id, at, kit.adminUser.id, at);

    const tv = await kit.pairedDisplay(kit.admin);
    const playlist = must(await kit.call('/api/playlists', { method: 'POST', session: kit.admin, body: { name: 'Antigos', unitId: 'leste', sectorId: 'rh', items: [{ mediaId: id }] } }), 201);
    must(await kit.call(`/api/playlists/${playlist.id}/publish`, { method: 'POST', session: kit.admin, body: { rev: playlist.draftRev } }), 201);
    await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
    const manifest = must(await kit.call('/api/player/manifest', { token: tv.token }));
    assert.deepEqual(manifest.items.map(item => [item.id, item.type]), [[id, 'image/jpeg']]);
    const file = await kit.call(`/api/media/${id}/file`, { token: tv.token });
    assert.ok(file.status === 200 && file.bytes.equals(legacy), 'entregue como está');
    assert.equal(must(await kit.call(`/api/media/${id}`, { session: kit.admin })).title, 'Cartaz antigo');
    assert.ok(must(await kit.call('/api/library?unitId=leste&sectorId=rh', { session: kit.admin })).media.some(item => item.id === id));
  });
});

function jpegWithSeed(seed) { return sampleFile('.jpg', seed); }
