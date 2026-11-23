// Conferência do CONTEÚDO de JPEG e MOV no envio, além da assinatura (primeiros bytes) de formats.mjs.
//
// A assinatura só prova que o arquivo COMEÇA como o formato anunciado. Um JPEG cortado no meio, ou um MOV sem a tabela de reprodução,
// com dados fora do arquivo ou com um codec que o player não reproduz, passaria por ela, entraria na biblioteca e chegaria à TV como
// imagem quebrada ou como vídeo com som e tela preta. Aqui o arquivo inteiro (já em memória) é percorrido pela ESTRUTURA e, se estiver
// incompleto ou fora do que o player reproduz, é recusado no envio, com a orientação para a pessoa.
//
// Nada é decodificado nem executado: só se leem tamanhos e tipos dos blocos do arquivo. Não há dependência externa (ffmpeg) e não há
// conversão de vídeo. Esta conferência não substitui o antimalware nem a aprovação feita por uma pessoa.
import { fail } from '../lib/errors.mjs';

class ContentProblem extends Error {
  constructor(code, message) { super(message); this.name = 'ContentProblem'; this.code = code; }
}
const mismatch = () => new ContentProblem(undefined, 'O conteúdo não corresponde ao formato do arquivo.');
const incomplete = message => new ContentProblem('MEDIA_INCOMPLETE', message);
const unsupported = message => new ContentProblem('MEDIA_UNSUPPORTED', message);

const JPEG_INCOMPLETE = 'O arquivo JPEG está incompleto ou corrompido. Exporte a imagem novamente e envie de novo.';
const MOV_INCOMPLETE = 'O arquivo MOV está incompleto ou corrompido. Exporte o vídeo novamente e envie de novo.';

// ---- JPEG ------------------------------------------------------------------------------------------------------------------------
// Estrutura: SOI, segmentos (cada um com tamanho próprio), um quadro (SOF), uma ou mais varreduras (SOS + dados comprimidos) e EOI.
// Dados depois do EOI são permitidos (fotos de celular anexam miniaturas, mapas de ganho e vídeo curto depois da imagem principal).
const SOF_DISPLAYABLE = new Set([0xC0, 0xC1, 0xC2]); // sequencial básico, sequencial estendido e progressivo: o que os navegadores exibem
const isFrameMarker = marker => marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;

// Posição do próximo marcador depois dos dados comprimidos de uma varredura, ou -1 se o arquivo acaba antes.
function endOfScan(bytes, from) {
  let at = from;
  for (;;) {
    at = bytes.indexOf(0xFF, at);
    if (at < 0 || at + 1 >= bytes.length) return -1;
    const next = bytes[at + 1];
    if (next === 0x00 || (next >= 0xD0 && next <= 0xD7)) { at += 2; continue; } // byte reservado (FF00) e marcadores de reinício fazem parte dos dados
    if (next === 0xFF) { at += 1; continue; } // preenchimento
    return at;
  }
}

