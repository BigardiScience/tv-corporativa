// Validação de arquivo ANTES do envio (a mesma conferência é refeita pelo servidor, que é quem decide).
// Serve para a pessoa descobrir cedo que escolheu um formato errado, sem esperar o envio terminar.
import { formatBytes } from './format.js';

const FORMATS = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', pdf: 'application/pdf' });
export const ACCEPT = '.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.pdf';
// Primeiro bloco de um MOV (mesma lista de server/domain/formats.mjs): ftyp nos arquivos atuais; os mais antigos podem começar pelos dados.
const QUICKTIME_FIRST_ATOMS = Object.freeze(['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot', 'junk']);

export function mimeForName(name) {
  const text = String(name ?? '');
  return text.includes('.') ? FORMATS[text.split('.').pop().toLowerCase()] ?? null : null;
}

export const kindForMime = mime => (mime?.startsWith('image/') ? 'image' : mime?.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf' : 'other');

// Retorna o tipo MIME aceito ou lança Error com a orientação para a pessoa.
export async function validateMediaFile(file, maxMB = 50) {
  const mime = mimeForName(file.name);
  if (!mime) throw new Error('Exporte o arquivo original para PDF, imagem ou vídeo antes de enviar.');
  if (!file.size) throw new Error('O arquivo está vazio.');
  if (file.size > maxMB * 1024 * 1024) throw new Error(`O arquivo tem ${formatBytes(file.size)} e o limite é de ${maxMB} MB.`);
  if (file.type && file.type !== 'application/octet-stream' && file.type !== mime) throw new Error('O tipo do arquivo não corresponde à extensão. Exporte novamente na ferramenta de origem.');
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const starts = signature => signature.every((value, index) => bytes[index] === value);
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  // Mesmas regras (inclusive os tamanhos mínimos) da conferência do servidor em server/domain/formats.mjs; um teste compara as duas.
  const valid = mime === 'image/png' ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mime === 'image/jpeg' ? bytes.length > 3 && starts([255, 216, 255])
      : mime === 'image/webp' ? bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
        : mime === 'video/mp4' ? bytes.length >= 12 && ascii(4, 8) === 'ftyp'
          : mime === 'video/webm' ? bytes.length >= 4 && starts([26, 69, 223, 163])
            : mime === 'application/pdf' ? ascii(0, 5) === '%PDF-'
              : mime === 'video/quicktime' ? bytes.length >= 12 && QUICKTIME_FIRST_ATOMS.includes(ascii(4, 8)) : false;
  if (!valid) throw new Error('O conteúdo do arquivo não corresponde ao formato informado. Exporte novamente antes de enviar.');
  return mime;
}
