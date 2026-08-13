# Compatibilidade oficial

## Aplicativo

| Plataforma | Arquitetura e pacote da release |
| --- | --- |
| Windows 10/11 | x64, instalador NSIS |
| Linux desktop atual | x64, AppImage ou tar.gz |
| macOS mantido pela build oficial | arquitetura do artefato assinado, DMG |

Somente combinações produzidas e aprovadas pelo workflow
`Release · stable` são consideradas suportadas. Pacotes locais ou builds em
outra arquitetura são de desenvolvimento até passarem pelo mesmo smoke.

## Desenvolvimento

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- Electron `43.x`;
- SQLite via `better-sqlite3` reconstruído para o Electron adotado.

Antes de iniciar a suíte, o runner verifica o ABI do Electron carregando
`better-sqlite3` no runtime embutido. Em caso de falha, execute
`npm run rebuild:native` e tente novamente. Para executar somente esse
diagnóstico, use `npm run test:abi`.

## IA

- Codex CLI mínimo `0.145.0`;
- recomendado `0.146.0`;
- verificados `0.145.0` e `0.146.0`;
- versões mais novas são detectadas automaticamente quando atendem ao mínimo;
- Providers OpenAI-compatible remotos por HTTPS;
- Ollama, LM Studio e endpoints locais por loopback.

Anthropic nativo, plugins, múltiplos agentes, nuvem e execução totalmente
autônoma não fazem parte da compatibilidade da linha atual.

O contrato do Codex App Server permanece experimental. O mínimo evita versões
antigas demais, enquanto o handshake real do App Server valida a sessão antes
do uso. O smoke `npm run smoke:codex` continua sendo a validação explícita para
uma release; a lista de versões verificadas não precisa ser alterada a cada
versão nova do CLI.
