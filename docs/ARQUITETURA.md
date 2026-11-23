# Arquitetura e limites

> Atualização 2.4.0: a TV pode tocar um vídeo direto do servidor por um link temporário assinado quando o aparelho não toca o arquivo baixado para a memória (veja "O player" e "Conteúdo" abaixo). Não há mudança de banco, de permissões nem de formatos. Detalhes em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md).
>
> Atualização 2.3.0: o Editor passa a criar e publicar programações nas TVs que a TI liberou para ele. Da 2.2.0 continuam valendo o envio de MOV e JPEG e o código de pareamento para Editor e Gestor. Cadastro de TVs, acessos, ordem global e usuários continuam exclusivos do Administrador. Detalhes em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md) e [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as TVs compartilhadas da 2.1.0 estão em [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

Este documento descreve a versão 2.4.0. O que mudou nesta versão está em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md), na 2.3.0, em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md), na 2.2.0, em [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md) e, na 2.1.0, em [RELATORIO-2.1.0.md](RELATORIO-2.1.0.md). O que mudou em relação à 2.0.0-fase1 (carrossel e reprodução) está em [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md); o que a Fase 1 mudou em relação à 1.1.0 está em [RELATORIO-FASE-1.md](RELATORIO-FASE-1.md).

## Componentes

```text
Portal administrativo ─┐
(navegador)            ├── HTTPS / proxy da TI ── Servidor Node.js ── SQLite (WAL)
Players das TVs ───────┘     (um só processo)            │
                                                        ├── Arquivos de mídia (MEDIA_DIR)
                                                        ├── Backups (BACKUP_DIR)
                                                        └── Antivírus externo (programa de linha de comando)
```

O proxy, o certificado HTTPS, o antivírus e os serviços de infraestrutura são fornecidos e operados pela TI. No desenvolvimento local, o navegador acessa o Node diretamente por HTTP em `127.0.0.1:4173`. Não há dependências npm: o servidor usa apenas módulos nativos do Node (inclusive `node:sqlite`).

## Mapa do código

| Caminho | Responsabilidade |
| --- | --- |
| `public/index.html`, `public/js/main.js` | Portal: página única e ponto de entrada dos módulos ES (sem framework nem etapa de build) |
| `public/js/lib/` | Regras do painel sem DOM: cliente da API (`api.js`), permissões da sessão, modelos de playlist, programação, TV, usuário, auditoria, pesquisa da biblioteca, fila de envio, roteamento |
| `public/js/ui/` | Componentes (`dom.js` monta elementos sem HTML em texto), diálogos, avisos, ícones, miniaturas, estrutura da página |
| `public/js/views/` | Uma pasta ou arquivo por tela: login, visão geral, biblioteca, playlists, programações, telas, usuários, auditoria, configurações. Em `views/playlists/`, a pré-visualização (`preview.js`), a demonstração de efeitos (`effect-demo.js`) e o encaixe do motor de reprodução na tela do painel (`stage-host.js`) |
| `public/js/playback/` | **Motor de reprodução**, o mesmo na TV e no painel: modelo do item (`model.js`), regras de tempo e de sequência (`timing.js`), carrossel (`carousel.js`), efeitos e níveis de simplificação (`effects.js`), tela com camadas (`stage.js`), carga dos arquivos e caminho do vídeo (`loader.js`), memória de arquivos (`media-cache.js`), posição lembrada (`recovery.js`) e textos de motivo (`messages.js`) |
| `public/js/player/app.js` | Player da TV: pareamento, consulta do manifesto, controles, recuperação de conexão e ligação com o motor |
| `public/styles.css`, `auth.css`, `panel.css` | Estilos do painel e da tela de acesso |
| `public/player.html`, `player.js`, `player.css` | Página da TV; `player.js` é só o ponto de entrada que liga `js/player/app.js` ao navegador real |
| `public/assets/` | Logotipo, fotografia e ícone, servidos pela mesma origem |
| `server/index.mjs` | Inicialização e encerramento do processo HTTP |
| `server/config.mjs` | Leitura e validação da configuração por variáveis de ambiente |
| `server/core.mjs` | Ponto de composição: abre o banco, migra, monta os serviços, liga as rotas e trata cada requisição |
| `server/http/` | Roteador, contexto da requisição, leitura segura de pedidos, respostas, cabeçalhos de segurança, arquivos estáticos e entrega de mídia (Range/ETag) |
| `server/routes/` | Rotas finas: traduzem HTTP para chamadas ao domínio |
| `server/domain/` | Regras de negócio e acesso ao banco: permissões, usuários, sessões, organização, pastas, mídias, formatos e conferência do conteúdo dos arquivos (`formats.mjs`, `content-check.mjs`), biblioteca, playlists, programações, TVs, player, auditoria |
| `server/db/` | Conexão, migrador e as 8 migrações |
| `server/lib/` | Utilitários: erros, validação, criptografia, limitador de tentativas, registro em JSON |
| `scripts/` | `configure`, `reset-admin`, `migrate`, `backup`, `verify-audit`, `check` |
| `tests/` | Testes automatizados (veja [VALIDACAO.md](VALIDACAO.md)) |
| `data/` | Criada ao usar: banco `tvcorp.sqlite`, `media/` e `backups/`; caminhos alteráveis por variável de ambiente |

