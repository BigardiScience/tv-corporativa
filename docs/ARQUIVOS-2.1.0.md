# Arquivos da entrega 2.1.0

> Documento histórico da versão 2.1.0: lista as diferenças entre o ZIP 2.0.1-fase2 recebido e o pacote 2.1.0. A lista da versão atual (2.4.0) está em [ARQUIVOS-2.4.0.md](ARQUIVOS-2.4.0.md); a da 2.3.0, em [ARQUIVOS-2.3.0.md](ARQUIVOS-2.3.0.md); a da 2.2.0, em [ARQUIVOS-2.2.0.md](ARQUIVOS-2.2.0.md).

Versão **2.1.0**. Comparação por conteúdo com o ZIP TV-Corporativa-2.0.1-fase2.zip fornecido, cujo package.json identificava 2.0.0-fase2. Os caminhos abaixo são relativos à raiz do projeto.

As alterações abrangem frontend, backend, migração 8, player, testes e documentação. Não há dados de execução nem credenciais no pacote. A imagem nova usa somente dados fictícios de validação.

| Situação | Quantidade |
| --- | --- |
| Novos | 12 |
| Modificados | 67 |
| Removidos | 0 |
| Inalterados | 173 |

## Arquivos novos (12)

```text
docs/ARQUIVOS-2.1.0.md
docs/RELATORIO-2.1.0.md
docs/TV-GLOBAL-E-AUDIO.md
docs/imagens/13-tv-global.jpg
public/js/views/displays/form.js
public/js/views/displays/sequence.js
server/db/migrations/008-shared-displays.mjs
server/domain/display-access.mjs
tests/panel-displays-shared.test.mjs
tests/playback-audio.test.mjs
tests/shared-displays-migration.test.mjs
tests/shared-displays.test.mjs
```

## Arquivos modificados (67)

```text
README.md
docs/API-E-COMPATIBILIDADE.md
docs/ARQUITETURA.md
docs/ARQUIVOS-DA-FASE-2.md
docs/COMO-RODAR-NO-WINDOWS.md
docs/FORMATOS.md
docs/FUNCIONALIDADES.md
docs/IMPLANTACAO.md
docs/MIGRACOES.md
docs/OPERACAO.md
docs/PERMISSOES.md
docs/REGISTRO-DE-MUDANCAS.md
docs/RELATORIO-FASE-2.md
docs/SEGURANCA.md
docs/VALIDACAO.md
package.json
public/js/lib/api.js
public/js/lib/audit-model.js
public/js/lib/format.js
public/js/lib/permissions.js
public/js/lib/router-core.js
public/js/lib/user-model.js
public/js/playback/carousel.js
public/js/playback/stage.js
public/js/player/app.js
public/js/views/common-dialogs.js
public/js/views/displays/index.js
public/js/views/displays/pairing.js
public/js/views/login.js
public/js/views/overview.js
public/js/views/playlists/preview.js
public/js/views/playlists/stage-host.js
public/js/views/schedules/form.js
public/js/views/schedules/index.js
public/js/views/users/form.js
public/js/views/users/index.js
public/js/views/users/password.js
public/panel.css
public/player.css
public/player.html
server/core.mjs
server/db/migrations/index.mjs
server/domain/displays.mjs
server/domain/permissions.mjs
server/domain/player.mjs
server/domain/schedules.mjs
server/domain/users.mjs
server/routes/displays.mjs
tests/database.test.mjs
tests/displays.test.mjs
tests/docs.test.mjs
tests/e2e/displays.e2e.mjs
tests/e2e/playback.e2e.mjs
tests/e2e/schedules.e2e.mjs
tests/e2e/users.e2e.mjs
tests/frontend-admin.test.mjs
tests/frontend-core.test.mjs
tests/hardening.test.mjs
tests/helpers/fake-media-dom.mjs
tests/migrations.test.mjs
tests/panel-playlists.test.mjs
tests/permissions.test.mjs
tests/playback-api.test.mjs
tests/playback-recovery.test.mjs
tests/playback-stage.test.mjs
tests/player.test.mjs
tests/schedules.test.mjs
```

## Arquivos removidos (0)

```text

```

