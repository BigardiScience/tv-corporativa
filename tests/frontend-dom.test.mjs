// Camada segura de interface (ui/): construção de DOM sem HTML em texto, endereços permitidos, componentes, ícones, download e avisos.
// Roda no Node com um DOM de teste (tests/helpers/fake-dom.mjs). O que depende do navegador de verdade — foco, <dialog>, layout,
// arrastar e soltar — é validado nos testes de ponta a ponta com Chromium (tests/e2e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeEvent, SVG_NS, descendants, serialize, withFakeDom } from './helpers/fake-dom.mjs';
import { $, $$, append, fragment, h, isNode, mount, safeUrl, text } from '../public/js/ui/dom.js';
import { badge, button, emptyState, field, iconButton, initials, notice, pageHeading, sectionTitle, tones } from '../public/js/ui/components.js';
import { ICONS, icon } from '../public/js/ui/icons.js';
import { downloadBlob } from '../public/js/ui/download.js';
import { action, isHandled, runBusy, showError } from '../public/js/ui/feedback.js';
import { hideToast, toast } from '../public/js/ui/toast.js';
import { ApiError, abortError } from '../public/js/lib/api.js';

const names = element => element.childNodes.map(node => (node.nodeType === 3 ? `#${node.data}` : node.localName));
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };

// ---- o próprio DOM de teste ------------------------------------------------------------------------------------------------

test('DOM de teste: nós, classes, dataset, seletores e eventos se comportam como no navegador (a base dos demais testes)', async () => {
  await withFakeDom(document => {
    const box = document.createElement('div');
    const first = document.createElement('p'), second = document.createElement('em');
    box.appendChild(first); box.appendChild(second);
    assert.deepEqual(names(box), ['p', 'em']);
    box.appendChild(first);
    assert.deepEqual(names(box), ['em', 'p'], 'inserir de novo move o nó, não duplica');
    const loose = document.createDocumentFragment();
    loose.appendChild(document.createTextNode('x')); loose.appendChild(document.createElement('i'));
    box.appendChild(loose);
    assert.equal(loose.childNodes.length, 0, 'o fragmento fica vazio depois de inserido');
    assert.deepEqual(names(box), ['em', 'p', '#x', 'i']);
    assert.throws(() => first.appendChild(box), /HierarchyRequestError/);
    assert.throws(() => box.appendChild({}), TypeError);

    box.replaceChildren(second, 'texto');
    assert.deepEqual(names(box), ['em', '#texto']);
    assert.equal(first.parentNode, null);
    assert.equal(box.textContent, 'texto');
    box.textContent = '<b>não é marcação</b>';
    assert.deepEqual(names(box), ['#<b>não é marcação</b>']);
    box.textContent = '';
    assert.equal(box.childNodes.length, 0);

    assert.equal(box.isConnected, false);
    document.body.appendChild(box);
    assert.equal(box.isConnected, true);
    box.remove();
    assert.equal(box.isConnected, false);

    const el = document.createElement('div');
    el.classList.add('a', 'b'); el.classList.add('a');
    assert.equal(el.className, 'a b');
    assert.equal(el.classList.toggle('b'), false);
    assert.equal(el.classList.toggle('c', true), true);
    assert.equal(el.classList.contains('c'), true);
    assert.equal(String(el.classList), 'a c');
    assert.throws(() => el.classList.add(''), /InvalidCharacterError/);
    assert.throws(() => el.classList.add('com espaço'), /InvalidCharacterError/);
    el.dataset.fooBar = 7;
    assert.equal(el.getAttribute('data-foo-bar'), '7');
    assert.equal(el.dataset.fooBar, '7');
    assert.deepEqual(Object.keys(el.dataset), ['fooBar']);
    el.disabled = true;
    assert.equal(el.hasAttribute('disabled'), true);
    el.disabled = false;
    assert.equal(el.hasAttribute('disabled'), false);
    el.setAttribute('ARIA-Label', 'x');
    assert.equal(el.getAttribute('aria-label'), 'x', 'nomes de atributo HTML não diferenciam maiúsculas');

    const tree = document.createElement('section');
    tree.innerHTMLNotSupported = true;
    tree.appendChild(Object.assign(document.createElement('ul'), {}));
    const list = tree.firstChild;
    for (const [index, kind] of ['a', 'b', 'c'].entries()) {
      const item = document.createElement('li');
      item.className = `item ${kind}`;
      item.setAttribute('data-n', String(index));
      list.appendChild(item);
    }
    list.firstChild.setAttribute('disabled', '');
    assert.equal(tree.querySelectorAll('li').length, 3);
    assert.equal(tree.querySelector('li.b').getAttribute('data-n'), '1');
    assert.equal(tree.querySelectorAll('.item:not([disabled])').length, 2);
    assert.equal(tree.querySelectorAll('section > ul > li').length, 3, 'o seletor é conferido contra os ancestrais (inclusive a própria raiz), como no navegador');
    assert.equal(tree.querySelectorAll('ul > li[data-n="2"]').length, 1);
    assert.equal(tree.querySelectorAll('section').length, 0, 'mas só os descendentes são devolvidos: a raiz não entra no resultado');
    document.body.appendChild(tree);
    assert.equal(document.querySelectorAll('section li').length, 3);
    assert.equal(document.querySelectorAll('body > section > ul > li').length, 3);
    assert.equal(document.querySelectorAll('li.a, li.c').length, 2);
    assert.throws(() => tree.querySelector('li:first-child'), /não suportado/);
    tree.id = 'raiz';
    assert.equal(document.getElementById('raiz'), tree);
    assert.equal(document.getElementById('nada'), null);

    const seen = [];
    const inner = list.firstChild;
    document.body.addEventListener('click', event => seen.push(`body:${event.target === inner}:${event.currentTarget === document.body}`));
    inner.addEventListener('click', event => { seen.push('item'); event.preventDefault(); });
    inner.click();
    assert.deepEqual(seen, ['item', 'body:true:true'], 'o clique sobe do alvo até o documento');
    const once = [];
    inner.addEventListener('ping', () => once.push(1), { once: true });
    inner.dispatchEvent(new FakeEvent('ping')); inner.dispatchEvent(new FakeEvent('ping'));
    assert.deepEqual(once, [1]);
    assert.equal(inner.dispatchEvent(new FakeEvent('x', { cancelable: true })), true);

    const dangerous = document.createElement('p');
    dangerous.appendChild(document.createTextNode('<img src=x onerror=alert(1)> & "aspas"'));
    dangerous.setAttribute('title', '"><script>');
    assert.equal(serialize(dangerous), '<p title="&quot;&gt;&lt;script&gt;">&lt;img src=x onerror=alert(1)&gt; &amp; "aspas"</p>');
    assert.equal(serialize(document.createElement('input')), '<input>');
    const field = document.createElement('input');
    field.setAttribute('alt', '');
    field.hidden = true;
    assert.equal(serialize(field), '<input alt="" hidden>');
  });
  assert.equal(globalThis.document, undefined, 'o DOM de teste é removido ao terminar');
});

