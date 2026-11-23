// Demonstração dos efeitos de transição: dois conteúdos de exemplo se alternam com o efeito escolhido, passando pelo MESMO motor da TV.
// Serve para a pessoa ver (e comparar) cada efeito antes de aplicá-lo a um conteúdo da playlist. Os efeitos são independentes entre si:
// cada um é escolhido, e tem a duração ajustada, sem depender dos outros.
//
// Devolve (pela promessa) { effect, ms } se a pessoa escolher "Usar este efeito", ou undefined se apenas fechar.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { button } from '../../ui/components.js';
import { EFFECT_HELP, EFFECT_LABELS, simplifiedReasonText } from '../../playback/effects.js';
import { DEFAULT_TRANSITION_MS, MAX_TRANSITION_MS, TRANSITION_NAMES, normalizeItems } from '../../playback/model.js';
import { clampTransitionMs } from '../../lib/playlist-model.js';
import { selectBox } from '../shared.js';
import { createStageHost } from './stage-host.js';

const SLIDES = Object.freeze([
  { id: 'demo-a', title: 'Conteúdo A', letter: 'A', tone: 'fx-a' },
  { id: 'demo-b', title: 'Conteúdo B', letter: 'B', tone: 'fx-b' }
]);

const slideNode = slide => () => h('div.fx-slide', { class: slide.tone }, h('span.fx-letter', slide.letter), h('span.fx-caption', slide.title));

// Cada conteúdo fica um pouco mais que a própria transição, para o efeito terminar e a tela repousar antes da próxima troca.
export function demoItems(effect, ms) {
  const hold = Math.max(1600, ms + 1200);
  return normalizeItems(SLIDES.map(slide => ({
    id: slide.id, title: slide.title, type: 'application/x-tvcorp-html', durationMs: hold, transition: effect, transitionMs: ms, render: slideNode(slide)
  })));
}

// `canApply`: mostra o botão "Usar este efeito" (quem só consulta a playlist não altera nada).
export function openEffectDemo(ctx, { effect = 'fade', ms = DEFAULT_TRANSITION_MS, canApply = false } = {}, env = {}) {
  let host = null, closed = false;
  let chosen = TRANSITION_NAMES.includes(effect) ? effect : 'fade';
  let duration = chosen === 'cut' ? 0 : clampTransitionMs(ms) || DEFAULT_TRANSITION_MS;

  const help = h('p.fx-help', EFFECT_HELP[chosen]);
  const status = h('p.preview-label', { role: 'status' });
  const note = h('p.preview-note', { hidden: true });
  const hint = h('p.preview-hint', { aria: { hidden: 'true' } }, 'Preparando a demonstração…');
  const stage = h('div.preview-stage', { role: 'group', aria: { label: 'Demonstração do efeito' } }, hint);

  const msInput = h('input#demo-ms', {
    type: 'number', min: '0', max: String(MAX_TRANSITION_MS), step: '50', inputmode: 'numeric', value: String(duration || DEFAULT_TRANSITION_MS),
    aria: { label: 'Duração do efeito (ms)' }
  });
  const msField = h('label.pl-field', { for: 'demo-ms', hidden: chosen === 'cut' }, h('span', 'Duração do efeito (ms)'), msInput);
  const select = selectBox({
    id: 'demo-effect', label: 'Efeito de transição', value: chosen, options: TRANSITION_NAMES.map(name => [name, EFFECT_LABELS[name]]),
    onChange: value => {
      chosen = value;
      duration = value === 'cut' ? 0 : (duration || DEFAULT_TRANSITION_MS);
      msInput.value = String(duration || DEFAULT_TRANSITION_MS);
      msField.hidden = value === 'cut';
      restart();
    }
  });
  msInput.addEventListener('change', () => {
    if (msInput.value.trim() === '') { msInput.value = String(duration || DEFAULT_TRANSITION_MS); return; }
    duration = clampTransitionMs(msInput.value);
    msInput.value = String(duration);
    restart();
  });

  const again = button('Ver de novo', { icon: 'refresh', onClick: () => restart() });
  const toggle = button('Pausar', { icon: 'pause', onClick: () => host.carousel.toggle() });
  const apply = canApply ? button('Usar este efeito', { primary: true, icon: 'check', onClick: () => dialog.close({ effect: chosen, ms: chosen === 'cut' ? 0 : duration }) }) : null;

  function describe() {
    help.textContent = EFFECT_HELP[chosen];
    status.textContent = chosen === 'cut' ? `Efeito: ${EFFECT_LABELS.cut}.` : `Efeito: ${EFFECT_LABELS[chosen]} · ${duration} ms.`;
  }

  function refresh() {
    if (closed || !host) return;
    const shot = host.carousel.snapshot();
    const text = shot.playing ? 'Pausar' : 'Reproduzir';
    if (toggle.textContent !== text) mount(toggle, icon(shot.playing ? 'pause' : 'play'), text);
  }

  function handle(event) {
    if (closed) return;
    if (event.type === 'change') {
      hint.hidden = true;
      // Só a partir da segunda troca existe efeito (o primeiro conteúdo sempre entra em corte seco).
      if (event.effect?.requested && event.effect.requested !== 'cut') {
        note.textContent = event.effect.simplified
          ? `Efeito simplificado: ${simplifiedReasonText(event.effect.reason)}. Aparece como ${EFFECT_LABELS[event.effect.name]}.`
          : '';
        note.hidden = !note.textContent;
      }
    }
    refresh();
  }

  // Recomeça a demonstração com o efeito e a duração atuais (também retoma, se estava pausada).
  function restart() {
    if (closed || !host) return;
    note.textContent = '';
    note.hidden = true;
    describe();
    host.carousel.stop();
    if (!host.carousel.snapshot().playing) host.carousel.play();
    host.carousel.load(demoItems(chosen, duration), { loop: true });
    refresh();
  }

  const dialog = openModal({
    title: 'Ver efeito de transição', subtitle: 'Dois conteúdos de exemplo se alternam, como na TV.', size: 'normal',
    body: [
      h('div.pl-controls', h('label.pl-field', { for: 'demo-effect' }, h('span', 'Efeito'), select), msField),
      help, stage, status, note
    ],
    footer: [again, toggle, apply, button('Fechar', { primary: !canApply, onClick: () => dialog.close() })]
  });

  host = createStageHost({ root: stage, onEvent: handle, env });
  dialog.closed.then(() => { closed = true; host.destroy(); });
  describe();
  host.carousel.load(demoItems(chosen, duration), { loop: true });
  refresh();
  return dialog.closed;
}
