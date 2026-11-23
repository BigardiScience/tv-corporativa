# Relatório da Fase 2: carrossel e reprodução

> Documento histórico da Fase 2: descreve o pacote 2.0.0-fase2 e suas verificações originais. As alterações e a validação da versão atual (2.4.0) estão em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md); as da 2.3.0, em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md); as da 2.2.0, em [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as da 2.1.0, em [RELATORIO-2.1.0.md](RELATORIO-2.1.0.md).

Versão **2.0.0-fase2**, partindo da versão 2.0.0-fase1. Elaborado em 23 de outubro de 2026.

Este relatório reúne o que o documento de requisitos pede ao final de cada fase (seção 20) e separa três coisas que costumam ser misturadas: o que foi **feito e testado**, o que foi **feito, mas só validado em ambiente de teste (um computador, não uma TV)**, e o que **não foi feito**. Os detalhes de cada assunto estão nos outros documentos, indicados ao longo do texto. Os resultados dos testes e o que não pôde ser validado estão em [VALIDACAO.md](VALIDACAO.md); todas as mudanças, arquivo a arquivo e comportamento a comportamento, estão em [REGISTRO-DE-MUDANCAS.md](REGISTRO-DE-MUDANCAS.md).

## 1. Em resumo

| Situação | O que entra aqui |
| --- | --- |
| **Feito, integrado e testado** | Carrossel automático que percorre a playlist na ordem e recomeça; tempo individual de cada conteúdo; vídeo pelo tempo definido (como **limite**) ou até o fim; repetição contínua liga/desliga por playlist, com efeito na TV; cinco transições (corte seco, esmaecer, dissolver, deslizar, zoom) com duração de 0 a 3000 ms; pré-carregamento do próximo conteúdo; nunca uma tela vazia entre dois conteúdos; recuperação de falhas de rede, de arquivo e de vídeo; retomada do ponto depois de queda de conexão, de energia ou de recarga; pré-visualização da playlist (rascunho, publicação, versões e programação) e demonstração de cada efeito ("Ver efeito"); controles e avisos acessíveis no player e no editor; migração 7 do banco |
| **Feito, mas só validado em ambiente de teste** | Todo o comportamento acima foi exercitado em Chromium, num computador sem placa de vídeo, e no Node 22: a fluidez dos efeitos, o consumo de memória, a decodificação de vídeo e a reação a uma TV lenta (**simulada**) valem para esse ambiente, não para uma TV; a migração foi testada com bancos gerados pelo código da Fase 1, não com o seu banco real; nada foi executado no Node 24 nem no Windows |
| **Não feito** | **Duração individual por página de PDF** (depende da conversão de PDF da Fase 4: hoje o PDF aparece inteiro pelo tempo definido); registro das falhas de reprodução no servidor e diagnóstico remoto (Fase 3); versão alternativa de um conteúdo incompatível (Fase 4); homologação em televisores reais (Fase 7); Player Universal, pareamento iniciado pela TV, conversões, recuperação de senha e modo escuro (Fases 3 a 6) |

**Antes de usar com dados reais:**

1. No seu computador (Node 24.19.0), rode `npm.cmd run check` e `npm.cmd test`. Nada foi executado no Node 24 nem no Windows durante a validação.
2. Faça uma cópia da pasta `data/` e **ensaie a atualização nessa cópia** (a migração 7 é automática e faz backup antes), como descrito em [MIGRACOES.md](MIGRACOES.md). Depois da migração 7, o código da Fase 1 não abre mais aquele banco; a volta atrás é restaurar o backup.
3. Publique num serviço de teste separado (procedimento em [IMPLANTACAO.md](IMPLANTACAO.md)) e **teste em cada modelo de TV**: abra o player, pareie e deixe uma playlist com os cinco efeitos e um vídeo rodando por algumas horas. É o único jeito de saber como a TV se comporta; veja a seção 8.
4. Se algo falhar, a volta à Fase 1 está descrita em [MIGRACOES.md](MIGRACOES.md).

Nenhuma televisão foi usada neste trabalho: a compatibilidade com qualquer modelo ou fabricante **não foi testada** e não é declarada. O produto também não é certificado ISO/IEC 27001 nem avaliado TISAX.

## 2. O que a Fase 2 entrega, requisito por requisito

### 2.1 Seção 3: carrossel automático de mídia

| Requisito | Situação | Como foi feito e onde está |
| --- | --- | --- |
| 3.2 Até 6 conteúdos, estrutura para 15, limite configurável | Atendido | Já vinha da Fase 1 (`PLAYLIST_MAX_ITEMS`, 6 por padrão, até 15). O motor não tem limite próprio: um teste percorre 15 conteúdos em duas voltas |
| 3.3 Reprodução automática, sequência ordenada, avanço automático | Atendido | O player da TV exibe a programação sozinho, na ordem, e passa ao próximo quando o tempo do conteúdo acaba |
| 3.3 Loop infinito configurável | Atendido | Caixa "Repetir a playlist continuamente" em cada playlist (ligada por padrão, como sempre foi). Desligada, a TV exibe a sequência uma vez e **mantém o último conteúdo na tela**; "Reiniciar" ou o botão de reproduzir recomeça. A versão publicada guarda a sua própria repetição |
| 3.3 Controle de duração | Atendido | Tempo de cada conteúdo de 5 s a 1 hora; duração da transição de 0 a 3000 ms; em vídeo, "Tempo do vídeo" |
| 3.3 Retomada após falhas | Atendido em teste | Tentativas com espera crescente, conteúdo com defeito pulado e tentado de novo depois, aviso quando nada pode ser exibido e volta sozinho, retomada do ponto depois de queda de conexão, de energia ou de recarga (seção 2.3) |
| 3.3 Tratamento de conteúdos indisponíveis | Atendido | O conteúdo que não carrega, não decodifica, trava ou recusa tocar é pulado **com o motivo dito na tela**, e os demais seguem; sem nenhum conteúdo, a TV explica e tenta de novo a cada 10 s |
| 3.3 Pré-carregamento dos próximos conteúdos | Atendido, **só o próximo** | O próximo conteúdo é baixado e decodificado numa camada escondida enquanto o atual está na tela; nunca mais de três conteúdos vivos ao mesmo tempo (o atual, o que está saindo e o próximo) |
| 3.3 Continuidade entre transições | Atendido | O novo conteúdo entra **por cima** e o antigo só sai quando a troca termina; duas transições nunca se sobrepõem; uma troca interrompida por outra é concluída na hora |
| 3.3 Pré-visualização antes da publicação | Atendido | Botão "Pré-visualizar" no editor (mostra o rascunho, mesmo não salvo), na revisão de publicação, nos detalhes de uma versão e no formulário da programação. Usa **o mesmo motor da TV** |
| 3.4 Tempo individual por conteúdo | Atendido | Cada item tem o seu tempo; o tempo conta desde o início da entrada, então a soma dos tempos é a duração do ciclo |
| 3.4 Vídeo: duração natural **ou** limite | Atendido | "Tempo do vídeo": "Tempo definido (limite)" (toca até o fim ou até o limite, o que vier primeiro) ou "Até o fim do vídeo" (com um prazo de segurança de duração + 2 s, ou o tempo do item se a TV não conseguir ler a duração) |
| 3.4 PDF convertido: duração individual **por página** | **Não atendido** | Depende da conversão de PDF para imagens (Fase 4). Hoje o PDF aparece **inteiro**, pelo visualizador do aparelho, pelo tempo definido; o editor avisa isso na linha do PDF |
| 3.5 Fade, dissolver, deslizar, zoom, corte simples | Atendido | Cinco efeitos independentes (esmaecer, dissolver, deslizar, zoom, corte seco), cada um com a sua assinatura nos pixels conferida em Chromium |
| 3.5 Duração da transição configurável | Atendido | De 0 a 3000 ms por conteúdo (padrão 600 ms) |
| 3.5 Efeitos compatíveis com o desempenho; simplificados em TVs antigas | Atendido em simulação | O player mede o intervalo entre quadros durante as trocas; duas trocas lentas seguidas passam todos os efeitos a esmaecer, e mais duas, a corte seco; o nível é lembrado por 7 dias. Sem a API de animações do navegador, toda troca é corte seco. **A medição só foi testada com uma lentidão simulada** |
| 3.5 Respeitar a redução de movimento | Atendido | Com "reduzir movimento" no sistema, todo efeito vira esmaecer e a TV (e a pré-visualização) dizem por quê |
| 3.6 Evitar telas pretas entre conteúdos | Atendido no Chromium | Conferido quadro a quadro nos pixels apresentados, para cada efeito, inclusive na troca para vídeo; não verificado em TV |
| 3.6 Liberar recursos e prevenir consumo crescente de memória | Atendido em teste | Tudo o que é aberto é solto uma única vez; arquivos guardados só em memória, com teto (96 MB e 32 arquivos); 300 voltas com relógio de mentira e alguns minutos no Chromium não acumularam nada. **Dias de exibição e a memória de uma TV não foram medidos** |
| 3.6 Tratar erros de reprodução | Atendido | Seção 2.3 |
| 3.6 Evitar carregamentos repetitivos | Atendido | O arquivo é baixado uma vez e reaproveitado da memória a cada volta; conteúdo com defeito não é baixado de novo a cada volta (fica de fora por 30 s) |
| 3.6 Recuperar o estado após reconexão | Atendido | A TV retoma do conteúdo em que estava se a programação continua a mesma (seção 2.3) |

### 2.2 Seção 19: o que a Fase 2 pede

| Item da Fase 2 | Situação |
| --- | --- |
| Carrossel automático | Atendido |
| Controle individual de duração | Atendido, **exceto a duração por página de PDF** (Fase 4) |
| Transições | Atendido |
| Loop contínuo | Atendido |
| Pré-visualização | Atendido |
| Recuperação de reprodução | Atendido |

### 2.3 Recuperação de reprodução, em detalhes

| Situação | O que a TV faz |
| --- | --- |
| Falha de rede ao baixar um arquivo | Tenta de novo (3 tentativas, com espera de cerca de 1 s e 3 s, variada para as TVs não baterem juntas no servidor) enquanto o conteúdo anterior continua na tela. Persistindo, o conteúdo é pulado e volta a ser tentado depois de 30 s |
| Arquivo inexistente ou formato que a TV não toca | Não insiste: pula na hora, diz o motivo, e tenta de novo só depois de 30 s |
| Servidor ocupado (por exemplo, 503) | Pede de novo sozinho; o conteúdo aparece sem ser pulado |
| Acesso da TV revogado | Não repete: apaga conteúdo e credencial e volta ao pareamento |
| Conteúdo que demora mais de 120 s para ficar pronto | É abandonado; o atual continua na tela |
| Vídeo que quebra durante a exibição, trava (15 s sem avançar) ou o navegador recusa tocar sozinho | Pula para o próximo (a recusa de tocar é tentada uma segunda vez antes); o vídeo é solto |
| Nenhum conteúdo pode ser exibido | A tela mostra "Conteúdo indisponível nesta TV" e o motivo, tenta de novo a cada 10 s e volta sozinha quando o problema some |
| Programação nova | O conteúdo antigo fica na tela até o novo estar pronto, sem tela vazia; programação igual (a TV consulta o servidor a cada 20 s) não reinicia nada |
| Queda de conexão | Segue exibindo o que já foi baixado até a autorização vencer (60 s), tenta reconectar cada vez mais rápido (5, 10 e 20 s) e, vencida a autorização, **para de exibir por segurança**; ao voltar, retoma do ponto em que estava |
| Queda de energia ou página recarregada | Retoma do conteúdo em que estava, se for a mesma programação e a queda foi de menos de 10 minutos (só a posição é guardada no navegador da TV; nunca conteúdo nem credencial) |
| TV lenta | Simplifica os efeitos sozinha (seção 2.1) e avisa na tela |

### 2.4 O que as pessoas veem no painel

- **Linha de cada conteúdo da playlist:** campo de tempo que muda de nome conforme o conteúdo ("Duração (s)" em imagem e PDF, "Limite (s)" em vídeo com tempo definido, "Reserva (s)" em vídeo até o fim), "Tempo do vídeo" (só em vídeo), "Transição", "Efeito (ms)" e o botão **"Ver efeito"**, com uma explicação curta de cada campo.
- **"Ver efeito":** abre uma demonstração com dois conteúdos de exemplo passando pelo mesmo motor da TV, com "Ver de novo", "Pausar", escolha do efeito e da duração, e **"Usar este efeito"** (aplica só àquele conteúdo; fechar não aplica nada). Quem só consulta vê os efeitos, mas não vê o botão de aplicar.
- **Resumo do ciclo:** "um ciclo completo dura 50 s", "até 50 s" (há vídeo com limite) ou "50 s mais a duração do vídeo" (há vídeo até o fim).
- **Repetição:** caixa "Repetir a playlist continuamente", com a explicação do que a TV faz em cada estado, avisada a leitores de tela ao mudar.
- **Pré-visualização:** percorre a playlist como a TV faria (ordem, tempo e efeito de cada conteúdo, vídeo sem som), com Anterior, Pausar, Próximo, a lista de conteúdos para saltar e, para o que não abre, o motivo. Sem repetição, termina no último conteúdo e oferece reiniciar.

### 2.5 No player da TV

- **Controles:** Anterior, Pausar/Reproduzir (Reiniciar quando a sequência acaba), Próximo, tela cheia e desconectar, com nome e estado para leitores de tela. Somem depois de 6 s de exibição (voltam ao mexer o mouse, tocar ou apertar uma tecla) e **nunca somem** com o foco neles ou com a exibição pausada.
- **Teclado e controle remoto:** K, Espaço ou a tecla de mídia reproduzir/pausar alternam; N ou a tecla de mídia seguinte avança; P ou a tecla de mídia anterior volta.
- **Avisos:** posição ("2 de 5 · Em exibição"), conteúdo pulado e o motivo, "Reconectando…", "Efeito simplificado: movimento reduzido ativo" e anúncios para leitores de tela (pausa, retomada, sequência terminada, conteúdo pulado, conexão restabelecida).
- **Sem recursos mínimos:** se o navegador não tem módulos ES, `fetch`, `AbortController`, `Headers`, `Blob` ou `URL.createObjectURL`, a tela de pareamento diz o que falta em vez de ficar parada.

## 3. Como foi construído

- **Um motor, dois usos.** `public/js/playback/` contém o carrossel, as regras de tempo, os efeitos, o carregamento de arquivos, a memória do que foi baixado, a recuperação e a tela. A TV (`public/js/player/app.js`) e a pré-visualização do painel usam o mesmo código: o que se vê na prévia é o que a TV fará. O motor não conhece DOM, rede nem armazenamento: recebe tudo por parâmetro, por isso o tempo, a ordem, as falhas e a recuperação são testados em Node com um relógio de mentira, sem esperar segundos de verdade.
- **Só opacidade, deslocamento e escala** (e um desfoque, no dissolver). São as propriedades que o navegador anima na placa de vídeo. A camada que entra fica por cima e a que sai permanece opaca até o fim: nunca existe um quadro com as duas transparentes.
- **Nada em disco.** Os arquivos baixados ficam em memória (`Blob`) com limite e saem na ordem de uso. A credencial da TV só vai ao caminho local de mídia (`/api/media/<id>/file`); qualquer outro endereço é recusado antes de sair.
- **Sem recursos novos demais do JavaScript.** Um teste varre o código que a TV executa e proíbe recursos que navegadores de TV mais antigos podem não ter (por exemplo, `AbortSignal.any`, `Array.prototype.at`, `Object.hasOwn`, `structuredClone`).
- **Servidor: dois campos novos, nenhum caminho novo.** Veja [MIGRACOES.md](MIGRACOES.md) e [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md): `loop_enabled` (playlist e versão publicada) e `duration_mode` (item), com padrões que reproduzem exatamente o que a Fase 1 fazia.

## 4. Mudanças de comportamento em relação à Fase 1

Estas diferenças são **intencionais** e o player da Fase 1 não as tinha. Se você tinha o hábito de contar com o comportamento antigo, leia esta lista:

1. **O próximo conteúdo é baixado antes da hora**, enquanto o atual está na tela. A rede é usada um pouco antes, e a memória guarda até três conteúdos ao mesmo tempo.
2. **Os arquivos ficam guardados na memória da TV** (até 96 MB e 32 arquivos) e são reaproveitados a cada volta; na Fase 1 cada arquivo era baixado de novo a cada passagem. Usa menos rede e mais memória.
3. **O tempo de cada conteúdo conta desde o início da transição de entrada**, então a soma dos tempos é a duração do ciclo. Com transição de 1 s e tempo de 10 s, o conteúdo fica 10 s no total (1 s de entrada e 9 s inteiro). Um conteúdo nunca sai antes de a própria transição de entrada acabar. Na Fase 1 não havia transição, então a regra não aparecia.
4. **Conteúdo com defeito é pulado na hora e só é tentado de novo depois de 30 s**, em vez de mostrar um cartão de falha por 8 s a cada volta.
5. **Vídeo com tempo definido continua sendo limite**, como na Fase 1. A novidade é a opção "Até o fim do vídeo".
6. **Corte seco para um vídeo** tem uma pequena preparação de 3 quadros: o vídeo entra por cima, quase transparente, e a camada antiga só sai depois. É o que evita um quadro preto na troca.
7. **Repetição desligada** é nova: o padrão (ligada) é o que sempre foi.
8. **Os efeitos agora são aplicados** (na Fase 1 eram só gravados). Uma playlist antiga cujos itens já tinham efeito escolhido passa a exibi-lo.

## 5. Entregáveis da seção 20

| Item pedido | Onde está |
| --- | --- |
| 1. Código-fonte atualizado | O ZIP completo, pronto para extrair e executar |
| 2 e 3. Arquivos modificados e novos | [ARQUIVOS-DA-FASE-2.md](ARQUIVOS-DA-FASE-2.md): 39 arquivos novos, 41 arquivos modificados, 0 arquivos removidos e 160 arquivos inalterados em relação à Fase 1 |
| 4. Migrações necessárias | 1 migração nova (a 7), entre as 7 migrações automáticas descritas em [MIGRACOES.md](MIGRACOES.md) |
| 5 e 6. Testes implementados e resultados | 477 testes automatizados e 10 cenários em navegador (113 etapas), com os resultados e as limitações em [VALIDACAO.md](VALIDACAO.md) |
| 7. Executar localmente | [README.md](../README.md) e [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md) |
| 8. Deploy no Render | Seção 2 de [IMPLANTACAO.md](IMPLANTACAO.md) |
| 9. Documentação das funcionalidades | [FUNCIONALIDADES.md](FUNCIONALIDADES.md), [FORMATOS.md](FORMATOS.md), [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md) e [OPERACAO.md](OPERACAO.md) |
| 10. Riscos técnicos | Seção 7 deste relatório |
| 11. Limitações conhecidas | Seção 8 deste relatório |
| 12. Alterações de segurança | Seção 6 deste relatório e [SEGURANCA.md](SEGURANCA.md) |
| 13. Compatibilidade com versões anteriores | Seção 9 deste relatório e [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md) |
| Registro das mudanças | [REGISTRO-DE-MUDANCAS.md](REGISTRO-DE-MUDANCAS.md) |

## 6. Alterações de segurança

- **Nenhuma rota nova e nenhuma permissão nova.** A Fase 2 usa as mesmas 20 permissões e as mesmas regras de escopo; o servidor continua validando tudo (inclusive os novos campos) e nenhuma decisão foi levada para o navegador.
- **Validação dos campos novos no servidor e no banco.** A repetição só aceita verdadeiro ou falso (texto, 0 ou 1 são recusados com `LOOP_INVALID`); a duração natural só é aceita em vídeo (`DURATION_MODE_INVALID`); o banco repete as duas regras com restrições `CHECK`, e o gatilho que torna as versões publicadas imutáveis foi recriado para proteger a coluna nova.
- **A credencial da TV continua indo somente ao próprio servidor.** O carregador de arquivos só aceita o caminho local `/api/media/<id>/file`; um endereço externo nunca recebe pedido, e o motivo aparece na tela.
- **Memória, nunca disco.** O que a TV baixa fica em `Blob`, com teto, sem gravação em disco e sem `localStorage` de conteúdo. O que o navegador da TV guarda: a credencial (a mesma chave da Fase 1), a posição de retomada (um número e uma assinatura curta) e o nível de efeitos que o aparelho aguenta.
- **Política de segurança de conteúdo (CSP) inalterada.** Sem scripts em linha; arquivos de mídia, quadros de PDF e `blob:` já eram permitidos na CSP da Fase 1.
- **Auditoria** registra a repetição desligada ao criar, alterar e publicar a playlist, sem conteúdo sensível.
- **Sem registro de senhas, tokens ou credenciais** em nenhum dos novos fluxos. Um teste confere que o player novo lê a credencial da mesma chave do armazenamento da Fase 1 e envia a mesma credencial.

**Mantido sem enfraquecer:** tudo o que o relatório da Fase 1 lista como mantido. A autorização de exibição continua vencendo em 60 s sem contato com o servidor: com a conexão perdida, a TV retira o conteúdo da tela por segurança, e isso é uma decisão de projeto (a alternativa, exibir indefinidamente sem autorização, seria um risco), não uma falha.

## 7. Riscos técnicos

| Risco | Efeito possível | O que fazer |
| --- | --- | --- |
| **Nenhuma TV foi testada.** O player foi validado em Chromium num computador sem placa de vídeo | Efeitos que engasgam, vídeo que não decodifica, memória que acaba ou funções do navegador que a TV não tem | Testar cada modelo (seção 1, item 3). O player se protege (simplifica efeitos sozinho, pula o que não toca, avisa o que falta), mas **não há garantia sem teste** |
| Algumas TVs desenham o vídeo numa camada de hardware que pode ignorar opacidade e deslocamento durante a troca | O vídeo "pula" ou aparece por cima da transição | Usar corte seco ou esmaecer para conteúdos em vídeo nessas TVs; homologar por modelo (Fase 7) |
| Limiares de "TV lenta" (`FRAME_RULES`) são um ponto de partida, não medidos em TVs | O player pode simplificar efeitos sem necessidade, ou demorar a simplificar | Ajustar com TVs reais; o nível aprendido expira em 7 dias |
| O arquivo é baixado inteiro e guardado em memória | Vídeo muito grande ou rede muito lenta não fica pronto em 120 s e é pulado; TV com pouca memória pode falhar | Manter os vídeos pequenos (veja [FORMATOS.md](FORMATOS.md)); medir na TV |
| Só o próximo conteúdo é pré-carregado | Com rede lenta e conteúdos curtos, o próximo pode não estar pronto; o atual continua na tela | Evitar conteúdos de poucos segundos com arquivos grandes |
| Troca de banco irreversível sem backup | Depois da migração 7 o código da Fase 1 recusa o banco | A migração faz backup antes; guarde-o e ensaie numa cópia |
| Todo o resto da lista de riscos do relatório da Fase 1 continua valendo | — | Veja [RELATORIO-FASE-1.md](RELATORIO-FASE-1.md), seção 7 |

## 8. Limitações conhecidas

- **PDF:** o PDF é exibido **inteiro**, pelo visualizador do aparelho, pelo tempo definido. Não há duração por página (Fase 4) e muitas TVs não têm visualizador de PDF; para elas o conteúdo é pulado com o aviso "formato não suportado". A recomendação continua sendo exportar o documento como imagens ou vídeo ([FORMATOS.md](FORMATOS.md)).
- **Só o próximo conteúdo é pré-carregado.** Não há pré-carregamento de vários à frente.
- **Vídeo sempre sem som.** O player não oferece áudio (os navegadores costumam recusar o início automático de vídeo com som).
- **Sem painel de diagnóstico remoto das falhas de reprodução.** Os avisos aparecem na própria tela da TV e nos anúncios; o servidor ainda não recebe o registro delas (Fase 3).
- **O nível de efeitos aprendido fica no navegador da TV** e vale para aquele navegador; apagar os dados do navegador o zera.
- **A medição de lentidão exige uma amostra mínima de quadros** (8 intervalos entre quadros por troca, cerca de 150 ms a 60 quadros por segundo): transições mais curtas que isso podem não gerar amostra, e então o nível não muda.
- **Conferência de acessibilidade:** testes e cenários verificam nomes, estados, anúncios e uso só com o teclado; não houve auditoria com leitores de tela reais nem avaliação WCAG formal.
- **Os cenários em navegador esperam o tempo real** das trocas e quedas de rede (o de reprodução leva alguns minutos).
- Todas as limitações de ambiente de [VALIDACAO.md](VALIDACAO.md#o-que-não-foi-validado).

## 9. Compatibilidade com a Fase 1

- **Dados:** a migração 7 só **acrescenta** colunas com padrões que mantêm o comportamento: toda playlist e versão continuam repetindo (`loop_enabled = 1`) e todo item continua com tempo definido (`duration_mode = 'fixed'`). A própria migração confere isso e desfaz tudo se algum registro não receber o padrão. Playlists, versões, programações, contas e TVs não mudam.
- **TVs já pareadas:** o player novo lê a credencial da mesma chave do armazenamento do navegador e envia a mesma credencial: a TV pareada na Fase 1 continua pareada (conferido por teste). Não é preciso parear de novo.
- **API:** nenhum caminho foi removido ou mudou de significado. O manifesto da TV ganhou `loop` (na raiz) e `durationMode` (em cada item); as respostas de playlist ganharam `loop` e `durationMode`; as de versão, `loop`. As requisições antigas, sem os campos novos, continuam valendo. Um player da Fase 1 **não foi testado** lendo o novo manifesto.
- **Volta atrás:** pare o servidor, restaure o backup `tvcorp-antes-da-migracao-…` (ou a cópia de `data/` feita antes) e use os arquivos da Fase 1. Não abra um banco já migrado pela Fase 2 com o código da Fase 1.

## 10. Próximos passos e decisões que dependem de você

| Fase | Pode ser testada sem televisão? | Depende de |
| --- | --- | --- |
| 3. Player Universal | Só o núcleo e o diagnóstico; a compatibilidade exige aparelhos | Modelos, anos e sistemas das televisões disponíveis |
| 4. Mídias e upload | Em grande parte | Programas conversores no servidor (inclui a duração por página de PDF); licenças e credenciais do Power BI e, se for o caso, do Canva |
| 5. Senha e usuários | Sim, com um servidor de e-mail de teste | Serviço de e-mail (SMTP) da empresa |
| 6. Interface | Sim, no Chromium | Nada externo |
| 7. Qualidade e infraestrutura | Parcialmente | Servidor da empresa e aparelhos reais |

Decisões que continuam sendo suas:

1. **Televisões.** Quais modelos e sistemas existem de fato nas unidades. Sem isso, a Fase 3 não tem como ser planejada e o desempenho dos efeitos só pode ser medido num aparelho.
2. **Modo demonstração do painel.** Voltar ou não (veja o relatório da Fase 1, seção 3.1).
3. **Quatro olhos.** A empresa exige que quem envia um arquivo não seja quem o aprova?
4. **E-mail.** Qual serviço de envio será usado na recuperação de senha (Fase 5).
