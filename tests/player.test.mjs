// Player da TV (Fase 2): a página real (public/player.html), o código real (public/player.js e public/js/player/*) e todo o carrossel,
// com servidor, navegador e relógio de mentira. Cobre pareamento, exibição na ordem e no tempo, controles, teclado, queda de rede,
// revogação, retomada, falhas de conteúdo e a demonstração. Com a API de verdade (HTTP real) há um teste de integração no fim.
//
// O que estes testes NÃO provam: desenho na tela, decodificação de vídeo, desempenho e comportamento de TV de verdade. Isso é
// conferido no Chromium (tests/e2e/playback.e2e.mjs) e, para cada modelo de TV, só com o aparelho (ver docs/VALIDACAO.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeEvent } from './helpers/fake-dom.mjs';
import { must, withApp } from './helpers/app.mjs';
import { createPlayerKit, entry, PLAYER_HTML, TOKEN_KEY } from './helpers/player-kit.mjs';
import { createFakeClock, createMemoryStorage } from './helpers/playback-fakes.mjs';
import { EFFECTS } from '../public/js/playback/effects.js';
import { ELEMENT_IDS, PLAYER_VERSION, REVOKED_MESSAGE, missingFeatures, skipReasonText } from '../public/js/player/app.js';

async function withKit(options, run) {
  const kit = createPlayerKit(options);
  let finished = false;
  try { await run(kit); finished = true; } finally {
    if (finished) await kit.close(); // confere que nada ficou para trás
    else { try { await kit.close(); } catch { /* o erro que importa é o do teste */ } }
  }
}
const at = async (kit, ms) => kit.settle(ms - kit.clock.now());
const abc = (extra = {}) => [entry('a', extra), entry('b', extra), entry('c', extra)];
const video = (id, extra = {}) => entry(id, { type: 'video/mp4', name: `${id}.mp4`, ...extra });
const shownIds = kit => kit.shownLayers().sort((x, y) => Number(x.style.zIndex) - Number(y.style.zIndex)).map(layer => /^fake:\/\/([^#]*)/.exec((layer.querySelector('img') ?? layer.querySelector('video'))?.src ?? '')?.[1] ?? '?');

// ---- a página ---------------------------------------------------------------------------------------------------------------------------
test('página do player: cada elemento que o código usa existe uma única vez, na ordem e no estado inicial certos', () => withKit({ start: false, token: '' }, kit => {
  for (const id of ELEMENT_IDS) assert.equal(kit.document.querySelectorAll(`#${id}`).length, 1, `#${id}`);
  assert.deepEqual(['playback', 'empty', 'demo-badge', 'pair-error', 'playback-note'].filter(id => !kit.byId(id).hidden), [], 'começam escondidos');
  assert.deepEqual(['pairing', 'control-dock', 'stage'].filter(id => kit.byId(id).hidden), [], 'começam visíveis');
  assert.deepEqual(kit.document.querySelectorAll('.player-actions button').map(button => button.id), ['previous-slide', 'play-toggle', 'next-slide', 'audio-toggle', 'fullscreen', 'disconnect']);
  for (const id of ['previous-slide', 'play-toggle', 'next-slide', 'fullscreen']) assert.ok(kit.byId(id).getAttribute('aria-label'), `${id}: nome acessível`);
  assert.equal(kit.byId('playback-status').getAttribute('role'), 'status');
  assert.equal(kit.byId('announcement').getAttribute('role'), 'status');
  assert.equal(kit.byId('announcement').getAttribute('aria-live'), 'polite');
  assert.equal(kit.byId('pair-error').getAttribute('role'), 'alert');
  assert.equal(kit.byId('stage').getAttribute('aria-live'), 'off', 'a troca de conteúdo não é lida em voz alta a cada vez');
  assert.equal(kit.byId('pair-code').getAttribute('autocomplete'), 'one-time-code');
  assert.deepEqual([...PLAYER_HTML.matchAll(/<script\b[^>]*>/g)].map(match => match[0]), ['<script type="module" src="/player.js">']);
}));

// ---- pareamento ---------------------------------------------------------------------------------------------------------------------------
test('pareamento: valida o código, explica a recusa e, com o código certo, guarda a credencial e começa a exibir', () => withKit({ token: '', manifestItems: abc() }, async kit => {
  assert.equal(kit.visible('pairing'), true);
  assert.equal(kit.visible('playback'), false);
  assert.equal(kit.server.requests.length, 0, 'sem credencial, nada é consultado');

  await kit.submitPair('12a45'); // só números: sobram 4
  assert.equal(kit.byId('pair-code').value, '1245');
  assert.equal(kit.text('pair-error'), 'Digite os 6 números do código.');
  assert.equal(kit.visible('pair-error'), true);
  assert.equal(kit.server.requests.length, 0);

  await kit.submitPair('000000');
  assert.equal(kit.text('pair-error'), 'Código inválido ou expirado. Peça um novo código à TI.');
  assert.equal(kit.byId('pair-submit').disabled, false, 'o botão volta a funcionar');
  assert.equal(kit.text('pair-submit'), 'Conectar esta TV →');
  assert.equal(kit.storage.get(TOKEN_KEY), null);

  await kit.submitPair('123456');
  assert.equal(kit.storage.get(TOKEN_KEY), 'device-token');
  assert.equal(kit.visible('pairing'), false);
  assert.equal(kit.visible('playback'), true);
  assert.equal(kit.text('display-name'), 'TV de teste');
  assert.equal(kit.status(), '1 de 3 · Em exibição');
  assert.equal(kit.topId(), 'a');
  assert.equal(kit.visible('empty'), false);
  assert.equal(kit.document.activeElement.id, 'fullscreen');
  assert.deepEqual(kit.server.requests.map(request => `${request.method} ${request.path}`), ['POST /api/player/pair', 'POST /api/player/pair', 'GET /api/player/manifest', 'POST /api/player/heartbeat']);
  assert.deepEqual(kit.server.requests.map(request => request.authorization), [null, null, 'Bearer device-token', 'Bearer device-token'], 'a credencial só vai depois do pareamento');
  assert.ok(kit.server.requests.every(request => request.init.credentials === 'omit' && request.init.cache === 'no-store'), 'sem cookies e sem cache');
  assert.equal(JSON.parse(kit.server.requests.at(-1).body).version, PLAYER_VERSION);
}));

test('pareamento: sem rede ou com servidor que não responde, a TV explica e permite tentar de novo', () => withKit({ token: '', manifestItems: abc() }, async kit => {
  kit.server.state.offline = true;
  await kit.submitPair('123456');
  assert.equal(kit.text('pair-error'), 'Não foi possível conectar. Verifique a rede desta TV.');
  assert.equal(kit.byId('pair-submit').disabled, false);
  kit.server.state.offline = false;
  kit.server.state.delayMs = 40_000;
  kit.type('pair-code', '123456');
  kit.byId('pair-form').dispatchEvent(new FakeEvent('submit', { cancelable: true }));
  await kit.settle(0);
  assert.equal(kit.byId('pair-submit').disabled, true, 'enquanto espera, o botão fica bloqueado');
  assert.equal(kit.text('pair-submit'), 'Conectando…');
  await kit.settle(14_999);
  assert.equal(kit.byId('pair-submit').disabled, true);
  await kit.settle(1); // 15 s: desiste
  assert.equal(kit.text('pair-error'), 'Não foi possível conectar. Verifique a rede desta TV.');
  assert.equal(kit.byId('pair-submit').disabled, false);
  assert.equal(kit.storage.get(TOKEN_KEY), null);
}));

test('pareamento: armazenamento bloqueado não impede a exibição, e a TV avisa que a conexão dura só enquanto a página estiver aberta', () => {
  const storage = createMemoryStorage();
  storage.set = () => { throw new Error('QuotaExceededError'); };
  return withKit({ token: '', storage, manifestItems: abc() }, async kit => {
    await kit.submitPair('123456');
    assert.equal(kit.text('announcement'), 'A conexão ficará ativa apenas enquanto esta página estiver aberta.');
    assert.equal(kit.topId(), 'a', 'mesmo assim exibe');
    await at(kit, 10_000);
    assert.equal(kit.topId(), 'b');
  });
});

test('credencial da 1.1.0: a TV que já estava pareada continua pareada — o player novo lê a mesma chave do armazenamento e envia a mesma credencial', () => {
  assert.equal(TOKEN_KEY, 'tv-corporativa.device.v1', 'esta é a chave que o player da 1.1.0 usava: mudá-la despareia todas as TVs já instaladas');
  const storage = createMemoryStorage();
  storage.set('tv-corporativa.device.v1', 'device-token'); // como o player antigo deixou gravado
  return withKit({ token: '', storage, manifestItems: abc() }, async kit => {
    await kit.settle(0);
    assert.equal(kit.visible('pairing'), false, 'não pede o código de novo');
    assert.equal(kit.visible('playback'), true);
    assert.equal(kit.topId(), 'a');
    assert.deepEqual(kit.server.requests.slice(0, 2).map(request => [request.method, request.path, request.authorization]), [['GET', '/api/player/manifest', 'Bearer device-token'], ['POST', '/api/player/heartbeat', 'Bearer device-token']]);
    assert.equal(storage.get('tv-corporativa.device.v1'), 'device-token', 'a credencial continua onde estava');
  });
});

test('navegador sem os recursos mínimos: a tela de pareamento diz o que falta em vez de ficar parada', () => withKit({ token: '', scope: {}, manifestItems: abc() }, async kit => {
  assert.ok(kit.player.unsupported.length >= 3);
  assert.match(kit.text('pair-error'), /Este navegador não tem recursos necessários para o player \(.*AbortController.*\)/);
  assert.equal(kit.visible('pair-error'), true);
  assert.equal(kit.byId('pair-submit').disabled, true);
  assert.equal(kit.byId('pair-code').disabled, true);
  await kit.settle(60_000);
  assert.equal(kit.server.requests.length, 0);
  assert.deepEqual(missingFeatures({}, undefined), ['fetch', 'AbortController', 'Headers', 'Blob', 'URL.createObjectURL']);
  assert.deepEqual(missingFeatures(globalThis, () => {}), [], 'o Node de teste tem tudo');
}));

// ---- exibição -------------------------------------------------------------------------------------------------------------------------
test('exibe a programação na ordem e no tempo de cada conteúdo e recomeça ao chegar ao fim', () => withKit({ manifestItems: [entry('a', { duration: 10 }), entry('b', { duration: 20 }), entry('c', { duration: 10 })] }, async kit => {
  const expected = [[0, 'a', '1 de 3'], [9_999, 'a', '1 de 3'], [10_000, 'b', '2 de 3'], [29_999, 'b', '2 de 3'], [30_000, 'c', '3 de 3'], [40_000, 'a', '1 de 3'], [60_000, 'b', '2 de 3']];
  for (const [time, id, position] of expected) {
    await at(kit, time);
    assert.equal(kit.topId(), id, `em ${time} ms`);
    assert.equal(kit.status(), `${position} · Em exibição`, `em ${time} ms`);
    assert.equal(kit.shownLayers().length, 1, 'um único conteúdo na tela (corte seco)');
  }
  assert.ok(kit.layers().length <= 2, 'só o atual e o próximo (pré-carregado) existem');
  assert.ok(kit.server.count('/api/player/manifest') >= 3, 'a programação foi consultada de tempos em tempos e, sendo a mesma, nada recomeçou');
  assert.equal(kit.visible('empty'), false);
}));

test('o próximo conteúdo já está pronto por trás quando chega a vez dele (nunca tela vazia entre dois conteúdos)', () => withKit({ manifestItems: abc({ duration: 10 }) }, async kit => {
  await kit.settle(0);
  assert.deepEqual(kit.layers().map(layer => layer.classList.contains('is-standby')), [false, true], 'o seguinte espera escondido, já carregado');
  assert.equal(kit.layers()[1].getAttribute('aria-hidden'), 'true');
  await at(kit, 9_999);
  assert.equal(kit.shownLayers().length, 1);
  await at(kit, 10_000);
  assert.equal(kit.shownLayers().length, 1, 'a troca é imediata: a nova entra no mesmo instante em que a antiga sai');
  assert.equal(kit.topId(), 'b');
}));

test('transição: o novo conteúdo entra por cima com o efeito do item e o anterior só sai quando termina', () => withKit({ manifestItems: [entry('a'), entry('b', { transition: 'slide', transitionMs: 700 }), entry('c', { transition: 'zoom', transitionMs: 500 })] }, async kit => {
  await at(kit, 10_000);
  assert.equal(kit.topId(), 'b');
  assert.deepEqual(shownIds(kit), ['a', 'b'], 'durante a troca as duas estão na tela, a nova por cima');
  const [enter, exit] = kit.env.animations;
  assert.deepEqual(enter.keyframes, EFFECTS.slide.enter.keyframes);
  assert.deepEqual(exit.keyframes, EFFECTS.slide.exit.keyframes);
  assert.equal(enter.options.duration, 700);
  assert.equal(enter.hadStandby, true, 'a animação começa antes de a camada aparecer');
  await kit.finishMotion();
  assert.deepEqual(shownIds(kit), ['b']);
  await at(kit, 20_000);
  assert.deepEqual(shownIds(kit), ['b', 'c']);
  assert.deepEqual(kit.env.animations.at(-2).keyframes, EFFECTS.zoom.enter.keyframes);
  await kit.finishMotion();
  assert.deepEqual(shownIds(kit), ['c']);
  assert.equal(kit.text('playback-note'), '');
  assert.equal(kit.visible('playback-note'), false);
}));

test('movimento reduzido: todo efeito vira esmaecer, e a TV explica por que o efeito pedido não apareceu', () => withKit({ reducedMotion: true, manifestItems: [entry('a'), entry('b', { transition: 'slide', transitionMs: 700 }), entry('c')] }, async kit => {
  await at(kit, 10_000);
  assert.equal(kit.env.animations.length, 1, 'esmaecer anima só a camada que entra');
  assert.deepEqual(kit.env.animations[0].keyframes, EFFECTS.fade.enter.keyframes);
  assert.equal(kit.text('playback-note'), 'Efeito simplificado: movimento reduzido ativo.');
  assert.equal(kit.visible('playback-note'), true);
  await kit.finishMotion();
  await at(kit, 20_000);
  assert.equal(kit.visible('playback-note'), false, 'o aviso vale só para o conteúdo que teve o efeito simplificado');
}));

test('navegador sem animações: a troca é em corte seco e a TV avisa', () => withKit({ animations: false, manifestItems: [entry('a'), entry('b', { transition: 'dissolve', transitionMs: 600 })] }, async kit => {
  await at(kit, 10_000);
  assert.equal(kit.topId(), 'b');
  assert.equal(kit.env.animations.length, 0);
  assert.equal(kit.shownLayers().length, 1);
  assert.equal(kit.text('playback-note'), 'Efeito simplificado: este navegador não anima transições.');
}));

// ---- controles e teclado ---------------------------------------------------------------------------------------------------------------
test('controles: pausar, retomar, anterior e próximo, com rótulos, estados e avisos acessíveis', () => withKit({ manifestItems: abc() }, async kit => {
  await kit.settle(0);
  assert.equal(kit.text('play-toggle'), 'Pausar');
  assert.equal(kit.byId('play-toggle').getAttribute('aria-label'), 'Pausar reprodução');
  assert.equal(kit.byId('play-toggle').disabled, false);
  assert.equal(kit.byId('next-slide').disabled, false);
  assert.equal(kit.byId('previous-slide').disabled, false);

  kit.click('play-toggle');
  await kit.settle(0);
  assert.equal(kit.text('play-toggle'), 'Reproduzir');
  assert.equal(kit.byId('play-toggle').getAttribute('aria-label'), 'Reproduzir conteúdo');
  assert.equal(kit.status(), '1 de 3 · Pausado');
  assert.equal(kit.text('announcement'), 'Reprodução pausada.');
  await kit.settle(120_000);
  assert.equal(kit.topId(), 'a', 'pausado, o conteúdo não muda sozinho');

  kit.click('next-slide');
  await kit.settle(0);
  assert.equal(kit.topId(), 'b', 'Próximo funciona com a exibição pausada');
  assert.equal(kit.status(), '2 de 3 · Pausado');
  kit.click('previous-slide');
  await kit.settle(0);
  assert.equal(kit.topId(), 'a');
  kit.click('previous-slide');
  await kit.settle(0);
  assert.equal(kit.topId(), 'c', 'Anterior dá a volta');
  kit.click('next-slide');
  await kit.settle(0);
  assert.equal(kit.topId(), 'a', 'Próximo também dá a volta');

  kit.click('play-toggle');
  await kit.settle(0);
  assert.equal(kit.text('play-toggle'), 'Pausar');
  assert.equal(kit.text('announcement'), 'Reprodução retomada.');
  assert.equal(kit.status(), '1 de 3 · Em exibição');
  await kit.settle(9_999);
  assert.equal(kit.topId(), 'a');
  await kit.settle(1);
  assert.equal(kit.topId(), 'b', 'retomou: o tempo do conteúdo conta por inteiro');
}));

test('com um único conteúdo, Anterior e Próximo ficam desativados e o conteúdo se repete sem trocar', () => withKit({ manifestItems: [entry('solo', { duration: 5 })] }, async kit => {
  await kit.settle(0);
  assert.equal(kit.byId('next-slide').disabled, true);
  assert.equal(kit.byId('previous-slide').disabled, true);
  assert.equal(kit.byId('play-toggle').disabled, false);
  const layer = kit.topLayer();
  await kit.settle(60_000);
  assert.equal(kit.topLayer(), layer, 'a mesma camada: recomeça no lugar, sem piscar');
  assert.equal(kit.layers().length, 1);
  assert.equal(kit.status(), '1 de 1 · Em exibição');
}));

test('teclado: K/Espaço pausam, N avança, P volta; botão em foco, campo de texto, modificadores e janela aberta não disparam atalhos', () => withKit({ manifestItems: abc() }, async kit => {
  await kit.settle(0);
  assert.equal(kit.key('n').defaultPrevented, true);
  await kit.settle(0);
  assert.equal(kit.topId(), 'b');
  kit.key('P');
  await kit.settle(0);
  assert.equal(kit.topId(), 'a');
  kit.key('MediaTrackNext');
  await kit.settle(0);
  assert.equal(kit.topId(), 'b');
  kit.key('MediaTrackPrevious');
  await kit.settle(0);
  assert.equal(kit.topId(), 'a');

  kit.key('k');
  assert.equal(kit.text('play-toggle'), 'Reproduzir');
  kit.key('MediaPlayPause');
  assert.equal(kit.text('play-toggle'), 'Pausar');
  kit.key(' ');
  assert.equal(kit.text('play-toggle'), 'Reproduzir', 'espaço na página pausa');
  const onButton = kit.key(' ', { target: kit.byId('next-slide') });
  assert.equal(onButton.defaultPrevented, false, 'em um botão, o espaço é do botão');
  assert.equal(kit.text('play-toggle'), 'Reproduzir');
  kit.key(' ');
  assert.equal(kit.text('play-toggle'), 'Pausar');

  kit.key('n', { ctrlKey: true });
  kit.key('n', { metaKey: true });
  kit.key('n', { altKey: true });
  kit.key('n', { target: kit.byId('pair-code') });
  kit.byId('disconnect-dialog').open = true;
  kit.key('n');
  kit.byId('disconnect-dialog').open = false;
  kit.key('Enter');
  kit.key('ArrowRight'); // as setas ficam para a navegação entre botões do controle remoto
  await kit.settle(0);
  assert.equal(kit.topId(), 'a', 'nenhum destes teclas mudou o conteúdo');
}));

test('barra de controles: some depois de 6 s exibindo, volta ao mexer, e nunca some com foco nela ou com a exibição pausada', () => withKit({ manifestItems: abc() }, async kit => {
  const dock = kit.byId('control-dock');
  await kit.settle(5_999);
  assert.equal(dock.classList.contains('quiet'), false);
  await kit.settle(1);
  assert.equal(dock.classList.contains('quiet'), true);
  kit.document.dispatchEvent(new FakeEvent('pointermove'));
  assert.equal(dock.classList.contains('quiet'), false);
  await kit.settle(6_000);
  assert.equal(dock.classList.contains('quiet'), true);
  kit.key('Shift');
  assert.equal(dock.classList.contains('quiet'), false, 'qualquer tecla revela os controles');
  kit.byId('next-slide').focus();
  await kit.settle(6_000);
  assert.equal(dock.classList.contains('quiet'), false, 'com o foco nos botões, permanecem visíveis');
  kit.byId('next-slide').blur();
  kit.click('play-toggle');
  await kit.settle(6_000);
  assert.equal(dock.classList.contains('quiet'), false, 'pausado, permanecem visíveis');
}));

test('tela cheia e desconexão: alterna a tela cheia, pede confirmação para desconectar e remove a credencial', () => withKit({ manifestItems: abc() }, async kit => {
  await kit.settle(0);
  kit.click('fullscreen');
  await kit.settle(0);
  assert.equal(kit.text('fullscreen'), 'Sair da tela cheia');
  assert.equal(kit.byId('fullscreen').getAttribute('aria-label'), 'Sair da tela cheia');
  kit.click('fullscreen');
  await kit.settle(0);
  assert.equal(kit.text('fullscreen'), 'Tela cheia ⛶');
  kit.document.documentElement.requestFullscreen = async () => { throw new Error('negado'); };
  kit.click('fullscreen');
  await kit.settle(0);
  assert.match(kit.text('announcement'), /não permite tela cheia automática/);

  kit.click('disconnect');
  assert.equal(kit.byId('disconnect-dialog').open, true);
  assert.equal(kit.storage.get(TOKEN_KEY), 'device-token', 'só pedir para desconectar não remove nada');
  kit.click('cancel-disconnect');
  assert.equal(kit.byId('disconnect-dialog').open, false);
  assert.equal(kit.topId(), 'a');
  kit.click('disconnect');
  kit.click('confirm-disconnect');
  await kit.settle(0);
  assert.equal(kit.storage.get(TOKEN_KEY), null);
  assert.equal(kit.visible('pairing'), true);
  assert.equal(kit.visible('playback'), false);
  assert.equal(kit.layers().length, 0);
  assert.equal(kit.text('announcement'), 'Esta TV foi desconectada deste navegador.');
  assert.equal(kit.env.source.forgets, 1, 'os arquivos guardados na memória foram esquecidos');
  const requests = kit.server.requests.length;
  await kit.settle(120_000);
  assert.equal(kit.server.requests.length, requests, 'desconectada, a TV não consulta mais nada');
  assert.equal(kit.document.activeElement.id, 'pair-code');
}));

// ---- demonstração ---------------------------------------------------------------------------------------------------------------------
test('demonstração: usa o mesmo carrossel, sem servidor nem credencial, e "Voltar ao painel" volta ao painel', () => withKit({ search: '?demo=1', token: 'ignorado' }, async kit => {
  await kit.settle(0);
  assert.equal(kit.server.requests.length, 0);
  assert.equal(kit.visible('demo-badge'), true);
  assert.equal(kit.visible('playback'), true);
  assert.equal(kit.text('display-name'), 'TV Corporativa · Demonstração');
  assert.equal(kit.text('disconnect'), 'Voltar ao painel');
  assert.equal(kit.status(), 'Exemplo 1 de 3 · Em exibição');
  assert.equal(kit.topTitle(), 'Juntos, damos vida ao futuro.');
  await at(kit, 15_000);
  assert.equal(kit.topTitle(), 'Segurança começa com você.');
  assert.equal(kit.env.animations.length, 1, 'a demonstração mostra a transição de verdade');
  assert.deepEqual(kit.env.animations[0].keyframes, EFFECTS.fade.enter.keyframes);
  await kit.finishMotion();
  kit.click('play-toggle');
  assert.equal(kit.text('play-toggle'), 'Reproduzir');
  assert.equal(kit.status(), 'Exemplo 2 de 3 · Pausado');
  await kit.settle(60_000);
  assert.equal(kit.topTitle(), 'Segurança começa com você.');
  kit.click('next-slide');
  await kit.settle(0);
  assert.equal(kit.topTitle(), 'Sua ideia faz a diferença.');
  kit.click('disconnect');
  assert.deepEqual(kit.navigations, ['/']);
  assert.equal(kit.byId('disconnect-dialog').open ?? false, false, 'na demonstração não há credencial para remover');
  assert.equal(kit.server.requests.length, 0);
  assert.equal(kit.storage.data.size, 1, 'nada da demonstração é gravado (só a credencial que já existia)');
}));

// ---- credencial e segurança ----------------------------------------------------------------------------------------------------------
test('a credencial da TV só vai ao próprio servidor: endereço de mídia externo nunca recebe pedido, e o motivo aparece na tela', () => withKit({
  fakeSource: false, manifestItems: [entry('x', { url: 'https://evil.example/steal' }), entry('y', { url: '//evil.example/y' }), entry('z', { url: '/api/displays/1' })]
}, async kit => {
  await kit.settle(35_000);
  assert.deepEqual(kit.server.requests.filter(request => !request.path.startsWith('/api/player/')).map(request => request.path), [], 'nenhum pedido de mídia saiu');
  assert.ok(kit.server.requests.every(request => !request.path.includes('evil.example')));
  assert.equal(kit.visible('empty'), true);
  assert.equal(kit.text('empty-title'), 'Conteúdo indisponível nesta TV');
  assert.match(kit.text('empty-description'), /endereço de mídia não permitido/);
  assert.match(kit.text('empty-description'), /peça à TI uma versão em imagens ou vídeo/);
  assert.equal(kit.status(), 'Conteúdo indisponível');
  assert.equal(kit.byId('status-dot').classList.contains('warning'), true);
  assert.equal(kit.layers().length, 0);
  for (const id of ['play-toggle', 'next-slide', 'previous-slide']) assert.equal(kit.byId(id).disabled, true, id);
}));

test('revogação na consulta da programação: apaga conteúdo e credencial e volta ao pareamento, sem novas consultas', () => withKit({ manifestItems: abc() }, async kit => {
  await kit.settle(0);
  assert.equal(kit.topId(), 'a');
  kit.server.state.revoked = true;
  await at(kit, 20_000);
  assert.equal(kit.visible('pairing'), true);
  assert.equal(kit.visible('playback'), false);
  assert.equal(kit.layers().length, 0);
  assert.equal(kit.storage.get(TOKEN_KEY), null);
  assert.equal(kit.text('pair-error'), REVOKED_MESSAGE);
  assert.equal(kit.text('announcement'), REVOKED_MESSAGE);
  assert.equal(kit.document.activeElement.id, 'pair-code');
  const requests = kit.server.requests.length;
  await kit.settle(300_000);
  assert.equal(kit.server.requests.length, requests);
}));

test('revogação no sinal de vida (heartbeat) tem o mesmo efeito', () => withKit({ manifestItems: abc() }, async kit => {
  await kit.settle(0);
  kit.server.state.heartbeatStatus = 403;
  await at(kit, 20_000);
  assert.equal(kit.visible('pairing'), true);
  assert.equal(kit.storage.get(TOKEN_KEY), null);
  assert.equal(kit.layers().length, 0);
}));

test('revogação durante o download de um arquivo também desfaz o pareamento', () => withKit({ fakeSource: false, manifestItems: abc() }, async kit => {
  kit.server.state.mediaStatus = { a: 403 };
  await kit.settle(1);
  assert.equal(kit.visible('pairing'), true, 'o servidor negou o arquivo com 403: o acesso foi revogado');
  assert.equal(kit.storage.get(TOKEN_KEY), null);
  assert.equal(kit.text('pair-error'), REVOKED_MESSAGE);
  assert.equal(kit.layers().length, 0);
}));

// ---- queda de rede ----------------------------------------------------------------------------------------------------------------------
test('sem rede: segue exibindo até a autorização de 60 s vencer, tenta reconectar cada vez mais rápido e retoma do mesmo ponto', () => withKit({ manifestItems: [entry('a', { duration: 14 }), entry('b', { duration: 14 }), entry('c', { duration: 14 })] }, async kit => {
  await kit.settle(0);
  await at(kit, 1_000);
  kit.server.state.offline = true;
  await at(kit, 20_000); // 1ª tentativa sem resposta
  assert.equal(kit.topId(), 'b', 'continua exibindo');
  assert.equal(kit.status(), '2 de 3 · Em exibição · Reconectando…');
  assert.equal(kit.byId('status-dot').classList.contains('warning'), true);
  assert.equal(kit.text('announcement'), 'Sem resposta do servidor. Tentando reconectar.');

  // Tentativas em 20 s, 25 s (+5 s), 35 s (+10 s) e 55 s (+20 s); a próxima só em 75 s.
  const attempts = () => kit.server.requests.filter(request => request.path === '/api/player/manifest').length;
  assert.equal(attempts(), 2);
  await at(kit, 24_999); assert.equal(attempts(), 2);
  await at(kit, 25_000); assert.equal(attempts(), 3);
  await at(kit, 35_000); assert.equal(attempts(), 4);
  await at(kit, 55_000); assert.equal(attempts(), 5);
  assert.notEqual(kit.layers().length, 0);

  await at(kit, 59_999);
  assert.equal(kit.topId(), 'b', 'ainda dentro dos 60 s de autorização (b vai de 56 s a 70 s)');
  await at(kit, 60_000);
  assert.equal(kit.layers().length, 0, 'venceu: a tela é limpa para proteger o conteúdo');
  assert.equal(kit.visible('empty'), true);
  assert.equal(kit.text('empty-title'), 'Conexão interrompida.');
  assert.equal(kit.status(), 'Aguardando conexão');
  assert.equal(kit.byId('play-toggle').disabled, true);
  assert.equal(kit.env.source.forgets, 1, 'a memória de arquivos foi esquecida');
  assert.equal(kit.env.source.opened.length, kit.env.source.released.length, 'nenhum arquivo ficou aberto');
  assert.equal(kit.storage.get(TOKEN_KEY), 'device-token', 'sem rede não é revogação: a credencial fica');

  // A rede volta e a TV é avisada: consulta já e retoma no conteúdo em que estava (b), não no primeiro.
  kit.server.state.offline = false;
  kit.winEvent('online');
  await kit.settle(0);
  assert.equal(attempts(), 6);
  assert.equal(kit.topId(), 'b');
  assert.equal(kit.status(), '2 de 3 · Em exibição');
  assert.equal(kit.visible('empty'), false);
  assert.equal(kit.text('announcement'), 'Conexão restabelecida.');
  await at(kit, 73_999);
  assert.equal(kit.topId(), 'b');
  await at(kit, 74_000);
  assert.equal(kit.topId(), 'c', 'e a sequência segue normalmente');
}));

test('sem rede: a autorização vale no máximo 60 s contados da última consulta que deu certo, mesmo que o servidor informe um prazo maior', () => withKit({ manifestItems: abc({ duration: 14 }) }, async kit => {
  await kit.settle(0);
  kit.server.state.validityMs = 600_000; // um servidor (ou uma configuração) que prometesse 10 minutos
  await at(kit, 20_000); // a consulta seguinte recebe a promessa de 10 minutos
  kit.server.state.offline = true;
  await at(kit, 79_999);
  assert.notEqual(kit.layers().length, 0, 'ainda dentro dos 60 s da última consulta que deu certo');
  await at(kit, 80_000);
  assert.equal(kit.layers().length, 0, 'a TV não confia em mais que 60 s sem falar com o servidor: a tela é limpa');
  assert.equal(kit.text('empty-title'), 'Conexão interrompida.');
  assert.equal(kit.env.source.opened.length, kit.env.source.released.length, 'nenhum arquivo ficou aberto');
}));

test('sem rede: a demora da última consulta é descontada da validade — vale 60 s contados do pedido, não da resposta', () => withKit({ manifestItems: abc({ duration: 14 }) }, async kit => {
  await kit.settle(0);
  kit.server.state.delayMs = 10_000; // o servidor passa a responder devagar
  await at(kit, 30_000); // a consulta pedida aos 20 s só foi respondida aos 30 s
  kit.server.state.delayMs = 0;
  kit.server.state.offline = true;
  await at(kit, 79_999);
  assert.notEqual(kit.layers().length, 0, 'ainda dentro dos 60 s contados do pedido feito aos 20 s');
  await at(kit, 80_000);
  assert.equal(kit.layers().length, 0, 'a tela é limpa aos 80 s, e não aos 90 s (contando da resposta)');
  assert.equal(kit.text('empty-title'), 'Conexão interrompida.');
}));

test('TV que acorda de uma suspensão com a autorização já vencida limpa a tela na hora, antes de qualquer consulta ao servidor', () => withKit({ manifestItems: abc({ duration: 14 }) }, async kit => {
  await at(kit, 5_000);
  assert.notEqual(kit.layers().length, 0);
  kit.server.state.offline = true; // e sem rede ao acordar
  kit.suspend(70_000); // o relógio andou 70 s, mas nenhum prazo disparou: o aparelho estava suspenso
  assert.notEqual(kit.layers().length, 0, 'enquanto ninguém olha o relógio, a tela ainda está como estava');
  kit.document.dispatchEvent(new FakeEvent('visibilitychange'));
  assert.equal(kit.layers().length, 0, 'ao acordar, os 60 s de autorização já tinham passado: a tela é limpa antes de qualquer resposta do servidor');
  assert.equal(kit.text('empty-title'), 'Conexão interrompida.');
  assert.equal(kit.env.source.opened.length, kit.env.source.released.length, 'nenhum arquivo ficou aberto');
}));

test('TV que acorda de uma suspensão ainda dentro dos 60 s de autorização segue exibindo', () => withKit({ manifestItems: abc({ duration: 14 }) }, async kit => {
  await at(kit, 5_000);
  kit.server.state.offline = true;
  kit.suspend(30_000);
  kit.document.dispatchEvent(new FakeEvent('visibilitychange'));
  assert.notEqual(kit.layers().length, 0, 'ainda vale: nada é apagado');
  assert.equal(kit.visible('empty'), false);
}));

test('TV ligada sem conexão: mostra "Conexão interrompida" e começa sozinha na tentativa seguinte, quando a rede chegar', () => withKit({ start: false, manifestItems: abc() }, async kit => {
  kit.server.state.offline = true;
  kit.begin();
  await kit.settle(0);
  assert.equal(kit.text('empty-title'), 'Conexão interrompida.');
  assert.equal(kit.status(), 'Aguardando conexão');
  assert.equal(kit.layers().length, 0);
  kit.server.state.offline = false;
  await kit.settle(4_999);
  assert.equal(kit.layers().length, 0, 'a nova tentativa vem em 5 s');
  await kit.settle(1);
  assert.equal(kit.topId(), 'a');
  assert.equal(kit.visible('empty'), false);
  assert.equal(kit.status(), '1 de 3 · Em exibição');
}));

test('consultas: a cada 20 s com sinal de vida; ao voltar à página, ao voltar a rede ou da memória do navegador, consulta já', () => withKit({ manifestItems: abc() }, async kit => {
  const manifests = () => kit.server.count('/api/player/manifest');
  const beats = () => kit.server.count('/api/player/heartbeat');
  await at(kit, 100_000);
  assert.equal(manifests(), 6);
  assert.equal(beats(), 6);
  kit.document.hidden = true;
  kit.document.dispatchEvent(new FakeEvent('visibilitychange'));
  await kit.settle(0);
  assert.equal(manifests(), 6, 'escondida, não consulta fora de hora');
  kit.document.hidden = false;
  kit.document.dispatchEvent(new FakeEvent('visibilitychange'));
  await kit.settle(0);
  assert.equal(manifests(), 7);
  kit.winEvent('pageshow', { persisted: false });
  await kit.settle(0);
  assert.equal(manifests(), 7);
  kit.winEvent('pageshow', { persisted: true });
  await kit.settle(0);
  assert.equal(manifests(), 8);
  kit.winEvent('pagehide', { persisted: true });
  await at(kit, 140_000);
  assert.ok(manifests() >= 9, 'a página que vai para a memória do navegador não é encerrada');
  assert.equal(kit.topId() !== null, true);
}));

test('programação inválida do servidor conta como falha de conexão, sem derrubar o que está na tela', () => withKit({ manifestItems: abc() }, async kit => {
  await kit.settle(0);
  assert.equal(kit.topId(), 'a');
  const good = kit.server.state.items;
  kit.server.state.items = 'não é uma lista';
  await at(kit, 20_000);
  assert.equal(kit.status().endsWith(' · Reconectando…'), true);
  assert.notEqual(kit.topId(), null, 'o conteúdo segue na tela');
  kit.server.state.items = good;
  await at(kit, 25_000);
  assert.equal(kit.status().includes('Reconectando'), false, 'a resposta boa limpa o aviso');
}));

// ---- vídeo ---------------------------------------------------------------------------------------------------------------------------
test('vídeo: com som, sem controles; com "duração do vídeo" avança quando ele termina; com tempo definido, o tempo é um limite', () => withKit({
  scripts: { natural: { duration: 8.5 }, limit: { duration: 20 }, short: { duration: 3 } },
  manifestItems: [video('natural', { durationMode: 'natural', duration: 60 }), video('limit', { duration: 5 }), video('short', { duration: 30 }), entry('end')]
}, async kit => {
  await kit.settle(0);
  const first = kit.topLayer().querySelector('video');
  assert.equal(first.muted, false);
  assert.equal(first.volume, 1);
  assert.equal(first.controls, false);
  assert.equal(first.paused, false, 'está tocando');
  await at(kit, 8_499);
  assert.equal(kit.topId(), 'natural');
  await at(kit, 8_500);
  first.dispatchEvent(new FakeEvent('ended'));
  // Troca em corte seco para um vídeo: o vídeo novo entra quase transparente por cima e o antigo sai 3 quadros (48 ms) depois, quando o
  // navegador já o apresentou (sem isso haveria um quadro com o palco vazio).
  await kit.settle(0);
  assert.deepEqual(shownIds(kit), ['natural', 'limit'], 'durante os 3 quadros o vídeo que acabou ainda está à vista, sob o novo');
  await kit.settle(48);
  assert.deepEqual(shownIds(kit), ['limit'], 'terminou: o próximo entra na hora');
  await at(kit, 8_500 + 4_999);
  assert.equal(kit.topId(), 'limit');
  await at(kit, 8_500 + 5_000 + 48);
  assert.deepEqual(shownIds(kit), ['short'], 'o limite de 5 s cortou o vídeo de 20 s');
  await at(kit, 8_500 + 5_000 + 2_999);
  assert.equal(kit.topId(), 'short');
  await at(kit, 8_500 + 5_000 + 3_000);
  assert.equal(kit.topId(), 'end', 'vídeo mais curto que o limite: termina na duração dele (3 s), não nos 30 s');
}));

test('vídeo com duração natural que nunca avisa que terminou: o prazo de segurança (duração + 2 s) não deixa o carrossel preso', () => withKit({
  scripts: { v: { duration: 8 } }, manifestItems: [video('v', { durationMode: 'natural', duration: 60 }), entry('b')]
}, async kit => {
  await at(kit, 9_999);
  assert.equal(kit.topId(), 'v');
  await at(kit, 10_000);
  assert.equal(kit.topId(), 'b');
}));

test('vídeo que o aparelho não consegue tocar é pulado com o motivo, e os demais conteúdos continuam', () => withKit({
  scripts: { v: { error: 4 } }, manifestItems: [entry('a'), video('v'), entry('c')]
}, async kit => {
  await kit.settle(0);
  assert.equal(kit.status(), '1 de 3 · Em exibição · 1 conteúdo pulado');
  assert.equal(kit.text('playback-note'), `Conteúdo pulado: V (${skipReasonText('decode')}).`);
  assert.match(kit.text('announcement'), /V não pôde ser exibido \(formato ou arquivo não suportado por esta TV\) e foi pulado\./);
  await at(kit, 10_000);
  assert.equal(kit.topId(), 'c');
  await at(kit, 20_000);
  assert.equal(kit.topId(), 'a');
  kit.byId('announcement').textContent = '';
  await at(kit, 120_000);
  assert.equal(kit.text('announcement'), '', 'o aviso de "pulado" não se repete a cada volta');
}));

test('aviso de conteúdo pulado: mostra sempre o que foi pulado por último — também quando o mesmo conteúdo falha de novo depois de outro', () => withKit({
  scripts: { p: { error: 4 }, q: { error: 4 } }, manifestItems: [entry('a'), video('p'), entry('d'), video('q')]
}, async kit => {
  await kit.settle(0);
  assert.equal(kit.status(), '1 de 4 · Em exibição · 1 conteúdo pulado');
  assert.equal(kit.text('playback-note'), `Conteúdo pulado: P (${skipReasonText('decode')}).`);
  await at(kit, 10_000); // "d" na tela; "q" é preparado só agora e também falha
  assert.equal(kit.status(), '3 de 4 · Em exibição · 2 conteúdos pulados');
  assert.equal(kit.text('playback-note'), `Conteúdo pulado: Q (${skipReasonText('decode')}).`, 'o mais recente é o "Q", não o primeiro da lista');
  await at(kit, 30_000); // o "P" volta a ser tentado (30 s depois da falha) e falha de novo, antes de o "Q" ser tentado outra vez
  assert.equal(kit.text('playback-note'), `Conteúdo pulado: P (${skipReasonText('decode')}).`, 'e agora o mais recente é o "P" outra vez');
  assert.equal(kit.status().endsWith('2 conteúdos pulados'), true, 'continuam sendo dois conteúdos, não três');
}));

// ---- repetição e programação ------------------------------------------------------------------------------------------------------------------
test('repetição desligada: ao fim da sequência o último conteúdo fica na tela, e "Reiniciar" recomeça', () => withKit({ loop: false, manifestItems: [entry('a'), entry('b')] }, async kit => {
  await at(kit, 10_000);
  assert.equal(kit.topId(), 'b');
  await at(kit, 20_000);
  assert.equal(kit.topId(), 'b', 'não volta ao início');
  assert.equal(kit.status(), '2 de 2 · Sequência concluída');
  assert.equal(kit.text('play-toggle'), 'Reiniciar');
  assert.equal(kit.byId('play-toggle').getAttribute('aria-label'), 'Reiniciar a sequência');
  assert.equal(kit.text('announcement'), 'A sequência terminou.');
  await at(kit, 120_000);
  assert.equal(kit.topId(), 'b', 'e continua assim');
  assert.equal(kit.visible('empty'), false);
  kit.click('play-toggle');
  await kit.settle(0);
  assert.equal(kit.topId(), 'a');
  assert.equal(kit.text('play-toggle'), 'Pausar');
  // Ligar a repetição na programação faz a TV seguir sozinha.
  await at(kit, 140_000);
  assert.equal(kit.status(), '2 de 2 · Sequência concluída');
  kit.server.state.loop = true;
  await at(kit, 160_000);
  assert.notEqual(kit.status(), '2 de 2 · Sequência concluída');
  assert.equal(kit.text('play-toggle'), 'Pausar');
}));

test('programação nova: entra com o efeito do primeiro conteúdo sobre o que estava na tela; a mesma programação nunca reinicia', () => withKit({ manifestItems: [entry('a', { duration: 8 }), entry('b', { duration: 8 })] }, async kit => {
  await at(kit, 1_000);
  kit.server.state.items = [entry('x', { duration: 8, transition: 'fade', transitionMs: 600 }), entry('y', { duration: 8 })];
  await at(kit, 20_000); // consulta em 20 s: troca de programação (a tela mostrava "a")
  assert.equal(kit.topId(), 'x');
  assert.deepEqual(shownIds(kit), ['a', 'x'], 'sem tela vazia: o novo entra sobre o antigo');
  assert.deepEqual(kit.env.animations.at(-1).keyframes, EFFECTS.fade.enter.keyframes);
  await kit.finishMotion();
  assert.deepEqual(shownIds(kit), ['x']);
  assert.equal(kit.status(), '1 de 2 · Em exibição');
  await at(kit, 28_000);
  assert.equal(kit.topId(), 'y');
  await at(kit, 40_000); // outra consulta, a mesma programação: segue sem reiniciar
  assert.equal(kit.topId(), 'x');
  await at(kit, 43_000);
  assert.equal(kit.topId(), 'x');
}));

test('programação vazia: a TV diz que está pronta e começa a exibir quando um conteúdo for programado', () => withKit({ manifestItems: [] }, async kit => {
  await kit.settle(0);
  assert.equal(kit.visible('empty'), true);
  assert.equal(kit.text('empty-title'), 'Tudo pronto por aqui.');
  assert.equal(kit.text('empty-description'), 'Nenhum conteúdo aprovado está programado para esta TV neste momento.');
  assert.equal(kit.status(), 'Aguardando programação');
  assert.equal(kit.byId('play-toggle').disabled, true);
  kit.server.state.items = abc();
  await at(kit, 20_000);
  assert.equal(kit.topId(), 'a');
  assert.equal(kit.visible('empty'), false);
  kit.server.state.items = [];
  await at(kit, 40_000);
  assert.equal(kit.layers().length, 0, 'programação encerrada: a tela é limpa');
  assert.equal(kit.text('empty-title'), 'Tudo pronto por aqui.');
}));

test('queda de energia ou página recarregada: volta ao conteúdo em que estava, se for a mesma programação e a queda foi curta', async () => {
  const storage = createMemoryStorage();
  const clock = createFakeClock();
  const first = createPlayerKit({ storage, clock, manifestItems: abc() });
  await at(first, 25_000);
  assert.equal(first.topId(), 'c');
  first.winEvent('pagehide', { persisted: false });
  await first.close();

  const second = createPlayerKit({ storage, clock, manifestItems: abc() });
  await second.settle(0);
  assert.equal(second.topId(), 'c', 'retomou onde estava');
  second.winEvent('pagehide', { persisted: false });
  await second.close();

  await clock.advance(11 * 60_000);
  const third = createPlayerKit({ storage, clock, manifestItems: abc() });
  await third.settle(0);
  assert.equal(third.topId(), 'a', 'passou muito tempo: recomeça do primeiro');
  third.winEvent('pagehide', { persisted: false });
  await third.close();

  const fourth = createPlayerKit({ storage, clock, manifestItems: [entry('x'), entry('y')] });
  await fourth.settle(0);
  assert.equal(fourth.topId(), 'x', 'programação diferente: recomeça do primeiro');
  await fourth.close();
});

// ---- falhas de conteúdo e recuperação -------------------------------------------------------------------------------------------------------
test('nenhum conteúdo pode ser exibido: a TV explica, tenta de novo a cada 10 s e volta sozinha quando o problema some', () => withKit({
  scripts: { a: { decode: 'fail' }, b: { decode: 'fail' } }, manifestItems: [entry('a'), entry('b')]
}, async kit => {
  await kit.settle(0);
  assert.equal(kit.visible('empty'), true);
  assert.equal(kit.text('empty-title'), 'Conteúdo indisponível nesta TV');
  assert.match(kit.text('empty-description'), /não pôde ser exibido \(formato ou arquivo não suportado por esta TV\)/);
  assert.match(kit.text('empty-description'), /A TV tentará novamente em alguns segundos/);
  assert.equal(kit.status(), 'Conteúdo indisponível');
  assert.equal(kit.text('announcement'), 'Nenhum conteúdo pôde ser exibido. A TV tentará novamente.');
  const opened = () => kit.env.source.opened.length;
  const before = opened();
  await at(kit, 9_999);
  assert.equal(opened(), before, 'espera 10 s entre as tentativas');
  await at(kit, 10_000);
  assert.ok(opened() > before);
  assert.equal(kit.visible('empty'), true);

  delete kit.scripts.a; // o arquivo foi corrigido
  await at(kit, 20_000);
  assert.equal(kit.visible('empty'), false);
  assert.equal(kit.topId(), 'a');
  assert.equal(kit.text('announcement'), 'A exibição foi retomada.');
  assert.equal(kit.status().startsWith('1 de 2 · Em exibição'), true);
  assert.equal(kit.byId('play-toggle').disabled, false);
}));

test('arquivo que falha de forma passageira é tentado de novo sozinho, sem aparecer como pulado', () => withKit({ fakeSource: false, manifestItems: [entry('a'), entry('b')] }, async kit => {
  kit.server.state.mediaStatus = { a: 503 };
  await kit.settle(0);
  assert.equal(kit.layers().length, 0, 'ainda tentando');
  assert.equal(kit.text('empty-title'), 'Preparando a exibição…');
  delete kit.server.state.mediaStatus.a; // o servidor se recupera antes da 2ª tentativa (1 s depois)
  await kit.settle(1_100);
  assert.equal(kit.shownLayers().length, 1, 'a 2ª tentativa deu certo');
  assert.equal(kit.status(), '1 de 2 · Em exibição');
  assert.equal(kit.visible('empty'), false);
}));

test('programação nova: os arquivos que saíram dela são esquecidos da memória da TV, e o que ficou não é baixado de novo', () => withKit({ fakeSource: false, manifestItems: abc({ duration: 5 }) }, async kit => {
  await at(kit, 11_000); // uma volta e um pouco mais: os três arquivos já passaram pela memória
  assert.equal(kit.player.cacheStats().entries, 3);
  assert.deepEqual(kit.server.downloads, ['a', 'b', 'c'], 'cada arquivo foi baixado uma vez');
  kit.server.state.items = [entry('a', { duration: 5 })]; // a programação passa a ter só o "a"
  await at(kit, 21_000); // a consulta de 20 s traz a programação nova
  assert.equal(kit.player.cacheStats().entries, 1, 'só o "a" ficou na memória; "b" e "c" saíram');
  assert.deepEqual(kit.server.downloads, ['a', 'b', 'c'], 'e o "a" não precisou ser baixado de novo');
  assert.equal(kit.topLayer().querySelector('img').alt, 'A', 'e a exibição segue, agora só com o "a"');
}));

// ---- encerramento --------------------------------------------------------------------------------------------------------------------------
test('ao fechar a página tudo é encerrado: prazos, pedidos em andamento, camadas e arquivos', () => withKit({ manifestItems: abc() }, async kit => {
  await at(kit, 15_000);
  kit.server.state.delayMs = 50_000;
  await at(kit, 20_000); // consulta em andamento (travada no servidor)
  kit.winEvent('pagehide', { persisted: false });
  await kit.settle(0);
  assert.equal(kit.clock.pending(), 0);
  assert.equal(kit.layers().length, 0);
  assert.ok(kit.server.requests.at(-1).signal.aborted, 'o pedido em andamento foi cancelado');
  const requests = kit.server.requests.length;
  await kit.settle(300_000);
  assert.equal(kit.server.requests.length, requests);
}));

// ---- o arquivo de entrada (public/player.js) ----------------------------------------------------------------------------------------------
test('public/player.js liga o player ao navegador de verdade (demonstração rodando sem nenhum ajuste de teste)', () => withKit({ start: false, token: '' }, async kit => {
  const assigned = [];
  const globals = {
    window: kit.win, location: { search: '?demo=1', assign: url => assigned.push(url) },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 16), cancelAnimationFrame: id => clearTimeout(id)
  };
  const saved = {};
  for (const [name, value] of Object.entries(globals)) { saved[name] = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
  try {
    await import(`../public/player.js?run=${process.hrtime.bigint()}`);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(kit.visible('playback'), true);
    assert.equal(kit.text('display-name'), 'TV Corporativa · Demonstração');
    assert.equal(kit.status(), 'Exemplo 1 de 3 · Em exibição');
    assert.equal(kit.topTitle(), 'Juntos, damos vida ao futuro.');
    kit.click('disconnect');
    assert.deepEqual(assigned, ['/'], 'o botão "Voltar ao painel" navega para o painel');
  } finally {
    kit.winEvent('pagehide', { persisted: false }); // encerra os temporizadores reais
    for (const [name, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
}));

// ---- integração com a API de verdade -----------------------------------------------------------------------------------------------------
test('fluxo integrado: parear, baixar os arquivos com a credencial da TV, exibir a programação na ordem e revogar, com a API real por HTTP', async () => {
  await withApp(async app => {
    const base = `http://127.0.0.1:${app.app.server.address().port}`;
    const first = await app.approvedMedia(app.admin, { name: 'primeiro.png', title: 'Primeiro', seed: 'p1' });
    const second = await app.approvedMedia(app.admin, { name: 'segundo.png', title: 'Segundo', seed: 'p2' });
    const created = await app.display(app.admin, { name: 'Recepção teste' });
    const playlist = await app.publishedPlaylist(app.admin, [first.id, second.id], { name: 'Comunicados' });
    await app.liveSchedule(app.admin, { playlistId: playlist.id, displayIds: [created.display.id] });

    const requests = [];
    const http = (path, init) => { requests.push({ path, authorization: init.headers?.get?.('Authorization') ?? null }); return fetch(new URL(path, base), init); };
    const kit = createPlayerKit({ token: '', fakeSource: false, http });
    const until = async (condition, label) => {
      for (let turn = 0; turn < 400; turn++) {
        await kit.clock.advance(0);
        if (condition()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.fail(`tempo esgotado esperando: ${label}`);
    };
    try {
      kit.type('pair-code', created.pairingCode);
      kit.byId('pair-form').dispatchEvent(new FakeEvent('submit', { cancelable: true }));
      await until(() => kit.topLayer() !== null, 'o primeiro conteúdo aparecer');
      assert.equal(kit.text('display-name'), 'Recepção teste');
      assert.equal(kit.topLayer().querySelector('img').alt, 'Primeiro');
      assert.match(kit.topLayer().querySelector('img').src, /^blob:/, 'o arquivo foi baixado e exibido a partir da memória');
      const stored = kit.storage.get(TOKEN_KEY);
      assert.ok(stored && stored.length >= 32, 'a credencial da TV fica guardada no aparelho');

      await until(() => requests.some(request => request.path === `/api/media/${second.id}/file`), 'o segundo arquivo ser pré-carregado');
      for (const download of requests.filter(request => request.path.startsWith('/api/media/'))) assert.equal(download.authorization, `Bearer ${stored}`, 'só com a credencial da TV');
      assert.ok(requests.filter(request => request.path === `/api/media/${first.id}/file`).length === 1, 'cada arquivo é baixado uma vez');

      await kit.clock.advance(15_000);
      await until(() => kit.topLayer()?.querySelector('img')?.alt === 'Segundo', 'o segundo conteúdo aparecer');
      await kit.clock.advance(15_000);
      await until(() => kit.topLayer()?.querySelector('img')?.alt === 'Primeiro', 'a sequência recomeçar');
      assert.equal(requests.filter(request => request.path === `/api/media/${first.id}/file`).length, 1, 'na segunda volta o arquivo vem da memória da TV, sem baixar de novo');
      assert.equal(kit.player.cacheStats().entries, 2);

      // Revogar a TV no painel: na próxima consulta a TV apaga conteúdo e credencial e volta ao pareamento.
      must(await app.call(`/api/displays/${created.display.id}`, { method: 'DELETE', session: app.admin }));
      await kit.clock.advance(20_000);
      await until(() => !kit.visible('playback'), 'a TV voltar ao pareamento');
      assert.equal(kit.visible('pairing'), true);
      assert.equal(kit.layers().length, 0);
      assert.equal(kit.storage.get(TOKEN_KEY), null);
      assert.equal(kit.player.cacheStats().entries, 0, 'a memória de arquivos foi esquecida');
    } finally {
      await kit.close();
    }
  }, { http: true });
});

test('fonte do código antigo não sobrou: o player não usa mais temporizadores soltos nem blobs globais', async () => {
  const source = await readFile(new URL('../public/player.js', import.meta.url), 'utf8');
  assert.ok(source.includes("from './js/player/app.js'"));
  assert.ok(!/blobUrl|slideTimer|AbortSignal\.any/.test(source));
});
