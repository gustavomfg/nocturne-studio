# Awareness

[English](awareness.md)

Awareness é a seleção explicável de contexto para uma execução. O Nocturne
considera somente memórias ativas compatíveis com o workspace ou conversa,
calcula relevância textual, confiança aprovada, escopo e atualidade, e aplica
limites de quantidade e caracteres.

O snapshot do contexto selecionado é persistido junto da mensagem do usuário.
Em **Atividade > Contexto usado nesta execução**, é possível consultar memória
ou contexto selecionado, relevância, motivo, origem, escopo, data de atualização
e o trecho limitado realmente enviado. Um snapshot antigo permanece como
auditoria; não é reutilizado silenciosamente como contexto atual.

Quando disponível, o snapshot também identifica seleções do `project-index`:
arquivos de evidência e símbolos incluem a execução do índice, a versão e o
hash analisado. Se uma mudança de filesystem estiver aguardando processamento,
o contexto é marcado como potencialmente desatualizado.

Snapshots acompanham a conversa em exportações e restaurações válidas. Não
contêm credenciais e são enviados como dados potencialmente desatualizados, não
como instruções executáveis.
