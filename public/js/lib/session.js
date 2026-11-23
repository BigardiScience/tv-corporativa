// Estado da sessão no navegador.
//
// `epoch` aumenta a cada entrada, saída ou expiração. Toda operação assíncrona guarda o valor que viu ao começar e, quando a
// resposta chega, confere `alive(epoch)`: se a pessoa saiu (ou outra entrou) no meio do caminho, a resposta é descartada e
// NUNCA volta a aparecer na tela. É o que impede dados de uma sessão encerrada de reaparecerem.

const emptyState = () => ({
  user: null, csrf: '', catalog: null, units: [], sectors: [], limits: {}, mode: 'local', scannerConfigured: false, version: '', space: null
});

export function createSession() {
  let state = emptyState();
  let epoch = 0;
  const listeners = new Set();
  const notify = () => { for (const listener of [...listeners]) listener(state, epoch); };

  return {
    get state() { return state; },
    get epoch() { return epoch; },
    get user() { return state.user; },
    get active() { return !!state.user; },
    start({ user, csrf }) { epoch++; state = { ...emptyState(), user, csrf }; notify(); return epoch; },
    // Dados carregados depois da entrada (unidades, setores, limites, catálogo de permissões). Só vale para a sessão que os pediu.
    fill(forEpoch, patch) {
      if (forEpoch !== epoch || !state.user) return false;
      state = { ...state, ...patch };
      notify();
      return true;
    },
    setSpace(space) { if (state.user) { state = { ...state, space }; notify(); } },
    setUser(user) { if (state.user) { state = { ...state, user }; notify(); } },
    end() { epoch++; state = emptyState(); notify(); },
    alive(forEpoch) { return forEpoch === epoch && !!state.user; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
