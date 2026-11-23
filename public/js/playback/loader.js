// Como o arquivo de um conteúdo chega até a tela.
//   TV ....... baixa o arquivo com a credencial própria do aparelho, com prazos, conferência do tamanho e guarda na memória (limitada).
//              Vídeo também pode tocar direto do servidor, por um link temporário assinado, nos aparelhos que não tocam o arquivo baixado.
//   Painel ... usa o endereço do servidor direto (a sessão do navegador autentica): não baixa nem guarda nada.
// Nada é gravado em disco. Só endereços locais /api/media/<id>/file são aceitos: a credencial nunca é enviada para outro endereço.
//
// Os erros carregam o que o motor precisa saber para decidir se vale tentar de novo:
//   transient ... rede, servidor ocupado, prazo estourado → tenta de novo
//   permanent ... arquivo inexistente, formato inválido   → não adianta repetir
//   auth ........ acesso revogado (401/403)               → não repete e avisa o player

export const MEDIA_PATH = /^\/api\/media\/[^/?#]+\/file$/;
const MEDIA_ID = /^\/api\/media\/([^/?#]+)\/file$/;

export const LOAD_LIMITS = Object.freeze({
  headersMs: 15_000,                // esperar o servidor começar a responder
  idleMs: 20_000,                   // sem receber nenhum dado por tanto tempo, o download é considerado travado
  streamMaxBytes: 24 * 1024 * 1024, // até este tamanho o download é acompanhado pedaço a pedaço
  minBytesPerSecond: 64 * 1024,     // acima disso, o prazo do download cresce com o tamanho do arquivo
  bodyMinMs: 30_000,
  bodyMaxMs: 15 * 60_000
});

const abortError = () => Object.assign(new Error('cancelado'), { name: 'AbortError', cancelled: true });
export const loadError = (message, flags = {}) => Object.assign(new Error(message), flags);

export function mediaPath(url) {
  if (typeof url !== 'string' || !MEDIA_PATH.test(url)) throw loadError('Endereço de mídia não permitido.', { permanent: true, code: 'bad-url' });
  return url;
}

// Confere o link temporário que o servidor entregou: tem de ser o endereço local do MESMO arquivo, só com o parâmetro ?t=.
// Qualquer outra coisa (outro servidor, outro arquivo, parâmetros a mais) é recusada: o navegador nunca é mandado para fora.
export function directPath(path, reply) {
  const prefix = `/api/media/${MEDIA_ID.exec(path)?.[1]}/file?t=`;
  const url = reply?.url;
  if (!MEDIA_ID.test(path) || typeof url !== 'string' || !url.startsWith(prefix) || !/^[A-Za-z0-9._-]{16,512}$/.test(url.slice(prefix.length))) {
    throw loadError('Endereço temporário de mídia não permitido.', { permanent: true, code: 'bad-url' });
  }
  return url;
}

export function classifyStatus(status) {
  if (status === 401 || status === 403) return { auth: true, permanent: true, code: 'auth' };
  if (status === 408 || status === 425 || status === 429 || status >= 500) return { transient: true, code: 'server' };
  if (status >= 400) return { permanent: true, code: 'not-found' };
  return { transient: true, code: 'server' };
}

// Abandona a espera assim que o sinal dispara, mesmo que a origem da promessa (rede, leitor do arquivo) ignore o cancelamento.
const raceSignal = (promise, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const onAbort = () => reject(abortError());
  signal.addEventListener('abort', onAbort, { once: true });
  promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
});

const systemTimers = () => ({ setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: id => globalThis.clearTimeout(id) });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Baixa `path` e devolve um Blob. `request(path, { signal })` é fornecido por quem conhece a credencial (o player da TV).
export async function downloadBlob(request, path, { signal, limits = LOAD_LIMITS, timers = systemTimers(), mime = '' } = {}) {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let why = null, timer = null;
  const clear = () => { if (timer !== null) { timers.clearTimeout(timer); timer = null; } };
  const arm = (ms, reason) => { clear(); timer = timers.setTimeout(() => { why = reason; controller.abort(); }, ms); };
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort, { once: true });
  // Traduz uma interrupção: pedida por quem chamou (cancelamento), por um prazo nosso (tentar de novo) ou falha de rede.
  const interrupted = error => {
    if (signal?.aborted) return abortError();
    if (why === 'headers') return loadError('O servidor demorou para responder.', { transient: true, code: 'timeout' });
    if (why) return loadError('O download parou de receber dados.', { transient: true, code: 'timeout' });
    return error?.transient || error?.permanent ? error : loadError('Sem conexão com o servidor.', { transient: true, code: 'network' });
  };
  try {
    arm(limits.headersMs, 'headers');
    let response;
    try { response = await raceSignal(Promise.resolve(request(path, { signal: controller.signal })), controller.signal); } catch (error) { throw interrupted(error); }
    clear();
    if (!response.ok) throw loadError(`O servidor respondeu ${response.status}.`, { ...classifyStatus(response.status), status: response.status });

    const declared = Number(response.headers?.get?.('content-length'));
    const known = Number.isFinite(declared) && declared > 0;
    const encoding = response.headers?.get?.('content-encoding');
    const exact = known && (!encoding || encoding === 'identity'); // com compressão o tamanho declarado não é o do arquivo
    let blob, reader = null;
    try {
      if (known && declared <= limits.streamMaxBytes && typeof response.body?.getReader === 'function') {
        reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
          arm(limits.idleMs, 'idle');
          const { done, value } = await raceSignal(reader.read(), controller.signal);
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
        }
        clear();
        blob = new Blob(chunks, { type: mime });
        if (exact && received !== declared) throw loadError('O arquivo chegou incompleto.', { transient: true, code: 'incomplete' });
      } else {
        // Arquivos grandes (ou aparelhos sem leitura por pedaços): o navegador monta o arquivo; o prazo cresce com o tamanho.
        arm(known ? clamp((declared / limits.minBytesPerSecond) * 1000, limits.bodyMinMs, limits.bodyMaxMs) : limits.bodyMaxMs, 'body');
        blob = await raceSignal(response.blob(), controller.signal);
        clear();
        if (exact && blob.size !== declared) throw loadError('O arquivo chegou incompleto.', { transient: true, code: 'incomplete' });
      }
    } catch (error) {
      try { reader?.cancel?.().catch?.(() => {}); } catch { /* conexão já encerrada */ }
      throw error?.code === 'incomplete' ? error : interrupted(error);
    }
    if (!blob.size) throw loadError('O arquivo veio vazio.', { transient: true, code: 'empty' });
    return mime && (!blob.type || blob.type === 'application/octet-stream') ? blob.slice(0, blob.size, mime) : blob;
  } finally {
    clear();
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

// Fonte de arquivos da TV. Imagens e PDFs: baixa (ou reaproveita da memória) e entrega um endereço blob: para a tela usar.
//
// Vídeos têm dois caminhos (quando `directLink` existe) e a TV fica com o que funciona nela:
//   baixado ... o arquivo inteiro vai para a memória e o <video> toca por um endereço blob: (o padrão: o próximo vídeo fica pronto antes de aparecer);
//   direto .... o <video> pede o arquivo ao servidor por um link temporário assinado, como faz a pré-visualização do painel.
// Há TVs cujo navegador recusa vídeo por blob: ("formato não suportado", mesmo com arquivo e codecs corretos). Se o vídeo falha por
// decodificação, o palco chama `alternate()` e tenta o outro caminho uma vez; `confirm()` registra o que funcionou e os próximos vídeos já
// começam por ele. TVs que tocam o arquivo baixado não mudam em nada: nada é pedido a mais nem gravado.
//
// `remember` ({ get(), set(valor) }) guarda, de uma abertura da página para outra, o caminho que funcionou neste aparelho; sem isso, a cada
// reinício o primeiro vídeo seria baixado inteiro só para falhar de novo. É só uma dica: se ela estiver velha, o outro caminho assume sozinho.
export function createTvSource({ request, cache = null, directLink = null, remember = null, limits = LOAD_LIMITS, timers = systemTimers() }) {
  let preferDirect = false;
  try { preferDirect = remember?.get() === 'direct'; } catch { /* sem armazenamento: começa pelo arquivo baixado */ }

  async function openBlob(item, path, signal) {
    let blob = cache?.get(path);
    if (!blob) {
      blob = await downloadBlob(request, path, { signal, limits, timers, mime: item.type });
      cache?.set(path, blob);
    }
    const url = globalThis.URL.createObjectURL(blob);
    let released = false;
    return { url, release: () => { if (!released) { released = true; globalThis.URL.revokeObjectURL(url); } } };
  }

  // `directLink(id, { signal })` pede o link ao servidor, com a credencial da TV, e devolve a resposta { url }.
  async function openDirect(item, path, signal) {
    if (signal?.aborted) throw abortError();
    let reply;
    try { reply = await directLink(MEDIA_ID.exec(path)[1], { signal }); } catch (error) { throw signal?.aborted ? abortError() : error; }
    if (signal?.aborted) throw abortError();
    return { url: directPath(path, reply), release() {} };
  }

  const ways = { blob: openBlob, direct: openDirect };

  async function openVideo(item, path, signal) {
    let way = preferDirect ? 'direct' : 'blob', current;
    try { current = await ways[way](item, path, signal); } catch (error) {
      // O link não veio (servidor antigo, rede): o arquivo baixado ainda serve.
      if (way !== 'direct' || error?.cancelled || signal?.aborted) throw error;
      way = 'blob';
      current = await ways.blob(item, path, signal);
    }
    let spare = way === 'blob' ? 'direct' : 'blob';
    const opened = {
      url: current.url,
      release: () => current.release(),
      // A tela não conseguiu tocar por este caminho: troca pelo outro, uma única vez. Devolve false quando não há outro caminho utilizável.
      async alternate({ signal: outer } = {}) {
        if (!spare) return false;
        const next = spare, wait = outer ?? signal;
        spare = null;
        let fresh;
        try { fresh = await ways[next](item, path, wait); } catch (error) {
          if (error?.cancelled || wait?.aborted) throw error?.cancelled ? error : abortError();
          return false;
        }
        if (way === 'blob') cache?.delete?.(path); // o arquivo baixado não toca neste aparelho: não deve ocupar a memória à toa
        current.release();
        current = fresh; way = next; opened.url = fresh.url;
        return true;
      },
      // A tela tocou por este caminho: os próximos vídeos começam por ele (e só se isso mudou algo é que se grava).
      confirm() {
        if ((way === 'direct') === preferDirect) return;
        preferDirect = way === 'direct';
        try { remember?.set(preferDirect ? 'direct' : 'blob'); } catch { /* sem armazenamento: vale até a página recarregar */ }
      }
    };
    return opened;
  }

  return {
    async open(item, { signal } = {}) {
      const path = mediaPath(item.url);
      return directLink && item.kind === 'video' ? openVideo(item, path, signal) : openBlob(item, path, signal);
    },
    forget: () => cache?.clear()
  };
}

// Fonte de arquivos do painel: o navegador já está autenticado, então basta o endereço do servidor.
export function createDirectSource() {
  return {
    async open(item) { return { url: mediaPath(item.url), release() {} }; },
    forget() {}
  };
}
