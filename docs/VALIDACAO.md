# Validação — versão 2.4.0

Validação realizada em 6 de novembro de 2026, sobre o projeto desta entrega (versão 2.4.0: a base 2.2.0 com os pontos principais da 2.3.0 incorporados e a correção da reprodução de vídeo em TVs que recusam o arquivo baixado). Os relatórios das Fases 1 e 2, os da 2.1.0, da 2.2.0 e da 2.3.0 preservam registros históricos; seus resultados não são apresentados como uma execução desta atualização.

## Resultado

| Verificação | Resultado |
| --- | --- |
| Sintaxe (`npm run check`) | 204 arquivos JavaScript verificados; 0 falhas |
| Testes (`npm test`) | **588 testes automatizados: 588 passaram, 0 falharam, 0 ignorados** |
| Cenários em navegador (`npm run test:e2e`) | **13 cenários em navegador (138 etapas): 13 passaram, 0 falharam, 0 ignorados** |

Esses números vêm de uma execução em **Linux com Node.js v24.21.0** (veja o ambiente abaixo), não do ambiente de destino. Em Windows, cinco testes ficam ignorados, os mesmos da 2.2.0: dois dependem de terminal POSIX com Python e três usam um scanner auxiliar em shell Unix. Ignorado não é aprovado. Aqui, com Linux, nenhum foi ignorado.

**O que isso prova e o que não prova.** Prova que o código novo faz o que foi especificado (no servidor, no player e num Chromium de verdade com servidor real), que nada do que já existia deixou de funcionar e que a 2.3.0 e a 2.4.0 trabalham com os mesmos dados nos dois sentidos. **Não prova que a TV da recepção vai tocar o vídeo**: nenhum televisor foi usado e a recusa do arquivo baixado foi simulada. O reteste no aparelho, com o roteiro de [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md), é a validação que falta.

## Ambiente e o que ele não prova

- **Sistema e Node.js:** Ubuntu 24.04 (Linux) com 2 núcleos de processador e Node.js v24.21.0, que é a versão exigida pelo `package.json` (24 ou superior), com o SQLite nativo do Node. **Nada foi executado em Windows.** A validação registrada da 2.1.0 foi feita em Windows com Node.js v24.19.0; repita `npm.cmd run check` e `npm.cmd test` na sua máquina antes de usar o pacote.
- **Navegador:** Chromium 153 (versão 153.0.8010.12) do Playwright 1.63.0, sem janela (modo headless), com o servidor da própria entrega e bancos temporários de dados fictícios, criados e apagados a cada cenário. Não houve Firefox, Safari, Edge ou Chrome gerenciados.
- **Televisores:** nenhuma Smart TV, controle remoto, saída de som, servidor corporativo ou produção foi usado. O que o Chromium reproduz não prova que uma TV reproduz. A recusa do arquivo baixado pela TV da recepção (LG webOS, modelo 55UT801C0SA) foi **simulada** no Chromium: o endereço `blob:` é revogado antes do uso, o que produz a mesma classe de erro (código 4, estado de rede 3, estado de leitura 0). A compatibilidade dessa TV, e a de qualquer outro modelo, com o link direto **não foi validada**.
- **Som:** o Chromium roda sem saída de som, e nada foi ouvido. O som foi verificado pelo estado do elemento de vídeo (volume e mudo) e pelas chamadas de reprodução, não pelo que um aparelho emite.
- **HEVC:** o Chromium usado **não decodifica HEVC**. O MOV com HEVC foi verificado pela estrutura do arquivo (aceito no envio) e pelo caminho em que o aparelho não decodifica a imagem (o conteúdo é pulado com o motivo, sem quadro preto). A reprodução de HEVC num aparelho que o decodifica não foi observada.
- **Antivírus:** os testes de produção usam um scanner de mentira em shell, só para provar que arquivo não verificado não chega à TV. O antivírus real e sua configuração não foram homologados.
- **Proxy reverso:** nginx e Let's Encrypt não foram usados. O comportamento de `Range` e da parte `?t=` do endereço atravessando um proxy real não foi testado.
- **Dados dos ensaios de compatibilidade:** fictícios, criados pelo código da 2.3.0. Não são o seu banco de dados nem uma cópia dele; repita o ensaio de [MIGRACOES.md](MIGRACOES.md) com uma cópia dos seus dados.
- **Desempenho:** as medidas foram feitas em `localhost`, num computador de 2 núcleos. Não preveem a sua rede nem o aparelho.
- **Não há certificação ISO/IEC 27001 nem avaliação TISAX**; os testes de segurança verificam controles da aplicação, não a conformidade da organização.

## Critérios de aceite do escopo

Cada linha indica onde o critério está verificado. “Navegador” é o cenário em Chromium; “ensaio” é o ensaio de compatibilidade descrito em “Verificações feitas à parte”; os demais são testes automatizados em Node.js.