// ---- h(): elementos, filhos e propriedades ---------------------------------------------------------------------------------

test('h: especificação do elemento — tag, id e classes; especificações inválidas e elementos proibidos são recusados', async () => {
  await withFakeDom(() => {
    const el = h('button.button.primary#save');
    assert.equal(el.localName, 'button');
    assert.equal(el.id, 'save');
    assert.equal(el.className, 'button primary');
    assert.equal(serialize(h('div')), '<div></div>');
    assert.equal(serialize(h('.card.wide')), '<div class="card wide"></div>');
    assert.equal(serialize(h('#so-id')), '<div id="so-id"></div>');
    assert.equal(serialize(h('input.field', { type: 'text' })), '<input class="field" type="text">');
    assert.equal(serialize(h('h2.a-b_c.d1')), '<h2 class="a-b_c d1"></h2>');
    for (const spec of ['div onclick=1', '<div>', 'DIV', 'div.', 'div#', '1div', 'a b', 'div.x y', 'div[onclick]', 'div>p', "div'", 'div..x', 'div.x#', 'çdiv', 'div\n']) {
      assert.throws(() => h(spec), /Especificação de elemento inválida/, JSON.stringify(spec));
    }
    for (const tag of ['script', 'style', 'link', 'meta', 'base', 'object', 'embed', 'applet', 'noscript', 'template', 'slot']) {
      assert.throws(() => h(tag), /Elemento não permitido/, tag);
      assert.throws(() => h(`${tag}.x#y`, { text: 'a' }), /Elemento não permitido/, `${tag} com classe e id`);
    }
    assert.doesNotThrow(() => h('iframe', { src: '/api/media/abc/file', title: 'Pré-visualização' }), 'a pré-visualização de PDF usa iframe do próprio servidor');
  });
});

test('h: filhos — texto, números, listas aninhadas, nós e fragmentos; vazios (null, undefined, false, true) são ignorados', async () => {
  await withFakeDom(() => {
    const parent = h('div', 'a', 1, 0, null, undefined, false, true, ['b', ['c', null, [h('u')]]], h('i'), fragment('x', h('b')));
    assert.equal(serialize(parent), '<div>a10bc<u></u><i></i>x<b></b></div>');
    assert.equal(serialize(h('div', 'texto')), '<div>texto</div>', 'texto no lugar das propriedades vira filho');
    assert.equal(serialize(h('div', h('b', 'x'))), '<div><b>x</b></div>');
    assert.equal(serialize(h('div', ['a', h('b')])), '<div>a<b></b></div>');
    assert.equal(serialize(h('div', 42)), '<div>42</div>');
    assert.equal(serialize(h('div', false)), '<div></div>');
    assert.equal(serialize(h('div', null, 'x')), '<div>x</div>');
    assert.equal(serialize(h('div', undefined, 'x')), '<div>x</div>');
    assert.equal(serialize(h('div', { id: 'a' }, 'x', h('b'))), '<div id="a">x<b></b></div>');
    assert.equal(serialize(h('p', { text: 5 })), '<p>5</p>');
    const shared = h('i');
    const first = h('div', shared), second = h('div', shared);
    assert.equal(first.childNodes.length, 0, 'um nó só existe em um lugar: inserir de novo o move');
    assert.equal(second.childNodes.length, 1);
  });
});

