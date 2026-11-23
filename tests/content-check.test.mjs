// Conferência do conteúdo de JPEG e MOV no envio (server/domain/content-check.mjs): o arquivo inteiro precisa estar completo e,
// no MOV, ter imagem em um codec que o player reproduz. Usa imagens e vídeos reais (tests/fixtures/media) e arquivos montados byte a byte.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkContent, inspectJpeg, inspectQuickTime } from '../server/domain/content-check.mjs';
import { HttpError } from '../server/lib/errors.mjs';
import { JPEG, atom, buildMov, jpegWith } from './helpers/media-files.mjs';

const fixture = name => readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url));
// Executa `fn` e devolve o erro lançado (ou null).
const thrown = fn => { try { fn(); } catch (error) { return error; } return null; };
const codeOf = fn => thrown(fn)?.code ?? null;

// Posição do cabeçalho do quadro (SOF0) no JPEG de exemplo: FF C0, tamanho 17 (3 componentes).
const SOF = JPEG.indexOf(Buffer.from([0xff, 0xc0, 0x00, 0x11]));
const withByte = (bytes, at, value) => { const copy = Buffer.from(bytes); copy[at] = value; return copy; };

// ---- JPEG ------------------------------------------------------------------------------------------------------------------------

test('JPEG: aceita imagens de codificadores e variantes diferentes, com dados depois do fim da imagem', () => {
  assert.ok(SOF > 0, 'o exemplo tem o cabeçalho de quadro esperado');
  assert.deepEqual(inspectJpeg(JPEG), { width: 16, height: 16, components: 3, progressive: false });
  assert.deepEqual(inspectJpeg(jpegWith('comentário dentro do arquivo')), { width: 16, height: 16, components: 3, progressive: false });
  assert.deepEqual(inspectJpeg(fixture('progressive.jpg')), { width: 96, height: 54, components: 3, progressive: true });
  assert.deepEqual(inspectJpeg(fixture('gray.jpg')), { width: 96, height: 54, components: 1, progressive: false });
  assert.deepEqual(inspectJpeg(fixture('cmyk.jpg')), { width: 96, height: 54, components: 4, progressive: false });
  assert.deepEqual(inspectJpeg(fixture('restart.jpg')), { width: 96, height: 54, components: 3, progressive: false }, 'marcadores de reinício fazem parte dos dados');

  // Fotos de celular guardam outras imagens, mapas de ganho ou vídeo curto depois do fim da imagem principal.
  assert.equal(inspectJpeg(Buffer.concat([JPEG, Buffer.from('anexo depois do EOI')])).width, 16);
  assert.equal(inspectJpeg(Buffer.concat([JPEG, JPEG])).width, 16);
  assert.equal(inspectJpeg(Buffer.concat([JPEG, Buffer.alloc(64)])).width, 16, 'preenchimento de zeros no fim');
});

test('JPEG: arquivo cortado em qualquer posição é recusado como incompleto (inclusive sem o marcador final)', () => {
  for (const sample of [JPEG, fixture('progressive.jpg'), fixture('restart.jpg'), fixture('cmyk.jpg')]) {
    for (let cut = 4; cut < sample.length; cut++) {
      assert.equal(codeOf(() => inspectJpeg(sample.subarray(0, cut))), 'MEDIA_INCOMPLETE', `cortado em ${cut} de ${sample.length} bytes`);
    }
  }
  // Menos que a assinatura: nem chega a ser um JPEG.
  const tiny = thrown(() => inspectJpeg(Buffer.from([0xff, 0xd8])));
  assert.equal(tiny.message, 'O conteúdo não corresponde ao formato do arquivo.');
  assert.equal(tiny.code, undefined);
});

