import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createPlayer, MEDIA_LINK_TTL_MS } from '../server/domain/player.mjs';
import { sendFile, SEND_CHUNK_BYTES } from '../server/http/send-file.mjs';
import { withApp, must } from './helpers/app.mjs';
import { buildMov } from './helpers/media-files.mjs';

// Link temporário e assinado: a TV (com a credencial dela) pede o endereço de UM vídeo da programação dela e o <video> toca por ele,
// sem baixar o arquivo inteiro antes. Aqui se prova o que o link permite e, principalmente, o que ele NÃO permite.

async function scene(kit, { video = true, name = 'aviso' } = {}) {
  const media = await kit.approvedMedia(kit.admin, video ? { name: `${name}.mov`, bytes: buildMov({ payload: 3000, seed: name }) } : { name: `${name}.png`, seed: name });
  const playlist = await kit.publishedPlaylist(kit.admin, [media.id]);
  const tv = await kit.pairedDisplay(kit.admin, { name: 'Recepção' });
  const schedule = await kit.liveSchedule(kit.admin, { playlistId: playlist.id, displayIds: [tv.display.id] });
  return { media, playlist, tv, schedule };
}
const askLink = (kit, tv, media) => kit.call(`/api/player/media/${media.id}/link`, { token: tv.token });
const status = (kit, route, options) => kit.call(route, options).then(response => response.status);
const swap = (url, from, to) => url.replace(from, to);

test('a TV pede o link de um vídeo da programação dela e o navegador toca por ele, sem a credencial, inclusive por trechos', async () => {
  await withApp(async kit => {
    const { media, tv } = await scene(kit);
    const before = Date.now();
    const link = must(await askLink(kit, tv, media));
    assert.deepEqual(Object.keys(link).sort(), ['expiresAt', 'url']);
    assert.match(link.url, new RegExp(`^/api/media/${media.id}/file\\?t=${tv.display.id}\\.\\d{13}\\.[A-Za-z0-9_-]{43}$`));
    const lifetime = Date.parse(link.expiresAt) - before;
    assert.ok(lifetime >= MEDIA_LINK_TTL_MS && lifetime <= MEDIA_LINK_TTL_MS + 5000, `validade de ${MEDIA_LINK_TTL_MS} ms (veio ${lifetime})`);
    assert.equal(MEDIA_LINK_TTL_MS, 6 * 60 * 60 * 1000);

    const byToken = must(await kit.call(`/api/media/${media.id}/file`, { token: tv.token }));
    assert.ok(Buffer.isBuffer(byToken) || byToken, 'o caminho atual (credencial no cabeçalho) segue igual');
    const whole = await kit.call(link.url);
    assert.equal(whole.status, 200);
    assert.ok(whole.bytes.equals((await kit.call(`/api/media/${media.id}/file`, { token: tv.token })).bytes), 'mesmos bytes pelos dois caminhos');
    assert.equal(whole.headers.get('content-type'), 'video/quicktime');
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(whole.headers.get('cache-control'), 'no-store');
    assert.equal(whole.headers.get('referrer-policy'), 'no-referrer');
    assert.match(whole.headers.get('content-security-policy'), /media-src 'self' blob:/);
    assert.equal(whole.setCookie, undefined, 'o link não abre sessão nem grava cookie');

    // O navegador segue pedindo trechos com o mesmo endereço (início, meio, fim) e revalida pela etiqueta do arquivo.
    const size = whole.bytes.length;
    const head = await kit.call(link.url, { headers: { Range: 'bytes=0-99' } });
    assert.deepEqual([head.status, head.headers.get('content-range')], [206, `bytes 0-99/${size}`]);
    assert.ok(head.bytes.equals(whole.bytes.subarray(0, 100)));
    const tail = await kit.call(link.url, { headers: { Range: `bytes=${size - 50}-` } });
    assert.deepEqual([tail.status, tail.headers.get('content-range')], [206, `bytes ${size - 50}-${size - 1}/${size}`]);
    assert.equal((await kit.call(link.url, { headers: { 'If-None-Match': whole.headers.get('etag') } })).status, 304);
  });
});