## Caminho de uma requisição

1. `handle` (em `server/core.mjs`) aplica os cabeçalhos de segurança e valida o endereço pedido.
2. O roteador encontra a rota e sua regra de autenticação: `session` (padrão), `device` (TV), `device-or-session` ou `none`. Só a rota do arquivo de mídia é `device-or-session`; nela, um pedido **sem** cabeçalho `Authorization` e com um único parâmetro `t` é tratado como o link temporário de vídeo da TV (2.4.0): `t` inválido, vencido ou repetido dá 401 e nunca cai para o cookie de sessão.
3. Rotas de pessoa resolvem a sessão pelo cookie e, em qualquer método que altere dados, conferem a origem e o token CSRF. Rotas de TV validam o token do aparelho (guardado como hash).
4. O tratador chama o serviço de domínio. Serviços de conteúdo usam `authorize(usuário, permissão, recurso)`. TVs aplicam `requireDisplayAdmin` à gestão e as concessões de `server/domain/display-access.mjs` à consulta/publicação. As decisões são do servidor.
5. Alterações acontecem em uma transação (`tx`) e registram um evento na auditoria dentro da mesma transação.
6. Erros de negócio viram `{ error, code, details }` com o status HTTP adequado; falhas internas devolvem uma mensagem genérica e o detalhe vai só para o registro técnico.

## Modelo de dados

Banco SQLite com chaves estrangeiras ligadas, modo WAL e espera por bloqueio. O esquema (versão 8) tem estas tabelas:

| Tabela | Conteúdo |
| --- | --- |
| `units`, `sectors` | Cadastro global de unidades e setores (identificador permanente; nomes únicos) |
| `users`, `sessions` | Contas (perfil, escopo, permissões concedidas e retiradas) e sessões (só o hash do token) |
| `folders` | Pastas da biblioteca por espaço (unidade + setor), com pai, profundidade máxima de 8 e nome único por pasta |
| `media` | Arquivos: título, nome original, tipo, tamanho, SHA-256, situação (pendente, aprovado, rejeitado), resultado da varredura, pasta, autoria e revisão |
| `playlists`, `playlist_items` | O **rascunho** da playlist: a opção de repetição (`loop_enabled`) e itens ordenados com duração (5–3600 s), modo de duração (`duration_mode`: tempo definido ou, só em vídeo, até o fim) e transição (corte, esmaecer, dissolver, deslizar, zoom; 0–3000 ms) |
| `playlist_versions`, `playlist_version_items` | **Versões publicadas**, imutáveis (gatilhos impedem alterar); guardam a cópia da repetição e, em cada item, do tempo, do modo de duração e da transição, além do título, nome e tipo; o vínculo com o arquivo só pode ser desfeito |
| `schedules`, `schedule_displays` | **Programações**: apontam para uma versão fixa de uma playlist, com período e situação (rascunho, publicada, interrompida) e revisão (`rev`) para detectar edição concorrente; ligação com as TVs |
| `displays` | TVs por unidade, situação, remoção lógica, revisões de acesso/fila, hashes de pareamento e token, contato e autoria |
| `display_grants` | Concessões da TV por setor ou usuário, com histórico de revogação |
| `schedule_display_history` | Histórico de criação, autorização, retirada e suspensão dos vínculos |

| `audit` | Trilha de eventos encadeada por hash |
| `schema_migrations` | Migrações aplicadas (número, nome, data, impressão digital, resumo) |
| `records` | Registros genéricos da 1.1.0, mantidos intactos como histórico (o servidor atual não os usa) |

