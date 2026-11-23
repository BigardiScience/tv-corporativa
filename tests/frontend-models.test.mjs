// Regras do painel que não tocam a tela, testadas no Node: validação de arquivos antes do envio, fila de envio, seleção,
// árvore de pastas, filtros da biblioteca, rascunho de playlist, programações e telas. Nada do negócio é simulado:
// onde existe uma regra equivalente no servidor, o teste compara as duas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/js/lib/api.js';
import { ACCEPT, kindForMime, mimeForName, validateMediaFile } from '../public/js/lib/media-validation.js';
import { allowDuplicate, checkTitle, isPending, prepareFiles, retryItem, runUploads, summarize, titleFromFileName } from '../public/js/lib/uploads.js';
import { createSelection, folderKey, mediaKey } from '../public/js/lib/selection.js';
import { buildTree, descendantIds, destinationOptions, isInside, pathTo, subtreeHeight } from '../public/js/lib/tree.js';
import { PAGE_SIZE, defaultFilters, hasActiveFilters, isFlatListing, parseLibraryQuery, toApiQuery, toRouteQuery } from '../public/js/lib/library-query.js';
import { insertAt, moveItem, removeAt } from '../public/js/lib/reorder.js';
import * as playlistModel from '../public/js/lib/playlist-model.js';
import * as scheduleModel from '../public/js/lib/schedule-model.js';
import * as displayModel from '../public/js/lib/display-model.js';
import { KINDS, MIME, signature } from '../server/domain/formats.mjs';
import { SAMPLE_FILES, sampleFile } from './helpers/http.mjs';

const file = (bytes, name, type = '', extra = {}) => new File([bytes], name, { type, ...extra });
const MB = 1024 * 1024;

// ---- validação de arquivo antes do envio ----------------------------------------------------------------------------------

test('arquivos: orienta a exportar e recusa editáveis, macros e executáveis, mesmo disfarçados de tipo genérico', async () => {
  for (const name of ['slides.pptx', 'tabela.xlsm', 'projeto.psd', 'aplicativo.exe', 'documento.docx', 'script.js', 'pagina.html', 'sem-extensao', 'termina-com-ponto.']) {
    await assert.rejects(validateMediaFile(file('dados', name, 'application/octet-stream')), /^Error: Exporte o arquivo original para PDF, imagem ou vídeo antes de enviar\.$/, name);
  }
  assert.equal(mimeForName(undefined), null);
  assert.equal(mimeForName(''), null);
  assert.equal(mimeForName('a.b.c.png'), 'image/png');
  assert.equal(mimeForName('FOTO.JpG'), 'image/jpeg');
});

test('arquivos: vazio e acima do limite são recusados antes de ler o conteúdo; o limite é configurável e exato', async () => {
  await assert.rejects(validateMediaFile({ name: 'vazio.png', size: 0 }), /vazio/);
  await assert.rejects(validateMediaFile({ name: 'grande.png', size: 51 * MB }), /O arquivo tem 51 MB e o limite é de 50 MB\./);
  await assert.rejects(validateMediaFile({ name: 'grande.mp4', size: 3 * MB }, 2), /limite é de 2 MB/);

  const exactly = Buffer.concat([SAMPLE_FILES['.png'], Buffer.alloc(MB - SAMPLE_FILES['.png'].length)]);
  assert.equal(exactly.length, MB);
  assert.equal(await validateMediaFile(file(exactly, 'limite.png', 'image/png'), 1), 'image/png', 'exatamente no limite ainda passa');
  await assert.rejects(validateMediaFile(file(Buffer.concat([exactly, Buffer.from([0])]), 'passou.png', 'image/png'), 1), /limite é de 1 MB/);
});

test('arquivos: o conteúdo precisa confirmar a extensão (HTML com nome de PNG é recusado) e o tipo declarado não pode contradizê-la', async () => {
  const html = '<!doctype html><script>alert(1)</script>';
  await assert.rejects(validateMediaFile(file(html, 'disfarce.png', 'text/html')), /O tipo do arquivo não corresponde à extensão/);
  await assert.rejects(validateMediaFile(file(html, 'disfarce.png', 'image/png')), /O conteúdo do arquivo não corresponde ao formato informado/);
  await assert.rejects(validateMediaFile(file(html, 'disfarce.png', '')), /conteúdo do arquivo não corresponde/);
  await assert.rejects(validateMediaFile(file(sampleFile('.png', 'a'), 'foto.png', 'image/jpeg')), /tipo do arquivo não corresponde/);
  for (const name of ['a.jpg', 'a.jpeg', 'a.webp', 'a.mp4', 'a.mov', 'a.webm', 'a.pdf']) await assert.rejects(validateMediaFile(file(sampleFile('.png', 'x'), name)), /conteúdo do arquivo não corresponde/, name);

  // Formatos aceitos (tipo declarado igual, vazio ou genérico; extensão em qualquer caixa).
  for (const [extension, mime] of Object.entries(MIME)) {
    const bytes = SAMPLE_FILES[extension === '.jpeg' ? '.jpg' : extension];
    for (const declared of [mime, '', 'application/octet-stream']) assert.equal(await validateMediaFile(file(bytes, `arquivo${extension.toUpperCase()}`, declared)), mime, `${extension} (${declared || 'sem tipo'})`);
  }
});

