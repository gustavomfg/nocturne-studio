# Solução de problemas

## O projeto não abre

Confirme que a pasta existe e possui permissão de leitura. Para um projeto
movido, use **Localizar pasta**. O histórico local é preservado enquanto a raiz
estiver indisponível.

## Codex não aparece ou não lista modelos

Verifique **Configurações > IA > Diagnóstico**. Instale o Codex CLI na versão
mínima indicada, faça login pelo Codex CLI e reinicie a verificação. Versões
mais novas são detectadas automaticamente; se o handshake do App Server falhar,
use o smoke de contrato antes de atualizar a release do Nocturne.

## A API informa falta de créditos

Saldo da API e assinatura ChatGPT são produtos separados. Adicione crédito à
conta da API, troque de Provider ou conecte a conta ChatGPT pelo Codex CLI.

## Provider não conecta

Revise URL, HTTPS, credencial e catálogo. Para Ollama ou LM Studio, confirme que
o serviço local está ativo no endereço de loopback configurado. Use o
diagnóstico para distinguir timeout, autenticação, rate limit e resposta
inválida.

## Uma execução foi interrompida

O erro informa o que foi preservado. Use **Tentar novamente** quando disponível.
Build mantém logs e oferece rollback somente quando existe um snapshot
reversível válido.

## Atualização falhou

Escolha **Retomar download**. A versão atual e os dados locais permanecem
intactos até um pacote ser baixado, validado e confirmado.

## Banco ou restauração falhou

Não apague os arquivos locais. Use a recuperação guiada ou importe um backup
verificado. Exporte um diagnóstico sanitizado em **Dados e diagnóstico** para
investigar sem incluir conteúdo privado.
