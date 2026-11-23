# Relatório da Fase 1: arquitetura e permissões

Versão **2.0.0-fase1**, partindo da versão 1.1.0. Elaborado em 23/10/2026.

> **Documento histórico da Fase 1.** Os números e as afirmações abaixo descrevem o pacote 2.0.0-fase1 (por exemplo, "o player não foi alterado") e não são reescritos a cada fase. Para a versão atual, veja [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md) (carrossel e reprodução), [VALIDACAO.md](VALIDACAO.md) e [REGISTRO-DE-MUDANCAS.md](REGISTRO-DE-MUDANCAS.md).

Este relatório reúne o que o documento de requisitos pede ao final de cada fase (seção 20) e separa três coisas que costumam ser misturadas: o que foi **feito e testado**, o que foi **feito, mas só validado em ambiente de teste**, e o que **não foi feito**. Os detalhes de cada assunto estão nos outros documentos, indicados ao longo do texto. Os resultados dos testes e o que não pôde ser validado estão em [VALIDACAO.md](VALIDACAO.md).

## 1. Em resumo

| Situação | O que entra aqui |
| --- | --- |
| **Feito, integrado e testado** | Biblioteca em pastas e subpastas; playlists com rascunho e versões publicadas imutáveis; programações separadas (quando e onde a playlist passa); perfis Gestor e Editor com 20 permissões individuais, sempre com escopo de unidade e setor, verificadas no servidor; cadastro de TV com ativação posterior; migração segura do banco da 1.1.0; painel reescrito em módulos; auditoria com escopo; configurações de unidades e setores |
| **Feito, mas só validado em ambiente de teste** | A migração do banco (testada com um banco gerado pelo código da 1.1.0 e com volume sintético, não com o seu banco real); todos os testes (rodaram no Node 22, e o projeto pede o 24); os cenários em navegador (apenas Chromium); o antivírus (apenas um programa simulado) |
| **Não feito** | Fases 2 a 7: transições aplicadas na TV, pré-carregamento e recuperação do player (Fase 2); Player Universal, pareamento iniciado pela TV, monitoramento, diagnóstico e quiosque (Fase 3); conversão de apresentações e PDFs, Canva e Power BI (Fase 4); recuperação de senha com aprovação (Fase 5); modo escuro (Fase 6); homologação em televisores reais e preparação final do servidor (Fase 7) |

**Antes de usar com dados reais:**

1. No seu computador (Node 24.19.0), rode `npm.cmd run check` e `npm.cmd test`. Nada foi executado no Node 24 nem no Windows durante a validação.
2. Faça uma cópia da pasta `data/` e **ensaie a migração nessa cópia**, como descrito em [MIGRACOES.md](MIGRACOES.md). Só você tem o banco real.
3. Publique no Render, num serviço de teste separado (procedimento em [IMPLANTACAO.md](IMPLANTACAO.md)), e percorra o fluxo de [FUNCIONALIDADES.md](FUNCIONALIDADES.md). A versão publicada hoje não é tocada por este pacote.
4. Se algo falhar, a volta à 1.1.0 está descrita em [MIGRACOES.md](MIGRACOES.md).

Nenhuma televisão foi usada neste trabalho: a compatibilidade com qualquer modelo ou fabricante **não foi testada** e não é declarada. O produto também não é certificado ISO/IEC 27001 nem avaliado TISAX.

## 2. Diagnóstico da versão 1.1.0

### 2.1 O que já estava bom e foi mantido

Autenticação própria com senhas em scrypt e sal aleatório; sessão com token aleatório de que o banco guarda só o hash; proteção CSRF e conferência da origem; limite de tentativas de login; política de segurança de conteúdo (CSP) restritiva; pareamento de TV com código temporário e credencial individual guardada como hash; trilha de auditoria com hashes encadeados; validação de arquivos por assinatura e integração opcional com antivírus; nenhuma dependência npm; configuração por variáveis de ambiente, sem credenciais no código. Tudo isso foi preservado, e a maior parte passou a ter teste automatizado próprio.

### 2.2 Conflitos entre a 1.1.0 e os novos requisitos

