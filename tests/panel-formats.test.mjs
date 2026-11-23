// Formatos aceitos no painel: seletor de arquivos, texto da lista, escolha e arrastar-e-soltar (MOV e JPEG, em maiúsculas e minúsculas),
// recusa na própria linha e a explicação quando o navegador não decodifica a imagem de um MOV. Testado no Node com o DOM de mentira
// (tests/helpers/panel-kit.mjs); o seletor e a reprodução de verdade são conferidos no Chromium (tests/e2e/formats.e2e.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeEvent } from './helpers/fake-dom.mjs';
import { createPanelKit } from './helpers/panel-kit.mjs';
import { sampleFile } from './helpers/http.mjs';
import { MIME } from '../server/domain/formats.mjs';
import { ACCEPT } from '../public/js/lib/media-validation.js';
import { buildTree } from '../public/js/lib/tree.js';
import { closeAllDialogs } from '../public/js/ui/dialogs.js';
import { formatsDialog } from '../public/js/views/common-dialogs.js';
import { openMediaDetails } from '../public/js/views/library/details.js';
import { openUploadDialog } from '../public/js/views/library/upload.js';

const withKit = run => async () => {
  const kit = createPanelKit({});
  try { await run(kit); } finally {
    closeAllDialogs();
    await kit.clock.advance(0);
    kit.release();
  }
};

const EIGHT = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.pdf'];
const file = (bytes, name, type = '') => new File([bytes], name, { type });
const space = { unitId: 'leste', sectorId: 'rh' };
const context = (extra = {}) => ({ state: { limits: { maxUploadMB: 50 }, scannerConfigured: true }, api: {}, ...extra });
// Conteúdo de exemplo pela extensão (.jpeg usa o mesmo tipo de JPEG que .jpg).
const bytesFor = (name, seed) => sampleFile(`.${name.split('.').pop().toLowerCase()}`, seed);

// A validação é assíncrona (lê o início do arquivo): espera até a condição valer.
async function until(condition, what) {
  for (let turn = 0; turn < 300; turn++) {
    if (condition()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`tempo esgotado esperando: ${what}`);
}

const openDialog = (kit, ctx = context()) => {
  openUploadDialog(ctx, { space, tree: buildTree([]), files: [] });
  return kit.top();
};
const rows = (kit, dialog) => kit.all(dialog, '.upload-row').map(row => ({
  name: kit.textOf(kit.all(row, '.upload-main small:not(.field-error)')[0]).split(' · ')[0],
  status: row.getAttribute('data-status'),
  text: kit.textOf(row)
}));
const choose = (dialog, files) => {
  const input = dialog.querySelector('#upload-input');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new FakeEvent('change', { bubbles: true }));
};
const drop = (dialog, files) => {
  const event = new FakeEvent('drop', { bubbles: true, cancelable: true });
  event.dataTransfer = { files };
  dialog.querySelector('.dropzone').dispatchEvent(event);
  return event;
};
const click = element => element.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));

test('janela de envio: o seletor oferece os oito formatos e o texto da área de soltar lista os mesmos oito, sem nada a mais', withKit(async kit => {
  assert.equal(ACCEPT, EIGHT.join(','));
  assert.deepEqual(Object.keys(MIME), EIGHT, 'o servidor aceita exatamente os mesmos oito');
  const dialog = openDialog(kit);
  const input = dialog.querySelector('#upload-input');
  assert.equal(input.getAttribute('accept'), '.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.pdf');
  assert.equal(input.hasAttribute('multiple'), true);
  assert.equal(kit.textOf(dialog.querySelector('.dropzone b')), 'Arraste os arquivos até aqui ou clique para escolher');
  assert.equal(kit.textOf(dialog.querySelector('.dropzone p')), 'PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM ou PDF · até 50 MB por arquivo');
  assert.equal(kit.all(dialog, '.upload-row').length, 0);
  assert.equal(kit.all(dialog, '.notice').length, 0, 'nenhum aviso, cartão ou explicação técnica a mais na janela');

  closeAllDialogs();
  formatsDialog(context({ state: { limits: { maxUploadMB: 80 } } }));
  assert.match(kit.textOf(kit.top()), /Formatos aceitos: PNG, JPG, JPEG, WEBP, MP4, MOV, WEBM e PDF\. Limite: 80 MB por arquivo\. Macros e executáveis são bloqueados\./);
}));