test('o mesmo fluxo por HTTP de verdade (soquete local): endereço com ?t=, Range e sem credencial', async () => {
  await withApp(async kit => {
    const { media, tv } = await scene(kit);
    const link = must(await askLink(kit, tv, media));
    const whole = await kit.call(link.url);
    assert.equal(whole.status, 200);
    const part = await kit.call(link.url, { headers: { Range: 'bytes=10-59' } });
    assert.deepEqual([part.status, part.headers.get('content-range')], [206, `bytes 10-59/${whole.bytes.length}`]);
    assert.ok(part.bytes.equals(whole.bytes.subarray(10, 60)));
    assert.equal((await kit.call(`${link.url}x`)).status, 401, 'qualquer alteração do link o invalida');
  }, { http: true });
});

test('pedir o link: só a TV pareada, só para o que está na programação ativa dela', async () => {
  await withApp(async kit => {
    const { media, tv } = await scene(kit);
    const route = `/api/player/media/${media.id}/link`;
    for (const options of [{}, { token: 'invalido' }, { headers: { Authorization: `Basic ${tv.token}` } }, { headers: { Authorization: tv.token } }]) {
      assert.equal(await status(kit, route, options), 401, JSON.stringify(options));
    }
    assert.equal(await status(kit, route, { session: kit.admin }), 401, 'o cookie de administrador não abre o lado da TV');
    assert.notEqual(await status(kit, route, { method: 'POST', token: tv.token, body: {} }), 200, 'só GET');

    const unscheduled = await kit.approvedMedia(kit.admin, { name: 'fora.mov', bytes: buildMov({ payload: 500, seed: 'fora' }) });
    const foreign = await kit.approvedMedia(kit.admin, { unitId: 'centro', sectorId: 'rh', name: 'alheio.mov', bytes: buildMov({ payload: 500, seed: 'alheio' }) });
    const pending = await kit.upload(kit.admin, { name: 'pendente.mov', bytes: buildMov({ payload: 500, seed: 'pendente' }) });
    assert.equal(await status(kit, `/api/player/media/${unscheduled.id}/link`, { token: tv.token }), 403, 'aprovado, mas fora da programação desta TV');
    assert.equal(await status(kit, `/api/player/media/${foreign.id}/link`, { token: tv.token }), 403, 'de outra unidade');
    assert.equal(await status(kit, `/api/player/media/${pending.id}/link`, { token: tv.token }), 403, 'ainda não aprovado');
    assert.equal(await status(kit, '/api/player/media/nao-existe/link', { token: tv.token }), 404);
    assert.equal(await status(kit, route, { token: tv.token }), 200);
  });
});

