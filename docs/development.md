# Desenvolvimento

Requer Node.js >=24.18 <25 e npm >=11 <12.

Codex CLI: versão mínima 0.145.0; versões verificadas 0.145.0 e 0.146.0.
Versões mais novas são detectadas automaticamente e precisam passar pelo
handshake do App Server; não fixe uma nova versão no código apenas porque o
CLI foi atualizado.

## Comandos

- `npm run dev` — inicia o app em modo desenvolvimento
- `npm test` — executa os testes
- `npm run lint` — verifica codigo
- `npm run typecheck` — verifica tipos
- `npm run build` — compila para producao

## Automação

Consulte [GitHub Actions e releases](github-actions.md) para os gatilhos dos
workflows, a configuração do runner dedicado e as credenciais de assinatura.
