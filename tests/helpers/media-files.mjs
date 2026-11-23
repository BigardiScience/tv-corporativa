// Arquivos de exemplo para os testes de envio: um JPEG de verdade e um construtor de MOV (QuickTime) estruturalmente válido.
// O MOV sintético tem os blocos que o servidor confere (ftyp, mdat, moov com faixa de vídeo, tabelas e dref); ele NÃO é um vídeo que
// um navegador consiga decodificar. Testes que precisam de imagem em movimento de verdade usam os arquivos de tests/fixtures/media.

// JPEG 16x16 (gradiente), 657 bytes, gerado por um codificador real: SOI, tabelas, quadro, varredura e EOI.
export const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmLXTuny1r2undPlrXtdO6fLWxa6d0+Wqr47zDKsx21P/Z',
  'base64'
);

// JPEG com o mesmo desenho e conteúdo diferente (hash diferente): um comentário (COM) logo depois do SOI.
export function jpegWith(seed = '') {
  const text = Buffer.from(String(seed));
  const comment = Buffer.concat([Buffer.from([0xff, 0xfe, (text.length + 2) >> 8, (text.length + 2) & 0xff]), text]);
  return Buffer.concat([JPEG.subarray(0, 2), comment, JPEG.subarray(2)]);
}

const u32 = (...values) => { const out = Buffer.alloc(values.length * 4); values.forEach((value, index) => out.writeUInt32BE(value >>> 0, index * 4)); return out; };
export const atom = (type, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
};

// Descrição de amostra de vídeo no formato QuickTime (86 bytes): tipo do codec, tamanho da imagem e nome do compressor.
const videoEntry = (codec, width, height) => atom(codec, Buffer.alloc(6), u32(1).subarray(2), Buffer.alloc(16),
  Buffer.from([width >> 8, width & 255, height >> 8, height & 255]), u32(0x00480000, 0x00480000, 0), Buffer.from([0, 1]), Buffer.alloc(32), Buffer.from([0, 24, 0xff, 0xff]));
const audioEntry = () => atom('mp4a', Buffer.alloc(6), u32(1).subarray(2), Buffer.alloc(8), Buffer.from([0, 2, 0, 16, 0, 0, 0, 0, 0xac, 0x44, 0, 0]));

// Monta um MOV: ftyp + mdat + moov (ou moov antes de mdat com `moovFirst`).
//   codec ........ tipo da amostra de vídeo (avc1, hvc1, apch, mp4v…)
//   handler ...... 'vide' (padrão) ou 'soun' (arquivo só de áudio)
//   external ..... a faixa aponta para dados fora do arquivo (dref sem o bit "no próprio arquivo")
//   fragmented ... moov com mvex + um fragmento moof/mdat (sem tabelas de amostras)
//   omit ......... nomes de átomos a deixar de fora (por exemplo 'stco', 'mdat', 'moov')
//   brand ........ marca do ftyp ('qt  ' por padrão); null = arquivo sem ftyp (começa pelos dados)
//   wideMdat ..... mdat com o tamanho em 64 bits (cabeçalho de 16 bytes)
//   moovExtra .... átomos acrescentados dentro do moov (por exemplo cmov ou rmra)
//   chunkOffset .. posição dos dados escrita em stco (padrão: o início real do mdat)
//   sampleCount .. quantidade de amostras declarada em stsz (padrão 1)
//   seed ......... conteúdo extra num átomo `free` ao final: arquivos diferentes para testes que não podem acusar duplicidade
export function buildMov({ codec = 'avc1', handler = 'vide', external = false, fragmented = false, moovFirst = false, omit = [], brand = 'qt  ', seed = '', width = 64, height = 36, payload = 200, wideMdat = false, moovExtra = [], chunkOffset = null, sampleCount = 1 } = {}) {
  const skip = name => omit.includes(name);
  const ftyp = brand === null ? Buffer.alloc(0) : atom('ftyp', Buffer.from(brand, 'latin1'), u32(0), Buffer.from(brand, 'latin1'));
  const media = Buffer.alloc(payload, 0x5a);
  const wide = Buffer.alloc(8); wide.writeBigUInt64BE(BigInt(media.length + 16));
  const mdat = skip('mdat') ? Buffer.alloc(0) : wideMdat ? Buffer.concat([u32(1), Buffer.from('mdat'), wide, media]) : atom('mdat', media);
  const dataHeader = wideMdat ? 16 : 8;
  const tail = seed ? atom('free', Buffer.from(String(seed))) : Buffer.alloc(0);

  function moov(offset) {
    const dref = atom('dref', u32(0, 1), atom('url ', u32(external ? 0 : 1)));
    const entry = handler === 'vide' ? videoEntry(codec, width, height) : audioEntry();
    const tables = fragmented
      ? [atom('stts', u32(0, 0)), atom('stsc', u32(0, 0)), atom('stsz', u32(0, 0, 0)), atom('stco', u32(0, 0))]
      : [atom('stts', u32(0, 1, 1, 30)), atom('stsc', u32(0, 1, 1, 1, 1)), atom('stsz', u32(0, payload, sampleCount)), atom('stco', u32(0, 1, chunkOffset ?? offset))];
    const stbl = atom('stbl', atom('stsd', u32(0, 1), entry), ...tables.filter(table => !skip(table.toString('latin1', 4, 8))));
    const track = atom('trak', atom('tkhd', u32(0x0f), Buffer.alloc(80)),
      atom('mdia', atom('mdhd', u32(0, 0, 0, 600, 600), Buffer.alloc(4)), atom('hdlr', u32(0), Buffer.from('mhlr' + handler, 'latin1'), Buffer.alloc(14)),
        atom('minf', atom(handler === 'vide' ? 'vmhd' : 'smhd', u32(1), Buffer.alloc(8)), atom('dinf', dref), stbl)));
    return skip('moov') ? Buffer.alloc(0) : atom('moov', atom('mvhd', u32(0, 0, 0, 600, 600, 0x00010000), Buffer.alloc(76)), track, ...(fragmented ? [atom('mvex', atom('trex', u32(0, 1, 1, 0, 0, 0)))] : []), ...moovExtra);
  }

  if (fragmented) {
    const fragment = Buffer.concat([atom('moof', atom('mfhd', u32(0, 1))), atom('mdat', media)]);
    return Buffer.concat([ftyp, moov(0), fragment, tail]);
  }
  if (moovFirst) {
    const size = moov(0).length;
    return Buffer.concat([ftyp, moov(ftyp.length + size + dataHeader), mdat, tail]);
  }
  return Buffer.concat([ftyp, mdat, moov(ftyp.length + dataHeader), tail]);
}
