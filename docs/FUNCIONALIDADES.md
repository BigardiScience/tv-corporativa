# Guia das funcionalidades

> Atualização 2.4.0: a TV que não toca o vídeo baixado para a memória passa a tocar o mesmo arquivo direto do servidor, sem mudar nada no painel. Detalhes em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md).
>
> Atualização 2.3.0: o Editor passa a criar e publicar programações nas TVs que a TI liberou para ele. Da 2.2.0 continuam valendo o envio de MOV e JPEG e o código de pareamento para Editor e Gestor. Cadastro de TVs, acessos, ordem global e usuários continuam exclusivos do Administrador. Detalhes em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md) e [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as TVs compartilhadas da 2.1.0 estão em [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

Este guia explica, tela por tela, o que a versão 2.4.0 faz, quais regras valem e quem pode agir. Os nomes de botões e situações são os que aparecem no painel. As permissões citadas (como `media:approve`) estão explicadas em [PERMISSOES.md](PERMISSOES.md); o que cada perfil recebe por padrão está na matriz daquele documento.

> **Sobre as imagens:** são capturas do painel feitas pelos testes automatizados em navegador (Chromium), em ambiente de teste e com **dados fictícios** (arquivos de poucos bytes, contas `example.invalid`). Servem para mostrar a organização das telas, não um conteúdo real. As capturas são históricas das fases 1 e 2 da 2.0. Não mostram as novas concessões, a fila global e o áudio da 2.1, nem a lista de formatos com MOV e JPEG e o botão de código de pareamento de Editor e Gestor da 2.2; nessas áreas, siga o texto atual e [TV-GLOBAL-E-AUDIO.md](TV-GLOBAL-E-AUDIO.md). A captura da janela de novo usuário, em Usuários e permissões, é da 2.3.0.

## Do arquivo até a TV, em sete passos

1. **Biblioteca** — envie os arquivos para uma pasta do seu espaço (unidade + setor).
2. **Aprovação** — quem tem `media:approve` aprova (ou rejeita) cada arquivo. Só arquivo aprovado vai para uma playlist publicada.
3. **Playlist** — monte a lista do que vai passar: ordem, tempo de cada item, transição e repetição. Confira com **Pré-visualizar** e salve como rascunho.
4. **Publicar versão** — a playlist ganha uma versão numerada e **imutável**. É ela que uma programação usa.
5. **Programação** — escolha a playlist publicada, as TVs e o período em que ela deve tocar. Programar é o que leva a playlist às TVs.
6. **Telas** — cadastre a TV, ative-a e digite o código de pareamento no aparelho.
7. **Acompanhe** — a TV mostra a programação enquanto ela estiver no período; a auditoria registra quem fez cada passo.

A separação central da versão 2.0: a **playlist** diz *o que* passa; a **programação** diz *quando* e *onde*. Na 1.1.0 as duas coisas eram uma só (uma "playlist" era, na prática, uma publicação). A migração converteu cada publicação antiga em uma playlist (versão 1 publicada) mais uma programação ([MIGRACOES.md](MIGRACOES.md)).

## Espaço de trabalho: unidade e setor

Todo conteúdo pertence a **uma unidade e um setor**. O seletor no alto do menu lateral escolhe o espaço em que você está trabalhando; ele é uma conveniência de navegação. O que você pode ver ou alterar é decidido pelo servidor conforme a unidade e o setor da sua conta (regra de **escopo**). Administrador enxerga todos os espaços; as demais contas, só os seus.

## Visão geral

Mostra, para o espaço escolhido, o número de TVs (e quantas estão online), de arquivos (e quantos aprovados), de playlists e de programações no ar, além das TVs com o que está no ar e, para quem tem `audit:read`, as últimas atividades. O botão **Pré-visualizar TV** abre o player em modo demonstração (sem transmissão real).

## Biblioteca

A biblioteca organiza os arquivos **em pastas**, com até **8 níveis**. A árvore de pastas fica à esquerda; acima da lista aparece o caminho percorrido.

**O que dá para fazer**

| Ação | Como | Permissão |
| --- | --- | --- |
| Criar pasta | **Nova pasta** | `folder:create` |
| Renomear ou mover pasta | Menu da pasta, ou arrastando para outra pasta | `folder:update` |
| Excluir pasta | Menu da pasta; se não estiver vazia, pede uma segunda confirmação e exclui o conteúdo junto (tudo ou nada) | `folder:delete` |
| Enviar arquivos | **Enviar arquivos**: escolha ou arraste os arquivos; há fila com progresso | `media:upload` |
| Renomear ou mover arquivo | Menu do arquivo, arrastando para uma pasta ou **Mover para…**. Renomear muda o **título** (o nome que aparece nas playlists); o nome do arquivo original não muda | `media:update` |
| Aprovar ou rejeitar | **Aprovar** ou **Rejeitar** no menu do arquivo, ou em lote (**Selecionar todos** ou seleção com Shift); pede confirmação | `media:approve` |
| Excluir arquivo | Menu do arquivo ou em lote | `media:delete` |
| Consultar | Buscar, filtrar por tipo e situação, ordenar, alternar entre grade e lista, **Mostrar arquivos das subpastas** | só o escopo |

**Regras**

- Formatos aceitos: **PNG, JPG, JPEG, WebP, PDF, MP4, MOV e WebM**, com a extensão em maiúsculas ou minúsculas (veja [FORMATOS.md](FORMATOS.md)). O tamanho máximo por arquivo é o definido pelo servidor (50 MB por padrão). A janela de envio, ao escolher ou ao arrastar os arquivos, recusa antes de enviar o que não pode ser aceito; o servidor confere de novo e confirma o tipo pelo **conteúdo** do arquivo, não só pela extensão. Em JPEG e MOV o arquivo inteiro é percorrido: um arquivo incompleto, renomeado ou com codec de vídeo que o sistema não aceita (só H.264 e HEVC) é recusado na hora, com a orientação, e não entra na biblioteca.
- Nome de pasta é único dentro da mesma pasta (sem diferenciar acento e maiúsculas). Ao enviar vários arquivos com o mesmo título para o mesmo lugar, o sistema acrescenta (2), (3)…
- **Arquivo repetido:** se o conteúdo (impressão digital SHA-256) já existe no mesmo espaço, o painel avisa e só envia se você confirmar.
- **Situações do arquivo:** *Aguardando aprovação*, *Aprovado* e *Rejeitado*. Quem envia fica aguardando; um Editor (por padrão) não aprova.
- **Antivírus:** em ambiente local, sem antivírus configurado, aprovar exige a confirmação de que não houve verificação, e isso fica na auditoria. Em **produção**, um arquivo só é aprovado e só chega à TV depois de verificado.
- **Mover não quebra nada:** playlists e programações continuam apontando para o mesmo arquivo. **Excluir é bloqueado** enquanto o arquivo estiver no rascunho de alguma playlist ou em uma programação **publicada**; a janela lista as playlists e as programações no ar que o impedem. **Rejeitar** um conteúdo o tira do ar imediatamente. Cartões e linhas mostram as marcas **Em playlist** e **No ar**.
- Pastas e arquivos nunca saem do espaço (unidade + setor) em que nasceram.

## Playlists

Uma playlist é a lista ordenada **do que passa**, sem data nem TV. Ela tem **rascunho** (editável) e **versões publicadas** (cópias fixas).

**Montar**

1. Em **Playlists**, use **Nova playlist** e dê um nome (e, se quiser, uma descrição).
2. **Adicionar da biblioteca** abre o seletor. Por padrão mostra só arquivos aprovados; respeita o limite de itens por playlist (6 por padrão; o servidor aceita configurar de 1 a 15).
3. Ordene pelos botões de seta ou arrastando a alça. Para cada item defina a **Duração (s)** (de 5 a 3600; padrão 15) e a **Transição** (*Corte seco*, *Esmaecer*, *Dissolver*, *Deslizar* ou *Zoom*) com o **Efeito (ms)** de 0 a 3000 (padrão 600; *Corte seco* é sempre 0). Valores fora do limite são corrigidos na própria tela. Em **vídeo**, o campo **Tempo do vídeo** escolhe entre *Tempo definido (limite)* — o vídeo toca até o fim ou até o limite, o que vier primeiro — e *Até o fim do vídeo*; neste caso o número vira uma **Reserva (s)**, usada só se a TV não conseguir ler a duração do vídeo. Em imagem e PDF vale sempre o tempo definido.
4. Marque ou desmarque **Repetir a playlist continuamente**. Ligada (padrão), a TV volta ao primeiro conteúdo depois do último; desligada, exibe a sequência uma vez e mantém o último conteúdo na tela. A repetição é gravada junto com o rascunho e copiada para cada versão publicada: para mudar o que está no ar, publique uma versão nova e atualize a programação.
5. **Ver efeito**, em cada conteúdo, abre uma demonstração com dois conteúdos de exemplo que se alternam com o efeito escolhido. Troque o efeito e a duração, use **Ver de novo** e **Pausar**, e **Usar este efeito** aplica a escolha só àquele conteúdo (como alteração a salvar). Fechar sem escolher não muda nada. Quem só consulta a playlist vê a demonstração, mas não tem o botão de aplicar.
6. **Salvar rascunho.** Sair com alterações pendentes pede confirmação.
7. **Pré-visualizar** exibe a playlist inteira, a partir do rascunho atual (inclusive o que ainda não foi salvo), com o **mesmo motor de reprodução da TV**: ordem, tempo de cada conteúdo, vídeo até o fim ou com limite, efeito de entrada e repetição. Os vídeos tentam tocar com som, como na TV; há controle de silêncio e **Ativar áudio** quando o navegador bloquear. Há **Anterior**, **Pausar**/**Reproduzir**, **Próximo** e a lista **Sequência** para saltar para um conteúdo; conteúdos que o navegador não consegue abrir aparecem numa lista com o motivo. A mesma pré-visualização é oferecida antes de publicar, em **Ver conteúdo** de uma versão e no formulário da programação.
8. **Publicar versão**, com uma nota opcional. A janela de revisão mostra a quantidade de conteúdos, a duração de um ciclo e se a repetição está ligada (ou se a TV exibirá a sequência uma vez e manterá o último conteúdo), lista cada conteúdo com o tempo e o efeito, e tem o botão **Pré-visualizar** para ver exatamente o que será publicado. A versão recebe um número e passa a ser imutável.

**Regras**

- O rascunho aceita conteúdo ainda *Aguardando aprovação*, mas **a publicação é bloqueada** enquanto houver item não liberado (pendente, rejeitado, sem verificação em produção ou excluído) ou a playlist estiver vazia. A mensagem lista os itens.
- **Versões publicadas** (painel à direita): **Ver conteúdo** mostra o que foi publicado; **Restaurar no rascunho** copia uma versão antiga de volta para edição, sem apagar nada. Publicar uma versão nova **não altera** o que já está no ar: programações apontam para uma versão específica.
- **Conflito de edição:** se outra pessoa salvar a playlist enquanto você edita, a tela avisa e oferece carregar a versão mais recente em vez de sobrescrever.
- Uma playlist usada por alguma programação **não pode ser excluída**.
- **Transições:** ficam gravadas na playlist e em cada versão e são aplicadas pelo player da TV (*Corte seco*, *Esmaecer*, *Dissolver*, *Deslizar* e *Zoom*, cada um com a duração escolhida). Em aparelho lento, em navegador sem suporte a animações ou quando o sistema pede **menos movimento**, o player **simplifica** o efeito (esmaecer ou corte seco) e a tela diz o motivo; a pré-visualização e o "Ver efeito" fazem o mesmo. *Dissolver* usa desfoque e pede mais do aparelho. A troca de conteúdo nunca deixa a tela vazia: o conteúdo novo só aparece depois de pronto. Teste sempre em uma TV antes de divulgar.
- **PDF:** o tempo definido vale para o documento inteiro; as páginas não passam sozinhas. O tempo por página **não existe** nesta versão (não há conversão de PDF em imagens).
- **Vídeos** tentam iniciar com som, volume máximo. Se o navegador bloquear, há um fallback mudo e **Ativar áudio**. Se bloquear também sem som, use **Reproduzir**. Silenciar permanece durante a sessão. O limite de um vídeo com tempo definido corta o vídeo no limite; para ver o vídeo inteiro, use *Até o fim do vídeo*.

| Ação | Permissão |
| --- | --- |
| Criar playlist | `playlist:create` |
| Editar o rascunho | `playlist:update` |
| Publicar versão | `playlist:publish` |
| Excluir playlist | `playlist:delete` |

## Programações

Uma programação liga **uma versão publicada de uma playlist** a **uma ou mais TVs**, em um **período**. É o que leva conteúdo às telas.

**Criar**

1. **Nova programação**. Dê um nome (por exemplo, "Avisos de agosto — Recepção").
2. Escolha a **Playlist** (só aparecem as que têm versão publicada) e a **Versão da playlist**. Para usar outra playlist depois, crie outra programação.
3. **Início** e **Término** são opcionais: início vazio começa assim que for publicada; término vazio não tem data final. Os horários seguem o fuso do navegador (o aviso aparece na tela); o servidor guarda em UTC.
4. Marque as **TVs que vão exibir**. Para publicar, as TVs precisam estar ativas, na mesma unidade e autorizadas para o setor e responsável; uma TV *Aguardando ativação* aparece desabilitada (um rascunho aceita).
5. **Salvar rascunho** ou **Publicar agora** (a tela pede confirmação mostrando playlist, período e TVs).

**Situações:** *Rascunho*, *Agendada* (publicada, ainda não começou), *No ar*, *Encerrada* (passou o término) e *Interrompida*. A lista tem filtro por situação.

**Regras**

- Quando a playlist ganha uma versão nova, a programação **avisa** e oferece **Atualizar versão**; nada muda no ar até você aceitar.
- **Interromper** tira a programação do ar. **Só depois de interromper** (ou de ser rascunho) ela pode ser excluída.
- Várias programações ativas **somam** seus conteúdos na ordem global definida para a TV. Ela recebe mídia da própria unidade e dos setores de programações autorizadas, sem abrir bibliotecas entre setores.
- **Conflito de edição:** se outra pessoa alterar a programação enquanto a tela está aberta, a alteração é recusada com aviso (em vez de sobrescrever em silêncio).
- Em **Playlists**, o botão **Programar esta playlist** abre o formulário já preenchido.

| Ação | Permissão |
| --- | --- |
| Criar, alterar ou excluir um **rascunho** | `schedule:create` |
| Publicar, interromper, e alterar ou excluir uma programação já publicada ou interrompida | `schedule:publish` (uma programação no ar precisa ser interrompida antes de ser excluída) |

> Por padrão o Administrador, o Gestor e o **Editor** (desde a 2.3.0) têm as duas permissões; o Visualizador não tem nenhuma. O Editor programa só nas TVs que a TI liberou para ele e só com playlists que já têm versão publicada por um Gestor ou pela TI; ele continua sem aprovar arquivos e sem publicar versões de playlist. Para quem deve só preparar rascunhos, o Administrador retira `schedule:publish` em **Usuários → editar**: a pessoa cria e ajusta rascunhos, e a publicação (e qualquer mudança no que está no ar) fica com quem tem a permissão; a tela mostra esse aviso. Veja [PERMISSOES.md](PERMISSOES.md#editor-e-programações-230).

## Telas (TVs)

**Cadastrar e conectar**

1. Como Administrador, use **Cadastrar TV**, informe nome e unidade e escolha setores e/ou usuários autorizados. O cadastro nasce **ativo**, com **código de pareamento**; ativação separada é para registros legados pendentes.
2. No aparelho, abra o endereço do player (`/player.html`) e digite o código de 6 dígitos.
3. O código vale **10 minutos** e **uma única vez**. Depois do pareamento, a TV guarda uma credencial própria no navegador dela.

**Situações:** *Online* (falou com o servidor há poucos instantes), *Offline* e *Aguardando ativação*. **Online não garante que o conteúdo esteja visível**: confira a tela do aparelho.

**Outras ações**

- **Código de pareamento (Administrador)** em uma TV já pareada gera outro código e **desconecta** o aparelho atual: a credencial antiga deixa de valer.
- **Código de pareamento (Editor e Gestor)**: quem tem a permissão `screen:pair` vê esse botão nas TVs **já cadastradas e ativas** que pode usar (a unidade da TV está na conta e a TV foi liberada para um setor da conta ou para a própria pessoa). Ele gera o código de 6 números **sem desconectar** a TV: o aparelho atual continua recebendo conteúdo até alguém digitar o código nele, e só então a credencial é trocada. Se já havia outro código aberto, o anterior deixa de valer. Editor e Gestor **não** cadastram, ativam, renomeiam nem removem TVs, não alteram acessos nem a ordem global e não gerenciam usuários; o Visualizador não tem esse botão. A geração fica na auditoria (*Código de pareamento gerado*) com a pessoa, a TV, a unidade e o horário, sem o código.
- **Renomear e editar acessos**: somente Administrador; a tela valida a revisão para evitar sobrescrita concorrente.
- **Remover**: somente Administrador. Revoga a credencial no servidor, marca a TV removida e suspende seus vínculos, preservando histórico. O player para na consulta seguinte ou ao vencer a autorização, de no máximo 60 segundos.
- O sistema registra quem cadastrou e quem ativou cada TV.

**No aparelho:** o player exibe a programação no ar como um carrossel. Cada conteúdo fica o tempo definido, a troca usa o efeito escolhido e o **próximo conteúdo é baixado e preparado antes de aparecer**, para não haver tela vazia entre eles. Os controles são **Anterior**, **Pausar**/**Reproduzir**, **Próximo**, **Áudio**, **Tela cheia** e **Desconectar**; somem após 6 segundos, exceto durante pausa, foco ou necessidade de ativar áudio, e voltam com qualquer toque, movimento do mouse ou tecla. Pelo teclado (ou por um controle remoto que envie essas teclas): **K**, espaço ou a tecla de mídia Play/Pause alternam a pausa; **N** ou a tecla de mídia Próxima avança; **P** ou a tecla de mídia Anterior volta. A linha de situação mostra a posição ("3 de 5 · Em exibição"), os conteúdos pulados e "Reconectando…" quando uma consulta ao servidor falhou, e uma barra fina mostra o progresso do conteúdo atual.

- **Conteúdo que não pode ser exibido** (arquivo ausente ou corrompido, formato ou codec que o aparelho não reproduz, falha de rede): o player **pula** para o próximo, mostra o motivo na tela, avisa por leitor de tela e **tenta de novo depois de 30 segundos**. Se nenhum conteúdo puder ser exibido, a tela explica e a TV tenta de novo a cada 10 segundos.
- **Queda de rede curta:** a exibição continua com o que já foi baixado, a linha de situação mostra "Reconectando…" e a TV volta a consultar o servidor sozinha (em 5, 10 e 20 segundos, e assim que o navegador avisa que a rede voltou). Conteúdos que faltaram voltam à exibição quando a rede volta.
- **Recarga ou reinício da página:** se a TV recarregar a página em até 10 minutos e a programação for a mesma, ela **retoma do conteúdo em que estava** (guarda só o número da posição e uma assinatura curta da programação, nunca conteúdo nem credencial).
- **Perda de contato por mais de 60 segundos:** a autorização que o player recebe do servidor vale por pouco tempo (no máximo 60 segundos à frente). Passado esse prazo sem contato, a TV **para de exibir** e mostra "Conexão interrompida."; quando a conexão volta, retoma do conteúdo lembrado. Remover a TV revoga a credencial no servidor imediatamente; a exibição para na próxima resposta de revogação ou no vencimento da autorização.
- **Memória:** os arquivos baixados ficam só na memória do aparelho, com limite de 96 MB e de 32 arquivos (o mais antigo sai primeiro); nada é gravado em disco, e arquivos que saem da programação são descartados.
- O link "Conhecer o player em demonstração" abre um exemplo que passa pelo mesmo carrossel, sem credencial e sem consultar o servidor.

> Capturas e medições de navegador disponíveis são registros históricos da Fase 2; a validação atual está em [VALIDACAO.md](VALIDACAO.md). **Não foi validada em TVs reais** (LG webOS, Samsung Tizen, AOC Android TV, Roku ou outras): o desempenho dos efeitos, os codecs de vídeo e o comportamento do navegador de cada TV podem ser diferentes. Veja [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md).

## Usuários e permissões

**Perfis:** Administrador TI, Gestor, Editor e Visualizador, cada um com permissões padrão. Em **Usuários** (menu Administração, exclusivo do Administrador):

- **Novo usuário** define nome, e-mail (que é o login e **não pode ser alterado depois**), perfil, senha inicial (de 12 a 128 caracteres; há geração automática), **unidades e setores autorizados** e as **permissões individuais**. O quadro mostra, em cada permissão, se é *Padrão do perfil*, *Concedida* ou *Retirada*, e **Restaurar o padrão do perfil** volta ao básico.
- **Editar** altera perfil, escopo, permissões e situação (conta ativa ou suspensa). Suspender impede a entrada **sem apagar o histórico**. Qualquer alteração encerra as sessões da pessoa.
- **Redefinir senha**: somente o Administrador.
- A lista tem busca por nome ou e-mail e filtros por perfil e situação. A coluna Permissões marca as contas **Personalizadas**.
- Somente o **Administrador** acessa a gestão de usuários, cria contas, altera permissões e redefine senhas. Concessões históricas não habilitam essas ações para outros perfis.
- O sistema nunca fica sem Administrador ativo, e uma pessoa não suspende a própria conta.

Cada pessoa consulta as próprias permissões efetivas no menu da conta, em **O que o meu acesso permite**. As regras completas estão em [PERMISSOES.md](PERMISSOES.md).

## Auditoria

Quem tem `audit:read` consulta **quem fez o quê, onde e quando**: entradas e saídas, pastas, arquivos, playlists e versões, programações, TVs, usuários e configurações.

- A tela carrega os **200 eventos mais recentes** por vez. Busca por pessoa, ação, arquivo ou TV (sem diferenciar acento) e filtro por **categoria** atuam sobre os eventos **já carregados**; o filtro por **período** carrega os eventos mais antigos que faltam (até 2.000) antes de filtrar. Os filtros ficam no endereço da página e voltam ao recarregar.
- O ícone de olho de cada linha abre os **detalhes**: data no seu navegador e em UTC, o que foi gravado e o **código de verificação (hash)** do evento e do anterior.
- **Carregar mais eventos** busca a página anterior, sem repetir nem perder nenhum.
- **Exportar CSV** reúne até **10.000** eventos recentes e aplica os filtros atuais; se houver registros mais antigos fora da exportação, a tela avisa. Células que começariam com caracteres de fórmula são gravadas como texto, para que o Excel não as execute.
- O **Gestor** com essa permissão vê e exporta só os eventos do próprio escopo; eventos sem unidade e setor (entradas, usuários, configurações globais, migrações do banco) são só do Administrador.
- Gerar o código de pareamento registra *Código de pareamento gerado* (e *Novo código de pareamento*, quando o Administrador renova o pareamento e desconecta a TV), com a pessoa responsável, a TV, a unidade e o horário. O código em si nunca é gravado.
- Senhas e tokens nunca são gravados. A cadeia de hashes ajuda a perceber alterações indevidas, mas **não substitui** a guarda de cópias externas; a TI confere a cadeia no servidor com `npm run audit:verify`.

## Configurações

- **Preferências de leitura** (por pessoa, neste navegador): **Texto ampliado** e **Contraste reforçado**.
- **Unidades e setores** (somente `settings:manage`, ou seja, o Administrador): criar e **renomear**. Nomes são únicos. **Não há exclusão**, para preservar o histórico; o identificador nunca muda ao renomear.
- Os quadros de **integrações** (SharePoint/OneDrive, Power BI Embedded) aparecem como **"Não conectado"**: essas integrações não existem nesta versão.
- A seção "Ambiente e suporte" informa se o painel está em ambiente local de testes ou corporativo e abre o guia rápido para a equipe.

## Problemas comuns

| Sintoma | O que verificar |
| --- | --- |
| A TV está *Online*, mas não mostra nada | Existe programação **No ar** (período, situação) com **versão publicada** que contenha conteúdo **aprovado** (e, em produção, verificado)? A TV é da mesma unidade e o responsável ainda tem autorização para publicar nela? O vínculo está ativo? |
| **Publicar versão** não funciona | A playlist está vazia ou tem item pendente, rejeitado, sem verificação (produção) ou excluído. A mensagem lista quais. |
| **Publicar agora** na programação recusa | Falta TV **ativa** na programação, ou a versão da playlist tem conteúdo indisponível. Ative a TV em **Telas** ou publique uma versão nova da playlist. |
| Não encontro o botão de ação | Seu perfil ou suas permissões individuais não incluem a ação. Veja **O que o meu acesso permite**. |
| Não encontro **Publicar** nem **Publicar agora** nas Programações | A TI retirou `schedule:publish` da sua conta: você cria e ajusta rascunhos, e a publicação fica com quem tem a permissão. A tela mostra esse aviso. |
| Minha programação saiu do ar e o vínculo aparece como suspenso | O responsável pela publicação perdeu a permissão de programar, o acesso à TV ou o acesso ao setor. Depois de acertar o acesso, quem tem `schedule:publish` interrompe a programação e a publica de novo. |
| "Escopo negado" | A unidade ou o setor do recurso não está na sua conta. Peça à TI. |
| Um MOV ou JPEG é recusado no envio | A mensagem diz o motivo: arquivo incompleto ou corrompido, imagem sem a estrutura completa, MOV sem imagem ou com codec que o sistema não aceita (só H.264 e HEVC), ou extensão que não corresponde ao conteúdo. Exporte de novo na ferramenta de origem (MP4 ou MOV com H.264, JPEG comum) e envie outra vez. |
| Aprovação recusada | Em produção, só se aprova o que foi verificado pelo antivírus. Em ambiente local, confirme a ciência de que não houve verificação. |
| Código de pareamento recusado | Venceu (10 minutos), já foi usado, foi substituído por um código mais novo da mesma TV ou houve tentativas demais (6 por endereço a cada 15 minutos). Gere outro em **Telas** (Administrador, ou Editor e Gestor com acesso à TV). |
| A TV mostra “formato ou arquivo não suportado por esta TV” com um arquivo que toca em outra TV | Veja o roteiro em [OPERACAO.md](OPERACAO.md) (problemas comuns): desde a 2.4.0 a TV tenta o vídeo direto do servidor; recarregue a página do player depois de atualizar. |
| A TV mostra "conteúdo pulado" | O motivo aparece na própria tela (e na pré-visualização): arquivo inexistente ou corrompido, formato ou codec que o aparelho não reproduz, ou falha de rede. A TV tenta de novo depois de 30 segundos. Confira o arquivo na pré-visualização e em uma TV; na dúvida, exporte de novo (MP4 com H.264, por exemplo). |
| O efeito na TV é diferente do escolhido | Ele foi simplificado: o aparelho não aguentou a animação, o navegador não anima transições ou o sistema pede menos movimento. A tela mostra "Efeito simplificado" com o motivo. Para aparelhos antigos, prefira *Esmaecer* ou *Corte seco*. |
| A TV mostra "Conexão interrompida." | Ficou mais de 60 segundos sem falar com o servidor e, por segurança, parou de exibir. Volta sozinha, no conteúdo em que estava, quando a conexão for restabelecida. |
| Um vídeo é cortado antes do fim | O vídeo está com *Tempo definido (limite)* e o limite é menor que a duração dele. Escolha *Até o fim do vídeo* ou aumente o limite. |
| A playlist para no último conteúdo | **Repetir a playlist continuamente** está desligada nessa versão publicada. Ligue, publique uma versão nova e atualize a programação. |

## O que não existe nesta versão

Não existem: tempo individual por **página de PDF**; conversão de vídeo, de PDF em imagens e de arquivos Office, PSD ou PBIX; aplicativos nativos para webOS, Tizen, Android TV ou Roku (o player é uma página que roda no navegador da TV); recuperação de senha com aprovação administrativa; modo escuro; e SSO com Microsoft Entra ID. O que foi e o que não foi validado está em [VALIDACAO.md](VALIDACAO.md).

## Recursos acrescentados na 2.1.0

A TV pertence à unidade e pode receber programações de vários setores autorizados. **Telas** permite ao Administrador gerenciar concessões por setor/usuário e a ordem global. As bibliotecas continuam separadas por unidade e setor. O acesso individual à TV não amplia o escopo de conteúdo da pessoa.

A sequência mostra vínculos atuais e suspensos. Programações fora do escopo aparecem com nome genérico; a mídia continua protegida. A revisão de ordem evita que uma gravação antiga substitua uma alteração concorrente. Revogar acesso suspende vínculos dependentes; conceder novamente não republica sozinho. A edição comum preserva o autor, e a publicação explícita do Administrador usa seu acesso global.

No player, **Silenciar**, **Ativar som** e **Ativar áudio** refletem a escolha do usuário e o bloqueio do navegador. A tecla **M** e a tecla de silêncio do controle remoto podem operar o som. Pausar ou finalizar interrompe o áudio; durante efeitos, o quadro anterior permanece sem som. A pré-visualização usa a mesma política. Veja limites e roteiro em [TV-GLOBAL-E-AUDIO.md](TV-GLOBAL-E-AUDIO.md).

## Recursos acrescentados na 2.2.0

- **MOV e JPEG no envio.** A lista de formatos aceitos passou a ter oito: PNG, JPG, JPEG, WebP, PDF, MP4, MOV e WebM. JPEG segue o fluxo de imagem; MOV, o de vídeo (aprovação antes de chegar à TV, sem conversão). Regras e limites em [FORMATOS.md](FORMATOS.md).
- **Gerar o código de pareamento** passou a ser permitido a Editor e Gestor, nas TVs já cadastradas e ativas que podem usar (permissão `screen:pair`), sem desconectar a TV. Detalhes em **Telas (TVs)**, acima, e em [PERMISSOES.md](PERMISSOES.md).

## Recursos acrescentados na 2.3.0

- **O Editor cria e publica programações** (`schedule:create` e `schedule:publish` passaram a ser padrão do perfil), só nas TVs que a TI liberou para ele e dentro da sua unidade e do seu setor. Ele continua sem aprovar arquivos, publicar versões de playlist, administrar TVs e usuários ou consultar a auditoria. Para quem deve só preparar rascunhos, a TI retira `schedule:publish` em **Usuários → editar**. A tela de Programações é a mesma: ela mostra ou esconde as ações conforme as permissões da conta. As regras completas, inclusive o que acontece ao retirar a permissão de quem já publicou, estão em [PERMISSOES.md](PERMISSOES.md#editor-e-programações-230).

## Recursos acrescentados na 2.4.0

- **Vídeo direto do servidor, nas TVs que precisam.** O player continua baixando cada arquivo para a memória e tocando a partir dela, como antes. Se o aparelho recusa esse vídeo (mostrava “formato ou arquivo não suportado por esta TV” com arquivo e codecs corretos), o player pede ao servidor um link temporário e toca o mesmo arquivo direto, sem aviso na tela, e lembra o caminho que funcionou naquela TV. Imagens, PDFs, formatos aceitos, áudio e permissões não mudam; não há tela nova nem configuração nova. Quem opera precisa recarregar a página do player em cada TV depois de atualizar. Detalhes técnicos em [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md#link-temporário-de-vídeo-240) e [SEGURANCA.md](SEGURANCA.md).
