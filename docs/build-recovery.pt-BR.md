# Recuperação do Build Mode

[English](build-recovery.md)

Rollback usa checkpoints privados e imutáveis BEFORE/AFTER, sem depender de
`HEAD` ou redefinir o index Git. Trabalho anterior do usuário faz parte de BEFORE.

A confirmação fica vinculada ao ID da execução. Cada caminho precisa corresponder
a AFTER em bytes e modo antes da restauração. Arquivos deslocados são preservados
em `.nocturne/rollback/<operação>`, com um journal. A publicação exclusiva não
substitui um caminho recriado por outro processo. O resultado produzido, inclusive
a ausência esperada de um arquivo novo, é conferido antes de declarar restauração.
Delete e rename seguem a mesma semântica de estados BEFORE/AFTER por arquivo.

Falhas parciais preservam os bytes deslocados e informam o diretório de recuperação.
O rollback completo bem-sucedido encerra a pendência de decisão e publica o
ChangeSet persistido ao renderer. Não há transação global de filesystem: processos
externos podem manter descritores abertos nos arquivos deslocados, que permanecem
preservados. Inspecione workspace e diretório de recuperação em caso de conflito;
nenhuma restauração interrompida é retomada automaticamente.
