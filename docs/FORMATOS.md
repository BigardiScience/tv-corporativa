# Conteúdo e formatos

> Atualização 2.4.0: os formatos aceitos e o tratamento de áudio **não mudaram**, e o sistema continua sem converter nada. Muda só o caminho pelo qual o vídeo chega ao `<video>` da TV: o arquivo baixado para a memória (como sempre) ou, nas TVs que o recusam, o mesmo arquivo direto do servidor por um link temporário. Detalhes em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md).
>
> Atualização 2.2.0: o envio de arquivos aceita também MOV e JPEG, e Editor e Gestor passam a gerar o código de pareamento das TVs já cadastradas que podem usar. Cadastro de TVs, acessos, ordem global e usuários continuam exclusivos do Administrador. Detalhes em [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md); as TVs compartilhadas da 2.1.0 estão em [TV global e áudio](TV-GLOBAL-E-AUDIO.md).

A TV Corporativa distribui conteúdo que já foi preparado e aprovado nas ferramentas de autoria. Ele não edita apresentações, planilhas, projetos de design ou relatórios de BI.

## O que utilizar nesta versão

| Ferramenta de origem | Arquivo recomendado para a TV | Observação |
| --- | --- | --- |
| PowerPoint | MP4, PNG, JPEG ou PDF | MP4 conserva a sequência e as animações exportadas; imagens são adequadas a comunicados estáticos. |
| Excel / Word | PDF, PNG ou JPEG | Exporte apenas a área de impressão necessária. A TV não recalcula fórmulas. |
| Power BI | PDF ou imagem exportada | É uma fotografia do relatório no momento da exportação. Não atualiza os dados automaticamente. |
| Canva | PNG, JPEG, PDF ou MP4 | Exporte na própria ferramenta. Canva é um produto independente da Microsoft. |
| Photoshop | PNG ou JPEG | Exporte a arte final; PSD não é um formato de reprodução. Photoshop é um produto da Adobe. |
| Outras ferramentas | PNG, JPG/JPEG, WebP, PDF, MP4, MOV ou WebM | A extensão e o conteúdo do arquivo devem passar pela validação do servidor. |

Arquivos de trabalho como PPTX, XLSX, DOCX, PBIX e PSD não são renderizados diretamente. Arquivos com macros, executáveis, HTML e SVG não são aceitos para exibição. A marca do aplicativo de origem não garante que um arquivo seja seguro.

## Formatos aceitos no envio

São oito extensões. Maiúsculas e minúsculas valem o mesmo (`.MOV` e `.mov`, `.Jpeg` e `.jpeg`):

| Extensão | Tipo | O que o servidor confere antes de aceitar |
| --- | --- | --- |
| `.png` | Imagem | A assinatura: os primeiros bytes são de um PNG. |
| `.jpg` e `.jpeg` | Imagem. São o mesmo formato (JPEG), com a mesma conferência e o mesmo fluxo | A assinatura e o **arquivo inteiro**: segmentos com tamanhos coerentes, um quadro de imagem válido, ao menos uma varredura completa e a marca de fim. |
| `.webp` | Imagem | A assinatura (`RIFF` … `WEBP`). |
| `.pdf` | Documento | A assinatura (`%PDF-`). |
| `.mp4` | Vídeo | A assinatura (bloco `ftyp`). |
| `.mov` | Vídeo (QuickTime) | A assinatura e a **estrutura inteira**: informações de reprodução e dados presentes, faixa de vídeo H.264 ou HEVC e dados dentro do próprio arquivo. |
| `.webm` | Vídeo | A assinatura (cabeçalho EBML). |

A extensão escolhe o tipo, e o servidor guarda e entrega o tipo que corresponde a ela, não o que o navegador informou. Um arquivo vazio, renomeado (um PDF chamado `.jpg`, por exemplo), cortado ou com estrutura inválida é recusado no envio (HTTP 415, com a orientação para a pessoa) e **não entra na biblioteca**. A janela de envio confere extensão, tamanho e primeiros bytes antes de enviar, tanto ao escolher quanto ao arrastar os arquivos; o servidor refaz todas as conferências, e é ele quem decide.

**JPG e JPEG.** Dois nomes para o mesmo formato (tipo `image/jpeg`). Além da assinatura, o servidor percorre o arquivo inteiro e recusa o JPEG cortado ou corrompido (“O arquivo JPEG está incompleto ou corrompido…”) e as codificações que os navegadores não exibem (sem perdas, aritmética ou diferente de 8 bits). JPEG progressivo, em tons de cinza ou com marcadores de reinício passa, e dados depois da marca de fim, como as miniaturas que os celulares anexam, são permitidos. JPEG em CMYK passa na conferência da estrutura, mas a exibição depende do navegador do aparelho: prefira RGB. O servidor não decodifica a imagem.