Seis gatilhos fazem valer no próprio banco: pasta não muda de espaço nem forma ciclo; mídia não muda de espaço e fica sempre em pasta do mesmo espaço; versões de playlist são imutáveis (a migração 7 recriou o gatilho dos itens para proteger também o novo modo de duração; o da versão já vedava qualquer alteração, inclusive da repetição). As regras também são conferidas no código de domínio, em duas camadas. Detalhes da migração em [MIGRACOES.md](MIGRACOES.md).

## Biblioteca, playlist e programação

Os três conceitos têm interfaces, regras e tabelas separadas:

- **Biblioteca** guarda e organiza arquivos em pastas. Mover um arquivo ou pasta não altera seu identificador, então nada que o referencia quebra.
- **Playlist** é a lista ordenada de arquivos que vai passar. O rascunho é editável; **Publicar versão** tira uma cópia numerada e imutável.
- **Programação** liga uma **versão** de playlist a TVs e a um período. Publicar uma versão nova da playlist **não muda o que está no ar**: a programação continua apontando para a versão que escolheu até alguém atualizá-la.

O manifesto que a TV recebe (`GET /api/player/manifest`) é montado a cada consulta: programações publicadas e dentro do período que incluem aquela TV, na ordem global configurada para a TV. Cada vínculo exige autorização válida; cada arquivo deve estar **aprovado** (e, em produção, **verificado**), na unidade da TV e no setor da programação. Bibliotecas permanecem isoladas por setor. Cada item traz `id`, `title`, `name`, `type`, `url`, `duration` e, como acréscimos da 2.0, `transition` e `transitionMs` (Fase 1) e `durationMode` (Fase 2: `fixed` ou `natural`). O manifesto traz também `loop` (Fase 2), que só é falso quando todas as playlists ativas com conteúdo liberado para aquela TV estão com a repetição desligada. Os campos antigos continuam com o mesmo formato e significado (um teste confere conteúdos e tempos de uma TV pareada na Fase 1 depois da migração); os novos são só acréscimos. O manifesto vale por no máximo 60 segundos, ou até o término da programação mais próxima.

Rejeitar um arquivo, interromper uma programação ou remover uma TV tem efeito na consulta seguinte, sem esperar a publicação de nada.

A fila global é consultada em `GET /api/displays/:id/sequence` e reordenada somente pelo Administrador com `PUT /api/displays/:id/order`. As revisões de acesso e ordem são independentes; a gravação da fila compara a revisão dentro de uma transação. Vínculos guardam o responsável pela autorização. A retirada de acesso suspende os vínculos dependentes, sem reativação automática ao restaurar uma concessão; uma edição comum também não troca o responsável. A autoridade global de um Administrador não depende apenas de concessões de setor.

## Autorização

Duas condições valem ao mesmo tempo: a **permissão** (padrão do perfil + concedidas − retiradas) e o **escopo** (a unidade **e** o setor do recurso nas listas da conta). O Administrador tem alcance global; os demais têm as listas de unidades e setores, que permitem **todas as combinações** entre os itens atribuídos. Não há escopo por pasta nem lista de pares específicos.

São 21 permissões e quatro perfis padrão. Somente o Administrador administra usuários e TVs; as seis permissões reservadas não podem ser concedidas a outro perfil. Editor e Gestor recebem por padrão `screen:pair`, que apenas gera o código de pareamento das TVs a que têm acesso, e (o Editor, desde a 2.3.0) `schedule:create` e `schedule:publish`, que valem só no escopo da conta e nas TVs liberadas a ela. O Gestor mantém conteúdo e auditoria no seu escopo; o Editor, por padrão, não aprova arquivos nem publica versões de playlist. A matriz completa, as regras e o que a migração fez com as contas da 1.1.0 estão em [PERMISSOES.md](PERMISSOES.md). A interface esconde o que a pessoa não pode fazer por conveniência; a decisão é sempre do servidor, e um teste confere que as permissões que o painel usa são exatamente as do servidor.

A aprovação de arquivos por Gestor está disponível, mas o código não exige que autor e aprovador sejam pessoas diferentes. Se a política exigir segregação estrita de funções, essa regra precisa ser implementada antes da liberação. Atualizar uma conta encerra as sessões dela, e o sistema não deixa de ter ao menos um Administrador ativo. Uma redefinição de senha exige perfil administrativo, encerra as sessões da conta e gera um evento específico sem registrar o segredo.

## Sessões e dispositivos