test('h: texto vindo de pessoas ou do servidor NUNCA vira marcação (defesa central contra XSS)', async () => {
  await withFakeDom(document => {
    const attack = '<img src=x onerror=alert(1)>';
    const closeAndInject = '</div><script>alert(1)</script>';
    const breakout = '"><img src=x onerror=alert(1)>';
    const container = h('div#c',
      h('p', attack),
      h('p', { text: closeAndInject }),
      h('input', { value: attack, placeholder: attack, title: breakout, alt: breakout, name: breakout }),
      h('a', { href: '#/x', title: breakout, aria: { label: breakout }, dataset: { raw: breakout } }, attack),
      h('button', { 'aria-label': breakout, 'data-raw': breakout }, closeAndInject),
      h('ul', [attack, closeAndInject].map(item => h('li', item))),
      mount(h('section'), attack, [closeAndInject]));
    document.body.appendChild(container);

    assert.equal($$('img', container).length, 0, 'nenhuma imagem foi criada a partir de texto');
    assert.equal($$('script', container).length, 0, 'nenhum script foi criado a partir de texto');
    const html = serialize(container);
    assert.ok(!html.includes('<img') && !html.includes('<script'), html);
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
    for (const element of descendants(container)) {
      assert.ok(!element.attributes.some(attribute => /^on/i.test(attribute.name)), `<${element.localName}> ganhou um manipulador de evento`);
    }
    assert.equal($('a', container).getAttribute('title'), breakout, 'o valor do atributo continua sendo apenas um valor');
    assert.equal($('input', container).value, attack);
    assert.equal(container.querySelectorAll('li').length, 2);
    assert.equal(container.querySelector('li').textContent, attack);
  });
});

test('h: propriedades e atributos proibidos são recusados, mesmo vazios, e nada fora da lista permitida passa', async () => {
  await withFakeDom(() => {
    for (const key of ['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML', 'innerText', 'onclick', 'onerror', 'onload', 'onmouseover', 'ONCLICK', 'onClick', 'onfocusin']) {
      assert.throws(() => h('div', { [key]: '<b>x</b>' }), /Propriedade não permitida/, key);
      assert.throws(() => h('div', { [key]: undefined }), /Propriedade não permitida/, `${key} mesmo sem valor`);
    }
    for (const key of ['formaction', 'action', 'contenteditable', 'xlink:href', 'is', 'srcset', 'ping', 'background', 'content', 'http-equiv', 'data', 'onclick ', ' onclick', '__proto__', 'constructor', 'style-x']) {
      assert.throws(() => h('div', JSON.parse(`{${JSON.stringify(key)}: "x"}`)), /não permitid/, JSON.stringify(key));
    }
    assert.throws(() => h('div', { style: 'color: red' }), /style deve ser um objeto/);
    assert.throws(() => h('a', { href: 'javascript:alert(1)' }), /Endereço não permitido/);
    assert.doesNotThrow(() => h('div', { on: { click() {} } }));
    const allowed = h('input', {
      id: 'x', type: 'text', name: 'n', placeholder: 'p', title: 't', role: 'textbox', tabindex: -1, min: 0, max: 9, step: 1, maxlength: 5, minlength: 1, autocomplete: 'off',
      accept: '.png', rows: 2, cols: 3, inputmode: 'numeric', spellcheck: false, lang: 'pt-BR', pattern: '[0-9]+', list: 'dl', form: 'f', dir: 'ltr'
    });
    assert.equal(allowed.getAttribute('tabindex'), '-1');
    // "spellcheck" e "draggable" são atributos enumerados: desligado precisa ser o TEXTO "false" (sem o atributo vale o padrão do navegador).
    assert.equal(allowed.getAttribute('spellcheck'), 'false');
    assert.equal(h('input', { spellcheck: 'false' }).getAttribute('spellcheck'), 'false', 'forma usada nas telas');
    assert.equal(h('input', { spellcheck: true }).getAttribute('spellcheck'), 'true');
    assert.equal(h('input', { spellcheck: 'true' }).getAttribute('spellcheck'), 'true');
    assert.equal(h('input', { spellcheck: undefined }).hasAttribute('spellcheck'), false);
    assert.equal(h('input', { spellcheck: null }).hasAttribute('spellcheck'), false);
  });
});