**MOV (QuickTime).** É aceito o vídeo H.264 ou HEVC (H.265) em um único arquivo completo; o áudio não é conferido nem exigido. O servidor não decodifica nem executa nada: lê só os tamanhos e os tipos dos blocos do arquivo. Ele recusa, com a mensagem correspondente, o arquivo cortado ou sem as informações de reprodução ou sem os dados; o arquivo sem imagem (só áudio); o codec diferente de H.264 e HEVC, como Apple ProRes ou Motion JPEG (a mensagem diz qual foi encontrado); o vídeo cujos dados estão fora do arquivo; e a estrutura comprimida ou de referência.

**O que esta versão não faz com vídeo.** Não existe análise nem conversão de vídeo: nenhum FFmpeg ou outro conversor é instalado ou chamado, e o projeto não depende de programa algum para processar mídia. O MOV, como o MP4 e o WebM, é guardado exatamente como foi enviado e entregue à TV no mesmo formato (tipo `video/quicktime`), e **somente depois de aprovado** por uma pessoa autorizada (e, em produção, verificado pelo antivírus). Antes disso o arquivo fica em *Aguardando aprovação* e a TV recebe recusa (403) se pedir o arquivo. Se o navegador do aparelho não decodificar o vídeo (HEVC em modelos sem esse suporte, por exemplo), o player pula o conteúdo e mostra o motivo na tela. No painel, quando o navegador do computador não exibe a imagem de um MOV, os detalhes do arquivo avisam, e a pré-visualização da playlist pula o conteúdo com o motivo. Para a maior compatibilidade, prefira MP4 com H.264 e AAC, e teste cada MOV (principalmente HEVC) na TV de destino antes de publicar.

Para telas horizontais, prepare uma versão 1920 × 1080, proporção 16:9, com pouco texto, letras grandes e contraste suficiente. Para telas verticais, utilize a orientação correspondente. MP4 e MOV dependem dos codecs que o navegador do dispositivo consegue decodificar; valide H.264/AAC (e, no MOV, também HEVC) no equipamento real antes de publicar. Vídeos tentam iniciar com áudio e volume 1, o máximo do elemento de vídeo. Isso não altera o volume físico da TV. Quando o navegador bloqueia o som, há **Ativar áudio** e uma única tentativa muda. Se também bloquear sem som, a sequência pausa até a ação **Reproduzir**.

PDF depende do visualizador disponível no navegador da TV e não equivale a uma apresentação automática de todas as páginas. Para uma sequência previsível, exporte cada página como imagem ou toda a apresentação como MP4. Homologue cada combinação de modelo de TV, sistema operacional e navegador.

O limite inicial do servidor é 50 MB por arquivo, configurável em `MAX_UPLOAD_MB` (de 1 a 250). O envio sempre coloca o conteúdo em revisão. Uma playlist só pode ser publicada com conteúdo aprovado, e uma TV só recebe arquivos liberados pela política de verificação do ambiente.

## Tempo de exibição, vídeo, repetição e transições

Na playlist, cada conteúdo tem um **tempo de exibição de 5 a 3600 segundos** (padrão 15 s). O player avança quando esse tempo termina, contado desde o início da entrada do conteúdo, de modo que a soma dos tempos é a duração do ciclo. Imagens e PDFs ficam na tela durante todo o tempo definido. No PDF o tempo vale para o documento inteiro e as páginas não passam sozinhas; o tempo por página não existe nesta versão (não há conversão de PDF em imagens).

O **vídeo** tem dois modos:

| Modo | O que acontece |
| --- | --- |
| *Tempo definido (limite)* (padrão) | O vídeo toca até o fim ou até o limite, o que vier primeiro. Para ver o vídeo inteiro, ajuste o limite ao menos para a duração dele. |
| *Até o fim do vídeo* | O vídeo toca inteiro. O número do campo vira uma **reserva**: só vale se o aparelho não conseguir ler a duração do vídeo (assim nada prende o carrossel). Há ainda um prazo de segurança de 2 segundos além da duração do vídeo. |

