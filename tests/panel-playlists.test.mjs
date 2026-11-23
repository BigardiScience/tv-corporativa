// Telas de playlist da Fase 2 no painel, testadas no Node com DOM, navegador e relógio de mentira (tests/helpers/panel-kit.mjs):
// a linha de cada conteúdo (modo de duração do vídeo, transição, "Ver efeito"), a pré-visualização e a demonstração de efeitos.
// As duas últimas passam pelo MESMO motor da TV; aqui se confere a tela em volta dele. O desenho de verdade, o foco e os codecs
// ficam para os testes no Chromium (tests/e2e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeEvent } from './helpers/fake-dom.mjs';
import { createPanelKit } from './helpers/panel-kit.mjs';
import { DURATION_MODE_HELP, LOOP_HELP } from '../public/js/lib/playlist-model.js';
import { EFFECT_HELP } from '../public/js/playback/effects.js';
import { focusItemAction, renderItems } from '../public/js/views/playlists/items.js';
import { openPreview } from '../public/js/views/playlists/preview.js';
import { openPublishDialog } from '../public/js/views/playlists/publish.js';
import { previewVersion, viewVersion } from '../public/js/views/playlists/versions.js';
import { formatDateTime } from '../public/js/lib/format.js';
import { hideToast } from '../public/js/ui/toast.js';
import { closeAllDialogs } from '../public/js/ui/dialogs.js';
import { demoItems, openEffectDemo } from '../public/js/views/playlists/effect-demo.js';

const withKit = (options, run) => async () => {
  const kit = createPanelKit(options);
  try { await run(kit); } finally {
    // Se uma conferência falhar com janelas abertas, elas se fecham aqui e soltam seus prazos; senão o processo ficaria esperando por eles.
    closeAllDialogs();
    await kit.clock.advance(0);
    kit.release();
  }
};

// Conteúdo como o editor o guarda no rascunho.
const media = (id, extra = {}) => ({ id, title: `Conteúdo ${id.toUpperCase()}`, name: `${id}.png`, type: 'image/png', url: `/api/media/${id}/file`, ...extra });
const item = (key, mediaExtra = {}, extra = {}) => {
  const id = mediaExtra.id ?? 'a';
  return { key, mediaId: id, durationS: 15, durationMode: 'fixed', transition: 'cut', transitionMs: 0, readiness: 'ready', media: media(id, mediaExtra), ...extra };
};
const video = (key, id = 'v', extra = {}, mediaExtra = {}) => item(key, { id, title: 'Clipe', name: 'clipe.mp4', type: 'video/mp4', ...mediaExtra }, extra);
const pdf = (key, id = 'p') => item(key, { id, title: 'Cartaz', name: 'cartaz.pdf', type: 'application/pdf' });

const handlersLog = () => {
  const calls = [];
  return { calls, handlers: { edit: () => calls.push('edit'), move: (...args) => calls.push(['move', ...args]), remove: index => calls.push(['remove', index]), demo: index => calls.push(['demo', index]) } };
};

// ---- linha de cada conteúdo ----------------------------------------------------------------------------------------------------------

test('linha de imagem: duração, transição, efeito e "Ver efeito" têm nome acessível, e o efeito só aparece quando existe', withKit({}, async kit => {
  const { calls, handlers } = handlersLog();
  const row = item('item-1', { id: 'a', title: 'Aviso' });
  const list = renderItems({}, { items: [row], editable: true, handlers });
  kit.document.body.appendChild(list);
  const q = selector => list.querySelector(selector);

  assert.equal(q('#dm-item-1'), null, 'imagem não escolhe entre limite e duração natural');
  assert.equal(kit.nameOf(q('#dur-item-1')), 'Duração (s) de “Aviso”');
  assert.equal(kit.textOf(q('label[for="dur-item-1"] span')), 'Duração (s)', 'o texto visível está contido no nome acessível');
  assert.equal(kit.nameOf(q('#tr-item-1')), 'Transição de “Aviso”');
  assert.equal(q('label[for="ms-item-1"]').hidden, true, 'corte seco não tem duração de efeito');
  assert.match(kit.textOf(q('.pl-meta')), /^Imagem · exibe por 15 s/);
  assert.equal(kit.textOf(q('#eh-item-1')), EFFECT_HELP.cut);
  assert.equal(q('#tr-item-1').getAttribute('aria-describedby'), 'eh-item-1');
  assert.equal(kit.button(list, 'Ver efeito').getAttribute('aria-label'), 'Ver efeito de “Aviso”');

  kit.change(q('#tr-item-1'), 'slide');
  assert.deepEqual([row.transition, row.transitionMs], ['slide', 600], 'efeito novo começa com 600 ms');
  assert.equal(q('label[for="ms-item-1"]').hidden, false);
  assert.equal(q('#ms-item-1').value, '600');
  assert.equal(kit.textOf(q('#eh-item-1')), EFFECT_HELP.slide, 'a explicação acompanha o efeito escolhido');

  kit.change(q('#ms-item-1'), '99999');
  assert.equal(row.transitionMs, 3000, 'acima do limite vira o máximo');
  assert.equal(q('#ms-item-1').value, '3000');

  kit.change(q('#tr-item-1'), 'cut');
  assert.deepEqual([row.transition, row.transitionMs], ['cut', 0]);
  assert.equal(q('label[for="ms-item-1"]').hidden, true);

  kit.change(q('#dur-item-1'), '2');
  assert.equal(row.durationS, 5, 'abaixo do mínimo vira 5 s');
  assert.equal(q('#dur-item-1').value, '5');
  assert.match(kit.textOf(q('.pl-meta')), /exibe por 5 s/, 'o resumo da linha acompanha a edição');

  kit.button(list, 'Ver efeito').click();
  assert.deepEqual(calls.filter(call => Array.isArray(call)), [['demo', 0]]);
  assert.ok(calls.includes('edit'));
}));

