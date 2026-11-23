// Transições entre conteúdos: o que cada efeito faz, como ele é simplificado quando o aparelho ou a pessoa pedem menos movimento,
// e como o desempenho real de um aparelho decide se ele consegue ou não executar o efeito. Tudo aqui é dado e regra pura;
// a execução com animações do navegador fica em stage.js.
//
// Todos os efeitos usam só opacidade, deslocamento e escala, que o navegador anima na placa de vídeo, com uma exceção: Dissolver
// também usa desfoque, mais pesado. A camada que entra sempre fica POR CIMA da que sai, e a que sai permanece opaca até o fim:
// nunca existe um quadro em que as duas estejam transparentes ao mesmo tempo (tela preta entre conteúdos).

export const TIERS = Object.freeze(['full', 'reduced', 'minimal']);

const SMOOTH = 'cubic-bezier(0.4, 0, 0.2, 1)';
const PUSH = 'cubic-bezier(0.65, 0, 0.35, 1)';

// `enter`: animação da camada que entra. `exit`: animação da camada que sai (opcional).
export const EFFECTS = Object.freeze({
  cut: null,
  fade: Object.freeze({
    enter: Object.freeze({ keyframes: Object.freeze([{ opacity: 0 }, { opacity: 1 }]), easing: SMOOTH })
  }),
  dissolve: Object.freeze({
    enter: Object.freeze({ keyframes: Object.freeze([{ opacity: 0, filter: 'blur(28px)' }, { opacity: 1, filter: 'blur(0px)' }]), easing: 'ease-out' })
  }),
  slide: Object.freeze({
    enter: Object.freeze({ keyframes: Object.freeze([{ transform: 'translateX(100%)' }, { transform: 'translateX(0%)' }]), easing: PUSH }),
    exit: Object.freeze({ keyframes: Object.freeze([{ transform: 'translateX(0%)' }, { transform: 'translateX(-100%)' }]), easing: PUSH })
  }),
  zoom: Object.freeze({
    enter: Object.freeze({ keyframes: Object.freeze([{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'scale(1)' }]), easing: 'cubic-bezier(0.16, 0.84, 0.3, 1)' }),
    exit: Object.freeze({ keyframes: Object.freeze([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }]), easing: 'ease-in' })
  })
});

export const EFFECT_LABELS = Object.freeze({ cut: 'Corte seco', fade: 'Esmaecer', dissolve: 'Dissolver', slide: 'Deslizar', zoom: 'Zoom' });
export const EFFECT_HELP = Object.freeze({
  cut: 'Troca na hora, sem efeito. É a opção mais leve e funciona em qualquer TV.',
  fade: 'O novo conteúdo aparece aos poucos sobre o anterior.',
  dissolve: 'O novo conteúdo surge desfocado e entra em foco enquanto aparece. Pede mais da TV.',
  slide: 'O novo conteúdo entra pela direita empurrando o anterior para a esquerda.',
  zoom: 'O novo conteúdo cresce até ocupar a tela enquanto aparece. O anterior se afasta um pouco.'
});

const REASON_TEXT = Object.freeze({
  'reduced-motion': 'movimento reduzido ativo',
  'device-limited': 'aparelho com desempenho limitado',
  'device-slow': 'aparelho sem desempenho para animações',
  'no-animation-api': 'este navegador não anima transições'
});
export const simplifiedReasonText = reason => REASON_TEXT[reason] ?? '';

