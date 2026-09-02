# Migrações e recuperação do banco

O SQLite usa `PRAGMA user_version` como versão canônica. A atualização completa,
incluindo reparos legados e todas as etapas pendentes, ocorre em uma única
transação. Uma falha reverte schema, dados e `user_version` ao estado anterior.

Antes de migrar, o Studio:

1. executa `quick_check`;
2. consolida o WAL;
3. cria uma cópia com permissão `0600`;
4. abre a cópia em modo somente leitura e verifica sua integridade;
5. mantém os três backups pré-migração mais recentes.

Um banco com versão futura é recusado sem manutenção ou escrita. Um banco que
falha na verificação de integridade não é migrado automaticamente. Antes de
inicializar os serviços, o Studio procura um snapshot saudável e compatível.
Quando encontra, apresenta a data e a origem e exige confirmação. O banco
corrompido e seus arquivos WAL/SHM são movidos para uma pasta de quarentena; se
a restauração falhar, eles voltam aos caminhos originais.

## Histórico do schema

| Versão | Alteração |
| --- | --- |
| 1 | Conversas, mensagens e configurações |
| 2 | Registro de workspaces |
| 3 | Memória editável, artefatos e auditoria de aprovações |
| 4 | Sugestões e decisões |
| 5 | Benefícios, complexidade e risco das sugestões |
| 6 | Autorização explícita de workspaces |
| 7 | Índices de navegação e paginação |
| 8 | Segundo Cérebro e busca FTS |
| 9 | Configurações normalizadas de Providers |
| 10 | Catálogo de modelos e bindings por workspace |
| 11 | Remoção do identificador experimental de thread do Codex |
| 12 | Associação persistente e limitada entre conversa e thread retomável do Codex |
| 13 | Evidências, confiança, origem e responsável das sugestões de Review |
| 14 | Ciclo de vida completo e histórico consultável das sugestões |
| 15 | Histórico auditável do ciclo de vida das memórias do Segundo Cérebro |
| 16 | Índice incremental do projeto, símbolos, relações import/export, evidências do stack e exclusões |
| 17 | Resultados estruturados do Validation Pipeline |

As migrações são progressivas. Reversão para uma versão antiga do aplicativo
deve usar um backup criado por essa versão; não se remove schema novo
silenciosamente.