test('linha de vídeo: escolher entre tempo definido (limite) e até o fim muda o que o campo de segundos significa', withKit({}, async kit => {
  const { calls, handlers } = handlersLog();
  const row = video('item-1', 'v', { durationS: 20 });
  const list = renderItems({}, { items: [row], editable: true, handlers });
  kit.document.body.appendChild(list);
  const q = selector => list.querySelector(selector);

  const mode = q('#dm-item-1');
  assert.deepEqual(mode.querySelectorAll('option').map(option => [option.value ?? option.getAttribute('value'), kit.textOf(option)]),
    [['fixed', 'Tempo definido (limite)'], ['natural', 'Até o fim do vídeo']]);
  assert.equal(mode.value, 'fixed');
  assert.equal(kit.nameOf(mode), 'Tempo do vídeo “Clipe”');
  assert.equal(kit.textOf(q('label[for="dm-item-1"] span')), 'Tempo do vídeo');
  assert.equal(kit.nameOf(q('#dur-item-1')), 'Limite (s) do vídeo “Clipe”');
  assert.match(kit.textOf(q('.pl-meta')), /^Vídeo · toca por até 20 s/);
  assert.equal(kit.textOf(q('#dh-item-1')), DURATION_MODE_HELP.fixed);
  assert.equal(mode.getAttribute('aria-describedby'), 'dh-item-1');

  kit.change(mode, 'natural');
  assert.equal(row.durationMode, 'natural');
  assert.equal(kit.nameOf(q('#dur-item-1')), 'Reserva (s) do vídeo “Clipe”');
  assert.equal(kit.textOf(q('label[for="dur-item-1"] span')), 'Reserva (s)');
  assert.equal(q('#dur-item-1').value, '20', 'o valor digitado fica; só o papel do campo muda');
  assert.match(kit.textOf(q('.pl-meta')), /toca até o fim do vídeo/);
  assert.equal(kit.textOf(q('#dh-item-1')), DURATION_MODE_HELP.natural);
  assert.ok(calls.includes('edit'), 'a tela avisa que o rascunho mudou');

  kit.change(mode, 'fixed');
  assert.equal(row.durationMode, 'fixed');
  assert.equal(kit.nameOf(q('#dur-item-1')), 'Limite (s) do vídeo “Clipe”');
}));

test('linha de PDF explica que o tempo vale para o documento inteiro; só consulta não altera nada, mas ainda vê os efeitos', withKit({}, async kit => {
  const { handlers } = handlersLog();
  const list = renderItems({}, { items: [pdf('item-1'), video('item-2', 'v')], editable: false, handlers });
  kit.document.body.appendChild(list);
  const q = selector => list.querySelector(selector);

  assert.match(kit.textOf(q('#dp-item-1')), /^PDF: o tempo vale para o documento inteiro/);
  assert.equal(q('#dur-item-1').getAttribute('aria-describedby'), 'dp-item-1');
  assert.equal(q('#dp-item-2'), null, 'só PDF tem esse aviso');
  for (const control of list.querySelectorAll('input, select')) assert.equal(control.disabled, true, `${control.id} deve estar desabilitado`);
  assert.equal(list.querySelectorAll('.pl-actions').length, 0, 'sem botões de mover e remover');
  assert.equal(list.querySelectorAll('.pl-handle').length, 0, 'sem alça de arrastar');
  const demo = list.querySelectorAll('button').filter(button => kit.textOf(button) === 'Ver efeito');
  assert.equal(demo.length, 2);
  assert.ok(demo.every(button => !button.disabled), 'quem só consulta também pode ver como cada efeito é');
}));

test('linhas: todo controle tem nome, os identificadores são únicos e a explicação de cada campo existe', withKit({}, async kit => {
  const { handlers } = handlersLog();
  const list = renderItems({}, { items: [item('item-1', { id: 'a' }), video('item-2', 'v'), pdf('item-3'), item('item-4', { id: 'a' })], editable: true, handlers });
  kit.document.body.appendChild(list);

  const ids = list.querySelectorAll('[id]').map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'identificadores repetidos entre linhas');
  for (const control of list.querySelectorAll('input, select, button')) assert.ok(kit.nameOf(control).length > 1, `controle sem nome acessível: ${control.outerHTML ?? control.localName}`);
  for (const control of list.querySelectorAll('[aria-describedby]')) {
    const target = list.querySelector(`#${control.getAttribute('aria-describedby')}`);
    assert.ok(target && kit.textOf(target).length > 10, `aria-describedby de ${control.id} aponta para o nada`);
  }
  // O mesmo arquivo duas vezes na playlist continua com campos independentes.
  assert.notEqual(list.querySelector('#dur-item-1'), list.querySelector('#dur-item-4'));
}));

test('depois de redesenhar a lista, o foco volta ao botão "Ver efeito" da linha que a pessoa usou', withKit({}, async kit => {
  const { handlers } = handlersLog();
  const list = renderItems({}, { items: [item('item-1', { id: 'a' }), item('item-2', { id: 'b' })], editable: true, handlers });
  kit.document.body.appendChild(list);
  focusItemAction(list, 'item-2', 'demo');
  assert.equal(kit.document.activeElement.dataset.action, 'demo');
  assert.equal(kit.document.activeElement.getAttribute('aria-label'), 'Ver efeito de “Conteúdo B”');
}));

// ---- pré-visualização ----------------------------------------------------------------------------------------------------------------

const label = dialog => dialog.querySelector('.preview-label').textContent;
const note = dialog => dialog.querySelector('.preview-note');
const noteText = dialog => (note(dialog).hidden ? '' : note(dialog).textContent);

