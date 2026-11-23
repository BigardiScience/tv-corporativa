# Arquivos da Fase 1

Versão **2.0.0-fase1**, comparada com a 1.1.0 (o código original recebido). A comparação foi feita pelo **conteúdo** dos arquivos, não só pelos nomes. Enquanto o pacote continuar nesta versão, `tests/docs.test.mjs` confere que estas listas são exatamente os arquivos do pacote.

> **Documento histórico da Fase 1.** Esta lista descreve o pacote 2.0.0-fase1; o pacote atual mudou. A lista da versão atual, comparada com a 2.0.0-fase1, está em [ARQUIVOS-DA-FASE-2.md](ARQUIVOS-DA-FASE-2.md), e o relatório atual, em [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md).

Não fazem parte do pacote nem da comparação: a pasta `.git` (o histórico do seu repositório), a pasta `data/` (dados de execução), `node_modules/` e `tests/e2e/output/` (capturas geradas pelos cenários em navegador).

| Situação | Quantidade |
| --- | --- |
| Novos | 164 |
| Modificados | 19 |
| Removidos | 6 |
| Inalterados | 18 |

## Arquivos removidos (6)

Estes arquivos da 1.1.0 não existem mais:

```text
docs/previa.png
public/app.js
public/auth-view.js
public/media-validation.js
tests/frontend.test.mjs
tests/server.test.mjs
```

- **docs/previa.png**: Captura de tela da 1.1.0, mantida como referência em docs/legado/previa-v1.1.0.png.
- **public/app.js**: O painel inteiro num só arquivo. Substituído pelos módulos de public/js (ponto de entrada main.js).
- **public/auth-view.js**: A tela de acesso do painel antigo. Substituída por public/js/views/login.js.
- **public/media-validation.js**: A validação de arquivos do painel antigo. Substituída por public/js/lib/media-validation.js.
- **tests/frontend.test.mjs**: Os 12 testes do painel antigo, que simulavam o navegador. Substituídos pelos testes do painel e pelos cenários em navegador (o mapa está em VALIDACAO.md).
- **tests/server.test.mjs**: Os 3 testes do servidor antigo. Substituídos pelos testes de fluxo, permissões, endurecimento e migrações.

## Arquivos modificados (19)

```text
.env.example
.gitignore
Dockerfile
README.md
docs/ARQUITETURA.md
docs/COMO-RODAR-NO-WINDOWS.md
docs/FORMATOS.md
docs/OPERACAO.md
docs/SEGURANCA.md
docs/VALIDACAO.md
package.json
public/index.html
scripts/configure.mjs
scripts/reset-admin.mjs
scripts/verify-audit.mjs
server/core.mjs
server/index.mjs
tests/auth.test.mjs
tests/player.test.mjs
```

| Arquivo | O que mudou |
| --- | --- |
| `.env.example` | Variáveis novas (`DB_PATH`, `MEDIA_DIR`, `BACKUP_DIR`, `PLAYLIST_MAX_ITEMS`, `TRUST_PROXY` e `TEST_ADMIN_*`), com comentários; os segredos continuam sempre vazios |
| `.gitignore` | Passa a ignorar também as capturas de tela geradas pelos cenários em navegador (`tests/e2e/output/`) |
| `Dockerfile` | Acrescenta uma verificação de saúde que consulta `/healthz` |
| `README.md` | Reescrito: estado da fase, atualização a partir da 1.1.0, funcionalidades, comandos e índice de documentos |
| `docs/ARQUITETURA.md` | Reescrito para a arquitetura em camadas e o novo modelo de dados |
| `docs/COMO-RODAR-NO-WINDOWS.md` | Reescrito para o fluxo atual (comandos novos, perfis, testes) |
| `docs/FORMATOS.md` | Acrescenta o tempo de exibição, as transições e o limite de envio configurável |
| `docs/OPERACAO.md` | Reescrito: perfis, rotina da TI, backup e migração |
| `docs/SEGURANCA.md` | Reescrito: controles com a evidência de cada um, mapeamento inicial ao Anexo A, riscos e limitações |
| `docs/VALIDACAO.md` | Reescrito: resultados, inventário dos testes, mapa dos 25 testes da 1.1.0 e o que não foi validado |
| `package.json` | Versão 2.0.0-fase1, novos scripts (`migrate`, `backup`, `test:e2e`) e nova descrição |
| `public/index.html` | Passa a carregar o painel modular (`/js/main.js`) e a folha de estilos `panel.css` |
| `scripts/configure.mjs` | Usa o registro técnico em JSON, mostrando só avisos e erros no terminal |
| `scripts/reset-admin.mjs` | Idem |
| `scripts/verify-audit.mjs` | Lê o caminho do banco da configuração (`DB_PATH`), em vez de montá-lo por conta própria |
| `server/core.mjs` | Era o servidor inteiro; agora só compõe configuração, banco, migrações, serviços e rotas |
| `server/index.mjs` | Inicialização com mensagens claras de erro, administrador de homologação em módulo próprio e encerramento ordenado |
| `tests/auth.test.mjs` | Ampliado: senhas, sessões, desativação de contas e recuperação pelo terminal |
| `tests/player.test.mjs` | Os seis testes do player da 1.1.0, adaptados à nova inicialização; o fluxo integrado agora toca a programação na ordem |

