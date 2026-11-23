// DOM mínimo para testar, no Node, a construção da interface (ui/dom.js, componentes, avisos, download).
//
// Não é um navegador: foco real, <dialog>, layout, rolagem e arrastar-e-soltar são validados nos testes de ponta a ponta
// com Chromium (tests/e2e). Aqui basta ser fiel no que o código do painel usa: nós, atributos, classes, dataset, eventos
// (com propagação) e seletores simples. Onde o navegador recusa algo (nó dentro de si mesmo, classe vazia ou com espaço),
// este DOM também recusa, para que um erro do painel não passe despercebido por causa da simulação.

export const HTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Propriedades booleanas que o navegador reflete em atributos (propriedade → atributo).
const BOOLEAN_REFLECT = Object.freeze({
  disabled: 'disabled', hidden: 'hidden', checked: 'checked', selected: 'selected', open: 'open', readOnly: 'readonly', required: 'required',
  multiple: 'multiple', autofocus: 'autofocus', muted: 'muted', loop: 'loop', controls: 'controls', autoplay: 'autoplay', playsInline: 'playsinline'
});
const BOOLEAN_ATTRIBUTES = new Set(Object.values(BOOLEAN_REFLECT));

const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = value => escapeText(value).replace(/"/g, '&quot;');
const kebab = name => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const camel = name => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export class FakeEvent {
  constructor(type, { bubbles = false, cancelable = false } = {}) {
    this.type = type;
    this.bubbles = bubbles;
    this.cancelable = cancelable;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.stopped = false;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}

class FakeNode {
  constructor(ownerDocument, nodeType) {
    this.ownerDocument = ownerDocument;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }

  appendChild(child) {
    if (!child || typeof child.nodeType !== 'number') throw new TypeError('appendChild: o argumento não é um nó.');
    if (child.nodeType === 11) {
      for (const grandchild of [...child.childNodes]) this.appendChild(grandchild);
      return child;
    }
    for (let ancestor = this; ancestor; ancestor = ancestor.parentNode) {
      if (ancestor === child) throw new Error('HierarchyRequestError: um nó não pode ser inserido dentro de si mesmo.');
    }
    child.remove();
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    for (const node of nodes) this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node);
  }

  remove() {
    const parent = this.parentNode;
    if (!parent) return;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }

  // Insere nós (ou textos) logo depois deste, no mesmo pai.
  after(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const inserted = nodes.map(node => (typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node));
    for (const node of inserted) node.remove();
    parent.childNodes.splice(parent.childNodes.indexOf(this) + 1, 0, ...inserted);
    for (const node of inserted) node.parentNode = parent;
  }

  // Troca este nó pelos indicados, no mesmo lugar do pai.
  replaceWith(...nodes) {
    const parent = this.parentNode;
    if (!parent) return;
    const inserted = nodes.map(node => (typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node));
    for (const node of inserted) node.remove();
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1, ...inserted);
    for (const node of inserted) node.parentNode = parent;
    this.parentNode = null;
  }

  get textContent() { return this.childNodes.map(child => child.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    const textValue = String(value ?? '');
    if (textValue) this.appendChild(this.ownerDocument.createTextNode(textValue));
  }

  addEventListener(type, listener, options) {
    const list = this.listeners.get(type) ?? [];
    if (!list.some(entry => entry.listener === listener)) list.push({ listener, once: typeof options === 'object' && options?.once === true });
    this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry.listener !== listener));
  }
  dispatchEvent(event) {
    const dispatched = event instanceof FakeEvent ? event : new FakeEvent(event.type, event);
    dispatched.target = this;
    for (let node = this; node && !dispatched.stopped; node = dispatched.bubbles ? node.parentNode : null) {
      dispatched.currentTarget = node;
      for (const entry of [...(node.listeners.get(dispatched.type) ?? [])]) {
        if (entry.once) node.removeEventListener(dispatched.type, entry.listener);
        entry.listener.call(node, dispatched);
      }
    }
    dispatched.currentTarget = null;
    return !dispatched.defaultPrevented;
  }

  querySelectorAll(selector) {
    const alternatives = parseSelectorList(selector);
    const found = [];
    const visit = node => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (alternatives.some(parts => matchesComplex(child, parts))) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

class FakeText extends FakeNode {
  constructor(ownerDocument, data) { super(ownerDocument, 3); this.data = data; }
  get nodeValue() { return this.data; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value ?? ''); }
}