| Na 1.1.0 | Por que conflita | O que a Fase 1 fez |
| --- | --- | --- |
| Todo o servidor num só arquivo (o antigo `core.mjs` tinha cerca de 300 linhas muito densas) e todo o painel num só arquivo de cerca de 65 KB | Exigência de código modular; cada mudança arriscava tudo | Servidor em camadas (`server/http`, `server/routes`, `server/domain`, `server/db`, `server/lib`) e painel em módulos ES (`public/js`) |
| Dados como documentos JSON genéricos (`records`, `users.data`), sem chaves estrangeiras; cada consulta carregava e filtrava coleções inteiras em JavaScript | Sem integridade referencial; não escala; impossível impedir ciclos de pastas ou referências quebradas no banco | Tabelas relacionais com chaves estrangeiras, índices e gatilhos; as tabelas antigas ficam intactas |
| Esquema criado só com `CREATE TABLE IF NOT EXISTS`, sem versão | Não permite migrar sem perder dados | Migrador versionado, com backup verificado e tudo-ou-nada |
| "Playlist" era uma publicação: conteúdos, TVs, período e duração num só registro, sem edição depois de publicada | Contraria a separação entre Playlist e Programação | Playlist (rascunho e versões imutáveis) separada da Programação (quando, onde e em quais telas) |
| Biblioteca plana: sem pastas e sem renomear, mover ou excluir arquivos | Contraria a biblioteca hierárquica | Pastas com identificador permanente, anti-ciclo, mover, renomear e excluir |
| Permissões fixas por perfil, escritas no código (`admin`, `manager`, `editor`, `viewer`) | Impede permissões granulares e o perfil Gestor com poderes limitados | Catálogo de 20 permissões, padrões por perfil e concessões e retiradas por pessoa |
| `GET /api/state` devolvia tudo de uma vez | Sem paginação e sem escopo por recurso | Rotas por recurso, com paginação e escopo |

### 2.3 Falhas e riscos encontrados

A coluna "Como foi constatado" diz se o problema foi **reproduzido** executando o código da 1.1.0 (em modo de leitura, sem alterar a versão original) ou apenas **lido** no código.

| Achado | Consequência | Como foi constatado | Correção |
| --- | --- | --- | --- |
| Endereço malformado (por exemplo, `/%E0%A4%A`) provocava exceção não tratada | Resposta 500 e registro de "falha interna" para uma entrada trivial de um visitante | Reproduzido | Recusa com 400 ou 404, sem 500 |
| Em caso de login com falha, o texto digitado no campo e-mail ia para a auditoria | Uma senha digitada no campo errado ficava gravada em texto no registro | Reproduzido | Só se grava o que tem formato de e-mail |
| O cookie de sessão só era `Secure`, e o HSTS só era enviado, com `NODE_ENV=production` | Um ambiente de homologação em HTTPS (como o Render) trabalhava com cookie sem `Secure` | Reproduzido | `Secure` e HSTS passam a seguir a origem HTTPS |
| Arquivos estáticos com `Cache-Control: no-store` e sem `ETag` | Todo o painel era baixado de novo a cada visita | Reproduzido | Revalidação por `ETag` nos estáticos; a API continua com `no-store` |
| O limitador de tentativas e a conferência "esta requisição é local?" usavam o endereço da conexão | Atrás de um proxy reverso, todas as pessoas parecem ter o mesmo endereço (o limite de login passaria a ser global) e, se o proxy rodar no mesmo servidor, a configuração inicial (protegida por token) pareceria local | Lido | `TRUST_PROXY` explícito, contando os endereços de `X-Forwarded-For` a partir da direita; sem ele o cabeçalho é ignorado |
| Arquivos de mídia lidos inteiros e entregues sem suporte a `Range` e `ETag` | Vídeos grandes e navegadores que pedem faixas de bytes sofrem; sem revalidação | Lido | Entrega com `Range`, `ETag` e `304`, verificando o escopo |
| Autenticação da TV varria todas as TVs e a programação ativa percorria todas as playlists a cada consulta | Custo proporcional ao volume, a cada consulta de cada TV | Lido | Consultas indexadas |
| Sem exclusão, renomeação nem movimentação de arquivos; sem backup; sem registro estruturado | Operação precária | Lido | Funcionalidades novas, `npm run backup` e registro técnico em JSON sem segredos |

### 2.4 Ordem de implementação

Primeiro o que é estrutural e afeta tudo o resto: migrador e banco, depois permissões, depois biblioteca, playlists, programações e TVs, só então o painel e, por fim, a documentação e a validação. O painel foi escrito depois do servidor para que a interface nunca fosse a única barreira de proteção.

## 3. O que a Fase 1 entrega, requisito por requisito

Situações: **Concluído** (integrado e testado), **Parcial** (existe, mas falta algo que o requisito pede) e **Não iniciado**. "Testado" aqui significa os testes descritos em [VALIDACAO.md](VALIDACAO.md), no ambiente ali descrito.