test('h: aria, data, classes, estilos, eventos, ref, texto, valor e propriedades booleanas', async () => {
  await withFakeDom(() => {
    const el = h('div', { 'aria-label': 'rótulo', 'data-id': '7', 'aria-hidden': false, 'data-off': false });
    assert.equal(el.getAttribute('aria-label'), 'rótulo');
    assert.equal(el.getAttribute('data-id'), '7');
    assert.equal(el.hasAttribute('aria-hidden'), false);
    assert.equal(el.hasAttribute('data-off'), false);

    const aria = h('div', { aria: { label: 'x', hidden: true, busy: false, live: undefined, current: null, level: 2 } });
    assert.deepEqual(aria.attributes, [{ name: 'aria-label', value: 'x' }, { name: 'aria-hidden', value: 'true' }, { name: 'aria-level', value: '2' }]);
    const data = h('div', { dataset: { fooBar: 1, empty: '', gone: undefined, nothing: null } });
    assert.deepEqual(data.attributes, [{ name: 'data-foo-bar', value: '1' }, { name: 'data-empty', value: '' }]);

    assert.equal(h('div', { class: 'a  b' }).className, 'a b');
    assert.equal(h('div', { class: ['a', ['b', { c: true, d: false }], null, '', undefined] }).className, 'a b c');
    assert.equal(h('div', { className: { x: true } }).className, 'x');
    assert.equal(h('div.base', { class: { on: true, off: 0 } }).className, 'base on');
    assert.equal(h('div', { class: undefined }).hasAttribute('class'), false);
    assert.equal(h('div', { class: '' }).hasAttribute('class'), false);

    const styled = h('div', { style: { width: '10px', '--accent': 'red' } });
    assert.equal(styled.style.width, '10px');
    assert.equal(styled.style.getPropertyValue('--accent'), 'red');

    const calls = [];
    const handlers = h('button', { on: { click: event => calls.push(['click', event.type, event.currentTarget.localName]), focus: [() => calls.push(['focus']), { once: true }] } });
    handlers.click();
    handlers.dispatchEvent(new FakeEvent('focus')); handlers.dispatchEvent(new FakeEvent('focus'));
    assert.deepEqual(calls, [['click', 'click', 'button'], ['focus']]);

    let referenced;
    const withRef = h('div', { ref: node => { referenced = node; } });
    assert.equal(referenced, withRef);

    assert.equal(h('input', { value: 5 }).value, '5');
    assert.equal(h('input', { value: '' }).value, '');
    assert.equal(h('input', { value: undefined }).value, '');

    assert.equal(serialize(h('button', { disabled: true, hidden: true })), '<button disabled hidden></button>');
    assert.equal(serialize(h('button', { disabled: false, hidden: false })), '<button></button>');
    assert.equal(h('input', { type: 'checkbox', checked: true }).checked, true);
    assert.equal(h('option', { selected: true }).selected, true);
    assert.equal(h('input', { readOnly: true }).hasAttribute('readonly'), true);
    assert.equal(h('input', { indeterminate: true }).indeterminate, true);
    assert.equal(h('video', { muted: true, loop: true, controls: true, autoplay: true, playsInline: true }).hasAttribute('playsinline'), true);

    assert.equal(h('div', { draggable: true }).getAttribute('draggable'), 'true');
    assert.equal(h('div', { draggable: false }).getAttribute('draggable'), 'false');
    assert.equal(h('div', { draggable: undefined }).hasAttribute('draggable'), false);
    assert.equal(h('div', { draggable: null }).hasAttribute('draggable'), false);

    assert.equal(h('div', { title: false }).hasAttribute('title'), false, 'false remove o atributo');
    assert.equal(h('div', { title: undefined }).hasAttribute('title'), false);
    assert.equal(h('div', { title: 0 }).getAttribute('title'), '0');
  });
});

// ---- endereços -------------------------------------------------------------------------------------------------------------

test('safeUrl: só âncoras, caminhos do próprio servidor e blob: — nada de javascript:, data:, sites externos nem disfarces', () => {
  const allowed = ['#', '#/biblioteca?folderId=abc', '#/playlists/abc-1_2', '/', '/api/media/abc/file', '/assets/logo.png?v=2', '/index.html#topo', 'blob:http://127.0.0.1:3000/6f1c-22', 'BLOB:http://localhost/1', '/%5Cnao-e-barra-invertida'];
  for (const value of allowed) assert.equal(safeUrl(value), value, value);
  assert.equal(safeUrl('  /api/x  '), '/api/x', 'espaços nas pontas são ignorados');
  assert.equal(safeUrl('\n#/x\t'), '#/x');
  for (const empty of ['', '   ', null, undefined]) assert.equal(safeUrl(empty), '');

  const refused = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\rscript:alert(1)', '\u0001javascript:alert(1)', 'ja\u0000vascript:x',
    'data:text/html,<script>alert(1)</script>', 'data:image/png;base64,AAAA', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://exemplo.invalid', 'mailto:alguem@example.invalid',
    'http://evil.example', 'https://evil.example/x', 'HTTPS://EVIL.EXAMPLE', '//evil.example/x', '///evil.example', 'evil.example', 'www.evil.example', '?x=1', 'api/x',
    // O navegador lê "\" como "/" e descarta tabulações e quebras de linha: estes viram "//evil.example" se passarem.
    '/\\evil.example', '/\\/evil.example', '\\\\evil.example', '\\/evil.example', '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/ /evil.example', '/\u2028/evil.example', '/\u00a0/evil.example', '/\u3000/x', '/\ufeff/x', '/a b', '/\u0085/x', '/\u007f/x'
  ];
  for (const value of refused) assert.throws(() => safeUrl(value), /Endereço não permitido/, JSON.stringify(value));
  assert.throws(() => safeUrl(`/${'a'.repeat(100)} x`), /Endereço não permitido no painel: \/a{39}$/, 'a mensagem mostra só o começo do endereço');
});

