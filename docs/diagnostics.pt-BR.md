# Diagnóstico e privacidade

[English](diagnostics.md)

Cada inicialização recebe um identificador aleatório de sessão. Logs locais são
estruturados e contêm data, sessão, nível, categoria, evento e dados
operacionais limitados.

Antes de gravar, o logger remove campos de credencial, prompt, conteúdo, diff e
saída bruta; mascara padrões conhecidos de tokens e headers de autorização;
limita strings, listas, objetos e profundidade; e usa rotação local com
permissões restritivas. O tráfego bruto do Codex App Server não é armazenado.

Em **Configurações > Diagnóstico**, é possível copiar ou exportar um relatório
sanitizado com versões do aplicativo/runtimes, plataforma, arquitetura,
identificador de sessão, contagens de eventos, contagens de Providers/modelos e
tempos. Ele não contém credenciais, prompts, conteúdo de arquivos, diffs ou
histórico de conversas. Revise qualquer log local antes de enviá-lo para fora do
dispositivo.
