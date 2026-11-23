# Perfis e permissões

Este documento descreve a versão **2.4.0**, cujas permissões são as da 2.3.0: a 2.4.0 não acrescenta nem altera nenhuma (a rota nova do link de vídeo é da própria TV e não usa permissão de pessoa). Somente o Administrador gerencia usuários, senhas, TVs, seus acessos e a ordem global de reprodução. Editor e Gestor **criam e publicam programações** nas TVs já cadastradas que podem usar e **geram o código de pareamento** delas (`screen:pair`); o Editor, por padrão, não aprova arquivos nem publica versões de playlist. O Gestor administra conteúdo no próprio escopo. A matriz é conferida por `tests/docs.test.mjs` contra `server/domain/permissions.mjs`.

## Como o acesso é decidido

A API valida a permissão da ação e a unidade **e** o setor do recurso. Contas inativas não têm acesso. O Administrador tem alcance global; para os outros perfis, as listas de unidades e setores permitem todas as combinações entre os itens marcados, sem escopo por pasta ou lista de pares.

As permissões efetivas são o padrão do perfil mais concessões, menos retiradas. As seis permissões reservadas à administração não podem ser concedidas a outro perfil; concessões antigas dessas permissões também não são aceitas pelo servidor.

Para consultar ou publicar em uma TV compartilhada, o não administrador precisa ainda de acesso à unidade da TV e de uma concessão para seu usuário ou para um setor autorizado da sua conta. Publicar exige também `schedule:publish` e o escopo do conteúdo; criar um rascunho exige `schedule:create`. Isso vale para todos os perfis que não são Administrador, inclusive o Editor (2.3.0). Compartilhar uma TV não compartilha a biblioteca nem dá permissão para gerenciar o aparelho.

## Matriz padrão de cada perfil

`✓` = permitido por padrão · `–` = não permitido por padrão. O Administrador pode ajustar permissões individuais que não sejam exclusivas da administração.

| Permissão | O que permite | Administrador | Gestor | Editor | Visualizador | Exclusiva do Administrador |
| --- | --- | --- | --- | --- | --- | --- |
| `folder:create` | Criar pastas | ✓ | ✓ | ✓ | – | não |
| `folder:update` | Renomear e mover pastas | ✓ | ✓ | ✓ | – | não |
| `folder:delete` | Excluir pastas | ✓ | ✓ | – | – | não |
| `media:upload` | Enviar arquivos | ✓ | ✓ | ✓ | – | não |
| `media:update` | Renomear e mover arquivos | ✓ | ✓ | ✓ | – | não |
| `media:delete` | Excluir arquivos | ✓ | ✓ | – | – | não |
| `media:approve` | Aprovar ou rejeitar arquivos | ✓ | ✓ | – | – | não |
| `playlist:create` | Criar playlists | ✓ | ✓ | ✓ | – | não |
| `playlist:update` | Editar playlists (rascunho) | ✓ | ✓ | ✓ | – | não |
| `playlist:delete` | Excluir playlists | ✓ | ✓ | – | – | não |
| `playlist:publish` | Publicar versões de playlist | ✓ | ✓ | – | – | não |
| `schedule:create` | Criar programações (rascunho) | ✓ | ✓ | ✓ | – | não |
| `schedule:publish` | Publicar, alterar e interromper programações | ✓ | ✓ | ✓ | – | não |
| `screen:create` | Cadastrar telas | ✓ | – | – | – | sim |
| `screen:activate` | Ativar telas e renovar o pareamento (desconecta a TV) | ✓ | – | – | – | sim |
| `screen:pair` | Gerar código de pareamento de TVs já cadastradas | ✓ | ✓ (só TVs autorizadas) | ✓ (só TVs autorizadas) | – | não |
| `screen:update` | Renomear telas | ✓ | – | – | – | sim |
| `screen:delete` | Revogar e remover telas | ✓ | – | – | – | sim |
| `user:manage` | Gerenciar usuários | ✓ | – | – | – | sim |
| `audit:read` | Consultar a auditoria | ✓ | ✓ (só o escopo) | – | – | não |
| `settings:manage` | Configurações globais (unidades e setores) | ✓ | – | – | – | sim |

