# Modos Review, Build e Docs

[English](modes.md)

## Review Mode

Review é somente análise. Lê o workspace autorizado e produz sugestões
estruturadas com evidência, confiança, origem, severidade, justificativa e
histórico de decisões. Uma nova análise reconcilia achados novos e persistentes
e resolve achados abertos que não são sustentados pelas evidências atuais.
Review nunca altera arquivos por conta própria.

## Build Mode

Build pode modificar arquivos somente dentro do workspace autorizado e sob as
políticas atuais de aprovação e sandbox. O App Server Codex recebe política de
escrita no workspace com rede desabilitada. Progresso, aprovações, arquivos
alterados e diffs permanecem visíveis.

Rollback protegido só é oferecido quando o workspace estava limpo antes da
execução, existe commit `HEAD` e o agente reportou caminhos contidos na raiz
autorizada. Revise o diff antes de confirmar o rollback.

## Docs Mode

Docs gera propostas somente leitura. O usuário escolhe um arquivo Markdown,
compara conteúdo atual e proposto e confirma anexar, substituir ou criar. O hash
é verificado novamente antes da escrita, que é atômica. Exports HTML, DOCX e PDF
são cópias derivadas e não atualizações incrementais do documento-fonte.

Recursos avançados de automação autônoma, build e orquestração ficam fora do
contrato atual da 1.0.