test('arquivos: a conferência do navegador aceita e recusa exatamente o que o servidor aceita e recusa, em qualquer tamanho de arquivo', async () => {
  assert.equal(ACCEPT, Object.keys(MIME).join(','), 'a janela de escolha oferece os mesmos formatos que o servidor aceita');
  for (const [extension, mime] of Object.entries(MIME)) assert.equal(mimeForName(`x${extension}`), mime);
  for (const unknown of ['.gif', '.svg', '.bmp', '.html', '.zip']) assert.equal(mimeForName(`x${unknown}`), null, unknown);
  assert.deepEqual(['image', 'video', 'pdf'], [...KINDS]);
  for (const mime of new Set(Object.values(MIME))) assert.equal(kindForMime(mime), mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'pdf');
  assert.equal(kindForMime('text/plain'), 'other');
  assert.equal(kindForMime(undefined), 'other');

  const garbage = [Buffer.alloc(40, 0), Buffer.from('<html><body>oi</body></html>'), Buffer.from('MZ\x90\x00 executavel'), Buffer.from('PK\x03\x04 zip'), Buffer.from('GIF89a....')];
  for (const extension of Object.keys(MIME)) {
    const valid = SAMPLE_FILES[extension === '.jpeg' ? '.jpg' : extension];
    const samples = [...Array.from({ length: valid.length }, (_, index) => valid.subarray(0, index + 1)), valid, ...garbage];
    for (const sample of samples) {
      const server = signature(sample, extension);
      let client = true;
      try { await validateMediaFile(file(sample, `x${extension}`)); } catch { client = false; }
      assert.equal(client, server, `${extension} com ${sample.length} bytes começando por ${sample.subarray(0, 6).toString('hex')}`);
    }
  }
});

// ---- fila de envio ---------------------------------------------------------------------------------------------------------

test('envio: título sugerido a partir do nome do arquivo e verificação do título digitado', () => {
  assert.equal(titleFromFileName('Comunicado RH.png'), 'Comunicado RH');
  assert.equal(titleFromFileName('relatório.final.v2.pdf'), 'relatório.final.v2');
  assert.equal(titleFromFileName('a/b\\c.png'), 'a b c');
  assert.equal(titleFromFileName('  muitos    espaços  .png'), 'muitos espaços');
  assert.equal(titleFromFileName('sem extensão'), 'sem extensão');
  assert.equal(titleFromFileName('.png'), '.png');
  assert.equal(titleFromFileName(undefined), 'Arquivo');
  assert.equal(titleFromFileName(`${'x'.repeat(200)}.png`).length, 120);
  assert.equal(titleFromFileName('<img src=x onerror=1>.PNG'), '<img src=x onerror=1>', 'marcação no nome fica como texto (a tela nunca a interpreta)');

  assert.equal(checkTitle('Aviso'), '');
  assert.equal(checkTitle('  '), 'Informe um título.');
  assert.equal(checkTitle(undefined), 'Informe um título.');
  assert.match(checkTitle('x'.repeat(121)), /até 120 caracteres/);
  assert.match(checkTitle('a/b'), /barras/);
  assert.match(checkTitle('a\\b'), /barras/);
  assert.match(checkTitle('a\u0007b'), /barras/);
  assert.equal(checkTitle('x'.repeat(120)), '');
});

test('envio: prepara a fila validando cada arquivo e avisa sobre o mesmo arquivo escolhido duas vezes', async () => {
  const a = file(sampleFile('.png', 'a'), 'a.png', 'image/png', { lastModified: 1000 });
  const sameAgain = file(sampleFile('.png', 'a'), 'a.png', 'image/png', { lastModified: 1000 });
  const otherTime = file(sampleFile('.png', 'a'), 'a.png', 'image/png', { lastModified: 2000 });
  const bad = file('dados', 'planilha.xlsx');
  const first = await prepareFiles([a, bad, sameAgain, otherTime]);
  assert.deepEqual(first.map(item => item.status), ['ready', 'invalid', 'invalid', 'ready']);
  assert.equal(first[0].mime, 'image/png');
  assert.equal(first[0].title, 'a');
  assert.match(first[1].message, /Exporte o arquivo original/);
  assert.equal(first[2].message, 'Este arquivo já está na lista.');
  assert.deepEqual(first.map(item => item.id).length, new Set(first.map(item => item.id)).size, 'cada item tem identificador próprio');

  const again = await prepareFiles([file(sampleFile('.png', 'a'), 'a.png', 'image/png', { lastModified: 1000 })], { existing: first });
  assert.equal(again[0].status, 'invalid', 'também vale contra o que já estava na fila');
  const tooBig = await prepareFiles([{ name: 'enorme.png', size: 80 * MB }], { maxMB: 50 });
  assert.match(tooBig[0].message, /limite é de 50 MB/);
  assert.deepEqual(summarize(first), { total: 4, ready: 2, done: 0, duplicate: 0, failed: 2, canceled: 0, running: 0 });
  assert.equal(first.filter(isPending).length, 2);
});

test('envio: no máximo dois envios ao mesmo tempo, andamento por arquivo e resultado de cada um', async () => {
  const items = await prepareFiles(Array.from({ length: 6 }, (_, index) => file(sampleFile('.png', `f${index}`), `f${index}.png`, 'image/png', { lastModified: index + 1 })));
  let active = 0, peak = 0;
  const changes = new Map();
  const result = await runUploads(items, {
    concurrency: 2,
    send: async (item, { onProgress }) => {
      active++; peak = Math.max(peak, active);
      onProgress(0.5);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return { id: `m-${item.name}` };
    },
    onChange: item => { const list = changes.get(item.id) ?? []; list.push(`${item.status}:${item.progress}`); changes.set(item.id, list); }
  });
  assert.equal(peak, 2);
  assert.deepEqual(result, { total: 6, ready: 0, done: 6, duplicate: 0, failed: 0, canceled: 0, running: 0 });
  assert.deepEqual(items.map(item => item.result.id), items.map(item => `m-${item.name}`));
  assert.deepEqual(changes.get(items[0].id), ['uploading:0', 'uploading:0.5', 'done:1']);
});

