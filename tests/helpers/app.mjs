import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/core.mjs';
import { silentLogger } from '../../server/lib/logger.mjs';
import { publicUser } from '../../server/domain/users.mjs';
import { root } from '../../server/config.mjs';
import { apiClient, httpClient, uniquePng } from './http.mjs';

// Senha fictícia só para bancos temporários dos testes: gerada a cada execução, nunca fixa no código.
export const PASSWORD = `Senha-${randomBytes(12).toString('base64url')}`;

export function makeTempDir(prefix = 'tvcorp-test-') {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Só apaga pastas temporárias criadas pelos próprios testes.
export function removeTempDir(dir, prefix = 'tvcorp-test-') {
  const target = path.resolve(dir), expected = path.join(path.resolve(os.tmpdir()), prefix);
  assert.ok(target.startsWith(expected), 'Excluir somente a pasta temporária deste teste.');
  rmSync(target, { recursive: true, force: true });
}

// Antivírus de mentira para os testes de produção: sai com 0 (limpo) ou 1 (infectado), como o clamscan.
export function writeScanner(dir, verdict = 'clean') {
  const file = path.join(dir, `scanner-${verdict}.sh`);
  writeFileSync(file, `#!/bin/sh\nexit ${verdict === 'clean' ? 0 : 1}\n`);
  chmodSync(file, 0o755);
  return file;
}

// Ambiente limpo para executar scripts e o servidor como processos de verdade: só entra o que o teste informa.
const CONFIG_VARIABLES = ['DATA_DIR', 'DB_PATH', 'MEDIA_DIR', 'BACKUP_DIR', 'NODE_ENV', 'APP_ORIGIN', 'MALWARE_SCANNER', 'PORT', 'HOST', 'TRUST_PROXY', 'SETUP_TOKEN',
  'PLAYLIST_MAX_ITEMS', 'MAX_UPLOAD_MB', 'TEST_ADMIN_NAME', 'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD'];
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of CONFIG_VARIABLES) delete env[name];
  return { ...env, ...extra };
}
export { root as projectRoot };

// Exige o status esperado e mostra o corpo da resposta quando falha (diagnóstico rápido).
export function must(response, status = 200) {
  assert.equal(response.status, status, `esperado ${status}, recebido ${response.status}: ${JSON.stringify(response.data)?.slice(0, 400)}`);
  return response.data;
}

export function createTestApp(overrides = {}) {
  const dataDir = overrides.dataDir ?? makeTempDir();
  const app = createApp({ dataDir, port: 0, production: false, scanner: '', logger: silentLogger, ...overrides });
  return { app, dataDir, api: apiClient(app) };
}

export const ADMIN_EMAIL = 'admin@example.invalid';

// Ambiente completo: aplicação nova, administrador logado e atalhos para montar cenários.
// `reuseAdmin: true` reabre um diretório de dados que já tem o administrador de teste (testes de reinício/migração).
// `http: true` abre um soquete local (porta livre) e fala com o servidor por HTTP de verdade, em vez de chamar o tratador em processo.
export async function withApp(run, overrides = {}) {
  const { reuseAdmin = false, http = false, ...options } = overrides;
  const created = createTestApp(options);
  const { app, dataDir } = created;
  let api = created.api;
  try {
    if (http) api = await listenOnFreePort(app);
    const adminUser = reuseAdmin ? publicUser(app.services.users.byEmail(ADMIN_EMAIL)) : app.createAdmin('Admin teste', ADMIN_EMAIL, PASSWORD);
    const admin = (await api.login(adminUser.email, PASSWORD)).session;
    const kit = buildKit({ app, api, dataDir, adminUser, admin });
    await run(kit);
  } finally {
    await app.close();
    if (!options.dataDir) removeTempDir(dataDir);
  }
}

export async function listenOnFreePort(app) {
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  return httpClient(`http://127.0.0.1:${app.server.address().port}`);
}