### 3.1 Regras obrigatórias (seção 1.1)

| Regra | Situação | Observação |
| --- | --- | --- |
| 1 e 2. Preservar as funcionalidades e não excluir sem justificativa | Concluído, com uma exceção | O painel antigo continha um "modo demonstração" (dados fictícios no navegador) que **não tinha nenhuma forma de ser ligado** na 1.1.0 (a variável que o ativava só recebia `false`). Não foi portado, também porque o documento de requisitos pede para não substituir funcionalidades reais por demonstrações visuais. A demonstração do **player** (`player.html?demo=1`) continua. **Se você quiser o modo demonstração de volta, diga e ele entra como um ambiente de treinamento claramente identificado.** |
| 3. Identidade visual | Concluído | `styles.css` e `auth.css` ficaram idênticos; os módulos novos usam as mesmas cores e variáveis (`panel.css`) |
| 4. Unidades, setores e permissões | Concluído | Preservados e ampliados |
| 5. Autorização no servidor | Concluído | Um único ponto de decisão; teste que varre todas as rotas |
| 6. Desempenho, segurança e estabilidade | Parcial | Paginação, consultas indexadas e testes de segurança; **sem teste de carga** |
| 7. Minimizar dependências | Concluído | Nenhuma dependência npm; o Playwright dos testes em navegador é opcional e fica fora do projeto |
| 8. Migrações sem perda de dados | Concluído em teste | Ensaiar no seu banco real (veja [MIGRACOES.md](MIGRACOES.md)) |
| 9. Compatibilidade com Node.js | Parcial | O projeto exige Node 24 ou superior, como a 1.1.0; foi testado no Node 22.22.0 |
| 10. APIs preservadas ou mudanças documentadas | Concluído | [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md) |
| 11. Sem senhas ou credenciais no código | Concluído | Teste de higiene; o administrador de homologação vem de variáveis de ambiente |
| 12. Testes de funcionalidades novas e existentes | Concluído para a Fase 1 | Veja [VALIDACAO.md](VALIDACAO.md) |
| 13. Documentar | Concluído | Cada documento é conferido por teste contra o código |
| 14. Não dar por concluído sem validação | Seguido | Este relatório usa três situações para isso |
| 15. Privilégio mínimo, segregação de funções, rastreabilidade | Parcial | Privilégio mínimo e rastreabilidade: sim. **Segregação entre quem envia e quem aprova um arquivo: não existe** |
| 16. Preservar o player durante atualizações administrativas | Concluído | A programação aponta para uma versão fixa da playlist; editar ou publicar uma versão nova não muda o que está no ar |

### 3.2 Seções 2 a 5: biblioteca, playlist, programação, carrossel, formatos e upload

| Seção | Situação | O que existe e o que falta |
| --- | --- | --- |
| 2. Biblioteca, playlist e programação | **Concluído** | Pastas e subpastas (até 8 níveis) com identificador permanente e sem ciclos (conferido no servidor e por gatilho no banco); renomear, mover (inclusive arrastando) e excluir com confirmação; navegação com caminho (breadcrumbs); pesquisa sem acento em toda a biblioteca; filtros; ordenação por nome, data, formato e tamanho; grade e lista; miniaturas (geradas no navegador, apenas em memória); seleção múltipla; ações em lote tudo-ou-nada; uso em playlists e programações visível e protegido contra exclusão; tratamento de arquivos duplicados. Playlists com rascunho, versões publicadas, restauração, tempo e transição por conteúdo e prévia. Programações com período, TVs e situação. Mover arquivos não quebra playlists nem programações |
| 3. Carrossel automático | **Parcial** | Pronto: limite de conteúdos por playlist configurável (6 por padrão, até 15), ordem, tempo individual de cada conteúdo (5 a 3600 s), prévia no navegador e entrega ao player. O **player da 1.1.0, que não foi alterado**, avança pela lista e recomeça do primeiro conteúdo usando o tempo de cada item. **Não existe:** duração natural do vídeo, tempo por página de PDF, laço configurável, pré-carregamento, continuidade sem tela preta, recuperação do estado após reconexão e **aplicação das transições**. As transições são escolhidas, validadas, gravadas e entregues ao player, mas o player ainda troca de conteúdo com corte seco. Tudo isso é a Fase 2 |
| 4. Compatibilidade de formatos | **Não iniciado** | PNG, JPG, WebP, PDF, MP4 e WebM continuam aceitos como antes. Conversão de PPT/PPTX e de PDF em páginas, conteúdo do Canva e Power BI são a Fase 4 e dependem de programas conversores no servidor e de licenças e credenciais (veja [FORMATOS.md](FORMATOS.md)) |
| 5. Upload | **Parcial** (adiantado da Fase 4) | Janela de envio com área para arrastar e soltar, seleção múltipla, escolha da pasta, título editável, barra de progresso por arquivo, resumo do conjunto, cancelamento, nova tentativa, aviso de duplicados e mensagens de erro; validação no navegador e, de novo, no servidor (extensão, assinatura do conteúdo e tamanho), sem enfraquecer o antivírus. **Falta:** pré-visualização antes de enviar, conversões, barra única de progresso geral, validação em telas pequenas. Soltar arquivos do sistema operacional sobre a área de envio não foi exercitado no navegador automatizado |

