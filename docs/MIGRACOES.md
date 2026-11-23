# Migrações do banco de dados

A versão 2.0.0-fase1 reorganizou o banco SQLite (biblioteca em pastas, playlists separadas de programações, TVs e permissões individuais) e a 2.0.0-fase2 acrescentou a migração 7 (repetição da playlist e duração natural de vídeo). A **2.1.0** acrescenta a migração 8 para TVs compartilhadas, concessões e fila global. A **2.2.0**, a **2.3.0** e a **2.4.0** não acrescentam migração: o esquema continua na versão 8. Esta página explica como atualizar as versões anteriores, ensaiar numa cópia e restaurar um backup.

> **Antes de atualizar um servidor com dados reais:** pare o serviço, copie a pasta `data/` inteira (banco **e** mídias) para fora do servidor e ensaie a migração em uma **cópia** (procedimento abaixo). A migração foi testada contra um banco gerado pelo código real da 1.1.0 e contra um banco de volume grande, mas **não** contra o seu banco de produção — só você pode fazer esse ensaio.

## Como funciona

- As migrações rodam **automaticamente na inicialização** do servidor (`npm start`) ou, sem iniciar o servidor, com `npm run migrate`.
- Cada migração tem um número e um nome. O banco guarda quais já foram aplicadas na tabela `schema_migrations` (número, nome, data, impressão digital do código e um resumo do que foi feito).
- **Backup automático antes de qualquer alteração**, quando o banco já tem dados: um arquivo consistente (copiado pelo próprio SQLite e verificado com `PRAGMA quick_check`) em `BACKUP_DIR` (por padrão `data/backups/`), com o nome `tvcorp-antes-da-migracao-<carimbo>-v<de>-para-v<para>.sqlite`. Um banco novo (vazio) não gera backup.
- **Tudo ou nada:** todas as migrações pendentes rodam na **mesma transação**. Se qualquer uma falhar, o SQLite desfaz tudo, o servidor não inicia e a mensagem de erro diz qual migração falhou e onde está o backup. Nada fica pela metade.
- Depois de cada migração o sistema confere a **integridade referencial** (`PRAGMA foreign_key_check`) e, no final, a integridade do arquivo (`PRAGMA quick_check`). Se algo estiver errado, desfaz.
- **Banco de versão mais nova:** se o banco foi atualizado por uma versão mais nova da TV Corporativa do que a que está rodando, o servidor **se recusa a iniciar** e não altera nada.
- **Código de migração alterado depois de aplicado:** o servidor avisa no registro (log) para conferir se o código corresponde ao banco. Regra do projeto: nunca edite uma migração já distribuída; crie uma nova.
- Um banco da 1.1.0 parte do esquema **0** e recebe as migrações até o **8**. A 2.0.0-fase1 parte do **6** e recebe 7 e 8; a 2.0.0-fase2 parte do **7** e recebe somente 8. Os arquivos das migrações 1 a 7 permanecem preservados.
- A migração concluída grava na auditoria o evento `db.migrated` (de qual versão para qual, quais migrações e o nome do arquivo de backup). Esse evento não tem unidade/setor e por isso só o Administrador o vê.

## O que cada migração faz

