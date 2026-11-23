# Implantação: local, homologação no Render e servidor corporativo

> Atualização 2.4.0: a TV pode tocar vídeo direto do servidor por um link temporário assinado. Para quem opera o proxy reverso: o proxy precisa repassar `Range` e a parte da consulta do endereço, e o `access.log` passa a registrar esse link (veja o fim da seção 3.1 e a seção 3.4). Detalhes em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md).
>
> Atualização 2.3.0: o Editor passa a criar e publicar programações nas TVs que a TI liberou para ele. Da 2.2.0 continuam valendo o envio de MOV e JPEG e o código de pareamento para Editor e Gestor. Cadastro de TVs, acessos, ordem global e usuários continuam exclusivos do Administrador. Detalhes em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md) e [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as TVs compartilhadas da 2.1.0 estão em [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

Este guia cobre os três ambientes da TV Corporativa e as variáveis de configuração. A aplicação roda do mesmo jeito nos três; o que muda é a configuração e quem opera.

> **O que foi e o que não foi validado.** Os procedimentos de **Render** e de **servidor corporativo** abaixo foram escritos a partir do comportamento do código (testado) e da documentação oficial do Render, mas **não foram executados** a partir do ambiente em que este trabalho foi feito: não houve acesso ao Render, ao seu servidor, a um proxy reverso real, a um antivírus real, a Node 24 nem a um daemon Docker. Trate-os como roteiro a ser validado por quem opera cada ambiente. Os trechos de configuração marcados como "exemplo" são ilustrativos.

| Ambiente | Para quê | Dados |
| --- | --- | --- |
| **Local** (seu computador) | Desenvolvimento e primeiros testes | `data/` na pasta do projeto |
| **Render** | Apenas **homologação** preliminar | **Efêmeros**: somem a cada reinício/publicação (disco temporário) |
| **Servidor corporativo** | Produção | Disco persistente, com backup e HTTPS |

Requisito de execução: **Node.js 24 ou superior**. Não há dependências npm para instalar.

## Variáveis de ambiente

Todas são opcionais em ambiente local. Em um arquivo `.env` (copie de `.env.example`; ele nunca vai para o repositório) ou no painel do serviço de hospedagem. **Nunca coloque senhas ou tokens no código nem no `.env.example`.**

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `NODE_ENV` | vazio (modo local) | `production` ativa as exigências de produção (HTTPS, antivírus, cookie `Secure`, HSTS). `development` é o modo de **homologação**. |
| `HOST` | `127.0.0.1` | Endereço de escuta. Para receber conexões de fora do computador use `0.0.0.0` (ou o endereço da placa de rede). Em produção, mantenha o servidor atrás de um proxy reverso. |
| `PORT` | `4173` | Porta de escuta (o Render informa a dele, normalmente 10000). |
| `APP_ORIGIN` | `http://127.0.0.1:<PORT>` | Endereço público **exato**, sem barra no final (ex.: `https://tv.suaempresa.com.br`). Define a origem aceita nas alterações (CSRF) e se o cookie é `Secure`. |
| `DATA_DIR` | `./data` | Pasta-base dos dados. Banco, mídias e backups ficam dentro dela, a menos que as três variáveis abaixo sejam usadas. |
| `DB_PATH` | `<DATA_DIR>/tvcorp.sqlite` | Arquivo do banco SQLite. |
| `MEDIA_DIR` | `<DATA_DIR>/media` | Arquivos de mídia enviados. |
| `BACKUP_DIR` | `<DATA_DIR>/backups` | Backups automáticos de migração e do `npm run backup`. |
| `SETUP_TOKEN` | vazio | Token aleatório (≥ 32 caracteres) que habilita a rota `POST /api/setup` para criar o primeiro administrador, **somente em requisições feitas no próprio servidor**. O painel não tem tela para isso: o caminho recomendado é `npm run configure`. Remova o token depois do uso. |
| `MALWARE_SCANNER` | vazio | Caminho de um antivírus compatível com `clamscan` (recebe `--no-summary --infected <arquivo>`; saída 0 = limpo). **Obrigatório em produção.** |
| `MAX_UPLOAD_MB` | `50` | Tamanho máximo de upload, de 1 a 250. |
| `PLAYLIST_MAX_ITEMS` | `6` | Máximo de conteúdos por playlist, de 1 a 15. Playlists antigas maiores continuam funcionando, mas não podem crescer. |
| `TRUST_PROXY` | `false` | Quantos proxies reversos **confiáveis** existem na frente (`false` = nenhum, `true` = 1, ou 1 a 5). O servidor lê o endereço do cliente no cabeçalho `X-Forwarded-For` contando **da direita**. Errar isso faz todos parecerem ter o mesmo endereço (ou deixa forjar o endereço): ajuste com cuidado. |
| `TEST_ADMIN_NAME` | vazio | **Somente homologação:** nome do administrador criado automaticamente. |
| `TEST_ADMIN_EMAIL` | vazio | **Somente homologação:** e-mail desse administrador. |
| `TEST_ADMIN_PASSWORD` | vazio | **Somente homologação:** senha desse administrador (12 a 128 caracteres). Defina **só no painel da hospedagem**. |

Regras que o servidor impõe ao iniciar (ele recusa iniciar, com mensagem clara, se alguma for violada):

- `NODE_ENV=production` exige `APP_ORIGIN` com `https://` **e** `MALWARE_SCANNER`.
- `APP_ORIGIN` deve ser `http(s)://host[:porta]`, sem caminho nem barra final.
- `MAX_UPLOAD_MB` entre 1 e 250; `PLAYLIST_MAX_ITEMS` entre 1 e 15; `TRUST_PROXY` com valor válido.
- `TEST_ADMIN_*` só valem com `NODE_ENV=development` e enquanto **não existe nenhum administrador**; em qualquer outro caso são ignoradas.

Onde ficam as coisas (requisito de separar banco, mídias, temporários, logs e backups):

| O quê | Onde | Variável |
| --- | --- | --- |
| Banco de dados | `DB_PATH` (SQLite em modo WAL: aparecem também `-wal` e `-shm`) | `DB_PATH` |
| Mídias | `MEDIA_DIR` (nome gerado pelo servidor, fora da pasta pública) | `MEDIA_DIR` |
| Backups | `BACKUP_DIR` | `BACKUP_DIR` |
| Arquivos temporários | Não há pasta de temporários: o arquivo enviado é lido em memória (até `MAX_UPLOAD_MB`), gravado em `MEDIA_DIR` com o nome definitivo, verificado e **removido se reprovado**. Uma queda do processo no meio do envio pode deixar um arquivo sem registro em `MEDIA_DIR` (inofensivo; pode ser apagado depois). | — |
| Logs | Saída padrão do processo, em JSON (uma linha por evento), sem senhas, tokens, cookies nem corpo de requisições. Capture pelo gerenciador do serviço. | — |
| Auditoria | Tabela `audit` do banco (não é arquivo de log). | — |

## 1. Local (Windows)

Passo a passo ilustrado em [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md). Em resumo, na pasta que contém `package.json`:

```powershell
npm.cmd run configure   # cria o primeiro administrador (uma vez)
npm.cmd start           # http://127.0.0.1:4173
```

Ao iniciar, o servidor aplica as migrações pendentes (com backup automático se o banco já tinha dados). Dependendo da versão do Node, aparece o aviso `ExperimentalWarning: SQLite is an experimental feature`: é um aviso do próprio Node sobre o módulo `node:sqlite` e não indica erro.

## 2. Homologação no Render

O Render é usado **somente para teste**. Disco temporário significa que **cada reinício ou nova publicação recomeça com banco vazio**: usuários, arquivos, playlists e programações criados ali se perdem. O administrador é recriado a cada partida a partir das variáveis `TEST_ADMIN_*`. Use apenas dados fictícios.

### 2.1 Preparar o código sem tocar na versão publicada

1. No GitHub (`BigardiScience/TV-Corporativa`), crie uma **branch nova** (por exemplo `fase-2`) e coloque nela o conteúdo do ZIP da 2.0. Não altere a branch que está publicada hoje.
2. No Render, crie um **novo serviço Web** apontando para essa branch (em vez de editar o serviço atual). Assim a versão que está no ar continua intacta e você compara as duas.

Exemplo (ilustrativo; adapte ao seu fluxo):

```powershell
git switch -c fase-2
# substitua o conteúdo da pasta pelo do ZIP da 2.0 (mantendo a pasta .git)
git add -A
git commit -m "TV Corporativa 2.4.0"
git push -u origin fase-2
```

O `.gitignore` já exclui `data/`, `.env*` (menos `.env.example`), `node_modules/` e `*.zip`.

### 2.2 Configurar o serviço

| Campo no Render | Valor |
| --- | --- |
| Tipo / ambiente | Web Service, runtime **Node** (não use o `Dockerfile`: ele define `NODE_ENV=production`, que exige antivírus, e a imagem não o inclui) |
| Branch | a branch criada acima |
| Build Command | `npm install` (não há dependências; termina em segundos. **Não** use `npm ci`: não há `package-lock.json`) |
| Start Command | `npm start` |
| Health Check Path | `/healthz` (o Render considera saudável resposta 2xx/3xx em até 5 s) |
| Instâncias | **1** (SQLite e limites de tentativa ficam no processo; não escale para várias instâncias) |

Variáveis de ambiente do serviço:

| Variável | Valor | Observação |
| --- | --- | --- |
| `NODE_VERSION` | uma versão **24.x exata** (por exemplo a que você usa localmente) | O Render dá prioridade a esta variável sobre `.node-version`, `.nvmrc` e `engines.node`, e pede que intervalos tenham limite superior. O `engines` deste projeto é `>=24.0.0` (sem limite superior): defina a variável para não depender da versão que o Render escolheria. |
| `NODE_ENV` | `development` | Necessário para `TEST_ADMIN_*` e para o modo sem antivírus. É o modo de **homologação**: o painel mostra "Ambiente local". |
| `HOST` | `0.0.0.0` | Para o Render alcançar o processo. |
| `APP_ORIGIN` | `https://<nome-do-serviço>.onrender.com` | Exato, sem barra no final. Com HTTPS, o cookie vira `Secure` e o HSTS é enviado. |
| `TRUST_PROXY` | `1` | O Render coloca um proxy na frente; sem isso o limite de tentativas enxerga o endereço do proxy. |
| `TEST_ADMIN_NAME`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` | definidos **no painel** | Nunca em arquivo versionado. Senha de 12 a 128 caracteres, exclusiva desta homologação. |

`PORT` é fornecida pelo Render (o servidor a lê). Não defina `MALWARE_SCANNER` (não há antivírus no Render): em `development`, arquivos sem varredura exigem confirmação explícita na aprovação.

### 2.3 Conferir depois da publicação

1. Abra `https://<nome-do-serviço>.onrender.com/healthz`: deve responder `{"ok":true,"version":"2.4.0","schema":8}`.
2. Abra a raiz do site: tela de login. Entre com o administrador de `TEST_ADMIN_*`. O rodapé do painel indica "Ambiente local" e a versão.
3. Percorra o fluxo: criar pasta → enviar arquivo → aprovar → montar playlist (tempo, transição e repetição) → **pré-visualizar** → publicar versão → cadastrar TV → pareá-la → criar e publicar programação → conferir o player em `/player.html`.
4. Crie um Gestor e um Editor com escopos diferentes e confira o que cada um enxerga e pode fazer, inclusive programar e gerar o código de pareamento de uma TV autorizada: o Editor cria e publica programações por padrão, e quem deve só preparar rascunhos precisa ter `schedule:publish` retirado (veja [PERMISSOES.md](PERMISSOES.md)). Envie também um arquivo JPEG e um MOV de teste (veja [FORMATOS.md](FORMATOS.md)).

Observações do plano gratuito do Render: o serviço pode "dormir" por inatividade e levar um tempo para voltar (nessa volta, o disco recomeça vazio); o `/healthz` é consultado pelo Render, não substitui monitoramento. Manter dados entre reinícios exigiria um disco persistente pago montado em `DATA_DIR`; mesmo assim, o Render continua sendo ambiente de teste.

## 3. Servidor corporativo (produção)

### 3.1 Arquitetura recomendada

```text
TVs e navegadores ── HTTPS (443) ── proxy reverso (TLS, certificado da empresa)
                                         │  rede privada / 127.0.0.1
                                         └── Node.js (TV Corporativa) ── SQLite + mídias em disco local
                                                                    └── antivírus (clamscan)
```

- **Proxy reverso com TLS** (nginx, Apache, IIS/ARR, HAProxy ou o que a TI padronizar). O Node escuta só em `127.0.0.1` ou em interface privada; a porta do Node **não** é publicada para a rede.
- **DNS corporativo** para o nome público (`APP_ORIGIN=https://tv.suaempresa.com.br`) e **certificado** de uma autoridade que as TVs e os navegadores confiem. Algumas TVs não permitem instalar autoridades certificadoras próprias: confirme antes (a compatibilidade com cada modelo **não foi validada**).
- **Firewall e segmentação:** libere a porta 443 do proxy para as redes dos usuários e das TVs; feche tudo o mais. Mantenha o servidor em rede de servidores, sem exposição direta à internet. Se houver comunicação entre unidades, limite por faixa de endereços.
- **Antivírus** compatível com `clamscan` instalado no servidor, com base de assinaturas atualizada (ex.: ClamAV + `freshclam`), e `MALWARE_SCANNER` apontando para o executável. O servidor chama `clamscan --no-summary --infected <arquivo>`: saída 0 = limpo; qualquer falha reprova o arquivo.
- **Conta de serviço** dedicada, sem privilégios administrativos, com escrita **somente** em `DATA_DIR` (ou nos três caminhos separados) e leitura do código. Criptografia de disco no volume de dados.
- **Relógio** sincronizado (NTP): a auditoria grava horários em UTC.

Exemplo de arquivo de ambiente de produção (ilustrativo; com permissão restrita ao usuário do serviço):

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=4173
APP_ORIGIN=https://tv.suaempresa.com.br
TRUST_PROXY=1
DATA_DIR=/var/lib/tv-corporativa
MALWARE_SCANNER=/usr/bin/clamscan
MAX_UPLOAD_MB=50
```

Exemplo de trecho de proxy nginx (ilustrativo, não executado aqui):

```nginx
server {
  listen 443 ssl;
  server_name tv.suaempresa.com.br;
  # ssl_certificate / ssl_certificate_key: do certificado da empresa
  client_max_body_size 60m;             # um pouco acima de MAX_UPLOAD_MB
  location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 150s;            # o servidor encerra requisições após 150 s
  }
}
```

Com **um** proxy confiável na frente, use `TRUST_PROXY=1`. Se houver mais camadas (balanceador, WAF), use o número exato de camadas **confiáveis**.

**Registro de acessos e o link de vídeo (2.4.0).** Quando uma TV não toca o vídeo baixado, o player pede ao servidor um link temporário e o navegador da TV abre `/api/media/<id>/file?t=…`. O servidor não registra URLs, mas o `access.log` padrão do nginx grava o endereço completo, com o `t`. O link vale 6 horas e abre um único vídeo da programação daquela TV; mesmo assim, deixe o registro de acessos com acesso restrito e retenção curta, ou grave o caminho sem a consulta. Exemplo ilustrativo, não executado aqui:

```nginx
# em http { }: o mesmo formato "combined", mas com $uri (caminho sem a consulta) no lugar de $request
log_format sem_consulta '$remote_addr - $remote_user [$time_local] "$request_method $uri $server_protocol" '
                        '$status $body_bytes_sent "$http_user_agent"';

# em server { }
access_log /var/log/nginx/tv-corporativa.access.log sem_consulta;
```

### 3.2 Executar como serviço

Use o gerenciador de serviços padrão da TI para iniciar com o sistema e reiniciar em caso de falha. Exemplo de unidade systemd (Linux; ilustrativo):

```ini
[Unit]
Description=TV Corporativa
After=network.target

[Service]
User=tvcorp
WorkingDirectory=/opt/tv-corporativa
EnvironmentFile=/etc/tv-corporativa.env
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

No Windows Server, use um gerenciador de serviços aprovado pela TI executando `node server/index.mjs` na pasta do projeto, com as variáveis definidas no ambiente do serviço.

O servidor encerra com `SIGTERM`/`SIGINT` fechando as conexões e o banco de forma limpa. Monitore `https://<endereço>/healthz`.

### 3.3 Backup e recuperação

| O quê | Como |
| --- | --- |
| Backup do banco (com o servidor ligado) | `npm run backup` — cópia consistente e verificada em `BACKUP_DIR`. |
| Banco + mídias | `npm run backup -- --media` |
| Reter só os N mais recentes | `npm run backup -- --keep 14` |
| Agendar | Cron / Agendador de Tarefas, diariamente (ou conforme o RPO definido pela empresa). |
| Levar para fora do servidor | **Obrigatório:** um backup no mesmo disco não protege contra falha do disco. Copie, criptografe e guarde conforme a política. |
| Testar a restauração | Periodicamente, em outra máquina. Backup que nunca foi restaurado não é garantia. |

Restaurar: pare o serviço; coloque o arquivo de backup no lugar de `tvcorp.sqlite` (apague os arquivos `-wal` e `-shm` antigos); restaure a pasta de mídias correspondente; inicie; rode `npm run audit:verify` para checar a cadeia de hashes da auditoria. O backup automático `tvcorp-antes-da-migracao-…` é criado antes de cada atualização do esquema (veja [MIGRACOES.md](MIGRACOES.md)).

### 3.4 Atualizar o sistema

1. Backup do banco **e** das mídias; avise os usuários.
2. Ensaie em uma cópia (`npm run migrate` apontando `DATA_DIR` para a cópia).
3. Pare o serviço, substitua o código (mantendo `data/` e o arquivo de ambiente), inicie. O primeiro início migra o banco, com backup automático.
4. Confira `/healthz`, o painel e uma TV de teste. Guarde o backup anterior até validar.

Da 2.3.0 (ou da 2.2.0, ou da 2.1.0) para a 2.4.0 não há migração de banco: o esquema continua na versão 8 e `data/` é reaproveitada como está. Mesmo assim, faça o backup e o ensaio acima antes de trocar o código ([MIGRACOES.md](MIGRACOES.md)). **Atenção:**

- **Recarregue o player em cada TV.** Uma página do player já aberta continua com o código antigo até ser recarregada; só depois disso a TV passa a usar o link de vídeo. Reiniciar o serviço **invalida os links de vídeo emitidos** (a chave de assinatura nasce a cada início): as TVs pedem outro ao carregar o próximo vídeo.
- Quem vem da 2.2.0 ou da 2.1.0: os Editores já cadastrados passam a criar e publicar programações assim que o código novo entra no ar; para quem deve só preparar rascunhos, retire `schedule:publish` em **Usuários** logo depois de atualizar.

### 3.5 Limites e cuidados (leia antes de dimensionar)

- **Processo único e SQLite local.** Não use alta disponibilidade com dois servidores gravando o mesmo banco. **Não coloque `DATA_DIR` em compartilhamento de rede** (SMB/NFS): o modo WAL do SQLite exige disco local.
- Os arquivos enviados são lidos **inteiros em memória** (até `MAX_UPLOAD_MB`) e algumas operações de banco e criptografia são síncronas. **Não houve teste de carga** com muitas TVs ou envios simultâneos: valide o volume real em um piloto.
- Os limites de tentativa de login/pareamento ficam na memória do processo (reiniciar os zera; não são distribuídos).
- O `Dockerfile` (imagem `node:24-alpine`, usuário sem privilégios, `HEALTHCHECK` em `/healthz`) **não foi construído nem executado** aqui. Ele define `NODE_ENV=production`, e a imagem **não traz antivírus**: para usá-la em produção é preciso uma imagem derivada com o antivírus e `MALWARE_SCANNER`, além de volume persistente em `/app/data` e o proxy HTTPS na frente.
- **Dependências de processamento de mídia: nenhuma.** O servidor não usa FFmpeg nem outro analisador ou conversor de vídeo e não precisa de programa algum além do Node.js: os arquivos são guardados e entregues como foram enviados, e a conferência de JPEG e MOV é feita em JavaScript, lendo só a estrutura do arquivo. O único programa externo é o antivírus (`MALWARE_SCANNER`), opcional no modo local e obrigatório em produção, que não vem no projeto.
- **Não existem nesta versão:** SSO/MFA (Microsoft Entra ID), envio de logs a um SIEM, WAF, conversão de vídeo, de PPTX ou de PDF no servidor (e, com ela, o tempo por página de PDF), Power BI, monitoramento de TVs além de "última comunicação" e aplicativos nativos para webOS, Tizen, Android TV ou Roku (o player é uma página que roda no navegador da TV). [RELATORIO-FASE-1.md](RELATORIO-FASE-1.md) e [RELATORIO-FASE-2.md](RELATORIO-FASE-2.md) são relatórios históricos.
- Compatibilidade com **LG webOS, Samsung Tizen e AOC (Android TV/Roku) não foi testada**: nenhuma TV real foi usada. O player (`public/player.html`, com módulos ES em `public/js/`) depende dos recursos do navegador de cada TV. Ele precisa de módulos ES e da sintaxe `?.`/`??`; sem isso o navegador não executa o player. Se faltar `fetch`, `AbortController`, `Headers`, `Blob` ou `URL.createObjectURL`, a tela de pareamento diz qual falta. A API de animações é opcional: sem ela as transições viram corte seco. O player da 1.1.0 usava `AbortSignal.any` e `AbortSignal.timeout` (Chromium 116 ou posterior); o atual não depende delas, e um teste automatizado confere que o código da TV não usa funções recentes. Isso é uma lista de verificação e **não** comprova o funcionamento em nenhum modelo. Há aparelhos cujo navegador recusa o vídeo entregue como arquivo baixado (endereço `blob:`) mesmo com arquivo e codecs corretos; a partir da 2.4.0 o player tenta, nesses casos, o link direto do servidor ([RELATORIO-2.4.0.md](RELATORIO-2.4.0.md)), o que também não foi validado em televisor.
- **Memória e rede da TV.** O player baixa cada arquivo por inteiro para a memória do navegador, mantém até 96 MB e prepara o conteúdo seguinte com antecedência (a TV baixa um arquivo a mais do que o que está na tela). Arquivos grandes em redes lentas podem não ficar prontos em 120 s e serão pulados. O proxy reverso deve repassar o cabeçalho `Authorization` (é com ele que a TV se autentica), os pedidos `Range` (a pré-visualização do painel toca o vídeo direto do servidor, e as TVs que não tocam o arquivo baixado fazem o mesmo, a partir da 2.4.0, por um link temporário) e a parte da consulta do endereço (`?t=`, o padrão da maioria dos proxies); essa passagem não foi testada com um proxy real. Nas TVs que tocam o vídeo direto, o vídeo depende do servidor durante a exibição, o que o arquivo baixado não exige.
- **Novas variáveis de ambiente na Fase 2, na 2.2.0, na 2.3.0 e na 2.4.0:** nenhuma. Repetição, modo de duração e transições são configurados por playlist no painel; os formatos aceitos e as permissões (pareamento e programação) não têm variável de ambiente.

## Lista de conferência antes de usar dados reais

- [ ] HTTPS com certificado válido e proxy reverso; porta do Node fechada para a rede.
- [ ] `NODE_ENV=production`, `APP_ORIGIN` HTTPS, `MALWARE_SCANNER` funcionando (teste com um arquivo de teste do antivírus).
- [ ] `TRUST_PROXY` correto; `SETUP_TOKEN` removido após criar o administrador.
- [ ] Conta de serviço sem privilégios; permissões mínimas em `DATA_DIR`; disco criptografado.
- [ ] Backup agendado, **fora do servidor**, com restauração testada.
- [ ] Administradores revisados; Gestores e Editores com o escopo certo e, entre os Editores, quem deve só preparar rascunhos com `schedule:publish` retirado (veja [PERMISSOES.md](PERMISSOES.md)).
- [ ] Piloto com TVs reais de cada modelo antes de qualquer afirmação de compatibilidade.
- [ ] Demais itens de [SEGURANCA.md](SEGURANCA.md).