test('JPEG: estrutura inválida ou codificação que o navegador não exibe é recusada com orientação', () => {
  const incomplete = bytes => assert.equal(codeOf(() => inspectJpeg(bytes)), 'MEDIA_INCOMPLETE');
  // Só o cabeçalho "JFIF" com texto qualquer depois (o que a verificação por assinatura sozinha aceitaria).
  incomplete(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-teste-jpg')]));
  incomplete(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.alloc(200, 0x41)]));
  // Dimensão zero, quantidade de componentes impossível e tamanho do cabeçalho incoerente.
  // Posições a partir do marcador SOF: +2 tamanho (2 bytes), +4 precisão, +5 altura (2 bytes), +7 largura (2 bytes), +9 componentes.
  incomplete(withByte(withByte(JPEG, SOF + 7, 0), SOF + 8, 0)); // largura 0
  incomplete(withByte(withByte(JPEG, SOF + 5, 0), SOF + 6, 0)); // altura 0
  incomplete(withByte(JPEG, SOF + 9, 2)); // 2 componentes: não existe
  incomplete(withByte(JPEG, SOF + 9, 1)); // 1 componente, mas o cabeçalho tem o tamanho de 3
  incomplete(withByte(JPEG, SOF + 2, 0x10)); // segmento do quadro maior que o arquivo
  // Tamanho de segmento além do fim do arquivo.
  const dqt = JPEG.indexOf(Buffer.from([0xff, 0xdb]));
  incomplete(withByte(withByte(JPEG, dqt + 2, 0xff), dqt + 3, 0xff));
  // Varredura antes do quadro e dois quadros na mesma imagem.
  const sosAt = JPEG.indexOf(Buffer.from([0xff, 0xda]));
  incomplete(Buffer.concat([JPEG.subarray(0, 2), JPEG.subarray(sosAt)]));
  const frame = JPEG.subarray(SOF, SOF + 19);
  incomplete(Buffer.concat([JPEG.subarray(0, SOF + 19), frame, JPEG.subarray(SOF + 19)]));
  // Marcador sem tamanho (reinício) fora dos dados da imagem.
  incomplete(Buffer.concat([JPEG.subarray(0, 2), Buffer.from([0xff, 0xd0]), JPEG.subarray(2)]));

  // Codificações válidas, mas que os navegadores não exibem: sem perdas (SOF3), aritmética (SOF9) e 12 bits.
  const unsupported = bytes => { const error = thrown(() => inspectJpeg(bytes)); assert.equal(error?.code, 'MEDIA_UNSUPPORTED'); assert.match(error.message, /Exporte como JPEG comum/); };
  unsupported(withByte(JPEG, SOF + 1, 0xc3));
  unsupported(withByte(JPEG, SOF + 1, 0xc9));
  unsupported(withByte(JPEG, SOF + 4, 12));
  assert.equal(inspectJpeg(withByte(JPEG, SOF + 1, 0xc1)).width, 16, 'sequencial estendido é exibido pelos navegadores');
});

// ---- MOV -------------------------------------------------------------------------------------------------------------------------