## Arquivos inalterados (173)

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
docs/ARQUIVOS-DA-FASE-1.md
docs/MARCA.md
docs/RELATORIO-FASE-1.md
docs/imagens/01-login.png
docs/imagens/02-biblioteca.png
docs/imagens/03-playlist.png
docs/imagens/04-programacoes.png
docs/imagens/05-telas.png
docs/imagens/06-codigo-de-pareamento.png
docs/imagens/07-usuarios-permissoes.png
docs/imagens/08-meu-acesso.png
docs/imagens/09-auditoria.png
docs/imagens/10-playlist-repeticao-e-efeitos.png
docs/imagens/11-ver-efeito.png
docs/imagens/12-previa.png
docs/legado/previa-v1.1.0.png
public/assets/favicon.svg
public/assets/destaque.jpg
public/assets/logo.png
public/auth.css
public/index.html
public/js/lib/csv.js
public/js/lib/display-model.js
public/js/lib/library-query.js
public/js/lib/media-validation.js
public/js/lib/playlist-model.js
public/js/lib/prefs.js
public/js/lib/reorder.js
public/js/lib/schedule-model.js
public/js/lib/selection.js
public/js/lib/session.js
public/js/lib/settings-model.js
public/js/lib/tree.js
public/js/lib/uploads.js
public/js/main.js
public/js/playback/effects.js
public/js/playback/loader.js
public/js/playback/media-cache.js
public/js/playback/messages.js
public/js/playback/model.js
public/js/playback/recovery.js
public/js/playback/timing.js
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
public/js/views/index.js
public/js/views/library/actions.js
public/js/views/library/details.js
public/js/views/library/dnd.js
public/js/views/library/index.js
public/js/views/library/items.js
public/js/views/library/tree.js
public/js/views/library/upload.js
public/js/views/playlists/editor.js
public/js/views/playlists/effect-demo.js
public/js/views/playlists/index.js
public/js/views/playlists/items.js
public/js/views/playlists/picker.js
public/js/views/playlists/publish.js
public/js/views/playlists/versions.js
public/js/views/settings/index.js
public/js/views/settings/organization.js
public/js/views/shared.js
public/js/views/units.js
public/js/views/users/password-field.js
public/js/views/users/permission-editor.js
public/player.js
public/styles.css
scripts/backup.mjs
scripts/check.mjs
scripts/configure.mjs
scripts/migrate.mjs
scripts/reset-admin.mjs
scripts/verify-audit.mjs
server/config.mjs
server/db/connection.mjs
server/db/migrations/001-baseline.mjs
server/db/migrations/002-organization.mjs
server/db/migrations/003-library.mjs
server/db/migrations/004-displays.mjs
server/db/migrations/005-playlists-schedules.mjs
server/db/migrations/006-users.mjs
server/db/migrations/007-reproducao.mjs
server/db/migrations/legacy.mjs
server/db/migrator.mjs
server/dev-admin.mjs
server/domain/audit.mjs
server/domain/files.mjs
server/domain/folders.mjs
server/domain/formats.mjs
server/domain/library.mjs
server/domain/media.mjs
server/domain/organization.mjs
server/domain/playlists.mjs
server/domain/scanner.mjs
server/domain/sessions.mjs
server/domain/usage.mjs
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
server/routes/library.mjs
server/routes/playlists.mjs
server/routes/system.mjs
server/routes/users.mjs
tests/audit.test.mjs
tests/auth.test.mjs
tests/e2e/audit.e2e.mjs
tests/e2e/foundation.e2e.mjs
tests/e2e/frame-analysis.mjs
tests/e2e/harness.mjs
tests/e2e/library.e2e.mjs
tests/e2e/playback-kit.mjs
tests/e2e/playlists-fase2.e2e.mjs
tests/e2e/playlists.e2e.mjs
tests/e2e/run.mjs
tests/e2e/settings.e2e.mjs
tests/fixtures/legacy-1.1.0/README.md
tests/fixtures/legacy-1.1.0/core.mjs
tests/fixtures/playback/video-azul-3s.webm
tests/fixtures/playback/video-roxo-6s.webm
tests/flow.test.mjs
tests/frame-analysis.test.mjs
tests/frontend-dom.test.mjs
tests/frontend-models.test.mjs
tests/frontend-static.test.mjs
tests/helpers/app.mjs
tests/helpers/fake-dom.mjs
tests/helpers/html-dom.mjs
tests/helpers/http.mjs
tests/helpers/legacy-db.mjs
tests/helpers/panel-kit.mjs
tests/helpers/playback-fakes.mjs
tests/helpers/player-kit.mjs
tests/helpers/pty-driver.py
tests/hygiene.test.mjs
tests/library.test.mjs
tests/organization.test.mjs
tests/panel-editor.test.mjs
tests/playback-core.test.mjs
tests/playback-engine.test.mjs
tests/playback-loader.test.mjs
tests/playlists.test.mjs
tests/process.test.mjs
tests/terminal.test.mjs
```

Veja [o relatório](RELATORIO-2.1.0.md) e [a validação](VALIDACAO.md) para comportamento, testes e limitações.