class FakeFragment extends FakeNode {
  constructor(ownerDocument) { super(ownerDocument, 11); }
}

function makeStyle() {
  const custom = new Map();
  return {
    setProperty(name, value) { custom.set(name, String(value)); },
    getPropertyValue(name) { return custom.get(name) ?? ''; },
    removeProperty(name) { const previous = custom.get(name) ?? ''; custom.delete(name); return previous; }
  };
}

class FakeElement extends FakeNode {
  constructor(ownerDocument, localName, namespaceURI = HTML_NS) {
    super(ownerDocument, 1);
    this.localName = localName;
    this.namespaceURI = namespaceURI;
    this.tagName = namespaceURI === HTML_NS ? localName.toUpperCase() : localName;
    this.attributeMap = new Map();
    this.style = makeStyle();
    this.value = '';
    this.indeterminate = false;
    this.clicks = 0;
  }

  get attributes() { return [...this.attributeMap].map(([name, value]) => ({ name, value })); }
  setAttribute(name, value) { this.attributeMap.set(this.namespaceURI === HTML_NS ? String(name).toLowerCase() : String(name), String(value)); }
  getAttribute(name) { return this.attributeMap.get(this.namespaceURI === HTML_NS ? String(name).toLowerCase() : String(name)) ?? null; }
  hasAttribute(name) { return this.getAttribute(name) !== null; }
  removeAttribute(name) { this.attributeMap.delete(this.namespaceURI === HTML_NS ? String(name).toLowerCase() : String(name)); }
  toggleAttribute(name, force) {
    const on = force ?? !this.hasAttribute(name);
    if (on) { if (!this.hasAttribute(name)) this.setAttribute(name, ''); } else this.removeAttribute(name);
    return on;
  }

  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }

  get classList() {
    const element = this;
    const read = () => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const write = list => { if (list.length) element.setAttribute('class', list.join(' ')); else element.removeAttribute('class'); };
    const check = token => {
      if (token === '' || /\s/.test(token)) throw new Error(`InvalidCharacterError: classe inválida "${token}".`);
      return token;
    };
    return {
      add: (...names) => { const list = read(); for (const name of names) if (!list.includes(check(String(name)))) list.push(String(name)); write(list); },
      remove: (...names) => write(read().filter(item => !names.map(check).includes(item))),
      contains: name => read().includes(name),
      toggle: (name, force) => {
        const has = read().includes(check(name)), on = force ?? !has;
        if (on && !has) write([...read(), name]); else if (!on && has) write(read().filter(item => item !== name));
        return on;
      },
      item: index => read()[index] ?? null,
      get length() { return read().length; },
      toString: () => read().join(' '),
      [Symbol.iterator]: () => read()[Symbol.iterator]()
    };
  }

  get dataset() {
    const element = this;
    const attribute = key => `data-${kebab(key)}`;
    return new Proxy({}, {
      get: (_, key) => (typeof key === 'string' ? element.getAttribute(attribute(key)) ?? undefined : undefined),
      set: (_, key, value) => { element.setAttribute(attribute(key), String(value)); return true; },
      deleteProperty: (_, key) => { element.removeAttribute(attribute(key)); return true; },
      has: (_, key) => typeof key === 'string' && element.hasAttribute(attribute(key)),
      ownKeys: () => [...element.attributeMap.keys()].filter(name => name.startsWith('data-')).map(name => camel(name.slice(5))),
      getOwnPropertyDescriptor: (_, key) => (typeof key === 'string' && element.hasAttribute(attribute(key))
        ? { enumerable: true, configurable: true, writable: true, value: element.getAttribute(attribute(key)) }
        : undefined)
    });
  }

  matches(selector) { return parseSelectorList(selector).some(parts => matchesComplex(this, parts)); }
  click() { this.clicks++; this.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true })); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
}

for (const [property, attribute] of Object.entries(BOOLEAN_REFLECT)) {
  Object.defineProperty(FakeElement.prototype, property, {
    configurable: true,
    get() { return this.attributeMap.has(attribute); },
    set(value) { if (value) this.attributeMap.set(attribute, ''); else this.attributeMap.delete(attribute); }
  });
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null, 9);
    this.ownerDocument = this;
    this.body = new FakeElement(this, 'body');
    this.appendChild(this.body);
    this.activeElement = this.body;
  }
  createElement(tag) { return new FakeElement(this, String(tag).toLowerCase()); }
  createElementNS(namespace, tag) { return new FakeElement(this, String(tag), namespace); }
  createTextNode(data) { return new FakeText(this, String(data)); }
  createDocumentFragment() { return new FakeFragment(this); }
  getElementById(id) { return this.querySelectorAll('*').find(element => element.id === id) ?? null; }
}