| Critério | Verificação |
| --- | --- |
| Vídeo que o aparelho recusa por decodificação toca pelo outro caminho (do arquivo baixado para o link direto, ou o contrário), uma única vez e sem intervenção, e a TV lembra o que funcionou | `tests/playback-direct.test.mjs`; navegador: `video-direto` |
| TV que já toca o arquivo baixado não muda: mesmo caminho, nenhuma gravação no navegador, nenhum pedido de link | `tests/playback-direct.test.mjs`; navegador: `video-direto` |
| Imagens e PDFs seguem como antes; rede, tempo esgotado, cancelamento e MOV sem imagem não trocam de caminho | `tests/playback-direct.test.mjs` |
| Servidor sem a rota do link (a 2.3.0 responde 401; o teste cobre também 404, 403 e falha de rede) ou que recusa o link: comportamento de antes e a TV continua pareada | `tests/playback-direct.test.mjs`; navegador: `video-direto`; ensaio |
| O link só abre o arquivo e a TV para os quais foi emitido; adulterado, vencido, repetido ou usado em outra rota é recusado (401) e nunca cai para a sessão do painel; o cabeçalho de credencial, quando presente, tem prioridade sobre o link | `tests/player-media-link.test.mjs`; ensaio |
| O link acompanha a programação, a credencial e o cadastro da TV, vale 6 horas e perde a validade quando o servidor reinicia | `tests/player-media-link.test.mjs` |
| Pedir o link não grava nada no banco, não gera auditoria e não altera o manifesto | `tests/player-media-link.test.mjs`; ensaio |
| A credencial da TV nunca vai para o endereço que o navegador usa para o vídeo | `tests/playback-direct.test.mjs`; navegador: `video-direto` |
| Codecs, formatos aceitos e tratamento de áudio da 2.2.0 não mudam, e o som (volume e mudo) de um vídeo que trocou de caminho é o de um que não trocou | `tests/playback-audio.test.mjs`; `tests/formats.test.mjs`; `tests/playback-direct.test.mjs`; comparação arquivo a arquivo com a 2.3.0 |
| A entrega de arquivos em blocos de 256 KB mantém o conteúdo idêntico em qualquer ponto, inteiro ou por trechos (`Range`) | `tests/player-media-link.test.mjs`; ensaio |
| O Editor programa e publica dentro do escopo, e os limites da 2.3.0 continuam valendo (setor e unidade, TVs liberadas, sem aprovar arquivos nem publicar playlists, retirada individual pela TI) | `tests/editor-schedules.test.mjs`; `tests/permissions.test.mjs`; `tests/pairing-permission.test.mjs`; `tests/shared-displays.test.mjs`; navegador: `editor-programacao` e `users` |
| Os critérios da 2.2.0 continuam valendo (MOV e JPEG no envio, conferência de conteúdo, código de pareamento sem desconectar a TV) | `tests/formats.test.mjs`; `tests/content-check.test.mjs`; `tests/panel-formats.test.mjs`; `tests/pairing-permission.test.mjs`; navegador: `formats` e `displays` |
| Dados existentes preservados, sem migração (esquema 8), com ida e volta entre a 2.3.0 e a 2.4.0 | `tests/migrations.test.mjs`; `tests/shared-displays-migration.test.mjs`; ensaio |
| Documentos conferidos com o código (rotas, permissões, formatos, contagens, links, prazo do link, bloco de leitura e chave da escolha lembrada) | `tests/docs.test.mjs` |

## Verificações feitas à parte

Foram feitas com scripts de apoio, **fora do ZIP**; os resultados estão aqui, mas a TI não consegue repeti-las só com o pacote. Para repetir a atualização, siga o ensaio de [MIGRACOES.md](MIGRACOES.md) com uma cópia dos seus dados.

**Ponto de partida conferido.** A cópia de trabalho foi conferida arquivo a arquivo contra o ZIP da 2.3.0 recebido (SHA-256 `40d86d5408186e39fea70958a4d5b5b7f8d7bf688706b0e7ecb5ae32452953fb`) antes de qualquer mudança: o mesmo conteúdo nos 277 arquivos. O conjunto de testes desse ZIP, sem nenhuma alteração, foi executado em Node.js v24.21.0 como linha de base: **558 testes, 558 passaram**, 0 falharam, 0 ignorados. A validação registrada da 2.3.0 foi feita em Node.js v22.23.4; esta é a primeira confirmação dela em Node.js 24. Os cenários em navegador da 2.3.0 não foram repetidos em separado: os 12 deles estão entre os 13 da 2.4.0, que rodaram inteiros e sem nenhuma alteração nesses arquivos.

### Ensaio de compatibilidade 2.3.0 ↔ 2.4.0

Com o código real da 2.3.0 (o ZIP recebido) foi criada, pela API, uma pasta de dados com as quatro contas (Administrador, Gestor, Editor e Visualizador), quatro arquivos aprovados (um PNG, um WebM, um MOV pequeno e um MOV de 900 KB, para cruzar as fronteiras de 256 KB da entrega), uma playlist publicada e uma TV pareada com programação no ar. Essa pasta foi aberta, como servidor de verdade, pelo código da 2.4.0 (rodada B); uma cópia idêntica foi aberta pela 2.3.0 como controle; e a pasta já usada pela 2.4.0 foi aberta de novo pela 2.3.0 (rodada C, a volta). Foram **101 verificações e nenhuma falhou**, em Node.js v24.21.0:

