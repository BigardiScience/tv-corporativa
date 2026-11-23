# TV Corporativa

Plataforma de TV corporativa para organizar conteúdo, programação, telas e acessos por unidade e setor. Esta é a versão **2.4.0**: parte da 2.2.0 entregue, traz os pontos principais da 2.3.0 e corrige o vídeo em TVs que não tocam o arquivo baixado. A 2.2.0, por sua vez, partiu do pacote 2.1.0 recebido. O projeto é entregue como código local para abrir no **VS Code** e hospedar sob responsabilidade da TI.

Inclui tela de login, painel administrativo, player de TV e servidor com banco SQLite. Não depende de pacotes externos do npm para iniciar. Esta entrega não foi publicada na internet nem conectada à infraestrutura ou ao tenant Microsoft da empresa.

## Estado desta versão

- **Novo na 2.4.0:** a TV que recusa o vídeo baixado para a memória (erro de "formato ou arquivo não suportado" com arquivo e codecs corretos) passa a tocar o **mesmo arquivo direto do servidor**, por um **link temporário assinado**, e lembra o que funcionou. TVs que já tocam não mudam em nada. O servidor também entrega arquivos em blocos de leitura maiores. Não há migração de banco, nem mudança de formatos, codecs, áudio ou permissões. As TVs precisam **recarregar a página do player** para usar o código novo. Veja o [relatório da 2.4.0](docs/RELATORIO-2.4.0.md).
- **Da 2.3.0:** o **Editor** passa a **criar e publicar programações** (`schedule:create` e `schedule:publish` entram no padrão do perfil), sempre dentro da unidade e do setor da conta e só nas TVs que a TI liberou para ele. Continua sem aprovar arquivos, publicar versões de playlist e administrar TVs ou usuários. Não há migração de banco: os Editores já cadastrados ganham as duas permissões ao atualizar, e a TI pode retirar `schedule:publish` (ou as duas) de quem deva só preparar rascunhos.
- **Da 2.2.0:** envio de arquivos com **MOV** e **JPEG** (oito formatos: PNG, JPG, JPEG, WebP, PDF, MP4, MOV e WebM) e a permissão `screen:pair`, com que Editor e Gestor **geram o código de pareamento** das TVs já cadastradas que podem usar, sem desconectá-las. Não há migração de banco.
- **Da 2.1.0:** TVs compartilhadas por usuários e setores; administração exclusiva da TI; sequência consolidada com ordem global e controle de revisão; revogação de destinos sem apagar histórico; áudio automático com ativação acessível quando bloqueado.
- **Preservado:** biblioteca em pastas, playlists versionadas, vigência, duração natural ou limitada, repetição, transições, login, controles de segurança e identidade visual.
- **Leia primeiro:** [relatório da 2.4.0](docs/RELATORIO-2.4.0.md), [formatos aceitos](docs/FORMATOS.md), [atualização dos dados](docs/MIGRACOES.md) e [validação desta entrega](docs/VALIDACAO.md).
- **Limites:** não há homologação em televisores físicos (inclusive para MOV e HEVC), conversão de vídeo ou de Office, integração Microsoft/SSO ativa nem certificação ISO/IEC 27001 ou avaliação TISAX.



Validação da entrega: **588 testes automatizados: 588 passaram, 0 falharam, 0 ignorados** e 13 cenários em navegador (138 etapas) sem falhas, em Linux com Node.js 24 (nada foi executado em Windows nem em televisor). O que foi e o que não foi validado está no [relatório](docs/VALIDACAO.md).

## Começar

Requisito: **Node.js 24 ou superior**.

Abra `TV-Corporativa.code-workspace` no VS Code. No primeiro uso, o responsável da TI deve criar o administrador e iniciar o servidor:

```powershell
npm.cmd run configure
npm.cmd start
```

