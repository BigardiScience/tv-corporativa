# Entrega TV Corporativa 2.4.0

Candidata a 2.4.0, feita a partir do pacote **2.2.0** (`TV-Corporativa-2.2.0.zip`, SHA-256 `851b63ea5a0dc003f17d71c53bd4440fcc421861e872b3c4c7634fe415f51554`), com os pontos principais do pacote **2.3.0** (`TV-Corporativa-2.3.0.zip`, SHA-256 `40d86d5408186e39fea70958a4d5b5b7f8d7bf688706b0e7ecb5ae32452953fb`) incorporados e com a correção do vídeo da TV da recepção, que mostrava "formato ou arquivo não suportado por esta TV". O trabalho foi feito sobre uma cópia; os pacotes recebidos e as instalações em uso não foram tocados. A entrega é o projeto completo em ZIP, com código, testes e documentação, sem credenciais, dados corporativos, arquivos temporários nem bancos de teste.

O pedido tinha quatro partes: **comparar** as duas versões, **trazer** os pontos principais da 2.3.0 para a base 2.2.0, **achar a causa** de a TV não tocar vídeo e **corrigir sem mexer nos codecs e no áudio** da 2.2.0, com testes e sem preencher lacunas por suposição. Cada parte tem sua seção abaixo, com o que foi provado e o que não foi.

## 1. Comparativo: 2.2.0 × 2.3.0

Comparação por conteúdo (ignorando só o fim de linha) dos dois ZIPs recebidos: **5 arquivos novos, 33 modificados, 0 removidos e 239 inalterados**. A 2.3.0 não tem nada a menos que a 2.2.0; a única coisa que a 2.2.0 tem e a 2.3.0 não tem é o comportamento antigo do Editor, que a 2.3.0 trocou de propósito.

| Assunto | 2.2.0 | 2.3.0 |
| --- | --- | --- |
| Perfil **Editor** | Envia e organiza arquivos, monta playlists em rascunho e gera o código de pareamento. **Não programa.** | Faz o mesmo e também **cria e publica programações** (`schedule:create` e `schedule:publish` entram no padrão do perfil), só nas TVs que a TI liberou e só no próprio setor e unidade. |
| Código da aplicação que difere | Nenhum a mais | `server/domain/permissions.mjs` (padrão do Editor), `public/js/lib/permissions.js` (descrição do perfil no formulário de usuários) e a versão no `package.json` |
| **Player, vídeo, áudio, formatos, entrega de arquivos, banco (esquema 8)** | Os da 2.2.0 | **Idênticos.** Os 239 arquivos inalterados incluem todo o motor de reprodução (`public/js/playback/`), o player (`public/js/player/app.js`), `server/domain/formats.mjs` e a entrega de arquivos |
| Testes | 548 testes e 11 cenários de navegador, com 124 etapas | 558 testes e 12 cenários de navegador, com 133 etapas: `tests/editor-schedules.test.mjs` (6 testes), o cenário `tests/e2e/editor-programacao.e2e.mjs` (com 9 etapas) e testes de tela e de permissão ajustados |
| Documentação | Relatório e anexo da 2.2.0 | Relatório e anexo da 2.3.0, seção "Editor e programações" em [PERMISSOES.md](PERMISSOES.md), três capturas de tela (uma nova e duas refeitas) |

**O que isso diz sobre a TV.** Os dois pacotes têm exatamente o mesmo código de reprodução e os mesmos formatos aceitos. Nenhum dos dois converte ou recodifica vídeo ou áudio: o servidor só confere a estrutura de MOV e JPEG no envio, guarda o arquivo como foi enviado e o entrega do mesmo jeito, e quem decodifica é o navegador da TV. Portanto **não há diferença de codec ou de áudio entre a 2.2.0 e a 2.3.0** que explique uma TV tocar numa e não na outra.

## 2. O que foi trazido da 2.3.0 para a base 2.2.0

A 2.3.0 é a 2.2.0 mais o padrão novo do Editor (seção 1), então os pontos principais são esses, com os testes e a documentação que os acompanham: o Editor programa e publica dentro do escopo, a TI pode retirar `schedule:publish` de quem deve só rascunhar, as capturas de tela refeitas e a seção de migração. A cópia de trabalho de partida foi conferida arquivo a arquivo contra o ZIP da 2.3.0 recebido e tinha o mesmo conteúdo nos 277 arquivos; o conjunto de testes desse ZIP foi executado em Node.js 24 como linha de base (resultado em [VALIDACAO.md](VALIDACAO.md)). Nada da 2.2.0 foi removido: MOV e JPEG no envio e o código de pareamento para Editor e Gestor continuam como estavam.

