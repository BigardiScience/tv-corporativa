# Operação da TV Corporativa

> Atualização 2.4.0: uma TV que não toca o vídeo baixado para a memória passa a tocar o mesmo arquivo direto do servidor, por um link temporário, e lembra o que funcionou. **Depois de atualizar o servidor, recarregue a página do player em cada TV** (uma página já aberta continua com o código antigo). Detalhes em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md) e, nos problemas comuns, abaixo.
>
> Atualização 2.3.0: o Editor passa a criar e publicar programações nas TVs que a TI liberou para ele. Da 2.2.0 continuam valendo o envio de MOV e JPEG e o código de pareamento para Editor e Gestor. Cadastro de TVs, acessos, ordem global e usuários continuam exclusivos do Administrador. Detalhes em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md) e [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as TVs compartilhadas da 2.1.0 estão em [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

Este guia é para quem opera o dia a dia: TI, Gestores e Editores. Para ver cada tela em detalhe, consulte [FUNCIONALIDADES.md](FUNCIONALIDADES.md); para implantar em outro ambiente, [IMPLANTACAO.md](IMPLANTACAO.md).

## Abrir no VS Code

Abra a pasta `tv-corporativa` no VS Code. Use Node.js 24 ou superior. O servidor utiliza módulos nativos do Node e SQLite; não precisa instalar pacotes de terceiros para iniciar.

Para um passo a passo com cada clique e comando no Windows, consulte [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md).

No terminal integrado, dentro da pasta do projeto:

```powershell
npm.cmd run configure
npm.cmd start
```

O assistente de configuração cria a primeira conta administrativa local. Escolha uma senha exclusiva e guarde-a no cofre corporativo. Não há uma senha padrão compartilhada. Se o primeiro administrador já existe, utilize o login normal e a administração de usuários.

Ao iniciar, o servidor **atualiza o banco automaticamente** se ele vier de uma versão anterior (com backup antes de qualquer alteração; veja [MIGRACOES.md](MIGRACOES.md)) e escreve no terminal uma linha de registro em JSON com a versão, o endereço e a versão do esquema. Dependendo da versão do Node, ele também pode mostrar o aviso "SQLite is an experimental feature": é esperado e inofensivo.

Abra [http://127.0.0.1:4173](http://127.0.0.1:4173). Utilize sempre a mesma origem configurada em `APP_ORIGIN`; alternar entre `localhost`, endereço IP e nome de rede pode invalidar a sessão e a proteção de origem.

Para mudar porta, diretório de dados ou configurações de implantação, copie `.env.example` para `.env` e ajuste os valores (a lista completa de variáveis está em [IMPLANTACAO.md](IMPLANTACAO.md)). O arquivo `.env` contém configurações sensíveis e é excluído do controle de versão. A API também oferece cadastro inicial com `SETUP_TOKEN` aleatório, de pelo menos 32 caracteres, e acesso local; o caminho disponível ao usuário na interface é a orientação para usar o assistente do terminal. Remova esse token após concluir a configuração inicial.

## Login e primeiro uso

Ao abrir o site sem sessão, a tela inicial solicita e-mail e senha. Não existe cadastro público, senha padrão ou entrada automática com acesso de administrador. Depois do login, os dados e ações disponíveis refletem o perfil, as permissões e o escopo (unidades e setores) da conta. A instalação inicial não contém TVs, mídia ou programações fictícias.

As unidades iniciais são **Unidade Centro**, **Unidade Leste**, **Vila Norte** e **Unidade Oeste**. Os setores são **RH**, **TI**, **SEGURANÇA DO TRABALHO** e **TESTE**. O Administrador pode criar e renomear unidades e setores em **Configurações**; não há exclusão. A TI deve revisar esses cadastros e atribuir os responsáveis antes do piloto.

## Do arquivo à TV

1. Prepare a arte, apresentação ou relatório na ferramenta de origem. Exporte para um formato descrito em [FORMATOS.md](FORMATOS.md).
2. Entre com sua conta e escolha a unidade e o setor de trabalho (seletor no alto do menu).
3. Em **Biblioteca**, crie as pastas que fizerem sentido e envie o arquivo com **Enviar arquivos**. Todo arquivo entra como *Aguardando aprovação*.
4. Quem tem permissão de aprovar (por padrão, Gestor e Administrador) revisa e **aprova** ou **rejeita**. Em produção, só vai adiante o que o antivírus verificou.
5. Em **Playlists**, monte a lista com os arquivos aprovados: ordem, tempo de cada item (em vídeo, *tempo definido* ou *até o fim do vídeo*), transição (**Ver efeito** mostra cada uma) e **Repetir a playlist continuamente**. Salve o rascunho, confira com **Pré-visualizar** (o mesmo motor da TV, com os arquivos reais) e use **Publicar versão**.
6. Em **Programações**, escolha a playlist publicada, as TVs e o período (**Publicar agora** ou salve como rascunho para alguém publicar).
7. Verifique o conteúdo em uma TV piloto antes de expandir para os demais dispositivos.

Alterar o arquivo original no PowerPoint, Excel ou Canva não atualiza automaticamente a cópia já enviada. Exporte a nova versão, envie, aprove e publique uma versão nova da playlist. **Publicar uma versão nova da playlist não muda o que está no ar:** a programação avisa que existe versão nova e você escolhe **Atualizar versão** quando quiser. Links externos e credenciais Microsoft não são necessários para o fluxo de arquivos exportados.

## Preparar uma TV

Utilize um navegador compatível em uma TV ou player dedicado, conectado ao endereço interno HTTPS da aplicação. Um mini-PC gerenciado permite maior controle de atualizações, codecs e modo quiosque. A escolha de hardware deve ser homologada pela TI: **esta versão não foi validada em nenhum modelo de TV**.

O player fica em `/player.html`. Em **Telas**, o Administrador cadastra a TV na unidade e escolhe concessões para setores e/ou usuários:

- **Somente o Administrador** cadastra a TV já **ativa** e recebe o **código de pareamento** (seis dígitos, válido por 10 minutos, uso único).
- **Gestor e Editor** usam somente as TVs autorizadas pelo Administrador, programam nelas e não gerenciam seus cadastros. Em **Telas**, nas TVs já cadastradas e ativas que podem usar, eles geram um novo **código de pareamento** (permissão `screen:pair`), por exemplo para trocar o aparelho ou reconectar a TV. A TV atual continua conectada até o código ser digitado nela. O Visualizador não gera código.
- O código é digitado na tela de pareamento do player. Cada TV recebe a sua própria credencial. Não reutilize a conta de uma pessoa no equipamento.

Após parear, atribua uma programação, abra o player em tela cheia e confirme a situação *Online*. **Online** significa que a TV falou com o servidor há poucos instantes; não comprova que a tela esteja exibindo conteúdo. Mudanças de programação são consultadas a cada 20 segundos; valide o tempo de propagação no piloto.

Na TV, a linha de situação mostra a posição ("2 de 5 · Em exibição"), avisos como "Conteúdo pulado" ou "Efeitos simplificados" e, ao perder a conexão, "Reconectando…". Os controles (Anterior, Pausar, Próximo, Áudio, Tela cheia e Desconectar) somem depois de 6 segundos, exceto durante pausa, foco ou necessidade de ativar áudio, e voltam com qualquer tecla, toque ou movimento do ponteiro; as teclas **K** ou **Espaço** pausam, **N** avança e **P** volta (e as teclas de mídia equivalentes). Se a TV recarregar a página em até 10 minutos, ela retoma do conteúdo em que estava. **Teste cada modelo de TV com uma playlist de piloto** (imagens, um vídeo curto e um com o tempo definido, cada efeito e a repetição desligada) antes de divulgar: o desempenho dos efeitos e dos codecs varia por aparelho e **não foi validado em TV real**.

Para retirar um equipamento, **remova a TV** no cadastro: isso revoga a credencial e suspende os vínculos dessa TV, preservando o histórico. A exibição para ao receber a revogação ou ao vencer a validade do manifesto. O botão do Administrador **renova o pareamento** e, em uma TV já pareada, revoga a credencial anterior (a TV precisa ser pareada de novo). O botão de Editor e Gestor só **gera o código** e não desconecta a TV: a credencial do aparelho é trocada quando o código novo é digitado em um aparelho, seja qual for, então digite-o na TV pretendida. Um código novo substitui o anterior que ainda estivesse aberto. O botão Desconectar no player apaga a credencial somente daquele navegador; isso não revoga uma cópia da credencial no servidor. Se o equipamento for perdido, removido ou transferido de unidade, revogue o acesso pelo painel antes de realizar novo pareamento. Um período sem conexão não constitui reprodução offline garantida: sem contato com o servidor, o player para de exibir quando a autorização de até 60 segundos vence, e esta versão não mantém uma biblioteca offline gerenciada.

## Perfis

| Perfil | Finalidade |
| --- | --- |
| Administrador TI | Administra usuários, permissões, senhas, unidades, setores, dispositivos e controles globais. Alcance em todas as unidades e setores. |
| Gestor | Responsável pelo escopo atribuído: aprova conteúdo e publica playlists e programações no próprio escopo e nas TVs autorizadas. Gera o código de pareamento dessas TVs. |
| Editor | Prepara e programa no escopo atribuído: cria pastas, envia arquivos, monta playlists em rascunho, cria e publica programações nas TVs autorizadas e gera o código de pareamento delas. Não aprova arquivos nem publica versões de playlist (isso fica com um Gestor ou com a TI). |
| Visualizador | Consulta informações permitidas sem alterar os dados. |

Cada perfil tem permissões **padrão**. O Administrador pode ajustar permissões individuais de conteúdo e auditoria em **Usuários → editar**; a gestão de usuários e TVs permanece exclusiva da administração. A única exceção é gerar o código de pareamento, padrão de Editor e Gestor (inclusive das contas que já existiam), que o Administrador pode retirar de uma pessoa específica. Desde a 2.3.0, `schedule:create` e `schedule:publish` também são padrão do Editor, inclusive das contas que já existiam: para quem deve só preparar rascunhos, retire `schedule:publish` em **Usuários → editar**; quem perde a permissão de programar tem o que já publicou suspenso. As listas de unidades e setores autorizam todas as combinações entre os valores atribuídos à conta. A matriz completa, as regras de delegação e a lista do que mudou para as contas da 1.1.0 estão em [PERMISSOES.md](PERMISSOES.md). Teste contas distintas, incluindo tentativas de leitura e alteração fora da unidade e do setor, antes da liberação.

## Usuários e senhas

- **Criar contas:** somente o Administrador cria contas, de qualquer perfil. A senha inicial é definida pelo Administrador (há gerador) e deve ser entregue por um canal aprovado pela TI. O e-mail é o login e não muda depois.
- **Redefinir senha:** somente o Administrador, em **Usuários**. Uma redefinição encerra as sessões da conta e gera um registro específico de auditoria. A aplicação não envia e-mails de recuperação. Quem esquece a senha procura a TI. (Não há recuperação de senha com aprovação administrativa nesta versão.)
- **Suspender** uma conta impede a entrada sem apagar o histórico. Qualquer alteração de uma conta encerra as sessões dela.
- Caso nenhum administrador consiga entrar, a TI com acesso local ao servidor pode parar o processo e executar `npm.cmd run reset-admin`. O assistente solicita a conta administrativa ativa e a nova senha. A recuperação fica registrada e encerra as sessões existentes. Não apague o banco ou a pasta de dados para recuperar acesso.

## Rotina da TI

- Verifique TVs sem comunicação (*Offline*), TVs *Aguardando ativação* e programações vencidas ou interrompidas.
- Olhe uma TV de cada unidade de vez em quando: "Conteúdo pulado" ou "Efeitos simplificados" na linha de situação indicam arquivo ou formato que o aparelho não reproduz bem. Corrija o arquivo (ou escolha *Esmaecer*/*Corte seco*) e publique uma versão nova.
- Revise conteúdos aguardando aprovação (o menu **Biblioteca** mostra a contagem) e os responsáveis pelo próximo período.
- Desative contas desligadas e revise acessos e permissões individuais ao mudar uma pessoa de função ou unidade (a lista de usuários marca as contas com permissões **Personalizadas**).
- Consulte a **Auditoria** e confira a cadeia de hashes com `npm.cmd run audit:verify`. Os eventos *Código de pareamento gerado* mostram quem gerou código para qual TV, e quando.
- Atualize sistema operacional, Node, navegador e antivírus em janela de manutenção.
- Monitore espaço em disco, integridade do banco e falhas de upload; `GET /healthz` informa se o servidor e o banco respondem.
- Preserve logs e execute a política de backups com restauração testada.

## Dados e backup

Os dados reais são mantidos no diretório indicado por `DATA_DIR`, inicialmente `data/`: o banco `tvcorp.sqlite`, os arquivos em `media/` e os backups em `backups/`. Ele contém informação operacional sensível e não faz parte dos arquivos públicos. O SQLite é adequado ao piloto em um único servidor; expansão e alta disponibilidade exigem projeto de infraestrutura e avaliação de carga.

```powershell
npm.cmd run backup                  # somente o banco (cópia consistente, mesmo com o servidor ligado)
npm.cmd run backup -- --media       # banco + pasta de mídias
npm.cmd run backup -- --keep 14     # mantém só os 14 backups de banco mais recentes
```

O backup do banco é feito pelo próprio SQLite e conferido (`PRAGMA quick_check`). **Guarde uma cópia fora do servidor**: um backup no mesmo disco não protege contra a falha do disco. Para uma cópia que una banco e mídias de forma consistente, pare o serviço antes de copiar todo o diretório de dados. Copiar apenas o arquivo principal do banco enquanto está aberto pode perder transações que ainda estejam no journal/WAL. Em produção, implemente rotina agendada, retenção, criptografia e restauração verificada (veja [IMPLANTACAO.md](IMPLANTACAO.md)). Antes de atualizar uma versão, siga o procedimento de [MIGRACOES.md](MIGRACOES.md).

## Verificação e implantação

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run audit:verify
```

Os testes automatizados fornecem evidência sobre o comportamento coberto, não comprovam conformidade ou segurança integral (veja [VALIDACAO.md](VALIDACAO.md) para o que foi e o que não foi exercitado). `audit:verify` verifica a cadeia local de hashes; não comprova imutabilidade contra um administrador do host. A tela de auditoria carrega 200 eventos por vez e exporta até 10.000. Execute também os testes de hardware, acessibilidade e operação descritos em [SEGURANCA.md](SEGURANCA.md).

O Dockerfile fornece uma base de empacotamento, não uma implantação corporativa completa, e **não foi construído nem executado** durante este trabalho. Configure volume persistente, proxy HTTPS, segredos e antivírus antes de utilizar o modo de produção. A imagem fornecida não inclui o antimalware nem sua base de assinaturas. Não publique a porta do backend diretamente na internet.

## Problemas comuns

| Situação | Verificação |
| --- | --- |
| Não inicia | Confirme Node 24+, porta disponível e permissão de escrita no diretório de dados. Se a mensagem citar o banco ou uma migração, **não apague a pasta de dados**: veja [MIGRACOES.md](MIGRACOES.md). |
| Erro de origem ou sessão | Use o endereço exato de `APP_ORIGIN` e entre novamente. |
| Arquivo recusado | Exporte para um formato aceito (PNG, JPG, JPEG, WebP, PDF, MP4, MOV ou WebM) e leia a mensagem da recusa: tamanho, arquivo incompleto ou corrompido, MOV sem imagem ou com codec que o sistema não aceita (só H.264 e HEVC), ou resultado do antivírus. Não apenas renomeie a extensão. |
| Código de pareamento recusado na TV | O código vale 10 minutos, serve uma vez e é substituído quando outro é gerado para a mesma TV; há no máximo 6 tentativas por endereço a cada 15 minutos. Gere outro em **Telas**. |
| Arquivo não aparece na playlist | Só arquivos **aprovados** entram; confira se foi aprovado e se está na mesma unidade e setor. |
| Programação não publica | A playlist precisa de versão publicada, a programação precisa de TVs ativas e todos os arquivos da versão precisam estar liberados. |
| TV sem conteúdo | Confirme pareamento, rede, programação **No ar** (período e situação) e conteúdo aprovado para aquela TV. |
| PDF ou vídeo não funciona na TV | Verifique suporte do navegador; exporte PDF para imagens ou vídeo para codec compatível. O sistema não converte vídeo: um MOV (principalmente HEVC) que o aparelho não decodifica é pulado; prefira MP4 com H.264 e AAC. A TV mostra o motivo ("Conteúdo pulado: …") e tenta de novo depois de 30 segundos. |
| A TV mostra “formato ou arquivo não suportado por esta TV” com um arquivo que toca em outra TV | Desde a 2.4.0 o player tenta sozinho um segundo caminho, o vídeo direto do servidor por um link temporário (veja [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md)). 1) Confirme que a TV carregou o player novo: recarregue a página do player ou reinicie o navegador dela. 2) O primeiro vídeo pode levar alguns segundos a mais; depois a TV lembra o caminho que funcionou, no próprio navegador (chave `tv-corporativa.video-way.v1`; limpar os dados do navegador apaga a lembrança e também a credencial, e a TV precisa ser pareada de novo). 3) No registro de acessos do proxy, procure `/api/player/media/<id>/link` seguido de `/api/media/<id>/file?t=`: se os dois aparecem e o erro continua, o aparelho recusou também o link e a causa é outra; se nenhum aparece, a TV ainda está com o player antigo. O proxy precisa repassar `Range` e a parte da consulta do endereço ([IMPLANTACAO.md](IMPLANTACAO.md)). |
| O efeito na TV não é o escolhido | O player simplificou o efeito (aparelho lento, navegador sem animações ou sistema pedindo menos movimento) e a tela diz o motivo. Para aparelhos antigos prefira *Esmaecer* ou *Corte seco*. |
| Um vídeo é cortado antes do fim | Está em *Tempo definido (limite)* com limite menor que o vídeo. Use *Até o fim do vídeo* ou aumente o limite. |
| A TV para no último conteúdo | **Repetir a playlist continuamente** está desligada naquela versão. Ligue, publique uma versão nova e use **Atualizar versão** na programação. |
| A TV mostra "Conexão interrompida." | Mais de 60 segundos sem contato com o servidor: por segurança a TV para de exibir e volta sozinha, no mesmo conteúdo, quando a conexão voltar. Confira rede, proxy e certificado. |
| Não consigo fazer uma ação | O perfil ou as permissões individuais não incluem a ação: veja **O que o meu acesso permite** no menu da conta. |
| Power BI ou Microsoft 365 não conecta | Esses conectores precisam de implementação e configuração do tenant; utilize uma exportação nesta versão. |

Antes de uso com conteúdo corporativo real, conclua a preparação descrita em [SEGURANCA.md](SEGURANCA.md) com os responsáveis internos.

## Compartilhar uma TV e organizar sua fila

1. Como Administrador, abra **Telas**, cadastre ou edite o aparelho e confira sua unidade.
2. Conceda acesso aos setores e/ou usuários necessários. Uma concessão individual não amplia as unidades e setores da conta. Gestores e Editores publicam conteúdo de seu próprio escopo nos destinos autorizados.
3. Consulte a sequência global da TV. Ela reúne vínculos de vários setores; pessoas sem escopo para um conteúdo veem identificação genérica, sem acesso ao arquivo.
4. Como Administrador, ajuste a ordem da fila. Se outra pessoa modificar antes de salvar, atualize a consulta e refaça a ordenação com os dados atuais.
5. Ao revogar acesso, desativar um responsável ou retirar dele a permissão de programar, confira os vínculos suspensos. Reatribuir o acesso não os coloca no ar: interrompa e republique a programação com autorização válida quando desejar retomá-la. Editar nome, datas ou versão não substitui o responsável do vínculo nem remove a suspensão.

Publicações autorizadas explicitamente por Administrador usam seu alcance global. Para retirá-las, interrompa a programação ou remova o destino correspondente. As TVs consultam mudanças normalmente em 20 segundos e param sem autorização renovada em no máximo 60 segundos.

## Som e controles na TV

O player tenta reproduzir vídeo com som e volume máximo do elemento. Isso não ajusta o volume físico da TV. Se aparecer **Ativar áudio**, selecione o botão ou pressione **M**; a tecla de silêncio do controle remoto também é reconhecida quando enviada pelo navegador. Se até a reprodução sem som estiver bloqueada, use **Reproduzir**.

**Silenciar** vale durante a sessão, inclusive ao mudar de vídeo. Ativar o som de um vídeo pausado não inicia a reprodução. O som anterior para em pausa, fim da sequência e início da troca, mesmo que o último quadro permaneça enquanto o próximo carrega. O navegador pode exigir outra interação em um novo elemento de vídeo. Valide o aparelho real, o arquivo com faixa de áudio e a saída física de som antes de liberar.