test('h: href, src e poster passam pelo filtro de endereços; target="_blank" nunca entrega a janela de origem', async () => {
  await withFakeDom(() => {
    for (const [tag, key] of [['a', 'href'], ['img', 'src'], ['iframe', 'src'], ['video', 'poster'], ['video', 'src'], ['audio', 'src']]) {
      assert.equal(h(tag, { [key]: '/api/media/abc/file' }).getAttribute(key), '/api/media/abc/file');
      assert.equal(h(tag, { [key]: 'blob:http://127.0.0.1:3000/uuid' }).getAttribute(key), 'blob:http://127.0.0.1:3000/uuid');
      for (const bad of ['javascript:alert(1)', 'https://tracker.example/p.gif', 'data:image/png;base64,AAAA', '//evil.example/x', '/\\evil.example']) {
        assert.throws(() => h(tag, { [key]: bad }), /Endereço não permitido/, `${tag}[${key}]=${bad}`);
      }
    }
    assert.equal(h('a', { href: '' }).getAttribute('href'), '', 'endereço vazio é aceito');
    assert.equal(h('a', { href: '#/x', download: 'arquivo.csv' }).getAttribute('download'), 'arquivo.csv', 'download não é um endereço');

    assert.equal(h('a', { href: '#/x', target: '_blank' }).getAttribute('rel'), 'noopener noreferrer');
    assert.equal(h('a', { href: '#/x', target: '_blank', rel: 'opener' }).getAttribute('rel'), 'noopener noreferrer', 'rel pedido por engano não vale');
    assert.equal(h('a', { rel: 'opener', href: '#/x', target: '_blank' }).getAttribute('rel'), 'noopener noreferrer', 'nem em outra ordem');
    assert.equal(h('a', { href: '#/x', target: '_self', rel: 'help' }).getAttribute('rel'), 'help');
    assert.equal(h('a', { href: '#/x' }).hasAttribute('rel'), false);
  });
});

// ---- mount, append, fragment, text -----------------------------------------------------------------------------------------

test('mount, append, fragment, text, isNode, $ e $$', async () => {
  await withFakeDom(document => {
    const box = h('div', h('p', 'antigo'), 'texto');
    assert.equal(mount(box, h('b', 'novo'), 'fim', null, [h('i')]), box);
    assert.equal(serialize(box), '<div><b>novo</b>fim<i></i></div>');
    mount(box);
    assert.equal(box.childNodes.length, 0);
    assert.equal(append(box, ['x', [h('b')], false]), box);
    assert.equal(serialize(box), '<div>x<b></b></div>');
    assert.equal(serialize(fragment('a', h('b'), null)), 'a<b></b>');
    assert.equal(fragment().childNodes.length, 0);
    assert.equal(text(null).data, '');
    assert.equal(text(undefined).data, '');
    assert.equal(text(5).data, '5');
    assert.equal(text('<b>').nodeType, 3);
    assert.equal(isNode(box), true);
    assert.equal(isNode(text('x')), true);
    for (const value of [null, undefined, 'x', 5, {}, [], { nodeType: '1' }]) assert.equal(isNode(value), false, JSON.stringify(value));
    assert.equal(isNode({ nodeType: 1 }), true, 'qualquer objeto com nodeType numérico conta como nó');

    document.body.appendChild(h('main', h('p.a', 'um'), h('p.b', 'dois')));
    assert.equal($('p.b').textContent, 'dois');
    assert.deepEqual($$('p').map(item => item.textContent), ['um', 'dois']);
    assert.equal($('p.c'), null);
    assert.deepEqual($$('p.c'), []);
    assert.equal($('p', $('main')).textContent, 'um');
  });
  assert.throws(() => h('div'), /DOM indisponível/, 'sem navegador, construir interface falha de forma clara');
});

// ---- componentes ----------------------------------------------------------------------------------------------------------

