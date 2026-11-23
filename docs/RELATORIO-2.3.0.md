# Entrega TV Corporativa 2.3.0

> Documento histórico da versão 2.3.0: descreve o pacote 2.3.0 e suas verificações originais (558 testes e 12 cenários de navegador, em Node.js v22). As alterações e a validação da versão atual (2.4.0) estão em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md); a lista de arquivos, em [ARQUIVOS-2.4.0.md](ARQUIVOS-2.4.0.md).

Atualização da 2.2.0 entregue anteriormente (`TV-Corporativa-2.2.0.zip`, SHA-256 `851b63ea5a0dc003f17d71c53bd4440fcc421861e872b3c4c7634fe415f51554`), que por sua vez partiu do `TV-Corporativa-2.1.0.zip` recebido (SHA-256 `3c83a9c5642e46fc27aaddc429ef4f2d53561b03ad1da2f15073ab62b8cf1cde`). O trabalho foi feito sobre uma cópia; o pacote publicado e os dados de quem já usa o sistema não foram tocados. A entrega é o projeto completo em ZIP, com código, testes e documentação, sem credenciais, dados corporativos, arquivos temporários nem bancos de teste.

O escopo é um só: **o Editor pode realizar programação**. Foi seguido à risca: a mudança no código da aplicação é pequena (o padrão do perfil Editor passou a incluir `schedule:create` e `schedule:publish`) e o esforço foi para provar que as regras que já protegiam o Gestor (unidade, setor, TVs liberadas, conteúdo aprovado, auditoria) valem do mesmo jeito para o Editor. Nada além disso foi acrescentado, e nada que já existia foi removido. A base é a 2.2.0, então tudo que ela trouxe (MOV e JPEG no envio, código de pareamento para Editor e Gestor) continua no pacote.

Duas escolhas foram confirmadas com quem pediu a mudança antes de começar: o Editor **cria e publica** (e não só prepara rascunhos), e a base é a **2.2.0 já enviada**.

## Alterações

### 1. O que o Editor passa a fazer

Criar, ajustar, publicar, alterar o que está no ar, interromper, publicar de novo e excluir programações. A tela é a mesma de Gestor e Administrador; ela mostra ou esconde cada ação conforme as permissões da conta, e o servidor confere tudo a cada chamada.

- **Só no próprio escopo:** a unidade e o setor da conta. Programações de outro setor ou de outra unidade são recusadas (403 `SCOPE_DENIED`) por qualquer rota, inclusive com o identificador na mão.
- **Só nas TVs que a TI liberou** para um setor da conta ou para a própria pessoa, na unidade dela. TV de outro setor ou sem liberação: 403 `DISPLAY_ACCESS_DENIED`; TV de outra unidade: 400 `SCOPE_MISMATCH`. Se um destino da lista for recusado, nada é criado.
- **Só com conteúdo liberado por outro perfil:** playlists com versão publicada por quem tem `playlist:publish` (Gestor ou TI, por padrão), 409 `PLAYLIST_NOT_PUBLISHED` caso contrário; e arquivos já aprovados (em produção, também verificados), 409 `MEDIA_NOT_READY` caso contrário.
- **Na sequência compartilhada da TV:** a programação do Editor entra no fim da fila, como a de qualquer outro perfil; a ordem global continua exclusiva do Administrador.
- **Auditoria:** cada criação, alteração, publicação, interrupção e exclusão registra a conta do Editor como autora, com a unidade e o setor.

### 2. O que o Editor continua sem fazer

Aprovar ou rejeitar arquivos, publicar versões de playlist, cadastrar, ativar, renomear, mover ou excluir TVs, renovar o pareamento (que desconecta a TV), conceder acessos, mudar a ordem global, administrar usuários e configurações e consultar a auditoria. Tentativas diretas pela API recebem 403 (ou lista vazia, no caso da auditoria). A TI continua podendo conceder `playlist:publish` ou `media:approve` a uma pessoa específica, como antes.

### 3. Como restringir uma pessoa

