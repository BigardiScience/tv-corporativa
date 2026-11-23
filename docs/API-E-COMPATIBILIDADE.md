# API e compatibilidade com a versão 1.1.0

> Atualização 2.4.0: a TV pode tocar um vídeo direto do servidor por um **link temporário assinado** (nova rota `GET /api/player/media/:id/link` e parâmetro `?t=` em `GET /api/media/:id/file`), usado só pelos aparelhos que não tocam o arquivo baixado. Detalhes em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md) e na seção [Link temporário de vídeo](#link-temporário-de-vídeo-240) abaixo.
>
> Atualização 2.3.0: o Editor passa a criar e publicar programações nas TVs que a TI liberou para ele. Da 2.2.0 continuam valendo o envio de MOV e JPEG e o código de pareamento para Editor e Gestor. Cadastro de TVs, acessos, ordem global e usuários continuam exclusivos do Administrador. Detalhes em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md) e [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as TVs compartilhadas da 2.1.0 estão em [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

Referência das rotas HTTP da versão 2.4.0 e lista das **mudanças incompatíveis** em relação à 1.1.0. A tabela de rotas é conferida por um teste automatizado (`tests/docs.test.mjs`) contra as rotas que o servidor realmente registra, inclusive a forma de autenticação de cada uma. A Fase 2 acrescentou campos de reprodução; a 2.1.0 adiciona consulta e ordenação da fila global de TVs e restringe a gestão de usuários e aparelhos ao Administrador; a 2.2.0 acrescenta a rota `POST /api/displays/:id/pairing-code` e os formatos MOV e JPEG no envio, sem alterar as demais rotas. A 2.3.0 não alterou rotas, campos nem respostas: só o padrão de permissões do perfil Editor passou a incluir `schedule:create` e `schedule:publish`, que as rotas de programações já exigiam. A 2.4.0 acrescenta a rota `GET /api/player/media/:id/link` e o parâmetro `?t=` na rota do arquivo; as demais rotas, campos e respostas, inclusive o manifesto, são os da 2.3.0.

## Convenções

- Corpo e respostas em **JSON** (`Content-Type: application/json`). Exceção: o envio de arquivo (`POST /api/media`) manda os **bytes** no corpo, com os dados em parâmetros de consulta.
- Identificadores de pastas, arquivos, playlists, programações e TVs são UUID gerados pelo servidor e **nunca mudam** (renomear ou mover não altera o identificador). Unidades e setores pré-cadastrados usam apelidos curtos (`centro`, `rh`…).
- Datas em ISO 8601 UTC (`2026-10-22T12:00:00.000Z`).
- As rotas validam permissões no servidor. Conteúdos exigem escopo de unidade e setor; TVs compartilhadas exigem acesso à unidade e concessão para setor/usuário, salvo alcance global do Administrador. Veja [PERMISSOES.md](PERMISSOES.md).

## Autenticação

| Quem | Como |
| --- | --- |
| Pessoa (painel) | `POST /api/login` devolve o cookie `pwc_session` (`HttpOnly`, `SameSite=Strict`, `Secure` quando a origem é HTTPS, validade de 8 horas) e um token CSRF. |
| Alterações (`POST`, `PUT`, `PATCH`, `DELETE`) | Exigem o cabeçalho `X-CSRF-Token` com o token da sessão **e** (se o navegador enviar `Origin`) a origem igual a `APP_ORIGIN`. Sem isso: 403. |
| TV (player) | Cabeçalho `Authorization: Bearer <token da TV>`, obtido no pareamento. O token nunca vai na URL; o servidor guarda só o hash. |
| TV (vídeo direto, 2.4.0) | `GET /api/media/:id/file?t=<link temporário>`, **sem** cabeçalho de credencial. O link é pedido pela TV, com a credencial dela, em `GET /api/player/media/:id/link`, vale para um arquivo e uma TV, expira e deixa de valer quando a credencial da TV muda. Veja [Link temporário de vídeo](#link-temporário-de-vídeo-240). |

Colunas **Acesso** da tabela: **Pública** (sem credencial), **Sessão** (pessoa logada), **TV** (token do aparelho) e **Sessão ou TV** (arquivo de mídia: a TV só baixa o que está na programação ativa dela, com o token ou, nos vídeos, com o link temporário).

## Erros

Resposta de erro: `{ "error": "texto para pessoas", "code": "CODIGO_ESTAVEL", "details": { … } }` (`code` e `details` só quando existem). Falhas internas devolvem uma mensagem genérica, sem pilha nem caminhos.

| Status | Quando |
| --- | --- |
| 400 | Dado inválido (`SCOPE_MISMATCH`, `FOLDER_DEPTH`, `FOLDER_CYCLE`, `PLAYLIST_EMPTY`, `PLAYLIST_LIMIT`, `PLAYLIST_IMMUTABLE`, `NO_DISPLAYS`, `DISPLAY_NOT_ACTIVE`, `MEDIA_REJECTED`, `MEDIA_NOT_FOUND`, `LOOP_INVALID`, `DURATION_MODE_INVALID`) |
| 401 | Sem sessão, sessão expirada, conta desativada ou token de TV inválido/revogado |
| 403 | Sem permissão (`PERMISSION_DENIED`), fora do escopo (`SCOPE_DENIED`), tentativa de escalar privilégio (`ROLE_ESCALATION`), CSRF ou origem inválidos |
| 404 | Recurso inexistente |
| 409 | Conflito de estado (`NAME_CONFLICT`, `NAME_TAKEN`, `DUPLICATE_MEDIA`, `REVISION_CONFLICT`, `MEDIA_IN_USE`, `MEDIA_NOT_READY`, `FOLDER_NOT_EMPTY`, `PLAYLIST_IN_USE`, `PLAYLIST_EMPTY`, `PLAYLIST_NOT_PUBLISHED`, `NO_CHANGES`, `VERSION_MISSING`, `ALREADY_PUBLISHED`, `NOT_PUBLISHED`, `SCHEDULE_LIVE`, `ALREADY_ACTIVE`, `NOT_ACTIVE`, `SCAN_REQUIRED`) |
| 413 | Arquivo ou corpo maior que o limite (`MAX_UPLOAD_MB`) |
| 415 | Formato não aceito, conteúdo que não corresponde à extensão ou corpo que não é JSON |
| 422 | Arquivo reprovado pela verificação antimalware |
| 429 | Muitas tentativas (login, configuração inicial, pareamento) |

**Edição simultânea:** playlists e programações têm revisão (`draftRev` e `rev`); TVs têm revisões independentes de acesso (`accessRev`) e ordem (`orderRev`). Para alterar, envie o `rev` que você leu; se outra pessoa alterou antes, a resposta é 409 `REVISION_CONFLICT` com a revisão atual em `details.currentRev`.

## Rotas

| Método | Caminho | Acesso | Permissão e escopo | Finalidade |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | Pública | — | Verificação de saúde: `{ ok, version, schema }`. Para balanceador e monitoramento. |
| GET | `/api/status` | Pública | — | Instalação configurada? modo (local/produção), limite de upload, scanner configurado, versão. |
| POST | `/api/setup` | Pública | Somente no próprio servidor, com `SETUP_TOKEN` (≥ 32 caracteres) | Cria o primeiro administrador. |
| GET | `/api/permissions` | Sessão | Qualquer conta | Catálogo de permissões, padrão de cada perfil e perfis gerenciáveis. |
| GET | `/api/state` | Sessão | Qualquer conta | Dados iniciais do painel: conta, unidades e setores visíveis, limites, modo e versão. |
| GET | `/api/audit` | Sessão | `audit:read` (Gestor: só o escopo) | Eventos da auditoria, do mais novo ao mais antigo. `limit` (até 500) e `before`. |
| POST | `/api/login` | Pública | — | Entrar. Limite de tentativas por endereço e por conta. |
| POST | `/api/logout` | Sessão | — | Encerrar a sessão (invalida no servidor). |
| GET | `/api/me` | Sessão | — | Conta atual e token CSRF. |
| GET | `/api/users` | Sessão | Administrador (`user:manage`; demais perfis recebem lista vazia) | Listar usuários. |
| POST | `/api/users` | Sessão | Administrador (`user:manage`) | Criar usuário. |
| PATCH | `/api/users/:id` | Sessão | Administrador (`user:manage`) | Alterar perfil, escopo, permissões, situação, nome ou senha. |
| POST | `/api/units` | Sessão | `settings:manage` | Criar unidade. |
| PATCH | `/api/units/:id` | Sessão | `settings:manage` | Alterar unidade. |
| POST | `/api/sectors` | Sessão | `settings:manage` | Criar setor. |
| PATCH | `/api/sectors/:id` | Sessão | `settings:manage` | Alterar setor. |
| GET | `/api/library` | Sessão | Escopo | Pastas e arquivos de uma pasta (ou do espaço todo): busca, filtros, ordenação e paginação. |
| GET | `/api/folders` | Sessão | Escopo | Todas as pastas do espaço (para montar a árvore). |
| POST | `/api/library/batch` | Sessão | Por item: `folder:update` / `media:update` (mover), `folder:delete` / `media:delete` (excluir), `media:approve` (aprovar/rejeitar) | Ação em lote, **tudo ou nada**. |
| GET | `/api/folders/:id` | Sessão | Escopo | Uma pasta e seu caminho (breadcrumbs). |
| POST | `/api/folders` | Sessão | `folder:create` | Criar pasta ou subpasta. |
| PATCH | `/api/folders/:id` | Sessão | `folder:update` | Renomear e/ou mover (na mesma chamada, tudo ou nada). |
| DELETE | `/api/folders/:id` | Sessão | `folder:delete` (e `media:delete` para o que houver dentro, com `?recursive=1`) | Excluir pasta. |
| POST | `/api/media` | Sessão | `media:upload` | Enviar arquivo (bytes no corpo). |
| GET | `/api/media/:id` | Sessão | Escopo | Detalhes do arquivo, caminho e onde é usado. |
| PATCH | `/api/media/:id` | Sessão | `media:update` | Renomear (`title`) e/ou mover (`folderId`). |
| DELETE | `/api/media/:id` | Sessão | `media:delete` | Excluir arquivo (recusado se estiver em rascunho de playlist ou em programação publicada). |
| POST | `/api/media/:id/approve` | Sessão | `media:approve` | Aprovar. |
| POST | `/api/media/:id/reject` | Sessão | `media:approve` | Rejeitar. |
| GET | `/api/media/:id/file` | Sessão ou TV | Pessoa: escopo · TV: só o que está na programação ativa dela | Conteúdo do arquivo (suporta `Range`, `ETag` e `304`). A TV pode usar o token ou o link temporário (`?t=`). |
| GET | `/api/playlists` | Sessão | Escopo | Listar playlists (busca por nome, paginação). |
| POST | `/api/playlists` | Sessão | `playlist:create` | Criar playlist (rascunho). |
| GET | `/api/playlists/:id` | Sessão | Escopo | Rascunho, versões publicadas e programações que a usam. |
| PATCH | `/api/playlists/:id` | Sessão | `playlist:update` | Editar o rascunho (nome, descrição, repetição, itens, tempos, modo de duração, transições). Exige `rev`. |
| DELETE | `/api/playlists/:id` | Sessão | `playlist:delete` | Excluir (recusado se alguma programação a usa). |
| POST | `/api/playlists/:id/publish` | Sessão | `playlist:publish` | Publicar uma nova **versão** imutável. Exige `rev`. |
| POST | `/api/playlists/:id/restore` | Sessão | `playlist:update` | Copiar uma versão antiga para o rascunho (não publica). |
| GET | `/api/playlists/:id/versions/:version` | Sessão | Escopo | Itens de uma versão publicada. |
| GET | `/api/schedules` | Sessão | Escopo | Listar programações (filtro por situação e por playlist). |
| POST | `/api/schedules` | Sessão | `schedule:create` (e `schedule:publish` com `publish: true`) | Criar programação (rascunho, ou já publicada). |
| GET | `/api/schedules/:id` | Sessão | Escopo | Uma programação. |
| PATCH | `/api/schedules/:id` | Sessão | `schedule:create` (rascunho) ou `schedule:publish` (publicada/interrompida) | Alterar nome, versão da playlist, período e TVs. Exige `rev`. |
| DELETE | `/api/schedules/:id` | Sessão | `schedule:create` (rascunho) ou `schedule:publish` | Excluir (programação publicada precisa ser interrompida antes). |
| POST | `/api/schedules/:id/publish` | Sessão | `schedule:publish` | Publicar (ou republicar uma interrompida). |
| POST | `/api/schedules/:id/stop` | Sessão | `schedule:publish` | Interromper. |
| GET | `/api/displays` | Sessão | Administrador global; demais: unidade e concessão de setor/usuário | Listar TVs autorizadas com conexão e programações ativas. |
| POST | `/api/displays` | Sessão | Somente Administrador (`screen:create`) | Cadastrar TV ativa com concessões e código de pareamento. |
| POST | `/api/displays/:id/activate` | Sessão | Somente Administrador (`screen:activate`) | Ativar cadastro legado pendente e gerar código. |
| POST | `/api/displays/:id/pairing` | Sessão | Somente Administrador (`screen:activate`) | Novo código de pareamento; revoga a credencial anterior. |
| POST | `/api/displays/:id/pairing-code` | Sessão | `screen:pair` e acesso à TV (unidade e concessão de setor ou de pessoa) | Gerar o código de pareamento de uma TV ativa, sem revogar a credencial atual. |
| PATCH | `/api/displays/:id` | Sessão | Somente Administrador (`screen:update`) | Renomear, transferir unidade ou alterar concessões; valida revisão de acesso. |
| DELETE | `/api/displays/:id` | Sessão | Somente Administrador (`screen:delete`) | Revogar credencial, marcar TV removida e suspender vínculos, preservando histórico. |
| GET | `/api/displays/:id/sequence` | Sessão | Acesso à TV; outros setores têm metadados restritos | Consultar fila global e revisão. |
| PUT | `/api/displays/:id/order` | Sessão | Somente Administrador (`screen:update`) | Reordenar a fila completa com revisão atual. |
| POST | `/api/player/pair` | Pública | Código de 6 dígitos, válido por 10 minutos, uso único; 6 tentativas por endereço a cada 15 minutos | Trocar o código pelo token da TV. |
| GET | `/api/player/manifest` | TV | A própria TV | Lista do que tocar agora (contrato abaixo). |
| POST | `/api/player/heartbeat` | TV | A própria TV | Registrar que a TV está viva (alimenta "Online"). |
| GET | `/api/player/media/:id/link` | TV | A própria TV: só o que está na programação ativa dela | Pedir o link temporário para tocar um vídeo direto (veja abaixo). |

Rotas que não são `/api/…` servem os arquivos estáticos do painel e do player (`public/`), somente leitura, sem arquivos ocultos.

## Campos principais

Somente o que é necessário para integrar. O formato completo está no código (`server/domain/*.mjs`) e é exercitado em `tests/`.

**Biblioteca**

- `GET /api/library?unitId=…&sectorId=…` — opcionais: `folderId`, `q` (busca sem acento e sem diferenciar maiúsculas), `type` (`image`, `video`, `pdf`), `status` (`pending`, `approved`, `rejected`), `sort` (`name`, `date`, `type`, `size`, `status`), `order` (`asc`, `desc`), `flat=1` (ignora a hierarquia), `search=space`, `limit` (1–200, padrão 60), `offset`. Cada arquivo traz `usage` (quantas playlists e programações o usam).
- `POST /api/folders` — `{ unitId, sectorId, name, parentId? }`. Profundidade máxima: **8 níveis**; nome único por pasta (sem diferenciar acento e maiúsculas); nomes sem `/`, `\` nem caracteres de controle.
- `PATCH /api/folders/:id` — `{ name?, parentId? }` (`parentId: null` move para a raiz). O servidor impede ciclos e mover para outro espaço.
- `POST /api/media?name=…&unitId=…&sectorId=…` — opcionais `title`, `folderId`, `duplicate=allow`. O corpo são os bytes. Extensões aceitas, sem diferenciar maiúsculas: PNG, JPG, JPEG, WebP, PDF, MP4, MOV, WebM (veja [FORMATOS.md](FORMATOS.md)); a assinatura do conteúdo é conferida e, em JPEG e MOV, também a estrutura do arquivo inteiro. Conteúdo que não corresponde à extensão, JPEG ou MOV incompleto e MOV com codec de vídeo não aceito (só H.264 e HEVC) são recusados com 415; as recusas de arquivo incompleto e de codec trazem o código `MEDIA_INCOMPLETE` ou `MEDIA_UNSUPPORTED`. Arquivo idêntico (mesmo SHA-256) no mesmo espaço devolve 409 `DUPLICATE_MEDIA` com o existente em `details`, a menos que `duplicate=allow`.
- `POST /api/media/:id/approve` — corpo opcional `{ "acknowledgeUnscanned": true }` (somente fora de produção, quando não há antivírus).
- `POST /api/library/batch` — `{ action: "move" | "delete" | "approve" | "reject", mediaIds?, folderIds?, targetFolderId?, recursive? }`, até 200 itens, todos do mesmo espaço.

**Playlists**

- `POST /api/playlists` — `{ unitId, sectorId, name, description?, loop?, items?: [{ mediaId, durationS?, durationMode?, transition?, transitionMs? }] }`.
- Limites por item: duração de **5 a 3600 s** (padrão 15); transição `cut`, `fade`, `dissolve`, `slide` ou `zoom`, de **0 a 3000 ms** (padrão 600 ms; `cut` sempre 0). Máximo de itens por playlist: `PLAYLIST_MAX_ITEMS` (padrão 6, até 15).
- `durationMode` (Fase 2): `fixed` (padrão) usa `durationS` como tempo de exibição; em vídeo, é o **limite** (o vídeo que termina antes avança antes). `natural` faz o vídeo tocar até o fim e mantém `durationS` como reserva para o aparelho que não consegue ler a duração. `natural` em imagem ou PDF é recusado com 400 `DURATION_MODE_INVALID`.
- `loop` (Fase 2): booleano; `true` (padrão) repete a sequência sem parar, `false` exibe uma vez e mantém o último conteúdo. Qualquer valor que não seja `true` ou `false` (como `"false"`, `0` ou `1`) é recusado com 400 `LOOP_INVALID`. No `PATCH`, omitir o campo mantém o valor atual. A playlist e cada versão publicada devolvem `loop`, e cada item devolve `durationMode`.
- `PATCH /api/playlists/:id` — `{ rev, name?, description?, loop?, items? }`; `POST …/publish` — `{ rev, note? }` (a versão guarda uma cópia imutável de `loop` e dos modos de duração); `POST …/restore` — `{ rev, version }` (copia também a repetição da versão para o rascunho).
- Só entram arquivos do **mesmo espaço** e não rejeitados; para **publicar**, todos precisam estar aprovados (e, em produção, verificados pelo antimalware).

**Programações**

- `POST /api/schedules` — `{ unitId, sectorId, name, playlistId, playlistVersion?, startAt?, endAt?, displayIds?, publish? }`. A programação aponta para uma **versão fixa** da playlist (padrão: a mais recente). Sem `startAt`, começa imediatamente; sem `endAt`, não tem fim.
- Situação (`status`): `draft`, `published`, `stopped`. O campo `state` acrescenta o momento: `scheduled` (publicada, ainda não começou), `live` (no ar), `expired` (publicada e já terminou).
- Para publicar: ao menos uma TV **ativa** da mesma unidade, autorizada para o publicador e o setor, término no futuro, versão da playlist existente e com conteúdos liberados.

**TVs**

- `POST /api/displays` — `{ unitId, name, sectorIds?: [], userIds?: [] }`. Só Administrador. A entrada legada `sectorId` é aceita quando `sectorIds` não é informado. Resposta: `{ display, pairingCode, expiresAt }`; a TV nasce ativa, e o código é mostrado uma vez.
- `display` traz `sectorIds`, `userIds` (só para Administrador), `shared`, `accessRev`, `orderRev` e `permissions: { view, publish, manage, pair }`; `pair` é verdadeiro quando a conta tem `screen:pair` e acesso à TV. O antigo `sectorId` é uma referência legada, não a lista atual de concessões.
- `display.status`: `pending` (legado aguardando ativação) ou `active`. `display.connection`: `online` (contato nos últimos 90 s), `offline` ou `inactive`. Cadastro não significa conexão.
- `POST /api/displays/:id/pairing-code` — sem corpo. Resposta: `{ display, pairingCode, expiresAt }` (o código aparece uma única vez). Exige `screen:pair` e acesso à TV; só vale o `id` do caminho. Recusas: 401 sem sessão; 403 `PERMISSION_DENIED` sem a permissão; 403 `DISPLAY_ACCESS_DENIED` sem acesso à TV; 404 TV inexistente ou removida; 409 `NOT_ACTIVE` TV ainda não ativada. Não altera nome, unidade, concessões, ordem nem a credencial da TV; um código anterior ainda aberto deixa de valer. A auditoria registra `device.pairing.generated`, sem o código.
- `PATCH /api/displays/:id` — `{ name?, unitId?, sectorIds?, userIds?, rev? }`. Alterar concessões exige `rev` igual a `accessRev`. Transferir unidade exige informar os dois arrays de concessões. Uma revisão enviada na renomeação também é validada; conflito resulta em 409.
- `GET /api/displays/:id/sequence` — `{ display, revision, schedules, items: [] }`. Inclui vínculos não removidos, mesmo rascunhos, futuros, interrompidos ou suspensos. Cada linha tem `id`, `name`, `sectorId`, `sectorName`, `position`, `status`, `state`, `itemCount`, `durationSeconds`, `accessible`, `linkStatus` e `suspensionReason`. Programações fora do escopo recebem nome genérico e não entregam mídias ao painel.
- `PUT /api/displays/:id/order` — `{ rev, scheduleIds: [...] }`. Só Administrador. Envie a revisão da consulta e todos os IDs da fila exatamente uma vez. A comparação da revisão e a gravação ocorrem na transação; uma edição concorrente obsoleta recebe 409 `REVISION_CONFLICT`. Retorna a sequência atualizada.
- Vínculos guardam quem autorizou a publicação. Revogar o acesso, desativar o responsável ou retirar permissão de publicar suspende vínculos dependentes. Restabelecer acesso não os reativa sozinho. Edição comum preserva o autor e a suspensão; interromper e republicar com acesso válido reautoriza explicitamente. O Administrador tem acesso global: sua publicação não depende apenas de uma concessão de setor.

## Contrato do player (manifesto)

```json
{
  "display": { "id": "…", "name": "TV Recepção", "unitId": "leste", "sectorId": "rh", "status": "active", "connection": "online", "paired": true },
  "items": [
    { "id": "…", "title": "Boas-vindas", "name": "boas-vindas.png", "type": "image/png",
      "url": "/api/media/…/file", "duration": 15, "durationMode": "fixed", "transition": "fade", "transitionMs": 600 }
  ],
  "loop": true,
  "generatedAt": "2026-10-22T12:00:00.000Z",
  "validUntil": "2026-10-22T12:01:00.000Z"
}
```

- O formato é o mesmo da 1.1.0; `transition` e `transitionMs` (Fase 1) e `durationMode` e `loop` (Fase 2) são **acréscimos**. O player da 1.1.0 os ignorava e trocava de conteúdo com corte seco; o player atual os aplica.
- `loop` é `false` somente quando **todas** as playlists ativas com conteúdo liberado para aquela TV estão com a repetição desligada; em qualquer outro caso (inclusive sem conteúdo) é `true`. Um player que não conhece o campo repete, como sempre fez.
- `items` reúne os conteúdos de **todas** as programações publicadas, dentro do período e destinadas àquela TV, na ordem global configurada para a TV e, dentro da programação, na ordem dos itens da versão. Só entram vínculos ativos com autorização válida e mídias aprovadas (verificadas em produção), da unidade da TV e do setor de cada programação. Compartilhar o aparelho não compartilha bibliotecas.
- `validUntil` é no máximo 60 s à frente (ou o término da programação mais próxima): sem contato com o servidor, o player para de exibir quando vence.
- Não há prioridade de emergência, recorrência semanal nem resolução de sobreposição entre programações nesta versão.

## Link temporário de vídeo (2.4.0)

Algumas TVs não conseguem tocar o vídeo que o player baixa para a memória e entrega ao `<video>` por um endereço `blob:` (aparece "formato ou arquivo não suportado" mesmo com arquivo e codecs corretos). Para elas, o player pede ao servidor um link temporário e deixa o próprio `<video>` buscar o arquivo, como faz a pré-visualização do painel. TVs que tocam o arquivo baixado **não usam** o link e não pedem nada a mais.

```text
GET /api/player/media/<id do arquivo>/link
Authorization: Bearer <token da TV>

200 { "url": "/api/media/<id do arquivo>/file?t=<id da TV>.<validade em ms>.<assinatura>", "expiresAt": "2026-10-22T18:00:00.000Z" }
```

- **Quem pode pedir:** só a TV pareada, e só para um arquivo que está na programação ativa dela (a mesma regra da entrega do arquivo). Sem credencial: 401. Arquivo fora da programação, do setor ou da unidade da TV: 403 "Mídia indisponível para esta TV.". Arquivo inexistente: 404.
- **Validade:** o link vale por 6 horas. Ele não renova sozinho: a TV pede outro a cada exibição.
- **O que o link permite:** o `<video>` faz `GET` do endereço devolvido, sem cabeçalho de credencial, e recebe o arquivo como na rota normal (`Range`, `ETag` e `304`). A cada pedido o servidor confere de novo que o arquivo ainda está na programação ativa da TV: perder o direito ao arquivo é perder o acesso, mesmo com o link ainda dentro da validade.
- **O que o link não permite:** é aceito **só** em `GET /api/media/:id/file`, e só para o arquivo e a TV para os quais foi emitido. Em qualquer outra rota o parâmetro `t` é ignorado. Se o cabeçalho `Authorization` vier junto, o cabeçalho decide. Um `t` inválido, vencido ou repetido é recusado com 401 e **nunca** cai para o cookie de sessão do painel.
- **O que invalida o link:** passar o prazo; reiniciar o servidor (a chave de assinatura nasce a cada início); renovar o pareamento, revogar a credencial ou remover a TV do cadastro; alterar qualquer parte do link.
- **Assinatura:** HMAC-SHA256 sobre o arquivo, a TV, a validade e o hash da credencial atual da TV, com chave aleatória de 32 bytes que existe só na memória do processo. Nada do link é gravado no banco.
- **Auditoria:** assim como a entrega do arquivo, pedir ou usar o link não gera evento na trilha.
- **Cuidado de operação:** como o link vai na URL, ele aparece no registro de acessos do proxy reverso (por exemplo, o `access.log` do nginx). Ele expira e só abre um vídeo da programação da TV, mas trate esse registro como sensível; veja [SEGURANCA.md](SEGURANCA.md) e [IMPLANTACAO.md](IMPLANTACAO.md).

## Compatibilidade com a versão 1.1.0

### O que continua igual

`GET /api/status`, `POST /api/setup`, `POST /api/login`, `POST /api/logout`, `GET /api/me`, `POST /api/users` e `PATCH /api/users/:id` (mesmos campos; os novos são opcionais), `POST /api/media` (mesmos parâmetros; os novos são opcionais), `POST /api/media/:id/approve|reject`, `GET /api/media/:id/file`, `POST /api/displays/:id/pairing`, `DELETE /api/displays/:id`, `POST /api/player/pair`, `GET /api/player/manifest`, `POST /api/player/heartbeat`. Nessas rotas o **contrato** (caminho, campos e resposta) é o mesmo; em algumas mudou **quem pode chamar** (na 2.1 somente o Administrador gerencia usuários e TVs, mesmo diante de concessões históricas; veja a coluna de permissões da tabela). O **player** foi reescrito na Fase 2 (`public/js/player/app.js`, ligado por `public/player.js`), mas as TVs já pareadas continuam funcionando com a mesma credencial: a chave do armazenamento do navegador da TV (`tv-corporativa.device.v1`) e o envio do token em `Authorization: Bearer` são os da 1.1.0, e um teste confere. O formato de hash das senhas, o cookie de sessão e o formato da trilha de auditoria também foram preservados.

### Mudanças incompatíveis (e como se adaptar)

| O que mudou | Na 1.1.0 | Na 2.4.0 | Quem é afetado |
| --- | --- | --- | --- |
| `GET /api/state` | Devolvia tudo de uma vez (unidades, setores, TVs, mídias, playlists, usuários, auditoria) | Devolve só `{ user, units, sectors, limits, mode, scannerConfigured, version }`; o resto vem de rotas próprias (`/api/library`, `/api/playlists`, `/api/schedules`, `/api/displays`, `/api/users`, `/api/audit`) com escopo e paginação | Quem usava o "retrato" único |
| `POST /api/playlists` | **Publicava**: conteúdos + TVs + período + duração | Cria uma **playlist** (só conteúdo, rascunho). A publicação virou **programação**: `POST /api/schedules` | Quem automatizava publicações |
| `DELETE /api/playlists/:id` | **Interrompia** a publicação | **Exclui** a playlist (recusado se alguma programação a usa). Interromper agora é `POST /api/schedules/:id/stop` | Idem |
| Corpo de `POST /api/playlists` | `mediaIds`, `displayIds`, `startAt`, `endAt`, `duration` | `items` (cada um com `mediaId`, `durationS`, transição); período e TVs vão na programação | Idem |
| Resposta de TV (`display`) | `status` = `online`/`offline` e campo `active` | `status` = `pending`/`active`; a conexão está em `connection` (`online`/`offline`/`inactive`); não há mais `active` | Quem lia `status === 'online'` |
| `POST /api/displays` | Administrador; setor único | Administrador; unidade e concessões de setores/usuários; nasce ativa com código | Integrações com cadastro de TVs |
| Envio de arquivo repetido | Aceitava duplicados | 409 `DUPLICATE_MEDIA` (use `duplicate=allow` para forçar) | Quem enviava em lote |
| Unidades e setores | Qualquer nome | Exigem `settings:manage` e nome único, sem diferenciar acento e maiúsculas (409 `NAME_TAKEN`) | Quem cadastrava |
| Manifesto do player | `items[].duration` | Mesmos campos + `transition`, `transitionMs`, `durationMode` e `loop` | Ninguém (só acréscimos) |
| Auditoria | `playlist.published` e `playlist.stopped` | Novos eventos `schedule.*`, `playlist.version.*`, `folder.*`, `media.*`, `device.*`; os antigos continuam legíveis na trilha, mas deixam de ser gravados | Quem filtrava por ação |
| `GET /api/audit` | (a lista vinha dentro de `/api/state`, só 200 eventos) | Rota própria, paginada por `before`, até 500 por chamada; o Gestor com `audit:read` vê só o próprio escopo | Quem lia a trilha |

As mudanças refletem a separação de playlists e programações e, na 2.1, TVs compartilhadas com administração exclusiva da TI. Não há camada de compatibilidade que finja a API antiga: um cliente que dependa dela precisa ser ajustado.