As sessões administrativas expiram após oito horas. O cookie é `HttpOnly` e `SameSite=Strict`, com `Secure` sempre que a origem pública (`APP_ORIGIN`) é HTTPS. O navegador guarda um token aleatório e o banco guarda só o hash. Senhas usam scrypt com sal aleatório. Há limitação de tentativas de login por endereço e por conta; os contadores ficam na memória do processo e não são distribuídos.

`scripts/reset-admin.mjs` permite à TI recuperar a senha de uma conta administrativa ativa por terminal interativo no servidor. Esse procedimento usa acesso local ao banco e não possui endpoint público de recuperação. Restringir o acesso ao sistema operacional e ao diretório de dados é parte da fronteira de segurança.

O cadastro de TV gera um código de seis dígitos, válido por dez minutos e utilizável uma vez; o sistema evita repetir um código ainda válido. O pareamento troca esse código por um token exclusivo da TV. O servidor armazena o hash do token; o player o mantém no armazenamento local do navegador e o envia em `Authorization: Bearer`, sem colocá-lo na URL. Somente o Administrador cadastra TVs; novas TVs nascem ativas. O estado pendente é mantido para registros legados. Para uma TV já cadastrada e ativa, um código novo é gerado de duas formas: o Administrador **renova o pareamento** (`POST /api/displays/:id/pairing`), o que revoga a credencial atual da TV; e Editor e Gestor com `screen:pair` apenas **geram o código** (`POST /api/displays/:id/pairing-code`) das TVs a que têm acesso, sem tocar na credencial. Em ambos só o hash do código é guardado e um código novo substitui o aberto.

Renovar o pareamento (Administrador) revoga a credencial anterior; gerar o código (Editor e Gestor) não revoga, e a credencial anterior deixa de valer quando o código novo é usado em `POST /api/player/pair`. Remover a TV do servidor revoga o acesso. Apagar o token somente no navegador não revoga sua cópia no servidor; a TI deve usar a administração de telas quando a intenção for revogar.

## Conteúdo

O envio tem limite de tamanho, lista explícita de extensões e verificação da assinatura do arquivo. Essa verificação identifica formatos conhecidos; não valida integralmente o documento nem garante ausência de conteúdo malicioso. Para JPEG e MOV, `server/domain/content-check.mjs` percorre também a estrutura do arquivo inteiro, sem decodificar nem executar nada e sem dependências externas: JPEG cortado ou com codificação que os navegadores não exibem e MOV incompleto, sem imagem, com dados fora do arquivo ou com codec que não seja H.264 ou HEVC são recusados com 415. Não existe análise nem conversão de vídeo (nenhum FFmpeg): o MOV é guardado e entregue como foi enviado, depois de aprovado. Se configurado, o antivírus é executado antes de registrar a mídia. Em produção, ausência de configuração bloqueia a inicialização e falha de varredura bloqueia o arquivo. Fora de produção, sem antivírus, o arquivo fica com o resultado "não configurado" e a aprovação exige ciência explícita, registrada na auditoria.

Todo arquivo enviado entra como **aguardando aprovação**. Os arquivos ficam em `MEDIA_DIR` com nome gerado pelo servidor, fora do diretório público, e são entregues pela API com verificação de escopo, suporte a `Range` e `ETag`. O disco é lido em blocos de 256 KB (`SEND_CHUNK_BYTES`; a medição está em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md)). Além da credencial da TV, o arquivo de um vídeo da programação ativa pode ser aberto por um link temporário assinado, pedido pela própria TV (veja "O player").

## O player

O player é o módulo `public/js/player/app.js`; `public/player.js` só o liga ao navegador real (documento, rede, relógio e armazenamento entram por parâmetro, e é por isso que o mesmo código roda nos testes do Node com relógio e rede de mentira). Ele consulta o manifesto a cada 20 s (se falhar, tenta de novo em 5, 10 e 20 s) e envia o sinal de vida (`heartbeat`). Não recebe comandos por push nem espelha a tela de outro computador. Os arquivos são buscados pela rede com a credencial da TV e guardados **só em memória**; não existe armazenamento offline gerenciado. **Vídeo, dois caminhos (2.4.0):** o padrão é tocar o arquivo baixado para a memória (endereço `blob:`). Se o `<video>` falha por decodificação, o palco pede à fonte o outro caminho uma única vez: a TV pede `GET /api/player/media/:id/link` (com a credencial dela) e o `<video>` passa a abrir `/api/media/:id/file?t=…`, sem a credencial no endereço de rede. O link é assinado (HMAC-SHA256 sobre o arquivo, a TV, a validade e a credencial atual da TV, com chave que existe só na memória do processo), vale 6 horas, serve só para aquele arquivo e cada pedido reconfere a programação ativa da TV. O navegador da TV guarda qual caminho funcionou (chave `tv-corporativa.video-way.v1`) e a próxima abertura da página já começa por ele; uma TV que toca o arquivo baixado nunca grava nada. Imagens e PDFs não usam o link. A validade curta do manifesto evita manter uma programação autorizada indefinidamente sem contato com o servidor: sem uma consulta bem-sucedida nos últimos 60 s a TV para de exibir, guarda o ponto onde estava e retoma dele quando a conexão volta.

