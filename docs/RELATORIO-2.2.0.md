# Entrega TV Corporativa 2.2.0

> Documento histórico da versão 2.2.0: descreve o pacote 2.2.0 e suas verificações originais. As alterações e a validação da versão atual (2.4.0) estão em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md); as da 2.3.0, em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md). A observação "Pedido anterior ainda não atendido", mais abaixo, está superada: o pedido de programações com recursos globais e escolha dos setores foi informado como concluído por outra IA, e a 2.3.0 o trata assim, sem alterá-lo.

Atualização do `TV-Corporativa-2.1.0.zip` recebido (SHA-256 `3c83a9c5642e46fc27aaddc429ef4f2d53561b03ad1da2f15073ab62b8cf1cde`). O trabalho foi feito sobre uma cópia; o pacote publicado e os dados de quem já usa o sistema não foram tocados. A entrega é o projeto completo em ZIP, com código, testes e documentação, sem credenciais, dados corporativos, arquivos temporários nem bancos de teste.

O escopo recebido foi seguido à risca: dois acréscimos funcionais (MOV e JPEG no envio de arquivos; permissão de gerar o código de pareamento para Editor e Gestor), interface preservada, revisão conservadora e documentação conferida com o comportamento real. Nada além disso foi acrescentado, e nada que já existia foi removido.

## Alterações

### 1. Envio de arquivos: MOV e JPEG

O envio aceita oito formatos: **PNG, JPG, JPEG, WebP, MP4, MOV, WebM e PDF**, com a extensão em maiúsculas ou minúsculas, pelo seletor de arquivos e por arrastar e soltar. Os seis formatos anteriores, inclusive o WebM, continuam como estavam.

- **JPG e JPEG** são o mesmo formato (tipo `image/jpeg`), com a mesma detecção de duplicados e o mesmo fluxo de qualquer imagem. Além da assinatura, o servidor percorre o arquivo inteiro e recusa o JPEG cortado, corrompido ou com codificação que os navegadores não exibem.
- **MOV** segue o fluxo de vídeo. O servidor confere a estrutura inteira do arquivo (informações de reprodução presentes, dados presentes e dentro do arquivo, faixa de vídeo H.264 ou HEVC) e recusa, com orientação, o arquivo cortado, o que só tem áudio e os codecs que o player não reproduz (Apple ProRes, Motion JPEG e outros, com o nome do codec encontrado).
- **Validação em duas camadas:** a janela de envio confere extensão, tamanho e primeiros bytes antes de enviar; o servidor refaz tudo e decide. Arquivo renomeado (um PDF chamado `.jpg`), vazio, incompleto ou inválido é recusado (HTTP 415) e não entra na biblioteca.
- **Nada chega ao player sem estar pronto:** todo arquivo novo entra *Aguardando aprovação*; a TV recebe recusa (403) até a aprovação e, em produção, até a verificação do antivírus terminar limpa. MOV e JPEG não têm exceção.
- **Arquivos já cadastrados** permanecem como estão: a conferência vale para os novos envios e não reavalia a biblioteca existente.
- **Sem análise nem conversão de vídeo:** o projeto nunca teve FFmpeg ou outro conversor, e esta entrega não instala nenhum. Por isso não há como "reutilizar a análise e a conversão disponíveis": o MOV é guardado e entregue como foi enviado (`video/quicktime`), e a limitação está dita de forma objetiva em [FORMATOS.md](FORMATOS.md). O formato não foi escondido por isso. Quando o aparelho carrega o arquivo mas não decodifica a imagem (HEVC em modelos sem esse suporte, por exemplo), o player pula o conteúdo e mostra o motivo, em vez de exibir um quadro preto com som.

### 2. Permissão para Editor e Gestor: gerar o código de pareamento

Nova permissão `screen:pair` ("Gerar código de pareamento de TVs já cadastradas"), separada da administração de TVs.