test('componentes: botões, ícones, selos, avisos, estados vazios, cabeçalhos, campos e títulos de seção', async () => {
  await withFakeDom(() => {
    let clicks = 0;
    const full = button('Salvar', { icon: 'check', primary: true, danger: true, onClick: () => clicks++, title: 'Salva tudo', aria: { label: 'Salvar tudo' }, className: 'wide', dataset: { action: 'save' } });
    assert.equal(full.localName, 'button');
    assert.equal(full.className, 'button primary danger wide');
    assert.equal(full.getAttribute('type'), 'button', 'o tipo padrão é "button": dentro de um formulário nunca envia por engano');
    assert.equal(full.getAttribute('title'), 'Salva tudo');
    assert.equal(full.getAttribute('aria-label'), 'Salvar tudo');
    assert.equal(full.dataset.action, 'save');
    assert.equal(full.firstChild.localName, 'svg');
    assert.equal(full.lastChild.data, 'Salvar');
    full.click();
    assert.equal(clicks, 1);
    assert.equal(button('Enviar', { type: 'submit' }).getAttribute('type'), 'submit');
    assert.equal(button('x', { disabled: true }).disabled, true);
    assert.equal(serialize(button('Sem ícone')), '<button class="button" type="button">Sem ícone</button>');
    assert.doesNotThrow(() => button('Sem ação').click());

    let closed = 0;
    const iconOnly = iconButton('Fechar janela', 'close', () => closed++, { className: 'quiet', aria: { haspopup: 'dialog' }, dataset: { id: '3' } });
    assert.equal(iconOnly.className, 'icon-button quiet');
    assert.equal(iconOnly.getAttribute('title'), 'Fechar janela');
    assert.equal(iconOnly.getAttribute('aria-label'), 'Fechar janela', 'botão só com ícone sempre tem nome acessível');
    assert.equal(iconOnly.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(iconOnly.dataset.id, '3');
    assert.equal(iconOnly.firstChild.getAttribute('aria-hidden'), 'true');
    iconOnly.click();
    assert.equal(closed, 1);

    assert.equal(serialize(badge('Ativa')), '<span class="badge"><span class="live-dot"></span>Ativa</span>');
    assert.equal(badge('Pendente', 'warning').className, 'badge warning');

    const info = notice(['Texto ', h('b', 'forte')], { tone: 'warning', iconName: 'alert', className: 'mb' });
    assert.equal(info.className, 'notice warning mb');
    assert.equal(info.firstChild.localName, 'svg');
    assert.equal(info.lastChild.textContent, 'Texto forte');
    assert.equal(notice('simples').className, 'notice');

    const empty = emptyState({ iconName: 'image', title: 'Nada aqui' });
    assert.deepEqual(names(empty), ['svg', 'h3'], 'sem texto nem ações, só ícone e título');
    const emptyFull = emptyState({ title: 'Vazio', text: 'Explicação', actions: [button('Criar')] });
    assert.deepEqual(names(emptyFull), ['svg', 'h3', 'p', 'div']);
    assert.equal(emptyFull.lastChild.className, 'actions center');

    const heading = pageHeading({ title: 'Biblioteca' });
    assert.equal(heading.querySelector('.eyebrow').textContent, 'SEU PONTO DE CONEXÃO');
    assert.equal(heading.querySelector('h1').textContent, 'Biblioteca');
    assert.equal(heading.querySelector('p'), null);
    assert.equal(heading.querySelector('.actions'), null);
    const headingFull = pageHeading({ eyebrow: 'ADMINISTRAÇÃO', title: 'Usuários', description: 'Quem acessa.', actions: [button('Novo')] });
    assert.equal(headingFull.querySelector('.eyebrow').textContent, 'ADMINISTRAÇÃO');
    assert.equal(headingFull.querySelector('p').textContent, 'Quem acessa.');
    assert.equal(headingFull.querySelector('.actions button').textContent, 'Novo');

    const control = h('input#email', { type: 'email' });
    const labelled = field({ label: 'E-mail', control, hint: 'Usado para entrar.', full: true, className: 'extra' });
    assert.equal(labelled.className, 'field full extra');
    assert.equal(labelled.querySelector('label').getAttribute('for'), 'email', 'o rótulo aponta para o controle (acessibilidade)');
    assert.equal(labelled.querySelector('label').textContent, 'E-mail');
    assert.equal(labelled.querySelector('small').textContent, 'Usado para entrar.');
    assert.equal(field({ label: 'Nome', control: h('input#nome') }).className, 'field');
    assert.equal(field({ label: 'Nome', control: h('input#nome') }).querySelector('small'), null);

    const section = sectionTitle('Resumo', 'Descrição', [button('Ação')]);
    assert.equal(section.className, 'section-title');
    assert.equal(section.querySelector('h2').textContent, 'Resumo');
    assert.equal(section.querySelector('p').textContent, 'Descrição');
    assert.equal(section.querySelector('button').textContent, 'Ação');
    assert.equal(sectionTitle('Só título').querySelector('p'), null);
  });
});

test('componentes: tons de situação cobrem tudo o que o servidor devolve, e as iniciais do avatar', async () => {
  assert.deepEqual(tones.media, { approved: '', pending: 'warning', rejected: 'danger' });
  assert.deepEqual(Object.keys(tones.readiness).sort(), ['deleted', 'not_scanned', 'pending', 'ready', 'rejected']);
  assert.deepEqual(Object.keys(tones.schedule).sort(), ['draft', 'expired', 'live', 'published', 'scheduled', 'stopped']);
  assert.deepEqual(Object.keys(tones.connection).sort(), ['inactive', 'offline', 'online']);
  for (const group of Object.values(tones)) for (const tone of Object.values(group)) assert.ok(['', 'warning', 'danger', 'neutral'].includes(tone), tone);
  assert.equal(initials('Maria Souza'), 'MS');
  assert.equal(initials('maria'), 'M');
  assert.equal(initials('  ana   paula  silva '), 'AP');
  assert.equal(initials('ábaco azul'), 'ÁA');
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
  assert.equal(initials(undefined), '?');
});

// ---- ícones ---------------------------------------------------------------------------------------------------------------

test('ícones: SVG criado por elementos (nunca por texto), no estilo do painel, com reserva para nomes desconhecidos', async () => {
  await withFakeDom(() => {
    const svg = icon('check');
    assert.equal(svg.namespaceURI, SVG_NS);
    assert.equal(svg.localName, 'svg');
    assert.equal(svg.getAttribute('class'), 'icon');
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('aria-hidden'), 'true', 'ícone decorativo some para leitores de tela');
    assert.equal(svg.getAttribute('focusable'), 'false');
    assert.equal(svg.childNodes.length, 1);
    const [path] = svg.childNodes;
    assert.equal(path.localName, 'path');
    assert.equal(path.namespaceURI, SVG_NS);
    assert.equal(path.getAttribute('d'), ICONS.check);
    assert.equal(icon('inexistente').firstChild.getAttribute('d'), ICONS.file, 'nome desconhecido usa o ícone de arquivo');
    assert.equal(icon('check', 'turned big').getAttribute('class'), 'icon turned big');
    assert.equal(icon('check', '').getAttribute('class'), 'icon');
    assert.equal(icon('<script>alert(1)</script>').firstChild.getAttribute('d'), ICONS.file, 'o nome nunca é usado como marcação');
    assert.equal(icon('__proto__').firstChild.getAttribute('d'), ICONS.file);
    assert.equal(icon('toString').firstChild.getAttribute('d'), ICONS.file);
  });
  assert.ok(Object.isFrozen(ICONS));
  const entries = Object.entries(ICONS);
  assert.ok(entries.length >= 50);
  for (const [name, path] of entries) {
    assert.match(name, /^[a-z]+(?:-[a-z]+)*$/, name);
    assert.match(path, /^M[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/, `desenho do ícone ${name}`);
  }
  assert.equal(new Set(Object.values(ICONS)).size, entries.length, 'dois nomes não podem apontar para o mesmo desenho');
});

// ---- download -------------------------------------------------------------------------------------------------------------

test('download: o arquivo montado na página vira um link temporário que é removido e cujo endereço é revogado depois', async () => {
  await withFakeDom(document => {
    const events = [], scheduled = [];
    const blob = { size: 3 };
    const urlApi = {
      createObjectURL: value => { events.push('create'); assert.equal(value, blob); return 'blob:http://127.0.0.1:3000/abc-123'; },
      revokeObjectURL: url => events.push(['revoke', url])
    };
    document.body.addEventListener('click', event => {
      const link = event.target;
      events.push(['click', link.localName, link.getAttribute('href'), link.getAttribute('download'), link.hidden, link.isConnected, link.getAttribute('rel')]);
    });
    downloadBlob('relatório;2026.csv', blob, { urlApi, doc: document, later: (callback, ms) => scheduled.push([callback, ms]) });
    assert.deepEqual(events, ['create', ['click', 'a', 'blob:http://127.0.0.1:3000/abc-123', 'relatório;2026.csv', true, true, null]]);
    assert.equal(document.body.childNodes.length, 0, 'o link temporário é removido logo após o clique');
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0][1], 1000);
    assert.equal(events.length, 2, 'o endereço ainda não foi revogado: o navegador precisa de tempo para iniciar o download');
    scheduled[0][0]();
    assert.deepEqual(events.at(-1), ['revoke', 'blob:http://127.0.0.1:3000/abc-123']);

    const hostile = '<img src=x onerror=alert(1)>.csv';
    downloadBlob(hostile, blob, { urlApi, doc: document, later: () => {} });
    assert.equal(events.at(-1)[3], hostile, 'o nome do arquivo é só um valor de atributo');
    assert.equal(document.body.childNodes.length, 0);
    assert.throws(() => downloadBlob('x.csv', blob, { urlApi: { createObjectURL: () => 'https://evil.example/x', revokeObjectURL() {} }, doc: document, later: () => {} }), /Endereço não permitido/, 'só blob: é aceito como origem do download');
    assert.equal(document.body.childNodes.length, 0);
  });
});