Resumo: o **Administrador** tem as 21 permissões; o **Gestor** tem 15 (biblioteca, playlists, programações, código de pareamento das TVs autorizadas e auditoria no escopo); o **Editor** tem 9 (pastas, envio e organização de arquivos, playlists em rascunho, programações e código de pareamento das TVs autorizadas); o **Visualizador** não tem permissão de alteração por padrão.

Os identificadores `screen:create`, `screen:activate`, `screen:update` e `screen:delete` continuam no catálogo por compatibilidade e são exclusivos do Administrador; a gestão das TVs tem também uma guarda explícita de perfil administrativo, e alterar concessões não contorna essa regra. `screen:pair` é a única permissão de TV que não é exclusiva: dá apenas o direito de gerar o código de pareamento, por uma rota própria (`POST /api/displays/:id/pairing-code`), separada da renovação do pareamento feita pelo Administrador, que desconecta a TV.

## Usuários, senhas e permissões individuais

Somente o Administrador gerencia usuários. O Gestor não cria contas, não altera acessos e não redefine senhas, mesmo que uma conta antiga tenha uma concessão administrativa armazenada.

| Regra | Efeito |
| --- | --- |
| `screen:create`, `screen:activate`, `screen:update`, `screen:delete`, `user:manage` e `settings:manage` são reservadas | Não podem ser concedidas a Gestor, Editor ou Visualizador. |
| `screen:pair` é padrão de Editor e Gestor | Vale para as contas novas e para as que já existiam (inclusive as migradas da 1.1.0), sem ação do Administrador. O Administrador pode **retirá-la** de uma pessoa; a retirada individual prevalece. Não pode ser concedida ao Visualizador (pedido recusado). |
| `schedule:create` e `schedule:publish` são padrão de Editor (2.3.0) | Vale para as contas novas e para as que já existiam (inclusive as migradas da 1.1.0), sem ação do Administrador. O Administrador pode retirar uma ou as duas de uma pessoa; a retirada individual prevalece. Com só `schedule:create`, a pessoa cria e ajusta rascunhos e não publica; sem as duas, só consulta. Retirar de quem já publicou suspende o que a pessoa colocou no ar (veja a seção "Editor e programações"). |
| `audit:read` e permissões de conteúdo podem ser concedidas pelo Administrador | Permanecem limitadas ao escopo da conta. |
| Uma permissão não pode ser concedida e retirada ao mesmo tempo | Pedido recusado. |
| Concessões já presentes no perfil e retiradas que não existem no perfil são descartadas | A conta guarda a diferença em relação ao padrão. |
| Perfil Administrador não tem concessões nem retiradas | Sempre todas as permissões e alcance global. |
| Alterar uma conta encerra suas sessões | A pessoa precisa entrar novamente; vale para nome, situação, escopo, permissões e senha. |
| Deve existir ao menos um Administrador ativo | Desativar ou rebaixar o último é recusado. |
| Redefinir senha exige Administrador | Gera `user.password.reset`, sem registrar o segredo. |

O Gestor com `audit:read` consulta eventos que tenham unidade e setor dentro do seu escopo. Eventos sem escopo, como configuração global, criação de usuários e migrações, são visíveis somente ao Administrador.

A recuperação local de uma conta administrativa ativa usa `npm run reset-admin`, no terminal do servidor. Não há recuperação pública de senha, integração com Entra ID ou aprovação de recuperação por autoatendimento nesta versão.

## TVs compartilhadas e revogação

A TV pertence a uma unidade. O Administrador cadastra o aparelho, escolhe setores e/ou usuários autorizados, gera o pareamento e gerencia a fila global. Um usuário com concessão individual continua limitado às unidades e setores da própria conta.