## Arquivos inalterados (18)

Idênticos aos da 1.1.0. Entre eles estão o **player** (`public/player.js`, `public/player.html` e `public/player.css`) e os estilos da identidade visual (`public/styles.css` e `public/auth.css`).

```text
.dockerignore
.vscode/extensions.json
.vscode/launch.json
.vscode/tasks.json
01-configurar-administrador.cmd
02-iniciar-plataforma.cmd
03-recuperar-administrador.cmd
TV-Corporativa.code-workspace
docs/MARCA.md
public/assets/favicon.svg
public/assets/destaque.jpg
public/assets/logo.png
public/auth.css
public/player.css
public/player.html
public/player.js
public/styles.css
scripts/check.mjs
```

## Arquivos novos (164)

### `server/` (2)

Configuração por variáveis de ambiente e criação do administrador de homologação.

```text
server/config.mjs
server/dev-admin.mjs
```

### `server/db/` (2)

Conexão com o SQLite e o migrador (backup, tudo-ou-nada, conferência de integridade).

```text
server/db/connection.mjs
server/db/migrator.mjs
```

### `server/db/migrations/` (8)

As seis migrações, o índice delas e a leitura do formato antigo da 1.1.0.

```text
server/db/migrations/001-baseline.mjs
server/db/migrations/002-organization.mjs
server/db/migrations/003-library.mjs
server/db/migrations/004-displays.mjs
server/db/migrations/005-playlists-schedules.mjs
server/db/migrations/006-users.mjs
server/db/migrations/index.mjs
server/db/migrations/legacy.mjs
```

### `server/domain/` (16)

Regras de negócio: permissões, usuários, sessões, organização, pastas, mídias, biblioteca, playlists, programações, TVs, player e auditoria.

```text
server/domain/audit.mjs
server/domain/displays.mjs
server/domain/files.mjs
server/domain/folders.mjs
server/domain/formats.mjs
server/domain/library.mjs
server/domain/media.mjs
server/domain/organization.mjs
server/domain/permissions.mjs
server/domain/player.mjs
server/domain/playlists.mjs
server/domain/scanner.mjs
server/domain/schedules.mjs
server/domain/sessions.mjs
server/domain/usage.mjs
server/domain/users.mjs
```

### `server/http/` (7)

Roteador, contexto da requisição, leitura segura do corpo, respostas, cabeçalhos de segurança, arquivos estáticos e entrega de mídia.

```text
server/http/context.mjs
server/http/request.mjs
server/http/responses.mjs
server/http/router.mjs
server/http/security.mjs
server/http/send-file.mjs
server/http/static.mjs
```

### `server/lib/` (5)

Utilitários: criptografia, erros, registro técnico em JSON, limitador de tentativas e validações.

```text
server/lib/crypto.mjs
server/lib/errors.mjs
server/lib/logger.mjs
server/lib/rate-limit.mjs
server/lib/validate.mjs
```

### `server/routes/` (6)

Rotas HTTP finas, que traduzem o pedido para chamadas ao domínio.

```text
server/routes/auth.mjs
server/routes/displays.mjs
server/routes/library.mjs
server/routes/playlists.mjs
server/routes/system.mjs
server/routes/users.mjs
```

### `scripts/` (2)

Migração do banco e backup.

```text
scripts/backup.mjs
scripts/migrate.mjs
```

### `public/` (1)

Estilos das peças novas do painel.

```text
public/panel.css
```

### `public/js/` (1)

Ponto de entrada do painel.

```text
public/js/main.js
```

### `public/js/lib/` (19)

Regras do painel sem DOM: cliente da API, rotas, sessão, permissões, modelos, fila de envio, formatação.

```text
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
```

### `public/js/ui/` (9)

Componentes, diálogos, avisos, ícones, miniaturas e estrutura da página.

```text
public/js/ui/components.js
public/js/ui/dialogs.js
public/js/ui/dom.js
public/js/ui/download.js
public/js/ui/feedback.js
public/js/ui/icons.js
public/js/ui/shell.js
public/js/ui/thumbnails.js
public/js/ui/toast.js
```

### `public/js/views/` (7)

