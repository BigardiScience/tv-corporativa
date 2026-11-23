// Infraestrutura dos testes de ponta a ponta: servidor de verdade (porta livre, banco e pasta temporários) + Chromium controlado pelo Playwright.
//
// Estes testes NÃO fazem parte de `npm test` (que usa só módulos do próprio Node.js, sem dependências). Eles exigem o Playwright,
// que é uma dependência opcional de desenvolvimento:  npm install --no-save playwright  &&  npx playwright install chromium
// Nenhuma credencial fixa: a senha do administrador de teste é sorteada a cada execução e só existe no banco temporário descartado ao final.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../server/core.mjs';
import { silentLogger } from '../../server/lib/logger.mjs';
import { httpClient } from '../helpers/http.mjs';
import { buildKit, writeScanner } from '../helpers/app.mjs';
import { publicUser } from '../../server/domain/users.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = process.env.E2E_OUTPUT ?? path.join(here, 'output');

// Procura o Playwright em: PLAYWRIGHT_MODULES (pasta node_modules), no projeto e em /opt/npm-tools (ambiente de validação).
export function loadPlaywright() {
  const roots = [process.env.PLAYWRIGHT_MODULES, path.join(here, '..', '..', 'node_modules'), '/opt/npm-tools/node_modules'].filter(Boolean);
  for (const root of roots) {
    try { return createRequire(path.join(root, '/'))('playwright'); } catch { /* tenta o próximo */ }
  }
  return null;
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// Avisos esperados e inofensivos: a tela de login consulta /api/me ainda sem sessão e recebe 401 (o navegador registra no console).
const EXPECTED = [/HTTP 401 GET \/api\/me/, /Failed to load resource: the server responded with a status of 401/];

export async function launch({ production = false, viewport = { width: 1440, height: 900 }, headless = true } = {}) {
  const playwright = loadPlaywright();
  if (!playwright) {
    const error = new Error('Playwright não encontrado. Instale com: npm install --no-save playwright && npx playwright install chromium');
    error.code = 'NO_PLAYWRIGHT';
    throw error;
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tvcorp-e2e-'));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const scanner = production ? writeScanner(dataDir, 'clean') : '';
  // trustProxy: 1 só nos testes, para que cada entrada (pela API ou pelo navegador) parta de um endereço fictício próprio. O limite de
  // tentativas por ENDEREÇO continua valendo e é testado nos testes do servidor; o limite por CONTA não é alterado.
  const app = createApp({ dataDir, port, origin, production, scanner, trustProxy: 1, logger: silentLogger });
  const password = `Pw-${randomBytes(9).toString('base64url')}-x1`;
  const adminEmail = 'admin@example.invalid';
  app.createAdmin('Administrador E2E', adminEmail, password);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', resolve); });

  const browser = await playwright.chromium.launch({ headless });
  const context = await browser.newContext({ viewport, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  // Cada entrada feita pelo navegador também sai de um endereço fictício diferente (mesma razão do trustProxy acima).
  let browserLogins = 0;
  await context.route('**/api/login', route => {
    browserLogins++;
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.88.${(browserLogins >> 8) & 255}.${browserLogins & 255}` } });
  });
  const page = await context.newPage();
  const issues = [];
  const allowed = [...EXPECTED];
  const note = text => { if (!allowed.some(pattern => pattern.test(text))) issues.push(text); };
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) note(`console.${message.type()}: ${message.text()}`); });
  page.on('pageerror', error => note(`pageerror: ${error.message}`));
  page.on('response', response => { if (response.status() >= 400) note(`HTTP ${response.status()} ${response.request().method()} ${response.url().replace(origin, '')}`); });

  const http = httpClient(origin);
  const api = { ...http, async adminSession() { return (await http.login(adminEmail, password)).session; } };
  // Dados de apoio criados pela API (arquivos aprovados, pastas, TVs…): o cenário testa a tela, não repete o que outros testes já cobrem.
  // Cada entrada por API parte de um endereço fictício próprio (kit.login); o limite por CONTA (12 em 15 min) continua valendo.
  const seed = async () => buildKit({ app, api: http, dataDir, adminUser: publicUser(app.services.users.byEmail(adminEmail)), admin: await api.adminSession() });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => {});
    await app.close().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  }
  const shot = async (name, options = {}) => page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), ...options });
  // Um cenário que provoca um erro de propósito (ex.: duplicado → 409) declara aqui o que é esperado; o resto continua sendo falha.
  const allow = (...patterns) => { allowed.push(...patterns); };
  return { app, origin, page, context, browser, password, adminEmail, issues, api, seed, close, shot, dataDir, production, allow };
}

// Ações de interface reutilizadas pelos cenários ------------------------------------------------------------------------------

export async function loginAs(page, origin, email, password) {
  await page.goto(origin);
  await page.waitForSelector('#login-email');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-submit');
  await page.waitForSelector('.app-shell');
}

// Escolhe unidade e setor na janela "Onde você vai trabalhar?" (ou pelo seletor do menu lateral).
export async function chooseSpace(page, unitName, sectorName) {
  if (!(await page.locator('dialog[open]').count())) await page.click('.workspace');
  const dialog = page.locator('dialog[open]');
  await dialog.waitFor();
  const unit = dialog.getByRole('button', { name: unitName, exact: true });
  if (await unit.count()) await unit.click();
  await dialog.getByRole('button', { name: sectorName, exact: true }).click();
  await page.waitForSelector('#dialogs dialog', { state: 'detached' });
}

export const goTo = async (page, routeName) => { await page.click(`.nav-btn[data-route="${routeName}"]`); };

export function expectNoIssues(session) {
  assert.deepEqual(session.issues, [], `Problemas no navegador:\n${session.issues.join('\n')}`);
}

// Executa e relata cada etapa de um cenário (nome claro no resultado, captura de tela quando falha).
export async function runScenario(title, body) {
  const started = Date.now();
  let session;
  const results = [];
  try {
    session = await launch();
    const step = async (name, fn) => {
      try { await fn(); results.push({ name, ok: true }); } catch (error) {
        results.push({ name, ok: false, error });
        await session.shot(`falha-${title.replace(/\W+/g, '-')}`).catch(() => {});
        throw error;
      }
    };
    await body(session, step);
  } catch (error) {
    if (error.code === 'NO_PLAYWRIGHT') { console.log(`↷ ${title}: ${error.message}`); return { title, skipped: true }; }
    results.push({ name: 'erro', ok: false, error });
  } finally {
    await session?.close();
  }
  const failed = results.filter(item => !item.ok);
  console.log(`${failed.length ? '✗' : '✓'} ${title} — ${results.filter(item => item.ok).length}/${results.length} etapas · ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const item of results) console.log(`   ${item.ok ? '✓' : '✗'} ${item.name}${item.ok ? '' : `\n      ${String(item.error?.stack ?? item.error).split('\n').slice(0, 8).join('\n      ')}`}`);
  return { title, ok: failed.length === 0 };
}
