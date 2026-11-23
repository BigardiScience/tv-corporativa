# Arquivos da entrega 2.2.0

> Documento histórico da versão 2.2.0: lista as diferenças entre o ZIP 2.1.0 recebido e o pacote 2.2.0. A lista da versão atual (2.4.0) está em [ARQUIVOS-2.4.0.md](ARQUIVOS-2.4.0.md); a da 2.3.0, em [ARQUIVOS-2.3.0.md](ARQUIVOS-2.3.0.md).

Versão **2.2.0**. Comparação por conteúdo com o ZIP TV-Corporativa-2.1.0.zip fornecido (SHA-256 `3c83a9c5642e46fc27aaddc429ef4f2d53561b03ad1da2f15073ab62b8cf1cde`), cujo package.json identificava 2.1.0. Os caminhos abaixo são relativos à raiz do projeto. A pasta `.git` do pacote recebido não faz parte desta entrega.

As alterações abrangem o envio de arquivos (servidor e painel), a permissão de gerar o código de pareamento, o player, os testes e a documentação. Não há migração de banco, dados de execução nem credenciais no pacote. As duas imagens novas usam somente dados fictícios de validação.

| Situação | Quantidade |
| --- | --- |
| Novos | 20 |
| Modificados | 50 |
| Removidos | 0 |
| Inalterados | 202 |

## Arquivos novos (20)

```text
docs/ARQUIVOS-2.2.0.md
docs/RELATORIO-2.2.0.md
docs/imagens/14-janela-de-envio.png
docs/imagens/15-telas-editor.png
server/domain/content-check.mjs
tests/content-check.test.mjs
tests/e2e/formats.e2e.mjs
tests/fixtures/media/audio-only.mov
tests/fixtures/media/cmyk.jpg
tests/fixtures/media/gray.jpg
tests/fixtures/media/h264-aac.mov
tests/fixtures/media/hevc-aac.mov
tests/fixtures/media/mpeg4-video-only.mov
tests/fixtures/media/progressive.jpg
tests/fixtures/media/prores-pcm.mov
tests/fixtures/media/restart.jpg
tests/formats.test.mjs
tests/helpers/media-files.mjs
tests/pairing-permission.test.mjs
tests/panel-formats.test.mjs
```

## Arquivos modificados (50)

```text
README.md
docs/API-E-COMPATIBILIDADE.md
docs/ARQUITETURA.md
docs/ARQUIVOS-2.1.0.md
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
docs/RELATORIO-FASE-2.md
docs/SEGURANCA.md
docs/TV-GLOBAL-E-AUDIO.md
docs/VALIDACAO.md
package.json
public/js/lib/audit-model.js
public/js/lib/display-model.js
public/js/lib/format.js
public/js/lib/media-validation.js
public/js/lib/permissions.js
public/js/playback/stage.js
public/js/player/app.js
public/js/views/common-dialogs.js
public/js/views/displays/index.js
public/js/views/library/details.js
public/js/views/library/upload.js
server/domain/displays.mjs
server/domain/formats.mjs
server/domain/media.mjs
server/domain/permissions.mjs
server/domain/users.mjs
server/routes/displays.mjs
tests/docs.test.mjs
tests/e2e/displays.e2e.mjs
tests/e2e/foundation.e2e.mjs
tests/e2e/playlists-fase2.e2e.mjs
tests/e2e/users.e2e.mjs
tests/frontend-core.test.mjs
tests/frontend-models.test.mjs
tests/helpers/fake-dom.mjs
tests/helpers/fake-media-dom.mjs
tests/helpers/http.mjs
tests/library.test.mjs
tests/panel-displays-shared.test.mjs
tests/permissions.test.mjs
tests/playback-stage.test.mjs
```

## Arquivos removidos (0)

Nenhum.

