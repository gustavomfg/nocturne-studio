# Compatibilidade

A restauração protegida tem contrato mais restrito que a aplicação:
[rollback V1](native-rollback-v1.md) suporta Linux tmpfs/ext4/Btrfs local,
macOS APFS e Windows NTFS em volume fixo, com restrições de tipo/permissão/tamanho.
Outros ambientes recusam a mutação com `UNSUPPORTED`; captura de checkpoints,
inspeção de diffs e aceitação continuam disponíveis. O worker nativo exige
toolchain C++17 de desenvolvimento, sem alterar o ABI SQLite/Electron.

[English](compatibility.md)

## Alvos oficiais do aplicativo

| Plataforma | Artefato de release |
| --- | --- |
| Windows 10/11 | instalador NSIS x64 |
| Linux desktop | AppImage ou `tar.gz` da arquitetura publicada |
| macOS | DMG e ZIP do atualizador da arquitetura publicada |

Somente artefatos publicados pelo workflow automatizado de release após seus
gates de validação são releases oficiais. Pacotes locais e builds de outra arquitetura são artefatos
de desenvolvimento até passarem pelos mesmos smoke checks e gates.

## Compatibilidade de desenvolvimento

- Node.js `>=24.18 <25`;
- npm `>=11 <12`;
- Electron 43.x;
- `better-sqlite3` 13.x com N-API, verificado no runtime Electron adotado e no
  Node.js de desenvolvimento.

Use `npm run test:abi` para verificar o carregamento do módulo nativo no
runtime empacotado antes da suíte completa. A compatibilidade N-API não
substitui o smoke do pacote.

## Compatibilidade de IA

- Codex CLI mínimo: `0.145.0`;
- recomendado: `0.146.0`;
- verificado: `0.145.0` e `0.146.0`;
- versões novas exigem contrato de execução real bem-sucedido do App Server;
- endpoints OpenAI-compatible remotos exigem HTTPS;
- Ollama e LM Studio locais usam loopback.

Não há adapters nativos dedicados para Anthropic, Gemini ou GitHub Copilot no
contrato atual. O Codex App Server continua experimental.
