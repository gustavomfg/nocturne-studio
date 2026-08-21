# Arquitetura

[English](architecture.md)

O Nocturne Studio é um workspace desktop Electron. O renderer apresenta estado
e solicita operações; não recebe acesso a Node.js, Electron, credenciais ou ao
filesystem diretamente.

## Processos e fronteiras

- `src/` contém o renderer React.
- `electron/preload.ts` expõe métodos nomeados e tipados pelo `contextBridge`.
- `electron/ipc/` valida origem, payload, limites de taxa e autorização do
  workspace antes de iniciar operações nativas.
- O processo principal do Electron mantém SQLite, arquivos, Git, Providers e o
  Codex App Server.
- `shared/` contém contratos e limites compartilhados pelas duas partes.

O BrowserWindow usa `contextIsolation: true`, `sandbox: true` e
`nodeIntegration: false`. Navegação externa é negada; links HTTPS permitidos
são abertos pelo sistema operacional.

## Execução de IA

Codex CLI/App Server é usado no caminho de conta e nos modos Build e Docs.
Review usa políticas somente leitura. Build usa política de escrita limitada ao
workspace, aprovações explícitas e rede desabilitada no sandbox do agente.

Providers OpenAI-compatible usam um contrato separado para descoberta de
modelos, streaming, cancelamento, respostas limitadas e diagnóstico. Tool
calling não é normalizado por esse adapter. Credenciais permanecem no processo
principal.

## Estado local

SQLite armazena conversas, mensagens, configurações, catálogos de modelos,
bindings, sugestões e conhecimento estruturado. Migrações são transacionais e o
banco usa WAL com `synchronous=FULL`. Arquivos de contexto do workspace têm
limites e escrita atômica. Backups usam envelope versionado e checksum; a
restauração cria primeiro um snapshot local.

Workspaces restaurados não são autorizados automaticamente. O workspace ativo é
observado por um único backend Chokidar, com diretórios gerados ignorados,
reconciliação limitada e eventos semânticos agrupados.

## Modelo de confiança

O desenvolvedor controla a escolha do Provider, a autorização do workspace, as
aprovações, as decisões de Review e as mudanças finais. Memória persistente é
tratada como dado não confiável e potencialmente desatualizado, não como
instrução executável.
