# TVs compartilhadas e áudio — versão 2.1.0

> Atualização 2.4.0: o áudio **não mudou**. A TV que recusa o vídeo baixado para a memória passa a tocar o mesmo arquivo direto do servidor (link temporário, [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md)); o elemento de vídeo, o volume e o silêncio escolhido são os mesmos nos dois caminhos.
>
> Atualização 2.3.0: o Editor passa a criar e publicar programações nas TVs a que tem acesso (veja [PERMISSOES.md](PERMISSOES.md)). Na 2.2.0, Editor e Gestor com acesso à TV passaram a gerar o código de pareamento de uma TV já cadastrada, sem desconectá-la. O restante deste guia continua valendo.

Esta atualização parte do ZIP TV-Corporativa-2.0.1-fase2 recebido (seu package.json identificava a versão como 2.0.0-fase2). Preserva logo, cores, autenticação, unidades, setores, biblioteca, versões de playlists e carrossel.

## Configurar uma TV compartilhada

1. Entre como **Administrador TI** e abra **Telas → Cadastrar TV**.
2. Informe o nome do aparelho e sua unidade. Cadastre o aparelho uma única vez.
3. Em **Quem pode publicar nesta TV?**, selecione setores inteiros ou usuários específicos. Marcar um setor libera os usuários daquele setor dentro da unidade autorizada, respeitando as permissões de cada perfil. Marcar uma pessoa não amplia suas unidades nem seus setores.
4. Salve e use o código temporário no player da TV. A mesma TV pode ser destino de programações de RH, TI, Segurança do Trabalho e Teste.
5. Cada pessoa entra em seu espaço de trabalho, prepara e publica a versão de sua playlist e cria sua própria programação, escolhendo essa TV como destino.

Acesso individual **ou** acesso pelo setor é suficiente, desde que a conta esteja ativa, pertença à unidade/setor do conteúdo e tenha a permissão da operação. Quem não tem a permissão de publicar programações (por exemplo, um Editor a quem a TI retirou `schedule:publish`) continua sem poder publicar, mesmo autorizado na TV; o Editor comum tem essa permissão desde a 2.3.0. O Administrador ajusta as permissões em Usuários.

Somente o Administrador cadastra, altera, ativa, remove TVs, altera seus acessos, renova o pareamento (o que desconecta a TV) e gerencia usuários. Editor e Gestor com acesso à TV só podem gerar o código de pareamento de uma TV já cadastrada, em **Telas**, e isso não desconecta o aparelho atual. Concessões antigas de permissões administrativas a outros perfis deixam de produzir efeito. Os demais perfis continuam com suas capacidades de conteúdo.

## Entender e ordenar a fila

Na TV, conteúdos de vários setores entram numa sequência única. Envios simultâneos não substituem publicações de outros setores. Programações preservam a versão da playlist, a ordem de seus itens, a vigência, a duração e os efeitos configurados.

Em **Telas**, abra a **Sequência** da TV. A prévia mostra a programação e o setor responsável. Para quem está fora do setor, nomes privados e identificadores de mídias não são liberados. Não há URL de arquivo ou miniatura nessa resposta.

O Administrador usa **Subir/Descer** e salva a ordem global por programação. Dentro de cada programação vale a ordem da playlist. O desempate usa data de publicação e identificador. Alterações da mesma ordem ou do mesmo cadastro exigem a revisão lida: uma edição desatualizada recebe conflito e deve ser recarregada, sem sobrescrever silenciosamente a mudança de outra pessoa.

A fila inclui somente destinos ativos e autorizados, programações publicadas na vigência e arquivos aprovados. Em produção o arquivo também precisa de varredura limpa. O player consulta automaticamente a programação; a autorização de um manifesto dura no máximo 60 segundos. Um arquivo novo solicitado após a revogação já é recusado no servidor; conteúdo carregado pode permanecer até a próxima atualização ou o vencimento desse prazo.

## Revogar acesso sem apagar o histórico

Edite a TV como Administrador e retire o setor ou usuário. Uma programação só é suspensa se perder todas as autorizações das quais depende: retirar acesso individual de alguém ainda autorizado pelo setor não cancela seu acesso efetivo.

Vínculos suspensos permanecem no histórico. Depois de liberar acesso novamente, revise a programação, interrompa e publique novamente para reativá-los. Uma edição comum não retoma um vínculo suspenso. O sistema também revalida a situação, o perfil e o escopo da conta que autorizou o destino. Não é preciso duplicar a TV ou apagar mídias.

Publicações feitas pelo próprio Administrador usam sua autorização global. Retirar uma permissão de setor não suspende uma publicação autorizada diretamente por um Administrador ainda ativo. Para pará-la, o Administrador interrompe a programação.

