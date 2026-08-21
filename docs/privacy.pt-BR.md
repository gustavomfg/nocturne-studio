# Privacidade

[English](privacy.md)

O Nocturne Studio é local-first. Banco local, conversas, sugestões, memórias,
configurações e logs ficam no dispositivo, no diretório de dados do produto.

Conteúdo sai do dispositivo somente quando o usuário executa uma tarefa com um
Provider remoto ou com o Codex CLI autenticado. A requisição pode incluir
prompt, conversa/contexto selecionado e arquivos anexados explicitamente.
Providers locais recebem requisições no endpoint de loopback configurado.

Credenciais de Providers:

- ficam no processo principal do Electron;
- são cifradas pelo armazenamento seguro do sistema;
- nunca atravessam a API renderer/preload;
- não são exportadas para backups ou diagnósticos.

Diagnósticos usam identificador aleatório de sessão, campos limitados e remoção
de credenciais, prompts, respostas, diffs, conteúdo de arquivos e caminhos
sensíveis. Métricas de desempenho contêm somente números agregados. Também se
aplicam as políticas do Provider escolhido e do serviço Codex ao conteúdo
enviado.

O Nocturne Studio é independente e não é um produto oficial da OpenAI.
