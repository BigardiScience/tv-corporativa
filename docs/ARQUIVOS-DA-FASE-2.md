# Arquivos da Fase 2

> Documento histórico da Fase 2: descreve o pacote 2.0.0-fase2 e suas verificações originais. As alterações e a validação da versão atual (2.4.0) estão em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md); as da 2.3.0, em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md); as da 2.2.0, em [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as da 2.1.0, em [RELATORIO-2.1.0.md](RELATORIO-2.1.0.md).

Versão **2.0.0-fase2**, comparada com a 2.0.0-fase1 (o pacote entregue na Fase 1). A comparação foi feita pelo **conteúdo** dos arquivos, não só pelos nomes. Enquanto o pacote continuar nesta versão, `tests/docs.test.mjs` confere que estas listas são exatamente os arquivos do pacote. Este anexo lista a si mesmo entre os arquivos novos. A lista da Fase 1, comparada com a 1.1.0, está em [ARQUIVOS-DA-FASE-1.md](ARQUIVOS-DA-FASE-1.md).

Não fazem parte do pacote nem da comparação: a pasta `.git` (o histórico do seu repositório), a pasta `data/` (dados de execução), `node_modules/` e `tests/e2e/output/` (capturas geradas pelos cenários em navegador).

| Situação | Quantidade |
| --- | --- |
| Novos | 39 |
| Modificados | 41 |
| Removidos | 0 |
| Inalterados | 160 |

## Arquivos removidos (0)

Nenhum arquivo da Fase 1 foi removido. O código antigo do player foi **substituído no mesmo arquivo** (`public/player.js`), não apagado.

## Arquivos modificados (41)

```text
README.md
docs/API-E-COMPATIBILIDADE.md
docs/ARQUITETURA.md
docs/ARQUIVOS-DA-FASE-1.md
docs/COMO-RODAR-NO-WINDOWS.md
docs/FORMATOS.md
docs/FUNCIONALIDADES.md
docs/IMPLANTACAO.md
docs/MIGRACOES.md
docs/OPERACAO.md
docs/PERMISSOES.md
docs/RELATORIO-FASE-1.md
docs/SEGURANCA.md
docs/VALIDACAO.md
docs/imagens/03-playlist.png
package.json
public/js/lib/playlist-model.js
public/js/views/playlists/editor.js
public/js/views/playlists/items.js
public/js/views/playlists/preview.js
public/js/views/playlists/publish.js
public/js/views/playlists/versions.js
public/js/views/schedules/form.js
public/panel.css
public/player.css
public/player.html
public/player.js
server/db/migrations/index.mjs
server/domain/player.mjs
server/domain/playlists.mjs
tests/database.test.mjs
tests/displays.test.mjs
tests/docs.test.mjs
tests/e2e/playlists.e2e.mjs
tests/e2e/settings.e2e.mjs
tests/frontend-admin.test.mjs
tests/frontend-models.test.mjs
tests/frontend-static.test.mjs
tests/helpers/http.mjs
tests/migrations.test.mjs
tests/player.test.mjs
```

| Arquivo | O que mudou |
| --- | --- |
| `README.md` | Estado da Fase 2, números de testes e cenários, funcionalidades de reprodução e índice com os documentos novos |
| `docs/API-E-COMPATIBILIDADE.md` | Campos `loop` e `durationMode` (entrada, respostas e manifesto da TV), erros `LOOP_INVALID` e `DURATION_MODE_INVALID` e a tabela de compatibilidade com a Fase 1 |
| `docs/ARQUITETURA.md` | Motor de reprodução compartilhado, player em módulos, esquema 7 e o fluxo do manifesto |
| `docs/ARQUIVOS-DA-FASE-1.md` | Aviso de documento histórico, com ponteiros para os documentos da Fase 2 (as listas não mudaram) |
| `docs/COMO-RODAR-NO-WINDOWS.md` | Migrações 1 a 7, passo de playlist com repetição, tempo do vídeo, "Ver efeito" e "Pré-visualizar", demonstração do player e atualização a partir da 2.0.0-fase1 |
| `docs/FORMATOS.md` | Tempo de exibição, vídeo (limite ou até o fim), repetição, transições aplicadas e como o player as simplifica; o PDF aparece inteiro |
| `docs/FUNCIONALIDADES.md` | Repetição, tempo do vídeo, efeitos e "Ver efeito", pré-visualização, controles e teclas do player, solução de problemas; três capturas de tela novas |
| `docs/IMPLANTACAO.md` | Esquema 7 em `/healthz`, o que o navegador da TV precisa ter, memória e rede da TV, proxy com `Authorization` e `Range` |
| `docs/MIGRACOES.md` | Migração 7 em detalhes, atualização a partir da 2.0.0-fase1, backup `…-v6-para-v7` e a volta atrás |
| `docs/OPERACAO.md` | Rotina com repetição e pré-visualização, avisos na tela da TV, teclas e novos itens de solução de problemas |
| `docs/PERMISSOES.md` | Declara que a Fase 2 não criou nem alterou permissões |
| `docs/RELATORIO-FASE-1.md` | Aviso de documento histórico, com ponteiros para o relatório da Fase 2 (o texto não foi reescrito) |
| `docs/SEGURANCA.md` | Controles dos campos novos, credencial da TV só para o próprio servidor, o que a TV guarda no navegador e riscos da reprodução |
| `docs/VALIDACAO.md` | Reescrito para a Fase 2: resultados, camadas de teste, medição da reprodução, mapa dos testes da 1.1.0 e o que não foi validado |
| docs/imagens/03-playlist.png | Captura refeita com o editor da Fase 2 (repetição, tempo do vídeo e "Ver efeito") |
| `package.json` | Somente a versão (`2.0.0-fase2`); nenhum script, nenhuma dependência |
| `public/js/lib/playlist-model.js` | Modos de duração, textos de ajuda, resumo do ciclo, limites e o formato entregue à pré-visualização (o mesmo do manifesto da TV) |
| `public/js/views/playlists/editor.js` | Caixa de repetição, resumo do ciclo, botão "Pré-visualizar" com o rascunho e abertura da demonstração "Ver efeito" |
| `public/js/views/playlists/items.js` | Linha do conteúdo: campo de tempo que muda de nome, "Tempo do vídeo", ajuda de cada campo, aviso do PDF e botão "Ver efeito" |
| `public/js/views/playlists/preview.js` | Pré-visualização reescrita sobre o motor da TV (efeitos, lista de conteúdos, motivos do que não abre, sem repetição) |
| `public/js/views/playlists/publish.js` | Linha "Repetição", tempo e efeito de cada conteúdo e botão "Pré-visualizar" na revisão de publicação |
| `public/js/views/playlists/versions.js` | Linha "Repetição", tempo e efeito de cada conteúdo, "Pré-visualizar" nos detalhes e `previewVersion` |
| `public/js/views/schedules/form.js` | Botão "Pré-visualizar esta versão" no formulário da programação |
| `public/panel.css` | Regras da repetição, da ajuda dos campos, da pré-visualização, da demonstração de efeitos e do alto contraste |
| `public/player.css` | Reescrito para as camadas do carrossel, os avisos e os controles |
| `public/player.html` | Script como módulo, botão "Anterior", atalhos anunciados nos botões e campo de aviso ao lado do estado |
| `public/player.js` | De um script de 248 linhas para um módulo de 23 linhas que liga o navegador real ao player (`public/js/player/app.js`) |
| `server/db/migrations/index.mjs` | Registra a migração 7 |
| `server/domain/player.mjs` | O manifesto da TV ganha `loop` e, em cada item, `durationMode` |
| `server/domain/playlists.mjs` | Repetição e modo de duração: validação, gravação, cópia para a versão publicada, restauração e auditoria |
| `tests/database.test.mjs` | Esquema esperado 7 e backup `…-v0-para-v7` |
| `tests/displays.test.mjs` | As chaves esperadas do manifesto e do item incluem `loop` e `durationMode` |
| `tests/docs.test.mjs` | Reestruturado: documentos da Fase 1 são históricos, o anexo de cada fase é conferido contra o pacote e a versão atual vale para os documentos da Fase 2 |
| `tests/e2e/playlists.e2e.mjs` | A etapa da pré-visualização espera a camada visível e o texto da posição mudarem (o próximo conteúdo é preparado em segundo plano) |
| `tests/e2e/settings.e2e.mjs` | A versão esperada em "Ambiente e suporte" é lida de `package.json` |
| `tests/frontend-admin.test.mjs` | Versão e esquema nos dados de exemplo da tela Ambiente |
| `tests/frontend-models.test.mjs` | O envio de itens inclui `durationMode`; três testes novos (modo de duração, resumo do ciclo e formato da pré-visualização) |
| `tests/frontend-static.test.mjs` | O player da TV passa a ser ponto de entrada; as classes de `public/player.css` entram na conferência; o `<script>` do player é um módulo; um teste novo vigia o código que a TV executa |
| `tests/helpers/http.mjs` | Acréscimo de `stripedPng` (PNG de listras para medir desfoque); `solidPng` gera os mesmos bytes de antes |
| `tests/migrations.test.mjs` | Esquema esperado 7, backup `…-v0-para-v7` e migrações 1 a 7 |
| `tests/player.test.mjs` | Reescrito para o player novo (de 6 para 44 testes); as garantias dos seis testes da Fase 1 continuam |

## Arquivos inalterados (160)

Idênticos aos da Fase 1. Entre eles estão a identidade visual (`public/styles.css` e `public/auth.css`), o código do servidor fora de playlists e do manifesto da TV, os scripts de terminal, o `Dockerfile`, o `.env.example` e os arquivos de teste da Fase 1 que não precisaram mudar.

| Pasta | Arquivos inalterados |
| --- | --- |
| `.vscode` | 3 |
| `(raiz)` | 8 |
| `docs` | 10 |
| `public` | 60 |
| `scripts` | 6 |
| `server` | 45 |
| `tests` | 28 |

```text
.dockerignore
.env.example
.gitignore
.vscode/extensions.json
.vscode/launch.json
.vscode/tasks.json
01-configurar-administrador.cmd
02-iniciar-plataforma.cmd
03-recuperar-administrador.cmd
Dockerfile
TV-Corporativa.code-workspace
docs/MARCA.md
docs/imagens/01-login.png
docs/imagens/02-biblioteca.png
docs/imagens/04-programacoes.png
docs/imagens/05-telas.png
docs/imagens/06-codigo-de-pareamento.png
docs/imagens/07-usuarios-permissoes.png
docs/imagens/08-meu-acesso.png
docs/imagens/09-auditoria.png
docs/legado/previa-v1.1.0.png
public/assets/favicon.svg
public/assets/destaque.jpg
public/assets/logo.png
public/auth.css
public/index.html
public/js/lib/api.js
public/js/lib/audit-model.js
public/js/lib/csv.js
public/js/lib/display-model.js
public/js/lib/format.js
public/js/lib/library-query.js
public/js/lib/media-validation.js
public/js/lib/permissions.js
public/js/lib/prefs.js
public/js/lib/reorder.js
public/js/lib/router-core.js
public/js/lib/schedule-model.js
public/js/lib/selection.js
public/js/lib/session.js
public/js/lib/settings-model.js
public/js/lib/tree.js
public/js/lib/uploads.js
public/js/lib/user-model.js
public/js/main.js
public/js/ui/components.js
public/js/ui/dialogs.js
public/js/ui/dom.js
public/js/ui/download.js
public/js/ui/feedback.js
public/js/ui/icons.js
public/js/ui/shell.js
public/js/ui/thumbnails.js
public/js/ui/toast.js
public/js/views/audit.js
public/js/views/common-dialogs.js
public/js/views/displays/index.js
public/js/views/displays/pairing.js
public/js/views/index.js
public/js/views/library/actions.js
public/js/views/library/details.js
public/js/views/library/dnd.js
public/js/views/library/index.js
public/js/views/library/items.js
public/js/views/library/tree.js
public/js/views/library/upload.js
public/js/views/login.js
public/js/views/overview.js
public/js/views/playlists/index.js
public/js/views/playlists/picker.js
public/js/views/schedules/index.js
public/js/views/settings/index.js
public/js/views/settings/organization.js
public/js/views/shared.js
public/js/views/units.js
public/js/views/users/form.js
public/js/views/users/index.js
public/js/views/users/password-field.js
public/js/views/users/password.js
public/js/views/users/permission-editor.js
public/styles.css
scripts/backup.mjs
scripts/check.mjs
scripts/configure.mjs
scripts/migrate.mjs
scripts/reset-admin.mjs
scripts/verify-audit.mjs
server/config.mjs
server/core.mjs
server/db/connection.mjs
server/db/migrations/001-baseline.mjs
server/db/migrations/002-organization.mjs
server/db/migrations/003-library.mjs
server/db/migrations/004-displays.mjs
server/db/migrations/005-playlists-schedules.mjs
server/db/migrations/006-users.mjs
server/db/migrations/legacy.mjs
server/db/migrator.mjs
server/dev-admin.mjs
server/domain/audit.mjs
server/domain/displays.mjs
server/domain/files.mjs
server/domain/folders.mjs
server/domain/formats.mjs
server/domain/library.mjs
server/domain/media.mjs
server/domain/organization.mjs
server/domain/permissions.mjs
server/domain/scanner.mjs
server/domain/schedules.mjs
server/domain/sessions.mjs
server/domain/usage.mjs
server/domain/users.mjs
server/http/context.mjs
server/http/request.mjs
server/http/responses.mjs
server/http/router.mjs
server/http/security.mjs
server/http/send-file.mjs
server/http/static.mjs
server/index.mjs
server/lib/crypto.mjs
server/lib/errors.mjs
server/lib/logger.mjs
server/lib/rate-limit.mjs
server/lib/validate.mjs
server/routes/auth.mjs
server/routes/displays.mjs
server/routes/library.mjs
server/routes/playlists.mjs
server/routes/system.mjs
server/routes/users.mjs
tests/audit.test.mjs
tests/auth.test.mjs
tests/e2e/audit.e2e.mjs
tests/e2e/displays.e2e.mjs
tests/e2e/foundation.e2e.mjs
tests/e2e/harness.mjs
tests/e2e/library.e2e.mjs
tests/e2e/run.mjs
tests/e2e/schedules.e2e.mjs
tests/e2e/users.e2e.mjs
tests/fixtures/legacy-1.1.0/README.md
tests/fixtures/legacy-1.1.0/core.mjs
tests/flow.test.mjs
tests/frontend-core.test.mjs
tests/frontend-dom.test.mjs
tests/hardening.test.mjs
tests/helpers/app.mjs
tests/helpers/fake-dom.mjs
tests/helpers/legacy-db.mjs
tests/helpers/pty-driver.py
tests/hygiene.test.mjs
tests/library.test.mjs
tests/organization.test.mjs
tests/permissions.test.mjs
tests/playlists.test.mjs
tests/process.test.mjs
tests/schedules.test.mjs
tests/terminal.test.mjs
```

## Arquivos novos (39)

### `docs/` (3)

Os documentos novos da Fase 2: o relatório, o registro de mudanças e esta lista.

```text
docs/ARQUIVOS-DA-FASE-2.md
docs/REGISTRO-DE-MUDANCAS.md
docs/RELATORIO-FASE-2.md
```

### docs/imagens/ (3)

Capturas de tela do painel da Fase 2 (ambiente de teste, dados fictícios): editor com repetição e efeitos, "Ver efeito" e pré-visualização.

```text
docs/imagens/10-playlist-repeticao-e-efeitos.png
docs/imagens/11-ver-efeito.png
docs/imagens/12-previa.png
```

### `public/js/playback/` (9)

O motor de reprodução, compartilhado pela TV e pela pré-visualização do painel: carrossel, tempo, efeitos, tela, carregamento, memória dos arquivos, recuperação, modelo do item e textos.

```text
public/js/playback/carousel.js
public/js/playback/effects.js
public/js/playback/loader.js
public/js/playback/media-cache.js
public/js/playback/messages.js
public/js/playback/model.js
public/js/playback/recovery.js
public/js/playback/stage.js
public/js/playback/timing.js
```

### `public/js/player/` (1)

O player da TV sobre o motor: pareamento, consulta da programação, controles, avisos e recuperação.

```text
public/js/player/app.js
```

### `public/js/views/playlists/` (2)

A demonstração dos efeitos ("Ver efeito") e a ligação do motor da TV a uma área do painel.

```text
public/js/views/playlists/effect-demo.js
public/js/views/playlists/stage-host.js
```

### `server/db/migrations/` (1)

A migração 7: repetição da playlist e duração natural de vídeo.

```text
server/db/migrations/007-reproducao.mjs
```

### `tests/` (9)

Suítes novas: o motor (regras, carrossel, recuperação, carregamento e tela), o servidor da Fase 2, as janelas e o editor do painel e o analisador de quadros.

```text
tests/frame-analysis.test.mjs
tests/panel-editor.test.mjs
tests/panel-playlists.test.mjs
tests/playback-api.test.mjs
tests/playback-core.test.mjs
tests/playback-engine.test.mjs
tests/playback-loader.test.mjs
tests/playback-recovery.test.mjs
tests/playback-stage.test.mjs
```

### `tests/e2e/` (4)

Dois cenários novos em navegador (a TV e o editor de playlist da Fase 2) e o apoio deles: o analisador de quadros e o kit de reprodução.

```text
tests/e2e/frame-analysis.mjs
tests/e2e/playback-kit.mjs
tests/e2e/playback.e2e.mjs
tests/e2e/playlists-fase2.e2e.mjs
```

### `tests/fixtures/playback/` (2)

Dois vídeos curtos de teste (3 s e 6 s), gerados para os cenários de reprodução.

```text
tests/fixtures/playback/video-azul-3s.webm
tests/fixtures/playback/video-roxo-6s.webm
```

### `tests/helpers/` (5)

Peças de apoio dos testes: DOM de mentira para mídia e para o painel, relógio e renderer de mentira, kit do player.

```text
tests/helpers/fake-media-dom.mjs
tests/helpers/html-dom.mjs
tests/helpers/panel-kit.mjs
tests/helpers/playback-fakes.mjs
tests/helpers/player-kit.mjs
```
