# Atualizações

[English](updates.md)

O atualizador consulta releases somente no aplicativo empacotado. Builds de
desenvolvimento e smoke de pacote não acessam o serviço de release.

## Fluxo do usuário

1. Após iniciar, o pacote consulta atualizações e repete a consulta a cada seis
   horas sem requests sobrepostos.
2. Quando existe release, o aplicativo mostra um aviso não modal com versão e
   notas sanitizadas, sem interromper o trabalho atual.
3. O usuário pode consultar as notas e iniciar o download pelo aviso ou em
   Settings → Atualizações.
4. O progresso aparece dentro do Nocturne e no sistema operacional; o
   aplicativo continua utilizável.
5. `electron-updater` valida o artefato baixado.
6. A instalação ocorre após uma ação explícita de reinício ou ao encerrar o
   aplicativo, conforme o fluxo normal do atualizador.

O estado de atualização pertence ao processo principal e atravessa o domínio
IPC nomeado `updates` pelo preload. O renderer hidrata o estado com
`getState()` antes de depender dos eventos de alteração. Falhas em background
permanecem discretas; um download iniciado pelo usuário oferece retry.

O estado de auto-update é `unsupported` em instalações Linux tar.gz. O
AppImage é o alvo Linux com auto-update suportado. Windows NSIS e macOS DMG/ZIP
continuam representados na configuração, mas a publicação estável dessas
plataformas depende dos jobs de assinatura e release descritos no workflow de
manutenção.

Se o download falhar, o progresso é limpo e **Retomar download** inicia uma nova
tentativa validada. Recusar ou adiar não remove dados locais nem desabilita a
versão atual. Rollback do binário pertence ao instalador e ao sistema
operacional; a responsabilidade do Nocturne é preservar e recuperar os dados no
próximo startup.

Releases estáveis usam a política de metadados estável `release`. A configuração
de prerelease não promete que toda beta receberá toda build estável; o caminho
`0.9.5-beta` para `1.0.0` é ensaiado com metadados reais antes da release
estável. O workflow estável atual publica somente Linux. A expansão para
artefatos assinados de Windows e macOS é um follow-up separado do pipeline de
release. Veja o [workflow de release](github-actions.md).
