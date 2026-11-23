import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, createTestApp, removeTempDir } from './helpers/app.mjs';
import { PERMISSIONS, PERMISSION_IDS, ROLE_PERMISSIONS, MANAGEABLE_ROLES, NON_DELEGABLE, ADMIN_RESERVED } from '../server/domain/permissions.mjs';
import { migrations } from '../server/db/migrations/index.mjs';
import { loadConfig } from '../server/config.mjs';
import { MAX_DEPTH } from '../server/domain/folders.mjs';
import { ONLINE_WINDOW_MS, PAIRING_WINDOW_MS } from '../server/domain/displays.mjs';
import { MEDIA_LINK_TTL_MS } from '../server/domain/player.mjs';
import { SEND_CHUNK_BYTES } from '../server/http/send-file.mjs';

// Guarda contra "documentação que mente": o que os documentos afirmam sobre permissões, rotas, migrações, variáveis de ambiente,
// comandos e limites é conferido contra o código que de fato roda. Se o código mudar e o texto não, estes testes falham.

const read = relative => readFileSync(path.join(projectRoot, relative), 'utf8');
const docFiles = () => ['README.md', ...readdirSync(path.join(projectRoot, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];

// Documentos de fases anteriores: descrevem o pacote daquela fase e não são reescritos a cada fase. Eles não entram na conferência dos
// números ATUAIS (testes, rotas, migrações…), mas um teste próprio fixa os números que eles citam e exige que se declarem históricos.
const PHASE_ONE_DOCS = new Set(['docs/RELATORIO-FASE-1.md', 'docs/ARQUIVOS-DA-FASE-1.md']);
const HISTORICAL_DOCS = new Set([...PHASE_ONE_DOCS, 'docs/RELATORIO-FASE-2.md', 'docs/ARQUIVOS-DA-FASE-2.md', 'docs/REGISTRO-DE-MUDANCAS.md', 'docs/RELATORIO-2.1.0.md', 'docs/ARQUIVOS-2.1.0.md', 'docs/RELATORIO-2.2.0.md', 'docs/ARQUIVOS-2.2.0.md', 'docs/RELATORIO-2.3.0.md', 'docs/ARQUIVOS-2.3.0.md']);

// Remove blocos de código (``` … ```) e trechos em linha (`…`): exemplos e comandos não são links nem afirmações a conferir.
const withoutFences = text => text.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, '');
const withoutCode = text => withoutFences(text).replace(/`[^`\n]*`/g, '');

const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replaceAll('\\|', '|'));

// Tabelas Markdown: [{ header: [...], rows: [[...], ...] }]
function tablesOf(text) {
  const lines = withoutFences(text).split(/\r?\n/), found = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith('|') || !/^\|[\s:|-]+\|\s*$/.test(lines[index + 1] ?? '')) continue;
    const rows = [];
    let next = index + 2;
    while (next < lines.length && lines[next].startsWith('|')) rows.push(splitRow(lines[next++]));
    found.push({ header: splitRow(lines[index]), rows });
    index = next;
  }
  return found;
}

function tableWith(text, firstHeader, secondHeader) {
  const table = tablesOf(text).find(item => item.header[0] === firstHeader && (secondHeader === undefined || item.header[1] === secondHeader));
  assert.ok(table, `tabela "${firstHeader}${secondHeader ? ` | ${secondHeader}` : ''}" não encontrada`);
  return table;
}

const unquote = cell => cell.replace(/^`|`$/g, '');
const slugOf = heading => heading.replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim().toLowerCase()
  .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

function anchorsOf(file) {
  const seen = new Map(), anchors = new Set();
  for (const match of withoutFences(read(file)).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slugOf(match[1]), count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('documentação: todo link e toda imagem local existem; imagens têm texto alternativo; âncoras apontam para títulos reais', () => {
  const problems = [];
  let checked = 0;
  for (const file of docFiles()) {
    for (const match of withoutCode(read(file)).matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const [, bang, alt, target] = match;
      if (/^(?:https?:|mailto:)/i.test(target)) continue;
      checked++;
      const [pathPart, anchor] = target.split('#');
      const resolved = pathPart ? path.resolve(projectRoot, path.dirname(file), pathPart) : path.join(projectRoot, file);
      if (!existsSync(resolved)) { problems.push(`${file}: "${target}" não existe`); continue; }
      if (bang) {
        if (!alt.trim()) problems.push(`${file}: imagem ${target} sem texto alternativo`);
        const bytes = statSync(resolved).isFile() ? readFileSync(resolved) : Buffer.alloc(0);
        const validImage = /\.png$/i.test(resolved) ? bytes.subarray(0, 8).equals(PNG_SIGNATURE)
          : /\.jpe?g$/i.test(resolved) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
        if (!validImage || bytes.length < 5000) problems.push(`${file}: ${target} não é uma imagem PNG/JPEG válida`);
      }
      if (anchor && resolved.endsWith('.md') && !anchorsOf(path.relative(projectRoot, resolved)).has(anchor)) problems.push(`${file}: âncora "#${anchor}" não existe em ${path.relative(projectRoot, resolved)}`);
    }
  }
  assert.ok(checked >= 15, 'o teste precisa enxergar os links da documentação');
  assert.deepEqual(problems, []);
});

test('documentação: caminhos de arquivos citados entre crases existem no projeto', () => {
  const GENERATED = new Set(['tests/e2e/output']);
  const missing = [];
  let checked = 0;
  for (const file of docFiles()) {
    for (const match of withoutFences(read(file)).matchAll(/`((?:server|public|scripts|tests|docs)\/[^`\s]*)`/g)) {
      const token = match[1].replace(/[.,;:]+$/, '').replace(/\/$/, '');
      if (/[<>{}…]/.test(token) || GENERATED.has(token)) continue;
      checked++;
      const star = token.indexOf('*');
      const target = star < 0 ? token : (token.slice(0, star).endsWith('/') ? token.slice(0, star) : path.dirname(token.slice(0, star)));
      if (!existsSync(path.join(projectRoot, target))) missing.push(`${file}: ${token}`);
    }
  }
  assert.ok(checked >= 25, `poucos caminhos conferidos (${checked})`);
  assert.deepEqual(missing, []);
});