test('o link vale só para o arquivo e a TV de origem; adulterar, vencer ou usar em outro lugar é recusado', async () => {
  await withApp(async kit => {
    const { media, tv, playlist } = await scene(kit);
    const second = await kit.approvedMedia(kit.admin, { name: 'segundo.mov', bytes: buildMov({ payload: 800, seed: 'segundo' }) });
    const both = await kit.publishedPlaylist(kit.admin, [media.id, second.id], { name: 'Dois' });
    const other = await kit.pairedDisplay(kit.admin, { name: 'Outra TV' });
    await kit.liveSchedule(kit.admin, { playlistId: both.id, displayIds: [tv.display.id, other.display.id], name: 'Duas TVs' });
    const link = must(await askLink(kit, tv, media));
    const [prefix, token] = link.url.split('?t=');
    const [displayId, expires, signature] = token.split('.');
    assert.equal(displayId, tv.display.id);
    assert.equal(await status(kit, link.url), 200);

    const flipped = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');
    const forged = {
      'assinatura trocada': `${prefix}?t=${displayId}.${expires}.${flipped}`,
      'assinatura truncada': `${prefix}?t=${displayId}.${expires}.${signature.slice(0, 42)}`,
      'validade estendida': `${prefix}?t=${displayId}.${Number(expires) + 1}.${signature}`,
      'validade muito distante': `${prefix}?t=${displayId}.${Date.now() + MEDIA_LINK_TTL_MS * 2}.${signature}`,
      'validade já passada': `${prefix}?t=${displayId}.${Date.now() - 1000}.${signature}`,
      'TV trocada por outra TV ativa': `${prefix}?t=${other.display.id}.${expires}.${signature}`,
      'TV inexistente': `${prefix}?t=00000000-0000-4000-8000-000000000000.${expires}.${signature}`,
      'link de outro arquivo': `${swap(prefix, media.id, second.id)}?t=${token}`,
      'sem a TV': `${prefix}?t=${expires}.${signature}`,
      'vazio': `${prefix}?t=`,
      'lixo': `${prefix}?t=lixo`,
      'letras na validade': `${prefix}?t=${displayId}.abc.${signature}`,
      'parâmetro repetido': `${prefix}?t=${token}&t=${token}`,
      'repetido com um inválido': `${prefix}?t=lixo&t=${token}`,
      'com texto depois': `${prefix}?t=${token}x`
    };
    for (const [name, url] of Object.entries(forged)) assert.equal(await status(kit, url), 401, name);
    assert.equal(await status(kit, `${prefix}?t=${token}&outro=1`), 200, 'outros parâmetros não atrapalham, nem ajudam');

    // Cada TV recebe o seu link; o da outra TV não é emprestável para esta nem o contrário.
    const mine = must(await askLink(kit, other, media));
    assert.notEqual(mine.url, link.url);
    assert.equal(await status(kit, mine.url), 200);
    assert.ok(mine.url.includes(`t=${other.display.id}.`));

    // Vencimento: no último instante ainda vale; um milissegundo depois, não.
    const issued = Number(expires);
    const clock = mock.method(Date, 'now', () => issued - 1000);
    try {
      assert.equal(await status(kit, link.url), 200, 'um segundo antes de vencer');
      clock.mock.mockImplementation(() => issued);
      assert.equal(await status(kit, link.url), 401, 'na hora exata do vencimento');
      clock.mock.mockImplementation(() => issued + 1);
      assert.equal(await status(kit, link.url), 401, 'depois de vencer');
    } finally { clock.mock.restore(); }
    assert.equal(playlist.id.length > 0, true);
  });
});

test('o link não vira credencial: não vale em outras rotas, não ignora o cabeçalho de credencial e não cai para a sessão do painel', async () => {
  await withApp(async kit => {
    const { media, tv } = await scene(kit);
    const link = must(await askLink(kit, tv, media));
    const t = link.url.split('?t=')[1];
    for (const route of ['/api/player/manifest', '/api/state', '/api/users', '/api/audit', `/api/media/${media.id}`, '/api/library?unitId=leste&sectorId=rh']) {
      assert.equal(await status(kit, `${route}${route.includes('?') ? '&' : '?'}t=${t}`), 401, `${route} não aceita o link`);
    }
    assert.equal(await status(kit, `/api/player/heartbeat?t=${t}`, { method: 'POST', body: {} }), 401);
    assert.equal(await status(kit, `/api/player/media/${media.id}/link?t=${t}`), 401, 'o link não pede outros links');

    const file = `/api/media/${media.id}/file`;
    assert.equal(await status(kit, `${file}?t=lixo`, { session: kit.admin }), 401, 'link inválido não cai para o cookie do painel');
    assert.equal(await status(kit, file, { session: kit.admin }), 200, 'o painel segue igual: cookie, sem ?t=');
    assert.equal(await status(kit, `${file}?t=lixo`, { token: tv.token }), 200, 'com a credencial no cabeçalho, ela é quem vale (o ?t= é ignorado)');
    assert.equal(await status(kit, `${file}?t=${t}`, { token: 'invalido' }), 401, 'e se a credencial do cabeçalho é inválida, o link não a salva');
    assert.equal(await status(kit, `${file}?t=${t}`, { session: kit.admin }), 200, 'link válido vale mesmo com cookie junto');
  });
});

