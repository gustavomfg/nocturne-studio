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

Validação é uma solicitação explícita para rodar um comando escolhido pelas
evidências do stack em um workspace autorizado. O renderer não pode fornecer
executável ou argumentos: o Nocturne registra o comando e argumentos planejados,
revalida a autorização imediatamente antes do spawn, relê o script selecionado
em `package.json` e bloqueia se ele mudou. A validação roda sem shell e com
ambiente herdado restrito, mas executa deliberadamente código controlado pelo
projeto com os privilégios do sistema operacional do desenvolvedor. Ela não é
um sandbox do sistema operacional.

No POSIX, processos supervisionados de validação, Git, exportação de documentos
e Codex usam grupo de processo dedicado; o cancelamento pede o encerramento do
grupo antes de escalar. No Windows, a primitiva Node só alcança o filho direto;
um timeout de validação cujo encerramento final não puder ser confirmado é
registrado como falha incerta, não como cancelamento bem-sucedido. Um terminal
destacado aberto para o usuário fica intencionalmente fora da propriedade de
ciclo de vida do Nocturne.

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
produção do Electron. Releases estáveis exigem verificação de checksum e
assinatura de plataforma somente onde a política de release afirma isso:
atualmente o Linux tem manifesto de checksum assinado por GPG no ambiente
protegido, enquanto Windows e macOS não têm assinatura nem notarização. Também
é executado o smoke do contrato Codex no commit exato da tag. Isso reduz riscos,
mas não constitui certificação de segurança.
