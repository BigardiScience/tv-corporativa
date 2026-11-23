// Estrutura e regras de segurança do painel (frontend), conferidas sem navegador:
// módulos e importações, rotas, páginas HTML, estilos, ícones e permissões usados — e o que o código nunca pode conter.
// O comportamento real (clique, foco, janelas, arrastar) é validado nos testes de ponta a ponta com Chromium (tests/e2e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './helpers/app.mjs';
import { PERMISSION_IDS } from '../server/domain/permissions.mjs';
import { ROUTES, ROUTE_PERMISSION } from '../public/js/lib/router-core.js';
import { ICONS } from '../public/js/ui/icons.js';

const publicDir = path.join(projectRoot, 'public');
const jsDir = path.join(publicDir, 'js');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
const modules = walk(jsDir).filter(file => file.endsWith('.js')).sort();
const rel = file => path.relative(publicDir, file).split(path.sep).join('/');
const read = file => readFileSync(file, 'utf8');
const MAIN = path.join(jsDir, 'main.js');
const PLAYER = path.join(publicDir, 'player.js'); // ponto de entrada do player da TV (o painel começa em MAIN)

// Remove comentários sem mexer em textos entre aspas nem em expressões regulares (para procurar padrões proibidos só no código).
function stripComments(code) {
  let out = '', index = 0, quote = '';
  const previous = () => { for (let back = out.length - 1; back >= 0; back--) if (!/\s/.test(out[back])) return out[back]; return ''; };
  while (index < code.length) {
    const char = code[index], next = code[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next ?? ''; index += 2; continue; }
      if (char === quote) quote = '';
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; index++; continue; }
    if (char === '/' && next === '/') { while (index < code.length && code[index] !== '\n') index++; continue; }
    if (char === '/' && next === '*') { index += 2; while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) index++; index += 2; continue; }
    if (char === '/' && (previous() === '' || '(,=:[!&|?{};+-*%<>~^'.includes(previous()))) {
      let end = index + 1, inClass = false;
      for (; end < code.length; end++) {
        const item = code[end];
        if (item === '\\') { end++; continue; }
        if (item === '\n') break;
        if (item === '[') inClass = true; else if (item === ']') inClass = false; else if (item === '/' && !inClass) break;
      }
      out += code.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    out += char;
    index++;
  }
  return out;
}
const code = file => stripComments(read(file));

function importsOf(file) {
  const text = code(file);
  const found = [];
  for (const match of text.matchAll(/\bimport\s+([^'"()]*?)\s+from\s*(['"])([^'"]+)\2/g)) {
    const clause = match[1].trim();
    const named = /\{([^}]*)\}/.exec(clause)?.[1].split(',').map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean) ?? [];
    const defaultName = /^([\w$]+)\s*(?:,|$)/.exec(clause)?.[1];
    found.push({ specifier: match[3], named, hasDefault: Boolean(defaultName) });
  }
  for (const match of text.matchAll(/\bexport\s+(?:\*|\{([^}]*)\})\s*(?:as\s+[\w$]+\s*)?from\s*(['"])([^'"]+)\2/g)) {
    found.push({ specifier: match[3], named: (match[1] ?? '').split(',').map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean), hasDefault: false });
  }
  for (const match of text.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) found.push({ specifier: match[2], named: [], hasDefault: false });
  return found;
}
const resolveImport = (from, specifier) => path.resolve(path.dirname(from), specifier);

// ---- o verificador de comentários (a ferramenta dos testes abaixo também é testada) ----------------------------------------------

