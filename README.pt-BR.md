# Nocturne Studio

> Um workspace desktop local-first para entender, revisar e evoluir projetos de software reais com IA.

[English](README.md)

O Nocturne Studio mantém juntos o workspace de um projeto, suas conversas,
achados de engenharia e conhecimento durável. Ele é um workspace desktop de
engenharia, não uma IDE, uma substituição autônoma do desenvolvedor nem um
produto oficial da OpenAI.

Ele enfrenta a fragmentação de contexto dos tools baseados apenas em prompts:
estado do projeto, evidências de revisão, decisões e conhecimento aprovado
continuam conectados em vez de serem reconstruídos a cada conversa.

![Workspace do Nocturne Studio](docs/images/Captura_de_tela_20260803_145710.png)

## O que ele faz

- **Workspaces:** seleciona e autoriza explicitamente uma pasta de projeto;
  workspaces movidos ou restaurados continuam sem autorização até serem
  selecionados novamente.
- **Review Mode:** análise somente leitura com sugestões baseadas em evidências
  e reconciliação de achados novos, persistentes e resolvidos.
- **Build Mode:** alterações assistidas pelo Codex dentro do workspace autorizado,
  com aprovações, progresso, diff visível e rollback protegido quando suas
  precondições são atendidas.
- **Docs Mode:** preview, comparação e aplicação incremental de Markdown com
  confirmação, verificação de concorrência e escrita atômica.
- **Segundo Cérebro e Awareness:** memórias locais estruturadas com aprovação,
  escopo, atualidade e explicação do contexto selecionado para cada execução.
- **Conversas e Git:** conversas persistentes, históricos paginados, estado Git
  do workspace e preparação de commits.
- **Camada de Providers:** conta ChatGPT pelo Codex CLI/App Server e endpoints
  remotos e locais compatíveis com OpenAI.

O desenvolvedor continua responsável pela intenção, aprovação, revisão e
alteração final no projeto.

## Artefatos de release suportados

A validação oficial de release cobre atualmente:

| Plataforma | Artefato configurado pelo build |
| --- | --- |
| Windows 10/11 | instalador NSIS x64 (`.exe`) |
| Linux desktop | AppImage e `tar.gz` (vale a arquitetura do build publicado) |
| macOS | DMG e ZIP do atualizador (vale a arquitetura do build publicado) |

A validação de pacotes sem assinatura roda em Linux, Windows e macOS. Uma
release estável também precisa passar pelos gates protegidos de assinatura,
notarização e checksums; consulte [instalação](docs/installation.pt-BR.md) e
[compatibilidade](docs/compatibility.pt-BR.md).

## Conexões de IA

Review pode usar um Provider OpenAI-compatible configurado. Build e Docs usam o
Codex CLI/App Server. Os destinos compatíveis incluem OpenAI API, OpenRouter,
DeepSeek, Ollama, LM Studio e endpoints customizados compatíveis. Uma assinatura
ChatGPT é conectada pelo Codex CLI e é separada da cobrança da OpenAI Platform.

As credenciais de API dos Providers são cifradas pelo armazenamento seguro do
sistema operacional, ficam no processo principal e não entram em backups ou
diagnósticos. Consulte [Providers](docs/providers.pt-BR.md) e [integração Codex](docs/codex-integration.pt-BR.md).

## Dados locais e recuperação

Conversas, configurações, catálogo de modelos e conhecimento estruturado ficam
em um banco SQLite local. Arquivos de contexto do workspace usam escritas
limitadas e atômicas. O aplicativo valida o banco, cria snapshots antes de
operações destrutivas e pode colocar um banco corrompido em quarentena antes de
restaurar um candidato válido com confirmação do usuário. Backups não incluem
arquivos do projeto nem credenciais de Providers. Esses mecanismos reduzem o
risco de recuperação; não são promessa de durabilidade absoluta contra toda
falha de hardware ou filesystem.