Em **Usuários → editar → Permissões individuais**, a TI desmarca **Publicar, alterar e interromper programações** (`schedule:publish`): a pessoa continua criando e ajustando rascunhos, vê o aviso "Você cria rascunhos, mas a publicação depende de quem tem essa permissão.", não encontra os botões de publicar e recebe 403 se tentar pela API. Desmarcando também **Criar programações (rascunho)** (`schedule:create`), ela só consulta. Retirar a permissão de quem **já publicou** tira a programação do ar na próxima consulta da TV (o vínculo fica suspenso e a TI vê o motivo); devolver a permissão **não** recoloca no ar: é preciso interromper e publicar de novo.

### 4. Atualização e volta (sem migração de banco)

O esquema continua na versão 8 e o padrão do perfil é calculado na hora, então **todos os Editores já cadastrados passam a criar e publicar programações assim que a 2.3.0 entra no ar** (inclusive os migrados da 1.1.0 e os que tinham só a concessão individual de criar rascunhos). Quem deve continuar só com rascunhos precisa ter `schedule:publish` retirado pela TI **logo depois de atualizar**; nenhuma conta chega com essa retirada já feita. Nenhuma programação sai do ar por causa da atualização, e as TVs não precisam ser reiniciadas (o player não mudou). Na volta para a 2.2.0, o que os Editores publicaram sai do ar até que um Gestor ou a TI interrompa e publique de novo, e quem tinha só a concessão de criar rascunhos e teve a conta salva na 2.3.0 precisa recebê-la outra vez. Os dois sentidos foram ensaiados com o código real de cada versão (resultados em [VALIDACAO.md](VALIDACAO.md)); o passo a passo está em [MIGRACOES.md](MIGRACOES.md).

### 5. Interface preservada

Não houve redesenho. Mudaram apenas a descrição do perfil Editor no formulário de usuários e, como consequência da permissão (não de código novo), o rótulo das TVs para o Editor em **Telas**: "Destino autorizado" em vez de "Consulta autorizada". As capturas de tela da documentação de **Usuários** e de **Telas** foram refeitas na 2.3.0, e a documentação ganhou uma nova, da tela de Programações do Editor.

### 6. Testes e documentação

- **Testes novos:** `tests/editor-schedules.test.mjs` (6 testes: padrão do perfil sem migração; ciclo completo e auditoria; escopo e TVs, inclusive pedido misto e identificadores manipulados; limites de aprovação; restrição individual pela TI; registros antigos) e o cenário em navegador `tests/e2e/editor-programacao.e2e.mjs`, de 9 etapas. Mais 3 testes de tela em `tests/panel-displays-shared.test.mjs` e 1 em `tests/frontend-core.test.mjs`.
- **Testes antigos alterados de propósito:** vários testes afirmavam a regra anterior (o Editor não programa) e usavam a concessão individual de `schedule:create` como exemplo de concessão. Eles foram atualizados à regra nova, com a razão de cada um em [VALIDACAO.md](VALIDACAO.md); nenhum foi apenas "feito passar".
- **Sensibilidade:** 24 defeitos foram introduzidos de propósito, um de cada vez, em uma cópia descartável (padrão do perfil, escopo, acesso à TV, conferências de conteúdo, retirada individual, suspensão do vínculo e tela), e todos foram detectados.
- **Documentação:** guias, permissões, segurança, migração, implantação e API conferidos com o comportamento real; as seções "Editor e programações (2.3.0)" de [PERMISSOES.md](PERMISSOES.md) e "Da 2.2.0 para a 2.3.0" de [MIGRACOES.md](MIGRACOES.md) são as principais. Os testes de documentação, que conferem contagens, rotas, permissões e links contra o código, passam.

## Resultado da validação

558 testes automatizados: 558 passaram, 0 falharam, 0 ignorados, em Linux com Node.js v22.23.4 (o projeto exige Node 24 ou superior). 12 cenários em navegador (133 etapas) passaram no Chromium. 201 arquivos JavaScript verificados, sem falha. Em Windows, cinco testes são ignorados (os mesmos da 2.2.0: terminal POSIX e scanner em shell Unix). **Não houve** execução em Node 24, em Windows, em televisor físico nem com antivírus real. O ensaio completo, o que foi e o que não foi validado e como reproduzir estão em [VALIDACAO.md](VALIDACAO.md).