Sobre essa base foram feitas as mudanças da seção 4. Em relação ao ZIP da 2.3.0, a 2.4.0 muda 7 arquivos de código do servidor e do player (nada de banco, permissões ou formatos), a versão no `package.json`, 2 arquivos de apoio de teste e o teste de documentação, acrescenta 3 arquivos de teste e atualiza a documentação; a lista completa está em [ARQUIVOS-2.4.0.md](ARQUIVOS-2.4.0.md).

## 3. Por que a TV da recepção não tocava

**O que se sabe, pelos testes feitos no aparelho (LG webOS, modelo 55UT801C0SA):**

- Os mesmos arquivos tocam em outra TV da mesma rede.
- A **pré-visualização do painel** toca o vídeo nessa mesma TV.
- Um arquivo reconvertido (H.264 High, yuv420p, áudio AAC-LC) **também falhou**: codec, contêiner, faixa de cor e áudio ficam descartados como causa.
- A tela mostrou o detalhe do erro do `<video>`: **código 4, estado de rede 3 e estado de leitura 0**. Estado de rede 3 (`NETWORK_NO_SOURCE`) e estado de leitura 0 (`HAVE_NOTHING`) dizem que o navegador **nunca chegou a abrir a fonte**; não houve tentativa de decodificar nada.

**O que difere entre o que funciona e o que falha.** Na pré-visualização, o navegador pede o arquivo ao servidor pelo endereço normal. No player da TV, o código baixa o arquivo inteiro para a memória (com a credencial da TV no cabeçalho) e entrega ao `<video>` um endereço `blob:`. É a única diferença relevante entre o caso que toca e o que não toca.

**Conclusão, por eliminação:** o navegador dessa TV não aceita um endereço `blob:` como fonte de `<video>`, embora toque o mesmo arquivo pelo endereço do servidor. Isso **não foi observado dentro do aparelho**: é a explicação que sobrou depois de descartar arquivo, codec, áudio e cor, e que combina com os três sinais acima. O que foi reproduzido é a **classe do erro**: no Chromium, um vídeo cujo endereço `blob:` é recusado antes do uso falha com o mesmo código 4, estado de rede 3 e estado de leitura 0 (o texto da mensagem difere: o Chromium diz "Media load rejected by URL safety check" e a TV disse "Format error"). Isso prova que a correção trata essa classe de falha, não que a causa no aparelho seja idêntica. A confirmação definitiva é o reteste na TV.

## 4. O que mudou

Resumo: se um vídeo falha por decodificação, o player tenta **o outro caminho** (do arquivo baixado para o link direto, ou o contrário) e **lembra o que funcionou** naquela TV. TVs que já tocam o arquivo baixado não mudam em nada.

### 4.1 Servidor: link temporário assinado

Nova rota `GET /api/player/media/:id/link` (só a TV pareada, com a credencial dela). Ela devolve `{ url, expiresAt }`, em que `url` é `/api/media/<id>/file?t=<id da TV>.<validade>.<assinatura>`. A rota do arquivo passou a aceitar esse parâmetro `t`, **somente** quando o pedido não traz o cabeçalho `Authorization`.

- **Assinatura** HMAC-SHA256 sobre o arquivo, a TV, a validade e o hash da credencial atual da TV, com chave aleatória de 32 bytes que existe só na memória do processo.
- **Vale 6 horas**, para um arquivo e uma TV, e **só em `GET /api/media/:id/file`**. Perde a validade quando o servidor reinicia, a credencial da TV é renovada ou revogada, ou a TV é removida.
- **Não amplia acesso:** cada pedido com o link continua conferindo se o arquivo está na programação ativa daquela TV (setor, unidade e período). Um `t` inválido, vencido ou repetido dá 401 e **nunca** cai para o cookie de sessão do painel; o cabeçalho de credencial, quando presente, tem prioridade.
- Não grava nada no banco, não gera evento de auditoria e não altera o manifesto nem a resposta das demais rotas. Detalhes e erros em [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md).

### 4.2 Player: dois caminhos para o vídeo e memória do que funcionou