test('verificador de código: comentários saem, textos e expressões regulares ficam', () => {
  const sample = [
    "const url = 'http://www.w3.org/2000/svg'; // innerHTML aqui é comentário",
    '/* eval(1) */ const pattern = /["\'<>]\\/\\/x/; const ok = 4 / 2 / 1; // fim',
    'const text = `modelo // não é comentário ${1 + 1}`; const raw = "aspas \\" // dentro";',
    '// document.write("x")'
  ].join('\n');
  const cleaned = stripComments(sample);
  assert.ok(cleaned.includes("'http://www.w3.org/2000/svg'"));
  assert.ok(cleaned.includes('/["\'<>]\\/\\/x/'));
  assert.ok(cleaned.includes('4 / 2 / 1'));
  assert.ok(cleaned.includes('`modelo // não é comentário ${1 + 1}`'));
  assert.ok(cleaned.includes('"aspas \\" // dentro"'));
  for (const gone of ['innerHTML', 'eval(1)', 'document.write', 'fim']) assert.ok(!cleaned.includes(gone), gone);
});

// ---- módulos e importações ---------------------------------------------------------------------------------------------------------

test('painel: o código antigo (monólito) foi substituído pela estrutura modular e nada dele sobrou', () => {
  for (const legacy of ['app.js', 'auth-view.js', 'media-validation.js']) assert.ok(!existsSync(path.join(publicDir, legacy)), `public/${legacy} foi substituído por módulos em public/js`);
  assert.ok(existsSync(path.join(projectRoot, 'tests', 'frontend-core.test.mjs')));
  assert.ok(!existsSync(path.join(projectRoot, 'tests', 'frontend.test.mjs')), 'o teste do código antigo foi substituído pelos testes frontend-*.test.mjs');
  assert.ok(existsSync(MAIN));
  assert.ok(modules.length >= 60, `esperados ao menos 60 módulos, encontrados ${modules.length}`);
  assert.deepEqual(readdirSync(publicDir).filter(name => name.endsWith('.js')).sort(), ['player.js'], 'único script solto em public/: o player da TV');
  const pendingView = modules.filter(file => /pendingView/.test(read(file)));
  assert.deepEqual(pendingView.map(rel), [], 'resto da tela provisória da versão anterior');
});