test('envio: duplicado, falha e cancelamento têm cada um o seu estado; cada um pode ser retomado do jeito certo', async () => {
  const items = await prepareFiles(['dup', 'falha', 'sem-mensagem', 'cancelado', 'ok'].map((name, index) => file(sampleFile('.png', name), `${name}.png`, 'image/png', { lastModified: index + 1 })));
  const outcome = {
    dup: () => { throw new ApiError(409, 'Este arquivo já existe na biblioteca.', { code: 'DUPLICATE_MEDIA', details: { existing: { id: 'm9', title: 'Aviso geral' } } }); },
    falha: () => { throw new ApiError(415, 'Formato recusado pelo servidor.'); },
    'sem-mensagem': () => { throw new Error(''); },
    cancelado: () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); },
    ok: () => ({ id: 'novo' })
  };
  const summary = await runUploads(items, { concurrency: 1, send: item => outcome[item.name.replace('.png', '')]() });
  assert.deepEqual(items.map(item => item.status), ['duplicate', 'failed', 'failed', 'canceled', 'done']);
  assert.equal(items[0].message, 'Já existe na biblioteca como “Aviso geral”.');
  assert.deepEqual(items[0].existing, { id: 'm9', title: 'Aviso geral' });
  assert.equal(items[1].message, 'Formato recusado pelo servidor.');
  assert.equal(items[2].message, 'Não foi possível enviar este arquivo.');
  assert.equal(items[3].message, 'Envio cancelado.');
  assert.deepEqual(summary, { total: 5, ready: 0, done: 1, duplicate: 1, failed: 2, canceled: 1, running: 0 });

  items[0].progress = 0.9;
  allowDuplicate(items[0]);
  assert.deepEqual([items[0].status, items[0].allowDuplicate, items[0].message, items[0].progress], ['ready', true, '', 0], 'duplicado confirmado volta à fila com a autorização explícita e sem andamento antigo');
  items[1].progress = 0.4; items[1].result = { id: 'resultado-antigo' };
  retryItem(items[1]);
  assert.deepEqual([items[1].status, items[1].result, items[1].allowDuplicate, items[1].message, items[1].progress], ['ready', null, false, '', 0], 'tentar de novo limpa mensagem, andamento e resultado antigos e não autoriza duplicado');
  const second = await runUploads(items, { send: item => ({ id: `de-novo-${item.name}` }) });
  assert.equal(second.done, 3, 'só os itens prontos foram enviados de novo (o concluído e os que seguem com problema ficam como estão)');
  assert.equal(items[4].result.id, 'novo');
});

test('envio: cancelar interrompe o que está no ar e marca o restante da fila como cancelado, sem enviar mais nada', async () => {
  const items = await prepareFiles(Array.from({ length: 5 }, (_, index) => file(sampleFile('.png', `c${index}`), `c${index}.png`, 'image/png', { lastModified: index + 1 })));
  const controller = new AbortController();
  const sent = [];
  const summary = await runUploads(items, {
    concurrency: 1, signal: controller.signal,
    send: async item => { sent.push(item.name); if (sent.length === 2) controller.abort(); return { id: item.name }; }
  });
  assert.deepEqual(sent, ['c0.png', 'c1.png']);
  assert.deepEqual(items.map(item => item.status), ['done', 'done', 'canceled', 'canceled', 'canceled']);
  assert.equal(summary.canceled, 3);
  assert.equal(summary.done, 2);
});

// ---- seleção, pastas, filtros e ordem -------------------------------------------------------------------------------------

test('seleção: marcar, intervalo com Shift, podar o que sumiu e separar pastas de arquivos com o mesmo identificador', () => {
  const selection = createSelection();
  const order = ['f:1', 'f:2', 'm:1', 'm:2', 'm:3', 'm:4'];
  assert.equal(selection.toggle('m:1'), true);
  assert.equal(selection.toggle('m:1'), false);
  assert.equal(selection.size, 0);
  selection.toggle('f:1'); selection.toggle('m:1');
  assert.deepEqual(selection.ids(), { folderIds: ['1'], mediaIds: ['1'] }, 'pasta 1 e arquivo 1 não se confundem');
  assert.notEqual(folderKey('1'), mediaKey('1'));

  selection.clear();
  selection.range(order, 'm:3');
  assert.deepEqual(selection.keys, ['m:3'], 'sem marcação anterior, o Shift marca só o item');
  selection.toggle('m:1');
  selection.range(order, 'm:4');
  assert.deepEqual([...selection.keys].sort(), ['m:1', 'm:2', 'm:3', 'm:4'], 'do último marcado até o clicado, na ordem da tela');
  selection.range(order, 'item-que-nao-existe');
  assert.equal(selection.size, 4);
  selection.toggle('f:2');
  selection.range(order, 'f:1');
  assert.ok(selection.has('f:1') && selection.has('f:2'), 'o intervalo também funciona para trás');

  selection.prune(['m:1', 'm:3']);
  assert.deepEqual([...selection.keys].sort(), ['m:1', 'm:3']);
  selection.set(['m:9', 'f:9']);
  assert.deepEqual(selection.ids(), { folderIds: ['9'], mediaIds: ['9'] });
  selection.selectAll(order);
  assert.equal(selection.size, order.length + 2, 'selecionar tudo soma os itens visíveis ao que já estava marcado');
  selection.clear();
  assert.equal(selection.size, 0);
  assert.deepEqual(selection.ids(), { folderIds: [], mediaIds: [] });
});

const FOLDERS = [
  { id: 'a', name: 'Pasta 10', parentId: null, depth: 1 }, { id: 'b', name: 'Pasta 2', parentId: null, depth: 1 }, { id: 'c', name: 'Ágata', parentId: null, depth: 1 },
  { id: 'd', name: 'Filha', parentId: 'a', depth: 2 }, { id: 'e', name: 'Neta', parentId: 'd', depth: 3 }, { id: 'f', name: 'Órfã', parentId: 'nao-existe', depth: 2 }
];