test('documentação: os índices apontam para todos os documentos (nenhum documento órfão)', () => {
  const readme = read('README.md');
  const orphans = readdirSync(path.join(projectRoot, 'docs')).filter(name => name.endsWith('.md') && !readme.includes(`docs/${name}`));
  assert.deepEqual(orphans, [], 'documentos que o README não menciona');
});

test('PERMISSOES.md: a matriz padrão é idêntica ao catálogo e aos perfis do servidor', () => {
  const text = read('docs/PERMISSOES.md');
  const { header, rows } = tableWith(text, 'Permissão', 'O que permite');
  assert.deepEqual(header.slice(2, 6), ['Administrador', 'Gestor', 'Editor', 'Visualizador']);
  const roles = ['admin', 'manager', 'editor', 'viewer'];
  assert.deepEqual(rows.map(row => unquote(row[0])), PERMISSION_IDS, 'mesmas permissões, na mesma ordem do catálogo');
  for (const row of rows) {
    const id = unquote(row[0]);
    assert.equal(row[1], PERMISSIONS[id].label, `${id}: descrição diferente da do catálogo`);
    roles.forEach((role, index) => {
      const cell = row[2 + index], expected = role === 'admin' ? true : ROLE_PERMISSIONS[role].includes(id);
      assert.ok(cell === '–' || cell.startsWith('✓'), `${id}/${role}: célula "${cell}" inválida`);
      assert.equal(cell.startsWith('✓'), expected, `${id}/${role}: o documento diz "${cell}" mas o servidor diz ${expected ? 'permitido' : 'não permitido'}`);
    });
    assert.equal(row[6], ADMIN_RESERVED.includes(id) ? 'sim' : 'não', `${id}: exclusiva da administração?`);
  }
  // Os números do resumo e as qualificações do Gestor.
  const summary = /Administrador\*\* tem as (\d+) permissões; o \*\*Gestor\*\* tem (\d+) .*?; o \*\*Editor\*\* tem (\d+)/.exec(text);
  assert.ok(summary, 'frase-resumo com as contagens não encontrada');
  assert.deepEqual(summary.slice(1).map(Number), [PERMISSION_IDS.length, ROLE_PERMISSIONS.manager.length, ROLE_PERMISSIONS.editor.length]);
  assert.equal(MANAGEABLE_ROLES.manager, undefined);
  assert.match(text, /Somente o Administrador gerencia usuários/);
  const manager = Object.fromEntries(rows.map(row => [unquote(row[0]), row[3]]));
  assert.equal(manager['user:manage'], '–');
  assert.match(manager['audit:read'], /escopo/);
  // O que a migração 6 preserva é o que o documento lista.
  const migration = read('server/db/migrations/006-users.mjs');
  for (const [role, label] of [['manager', 'Gestor'], ['editor', 'Editor']]) {
    const listed = new RegExp(`${role}: \\[([^\\]]*)\\]`).exec(migration)[1].match(/'([^']+)'/g).map(item => item.slice(1, -1));
    const row = tableWith(text, 'Perfil na 1.1.0', 'Permissões retiradas pela migração').rows.find(item => item[0] === label);
    assert.deepEqual([...row[1].matchAll(/`([^`]+)`/g)].map(item => item[1]), listed, `permissões retiradas de ${label}`);
  }
});

test('API-E-COMPATIBILIDADE.md: a tabela de rotas é idêntica às rotas registradas (método, caminho e forma de autenticação)', async () => {
  const { app, dataDir } = createTestApp();
  try {
    const text = read('docs/API-E-COMPATIBILIDADE.md');
    const { rows, header } = tableWith(text, 'Método', 'Caminho');
    assert.deepEqual(header, ['Método', 'Caminho', 'Acesso', 'Permissão e escopo', 'Finalidade']);
    const accessOf = cell => (cell.startsWith('Sessão ou TV') ? 'device-or-session' : cell.startsWith('Sessão') ? 'session' : cell.startsWith('Pública') ? 'none' : cell.startsWith('TV') ? 'device' : null);
    const documented = rows.map(row => ({ key: `${row[0]} ${unquote(row[1])}`, auth: accessOf(row[2]), permissions: [...row[3].matchAll(/`([a-z]+:[a-z]+)`/g)].map(match => match[1]) }));
    const actual = app.routes.map(route => ({ key: `${route.method} ${route.pattern}`, auth: route.auth }));
    assert.deepEqual(documented.map(item => item.key).sort(), actual.map(item => item.key).sort(), 'rotas documentadas × rotas registradas');
    assert.equal(new Set(documented.map(item => item.key)).size, documented.length, 'rota repetida na tabela');
    for (const item of documented) {
      assert.ok(item.auth, `${item.key}: forma de acesso não reconhecida`);
      assert.equal(item.auth, actual.find(route => route.key === item.key).auth, `${item.key}: forma de autenticação`);
    }
    // Toda permissão citada existe e toda permissão do catálogo aparece em alguma rota.
    const cited = new Set(documented.flatMap(item => item.permissions));
    for (const id of cited) assert.ok(PERMISSIONS[id], `permissão inexistente na tabela de rotas: ${id}`);
    assert.deepEqual(PERMISSION_IDS.filter(id => !cited.has(id)), [], 'permissões do catálogo que nenhuma rota documentada exige');
  } finally {
    await app.close();
    removeTempDir(dataDir);
  }
});

test('cada permissão do catálogo é verificada em algum ponto do servidor (nenhuma permissão decorativa)', () => {
  const sources = ['server/domain', 'server/routes'].flatMap(dir => readdirSync(path.join(projectRoot, dir)).filter(name => name.endsWith('.mjs')).map(name => `${dir}/${name}`))
    .filter(file => file !== 'server/domain/permissions.mjs');
  const text = sources.map(read).join('\n');
  const unused = PERMISSION_IDS.filter(id => !ADMIN_RESERVED.includes(id) && !text.includes(`'${id}'`));
  assert.match(read('server/domain/displays.mjs'), /requireDisplayAdmin\(actor\)/, 'TVs possuem guarda administrativa além do catálogo');
  assert.deepEqual(unused, [], 'permissões do catálogo que nenhum código do servidor consulta');
});

test('MIGRACOES.md: a tabela lista exatamente as migrações do código, na ordem', () => {
  const { rows } = tableWith(read('docs/MIGRACOES.md'), 'Nº', 'Nome');
  assert.deepEqual(rows.map(row => [Number(row[0]), unquote(row[1])]), migrations.map(migration => [migration.id, migration.name]));
  assert.match(read('docs/IMPLANTACAO.md'), new RegExp(`"schema":${migrations.at(-1).id}`), 'a resposta de /healthz citada no guia de implantação traz o esquema atual');
});

test('IMPLANTACAO.md: a tabela de variáveis cobre o .env.example e os padrões citados batem com a configuração', () => {
  const { rows } = tableWith(read('docs/IMPLANTACAO.md'), 'Variável', 'Padrão');
  const documented = new Map(rows.map(row => [unquote(row[0]), row[1]]));
  const declared = new Set();
  for (const line of read('.env.example').split(/\r?\n/)) {
    const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) declared.add(match[1]);
  }
  assert.deepEqual([...documented.keys()].sort(), [...declared].sort(), 'variáveis documentadas × variáveis do .env.example');
  const config = loadConfig({ env: {} });
  const expected = { PORT: String(config.port), HOST: config.host, MAX_UPLOAD_MB: String(config.maxUpload / 1024 / 1024), PLAYLIST_MAX_ITEMS: String(config.playlistMaxItems), TRUST_PROXY: String(config.trustProxy === 0 ? false : config.trustProxy) };
  for (const [name, value] of Object.entries(expected)) assert.equal(unquote(documented.get(name)), value, `${name}: padrão documentado`);
  // Toda variável que o servidor lê aparece no guia.
  const used = new Set();
  for (const file of ['server/config.mjs', 'server/dev-admin.mjs']) for (const match of read(file).matchAll(/\benv\??\.([A-Z][A-Z0-9_]+)/g)) used.add(match[1]);
  assert.deepEqual([...used].filter(name => !documented.has(name)), []);
});

test('documentação: comandos npm, scripts e atalhos citados existem', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  const problems = [];
  let checked = 0;
  for (const file of docFiles()) {
    const text = read(file);
    for (const match of text.matchAll(/\bnpm(?:\.cmd)?\s+run\s+([A-Za-z0-9:_-]+)/g)) { checked++; if (!scripts[match[1]]) problems.push(`${file}: npm run ${match[1]}`); }
    for (const match of text.matchAll(/\bnpm(?:\.cmd)?\s+(start|test)\b/g)) { checked++; if (!scripts[match[1]]) problems.push(`${file}: npm ${match[1]}`); }
    for (const match of text.matchAll(/\bnode\s+(?:--[\w-]+(?:=\S+)?\s+)*((?:scripts|server|tests)\/[\w./-]+\.mjs)/g)) { checked++; if (!existsSync(path.join(projectRoot, match[1]))) problems.push(`${file}: node ${match[1]}`); }
    for (const match of text.matchAll(/\b(0\d-[\w-]+\.cmd)\b/g)) { checked++; if (!existsSync(path.join(projectRoot, match[1]))) problems.push(`${file}: ${match[1]}`); }
  }
  assert.ok(checked >= 20, `poucos comandos conferidos (${checked})`);
  assert.deepEqual(problems, []);
});

test('documentação: limites e prazos citados batem com as constantes do código', () => {
  const api = read('docs/API-E-COMPATIBILIDADE.md');
  assert.match(api, new RegExp(`Profundidade máxima: \\*\\*${MAX_DEPTH} níveis\\*\\*`));
  assert.match(api, new RegExp(`contato nos últimos ${ONLINE_WINDOW_MS / 1000} s`));
  assert.match(api, new RegExp(`válido por ${PAIRING_WINDOW_MS / 60000} minutos`));
  // Duração e transição: limites gravados no banco e validados no servidor.
  const items = read('server/db/migrations/005-playlists-schedules.mjs'), playlists = read('server/domain/playlists.mjs');
  const duration = /duration_s INTEGER NOT NULL CHECK \(duration_s BETWEEN (\d+) AND (\d+)\)/.exec(items), transition = /transition_ms INTEGER NOT NULL DEFAULT 0 CHECK \(transition_ms BETWEEN (\d+) AND (\d+)\)/.exec(items);
  assert.match(api, new RegExp(`duração de \\*\\*${duration[1]} a ${duration[2]} s\\*\\*`));
  assert.match(api, new RegExp(`\\*\\*${transition[1]} a ${transition[2]} ms\\*\\*`));
  assert.match(playlists, new RegExp(`integer\\(item\\.durationS \\?\\? DEFAULT_DURATION, ${duration[1]}, ${duration[2]}`));
  assert.match(playlists, new RegExp(`transitionMs \\?\\? DEFAULT_TRANSITION_MS, ${transition[1]}, ${transition[2]}`));
  assert.match(api, /padrão 15/); assert.match(playlists, /DEFAULT_DURATION = 15/);
  assert.match(api, /padrão 600 ms/); assert.match(playlists, /DEFAULT_TRANSITION_MS = 600/);
  // Sessão, manifesto e tentativas.
  const sessions = read('server/domain/sessions.mjs'), player = read('server/domain/player.mjs'), auth = read('server/routes/auth.mjs'), displays = read('server/routes/displays.mjs');
  const hours = Number(/const SESSION_MS = (\d+) \* 60 \* 60 \* 1000/.exec(sessions)[1]);
  assert.match(api, new RegExp(`validade de ${hours} horas`));
  const manifest = Number(/const MANIFEST_VALIDITY_MS = (\d+) \* 1000/.exec(player)[1]);
  assert.match(api, new RegExp(`no máximo ${manifest} s à frente`));
  const pairing = /s\.limit\(`pair:\$\{ctx\.ip\}`, (\d+), (\d+) \* 60000\)/.exec(displays);
  assert.match(api, new RegExp(`${pairing[1]} tentativas por endereço a cada ${pairing[2]} minutos`));
  const login = /s\.limit\(`login:\$\{ctx\.ip\}`, (\d+), (\d+) \* 60000\)/.exec(auth);
  const security = read('docs/SEGURANCA.md');
  assert.match(security, new RegExp(`${login[1]} tentativas em ${login[2]} minutos`), 'limite de tentativas de login citado em SEGURANCA.md');
  assert.match(security, new RegExp(`${hours} horas`), 'validade da sessão citada em SEGURANCA.md');
  assert.match(security, /entre 12 e 128 caracteres/);
  assert.match(read('server/lib/validate.mjs'), /value\.length < 12 \|\| value\.length > 128/);
  // Vídeo direto (2.4.0): o prazo do link, o bloco de leitura da entrega e a chave que a TV usa para lembrar o caminho são os do código.
  const hoursOfLink = MEDIA_LINK_TTL_MS / 3_600_000, report = read('docs/RELATORIO-2.4.0.md');
  assert.ok(Number.isInteger(hoursOfLink), 'o prazo do link é um número inteiro de horas');
  assert.match(api, new RegExp(`o link vale por ${hoursOfLink} horas`), 'validade do link citada em API-E-COMPATIBILIDADE.md');
  assert.match(report, new RegExp(`Vale ${hoursOfLink} horas`), 'validade do link citada em RELATORIO-2.4.0.md');
  assert.match(report, new RegExp(`\\| \\*\\*${SEND_CHUNK_BYTES / 1024} KB \\(agora\\)\\*\\* \\|`), 'bloco de leitura citado em RELATORIO-2.4.0.md');
  const wayKey = /VIDEO_WAY_KEY = '([^']+)'/.exec(read('public/js/player/app.js'))[1];
  for (const file of ['docs/RELATORIO-2.4.0.md', 'docs/OPERACAO.md']) assert.ok(read(file).includes(`\`${wayKey}\``), `${file} deve citar a chave ${wayKey}`);
});