- **2.4.0 sobre dados da 2.3.0.** O `/healthz` e a linha de início informam a versão 2.4.0 e o esquema 8; **nenhuma migração e nenhum backup**; os arquivos originais ficaram intactos (conferidos pelo conteúdo) e a pasta só ganhou o arquivo enviado durante a rodada. As quatro pessoas entraram com a mesma senha e **com as mesmas permissões**; os registros das quatro mídias, a credencial da TV, o manifesto e o sinal de vida ficaram iguais, e a entrega pela credencial da TV foi igual à anterior, inteira e por trechos (início, fronteira de bloco de 256 KB e fim: 206). O conteúdo novo publicado chegou à TV e a cadeia de hashes da auditoria ficou íntegra (33 eventos).
- **Fluxo do link.** Emitido (200), entrega o arquivo **sem credencial** (200) e aceita trechos (206). Link adulterado é recusado; o link de um arquivo não abre outro (401); não vale em outra rota; sem credencial e sem link o pedido é recusado (401); uma pessoa logada no painel não consegue pedir link de TV (401). A página do player continua sendo servida para revalidação a cada carga (`no-cache`).
- **Controle (2.3.0).** O mesmo roteiro, sem o fluxo do link: a 2.3.0 responde **401** à rota do link quando é a TV que pede (404 quando é uma pessoa logada), e um link emitido pela 2.4.0 **não abre nada** nela (401). A 2.4.0 gravou as **mesmas tabelas e colunas** que a 2.3.0; a rota nova não grava nada.
- **Volta (2.3.0 sobre a pasta usada pela 2.4.0).** As quatro pessoas entram, as permissões e os registros das mídias são os mesmos, a TV continua pareada com a mesma credencial e mostra também o conteúdo criado durante a 2.4.0, os arquivos são entregues, o esquema continua 8, não houve backup e a auditoria (37 eventos) segue íntegra.

O ensaio fala HTTP com o servidor: não envolve navegador nem TV, e usa dados fictícios.

### Verificação por mutação do código novo

Em uma cópia descartável do projeto, **44 defeitos** foram introduzidos um a um nas regras novas (troca de caminho no palco, escolha lembrada, ligação no player, validação do endereço do link, assinatura, validade, revogação, escopo e autenticação), e depois de cada um rodaram os dois arquivos de teste do código novo (`tests/playback-direct.test.mjs` e `tests/player-media-link.test.mjs`); sem defeito algum, todos passam (é a linha de base). No Node.js 24, um teste que espera para sempre não termina sozinho; por isso a verificação usou `--test-timeout=30000`, e 2 defeitos foram detectados também por tempo esgotado (indicado na tabela: o teste ficou esperando). **39 foram detectados e 5 sobreviveram**; os que sobreviveram estão explicados depois da tabela.

| Defeito introduzido de propósito | Resultado |
| --- | --- |
| O palco nunca tenta o outro caminho quando o vídeo falha por decodificação | Detectado (8 testes falharam) |
| O palco troca de caminho para qualquer erro, não só decodificação | Detectado (1 teste falhou) |
| O palco nunca confirma que o vídeo tocou (a escolha nunca é lembrada) | Detectado (4 testes falharam) |
| O palco confirma o caminho antes de conferir que o MOV tem imagem | Detectado (1 teste falhou) |
| Depois da troca, o palco espera duas vezes o vídeo ficar pronto (espera eterna) | Detectado (4 testes falharam, um deles por tempo esgotado) |
| A troca de caminho silencia o vídeo | **Sobreviveu** (explicado abaixo) |
| A troca de caminho muda o volume do vídeo | **Sobreviveu** (explicado abaixo) |
| A fonte nunca passa a preferir o link direto depois que ele funciona | Detectado (4 testes falharam) |
| A fonte nunca volta a preferir o arquivo baixado depois que ele funciona | Detectado (3 testes falharam) |
| A escolha é gravada a cada confirmação, mesmo sem mudança | Detectado (2 testes falharam) |
| A escolha gravada é sempre “direto” | Detectado (2 testes falharam) |
| A fonte não lê a escolha gravada na abertura | Detectado (2 testes falharam) |
| Sem escolha gravada, a fonte começa pelo link direto | Detectado (10 testes falharam, um deles por tempo esgotado) |
| Falha ao ler a escolha gravada derruba a reprodução | Detectado (1 teste falhou) |
| Falha ao gravar a escolha derruba a reprodução | Detectado (1 teste falhou) |
| O arquivo que o aparelho recusou continua na memória do player | Detectado (2 testes falharam) |
| O endereço `blob:` recusado não é liberado na troca | Detectado (1 teste falhou) |
| Imagens também passam a usar o link direto | Detectado (2 testes falharam) |
| A fonte perde o limite de uma troca por vídeo | **Sobreviveu** (explicado abaixo) |
| O cancelamento não chega ao pedido do link | Detectado (2 testes falharam) |
| Preferindo o direto, o link que não vem não cai para o arquivo baixado | Detectado (3 testes falharam) |
| Falha do link na troca vira erro em vez de “sem outro caminho” | Detectado (2 testes falharam) |
| O endereço do link não é conferido (outro arquivo ou outro servidor passa) | Detectado (2 testes falharam) |
| O formato do parâmetro `t` do link não é conferido | Detectado (1 teste falhou) |
| O pedido ao servidor não solta o ouvinte de cancelamento | **Sobreviveu** (explicado abaixo) |
| O pedido ao servidor ignora o cancelamento externo | Detectado (1 teste falhou) |
| O player não liga o link direto à fonte | Detectado (5 testes falharam) |
| O player não liga a escolha lembrada à fonte | Detectado (1 teste falhou) |
| O player não lê a escolha lembrada do armazenamento | Detectado (1 teste falhou) |
| Um 401 ao pedir o link desparea a TV | Detectado (1 teste falhou) |
| O player grava a escolha na chave da credencial da TV | Detectado (1 teste falhou) |
| O modo de demonstração também grava a escolha lembrada | **Sobreviveu** (explicado abaixo) |
| O servidor não confere a assinatura do link | Detectado (3 testes falharam) |
| O servidor aceita link vencido | Detectado (1 teste falhou) |
| A assinatura não inclui o arquivo | Detectado (1 teste falhou) |
| A assinatura não inclui a credencial atual da TV | Detectado (1 teste falhou) |
| A assinatura não inclui a validade | Detectado (1 teste falhou) |
| O link é emitido sem conferir a programação ativa da TV | Detectado (2 testes falharam) |
| A chave de assinatura é fixa (não nasce a cada início do servidor) | Detectado (1 teste falhou) |
| O link de uma TV removida continua valendo | Detectado (1 teste falhou) |
| O link de uma TV que deixou de estar ativa continua valendo | Detectado (1 teste falhou) |
| Parâmetro `t` repetido na mesma URL é aceito | Detectado (1 teste falhou) |
| O link vale em qualquer rota autenticada | Detectado (1 teste falhou) |
| A rota que emite o link não exige a credencial da TV | Detectado (10 testes falharam) |