### 3.3 Seções 6 a 8: senha, tema e permissões

| Seção | Situação | O que existe e o que falta |
| --- | --- | --- |
| 6. Recuperação de senha com aprovação | **Não iniciado** (Fase 5) | Hoje só o Administrador redefine a senha de outra pessoa (pelo painel) ou a TI redefine a de um administrador no servidor (`npm run reset-admin`). Não há "Esqueci minha senha" nem troca da própria senha. O fluxo pedido precisa de um serviço de e-mail (SMTP), que é uma dependência externa |
| 7. Modo noturno, claro e automático | **Não iniciado** (Fase 6) | Continuam os recursos preexistentes de texto ampliado e contraste reforçado, agora com teste |
| 8. Novas permissões | **Concluído**, exceto aprovar recuperação de senha (Fase 5) | Os 11 identificadores citados no requisito existem com os mesmos nomes; Gestor e Editor cadastram TVs no próprio escopo; a TV cadastrada por quem não pode ativá-la fica aguardando ativação; o sistema registra quem cadastrou e quem ativou. Matriz completa em [PERMISSOES.md](PERMISSOES.md) |

### 3.4 Seções 9 a 13: Player Universal, pareamento, monitoramento, quiosque e diagnóstico

| Seção | Situação | O que existe e o que falta |
| --- | --- | --- |
| 9. Player Universal (LG, Samsung, AOC) | **Não iniciado** (Fase 3) | O player é o da 1.1.0. Nenhuma televisão foi usada e nada foi homologado: a compatibilidade com qualquer fabricante, modelo ou sistema (webOS, Tizen, Android TV, Roku) **não foi testada** e não é afirmada |
| 10. Pareamento de televisões | **Parcial** | Continuam valendo e foram ampliados: códigos temporários de 6 dígitos com validade de 10 minutos e uso único, limite de tentativas, credencial individual guardada como hash, revogação, auditoria e escopo, sem senhas administrativas na TV. Agora Administrador, Gestor e Editor participam conforme a permissão. **O fluxo do requisito é o inverso do atual:** o requisito quer que a **TV mostre** o código e o painel o receba; hoje o **painel gera** o código e a TV o digita. A inversão depende do novo player (Fase 3) |
| 11. Monitoramento | **Parcial**, mínimo | A lista de telas mostra online, offline ou inativa conforme o último contato (online só com contato nos últimos 90 s) e a data do último contato; cadastro sem contato não conta como online. **Falta:** modelo, sistema, versão do player, falhas recentes, estado da reprodução, histórico e reinício lógico (Fase 3) |
| 12. Modo quiosque | **Não iniciado** | Depende de cada plataforma e de aparelhos reais (Fases 3 e 7) |
| 13. Diagnóstico e homologação | **Não iniciado** | Não há módulo de diagnóstico nem matriz de homologação: sem aparelhos testados, qualquer matriz seria inventada |

### 3.5 Seções 14 a 17: infraestrutura, segurança, desempenho e interface