test('MOV: aceita H.264 e HEVC (inclusive Dolby Vision) em qualquer organização válida do arquivo', () => {
  const ok = (options, expected) => assert.deepEqual({ ...inspectQuickTime(buildMov(options)) }, { brand: 'qt  ', codec: 'avc1', width: 64, height: 36, audio: false, fragmented: false, ...expected });
  ok({});
  ok({ moovFirst: true });
  ok({ codec: 'avc3' }, { codec: 'avc3' });
  ok({ codec: 'hvc1' }, { codec: 'hvc1' });
  ok({ codec: 'hev1' }, { codec: 'hev1' });
  ok({ codec: 'dvh1' }, { codec: 'dvh1' });
  ok({ fragmented: true }, { fragmented: true });
  ok({ wideMdat: true }, {});
  ok({ wideMdat: true, moovFirst: true }, {});
  ok({ brand: null }, { brand: null }); // arquivos antigos começam direto pelos dados
  ok({ brand: 'isom' }, { brand: 'isom' });
  ok({ width: 1920, height: 1080 }, { width: 1920, height: 1080 });

  // Arquivos reais, gravados por um codificador de verdade.
  assert.deepEqual({ ...inspectQuickTime(fixture('h264-aac.mov')) }, { brand: 'qt  ', codec: 'avc1', width: 160, height: 90, audio: true, fragmented: false });
  assert.deepEqual({ ...inspectQuickTime(fixture('hevc-aac.mov')) }, { brand: 'qt  ', codec: 'hvc1', width: 160, height: 90, audio: true, fragmented: false });

  // O último bloco pode ir "até o fim do arquivo" (tamanho 0) e arquivos antigos terminam com zeros de preenchimento.
  const base = buildMov({});
  assert.equal(inspectQuickTime(Buffer.concat([base, Buffer.from([0, 0, 0, 0]), Buffer.from('free'), Buffer.from('sem tamanho')])).codec, 'avc1');
  assert.equal(inspectQuickTime(Buffer.concat([base, Buffer.alloc(4)])).codec, 'avc1');
  assert.equal(inspectQuickTime(Buffer.concat([base, Buffer.alloc(64)])).codec, 'avc1');
  // Blocos desconhecidos no nível superior são ignorados (as câmeras gravam vários).
  assert.equal(inspectQuickTime(Buffer.concat([base, atom('uuid', Buffer.alloc(40, 1)), atom('skip', Buffer.alloc(5))])).codec, 'avc1');
});

test('MOV: arquivo cortado em qualquer posição é recusado como incompleto', () => {
  for (const [name, sample] of [['sintético', buildMov({})], ['sintético moov primeiro', buildMov({ moovFirst: true })], ['sintético fragmentado', buildMov({ fragmented: true })],
    ['h264-aac.mov', fixture('h264-aac.mov')], ['hevc-aac.mov', fixture('hevc-aac.mov')]]) {
    for (let cut = 0; cut < sample.length; cut++) {
      const error = thrown(() => inspectQuickTime(sample.subarray(0, cut)));
      assert.ok(error, `${name} cortado em ${cut} de ${sample.length} bytes foi aceito`);
      assert.equal(error.code, 'MEDIA_INCOMPLETE', `${name} cortado em ${cut}: ${error.message}`);
      assert.match(error.message, /incompleto ou corrompido/);
    }
  }
});

test('MOV: recusa o que o player não reproduz, dizendo o codec e o que fazer (não há conversão de vídeo)', () => {
  const codecs = { apch: 'Apple ProRes', apcn: 'Apple ProRes', ap4h: 'Apple ProRes', jpeg: 'Motion JPEG', mjpa: 'Motion JPEG', mp4v: 'MPEG-4 Visual', vp09: 'VP9', av01: 'AV1', 'dvc ': 'DV', 'rle ': 'Animation', cvid: 'Cinepak', 'raw ': 'sem compressão', encv: 'vídeo protegido', zzzz: '“zzzz”', 'a\u0001\u0002b': '“a??b”' };
  for (const [codec, name] of Object.entries(codecs)) {
    const error = thrown(() => inspectQuickTime(buildMov({ codec })));
    assert.equal(error?.code, 'MEDIA_UNSUPPORTED', codec);
    assert.ok(error.message.includes(`codec ${name}.`), `${codec}: ${error.message}`);
    assert.match(error.message, /H\.264 ou HEVC \(H\.265\) e não converte vídeos: exporte em H\.264 com áudio AAC e envie novamente\./);
    assert.ok(!/[\u0000-\u001f]/.test(error.message), 'o texto do codec vem do arquivo e não pode levar caracteres de controle para a mensagem');
  }
  // Arquivos reais.
  assert.ok(thrown(() => inspectQuickTime(fixture('prores-pcm.mov'))).message.includes('Apple ProRes'));
  assert.ok(thrown(() => inspectQuickTime(fixture('mpeg4-video-only.mov'))).message.includes('MPEG-4 Visual'));

  const audioOnly = [buildMov({ handler: 'soun' }), fixture('audio-only.mov')];
  for (const sample of audioOnly) assert.match(thrown(() => inspectQuickTime(sample)).message, /não tem imagem/);
  assert.equal(codeOf(() => inspectQuickTime(audioOnly[1])), 'MEDIA_UNSUPPORTED');

  const external = thrown(() => inspectQuickTime(buildMov({ external: true })));
  assert.equal(external.code, 'MEDIA_UNSUPPORTED');
  assert.match(external.message, /dados que estão fora do arquivo/);
  for (const type of ['cmov', 'rmra']) {
    const error = thrown(() => inspectQuickTime(buildMov({ moovExtra: [atom(type, Buffer.alloc(16))] })));
    assert.equal(error?.code, 'MEDIA_UNSUPPORTED', type);
    assert.match(error.message, /estrutura comprimida ou de referência/);
  }
});

