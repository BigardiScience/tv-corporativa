// Liga o motor de reprodução (o MESMO da TV) a uma área da tela do painel. É o que faz a pré-visualização da playlist e a demonstração
// dos efeitos mostrarem exatamente o que o player faz: mesma ordem, mesmos tempos, mesmas transições e mesma recuperação de falhas.
//
// Diferenças em relação à TV, todas de propósito: os arquivos vêm direto do servidor (o painel já está autenticado), nada é guardado
// no navegador (nem a posição da exibição nem o nível de efeitos) e o nível de efeitos fica sempre completo, porque quem confere a
// playlist está num computador. A preferência do sistema por menos movimento continua valendo.
import { createCarousel, systemClock } from '../../playback/carousel.js';
import { createStage, detectCapabilities } from '../../playback/stage.js';
import { createDirectSource } from '../../playback/loader.js';

// `env` existe para os testes (relógio, quadros e fonte de arquivos de mentira); no navegador valem os padrões.
export function createStageHost({ root, onEvent = () => {}, onAudioState = () => {}, env = {} } = {}) {
  const clock = env.clock ?? systemClock();
  const source = env.source ?? createDirectSource();
  const renderer = createStage({ root, source, onAudioState, doc: env.doc ?? globalThis.document, timers: clock, raf: env.raf, cancelRaf: env.cancelRaf });
  const carousel = createCarousel({
    renderer, clock, wallClock: env.wall ?? (() => Date.now()), tiers: null, capability: detectCapabilities(env.win ?? globalThis), storage: null, onEvent
  });
  let closed = false;
  return {
    carousel, clock,
    audioState: () => renderer.audioState(),
    setMuted: value => renderer.setMuted(value),
    activateAudio: () => renderer.activateAudio(),
    stats: () => renderer.stats(),
    // Solta tudo (camadas, vídeos, arquivos abertos, prazos). Pode ser chamado mais de uma vez.
    destroy() {
      if (closed) return;
      closed = true;
      carousel.destroy();
      renderer.clear();
      source.forget?.();
    }
  };
}
