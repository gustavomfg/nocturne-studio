# Code Intelligence — Fases 2 e 4

[English](code-intelligence.md)

O Code Intelligence mantém uma visão estrutural e semântica local do
workspace. Ele não é um IDE e não cria grafo visual de dependências. Embeddings
são opcionais e servem para recuperação de contexto, não para recomendações
arquiteturais automáticas.

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

## Índice semântico — Fase 4

O `SemanticChunker` deriva unidades estáveis dos símbolos do Project Index,
seções Markdown, arquivos de configuração e texto limitado. O
`SemanticIndexService` consome essas unidades sem introduzir outro watcher ou
uma nova descoberta. Cada unidade mantém hash do arquivo, hash do chunk, versão
da estratégia, localização e estado.

Os vetores são armazenados localmente como BLOBs Float32 no SQLite. O espaço de
embeddings é identificado por provider, modelo, versão do modelo e dimensões;
espaços diferentes nunca são comparados. O workspace precisa de um
`embeddingBinding` explícito, separado do `defaultBinding` de conversa. Sem um
binding válido, ou quando o Provider falha, o índice continua utilizável por
recuperação lexical e estrutural.

A privacidade é avaliada antes de enviar conteúdo ao adapter de embeddings.
Arquivos excluídos, potencialmente secretos, assets e tipos não suportados não
são lidos pelo pipeline semântico. Embeddings remotos exigem consentimento
explícito do workspace e, sem esse consentimento, nenhum conteúdo é enviado.
Hashes são verificados antes e depois da chamada assíncrona; trabalho obsoleto é
descartado e colocado novamente na fila.

A recuperação normaliza sinais lexicais, vetoriais, estruturais e de dependência
superficial antes de combiná-los. O `ContextAssemblyService` aplica prioridade
de fontes, deduplicação, limites de tokens e proveniência. Resultados enviados
à IA incluem caminho, hash analisado, hash do chunk, versão do índice e motivo
da recuperação.

## IA e observabilidade

O contexto estrutural enviado à IA contém a execução do índice, versão, resumo,
arquivos/símbolos selecionados, relações, evidências, hashes e indicação de
desatualização. A seleção persistida em Awareness aponta para a execução e para
o arquivo/símbolo usados.

O relatório sanitizado de Diagnóstico expõe contagens e tempos agregados de
indexação estrutural, indexação semântica, atualizações incrementais, parsers,
cancelamentos, falhas parciais e validações. Sincronização externa, grafo visual
de dependências, sugestões arquiteturais, multi-agent, aprovação de diffs,
checkpoints e histórico avançado de execução continuam fora destas fases.