test('janela de envio: MOV e JPEG, em maiúsculas ou minúsculas, escolhidos ou soltos, entram prontos como os demais formatos', withKit(async kit => {
  const dialog = openDialog(kit);
  const names = ['logo.png', 'foto.jpg', 'FOTO.JPEG', 'arte.WebP', 'clip.mp4', 'FILME.MOV', 'filme2.mov', 'anim.webm', 'AVISO.PDF'];
  const files = names.map((name, index) => file(bytesFor(name, `${index}`), name, ''));

  choose(dialog, files.slice(0, 5));
  await until(() => rows(kit, dialog).length === 5, 'fila com os 5 arquivos escolhidos');
  const event = drop(dialog, files.slice(5));
  assert.equal(event.defaultPrevented, true, 'soltar não abre o arquivo no navegador');
  await until(() => rows(kit, dialog).length === 9, 'fila com os 9 arquivos');
  assert.deepEqual(rows(kit, dialog).map(row => [row.name, row.status]), names.map(name => [name, 'ready']));
  assert.match(kit.textOf(dialog.querySelector('.upload-summary')), /^9 arquivos prontos \(/);
  assert.equal(kit.button(dialog, 'Enviar 9 arquivos').disabled, false);
}));

test('janela de envio: o tipo que o navegador informa para MOV e JPEG é aceito quando combina com a extensão', withKit(async kit => {
  const dialog = openDialog(kit);
  choose(dialog, [
    file(bytesFor('a.mov', 'a'), 'a.mov', 'video/quicktime'), file(bytesFor('b.MOV', 'b'), 'b.MOV', 'video/quicktime'),
    file(bytesFor('c.jpg', 'c'), 'c.jpg', 'image/jpeg'), file(bytesFor('d.JPEG', 'd'), 'd.JPEG', 'image/jpeg'),
    file(bytesFor('e.mov', 'e'), 'e.mov', 'application/octet-stream')
  ]);
  await until(() => rows(kit, dialog).length === 5, 'cinco linhas');
  assert.deepEqual(rows(kit, dialog).map(row => row.status), ['ready', 'ready', 'ready', 'ready', 'ready']);
}));

test('janela de envio: formato fora da lista, conteúdo trocado e tipo contraditório são recusados na própria linha, sem ir ao servidor', withKit(async kit => {
  const uploads = [];
  const dialog = openDialog(kit, context({ api: { upload: async (...args) => { uploads.push(args); return { status: 'pending' }; } } }));
  choose(dialog, [
    file(sampleFile('.png', 'a'), 'imagem.mov', 'video/quicktime'), // PNG com nome de MOV
    file(bytesFor('b.mov', 'b'), 'video.jpg', 'image/jpeg'), // MOV com nome de JPEG
    file(bytesFor('c.jpg', 'c'), 'foto.JPEG', 'video/quicktime'), // tipo declarado contradiz a extensão
    file(bytesFor('d.mov', 'd'), 'video.avi', 'video/x-msvideo'), // formato que não é aceito
    file('<html></html>', 'pagina.MOV', 'text/html'),
    file(Buffer.alloc(0), 'vazio.jpeg', 'image/jpeg'),
    file(bytesFor('e.mov', 'e'), 'bom.MOV', 'video/quicktime')
  ]);
  await until(() => rows(kit, dialog).length === 7, 'sete linhas');
  const byName = Object.fromEntries(rows(kit, dialog).map(row => [row.name, row]));
  assert.equal(byName['imagem.mov'].status, 'invalid');
  assert.match(byName['imagem.mov'].text, /O conteúdo do arquivo não corresponde ao formato informado/);
  assert.match(byName['video.jpg'].text, /O conteúdo do arquivo não corresponde ao formato informado/);
  assert.match(byName['foto.JPEG'].text, /O tipo do arquivo não corresponde à extensão/);
  assert.match(byName['video.avi'].text, /Exporte o arquivo original para PDF, imagem ou vídeo antes de enviar\./);
  assert.match(byName['pagina.MOV'].text, /O tipo do arquivo não corresponde à extensão/);
  assert.match(byName['vazio.jpeg'].text, /O arquivo está vazio\./);
  assert.equal(byName['bom.MOV'].status, 'ready');
  assert.equal(kit.button(dialog, 'Enviar 1 arquivo').disabled, false);
  assert.deepEqual(uploads, [], 'nada foi enviado ainda');

  // Enviar: só o válido sobe, com o tipo definido pela extensão e o nome como a pessoa escolheu.
  click(kit.button(dialog, 'Enviar 1 arquivo'));
  await until(() => uploads.length === 1, 'envio do arquivo válido');
  assert.deepEqual([uploads[0][0], uploads[0][1].query.name, uploads[0][1].contentType], ['/api/media', 'bom.MOV', 'video/quicktime']);
}));

test('janela de envio: a recusa do servidor (MOV incompleto, codec sem suporte) aparece na linha com a orientação do servidor, e dá para tentar de novo', withKit(async kit => {
  const messages = {
    'cortado.mov': 'O arquivo MOV está incompleto ou corrompido. Exporte o vídeo novamente e envie de novo.',
    'profissional.mov': 'O vídeo deste MOV usa o codec Apple ProRes. O sistema aceita MOV com vídeo H.264 ou HEVC (H.265) e não converte vídeos: exporte em H.264 com áudio AAC e envie novamente.'
  };
  const api = { upload: async (route, { query }) => { throw Object.assign(new Error(messages[query.name]), { status: 415, code: 'MEDIA_UNSUPPORTED' }); } };
  const dialog = openDialog(kit, context({ api }));
  choose(dialog, [file(bytesFor('x.mov', 'x'), 'cortado.mov', 'video/quicktime'), file(bytesFor('y.mov', 'y'), 'profissional.mov', 'video/quicktime')]);
  await until(() => rows(kit, dialog).length === 2, 'duas linhas');
  click(kit.button(dialog, 'Enviar 2 arquivos'));
  await until(() => rows(kit, dialog).every(row => row.status === 'failed'), 'as duas recusas');
  const texts = Object.fromEntries(rows(kit, dialog).map(row => [row.name, row.text]));
  assert.ok(texts['cortado.mov'].includes(messages['cortado.mov']), texts['cortado.mov']);
  assert.ok(texts['profissional.mov'].includes(messages['profissional.mov']), texts['profissional.mov']);
  assert.notEqual(kit.all(dialog, 'button').find(item => kit.textOf(item) === 'Tentar de novo'), undefined, 'a pessoa pode corrigir o arquivo e tentar de novo');
}));

// ---- detalhes do arquivo: MOV cuja imagem este navegador não decodifica ---------------------------------------------------------------------
const media = (extra = {}) => ({
  id: 'm1', unitId: 'leste', sectorId: 'rh', folderId: null, name: 'clipe.mov', title: 'Clipe', type: 'video/quicktime', kind: 'video', size: 22000, sha256: 'x'.repeat(64),
  status: 'pending', scanStatus: 'clean', createdAt: '2026-10-27T12:00:00.000Z', createdBy: 'u1', reviewedAt: null, reviewedBy: null, updatedAt: '2026-10-27T12:00:00.000Z',
  url: '/api/media/m1/file', folderPath: [], usage: { playlists: [], schedules: [] }, ...extra
});
const viewer = { id: 'u1', role: 'admin', active: true, permissions: ['media:approve'], unitIds: [], sectorIds: [] };
const NOTE = /Este navegador não consegue exibir a imagem deste vídeo/;

async function detailsFor(kit, item) {
  openMediaDetails({ api: { get: async () => item }, user: viewer, link: () => '#/' }, { mediaId: item.id, tree: buildTree([]) });
  await until(() => kit.top()?.querySelector('video.detail-preview'), 'pré-visualização montada');
  return kit.top();
}
// Simula o navegador terminando de ler o início do vídeo, com a largura que ele conseguiu decodificar.
const loaded = (kit, dialog, width) => {
  const video = dialog.querySelector('video.detail-preview');
  video.videoWidth = width;
  video.dispatchEvent(new FakeEvent('loadedmetadata'));
  return kit.textOf(dialog.querySelector('.detail-media'));
};

test('detalhes: MOV que o navegador carrega mas não decodifica (largura 0) ganha uma explicação logo depois do vídeo', withKit(async kit => {
  const dialog = await detailsFor(kit, media());
  assert.equal(dialog.querySelector('video.detail-preview').getAttribute('src'), '/api/media/m1/file');
  assert.equal(kit.all(dialog, '.detail-media p').length, 0, 'antes de saber, nada é dito');
  const text = loaded(kit, dialog, 0);
  assert.match(text, NOTE);
  assert.match(text, /Teste a reprodução na TV antes de publicar/);
  const notes = kit.all(dialog, '.detail-media p');
  assert.equal(notes.length, 1);
  const children = dialog.querySelector('.detail-media').childNodes;
  assert.deepEqual([children[0].localName, children[1].localName, children[2].localName], ['video', 'p', 'a'], 'a explicação fica entre o vídeo e o link de abrir em nova aba');
  assert.equal(notes[0].getAttribute('role'), 'status');
}));

test('detalhes: MOV com imagem decodificada, e qualquer outro vídeo, não ganham explicação nenhuma', withKit(async kit => {
  let dialog = await detailsFor(kit, media());
  assert.doesNotMatch(loaded(kit, dialog, 160), NOTE, 'com imagem decodificada não há aviso');
  assert.equal(kit.all(dialog, '.detail-media p').length, 0);
  closeAllDialogs();

  dialog = await detailsFor(kit, media({ id: 'm2', type: 'video/mp4', name: 'clipe.mp4' }));
  assert.doesNotMatch(loaded(kit, dialog, 0), NOTE, 'a explicação é só do MOV: MP4 continua como antes');
  assert.equal(kit.all(dialog, '.detail-media p').length, 0);
}));