**Os que sobreviveram.** Nenhum dos cinco altera um comportamento que se possa observar pelos caminhos reais do programa:

- *A troca de caminho silencia o vídeo*: o palco reafirma o volume e o mudo logo antes de cada reprodução (`start()`, linha inalterada desde a 2.2.0); o que se faz com eles antes disso não chega ao som.
- *A troca de caminho muda o volume do vídeo*: o mesmo motivo do anterior.
- *A fonte perde o limite de uma troca por vídeo*: sem a trava, uma segunda chamada cai no tratamento de erro e devolve o mesmo “sem outro caminho”; só mudaria se viesse com o pedido já cancelado, o que o palco nunca faz (ele pede a troca uma única vez, e só com o pedido vivo).
- *O pedido ao servidor não solta o ouvinte de cancelamento*: só deixa de liberar um ouvinte ao fim do pedido; nenhum comportamento visível muda.
- *O modo de demonstração também grava a escolha lembrada*: no modo de demonstração o player só mostra conteúdo local, sem nenhum vídeo da biblioteca, então a fonte nunca consulta nem grava a escolha; a trava é redundante hoje.

Os dois primeiros merecem uma frase a mais, porque tocam o som. Nenhuma linha do tratamento de áudio (volume, mudo, autoplay, bloqueio de som) foi alterada em relação à 2.3.0: a diferença do palco está só na espera de “vídeo pronto” (que ganhou a troca de caminho) e na confirmação ao fim. O resultado que importa, o som de um vídeo que trocou de caminho, é guardado por testes que conferem a chamada de reprodução depois da troca (volume 1 e mudo conforme a escolha da pessoa), em `tests/playback-direct.test.mjs`.

### Verificação por mutação no navegador

Outros 9 defeitos, escolhidos entre os que mexem no que o navegador vê, foram avaliados só pelo cenário `video-direto` (as etapas que falharam estão contadas por defeito; “etapa” inclui a conferência final de que o console do navegador ficou sem erros):

| Defeito introduzido de propósito | Resultado |
| --- | --- |
| O palco nunca tenta o outro caminho quando o vídeo falha por decodificação | Detectado (2 etapas falharam) |
| O player não liga o link direto à fonte | Detectado (2 etapas falharam) |
| O player não liga a escolha lembrada à fonte | Detectado (2 etapas falharam) |
| O player não lê a escolha lembrada do armazenamento | Detectado (2 etapas falharam) |
| O player não grava a escolha lembrada | Detectado (2 etapas falharam) |
| A fonte nunca passa a preferir o link direto depois que ele funciona | Detectado (2 etapas falharam) |
| A escolha é gravada a cada confirmação, mesmo sem mudança (a TV comum passaria a gravar) | Detectado (2 etapas falharam) |
| O servidor ignora o parâmetro `t` (o link não autentica nada) | Detectado (2 etapas falharam) |
| O servidor não confere a assinatura do link (o vídeo ainda toca) | **Sobreviveu** (explicado abaixo) |

8 foram detectados e 1 sobreviveu. O que sobreviveu, o servidor deixar de conferir a assinatura, não muda nada que o navegador veja (um link válido continua válido); quem o detecta é o teste de unidade `tests/player-media-link.test.mjs` (defeito “O servidor não confere a assinatura do link” na tabela anterior).

### Desempenho

Duas medidas, com scripts de apoio fora do ZIP, num computador de 2 núcleos, com tudo em `localhost` e Node.js v24.21.0. Elas dizem o quanto o servidor e o player trabalham, não a velocidade da sua rede nem de um aparelho.

**Leitura do arquivo no servidor.** Um arquivo de 300 MB (dados aleatórios, já no cache do sistema) foi baixado com `curl` para `/dev/null`, 5 rodadas por tamanho de bloco alternando a ordem. Primeiro o mesmo encadeamento de leitura do `sendFile`, variando só o bloco; depois o `sendFile` real de cada versão (a 2.3.0 lia com o bloco padrão do Node, de 64 KB):

| Bloco de leitura | Rodadas (MB/s) | Mediana (MB/s) |
| --- | --- | --- |
| 16 KB | 248, 297, 284, 258, 279 | 279 |
| 64 KB (a 2.3.0) | 751, 779, 686, 764, 810 | 764 |
| **256 KB (a 2.4.0)** | 1172, 1201, 982, 1233, 1280 | 1201 |
| 1 MB | 1329, 1199, 1214, 1206, 1216 | 1214 |

| `sendFile` real | Rodadas (MB/s) | Mediana (MB/s) |
| --- | --- | --- |
| 2.3.0 | 664, 745, 779, 732, 714 | 732 |
| **2.4.0** | 1388, 1223, 1199, 1063, 998 | **1199** |