## Arquivos inalterados (202)

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
docs/legado/previa-v1.1.0.png
public/assets/favicon.svg
public/assets/destaque.jpg
public/assets/logo.png
public/auth.css
public/index.html
public/js/lib/api.js
public/js/lib/csv.js
public/js/lib/library-query.js
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
public/js/views/displays/form.js
public/js/views/displays/pairing.js
public/js/views/displays/sequence.js
public/js/views/index.js
public/js/views/library/actions.js
public/js/views/library/dnd.js
public/js/views/library/index.js
public/js/views/library/items.js
public/js/views/library/tree.js
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
server/core.mjs
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
server/domain/display-access.mjs
server/domain/files.mjs
server/domain/folders.mjs
server/domain/library.mjs
server/domain/organization.mjs
server/domain/player.mjs
server/domain/playlists.mjs
server/domain/scanner.mjs
server/domain/schedules.mjs
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
tests/database.test.mjs
tests/displays.test.mjs
tests/e2e/audit.e2e.mjs
tests/e2e/frame-analysis.mjs
tests/e2e/harness.mjs
tests/e2e/library.e2e.mjs
tests/e2e/playback-kit.mjs
tests/e2e/playback.e2e.mjs
tests/e2e/playlists.e2e.mjs
tests/e2e/run.mjs
tests/e2e/schedules.e2e.mjs
tests/e2e/settings.e2e.mjs
tests/fixtures/legacy-1.1.0/README.md
tests/fixtures/legacy-1.1.0/core.mjs
tests/fixtures/playback/video-azul-3s.webm
tests/fixtures/playback/video-roxo-6s.webm
tests/flow.test.mjs
tests/frame-analysis.test.mjs
tests/frontend-admin.test.mjs
tests/frontend-dom.test.mjs
tests/frontend-static.test.mjs
tests/hardening.test.mjs
tests/helpers/app.mjs
tests/helpers/html-dom.mjs
tests/helpers/legacy-db.mjs
tests/helpers/panel-kit.mjs
tests/helpers/playback-fakes.mjs
tests/helpers/player-kit.mjs
tests/helpers/pty-driver.py
tests/hygiene.test.mjs
tests/migrations.test.mjs
tests/organization.test.mjs
tests/panel-editor.test.mjs
tests/panel-playlists.test.mjs
tests/playback-api.test.mjs
tests/playback-audio.test.mjs
tests/playback-core.test.mjs
tests/playback-engine.test.mjs
tests/playback-loader.test.mjs
tests/playback-recovery.test.mjs
tests/player.test.mjs
tests/playlists.test.mjs
tests/process.test.mjs
tests/schedules.test.mjs
tests/shared-displays-migration.test.mjs
tests/shared-displays.test.mjs
tests/terminal.test.mjs
```

## O que mudou, arquivo por arquivo

Código, testes e arquivos de apoio (a documentação foi revista em bloco; veja o [relatório](RELATORIO-2.2.0.md)).

| Arquivo | Mudança |
| --- | --- |
| `server/domain/content-check.mjs` | Novo. Confere o arquivo inteiro de JPEG (segmentos, quadro, varredura e fim) e de MOV (estrutura, faixa de vídeo H.264 ou HEVC, dados no próprio arquivo), sem decodificar nem executar nada. |
| `tests/content-check.test.mjs` | Novo. 9 testes da conferência de JPEG e MOV (variantes válidas, cortes, estruturas inválidas, codecs, bytes ao acaso). |
| `tests/e2e/formats.e2e.mjs` | Novo. Cenário em navegador de MOV e JPEG: seletor, arrastar e soltar, recusas, aprovação, detalhes e reprodução na TV. |
| `tests/fixtures/media/audio-only.mov` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/cmyk.jpg` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/gray.jpg` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/h264-aac.mov` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/hevc-aac.mov` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/mpeg4-video-only.mov` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/progressive.jpg` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/prores-pcm.mov` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/fixtures/media/restart.jpg` | Novo. Arquivo sintético de teste (veja VALIDACAO.md). |
| `tests/formats.test.mjs` | Novo. 6 testes dos oito formatos no servidor: tipo, duplicados, recusas, pendente até aprovar, produção com antivírus e arquivos já cadastrados. |
| `tests/helpers/media-files.mjs` | Novo. Gera JPEG e MOV válidos e variações inválidas para os testes. |
| `tests/pairing-permission.test.mjs` | Novo. 6 testes da permissão de gerar o código: catálogo, contas, TV continua conectada, acesso à TV, separação de poderes e auditoria. |
| `tests/panel-formats.test.mjs` | Novo. 7 testes da janela de envio e dos detalhes com os oito formatos. |
| `package.json` | Versão 2.2.0. |
| `public/js/lib/audit-model.js` | Descrição do evento de código gerado nos detalhes da auditoria. |
| `public/js/lib/display-model.js` | Ação `generateCode` (Editor e Gestor) separada da ação `pairing` do Administrador. |
| `public/js/lib/format.js` | Rótulo do evento “Código de pareamento gerado”. |
| `public/js/lib/media-validation.js` | Oito formatos na janela de envio; conferência dos primeiros bytes do MOV. |
| `public/js/lib/permissions.js` | Descrições dos perfis Editor e Gestor e a permissão `screen:pair` no formulário de usuários (travada para o Visualizador, com o motivo). |
| `public/js/playback/stage.js` | MOV que o aparelho carrega mas não decodifica (largura 0) passa a ser falha definitiva de decodificação: o conteúdo é pulado com o motivo, sem quadro preto. |
| `public/js/player/app.js` | Versão do player (2.2.0). |
| `public/js/views/common-dialogs.js` | Texto de formatos aceitos com MOV e JPEG. |
| `public/js/views/displays/index.js` | Botão “Código de pareamento” e confirmação para quem tem a permissão; aviso da tela de Telas desses perfis. |
| `public/js/views/library/details.js` | Explicação, só quando ocorre, de MOV que o navegador não decodifica. |
| `public/js/views/library/upload.js` | Texto da área de soltar com os oito formatos. |
| `server/domain/displays.mjs` | `generatePairingCode` (sem desconectar a TV) e `permissions.pair` no retorno da TV. |
| `server/domain/formats.mjs` | `.mov` na tabela de formatos (`video/quicktime`), primeira conferência de assinatura do MOV e mensagem de formatos. |
| `server/domain/media.mjs` | Chama a conferência de conteúdo no envio de JPEG e MOV, antes de gravar. |
| `server/domain/permissions.mjs` | Permissão `screen:pair` no padrão de Editor e Gestor; texto de `screen:activate` corrigido (renovar o pareamento desconecta a TV). |
| `server/domain/users.mjs` | Recusa conceder `screen:pair` ao Visualizador, com mensagem própria. |
| `server/routes/displays.mjs` | Rota `POST /api/displays/:id/pairing-code`. |
| `tests/docs.test.mjs` | Documentos históricos da 2.1.0 e versão 2.2.0 nas conferências. |
| `tests/e2e/displays.e2e.mjs` | Editor e Gestor geram o código pelo botão, a TV segue conectada e a auditoria mostra quem gerou, sem o código. |
| `tests/e2e/foundation.e2e.mjs` | Atualizado ao menu do Gestor da 2.1.0 (sem Usuários); a troca de senha passa a usar outra conta de Administrador. |
| `tests/e2e/playlists-fase2.e2e.mjs` | Atualizado ao áudio da 2.1.0 na pré-visualização (aviso de áudio, espera da posição e linha de efeito). |
| `tests/e2e/users.e2e.mjs` | 21 permissões. |
| `tests/frontend-core.test.mjs` | Permissão de pareamento no formulário de usuários. |
| `tests/frontend-models.test.mjs` | Formatos e ação `generateCode` nos modelos do painel. |
| `tests/helpers/fake-dom.mjs` | `after()` no DOM de teste. |
| `tests/helpers/fake-media-dom.mjs` | Largura de vídeo configurável (MOV sem imagem decodificada). |
| `tests/helpers/http.mjs` | Arquivos de exemplo reais de JPEG e MOV para os testes de envio. |
| `tests/library.test.mjs` | Oito extensões no envio. |
| `tests/panel-displays-shared.test.mjs` | Botão de gerar o código para Editor e Gestor, com e sem acesso à TV. |
| `tests/permissions.test.mjs` | A rota de gerar o código na matriz de perfis. |
| `tests/playback-stage.test.mjs` | MOV sem imagem decodificada vira falha definitiva. |