test('pastas: árvore ordenada como pessoas esperam (acentos e números), caminhos, descendentes e destinos válidos', () => {
  const tree = buildTree(FOLDERS);
  assert.deepEqual(tree.roots.map(node => node.name), ['Ágata', 'Órfã', 'Pasta 2', 'Pasta 10'], 'ordem pt-BR com números ("2" antes de "10") e pasta sem pai vira raiz');
  assert.deepEqual(pathTo(tree, 'e').map(node => node.id), ['a', 'd', 'e']);
  assert.deepEqual(pathTo(tree, null), []);
  assert.deepEqual(pathTo(tree, 'desconhecida'), []);
  assert.equal(isInside(tree, 'a', 'e'), true);
  assert.equal(isInside(tree, 'e', 'a'), false);
  assert.equal(isInside(tree, 'a', 'a'), true);
  assert.equal(isInside(tree, 'b', 'e'), false);
  assert.deepEqual(descendantIds(tree, 'a'), ['d', 'e']);
  assert.deepEqual(descendantIds(tree, 'e'), []);
  assert.deepEqual(descendantIds(tree, 'x'), []);
  assert.equal(subtreeHeight(tree, 'a'), 3);
  assert.equal(subtreeHeight(tree, 'e'), 1);
  assert.equal(subtreeHeight(tree, 'x'), 0);

  const options = destinationOptions(tree, { blocked: ['a'] });
  assert.deepEqual(options.map(option => [option.name, option.level, option.disabled]), [
    ['Ágata', 1, false], ['Órfã', 1, false], ['Pasta 2', 1, false], ['Pasta 10', 1, true], ['Filha', 2, true], ['Neta', 3, true]
  ], 'mover uma pasta para dentro dela mesma ou das suas filhas não é oferecido');
  const deep = destinationOptions(tree, { maxDepth: 3, movingDepth: 1 });
  assert.deepEqual(deep.filter(option => option.disabled).map(option => option.id), ['e'], 'o limite de níveis também bloqueia destinos');
});

test('biblioteca: filtros viram endereço e consulta; valores inventados no endereço voltam ao padrão', () => {
  const defaults = defaultFilters();
  assert.deepEqual(parseLibraryQuery({}), defaults);
  assert.deepEqual(toRouteQuery(defaults), {});
  const parsed = parseLibraryQuery({ q: '  regras  ', tipo: 'pdf', situacao: 'pending', ordenar: 'date', ordem: 'desc', plano: '1', tudo: '1' });
  assert.deepEqual(parsed, { q: 'regras', type: 'pdf', status: 'pending', sort: 'date', order: 'desc', flat: true, wholeSpace: true });
  assert.deepEqual(parseLibraryQuery(toRouteQuery(parsed)), parsed, 'ida e volta sem perder nada');
  assert.deepEqual(toRouteQuery({ ...defaults, order: 'desc' }), { ordem: 'desc' }, 'só o que difere do padrão entra no endereço');
  assert.deepEqual(parseLibraryQuery({ tipo: 'exe', situacao: 'hackeado', ordenar: 'senha', ordem: 'sideways', plano: 'sim' }), defaults);
  assert.equal(parseLibraryQuery({ q: 'x'.repeat(300) }).q.length, 100);

  const space = { unitId: 'u1', sectorId: 's1' };
  assert.deepEqual(toApiQuery({ space, folderId: null, filters: defaults }), { unitId: 'u1', sectorId: 's1', limit: PAGE_SIZE, offset: 0, sort: 'name', order: 'asc' });
  assert.deepEqual(toApiQuery({ space, folderId: 'p1', offset: 60, filters: { ...parsed, wholeSpace: true } }), {
    unitId: 'u1', sectorId: 's1', limit: PAGE_SIZE, offset: 60, sort: 'date', order: 'desc', folderId: 'p1', q: 'regras', type: 'pdf', status: 'pending', flat: '1', search: 'space'
  });
  assert.equal(toApiQuery({ space, folderId: null, filters: { ...defaults, wholeSpace: true } }).search, undefined, 'pesquisar em todo o espaço só vale com texto digitado');
  assert.equal(hasActiveFilters(defaults), false);
  assert.equal(hasActiveFilters({ ...defaults, sort: 'size', order: 'desc' }), false, 'ordenar não é filtrar');
  for (const patch of [{ q: 'a' }, { type: 'image' }, { status: 'approved' }, { flat: true }]) assert.equal(hasActiveFilters({ ...defaults, ...patch }), true);
  assert.equal(isFlatListing({ query: { flat: true } }), true);
  assert.equal(isFlatListing({ query: {} }), false);
  assert.equal(isFlatListing(null), false);
});

