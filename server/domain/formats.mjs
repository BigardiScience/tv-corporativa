// Formatos aceitos no envio. A extensão decide o tipo, e o CONTEÚDO precisa confirmar (assinatura do arquivo).
export const MIME = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.pdf': 'application/pdf'
});

export const UNSUPPORTED_FORMAT_MESSAGE = 'Exporte o original como PNG, JPG, JPEG, WebP, PDF, MP4, MOV ou WebM. Arquivos Office, PSD, executáveis e macros não são reproduzidos diretamente.';

// Primeiro bloco ("átomo") de um MOV: os gravados hoje começam por ftyp; arquivos mais antigos podem começar direto pelos dados ou pelas informações.
const QUICKTIME_FIRST_ATOMS = new Set(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot', 'junk']);

// Primeira barreira (rápida): o arquivo COMEÇA como o formato anunciado. JPEG e MOV passam ainda por content-check.mjs no envio.
export function signature(bytes, extension) {
  if (extension === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (extension === '.webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (extension === '.pdf') return bytes.toString('ascii', 0, 5) === '%PDF-';
  if (extension === '.mp4') return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
  if (extension === '.mov') return bytes.length >= 12 && QUICKTIME_FIRST_ATOMS.has(bytes.toString('latin1', 4, 8));
  if (extension === '.webm') return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  return false;
}

export const kindOf = type => (type?.startsWith('image/') ? 'image' : type?.startsWith('video/') ? 'video' : type === 'application/pdf' ? 'pdf' : 'other');
export const KINDS = Object.freeze(['image', 'video', 'pdf']);