Quem decide o que aparece, por quanto tempo e como é o **motor de reprodução** (`public/js/playback/`), o mesmo código que o painel usa na pré-visualização:

| Peça | O que decide |
| --- | --- |
| `model.js` | Converte cada conteúdo do manifesto (ou do rascunho) em item do carrossel: tipo, tempo, modo de duração, efeito e tempo da transição, já validados e dentro dos limites |
| `timing.js` | Regras puras: quanto cada conteúdo fica na tela, o próximo da sequência (com ou sem repetição), a espera entre tentativas e entre consultas |
| `carousel.js` | O carrossel: ordem, tempo, repetição, pausa, Anterior e Próximo, preparação antecipada do conteúdo seguinte, pulo do que falha e retomada |
| `effects.js`, `stage.js` | Os cinco efeitos em uma tela de camadas, a simplificação por movimento reduzido ou por aparelho lento e a medição de fluidez |
| `loader.js`, `media-cache.js` | Baixa cada arquivo com prazos e conferência de tamanho; a memória guarda no máximo 96 MB e 32 arquivos, e o mais antigo sai primeiro. Para vídeo, oferece também o **link direto** do servidor (2.4.0) e lembra qual dos dois caminhos funciona naquela TV |
| `recovery.js` | Lembra a posição da exibição (um número e uma assinatura da programação, por 10 minutos), nunca conteúdo nem credencial |

Como o carrossel se comporta:

- **Sem tela vazia.** O conteúdo seguinte é preparado por trás (imagem decodificada, vídeo carregado) enquanto o atual continua na tela; só então ele entra por cima, e o anterior permanece até o fim da transição. Se o conteúdo não fica pronto em 120 s ou falha, ele é pulado por 30 s com o motivo na barra de status, e o motor tenta de novo depois. Um arquivo que falha por rede é tentado até três vezes. Sem nenhum conteúdo possível, a TV avisa e tenta de novo a cada 10 s; um vídeo que para de avançar por 15 s é considerado travado.
- **Tempo.** Contado desde o início da entrada do conteúdo, de modo que a soma dos tempos é a duração do ciclo. Imagem e PDF ficam o tempo definido; o vídeo, no modo *tempo definido*, é limitado por ele e, no modo *até o fim*, toca inteiro (a duração do vídeo mais 2 s de folga é o prazo de segurança; o tempo definido é a reserva se o aparelho não ler a duração).
- **Repetição.** Ligada, a sequência recomeça sem parar; desligada, ela é exibida uma vez e o último conteúdo permanece. **Anterior** e **Próximo** sempre dão a volta, mesmo sem repetição.
- **Efeitos.** Opacidade, deslocamento e escala executados pelo navegador, e desfoque no *Dissolver*. Com o sistema pedindo menos movimento o efeito vira *Esmaecer*; o player mede a fluidez das transições no próprio aparelho e, depois de duas lentas seguidas, desce de nível (efeitos completos, só *Esmaecer*, corte seco), lembrando o nível por 7 dias.
- **Controles.** Pausar, Anterior, Próximo, áudio, tela cheia e desconectar, também pelo teclado (`K` ou Espaço, `N`, `P`, `M` e as teclas de mídia). Os controles somem depois de 6 s sem uso, exceto durante pausa, foco ou necessidade de ativar áudio, e voltam com qualquer tecla, toque ou movimento do ponteiro.

O som tenta iniciar habilitado, no volume 1. Se o navegador recusar com `NotAllowedError`, há uma única tentativa muda e o botão **Ativar áudio**. Se recusar também sem som, o motor pausa; não há repetição automática para contornar a política. A ação de áudio chama `play()` no gesto e não retoma uma exibição pausada. O silêncio escolhido dura pela sessão do palco. Elementos liberados são reutilizados quando possível, sem presumir autorização para outros elementos. Pausa, fim, troca e revogação interrompem o som anterior imediatamente, mantendo apenas o quadro durante o efeito.

