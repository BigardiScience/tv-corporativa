// Vídeo da TV no Chromium de verdade (servidor real, TV pareada pelo código): o aparelho que RECUSA o arquivo baixado (blob:) passa a tocar o
// mesmo vídeo direto do servidor, por um link temporário assinado. Reproduz o defeito da TV da recepção (LG webOS), que mostrava
// "formato ou arquivo não suportado" para arquivos que outra TV da mesma rede tocava: o <video> falha com erro 4, rede 3 e estado 0
// ao abrir o endereço blob:, mas toca o mesmo arquivo pelo endereço do servidor (como na pré-visualização do painel).
//
// O que este teste NÃO prova: o comportamento da TV de verdade. A recusa do blob: é SIMULADA (o arquivo baixado é aberto e o endereço é
// revogado antes de o <video> usá-lo, o que no Chromium dá o mesmo erro 4 / rede 3 / estado 0). A homologação na TV é outra etapa.
import assert from 'node:assert/strict';
import { runScenario } from './harness.mjs';
import { VIDEO_WAY_KEY } from '../../public/js/player/app.js';
import { VIDEO_COLORS, connectTv, fixture, publishToNewTv, waitForTop } from './playback-kit.mjs';

// Roda dentro da página, antes do código da TV. Não pode usar nada de fora.
function installRefusal({ refuse }) {
  window.__videoErrors = [];
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', event => window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`));
  // O erro do <video> não "borbulha", mas é visto na fase de captura.
  document.addEventListener('error', event => {
    const video = event.target;
    if (video instanceof HTMLVideoElement) window.__videoErrors.push({ code: video.error?.code ?? null, message: video.error?.message ?? '', networkState: video.networkState, readyState: video.readyState, src: video.getAttribute('src') ?? '' });
  }, true);
  if (!refuse) return;
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = create(blob);
    if (blob && typeof blob.type === 'string' && blob.type.startsWith('video/')) URL.revokeObjectURL(url);
    return url;
  };
}

// O que a TV pediu ao servidor, pedido a pedido (com a credencial e o Range que o navegador enviou).
function recorder() {
  const requests = [], responses = [];
  return {
    requests, responses,
    attach: async context => {
      context.on('request', request => {
        const headers = request.headers(), url = new URL(request.url());
        requests.push({ method: request.method(), path: url.pathname, query: url.search, authorization: headers.authorization ?? null, range: headers.range ?? null, type: request.resourceType() });
      });
      context.on('response', response => { const url = new URL(response.url()); responses.push({ path: url.pathname, query: url.search, status: response.status() }); });
    },
    // Baixar pelo caminho de sempre (credencial no cabeçalho) e pedir o link (idem): ambos usam a credencial da TV.
    downloads: id => requests.filter(item => item.path === `/api/media/${id}/file` && item.authorization),
    links: id => requests.filter(item => item.path === `/api/player/media/${id}/link`),
    // O <video> pedindo o arquivo pelo link: sem credencial no cabeçalho, com ?t= no endereço.
    direct: id => requests.filter(item => item.path === `/api/media/${id}/file` && item.query.startsWith('?t=')),
    answered: id => responses.filter(item => item.path === `/api/media/${id}/file` && item.query.startsWith('?t=')).map(item => item.status)
  };
}

