// Pré-visualização da playlist no painel, antes de publicar. Roda o MESMO motor de reprodução da TV (ordem, tempo de cada conteúdo,
// vídeo até o fim ou com limite, transições, repetição e recuperação de falhas) com os arquivos reais do servidor.
//
// O que ela NÃO prova: o desempenho e os formatos aceitos por uma TV específica. Um arquivo que abre aqui pode não abrir numa TV
// antiga, e os efeitos podem ser simplificados lá. Por isso o aviso fixo no fim da janela.
import { h, mount } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openModal } from '../../ui/dialogs.js';
import { button, emptyState, notice } from '../../ui/components.js';
import { EFFECT_LABELS, simplifiedReasonText } from '../../playback/effects.js';
import { skipReasonText } from '../../playback/messages.js';
import { normalizeItems } from '../../playback/model.js';
import { plural } from '../../lib/format.js';
import { isPlayable, timingText, toPlaybackItems } from '../../lib/playlist-model.js';
import { createStageHost } from './stage-host.js';

const PROGRESS_EVERY_MS = 250;

// `items`: conteúdos no formato do editor (rascunho) ou de uma versão publicada. `loop`: a repetição da playlist.
// `env` existe para os testes (relógio, quadros e fonte de arquivos de mentira).
export function openPreview(ctx, { items, loop = true, title = 'Pré-visualização da playlist', subtitle = 'Sequência, tempo e efeitos do rascunho atual, neste computador.' } = {}, env = {}) {
  const playable = items.filter(isPlayable);
  const list = normalizeItems(toPlaybackItems(items));

  if (!list.length) {
    const empty = openModal({
      title, subtitle, size: 'normal',
      body: [emptyState({ iconName: 'list', title: 'Nenhum conteúdo para exibir', text: 'Adicione à playlist ao menos um conteúdo que não esteja rejeitado nem excluído.' })],
      footer: [button('Fechar', { primary: true, onClick: () => empty.close() })]
    });
    return empty.closed;
  }

  const skipped = new Map();   // posição → motivo (conteúdos que o motor não conseguiu exibir)
  let host = null, closed = false, lastRatio = 0, progressTimer = null, toggleText = '';

  const hint = h('p.preview-hint', { aria: { hidden: 'true' } }, 'Preparando a exibição…'); // o texto de verdade é lido em "label"
  const stage = h('div.preview-stage', { role: 'group', aria: { label: 'Pré-visualização do conteúdo em exibição' } }, hint);
  const fill = h('span');
  const bar = h('div.preview-progress', { aria: { hidden: 'true' } }, fill);
  const label = h('p.preview-label', { role: 'status' });
  const effectLine = h('p.preview-note');
  const problems = h('div.preview-problems');

  const stepButtons = list.map((item, position) => h('button.preview-step', {
    type: 'button', title: `${item.title} · ${timingText(playable[position])}`, on: { click: () => host.carousel.goTo(position) }
  }, h('span.preview-step-num', { aria: { hidden: 'true' } }, String(position + 1)), h('span.preview-step-title', item.title), h('small', timingText(playable[position]))));
  const steps = h('ol.preview-steps', { aria: { label: 'Conteúdos da playlist, na ordem de exibição' } }, stepButtons.map(step => h('li', step)));

  const previous = button('Anterior', { icon: 'skip-prev', onClick: () => host.carousel.previous() });
  const toggle = button('Pausar', { icon: 'pause', onClick: () => host.carousel.toggle() });
  const next = button('Próximo', { icon: 'skip-next', onClick: () => host.carousel.next() });
  const audioNotice = h('p.preview-note', { role: 'status', hidden: true });
  const audioToggle = button('Silenciar', { onClick: () => {
    if (!host) return;
    const state = host.audioState();
    if (!state.muted && !state.blocked) host.setMuted(true);
    else host.activateAudio().catch(() => { audioNotice.textContent = 'Não foi possível ativar o áudio. Confira as permissões do navegador.'; audioNotice.hidden = false; });
  } });
  audioToggle.hidden = !list.some(item => item.kind === 'video');
  function refreshAudio(state) {
    if (closed) return;
    audioToggle.textContent = state.blocked ? 'Ativar áudio' : state.muted ? 'Ativar som' : 'Silenciar';
    audioToggle.setAttribute('aria-label', audioToggle.textContent);
    audioNotice.textContent = state.blocked ? 'O navegador bloqueou o som. Use Ativar áudio para permitir a reprodução com som.' : '';
    audioNotice.hidden = !state.blocked;
  }

  // ---- avisos fixos (dependem só do conteúdo da playlist) ----------------------------------------------------------------------
  const notes = [];
  if (list.some(item => item.kind === 'video')) notes.push('Os vídeos tentam iniciar com som. Ajuste o volume no dispositivo ou use Silenciar. Se o navegador bloquear o áudio, use Ativar áudio.');
  if (list.some(item => item.kind === 'pdf')) notes.push('PDF: aparece no visualizador do navegador (na TV, no do aparelho) e o tempo definido vale para o documento inteiro. A troca automática de páginas ainda não existe.');
  const waiting = playable.filter(item => item.readiness !== 'ready').length;
  if (waiting) notes.push(`${plural(waiting, 'conteúdo ainda não está liberado', 'conteúdos ainda não estão liberados')}: aparece${waiting === 1 ? '' : 'm'} aqui, mas só ${waiting === 1 ? 'vai' : 'vão'} ao ar depois de aprovado${waiting === 1 ? '' : 's'}.`);
  const left = items.length - playable.length;
  if (left) notes.push(`${plural(left, 'conteúdo rejeitado ou excluído ficou', 'conteúdos rejeitados ou excluídos ficaram')} de fora.`);
  if (!loop) notes.push('A repetição está desligada: ao terminar o último conteúdo, a exibição para nele, como na TV.');
  notes.push('A exibição real depende do aparelho. Teste sempre em uma TV antes de divulgar.');

  // ---- o que a tela mostra ------------------------------------------------------------------------------------------------------
  function effectNote(shot) {
    if (!shot.item || !shot.effect || shot.effect.requested === 'cut') return '';
    const { effect, item } = shot;
    const wanted = `${EFFECT_LABELS[effect.requested]} (${item.transitionMs} ms)`;
    if (!effect.simplified) return `Entrada deste conteúdo: ${wanted}.`;
    return `Entrada deste conteúdo: ${wanted}, exibida como ${EFFECT_LABELS[effect.name]}: ${simplifiedReasonText(effect.reason)}.`;
  }

  function drawProblems() {
    if (!skipped.size) { mount(problems); return; }
    const lines = [...skipped].sort((a, b) => a[0] - b[0]).map(([position, reason]) => h('li', `${position + 1}. ${list[position].title}: ${skipReasonText(reason, 'neste navegador')}.`));
    mount(problems, notice([h('b', 'Estes conteúdos não puderam ser exibidos e foram pulados:'), h('ul', lines)], { tone: 'warn', iconName: 'alert' }));
  }

  function refresh() {
    if (closed || !host) return;
    const shot = host.carousel.snapshot();
    const finished = shot.state === 'finished';
    const active = shot.state === 'running' || finished;
    if (shot.index >= 0 && shot.item) label.textContent = `${shot.index + 1} de ${list.length} · ${shot.item.title} · ${timingText(playable[shot.index])}${finished ? ' · sequência concluída' : ''}`;
    else label.textContent = shot.state === 'unavailable' ? 'Nenhum conteúdo pôde ser exibido.' : 'Preparando a exibição…';
    effectLine.textContent = effectNote(shot);
    effectLine.hidden = !effectLine.textContent;

    const text = finished ? 'Reiniciar' : shot.playing ? 'Pausar' : 'Reproduzir';
    if (text !== toggleText) {
      toggleText = text;
      mount(toggle, icon(finished ? 'refresh' : shot.playing ? 'pause' : 'play'), text);
    }
    toggle.disabled = !active;
    previous.disabled = next.disabled = !active || list.length < 2;
    stepButtons.forEach((step, position) => {
      if (shot.index === position) step.setAttribute('aria-current', 'true'); else step.removeAttribute('aria-current');
      step.classList.toggle('current', shot.index === position);
    });
  }

  // Barra de progresso do conteúdo atual: só transform, atualizada 4 vezes por segundo enquanto exibe.
  function tick() {
    progressTimer = null;
    if (closed) return;
    const shot = host.carousel.snapshot();
    const ratio = shot.state === 'finished' ? 1 : shot.state === 'running' && Number.isFinite(shot.progress) ? Math.max(0, Math.min(1, shot.progress)) : 0;
    fill.style.transition = ratio >= lastRatio ? '' : 'none'; // voltar ao início não "rebobina" a barra
    fill.style.transform = `scaleX(${ratio.toFixed(3)})`;
    lastRatio = ratio;
    if (shot.state === 'running' && shot.playing) progressTimer = host.clock.setTimeout(tick, PROGRESS_EVERY_MS);
  }
  const startProgress = () => { if (progressTimer === null && !closed) tick(); };

  function handle(event) {
    if (closed) return;
    switch (event.type) {
      case 'change':
        skipped.delete(event.index);
        hint.hidden = true;
        drawProblems();
        startProgress();
        break;
      case 'state':
        startProgress();
        break;
      case 'skip':
        if (event.reason === 'transition-failed') break; // o conteúdo aparece mesmo assim (em corte seco)
        skipped.set(event.index, event.reason);
        drawProblems();
        break;
      case 'unavailable':
        hint.textContent = 'Nenhum conteúdo pôde ser exibido. Tentando de novo em alguns segundos.';
        hint.hidden = false;
        break;
      case 'recovered':
        hint.hidden = true;
        break;
      case 'autoplay-blocked':
        audioNotice.textContent = 'O navegador bloqueou a reprodução. Use Reproduzir para iniciar.';
        audioNotice.hidden = false;
        break;
      default:
        break;
    }
    refresh();
  }

  const close = button('Fechar', { primary: true, onClick: () => dialog.close() });
  const dialog = openModal({
    title, subtitle, size: 'large',
    body: [
      stage, bar, label, effectLine, audioNotice, problems,
      h('p.field-label.mt', 'Sequência'), steps,
      notice(h('ul.preview-notes', notes.map(text => h('li', text))), { tone: 'info', className: 'mt' })
    ],
    footer: [previous, toggle, next, audioToggle, close]
  });
  // Os botões de controle ainda não estão liberados quando a janela abre (e o primeiro deles perderia o foco ao ser desabilitado):
  // o foco começa em "Fechar", que está sempre disponível, e daí o teclado alcança os controles com Tab.
  close.focus();

  host = createStageHost({ root: stage, onEvent: handle, onAudioState: refreshAudio, env });
  dialog.closed.then(() => {
    closed = true;
    if (progressTimer !== null) host.clock.clearTimeout(progressTimer);
    progressTimer = null;
    host.destroy();
  });
  host.carousel.load(list, { loop });
  refresh();
  return dialog.closed;
}
