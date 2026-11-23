// Monta, no DOM de teste, a estrutura REAL de uma página do projeto (o <body> de public/player.html), para os testes do player
// usarem exatamente os mesmos elementos, ids, textos e atributos "hidden" que a TV recebe. Não é um navegador: não aplica CSS,
// não executa scripts e só entende o HTML simples escrito à mão neste projeto.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = text => text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, entity => ENTITIES[entity]);

export function loadBody(document, html) {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1];
  if (body === undefined) throw new Error('A página não tem <body>.');
  const stack = [document.body];
  const tokens = body.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g);
  for (const [, closing, name, rawAttributes = '', text] of tokens) {
    if (text !== undefined) {
      const collapsed = text.replace(/\s+/g, ' ');
      if (collapsed.trim()) stack.at(-1).appendChild(document.createTextNode(decode(collapsed)));
      continue;
    }
    const tag = name.toLowerCase();
    if (closing) {
      while (stack.length > 1 && stack.at(-1).localName !== tag) stack.pop();
      if (stack.length > 1) stack.pop();
      continue;
    }
    const element = document.createElement(tag);
    for (const match of rawAttributes.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      element.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
    }
    stack.at(-1).appendChild(element);
    if (!VOID.has(tag) && !rawAttributes.trimEnd().endsWith('/')) stack.push(element);
  }
  return document;
}
