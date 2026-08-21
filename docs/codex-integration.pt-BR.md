# Integração Codex CLI

[English](codex-integration.md)

O Nocturne Studio integra-se ao Codex CLI pelo App Server.

- CLI mínimo suportado: `0.145.0`;
- CLI recomendado: `0.146.0`;
- versões verificadas: `0.145.0` e `0.146.0`.

## Autenticação e compatibilidade

Autentique pelo Codex CLI usando o fluxo de conta adequado à sua instalação. O
Nocturne verifica versão do executável, estado de autenticação e contrato real
do App Server. A inicialização inclui handshake de protocolo e uma sondagem
segura de `config/read`; a descoberta usa `model/list`. CLI ausente, não
autenticado ou resposta incompatível gera diagnóstico recuperável, não um
Provider utilizável desconhecido.

Versões novas não exigem editar dependência, mas precisam passar pelo handshake
em tempo de execução. A interface do App Server é experimental.

## Conversas e modos

A lista retornada de modelos é filtrada para a conta e o modelo escolhido é
enviado explicitamente no início de thread e turno. Threads do Codex podem ser
retomadas com as raízes e políticas atuais do workspace. Cancelamento usa os
identificadores exatos de thread e turno. Só uma execução de agente fica ativa
por vez.

Review usa sandbox somente leitura. Build usa sandbox de escrita limitada à raiz
autorizada, rede desabilitada e aprovações do usuário. Docs usa geração somente
leitura e aplica Markdown pela fronteira de preview e confirmação do Nocturne.

## Falhas

Se o CLI estiver ausente, sem autenticação, incompatível, exceder o tempo ou
encerrar, a operação termina com erro visível e cleanup. O renderer nunca
recebe credenciais Codex nem o transporte de processo genérico. Use
**Configurações > IA > Diagnóstico** para um relatório sanitizado.