test('MOV: estrutura corrompida ou sem as partes essenciais é recusada como incompleta', () => {
  const incomplete = (label, bytes) => { const error = thrown(() => inspectQuickTime(bytes)); assert.equal(error?.code, 'MEDIA_INCOMPLETE', `${label}: ${error?.message}`); };
  incomplete('sem moov', buildMov({ omit: ['moov'] }));
  incomplete('sem mdat', buildMov({ omit: ['mdat'] }));
  incomplete('sem a tabela de blocos', buildMov({ omit: ['stco'] }));
  incomplete('sem a tabela de tamanhos', buildMov({ omit: ['stsz'] }));
  incomplete('sem a tabela de tempos', buildMov({ omit: ['stts'] }));
  incomplete('nenhuma amostra declarada', buildMov({ sampleCount: 0 }));
  incomplete('bloco apontando para fora dos dados', buildMov({ chunkOffset: 99999 }));
  incomplete('bloco apontando para antes dos dados', buildMov({ chunkOffset: 3 }));
  const fragmented = buildMov({ fragmented: true });
  incomplete('fragmentado sem nenhum fragmento', Buffer.concat([fragmented.subarray(0, fragmented.indexOf(Buffer.from('moof')) - 4), atom('mdat', Buffer.alloc(8))]));
  incomplete('dois moov', Buffer.concat([buildMov({}), buildMov({}).subarray(buildMov({}).indexOf(Buffer.from('moov')) - 4)]));

  // Tamanhos de bloco impossíveis.
  const good = buildMov({});
  const mdatAt = good.indexOf(Buffer.from('mdat')) - 4;
  const resize = (at, size) => { const copy = Buffer.from(good); copy.writeUInt32BE(size, at); return copy; };
  incomplete('mdat maior que o arquivo', resize(mdatAt, good.length));
  incomplete('bloco menor que o próprio cabeçalho', resize(mdatAt, 4));
  const moovAt = good.indexOf(Buffer.from('moov')) - 4;
  incomplete('moov maior que o arquivo', resize(moovAt, 0x7fffffff));
  const trakAt = good.indexOf(Buffer.from('trak')) - 4;
  incomplete('faixa maior que o moov', resize(trakAt, 0x00ffffff));
  // Tamanho de 64 bits maior que o arquivo e cabeçalho de 64 bits sem os 8 bytes do tamanho.
  incomplete('tamanho de 64 bits além do arquivo', Buffer.concat([good.subarray(0, mdatAt), Buffer.from([0, 0, 0, 1]), Buffer.from('mdat'), Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.alloc(8)]));
  incomplete('cabeçalho de 64 bits cortado', Buffer.concat([good.subarray(0, mdatAt), Buffer.from([0, 0, 0, 1]), Buffer.from('mdat'), Buffer.alloc(4)]));
  incomplete('restante menor que um cabeçalho e não zerado', Buffer.concat([good, Buffer.from([1, 2, 3])]));

  // Arquivos que começam como MOV, mas são outra coisa (imagem HEIC, MP4 sem moov, texto qualquer depois do ftyp).
  incomplete('imagem HEIC renomeada', Buffer.concat([atom('ftyp', Buffer.from('heic'), Buffer.alloc(4), Buffer.from('heic')), atom('meta', Buffer.alloc(64))]));
  incomplete('ftyp seguido de texto', Buffer.concat([atom('ftyp', Buffer.from('qt  '), Buffer.alloc(4)), Buffer.from('isto não é um vídeo, só um texto qualquer que não forma blocos')]));

  // Um arquivo adulterado não pode prender o servidor: há um teto de blocos lidos.
  const free = count => Buffer.concat(Array.from({ length: count }, () => atom('free')));
  assert.equal(inspectQuickTime(Buffer.concat([good, free(1000)])).codec, 'avc1', 'mil blocos pequenos ainda passam');
  incomplete('mais de 200 mil blocos', Buffer.concat([good, free(200_100)]));
});