O usuário pode silenciar ou ativar o som; a preferência de silêncio dura pela sessão. Ativar áudio não retoma um vídeo pausado. Pausa, troca, fim e revogação interrompem o áudio anterior. A liberação de um elemento pelo navegador não garante a dos próximos. Vídeo que não pode ser decodificado é pulado, com o motivo na tela. Desde a 2.4.0, antes de pular por decodificação o player tenta uma vez o outro caminho de entrega (do arquivo baixado para o link direto do servidor, ou o contrário) e lembra o que funcionou naquela TV; o arquivo e o som são os mesmos nos dois caminhos.

A **repetição** é uma opção da playlist, copiada para cada versão publicada. Ligada (padrão), a sequência recomeça sem parar; desligada, o player exibe a sequência uma vez e mantém o último conteúdo na tela. Se várias programações estão ativas na mesma TV, a TV só deixa de repetir quando **todas** as playlists ativas (com conteúdo liberado para ela) estiverem com a repetição desligada.

A **transição** de cada conteúdo (corte seco, esmaecer, dissolver, deslizar ou zoom, de 0 a 3000 ms) é aplicada na **entrada** do conteúdo, pelo player da TV e pela pré-visualização do painel. O conteúdo novo só aparece depois de pronto e entra por cima do anterior, que permanece até o fim do efeito: não há tela vazia entre eles. Os efeitos usam opacidade, deslocamento e escala; o *Dissolver* também usa desfoque, que é mais pesado para o aparelho. O player **simplifica** o efeito quando necessário:

| Situação | O que o player faz |
| --- | --- |
| O sistema do aparelho pede menos movimento (`prefers-reduced-motion`) | Qualquer efeito vira *Esmaecer*, e a tela informa |
| O aparelho não mantém a fluidez (o próprio player mede o ritmo das transições; duas lentas seguidas contam) | Desce um nível: primeiro só *Esmaecer*, depois *Corte seco*. O nível é lembrado por 7 dias e depois testado de novo |
| O navegador não oferece animações | *Corte seco*, com o motivo informado |

Muitas TVs não oferecem a opção de reduzir movimento, por isso a medição acontece no próprio aparelho. Essa medição, o desempenho de cada efeito e o comportamento do navegador de cada modelo **não foram validados em nenhuma TV real**. Testes e capturas de navegador das fases anteriores não demonstram compatibilidade física. As execuções atuais estão em [VALIDACAO.md](VALIDACAO.md). Homologue cada combinação de modelo de TV, sistema e navegador antes de divulgar.

## Exportação simples do PowerPoint

No PowerPoint, escolha **Arquivo → Exportar → Criar um vídeo** e gere um MP4. Para conteúdo sem animação, utilize a exportação para PDF ou imagens. A Microsoft documenta os caminhos de [exportação da apresentação](https://support.microsoft.com/en-us/powerpoint/export-a-presentation) e [criação de vídeo](https://support.microsoft.com/en-us/powerpoint/training/save-a-presentation-as-a-video%E2%80%8B-in-powerpoint).

## Integrações Microsoft: não incluídas

Esta versão não tem conector com Microsoft 365, SharePoint, OneDrive nem Power BI; os quadros dessas integrações, em **Configurações**, aparecem como “Não conectado”. Usar essas origens de forma automática exigiria implementação e homologação que não existem aqui. Se a TI decidir construir uma integração própria, estes são os pontos externos a resolver (nada disto está configurado nesta entrega):

- **SharePoint/OneDrive:** registrar um aplicativo no tenant correto, usar biblioteca de autenticação suportada e conceder acesso somente aos sites ou arquivos necessários. As [permissões Selected do Microsoft Graph](https://learn.microsoft.com/en-us/graph/permissions-selected-overview) permitem restringir o alcance; consentimento e concessão no recurso são etapas distintas.
- **Power BI:** escolher a modalidade de incorporação, validar licenciamento e autorizações, proteger tokens no servidor e implementar renovação. Uma URL colada não resolve a autenticação de uma TV. A [incorporação segura](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-embed-secure) respeita as permissões dos relatórios e exige HTTPS.
- **Não utilizar “Publicar na Web” para relatórios internos:** esse recurso torna o conteúdo acessível sem autenticação na internet, mesmo quando o iframe é colocado numa intranet. Consulte a [explicação da Microsoft](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-publish-to-web).

Considere “Canvas” como Canva apenas se essa for a ferramenta pretendida. Aplicações chamadas Canvas que não sejam Canva precisam de avaliação própria; o caminho universal desta versão é exportar o conteúdo para um formato de reprodução aceito.