test('o link acompanha a programação, a credencial e o cadastro da TV: perdeu o direito, perdeu o link', async () => {
  await withApp(async kit => {
    // 1) a programação para: o link emitido deixa de servir na hora
    const a = await scene(kit);
    const linkA = must(await askLink(kit, a.tv, a.media));
    assert.equal(await status(kit, linkA.url), 200);
    must(await kit.call(`/api/schedules/${a.schedule.id}/stop`, { method: 'POST', session: kit.admin }));
    assert.equal(await status(kit, linkA.url), 403, 'programação encerrada');
    assert.equal(await status(kit, `/api/player/media/${a.media.id}/link`, { token: a.tv.token }), 403, 'e a TV não consegue novo link');

    // 2) a TV é reconectada com outro código: a credencial antiga e os links dela caducam
    const b = await scene(kit, { name: 'outro' });
    const linkB = must(await askLink(kit, b.tv, b.media));
    const { pairingCode } = must(await kit.call(`/api/displays/${b.tv.display.id}/pairing-code`, { method: 'POST', session: kit.admin }));
    const repaired = must(await kit.call('/api/player/pair', { method: 'POST', body: { code: pairingCode } }));
    assert.equal(await status(kit, linkB.url), 401, 'link da credencial anterior');
    assert.equal(await status(kit, `/api/media/${b.media.id}/file`, { token: b.tv.token }), 401, 'a credencial anterior também');
    const renewed = must(await kit.call(`/api/player/media/${b.media.id}/link`, { token: repaired.token }));
    assert.equal(await status(kit, renewed.url), 200, 'a credencial nova pede link novo');

    // 3) a TV é removida do cadastro
    const c = await scene(kit, { name: 'terceiro' });
    const linkC = must(await askLink(kit, c.tv, c.media));
    must(await kit.call(`/api/displays/${c.tv.display.id}`, { method: 'DELETE', session: kit.admin }));
    assert.equal(await status(kit, linkC.url), 401, 'TV removida');

  });
});

test('o link também acompanha o banco alterado por fora: TV não ativa, cadastro removido ou item fora da playlist publicada', async () => {
  await withApp(async kit => {
    // 4) o banco volta a marcar a TV como não ativa
    const d = await scene(kit, { name: 'quarto' });
    const linkD = must(await askLink(kit, d.tv, d.media));
    kit.app.db.prepare("UPDATE displays SET status='pending' WHERE id=?").run(d.tv.display.id);
    assert.equal(await status(kit, linkD.url), 401, 'TV que deixou de estar ativa');

    // 4b) o cadastro marcado como removido por fora, mesmo com a credencial ainda gravada
    const d2 = await scene(kit, { name: 'quarto-b' });
    const linkD2 = must(await askLink(kit, d2.tv, d2.media));
    assert.equal(await status(kit, linkD2.url), 200);
    kit.app.db.prepare('UPDATE displays SET removed_at=? WHERE id=?').run(new Date().toISOString(), d2.tv.display.id);
    assert.equal(await status(kit, linkD2.url), 401, 'TV removida do cadastro');

    // 5) mídia retirada da publicação por fora: a conferência a cada pedido a recusa
    const e = await scene(kit, { name: 'quinto' });
    const linkE = must(await askLink(kit, e.tv, e.media));
    kit.app.db.prepare('DELETE FROM playlist_version_items WHERE media_id=?').run(e.media.id);
    assert.equal(await status(kit, linkE.url), 403, 'o item saiu da playlist publicada');
  });
});

test('a chave dos links nasce a cada início do servidor: reiniciar invalida os links emitidos antes', async () => {
  await withApp(async kit => {
    const { media, tv } = await scene(kit);
    const link = must(await askLink(kit, tv, media));
    const token = link.url.split('?t=')[1];
    const s = kit.app.services;
    assert.equal(s.player.authenticateLink(token, media.id).id, tv.display.id);
    const restarted = createPlayer({ db: s.db, audit: s.audit, config: s.config, media: s.media, displays: s.displays, access: s.displayAccess });
    assert.throws(() => restarted.authenticateLink(token, media.id), error => error.status === 401);
    // …e o novo processo emite links que só ele reconhece.
    const fresh = restarted.mediaLink(s.player.authenticate({ headers: { authorization: `Bearer ${tv.token}` } }), s.media.load(media.id));
    assert.notEqual(fresh.url, link.url);
    assert.throws(() => s.player.authenticateLink(fresh.url.split('?t=')[1], media.id), error => error.status === 401);
  });
});

