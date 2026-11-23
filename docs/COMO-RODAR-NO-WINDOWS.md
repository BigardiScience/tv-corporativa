# Como rodar a TV Corporativa no Windows

Este guia coloca a aplicação para funcionar no próprio computador. O administrador TI cria o primeiro acesso; depois disso, os demais usuários entram com contas criadas pela administração. Não existe cadastro aberto nem senha padrão.

> **Já usa a versão anterior e quer manter os dados?** Não extraia esta versão por cima da pasta antiga nem apague nada. Leia antes [MIGRACOES.md](MIGRACOES.md): o banco é atualizado automaticamente, com backup, mas vale ensaiar em uma cópia.

## 1. Preparar os programas

Você precisa do **Node.js 24 ou superior** e do **Visual Studio Code**. Se ainda não estiverem instalados, solicite a instalação à TI pelos canais oficiais da empresa. Não é preciso instalar banco de dados separado ou executar `npm install`: o projeto usa os recursos nativos do Node.

Depois de instalar o Node, feche e abra novamente o VS Code para que ele reconheça o programa.

## 2. Extrair e abrir a pasta certa

1. Se recebeu um arquivo ZIP, clique com o botão direito nele e escolha **Extrair Tudo**. Extraia para uma pasta de trabalho, por exemplo `C:\Projetos\TV-Corporativa`.
2. Abra a pasta extraída. Procure o arquivo **`package.json`**. A pasta que contém esse arquivo é a raiz do projeto. Se houver outra pasta `tv-corporativa` dentro da pasta extraída, entre nela.
3. Abra o VS Code e escolha **Arquivo → Abrir Espaço de Trabalho do Arquivo**; selecione **`TV-Corporativa.code-workspace`**. Como alternativa, use **Arquivo → Abrir Pasta** e selecione a pasta que contém `package.json`.
4. No menu do VS Code, clique em **Terminal → Novo Terminal**.

Não abra apenas `public/index.html` com duplo clique nem use uma extensão de servidor estático para executar o projeto. O login e as funções administrativas precisam do servidor Node.

## 3. Conferir o terminal

Digite os comandos abaixo, pressionando Enter ao final de cada linha:

```powershell
node --version
npm.cmd --version
Get-Location
Test-Path .\package.json
```

O primeiro comando deve mostrar uma versão que comece com `v24` ou superior. O último deve mostrar **`True`**.

Se o último mostrar `False`, entre na pasta correta. Exemplo — substitua o caminho pelo local onde extraiu o projeto:

```powershell
Set-Location -LiteralPath 'C:\Projetos\TV-Corporativa\tv-corporativa'
Test-Path .\package.json
```

O guia utiliza **`npm.cmd`** para funcionar no PowerShell sem alterar a política de execução de scripts do Windows. Se `npm` mostrar que `npm.ps1` está bloqueado, utilize `npm.cmd`; não é necessário desativar proteções do computador.

## 4. Criar o primeiro administrador — somente uma vez

Com o servidor ainda parado, execute:

```powershell
npm.cmd run configure
```

O assistente pedirá:

1. Seu nome.
2. Seu e-mail corporativo.
3. Uma senha entre 12 e 128 caracteres.
4. A confirmação da mesma senha.

Ao digitar a senha, ela não aparece no terminal. Isso é normal. Digite e pressione Enter. Utilize uma senha exclusiva e guarde-a no cofre autorizado pela empresa.

Ao terminar, o terminal informa que o administrador foi criado. Se aparecer **“Um administrador já existe”**, não execute uma nova configuração: entre com a conta existente ou utilize o procedimento de recuperação da TI descrito abaixo.

Este comando é reservado ao responsável local pelo servidor. Ele não oferece autocadastro a visitantes do site.

## 5. Iniciar o site

Execute:

```powershell
npm.cmd start
```

O servidor escreve linhas de registro em JSON. Na primeira vez, aparecem as linhas `Aplicando migração 1` até `Aplicando migração 8` (é a criação do banco; quem atualiza da Fase 2 vê somente a migração 8). A linha que importa é a última, parecida com esta (os valores de `dados`, `banco` e `midias` mostram as pastas do seu computador):

```text
{"time":"…","level":"info","message":"TV Corporativa 2.4.0 em http://127.0.0.1:4173","modo":"local",…,"esquema":8}
```

Dependendo da versão do Node, aparece também o aviso `ExperimentalWarning: SQLite is an experimental feature` (e, se não houver arquivo `.env`, a mensagem `.env not found. Continuing without it.`). Ambos são esperados e inofensivos.

Deixe esse terminal aberto. Abra o navegador e acesse:

