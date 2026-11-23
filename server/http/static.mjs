import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '../lib/errors.mjs';
import { MIME } from '../domain/formats.mjs';

const STATIC_MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', ...MIME
});

// Serve somente o conteúdo de /public. Arquivos estáticos são públicos e sem segredos; por isso podem ser
// revalidados por ETag (as respostas da API continuam `no-store`).
export function createStaticServer(publicDir) {
  const base = path.resolve(publicDir);
  return async function serveStatic(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Método não permitido.');
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(base, relative);
    // Três camadas: sem ':' nem '\' (impede caminhos com letra de unidade no Windows, como C:/...), sem segmentos que
    // comecem com '.' (".." e arquivos ocultos) e, por fim, o caminho resolvido precisa continuar dentro de /public.
    if (/[:\\]/.test(relative) || relative.split('/').some(part => part.startsWith('.')) || !file.startsWith(base + path.sep)) fail(404, 'Página não encontrada.');
    let info;
    try { info = await stat(file); } catch { fail(404, 'Página não encontrada.'); }
    if (!info.isFile()) fail(404, 'Página não encontrada.');
    const type = STATIC_MIME[path.extname(file).toLowerCase()];
    if (!type) fail(404, 'Arquivo indisponível.');
    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
    res.statusCode = 200;
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  };
}