| Nº | Nome | O que faz |
| --- | --- | --- |
| 1 | `baseline-1.1.0` | Marca o estado da 1.1.0. Em um banco existente **não altera nada**; em um banco novo cria as tabelas de base (`records`, `users`, `sessions`, `audit`). |
| 2 | `unidades-e-setores` | Copia unidades e setores dos registros genéricos para tabelas próprias. Se o banco não tinha nenhum, cria as quatro unidades e os quatro setores padrão. Confere as contagens. |
| 3 | `biblioteca-pastas-e-midias` | Cria as tabelas de **pastas** e **mídias** (com gatilhos que impedem ciclos e misturar unidade/setor) e copia cada mídia da 1.1.0 mantendo identificador, título, nome, tipo, tamanho, hash, situação, resultado da varredura, datas e autoria. As mídias antigas ficam na **raiz** do seu espaço (nenhuma pasta é inventada). Os arquivos em disco não são tocados. |
| 4 | `telas` | Cria a tabela de **TVs** e copia as existentes mantendo identificador, nome, escopo, último contato e **credencial do aparelho** (as TVs já pareadas continuam funcionando sem parear de novo) e o código de pareamento ainda válido. TV que estava inativa vira "aguardando ativação". |
| 5 | `playlists-e-programacoes` | Cria playlists, itens, **versões imutáveis** de playlist, programações e a ligação programação × TVs. Cada "playlist" da 1.1.0 (que era, na verdade, uma publicação) vira **uma playlist com a versão 1 publicada + uma programação** que fixa essa versão. A programação **mantém o identificador antigo**, então os eventos da auditoria continuam apontando para ela. |
| 6 | `usuarios-permissoes-individuais` | Acrescenta às contas os campos de permissões concedidas e retiradas e normaliza escopos ausentes. Contas da 1.1.0 recebem **permissões retiradas** que preservam o que o perfil podia antes (ver [PERMISSOES.md](PERMISSOES.md)). Perfil, senha, escopo e situação **não mudam**. |
| 7 | `reproducao-repeticao-e-duracao-natural` | **Fase 2.** Acrescenta `loop_enabled` às playlists e às versões publicadas e `duration_mode` aos itens do rascunho e das versões publicadas, todos com o padrão que reproduz o comportamento anterior. Recria o gatilho de imutabilidade dos itens para proteger também a nova coluna e confere que todo registro antigo recebeu o padrão. |
| 8 | `telas-compartilhadas-acessos-fila` | **2.1.0.** Acrescenta concessões por setor/usuário, revisão de acessos e fila global, remoção lógica da TV, autoria e situação de cada vínculo e histórico de autorizações. Preserva IDs, credenciais, arquivos e versões. |

### Detalhes da migração 5 (histórico da separação de playlists)

| Na 1.1.0 | Na 2.0 |
| --- | --- |
| Publicação ativa (`active` verdadeiro) | Programação **publicada** (mesmo identificador, mesmas TVs, mesmas datas de início e término) |
| Publicação desativada (`active: false`) | Programação **interrompida** |
| Lista de conteúdos da publicação | Playlist com a **versão 1** publicada, na mesma ordem |
| Duração única da publicação | A mesma duração em cada item (mínimo 5 s, máximo 3600 s; sem valor válido, 15 s) |
| Transição (não existia) | `cut` (corte seco) em todos os itens |
| Conteúdo que não existe mais | Fica de fora; publicação **sem nenhum conteúdo existente** não é migrada e é listada no relatório da migração (`skipped`) |
| Publicação com mais itens que o limite atual (6 por padrão) | Migrada normalmente; o relatório conta quantas passam de 6 e de 15. O limite só impede **aumentar** playlists maiores que o limite. |

### Detalhes da migração 7 (Fase 2)

| Coluna | Tabelas | Valor dado aos registros que já existem | Significado |
| --- | --- | --- | --- |
| `loop_enabled` (0 ou 1) | `playlists`, `playlist_versions` | `1` | Repetição ligada: a sequência recomeça sem parar, como o player sempre fez |
| `duration_mode` (`fixed` ou `natural`) | `playlist_items`, `playlist_version_items` | `fixed` | Tempo definido pelo item; em vídeo é o **limite** (o vídeo que termina antes avança antes), como na Fase 1 |

Na migração 7, os padrões preservam o comportamento anterior de duração e repetição; e as versões publicadas continuam imutáveis (o gatilho dos itens foi recriado para cobrir a nova coluna; o da versão já bloqueava qualquer alteração). O relatório da migração traz as contagens de playlists, versões, itens e itens de versões tratados. Se algum registro antigo não receber o valor padrão, a migração falha e desfaz tudo. A coluna `duration_s` (5 a 3600 s) segue obrigatória nos dois modos: em `natural` ela é a reserva para o aparelho que não consegue ler a duração do vídeo.