// ---- seletores simples: tag, *, #id, .classe, [atributo], [atributo=valor], :not(...), descendente (espaço) e filho (>), lista (,) -------

function parseCompound(text) {
  const compound = { tag: '', id: '', classes: [], attributes: [], not: [] };
  let rest = text;
  const token = /^(?:(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:not\(([^()]*)\))/;
  while (rest) {
    const match = token.exec(rest);
    if (!match) throw new Error(`Seletor não suportado pelo DOM de teste: ${text}`);
    const [whole, tag, id, className, attributeName, double, single, bare, negated] = match;
    if (tag) compound.tag = tag.toLowerCase();
    else if (id) compound.id = id;
    else if (className) compound.classes.push(className);
    else if (attributeName) compound.attributes.push({ name: attributeName, value: double ?? single ?? bare });
    else if (negated !== undefined) compound.not.push(parseCompound(negated));
    rest = rest.slice(whole.length);
  }
  return compound;
}

function splitComplex(text) {
  const parts = [];
  let current = '', combinator = ' ', depth = 0, quote = '';
  const flush = () => {
    if (!current) return;
    parts.push({ combinator, compound: parseCompound(current) });
    current = '';
    combinator = ' ';
  };
  for (const char of text.trim()) {
    if (quote) { current += char; if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[' || char === '(') depth++;
    if (char === ']' || char === ')') depth--;
    if (depth === 0 && (char === ' ' || char === '>')) {
      flush();
      if (char === '>') combinator = '>';
      continue;
    }
    current += char;
  }
  flush();
  return parts;
}

function parseSelectorList(selector) {
  return String(selector).split(',').map(piece => piece.trim()).filter(Boolean).map(splitComplex);
}

function matchesCompound(element, compound) {
  if (compound.tag && compound.tag !== '*' && compound.tag !== element.localName.toLowerCase()) return false;
  if (compound.id && element.id !== compound.id) return false;
  const classes = (element.getAttribute('class') ?? '').split(/\s+/);
  if (compound.classes.some(name => !classes.includes(name))) return false;
  for (const { name, value } of compound.attributes) {
    const actual = element.getAttribute(name);
    if (actual === null || (value !== undefined && actual !== value)) return false;
  }
  return !compound.not.some(inner => matchesCompound(element, inner));
}

function matchesComplex(element, parts) {
  const test = (candidate, index) => {
    if (!matchesCompound(candidate, parts[index].compound)) return false;
    if (index === 0) return true;
    if (parts[index].combinator === '>') return candidate.parentNode?.nodeType === 1 && test(candidate.parentNode, index - 1);
    for (let ancestor = candidate.parentNode; ancestor?.nodeType === 1; ancestor = ancestor.parentNode) if (test(ancestor, index - 1)) return true;
    return false;
  };
  return parts.length > 0 && test(element, parts.length - 1);
}

// ---- serialização (para conferir que texto continua texto) -------------------------------------------------------------------

export function serialize(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  if (node.nodeType === 11 || node.nodeType === 9) return node.childNodes.map(serialize).join('');
  const attributes = [...node.attributeMap].map(([name, value]) => (BOOLEAN_ATTRIBUTES.has(name) && value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`)).join('');
  const tag = node.localName;
  if (node.namespaceURI === HTML_NS && VOID_TAGS.has(tag)) return `<${tag}${attributes}>`;
  return `<${tag}${attributes}>${node.childNodes.map(serialize).join('')}</${tag}>`;
}

// Todos os elementos abaixo de um nó, em ordem de documento.
export const descendants = node => node.querySelectorAll('*');

export function installFakeDom() {
  const document = new FakeDocument();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  return {
    document,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
    }
  };
}

// Executa `run(document)` com o DOM de teste instalado como `globalThis.document` e sempre o remove ao terminar.
export async function withFakeDom(run) {
  const installed = installFakeDom();
  try { return await run(installed.document); } finally { installed.restore(); }
}