**[http://127.0.0.1:4173](http://127.0.0.1:4173)**

Você verá a tela de login. Entre com o e-mail e a senha criados no passo anterior. No primeiro acesso não haverá TVs, arquivos ou programações cadastrados. Isso é esperado.

As unidades **Unidade Centro**, **Unidade Leste**, **Vila Norte** e **Unidade Oeste**, e os setores **RH**, **TI**, **SEGURANÇA DO TRABALHO** e **TESTE**, já estarão disponíveis.

Para parar o servidor, volte ao terminal e pressione **Ctrl+C**. Para iniciar novamente em outro dia, abra o projeto e execute `npm.cmd start`. Não é necessário recriar o administrador.

## 6. Criar contas para a equipe

Esta etapa é exclusiva do **Administrador TI**.

1. Entre no painel e abra **Usuários**, no menu **Administração**.
2. Clique em **Novo usuário**.
3. Informe o nome, o e-mail (que será o login e não muda depois) e a senha inicial. Há um gerador de senha; a senha deve ter de 12 a 128 caracteres.
4. Selecione o perfil adequado:

| Perfil | Responsabilidade |
| --- | --- |
| Administrador TI | Gestão global, usuários, permissões, senhas, unidades e setores, TVs |
| Gestor | Aprova conteúdo e publica playlists e programações no próprio escopo e em TVs autorizadas; gera o código de pareamento dessas TVs |
| Editor | Envia conteúdo, organiza pastas, monta playlists em rascunho, cria e publica programações e gera o código de pareamento das TVs autorizadas (não aprova arquivos nem publica versões de playlist) |
| Visualizador | Consulta no escopo autorizado |

5. Selecione as **unidades e setores autorizados**. Se necessário, ajuste as **permissões individuais** (cada permissão mostra se é padrão do perfil, concedida ou retirada) e clique em **Criar usuário**.
6. Entregue as credenciais à pessoa por um canal seguro aprovado pela TI.

Administrador TI tem acesso global. Nos demais perfis, as listas de unidades e setores autorizam todas as combinações entre os itens selecionados. Por exemplo, duas unidades e dois setores dão acesso àqueles dois setores nas duas unidades. A matriz completa de permissões está em [PERMISSOES.md](PERMISSOES.md).

Não há convite por e-mail ou entrega automática de senha nesta versão. A plataforma não obriga troca de senha no primeiro login nem permite que a pessoa troque a própria senha; esse processo deve ser controlado pela TI ou por uma integração de identidade corporativa, que não existe nesta versão.

## 7. Alterar permissões, suspender acesso ou redefinir senha

Entre com um administrador, abra **Usuários** e localize a pessoa (há busca e filtros por perfil e situação).

- Para ajustar o acesso, use a ação de edição e altere perfil, unidades, setores ou permissões individuais. **Restaurar o padrão do perfil** desfaz as personalizações.
- Para suspender o acesso, desmarque **Conta ativa** e salve. O histórico é mantido.
- Para redefinir uma senha (somente o Administrador), use **Redefinir senha**, informe e confirme a nova senha e conclua.

Alterações de usuário e redefinições encerram as sessões dessa conta. A pessoa precisará entrar novamente. A redefinição gera registro de auditoria sem armazenar a senha nesse registro.

Gestores, Editores e Visualizadores não têm acesso à gestão de usuários. O sistema impede desativar ou rebaixar o último administrador ativo.

## 8. Recuperar acesso do administrador

Se outro administrador ainda consegue entrar, ele pode redefinir a senha pelo painel. Se nenhum administrador consegue entrar, a TI com acesso ao computador servidor pode executar a recuperação local:

1. Pare o servidor com **Ctrl+C**.
2. No terminal da raiz do projeto, execute:

```powershell
npm.cmd run reset-admin
```

3. Siga as perguntas do assistente para identificar a conta administrativa e definir uma nova senha.
4. Inicie novamente com `npm.cmd start` e entre com a senha nova.

Esse comando não é um link público de “esqueci minha senha”. Ele exige acesso local ao servidor e deve ser usado somente pela TI responsável. Não apague `data/` para recuperar uma conta: isso eliminaria também os registros, arquivos e programações do ambiente.

## 9. Do arquivo até a primeira TV

1. Escolha a unidade e o setor de trabalho no seletor do alto do menu.
2. Em **Biblioteca**, crie uma pasta (**Nova pasta**) e clique em **Enviar arquivos**. Envie PNG, JPG, JPEG, WebP, PDF, MP4, MOV ou WebM exportado da ferramenta de origem.
3. Um Gestor ou Administrador revisa e **aprova** o arquivo. No ambiente local sem antivírus, será solicitada ciência explícita sobre a ausência de varredura antimalware.
4. Em **Playlists**, clique em **Nova playlist**, use **Adicionar da biblioteca** e ajuste ordem, duração (em vídeo, *tempo definido* ou *até o fim do vídeo*), transição (**Ver efeito** mostra cada uma) e **Repetir a playlist continuamente**. Use **Pré-visualizar** para ver a sequência como a TV vai exibi-la e clique em **Publicar versão**.
5. Como Administrador, em **Telas → Cadastrar TV**, informe nome e unidade, escolha setores e pessoas em **Quem pode publicar nesta TV?** e anote o código de pareamento (seis dígitos, válido por 10 minutos). TVs antigas aguardando ativação são ativadas somente pelo Administrador. Depois, Editor e Gestor com acesso à TV também podem gerar um novo código em **Telas → Código de pareamento**, sem desconectar a TV.
6. No dispositivo da TV, abra o endereço do player e informe o código.
7. Em **Programações**, clique em **Nova programação**, escolha a playlist publicada e a TV, defina o período e use **Publicar agora**. Administrador, Gestor e Editor (este, só nas TVs que a TI liberou para ele) criam e publicam programações, e a programação só aceita playlists que já têm versão publicada por um Gestor ou pela TI. Para quem deve só preparar rascunhos, a TI retira a permissão de publicar em **Usuários**.

Para um teste no mesmo computador, use **[http://127.0.0.1:4173/player.html](http://127.0.0.1:4173/player.html)** em outra janela (o endereço com `?demo=1` mostra o player em demonstração, sem servidor e sem código). Uma TV de outro computador **não** acessa o seu servidor por `127.0.0.1`; esse endereço sempre aponta para o próprio aparelho.

Acesso de TVs da rede exige implantação pela TI com endereço interno, HTTPS, firewall, antivírus e demais controles de [SEGURANCA.md](SEGURANCA.md) e [IMPLANTACAO.md](IMPLANTACAO.md). Não basta compartilhar o endereço local ou trocar a variável `HOST`. Cada tela do painel está explicada em [FUNCIONALIDADES.md](FUNCIONALIDADES.md).

Para compartilhar a mesma TV entre RH e TI, conferir a fila e testar som, siga [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

## 10. Rodar os testes (opcional)

```powershell
npm.cmd run check
npm.cmd test
```

`check` verifica a sintaxe dos arquivos e `test` executa os testes automatizados do servidor, do painel e do player (nenhum pacote extra é necessário). Os testes que abrem um navegador de verdade (`npm.cmd run test:e2e`) exigem instalar o Playwright à parte e **não** fazem parte da instalação normal; veja [VALIDACAO.md](VALIDACAO.md).

## Alternativas sem digitar os comandos

No VS Code, use **Terminal → Executar Tarefa** e escolha a tarefa TV Corporativa correspondente. As tarefas executam o Node diretamente.

Também é possível abrir estes arquivos na raiz do projeto:

| Arquivo | Quando utilizar |
| --- | --- |
| `01-configurar-administrador.cmd` | Primeira configuração, uma única vez |
| `02-iniciar-plataforma.cmd` | Iniciar o servidor e manter sua janela aberta |
| `03-recuperar-administrador.cmd` | Recuperação local de senha pela TI |

Os atalhos não mudam políticas de segurança do Windows e não possuem credenciais gravadas. Não utilize atalhos e terminal ao mesmo tempo para iniciar duas cópias na mesma porta.

## Problemas comuns

| Mensagem ou situação | Como resolver |
| --- | --- |
| `node` não é reconhecido | Confirme instalação do Node 24+ e reabra o VS Code. |
| `npm.ps1` bloqueado | Execute `npm.cmd` ou use uma tarefa pronta do VS Code. |
| `package.json` não encontrado | Confira a pasta com `Get-Location` e entre na raiz correta. |
| Porta em uso / `EADDRINUSE` | Verifique se o projeto já está aberto em outro terminal; use a instância existente ou encerre a sua instância anterior. |
| O site não abre | Confira se `npm.cmd start` continua executando sem erro e use o endereço exato mostrado. |
| Usuário ou senha inválidos | Use a conta criada no assistente; não existe senha padrão. Para recuperação, acione o administrador TI. |
| Muitas tentativas (erro 429) | Aguarde 15 minutos e confirme as credenciais com a TI. |
| Alterei meu acesso e fui desconectado | Entre novamente; as sessões são encerradas após alteração de conta. |
| Não vejo um botão ou recebo "Permissão negada" | O perfil ou as permissões individuais não incluem a ação. Veja **O que o meu acesso permite** no menu da conta e fale com o Gestor ou a TI. |
| Não consigo parear a TV | O código vale 10 minutos, só uma vez, e é substituído quando outro é gerado; gere outro em **Telas** (Administrador, ou Editor e Gestor com acesso à TV). TV *Aguardando ativação* precisa ser ativada antes pelo Administrador. |
| O servidor recusa iniciar citando o banco ou uma migração | Não apague `data/`. Veja [MIGRACOES.md](MIGRACOES.md): o backup anterior à migração está em `data\backups\`. |
| Arquivo Office foi recusado | Exporte para imagem, vídeo ou PDF; renomear a extensão não converte o arquivo. |
| Um MOV ou JPEG foi recusado | Leia a mensagem: arquivo incompleto ou corrompido, MOV sem imagem ou com codec que o sistema não aceita (só H.264 e HEVC; o sistema não converte vídeo). Exporte de novo e envie outra vez. |
| Produção exige HTTPS/antivírus | Complete as configurações corporativas com a TI. Não contorne o bloqueio para operar com dados reais. |

Os dados persistidos ficam em `data/` por padrão. Preserve essa pasta e mantenha backups conforme a política da empresa (`npm.cmd run backup`). Não compartilhe o diretório de dados, `.env` ou credenciais dentro de um ZIP do código.