### Detalhes da migração 8 (2.1.0)

Cria `display_grants` e `schedule_display_history`; acrescenta revisões de acesso e ordem e remoção lógica à TV. Os vínculos programação × TV passam a guardar posição, autor da autorização, estado, data e motivo de suspensão.

Cada TV recebe uma concessão para seu setor legado. A fila inicial mantém a ordem anterior por data de publicação e identificador. O autor é obtido de quem publicou, alterou ou criou a programação. Somente ausência histórica em todos esses campos recebe `legacy_authorized=1`; ID inexistente ou conta desativada nunca recebe essa exceção. A leitura do manifesto reavalia o acesso atual e suspende vínculos inválidos.

IDs, credenciais de TV, arquivos, playlists e versões são preservados. A gestão exclusiva pelo Administrador é regra da aplicação 2.1, não uma reescrita da migração 6: concessões administrativas históricas não valem para outros perfis. Mídias e playlists continuam isoladas por unidade e setor. Veja [PERMISSOES.md](PERMISSOES.md).

### Da 2.1.0 para a 2.2.0 (sem migração)

A 2.2.0 não altera o esquema: o banco continua na versão 8, o primeiro início não cria backup de migração e `data/` é reaproveitada como está (contas, arquivos, TVs, credenciais das TVs, programações, playlists e auditoria). Os arquivos já cadastrados permanecem como estão: a conferência de JPEG e MOV vale para os **novos envios** e não reavalia a biblioteca existente. As permissões não são regravadas: `screen:pair` é calculada na hora a partir do perfil, de modo que Editores e Gestores já cadastrados a recebem, respeitadas as retiradas individuais que o Administrador fizer.

### Da 2.2.0 para a 2.3.0 (sem migração)

A 2.3.0 também não altera o esquema: o banco continua na versão 8, o primeiro início não cria backup de migração e `data/` é reaproveitada como está (contas, arquivos, TVs, credenciais das TVs, programações, playlists e auditoria). Nenhuma programação sai do ar por causa da atualização, e as TVs não precisam ser reiniciadas nem pareadas de novo.

O que muda é o padrão do perfil **Editor**, que passa a incluir `schedule:create` e `schedule:publish`. As contas guardam só as concessões e as retiradas individuais, e o padrão do perfil é calculado na hora; por isso **todos os Editores já cadastrados** (inclusive os migrados da 1.1.0) passam a criar e publicar programações assim que a 2.3.0 entra no ar, nas TVs que a TI já liberou para eles. Para que ninguém ganhe a publicação sem querer:

1. **Antes de atualizar**, abra **Usuários**, liste os Editores e decida quem deve continuar só preparando rascunhos.
2. **Logo depois de atualizar**, abra cada uma dessas pessoas em **Usuários → editar**, desmarque **Publicar, alterar e interromper programações** e salve. A pessoa continua criando e ajustando rascunhos, e a publicação fica com um Gestor ou com a TI. Nenhuma conta chega à 2.3.0 com essa permissão já retirada: a 2.1.0 e a 2.2.0 descartavam, ao salvar a conta, a retirada de uma permissão que o perfil não tinha.
3. Quem tinha só a concessão individual de `schedule:create` (rascunhos para um Gestor publicar) passa a publicar também; retire `schedule:publish` dessa pessoa, como no passo anterior, se não for o desejado. A concessão antiga continua gravada, mas passou a ser redundante, e é descartada na próxima vez que a conta é salva em **Usuários**.
4. Se alguém não deve nem criar rascunhos, retire também `schedule:create`: sem as duas permissões, a pessoa só consulta as programações.