export default () => runScenario('Vídeo da TV: aparelho que recusa o arquivo baixado toca direto por link assinado (Chromium)', async (s, step) => {
  let kit;
  const media = {};
  const close = (a, b, tolerance, what) => assert.ok(a.every((value, index) => Math.abs(value - b[index]) <= tolerance), `${what}: ${JSON.stringify(a)} longe de ${JSON.stringify(b)}`);

  // Cor média do quadro que o <video> está mostrando (prova que a imagem foi decodificada e desenhada, não só que o relógio andou).
  const frameColor = page => page.evaluate(() => {
    const video = document.querySelector('#stage .stage-layer:not(.is-standby) video');
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, 8, 8);
    const data = context.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; }
    return sum.map(value => Math.round(value / 64));
  });
  const videoState = page => page.evaluate(() => {
    const video = document.querySelector('#stage .stage-layer:not(.is-standby) video');
    return video ? { src: video.currentSrc, time: video.currentTime, paused: video.paused, ready: video.readyState, error: video.error ? video.error.code : null } : null;
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function withTv(options, body) {
    const rec = recorder();
    const tv = await connectTv(s, { ...options, setup: async context => { await context.addInitScript(installRefusal, { refuse: options.refuse ?? false }); await rec.attach(context); await options.route?.(context); } });
    try {
      await body(tv, rec);
      assert.deepEqual(tv.problems, [], `Mensagens inesperadas no console da TV:\n${tv.problems.join('\n')}`);
      assert.deepEqual(await tv.page.evaluate(() => window.__csp), [], 'nenhuma violação da política de segurança (CSP)');
    } finally { await tv.close(); }
  }

  await step('preparar a biblioteca com dois vídeos reais (WebM)', async () => {
    kit = await s.seed();
    media.azul = await kit.approvedMedia(kit.admin, { title: 'Clipe azul', name: 'clipe-azul.webm', bytes: fixture('video-azul-3s.webm') });
    media.roxo = await kit.approvedMedia(kit.admin, { title: 'Clipe roxo', name: 'clipe-roxo.webm', bytes: fixture('video-roxo-6s.webm') });
  });

  await step('TV que toca o arquivo baixado: nada muda (endereço blob:, nenhum link pedido, nenhum pedido sem credencial)', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV comum', items: [{ media: media.azul, durationS: 30, durationMode: 'natural' }] });
    await withTv({ code: tv0.code }, async (tv, rec) => {
      await waitForTop(tv.page, 'Clipe azul');
      await sleep(1500);
      const state = await videoState(tv.page);
      assert.match(state.src, /^blob:/, 'o <video> usa o arquivo baixado');
      assert.ok(state.time > 0.3 && !state.paused && !state.error, JSON.stringify(state));
      close(await frameColor(tv.page), VIDEO_COLORS['video-azul-3s.webm'], 45, 'cor do quadro');
      assert.equal(rec.downloads(media.azul.id).length, 1);
      assert.deepEqual([rec.links(media.azul.id).length, rec.direct(media.azul.id).length], [0, 0], 'o link nem foi pedido');
      assert.equal(await tv.page.evaluate(key => localStorage.getItem(key), VIDEO_WAY_KEY), null, 'nada foi gravado no navegador da TV');
      assert.deepEqual(await tv.page.evaluate(() => window.__videoErrors), []);
    });
  });

  await step('TV que RECUSA o arquivo baixado (erro 4, rede 3, estado 0): o player pede o link e o vídeo toca direto, com imagem', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV recepção', items: [{ media: media.azul, durationS: 30, durationMode: 'natural' }, { media: media.roxo, durationS: 30, durationMode: 'natural' }] });
    await withTv({ code: tv0.code, refuse: true, tolerate: [/ERR_FILE_NOT_FOUND|Not allowed to load local resource/] }, async (tv, rec) => {
      await waitForTop(tv.page, 'Clipe azul');
      await sleep(1500);
      const state = await videoState(tv.page);
      assert.match(state.src, new RegExp(`/api/media/${media.azul.id}/file\\?t=`), `o <video> usa o link direto: ${state.src}`);
      assert.ok(state.time > 0.3 && !state.paused && state.ready >= 2 && !state.error, JSON.stringify(state));
      close(await frameColor(tv.page), VIDEO_COLORS['video-azul-3s.webm'], 45, 'cor do quadro');

      // O defeito foi reproduzido: o primeiro <video> falhou exatamente como na TV (erro 4, rede 3, estado 0) e o player seguiu em frente.
      const errors = await tv.page.evaluate(() => window.__videoErrors);
      assert.ok(errors.length >= 1 && errors[0].code === 4 && errors[0].networkState === 3 && errors[0].readyState === 0 && errors[0].src.startsWith('blob:'), JSON.stringify(errors));
      assert.equal(await tv.page.locator('#empty').evaluate(element => element.hidden), true, 'sem aviso de conteúdo indisponível');
      assert.match(await tv.page.locator('#playback-status').innerText(), /Em exibição/);

      // O que viajou pela rede: a credencial só nos pedidos à API; o <video> pede o arquivo sem credencial, por trechos (Range).
      assert.equal(rec.downloads(media.azul.id).length, 1, 'o arquivo baixado foi tentado uma vez');
      assert.ok(rec.links(media.azul.id).length >= 1 && rec.links(media.azul.id).every(item => item.authorization), 'o link é pedido com a credencial da TV');
      const direct = rec.direct(media.azul.id);
      assert.ok(direct.length >= 1, 'o <video> pediu o arquivo pelo link');
      assert.ok(direct.every(item => item.authorization === null), 'e sem credencial no cabeçalho');
      assert.ok(direct.some(item => item.range?.startsWith('bytes=')), 'por trechos (Range)');
      assert.ok(rec.answered(media.azul.id).every(status => status === 200 || status === 206), JSON.stringify(rec.answered(media.azul.id)));

      // Depois do primeiro, os outros vídeos e as próximas voltas vão direto: o arquivo não é mais baixado pelo caminho antigo.
      await waitForTop(tv.page, 'Clipe roxo', 20_000);
      await sleep(1200);
      const second = await videoState(tv.page);
      assert.match(second.src, new RegExp(`/api/media/${media.roxo.id}/file\\?t=`));
      assert.ok(second.time > 0.3 && !second.paused && !second.error, JSON.stringify(second));
      close(await frameColor(tv.page), VIDEO_COLORS['video-roxo-6s.webm'], 45, 'cor do quadro do segundo vídeo');
      assert.equal(rec.downloads(media.roxo.id).length, 0, 'o segundo vídeo nem foi baixado');
      assert.equal(rec.downloads(media.azul.id).length, 1, 'e o primeiro continua com a única tentativa');
      assert.ok(rec.links(media.roxo.id).length >= 1);
      assert.equal(await tv.page.evaluate(() => window.__videoErrors.length), 1, 'só o primeiro vídeo falhou');
    });
  });

  await step('TV reiniciada (página recarregada): o navegador lembra o caminho que funcionou e o primeiro vídeo já vai direto, sem baixar o arquivo', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV reiniciada', items: [{ media: media.azul, durationS: 30, durationMode: 'natural' }] });
    await withTv({ code: tv0.code, refuse: true, tolerate: [/ERR_FILE_NOT_FOUND|Not allowed to load local resource/] }, async (tv, rec) => {
      await waitForTop(tv.page, 'Clipe azul');
      await sleep(1500);
      assert.equal(await tv.page.evaluate(key => localStorage.getItem(key), VIDEO_WAY_KEY), 'direct', 'a TV guardou o caminho que funcionou');
      assert.equal(rec.downloads(media.azul.id).length, 1, 'a primeira vez paga uma tentativa com o arquivo baixado');

      await tv.page.reload(); // a TV desliga e liga: a credencial e a lembrança continuam no navegador
      await waitForTop(tv.page, 'Clipe azul');
      await sleep(1500);
      const state = await videoState(tv.page);
      assert.match(state.src, new RegExp(`/api/media/${media.azul.id}/file\\?t=`), `o <video> usa o link direto: ${state.src}`);
      assert.ok(state.time > 0.3 && !state.paused && state.ready >= 2 && !state.error, JSON.stringify(state));
      close(await frameColor(tv.page), VIDEO_COLORS['video-azul-3s.webm'], 45, 'cor do quadro');
      assert.equal(rec.downloads(media.azul.id).length, 1, 'depois de reiniciar o arquivo não foi baixado de novo');
      assert.deepEqual(await tv.page.evaluate(() => window.__videoErrors), [], 'e o <video> nunca recebeu um endereço blob: que fosse falhar');
      assert.equal(await tv.page.locator('#empty').evaluate(element => element.hidden), true, 'sem aviso de conteúdo indisponível');
    });
  });

  await step('servidor sem o link (versão anterior): o sintoma da TV aparece como antes — conteúdo indisponível, "formato ou arquivo não suportado"', async () => {
    const tv0 = await publishToNewTv(kit, { name: 'TV sem link', items: [{ media: media.azul, durationS: 30, durationMode: 'natural' }] });
    await withTv({
      code: tv0.code, refuse: true, tolerate: [/ERR_FILE_NOT_FOUND|Not allowed to load local resource|status of 404/],
      route: context => context.route('**/api/player/media/*/link', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Endpoint não encontrado."}' }))
    }, async tv => {
      await tv.page.waitForFunction(() => !document.getElementById('empty').hidden && /indispon/i.test(document.getElementById('empty-title').textContent), null, { timeout: 20_000 });
      assert.match(await tv.page.locator('#empty-description').innerText(), /Clipe azul não pôde ser exibido \(formato ou arquivo não suportado por esta TV\)/);
      assert.equal(await videoState(tv.page), null, 'nada de vídeo na tela');
    });
  });
});
