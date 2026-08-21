# Política de segurança

[English](SECURITY.md)

O Nocturne Studio é um aplicativo desktop local, mas lida com arquivos de
projeto, credenciais de Providers e comunicação com serviços de IA externos.
Relatos de segurança são bem-vindos.

## Como relatar uma vulnerabilidade

Não inclua segredos, arquivos de projeto ou prompts privados em uma issue
pública. Use o recurso GitHub Security Advisory do repositório para um relato
privado quando ele estiver disponível. Se o relato privado não estiver
disponível, abra uma issue mínima sem dados sensíveis e peça aos mantenedores um
canal privado.

Inclua, quando for seguro:

- versão ou commit afetado;
- sistema operacional e arquitetura;
- impacto e uma reprodução mínima;
- comportamento esperado e observado;
- mitigação ou workaround, se conhecido.

Antes de compartilhar logs, remova chaves de API, tokens, cookies, bancos,
conteúdo do workspace e informações pessoais.

## Escopo de segurança suportado

A política cobre o aplicativo desktop, as fronteiras Electron entre main,
preload e renderer, validação IPC, autorização e contenção de workspaces,
persistência e recuperação, integrações de Providers, armazenamento de
credenciais e atualizações empacotadas. Providers externos e o Codex CLI têm
suas próprias políticas.

O repositório está preparado como candidato `1.0.0`. O suporte estável dessa
versão começa somente depois da tag `v1.0.0` e da publicação protegida; o
candidato ainda não foi publicado. Notas históricas de betas não prometem
suporte a versões antigas.

## Projeto de segurança

- `contextIsolation` e o sandbox do renderer ficam habilitados; Node integration
  fica desabilitado.
- O preload expõe APIs nomeadas, não uma ponte IPC genérica.
- IPC valida origem, payload, taxa e autorização do workspace antes de iniciar
  operações nativas.
- Review Mode é somente leitura. Build limita escritas ao workspace autorizado,
  usa aprovações do Codex e desabilita rede no sandbox do agente.
- Caminhos do workspace são contidos e leituras limitadas rejeitam traversal e
  escapes por symlink quando a plataforma permite essa proteção.
- Credenciais de Providers são cifradas pelo armazenamento seguro do sistema
  operacional, nunca retornam ao renderer e ficam fora de backups e diagnósticos.
- Conexões remotas OpenAI-compatible exigem HTTPS, recusam redirects e validam
  endereços resolvidos para reduzir riscos de SSRF e DNS rebinding.
- Builds empacotadas usam ASAR, validação de integridade embutida e fuses do
  Electron.

Essas são mitigações implementadas, não uma certificação formal de segurança.
