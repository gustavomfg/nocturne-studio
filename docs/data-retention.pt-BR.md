# Retenção de dados e limites de recuperação

[English](data-retention.md)

O Nocturne não aplica hoje um coletor global por idade nem um orçamento global
de disco. Isso é deliberado: um Build concluído ainda pode ser elegível para
rollback iniciado pelo usuário, e apagar seus dados BEFORE/AFTER por idade
mudaria essa garantia silenciosamente. A ausência de GC não é uma promessa de
armazenamento ilimitado.

## Política de retenção atual

| Classe de dado | Garantia de retenção | Garantia de backup | Elegibilidade para GC |
| --- | --- | --- | --- |
| Execução ativa, ChangeSet pendente, checkpoint e operação interrompida | Preservar enquanto estiver pendente, em conflito, capturando ou necessário para reconciliar recovery. | Fora do backup de conteúdo. | Nunca automaticamente. |
| Auditoria de execução, validação, evidência de workspace e histórico de decisões | Retido localmente enquanto o workspace/conversa dono existir. | O backup de conteúdo preserva apenas sugestões e decisões. | Sem GC por idade. Exclusão somente por deleção/cascade do dono. |
| Memória autoral de workspace/Segundo Cérebro | Retida até o usuário editar/apagar ou apagar o dono. | Espelhos no banco e histórico do Segundo Cérebro são incluídos; arquivos `.nocturne` ficam fora do backup portável. | Nunca automaticamente. |
| Conversa Review, mensagens, artefatos, sugestões e decisões | Retidos enquanto a conversa existir; a reconciliação de Review futura é escopada à mesma conversa. | Incluídos como conteúdo. | Sem GC por idade. |
| Project/Semantic/Engineering Intelligence | Derivados e reconstruíveis; linhas de índice por arquivo são substituídas quando o workspace muda. | Excluídos. | Elegíveis a futura política explícita para dados derivados, mas sem pruning automático atual. |
| Logs e snapshots locais de recuperação | A rotação mantém o log atual de 2 MB e um rotacionado; snapshots pré-restore retêm cinco e cópias pré-migração retêm três. | Fora do backup de conteúdo. | Limitados pelos mecanismos específicos. |

Cada checkpoint também é limitado a 32 MB por arquivo e 512 MB no total. Esses
são limites de segurança da captura, não um orçamento de histórico do
workspace. O filesystem é hoje o caminho de observabilidade para o acúmulo de
banco e checkpoints; o Nocturne ainda não expõe nem alerta em um limiar global
de disco.

## Implicações para histórico de Review

O produto retém o histórico de Review que permanece no banco e exporta suas
entidades de conteúdo. Ele não promete arquivo temporal completo após reset,
deleção do banco ou restauração de conteúdo; `.nocturne/memory.md` não substitui
o Review original, a evidência ou a identidade da sugestão. Git registra as
mudanças no workspace, não toda a evidência de Review que as motivou.

Uma futura feature de retenção deve primeiro expor uma política visível ao
usuário e preservar todos os dados alcançáveis por decisões pendentes,
operações de rollback/recovery e interrupções não reconciliadas. Ela deve
remover linhas do banco e bytes privados de checkpoint de forma suficientemente
atômica para não deixar referências de recovery pendentes.
