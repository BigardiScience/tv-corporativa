# Registro de mudanças

> Documento histórico da Fase 2: descreve o pacote 2.0.0-fase2 e suas verificações originais. As alterações e a validação da versão atual (2.4.0) estão em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md); as da 2.3.0, em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md); as da 2.2.0, em [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as da 2.1.0, em [RELATORIO-2.1.0.md](RELATORIO-2.1.0.md).

Este registro anota **tudo o que mudou** da versão 2.0.0-fase1 (Fase 1) para a **2.0.0-fase2** (Fase 2: carrossel e reprodução), elaborado em 23 de outubro de 2026. Ele responde "o que mudou e por quê". Para saber **quais arquivos** mudaram, veja [ARQUIVOS-DA-FASE-2.md](ARQUIVOS-DA-FASE-2.md); para o que foi **entregue, entregue só em teste e não feito**, veja [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md); para **como foi testado**, [VALIDACAO.md](VALIDACAO.md).

## 2.0.0-fase2: carrossel e reprodução

### Em uma olhada

| Tipo | Resumo |
| --- | --- |
| **Adicionado** | Motor de reprodução compartilhado (9 módulos); player da TV novo sobre esse motor; repetição por playlist; "Tempo do vídeo" (tempo definido ou até o fim); transições aplicadas de verdade (corte seco, esmaecer, dissolver, deslizar, zoom) com demonstração "Ver efeito"; pré-visualização em quatro pontos do painel; recuperação de falhas e retomada do ponto; migração 7; 253 testes novos, 2 cenários novos em navegador; 3 documentos novos |
| **Alterado** | O player da TV (reescrito, mesmo endereço e mesma credencial); a pré-visualização do painel (passa a usar o motor da TV); as linhas do editor de playlist, a revisão de publicação, os detalhes de versão e o formulário de programação; o manifesto da TV e as respostas de playlist (só acréscimos); 8 comportamentos do player em relação à Fase 1 (lista adiante); 10 arquivos de teste da Fase 1 (e um de apoio); 14 documentos (o `README.md` e 13 em `docs/`) |
| **Removido** | Nenhum arquivo e nenhuma funcionalidade. O código antigo do player foi **substituído**; os seis testes que a Fase 1 tinha para ele continuam, reescritos (veja a seção 2.5) |
| **Não mudou** | As 54 rotas, as 20 permissões, os perfis, a identidade visual (`public/styles.css` e `public/auth.css`), as variáveis de ambiente, o `Dockerfile`, os scripts de terminal, a CSP e todo o código do servidor fora de playlists e do manifesto da TV (lista na seção "O que não mudou") |
| **Não feito** | Duração individual por página de PDF (Fase 4); registro das falhas de reprodução no servidor (Fase 3); versão alternativa de conteúdo incompatível (Fase 4); teste em televisores reais (Fase 7) |

## 1. Adicionado

### 1.1 Motor de reprodução (`public/js/playback/`)

Um único motor, usado pela TV e pela pré-visualização do painel. Não conhece DOM, rede nem armazenamento: recebe tudo por parâmetro, o que permite testar tempo, ordem, falhas e recuperação em Node, com relógio de mentira.

| Arquivo | O que faz |
| --- | --- |
| `public/js/playback/carousel.js` | Decide **qual** conteúdo aparece, **quando** sai, **como** a troca acontece e o que fazer quando algo dá errado: sequência, repetição, pausa, anterior, próximo, pré-carregamento do próximo, conteúdo pulado e tentado de novo, programação nova, retomada |
| `public/js/playback/timing.js` | Regras de tempo: o tempo conta desde o início da entrada; vídeo com tempo definido é limite; vídeo "até o fim" tem prazo de segurança; um conteúdo nunca sai antes da própria transição de entrada acabar |
| `public/js/playback/effects.js` | Os cinco efeitos (só opacidade, deslocamento e escala; desfoque no dissolver), a simplificação por movimento reduzido ou aparelho lento e as regras que medem a fluidez |
| `public/js/playback/stage.js` | A tela do carrossel: uma camada por conteúdo, o próximo pronto por trás (imagem decodificada, vídeo carregado), troca com as animações do navegador, vídeo mudo e sem controles |
| `public/js/playback/loader.js` | Como o arquivo chega: download com a credencial da TV **somente** em `/api/media/<id>/file` do próprio servidor, prazos, conferência de tamanho, tentativas com espera crescente; no painel, usa o endereço direto |
| `public/js/playback/media-cache.js` | Memória (`Blob`) dos arquivos baixados, com teto de 96 MB e 32 arquivos, o mais antigo sai primeiro; nada em disco |
| `public/js/playback/recovery.js` | Guarda só a posição da exibição e uma assinatura curta da programação, para retomar depois de queda de energia ou recarga (validade de 10 minutos) |
| `public/js/playback/model.js` | Transforma o item do manifesto (ou do rascunho) em item do carrossel, com os mesmos limites do servidor |
| `public/js/playback/messages.js` | Textos, em português, do motivo de cada conteúdo pulado |

### 1.2 Player da TV

- **`public/js/player/app.js`** (novo): pareamento, consulta da programação a cada 20 s, sinal de vida, exibição pelo carrossel e recuperação. O navegador (documento, rede, relógio, armazenamento) entra por parâmetro, então o player inteiro roda nos testes.
- **Controles:** Anterior, Pausar/Reproduzir (Reiniciar quando a sequência acaba), Próximo, tela cheia e desconectar, com nome e estado para leitores de tela; somem depois de 6 s e nunca somem com foco neles ou com a exibição pausada. Teclado e controle remoto: **K**, **Espaço** ou tecla de mídia reproduzir/pausar; **N** ou tecla de mídia seguinte; **P** ou tecla de mídia anterior.
- **Avisos na própria tela:** posição ("2 de 5 · Em exibição"), conteúdo pulado e o motivo, "Reconectando…", "Efeito simplificado: movimento reduzido ativo", "Conteúdo indisponível nesta TV", e anúncios para leitores de tela.
- **Recuperação:** tentativas com espera crescente; conteúdo com defeito pulado e tentado de novo depois de 30 s; vídeo que quebra, trava (15 s sem avançar) ou o navegador recusa tocar é pulado; conteúdo que demora mais de 120 s para ficar pronto é abandonado; nenhum conteúdo exibível: a TV explica e tenta de novo a cada 10 s; queda de conexão: segue exibindo até a autorização vencer (60 s), reconecta a cada 5, 10 e 20 s e, vencida a autorização, para de exibir por segurança; ao voltar, retoma do ponto em que estava.
- **Desempenho do aparelho:** o player mede o intervalo entre quadros durante as trocas; duas trocas lentas seguidas passam todos os efeitos a esmaecer e mais duas, a corte seco; o nível é lembrado por 7 dias. Sem a API de animações do navegador, toda troca é corte seco; com "reduzir movimento" no sistema, todo efeito vira esmaecer. O motivo aparece na tela.
- **Verificação dos recursos mínimos:** se o navegador não tem módulos ES, `fetch`, `AbortController`, `Headers`, `Blob` ou `URL.createObjectURL`, a tela de pareamento diz o que falta em vez de ficar parada.
- **Demonstração (`?demo=1`):** continua existindo, agora com o mesmo carrossel, sem servidor nem credencial; "Voltar ao painel" volta ao painel.

### 1.3 Painel de playlists

- **Repetição:** caixa "Repetir a playlist continuamente" (ligada por padrão), com explicação do que a TV faz em cada estado, avisada a leitores de tela ao mudar; vale depois de salvar e de recarregar.
- **Tempo de cada conteúdo:** o campo numérico muda de nome conforme o conteúdo ("Duração (s)" em imagem e PDF, "Limite (s)" em vídeo com tempo definido, "Reserva (s)" em vídeo até o fim), com o nome acessível completo ("Limite (s) do vídeo “…”").
- **"Tempo do vídeo"** (só em vídeo): "Tempo definido (limite)" ou "Até o fim do vídeo", cada um com a sua explicação.
- **Transição:** cada efeito tem a sua explicação curta, ligada ao campo para leitores de tela; o campo "Efeito (ms)" vai de 0 a 3000 ms e o corte seco nunca leva duração.
- **"Ver efeito"** (`public/js/views/playlists/effect-demo.js`): abre uma demonstração com dois conteúdos de exemplo passando pelo mesmo motor da TV, com "Ver de novo", "Pausar", escolha do efeito e da duração e **"Usar este efeito"** (aplica só àquele conteúdo; fechar não aplica nada; quem só consulta vê os efeitos sem o botão de aplicar).
- **Aviso do PDF:** "PDF: o tempo vale para o documento inteiro; as páginas não passam sozinhas." (a troca de páginas depende da Fase 4).
- **Resumo do ciclo:** "um ciclo completo dura 50 s", "até 50 s" (há vídeo com limite) ou "50 s mais a duração do vídeo" (há vídeo até o fim); o tempo de reserva de um vídeo até o fim não entra na soma.
- **Pré-visualização antes de publicar,** em quatro pontos: o botão "Pré-visualizar" do editor (mostra o rascunho, mesmo não salvo), a revisão de publicação (mostra exatamente o que será publicado), os detalhes de uma versão e o formulário da programação ("Pré-visualizar esta versão"). Mesmo motor da TV; vídeo sem som; lista de conteúdos para saltar; motivo para o que não abre; sem repetição, termina no último conteúdo e oferece reiniciar.
- **Revisão de publicação e detalhes da versão** mostram a linha "Repetição" e o tempo/efeito de cada conteúdo na mesma redação do editor.
- Código novo do painel: `public/js/views/playlists/effect-demo.js` e `public/js/views/playlists/stage-host.js` (liga o motor da TV a uma área do painel; nada é guardado no navegador e o nível de efeitos fica sempre completo).

### 1.4 Servidor e banco

- **Migração 7** (`server/db/migrations/007-reproducao.mjs`, nome `reproducao-repeticao-e-duracao-natural`): acrescenta `loop_enabled` às playlists e às versões publicadas e `duration_mode` aos itens do rascunho e das versões publicadas, todos com `CHECK` e com o padrão que reproduz o que a Fase 1 fazia (repetir; tempo definido). Recria o gatilho que torna as versões publicadas imutáveis para proteger também a coluna nova. Confere, ao final, que todo registro antigo recebeu o padrão; se algum não recebeu, a migração inteira é desfeita.
- **Validação (`server/domain/playlists.mjs`):** `loop` só aceita verdadeiro ou falso (texto, `0` e `1` são recusados com `LOOP_INVALID`); `durationMode` só aceita `fixed` ou `natural`, e `natural` só em vídeo (`DURATION_MODE_INVALID`). Publicar copia a repetição e os modos para a versão imutável; restaurar uma versão copia a repetição dela para o rascunho.
- **Manifesto da TV (`server/domain/player.mjs`):** cada item ganha `durationMode`; o manifesto ganha `loop`, que é `false` somente quando todas as playlists ativas com conteúdo liberado para aquela TV estão com a repetição desligada.
- **Auditoria:** criar, alterar e publicar registram `loop: false` quando a repetição está desligada (e a mudança de repetição ao alterar). Nada sensível é registrado.

### 1.5 Testes

253 testes novos (de 224 para 477 testes automatizados no total; o player teve 6 testes trocados por 44) e 2 cenários novos em navegador (de 8 para 10; de 81 para 113 etapas). Os números por arquivo e os resultados estão em [VALIDACAO.md](VALIDACAO.md).

| Arquivo | Testes | O que cobre |
| --- | --- | --- |
| `tests/playback-core.test.mjs` | 23 | Regras puras de tempo, efeitos, modelo do item, simplificação por aparelho lento e memória do nível |
| `tests/playback-engine.test.mjs` | 38 | O carrossel com relógio de mentira: ordem, tempo, repetição, transições que nunca se sobrepõem, pré-carregamento, limites (inclusive 15 conteúdos em duas voltas) |
| `tests/playback-recovery.test.mjs` | 44 | Falhas e recuperação: rede, arquivo, vídeo, acesso revogado, programação nova, retomada |
| `tests/playback-loader.test.mjs` | 15 | Download, credencial só para o caminho local, estados HTTP, cache |
| `tests/playback-stage.test.mjs` | 32 | A tela do carrossel: imagem, PDF, vídeo, camadas, animações, liberação de recursos |
| `tests/player.test.mjs` | 44 | O player da TV inteiro (eram 6 testes na Fase 1): página, pareamento, exibição, controles, teclado, demonstração, revogação, queda de rede, autorização de 60 s (inclusive TV que acorda de uma suspensão), memória de arquivos, aviso do último conteúdo pulado, retomada |
| `tests/frame-analysis.test.mjs` | 15 | O analisador de quadros usado nos cenários em Chromium, com quadros sintéticos |
| `tests/playback-api.test.mjs` | 6 | Servidor: duração natural só para vídeo, repetição, versão publicada, auditoria, manifesto, migração 7 sobre banco gerado pela Fase 1 |
| `tests/panel-playlists.test.mjs` | 27 | Linhas do editor e janelas: nomes acessíveis, tempo do vídeo, "Ver efeito", pré-visualização, revisão de publicação, detalhes de uma versão e pré-visualização a partir do formulário da programação |
| `tests/panel-editor.test.mjs` | 9 | O editor de playlist: repetição, resumo do ciclo, envio e pré-visualização |
| `tests/frontend-models.test.mjs` | +3 | Modo de duração, resumo do ciclo e textos de tempo, formato entregue à pré-visualização |
| `tests/frontend-static.test.mjs` | +1 | O código que a TV executa não usa funções nem sintaxe de navegadores recentes |
| `tests/docs.test.mjs` | +2 | Anexo da Fase 2 conferido contra o pacote; documentos da Fase 1 declarados históricos |
| `tests/e2e/playback.e2e.mjs` | 16 etapas | A TV de verdade em Chromium: pareada, na ordem e no tempo de cada conteúdo, cada efeito medido nos pixels, sem quadro vazio, vídeo, queda de rede, retomada, controles e teclado |
| `tests/e2e/playlists-fase2.e2e.mjs` | 16 etapas | O editor em Chromium: tempo por tipo de conteúdo, repetição por teclado, tempo do vídeo, "Ver efeito", pré-visualização nos quatro pontos, perfis |

Apoio: `tests/helpers/fake-media-dom.mjs`, `tests/helpers/html-dom.mjs`, `tests/helpers/panel-kit.mjs`, `tests/helpers/playback-fakes.mjs`, `tests/helpers/player-kit.mjs`, `tests/e2e/frame-analysis.mjs`, `tests/e2e/playback-kit.mjs` e dois vídeos curtos de teste em `tests/fixtures/playback/`.

### 1.6 Documentação

- **Novos:** este registro, [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md) e [ARQUIVOS-DA-FASE-2.md](ARQUIVOS-DA-FASE-2.md); três capturas de tela em docs/imagens/ (`10-playlist-repeticao-e-efeitos.png`, `11-ver-efeito.png` e `12-previa.png`).
- **Atualizados:** [README.md](../README.md), [ARQUITETURA.md](ARQUITETURA.md), [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md), [MIGRACOES.md](MIGRACOES.md), [SEGURANCA.md](SEGURANCA.md), [IMPLANTACAO.md](IMPLANTACAO.md), [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md), [OPERACAO.md](OPERACAO.md), [PERMISSOES.md](PERMISSOES.md), [FORMATOS.md](FORMATOS.md), [FUNCIONALIDADES.md](FUNCIONALIDADES.md) e [VALIDACAO.md](VALIDACAO.md) (reescrito para a Fase 2). A captura docs/imagens/03-playlist.png foi refeita com os controles novos.
- **Históricos:** [RELATORIO-FASE-1.md](RELATORIO-FASE-1.md) e [ARQUIVOS-DA-FASE-1.md](ARQUIVOS-DA-FASE-1.md) ganharam um aviso de que descrevem o pacote 2.0.0-fase1 e apontam para os documentos atuais; o restante do texto não foi reescrito (os números que eles citam são os da Fase 1, fixados por teste).

## 2. Alterado

### 2.1 Comportamento do player em relação à Fase 1

Estas diferenças são **intencionais**. Se você contava com o comportamento antigo, leia a lista:

| # | Na Fase 1 | Na Fase 2 | Por quê |
| --- | --- | --- | --- |
| 1 | O conteúdo era baixado quando chegava a vez dele | O próximo é baixado e decodificado numa camada escondida enquanto o atual está na tela | Nunca uma tela vazia entre dois conteúdos |
| 2 | Cada arquivo era baixado de novo a cada passagem | O arquivo fica na memória da TV (até 96 MB e 32 arquivos) e é reaproveitado a cada volta | Menos rede; custa mais memória |
| 3 | O tempo do conteúdo contava depois de ele carregar | Conta desde o início da transição de entrada, e a soma dos tempos é a duração do ciclo; um conteúdo nunca sai antes de a própria transição acabar | Duração do ciclo previsível; duas transições nunca se sobrepõem |
| 4 | Conteúdo com defeito mostrava um cartão de falha por 8 s a cada volta | É pulado na hora, o motivo aparece na tela e só é tentado de novo depois de 30 s | A exibição não para por causa de um arquivo |
| 5 | Vídeo com tempo definido tocava até o fim ou até o limite | Igual (continua sendo limite); a novidade é a opção "Até o fim do vídeo" | Preserva o comportamento antigo |
| 6 | Qualquer troca era um corte seco | Corte seco **para um vídeo** tem uma preparação de 3 quadros: o vídeo entra por cima, quase transparente, e a camada antiga sai depois | Evita um quadro preto na troca |
| 7 | A sequência sempre repetia | A repetição é uma opção da playlist; o padrão (ligada) é o que sempre foi | Atende "loop infinito configurável" |
| 8 | Os efeitos de transição eram só gravados | Os efeitos são aplicados. Uma playlist antiga cujos itens já tinham efeito escolhido passa a exibi-lo | Atende "transições" |

Mais uma diferença, de requisito técnico: o player da Fase 1 usava `AbortSignal.any` e `AbortSignal.timeout`; o novo não usa (um teste confere), mas é carregado como módulo ES e usa a sintaxe `?.` e `??`. **Nenhuma TV foi testada**, então a lista de recursos é uma conferência, não uma garantia: teste o player novo em cada modelo, mesmo naqueles em que o da Fase 1 funcionava.

### 2.2 Painel

- A pré-visualização antiga (uma sequência de imagens sem efeito) deu lugar à do motor da TV (`public/js/views/playlists/preview.js` reescrito): agora aplica o tempo e o efeito de cada conteúdo, mostra o que está em exibição, deixa saltar para qualquer conteúdo e explica o que não abre.
- O texto de tempo na revisão de publicação, nos detalhes da versão e no resumo do editor passou a usar a mesma redação (`describeItem`, `cycleLabel`), que distingue tempo definido, limite e "até o fim do vídeo".
- `public/js/lib/playlist-model.js`: modos de duração, textos de ajuda, resumo do ciclo, limites (5 a 3600 s; 0 a 3000 ms) e o formato entregue à pré-visualização (`toPlaybackItems`, o mesmo do manifesto da TV).
- `public/panel.css`: regras das caixas e textos novos (repetição, ajuda dos campos, pré-visualização, demonstração de efeitos, alto contraste). A área de exibição da pré-visualização usa as mesmas regras de camada do player (`public/player.css`).

### 2.3 Player (arquivos)

- `public/player.js`: de um script de 248 linhas que fazia tudo, passou a ser um **módulo de 23 linhas** que liga o navegador real (documento, rede, relógio, armazenamento) a `startPlayer()`.
- `public/player.html`: o script é carregado como módulo (`type="module"`); novo botão "Anterior"; atalhos de teclado anunciados nos botões (`aria-keyshortcuts`); um campo de aviso ao lado do estado.
- `public/player.css`: reescrito para as camadas do carrossel, os avisos e os controles.

### 2.4 Servidor

- `server/domain/playlists.mjs`, `server/domain/player.mjs` e `server/db/migrations/index.mjs` (registra a migração 7). Nada mais do servidor foi tocado.
- `package.json`: só o número da versão (`2.0.0-fase2`). Nenhum script, nenhuma dependência.

### 2.5 Testes alterados

Dos 30 arquivos de teste da Fase 1 (22 suítes do Node e 8 arquivos de cenário para o navegador), 20 continuam **idênticos, byte a byte**. Os outros 10, mais um arquivo de apoio (`tests/helpers/http.mjs`), mudaram assim:

| Arquivo | O que mudou | Por quê |
| --- | --- | --- |
| `tests/database.test.mjs`, `tests/migrations.test.mjs` | Esquema esperado 6 → 7, backup `…-v0-para-v7`, lista de migrações 1 a 7 | Há uma migração nova; as demais conferências não mudaram |
| `tests/displays.test.mjs` | As chaves do manifesto e do item incluem `loop` e `durationMode` | O manifesto ganhou os dois campos (só acréscimos) |
| `tests/frontend-admin.test.mjs` | Versão da plataforma e esquema nos dados de exemplo (`2.0.0-fase2`, 7) | Dados de exemplo da tela Ambiente |
| `tests/frontend-models.test.mjs` | O envio de itens inclui `durationMode: 'fixed'`; três testes novos | O modelo de playlist envia o modo de duração |
| `tests/frontend-static.test.mjs` | O player da TV passa a ser ponto de entrada junto com o painel; a conferência de classes de estilo inclui `public/player.css`; o `<script>` do player é um módulo; um teste novo vigia o código da TV | O player agora tem módulos próprios |
| `tests/player.test.mjs` | **Reescrito:** de 6 para 44 testes. As garantias dos seis da Fase 1 (demonstração sem credencial, revogação, 60 s sem rede, endereços externos sem credencial, vídeo e limite, fluxo integrado por HTTP) continuam, escritas para o player novo (mapa em [VALIDACAO.md](VALIDACAO.md)) | O player foi substituído |
| `tests/docs.test.mjs` | Reestruturado: documentos da Fase 1 são históricos (números fixados), listas de arquivos conferidas por fase, versão atual conferida nos documentos da Fase 2 | Documentação de duas fases convivendo |
| `tests/helpers/http.mjs` | Acréscimo de `stripedPng` (PNG de listras, para medir desfoque na tela); `solidPng` continua gerando exatamente os mesmos bytes | O cenário de dissolver precisa de uma imagem que mostre desfoque |
| `tests/e2e/playlists.e2e.mjs` | Uma etapa (a da pré-visualização) espera a camada visível e o texto da posição mudarem, em vez de ler o texto no instante do clique | A pré-visualização agora prepara o próximo conteúdo em segundo plano |
| `tests/e2e/settings.e2e.mjs` | A versão esperada em "Ambiente e suporte" é lida de `package.json` em vez de escrita no teste | Evita repetir o número da versão a cada fase |

Nenhum teste da Fase 1 foi removido. Fora o player, as alterações acima trocam números, acrescentam campos ou separam documentos históricos. No player, duas verificações do código antigo descreviam um comportamento que mudou de propósito e foram trocadas pelas equivalentes novas: "o segundo conteúdo só é baixado na vez dele" (agora o próximo é baixado antes, item 1 da seção 2.1) e o cartão de falha por 8 s para um endereço externo (agora o conteúdo é pulado com o motivo na tela, item 4). No primeiro caso, o teste novo confere que o próximo conteúdo já está pronto por trás quando chega a vez dele; no segundo, continua conferido o que importava: o endereço externo **nunca** recebe pedido nem credencial.

## 3. Banco de dados

| Antes (esquema 6) | Depois (esquema 7) |
| --- | --- |
| `playlists` sem repetição | `playlists.loop_enabled` (0 ou 1; padrão 1) |
| `playlist_versions` sem repetição | `playlist_versions.loop_enabled` (0 ou 1; padrão 1) |
| `playlist_items` só com `duration_s` | `playlist_items.duration_mode` (`fixed` ou `natural`; padrão `fixed`) |
| `playlist_version_items` só com `duration_s` | `playlist_version_items.duration_mode` (`fixed` ou `natural`; padrão `fixed`) |
| Gatilho `playlist_version_items_immutable` protege as colunas da Fase 1 | O mesmo gatilho, recriado, protege também `duration_mode` |

A migração é automática, faz backup antes (`tvcorp-antes-da-migracao-…-v6-para-v7.sqlite`), roda inteira ou não roda, e confere que todo registro antigo recebeu o padrão. Detalhes e como ensaiar em [MIGRACOES.md](MIGRACOES.md).

## 4. API

**Nenhuma rota nova, nenhum caminho removido, nenhuma permissão nova.** Só acréscimos:

| Onde | Acréscimo |
| --- | --- |
| `POST /api/playlists`, `PATCH /api/playlists/:id` (entrada) | `loop` (booleano, opcional) e `durationMode` em cada item (`fixed` ou `natural`, opcional) |
| Respostas de playlist | `loop` na playlist e `durationMode` em cada item |
| `GET /api/playlists/:id/versions/:n` | `loop` na versão e `durationMode` em cada item |
| `GET /api/player/manifest` | `loop` na raiz e `durationMode` em cada item |
| Erros novos | `LOOP_INVALID` e `DURATION_MODE_INVALID` (HTTP 400) |

Requisições antigas, sem os campos novos, continuam valendo (omitir `loop` no `PATCH` mantém o valor atual). Um player da Fase 1 ignora os campos novos, mas **essa leitura não foi testada**. Detalhes em [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md).

## 5. Segurança

- O servidor continua sendo quem valida: os campos novos são conferidos no servidor e, de novo, por restrições `CHECK` do banco.
- Nenhuma permissão nova; repetição, modo de duração e transições fazem parte de editar o rascunho (`playlist:update`).
- A credencial da TV só vai a `/api/player/*` e a `/api/media/<id>/file` do próprio servidor; um endereço externo nunca recebe pedido, e o motivo aparece na tela.
- Os arquivos baixados ficam só em memória, com teto; o navegador da TV guarda a credencial (a mesma chave da Fase 1), a posição de retomada e o nível de efeitos do aparelho, nunca conteúdo.
- CSP inalterada (nenhum script em linha). Nenhuma senha, token ou credencial em código, registros ou exemplos (o teste de higiene continua valendo).
- A TV sem contato com o servidor por mais de 60 s deixa de exibir: é a regra de segurança da Fase 1, mantida.

Detalhes em [SEGURANCA.md](SEGURANCA.md).

## 6. O que não mudou

Conferido por comparação com o pacote da Fase 1:

- **Rotas e permissões:** as mesmas 54 rotas (método, caminho e forma de autenticação) e as mesmas 20 permissões, com os mesmos perfis.
- **Código do servidor fora de playlists e do manifesto da TV:** biblioteca, pastas, mídias, programações, TVs, usuários, sessões, auditoria, cabeçalhos de segurança, configuração e scripts de terminal. Nenhuma variável de ambiente nova; `.env.example`, `Dockerfile` e `.dockerignore` idênticos.
- **Identidade visual:** `public/styles.css`, `public/auth.css`, logotipo e imagens.
- **Dados:** nenhuma tabela foi apagada ou renomeada; nenhum dado existente muda de significado.
- **Testes da Fase 1:** 20 dos 30 arquivos idênticos, e os demais alterados como descrito na seção 2.5.
- **A entrega da Fase 1:** o ZIP da 2.0.0-fase1 já entregue não foi tocado. A Fase 2 foi feita numa cópia, e toda comparação deste registro e de [ARQUIVOS-DA-FASE-2.md](ARQUIVOS-DA-FASE-2.md) é contra esse mesmo pacote.

## 7. Atualizar da 2.0.0-fase1

1. Pare o servidor e **copie a pasta `data/` inteira** (é o seu backup manual).
2. Extraia esta versão em **outra pasta**, sem sobrescrever a antiga.
3. Copie para a pasta nova a pasta `data/` e o arquivo `.env`, se existirem.
4. Rode `npm.cmd run check` e `npm.cmd test` no seu computador (Node 24.19.0). Nada foi executado no Node 24 nem no Windows durante a validação.
5. Inicie com `npm.cmd start`. A migração 7 roda sozinha e cria o backup `…-v6-para-v7.sqlite`. As TVs pareadas continuam pareadas.
6. Teste em cada modelo de TV antes de divulgar (veja [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md)).

Para voltar à Fase 1, restaure o backup e use os arquivos da Fase 1: **não abra um banco já migrado com o código anterior** ([MIGRACOES.md](MIGRACOES.md)).

## 8. Fora do alcance da Fase 2

| Item | Situação |
| --- | --- |
| Duração individual por página de PDF | **Não feito**: depende da conversão de PDF da Fase 4. O PDF aparece inteiro, pelo tempo definido |
| Registro das falhas de reprodução no servidor e diagnóstico remoto | Fase 3 |
| Versão alternativa de um conteúdo incompatível | Fase 4 |
| Teste e homologação em televisores reais | Fase 7; **nenhuma TV foi usada**, e a compatibilidade com qualquer modelo não é declarada |
| Vídeo com som, pré-carregamento de vários conteúdos à frente, áudio | Não previstos nesta fase |

## Histórico de versões

| Versão | O que foi |
| --- | --- |
| **2.4.0** | Vídeo direto do servidor, por link temporário assinado, nas TVs que recusam o arquivo baixado; traz os pontos principais da 2.3.0 sobre a base 2.2.0 ([RELATORIO-2.4.0.md](RELATORIO-2.4.0.md)) |
| 2.3.0 | O Editor cria e publica programações ([RELATORIO-2.3.0.md](RELATORIO-2.3.0.md)) |
| 2.2.0 | MOV e JPEG no envio; Editor e Gestor geram o código de pareamento ([RELATORIO-2.2.0.md](RELATORIO-2.2.0.md)) |
| 2.1.0 | TVs compartilhadas com concessões e fila global, e o áudio do vídeo ([RELATORIO-2.1.0.md](RELATORIO-2.1.0.md)) |
| 2.0.0-fase2 | Fase 2: carrossel e reprodução (este registro) |
| 2.0.0-fase1 | Fase 1: arquitetura em módulos, SQLite com migrações, permissões individuais, perfis Gestor e Editor, biblioteca em pastas, playlists com rascunho e versões, programações, TVs com ativação e painel modular ([RELATORIO-FASE-1.md](RELATORIO-FASE-1.md)) |
| 1.1.0 | O código original recebido |
