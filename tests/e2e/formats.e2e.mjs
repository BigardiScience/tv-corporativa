// Formatos MOV e JPEG de ponta a ponta no Chromium de verdade: os oito formatos na janela de envio, escolha e arrastar-e-soltar (maiúsculas e
// minúsculas), arquivos recusados na própria janela (antes do envio) e pelo servidor (conteúdo), aprovação, detalhes e a reprodução do MOV
// e do JPEG na TV pareada, passando pelo mesmo caminho da TV de verdade (download do arquivo e exibição a partir de um endereço blob:).
//
// O que este teste NÃO prova: o comportamento de uma TV (LG webOS, Samsung Tizen, Android TV…). O navegador é o Chromium do Playwright num
// computador, com os codecs que ele tem. O MOV com vídeo HEVC é tratado nas duas situações possíveis (o navegador decodifica ou não) e o
// relatório diz qual aconteceu. A homologação em cada modelo de TV é outra etapa (docs/VALIDACAO.md).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chooseSpace, goTo, loginAs, runScenario } from './harness.mjs';
import { connectTv, noteText, publishToNewTv, topTitle, waitForTop } from './playback-kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = name => readFileSync(path.join(here, '..', 'fixtures', 'media', name));
const EIGHT = '.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.pdf';

export default () => runScenario('Formatos MOV e JPEG: envio, recusas, aprovação, detalhes e reprodução na TV (Chromium)', async (s, step) => {
  const { page } = s;
  // As recusas de conteúdo feitas pelo servidor (415) são provocadas de propósito.
  s.allow(/^HTTP 415 POST \/api\/media\?/, /status of 415/);
  const report = { limitacao: 'Chromium do Playwright num computador: prova o código, não uma TV.' };
  let kit, library = [];
  const media = {};

  const h264 = sample('h264-aac.mov');
  const hevc = sample('hevc-aac.mov');
  const truncate = (bytes, fraction) => bytes.subarray(0, Math.floor(bytes.length * fraction));

  const rowOf = name => page.locator('dialog[open] .upload-row', { has: page.locator('.upload-main small', { hasText: name }) });
  const statusOf = name => rowOf(name).getAttribute('data-status');
  const textOf = name => rowOf(name).locator('.upload-status').innerText();

  // Solta arquivos na área da janela de envio como o navegador faz ao arrastar do computador (DataTransfer de verdade).
  const dropFiles = files => page.evaluate(async list => {
    const transfer = new DataTransfer();
    for (const entry of list) transfer.items.add(new File([Uint8Array.from(atob(entry.base64), char => char.charCodeAt(0))], entry.name, { type: entry.type }));
    const zone = document.querySelector('dialog[open] .dropzone');
    for (const type of ['dragenter', 'dragover']) zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const during = zone.classList.contains('dragover');
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return { during, after: zone.classList.contains('dragover') };
  }, files.map(file => ({ name: file.name, type: file.mimeType, base64: file.buffer.toString('base64') })));

  await step('os oito formatos aparecem no seletor e no texto da janela de envio, e na ajuda de formatos', async () => {
    kit = await s.seed();
    await loginAs(page, s.origin, s.adminEmail, s.password);
    await chooseSpace(page, 'Unidade Leste', 'RH');
    await page.getByRole('button', { name: 'Ver formatos e orientações de exportação' }).click();
    assert.match(await page.locator('dialog[open]').innerText(), /Formatos aceitos: PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM e PDF\./);
    await page.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).first().click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });

    await goTo(page, 'library');
    await page.getByText('A biblioteca está vazia').waitFor();
    await page.getByRole('button', { name: 'Enviar arquivos' }).first().click();
    assert.equal(await page.locator('#upload-input').getAttribute('accept'), EIGHT);
    assert.match(await page.locator('.dropzone p').innerText(), /^PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM ou PDF · até \d+ MB por arquivo$/);
    assert.equal(await page.locator('dialog[open] .notice').count(), 1, 'só o aviso de antivírus que já existia; nenhum aviso ou cartão novo');
    await s.shot('formatos-01-janela-de-envio');
  });

  await step('escolher MOV e JPEG (maiúsculas e minúsculas) pelo seletor: entram prontos', async () => {
    await page.setInputFiles('#upload-input', [
      { name: 'Boas Vindas.MOV', mimeType: 'video/quicktime', buffer: h264 },
      { name: 'Aviso Segurança.jpeg', mimeType: 'image/jpeg', buffer: sample('progressive.jpg') },
      { name: 'Foto Cinza.JPG', mimeType: 'image/jpeg', buffer: sample('gray.jpg') },
      { name: 'Clipe HEVC.mov', mimeType: 'video/quicktime', buffer: hevc }
    ]);
    await page.locator('dialog[open] .upload-row').nth(3).waitFor();
    for (const name of ['Boas Vindas.MOV', 'Aviso Segurança.jpeg', 'Foto Cinza.JPG', 'Clipe HEVC.mov']) assert.equal(await statusOf(name), 'ready', name);
  });

  await step('arrastar e soltar: JPEG sem tipo informado entra pronto; o que não serve é recusado na própria janela', async () => {
    const dragged = await dropFiles([
      { name: 'Cartaz.JPEG', mimeType: '', buffer: sample('restart.jpg') },
      { name: 'Abertura.MOV', mimeType: 'video/quicktime', buffer: sample('prores-pcm.mov') }, // passa na conferência da janela; o servidor recusa o codec
      { name: 'Somente áudio.mov', mimeType: 'video/quicktime', buffer: sample('audio-only.mov') },
      { name: 'Cortado.mov', mimeType: 'video/quicktime', buffer: truncate(h264, 0.6) },
      { name: 'Cortada.jpg', mimeType: 'image/jpeg', buffer: truncate(sample('progressive.jpg'), 0.5) },
      { name: 'Imagem disfarçada.mov', mimeType: 'video/quicktime', buffer: sample('gray.jpg') },
      { name: 'Filme antigo.avi', mimeType: 'video/x-msvideo', buffer: Buffer.from('RIFF....AVI ') }
    ]);
    assert.deepEqual(dragged, { during: true, after: false }, 'a área destaca durante o arrasto e volta ao normal ao soltar');
    await page.locator('dialog[open] .upload-row').nth(10).waitFor();
    assert.equal(await statusOf('Cartaz.JPEG'), 'ready');
    for (const name of ['Abertura.MOV', 'Somente áudio.mov', 'Cortado.mov', 'Cortada.jpg']) assert.equal(await statusOf(name), 'ready', `${name} só é recusado pelo servidor, que confere o conteúdo inteiro`);
    assert.equal(await statusOf('Imagem disfarçada.mov'), 'invalid');
    await rowOf('Imagem disfarçada.mov').getByText(/O conteúdo do arquivo não corresponde ao formato informado/).waitFor();
    assert.equal(await statusOf('Filme antigo.avi'), 'invalid');
    await rowOf('Filme antigo.avi').getByText('Exporte o arquivo original para PDF, imagem ou vídeo antes de enviar.').waitFor();
    await s.shot('formatos-02-fila');
  });

  await step('enviar: os válidos entram aguardando aprovação; o servidor recusa codec sem suporte, vídeo sem imagem e arquivos incompletos, com a orientação', async () => {
    const uploads = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/media?')) uploads.push(new URL(request.url()).searchParams.get('name')); });
    await page.getByRole('button', { name: /^Enviar 9 arquivos/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('dialog[open] .upload-row[data-status="uploading"], dialog[open] .upload-row[data-status="ready"]').length === 0, null, { timeout: 30_000 });
    assert.deepEqual([...uploads].sort(), ['Abertura.MOV', 'Aviso Segurança.jpeg', 'Boas Vindas.MOV', 'Cartaz.JPEG', 'Clipe HEVC.mov', 'Cortada.jpg', 'Cortado.mov', 'Foto Cinza.JPG', 'Somente áudio.mov'],
      'só os nove arquivos válidos na janela chegaram ao servidor; os dois recusados antes não foram enviados');

    for (const name of ['Boas Vindas.MOV', 'Aviso Segurança.jpeg', 'Foto Cinza.JPG', 'Clipe HEVC.mov', 'Cartaz.JPEG']) assert.equal(await statusOf(name), 'done', name);
    const refusals = {
      'Abertura.MOV': /O vídeo deste MOV usa o codec Apple ProRes\. O sistema aceita MOV com vídeo H\.264 ou HEVC \(H\.265\) e não converte vídeos: exporte em H\.264 com áudio AAC e envie novamente\./,
      'Somente áudio.mov': /Este arquivo MOV não tem imagem \(só áudio ou dados\)\. Exporte um vídeo com imagem e envie de novo\./,
      'Cortado.mov': /O arquivo MOV está incompleto ou corrompido\. Exporte o vídeo novamente e envie de novo\./,
      'Cortada.jpg': /O arquivo JPEG está incompleto ou corrompido\. Exporte a imagem novamente e envie de novo\./
    };
    for (const [name, message] of Object.entries(refusals)) {
      assert.equal(await statusOf(name), 'failed', name);
      assert.match(await textOf(name), message, name);
      await rowOf(name).getByRole('button', { name: 'Tentar de novo' }).waitFor();
    }
    await s.shot('formatos-03-resultado-do-envio');
    await page.locator('dialog[open]').getByRole('button', { name: 'Concluir' }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.item-card.media').length === 5);
    // O que o servidor recusou não ficou na biblioteca nem em disco.
    const listed = await kit.call('/api/library?unitId=leste&sectorId=rh', { session: kit.admin });
    assert.equal(listed.status, 200);
    library = listed.data.media;
    assert.deepEqual(library.map(item => item.title).sort(), ['Aviso Segurança', 'Boas Vindas', 'Cartaz', 'Clipe HEVC', 'Foto Cinza']);
    assert.deepEqual(Object.fromEntries(library.map(item => [item.title, item.type])), {
      'Aviso Segurança': 'image/jpeg', 'Boas Vindas': 'video/quicktime', Cartaz: 'image/jpeg', 'Clipe HEVC': 'video/quicktime', 'Foto Cinza': 'image/jpeg'
    });
    assert.ok(library.every(item => item.status === 'pending'), 'tudo entra aguardando aprovação');
    for (const item of library) media[item.title] = item;
  });

  await step('na biblioteca: MOV e JPEG aparecem como vídeo e imagem; o filtro de vídeos mostra o MOV', async () => {
    assert.equal(await page.locator('.item-card.media').count(), 5);
    assert.equal(await page.locator('.item-card.media', { has: page.locator('.item-title', { hasText: /^Boas Vindas$/ }) }).locator('.badge').first().innerText(), 'Aguardando aprovação');
    const videos = await kit.call('/api/library?unitId=leste&sectorId=rh&type=video', { session: kit.admin });
    assert.deepEqual(videos.data.media.map(item => item.title).sort(), ['Boas Vindas', 'Clipe HEVC']);
    const images = await kit.call('/api/library?unitId=leste&sectorId=rh&type=image', { session: kit.admin });
    assert.deepEqual(images.data.media.map(item => item.title).sort(), ['Aviso Segurança', 'Cartaz', 'Foto Cinza']);
  });

  await step('arquivo aguardando aprovação não chega à TV: nem pelo endereço direto do arquivo', async () => {
    const paired = await kit.pairedDisplay(kit.admin, { name: 'TV pendente' });
    for (const title of ['Boas Vindas', 'Aviso Segurança']) {
      const direct = await kit.call(`/api/media/${media[title].id}/file`, { token: paired.token });
      assert.equal(direct.status, 403, `${title} ainda não foi aprovado`);
    }
  });

  await step('aprovar e abrir os detalhes: o MOV com H.264 mostra o vídeo, sem nenhuma explicação a mais', async () => {
    for (const title of Object.keys(media)) media[title] = await kit.approve(kit.admin, media[title].id);
    await page.reload();
    await page.waitForSelector('.app-shell');
    await goTo(page, 'library');
    await page.locator('.item-card.media', { has: page.locator('.item-title', { hasText: /^Boas Vindas$/ }) }).locator('.item-open').click();
    const dialog = page.locator('dialog[open]');
    const video = dialog.locator('video.detail-preview');
    await video.waitFor();
    await page.waitForFunction(() => document.querySelector('dialog[open] video.detail-preview')?.readyState >= 1);
    const size = await video.evaluate(element => ({ width: element.videoWidth, height: element.videoHeight, duration: element.duration }));
    assert.deepEqual([size.width, size.height], [160, 90], 'o navegador decodificou a imagem do MOV');
    assert.ok(size.duration > 1.5 && size.duration < 2.5, `duração ${size.duration}`);
    assert.equal(await dialog.locator('.detail-media p').count(), 0, 'com imagem decodificada não há explicação');
    assert.match(await dialog.innerText(), /Formato\s*video\/quicktime/);
    assert.match(await dialog.innerText(), /Arquivo original\s*Boas Vindas\.MOV/);
    await s.shot('formatos-04-detalhes-mov');
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
  });

  await step('detalhes do MOV com HEVC: se este navegador não decodifica a imagem, a explicação aparece; se decodifica, nada aparece', async () => {
    await page.locator('.item-card.media', { has: page.locator('.item-title', { hasText: /^Clipe HEVC$/ }) }).locator('.item-open').click();
    const dialog = page.locator('dialog[open]');
    const video = dialog.locator('video.detail-preview');
    await video.waitFor();
    await page.waitForFunction(() => document.querySelector('dialog[open] video.detail-preview')?.readyState >= 1);
    const decodes = await video.evaluate(element => element.videoWidth > 0);
    report.hevcNoNavegador = decodes ? 'decodifica a imagem' : 'carrega mas não decodifica a imagem';
    if (decodes) {
      assert.equal(await dialog.locator('.detail-media p').count(), 0);
    } else {
      await dialog.locator('.detail-media p[role="status"]').waitFor();
      assert.match(await dialog.locator('.detail-media p[role="status"]').innerText(), /Este navegador não consegue exibir a imagem deste vídeo .*Teste a reprodução na TV antes de publicar/);
      await s.shot('formatos-05-detalhes-hevc-sem-imagem');
    }
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForSelector('#dialogs dialog', { state: 'detached' });
  });

  await step('TV: o MOV (H.264) e os JPEG chegam pelo download e tocam a partir do endereço blob: com imagem decodificada', async () => {
    const item = (title, extra = {}) => ({ media: media[title], durationS: 5, ...extra });
    const tv0 = await publishToNewTv(kit, { name: 'TV formatos', items: [item('Boas Vindas', { durationS: 30, durationMode: 'natural' }), item('Aviso Segurança'), item('Foto Cinza'), item('Cartaz')] });
    const tv = await connectTv(s, { code: tv0.code });
    try {
      await waitForTop(tv.page, 'Boas Vindas');
      const played = await tv.page.evaluate(async () => {
        const video = document.querySelector('#stage video');
        const first = video.currentTime;
        await new Promise(resolve => setTimeout(resolve, 700));
        const quality = video.getVideoPlaybackQuality();
        return {
          width: video.videoWidth, height: video.videoHeight, source: video.currentSrc.split(':')[0], ready: video.readyState, error: video.error?.code ?? null,
          advanced: video.currentTime - first, frames: quality.totalVideoFrames, corrupted: quality.corruptedVideoFrames, ended: video.ended
        };
      });
      assert.equal(played.source, 'blob', 'a TV toca a partir do arquivo baixado, não do endereço do servidor');
      assert.deepEqual([played.width, played.height, played.error], [160, 90, null]);
      assert.ok(played.advanced > 0.3 || played.ended, `o vídeo andou ${played.advanced} s`);
      assert.ok(played.frames > 0 && played.corrupted === 0, `quadros apresentados ${played.frames}, corrompidos ${played.corrupted}`);
      report.mov = played;

      // Terminado o vídeo (≈2 s), segue para os JPEG: imagem de verdade, desenhada.
      for (const title of ['Aviso Segurança', 'Foto Cinza', 'Cartaz']) {
        await waitForTop(tv.page, title, 15_000);
        const image = await tv.page.evaluate(() => { const img = document.querySelector('#stage > .stage-layer:not(.is-standby) img'); return { complete: img.complete, width: img.naturalWidth, height: img.naturalHeight, source: img.src.split(':')[0] }; });
        assert.equal(image.complete, true, title);
        assert.ok(image.width > 0 && image.height > 0, `${title}: o navegador desenhou o JPEG (${image.width}×${image.height})`);
        assert.equal(image.source, 'blob', title);
      }
      assert.deepEqual(tv.problems, [], `Mensagens inesperadas no console da TV:\n${tv.problems.join('\n')}`);
      const requested = Object.fromEntries(Object.entries(Object.groupBy(tv.media, entry => entry.id)).map(([id, list]) => [id, list.map(entry => entry.status)]));
      for (const title of ['Boas Vindas', 'Aviso Segurança', 'Foto Cinza', 'Cartaz']) assert.deepEqual(requested[media[title].id], [200], `${title} baixado uma vez`);
      await tv.page.screenshot({ path: path.join(s.dataDir, 'tv-formatos.png') }).catch(() => {});
    } finally { await tv.close(); }
  });

  await step('TV: o MOV com HEVC toca se o aparelho decodifica; se não decodifica, é pulado com o motivo (sem quadro preto) e o resto segue', async () => {
    const item = (title, extra = {}) => ({ media: media[title], durationS: 5, ...extra });
    const tv0 = await publishToNewTv(kit, { name: 'TV HEVC', items: [item('Cartaz'), item('Clipe HEVC', { durationS: 30, durationMode: 'natural' }), item('Foto Cinza')] });
    const tv = await connectTv(s, { code: tv0.code, tolerate: [/Failed to load resource/, /DEMUXER|PIPELINE|FFmpeg|decode/i] });
    try {
      await waitForTop(tv.page, 'Cartaz');
      if (report.hevcNoNavegador === 'decodifica a imagem') {
        await waitForTop(tv.page, 'Clipe HEVC', 15_000);
        assert.ok(await tv.page.evaluate(() => document.querySelector('#stage video').videoWidth > 0));
      } else {
        await tv.page.waitForFunction(() => /conteúdo pulado/.test(document.querySelector('#playback-status')?.textContent ?? ''), null, { timeout: 20_000 });
        assert.equal(await noteText(tv.page), 'Conteúdo pulado: Clipe HEVC (formato ou arquivo não suportado por esta TV).');
        // Nunca mostra o vídeo sem imagem: durante toda a sequência o topo é sempre uma das imagens.
        const seen = new Set();
        const deadline = Date.now() + 9_000;
        while (Date.now() < deadline) { seen.add(await topTitle(tv.page)); await tv.page.waitForTimeout(150); }
        assert.ok(!seen.has('Clipe HEVC'), `o vídeo sem imagem não pode ir ao ar (viu ${[...seen]})`);
        assert.ok(seen.has('Foto Cinza') || seen.has('Cartaz'), `a sequência seguiu (viu ${[...seen]})`);
        await s.shot('formatos-06-tv-hevc-pulado');
      }
    } finally { await tv.close(); }
  });

  console.log(`   relatório: ${JSON.stringify(report)}`);
});