| Seção | Situação | O que existe e o que falta |
| --- | --- | --- |
| 14. Rede corporativa e servidor próprio | **Parcial** | Preparado: caminhos do banco, das mídias e dos backups por variável de ambiente; HTTPS por proxy reverso (`APP_ORIGIN`, `TRUST_PROXY`); verificação de saúde em `/healthz`; `npm run backup`; `Dockerfile`; guia em [IMPLANTACAO.md](IMPLANTACAO.md). SQLite mantido. Os registros vão para a saída padrão em JSON e o envio de arquivos não usa pasta temporária (lê tudo em memória). **Nada disso foi executado no Render nem no servidor da empresa** |
| 15. ISO/IEC 27001 e VDA ISA/TISAX | **Parcial** | Controles técnicos implementados e documentados com a evidência de cada um em [SEGURANCA.md](SEGURANCA.md), com um mapeamento inicial para 17 controles do Anexo A da ISO/IEC 27001:2022. **O catálogo VDA ISA não foi mapeado.** Gestão de vulnerabilidades, gestão de atualizações e segurança de conteúdo em cache não foram tratadas. O relatório técnico final de aderência é um entregável do fim do projeto. O produto não é certificado nem avaliado |
| 16. Desempenho e confiabilidade | **Parcial** | Paginação, consultas indexadas, `/api/state` leve, `ETag` e `Range`, verificação de saúde, tratamento de exceções com resposta genérica, encerramento ordenado. **Falta:** pré-carregamento e reconexão no player, e qualquer teste de carga |
| 17. Modernização da interface | **Parcial** | Painel novo com a identidade visual do projeto, estados de carregamento, vazios e de erro, confirmações, avisos, operação por teclado e rótulos para leitores de tela. **Não validado:** telas pequenas, leitores de tela reais e controle remoto de TV. Dark mode: Fase 6 |

### 3.6 Seção 18: as 25 áreas de teste

| Situação | Áreas |
| --- | --- |
| **Coberto** | 1 Autenticação, 2 Sessões, 3 Permissões, 4 Unidade e setor, 5 Estrutura de pastas, 6 Biblioteca, 7 Playlists, 8 Programação, 12 Upload, 13 Validação de arquivos, 18 Cadastro de TVs, 19 Pareamento, 23 Auditoria, 24 Migração SQLite |
| **Parcial** | 9 Carrossel e 20 Reprodução (o player existente, no Chromium, não em TVs); 10 Duração individual e 11 Transições (gravadas, validadas e entregues, mas não executadas na TV); 21 Reconexão (a autorização do player expira em 60 s sem rede, e só); 22 Monitoramento (online e offline); 25 Compatibilidade com Node.js (Node 22.22.0, não o 24) |
| **Não coberto** | 14 Conversões, 15 Recuperação de senha, 16 Aprovação administrativa, 17 Dark mode |

O requisito pede também testes de acesso não autorizado e de regressão: ambos fazem parte da suíte (veja a seção "Onde estavam os 25 testes da versão 1.1.0" em [VALIDACAO.md](VALIDACAO.md)). Os testes que exigem aparelhos físicos estão listados como não validados.

### 3.7 Seções 19 e 20

A **Fase 1** do plano (análise integral, biblioteca hierárquica, separação entre playlist e programação, perfis Gestor e Editor, permissões granulares e migrações) está concluída. As **Fases 2 a 7** não foram iniciadas. Uma parte do que o plano coloca nas Fases 4 e 6 foi adiantada porque a nova biblioteca e o novo painel dependiam dela: a janela de envio e as miniaturas (Fase 4) e a operação por teclado (Fase 6). Isso não encerra aquelas fases.

## 4. Entregáveis da seção 20

| Item pedido | Onde está |
| --- | --- |
| 1. Código-fonte atualizado | O ZIP completo, pronto para extrair e executar |
| 2 e 3. Arquivos modificados e novos | [ARQUIVOS-DA-FASE-1.md](ARQUIVOS-DA-FASE-1.md): 164 arquivos novos, 19 arquivos modificados, 6 arquivos removidos e 18 arquivos inalterados em relação à 1.1.0 |
| 4. Migrações necessárias | 6 migrações automáticas, descritas em [MIGRACOES.md](MIGRACOES.md) |
| 5 e 6. Testes implementados e resultados | 224 testes automatizados e 8 cenários em navegador (81 etapas), com os resultados e as limitações em [VALIDACAO.md](VALIDACAO.md) |
| 7. Executar localmente | [README.md](../README.md) e [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md) |
| 8. Deploy no Render | Seção 2 de [IMPLANTACAO.md](IMPLANTACAO.md) |
| 9. Documentação das funcionalidades | [FUNCIONALIDADES.md](FUNCIONALIDADES.md), [PERMISSOES.md](PERMISSOES.md), [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md) e [FORMATOS.md](FORMATOS.md) |
| 10. Riscos técnicos | Seção 7 deste relatório |
| 11. Limitações conhecidas | Seção 8 deste relatório |
| 12. Alterações de segurança | Seção 6 deste relatório e [SEGURANCA.md](SEGURANCA.md) |
| 13. Compatibilidade com versões anteriores | Seção 9 deste relatório e [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md) |