- O padrão continua o de sempre: o arquivo é baixado para a memória, o próximo vídeo fica pronto antes de aparecer e o `<video>` toca por `blob:`.
- Se o `<video>` falha por **decodificação** (o erro que a TV deu), o palco chama a fonte para trocar de caminho **uma única vez**, recarrega o elemento e tenta de novo. Rede, cancelamento e tempo esgotado seguem o fluxo de antes, sem troca.
- O endereço do link é conferido antes de usar: tem de ser o endereço local **do mesmo arquivo**, só com o parâmetro `t`. Qualquer outra coisa é recusada, e a credencial da TV nunca vai para o endereço de rede do `<video>`.
- Depois que um vídeo toca por um caminho, o navegador da TV **guarda a escolha** (chave `tv-corporativa.video-way.v1`, valor `direct` ou `blob`) e, na próxima abertura da página, o primeiro vídeo já começa por ela. A escolha só é gravada quando muda; uma TV que toca o arquivo baixado **nunca grava nada**. É só uma dica: se estiver velha (por exemplo, o servidor deixou de oferecer o link), o outro caminho assume sozinho e a dica é corrigida. Armazenamento bloqueado não atrapalha: a escolha vale até a página recarregar.
- Imagens e PDFs não mudam. Se o servidor for de uma versão sem a rota do link (o da 2.3.0 responde 401 a esse pedido, e a TV **continua pareada**), ou recusar o link, a TV se comporta como antes ("formato ou arquivo não suportado por esta TV" e o conteúdo é pulado).
- O arquivo que a TV recusou é tirado da memória do player, para não ocupar espaço à toa.

### 4.3 O que **não** mudou: codecs, áudio e formatos

Nenhuma linha de `server/domain/formats.mjs`, do tratamento de áudio (mudo, volume, autoplay) ou da lista de formatos aceitos foi alterada, e o servidor continua sem converter nada. Os formatos de [FORMATOS.md](FORMATOS.md) são os da 2.2.0. A mudança de comportamento da reprodução está toda no caminho pelo qual o arquivo chega ao `<video>`.

## 5. Desempenho

Duas medidas, feitas aqui (Linux, 2 núcleos, Node.js v24.21.0, `localhost`), e o que elas dizem e não dizem.

**Leitura do arquivo no servidor.** O servidor lia o disco em blocos de 64 KB (o padrão do Node). Medimos a entrega de um arquivo de 300 MB por `localhost` (cliente `curl`, arquivo já no cache do sistema), cinco rodadas por tamanho de bloco alternando a ordem, e comparamos as medianas:

| Bloco de leitura | Vazão (MB/s, mediana) |
| --- | --- |
| 16 KB | 279 |
| 64 KB (antes) | 764 |
| **256 KB (agora)** | **1201** |
| 1 MB | 1214 |

256 KB rende cerca de 57% a mais que 64 KB e praticamente o mesmo que 1 MB, com um quarto do buffer de leitura por entrega em andamento, por isso é o valor adotado (constante `SEND_CHUNK_BYTES` em `server/http/send-file.mjs`). Medido na função `sendFile` real de cada versão, no mesmo servidor de teste: **732 MB/s na 2.3.0 e 1199 MB/s na 2.4.0**. Os valores absolutos são de `localhost` e não prevêem a velocidade na sua rede: numa LAN real, o limite é a rede, e o ganho é menos trabalho do servidor por arquivo entregue, não um vídeo mais rápido. Um teste confere que o conteúdo chega idêntico em qualquer ponto do arquivo, inteiro ou por trechos (`Range`).

**Tempo até o primeiro quadro tocando** (Chromium, arquivo WebM de 17,2 MB, rede limitada, medianas de três rodadas, contado do pareamento da TV até o vídeo tocando):

| Rede | Arquivo baixado (padrão) | TV que recusa o arquivo baixado, sem memória | Com a escolha já lembrada |
| --- | --- | --- | --- |
| 40 Mbit/s | 4,55 s | 4,66 s | **0,49 s** |
| 100 Mbit/s | 2,35 s | 2,38 s | **0,44 s** |

Leitura: sem memória, a TV que recusa o arquivo baixado gasta uma tentativa inteira (baixar o arquivo, ver o erro, pedir o link) e leva no máximo uns 0,1 s a mais que uma TV comum para mostrar o primeiro quadro: o custo do tropeço é o tempo de baixar o arquivo uma vez, que numa TV comum já seria gasto de qualquer forma. Com a escolha lembrada, o primeiro vídeo nem baixa o arquivo e começa quase de imediato. **Isso não torna o caminho direto melhor para todos:** o arquivo baixado continua sendo o padrão porque deixa o vídeo seguinte pronto na memória antes de entrar na tela e toca sem depender da rede durante a exibição. Por isso TVs que tocam esse caminho não mudam.

