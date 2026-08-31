# Desempenho e orçamentos internos

O Nocturne Studio trata desempenho como parte da estabilidade. Os limites de
coleções, buffers, paginação, persistência e backup são exercitados por testes.
O renderer também publica métricas agregadas para o log local de diagnóstico.

## Métricas do renderer

O renderer mede:

- tempo até concluir a inicialização;
- tempo da abertura mais recente de uma conversa;
- quantidade e duração acumulada de tarefas longas;
- duração da maior tarefa longa observada;
- tamanhos dos buffers de resposta, atividades e mensagens.
- contagens agregadas de renderização para o shell, chat, composer, container do
  agent inspector e superfície de atividades.

O cenário de renderer em `tests/renderer/renderer.spec.ts` exercita eventos de
atividade durante uma execução e compara as contagens do container com as da
superfície de atividades. Isso mantém a separação observável sem enviar
conteúdo de prompt, resposta ou arquivos ao diagnóstico.

Os orçamentos de referência ficam em `shared/constants.ts`:

- inicialização: 5 segundos;
- abertura de conversa: 2 segundos;
- tarefa longa: 50 milissegundos.

Uma ultrapassagem é marcada no evento estruturado do log. Ela não interrompe a
operação e serve para tornar regressões observáveis durante testes e suporte.

## Privacidade

As métricas contêm somente números agregados. O contrato IPC é estrito e rejeita
campos extras, portanto prompts, respostas, nomes de arquivos, caminhos e outros
conteúdos do usuário não podem ser enviados por esse canal.

Os relatórios permanecem locais e seguem a sanitização e a retenção descritas em
`docs/diagnostics.md`.
