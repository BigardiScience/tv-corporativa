import { pipeline } from 'node:stream/promises';

// Tamanho do bloco lido do disco por vez. Com o padrão do Node (64 KB) o servidor leva cerca de 1,6 vez o tempo por byte entregue: medido num
// arquivo de 300 MB em localhost (mediana de 5 rodadas), 16 KB ≈ 280, 64 KB ≈ 760, 256 KB ≈ 1.200 e 1 MB ≈ 1.210 MB/s. Fica em 256 KB: o ganho
// está quase todo aí e cada pedido em andamento ocupa só esse tanto de memória (a TV, no vídeo direto, mantém um pedido aberto por vídeo).
export const SEND_CHUNK_BYTES = 256 * 1024;

// Entrega um arquivo com suporte a "Range" (necessário para vídeo no Safari e em muitas TVs) e a ETag/304.
// `handle` é um FileHandle já aberto; quem chama o fecha.
export async function sendFile(req, res, { handle, size, type, etag, filename }) {
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
  let start = 0, end = size - 1, status = 200;
  const requested = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '').trim());
  if (requested && (requested[1] !== '' || requested[2] !== '')) {
    if (requested[1] === '') {
      const last = Number(requested[2]);
      start = Math.max(0, size - last);
    } else {
      start = Number(requested[1]);
      end = requested[2] === '' ? size - 1 : Math.min(Number(requested[2]), size - 1);
    }
    if (start >= size || start > end || (requested[1] === '' && Number(requested[2]) === 0)) {
      res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return;
    }
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.statusCode = status;
  res.setHeader('Content-Length', end - start + 1);
  if (req.method === 'HEAD') { res.end(); return; }
  await pipeline(handle.createReadStream({ start, end, autoClose: false, highWaterMark: SEND_CHUNK_BYTES }), res);
}