Os entregáveis do **fim do projeto** estão assim: a matriz consolidada de permissões já existe ([PERMISSOES.md](PERMISSOES.md)) e vale para a Fase 1; a documentação da arquitetura está em [ARQUITETURA.md](ARQUITETURA.md); os procedimentos de backup e de implantação no servidor corporativo estão em [IMPLANTACAO.md](IMPLANTACAO.md), ainda não executados; a **matriz de compatibilidade de televisores não existe**, porque nenhuma televisão foi testada; e o **relatório técnico final de aderência à ISO 27001 e ao VDA ISA/TISAX** só pode ser feito com o projeto completo (o ponto de partida é [SEGURANCA.md](SEGURANCA.md)).

## 5. Critérios de aceitação (seção 21)

| Critério | Situação nesta fase | Evidência e ressalva |
| --- | --- | --- |
| As funcionalidades existentes continuam operacionais | Atendido, com as mudanças documentadas | Cada teste da 1.1.0 foi mantido ou substituído (mapa em [VALIDACAO.md](VALIDACAO.md)). Mudanças de API e de permissão em [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md). O modo demonstração do painel antigo, que não podia ser ligado, não foi portado |
| As novas funcionalidades estão integradas | Atendido para o escopo da Fase 1 | Cenários em navegador percorrem biblioteca, playlists, programações, telas, usuários, auditoria e configurações |
| As autorizações são verificadas no servidor | Atendido | `tests/permissions.test.mjs` tenta cada operação com cada perfil, escopo parcial e outra unidade ou setor |
| As migrações preservam os dados | Atendido em teste | Banco gerado pelo código da 1.1.0 e volume sintético. **Não** testado no seu banco real |
| O player executa corretamente as programações | Parcial | O player da 1.1.0 (inalterado) cumpre a programação no teste de ponta a ponta com o servidor real, em Chromium. **Nenhuma TV real foi usada** |
| O sistema trata falhas de conexão | Parcial | A autorização do player vence em 60 s sem contato com o servidor e o conteúdo é retirado da tela. Reconexão e recuperação mais completas são a Fase 2 |
| Os testes automatizados relevantes foram aprovados | Atendido no ambiente descrito | Node 22.22.0 em Linux; **Node 24 e Windows não foram usados** |
| Riscos e limitações estão documentados | Atendido | Seções 7 e 8 deste relatório |
| A plataforma permanece compatível com o servidor corporativo | Preparada, não validada | Sem dependências, configuração por variáveis, HTTPS por proxy; procedimento em [IMPLANTACAO.md](IMPLANTACAO.md) **não executado** |
| Os recursos dependentes de fabricantes foram homologados nos aparelhos disponíveis | **Não atendido** | Nenhum aparelho foi usado. Fases 3 e 7 |

## 6. Alterações de segurança

Novas ou reforçadas em relação à 1.1.0:

- **Autorização em um só lugar.** Toda operação passa por `authorize`, que exige a permissão **e** o escopo (unidade e setor do recurso). Um teste varre as rotas para garantir que nenhuma ficou aberta e que toda alteração exige o token CSRF.
- **Permissões individuais com proteção contra escalada de privilégio.** Quem não é Administrador só concede o que possui; `settings:manage` nunca é concedida; o Gestor só gerencia Editores e Visualizadores do próprio escopo; sempre existe ao menos um Administrador ativo.
- **Regras também no banco.** Gatilhos e restrições impedem ciclos de pastas, mudança de espaço de uma pasta ou arquivo e alteração de versões publicadas, mesmo para quem escreva direto em SQL.
- **TV com acesso mínimo.** Além do token individual (guardado como hash), a TV só baixa arquivo aprovado, da própria unidade e setor, que esteja numa programação ativa para ela naquele instante.
- **Proxy reverso tratado explicitamente** (`TRUST_PROXY`), em vez de confiar no endereço da conexão ou, pior, em qualquer `X-Forwarded-For`.
- **Cookie `Secure` e HSTS** acompanham a origem HTTPS, inclusive em homologação.
- **Entradas hostis:** endereços malformados, corpos fora do tipo ou do tamanho, nomes com caracteres de controle e arquivos cuja assinatura não confirma a extensão são recusados sem erro interno.
- **Auditoria:** eventos novos com unidade e setor, consulta por escopo (`audit:read`), cadeia de hashes mantida e conferível, sem registrar senhas, tokens nem o texto digitado por engano no campo e-mail.
- **Registro técnico em JSON,** sem senhas, tokens, cookies nem corpos de requisição; falhas internas devolvem mensagem genérica.
- **Configuração validada na inicialização,** com falha clara; o administrador de homologação (`TEST_ADMIN_*`) só existe com `NODE_ENV=development`.
- **Migrações com backup verificado,** tudo-ou-nada e conferência de integridade; recusa de banco de versão mais nova.
- **Verificações automáticas de higiene:** nenhuma credencial no código, na documentação ou nos exemplos; sem `eval`, `new Function`, shell nem aleatoriedade fraca; `.env`, `data/` e backups fora do repositório e da imagem.
- **Painel sem HTML montado por texto:** nomes de arquivos, playlists e pessoas aparecem sempre como texto, e a política de segurança de conteúdo continua proibindo scripts em linha.