// Os limites que o servidor realmente aplica, lidos do próprio código: configuração (testada por tentativa) e restrições do banco.
function codeLimits() {
  const accepted = (name, upTo) => Array.from({ length: upTo + 1 }, (_, value) => value).filter(value => {
    try { loadConfig({ env: { [name]: String(value) } }); return true; } catch { return false; }
  });
  const upload = accepted('MAX_UPLOAD_MB', 300), items = accepted('PLAYLIST_MAX_ITEMS', 30);
  for (const range of [upload, items]) assert.equal(range.length, range.at(-1) - range[0] + 1, 'os valores aceitos formam uma faixa contínua');
  const defaults = loadConfig({ env: {} });
  const migration = read('server/db/migrations/005-playlists-schedules.mjs'), playlists = read('server/domain/playlists.mjs');
  const duration = /duration_s INTEGER NOT NULL CHECK \(duration_s BETWEEN (\d+) AND (\d+)\)/.exec(migration);
  const transition = /transition_ms INTEGER NOT NULL DEFAULT 0 CHECK \(transition_ms BETWEEN (\d+) AND (\d+)\)/.exec(migration);
  return {
    uploadDefault: defaults.maxUpload / 1024 / 1024, uploadMin: upload[0], uploadMax: upload.at(-1),
    itemsDefault: defaults.playlistMaxItems, itemsMin: items[0], itemsMax: items.at(-1),
    durationMin: Number(duration[1]), durationMax: Number(duration[2]), durationDefault: Number(/DEFAULT_DURATION = (\d+)/.exec(playlists)[1]),
    transitionMin: Number(transition[1]), transitionMax: Number(transition[2]), transitionDefault: Number(/DEFAULT_TRANSITION_MS = (\d+)/.exec(playlists)[1])
  };
}