export function buildKit({ app, api, dataDir, adminUser, admin }) {
  const { call } = api;
  const counter = { n: 0 };
  // O servidor limita tentativas de entrada por endereço (12 em 15 min). Cenários que criam muitas pessoas não são teste de limite:
  // cada entrada preparatória parte de um endereço fictício próprio. Os testes do limite chamam /api/login diretamente.
  let logins = 0;
  const login = (email, password, options = {}) => {
    logins++;
    return api.login(email, password, { remoteAddress: `10.77.${(logins >> 8) & 255}.${logins & 255}`, ...options });
  };

  async function createUser(role, { unitIds = ['leste'], sectorIds = ['rh'], email, grants, revokes, by = admin } = {}) {
    counter.n++;
    const address = email ?? `${role}${counter.n}@example.invalid`;
    const user = must(await call('/api/users', { method: 'POST', session: by, body: { name: `Teste ${role} ${counter.n}`, email: address, password: PASSWORD, role, unitIds, sectorIds, ...(grants ? { grants } : {}), ...(revokes ? { revokes } : {}) } }), 201);
    const session = (await login(address, PASSWORD)).session;
    return { user, session, email: address };
  }

  async function folder(session, { unitId = 'leste', sectorId = 'rh', name, parentId } = {}) {
    counter.n++;
    return must(await call('/api/folders', { method: 'POST', session, body: { unitId, sectorId, name: name ?? `Pasta ${counter.n}`, ...(parentId ? { parentId } : {}) } }), 201);
  }

  async function upload(session, { unitId = 'leste', sectorId = 'rh', folderId, name, title, seed, bytes, duplicate, expect = 201 } = {}) {
    counter.n++;
    const file = name ?? `arquivo${counter.n}.png`;
    const query = new URLSearchParams({ name: file, unitId, sectorId });
    if (title) query.set('title', title);
    if (folderId) query.set('folderId', folderId);
    if (duplicate) query.set('duplicate', duplicate);
    return must(await call(`/api/media?${query}`, { method: 'POST', session, body: bytes ?? uniquePng(seed ?? `${file}-${counter.n}`) }), expect);
  }

  async function approve(session, mediaId) {
    return must(await call(`/api/media/${mediaId}/approve`, { method: 'POST', session, body: { acknowledgeUnscanned: true } }));
  }

  async function approvedMedia(session, options = {}) {
    const media = await upload(session, options);
    return approve(admin, media.id);
  }

  async function playlist(session, { unitId = 'leste', sectorId = 'rh', name = 'Playlist', items = [] } = {}) {
    return must(await call('/api/playlists', { method: 'POST', session, body: { name, unitId, sectorId, items } }), 201);
  }

  async function publishedPlaylist(session, mediaIds, options = {}) {
    const created = await playlist(session, { ...options, items: mediaIds.map(mediaId => ({ mediaId })) });
    return must(await call(`/api/playlists/${created.id}/publish`, { method: 'POST', session, body: { rev: created.draftRev } }), 201);
  }

  async function display(session, { unitId = 'leste', sectorId = 'rh', name = 'TV de teste' } = {}) {
    return must(await call('/api/displays', { method: 'POST', session, body: { name, unitId, sectorId } }), 201);
  }

  async function pairedDisplay(session, options = {}) {
    const created = await display(session, options);
    const paired = must(await call('/api/player/pair', { method: 'POST', body: { code: created.pairingCode } }));
    return { display: created.display, token: paired.token };
  }

  async function liveSchedule(session, { playlistId, displayIds, name = 'Programação', unitId = 'leste', sectorId = 'rh', ...rest }) {
    return must(await call('/api/schedules', { method: 'POST', session, body: { name, unitId, sectorId, playlistId, displayIds, publish: true, ...rest } }), 201);
  }

  const png = seed => uniquePng(seed);
  return { app, api, call, login, dataDir, adminUser, admin, createUser, folder, upload, approve, approvedMedia, playlist, publishedPlaylist, display, pairedDisplay, liveSchedule, png };
}