Telas de uso geral: acesso, visão geral, unidades, auditoria e diálogos comuns.

```text
public/js/views/audit.js
public/js/views/common-dialogs.js
public/js/views/index.js
public/js/views/login.js
public/js/views/overview.js
public/js/views/shared.js
public/js/views/units.js
```

### `public/js/views/library/` (7)

Tela da biblioteca: árvore de pastas, itens, envio, detalhes, ações e arrastar e soltar.

```text
public/js/views/library/actions.js
public/js/views/library/details.js
public/js/views/library/dnd.js
public/js/views/library/index.js
public/js/views/library/items.js
public/js/views/library/tree.js
public/js/views/library/upload.js
```

### `public/js/views/playlists/` (7)

Tela de playlists: lista, editor, itens, seletor da biblioteca, prévia, publicação e versões.

```text
public/js/views/playlists/editor.js
public/js/views/playlists/index.js
public/js/views/playlists/items.js
public/js/views/playlists/picker.js
public/js/views/playlists/preview.js
public/js/views/playlists/publish.js
public/js/views/playlists/versions.js
```

### `public/js/views/schedules/` (2)

Tela de programações.

```text
public/js/views/schedules/form.js
public/js/views/schedules/index.js
```

### `public/js/views/displays/` (2)

Tela de telas (TVs) e janela do código de pareamento.

```text
public/js/views/displays/index.js
public/js/views/displays/pairing.js
```

### `public/js/views/users/` (5)

Tela de usuários, formulário, senha e editor de permissões.

```text
public/js/views/users/form.js
public/js/views/users/index.js
public/js/views/users/password-field.js
public/js/views/users/password.js
public/js/views/users/permission-editor.js
```

### `public/js/views/settings/` (2)

Tela de configurações e cadastro de unidades e setores.

```text
public/js/views/settings/index.js
public/js/views/settings/organization.js
```

### `tests/` (20)

Testes automatizados novos.

```text
tests/audit.test.mjs
tests/database.test.mjs
tests/displays.test.mjs
tests/docs.test.mjs
tests/flow.test.mjs
tests/frontend-admin.test.mjs
tests/frontend-core.test.mjs
tests/frontend-dom.test.mjs
tests/frontend-models.test.mjs
tests/frontend-static.test.mjs
tests/hardening.test.mjs
tests/hygiene.test.mjs
tests/library.test.mjs
tests/migrations.test.mjs
tests/organization.test.mjs
tests/permissions.test.mjs
tests/playlists.test.mjs
tests/process.test.mjs
tests/schedules.test.mjs
tests/terminal.test.mjs
```

### `tests/helpers/` (5)

Auxiliares dos testes: aplicativo de teste, cliente HTTP, DOM de teste, banco da 1.1.0 e terminal.

```text
tests/helpers/app.mjs
tests/helpers/fake-dom.mjs
tests/helpers/http.mjs
tests/helpers/legacy-db.mjs
tests/helpers/pty-driver.py
```

### `tests/fixtures/legacy-1.1.0/` (2)

Cópia do servidor da 1.1.0, usada só pelos testes para gerar um banco real da versão antiga.

```text
tests/fixtures/legacy-1.1.0/README.md
tests/fixtures/legacy-1.1.0/core.mjs
```

### `tests/e2e/` (10)

Executor e oito cenários em navegador (Playwright é opcional).

```text
tests/e2e/audit.e2e.mjs
tests/e2e/displays.e2e.mjs
tests/e2e/foundation.e2e.mjs
tests/e2e/harness.mjs
tests/e2e/library.e2e.mjs
tests/e2e/playlists.e2e.mjs
tests/e2e/run.mjs
tests/e2e/schedules.e2e.mjs
tests/e2e/settings.e2e.mjs
tests/e2e/users.e2e.mjs
```

### `docs/` (7)

Documentos novos.

```text
docs/API-E-COMPATIBILIDADE.md
docs/ARQUIVOS-DA-FASE-1.md
docs/FUNCIONALIDADES.md
docs/IMPLANTACAO.md
docs/MIGRACOES.md
docs/PERMISSOES.md
docs/RELATORIO-FASE-1.md
```

### docs/imagens/ (9)

Capturas de tela do painel (ambiente de teste, dados fictícios).

```text
docs/imagens/01-login.png
docs/imagens/02-biblioteca.png
docs/imagens/03-playlist.png
docs/imagens/04-programacoes.png
docs/imagens/05-telas.png
docs/imagens/06-codigo-de-pareamento.png
docs/imagens/07-usuarios-permissoes.png
docs/imagens/08-meu-acesso.png
docs/imagens/09-auditoria.png
```

### docs/legado/ (1)

Captura de tela da versão 1.1.0.

```text
docs/legado/previa-v1.1.0.png
```