## Uso e atualização

Para primeira instalação, siga o [README](../README.md) e [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md). Para atualizar uma instalação existente (sem migração de banco), pare o servidor, copie a pasta `data/` inteira para fora do servidor, extraia o ZIP numa pasta nova, aponte-a para uma **cópia** de `data/` e confira o que está em [MIGRACOES.md](MIGRACOES.md) antes de trocar o código do ambiente real. Passo a passo curto para validar localmente:

1. Extraia o ZIP e abra `TV-Corporativa.code-workspace` no VS Code.
2. No terminal, rode `npm.cmd run check` e `npm.cmd test`. Em Windows, cinco testes aparecem como ignorados; nenhum deve falhar.
3. Com `data/` copiada para a pasta nova (ou uma instalação limpa com `npm.cmd run configure`), rode `npm.cmd start` e entre em `http://127.0.0.1:4173`.
4. Como Administrador, abra **Usuários** e decida quais Editores devem só preparar rascunhos; para cada um, **editar → Permissões individuais** e desmarque **Publicar, alterar e interromper programações**.
5. Entre como Editor (de uma unidade e um setor com TV liberada), abra **Programações → Nova programação**, escolha uma playlist com versão publicada e a TV, e use **Publicar agora**. Confira na TV, ou em **Telas → Ver sequência** como Administrador, que a programação entrou.
6. Entre como o Editor que só prepara rascunhos e confira o aviso e a ausência dos botões de publicar.
7. Como Administrador, veja em **Auditoria** as ações das programações com o nome de quem as fez.

## Dependências reais e limites

- **Televisores:** nenhum modelo foi testado, inclusive para esta versão; o player não mudou.
- **Sem aprovação de programações:** o Editor publica direto na TV, sem a revisão de outra pessoa. Os limites acima reduzem o risco (conteúdo já aprovado, playlist já publicada por outro perfil, só o próprio setor e as TVs liberadas), mas **não existe fluxo de aprovação de programações**. Se a política da empresa exige revisão antes de ir ao ar, retire `schedule:publish` dos Editores que só devem preparar rascunhos.
- **Antivírus:** o antivírus real não foi homologado nesta entrega; em produção, a TV só recebe arquivo verificado e limpo (`MALWARE_SCANNER`).
- **Integrações:** não há Microsoft Entra ID, SSO, SharePoint, OneDrive nem Power BI. Os quadros de Configurações aparecem como "Não conectado".
- **Conformidade:** sem certificação ISO/IEC 27001 nem avaliação TISAX.

## Observações fora do escopo

- **Pedido de sábado (programações com recursos globais e escolha dos setores):** foi informado como concluído por outra IA e tratado assim: nada dele foi refeito ou alterado, e esta entrega não verificou se ele cobre todos os pontos do pedido original. A nota "Pedido anterior ainda não atendido" do [relatório da 2.2.0](RELATORIO-2.2.0.md) está superada.
- **Player inalterado:** o identificador de versão do player continua `2.2.0` de propósito. Como o player não mudou, nenhuma TV precisa ser reiniciada ou atualizada.
- **Cenário de Programações:** passou a cobrir Gestor e Visualizador; o Editor tem cenário próprio. O cenário de Usuários passou a usar a permissão `playlist:publish` como exemplo de concessão individual e `schedule:publish` como exemplo de retirada.
- **Histórico do Git:** o ZIP não inclui a pasta `.git`. Para atualizar o repositório publicado, substitua os arquivos pelo conteúdo desta entrega e faça o commit.

## Arquivos

5 arquivos novos, 33 arquivos modificados, 0 arquivos removidos e 239 arquivos inalterados em relação à 2.2.0. Lista completa de diferenças em [ARQUIVOS-2.3.0.md](ARQUIVOS-2.3.0.md).
