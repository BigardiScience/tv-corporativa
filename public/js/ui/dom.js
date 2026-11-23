// Construção segura de DOM.
//
// Regra do painel: NENHUM texto vindo do servidor ou de pessoas vira HTML. Tudo é criado com createElement / createTextNode,
// então "<img onerror=…>" num título de arquivo aparece como texto, nunca como marcação. Esta é a defesa central contra XSS
// e é verificada por testes (tests/frontend-static.test.mjs e tests/frontend-dom.test.mjs).
//
// Uso:  h('button.button.primary', { type: 'button', on: { click: salvar }, aria: { label: 'Salvar' } }, icon('check'), 'Salvar')

const FORBIDDEN_TAGS = new Set(['script', 'style', 'link', 'meta', 'base', 'object', 'embed', 'applet', 'noscript', 'template', 'slot']);

// Atributos aceitos (além de aria-*, data-* e das propriedades tratadas à parte). Nada de on*, srcdoc, style em texto, etc.
const ATTRIBUTES = new Set([
  'id', 'type', 'name', 'for', 'placeholder', 'title', 'role', 'tabindex', 'href', 'src', 'alt', 'min', 'max', 'step', 'maxlength', 'minlength',
  'autocomplete', 'accept', 'rows', 'cols', 'colspan', 'rowspan', 'scope', 'target', 'rel', 'download', 'inputmode', 'autocapitalize', 'spellcheck',
  'enterkeyhint', 'loading', 'decoding', 'preload', 'poster', 'sandbox', 'width', 'height', 'lang', 'datetime', 'list', 'pattern', 'label', 'form', 'dir'
]);
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster']);
const BOOLEAN_PROPERTIES = new Set(['disabled', 'checked', 'selected', 'hidden', 'open', 'readOnly', 'required', 'multiple', 'indeterminate', 'autofocus', 'muted', 'loop', 'controls', 'autoplay', 'playsInline']);
const FORBIDDEN_KEYS = new Set(['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML', 'innerText']);

const documentOf = () => {
  if (!globalThis.document) throw new Error('DOM indisponível.');
  return globalThis.document;
};

export const isNode = value => !!value && typeof value === 'object' && typeof value.nodeType === 'number';

// Só endereços do próprio painel, âncoras e blob: (prévias locais). Nada de javascript:, data: ou sites externos por engano.
// O navegador ignora tabulações e quebras de linha dentro de um endereço e lê "\" como "/": sem o bloqueio abaixo,
// "/\outro-site" e "/<TAB>/outro-site" passariam por caminhos do painel e abririam outro site.
export function safeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const refuse = () => { throw new Error(`Endereço não permitido no painel: ${text.slice(0, 40)}`); };
  if (/[\u0000-\u001f\u007f-\u009f\\\s]/.test(text)) refuse();
  if (text.startsWith('#') || (text.startsWith('/') && !text.startsWith('//'))) return text;
  if (/^blob:/i.test(text)) return text;
  return refuse();
}

function parseSpec(spec) {
  const match = /^([a-z][a-z0-9-]*)?((?:[.#][A-Za-z0-9_-]+)*)$/.exec(String(spec));
  if (!match) throw new Error(`Especificação de elemento inválida: ${String(spec).slice(0, 40)}`);
  const tag = match[1] || 'div';
  if (FORBIDDEN_TAGS.has(tag)) throw new Error(`Elemento não permitido: <${tag}>`);
  let id = '';
  const classes = [];
  for (const part of (match[2].match(/[.#][A-Za-z0-9_-]+/g) ?? [])) {
    if (part[0] === '#') id = part.slice(1); else classes.push(part.slice(1));
  }
  return { tag, id, classes };
}

function classNames(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(classNames);
  return Object.entries(value).filter(([, on]) => on).map(([name]) => name);
}

function applyProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEYS.has(key) || (/^on/i.test(key) && key !== 'on')) throw new Error(`Propriedade não permitida: ${key}`);
    // Atributos "enumerados" do HTML: o desligado precisa ser o TEXTO "false" (e não a ausência do atributo, que significa o padrão).
    if (key === 'draggable' || key === 'spellcheck') {
      if (value !== undefined && value !== null) el.setAttribute(key, value === false || value === 'false' || value === 0 ? 'false' : 'true');
      continue;
    }
    if (value === undefined || value === null) continue;
    if (key === 'class' || key === 'className') { const names = classNames(value); if (names.length) el.classList.add(...names); continue; }
    if (key === 'dataset') { for (const [name, item] of Object.entries(value)) if (item !== undefined && item !== null) el.dataset[name] = String(item); continue; }
    if (key === 'aria') { for (const [name, item] of Object.entries(value)) if (item !== undefined && item !== null && item !== false) el.setAttribute(`aria-${name}`, String(item)); continue; }
    if (key === 'style') {
      if (typeof value !== 'object') throw new Error('style deve ser um objeto.');
      for (const [name, item] of Object.entries(value)) { if (name.startsWith('--')) el.style.setProperty(name, String(item)); else el.style[name] = String(item); }
      continue;
    }
    if (key === 'on') {
      for (const [name, handler] of Object.entries(value)) {
        if (Array.isArray(handler)) el.addEventListener(name, handler[0], handler[1]); else el.addEventListener(name, handler);
      }
      continue;
    }
    if (key === 'ref') { value(el); continue; }
    if (key === 'text') { el.textContent = String(value); continue; }
    if (key === 'value') { el.value = String(value); continue; }
    if (BOOLEAN_PROPERTIES.has(key)) { if (value !== false) el[key] = true; continue; }
    if (key.startsWith('aria-') || key.startsWith('data-')) { if (value !== false) el.setAttribute(key, String(value)); continue; }
    if (!ATTRIBUTES.has(key)) throw new Error(`Atributo não permitido: ${key}`);
    if (value === false) continue;
    el.setAttribute(key, URL_ATTRIBUTES.has(key) ? safeUrl(value) : String(value));
  }
  // target="_blank" nunca entrega a janela de origem à página aberta.
  if (el.getAttribute?.('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
}

export function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (isNode(child)) parent.appendChild(child);
    else parent.appendChild(documentOf().createTextNode(String(child)));
  }
  return parent;
}

export function h(spec, props, ...children) {
  if (props !== undefined && props !== null && (typeof props !== 'object' || isNode(props) || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  const { tag, id, classes } = parseSpec(spec);
  const el = documentOf().createElement(tag);
  if (id) el.id = id;
  if (classes.length) el.classList.add(...classes);
  if (props) applyProps(el, props);
  return append(el, children);
}

export function fragment(...children) {
  return append(documentOf().createDocumentFragment(), children);
}

export function text(value) {
  return documentOf().createTextNode(String(value ?? ''));
}

// Troca todo o conteúdo de um contêiner.
export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

export const $ = (selector, root = globalThis.document) => root.querySelector(selector);
export const $$ = (selector, root = globalThis.document) => [...root.querySelectorAll(selector)];