test('ordem: mover, inserir e remover nunca alteram a lista original e respeitam os limites', () => {
  const list = ['a', 'b', 'c', 'd'];
  const frozen = Object.freeze([...list]);
  assert.deepEqual(moveItem(frozen, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(frozen, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(frozen, 1, 1), list);
  assert.deepEqual(moveItem(frozen, -1, 2), list);
  assert.deepEqual(moveItem(frozen, 9, 0), list);
  assert.deepEqual(moveItem(frozen, 0, 99), ['b', 'c', 'd', 'a'], 'destino além do fim vai para o fim');
  assert.deepEqual(moveItem(frozen, 2, -5), ['c', 'a', 'b', 'd'], 'destino antes do começo vai para o começo');
  assert.deepEqual(moveItem(frozen, 2, -1), ['c', 'a', 'b', 'd'], '-1 não significa "antes do último": também vai para o começo');
  assert.deepEqual(insertAt(frozen, 1, 'x'), ['a', 'x', 'b', 'c', 'd']);
  assert.deepEqual(insertAt(frozen, 99, 'x'), ['a', 'b', 'c', 'd', 'x']);
  assert.deepEqual(insertAt(frozen, -3, 'x'), ['x', 'a', 'b', 'c', 'd']);
  assert.deepEqual(insertAt(frozen, -1, 'x'), ['x', 'a', 'b', 'c', 'd'], '-1 também vai para o começo');
  assert.deepEqual(removeAt(frozen, 2), ['a', 'b', 'd']);
  assert.deepEqual(removeAt(frozen, 9), list);
  assert.deepEqual(frozen, list);
});

// ---- playlist --------------------------------------------------------------------------------------------------------------

const media = (patch = {}) => ({ id: 'm1', title: 'Aviso', name: 'aviso.png', type: 'image/png', status: 'approved', scanStatus: 'clean', folderId: null, url: '/media/m1', ...patch });

test('playlist: tempo e duração da transição ficam sempre em valores aceitos pelo servidor', () => {
  const { clampDuration, clampTransitionMs, DEFAULT_DURATION, DEFAULT_TRANSITION_MS, MIN_DURATION, MAX_DURATION, MAX_TRANSITION_MS } = playlistModel;
  assert.deepEqual([clampDuration(10), clampDuration('20'), clampDuration(7.6), clampDuration(1), clampDuration(0), clampDuration(-4), clampDuration(99999)], [10, 20, 8, MIN_DURATION, MIN_DURATION, MIN_DURATION, MAX_DURATION]);
  assert.deepEqual([clampDuration('abc'), clampDuration(undefined), clampDuration(NaN)], [DEFAULT_DURATION, DEFAULT_DURATION, DEFAULT_DURATION]);
  assert.deepEqual([clampTransitionMs(600), clampTransitionMs(-1), clampTransitionMs(99999), clampTransitionMs('x')], [600, 0, MAX_TRANSITION_MS, DEFAULT_TRANSITION_MS]);
});

test('playlist: a situação de cada conteúdo segue a regra do servidor (aprovado e, em produção, verificado)', () => {
  const { readinessOf } = playlistModel;
  assert.equal(readinessOf(media({ status: 'rejected' })), 'rejected');
  assert.equal(readinessOf(media({ status: 'pending' })), 'pending');
  assert.equal(readinessOf(media({ status: 'approved' })), 'ready');
  assert.equal(readinessOf(media({ status: 'approved', scanStatus: 'not_configured' })), 'ready', 'em ambiente local, sem antivírus, aprovado basta');
  assert.equal(readinessOf(media({ status: 'approved', scanStatus: 'not_configured' }), { production: true }), 'not_scanned');
  assert.equal(readinessOf(media({ status: 'approved', scanStatus: 'clean' }), { production: true }), 'ready');
  assert.equal(readinessOf(media({ status: 'rejected', scanStatus: 'clean' }), { production: true }), 'rejected');
  assert.equal(readinessOf(media({ status: 'pending', scanStatus: 'clean' }), { production: true }), 'pending');
});

test('playlist: item novo, rascunho vindo do servidor e o que é enviado ao salvar', () => {
  const { newItem, fromServer, toPayloadItems, snapshot, totalSeconds, notReady, validateDraft } = playlistModel;
  const first = newItem(media(), { durationS: 12 }), second = newItem(media({ id: 'm2', status: 'pending' }), { durationS: 2, production: true });
  assert.notEqual(first.key, second.key, 'cada item tem chave própria (o mesmo arquivo pode entrar duas vezes)');
  assert.deepEqual([first.durationS, first.transition, first.transitionMs, first.readiness], [12, 'cut', 0, 'ready']);
  assert.deepEqual([second.durationS, second.readiness], [playlistModel.MIN_DURATION, 'pending']);
  assert.deepEqual(Object.keys(first.media).sort(), ['folderId', 'id', 'name', 'scanStatus', 'status', 'title', 'type', 'url']);

  const loaded = fromServer({
    id: 'p1', draftRev: 4, name: 'Boas-vindas', description: null,
    items: [{ mediaId: 'm1', durationS: 10, transition: 'fade', transitionMs: 500, media: media(), readiness: 'ready' }, { mediaId: 'm1', durationS: 20, transition: 'cut', transitionMs: 0, media: media(), readiness: 'ready' }]
  });
  assert.deepEqual([loaded.id, loaded.rev, loaded.name, loaded.description], ['p1', 4, 'Boas-vindas', '']);
  assert.notEqual(loaded.items[0].key, loaded.items[1].key);

  const draft = { ...loaded, items: [{ ...loaded.items[0], transition: 'cut', transitionMs: 900, durationS: 1 }, { ...loaded.items[1], transition: 'fade', transitionMs: 99999, durationS: 20 }] };
  assert.deepEqual(toPayloadItems(draft.items), [
    { mediaId: 'm1', durationS: 5, durationMode: 'fixed', transition: 'cut', transitionMs: 0 },
    { mediaId: 'm1', durationS: 20, durationMode: 'fixed', transition: 'fade', transitionMs: 3000 }
  ], 'corte seco nunca leva duração de transição; valores fora do limite são ajustados');
  assert.equal(totalSeconds(draft.items), 25);
  assert.equal(totalSeconds([]), 0);

  assert.equal(snapshot(draft), snapshot({ ...draft, name: `  ${draft.name}  `, description: '  ' }), 'espaços sobrando não contam como alteração');
  assert.notEqual(snapshot(draft), snapshot({ ...draft, name: 'Outro nome' }));
  assert.notEqual(snapshot(draft), snapshot({ ...draft, items: [...draft.items].reverse() }), 'mudar a ordem é alteração');
  assert.notEqual(snapshot(draft), snapshot({ ...draft, items: [{ ...draft.items[0], durationS: 6 }, draft.items[1]] }));

  assert.deepEqual(notReady([first, second]).map(item => item.mediaId), ['m2']);
  assert.deepEqual(validateDraft(draft, 10), []);
  assert.deepEqual(validateDraft({ ...draft, name: '  ' }, 10), ['Informe o nome da playlist.']);
  assert.deepEqual(validateDraft({ ...draft, name: 'x'.repeat(121) }, 10), ['O nome pode ter até 120 caracteres.']);
  assert.deepEqual(validateDraft(draft, 1), ['Uma playlist aceita até 1 conteúdos.']);
  assert.deepEqual(validateDraft({ ...draft, items: [draft.items[0], { ...draft.items[1], readiness: 'rejected', media: media({ title: 'Cartaz' }) }] }, 10), ['O item 2 (“Cartaz”) foi rejeitado e precisa sair da playlist.']);
  assert.deepEqual(validateDraft({ ...draft, items: [{ ...draft.items[0], readiness: 'pending' }] }, 10), [], 'pendente pode ficar no rascunho; só não vai ao ar');
});

test('playlist: vídeo escolhe entre tempo definido (limite) e tocar até o fim; os demais tipos ignoram o modo', () => {
  const { fromServer, newItem, toPayloadItems, snapshot, isNaturalItem, isVideoItem } = playlistModel;
  const video = media({ id: 'v1', title: 'Institucional', name: 'inst.mp4', type: 'video/mp4' });
  const loaded = fromServer({
    id: 'p1', draftRev: 2, name: 'Mix', loop: false,
    items: [
      { mediaId: 'v1', durationS: 30, durationMode: 'natural', transition: 'fade', transitionMs: 400, media: video, readiness: 'ready' },
      { mediaId: 'm1', durationS: 10, durationMode: 'natural', transition: 'cut', transitionMs: 0, media: media(), readiness: 'ready' },
      { mediaId: 'v1', durationS: 20, transition: 'cut', transitionMs: 0, media: video, readiness: 'ready' }
    ]
  });
  assert.equal(loaded.loop, false, 'a repetição vem do servidor');
  assert.equal(fromServer({ id: 'p2', draftRev: 1, name: 'x', items: [] }).loop, true, 'sem informação, a playlist repete (padrão antigo)');
  assert.deepEqual(loaded.items.map(item => item.durationMode), ['natural', 'natural', 'fixed'], 'item sem modo (servidor antigo) é tempo definido');
  assert.deepEqual([isVideoItem(loaded.items[0]), isVideoItem(loaded.items[1])], [true, false]);
  assert.deepEqual([isNaturalItem(loaded.items[0]), isNaturalItem(loaded.items[1]), isNaturalItem(loaded.items[2])], [true, false, false], 'imagem nunca é "até o fim", mesmo que o rascunho diga isso');
  assert.deepEqual(toPayloadItems(loaded.items).map(item => item.durationMode), ['natural', 'fixed', 'fixed'], 'o servidor recusa duração natural fora de vídeo: o modelo nunca envia');
  assert.equal(newItem(video).durationMode, 'fixed', 'item novo começa com tempo definido');

  const draft = { ...loaded };
  assert.notEqual(snapshot(draft), snapshot({ ...draft, loop: true }), 'mudar a repetição é alteração não salva');
  assert.notEqual(snapshot(draft), snapshot({ ...draft, items: [{ ...draft.items[0], durationMode: 'fixed' }, ...draft.items.slice(1)] }), 'mudar o modo é alteração não salva');
  assert.equal(snapshot(draft), snapshot({ ...draft, items: [draft.items[0], { ...draft.items[1], durationMode: 'fixed' }, draft.items[2]] }), 'modo inválido numa imagem não conta como alteração');
});

test('playlist: duração do ciclo e textos de tempo contam vídeos com limite ("até") e vídeos até o fim', () => {
  const { cycleOf, cycleLabel, cycleSentence, totalSeconds, timingText, timingSentence, effectText, describeItem } = playlistModel;
  const image = (durationS, extra = {}) => ({ mediaId: 'm1', durationS, durationMode: 'fixed', transition: 'cut', transitionMs: 0, media: media(), readiness: 'ready', ...extra });
  const video = (durationS, durationMode = 'fixed', extra = {}) => ({ ...image(durationS, extra), mediaId: 'v1', durationMode, media: media({ id: 'v1', type: 'video/mp4' }) });

  assert.deepEqual(cycleOf([image(20), image(30)]), { seconds: 50, naturalVideos: 0, limitedVideos: 0 });
  assert.equal(cycleSentence([image(20), image(30)]), 'um ciclo completo dura 50 s', 'só imagens: o texto antigo, sem mudança');
  assert.equal(cycleSentence([]), 'um ciclo completo dura 0 s');
  assert.equal(cycleLabel([image(20), video(30)]), 'até 50 s', 'vídeo com tempo definido é um limite: o ciclo pode ser mais curto');
  assert.equal(cycleLabel([image(20), video(30, 'natural')]), '20 s mais a duração do vídeo');
  assert.equal(cycleLabel([image(65), video(30, 'natural'), video(15, 'natural')]), '1 min 5 s mais a duração dos 2 vídeos');
  assert.equal(cycleLabel([video(30, 'natural')]), 'duração do vídeo');
  assert.equal(cycleSentence([video(30, 'natural'), video(40, 'natural')]), 'um ciclo completo equivale à duração dos 2 vídeos');
  assert.equal(cycleSentence([video(30), video(40, 'natural')]), 'um ciclo completo dura até 30 s mais a duração do vídeo');
  assert.equal(totalSeconds([image(20), video(30, 'natural')]), 20, 'o tempo de reserva de um vídeo até o fim não entra na soma');

  assert.equal(timingText(image(20)), '20 s');
  assert.equal(timingText(video(20)), 'até 20 s');
  assert.equal(timingText(video(20, 'natural')), 'até o fim do vídeo');
  assert.equal(timingSentence(image(75)), 'exibe por 1 min 15 s');
  assert.equal(timingSentence(video(20)), 'toca por até 20 s');
  assert.equal(timingSentence(video(20, 'natural')), 'toca até o fim do vídeo');
  assert.equal(effectText(image(20)), '', 'corte seco não é descrito como efeito');
  assert.equal(effectText(image(20, { transition: 'slide', transitionMs: 900 })), 'Deslizar 900 ms');
  assert.equal(effectText(image(20, { transition: 'constructor', transitionMs: 900 })), 'constructor 900 ms', 'efeito desconhecido não herda nada do objeto de rótulos');
  assert.equal(describeItem(video(20, 'natural', { transition: 'zoom', transitionMs: 3500 })), 'até o fim do vídeo · Zoom 3000 ms');
  assert.equal(describeItem(image(20)), '20 s');
});

test('playlist: o que a pré-visualização recebe é o mesmo formato do manifesto da TV, sem rejeitados nem excluídos', () => {
  const { toPlaybackItems, isPlayable } = playlistModel;
  const base = { mediaId: 'm1', durationS: 12, durationMode: 'fixed', transition: 'fade', transitionMs: 500, media: media({ url: '/api/media/m1/file' }), readiness: 'ready' };
  const video = { ...base, mediaId: 'v1', durationMode: 'natural', transition: 'cut', transitionMs: 900, media: media({ id: 'v1', title: 'Clipe', name: 'c.mp4', type: 'video/mp4', url: '/api/media/v1/file' }) };
  const items = [
    base, video,
    { ...base, readiness: 'rejected' },
    { ...base, readiness: 'deleted', media: { ...base.media, url: null } },
    { ...base, mediaId: 'p1', readiness: 'pending', media: media({ id: 'p1', title: 'Cartaz', type: 'application/pdf', url: '/api/media/p1/file' }) }
  ];
  assert.deepEqual(items.map(isPlayable), [true, true, false, false, true], 'pendente de aprovação pode ser conferido na prévia; rejeitado e excluído não');
  assert.deepEqual(toPlaybackItems(items), [
    { id: 'm1', title: 'Aviso', name: 'aviso.png', type: 'image/png', url: '/api/media/m1/file', duration: 12, durationMode: 'fixed', transition: 'fade', transitionMs: 500 },
    { id: 'v1', title: 'Clipe', name: 'c.mp4', type: 'video/mp4', url: '/api/media/v1/file', duration: 12, durationMode: 'natural', transition: 'cut', transitionMs: 0 },
    { id: 'p1', title: 'Cartaz', name: 'aviso.png', type: 'application/pdf', url: '/api/media/p1/file', duration: 12, durationMode: 'fixed', transition: 'fade', transitionMs: 500 }
  ]);
  assert.deepEqual(toPlaybackItems([{ ...base, durationS: 1, transitionMs: 99999 }]).map(item => [item.duration, item.transitionMs]), [[5, 3000]], 'mesmos limites do servidor');
});

// ---- programações e telas -----------------------------------------------------------------------------------------------

const NOW = Date.parse('2026-10-22T12:00:00Z');

test('programação: o formulário explica cada problema antes de enviar (mesmas regras do servidor)', () => {
  const { validateSchedule } = scheduleModel;
  const ok = { name: 'Semana da segurança', playlistId: 'p1', startAt: '2026-10-23T08:00:00Z', endAt: '2026-10-30T18:00:00Z', displayIds: ['d1'], publish: true };
  assert.deepEqual(validateSchedule(ok, NOW), []);
  assert.deepEqual(validateSchedule({}, NOW), ['Informe o nome da programação.', 'Escolha a playlist.']);
  assert.deepEqual(validateSchedule({ ...ok, name: 'x'.repeat(121) }, NOW), ['O nome pode ter até 120 caracteres.']);
  assert.deepEqual(validateSchedule({ ...ok, startAt: 'ontem', endAt: 'amanhã' }, NOW), ['A data de início é inválida.', 'A data de término é inválida.']);
  assert.deepEqual(validateSchedule({ ...ok, endAt: '2026-10-22T11:59:59Z' }, NOW), ['O término deve ser no futuro.']);
  assert.deepEqual(validateSchedule({ ...ok, startAt: '2026-10-30T18:00:00Z', endAt: '2026-10-30T18:00:00Z' }, NOW), ['O término deve ser depois do início.']);
  assert.deepEqual(validateSchedule({ ...ok, startAt: '', endAt: '' }, NOW), [], 'sem datas: começa agora e não termina');
  assert.deepEqual(validateSchedule({ ...ok, displayIds: [] }, NOW), ['Escolha ao menos uma TV para publicar.']);
  assert.deepEqual(validateSchedule({ ...ok, displayIds: [], publish: false }, NOW), [], 'rascunho pode ficar sem TV');
});

test('programação: período, calendário do cartão, rótulos de versão e ações disponíveis em cada situação', () => {
  const { windowLabel, tileOf, matchesState, versionOptionLabel, scheduleActions, STATE_FILTERS } = scheduleModel;
  assert.equal(windowLabel({}), 'Início imediato → Sem data de término');
  assert.match(windowLabel({ startAt: '2026-10-05T14:30:00Z', endAt: '2026-10-06T18:00:00Z' }, { timeZone: 'UTC' }), /^05\/10\/2026,? 14:30 → 06\/10\/2026,? 18:00$/);
  assert.deepEqual(tileOf({}), { day: null, month: 'Contínuo' });
  assert.deepEqual(tileOf({ startAt: 'lixo' }), { day: null, month: 'Contínuo' });
  const tile = tileOf({ startAt: '2026-10-05T12:00:00Z' }, { timeZone: 'UTC' });
  assert.equal(tile.day, '05');
  assert.match(tile.month, /^out\.?$/i);
  assert.ok(!tile.month.includes('.'));

  assert.deepEqual(STATE_FILTERS[0], ['', 'Todas']);
  assert.equal(matchesState({ state: 'live' }, ''), true);
  assert.equal(matchesState({ state: 'live' }, 'live'), true);
  assert.equal(matchesState({ state: 'live' }, 'draft'), false);

  assert.equal(versionOptionLabel({ version: 3, itemCount: 1, note: 'revisão do RH' }, 3), 'Versão 3 (mais recente) · 1 conteúdo · revisão do RH');
  assert.equal(versionOptionLabel({ version: 2, itemCount: 5 }, 3), 'Versão 2 · 5 conteúdos');

  const full = { canCreate: true, canPublish: true }, creator = { canCreate: true, canPublish: false }, publisher = { canCreate: false, canPublish: true }, none = { canCreate: false, canPublish: false };
  assert.deepEqual(scheduleActions({ status: 'draft', newerVersionAvailable: true }, full), { publish: true, stop: false, edit: true, remove: true, updateVersion: true });
  assert.deepEqual(scheduleActions({ status: 'draft' }, creator), { publish: false, stop: false, edit: true, remove: true, updateVersion: undefined });
  assert.deepEqual(scheduleActions({ status: 'published', newerVersionAvailable: true }, full), { publish: false, stop: true, edit: true, remove: false, updateVersion: true });
  assert.deepEqual(scheduleActions({ status: 'published' }, creator), { publish: false, stop: false, edit: false, remove: false, updateVersion: undefined }, 'quem só cria não altera o que está publicado');
  assert.deepEqual(scheduleActions({ status: 'stopped' }, publisher), { publish: true, stop: false, edit: true, remove: true, updateVersion: undefined });
  for (const status of ['draft', 'published', 'stopped']) {
    const actions = scheduleActions({ status, newerVersionAvailable: true }, none);
    assert.deepEqual(Object.values(actions).map(Boolean), [false, false, false, false, false], `sem permissão nada é oferecido (${status})`);
  }
});

test('telas: situação do pareamento, ações disponíveis, nome, código e último contato', () => {
  const { pairingState, displayActions, validateDisplayName, expiryLabel, spokenCode, contactLabel } = displayModel;
  assert.deepEqual(pairingState({ status: 'pending' }), { key: 'inactive', label: 'Aguardando ativação', tone: 'warning' });
  assert.deepEqual(pairingState({ status: 'active', pairingOpen: true, paired: true }), { key: 'open', label: 'Código aberto, aguardando a TV', tone: 'warning' });
  assert.deepEqual(pairingState({ status: 'active', paired: true }), { key: 'paired', label: 'Pareada', tone: '' });
  assert.deepEqual(pairingState({ status: 'active' }), { key: 'none', label: 'Sem código ativo', tone: 'neutral' });

  const can = { activate: true, update: true, delete: false };
  assert.deepEqual(displayActions({ status: 'pending' }, can), { activate: true, pairing: false, generateCode: false, rename: true, remove: false });
  assert.deepEqual(displayActions({ status: 'active' }, can), { activate: false, pairing: true, generateCode: false, rename: true, remove: false });
  assert.deepEqual(displayActions({ status: 'active' }, {}), { activate: false, pairing: false, generateCode: false, rename: false, remove: false });
  // Editor e Gestor (permissão própria): só gera código de TV ativa e sem os poderes de administração; o Administrador usa o botão de renovação.
  assert.deepEqual(displayActions({ status: 'active' }, { pair: true }), { activate: false, pairing: false, generateCode: true, rename: false, remove: false });
  assert.equal(displayActions({ status: 'pending' }, { pair: true }).generateCode, false);
  assert.equal(displayActions({ status: 'active' }, { pair: false }).generateCode, false);
  assert.equal(displayActions({ status: 'active' }, { ...can, pair: true }).generateCode, false, 'quem administra TVs não ganha um segundo botão');

  assert.deepEqual(validateDisplayName('  '), ['Informe o nome da TV.']);
  assert.deepEqual(validateDisplayName(undefined), ['Informe o nome da TV.']);
  assert.deepEqual(validateDisplayName('x'.repeat(121)), ['O nome pode ter até 120 caracteres.']);
  assert.deepEqual(validateDisplayName('TV da recepção'), []);

  assert.equal(expiryLabel('2026-10-22T14:32:00Z', { timeZone: 'UTC' }), 'até 14:32');
  assert.equal(expiryLabel('lixo'), '');
  assert.equal(spokenCode('123456'), '123 456');
  assert.equal(spokenCode('12-34-56'), '123 456');
  assert.equal(spokenCode('12345'), '12345', 'só códigos de 6 números são separados');
  assert.equal(spokenCode(undefined), '');

  assert.equal(contactLabel({ status: 'pending', createdAt: '2026-10-22T09:00:00Z' }, NOW), 'Cadastrada há 3 h');
  assert.equal(contactLabel({ status: 'active', lastSeen: '2026-10-22T11:30:00Z' }, NOW), 'Último contato: há 30 min');
  assert.equal(contactLabel({ status: 'active', lastSeen: null }, NOW), 'Ainda sem contato com o servidor');
});