test('conferência no envio: só JPEG e MOV passam por ela; a recusa é 415 com código estável', () => {
  assert.equal(checkContent(Buffer.from('qualquer coisa'), '.png'), null);
  assert.equal(checkContent(Buffer.from('qualquer coisa'), '.pdf'), null);
  assert.equal(checkContent(Buffer.from('qualquer coisa'), '.mp4'), null);
  assert.equal(checkContent(Buffer.from('qualquer coisa'), '.webm'), null);
  assert.equal(checkContent(JPEG, '.jpg').width, 16);
  assert.equal(checkContent(JPEG, '.jpeg').width, 16, '.jpg e .jpeg seguem a mesma conferência');
  assert.equal(checkContent(fixture('h264-aac.mov'), '.mov').codec, 'avc1');

  const cases = [
    [() => checkContent(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-teste-jpg')]), '.jpg'), 'MEDIA_INCOMPLETE'],
    [() => checkContent(JPEG.subarray(0, 300), '.jpeg'), 'MEDIA_INCOMPLETE'],
    [() => checkContent(withByte(JPEG, SOF + 1, 0xc9), '.jpg'), 'MEDIA_UNSUPPORTED'],
    [() => checkContent(fixture('h264-aac.mov').subarray(0, 5000), '.mov'), 'MEDIA_INCOMPLETE'],
    [() => checkContent(fixture('prores-pcm.mov'), '.mov'), 'MEDIA_UNSUPPORTED']
  ];
  for (const [run, code] of cases) {
    const error = thrown(run);
    assert.ok(error instanceof HttpError, String(error));
    assert.deepEqual([error.status, error.code], [415, code]);
  }
});

test('conferência no envio: bytes alterados ao acaso nunca causam erro inesperado nem demoram', () => {
  // Gerador determinístico: o teste repete sempre a mesma sequência.
  let state = 20261027;
  const next = limit => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; };
  const allowed = new Set([null, 'MEDIA_INCOMPLETE', 'MEDIA_UNSUPPORTED']);
  const started = Date.now();
  for (const [sample, extension] of [[JPEG, '.jpg'], [fixture('progressive.jpg'), '.jpeg'], [buildMov({}), '.mov'], [buildMov({ fragmented: true }), '.mov'], [fixture('h264-aac.mov').subarray(0, 4000), '.mov']]) {
    for (let round = 0; round < 1500; round++) {
      const copy = Buffer.from(sample);
      for (let changes = 1 + next(4); changes > 0; changes--) copy[next(copy.length)] = next(256);
      const error = thrown(() => checkContent(copy, extension));
      // Aceitar é possível (o byte alterado pode estar nos dados comprimidos); o que não pode é falhar de outro jeito.
      assert.ok(error === null || (error instanceof HttpError && error.status === 415 && (error.code === undefined || allowed.has(error.code))), `${extension} rodada ${round}: ${error?.stack ?? error}`);
    }
  }
  assert.ok(Date.now() - started < 20_000, 'a conferência de arquivos adulterados é rápida');
});