**Tempo até o primeiro quadro tocando.** Chromium com a rede limitada (limite de download e 20 ms de latência), um vídeo WebM de 17,2 MB, três rodadas por situação, contado do pareamento da TV até o vídeo tocando. “TV que recusa” é a recusa simulada do `blob:`; “escolha lembrada” é essa TV na segunda abertura da página.

| Rede | Arquivo baixado (TV comum): rodadas → mediana | TV que recusa, sem escolha lembrada | TV que recusa, com a escolha lembrada |
| --- | --- | --- | --- |
| 40 Mbit/s | 4,64, 4,51, 4,55 → **4,55 s** | 4,71, 4,66, 4,62 → **4,66 s** | 0,45, 0,51, 0,49 → **0,49 s** |
| 100 Mbit/s | 2,35, 2,37, 2,35 → **2,35 s** | 2,49, 2,38, 2,33 → **2,38 s** | 0,44, 0,45, 0,44 → **0,44 s** |

Leitura: o bloco de 256 KB rende cerca de 57% a mais que o de 64 KB e praticamente o mesmo que 1 MB. Quanto ao primeiro quadro, uma TV que recusa o arquivo baixado e ainda não tem a escolha lembrada gasta uma tentativa inteira e fica, em tempo, no mesmo patamar de uma TV comum; com a escolha lembrada o arquivo nem é baixado antes de o vídeo começar. **Isso não torna o caminho direto melhor para todos:** o arquivo baixado continua sendo o padrão porque deixa o vídeo seguinte pronto antes de entrar na tela e toca sem depender da rede durante a exibição.

### Verificações herdadas da 2.3.0 (não repetidas nesta entrega)

As verificações abaixo foram registradas na validação da 2.3.0, feitas com scripts de apoio sobre o código daquela versão. **Não foram repetidas aqui**: o que elas exercitam (permissões, programações, banco de dados e migrações) não foi tocado pela 2.4.0: nenhum arquivo dessas áreas mudou. No servidor mudaram só a autenticação do pedido de arquivo da TV (o parâmetro `?t=`), a rota e a emissão do link e a leitura do arquivo em blocos (a lista está em [ARQUIVOS-2.4.0.md](ARQUIVOS-2.4.0.md)). Os testes automatizados que protegem essas regras rodaram inteiros nesta validação e passaram. O ensaio de compatibilidade acima cobre a ida e a volta entre 2.3.0 e 2.4.0.

**Atualização 2.2.0 → 2.3.0 com dados criados pelo código real da 2.2.0.** Com uma cópia intacta do código da 2.2.0 entregue foram criados, pela API, o Administrador e seis contas (um Gestor; um Editor comum; um Editor com a concessão individual de criar rascunhos, que era a forma de a 2.2.0 permitir rascunhos; um Editor com a restrição individual de outra permissão; um Editor com a retirada de publicar programações pedida ainda na 2.2.0; e um Visualizador), três arquivos aprovados com suas playlists publicadas, uma TV pareada, uma programação do Gestor no ar e um rascunho da pessoa com a concessão individual. A mesma pasta de dados foi então aberta pelo código da 2.3.0. Resultado (o roteiro tem 67 verificações, contando a volta descrita adiante; nenhuma falhou):

- O esquema continua na versão 8; nenhuma migração foi aplicada e nenhum backup foi criado. Contas, arquivos, playlists, programações e cadastro da TV ficaram **idênticos, linha a linha**, e os arquivos de mídia no disco, byte a byte. A única diferença na pasta foram os arquivos auxiliares do SQLite (`-wal` e `-shm`) que existem enquanto o banco está aberto.
- Todas as contas entraram com a mesma senha. O Gestor não ganhou nada. O Editor comum ganhou `schedule:create` e `schedule:publish`. O Editor que tinha só a concessão de criar rascunhos ganhou `schedule:publish` (e passou a publicar). O Editor com a restrição de outra permissão manteve essa restrição e ganhou as duas. O Editor com a retirada antiga de `schedule:publish` **ganhou as duas**, porque a 2.2.0 não chegou a gravar essa retirada (a permissão não era padrão do perfil). O Visualizador não ganhou nada.
- A TV manteve a credencial, o manifesto e a entrega dos arquivos, e passou a mostrar “Destino autorizado” ao Editor. Logo depois de atualizar, o Editor comum publicou uma programação (201) e a TV a recebeu; a pessoa com a concessão antiga publicou o rascunho que já tinha (200); a TV passou a ter três programações.
- A TI retirou `schedule:publish` da pessoa que só rascunhava: o registro da conta ficou apenas com a retirada (a concessão antiga de criar, que virou padrão, foi descartada ao salvar) e o que ela tinha publicado saiu do ar. Ela continuou criando rascunho (201) e recebeu 403 `PERMISSION_DENIED` ao tentar publicar.
- A TI retirou as duas permissões de um Editor que já tinha publicado: a programação dele saiu do ar e o vínculo apareceu como suspenso para a TI, com o motivo “Responsável sem permissão para programar”. Devolver as permissões **não** recolocou no ar; interromper e publicar de novo (200 e 200) recolocou.
- O Editor continuou recebendo 403 ao aprovar um arquivo e ao publicar uma versão de playlist, não cadastrou TV e não leu a auditoria. A auditoria guardou o nome do Editor nos atos, e a cadeia de hashes ficou íntegra (53 eventos, 32 deles vindos da 2.2.0).