// ---- tratamento de erros e operações em andamento ---------------------------------------------------------------------------

function toastRegion(document) {
  const region = document.createElement('div');
  region.id = 'toast';
  document.body.appendChild(region);
  return region;
}

test('feedback: 401 e cancelamentos já foram tratados; outros erros viram aviso ou mensagem na janela aberta', async () => {
  await withFakeDom(document => {
    const region = toastRegion(document);
    assert.equal(isHandled(new ApiError(401, 'x')), true);
    assert.equal(isHandled(abortError()), true);
    assert.equal(isHandled(new ApiError(403, 'x')), false);
    assert.equal(isHandled(new ApiError(0, 'x')), false);
    assert.equal(isHandled(new Error('x')), false);
    assert.equal(isHandled(null), false);
    assert.equal(isHandled(undefined), false);

    showError(new ApiError(401, 'Sessão expirou'));
    showError(abortError());
    assert.equal(region.textContent, '', 'erros já tratados não aparecem');

    showError(new ApiError(422, 'O nome já existe.'));
    assert.equal(region.textContent, 'O nome já existe.');
    assert.equal(region.dataset.kind, 'error');
    assert.equal(region.getAttribute('role'), 'alert');
    showError(new Error(''));
    assert.equal(region.textContent, 'Não foi possível concluir a ação.');
    showError(null);
    assert.equal(region.textContent, 'Não foi possível concluir a ação.');

    const messages = [];
    const attached = document.createElement('dialog');
    document.body.appendChild(attached);
    const dialog = { el: attached, setError: message => messages.push(message), clearError() {} };
    region.textContent = '';
    showError(new ApiError(409, 'Alguém alterou antes de você.'), dialog);
    assert.deepEqual(messages, ['Alguém alterou antes de você.']);
    assert.equal(region.textContent, '', 'com a janela aberta o erro aparece nela, não no aviso');
    attached.remove();
    showError(new ApiError(409, 'Janela já fechada.'), dialog);
    assert.deepEqual(messages, ['Alguém alterou antes de você.'], 'janela fechada: volta ao aviso');
    assert.equal(region.textContent, 'Janela já fechada.');

    showError(new ApiError(400, '<img src=x onerror=alert(1)>'));
    assert.equal(region.querySelectorAll('img').length, 0, 'a mensagem do servidor é sempre texto');
    assert.equal(region.textContent, '<img src=x onerror=alert(1)>');
  });
});