- **Quem tem:** Administrador, Gestor e Editor, para as TVs que já podem usar (unidade, setor e vínculos de acesso). Contas já cadastradas e novas recebem a permissão pelo perfil, sem migração de dados; uma retirada individual feita pelo Administrador é respeitada. O Visualizador não a tem e não pode recebê-la.
- **O que faz:** `POST /api/displays/:id/pairing-code` abre um código novo de 6 números para uma TV **ativa**. Não desconecta a TV e não revoga a credencial dela: a TV só troca de credencial quando alguém digita o código nela. Mantém validade de 10 minutos, uso único, limite de tentativas no endereço de pareamento e a regra de que o código novo substitui um código aberto. Só o hash do código é guardado.
- **Servidor decide tudo:** permissão, acesso à TV e situação da TV são verificados no servidor a cada chamada; só o identificador da rota é usado, então corpo, parâmetros ou identificadores manipulados não mudam o alvo. Respostas: 401 sem sessão; 403 sem a permissão (`PERMISSION_DENIED`) ou sem acesso à TV (`DISPLAY_ACCESS_DENIED`); 404 TV inexistente; 409 TV ainda não ativada.
- **Continua exclusivo do Administrador:** cadastrar, editar, renomear, mover de unidade e excluir TVs, ativar e renovar o pareamento (que **desconecta** a TV), conceder ou revogar acessos, a ordem global e a administração de usuários. Esse conjunto é reservado no código e uma concessão individual não o libera.
- **Auditoria:** evento `device.pairing.generated` (“Código de pareamento gerado”) com o responsável, a TV, a unidade e o horário, no escopo da própria TV. Nem o código nem o hash dele são gravados.
- **Onde fica:** na tela **Telas**, na linha de cada TV autorizada, o botão **Código de pareamento**, com o mesmo visual dos demais botões, uma confirmação e a mesma janela que já exibia o código ao Administrador. O texto do catálogo de permissões que prometia “gerar códigos” a quem ativa TVs foi corrigido: ativar e renovar o pareamento são do Administrador e desconectam a TV.
- **Exceção declarada:** a 1.1.0 prometia que a atualização não daria poderes novos a contas existentes. Esta é a única exceção, pedida no escopo: Editores e Gestores, inclusive os já cadastrados, ganham o poder de gerar o código das TVs que já usam.

### 3. Interface preservada

Não houve redesenho. Mudaram apenas: MOV e JPEG na lista de formatos aceitos (seletor, texto da área de soltar e ajuda), o botão **Código de pareamento** e sua confirmação em Telas para quem tem a permissão, o aviso de Telas desses perfis e o texto das mensagens de recusa do envio. Não há cartões, seções, avisos nem explicações técnicas permanentes novos.

### 4. Revisão e refatoração conservadoras

Foram alterados apenas os pontos necessários: tabela de formatos e primeira conferência de assinatura (`server/domain/formats.mjs`), chamada da conferência de conteúdo no envio (`server/domain/media.mjs`), o módulo novo `server/domain/content-check.mjs`, o catálogo e os perfis de permissões (`permissions.mjs`, com uma linha em `users.mjs`), a função e a rota de geração do código (`displays.mjs`, `routes/displays.mjs`) e, no painel e no player, a validação de formatos, os modelos de TV, de permissões e de auditoria e a tela de Telas. Rotas, contratos de API, autenticação, banco (esquema 8, sem migração) e controles de segurança existentes ficaram como estavam; a API ganhou uma rota (de 56 para 57 rotas).

### 5. Documentação e segurança

Todos os guias foram conferidos com o código e corrigidos onde diferiam: instalação e execução, formatos aceitos e limites verificados, perfis e permissões (21 permissões), pareamento, processamento e aprovação, operação e configuração pela TI, atualização e preservação de dados. Foram removidas promessas e planos de fases futuras dos documentos atuais (os relatórios de entregas anteriores ficam como histórico, com aviso no topo), e as dependências externas ainda não configuradas (antivírus, Microsoft/SSO, Power BI, conversão de vídeo e de Office) aparecem como tal, não como recurso pronto. Os testes de documentação, que conferem contagens, rotas, permissões e links contra o código, foram atualizados e passam. Os controles de segurança existentes foram preservados e verificados (privilégio mínimo, autorização no servidor, isolamento por unidade e setor, validação de arquivos, proteção de credenciais e auditoria encadeada). **Não há certificação ISO/IEC 27001, avaliação TISAX nem declaração de conformidade total:** os controles apoiam um processo de conformidade, que depende de decisões e evidências da organização ([SEGURANCA.md](SEGURANCA.md)).

## Resultado da validação