Ao mudar a unidade da TV, destinos incompatíveis são suspensos; as bibliotecas permanecem nos setores/unidades de origem. A exclusão da TV revoga o aparelho e preserva o histórico de seus vínculos.

## Áudio do vídeo

O player tenta iniciar cada vídeo com áudio e volume interno igual a 1 (100%). O volume final e o estado de mudo do equipamento são controlados pela TV, pelo sistema operacional e pelo navegador. O site não altera essas configurações nem consegue confirmar que os alto-falantes estão audíveis.

- **Silenciar** é uma escolha explícita, mantida durante a sessão do player e entre trocas de conteúdo.
- **Ativar som** desfaz essa escolha.
- **Ativar áudio** aparece quando o navegador recusa reprodução automática com som. Clique, toque ou use Tab e Enter/controle remoto compatível.
- Se permitido, o vídeo continua silencioso após uma tentativa de áudio bloqueada. Se até a reprodução silenciosa for bloqueada, use **Reproduzir**. O player não entra em tentativas infinitas.
- Pausar, sair, revogar a TV, trocar conteúdo ou terminar uma sequência interrompe o vídeo anterior. As camadas da transição visual podem coexistir, mas seus áudios não tocam juntos.
- A pré-visualização de playlists usa o mesmo motor e oferece controle de som.
- O caminho pelo qual o vídeo chega à TV (arquivo baixado ou, desde a 2.4.0, link direto do servidor) não muda nada disso: é o mesmo elemento de vídeo, com a mesma política de som. Se o player troca de caminho no meio da preparação de um vídeo, o volume e o silêncio escolhido continuam como estavam (conferido por teste automatizado).

O navegador pode exigir nova ativação em outro elemento ou depois de reiniciar a página/aparelho. Uma preferência local não substitui a permissão real do navegador. MP4, MOV e WebM dependem dos codecs disponíveis; para MP4 e MOV, teste H.264 e AAC (e HEVC, se o MOV usar esse codec) no equipamento de destino.

## Configuração recomendada para a TI

Em computadores corporativos gerenciados que exibem o player, a TI pode permitir reprodução automática apenas no endereço HTTPS da plataforma:

1. Defina e valide a origem interna definitiva, por exemplo https://tv.empresa.example.
2. No Microsoft Edge gerenciado, configure **AutoplayAllowlist** com essa origem específica. Evite o curinga global `*`.
3. Confira a política efetivamente aplicada em `edge://policy`, feche e reabra a aba do player e teste vídeo com faixa de áudio.
4. O modo quiosque/tela cheia deve ser configurado no dispositivo pela TI; tela cheia, por si só, não garante permissão de áudio.
5. Teste também o reinício do aparelho, perda e retomada de rede, volume/mudo físicos, pausa e a troca entre dois vídeos com áudio.

Em Chrome gerenciado há políticas equivalentes. No navegador embutido da Smart TV, as opções podem ser diferentes ou indisponíveis. Se ele não oferecer funcionamento confiável, valide um dispositivo externo gerenciado conectado por HDMI.

Referências oficiais: [Microsoft Edge — AutoplayAllowlist](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/autoplayallowlist), [Chrome — política de autoplay](https://developer.chrome.com/blog/autoplay) e [MDN — volume de mídia](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume).

## Ensaio local com duas contas

1. Siga [Como rodar no Windows](COMO-RODAR-NO-WINDOWS.md). Use contas e arquivos de teste.
2. Crie dois Gestores, um com Leste/RH e outro com Leste/TI. Preserve a configuração padrão de publicação desses perfis.
3. Cadastre uma TV Leste e marque RH e TI. Pareie o player em outra janela.
4. Em sessões independentes (perfis de navegador), cada Gestor envia e aprova seu arquivo, publica uma playlist e programa a mesma TV.
5. Confirme que ambas aparecem na Sequência e alternam no player. Mude a ordem como Administrador e confira a atualização.
6. Entre com uma conta sem acesso à TV: ela não deve conseguir selecioná-la ou publicar por uma requisição direta. A conta RH não deve conseguir abrir arquivos privados de TI.
7. Retire o acesso de TI: os destinos dependentes devem ficar suspensos e sair do player no limite de atualização. Confira a auditoria e a preservação de RH.
8. Use dois vídeos com áudio: confira início, ativação quando bloqueada, silêncio explícito, troca, pausa e encerramento. Ajuste o volume no próprio dispositivo.

Os ambientes efetivamente executados e os limites estão em [Validação](VALIDACAO.md). Não há homologação em televisores físicos nem certificação ISO/IEC 27001 ou avaliação TISAX nesta entrega.