test('emitir o link não polui a auditoria nem altera o manifesto da TV', async () => {
  await withApp(async kit => {
    const { media, tv } = await scene(kit);
    const manifest = must(await kit.call('/api/player/manifest', { token: tv.token }));
    const audits = () => kit.app.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
    const before = audits();
    for (let i = 0; i < 5; i++) { const link = must(await askLink(kit, tv, media)); assert.equal(await status(kit, link.url), 200); }
    assert.equal(audits(), before, 'um registro por vídeo exibido encheria a auditoria à toa');
    const after = must(await kit.call('/api/player/manifest', { token: tv.token }));
    assert.deepEqual(after.items, manifest.items, 'o manifesto não ganhou campo nem mudou de endereço');
    assert.equal(after.items[0].url, `/api/media/${media.id}/file`);
  });
});

test('entrega do vídeo: blocos de leitura de 256 KB e o conteúdo chega idêntico em qualquer ponto (início, fronteira de bloco, fim), inteiro ou por trechos', async () => {
  assert.equal(SEND_CHUNK_BYTES, 256 * 1024);
  // O pedido ao disco usa o tamanho de bloco combinado (a medição que o justifica está em send-file.mjs e em docs/RELATORIO-2.4.0.md).
  let asked;
  const chunks = [];
  const res = Object.assign(new Writable({ write(chunk, _, done) { chunks.push(chunk); done(); } }), { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; } });
  await sendFile({ headers: {}, method: 'GET' }, res, { handle: { createReadStream: options => { asked = options; return Readable.from([Buffer.from('abc')]); } }, size: 3, type: 'video/webm', etag: '"x"', filename: 'x.webm' });
  assert.deepEqual([asked.start, asked.end, asked.highWaterMark, asked.autoClose], [0, 2, SEND_CHUNK_BYTES, false]);

  await withApp(async kit => {
    const { media, tv } = await scene(kit, { video: false });
    const big = await kit.approvedMedia(kit.admin, { name: 'grande.mov', bytes: buildMov({ payload: 900_000, seed: 'grande' }) });
    const both = await kit.publishedPlaylist(kit.admin, [media.id, big.id], { name: 'Com vídeo grande' });
    await kit.liveSchedule(kit.admin, { playlistId: both.id, displayIds: [tv.display.id], name: 'Vídeo grande' });
    const link = must(await askLink(kit, tv, big));
    const whole = await kit.call(link.url);
    assert.equal(whole.status, 200);
    const size = whole.bytes.length;
    assert.ok(size > 3 * SEND_CHUNK_BYTES, `arquivo com mais de 3 blocos (${size} bytes)`);
    const edge = SEND_CHUNK_BYTES;
    for (const [from, to] of [[0, 0], [0, 99], [edge - 1, edge], [edge, edge], [edge - 10, edge + 10], [2 * edge - 1, 2 * edge], [size - 1, size - 1], [100, size - 1]]) {
      const part = await kit.call(link.url, { headers: { Range: `bytes=${from}-${to}` } });
      assert.equal(part.status, 206, `${from}-${to}`);
      assert.equal(part.headers.get('content-range'), `bytes ${from}-${to}/${size}`);
      assert.ok(part.bytes.equals(whole.bytes.subarray(from, to + 1)), `bytes ${from}-${to} idênticos ao arquivo`);
    }
    assert.ok((await kit.call(`/api/media/${big.id}/file`, { token: tv.token })).bytes.equals(whole.bytes), 'e idêntico ao caminho pela credencial');
  });
});