test('feedback: botão desabilitado e "ocupado" durante a operação, sem dupla execução, e sempre liberado ao terminar', async () => {
  await withFakeDom(async document => {
    const region = toastRegion(document);
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    let during;
    const result = await runBusy(trigger, async () => { during = [trigger.disabled, trigger.getAttribute('aria-busy')]; return 42; });
    assert.deepEqual(during, [true, 'true']);
    assert.equal(result, 42);
    assert.equal(trigger.disabled, false);
    assert.equal(trigger.hasAttribute('aria-busy'), false);

    const slow = deferred();
    let second = 0;
    const running = runBusy(trigger, () => slow.promise);
    assert.equal(await runBusy(trigger, async () => { second++; return 'não deve rodar'; }), undefined, 'clicar de novo durante a operação não repete nada');
    assert.equal(second, 0);
    slow.resolve('pronto');
    assert.equal(await running, 'pronto');
    assert.equal(trigger.disabled, false);

    assert.equal(await runBusy(trigger, async () => { throw new ApiError(422, 'Nome inválido.'); }), undefined);
    assert.equal(region.textContent, 'Nome inválido.');
    assert.equal(trigger.disabled, false, 'falhou, mas o botão volta a funcionar');
    assert.equal(trigger.hasAttribute('aria-busy'), false);

    region.textContent = '';
    assert.equal(await runBusy(trigger, async () => { throw new ApiError(401, 'Sessão expirou'); }), undefined);
    assert.equal(await runBusy(trigger, async () => { throw abortError(); }), undefined);
    assert.equal(region.textContent, '', '401 e cancelamento não geram aviso');

    const calls = [];
    const dialog = { el: trigger, clearError: () => calls.push('clear'), setError: message => calls.push(`erro:${message}`) };
    await runBusy(trigger, async () => { calls.push('trabalho'); throw new ApiError(409, 'Conflito.'); }, { dialog });
    assert.deepEqual(calls, ['clear', 'trabalho', 'erro:Conflito.'], 'a mensagem anterior é limpa antes de tentar de novo');

    assert.equal(await runBusy(null, async () => 'sem botão'), 'sem botão');

    const detached = document.createElement('button');
    assert.equal(await runBusy(detached, async () => 'ok'), 'ok');
    assert.equal(detached.disabled, true, 'botão que saiu da tela durante a operação não é mexido');
  });
});

test('feedback: action() liga a operação ao botão que recebeu o clique', async () => {
  await withFakeDom(async document => {
    toastRegion(document);
    const finished = deferred();
    const seen = [];
    const trigger = h('button', { on: { click: action(async event => { seen.push([event.type, trigger.disabled]); await finished.promise; seen.push('fim'); }) } });
    document.body.appendChild(trigger);
    trigger.click();
    assert.deepEqual(seen, [['click', true]], 'o botão já está ocupado quando a operação começa');
    trigger.click();
    assert.equal(seen.length, 1, 'clique repetido é ignorado');
    finished.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen.at(-1), 'fim');
    assert.equal(trigger.disabled, false);
  });
});

// ---- avisos -------------------------------------------------------------------------------------------------------------------

test('aviso (toast): região anunciada por leitores de tela, duração própria para erros, reinício do tempo e texto sempre puro', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await withFakeDom(document => {
    assert.doesNotThrow(() => toast('sem região na página'), 'sem a região o aviso simplesmente não aparece');
    assert.doesNotThrow(() => hideToast());
    const region = toastRegion(document);

    toast('Salvo com sucesso.');
    assert.equal(region.textContent, 'Salvo com sucesso.');
    assert.equal(region.dataset.kind, 'info');
    assert.equal(region.getAttribute('role'), 'status');
    assert.equal(region.classList.contains('visible'), true);
    t.mock.timers.tick(4799);
    assert.equal(region.classList.contains('visible'), true);
    t.mock.timers.tick(1);
    assert.equal(region.classList.contains('visible'), false, 'some depois de 4,8 s');

    toast('Falhou.', { kind: 'error', duration: 100 });
    assert.equal(region.getAttribute('role'), 'alert', 'erro é anunciado de imediato');
    assert.equal(region.dataset.kind, 'error');
    t.mock.timers.tick(6999);
    assert.equal(region.classList.contains('visible'), true, 'erro fica pelo menos 7 s, mesmo com duração menor');
    t.mock.timers.tick(1);
    assert.equal(region.classList.contains('visible'), false);

    toast('Erro longo.', { kind: 'error', duration: 12000 });
    t.mock.timers.tick(11999);
    assert.equal(region.classList.contains('visible'), true);
    t.mock.timers.tick(1);
    assert.equal(region.classList.contains('visible'), false);

    toast('A');
    t.mock.timers.tick(3000);
    toast('B');
    t.mock.timers.tick(3000);
    assert.equal(region.classList.contains('visible'), true, 'um novo aviso reinicia a contagem');
    assert.equal(region.textContent, 'B');
    assert.equal(region.getAttribute('role'), 'status', 'o papel volta a "status" depois de um erro');
    t.mock.timers.tick(1800);
    assert.equal(region.classList.contains('visible'), false);

    toast('Será escondido');
    hideToast();
    assert.equal(region.classList.contains('visible'), false);
    t.mock.timers.tick(10000);
    assert.equal(region.classList.contains('visible'), false);

    toast(null);
    assert.equal(region.textContent, '');
    toast('<img src=x onerror=alert(1)>');
    assert.equal(region.querySelectorAll('img').length, 0);
    assert.equal(region.childNodes.length, 1);
    assert.equal(region.firstChild.nodeType, 3);
    hideToast();
  });
});