A pré-visualização do painel usa o mesmo motor, com diferenças deliberadas: os arquivos vêm direto do servidor (o navegador já está autenticado), nada é guardado no navegador e o nível de efeitos é sempre o completo. **A compatibilidade com modelos de TV não foi validada:** as capturas de navegador das fases anteriores e os testes automatizados não substituem homologação de áudio, codecs e desempenho em cada equipamento. O tempo por página de PDF não existe.

## Rastreabilidade e escala

Eventos administrativos são persistidos com o hash do evento anterior, a unidade e o setor (quando o evento tem escopo) e a data em UTC. `GET /api/audit` devolve por página (padrão 200, no máximo 500) e respeita o escopo de quem consulta; o painel carrega 200 por vez e exporta até 10.000 eventos em CSV. `npm run audit:verify` percorre a cadeia local completa. O controle não impede alteração por alguém que controla integralmente o host e consegue recalcular os hashes. Evidências independentes exigem exportação a um destino separado.

A aplicação opera como um único processo Node com SQLite em disco local. Os arquivos enviados são lidos inteiros em memória, e algumas operações de banco e de criptografia são síncronas. Valide volume de mídia, quantidade de TVs e concorrência no piloto. Não houve teste de carga. Armazenamento de objetos, tarefas assíncronas, banco externo, alta disponibilidade e limitação de tentativas distribuída são evoluções necessárias conforme a escala. Mais detalhes em [IMPLANTACAO.md](IMPLANTACAO.md).

## Princípios do painel

- Roteamento por endereço com `#` (links diretos e o botão Voltar funcionam), com um ciclo de vida por tela: o que ficou pendente de uma tela não aparece em outra, e sair da conta limpa tudo.
- Nenhum HTML é montado a partir de texto: os elementos são criados por funções (`h()`), então nomes de arquivos, playlists e pessoas aparecem sempre como texto.
- Só `lib/api.js` (e a carga de miniaturas) fala com a rede; só `lib/prefs.js` usa o armazenamento do navegador, e apenas para conveniências (texto ampliado, contraste, grade ou lista na biblioteca e o último espaço escolhido), nunca para dados de negócio nem segredos.
- As permissões que a interface usa são as do servidor (teste automático confere); o que a interface esconde, o servidor também recusa.
- Módulos pequenos, importados explicitamente; um teste verifica que não sobra arquivo sem uso nem importação para nome inexistente.

## Decisões de arquitetura

| Decisão | Motivo |
| --- | --- |
| Manter Node.js e SQLite, sem dependências npm | Requisito do projeto; menos superfície de ataque e de manutenção |
| Playlist, versão e programação como estruturas distintas | Permitir editar uma playlist sem alterar o que está no ar |
| Versões publicadas imutáveis (também no banco, por gatilho) | Rastreabilidade e reversão sem perda |
| Regras centrais para conteúdo, administração e concessões de TV | Preservar escopos sem tratar compartilhamento de aparelho como compartilhamento de biblioteca |
| Migrações tudo-ou-nada, com backup verificado antes | Atualizar sem perder dados e poder voltar |
| A programação migrada mantém o identificador da publicação antiga | A auditoria antiga continua apontando para ela |
| Identificadores permanentes (UUID) para pastas, mídias, playlists e programações | Mover ou renomear não quebra referências |
| Configuração só por variáveis de ambiente, validada na inicialização | Falhar cedo e sem credenciais no código |
| Vídeo: arquivo baixado como padrão e link temporário assinado como segundo caminho, escolhido por TV | Não mudar o que já funciona (o próximo vídeo fica pronto antes de entrar e a exibição não depende da rede) e dar uma saída às TVs que recusam o endereço `blob:`; o link não amplia acesso, porque cada pedido reconfere a programação |

## O que esta arquitetura não tem

Não existem nesta versão: Microsoft SSO, Graph, Power BI autenticado, conversão de vídeo, de arquivos Office e de PDF em páginas (e, com ela, o tempo de exibição por página), recuperação de senha com aprovação, tema escuro, aplicativos nativos para webOS, Tizen, Android TV ou Roku, central de monitoramento detalhada dos aparelhos e gestão MDM dos players. A preparação e os critérios de liberação estão em [SEGURANCA.md](SEGURANCA.md).