- O cadastro atual já cria a TV ativa. O estado `pending` e a ação de ativação existem para registros legados.
- Gestor, Editor e Visualizador não cadastram, ativam, renomeiam, removem, compartilham ou reordenam TVs. Editor e Gestor apenas geram o código de pareamento das TVs que podem usar (`screen:pair`) e programam nelas (`schedule:create` e `schedule:publish`).
- Quem tem acesso à TV pode consultar sua sequência; conteúdos de outros setores aparecem como programações de outro setor, sem acesso à mídia correspondente no painel.
- Publicar conteúdo continua exigindo o escopo da playlist e da programação. Compartilhamento não permite misturar mídias de setores em uma playlist.
- Revogar o acesso de um responsável, desativá-lo ou retirar sua permissão de publicação suspende os vínculos que dependem desse acesso.
- Restabelecer o acesso não recoloca automaticamente vínculos suspensos no ar. Exige nova autorização explícita, como interromper e republicar a programação com acesso válido.
- Editar apenas nome, período ou versão de uma programação preserva a autoria dos vínculos existentes. Acrescentar um destino cria uma autorização para esse novo vínculo.
- O Administrador tem autorização global: uma publicação explicitamente autorizada por ele não depende apenas de uma concessão de setor. Retirar essa concessão não revoga o alcance administrativo; interrompa ou remova o vínculo pretendido.

O player recebe as mudanças na próxima consulta, normalmente em 20 segundos. Se perder contato, a autorização vence em no máximo 60 segundos; isso não equivale a revogação instantânea em uma TV desconectada.

## Editor e programações (2.3.0)

Desde a 2.3.0, `schedule:create` e `schedule:publish` fazem parte do padrão do **Editor**. Ele cria, ajusta, publica, interrompe e exclui programações, com as condições abaixo, todas conferidas no servidor a cada chamada (a interface só esconde o que a pessoa não pode fazer):

- **Escopo:** só a unidade e o setor da própria conta. Programações de outro setor ou de outra unidade são recusadas (403 `SCOPE_DENIED`), inclusive para ler, alterar, publicar, interromper ou excluir pelo identificador.
- **TVs:** só as que a TI liberou para um setor da conta ou para a própria pessoa, na unidade dela. TV de outro setor ou sem liberação é recusada (403 `DISPLAY_ACCESS_DENIED`); TV de outra unidade, 400 `SCOPE_MISMATCH`. Se um só destino da lista for recusado, nada é criado.
- **Conteúdo:** só playlists com versão publicada por quem tem `playlist:publish` (Gestor ou TI, por padrão) e só arquivos já aprovados (e, em produção, verificados). O Editor continua sem aprovar arquivos e sem publicar versões de playlist (403, também por chamada direta).
- **Continua exclusivo da administração:** cadastro, ativação, renomeação, remoção e acessos das TVs, ordem global, usuários, configurações e auditoria.
- **Quem deve só preparar rascunhos:** o Administrador retira `schedule:publish` dessa pessoa em **Usuários → editar**. Ela cria e ajusta rascunhos, mas não publica, não altera o que está no ar e não interrompe nem exclui programação publicada; a tela mostra o aviso e não oferece essas ações. Sem `schedule:create` e sem `schedule:publish`, a pessoa só consulta.
- **Retirar depois que a pessoa já publicou:** a programação **sai do ar** na consulta seguinte da TV (normalmente em até 20 segundos) e o vínculo aparece como suspenso para a TI e para o Gestor ("Responsável sem permissão para programar"). Devolver a permissão **não** recoloca no ar: quem tem `schedule:publish` (um Gestor, a TI ou o próprio Editor, com a permissão de volta) interrompe a programação e a publica de novo, o que passa a autorizar o novo responsável.
- **Auditoria:** cada criação, alteração, publicação, interrupção e exclusão registra a conta do Editor como autora. O Editor não lê a auditoria.