**Mantido sem enfraquecer:** scrypt e o mesmo formato de hash (as senhas atuais continuam válidas), sessão de 8 horas, CSRF, limite de tentativas de login, pareamento, política de antivírus (em produção só chega à TV o que foi verificado), CSP e neutralização de fórmulas na exportação CSV.

## 7. Riscos técnicos

| Risco | Efeito possível | O que fazer |
| --- | --- | --- |
| Validação no Node 22; o projeto pede o 24 e usa o `node:sqlite`, um módulo recente do Node que, conforme a versão, ainda emite aviso de recurso experimental | Diferença de comportamento ou de aviso entre as versões | Rodar `npm run check` e `npm test` no Node 24.19.0 antes de qualquer outra coisa. No Render, fixar `NODE_VERSION` (o `engines` só tem limite inferior) |
| Migração testada com banco gerado e volume sintético, não com o banco real | Dado inesperado no banco real | Ensaiar numa cópia; guardar o backup automático |
| Processo único com SQLite em disco local | Sem alta disponibilidade; um disco perdido é um banco perdido | Backups agendados e copiados para fora; ver [IMPLANTACAO.md](IMPLANTACAO.md) |
| Arquivos enviados ficam inteiros na memória durante o envio; sem pasta temporária | Várias cargas grandes ao mesmo tempo consomem memória; queda no meio do envio pode deixar arquivo órfão | Manter `MAX_UPLOAD_MB` baixo; monitorar memória; rotina de limpeza na Fase 7 |
| Limitador de tentativas na memória do processo | Zera ao reiniciar; não vale entre processos | Limite adicional no proxy ou firewall |
| Antivírus externo, só testado com um programa simulado | Falha de configuração deixaria arquivo sem varredura em desenvolvimento; em produção o arquivo é bloqueado | Instalar, atualizar e testar o antivírus escolhido; testar a falha segura |
| Autenticação local, sem MFA nem SSO; sem troca da própria senha | Senha inicial conhecida por quem cria a conta | Entregar a senha inicial por canal seguro; Fase 5 e integração com a identidade corporativa |
| Sem segregação entre quem envia e quem aprova | A mesma pessoa pode enviar e aprovar um arquivo | Definir a política; implementar se for exigida |
| Auditoria encadeada por hash não é prova de imutabilidade | Quem controla o servidor pode reescrever o histórico | Enviar os eventos a um destino independente |
| Transições gravadas, mas não aplicadas pelo player | Expectativa de efeito visual que ainda não existe | Fase 2; avisado em [FORMATOS.md](FORMATOS.md) e na própria tela da playlist |
| Nenhuma TV testada | Qualquer promessa de compatibilidade seria infundada | Fases 3 e 7, com aparelhos reais |
| Render com disco efêmero | A cada publicação o banco recomeça vazio | Usar o Render só para testes, nunca como armazenamento |

## 8. Limitações conhecidas