export function inspectJpeg(bytes) {
  const size = bytes.length;
  if (size < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8 || bytes[2] !== 0xFF) throw mismatch();
  let at = 2, frame = null, scans = 0;
  while (at < size) {
    if (bytes[at] !== 0xFF) throw incomplete(JPEG_INCOMPLETE); // entre dois segmentos só cabe o marcador seguinte
    while (at < size && bytes[at] === 0xFF) at++; // bytes FF repetidos são preenchimento permitido
    if (at >= size) break;
    const marker = bytes[at++];
    if (marker === 0xD9) { // EOI: a imagem principal termina aqui
      if (!frame || !scans) throw incomplete(JPEG_INCOMPLETE);
      return frame;
    }
    if (marker === 0x00 || marker === 0x01 || marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) throw incomplete(JPEG_INCOMPLETE); // sem tamanho: não podem aparecer aqui
    if (at + 2 > size) throw incomplete(JPEG_INCOMPLETE);
    const length = bytes.readUInt16BE(at);
    if (length < 2 || at + length > size) throw incomplete(JPEG_INCOMPLETE);
    if (isFrameMarker(marker)) {
      if (frame) throw incomplete(JPEG_INCOMPLETE); // dois quadros na mesma imagem
      if (length < 8) throw incomplete(JPEG_INCOMPLETE);
      const precision = bytes[at + 2], height = bytes.readUInt16BE(at + 3), width = bytes.readUInt16BE(at + 5), components = bytes[at + 7];
      if (!width || !height || (components !== 1 && components !== 3 && components !== 4) || length !== 8 + 3 * components) throw incomplete(JPEG_INCOMPLETE);
      if (!SOF_DISPLAYABLE.has(marker) || precision !== 8) throw unsupported('Este JPEG usa uma codificação que os navegadores não exibem (sem perdas, aritmética ou diferente de 8 bits). Exporte como JPEG comum e envie de novo.');
      frame = { width, height, components, progressive: marker === 0xC2 };
    } else if (marker === 0xDA) { // SOS: depois do cabeçalho vêm os dados comprimidos, até o próximo marcador
      if (!frame) throw incomplete(JPEG_INCOMPLETE);
      const next = endOfScan(bytes, at + length);
      if (next < 0) throw incomplete(JPEG_INCOMPLETE); // acabou no meio dos dados: arquivo cortado
      scans++;
      at = next;
      continue;
    }
    at += length;
  }
  throw incomplete(JPEG_INCOMPLETE); // chegou ao fim sem o marcador EOI
}

// ---- MOV (QuickTime) -------------------------------------------------------------------------------------------------------------
// Estrutura: sequência de "átomos" (tamanho de 4 bytes + tipo de 4 letras + conteúdo). O arquivo precisa ser coberto exatamente por eles,
// ter as informações de reprodução (moov), os dados (mdat) e uma faixa de vídeo cujo codec o player reproduz.
const MAX_ATOMS = 200_000; // teto de blocos lidos: um arquivo adulterado não pode prender o servidor

// Codecs de vídeo aceitos em MOV: H.264 e HEVC (inclusive o HEVC com Dolby Vision gravado por celulares). Qualquer outro é recusado no envio.
const VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'dvh1', 'dvhe']);
const CODEC_NAMES = Object.freeze({
  apch: 'Apple ProRes', apcn: 'Apple ProRes', apcs: 'Apple ProRes', apco: 'Apple ProRes', ap4h: 'Apple ProRes', ap4x: 'Apple ProRes',
  jpeg: 'Motion JPEG', mjpa: 'Motion JPEG', mjpb: 'Motion JPEG', mp4v: 'MPEG-4 Visual', h263: 'H.263', s263: 'H.263',
  vp09: 'VP9', vp08: 'VP8', av01: 'AV1', 'dvc ': 'DV', dvcp: 'DV', dvpp: 'DV', dv5n: 'DV', dv5p: 'DV', 'rle ': 'Animation', 'png ': 'PNG',
  'raw ': 'sem compressão', yuv2: 'sem compressão', '2vuy': 'sem compressão', v210: 'sem compressão', cvid: 'Cinepak', SVQ1: 'Sorenson', SVQ3: 'Sorenson', encv: 'vídeo protegido'
});

const fourcc = (bytes, at) => bytes.toString('latin1', at, at + 4);
const printable = text => text.replace(/[^\x20-\x7e]/g, '?');

function codecMessage(type) {
  const name = CODEC_NAMES[type] ?? `“${printable(type)}”`;
  return `O vídeo deste MOV usa o codec ${name}. O sistema aceita MOV com vídeo H.264 ou HEVC (H.265) e não converte vídeos: exporte em H.264 com áudio AAC e envie novamente.`;
}