548 testes automatizados: 548 passaram, 0 falharam, 0 ignorados, em Linux com Node.js v22.23.4 (o projeto exige Node 24 ou superior). 11 cenários em navegador (124 etapas) passaram no Chromium. 199 arquivos JavaScript verificados, sem falha. Em Windows, cinco testes são ignorados: os quatro que já eram na 2.1.0 (terminal POSIX e scanner em shell Unix) e o novo teste de produção com MOV e JPEG, que usa o mesmo scanner. **Não houve** execução em Node 24, em Windows, em televisor físico, com antivírus real nem com HEVC decodificado (o Chromium usado não decodifica HEVC). O ensaio completo, o que foi e o que não foi validado e como reproduzir estão em [VALIDACAO.md](VALIDACAO.md).

## Uso e atualização

Para primeira instalação, siga o [README](../README.md) e [COMO-RODAR-NO-WINDOWS.md](COMO-RODAR-NO-WINDOWS.md). Para atualizar uma instalação existente (sem migração de banco), pare o servidor, copie a pasta `data/` inteira para fora do servidor, extraia o ZIP numa pasta nova, aponte-a para uma **cópia** de `data/` e confira o que está em [MIGRACOES.md](MIGRACOES.md) antes de trocar o código do ambiente real. Passo a passo curto para validar localmente:

1. Extraia o ZIP e abra `TV-Corporativa.code-workspace` no VS Code.
2. No terminal, rode `npm.cmd run check` e `npm.cmd test`. Em Windows, cinco testes aparecem como ignorados; nenhum deve falhar.
3. Com `data/` copiada para a pasta nova (ou uma instalação limpa com `npm.cmd run configure`), rode `npm.cmd start` e entre em `http://127.0.0.1:4173`.
4. Em **Biblioteca → Enviar arquivos**, confira os oito formatos na janela; envie um `.JPEG` e um `.MOV` (H.264) de teste, aprove-os e confira que só então aparecem para a TV.
5. Entre como Editor ou Gestor, abra **Telas**, use **Código de pareamento** numa TV autorizada e confirme que a TV atual continua conectada até o código ser digitado nela.
6. Entre como Administrador e veja em **Auditoria** o evento “Código de pareamento gerado”, sem o código.
7. Teste cada MOV, e cada HEVC em especial, no navegador da TV de destino antes de divulgar.

## Dependências reais e limites

- **Vídeo:** não existe análise nem conversão. MOV é entregue como enviado; a reprodução depende dos codecs do navegador de cada TV, e o MOV com HEVC só toca em aparelhos que o decodificam. O limite padrão de 50 MB por arquivo costuma ser pequeno para MOV gravado em celular; ele é configurável em `MAX_UPLOAD_MB` (de 1 a 250).
- **Antivírus:** o antivírus real não foi homologado nesta entrega; em produção, a TV só recebe arquivo verificado e limpo (`MALWARE_SCANNER`).
- **Televisores:** nenhum modelo foi testado, inclusive para MOV, HEVC e áudio.
- **Integrações:** não há Microsoft Entra ID, SSO, SharePoint, OneDrive nem Power BI. Os quadros de Configurações aparecem como “Não conectado”.
- **Conformidade:** sem certificação ISO/IEC 27001 nem avaliação TISAX.

## Observações fora do escopo

- **Pedido anterior ainda não atendido:** “as programações também terem recursos globais e uma opção de quais setores podem visualizar as postagens”. Não faz parte da 2.1.0 recebida nem desta entrega, e nada dele foi implementado. Pode ser feito como uma entrega própria.
- **Cenários de navegador desatualizados desde a 2.1.0:** dois (Fundação e Playlists – Fase 2) falhavam no pacote 2.1.0 recebido, porque esperavam o menu antigo do Gestor e o comportamento de áudio anterior da pré-visualização; a validação da 2.1.0 os listava como não executados. Só os testes foram corrigidos; o produto não mudou.
- **Histórico do Git no ZIP recebido:** a pasta `.git` que veio no `TV-Corporativa-2.1.0.zip` lista commits chamados 2.1.1 e 2.1.2 antes do último commit 2.1.0. Como pedido, só o conteúdo desse ZIP foi considerado: o que existir somente naqueles commits não está nesta entrega. Antes de substituir o código publicado, confira se algo deles precisa ser mantido.
- **Novo código do Administrador:** continua desconectando a TV, por desenho. Quem precisa trocar o código sem desconectar a TV usa o botão novo, se tiver a permissão.

## Arquivos

Lista completa de diferenças em [ARQUIVOS-2.2.0.md](ARQUIVOS-2.2.0.md).
