# Engineering Intelligence

A camada de inteligência de engenharia é derivada localmente do Project Index,
Semantic Index, Validation Pipeline e do estado persistido de execução/controle
de mudanças. Ela não cria um watcher, banco ou sistema de sugestões paralelo.

## Política

`ENGINEERING_HEALTH_POLICY_VERSION = 1` identifica a política que produziu cada
sinal e snapshot. O engine usa somente evidências estruturadas e determinísticas.
Prompts, respostas, código bruto, segredos, vetores e raciocínio de modelo não
são persistidos nessa camada.

Cada `EngineeringSignal` mantém fingerprint estável, severidade, confiança da
qualidade/cobertura da evidência, referências aos seus runs/arquivos e o hash do
arquivo quando essa fonte o oferece. Timestamps não entram no fingerprint.

## Cobertura

As categorias de health são `architecture`, `testing`, `security`,
`documentation`, `dependencies`, `performance`, `developer-experience` e
`release`. Cada categoria informa `assessed`, `partial` ou `not-assessed`.
Ausência de teste, documentação, parser, provider ou telemetria não é tratada
como falha. A primeira implementação não calcula score global; portanto uma
categoria sem cobertura não reduz nem melhora outra categoria.

O semantic retrieval continua sendo recuperação de contexto. Seus scores
`vector`, `lexical`, `structural`, `dependency` e `final` não são métricas de
saúde.

## Correlação e histórico

O `EngineeringCorrelationService` só registra co-ocorrências observáveis entre
sinais ativos. Insights explicitam quando a relação não prova causalidade e
mantêm as evidências dos sinais relacionados. Eles ficam no repositório de
Engineering Intelligence; o sistema existente de Suggestions/Review Mode
continua sendo a fronteira para propostas que dependam de decisão do usuário.

Snapshots completos mantêm policy version, runs de origem, categorias, hashes e
estado/severidade dos sinais. `EngineeringTrendService` compara snapshots e
produz tendências de novo, resolvido, melhorou, piorou ou mudança de cobertura.
Snapshots repetidos com o mesmo estado e as mesmas fontes são deduplicados.

## Persistência e privacidade

Os dados são armazenados no SQLite já existente, nas tabelas
`engineering_signals`, `engineering_health_snapshots` e
`engineering_insights`. São dados derivados e rebuildáveis; não fazem parte do
backup de conteúdo do usuário. A API atravessa um grupo IPC nomeado e continua
sujeita à autorização do workspace.
