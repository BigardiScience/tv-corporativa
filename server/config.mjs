import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const appVersion = (() => {
  try { return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
})();

function parseTrustProxy(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'false' || text === '0') return 0;
  if (text === 'true') return 1;
  const hops = Number(text);
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) throw new Error('TRUST_PROXY deve ser false, true ou o número de proxies confiáveis (1 a 5).');
  return hops;
}

// Lê e valida toda a configuração. Opções explícitas (usadas pelos testes) têm prioridade sobre o ambiente.
export function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  const production = options.production ?? env.NODE_ENV === 'production';
  const port = Number(options.port ?? env.PORT ?? 4173);
  const host = options.host ?? env.HOST ?? '127.0.0.1';
  const origin = options.origin ?? env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
  const dataDir = path.resolve(options.dataDir ?? env.DATA_DIR ?? path.join(root, 'data'));
  const scanner = options.scanner ?? env.MALWARE_SCANNER ?? '';
  const setupToken = options.setupToken ?? env.SETUP_TOKEN ?? '';
  const maxUpload = Number(options.maxUpload ?? env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;
  const playlistMaxItems = Number(options.playlistMaxItems ?? env.PLAYLIST_MAX_ITEMS ?? 6);
  const trustProxy = parseTrustProxy(options.trustProxy ?? env.TRUST_PROXY);

  // Pela variável de ambiente, o limite vai de 1 a 250 MB. Só uma opção explícita (usada pelos testes) pode ir abaixo de 1 MB.
  const minimumUpload = options.maxUpload === undefined ? 1024 * 1024 : 1024;
  if (!Number.isFinite(maxUpload) || maxUpload < minimumUpload || maxUpload > 250 * 1024 * 1024) throw new Error('MAX_UPLOAD_MB deve ficar entre 1 e 250.');
  if (!Number.isInteger(playlistMaxItems) || playlistMaxItems < 1 || playlistMaxItems > 15) throw new Error('PLAYLIST_MAX_ITEMS deve ficar entre 1 e 15.');
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); } catch { throw new Error('APP_ORIGIN inválida. Informe o endereço público completo, por exemplo https://tv.suaempresa.com.br'); }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) throw new Error('APP_ORIGIN deve conter apenas http(s), host e porta, sem caminho nem barra no final.');
  if (production && (!origin.startsWith('https://') || !scanner)) throw new Error('Produção exige APP_ORIGIN HTTPS e MALWARE_SCANNER configurado.');

  return Object.freeze({
    production, port, host, origin, dataDir, scanner, setupToken, maxUpload, playlistMaxItems, trustProxy,
    // Banco, mídias e backups ficam separados e podem ser movidos por variável de ambiente.
    dbPath: path.resolve(options.dbPath ?? env.DB_PATH ?? path.join(dataDir, 'tvcorp.sqlite')),
    mediaDir: path.resolve(options.mediaDir ?? env.MEDIA_DIR ?? path.join(dataDir, 'media')),
    backupDir: path.resolve(options.backupDir ?? env.BACKUP_DIR ?? path.join(dataDir, 'backups')),
    // O cookie de sessão é Secure sempre que a origem pública for HTTPS (inclui homologação no Render).
    secureCookies: origin.startsWith('https://'),
    version: appVersion
  });
}