## 6. Testes

- **Servidor** (`tests/player-media-link.test.mjs`, 10 testes): quem pode pedir o link, o que ele vale e o que não vale (outro arquivo, outra TV, adulterado, vencido, repetido, em outra rota, com cabeçalho de credencial, com o cookie do painel), o que o invalida (programação encerrada, pareamento renovado, TV removida, banco alterado por fora, reinício do servidor), auditoria e manifesto intocados, e a entrega por blocos de 256 KB.
- **Player** (`tests/playback-direct.test.mjs`, 20 testes): a fonte e o palco sozinhos (troca única, simetria nos dois sentidos, cancelamento, endereço do link validado, arquivo recusado tirado da memória, falhas do link, a escolha lembrada e o armazenamento que falha) e o player inteiro com uma TV simulada que recusa `blob:`.
- **Navegador de verdade** (`tests/e2e/video-direto.e2e.mjs`, 5 etapas no Chromium, com servidor real e TV pareada pelo código): TV comum sem nenhuma mudança; TV que recusa o arquivo baixado com o mesmo erro da recepção (código 4, rede 3, leitura 0) e passa a tocar direto, com a cor do quadro conferida, `Range` sem credencial e sem violação da política de segurança de conteúdo; a TV reiniciada, que lembra e nem baixa o arquivo; e o servidor sem a rota do link, que reproduz o sintoma de antes. **A recusa do `blob:` é simulada** (o endereço é revogado antes do uso); o teste não prova nada sobre o aparelho de verdade.
- **Áudio:** nenhuma linha do tratamento de áudio (volume, mudo, autoplay, bloqueio de som) foi alterada. Os testes conferem que um vídeo que trocou de caminho é reproduzido com volume 1 e mudo conforme a escolha da pessoa, igual a um que não trocou, e os 13 testes de áudio da 2.2.0 passam sem alteração. O som foi verificado pelo estado do elemento e pelas chamadas de reprodução, não ouvido num aparelho.
- **Sensibilidade:** 44 defeitos foram introduzidos de propósito, um a um, nas regras novas (troca de caminho, validação do endereço, assinatura, validade, revogação, escopo, escolha lembrada) e 39 foram detectados pelos testes de unidade; os 5 que sobreviveram não alteram nenhum comportamento observável pelos caminhos reais do programa (por exemplo, silenciar o vídeo durante a troca de caminho não muda o som, porque o palco reafirma volume e mudo logo antes de cada reprodução) e estão explicados em [VALIDACAO.md](VALIDACAO.md). Outros 9 foram testados no cenário de navegador: 8 detectados, e o que sobreviveu (assinatura não conferida) é detectado pelo teste de unidade correspondente.
- Nenhum teste existente foi apagado ou afrouxado. Foram estendidos os dois auxiliares de teste do player (`tests/helpers/fake-media-dom.mjs` e `tests/helpers/player-kit.mjs`: uma TV simulada que recusa `blob:`, o registro dos endereços dados ao `<video>` e os pedidos de link) e ajustado `tests/docs.test.mjs` (versão atual, documentos históricos e a conferência do prazo do link e do bloco de leitura contra o código).

## Resultado da validação

588 testes automatizados: 588 passaram, 0 falharam, 0 ignorados, em Linux com Node.js v24.21.0 (o projeto exige Node 24 ou superior). 13 cenários em navegador (138 etapas) passaram no Chromium. 204 arquivos JavaScript verificados, sem falha. Em Windows, cinco testes são ignorados (terminal POSIX e scanner em shell Unix). **Não houve** execução em Windows, em televisor físico nem com antivírus real. O ensaio de atualização e volta 2.3.0 ↔ 2.4.0, o que foi e o que não foi validado e como reproduzir estão em [VALIDACAO.md](VALIDACAO.md).

## Uso e atualização

A atualização **não tem migração de banco** (esquema 8, `data/` reaproveitada como está) e não muda permissões. Para atualizar, siga [IMPLANTACAO.md](IMPLANTACAO.md) e [MIGRACOES.md](MIGRACOES.md): backup, troca do código mantendo `data/` e o arquivo de ambiente, reinício do serviço e conferência de `/healthz` (deve responder `"version":"2.4.0"`).

