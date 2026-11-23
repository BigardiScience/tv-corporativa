import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, PASSWORD } from './helpers/app.mjs';

// Higiene do repositório: regras do projeto que não dependem de executar o servidor.
const read = relative => readFileSync(path.join(projectRoot, relative), 'utf8');
const SKIP = new Set(['node_modules', 'data', '.git']);

function walk(start, accept = () => true) {
  const found = [];
  const visit = directory => {
    for (const entry of readdirSync(path.join(projectRoot, directory), { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) visit(relative);
      else if (accept(relative)) found.push(relative);
    }
  };
  visit(start);
  return found;
}

const isScript = file => /\.(?:mjs|js)$/.test(file);
const productCode = () => ['server', 'scripts', 'public'].flatMap(dir => walk(dir, isScript));
// Tudo o que é distribuído e NÃO é teste: código, scripts, documentação, configuração de exemplo.
const shipped = () => [
  ...['server', 'scripts', 'public', 'docs', '.vscode'].flatMap(dir => (existsSync(path.join(projectRoot, dir)) ? walk(dir, file => /\.(?:mjs|js|css|html|md|json|cmd|ps1|sh)$/.test(file)) : [])),
  ...readdirSync(projectRoot).filter(name => /\.(?:cmd|md|json|code-workspace)$/.test(name) || ['Dockerfile', '.env.example', '.dockerignore', '.gitignore'].includes(name))
];

test('package.json: zero dependências, Node 24+, projeto privado e scripts de operação presentes', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
    assert.equal(pkg[field], undefined, `${field}: o projeto não tem dependências externas (menos superfície de ataque e nada para instalar)`);
  }
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.match(pkg.engines.node, /^>=24(?:\.\d+){0,2}$/, 'node:sqlite estável exige Node 24+');
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  for (const script of ['start', 'dev', 'test', 'test:e2e', 'check', 'configure', 'reset-admin', 'audit:verify', 'migrate', 'backup']) {
    assert.equal(typeof pkg.scripts[script], 'string', `script npm "${script}" ausente`);
  }
  assert.match(pkg.scripts.test, /node --test/);
  // Os testes de navegador (Playwright + Chromium) ficam fora de `npm test` e o Playwright NUNCA é dependência do projeto.
  assert.equal(pkg.scripts['test:e2e'], 'node tests/e2e/run.mjs');
  assert.doesNotMatch(pkg.scripts.test, /e2e|playwright/i, 'npm test não depende de navegador');
  assert.ok(existsSync(path.join(projectRoot, 'tests', 'e2e', 'run.mjs')));
  assert.ok(!walk('tests', file => /\.test\.mjs$/.test(file) && file.includes('/e2e/')).length, 'testes de navegador usam o sufixo .e2e.mjs, que `npm test` não executa');
  assert.ok(!existsSync(path.join(projectRoot, 'package-lock.json')), 'sem dependências não há lockfile');
});