Acesse **[http://127.0.0.1:4173](http://127.0.0.1:4173)** e entre com a conta criada. O assistente solicita nome, e-mail e uma senha de 12 a 128 caracteres. Não existe senha padrão, cadastro público ou acesso automático como administrador.

Sem sessão, a tela inicial solicita login. Uma sessão válida é restaurada ao recarregar. O ambiente começa sem TVs, arquivos ou programações de exemplo, com as quatro unidades e quatro setores pré-cadastrados.

**Primeira vez no Windows? Siga o [passo a passo completo](docs/COMO-RODAR-NO-WINDOWS.md).** Também há tarefas prontas em **Terminal → Executar Tarefa** e atalhos `.cmd` numerados na raiz do projeto.

> `127.0.0.1` funciona somente no próprio computador. Para transmitir a outras TVs, a TI precisa hospedar o servidor em um endereço acessível na rede, com HTTPS e as proteções de implantação descritas nos guias.

### Já usa uma versão anterior?

Da 2.3.0 (ou da 2.2.0, ou da 2.1.0) para a 2.4.0 não há migração: o esquema continua na versão 8 e os dados de `data/` são reaproveitados como estão. **Atenção:** (1) cada TV só passa a usar o player novo quando a página do player é recarregada; (2) quem vem da 2.2.0 ou da 2.1.0: os Editores já cadastrados passam a criar e publicar programações assim que o código novo entra no ar, e, se alguém deve continuar só com rascunhos, a TI retira `schedule:publish` dessa pessoa em **Usuários** logo depois de atualizar. Bancos de versões anteriores recebem as migrações pendentes na inicialização (por exemplo, a 8 sobre bancos da Fase 2), com backup antes de alterar um banco existente; as credenciais das TVs são preservadas. Pare o serviço e faça uma cópia completa de `data/` e da configuração; ensaie a atualização nessa cópia. Não sobrescreva o banco real ou extraia o ZIP por cima da instalação em uso. Veja [MIGRACOES.md](docs/MIGRACOES.md).

## Unidades e setores

| Unidades | Setores disponíveis |
| --- | --- |
| Unidade Centro | RH |
| Unidade Leste | TI |
| Vila Norte | SEGURANÇA DO TRABALHO |
| Unidade Oeste | TESTE |

As colunas são listas independentes: cada unidade pode utilizar todos os setores. As permissões de cada conta delimitam quais unidades e setores ela pode acessar. O Administrador pode cadastrar novas unidades e setores em **Configurações**.

## O que já funciona

- **Biblioteca:** pastas e subpastas, renomear, mover (inclusive arrastando), excluir com confirmação, caminho de navegação, pesquisa, filtros, ordenação, grade e lista, miniaturas, seleção múltipla e aviso de arquivos duplicados.
- **Envio de arquivos:** PNG, JPG, JPEG, WebP, PDF, MP4, MOV e WebM, em janela com arrastar e soltar, seleção múltipla, progresso por arquivo, cancelamento, validação do formato e do conteúdo (em JPEG e MOV, do arquivo inteiro), e revisão e aprovação por perfil autorizado.
- **Playlists:** montagem com ordem, tempo e transição por conteúdo, **repetição** ligável e desligável, vídeo até o fim ou com limite, "Ver efeito" para comparar cada transição, **pré-visualização** da playlist inteira (no rascunho, antes de publicar, nas versões publicadas e no formulário da programação) e versões publicadas que não mudam depois de publicadas.
- **Programações:** definem quando e em quais TVs uma versão de playlist passa. Administrador, Gestor e Editor criam, publicam, alteram e interrompem programações no próprio escopo e nas TVs que podem usar; o Visualizador consulta. Publicar uma versão nova da playlist não altera o que já está no ar.
- **TVs:** cadastro e pareamento com código temporário, administração exclusiva pelo Administrador, compartilhamento por setores e usuários, revogação de acesso e situação online ou offline. Editor e Gestor geram o código de pareamento das TVs já cadastradas que podem usar.
- **Player** em **[http://127.0.0.1:4173/player.html](http://127.0.0.1:4173/player.html)**: carrossel com transições, próximo conteúdo preparado antes da troca, conteúdos que falham pulados com o motivo na tela, retomada do ponto em que estava depois de queda de conexão ou recarga da página, controles por teclado (**K**/espaço, **N**, **P**) e consulta de programação com sinal de vida. Vídeos tocam do arquivo baixado e, nas TVs que o recusam, direto do servidor por um link temporário assinado. O pareamento e a segurança da TV são os da Fase 1.
- **Usuários e permissões:** perfis com 21 permissões individuais, cada uma sempre limitada à unidade e ao setor da pessoa; suspensão e redefinição de senha pelo Administrador.
- **Auditoria:** busca, filtros, detalhes e exportação em CSV, respeitando o escopo de quem consulta.
- **Acessibilidade:** texto ampliado, contraste reforçado, rótulos, foco visível e navegação por teclado.

Veja o [guia das funcionalidades](docs/FUNCIONALIDADES.md), com o passo a passo "do arquivo até a TV".

## Perfis e permissões

Cada ação exige uma **permissão** e que a unidade e o setor do recurso estejam no escopo da conta. A decisão é do servidor; a interface apenas esconde o que a pessoa não pode fazer.

- **Administrador:** todas as 21 permissões e alcance global.
- **Gestor:** prepara, aprova e publica conteúdo dentro do escopo; consulta a auditoria do escopo; gera o código de pareamento das TVs autorizadas. Não administra TVs ou usuários.
- **Editor:** organiza a biblioteca, envia arquivos, monta playlists em rascunho, cria e publica programações nas TVs autorizadas e gera o código de pareamento delas. Não aprova arquivos nem publica versões de playlist por padrão; a TI pode retirar a publicação de programações de uma pessoa específica.
- **Visualizador:** consulta.

Contas vindas da 1.1.0 **não ganham poderes novos** na atualização, com duas exceções: na 2.2.0, Editores e Gestores, inclusive os já cadastrados, passam a gerar o código de pareamento das TVs que já podem usar; na 2.3.0, os Editores, inclusive os já cadastrados, passam a criar e publicar programações nas TVs que já podem usar. Em ambos os casos o Administrador pode retirar a permissão de uma pessoa. As demais capacidades novas continuam sendo liberadas pelo Administrador, pessoa a pessoa. A matriz completa está em [PERMISSOES.md](docs/PERMISSOES.md).

## Conteúdo e integrações

Edite nas ferramentas usuais e envie a versão exportada: **PNG, JPG, JPEG, WebP, PDF, MP4, MOV ou WebM** (a extensão pode estar em maiúsculas), até **50 MB** por arquivo (configurável em `MAX_UPLOAD_MB`, de 1 a 250). O MOV é aceito com vídeo H.264 ou HEVC; o projeto **não converte vídeo**, então teste cada MOV na TV de destino.

PowerPoint, Excel, Word, Power BI, Canva e Photoshop são ferramentas de origem. **PPTX, XLSX, DOCX, PBIX e PSD não são executados ou editados diretamente.** Para apresentações com animação, prefira MP4; para comunicados, prefira imagens. PDF depende do visualizador do navegador: o tempo definido vale para o documento inteiro e as páginas não passam sozinhas (o tempo por página não existe nesta versão). Consulte [FORMATOS.md](docs/FORMATOS.md). A transição escolhida na playlist é aplicada pelo player; em aparelhos lentos, sem suporte a animações ou com redução de movimento ativa, ela é simplificada e a tela diz isso.

Esta versão não tem integração com **Microsoft Entra ID, Microsoft 365/SharePoint/OneDrive nem Power BI**, e não há SSO/MFA Microsoft. Os quadros de integração, em **Configurações**, aparecem como “Não conectado”.

## Segurança e produção

O servidor implementa perfis, escopos por unidade/setor, senha com scrypt, sessão HttpOnly, proteção CSRF, limite de tentativas, validação de formato, aprovação de mídia, migrações com backup e trilha com hashes encadeados. Isso apoia a homologação; **não torna o produto certificado ISO/IEC 27001 ou avaliado TISAX**.

Em desenvolvimento, arquivos sem scanner exigem ciência explícita para aprovação. O modo de produção exige uma origem HTTPS e scanner antimalware configurado; falhas de varredura bloqueiam o upload. O scanner e suas assinaturas não estão incluídos no projeto.

Antes de usar dados corporativos reais, conclua a configuração de identidade, TLS, rede, backups, retenção, monitoramento, dispositivos e validações descritas em **[SEGURANCA.md](docs/SEGURANCA.md)** e **[IMPLANTACAO.md](docs/IMPLANTACAO.md)**. Não foi realizado teste de intrusão ou auditoria formal de conformidade/acessibilidade.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm.cmd start` | Iniciar o servidor local |
| `npm.cmd run dev` | Reiniciar o servidor ao alterar arquivos de código |
| `npm.cmd run configure` | Criar o primeiro administrador no terminal |
| `npm.cmd run reset-admin` | Recuperar localmente a senha de um administrador, pela TI |
| `npm.cmd run migrate` | Atualizar o banco sem iniciar o servidor (com backup) |
| `npm.cmd run backup` | Copiar o banco com o servidor ligado (mídias opcionais) |
| `npm.cmd run check` | Verificar a sintaxe de todos os JavaScript do projeto |
| `npm.cmd test` | Executar os testes automatizados |
| `npm.cmd run test:e2e` | Executar os cenários em navegador (exige o Playwright, opcional) |
| `npm.cmd run audit:verify` | Verificar a cadeia de hashes do registro local |

Copie `.env.example` para `.env` somente se precisar personalizar a configuração; as variáveis estão em [IMPLANTACAO.md](docs/IMPLANTACAO.md). Não compartilhe `.env`, o diretório `data/` ou credenciais dos players.

## Organização das pastas

```text
tv-corporativa/
├── public/                     Painel, player e ativos visuais
│   ├── js/                     Painel em módulos (lib, ui, views)
│   │   ├── playback/           Motor do carrossel (o mesmo na TV e na pré-visualização)
│   │   └── player/             Player da TV: pareamento, consulta e controles
│   └── assets/                 Logo, fotografia e ícone
├── server/                     Servidor HTTP e regras de negócio
│   ├── http/                   Roteador, cabeçalhos, estáticos, mídia
│   ├── routes/                 Rotas finas (HTTP → domínio)
│   ├── domain/                 Regras de negócio e permissões
│   ├── db/                     Conexão, migrador e migrações
│   └── lib/                    Utilitários
├── scripts/                    Configuração, recuperação, migração, backup e verificações
├── tests/                      Testes automatizados e cenários em navegador
├── docs/                       Guias de uso, implantação, segurança e relatórios
├── .vscode/                    Tarefas do VS Code
├── data/                       Criada ao usar; dados privados do servidor
├── 01-configurar-administrador.cmd
├── 02-iniciar-plataforma.cmd
├── 03-recuperar-administrador.cmd
├── TV-Corporativa.code-workspace
├── .env.example
├── Dockerfile
└── package.json
```

Abra a pasta que contém `package.json`. A pasta `public/` sozinha não executa o sistema. O servidor é necessário para login, permissões, arquivos e TVs.

## Documentação

**Atualização 2.4.0**

- [Relatório de entrega 2.4.0](docs/RELATORIO-2.4.0.md), com o comparativo 2.2.0 × 2.3.0 e o diagnóstico da TV
- [Arquivos alterados nesta entrega](docs/ARQUIVOS-2.4.0.md)
- [Validação realizada e limites](docs/VALIDACAO.md)

**Atualização 2.3.0 (histórico)**

- [Relatório de entrega 2.3.0](docs/RELATORIO-2.3.0.md)
- [Arquivos alterados na 2.3.0](docs/ARQUIVOS-2.3.0.md)

**Atualização 2.2.0 (histórico)**

- [Relatório de entrega 2.2.0](docs/RELATORIO-2.2.0.md)
- [Arquivos alterados na 2.2.0](docs/ARQUIVOS-2.2.0.md)

**Atualização 2.1.0 (histórico)**

- [TV global e áudio: operação e roteiro de teste](docs/TV-GLOBAL-E-AUDIO.md)
- [Relatório de entrega 2.1.0](docs/RELATORIO-2.1.0.md)
- [Arquivos alterados na 2.1.0](docs/ARQUIVOS-2.1.0.md)

**Para usar**

- [Como rodar no Windows, do zero](docs/COMO-RODAR-NO-WINDOWS.md)
- [Guia das funcionalidades](docs/FUNCIONALIDADES.md)
- [Operação e rotina da TI](docs/OPERACAO.md)
- [Formatos e ferramentas de origem](docs/FORMATOS.md)

**Para implantar e operar**

- [Implantação: local, Render e servidor corporativo](docs/IMPLANTACAO.md)
- [Migrações do banco e como atualizar da 1.1.0](docs/MIGRACOES.md)
- [Segurança, governança e preparação para produção](docs/SEGURANCA.md)

**Para entender e manter**

- [Perfis e permissões](docs/PERMISSOES.md)
- [Arquitetura e limites da implementação](docs/ARQUITETURA.md)
- [API e compatibilidade com a 1.1.0](docs/API-E-COMPATIBILIDADE.md)
- [Identidade visual e ativos](docs/MARCA.md)

**Histórico da Fase 2**

- [Relatório da Fase 2](docs/RELATORIO-FASE-2.md)
- [Registro de mudanças](docs/REGISTRO-DE-MUDANCAS.md)
- [Arquivos novos, modificados e removidos na Fase 2](docs/ARQUIVOS-DA-FASE-2.md)

**Fase 1 (histórico)**

- [Relatório da Fase 1](docs/RELATORIO-FASE-1.md)
- [Arquivos novos, modificados e removidos na Fase 1](docs/ARQUIVOS-DA-FASE-1.md)

O logotipo e a ilustração da interface são genéricos e foram criados para este projeto. Veja como trocá-los pela marca da sua empresa em [Identidade visual e ativos](docs/MARCA.md).