test('pré-visualização: percorre a playlist pelo motor da TV, na ordem e no tempo de cada conteúdo, com efeito na entrada', withKit({}, async kit => {
  const items = [
    item('i1', { id: 'a', title: 'Aviso A' }, { durationS: 10 }),
    item('i2', { id: 'b', title: 'Aviso B' }, { durationS: 20, transition: 'slide', transitionMs: 500 }),
    item('i3', { id: 'c', title: 'Aviso C' }, { durationS: 8 })
  ];
  const closed = openPreview({}, { items, loop: true }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  assert.ok(dialog, 'a janela abriu');
  assert.equal(label(dialog), '1 de 3 · Aviso A · 10 s');
  assert.equal(kit.shown(dialog).length, 1, 'só o primeiro conteúdo está visível');
  assert.equal(noteText(dialog), '', 'o primeiro conteúdo entra sem efeito');
  assert.deepEqual(dialog.querySelectorAll('.preview-step').map(step => step.getAttribute('aria-current')), ['true', null, null]);
  assert.equal(dialog.querySelector('.preview-step.current .preview-step-title').textContent, 'Aviso A');

  await kit.clock.advance(9_999);
  assert.equal(label(dialog), '1 de 3 · Aviso A · 10 s', 'ainda não deu o tempo');
  await kit.clock.advance(1);
  assert.equal(label(dialog), '2 de 3 · Aviso B · 20 s');
  assert.equal(noteText(dialog), 'Entrada deste conteúdo: Deslizar (500 ms).');
  assert.equal(kit.media.animations.length, 2, 'o que entra e o que sai se movem juntos');
  assert.equal(kit.shown(dialog).length, 2, 'durante a transição os dois estão na tela');
  await kit.clock.advance(500);
  await kit.finishMotion();
  assert.equal(kit.shown(dialog).length, 1);

  // Botões e linha do tempo mandam no mesmo motor.
  kit.button(dialog, 'Próximo').click();
  await kit.clock.advance(0);
  assert.equal(label(dialog), '3 de 3 · Aviso C · 8 s');
  assert.equal(noteText(dialog), '', 'corte seco não anuncia efeito');
  kit.button(dialog, 'Anterior').click();
  await kit.clock.advance(0);
  assert.match(label(dialog), /^2 de 3 · Aviso B/);
  await kit.finishMotion();
  dialog.querySelectorAll('.preview-step')[0].click();
  await kit.clock.advance(0);
  assert.match(label(dialog), /^1 de 3 · Aviso A/);
  assert.equal(dialog.querySelector('.preview-step.current .preview-step-title').textContent, 'Aviso A');

  kit.button(dialog, 'Fechar').click();
  await closed;
  await kit.clock.advance(0);
  assert.equal(kit.layers(kit.document.body).length, 0, 'nenhuma camada sobrou');
  assert.equal(kit.media.source.opened.length, kit.media.source.released.length, 'todo arquivo aberto foi solto');
  assert.equal(kit.clock.pending(), 0, 'nenhum prazo ficou pendente');
  assert.equal(kit.media.running().length, 0);
}));

test('pré-visualização: pausar para onde está, retomar continua, e o botão mostra o que vai acontecer', withKit({}, async kit => {
  const items = [item('i1', { id: 'a', title: 'A' }, { durationS: 10 }), item('i2', { id: 'b', title: 'B' }, { durationS: 10 })];
  openPreview({}, { items }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  assert.ok(kit.button(dialog, 'Pausar'));
  await kit.clock.advance(4_000);
  kit.button(dialog, 'Pausar').click();
  assert.ok(kit.button(dialog, 'Reproduzir'), 'o botão passa a oferecer a retomada');
  await kit.clock.advance(60_000);
  assert.match(label(dialog), /^1 de 2/, 'pausado não avança, por mais que o tempo passe');
  kit.button(dialog, 'Reproduzir').click();
  await kit.clock.advance(5_999);
  assert.match(label(dialog), /^1 de 2/, 'faltavam 6 s do primeiro conteúdo');
  await kit.clock.advance(1);
  assert.match(label(dialog), /^2 de 2/);
  kit.button(dialog, 'Fechar').click();
}));

test('pré-visualização: vídeo até o fim espera o fim do vídeo; com limite, troca no limite', withKit({ scripts: { v: { duration: 7 }, w: { duration: 30 } } }, async kit => {
  const items = [
    video('i1', 'v', { durationS: 30, durationMode: 'natural' }),
    video('i2', 'w', { durationS: 12, durationMode: 'fixed' }),
    item('i3', { id: 'c', title: 'Imagem' }, { durationS: 9 })
  ];
  openPreview({}, { items }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  assert.equal(label(dialog), '1 de 3 · Clipe · até o fim do vídeo');
  assert.equal(dialog.querySelectorAll('.preview-step small')[1].textContent, 'até 12 s');
  await kit.clock.advance(6_900);
  assert.match(label(dialog), /^1 de 3/, 'o vídeo ainda não terminou');
  await kit.clock.advance(100);
  kit.shown(dialog)[0].querySelector('video').dispatchEvent(new FakeEvent('ended'));
  await kit.clock.advance(0);
  assert.match(label(dialog), /^2 de 3 · Clipe · até 12 s/, 'terminou o vídeo: segue já, sem esperar os 30 s');
  await kit.clock.advance(11_999);
  assert.match(label(dialog), /^2 de 3/, 'o segundo vídeo dura 30 s, mas o limite é 12 s');
  await kit.clock.advance(1);
  assert.match(label(dialog), /^3 de 3 · Imagem · 9 s/);
  kit.button(dialog, 'Fechar').click();
  assert.ok(dialog.querySelector('.preview-notes').textContent.includes('tentam iniciar com som'), 'o aviso explica áudio e bloqueio do navegador');
}));

test('pré-visualização: som por padrão, silêncio explícito persiste na troca e fechar interrompe o áudio', withKit({}, async kit => {
  openPreview({}, { items: [video('i1', 'v', { durationS: 5 }), video('i2', 'w', { durationS: 10 })] }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  const first = kit.shown(dialog)[0].querySelector('video');
  assert.equal(first.muted, false);
  assert.equal(first.volume, 1);
  kit.button(dialog, 'Silenciar').click();
  assert.equal(first.muted, true);
  await kit.clock.advance(5_000);
  const second = kit.shown(dialog)[0].querySelector('video');
  assert.equal(first.paused, true);
  assert.equal(second.muted, true);
  kit.button(dialog, 'Ativar som').click();
  await kit.clock.advance(0);
  assert.equal(second.muted, false);
  kit.button(dialog, 'Fechar').click();
  await kit.clock.advance(0);
  assert.equal(second.paused, true);
}));

test('pré-visualização sem repetição: ao terminar, fica no último conteúdo, avisa e oferece reiniciar', withKit({}, async kit => {
  const items = [item('i1', { id: 'a', title: 'A' }, { durationS: 5 }), item('i2', { id: 'b', title: 'B' }, { durationS: 5 })];
  openPreview({}, { items, loop: false }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  assert.ok(dialog.querySelector('.preview-notes').textContent.includes('A repetição está desligada'));
  await kit.clock.advance(5_000);
  assert.match(label(dialog), /^2 de 2 · B/);
  await kit.clock.advance(5_000);
  assert.equal(label(dialog), '2 de 2 · B · 5 s · sequência concluída');
  assert.equal(kit.shown(dialog).length, 1, 'o último conteúdo continua na tela');
  assert.equal(dialog.querySelector('.preview-progress span').style.transform, 'scaleX(1.000)');
  await kit.clock.advance(60_000);
  assert.match(label(dialog), /sequência concluída/, 'nada volta ao início sozinho');
  kit.button(dialog, 'Reiniciar').click();
  await kit.clock.advance(0);
  assert.equal(label(dialog), '1 de 2 · A · 5 s');
  assert.ok(kit.button(dialog, 'Pausar'));
  kit.button(dialog, 'Fechar').click();
}));

test('pré-visualização: o que não abre aparece numa lista com o motivo dito para o navegador, e a exibição segue', withKit({ scripts: { b: { decode: 'fail' } } }, async kit => {
  const items = [item('i1', { id: 'a', title: 'A' }, { durationS: 10 }), item('i2', { id: 'b', title: 'Quebrado' }, { durationS: 10 }), item('i3', { id: 'c', title: 'C' }, { durationS: 10 })];
  openPreview({}, { items }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  const problems = dialog.querySelector('.preview-problems');
  assert.equal(problems.textContent.includes('Quebrado'), true);
  assert.match(problems.textContent, /2\. Quebrado: formato ou arquivo não suportado neste navegador\./);
  assert.doesNotMatch(problems.textContent, /esta TV/, 'a prévia roda no navegador, não numa TV');
  assert.equal(problems.querySelector('.notice.warn') !== null, true);
  await kit.clock.advance(10_000);
  assert.match(label(dialog), /^3 de 3 · C · 10 s/, 'o conteúdo com defeito é pulado, como na TV');
  kit.button(dialog, 'Fechar').click();
}));

test('pré-visualização: reduz o movimento quando o sistema pede, e diz isso na tela', withKit({ reducedMotion: true }, async kit => {
  const items = [item('i1', { id: 'a', title: 'A' }, { durationS: 5 }), item('i2', { id: 'b', title: 'B' }, { durationS: 5, transition: 'slide', transitionMs: 700 })];
  openPreview({}, { items }, kit.env);
  await kit.clock.advance(5_000);
  const dialog = kit.top();
  assert.equal(noteText(dialog), 'Entrada deste conteúdo: Deslizar (700 ms), exibida como Esmaecer: movimento reduzido ativo.');
  assert.ok(kit.media.animations.every(animation => animation.keyframes.every(frame => frame.transform === undefined)), 'nada desliza: só aparece aos poucos');
  assert.ok(kit.media.animations.length >= 1);
  await kit.finishMotion();
  kit.button(dialog, 'Fechar').click();
}));

test('pré-visualização em navegador sem animações: corte seco, com o motivo na tela', withKit({ animations: false }, async kit => {
  const items = [item('i1', { id: 'a', title: 'A' }, { durationS: 5 }), item('i2', { id: 'b', title: 'B' }, { durationS: 5, transition: 'zoom', transitionMs: 700 })];
  openPreview({}, { items }, kit.env);
  await kit.clock.advance(5_000);
  const dialog = kit.top();
  assert.equal(noteText(dialog), 'Entrada deste conteúdo: Zoom (700 ms), exibida como Corte seco: este navegador não anima transições.');
  assert.equal(kit.media.animations.length, 0);
  assert.equal(kit.shown(dialog).length, 1);
  kit.button(dialog, 'Fechar').click();
}));

test('pré-visualização: avisos sobre PDF, conteúdo ainda não liberado e itens que ficaram de fora', withKit({}, async kit => {
  const items = [pdf('i1'), item('i2', { id: 'b', title: 'Pendente' }, { readiness: 'pending' }), item('i3', { id: 'c' }, { readiness: 'rejected' }), item('i4', { id: 'd' }, { readiness: 'deleted', media: media('d', { url: null }) })];
  openPreview({}, { items }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  const notes = dialog.querySelector('.preview-notes').textContent;
  assert.match(notes, /PDF: aparece no visualizador do navegador/);
  assert.match(notes, /A troca automática de páginas ainda não existe/);
  assert.match(notes, /1 conteúdo ainda não está liberado: aparece aqui, mas só vai ao ar depois de aprovado/);
  assert.match(notes, /2 conteúdos rejeitados ou excluídos ficaram de fora/);
  assert.match(notes, /Teste sempre em uma TV antes de divulgar/);
  assert.equal(dialog.querySelectorAll('.preview-step').length, 2, 'só os dois que tocam entram na linha do tempo');
  kit.button(dialog, 'Fechar').click();
}));

test('pré-visualização sem nada para exibir mostra o motivo e só oferece fechar', withKit({}, async kit => {
  const closed = openPreview({}, { items: [item('i1', { id: 'a' }, { readiness: 'rejected' })] }, kit.env);
  const dialog = kit.top();
  assert.match(dialog.textContent, /Nenhum conteúdo para exibir/);
  assert.equal(kit.layers(dialog).length, 0);
  assert.ok(kit.button(dialog, 'Fechar'));
  assert.equal(kit.button(dialog, 'Pausar'), null);
  kit.button(dialog, 'Fechar').click();
  await closed;
}));

test('fechar a pré-visualização no meio de uma transição solta tudo (animações, camadas, arquivos e prazos)', withKit({}, async kit => {
  const items = [item('i1', { id: 'a' }, { durationS: 5 }), item('i2', { id: 'b' }, { durationS: 5, transition: 'dissolve', transitionMs: 1500 })];
  const closed = openPreview({}, { items }, kit.env);
  await kit.clock.advance(5_100);
  assert.equal(kit.media.running().length, 1, 'a transição está em andamento');
  kit.top().querySelectorAll('button').filter(button => kit.textOf(button) === 'Fechar').at(-1).click();
  await closed;
  await kit.clock.advance(0);
  assert.equal(kit.media.running().length, 0);
  assert.equal(kit.layers(kit.document.body).length, 0);
  assert.equal(kit.media.source.opened.length, kit.media.source.released.length);
  assert.equal(kit.clock.pending(), 0);
}));

// ---- demonstração de efeitos -------------------------------------------------------------------------------------------------------

const letter = dialog => kit => kit.shown(dialog).map(layer => layer.querySelector('.fx-letter')?.textContent);

test('demonstração: dois conteúdos de exemplo se alternam com o efeito escolhido, passando pelo motor da TV', withKit({}, async kit => {
  const closed = openEffectDemo({}, { effect: 'slide', ms: 800, canApply: true }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  assert.deepEqual(letter(dialog)(kit), ['A']);
  assert.equal(kit.textOf(dialog.querySelector('.fx-help')), EFFECT_HELP.slide);
  assert.equal(label(dialog), 'Efeito: Deslizar · 800 ms.');
  assert.equal(kit.media.animations.length, 0, 'o primeiro conteúdo entra sem efeito');

  await kit.clock.advance(1_999);
  assert.deepEqual(letter(dialog)(kit), ['A']);
  await kit.clock.advance(1);
  const enter = kit.media.animations.find(animation => animation.keyframes[0].transform === 'translateX(100%)');
  const exit = kit.media.animations.find(animation => animation.keyframes[1].transform === 'translateX(-100%)');
  assert.ok(enter && exit, 'entra pela direita e empurra o anterior para a esquerda');
  assert.equal(enter.options.duration, 800);
  assert.deepEqual(letter(dialog)(kit).sort(), ['A', 'B']);
  await kit.finishMotion();
  assert.deepEqual(letter(dialog)(kit), ['B']);
  await kit.clock.advance(2_000);
  await kit.finishMotion();
  assert.deepEqual(letter(dialog)(kit), ['A'], 'volta ao primeiro, em ciclo');

  kit.button(dialog, 'Fechar').click();
  assert.equal(await closed, undefined, 'só fechar não escolhe nada');
  await kit.clock.advance(0);
  assert.equal(kit.layers(kit.document.body).length, 0);
  assert.equal(kit.clock.pending(), 0);
}));

test('demonstração: cada efeito é independente — trocar de efeito ou de duração recomeça a demonstração só com o que foi escolhido', withKit({}, async kit => {
  openEffectDemo({}, { effect: 'fade', ms: 600, canApply: true }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  const select = dialog.querySelector('#demo-effect');
  assert.deepEqual(select.querySelectorAll('option').map(option => option.value ?? option.getAttribute('value')), ['cut', 'fade', 'dissolve', 'slide', 'zoom']);
  assert.equal(kit.nameOf(select), 'Efeito de transição');
  assert.equal(kit.nameOf(dialog.querySelector('#demo-ms')), 'Duração do efeito (ms)');

  for (const [name, firstFrame] of [['fade', { opacity: 0 }], ['dissolve', { opacity: 0, filter: 'blur(28px)' }], ['slide', { transform: 'translateX(100%)' }], ['zoom', { opacity: 0, transform: 'scale(0.82)' }]]) {
    const before = kit.media.animations.length;
    kit.change(select, name);
    await kit.clock.advance(0);
    assert.deepEqual(letter(dialog)(kit), ['A'], `${name}: recomeça do primeiro conteúdo`);
    assert.equal(kit.textOf(dialog.querySelector('.fx-help')), EFFECT_HELP[name], `${name}: a explicação acompanha`);
    await kit.clock.advance(2_000);
    const started = kit.media.animations.slice(before);
    assert.ok(started.length >= 1, `${name}: a troca tem animação`);
    assert.deepEqual(started[0].keyframes[0], firstFrame, `${name}: primeiro quadro do efeito`);
    await kit.finishMotion();
    assert.deepEqual(letter(dialog)(kit), ['B'], `${name}: o segundo conteúdo terminou de entrar`);
  }

  // Duração: o campo vale para a animação e o tempo parado se ajusta para a troca terminar antes da próxima.
  kit.change(dialog.querySelector('#demo-ms'), '1500');
  await kit.clock.advance(0);
  const before = kit.media.animations.length;
  await kit.clock.advance(2_699);
  assert.equal(kit.media.animations.length, before, 'cada conteúdo fica 1,2 s além da duração do efeito');
  await kit.clock.advance(1);
  assert.equal(kit.media.animations.at(-1).options.duration, 1500);
  await kit.finishMotion();

  // Corte seco: nada de duração, nada de animação.
  kit.change(select, 'cut');
  await kit.clock.advance(0);
  assert.equal(dialog.querySelector('label[for="demo-ms"]').hidden, true);
  const still = kit.media.animations.length;
  await kit.clock.advance(1_600);
  assert.equal(kit.media.animations.length, still, 'corte seco não anima');
  assert.deepEqual(letter(dialog)(kit), ['B']);
  kit.button(dialog, 'Fechar').click();
}));

test('demonstração: "Usar este efeito" devolve a escolha; sem permissão de editar o botão nem aparece; pausar congela a demonstração', withKit({}, async kit => {
  const closed = openEffectDemo({}, { effect: 'cut', ms: 0, canApply: true }, kit.env);
  await kit.clock.advance(0);
  const dialog = kit.top();
  assert.equal(dialog.querySelector('label[for="demo-ms"]').hidden, true, 'corte seco começa sem duração');
  kit.change(dialog.querySelector('#demo-effect'), 'zoom');
  assert.equal(dialog.querySelector('#demo-ms').value, '600', 'efeito novo começa com 600 ms');
  kit.change(dialog.querySelector('#demo-ms'), '99999');
  assert.equal(dialog.querySelector('#demo-ms').value, '3000');
  kit.button(dialog, 'Usar este efeito').click();
  assert.deepEqual(await closed, { effect: 'zoom', ms: 3000 });

  const readonly = openEffectDemo({}, { effect: 'fade', ms: 600, canApply: false }, kit.env);
  await kit.clock.advance(0);
  const second = kit.top();
  assert.equal(kit.button(second, 'Usar este efeito'), null);
  assert.ok(kit.button(second, 'Fechar').classList.contains('primary'), 'quem só consulta tem "Fechar" como ação principal');
  kit.button(second, 'Pausar').click();
  assert.ok(kit.button(second, 'Reproduzir'));
  await kit.clock.advance(30_000);
  assert.deepEqual(letter(second)(kit), ['A'], 'pausada, a demonstração não avança');
  kit.button(second, 'Ver de novo').click();
  assert.ok(kit.button(second, 'Pausar'), '"Ver de novo" também retoma');
  await kit.clock.advance(2_000);
  assert.deepEqual(letter(second)(kit).sort(), ['A', 'B']);
  await kit.finishMotion();
  kit.button(second, 'Fechar').click();
  assert.equal(await readonly, undefined);
  await kit.clock.advance(0);
  assert.equal(kit.clock.pending(), 0);
}));

test('demonstração com movimento reduzido: todo efeito aparece como esmaecer e a tela diz por quê', withKit({ reducedMotion: true }, async kit => {
  openEffectDemo({}, { effect: 'zoom', ms: 600 }, kit.env);
  await kit.clock.advance(2_000);
  const dialog = kit.top();
  assert.equal(noteText(dialog), 'Efeito simplificado: movimento reduzido ativo. Aparece como Esmaecer.');
  assert.deepEqual(kit.media.animations.at(-1).keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  await kit.finishMotion();
  kit.button(dialog, 'Fechar').click();
}));

test('itens da demonstração: o tempo parado sempre cobre a transição, e os efeitos têm a duração pedida', () => {
  const effectOf = (name, ms) => demoItems(name, ms).map(entry => [entry.transition, entry.transitionMs, entry.durationMs]);
  assert.deepEqual(effectOf('fade', 600), [['fade', 600, 1800], ['fade', 600, 1800]]);
  assert.deepEqual(effectOf('slide', 3000), [['slide', 3000, 4200], ['slide', 3000, 4200]], 'efeito longo: o conteúdo espera 1,2 s depois dele');
  assert.deepEqual(effectOf('cut', 0), [['cut', 0, 1600], ['cut', 0, 1600]]);
  assert.deepEqual(effectOf('zoom', 0).map(entry => entry[0]), ['cut', 'cut'], 'efeito com duração 0 é corte seco');
  for (const entry of demoItems('fade', 600)) assert.equal(entry.kind, 'html');
});

// ---- publicar e ver versões: a repetição aparece na revisão e vale na pré-visualização -------------------------------------------------
// Estas janelas abrem a pré-visualização sem relógio de mentira (como no navegador de verdade); aqui só se lê o que ela escreve ao abrir
// e se fecha em seguida, o que solta todos os prazos dela.

const LOOP_OFF_TEXT = 'Uma vez, mantendo o último conteúdo';
const LOOP_OFF_NOTE = 'A repetição está desligada';
const reviewLines = (kit, dialog) => Object.fromEntries(kit.all(dialog, '.review-line').map(line => [kit.textOf(kit.one(line, 'span')), kit.textOf(kit.one(line, 'b'))]));
const notesOf = (kit, dialog) => kit.textOf(kit.one(dialog, '.preview-notes'));
const publishRow = (kit, row) => ({
  num: kit.textOf(kit.one(row, '.publish-num')), title: kit.textOf(kit.one(row, '.publish-title')), timing: kit.textOf(kit.one(row, 'small')),
  badge: kit.one(row, '.badge') ? kit.textOf(kit.one(row, '.badge')) : null
});
const serverPlaylist = (items, extra = {}) => ({ id: 'p1', name: 'Recepção', items, latestVersion: 0, hasUnpublishedChanges: true, draftRev: 7, ...extra });

test('publicar: a revisão diz quantos conteúdos, quanto dura o ciclo e se a repetição está ligada; a pré-visualização segue a mesma escolha', withKit({}, async kit => {
  const items = [item('i1', { id: 'a', title: 'Aviso A' }, { durationS: 10 }), video('i2', 'v', { durationS: 20, durationMode: 'natural' })];
  for (const [loop, expected] of [[true, 'Contínua'], [undefined, 'Contínua'], [false, LOOP_OFF_TEXT]]) {
    const closed = openPublishDialog({}, { playlist: serverPlaylist(items, { loop }) });
    const dialog = kit.top();
    assert.deepEqual(reviewLines(kit, dialog), { Conteúdos: '2 conteúdos', 'Duração de um ciclo': '10 s mais a duração do vídeo', Repetição: expected }, `repetição: ${String(loop)}`);

    kit.button(dialog, 'Pré-visualizar').click();
    const preview = kit.top();
    assert.notEqual(preview, dialog, 'a pré-visualização abre por cima da revisão');
    assert.equal(preview.querySelector('h2').textContent, 'Pré-visualização antes de publicar');
    assert.equal(notesOf(kit, preview).includes(LOOP_OFF_NOTE), loop === false, `a pré-visualização ${loop === false ? 'avisa' : 'não avisa'} da repetição desligada`);
    kit.button(preview, 'Fechar').click();
    await kit.clock.advance(0);
    assert.equal(kit.top(), dialog, 'fechar a pré-visualização volta para a revisão');

    kit.button(dialog, 'Cancelar').click();
    assert.equal(await closed, undefined);
  }
  assert.equal(kit.open().length, 0);
}));

test('publicar: com um conteúdo só, sem pendências, confirma com a nota sem espaços sobrando e devolve a playlist atualizada', withKit({}, async kit => {
  const posts = [];
  const ctx = { api: { post: async (url, body) => { posts.push([url, body]); return { id: 'p 1', latestVersion: 4 }; } } };
  const closed = openPublishDialog(ctx, { playlist: serverPlaylist([item('i1', { id: 'a', title: 'Aviso A' }, { durationS: 30 })], { id: 'p 1', latestVersion: 3, loop: true }) });
  const dialog = kit.top();
  assert.equal(dialog.querySelector('h2').textContent, 'Publicar a versão 4');
  assert.deepEqual(reviewLines(kit, dialog), { Conteúdos: '1 conteúdo', 'Duração de um ciclo': '30 s', Repetição: 'Contínua' });
  const confirm = kit.button(dialog, 'Publicar versão 4');
  assert.equal(confirm.disabled, false);
  assert.equal(kit.one(dialog, '#publish-note').disabled, false);
  kit.one(dialog, '#publish-note').value = '  Campanha de outubro  ';
  confirm.click();
  assert.deepEqual(await closed, { id: 'p 1', latestVersion: 4 });
  assert.deepEqual(posts, [['/api/playlists/p%201/publish', { rev: 7, note: 'Campanha de outubro' }]], 'envia a revisão do rascunho e a nota aparada');
}));

test('publicar: sem conteúdo, com conteúdo não liberado ou sem alteração nova, o botão fica desligado e a janela diz o motivo', withKit({}, async kit => {
  const cases = [
    ['sem conteúdo', serverPlaylist([]), 'Adicione ao menos um conteúdo para publicar.', true],
    ['conteúdo aguardando aprovação', serverPlaylist([item('i1', { id: 'a' }, { readiness: 'pending' })]), 'Há conteúdos que ainda não foram liberados. Aprove-os na biblioteca e tente de novo.', false],
    ['nada novo desde a última versão', serverPlaylist([item('i1', { id: 'a' })], { latestVersion: 2, hasUnpublishedChanges: false }), 'Não há alterações novas desde a última versão publicada.', false]
  ];
  for (const [name, playlist, reason, previewOff] of cases) {
    const closed = openPublishDialog({}, { playlist });
    const dialog = kit.top();
    assert.equal(kit.button(dialog, `Publicar versão ${playlist.latestVersion + 1}`).disabled, true, name);
    assert.equal(kit.one(dialog, '#publish-note').disabled, true, name);
    assert.equal(kit.textOf(kit.one(dialog, '.notice')).includes(reason), true, `${name}: ${reason}`);
    assert.equal(kit.button(dialog, 'Pré-visualizar').disabled, previewOff, `${name}: só dá para pré-visualizar quando há conteúdo`);
    kit.button(dialog, 'Cancelar').click();
    await closed;
  }
}));

test('ver versão: mostra quando foi publicada, quanto dura, a repetição e a nota, e a pré-visualização segue a repetição daquela versão', withKit({}, async kit => {
  const gets = [];
  const publishedAt = '2026-10-20T13:00:00.000Z';
  const items = [item('i1', { id: 'a', title: 'Aviso A' }, { durationS: 10, transition: 'fade', transitionMs: 400 }), video('i2', 'v', { durationS: 20, durationMode: 'natural' })];
  const payloads = {
    1: { publishedAt, items, loop: false, note: 'Campanha de outubro' },
    2: { publishedAt, items, loop: true },
    3: { publishedAt, items }
  };
  const ctx = { api: { get: async url => { gets.push(url); return payloads[Number(url.split('/').at(-1))]; } } };
  const playlist = { id: 'lista 1', name: 'Recepção' };

  for (const [number, expectedLoop, expectedNote] of [[1, LOOP_OFF_TEXT, 'Campanha de outubro'], [2, 'Contínua', undefined], [3, 'Contínua', undefined]]) {
    const closed = viewVersion(ctx, playlist, number);
    const dialog = kit.top();
    assert.equal(dialog.querySelector('h2').textContent, `Versão ${number}`);
    await kit.clock.advance(0);
    const lines = reviewLines(kit, dialog);
    assert.equal(lines['Publicada em'], formatDateTime(publishedAt));
    assert.ok(lines['Publicada em'].includes('2026'));
    assert.equal(lines['Duração de um ciclo'], '10 s mais a duração do vídeo');
    assert.equal(lines.Repetição, expectedLoop, `versão ${number}`);
    assert.equal(lines.Nota, expectedNote, expectedNote ? 'a nota da versão aparece' : 'sem nota, a linha nem existe');
    assert.deepEqual(kit.all(dialog, '.publish-item').map(row => publishRow(kit, row)), [
      { num: '1', title: 'Aviso A', timing: '10 s · Esmaecer 400 ms', badge: null },
      { num: '2', title: 'Clipe', timing: 'até o fim do vídeo', badge: null }
    ], 'cada conteúdo com o tempo e o efeito; só o que não está liberado ganha etiqueta');
    assert.equal(kit.all(dialog, '.notice').length, 0, 'tudo liberado: nenhum aviso');

    kit.button(dialog, 'Pré-visualizar').click();
    const preview = kit.top();
    assert.notEqual(preview, dialog);
    assert.equal(preview.querySelector('h2').textContent, `Pré-visualizar a versão ${number}`);
    assert.equal(notesOf(kit, preview).includes(LOOP_OFF_NOTE), number === 1, `versão ${number}: a pré-visualização ${number === 1 ? 'avisa' : 'não avisa'} da repetição desligada`);
    kit.button(preview, 'Fechar').click();
    await kit.clock.advance(0);
    kit.button(dialog, 'Fechar').click();
    await closed;
  }
  assert.deepEqual(gets, ['/api/playlists/lista%201/versions/1', '/api/playlists/lista%201/versions/2', '/api/playlists/lista%201/versions/3']);
  assert.equal(kit.open().length, 0);
}));

test('ver versão: conteúdo que deixou de estar liberado aparece marcado e vem com o aviso; erro ao carregar mostra o motivo na janela', withKit({}, async kit => {
  const items = [item('i1', { id: 'a', title: 'Aviso A' }), item('i2', { id: 'b', title: 'Aviso B' }, { readiness: 'deleted' })];
  const ctx = { api: { get: async url => { if (url.endsWith('/versions/9')) throw new Error('Versão não encontrada.'); return { publishedAt: '2026-10-20T13:00:00.000Z', items, loop: true }; } } };
  const playlist = { id: 'p1', name: 'Recepção' };

  const closed = viewVersion(ctx, playlist, 2);
  const dialog = kit.top();
  await kit.clock.advance(0);
  const rows = kit.all(dialog, '.publish-item');
  assert.deepEqual(rows.map(row => row.classList.contains('bad')), [false, true]);
  assert.deepEqual(rows.map(row => publishRow(kit, row).badge), [null, 'Arquivo excluído']);
  assert.match(kit.textOf(kit.one(dialog, '.notice')), /^Há conteúdos desta versão que não estão mais liberados/);
  kit.button(dialog, 'Fechar').click();
  await closed;

  const failed = viewVersion(ctx, playlist, 9);
  const broken = kit.top();
  await kit.clock.advance(0);
  assert.match(kit.textOf(broken), /Não foi possível abrir a versão\s*Versão não encontrada\./);
  assert.equal(kit.button(broken, 'Pré-visualizar'), null, 'sem os dados da versão não há o que pré-visualizar');
  kit.button(broken, 'Fechar').click();
  await failed;
}));

test('pré-visualizar uma versão direto (formulário da programação): busca a versão, respeita a repetição dela e, se falhar, avisa sem abrir nada', withKit({}, async kit => {
  const region = kit.document.createElement('div');
  region.id = 'toast';
  kit.document.body.appendChild(region);
  const items = [item('i1', { id: 'a', title: 'Aviso A' }), item('i2', { id: 'b', title: 'Aviso B' })];
  const gets = [];
  const ctx = { api: { get: async url => { gets.push(url); if (url.endsWith('/versions/8')) throw new Error('Versão não encontrada.'); return { items, loop: url.endsWith('/versions/1') ? false : undefined }; } } };
  const playlist = { id: 'p1', name: 'Recepção' };

  try {
    for (const number of [1, 2]) {
      const closed = previewVersion(ctx, playlist, number);
      await kit.clock.advance(0);
      const preview = kit.top();
      assert.equal(preview.querySelector('h2').textContent, `Pré-visualizar a versão ${number}`);
      assert.equal(kit.textOf(preview.querySelector('.dialog-head p')), 'Recepção · sequência e tempo desta versão publicada, neste computador.');
      assert.equal(notesOf(kit, preview).includes(LOOP_OFF_NOTE), number === 1);
      kit.button(preview, 'Fechar').click();
      await closed;
    }
    assert.equal(await previewVersion(ctx, playlist, 8), undefined);
    assert.equal(kit.open().length, 0, 'nada abre quando a versão não carrega');
    assert.equal(region.textContent, 'Versão não encontrada.');
    assert.equal(region.dataset.kind, 'error');
    assert.deepEqual(gets, ['/api/playlists/p1/versions/1', '/api/playlists/p1/versions/2', '/api/playlists/p1/versions/8']);
  } finally { hideToast(); }
}));

test('textos da repetição existem para os dois estados', () => {
  assert.ok(LOOP_HELP.on.length > 20 && LOOP_HELP.off.length > 20);
  assert.notEqual(LOOP_HELP.on, LOOP_HELP.off);
});
