# Docs Mode

[English](docs-mode.md)

Docs Mode mantém análise, aprovação e aplicação separadas:

1. o agente lê a documentação relacionada sem escrever;
2. produz uma atualização Markdown focada;
3. o usuário escolhe um arquivo Markdown dentro do workspace autorizado;
4. o Nocturne mostra conteúdo atual e proposto lado a lado;
5. o usuário escolhe cancelar, anexar, substituir ou criar;
6. o processo principal pede confirmação final antes da escrita.

Antes de aplicar, o Nocturne verifica o hash esperado. Se outro programa alterar
o arquivo depois do preview, a operação é recusada e uma nova comparação é
necessária. A escrita usa arquivo temporário, sincronização, permissões
restritivas e substituição atômica.

Exports HTML, DOCX e PDF dependem do Pandoc e são cópias derivadas da resposta;
não atualizam incrementalmente um Markdown fonte.
