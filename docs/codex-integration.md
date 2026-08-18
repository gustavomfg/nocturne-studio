# Integração Codex CLI

O Nocturne Studio é compatível com o Codex CLI.

Compatibilidade mínima: 0.145.0.

Versões verificadas: 0.145.0 e 0.146.0.

Versão recomendada: 0.146.0.

Versões futuras acima do mínimo não exigem alteração manual da matriz. O
Nocturne detecta a versão instalada e usa o handshake do App Server como gate
de compatibilidade em tempo real. Se o protocolo falhar, a sessão é bloqueada
com um diagnóstico explícito.

## Verificação

O contrato de compatibilidade é validado pelo smoke test:
`npm run smoke:codex`.

Além da versão do executável e do estado de autenticação, a tela de IA realiza
um handshake real com o App Server e uma leitura segura de `config/read`. Isso
confirma que o transporte e pelo menos um método de leitura do contrato estão
disponíveis antes de marcar a integração como compatível. Falhas de
inicialização, respostas incompatíveis e erros internos são exibidos
separadamente de “não instalado” e “não autenticado”. Como a interface do App
Server é experimental, uma versão abaixo do mínimo ou um contrato inválido
falha de forma fechada.

## Modelos da conta ChatGPT

Após autenticar pelo Codex CLI, o Nocturne consulta `model/list` no App Server
e apresenta somente os modelos visíveis disponibilizados para aquela conta.
A escolha é persistida nas configurações locais e enviada explicitamente em
`thread/start` e `turn/start`.

Essa seleção pertence ao acesso por conta ChatGPT. Providers OpenAI-compatible
continuam usando chave de API, catálogo e cobrança separados.

## Recuperação de sessão

As threads do Codex são persistentes e o identificador retornado pelo App Server
é associado localmente à conversa. Ao reabrir uma conversa ou após reiniciar o
App Server, o Nocturne usa `thread/resume` com o workspace, as raízes autorizadas
e as políticas atuais reaplicadas. Se a thread externa não existir mais, uma
nova thread é criada com o histórico local da conversa.

O cancelamento usa `turn/interrupt` com os identificadores exatos de thread e
turno. Se o processo cair durante uma execução, o turno é encerrado com erro
visível e o coordenador libera a conversa; a tentativa seguinte reinicia o App
Server e retoma a sessão persistida.
