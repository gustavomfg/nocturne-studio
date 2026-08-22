# Auditoria de segurança para a linha 1.0

Data da revisão: 30 de julho de 2026.

Esta auditoria verifica as superfícies exigidas pelo plano de estabilização. O
resultado descreve controles presentes no código e testes reproduzíveis; não é
uma certificação externa.

## Resultado

| Superfície | Controle verificado | Evidência automatizada | Estado |
| --- | --- | --- | --- |
| Path Traversal | normalização, raiz autorizada e rejeição de caminhos externos | `tests/security.test.ts`, `tests/electronBoundaries.e2e.test.ts` | aprovado |
| Symlink | resolução real antes do acesso e rejeição de escape | `tests/security.test.ts`, `tests/workspaceTrust.test.ts` | aprovado |
| Prompt Injection | contexto e anexos marcados como dados não confiáveis; permissões aplicadas fora do modelo | `tests/conversationContext.test.ts`, `tests/openAICompatibleProviderAdapter.test.ts`, `tests/codexClient.test.ts` | mitigado |
| Markdown hostil | HTML não habilitado, links limitados a HTTPS e imagens Markdown bloqueadas | `tests/safeMarkdown.test.ts`, CSP em `index.html` | aprovado |
| DNS Rebinding | resolução validada e conexão fixada ao endereço público aprovado | `tests/openAICompatibleProviderAdapter.test.ts` | aprovado |
| SSRF | HTTPS remoto obrigatório, loopback somente para provider local, redirects e redes reservadas recusados | `tests/openAICompatibleProviderAdapter.test.ts` | aprovado |
| Workspace malicioso | autorização explícita, Review somente leitura, anexos limitados e execução sem rede | `tests/security.test.ts`, `tests/taskBuilder.test.ts`, `tests/codexClient.test.ts` | aprovado |
| Arquivos gigantes | limites para anexos, preview, contexto, diffs, RPC, stream e backup | `tests/storeLimits.test.ts`, `tests/conversationContext.test.ts`, `tests/gitStatus.test.ts`, `tests/backupSchemas.test.ts` | aprovado |
| Corrupção de dados | integridade SQLite, quarentena, restauração guiada, checksum e importação transacional | `tests/databaseRecovery.test.ts`, `tests/migrationRehearsal.test.ts`, `tests/backupSchemas.test.ts` | aprovado |

## Fronteiras revisadas

- O renderer mantém `contextIsolation`, sandbox e `nodeIntegration: false`.
- O preload oferece somente operações nomeadas; IPC valida origem, payload e
  autorização.
- Credenciais permanecem no processo principal, cifradas pelo sistema
  operacional, e não entram em backup ou diagnóstico.
- Review Mode aplica acesso somente leitura independentemente da configuração.
- Build Mode limita escrita à raiz autorizada, desabilita rede e mantém
  aprovação humana.
- CSP impede conexões e recursos remotos no renderer de produção.
- Pacotes preservam ASAR, integridade e fuses de produção.

## Risco residual

Prompt injection é um risco inerente ao processamento de conteúdo não confiável
por modelos. As instruções adicionadas reduzem a chance de obediência ao
conteúdo, mas a garantia efetiva vem das fronteiras externas ao modelo:
permissões, sandbox, aprovação, validação de caminhos, rede desabilitada e Review
somente leitura.

Links HTTPS só abrem por ação do usuário no navegador externo. O conteúdo desse
site deixa então a fronteira do aplicativo.

## Critério de repetição

Antes de uma release estável, executar no commit exato da tag:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:renderer
npm run verify:release-assets -- release-assets
```

Falha em qualquer barreira de escrita, credencial, migração, atualização ou
fluxo principal bloqueia a publicação.