// Lista os átomos que cobrem [start, end). Um átomo com tamanho 0 vai até o fim; com tamanho 1 usa o tamanho de 64 bits.
function listAtoms(bytes, start, end, budget) {
  const atoms = [];
  let at = start;
  while (at < end) {
    if (end - at < 8) {
      if (bytes.subarray(at, end).every(byte => byte === 0)) break; // arquivos antigos terminam com um preenchimento de zeros
      throw incomplete(MOV_INCOMPLETE);
    }
    if (--budget.left < 0) throw incomplete(MOV_INCOMPLETE);
    let size = bytes.readUInt32BE(at), header = 8;
    if (size === 1) {
      if (end - at < 16) throw incomplete(MOV_INCOMPLETE);
      const wide = bytes.readBigUInt64BE(at + 8);
      if (wide > BigInt(end - at)) throw incomplete(MOV_INCOMPLETE);
      size = Number(wide); header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || size > end - at) throw incomplete(MOV_INCOMPLETE); // tamanho impossível ou arquivo cortado dentro do átomo
    atoms.push({ type: fourcc(bytes, at + 4), at, header, end: at + size });
    at += size;
  }
  return atoms;
}

const inside = (bytes, atom, budget) => listAtoms(bytes, atom.at + atom.header, atom.end, budget);
function dive(bytes, atom, path, budget) {
  let current = atom;
  for (const type of path) {
    current = inside(bytes, current, budget).find(child => child.type === type);
    if (!current) return null;
  }
  return current;
}

// Tipos de amostra declarados em stsd (um por descrição de codec da faixa).
function sampleEntries(bytes, stsd) {
  const start = stsd.at + stsd.header;
  if (stsd.end - start < 8) throw incomplete(MOV_INCOMPLETE);
  const count = bytes.readUInt32BE(start + 4), entries = [];
  let at = start + 8;
  for (let n = 0; n < count && n < 32; n++) {
    if (stsd.end - at < 16) throw incomplete(MOV_INCOMPLETE);
    const size = bytes.readUInt32BE(at);
    if (size < 16 || size > stsd.end - at) throw incomplete(MOV_INCOMPLETE);
    entries.push({ type: fourcc(bytes, at + 4), at, size });
    at += size;
  }
  return entries;
}

// A faixa referencia dados em OUTRO arquivo? (bit 0 de "flags" = dados no próprio arquivo)
function usesExternalData(bytes, track, budget) {
  const dref = dive(bytes, track, ['mdia', 'minf', 'dinf', 'dref'], budget);
  if (!dref) return false;
  const start = dref.at + dref.header;
  if (dref.end - start < 8) throw incomplete(MOV_INCOMPLETE);
  const count = bytes.readUInt32BE(start + 4);
  let at = start + 8;
  for (let n = 0; n < count && n < 32; n++) {
    if (dref.end - at < 12) throw incomplete(MOV_INCOMPLETE);
    const size = bytes.readUInt32BE(at);
    if (size < 12 || size > dref.end - at) throw incomplete(MOV_INCOMPLETE);
    if ((bytes.readUInt32BE(at + 8) & 1) === 0) return true;
    at += size;
  }
  return false;
}

// Todos os blocos (chunks) da faixa começam dentro de algum mdat do arquivo?
function chunksInsideData(bytes, table, wide, ranges) {
  const start = table.at + table.header;
  if (table.end - start < 8) return false;
  const count = bytes.readUInt32BE(start + 4), step = wide ? 8 : 4;
  if (count === 0 || count * step > table.end - start - 8) return false;
  for (let n = 0, at = start + 8; n < count; n++, at += step) {
    const offset = wide ? Number(bytes.readBigUInt64BE(at)) : bytes.readUInt32BE(at);
    if (!ranges.some(([from, to]) => offset >= from && offset <= to)) return false;
  }
  return true;
}

const entryCount = (bytes, atom, offset) => {
  const start = atom.at + atom.header + offset;
  return atom.end - start >= 4 ? bytes.readUInt32BE(start) : 0;
};