test('nenhuma credencial, chave ou token gravado no código, nos scripts, na documentação ou nos exemplos', () => {
  const patterns = [
    ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['chave AWS', /\bAKIA[0-9A-Z]{16}\b/],
    ['token GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
    ['token Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./],
    ['URL com usuário e senha', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i],
    ['senha/segredo literal', /\b(?:password|senha|secret|api_?key|setup_?token|admin_?password|test_admin_password)\b["']?\s*[:=]\s*(["'`])(?![<$%{])[^"'`\s]{8,}\1/i],
    // Linhas "NOME=valor" de arquivos de configuração e documentação (em JavaScript isto seria uma atribuição comum).
    ['variável de segredo com valor literal', /^[ \t]*(?:set\s+|export\s+|\$env:)?\w*(?:PASSWORD|SECRET|TOKEN)\w*[ \t]*=[ \t]*(?!["'<$%{]|\s|$)\S{8,}/im, file => !isScript(file)]
  ];
  const findings = [];
  for (const file of shipped()) {
    const text = read(file);
    for (const [label, pattern, applies = () => true] of patterns) {
      const match = applies(file) ? pattern.exec(text) : null;
      if (match) findings.push(`${file}: ${label} → ${match[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(findings, []);
  // A senha usada nos testes é fictícia, vive só em tests/ e nunca pode "vazar" para o que é distribuído.
  for (const file of shipped()) assert.ok(!read(file).includes(PASSWORD), `${file} contém a senha fictícia dos testes`);
});

test('.env.example: segredos sempre vazios e toda variável de ambiente lida pelo servidor está documentada', () => {
  const lines = read('.env.example').split(/\r?\n/);
  const declared = new Map();
  for (const line of lines) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) declared.set(match[1], match[2].trim());
  }
  for (const [name, value] of declared) {
    if (/TOKEN|PASSWORD|SECRET|API_?KEY/.test(name)) assert.equal(value, '', `${name} deve ficar vazio no exemplo`);
  }
  const used = new Set();
  for (const file of ['server/config.mjs', 'server/dev-admin.mjs', ...walk('scripts', isScript)]) {
    for (const match of read(file).matchAll(/\benv\??\.([A-Z][A-Z0-9_]+)/g)) used.add(match[1]);
  }
  for (const name of ['TEST_ADMIN_NAME', 'TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD']) used.add(name);
  const missing = [...used].filter(name => !declared.has(name));
  assert.deepEqual(missing, [], 'variáveis lidas pelo código e ausentes do .env.example');
});

test('o que não pode ir para o repositório nem para a imagem: .env, data/ e backups', () => {
  for (const file of ['.gitignore', '.dockerignore']) {
    const entries = read(file).split(/\r?\n/).map(line => line.trim());
    assert.ok(entries.includes('.env'), `${file} deve ignorar .env`);
    assert.ok(entries.includes('.env.*') && entries.includes('!.env.example') || file === '.dockerignore', `${file}: .env.* ignorado e exemplo liberado`);
    assert.ok(entries.some(line => /^\/?data\/?$/.test(line)), `${file} deve ignorar data/`);
    assert.ok(entries.includes('node_modules') || entries.includes('node_modules/'), `${file} deve ignorar node_modules`);
  }
  const docker = read('Dockerfile');
  assert.match(docker, /^FROM node:24/m);
  assert.match(docker, /^USER node$/m, 'o contêiner não roda como root');
  assert.match(docker, /^HEALTHCHECK .*\/healthz/m, 'o contêiner informa a própria saúde por /healthz');
  assert.doesNotMatch(docker, /^COPY\s+(?:--\S+\s+)*\.\s+\./m, 'copiar a pasta inteira levaria .env e data/ para a imagem');
  assert.doesNotMatch(docker, /^(?:COPY|ADD)\b[^\n]*(?:\.env|\bdata\b)/im, 'a imagem não leva .env nem dados');
  assert.match(docker, /ENV[^\n]*NODE_ENV=production/);
});

test('código do servidor, scripts e painel: sem eval, new Function, shell, aleatoriedade fraca nem segredo em registro', () => {
  const findings = [];
  for (const file of productCode()) {
    const text = read(file);
    const rules = [
      ['eval()', /\beval\s*\(/],
      ['new Function()', /\bnew\s+Function\s*\(/],
      ['setTimeout/Interval com texto', /\bset(?:Timeout|Interval)\s*\(\s*["'`]/],
      ['document.write', /\bdocument\.write\s*\(/],
      ['shell: true', /\bshell\s*:\s*true\b/],
      ['child_process.exec', /import\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s*['"](?:node:)?child_process['"]/],
      ['Math.random em código do servidor', file.startsWith('server/') ? /\bMath\.random\s*\(/ : /(?!)/]
    ];
    for (const [label, pattern] of rules) if (pattern.test(text)) findings.push(`${file}: ${label}`);
    // Mensagens de registro nunca citam segredos (o dado sensível nem chega até a chamada de log).
    text.split('\n').forEach((line, index) => {
      if (/\blog(?:ger)?\??\.(?:info|warn|error|debug)\b/.test(line) && /password|senha|cookie|authorization|secret|csrf|hash|token/i.test(line)) findings.push(`${file}:${index + 1}: registro cita segredo`);
    });
  }
  assert.deepEqual(findings, []);
  const spawnUsers = productCode().filter(file => /\bchild_process\b/.test(read(file))).sort();
  assert.deepEqual(spawnUsers, ['scripts/check.mjs', 'server/domain/scanner.mjs'], 'só o verificador de sintaxe e o antivírus executam programas externos');
  assert.match(read('server/domain/scanner.mjs'), /runFile\(command, \['--no-summary', '--infected', file\]/, 'o antivírus recebe argumentos em lista, sem shell');
  assert.match(read('server/domain/scanner.mjs'), /promisify\(execFile\)/, 'execFile (sem shell), nunca exec');
});

test('arquivos de script do Windows chamam somente o Node do projeto e não trazem credenciais', () => {
  for (const file of readdirSync(projectRoot).filter(name => name.endsWith('.cmd'))) {
    const text = read(file);
    assert.match(text, /where node/, `${file}: confere se o Node está instalado antes`);
    assert.match(text, /node --env-file-if-exists=\.env (?:server\/index|scripts\/[a-z-]+)\.mjs/, `${file}: executa um ponto de entrada do projeto`);
    assert.doesNotMatch(text, /password|senha=|token=/i, `${file}: sem credenciais`);
  }
});
