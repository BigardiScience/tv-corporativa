# Entrega TV Corporativa 2.1.0

> Documento histórico da versão 2.1.0: descreve o pacote 2.1.0 e suas verificações originais. As alterações e a validação da versão atual (2.4.0) estão em [RELATORIO-2.4.0.md](RELATORIO-2.4.0.md); as da 2.3.0, em [RELATORIO-2.3.0.md](RELATORIO-2.3.0.md); as da 2.2.0, em [RELATORIO-2.2.0.md](RELATORIO-2.2.0.md).

Atualização do TV-Corporativa-2.0.1-fase2.zip recebido. O código interno original informava 2.0.0-fase2. A entrega é local para VS Code e retorna o projeto completo em ZIP.

## Alterações

- **Backend e banco:** migração 8 aditiva; concessões por setor/pessoa; vínculo de destino com estado, autor e ordem; histórico de suspensão/retomada. IDs, mídia, versões, hashes de senha e credenciais das TVs existentes são preservados.
- **Permissões:** TVs, acesso aos aparelhos, ordem global e usuários administrados somente pelo Administrador. Compartilhamento não concede acesso a arquivos de outros setores. API e player revalidam acesso efetivo; publicações simultâneas são independentes e edições da fila usam revisão.
- **Painel:** formulário “Quem pode publicar nesta TV?”, seleção de unidade e pessoas, sequência com rótulo do setor, ordenação pela TI, avisos de suspensão e destinos filtrados no agendamento.
- **Player e prévia:** vídeo tenta iniciar com áudio, volume interno 1, controle de silêncio por sessão, fallback e ativação acessíveis, pausa do vídeo anterior antes do próximo e prevenção de áudio após descarte.
- **Testes e documentação:** casos de migração, compartilhamento, concorrência, isolamento e áudio; guias atualizados e testes antigos adaptados às regras administrativas.

## Resultado da validação

515 testes automatizados: 511 passaram, 0 falharam, 4 ignorados. 192 arquivos JavaScript verificados. Os quatro ignorados dependem de recursos POSIX/antivírus auxiliar que não existem neste Windows. A interface e o player também foram conferidos no navegador integrado. Detalhes e limites em [VALIDACAO.md](VALIDACAO.md).

## Uso e atualização

Para primeira instalação, extraia o ZIP, abra TV-Corporativa.code-workspace e execute `npm.cmd run configure` e `npm.cmd start`. Entre em http://127.0.0.1:4173 com o administrador criado. Não precisa executar npm install.

Para atualizar uma instalação existente, pare o servidor, faça backup completo de dados/configuração, extraia em uma pasta nova e ensaie a migração em uma cópia. Use [MIGRACOES.md](MIGRACOES.md). Para compartilhar TVs e validar o áudio, use [TV-GLOBAL-E-AUDIO.md](TV-GLOBAL-E-AUDIO.md).

A revogação interrompe novos downloads imediatamente e o conteúdo já carregado sai na atualização do player ou no limite do manifesto de 60 segundos. Reativar um vínculo suspenso exige autorização válida e publicação explícita: interrompa e publique novamente. Uma edição comum não transfere autoria nem reativa o vínculo.

## Limites

Não há homologação de televisores físicos. Autoplay com som depende das regras do navegador; o player não altera o volume do sistema operacional. Referências de configuração gerenciada e roteiro de ensaio estão no guia. Não há certificação ISO/IEC 27001 nem avaliação TISAX. O ZIP contém código, ativos, scripts, testes e guias; dados e credenciais de execução ficam fora.

## Arquivos

Lista completa de diferenças em [ARQUIVOS-2.1.0.md](ARQUIVOS-2.1.0.md).

