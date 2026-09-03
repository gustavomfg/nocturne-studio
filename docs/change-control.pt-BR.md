# Controle de mudanças — Fase 3

[English](change-control.md)

O Controle de Mudanças transforma cada Build em uma `Execution` persistida.
Ela mantém a intenção, o workspace, a conversa, o ciclo de vida, os
checkpoints, o ChangeSet, as validações associadas e os erros limitados.

## Fluxo

Antes de um Build, o processo principal captura um checkpoint `BEFORE` fora do
workspace. Ao terminar, captura `AFTER` e compara manifests por hash. A
comparação identifica create, modify e delete sem exigir Git. Arquivos binários
e diffs grandes permanecem estruturados, mas não são renderizados como texto
sem limite.

O ChangeSet aparece no Agent Mode junto da atividade da execução. Cada arquivo
exibe operação, hash observado, política, diff e estado de revisão. Hunks
textuais possuem patch original, patch final e estado próprio; edições são
validadas contra o conteúdo `BEFORE` antes de serem persistidas.

## Segurança e índice

Arquivos protegidos, como `.git` e `.nocturne`, são bloqueados. Exclusões,
arquivos de ambiente, remoções e renomeações exigem revisão adicional. Uma
rejeição só é aplicada quando o arquivo ainda coincide com o hash `AFTER`; se
houve edição externa, o rollback entra em conflito e preserva o conteúdo atual.

Enquanto há decisões pendentes, o watcher acumula eventos por workspace. O
Project Index só processa esse lote depois que todas as decisões forem
resolvidas, evitando que uma proposta rejeitada seja tratada como estado
efetivo.

Validações continuam usando o `ValidationPipeline` da Fase 2. Quando recebem
um `executionId`, o resultado mantém essa origem e pode ser consultado como
evidência da execução, com comando, duração, exit code, resumo sanitizado e
artefatos limitados.

Embeddings, busca semântica, RAG, grafo visual, multi-agent e aprendizado a
partir do histórico não fazem parte desta fase.
