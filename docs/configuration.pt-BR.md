# Configuração

[English](configuration.md)

Abra **Configurações** para definir modelo selecionado, sandbox e política de
aprovação do Codex, logs detalhados, conexões de Providers e o tema da
interface. O tema escuro é o padrão; o tema claro também está disponível em
Aplicativo.

## Providers e bindings de modelos

Definições de Providers e referências opacas de credenciais são armazenadas
localmente. Atualize o catálogo de modelos do Provider e associe um modelo
disponível ao workspace. Remover um Provider também remove sua referência de
credencial, mas não remove conversas ou histórico de workspace não relacionados.

O índice semântico possui um binding opcional e separado para o modelo de
embeddings. Escolha nas configurações do índice um modelo disponível com a
capacidade `embeddings`. Modelos remotos exigem um consentimento explícito;
manter o binding desativado ou o consentimento desligado mantém a indexação
local e lexical/estrutural.

## Confiança do workspace

Selecionar uma pasta é uma decisão de autorização, não apenas um registro de
caminho recente. Workspaces restaurados ou movidos precisam ser selecionados
novamente antes de arquivos, Git, memória ou IA poderem usá-los.

## Ferramentas externas do workspace

O atalho de editor usa o launcher `webstorm` do WebStorm. Se não estiver
disponível, o aplicativo informa o erro em vez de escolher outro editor.
Windows abre o prompt do sistema com o workspace como cwd do processo; macOS
abre Terminal. Linux procura GNOME Terminal, Konsole, Xfce Terminal, kitty,
Alacritty, a alternativa Debian ou xterm. `TERMINAL` pode priorizar um desses
nomes/caminhos de executáveis, sem argumentos. Strings de comandos não são
executadas. Esses aplicativos pertencem ao usuário e ficam separados da
supervisão dos jobs internos do Nocturne.

## Diagnóstico

Logs detalhados são opt-in. Logs e relatórios de diagnóstico são sanitizados,
locais e limitados. Revise um relatório antes de compartilhá-lo fora do
dispositivo.
