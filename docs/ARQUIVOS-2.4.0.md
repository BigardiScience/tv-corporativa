# Arquivos da entrega 2.4.0

Versão **2.4.0**. Comparação por conteúdo (ignorando só o fim de linha dos arquivos de texto) com o ZIP TV-Corporativa-2.3.0.zip recebido (SHA-256 `40d86d5408186e39fea70958a4d5b5b7f8d7bf688706b0e7ecb5ae32452953fb`), cujo package.json identificava 2.3.0. Os caminhos abaixo são relativos à raiz do projeto. A pasta `.git` não faz parte desta entrega. A comparação entre a 2.2.0 e a 2.3.0 está no [relatório](RELATORIO-2.4.0.md).

As mudanças no código da aplicação são o vídeo direto: no servidor, a rota e a emissão do link temporário assinado (`server/routes/displays.mjs`, `server/domain/player.mjs`), o aceite do parâmetro `t` na rota do arquivo (`server/core.mjs`) e a leitura em blocos de 256 KB (`server/http/send-file.mjs`); no player, o segundo caminho para o vídeo e a escolha lembrada (`public/js/playback/loader.js`, `public/js/playback/stage.js`, `public/js/player/app.js`); mais a versão no `package.json`. O resto são testes e documentação. Nada de banco, permissões, formatos ou áudio mudou. Não há migração de banco, dados de execução nem credenciais no pacote.

| Situação | Quantidade |
| --- | --- |
| Novos | 5 |
| Modificados | 33 |
| Removidos | 0 |
| Inalterados | 244 |

## Arquivos novos (5)

```text
docs/ARQUIVOS-2.4.0.md
docs/RELATORIO-2.4.0.md
tests/e2e/video-direto.e2e.mjs
tests/playback-direct.test.mjs
tests/player-media-link.test.mjs
```

## Arquivos modificados (33)

```text
README.md
docs/API-E-COMPATIBILIDADE.md
docs/ARQUITETURA.md
docs/ARQUIVOS-2.1.0.md
docs/ARQUIVOS-2.2.0.md
docs/ARQUIVOS-2.3.0.md
docs/ARQUIVOS-DA-FASE-2.md
docs/COMO-RODAR-NO-WINDOWS.md
docs/FORMATOS.md
docs/FUNCIONALIDADES.md
docs/IMPLANTACAO.md
docs/MIGRACOES.md
docs/OPERACAO.md
docs/PERMISSOES.md
docs/REGISTRO-DE-MUDANCAS.md
docs/RELATORIO-2.1.0.md
docs/RELATORIO-2.2.0.md
docs/RELATORIO-2.3.0.md
docs/RELATORIO-FASE-2.md
docs/SEGURANCA.md
docs/TV-GLOBAL-E-AUDIO.md
docs/VALIDACAO.md
package.json
public/js/playback/loader.js
public/js/playback/stage.js
public/js/player/app.js
server/core.mjs
server/domain/player.mjs
server/http/send-file.mjs
server/routes/displays.mjs
tests/docs.test.mjs
tests/helpers/fake-media-dom.mjs
tests/helpers/player-kit.mjs
```

## Arquivos removidos (0)

Nenhum.