**Mesmo roteiro a partir da 2.1.0.** Repetido com dados criados pelo código da 2.1.0 (56 verificações, nenhuma falha), o resultado foi o mesmo, com a diferença esperada de que Gestor e Editor também ganharam `screen:pair`, da 2.2.0.

**Volta 2.3.0 → 2.2.0.** A pasta usada pela 2.3.0 no ensaio acima foi aberta de novo pelo código da 2.2.0. Todas as contas entraram e o Editor deixou de programar (403 ao criar). A pessoa que só rascunhava ficou **sem** `schedule:create`, porque a concessão antiga tinha sido descartada quando a conta foi salva na 2.3.0; o registro da conta dela manteve apenas a retirada, sem efeito na 2.2.0. A programação publicada pelo Editor continuou cadastrada, mas com o vínculo suspenso (“Responsável sem permissão para programar”), e a TV passou a exibir só a do Gestor; o Gestor interrompeu e publicou de novo a programação do Editor (200 e 200) e ela voltou ao ar. A TV manteve a credencial e a cadeia de hashes ficou íntegra (64 eventos). É por isso que [MIGRACOES.md](MIGRACOES.md) manda guardar o backup anterior à troca e explica o que fazer sem ele.

**Verificação por mutação.** Em uma cópia descartável do projeto, 24 defeitos foram introduzidos um a um em regras que os testes dizem proteger, e os testes correspondentes foram rodados depois de cada um (antes, sem defeito algum, todos passaram: é a linha de base). Os 21 primeiros foram avaliados pelos testes de unidade e de API (`tests/editor-schedules.test.mjs`, `tests/schedules.test.mjs`, `tests/permissions.test.mjs`, `tests/shared-displays.test.mjs` e `tests/pairing-permission.test.mjs`; o da descrição do perfil, por `tests/frontend-core.test.mjs` e `tests/panel-displays-shared.test.mjs`) e os três últimos, pelo cenário em navegador `editor-programacao`. Todos os 24 foram detectados por pelo menos um teste ou uma etapa:

| Defeito introduzido de propósito | Resultado |
| --- | --- |
| O Editor deixa de programar (volta ao padrão da 2.2.0) | Detectado (12 testes falharam) |
| O Editor passa a criar rascunhos, mas não a publicar | Detectado (8 testes falharam) |
| O Editor ganha publicar versões de playlist por padrão | Detectado (6 testes falharam) |
| O Editor ganha aprovar arquivos por padrão | Detectado (3 testes falharam) |
| Programar numa TV sem o Administrador ter liberado o acesso | Detectado (2 testes falharam) |
| Aceitar TV de outra unidade | Detectado (2 testes falharam) |
| Publicar sem conferir a permissão schedule:publish | Detectado (4 testes falharam) |
| Interromper sem conferir a permissão schedule:publish | Detectado (3 testes falharam) |
| Publicar programação de outra unidade ou setor (sem conferir o escopo) | Detectado (1 teste falhou) |
| Interromper programação de outra unidade ou setor (sem conferir o escopo) | Detectado (2 testes falharam) |
| Alterar o que está no ar com só schedule:create | Detectado (2 testes falharam) |
| Excluir programação publicada com só schedule:create | Detectado (2 testes falharam) |
| Criar já publicando sem schedule:publish | Detectado (3 testes falharam) |
| Criar programação em outro setor (sem conferir o escopo) | Detectado (1 teste falhou) |
| Programar playlist que ainda não tem versão publicada | Detectado (2 testes falharam) |
| Programar playlist com arquivo ainda não liberado | Detectado (2 testes falharam) |
| O vínculo não é suspenso quando a pessoa perde schedule:publish | Detectado (2 testes falharam) |
| A retirada individual feita pela TI não é gravada | Detectado (8 testes falharam) |
| Concessão que passou a ser padrão do perfil continua gravada na conta | Detectado (1 teste falhou) |
| A TV deixa de mostrar o destino como autorizado para o Editor | Detectado (4 testes falharam) |
| A descrição do perfil Editor volta ao texto da 2.2.0 | Detectado (1 teste falhou) |
| A janela de programação oferece "Publicar agora" a quem não tem schedule:publish | Detectado (3 etapas falharam) |
| O aviso de "só rascunhos" desaparece | Detectado (3 etapas falharam) |
| A tela acha que todo mundo pode publicar | Detectado (3 etapas falharam) |

## Arquivos de teste de MOV e JPEG

Os arquivos de `tests/fixtures/media/` são pequenos, sintéticos e não têm conteúdo de ninguém. Foram gerados uma única vez com FFmpeg 6.1 e ImageMagick 6.9; **o projeto não usa nenhum dos dois**. Para refazê-los:

```
ffmpeg -f lavfi -i testsrc2=s=160x90:r=12:d=2 -f lavfi -i sine=frequency=440:duration=2:sample_rate=22050 -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -g 12 -c:a aac -b:a 24k -ac 1 -movflags +faststart -f mov h264-aac.mov
# hevc-aac.mov: o mesmo, com -c:v libx265 e -tag:v hvc1
# prores-pcm.mov: -c:v prores_ks -profile:v 0, 64x36, 0,5 s, áudio pcm_s16le
# audio-only.mov: só o áudio AAC. mpeg4-video-only.mov: -c:v mpeg4 -q:v 12, sem áudio
convert -size 96x54 gradient:#2a6fdb-#e8eefc -quality 70 baseline.jpg
# progressive.jpg: com -interlace Plane. gray.jpg: -colorspace Gray. cmyk.jpg: -colorspace CMYK
# restart.jpg: -define jpeg:restart-interval=2
```

