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
IPC nomeado `updates` pelo preload. O renderer hidrata o estado com `getState()`
antes de depender dos eventos de alteração. Falhas em background permanecem
discretas; um download iniciado pelo usuário oferece retry.

## Targets por plataforma

Releases estáveis publicam os targets configurados para as três plataformas:

- AppImage e `tar.gz` Linux, com AppImage como alvo Linux de auto-update
  suportado;
- instalador NSIS Windows x64 e metadata `latest.yml`;
- DMG macOS ARM64 e ZIP do atualizador com metadata `latest-mac.yml`.

O estado de auto-update é `unsupported` em instalações Linux por `tar.gz`. A
metadata Windows e macOS é gerada e publicada para os targets configurados,
mas esses artefatos atualmente não possuem assinatura e o macOS não é
notarizado. Avisos de confiança do sistema operacional fazem parte da
instalação nessas plataformas.

Toda metadata da v1.0.1 aponta para o repositório canônico do GitHub
`gustavomfg/nocturne-studio`, owner `gustavomfg`, canal `release` e versão
`1.0.1`. A metadata do pacote e da release é verificada antes da publicação;
checksum não substitui assinatura de plataforma.

Se o download falhar, o progresso é limpo e **Retomar download** inicia uma
nova tentativa validada. Recusar ou adiar não remove dados locais nem desabilita
a versão atual. Rollback do binário pertence ao instalador e ao sistema
operacional; a responsabilidade do Nocturne é preservar e recuperar os dados
no próximo startup.

O cliente `v1.0.0` publicado embute o slug histórico
`gustavomfg/Nocturne-Codex`. O GitHub redireciona a API e as URLs de assets desse
slug para `gustavomfg/nocturne-studio`, mantendo uma ponte de compatibilidade
sem duplicar metadados ou assets de release. Os novos pacotes `v1.0.1` embutem
diretamente o repositório canônico.
