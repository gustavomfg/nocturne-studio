# Fronteiras de segurança

[English](security.md)

## Electron e IPC

- `contextIsolation` e o sandbox do renderer ficam habilitados;
- Node integration fica desabilitado;
- o preload expõe métodos nomeados, nunca um `ipcRenderer` genérico;
- IPC valida origem, formato do payload, limites de taxa e autorização;
- operações privilegiadas e credenciais ficam no processo principal;
- navegação externa e permissões do navegador são negadas por padrão.

## Workspace e execução

Caminhos são normalizados e contidos no workspace explicitamente selecionado.
Leituras limitadas rejeitam traversal, caminhos absolutos externos e escapes por
symlink na fronteira de arquivo relevante. Workspaces restaurados ficam sem
autorização até nova seleção. Review é somente leitura. Build usa sandbox Codex
limitado ao workspace, rede desabilitada e aprovações explícitas.

Providers OpenAI-compatible remotos exigem HTTPS, recusam redirects e validam
todos os endereços resolvidos antes de fixar a conexão. HTTP sem TLS só é aceito
para serviços locais em loopback.

## Credenciais e dados locais

Chaves de Provider são cifradas com `safeStorage` do Electron, referenciadas por
identificadores opacos e excluídas de backups e diagnósticos. A sessão ChatGPT
continua no cofre do próprio Codex CLI. SQLite, WAL/SHM, snapshots, contexto do
workspace e arquivos de credencial usam permissões restritivas quando a
plataforma oferece essa capacidade. Logs são sanitizados e o diagnóstico
detalhado é opt-in.

## Distribuição

Builds empacotadas usam ASAR, validação de integridade embutida e fuses de
produção do Electron. Releases estáveis exigem assinatura por plataforma,
verificação de checksum e smoke do contrato Codex no commit exato da tag. Isso
reduz riscos, mas não constitui certificação de segurança.
