// Editor de playlist (Fase 2) no Node, com o DOM de teste e uma API de mentira: repetição contínua, tempo do vídeo, resumo do ciclo,
// "Ver efeito" (aplicar a escolha ao conteúdo), pré-visualização do RASCUNHO e o que vai no salvamento.
//
// A API é de mentira, então aqui se confere a tela e o que ela ENVIA. Que o servidor guarda e devolve esses campos é coberto por
// tests/playlists.test.mjs e tests/playback-api.test.mjs; o desenho e o foco reais, por tests/e2e.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeEvent } from './helpers/fake-dom.mjs';
import { createPanelKit } from './helpers/panel-kit.mjs';
import { LOOP_HELP } from '../public/js/lib/playlist-model.js';
import { hideToast } from '../public/js/ui/toast.js';
import { mountPlaylistEditor } from '../public/js/views/playlists/editor.js';

// Os prazos reais (aviso falado em 20 ms, aviso de "Rascunho salvo" em alguns segundos, relógio da pré-visualização) ficam parados:
// o teste decide quando disparar cada um e nada fica pendente no fim.
function freezeTimers() {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const pending = new Map();
  let next = 1;
  globalThis.setTimeout = (fn, ms = 0) => { const id = next++; pending.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = id => { pending.delete(id); };
  return {
    pending,
    // Dispara os prazos curtos (até `maxMs`), como o aviso falado.
    fireShort(maxMs = 50) { for (const [id, timer] of [...pending]) if (timer.ms <= maxMs) { pending.delete(id); timer.fn(); } },
    restore() { globalThis.setTimeout = real.setTimeout; globalThis.clearTimeout = real.clearTimeout; }
  };
}

const settle = async (turns = 12) => { for (let turn = 0; turn < turns; turn++) await new Promise(resolve => setImmediate(resolve)); };

const IMAGE = { id: 'a', title: 'Aviso', name: 'aviso.png', type: 'image/png', url: '/api/media/a/file' };
const VIDEO = { id: 'v', title: 'Clipe', name: 'clipe.mp4', type: 'video/mp4', url: '/api/media/v/file' };
const LIBRARY = { a: IMAGE, v: VIDEO };

const serverItem = (media, extra = {}) => ({ mediaId: media.id, durationS: 10, durationMode: 'fixed', transition: 'cut', transitionMs: 0, readiness: 'ready', media, ...extra });
const playlistOf = (extra = {}) => ({
  id: 'pl1', name: 'Recepção', description: '', unitId: 'u1', sectorId: 's1', loop: true, draftRev: 3, maxItems: 20,
  latestVersion: 0, hasUnpublishedChanges: false, versions: [], schedules: [],
  items: [serverItem(IMAGE, { durationS: 10 }), serverItem(VIDEO, { durationS: 30 })],
  ...extra
});
const MANAGER = { id: 'user-1', role: 'manager', active: true, unitIds: ['u1'], sectorIds: ['s1'], permissions: ['playlist:read', 'playlist:update', 'playlist:publish', 'schedule:create'] };
const VIEWER = { id: 'user-2', role: 'viewer', active: true, unitIds: ['u1'], sectorIds: ['s1'], permissions: ['playlist:read'] };

async function openEditor(kit, { playlist = playlistOf(), user = MANAGER } = {}) {
  const toast = kit.document.createElement('div');
  toast.id = 'toast';
  kit.document.body.appendChild(toast);
  let server = playlist;
  const calls = [];
  const ctx = {
    user, state: { mode: 'production', space: { unitId: 'u1', sectorId: 's1' } },
    link: name => `#/${name}`, navigate: (...args) => calls.push(['navigate', ...args]),
    unitName: () => 'Matriz', sectorName: () => 'Recepção',
    api: {
      get: async url => { calls.push(['get', url]); return structuredClone(server); },
      // Como o servidor: aceita a revisão atual, guarda o que veio e devolve a playlist completa.
      patch: async (url, body) => {
        calls.push(['patch', url, structuredClone(body)]);
        assert.equal(body.rev, server.draftRev, 'o editor deve mandar a revisão que viu');
        server = {
          ...server, name: body.name, description: body.description, loop: body.loop, draftRev: server.draftRev + 1, hasUnpublishedChanges: true,
          items: body.items.map(item => ({ ...item, readiness: 'ready', media: LIBRARY[item.mediaId] }))
        };
        return structuredClone(server);
      }
    }
  };
  let blocker = null;
  const disposers = [];
  const view = { alive: () => true, onDispose: fn => disposers.push(fn), setBlocker: fn => { blocker = fn; } };
  const container = kit.document.createElement('div');
  kit.document.body.appendChild(container);
  await mountPlaylistEditor(ctx, { params: { id: server.id } }, container, view);
  const patches = () => calls.filter(call => call[0] === 'patch').map(call => call[2]);
  return {
    ctx, container, calls, patches, blocker: () => blocker?.(), dispose: () => { for (const fn of disposers) fn(); },
    q: selector => container.querySelector(selector),
    control: aria => container.querySelectorAll('input, select, button').find(element => element.getAttribute('aria-label') === aria) ?? null,
    text: selector => kit.textOf(container.querySelector(selector)),
    live: () => container.querySelector('[role="status"].sr-only')?.textContent ?? ''
  };
}

const withEditor = (options, run) => async () => {
  const kit = createPanelKit(options?.kit ?? {});
  const timers = freezeTimers();
  try {
    await run(kit, timers);
  } finally {
    hideToast();
    timers.restore();
    kit.release();
  }
};

const check = (element, value) => { element.checked = value; element.dispatchEvent(new FakeEvent('change', { bubbles: true })); };

// ---- repetição contínua --------------------------------------------------------------------------------------------------------------

test('repetição: reflete o que o servidor guarda, explica cada estado e vai no salvamento', withEditor({}, async (kit, timers) => {
  const editor = await openEditor(kit, { playlist: playlistOf({ loop: false }) });
  const loop = editor.q('#playlist-loop');
  assert.equal(loop.checked, false, 'playlist que o servidor guarda sem repetição abre desmarcada');
  assert.equal(kit.nameOf(loop), 'Repetir a playlist continuamente');
  assert.equal(editor.text('#playlist-loop-note'), LOOP_HELP.off);
  assert.equal(loop.getAttribute('aria-describedby'), 'playlist-loop-note');
  assert.equal(editor.text('.save-state'), 'Tudo salvo');
  assert.equal(editor.q('.pl-summary') !== null, true);

  check(loop, true);
  assert.equal(editor.text('#playlist-loop-note'), LOOP_HELP.on, 'a explicação acompanha a escolha');
  assert.equal(editor.text('.save-state'), 'Alterações não salvas');
  assert.match(editor.blocker(), /alterações não salvas/, 'sair da tela agora pede confirmação');
  timers.fireShort();
  assert.equal(editor.live(), 'Repetição contínua ligada.');

  check(loop, false);
  assert.equal(editor.text('.save-state'), 'Tudo salvo', 'voltar ao estado salvo apaga a marca de alteração');
  assert.equal(editor.blocker(), null);
  timers.fireShort();
  assert.equal(editor.live(), 'Repetição contínua desligada. A TV exibirá a sequência uma vez.');

  check(loop, true);
  kit.button(editor.container, 'Salvar rascunho').click();
  await settle();
  assert.equal(editor.patches().length, 1);
  assert.equal(editor.patches()[0].loop, true, 'a repetição vai no salvamento');
  assert.equal(editor.text('.save-state'), 'Tudo salvo');
  assert.equal(editor.q('#playlist-loop').checked, true);
  assert.equal(editor.blocker(), null);
}));

test('repetição: sem permissão de editar a caixa fica desabilitada, mas continua explicando o estado', withEditor({}, async kit => {
  const editor = await openEditor(kit, { user: VIEWER });
  assert.equal(editor.q('#playlist-loop').disabled, true);
  assert.equal(editor.text('#playlist-loop-note'), LOOP_HELP.on);
  assert.equal(editor.text('.save-state'), 'Somente leitura');
  assert.equal(kit.button(editor.container, 'Salvar rascunho'), null);
  for (const control of editor.container.querySelectorAll('.pl-item input, .pl-item select')) assert.equal(control.disabled, true, `${control.id} deveria estar travado`);
}));

// ---- tempo do vídeo e resumo do ciclo --------------------------------------------------------------------------------------------------

test('vídeo: trocar entre "tempo definido (limite)" e "até o fim" muda o resumo do ciclo e o que é enviado', withEditor({}, async (kit, timers) => {
  const editor = await openEditor(kit);
  assert.equal(editor.text('.pl-summary'), '2 de 20 conteúdos · um ciclo completo dura até 40 s', 'imagem 10 s + vídeo com limite de 30 s');
  assert.equal(editor.control('Tempo do vídeo “Aviso”'), null, 'imagem não escolhe o modo do vídeo');

  const mode = editor.control('Tempo do vídeo “Clipe”');
  assert.ok(mode, 'o vídeo tem o seletor de modo');
  kit.change(mode, 'natural');
  assert.equal(editor.text('.pl-summary'), '2 de 20 conteúdos · um ciclo completo dura 10 s mais a duração do vídeo');
  assert.equal(editor.text('.save-state'), 'Alterações não salvas');
  assert.ok(editor.control('Reserva (s) do vídeo “Clipe”'), 'o campo de segundos passa a se chamar reserva');

  kit.change(editor.control('Duração (s) de “Aviso”'), '7');
  assert.equal(editor.text('.pl-summary'), '2 de 20 conteúdos · um ciclo completo dura 7 s mais a duração do vídeo');

  kit.change(mode, 'fixed');
  assert.equal(editor.text('.pl-summary'), '2 de 20 conteúdos · um ciclo completo dura até 37 s');
  kit.change(mode, 'natural');

  kit.button(editor.container, 'Salvar rascunho').click();
  await settle();
  assert.deepEqual(editor.patches()[0].items.map(item => [item.mediaId, item.durationS, item.durationMode, item.transition, item.transitionMs]), [
    ['a', 7, 'fixed', 'cut', 0],
    ['v', 30, 'natural', 'cut', 0]
  ]);
  assert.equal(editor.control('Tempo do vídeo “Clipe”').value, 'natural', 'depois de salvar, a tela mostra o que o servidor devolveu');
  timers.fireShort();
}));

test('só vídeos até o fim: o ciclo é a duração dos vídeos; duas faixas de vídeo somam ao tempo conhecido', withEditor({}, async kit => {
  const editor = await openEditor(kit, { playlist: playlistOf({ items: [serverItem(VIDEO, { durationMode: 'natural', durationS: 20 }), serverItem(VIDEO, { durationMode: 'natural', durationS: 20 })] }) });
  assert.equal(editor.text('.pl-summary'), '2 de 20 conteúdos · um ciclo completo equivale à duração dos 2 vídeos');
  const [first] = editor.container.querySelectorAll('.pl-item');
  assert.match(kit.textOf(first.querySelector('.pl-meta')), /toca até o fim do vídeo/);
}));

// ---- "Ver efeito" ------------------------------------------------------------------------------------------------------------------

test('"Ver efeito": o efeito escolhido na demonstração passa a valer para o conteúdo, marca o rascunho e volta o foco ao botão', withEditor({}, async (kit, timers) => {
  const editor = await openEditor(kit);
  const open = editor.control('Ver efeito de “Aviso”');
  open.click();
  await settle();
  const demo = kit.top();
  assert.ok(demo, 'a demonstração abriu');
  assert.equal(demo.querySelector('#demo-effect').value, 'cut', 'começa pelo efeito atual do conteúdo');

  kit.change(demo.querySelector('#demo-effect'), 'zoom');
  kit.change(demo.querySelector('#demo-ms'), '900');
  kit.button(demo, 'Usar este efeito').click();
  await settle();

  assert.equal(kit.top(), null, 'a demonstração fechou');
  assert.equal(editor.control('Transição de “Aviso”').value, 'zoom');
  assert.equal(editor.control('Efeito (ms) de “Aviso”').value, '900');
  assert.equal(editor.control('Transição de “Clipe”').value, 'cut', 'o outro conteúdo não muda');
  assert.equal(editor.text('.save-state'), 'Alterações não salvas');
  assert.equal(kit.document.activeElement.getAttribute('aria-label'), 'Ver efeito de “Aviso”', 'o foco volta ao botão que abriu a demonstração');
  timers.fireShort();
  assert.equal(editor.live(), 'Efeito de “Aviso”: Zoom, 900 ms.');

  kit.button(editor.container, 'Salvar rascunho').click();
  await settle();
  assert.deepEqual(editor.patches()[0].items.map(item => [item.mediaId, item.transition, item.transitionMs]), [['a', 'zoom', 900], ['v', 'cut', 0]]);
}));

test('"Ver efeito": fechar sem escolher não altera nada', withEditor({}, async kit => {
  const editor = await openEditor(kit);
  editor.control('Ver efeito de “Clipe”').click();
  await settle();
  kit.change(kit.top().querySelector('#demo-effect'), 'slide');
  kit.button(kit.top(), 'Fechar').click();
  await settle();
  assert.equal(editor.control('Transição de “Clipe”').value, 'cut');
  assert.equal(editor.text('.save-state'), 'Tudo salvo');
  assert.equal(editor.patches().length, 0);
}));

test('"Ver efeito" para quem só consulta: mostra os efeitos, mas não oferece aplicar', withEditor({}, async kit => {
  const editor = await openEditor(kit, { user: VIEWER });
  editor.control('Ver efeito de “Aviso”').click();
  await settle();
  const demo = kit.top();
  assert.ok(demo);
  assert.equal(kit.button(demo, 'Usar este efeito'), null);
  kit.button(demo, 'Fechar').click();
  await settle();
  assert.equal(editor.text('.save-state'), 'Somente leitura');
}));

// ---- pré-visualização do rascunho -------------------------------------------------------------------------------------------------

test('"Pré-visualizar" mostra o rascunho atual, com o que ainda não foi salvo', withEditor({}, async (kit, timers) => {
  const editor = await openEditor(kit);
  kit.change(editor.control('Duração (s) de “Aviso”'), '7');
  kit.change(editor.control('Tempo do vídeo “Clipe”'), 'natural');
  kit.change(editor.control('Transição de “Clipe”'), 'slide');
  check(editor.q('#playlist-loop'), false);

  kit.button(editor.container, 'Pré-visualizar').click();
  await settle();
  const dialog = kit.top();
  try {
    assert.ok(dialog, 'a pré-visualização abriu');
    assert.equal(dialog.querySelector('.preview-label').textContent, '1 de 2 · Aviso · 7 s', 'usa o tempo digitado, não o salvo');
    const steps = dialog.querySelectorAll('.preview-step small').map(small => small.textContent);
    assert.deepEqual(steps, ['7 s', 'até o fim do vídeo']);
    assert.ok(dialog.querySelector('.preview-notes').textContent.includes('A repetição está desligada'), 'e a repetição do rascunho');
    assert.equal(editor.patches().length, 0, 'pré-visualizar não salva nada');
  } finally {
    kit.button(dialog, 'Fechar').click();
    await settle();
  }
  assert.equal(kit.layers(kit.document.body).length, 0);
  assert.equal(timers.pending.size > 0, true, 'só sobram prazos da própria tela do editor (aviso falado)');
}));

test('"Pré-visualizar" fica desabilitado numa playlist vazia', withEditor({}, async kit => {
  const editor = await openEditor(kit, { playlist: playlistOf({ items: [] }) });
  assert.equal(kit.button(editor.container, 'Pré-visualizar').disabled, true);
  assert.equal(editor.text('.pl-summary'), '0 de 20 conteúdos · um ciclo completo dura 0 s');
}));
