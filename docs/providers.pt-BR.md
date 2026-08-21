# Providers e modelos

[English](providers.md)

## Conta ChatGPT

Conecte uma conta ChatGPT pelo Codex CLI. O Nocturne não recebe senha ou token
da conta: usa o App Server autenticado do Codex e lista os modelos retornados
para aquela conta. Uma assinatura ChatGPT não fornece créditos da OpenAI
Platform API.

Build e Docs usam esse caminho do Codex. Review pode usá-lo quando nenhum modelo
de API compatível estiver selecionado.

## Conexões OpenAI-compatible

O adapter atual suporta OpenAI API, OpenRouter, DeepSeek, Ollama, LM Studio e
endpoints customizados que implementem os recursos compatíveis de modelos e
chat completions. Endpoints remotos exigem HTTPS. HTTP simples é aceito apenas
para Providers locais em loopback.

O adapter oferece descoberta de modelos, streaming e cancelamento. Tool calling
não é normalizado por esse adapter e aparece como limitação. Atualize o catálogo
antes de associar um modelo ao workspace.

## Credenciais e diagnóstico

Chaves de Provider são cifradas pelo armazenamento seguro do sistema
operacional. No SQLite existem apenas referências opacas; elas nunca retornam
ao renderer e ficam fora de backups e relatórios de diagnóstico.

O painel de diagnóstico diferencia endpoint indisponível, credencial recusada,
modelo ausente, timeout, rate limit, resposta inválida e créditos insuficientes.
Uma falha de Provider é recuperável e não significa que o processo principal
falhou.

## Casos comuns

- **Créditos insuficientes:** adicione saldo na conta da API ou escolha outro
  Provider; plano ChatGPT e cobrança de API são separados.
- **Chave inválida:** substitua a credencial.
- **Modelo ausente:** atualize o catálogo e escolha um modelo disponível.
- **Rate limit:** aguarde a janela indicada pelo serviço.
- **Endpoint local offline:** inicie Ollama ou LM Studio e confirme o endereço
  de loopback.