Leia [backup e recuperação](docs/backup-and-recovery.pt-BR.md) antes de mover
ou restaurar um workspace.

## Segurança e privacidade

O renderer usa isolamento, sandbox e nenhuma integração Node.js. Capacidades
nativas atravessam APIs nomeadas do preload e handlers IPC validados. Caminhos
do workspace são contidos e rechecados, Review permanece somente leitura e
Providers remotos usam HTTPS com validação de endereços. O Nocturne é local-first,
mas prompts, contexto e anexos selecionados são enviados ao Provider escolhido.
Consulte [segurança](docs/security.pt-BR.md), [privacidade](docs/privacy.pt-BR.md)
e [SECURITY.md](SECURITY.pt-BR.md).

## Requisitos para desenvolvimento

- Node.js `>=24.18 <25`
- npm `>=11 <12`
- ferramentas nativas compatíveis com `better-sqlite3`

```bash
npm ci
npm run dev
```

A lista completa está em [desenvolvimento](docs/development.pt-BR.md).

## Estado atual

O repositório está preparado como candidato `v1.0.0`. Ele ainda não foi
tagueado nem publicado; artefatos assinados, validação do SHA final e aprovação
da release estável protegida ainda são necessários.
O contrato do Codex App
Server é experimental; o CLI mínimo suportado é `0.145.0` e o recomendado é
`0.146.0`. Versões mais novas precisam passar pelo handshake de compatibilidade
em tempo de execução.

Limitações conhecidas da 1.0 incluem o contrato experimental do Codex App
Server, adapters OpenAI-compatible sem tool calling normalizado e recursos
avançados de automação/autonomia fora dos modos protegidos atuais. Adapters
nativos dedicados para Anthropic, Gemini e GitHub Copilot, marketplace,
colaboração em nuvem e orquestração multiagente não fazem parte deste contrato.

## Documentação

- [Índice da documentação](docs/README.pt-BR.md) · [English](docs/README.md)
- [Instalação](docs/installation.pt-BR.md) · [English](docs/installation.md)
- [Primeiro uso](docs/getting-started.pt-BR.md) · [English](docs/getting-started.md)
- [Providers](docs/providers.pt-BR.md) · [English](docs/providers.md)
- [Configuração](docs/configuration.pt-BR.md) · [English](docs/configuration.md)
- [Integração Codex](docs/codex-integration.pt-BR.md) · [English](docs/codex-integration.md)
- [Review, Build e Docs](docs/modes.pt-BR.md) · [English](docs/modes.md)
- [Segundo Cérebro e Awareness](docs/second-brain.pt-BR.md) · [English](docs/second-brain.md)
- [Backup e recuperação](docs/backup-and-recovery.pt-BR.md) · [English](docs/backup-and-recovery.md)
- [Atualizações](docs/updates.pt-BR.md) · [English](docs/updates.md)
- [Segurança](docs/security.pt-BR.md) · [English](docs/security.md)
- [Privacidade](docs/privacy.pt-BR.md) · [English](docs/privacy.md)
- [Solução de problemas](docs/troubleshooting.pt-BR.md) · [English](docs/troubleshooting.md)
- [Desenvolvimento](docs/development.pt-BR.md) · [English](docs/development.md)
- [Arquitetura](docs/architecture.pt-BR.md) · [English](docs/architecture.md)
- [Notas da versão 1.0.0](docs/releases/v1.0.0.pt-BR.md) · [English](docs/releases/v1.0.0.md)
- [Checklist do candidato de release](docs/release-rc-checklist.pt-BR.md) · [English](docs/release-rc-checklist.md)
- [Prontidão da release (mantenedores)](docs/release-readiness-1.0.md)

English é a fonte pública canônica. As traduções em português usam o sufixo
`.pt-BR.md` e preservam títulos, comandos, caminhos e nomes técnicos.

## Licença

Nocturne Studio é distribuído sob a [licença MIT](LICENSE).