## Testes antigos alterados nesta entrega e por quê

Nenhum teste existente foi apagado ou afrouxado, e nenhuma asserção foi removida. Mudaram um arquivo de teste e dois auxiliares; o resto é novo (`tests/playback-direct.test.mjs`, `tests/player-media-link.test.mjs` e `tests/e2e/video-direto.e2e.mjs`).

| Arquivo | O que mudou e por quê |
| --- | --- |
| `tests/docs.test.mjs` | O relatório e o anexo da 2.3.0 passaram a documentos históricos e a versão atual é a 2.4.0. Conferências novas contra o código: o prazo do link (em horas), o bloco de leitura da entrega e a chave que a TV usa para lembrar o caminho aparecem na documentação com o valor que está no código. |
| `tests/helpers/fake-media-dom.mjs` | Só acréscimos: o aparelho de mentira pode recusar vídeos `blob:` com o código de erro escolhido (`refuseBlobVideo`), reconhece os endereços de vídeo direto (`/api/media/<id>/file?t=…`) e registra cada endereço dado ao `<video>`. |
| `tests/helpers/player-kit.mjs` | Só acréscimos: o servidor de mentira responde ao pedido de link (com estado, atraso e falha configuráveis) e registra os pedidos; o kit repassa `refuseBlobVideo`. |

As mudanças de testes feitas na 2.3.0 (a regra do Editor mudou, e os testes antigos que a afirmavam foram atualizados) continuam registradas abaixo.

**Alterações de testes feitas na 2.3.0 (herdado).**

Vários testes afirmavam a regra anterior (o Editor não programa) ou usavam a concessão individual de `schedule:create` como exemplo de concessão, o que deixou de fazer sentido porque criar rascunhos passou a ser padrão do perfil. Eles foram atualizados à regra nova; as regras que não mudaram continuam afirmadas.

| Arquivo | O que mudou e por quê |
| --- | --- |
| `tests/permissions.test.mjs` | A matriz de perfis passou a esperar Editor com permissão de criar, publicar e interromper programação (antes, só Administrador e Gestor). Os exemplos de concessão individual passaram de `schedule:create` (agora padrão) para `playlist:publish` (concessão de verdade), e “quem só rascunha” passou a ser o Editor com `schedule:publish` retirada. |
| `tests/schedules.test.mjs`, `tests/shared-displays.test.mjs` | A pessoa que só rascunha deixou de ser “Editor com a concessão de criar” e passou a ser “Editor com a publicação retirada”. O comportamento testado (cria rascunho, publicar é recusado, o vínculo é suspenso ao perder a permissão) é o mesmo. |
| `tests/pairing-permission.test.mjs` | As permissões que a TV mostra ao Editor passaram a incluir publicar (`publish: true`). Nova asserção: sem as permissões de programar, a pessoa ainda gera o código de pareamento, mas a TV deixa de ser destino para ela. |
| `tests/e2e/schedules.e2e.mjs` | O Editor saiu deste cenário, que agora cobre Gestor e Visualizador. A conferência de que o Editor só consulta contradiz a regra nova e foi substituída pelo cenário próprio `editor-programacao`. |
| `tests/e2e/users.e2e.mjs` | O cenário passou a usar `playlist:publish` como concessão e `schedule:publish` como retirada, e confere o efeito de cada uma por chamada direta à API e pela tela, com login real da pessoa. |
| `tests/docs.test.mjs` | O relatório e o anexo da 2.2.0 passaram a documentos históricos; a versão atual, então, era a 2.3.0. |

Nenhum teste foi apagado sem substituto e nenhuma asserção foi afrouxada. Os dois cenários que já tinham sido atualizados na 2.2.0 (Fundação e Playlists – Fase 2) estão explicados no [relatório da 2.2.0](RELATORIO-2.2.0.md).

## Inventário dos testes automatizados

Este inventário conta testes declarados; o resultado da execução aparece acima. Cinco testes são ignorados em Windows (veja acima).

| Arquivo | Testes |
| --- | --- |
| `tests/audit.test.mjs` | 2 |
| `tests/auth.test.mjs` | 8 |
| `tests/content-check.test.mjs` | 9 |
| `tests/database.test.mjs` | 9 |
| `tests/displays.test.mjs` | 11 |
| `tests/docs.test.mjs` | 19 |
| `tests/editor-schedules.test.mjs` | 6 |
| `tests/flow.test.mjs` | 2 |
| `tests/formats.test.mjs` | 6 |
| `tests/frame-analysis.test.mjs` | 15 |
| `tests/frontend-admin.test.mjs` | 17 |
| `tests/frontend-core.test.mjs` | 23 |
| `tests/frontend-dom.test.mjs` | 17 |
| `tests/frontend-models.test.mjs` | 22 |
| `tests/frontend-static.test.mjs` | 12 |
| `tests/hardening.test.mjs` | 17 |
| `tests/hygiene.test.mjs` | 6 |
| `tests/library.test.mjs` | 12 |
| `tests/migrations.test.mjs` | 10 |
| `tests/organization.test.mjs` | 4 |
| `tests/pairing-permission.test.mjs` | 6 |
| `tests/panel-displays-shared.test.mjs` | 19 |
| `tests/panel-editor.test.mjs` | 9 |
| `tests/panel-formats.test.mjs` | 7 |
| `tests/panel-playlists.test.mjs` | 28 |
| `tests/permissions.test.mjs` | 9 |
| `tests/playback-api.test.mjs` | 6 |
| `tests/playback-audio.test.mjs` | 13 |
| `tests/playback-core.test.mjs` | 23 |
| `tests/playback-direct.test.mjs` | 20 |
| `tests/playback-engine.test.mjs` | 38 |
| `tests/playback-loader.test.mjs` | 15 |
| `tests/playback-recovery.test.mjs` | 44 |
| `tests/playback-stage.test.mjs` | 33 |
| `tests/player-media-link.test.mjs` | 10 |
| `tests/player.test.mjs` | 44 |
| `tests/playlists.test.mjs` | 9 |
| `tests/process.test.mjs` | 3 |
| `tests/schedules.test.mjs` | 11 |
| `tests/shared-displays-migration.test.mjs` | 1 |
| `tests/shared-displays.test.mjs` | 10 |
| `tests/terminal.test.mjs` | 3 |