- **Funcionalidades que não existem ainda:** tudo das Fases 2 a 7 (seção 3 acima).
- **O fluxo de pareamento da seção 10 está invertido** em relação ao requisito (o painel gera o código, a TV o digita).
- **Senha inicial:** quem cria uma conta define a senha inicial e, portanto, a conhece. Não há troca da própria senha.
- **Identificação de autoria na tela:** a tela mostra datas e responsáveis nos eventos de auditoria, mas os cartões de arquivos, playlists e programações ainda não exibem por nome quem criou ou publicou (o identificador está no registro).
- **Auditoria:** busca e categoria filtram os eventos já carregados na tela; o período carrega o que falta (até 2.000 eventos); a exportação em CSV traz até 10.000 eventos; os eventos gravados pela 1.1.0 não têm unidade nem setor e só o Administrador os vê; a tela não verifica a cadeia de hashes (use `npm run audit:verify`).
- **Unidades e setores não podem ser excluídos** (só renomeados), para preservar o histórico.
- **Escopo por combinação de listas** de unidades e setores; não há escopo por par específico nem por pasta.
- **Miniaturas** são geradas no navegador de quem olha; o servidor não gera miniaturas.
- **Prévia de PDF** usa o visualizador do navegador num quadro, sem isolamento adicional.
- **Banco e mídias no mesmo servidor,** sem armazenamento de objetos e sem fila de tarefas.
- **A pasta `.git` e a pasta `data/` do ZIP original não foram copiadas** para este pacote (a primeira é o histórico do seu repositório; a segunda, dados de execução). Aplique este pacote numa **ramificação** do seu repositório, como descrito em [IMPLANTACAO.md](IMPLANTACAO.md). O repositório da 1.1.0 traz, em `data/media/`, um PDF de teste que já está versionado: o novo `.gitignore` impede que dados de execução entrem no repositório daqui em diante, mas não remove o que já foi versionado. Avalie tirá-lo do controle de versão (`git rm --cached`).

## 9. Compatibilidade com a versão 1.1.0

- **Dados:** contas, senhas, mídias, TVs já pareadas (as credenciais continuam valendo), publicações (viram playlist com versão 1 mais programação, mantendo o identificador) e a trilha de auditoria (mesmo conteúdo e mesmos hashes) são migrados sem perda. Os arquivos de mídia não são tocados e a tabela antiga `records` permanece, intacta, no banco.
- **Player:** `player.js`, `player.html` e `player.css` são idênticos aos da 1.1.0. O manifesto tem o mesmo formato, com dois campos a mais (`transition` e `transitionMs`), que o player atual ignora.
- **API:** as rotas de entrada, sessão, arquivos e pareamento mantêm o contrato. Mudaram, de forma deliberada, `GET /api/state`, `POST` e `DELETE` de `/api/playlists`, o formato da resposta de TV e alguns eventos da auditoria. A tabela completa, com como se adaptar, está em [API-E-COMPATIBILIDADE.md](API-E-COMPATIBILIDADE.md). Não existe camada que finja a API antiga.
- **Permissões:** as contas existentes são migradas **sem ganhar poderes**: o Gestor da 1.1.0 continua sem gerenciar usuários, sem ver a auditoria e sem mexer em TVs, e o Editor continua sem cadastrar TVs, até o Administrador liberar cada capacidade. Para contas criadas na 2.0, o Gestor passa a criar Editores e Visualizadores do próprio escopo, e Editor e Gestor passam a cadastrar TVs, como o requisito pede.
- **Telas do painel:** "Conteúdos" passou a se chamar "Biblioteca" e ganhou pastas; o que era "publicar uma playlist" agora são dois passos, **Playlists** (o que passa) e **Programações** (quando e onde); "Usuários e acessos" passou a se chamar "Usuários".
- **Para voltar atrás:** pare o servidor, restaure o backup `tvcorp-antes-da-migracao-…` (ou a cópia de `data/` feita antes) e use os arquivos da 1.1.0. Não abra um banco já migrado com a 1.1.0.

## 10. Próximos passos e decisões que dependem de você

Ordem sugerida, seguindo o plano do documento de requisitos:

| Fase | Pode ser testada sem televisão? | Depende de |
| --- | --- | --- |
| 2. Carrossel e reprodução | Em grande parte, no Chromium; o efeito em cada TV exige aparelho | Nada externo |
| 3. Player Universal | Só o núcleo e o diagnóstico; a compatibilidade exige aparelhos | Modelos, anos e sistemas das televisões disponíveis |
| 4. Mídias e upload | Em grande parte | Programas conversores no servidor; licenças e credenciais do Power BI e, se for o caso, do Canva |
| 5. Senha e usuários | Sim, com um servidor de e-mail de teste | Serviço de e-mail (SMTP) da empresa |
| 6. Interface | Sim, no Chromium | Nada externo |
| 7. Qualidade e infraestrutura | Parcialmente | Servidor da empresa e aparelhos reais |

Decisões que são suas:

1. **Modo demonstração do painel.** Voltar ou não (veja a seção 3.1).
2. **Quatro olhos.** A empresa exige que quem envia um arquivo não seja quem o aprova? Se sim, a regra precisa ser implementada.
3. **Televisões.** Quais modelos e sistemas existem de fato nas unidades, para planejar a Fase 3.
4. **E-mail.** Qual serviço de envio será usado na recuperação de senha (Fase 5).