Gestores e Visualizadores não mudam. Em ensaio feito na entrega da 2.3.0, com o código real das duas versões ([VALIDACAO.md](VALIDACAO.md#verificações-herdadas-da-230-não-repetidas-nesta-entrega)), dados criados pela 2.2.0 (e, separadamente, pela 2.1.0) foram abertos pela 2.3.0 com o esquema, as contas, as mídias, as playlists, as programações e a TV idênticos, a mesma senha em todas as contas, a TV recebendo a mesma programação e a cadeia de auditoria íntegra.

### Da 2.3.0 para a 2.4.0 (sem migração)

A 2.4.0 também não altera o esquema: o banco continua na versão 8, o primeiro início não cria backup de migração e `data/` é reaproveitada como está (contas, arquivos, TVs, credenciais das TVs, programações, playlists e auditoria). Nenhuma programação sai do ar, nenhuma permissão muda e as TVs não precisam ser pareadas de novo.

O que a atualização exige é **recarregar a página do player em cada TV**: uma página já aberta continua com o código antigo até recarregar (o servidor entrega sempre o arquivo mais novo, mas não troca uma página que já está aberta). Até lá a TV funciona como na 2.3.0, porque o servidor novo atende normalmente o player antigo.

O que a 2.4.0 **não** grava no banco: o link temporário de vídeo não é guardado (a chave de assinatura nasce a cada início do servidor, então reiniciar invalida os links emitidos e a TV pede outro) e não gera evento de auditoria. No navegador de cada TV, o player pode gravar a chave `tv-corporativa.video-way.v1`, só nas TVs em que o vídeo baixado é recusado; ela não faz parte de `data/` e não precisa de backup.

Em ensaio com os servidores reais das duas versões ([VALIDACAO.md](VALIDACAO.md)), dados criados pela 2.3.0 foram abertos pela 2.4.0 com o esquema, as contas, as permissões, as mídias e o cadastro da TV idênticos, a mesma senha em todas as contas, a TV recebendo a mesma programação e os mesmos arquivos (inteiros e por trechos), nenhum backup criado e a cadeia de auditoria íntegra. As tabelas e colunas que o servidor grava ao atender as mesmas operações foram as mesmas nas duas versões.

## O que **não** é alterado

- A tabela genérica `records` da 1.1.0 continua no banco, intacta, como registro histórico (o servidor novo não a usa).
- Os arquivos de mídia em `MEDIA_DIR` (ou `data/media/`).
- A **trilha de auditoria**: eventos antigos mantêm o mesmo conteúdo e o mesmo hash; a cadeia continua válida (`npm run audit:verify`). Eventos gravados pela 1.1.0 não têm unidade/setor no próprio registro, por isso só o Administrador os enxerga.
- Senhas: o formato de hash (scrypt) é o mesmo; ninguém precisa trocar de senha.

## Atenção: banco criado em modo local e usado em produção

Na 1.1.0 (e na 2.0), arquivos enviados sem antivírus configurado ficam com o resultado `not_configured`. Em **produção** só vai ao ar o que foi verificado (`clean`). Um banco local migrado e aberto em produção mantém tudo visível para a TI, mas **as TVs deixam de exibir** os arquivos aprovados sem varredura, e novas publicações com eles são recusadas (`MEDIA_NOT_READY`). Reenvie esses arquivos com o antivírus configurado. Esse comportamento é testado (`tests/migrations.test.mjs`).

## Procedimento recomendado de atualização

1. **Avise** quem usa o painel e **pare** o servidor (a cópia só é consistente com o serviço parado).
2. **Copie a pasta `data/` inteira** para um local fora do servidor (banco, `media/` e `backups/`). Guarde a cópia até concluir a validação.
3. **Ensaie em uma cópia.** Extraia a versão nova (2.4.0) em uma pasta de teste, copie `data/` para lá e rode a migração apontando para a cópia:

   ```powershell
   $env:DATA_DIR = 'C:\Ensaio\TV-Corporativa-2.4.0\data'
   npm.cmd run migrate
   Remove-Item Env:DATA_DIR
   ```

   A saída lista cada migração e seus números (quantas mídias, TVs, programações e contas foram tratadas) e o caminho do backup. Se a saída trouxer `skipped`, abra o relatório e confira o motivo.
4. **Inicie a cópia** em outra porta (`PORT` e `APP_ORIGIN` diferentes), entre e confira: biblioteca, programações no ar, TVs (o botão "Online" depende do último contato), usuários e permissões. Se tiver uma TV de teste já pareada, recarregue a página do player nela (ela só usa o código novo depois de recarregar) e confirme que continua recebendo a programação e que um vídeo toca. Entre também com uma conta de Editor e confira se ela cria e publica programações (padrão da 2.3.0) ou só rascunhos, conforme o que a TI decidiu.
5. **Só então** atualize o servidor real: coloque os arquivos da 2.4.0, mantenha `data/` e inicie. Depois, recarregue a página do player em cada TV. O primeiro início migra e cria o backup automático.
6. Guarde o backup `tvcorp-antes-da-migracao-…` até ter certeza de que está tudo certo.

No Render (homologação), o disco é efêmero: cada publicação nova começa com banco vazio e cria o esquema 8 do zero; não há migração de dados a fazer ali. Veja [IMPLANTACAO.md](IMPLANTACAO.md).

A **2.0.0-fase1** recebe 7 e 8, com backup `…-v6-para-v8.sqlite`. A **2.0.0-fase2** recebe somente 8, com backup `…-v7-para-v8.sqlite`. Reabrir um banco já atualizado não reaplica migrações.

## Voltando atrás

Não existe "migração reversa". Para voltar à versão anterior, inclusive 2.0.0-fase2:

1. Pare o servidor.
2. Preserve o estado atual separadamente. Restaure o backup consistente do banco e as mídias correspondentes da cópia completa de `data/`; use o código da versão anterior. Com o processo parado, trate os arquivos auxiliares SQLite WAL/SHM para não misturar o estado novo com o banco restaurado.
3. Confira integridade, auditoria e reprodução em ambiente isolado antes de liberar. Alterações posteriores ao backup não estarão na restauração.

Não abra um banco já migrado com a versão anterior: os dados novos vivem em tabelas e colunas que ela desconhece e os registros antigos ficam congelados no momento da migração. As versões 2.0 com migrador recusam iniciar com um banco no esquema 8. Novas concessões e ordenações não existem no backup anterior à 2.1.

**Da 2.2.0 para a 2.1.0:** a 2.2.0 não alterou o esquema, e em ensaio uma pasta `data/` usada pela 2.2.0 abriu normalmente no código da 2.1.0 ([VALIDACAO.md](VALIDACAO.md)). A 2.1.0 não conhece a permissão `screen:pair` (Editores e Gestores deixam de gerar o código), recusa novos arquivos MOV, e os MOV já cadastrados continuam listados e entregues. Mesmo assim, prefira restaurar o backup feito antes da troca.

**Da 2.3.0 para a 2.2.0:** a 2.3.0 não alterou o esquema, e em ensaio uma pasta `data/` usada pela 2.3.0, com programações publicadas por Editores, abriu normalmente no código da 2.2.0: todas as contas entraram com a mesma senha e a cadeia de auditoria continuou íntegra ([VALIDACAO.md](VALIDACAO.md#verificações-herdadas-da-230-não-repetidas-nesta-entrega)). A 2.2.0 não dá `schedule:create` nem `schedule:publish` ao Editor: ele volta a só consultar as programações, e o que ele publicou **sai do ar** na primeira consulta da TV (o vínculo fica suspenso, com o motivo "Responsável sem permissão para programar"). Para recolocar no ar, um Gestor ou a TI interrompe a programação e a publica de novo. Quem tinha só a concessão individual de `schedule:create` e teve a conta salva na 2.3.0 perdeu essa concessão (ela era redundante e foi descartada ao salvar): a TI precisa conceder de novo. As retiradas de `schedule:publish` feitas na 2.3.0 continuam gravadas e não têm efeito na 2.2.0. Mesmo assim, prefira restaurar o backup feito antes da troca.

**Da 2.4.0 para a 2.3.0:** a 2.4.0 não alterou o esquema, e em ensaio uma pasta `data/` usada pela 2.4.0 (inclusive com conteúdo novo criado por ela) abriu normalmente no código da 2.3.0: todas as contas entraram com a mesma senha, a TV manteve a credencial e passou a receber também a programação criada na 2.4.0, os arquivos foram entregues inteiros e por trechos e a cadeia de auditoria continuou íntegra ([VALIDACAO.md](VALIDACAO.md)). A 2.3.0 não conhece a rota do link de vídeo: responde 401 a esse pedido da TV (404 a uma pessoa logada) e ignora o parâmetro `t` do arquivo. Uma TV que ainda esteja com a página 2.4.0 aberta trata isso como link indisponível: o vídeo volta a depender do arquivo baixado (uma TV que só tocava pelo link volta a pular o vídeo com a mensagem de formato não suportado, como na 2.3.0) e a TV **continua pareada**, porque só o manifesto e o batimento podem desparear uma TV. Mesmo assim, prefira restaurar o backup feito antes da troca.

## Como a migração foi testada

| O que | Onde |
| --- | --- |
| Banco **real** da 1.1.0 (gerado pelo código original, preservado em `tests/fixtures/legacy-1.1.0/`) com contas, mídias, TV pareada, TV aguardando código, programação ativa e interrompida e auditoria: tudo preservado, credencial da TV válida, hash da auditoria idêntico, nenhum backup novo na segunda inicialização | `tests/migrations.test.mjs` |
| Banco novo nasce no esquema 8, sem backup | `tests/migrations.test.mjs` |
| **Migração 7:** banco no esquema 6 (migrações 1 a 6, idênticas às da Fase 1) com playlists, versões e programações recebe os padrões, as contagens do relatório batem, os itens das versões publicadas ficam idênticos, a versão antiga continua imutável e a TV pareada na Fase 1 recebe a mesma programação | `tests/playback-api.test.mjs` |
| Recusa de banco de versão mais nova, sem alterar nada | `tests/migrations.test.mjs` |
| Falha no meio desfaz **tudo**, mantém o backup e permite tentar de novo | `tests/migrations.test.mjs` |
| Aviso quando o código de uma migração já aplicada mudou | `tests/migrations.test.mjs` |
| Volume sintético: 5.000 arquivos, 400 publicações, 20 TVs (não equivale a teste de carga da instalação) | `tests/migrations.test.mjs` |
| Banco local aberto em produção: mídia sem varredura não chega à TV | `tests/migrations.test.mjs` |
| Integridade referencial e do arquivo conferidas pelo migrador | `tests/migrations.test.mjs` |
| Contas: não sobrescreve permissões já definidas; escopo ausente ou malformado é normalizado | `tests/migrations.test.mjs` |
| Editor que programa (2.3.0) sem migração: as contas já existentes recebem o padrão novo sem regravação, a concessão antiga que virou padrão é normalizada ao salvar e a retirada individual vale | `tests/editor-schedules.test.mjs` |
| Link temporário de vídeo (2.4.0), sem migração: a rota nova não grava no banco nem na auditoria e não altera o manifesto | `tests/player-media-link.test.mjs` |
| Atualização 2.3.0 → 2.4.0 e volta, com os servidores reais das duas versões sobre a mesma pasta de dados | Ensaio descrito em [VALIDACAO.md](VALIDACAO.md) (feito fora do pacote) |
| Gatilhos e restrições valem mesmo para quem escreve direto no SQL | `tests/database.test.mjs` |
| `npm run migrate` em uma cópia do banco da 1.1.0, com backup, e depois nada a fazer | `tests/database.test.mjs` |

**Limite da validação:** fixtures e bancos sintéticos não substituem um ensaio com cópia do banco real. As execuções desta entrega estão em [VALIDACAO.md](VALIDACAO.md).