## Arquivos inalterados (244)

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
docs/imagens/13-tv-global.jpg
docs/imagens/14-janela-de-envio.png
docs/imagens/15-telas-editor.png
docs/imagens/16-programacoes-editor.png
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
public/js/lib/playlist-model.js
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
public/js/playback/carousel.js
public/js/playback/effects.js
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
public/js/views/common-dialogs.js
public/js/views/displays/form.js
public/js/views/displays/index.js
public/js/views/displays/pairing.js
public/js/views/displays/sequence.js
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
public/js/views/playlists/editor.js
public/js/views/playlists/effect-demo.js
public/js/views/playlists/index.js
public/js/views/playlists/items.js
public/js/views/playlists/picker.js
public/js/views/playlists/preview.js
public/js/views/playlists/publish.js
public/js/views/playlists/stage-host.js
public/js/views/playlists/versions.js
public/js/views/schedules/form.js
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
public/panel.css
public/player.css
public/player.html
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
server/db/migrations/008-shared-displays.mjs
server/db/migrations/index.mjs
server/db/migrations/legacy.mjs
server/db/migrator.mjs
server/dev-admin.mjs
server/domain/audit.mjs
server/domain/content-check.mjs
server/domain/display-access.mjs
server/domain/displays.mjs
server/domain/files.mjs
server/domain/folders.mjs
server/domain/formats.mjs
server/domain/library.mjs
server/domain/media.mjs
server/domain/organization.mjs
server/domain/permissions.mjs
server/domain/playlists.mjs
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
tests/content-check.test.mjs
tests/database.test.mjs
tests/displays.test.mjs
tests/e2e/audit.e2e.mjs
tests/e2e/displays.e2e.mjs
tests/e2e/editor-programacao.e2e.mjs
tests/e2e/formats.e2e.mjs
tests/e2e/foundation.e2e.mjs
tests/e2e/frame-analysis.mjs
tests/e2e/harness.mjs
tests/e2e/library.e2e.mjs
tests/e2e/playback-kit.mjs
tests/e2e/playback.e2e.mjs
tests/e2e/playlists-fase2.e2e.mjs
tests/e2e/playlists.e2e.mjs
tests/e2e/run.mjs
tests/e2e/schedules.e2e.mjs
tests/e2e/settings.e2e.mjs
tests/e2e/users.e2e.mjs
tests/editor-schedules.test.mjs
tests/fixtures/legacy-1.1.0/README.md
tests/fixtures/legacy-1.1.0/core.mjs
tests/fixtures/media/audio-only.mov
tests/fixtures/media/cmyk.jpg
tests/fixtures/media/gray.jpg
tests/fixtures/media/h264-aac.mov
tests/fixtures/media/hevc-aac.mov
tests/fixtures/media/mpeg4-video-only.mov
tests/fixtures/media/progressive.jpg
tests/fixtures/media/prores-pcm.mov
tests/fixtures/media/restart.jpg
tests/fixtures/playback/video-azul-3s.webm
tests/fixtures/playback/video-roxo-6s.webm
tests/flow.test.mjs
tests/formats.test.mjs
tests/frame-analysis.test.mjs
tests/frontend-admin.test.mjs
tests/frontend-core.test.mjs
tests/frontend-dom.test.mjs
tests/frontend-models.test.mjs
tests/frontend-static.test.mjs
tests/hardening.test.mjs
tests/helpers/app.mjs
tests/helpers/fake-dom.mjs
tests/helpers/html-dom.mjs
tests/helpers/http.mjs
tests/helpers/legacy-db.mjs
tests/helpers/media-files.mjs
tests/helpers/panel-kit.mjs
tests/helpers/playback-fakes.mjs
tests/helpers/pty-driver.py
tests/hygiene.test.mjs
tests/library.test.mjs
tests/migrations.test.mjs
tests/organization.test.mjs
tests/pairing-permission.test.mjs
tests/panel-displays-shared.test.mjs
tests/panel-editor.test.mjs
tests/panel-formats.test.mjs
tests/panel-playlists.test.mjs
tests/permissions.test.mjs
tests/playback-api.test.mjs
tests/playback-audio.test.mjs
tests/playback-core.test.mjs
tests/playback-engine.test.mjs
tests/playback-loader.test.mjs
tests/playback-recovery.test.mjs
tests/playback-stage.test.mjs
tests/player.test.mjs
tests/playlists.test.mjs
tests/process.test.mjs
tests/schedules.test.mjs
tests/shared-displays-migration.test.mjs
tests/shared-displays.test.mjs
tests/terminal.test.mjs
```

## O que mudou, arquivo por arquivo

Código, testes e arquivos de apoio (a documentação foi revista em bloco; veja o [relatório](RELATORIO-2.4.0.md)).

| Arquivo | Mudança |
| --- | --- |
| `tests/e2e/video-direto.e2e.mjs` | Novo. Cenário em navegador de 5 etapas: TV comum sem mudança, TV que recusa o arquivo baixado (código 4, rede 3, leitura 0) tocando direto, TV reiniciada que lembra, e servidor sem a rota do link. |
| `tests/playback-direct.test.mjs` | Novo. 20 testes da fonte, do palco e do player inteiro: troca única de caminho, simetria, cancelamento, endereço do link validado, falhas do link (401, 404, 403, rede), escolha lembrada e armazenamento que falha, imagens e PDFs intactos, TV que não muda, som preservado na troca. |
| `tests/player-media-link.test.mjs` | Novo. 10 testes do servidor: quem pede o link, o que ele vale e o que o invalida, auditoria e manifesto intocados, entrega em blocos de 256 KB idêntica em qualquer ponto, também por HTTP de verdade. |
| `package.json` | Versão 2.4.0. |
| `public/js/playback/loader.js` | A fonte da TV ganha o segundo caminho para o vídeo (link direto assinado, com o endereço conferido: o mesmo arquivo, só com `?t=`) e a escolha lembrada (`directLink` e `remember`). Imagens e PDFs seguem como antes. |
| `public/js/playback/stage.js` | Quando o vídeo falha por decodificação, o palco pede o outro caminho à fonte (uma vez), recarrega o elemento e tenta de novo; ao tocar, confirma o caminho. Nenhuma linha do tratamento de áudio mudou. |
| `public/js/player/app.js` | Versão do player 2.4.0. Pedido do link com a credencial da TV (uma resposta de erro nunca despareia a TV) e a chave `tv-corporativa.video-way.v1` para lembrar o caminho (nunca gravada no modo de demonstração). |
| `server/core.mjs` | A rota do arquivo aceita o parâmetro `t` (link temporário) só sem o cabeçalho de credencial e com um único `t`; um `t` inválido dá 401 e nunca cai para a sessão do painel. |
| `server/domain/player.mjs` | Emissão (`mediaLink`) e conferência (`authenticateLink`) do link: HMAC-SHA256 com chave aleatória por processo, validade de 6 horas, ligado ao arquivo, à TV e à credencial atual da TV. |
| `server/http/send-file.mjs` | Leitura do disco em blocos de 256 KB (`SEND_CHUNK_BYTES`), no lugar dos 64 KB padrão do Node. |
| `server/routes/displays.mjs` | Nova rota `GET /api/player/media/:id/link`, só para a TV pareada. |
| `tests/docs.test.mjs` | Relatório e anexo da 2.3.0 passam a históricos; a versão atual é a 2.4.0. Confere o prazo do link, o bloco de leitura e a chave da escolha lembrada contra o código. |
| `tests/helpers/fake-media-dom.mjs` | Só acréscimos: aparelho de mentira que recusa vídeo `blob:` com o código de erro escolhido, reconhece o endereço do vídeo direto e registra o que é dado ao `<video>`. |
| `tests/helpers/player-kit.mjs` | Só acréscimos: o servidor de mentira responde ao pedido de link (estado, atraso e falha configuráveis) e registra os pedidos; repassa a recusa de `blob:`. |