export function inspectQuickTime(bytes) {
  const budget = { left: MAX_ATOMS };
  try {
    const top = listAtoms(bytes, 0, bytes.length, budget);
    const moovs = top.filter(atom => atom.type === 'moov');
    if (moovs.length !== 1) throw incomplete(MOV_INCOMPLETE); // sem as informações de reprodução (arquivo cortado antes delas) ou duplicadas
    const moovChildren = inside(bytes, moovs[0], budget);
    if (moovChildren.some(atom => atom.type === 'cmov' || atom.type === 'rmra')) {
      throw unsupported('Este MOV usa uma estrutura comprimida ou de referência, que os navegadores não reproduzem. Exporte novamente como MOV ou MP4 comum e envie de novo.');
    }
    const ranges = top.filter(atom => atom.type === 'mdat').map(atom => [atom.at + atom.header, atom.end]);
    const fragmented = moovChildren.some(atom => atom.type === 'mvex');
    if (!ranges.length || (fragmented && !top.some(atom => atom.type === 'moof'))) throw incomplete(MOV_INCOMPLETE); // sem os dados do vídeo

    let video = null, audio = false;
    for (const track of moovChildren.filter(atom => atom.type === 'trak')) {
      const handler = dive(bytes, track, ['mdia', 'hdlr'], budget);
      if (!handler || handler.end - handler.at - handler.header < 12) continue;
      const kind = fourcc(bytes, handler.at + handler.header + 8);
      if (kind === 'soun') audio = true;
      else if (kind === 'vide' && !video) video = track;
    }
    if (!video) throw unsupported('Este arquivo MOV não tem imagem (só áudio ou dados). Exporte um vídeo com imagem e envie de novo.');

    const stbl = dive(bytes, video, ['mdia', 'minf', 'stbl'], budget);
    const stsd = stbl && inside(bytes, stbl, budget).find(atom => atom.type === 'stsd');
    if (!stsd) throw incomplete(MOV_INCOMPLETE);
    const entries = sampleEntries(bytes, stsd);
    if (!entries.length) throw incomplete(MOV_INCOMPLETE);
    for (const entry of entries) if (!VIDEO_CODECS.has(entry.type)) throw unsupported(codecMessage(entry.type));
    if (usesExternalData(bytes, video, budget)) throw unsupported('Este MOV usa dados que estão fora do arquivo e não pode ser reproduzido sozinho. Exporte o vídeo como um único arquivo e envie de novo.');

    if (!fragmented) {
      const tables = Object.fromEntries(inside(bytes, stbl, budget).map(atom => [atom.type, atom]));
      const offsets = tables.stco ?? tables.co64;
      // Há amostras (quadros), tempos e blocos, e todos os blocos estão dentro dos dados do arquivo.
      if (!offsets || !tables.stsz || !tables.stts || !entryCount(bytes, tables.stsz, 8) || !entryCount(bytes, tables.stts, 4)
        || !chunksInsideData(bytes, offsets, offsets.type === 'co64', ranges)) throw incomplete(MOV_INCOMPLETE);
    }
    const first = entries[0], ftyp = top.find(atom => atom.type === 'ftyp');
    return {
      brand: ftyp && ftyp.end - ftyp.at - ftyp.header >= 4 ? fourcc(bytes, ftyp.at + ftyp.header) : null,
      codec: first.type, width: first.size >= 36 ? bytes.readUInt16BE(first.at + 32) : 0, height: first.size >= 36 ? bytes.readUInt16BE(first.at + 34) : 0,
      audio, fragmented
    };
  } catch (error) {
    if (error instanceof RangeError) throw incomplete(MOV_INCOMPLETE); // leitura além do fim de um bloco adulterado
    throw error;
  }
}

// Usada no envio: devolve o resumo do conteúdo ou recusa com 415 e a orientação. Outros formatos seguem só com a assinatura.
export function checkContent(bytes, extension) {
  const inspect = extension === '.jpg' || extension === '.jpeg' ? inspectJpeg : extension === '.mov' ? inspectQuickTime : null;
  if (!inspect) return null;
  try { return inspect(bytes); } catch (error) {
    if (error instanceof ContentProblem) fail(415, error.message, error.code);
    throw error;
  }
}