## Gerar código de pareamento (`screen:pair`)

Para Editor e Gestor, gerar o código é a **única** ação de administração de TV permitida (programar nelas é outra permissão, descrita acima). A cada pedido o servidor confere, nesta ordem: a sessão e o token CSRF; a permissão `screen:pair` da conta (padrão do perfil, salvo retirada individual); o acesso à TV (a unidade da TV está na conta e a TV foi liberada a um setor da conta ou à própria pessoa); e que a TV existe, não foi removida e está ativa. Vale só o identificador do caminho: identificadores no corpo ou na consulta são ignorados, e identificadores inexistentes, de outra unidade ou de TV removida são recusados (403 `PERMISSION_DENIED` ou `DISPLAY_ACCESS_DENIED`, 404, 409 `NOT_ACTIVE`), mesmo em chamadas diretas à API.

| Perfil | Pode gerar o código? |
| --- | --- |
| Administrador | Sim, em qualquer TV (o botão do painel renova o pareamento e desconecta a TV pareada). |
| Gestor e Editor | Sim, nas TVs ativas que podem usar, sem desconectá-las. Não alteram cadastro, unidade, acessos nem ordem. |
| Visualizador | Não. |

A geração não revoga a credencial da TV: o aparelho pareado continua conectado até alguém digitar o código nele. O código vale 10 minutos, serve uma única vez e é substituído se outro for gerado para a mesma TV; o servidor guarda só o hash, e a tentativa de uso (`POST /api/player/pair`) continua limitada a 6 por endereço a cada 15 minutos. A auditoria registra `device.pairing.generated` com a conta responsável, a TV, a unidade, o setor e o horário, nunca o código.

Limite conhecido: quem tem a permissão e o acesso à TV pode substituir um código ainda aberto, interrompendo um pareamento em andamento (nenhuma TV já pareada é desconectada). O Administrador pode retirar a permissão de uma pessoa em **Usuários**.

## Histórico da migração 6

A migração 6 foi distribuída na 2.0 e não foi reescrita. Ela registrava retiradas para preservar capacidades das contas da 1.1.0 diante do catálogo daquela época:

| Perfil na 1.1.0 | Permissões retiradas pela migração | Resultado |
| --- | --- | --- |
| Gestor | `user:manage`, `audit:read`, `screen:create`, `screen:activate`, `screen:update`, `screen:delete` | Preservava os poderes que a conta possuía antes da 2.0. |
| Editor | `screen:create` | Preservava a ausência de cadastro de TVs. |
| Administrador e Visualizador | nenhuma | Sem mudança de perfil. |

Na **2.1**, as regras atuais prevalecem: permissões administrativas permanecem exclusivas do Administrador, independentemente das concessões históricas. Uma retirada de `audit:read` continua valendo até ser revista pelo Administrador. Identidade, senha, situação e escopo não são substituídos por contas novas. Veja [MIGRACOES.md](MIGRACOES.md).

## Como conferir

O menu da conta, em **O que o meu acesso permite**, apresenta as permissões efetivas. `GET /api/permissions` apresenta o catálogo; as rotas e seus contratos estão em [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md). Os testes verificam a matriz e tentativas fora do escopo. O roteiro de TVs compartilhadas está em [TV-GLOBAL-E-AUDIO.md](TV-GLOBAL-E-AUDIO.md).

## Limites atuais

O sistema não exige autores e aprovadores diferentes para uma mídia. Se a política exigir quatro olhos, essa regra precisa ser implementada. Do mesmo modo, não existe fluxo de aprovação de programações: quem tem `schedule:publish` publica diretamente. Para exigir revisão antes de ir ao ar, retire essa permissão de quem deve só preparar rascunhos. Sessões têm validade de 8 horas, com revogação após alteração de conta. MFA, SSO e recuperação pública de senha não foram implementados.

