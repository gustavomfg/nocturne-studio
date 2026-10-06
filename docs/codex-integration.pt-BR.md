# Integração Codex CLI

[English](codex-integration.md)

O Nocturne Studio integra-se ao Codex CLI pelo App Server.

- CLI mínimo suportado: `0.145.0`;
- CLI recomendado: `0.146.0`;
- versões verificadas: `0.145.0` e `0.146.0`.

## Autenticação e compatibilidade

Autentique pelo Codex CLI usando o fluxo de conta adequado à sua instalação. O
Nocturne verifica versão do executável, estado de autenticação e contrato real
do App Server. Antes de iniciar uma execução, ele exige resposta tipada de
`initialize`, resposta segura de `config/read` e `model/list` validado e não
vazio; só então as respostas reais de `thread/start` e `turn/start` estabelecem
as identidades de thread e turno. CLI ausente, não autenticado, capability
ausente ou resposta incompatível gera diagnóstico recuperável, não um Provider
utilizável desconhecido.

Versões novas não exigem editar dependência, mas precisam passar por esse
contrato de execução em tempo de execução. O diagnóstico autenticado opcional
pode ser executado localmente com `npm run smoke:codex`; ele não é pré-requisito
de release estável. A interface do App Server é experimental.

## Conversas e modos

A lista retornada de modelos é filtrada para a conta e o modelo escolhido é
enviado explicitamente no início de thread e turno. Threads do Codex podem ser
retomadas com as raízes e políticas atuais do workspace. Cancelamento usa os
identificadores exatos de thread e turno. Só uma execução de agente fica ativa
por vez.

Todos os eventos de turno encaminhados, inclusive conteúdo, plano, diff,
progresso e aprovações, exigem os identificadores da thread e do turno ativos.
Eventos sem identidade ou com identidade divergente são descartados; aprovações
não atribuíveis são recusadas. Até 64 eventos antecipados aguardam a resposta de
`turn/start` e só são reproduzidos para o turno correspondente. Exceder esse
limite falha de forma conservadora. Essa guarda local não certifica todas as
versões autenticadas do Codex CLI.

Review usa sandbox somente leitura. Build usa sandbox de escrita limitada à raiz
autorizada, rede desabilitada e aprovações do usuário. Docs usa geração somente
leitura e aplica Markdown pela fronteira de preview e confirmação do Nocturne.

## Falhas

Se o CLI estiver ausente, sem autenticação, incompatível, exceder o tempo ou
encerrar, a operação termina com erro visível e cleanup. O renderer nunca
recebe credenciais Codex nem o transporte de processo genérico. Use
**Configurações > IA > Diagnóstico** para um relatório sanitizado.