// Decide qual efeito acontece de verdade. `requested`/`ms` vêm da playlist.
//   sem suporte a animação ........................ corte seco
//   aparelho no nível "minimal" ................... corte seco
//   pessoa pediu menos movimento .................. só esmaecer (sem deslizar, ampliar nem desfocar)
//   aparelho no nível "reduced" ................... só esmaecer
//   caso contrário ................................ o efeito pedido
export function resolveEffect({ requested = 'cut', ms = 0, tier = 'full', reducedMotion = false, animations = true } = {}) {
  const name = Object.prototype.hasOwnProperty.call(EFFECTS, requested) ? requested : 'cut';
  const duration = Math.max(0, Math.round(Number(ms) || 0));
  if (name === 'cut' || duration === 0) return { name: 'cut', ms: 0, requested: name, simplified: false, reason: '' };
  const cut = reason => ({ name: 'cut', ms: 0, requested: name, simplified: true, reason });
  if (!animations) return cut('no-animation-api');
  if (tier === 'minimal') return cut('device-slow');
  const fade = reason => ({ name: 'fade', ms: duration, requested: name, simplified: name !== 'fade', reason: name === 'fade' ? '' : reason });
  if (reducedMotion) return fade('reduced-motion');
  if (tier === 'reduced') return fade('device-limited');
  return { name, ms: duration, requested: name, simplified: false, reason: '' };
}

export const lowerTier = tier => TIERS[Math.min(TIERS.length - 1, Math.max(0, TIERS.indexOf(tier)) + 1)];

// ---- desempenho --------------------------------------------------------------------------------------------------------------
// Durante uma transição o navegador mede o intervalo entre quadros. Abaixo de ~22 quadros por segundo no meio da amostra, ou com
// um quarto dos quadros acima de 80 ms, a TV não está dando conta do efeito.
export const FRAME_RULES = Object.freeze({ minFrames: 8, slowMedianMs: 45, stutterMs: 80, stutterRatio: 0.25 });

export function judgeFrames(intervalsMs, rules = FRAME_RULES) {
  const values = intervalsMs.filter(value => Number.isFinite(value) && value > 0);
  if (values.length < rules.minFrames) return { enough: false, slow: false, count: values.length, medianMs: 0, stutterRatio: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const medianMs = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const stutterRatio = values.filter(value => value > rules.stutterMs).length / values.length;
  return { enough: true, slow: medianMs > rules.slowMedianMs || stutterRatio >= rules.stutterRatio, count: values.length, medianMs: Math.round(medianMs * 10) / 10, stutterRatio: Math.round(stutterRatio * 100) / 100 };
}

const TIER_KEY = 'tv-corporativa.playback-tier.v1';
export const TIER_TTL_MS = 7 * 24 * 3600 * 1000;

// Guarda o nível de efeitos que o aparelho aguenta. Duas transições lentas seguidas descem um nível; uma transição boa zera a contagem.
// O nível aprendido é lembrado por 7 dias (a TV não volta a tropeçar toda vez que liga) e depois é testado de novo.
// `storage` é opcional ({ get, set, remove }) e `now` devolve a hora em milissegundos.
export function createTierKeeper({ storage = null, now = () => Date.now(), key = TIER_KEY, slowLimit = 2 } = {}) {
  let tier = 'full', slowStreak = 0;
  try {
    const saved = JSON.parse(storage?.get(key) ?? 'null');
    if (saved && TIERS.includes(saved.tier) && Number.isFinite(saved.at) && now() - saved.at >= 0 && now() - saved.at < TIER_TTL_MS) tier = saved.tier;
  } catch { /* memória indisponível ou texto inválido: começa no nível completo */ }
  const persist = () => { try { storage?.set(key, JSON.stringify({ tier, at: now() })); } catch { /* sem armazenamento: vale só nesta exibição */ } };
  return {
    tier: () => tier,
    // Devolve o novo nível quando ele muda, senão null.
    report(verdict) {
      if (!verdict?.enough) return null;
      if (!verdict.slow) { slowStreak = 0; return null; }
      slowStreak++;
      if (slowStreak < slowLimit || tier === 'minimal') return null;
      slowStreak = 0;
      tier = lowerTier(tier);
      persist();
      return tier;
    },
    reset() { tier = 'full'; slowStreak = 0; try { storage?.remove(key); } catch { /* ignorado */ } }
  };
}