test('painel: toda importação aponta para um arquivo e para um nome que existem; só caminhos relativos, sem importação dinâmica', async () => {
  const problems = [];
  const cache = new Map();
  const load = async file => {
    if (!cache.has(file)) cache.set(file, import(pathToFileURL(file).href));
    return cache.get(file);
  };
  for (const file of [...modules, PLAYER]) {
    const text = code(file);
    if (/\bimport\s*\(/.test(text)) problems.push(`${rel(file)}: importação dinâmica`);
    for (const { specifier, named, hasDefault } of importsOf(file)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) { problems.push(`${rel(file)}: importação fora do painel (${specifier})`); continue; }
      const target = resolveImport(file, specifier);
      if (!target.endsWith('.js') || !existsSync(target)) { problems.push(`${rel(file)}: ${specifier} não existe`); continue; }
      if (!target.startsWith(jsDir + path.sep)) { problems.push(`${rel(file)}: ${specifier} sai da pasta do painel`); continue; }
      if (target === MAIN) { problems.push(`${rel(file)}: nada deve importar o ponto de entrada`); continue; }
      let exported;
      try { exported = await load(target); } catch (error) { problems.push(`${rel(file)}: ${specifier} não carrega (${String(error.message).split('\n')[0]})`); continue; }
      for (const name of named) if (!(name in exported)) problems.push(`${rel(file)}: ${specifier} não exporta "${name}"`);
      if (hasDefault && !('default' in exported)) problems.push(`${rel(file)}: ${specifier} não tem exportação padrão`);
    }
  }
  // Cada módulo (menos o ponto de entrada, que desenha a página ao carregar) precisa carregar no Node, sem navegador.
  for (const file of modules.filter(name => name !== MAIN)) {
    try { await load(file); } catch (error) { problems.push(`${rel(file)}: não carrega (${String(error.message).split('\n')[0]})`); }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test('painel e player: todo módulo é alcançado a partir de um ponto de entrada (o painel ou o player da TV) — nenhum arquivo esquecido', () => {
  const reached = new Set([MAIN, PLAYER]);
  const queue = [MAIN, PLAYER];
  while (queue.length) {
    const file = queue.pop();
    for (const { specifier } of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (!reached.has(target) && existsSync(target)) { reached.add(target); queue.push(target); }
    }
  }
  assert.deepEqual(modules.filter(file => !reached.has(file)).map(rel), []);
});

// ---- o que o aparelho precisa ter --------------------------------------------------------------------------------------------------

// O player da 1.1.0 usava AbortSignal.any e AbortSignal.timeout (Chromium 116 ou posterior). O novo não depende delas, e esta lista impede
// que funções e sintaxe de navegadores recentes voltem sem ninguém notar. É uma lista de verificação: NÃO prova que uma TV específica roda o player.
const TV_ENGINE_DENY = [
  ['AbortSignal.any / AbortSignal.timeout (Chromium 116 / 103)', /\bAbortSignal\s*\.\s*(?:any|timeout)\b/],
  ['Object.groupBy / Map.groupBy (Chromium 117)', /\b(?:Object|Map)\s*\.\s*groupBy\b/],
  ['Promise.withResolvers (Chromium 119)', /\bPromise\s*\.\s*withResolvers\b/],
  ['Array.fromAsync (Chromium 121)', /\bArray\s*\.\s*fromAsync\b/],
  ['toSorted / toReversed / toSpliced (Chromium 110)', /\.\s*to(?:Sorted|Reversed|Spliced)\s*\(/],
  ['structuredClone (Chromium 98)', /\bstructuredClone\b/],
  ['findLast / findLastIndex (Chromium 97)', /\.\s*findLast(?:Index)?\s*\(/],
  ['Object.hasOwn (Chromium 93)', /\bObject\s*\.\s*hasOwn\b/],
  ['.at() (Chromium 92)', /\.\s*at\s*\(/],
  ['crypto.randomUUID (Chromium 92)', /\brandomUUID\b/],
  ['replaceAll (Chromium 85)', /\.\s*replaceAll\s*\(/],
  ['Promise.any (Chromium 85)', /\bPromise\s*\.\s*any\b/],
  ['??= ||= &&= (Chromium 85)', /(?:\?\?|\|\||&&)=/]
];

test('player da TV: o que a TV carrega não usa funções nem sintaxe de navegadores recentes (lista de verificação; não prova compatibilidade com nenhuma TV)', () => {
  const reached = new Set([PLAYER]);
  const queue = [PLAYER];
  while (queue.length) {
    const file = queue.pop();
    for (const { specifier } of importsOf(file)) {
      const target = resolveImport(file, specifier);
      if (!reached.has(target) && existsSync(target)) { reached.add(target); queue.push(target); }
    }
  }
  const names = [...reached].map(rel).sort();
  for (const expected of ['player.js', 'js/player/app.js', 'js/playback/carousel.js', 'js/playback/stage.js', 'js/playback/effects.js', 'js/playback/loader.js', 'js/playback/timing.js']) assert.ok(names.includes(expected), `${expected} deve ser carregado pela TV`);
  assert.ok(!names.some(name => name.startsWith('js/views/') || name === 'js/main.js'), 'a TV não carrega o código das telas do painel');
  const findings = [];
  for (const file of reached) for (const [label, pattern] of TV_ENGINE_DENY) if (pattern.test(code(file))) findings.push(`${rel(file)}: ${label}`);
  assert.deepEqual(findings, []);

  // O detector em si: cada item da lista reconhece um exemplo seu, e código comum não é acusado.
  const samples = ['AbortSignal.any([a])', 'AbortSignal.timeout(5)', 'Object.groupBy(x, f)', 'Promise.withResolvers()', 'Array.fromAsync(x)', 'list.toSorted()', 'structuredClone(x)', 'list.findLast(f)',
    'Object.hasOwn(a, b)', 'list.at(-1)', 'crypto.randomUUID()', 'text.replaceAll(a, b)', 'Promise.any(list)', 'a ??= 1', 'a ||= 1', 'a &&= 1'];
  assert.deepEqual(TV_ENGINE_DENY.filter(([, pattern]) => !samples.some(sample => pattern.test(sample))).map(([label]) => label), [], 'todo padrão da lista reconhece um exemplo seu');
  assert.deepEqual(samples.filter(sample => !TV_ENGINE_DENY.some(([, pattern]) => pattern.test(sample))), [], 'todo exemplo é reconhecido por algum padrão');
  assert.ok(!TV_ENGINE_DENY.some(([, pattern]) => pattern.test('const last = list[list.length - 1] ?? 0; if (a === b || c !== d) run(a && b);')), 'código comum não é acusado');
});

// ---- regras de segurança do código -------------------------------------------------------------------------------------------------

test('painel e player: nenhum HTML montado por texto, execução dinâmica, cookie nem manipulador embutido; painel sem console, rede ou navegação por script fora dos pontos previstos', () => {
  const findings = [];
  const domModule = file => rel(file) === 'js/ui/dom.js';
  // Valem para o painel e para o player da TV.
  const shared = [
    ['innerHTML/outerHTML', /\b(?:innerHTML|outerHTML)\b/, domModule],
    ['insertAdjacentHTML', /\binsertAdjacentHTML\b/, domModule],
    ['createContextualFragment', /\bcreateContextualFragment\b/],
    ['DOMParser', /\bDOMParser\b/],
    ['document.write', /\bdocument\s*\.\s*write(?:ln)?\s*\(/],
    ['srcdoc', /\bsrcdoc\b/, domModule],
    ['eval', /\beval\s*\(/],
    ['new Function', /\bnew\s+Function\b/],
    ['setTimeout/setInterval com texto', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/],
    ['javascript:', /javascript\s*:/i],
    ['manipulador em texto (<… on…=)', /<[a-z][^>]*\son[a-z]+\s*=/i],
    ['debugger', /\bdebugger\b/],
    ['document.cookie', /\bdocument\s*\.\s*cookie\b/]
  ];
  // Só o painel (o player é um programa à parte, com credencial própria da TV e reprodução de mídia).
  const panelOnly = [
    ['atribuição de manipulador (on…=)', /\.\s*on[a-z]+\s*=(?!=)/, file => rel(file) === 'js/lib/api.js'],
    ['console', /\bconsole\s*\./],
    ['Math.random (senhas e identificadores usam o gerador criptográfico)', /\bMath\s*\.\s*random\b/],
    // A única abertura de janela por script é a prévia da TV: endereço fixo do próprio servidor, sempre com "noopener".
    ['abrir janela (fora da prévia da TV) ou navegar por script', /\b(?:window|globalThis)\s*\.\s*open\s*\((?!\s*'\/player\.html\?demo=1'\s*,\s*'_blank'\s*,\s*'noopener'\s*\))|\blocation\s*\.\s*(?:href\s*=(?!=)|assign\s*\(|replace\s*\()/],
    ['postMessage', /\bpostMessage\b/],
    ['localStorage/sessionStorage/indexedDB fora das preferências', /\b(?:localStorage|sessionStorage|indexedDB)\b/, file => rel(file) === 'js/lib/prefs.js'],
    ['rede fora do cliente da API', /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, file => rel(file) === 'js/lib/api.js'],
    ['fetch fora do cliente da API e das miniaturas', /\bfetch\s*\(/, file => ['js/lib/api.js', 'js/ui/thumbnails.js'].includes(rel(file))],
    ['replaceChildren direto nas telas (use mount)', /\breplaceChildren\s*\(/, file => rel(file).startsWith('js/ui/') || rel(file) === 'js/main.js']
  ];
  const player = path.join(publicDir, 'player.js');
  for (const file of [...modules, player]) {
    const text = code(file);
    const rules = file === player ? shared : [...shared, ...panelOnly];
    for (const [label, pattern, skip = () => false] of rules) if (!skip(file) && pattern.test(text)) findings.push(`${rel(file)}: ${label}`);
    if (file === player) continue;
    for (const host of [...text.matchAll(/https?:\/\/[^\s'"`)]+/g)].map(match => match[0])) if (host !== 'http://www.w3.org/2000/svg') findings.push(`${rel(file)}: endereço externo ${host}`);
  }
  assert.deepEqual(findings, []);
  assert.equal(modules.filter(file => /\bglobalThis\.open\(/.test(code(file))).map(rel).join(), 'js/views/overview.js', 'a prévia da TV é o único ponto que abre uma janela');
  const dom = code(path.join(jsDir, 'ui', 'dom.js'));
  for (const key of ['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML', 'innerText']) assert.ok(dom.includes(`'${key}'`), `dom.js deve recusar a propriedade ${key}`);
  assert.match(dom, /FORBIDDEN_TAGS = new Set\(\[[^\]]*'script'[^\]]*'style'/);
});

test('painel: todas as permissões usadas nas telas existem no servidor e todas as do servidor são tratadas nas telas', () => {
  const groups = [...new Set(PERMISSION_IDS.map(id => id.split(':')[0]))];
  const literal = new RegExp(`['"\`]((?:${groups.join('|')}):[a-z]+)['"\`]`, 'g');
  const used = new Set();
  for (const file of modules) for (const match of code(file).matchAll(literal)) used.add(match[1]);
  assert.deepEqual([...used].filter(id => !PERMISSION_IDS.includes(id)).sort(), [], 'permissão citada na tela e inexistente no servidor (a tela esconderia o botão para sempre)');
  assert.deepEqual(PERMISSION_IDS.filter(id => !used.has(id)).sort(), [], 'permissão do servidor que nenhuma tela leva em conta');
});

// ---- rotas e telas --------------------------------------------------------------------------------------------------------------------

test('rotas: cada rota tem uma tela, cada item do menu uma rota, e nenhuma tela chama uma rota que não existe', async () => {
  const { VIEWS } = await import('../public/js/views/index.js');
  const routeNames = ROUTES.map(route => route.name).sort();
  assert.deepEqual(Object.keys(VIEWS).sort(), routeNames, 'rotas e telas devem ser as mesmas');
  for (const [name, view] of Object.entries(VIEWS)) assert.equal(typeof view, 'function', name);
  assert.equal(new Set(ROUTES.map(route => route.title)).size, ROUTES.length, 'títulos de página repetidos');
  for (const route of ROUTES) assert.ok(route.title.trim(), route.name);
  for (const name of Object.keys(ROUTE_PERMISSION)) assert.ok(routeNames.includes(name), `permissão de rota para "${name}", que não existe`);

  const nav = [...read(path.join(jsDir, 'ui', 'shell.js')).matchAll(/\{\s*name:\s*'(\w+)',\s*label:/g)].map(match => match[1]);
  assert.deepEqual(nav.filter(name => !routeNames.includes(name)), [], 'item de menu sem rota');
  assert.deepEqual(routeNames.filter(name => !nav.includes(name)), ['playlist'], 'toda rota está no menu, exceto o editor (aberto pela lista de playlists)');
  const navPermissions = Object.fromEntries([...read(path.join(jsDir, 'ui', 'shell.js')).matchAll(/name:\s*'(\w+)'[^}]*permission:\s*'([\w:]+)'/g)].map(match => [match[1], match[2]]));
  assert.deepEqual(navPermissions, ROUTE_PERMISSION, 'o menu esconde exatamente as telas que a rota exige permissão');

  const called = new Map();
  for (const file of modules) {
    for (const match of code(file).matchAll(/\b(?:navigate|link|replaceUrl|buildHash)\(\s*'([\w-]+)'/g)) {
      if (!called.has(match[1])) called.set(match[1], new Set());
      called.get(match[1]).add(rel(file));
    }
  }
  assert.deepEqual([...called].filter(([name]) => !routeNames.includes(name)).map(([name, files]) => `${name} ← ${[...files].join(', ')}`), []);
});

// ---- ícones e estilos -------------------------------------------------------------------------------------------------------------------

test('ícones: todo nome de ícone escrito nas telas existe (nome desconhecido apareceria como um arquivo genérico)', () => {
  const forms = [
    /\bicon\(\s*'([a-z-]+)'/g,
    /\bicon(?:Name)?:\s*'([a-z-]+)'/g,
    /\biconButton\([^\n]*?,\s*'([a-z-]+)'\s*,/g,
    /\bicon\([^)\n]*?\?\s*'([a-z-]+)'\s*:\s*'([a-z-]+)'/g
  ];
  const used = new Map();
  const note = (name, file) => { if (!used.has(name)) used.set(name, new Set()); used.get(name).add(rel(file)); };
  for (const file of modules) {
    const text = code(file);
    for (const form of forms) for (const match of text.matchAll(form)) for (const name of match.slice(1)) if (name) note(name, file);
    for (const match of text.matchAll(/\bicons\s*=\s*\[([^\]]*)\]/g)) for (const name of match[1].match(/'([a-z-]+)'/g) ?? []) note(name.slice(1, -1), file);
  }
  for (const match of code(path.join(jsDir, 'views', 'overview.js')).matchAll(/\[\s*'([a-z-]+)'\s*,\s*'[^']*'\s*,\s*'[a-z]+'\s*\]/g)) note(match[1], path.join(jsDir, 'views', 'overview.js'));
  assert.ok(used.size >= 25, `poucos ícones encontrados (${used.size}); o verificador perdeu o rastro das formas de uso`);
  assert.deepEqual([...used].filter(([name]) => !Object.hasOwn(ICONS, name)).map(([name, files]) => `${name} ← ${[...files].join(', ')}`), []);
});

// Classes usadas só como "gancho" de estrutura (contêineres e modificadores) que não precisam de regra de estilo.
// Qualquer classe nova sem regra no CSS reprova o teste: ou ganha estilo ou entra aqui de propósito.
const STRUCTURAL_CLASSES = new Set([
  'app-shell', 'env-strip', 'audit-results', 'playlist-results', 'playlist-table', 'pl-host', 'org-column', 'scope-box', 'perm-editor',
  'select-all', 'table-panel', 'compact', 'center', 'pdf', 'media'
]);

test('estilos: toda classe usada nas telas tem regra nos arquivos CSS (ou é um gancho de estrutura declarado)', () => {
  const css = ['styles.css', 'auth.css', 'panel.css', 'player.css'].map(name => read(path.join(publicDir, name)).replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => match[1]));
  const used = new Map();
  const note = (name, file) => { if (!name) return; if (!used.has(name)) used.set(name, new Set()); used.get(name).add(rel(file)); };
  for (const file of modules) {
    const text = code(file);
    for (const match of text.matchAll(/\bh\(\s*(['"`])([^'"`]*)\1/g)) {
      if (match[2].includes('${')) continue;
      for (const part of match[2].match(/[.#][A-Za-z0-9_-]+/g) ?? []) if (part[0] === '.') note(part.slice(1), file);
    }
    for (const match of text.matchAll(/\bclass(?:Name)?:\s*(['"`])([^'"`$]*)\1/g)) for (const name of match[2].split(/\s+/)) note(name, file);
    for (const match of text.matchAll(/classList\.(?:add|remove|toggle|contains)\(\s*'([^']+)'/g)) note(match[1], file);
  }
  assert.ok(used.size >= 250, `poucas classes encontradas (${used.size}); o verificador perdeu o rastro das formas de uso`);
  const missing = [...used].filter(([name]) => !defined.has(name) && !STRUCTURAL_CLASSES.has(name)).map(([name, files]) => `${name} ← ${[...files].join(', ')}`);
  assert.deepEqual(missing, [], 'classe sem estilo no CSS (erro de digitação?)');
  assert.deepEqual([...STRUCTURAL_CLASSES].filter(name => defined.has(name)), [], 'classe declarada como "sem estilo" mas que agora tem regra: tire da lista');
  assert.deepEqual([...STRUCTURAL_CLASSES].filter(name => !used.has(name)), [], 'gancho declarado e não usado: tire da lista');
});

test('estilos: sem @import, sem url() externa e todo recurso referenciado existe', () => {
  for (const name of readdirSync(publicDir).filter(file => file.endsWith('.css'))) {
    const css = read(path.join(publicDir, name)).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /@import/i, `${name}: @import`);
    for (const match of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const target = match[2].trim();
      assert.doesNotMatch(target, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i, `${name}: recurso externo ${target}`);
      assert.ok(existsSync(path.join(publicDir, target.replace(/^\//, '').split(/[?#]/)[0])), `${name}: ${target} não existe`);
    }
  }
});

// ---- páginas HTML ------------------------------------------------------------------------------------------------------------------------

test('páginas HTML: sem script nem estilo embutido, sem manipuladores, sem recursos externos e com tudo o que referenciam', () => {
  for (const page of ['index.html', 'player.html']) {
    const html = read(path.join(publicDir, page));
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const [, attributes, body] of scripts) {
      assert.match(attributes, /\bsrc="\/[^"]+"/, `${page}: script sem src`);
      assert.equal(body.trim(), '', `${page}: script embutido`);
    }
    assert.doesNotMatch(html, /<style\b/i, `${page}: bloco <style>`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${page}: atributo style embutido`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page}: manipulador de evento embutido`);
    assert.doesNotMatch(html, /javascript\s*:/i, `${page}: javascript:`);
    assert.doesNotMatch(html, /\b(?:src|href|action)\s*=\s*["'](?:[a-z][a-z0-9+.-]*:)?\/\//i, `${page}: recurso externo`);
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<html lang="pt-BR">/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<title>[^<]+<\/title>/);
    for (const match of html.matchAll(/\b(?:src|href)="(\/[^"#?]*)/g)) {
      const target = match[1] === '/' ? 'index.html' : match[1].replace(/^\//, '');
      assert.ok(existsSync(path.join(publicDir, target)), `${page}: ${match[1]} não existe`);
    }
  }
  const index = read(path.join(publicDir, 'index.html'));
  assert.deepEqual([...index.matchAll(/<script\b([^>]*)>/gi)].map(match => match[1].trim().replace(/\s+/g, ' ')), ['type="module" src="/js/main.js"'], 'o painel carrega somente o módulo principal');
  assert.deepEqual([...index.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]), ['/styles.css', '/auth.css', '/panel.css']);
  for (const region of ['id="app"', 'id="dialogs"', 'id="toast"']) assert.ok(index.includes(region), `index.html: falta ${region}`);
  assert.match(index, /id="toast"[^>]*aria-live="polite"/, 'os avisos são anunciados por leitores de tela');
  assert.match(index, /<a class="skip" href="#main">/, 'atalho "pular para o conteúdo"');
  assert.match(read(path.join(jsDir, 'ui', 'shell.js')), /main#main\./, 'o destino do atalho existe na estrutura do painel');

  const player = read(path.join(publicDir, 'player.html'));
  assert.deepEqual([...player.matchAll(/<script\b([^>]*)>/gi)].map(match => match[1].trim().replace(/\s+/g, ' ')), ['type="module" src="/player.js"'], 'o player carrega somente o módulo de entrada');
  assert.match(player, /<meta name="robots" content="noindex, nofollow">/, 'o player não deve aparecer em buscadores');
});
