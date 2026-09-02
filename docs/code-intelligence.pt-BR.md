# Code Intelligence — Fase 2

[English](code-intelligence.md)

O Code Intelligence mantém uma visão estrutural local do workspace. Ele não é
um IDE, não executa busca semântica e não cria grafo visual nesta fase.

## Pipelines

O processo principal separa três responsabilidades:

1. `WorkspaceDiscoveryService` descobre arquivos, configurações, exclusões e
   caminhos ausentes sem depender da linguagem;
2. `ProjectIndexService` calcula hashes, escolhe um `ParserAdapter`, persiste
   metadados/símbolos/relações e publica o progresso;
3. `ValidationPipeline` escolhe uma validação compatível com as evidências do
   stack e registra o resultado estruturado.

O watcher Chokidar existente continua sendo a fonte de eventos. Depois da
indexação inicial, um evento de arquivo usa descoberta parcial e reprocessa
somente o arquivo ou diretório afetado. Um overflow ou uma reindexação manual
usa reconciliação completa. Eventos recebidos durante uma execução são
coalescidos em uma fila por workspace.

## Índice persistido

O SQLite mantém `project_index_runs`, `project_index_files`,
`project_index_symbols`, `project_index_imports`, `project_index_exports`,
`project_stack_evidence` e `project_index_exclusions`. Cada resultado derivado
carrega o hash analisado do arquivo de origem; evidências do stack carregam o
hash do arquivo que sustentou a conclusão. A versão estrutural atual é
`CODE_INTELLIGENCE_INDEX_VERSION`.

Falhas de leitura ou parsing são registradas no arquivo correspondente e não
interrompem os demais arquivos. O retry seleciona somente arquivos em falha.
Reindexação substitui relações e evidências dentro de transações, sem guardar
conteúdo bruto do código.

## Linguagens e relações

Parsers implementam o contrato comum em `electron/project-index/ParserAdapter.ts`.
O adapter atual usa a API do TypeScript para TypeScript e JavaScript, incluindo
funções, classes, interfaces, tipos, enums, métodos, componentes, imports e
exports. Novos adapters podem ser adicionados ao `ParserRegistry` sem alterar o
modelo SQLite.

Imports e exports registram caminho, hash, especificador, localização e
resolução local/externa/não resolvida. O modelo permanece independente da IA e
não renderiza um grafo.

## Stack e validação

O detector registra cada conclusão como evidência com categoria, confiança,
arquivo, hash, linha quando disponível e justificativa. Package managers,
scripts, runtimes, linguagens, frameworks, bundlers, ferramentas de lint,
typecheck, testes e build são inferidos apenas de arquivos encontrados.

O pipeline oferece typecheck, lint, testes, build e smoke quando existe um
script ou fallback suportado pelo stack. Comandos são iniciados pelo processo
principal, dentro do workspace autorizado, sem shell genérico do Nocturne; a
saída é limitada, sanitizada e artefatos só são persistidos quando apontam para
arquivos existentes dentro do workspace. Comando ausente ou risco destrutivo
produz estado `blocked`, não uma execução implícita.

## IA e observabilidade

O contexto estrutural enviado à IA contém a execução do índice, versão, resumo,
arquivos/símbolos selecionados, relações, evidências, hashes e indicação de
desatualização. A seleção persistida em Awareness aponta para a execução e para
o arquivo/símbolo usados.

O relatório sanitizado de Diagnóstico expõe contagens e tempos agregados de
indexação, atualizações incrementais, parsers, cancelamentos, falhas parciais e
validações. Nenhum embedding, sincronização externa ou histórico avançado de
execução faz parte desta fase.