test('documentação: todo número de limite citado (envio, itens por playlist, duração, transição) é o que o código aplica', () => {
  const limit = codeLimits();
  assert.deepEqual([limit.uploadMin, limit.uploadMax, limit.uploadDefault, limit.itemsMin, limit.itemsMax, limit.itemsDefault], [1, 250, 50, 1, 15, 6], 'limites que a documentação precisa refletir');
  // [descrição, expressão (com um grupo por número citado), números esperados]. Cada expressão tem de aparecer em ao menos um documento.
  const claims = [
    ['envio: padrão em MB', /(\d+) MB(?:\*\*)? (?:por arquivo|por padrão)/g, [limit.uploadDefault]],
    ['envio: padrão da variável', /`MAX_UPLOAD_MB` \(padrão (\d+)\)/g, [limit.uploadDefault]],
    ['envio: faixa "de … a …"', /`MAX_UPLOAD_MB`[^\n]{0,60}?\bde (\d+) a (\d+)/g, [limit.uploadMin, limit.uploadMax]],
    ['envio: faixa "entre … e …"', /`MAX_UPLOAD_MB` entre (\d+) e (\d+)/g, [limit.uploadMin, limit.uploadMax]],
    ['envio: teto "até …"', /`MAX_UPLOAD_MB`, até (\d+)/g, [limit.uploadMax]],
    ['itens por playlist: padrão e teto (API)', /`PLAYLIST_MAX_ITEMS` \(padrão (\d+), até (\d+)\)/g, [limit.itemsDefault, limit.itemsMax]],
    ['itens por playlist: faixa "entre … e …"', /`PLAYLIST_MAX_ITEMS` entre (\d+) e (\d+)/g, [limit.itemsMin, limit.itemsMax]],
    ['itens por playlist: tabela de variáveis', /\| `PLAYLIST_MAX_ITEMS` \|[^\n]*?\bde (\d+) a (\d+)\./g, [limit.itemsMin, limit.itemsMax]],
    ['itens por playlist: guia de funcionalidades', /\((\d+) por padrão; o servidor aceita configurar de (\d+) a (\d+)\)/g, [limit.itemsDefault, limit.itemsMin, limit.itemsMax]],
    ['itens por playlist: relatório', /\((\d+) por padrão, até (\d+)\)/g, [limit.itemsDefault, limit.itemsMax]],
    ['itens por playlist: migrações', /limite atual \((\d+) por padrão\)[^\n]*?passam de (\d+) e de (\d+)/g, [limit.itemsDefault, limit.itemsDefault, limit.itemsMax]],
    ['duração: arquitetura', /\((\d+)–(\d+) s\)/g, [limit.durationMin, limit.durationMax]],
    ['duração: formatos', /de (\d+) a (\d+) segundos\*\* \(padrão (\d+) s\)/g, [limit.durationMin, limit.durationMax, limit.durationDefault]],
    ['duração: funcionalidades', /Duração \(s\)\*\* \(de (\d+) a (\d+); padrão (\d+)\)/g, [limit.durationMin, limit.durationMax, limit.durationDefault]],
    ['duração: migrações', /mínimo (\d+) s, máximo (\d+) s; sem valor válido, (\d+) s/g, [limit.durationMin, limit.durationMax, limit.durationDefault]],
    ['duração: relatório', /tempo individual de cada conteúdo \((\d+) a (\d+) s\)/g, [limit.durationMin, limit.durationMax]],
    ['transição: arquitetura', /(\d+)–(\d+) ms/g, [limit.transitionMin, limit.transitionMax]],
    ['transição: formatos', /\bde (\d+) a (\d+) ms\)/g, [limit.transitionMin, limit.transitionMax]]
  ];
  const problems = [], seen = new Map(claims.map(([what]) => [what, 0]));
  for (const file of docFiles()) {
    const text = withoutFences(read(file));
    for (const [what, pattern, expected] of claims) {
      for (const match of text.matchAll(pattern)) {
        seen.set(what, seen.get(what) + 1);
        const cited = match.slice(1).map(Number);
        if (cited.join() !== expected.join()) problems.push(`${file}: ${what}: "${match[0]}" cita ${cited.join(' / ')}, o código aplica ${expected.join(' / ')}`);
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual([...seen].filter(([, count]) => count === 0).map(([what]) => what), [], 'afirmações que não aparecem mais em nenhum documento: atualize a expressão ou o texto');
  // O proxy reverso de exemplo precisa aceitar um corpo maior que o limite do servidor, senão ele recusa antes.
  const nginx = /client_max_body_size\s+(\d+)m/.exec(read('docs/IMPLANTACAO.md'));
  assert.ok(nginx && Number(nginx[1]) > limit.uploadDefault, 'o exemplo de proxy deve permitir mais que o limite de envio padrão');
});

test('documentação: a versão do pacote e as contagens de testes citadas no relatório correspondem ao projeto', () => {
  const version = JSON.parse(read('package.json')).version;
  for (const file of ['README.md', 'docs/RELATORIO-2.4.0.md', 'docs/REGISTRO-DE-MUDANCAS.md', 'docs/VALIDACAO.md']) assert.ok(read(file).includes(version), `${file} deve citar a versão ${version}`);
  assert.match(read('docs/IMPLANTACAO.md'), new RegExp(`"version":"${version.replace(/\./g, '\\.')}"`), 'resposta de /healthz citada no guia de implantação');
  // Cada cenário de navegador citado existe, e todos os que existem são citados.
  const scenarios = readdirSync(path.join(projectRoot, 'tests', 'e2e')).filter(name => name.endsWith('.e2e.mjs'));
  const validation = read('docs/VALIDACAO.md');
  assert.deepEqual(scenarios.filter(name => !validation.includes(name)), [], 'cenários e2e que VALIDACAO.md não cita');
  // Cada arquivo de teste automatizado é citado em VALIDACAO.md.
  const suites = readdirSync(path.join(projectRoot, 'tests')).filter(name => name.endsWith('.test.mjs'));
  assert.deepEqual(suites.filter(name => !validation.includes(name)), [], 'arquivos de teste que VALIDACAO.md não cita');
});

// Afirmações que este projeto não pode fazer: certificação, conformidade com normas e compatibilidade ou homologação em TVs reais.
const FORBIDDEN_CLAIMS = [
  /(?:é|está|foi)\s+certificad[oa]/gi,
  /compatível com (?:LG|Samsung|AOC|webOS|Tizen)/gi,
  /homologad[oa]s? (?:em|nas?|nos?) (?:LG|Samsung|AOC|TVs? reais)/gi,
  /(?:atende|atendem|cumpre|cumprem)\s+(?:à|a|ao|com)?\s*(?:norma\s+)?(?:ISO|TISAX|VDA)/gi
];

test('documentação honesta: nada de certificação ISO/TISAX nem de compatibilidade de TVs afirmada sem validação', () => {
  const offenders = [];
  for (const file of docFiles()) {
    const text = withoutFences(read(file));
    if (/ISO\s?\/?\s?(?:IEC)?\s?27001|TISAX|VDA\s?ISA/i.test(text) && !/n[ãa]o[^.\n]{0,160}certific|certific[^.\n]{0,160}\bn[ãa]o\b|sem\s+certifica/i.test(text)) offenders.push(`${file}: cita ISO 27001/TISAX sem declarar que não há certificação`);
    if (/\b(?:webOS|Tizen|Samsung|LG|AOC|Android TV|Roku)\b/.test(text) && !/n[ãa]o[^.\n]{0,200}(?:valid|homolog|test)/i.test(text)) offenders.push(`${file}: cita marcas de TV sem declarar que a compatibilidade não foi validada`);
    // Frases de certeza proibidas. Todas as ocorrências são examinadas, não só a primeira: só vale a que vier negada ("não é certificado").
    for (const pattern of FORBIDDEN_CLAIMS) {
      for (const match of text.matchAll(pattern)) {
        if (!/n[ãa]o[^.\n]{0,80}$/i.test(text.slice(Math.max(0, match.index - 90), match.index))) offenders.push(`${file}: "${match[0]}"`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('documentação honesta: o detector de frases proibidas pega a ocorrência afirmativa mesmo depois de uma negada', () => {
  const flagged = text => [...FORBIDDEN_CLAIMS.flatMap(pattern => [...text.matchAll(pattern)])]
    .filter(match => !/n[ãa]o[^.\n]{0,80}$/i.test(text.slice(Math.max(0, match.index - 90), match.index))).map(match => match[0]);
  assert.deepEqual(flagged('O projeto não é certificado ISO 27001.'), []);
  assert.deepEqual(flagged('O projeto não é certificado ISO 27001.\nA TV Corporativa é certificado ISO 27001.'), ['é certificado']);
  assert.deepEqual(flagged('A plataforma está certificada.'), ['está certificada']);
  assert.deepEqual(flagged('Ainda não foi homologado em TVs reais. Já foi homologado em TVs reais.'), ['homologado em TVs reais']);
  assert.deepEqual(flagged('Não é compatível com Samsung. O sistema é compatível com LG.'), ['compatível com LG']);
  assert.deepEqual(flagged('Atende à ISO 27001 e cumpre a norma TISAX.'), ['Atende à ISO', 'cumpre a norma TISAX']);
});

// ---------------------------------------------------------------------------------------------------------------------
// Números citados: o que VALIDACAO.md, RELATORIO-FASE-1.md e o README dizem sobre quantidade de testes, cenários, etapas,
// rotas, migrações e arquivos precisa ser igual ao que o projeto tem de fato.

// Um `test(` declarado dentro de um laço roda uma vez por volta: flow.test.mjs repete o fluxo completo em dois transportes.
const RUNS_PER_DECLARATION = { 'tests/flow.test.mjs': 2 };
// Quatro casos de perda de autorização são declarados na mesma linha do laço no teste de compartilhamento.
const INLINE_CASES = { 'tests/shared-displays.test.mjs': 4 };
const declaredTests = file => (read(file).match(/^\s*test\(/gm) ?? []).length * (RUNS_PER_DECLARATION[file] ?? 1) + (INLINE_CASES[file] ?? 0);
// Uma etapa é declarada por `await step(` ou, nos cenários que aceitam o filtro E2E_STEPS, por `await run(` (que chama `step`).
const declaredSteps = file => (read(file).match(/\bawait (?:step|run)\(/g) ?? []).length;
const filesIn = (dir, suffix) => readdirSync(path.join(projectRoot, dir)).filter(name => name.endsWith(suffix)).map(name => `${dir}/${name}`).sort();
// Mesma enumeração de scripts/check.mjs.
const javascriptFiles = dir => readdirSync(path.join(projectRoot, dir), { withFileTypes: true }).flatMap(entry => {
  const file = `${dir}/${entry.name}`;
  return entry.isDirectory() ? javascriptFiles(file) : /\.(?:mjs|js)$/.test(entry.name) ? [file] : [];
});

test('VALIDACAO.md e demais documentos: contagens de testes, cenários, etapas, rotas, migrações e arquivos batem com o projeto', async () => {
  const validation = read('docs/VALIDACAO.md');
  const suites = filesIn('tests', '.test.mjs'), scenarios = filesIn('tests/e2e', '.e2e.mjs');
  const rowsOf = (first, second) => tablesOf(validation).filter(table => table.header[0] === first && table.header[1] === second).flatMap(table => table.rows);
  const suiteRows = rowsOf('Arquivo', 'Testes'), scenarioRows = rowsOf('Arquivo', 'Etapas');

  assert.deepEqual(suiteRows.map(row => unquote(row[0])).sort(), suites, 'toda suíte de testes aparece, uma vez, na tabela de VALIDACAO.md');
  for (const row of suiteRows) assert.equal(Number(row[1]), declaredTests(unquote(row[0])), `${unquote(row[0])}: testes na tabela × testes declarados`);
  assert.deepEqual(scenarioRows.map(row => unquote(row[0])).sort(), scenarios, 'todo cenário em navegador aparece, uma vez, na tabela de VALIDACAO.md');
  for (const row of scenarioRows) assert.equal(Number(row[1]), declaredSteps(unquote(row[0])), `${unquote(row[0])}: etapas na tabela × etapas declaradas`);
  const totalTests = suiteRows.reduce((sum, row) => sum + Number(row[1]), 0), totalSteps = scenarioRows.reduce((sum, row) => sum + Number(row[1]), 0);

  // O quadro de resultado diz coisas coerentes entre si.
  const result = /(\d+) testes automatizados: (\d+) passaram, (\d+) falharam, (\d+) ignorados/.exec(validation);
  assert.ok(result, 'frase de resultado dos testes automatizados não encontrada');
  const [declared, passed, failed, skipped] = result.slice(1).map(Number);
  assert.deepEqual([declared, passed + failed + skipped, failed], [totalTests, totalTests, 0], 'contagem honesta: ignorados não são aprovados');
  const browser = /(\d+) cenários em navegador \((\d+) etapas\): (\d+) passaram, (\d+) falharam, (\d+) ignorados/.exec(validation);
  assert.ok(browser, 'frase de resultado dos cenários em navegador não encontrada');
  const [scenarioCount, stepCount, browserPassed, browserFailed, browserSkipped] = browser.slice(1).map(Number);
  assert.deepEqual([scenarioCount, stepCount, browserPassed + browserFailed + browserSkipped, browserFailed], [scenarios.length, totalSteps, scenarios.length, 0]);

  // Os mesmos números onde quer que apareçam, em qualquer documento.
  const { app, dataDir } = createTestApp();
  let routeCount;
  try { routeCount = app.routes.length; } finally { await app.close(); removeTempDir(dataDir); }
  const jsCount = ['server', 'public', 'scripts', 'tests'].flatMap(javascriptFiles).length;
  const isoControls = tableWith(read('docs/SEGURANCA.md'), 'Controle', 'O que a aplicação oferece').rows.length;
  const expectations = [
    [/\b(\d+) testes automatizados\b/g, totalTests, 'testes automatizados'],
    [/\b(\d+) cenários em navegador\b/g, scenarios.length, 'cenários em navegador'],
    [/\((\d+) etapas\)/g, totalSteps, 'etapas'],
    [/\b(\d+) arquivos JavaScript verificados\b/g, jsCount, 'arquivos JavaScript verificados'],
    [/\b(\d+) rotas\b/g, routeCount, 'rotas'],
    [/\b(\d+) migrações\b/g, migrations.length, 'migrações'],
    [/\b(\d+) permissões\b/g, PERMISSION_IDS.length, 'permissões'],
    [/\b(\d+) controles do Anexo A\b/g, isoControls, 'controles do Anexo A']
  ];
  const seen = new Map(expectations.map(([, , label]) => [label, 0]));
  for (const file of docFiles().filter(name => !HISTORICAL_DOCS.has(name))) {
    const text = withoutFences(read(file));
    for (const [pattern, expected, label] of expectations) {
      for (const match of text.matchAll(pattern)) {
        seen.set(label, seen.get(label) + 1);
        assert.equal(Number(match[1]), expected, `${file}: "${match[0]}" — o projeto tem ${expected}`);
      }
    }
  }
  for (const label of ['testes automatizados', 'cenários em navegador', 'etapas', 'arquivos JavaScript verificados']) assert.ok(seen.get(label) >= 1, `nenhum documento cita "${label}"`);
  assert.ok(seen.get('testes automatizados') >= 3, 'o total de testes deve aparecer em VALIDACAO.md, no relatório e no README');
});

test('documentação: sem marcadores de rascunho nem texto de preenchimento', () => {
  const offenders = [];
  for (const file of docFiles()) {
    const text = withoutFences(read(file));
    for (const pattern of [/\{\{|\}\}/, /\bTODO\b|\bFIXME\b|\bXXX\b/, /lorem ipsum/i, /\[(?:inserir|preencher|a definir)[^\]]*\]/i, /\?\?\?/, /^(?:<{7}|>{7})/m]) {
      const match = pattern.exec(text);
      if (match) offenders.push(`${file}: "${match[0]}"`);
    }
  }
  assert.deepEqual(offenders, []);
});

// Cada anexo é uma fotografia da diferença entre o pacote da fase anterior e o da sua fase (a Fase 1 compara com a 1.1.0). Enquanto o
// pacote continuar na versão que o anexo descreve, a lista tem de ser exatamente a árvore de arquivos; depois, ele passa a ser histórico
// e só se confere o que não depende dela.
const SKIPPED_DIRECTORIES = new Set(['data', 'node_modules', '.git', 'tests/e2e/output']);
function shippedTree(dir = '') {
  return readdirSync(path.join(projectRoot, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (SKIPPED_DIRECTORIES.has(relative)) return [];
    return entry.isDirectory() ? shippedTree(relative) : [relative];
  });
}

const ANNEXES = [
  { file: 'docs/ARQUIVOS-DA-FASE-1.md', report: 'docs/RELATORIO-FASE-1.md', version: '2.0.0-fase1' },
  { file: 'docs/ARQUIVOS-DA-FASE-2.md', report: 'docs/RELATORIO-FASE-2.md', version: '2.0.0-fase2' }
];

function checkAnnex({ file, report, version: annexVersion }) {
  const text = read(file);
  const version = JSON.parse(read('package.json')).version;
  const documentedVersion = /Versão \*\*([^*]+)\*\*/.exec(text)?.[1];
  assert.equal(documentedVersion, annexVersion, `${file}: o anexo precisa dizer a que versão se refere`);

  const sections = {};
  for (const part of text.split(/^## /m).slice(1)) {
    const heading = /^Arquivos (novos|modificados|removidos|inalterados) \((\d+)\)/.exec(part.split('\n', 1)[0]);
    if (!heading) continue;
    const paths = [];
    for (const block of part.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) paths.push(...block[1].split('\n').map(line => line.trim()).filter(Boolean));
    sections[heading[1]] = { declared: Number(heading[2]), paths };
  }
  assert.deepEqual(Object.keys(sections).sort(), ['inalterados', 'modificados', 'novos', 'removidos']);
  for (const [name, section] of Object.entries(sections)) assert.equal(section.paths.length, section.declared, `${name}: o título diz ${section.declared}, a lista tem ${section.paths.length}`);
  const all = Object.values(sections).flatMap(section => section.paths);
  assert.equal(new Set(all).size, all.length, 'um arquivo aparece em mais de uma lista');

  // A tabela-resumo do começo repete as contagens.
  const summary = Object.fromEntries(tableWith(text, 'Situação', 'Quantidade').rows.map(row => [row[0].toLowerCase(), Number(row[1])]));
  assert.deepEqual(summary, { novos: sections.novos.declared, modificados: sections.modificados.declared, removidos: sections.removidos.declared, inalterados: sections.inalterados.declared });

  if (documentedVersion !== version) return;
  for (const name of ['novos', 'modificados', 'inalterados']) for (const item of sections[name].paths) assert.ok(existsSync(path.join(projectRoot, item)), `${name}: ${item} não existe no pacote`);
  for (const item of sections.removidos.paths) assert.ok(!existsSync(path.join(projectRoot, item)), `removidos: ${item} ainda existe no pacote`);
  const present = [...sections.novos.paths, ...sections.modificados.paths, ...sections.inalterados.paths].sort();
  assert.deepEqual(present, shippedTree().sort(), 'o anexo precisa listar exatamente os arquivos do pacote');
  // O relatório da fase cita as mesmas contagens.
  const reportText = read(report);
  for (const [name, section] of Object.entries(sections)) assert.match(reportText, new RegExp(`\\b${section.declared} arquivos ${name}\\b`), `${report} deve citar "${section.declared} arquivos ${name}"`);
}

test('ARQUIVOS-DA-FASE-1.md: anexo histórico, consistente consigo mesmo (as listas só são comparadas com o pacote enquanto ele estiver na versão do anexo)', () => checkAnnex(ANNEXES[0]));

test('ARQUIVOS-DA-FASE-2.md: as listas de novos, modificados, removidos e inalterados correspondem ao pacote', () => {
  checkAnnex(ANNEXES[1]);
});

test('documentos da Fase 1: declaram-se históricos e citam os números do pacote 2.0.0-fase1, que o projeto deixou de ter', () => {
  // Fixados aqui de propósito: a Fase 2 mudou o projeto, e estes documentos continuam descrevendo o pacote da Fase 1.
  const phase1 = { 'testes automatizados': 224, 'cenários em navegador': 8, etapas: 81, migrações: 6, permissões: 20, 'controles do Anexo A': 17 };
  const patterns = {
    'testes automatizados': /\b(\d+) testes automatizados\b/g, 'cenários em navegador': /\b(\d+) cenários em navegador\b/g, etapas: /\((\d+) etapas\)/g,
    migrações: /\b(\d+) migrações\b/g, permissões: /\b(\d+) permissões\b/g, 'controles do Anexo A': /\b(\d+) controles do Anexo A\b/g
  };
  const report = withoutFences(read('docs/RELATORIO-FASE-1.md'));
  for (const [label, pattern] of Object.entries(patterns)) {
    const found = [...report.matchAll(pattern)].map(match => Number(match[1]));
    assert.ok(found.length >= 1, `RELATORIO-FASE-1.md cita "${label}"`);
    assert.deepEqual([...new Set(found)], [phase1[label]], `${label}: o relatório da Fase 1 cita os números daquela fase`);
  }
  for (const file of PHASE_ONE_DOCS) {
    const text = read(file);
    assert.match(text, /Documento histórico da Fase 1/, `${file} precisa se declarar histórico`);
    assert.ok(text.includes('2.0.0-fase1'), `${file} precisa dizer a que versão se refere`);
    assert.match(text, /\(RELATORIO-FASE-2\.md\)/, `${file} precisa apontar para o relatório atual`);
  }
});