**As TVs precisam recarregar a página do player.** Elas mantêm o código antigo até recarregar (o servidor entrega sempre o arquivo mais novo, mas uma página já aberta não o troca sozinha). Depois do reinício do serviço, abra de novo a página do player em cada TV ou reinicie o navegador dela. Nesta versão o servidor não grava a versão do player de cada TV; quem quiser confirmar que uma TV carregou o código novo pode procurar, no registro de acessos do proxy, o pedido dela a `/js/player/app.js` depois da atualização.

Teste na TV da recepção, nesta ordem:

1. Recarregue o player nela e deixe uma playlist com vídeo no ar.
2. O primeiro vídeo pode levar alguns segundos a mais que o normal (o aparelho tenta o arquivo baixado, é recusado e passa ao link). Dali em diante, os vídeos devem tocar normalmente e as próximas aberturas da página já começam pelo link.
3. Se **continuar** aparecendo "formato ou arquivo não suportado por esta TV", olhe o registro de acessos do proxy: se a TV pediu `/api/player/media/<id>/link` e depois `/api/media/<id>/file?t=…`, o player novo está rodando e o aparelho recusa também o link, então a causa é outra; se nenhum dos dois pedidos aparece, a TV ainda está com o player antigo.

## Dependências reais e limites

- **Televisores:** esta validação não usou nenhum televisor. As observações da seção 3 vieram de testes feitos pela TI no aparelho; a compatibilidade dessa TV, e de qualquer outro modelo, com o link direto **não foi validada**. A correção cobre a classe de falha observada (fonte recusada com código 4, rede 3, leitura 0) e foi provada em navegador de verdade com a recusa simulada.
- **Se a TV recusar os dois caminhos,** o comportamento é o de antes (conteúdo pulado, com o motivo na tela). A mensagem na tela não traz o detalhe técnico do erro (código, rede, leitura): a mensagem de depuração usada no diagnóstico era uma alteração temporária e não faz parte deste pacote.
- **O link vai na URL.** Ele aparece no registro de acessos do proxy reverso (por exemplo, o `access.log` do nginx). Vale 6 horas e abre só um vídeo da programação da TV, mas trate esse registro como sensível; veja [SEGURANCA.md](SEGURANCA.md) e [IMPLANTACAO.md](IMPLANTACAO.md) para como tirar a parte da consulta do registro. O proxy precisa repassar `Range` e a parte da consulta do endereço (o padrão); isso não foi testado com um proxy real.
- **Reiniciar o servidor invalida os links emitidos** (a chave de assinatura nasce a cada início). A TV pede um link novo a cada vídeo que vai exibir. Com o link, porém, o vídeo depende do servidor **durante** a exibição, o que o arquivo baixado não exige: uma queda de rede ou um reinício do servidor no meio de um vídeo pode interromper aquele vídeo, que o player trata como qualquer falha de reprodução.
- **Primeira vez em uma TV que recusa o arquivo baixado:** custa uma tentativa a mais (o tempo de baixar o arquivo uma vez). Depois a escolha é lembrada. Apagar os dados do navegador da TV faz a escolha ser refeita, mas apaga também a credencial da TV, que então precisa ser pareada de novo.
- **Antivírus:** o antivírus real não foi homologado nesta entrega; em produção, a TV só recebe arquivo verificado e limpo (`MALWARE_SCANNER`), por qualquer um dos dois caminhos.
- **Integrações e conformidade:** sem Microsoft Entra ID, SSO, SharePoint, OneDrive nem Power BI; sem certificação ISO/IEC 27001 nem avaliação TISAX.

## Observações fora do escopo

- **Identificador de versão do player:** passou de `2.2.0` para `2.4.0`, porque o player mudou (na 2.3.0 ele ficou em `2.2.0`, porque o player não mudou naquela versão). Ele é enviado no sinal de vida da TV, mas o servidor não o grava nem o mostra nesta versão.
- **Casos que continuam sem solução neste pacote:** conversão de vídeo no servidor e outros formatos; o texto de erro técnico na tela da TV.
- **Histórico do Git:** o ZIP não inclui a pasta `.git`. Para atualizar o repositório publicado, substitua os arquivos pelo conteúdo desta entrega e faça o commit.

## Arquivos

Diferenças em relação ao ZIP da 2.3.0 recebido e a lista completa em [ARQUIVOS-2.4.0.md](ARQUIVOS-2.4.0.md). O relatório anterior é [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md).
