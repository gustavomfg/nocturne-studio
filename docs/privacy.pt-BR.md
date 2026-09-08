# Privacidade

[English](privacy.md)

O Nocturne Studio é local-first. Banco local, conversas, sugestões, memórias,
configurações e logs ficam no dispositivo, no diretório de dados do produto.

Conteúdo sai do dispositivo somente quando o usuário executa uma tarefa com um
Provider remoto ou com o Codex CLI autenticado. A requisição pode incluir
prompt, conversa/contexto selecionado e arquivos anexados explicitamente.
Providers locais recebem requisições no endpoint de loopback configurado.

A indexação semântica segue a mesma fronteira local-first. O binding do modelo
de embeddings é separado do binding do modelo de conversa. A indexação lexical
e estrutural funciona sem Provider. Embeddings remotos ficam desativados até que
o workspace autorize explicitamente; arquivos excluídos, potencialmente
secretos e não suportados são filtrados antes da leitura pelo pipeline
semântico. Com autorização remota, somente chunks aprovados e não sensíveis são
enviados; os vetores resultantes permanecem no SQLite local. Falhas do Provider
usam fallback lexical/estrutural local.

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