## Cenários de navegador

Estes arquivos exigem o Playwright instalado à parte (ele não é dependência para operar o site); sem ele, o executor os marca como ignorados. Cada cenário abre o Chromium, usa um servidor local com banco temporário de dados fictícios e verifica também que o console do navegador ficou sem erros inesperados. O cenário `video-direto` sobe um servidor real e uma TV pareada pelo código e percorre quatro situações: TV que toca o arquivo baixado (nada muda); TV que recusa o arquivo baixado com o mesmo erro da recepção (código 4, rede 3, leitura 0) e passa a tocar direto, com a cor do quadro conferida e sem credencial no pedido do navegador; a mesma TV reiniciada, que lembra e nem baixa o arquivo; e o servidor sem a rota do link, que reproduz o sintoma de antes. **A recusa do `blob:` é simulada** (o endereço é revogado antes do uso).

| Arquivo | Etapas |
| --- | --- |
| `tests/e2e/audit.e2e.mjs` | 8 |
| `tests/e2e/displays.e2e.mjs` | 9 |
| `tests/e2e/editor-programacao.e2e.mjs` | 9 |
| `tests/e2e/formats.e2e.mjs` | 10 |
| `tests/e2e/foundation.e2e.mjs` | 7 |
| `tests/e2e/library.e2e.mjs` | 16 |
| `tests/e2e/playback.e2e.mjs` | 16 |
| `tests/e2e/playlists-fase2.e2e.mjs` | 16 |
| `tests/e2e/playlists.e2e.mjs` | 15 |
| `tests/e2e/schedules.e2e.mjs` | 11 |
| `tests/e2e/settings.e2e.mjs` | 7 |
| `tests/e2e/users.e2e.mjs` | 9 |
| `tests/e2e/video-direto.e2e.mjs` | 5 |

## Reproduzir a validação

Na pasta do projeto, rode `npm.cmd run check` e `npm.cmd test` (Node.js 24 ou superior). Para os cenários em navegador, instale o Playwright num ambiente de desenvolvimento conforme a infraestrutura em `tests/e2e/harness.mjs` e use `npm.cmd run test:e2e`; o cenário de reprodução da TV leva alguns minutos, e é possível rodar um só passando parte do nome do arquivo, como `npm.cmd run test:e2e -- video-direto`. Para o ensaio de operação com TVs, siga [TV global e áudio](TV-GLOBAL-E-AUDIO.md). O ensaio de compatibilidade, a verificação por mutação e as medidas de desempenho usaram scripts de apoio fora do ZIP e **não se repetem só com o pacote**.

Se for repetir a verificação por mutação no Node.js 24, use `node --test --test-timeout=30000 …`: um teste que espera para sempre (como o do defeito “espera dupla”) não termina sozinho nessa versão, e sem o prazo a verificação trava.

## O que não foi validado

- **Reprodução em televisores.** Compatibilidade com modelos de TV, codecs em equipamentos físicos (MOV, HEVC, H.264, WebM), saída de som, controle remoto e políticas corporativas de navegador. Em especial, **que a TV da recepção toca o link direto**: a causa apontada para a falha dela (o navegador do aparelho não aceita o endereço `blob:` como fonte de vídeo) é a explicação que sobrou por eliminação e não foi observada dentro do aparelho.
- **Windows**, Firefox, Safari, Edge e Chrome gerenciados.
- **Proxy reverso real** (nginx): `Range` e a parte `?t=` do endereço atravessando o proxy, e o que o registro de acessos guarda.
- **Antivírus real**, alta disponibilidade, carga, teste de intrusão, auditoria formal de acessibilidade e integração Microsoft (não existe nesta versão).
- **Conversão ou análise de vídeo**: não existe nesta versão.
- **Fluxo de aprovação de programações**: não existe nesta versão. O Editor publica sem a revisão de outra pessoa, dentro dos limites descritos em [PERMISSOES.md](PERMISSOES.md); o que foi verificado é que esses limites valem, não que a política de publicação da sua empresa seja adequada.
- **Armazenamento do navegador da TV real**: a escolha lembrada (`localStorage`) foi testada com armazenamento que funciona e com armazenamento que falha na leitura ou na gravação, ambos simulados; o comportamento do armazenamento de um aparelho específico não foi observado.
- O pedido de programações com recursos globais e escolha dos setores (informado como concluído por outra IA) não foi refeito nem reverificado aqui.

A entrega não inclui contas reais, credenciais, mídias corporativas, banco de produção nem scanner antimalware.
