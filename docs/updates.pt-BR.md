# Atualizações

[English](updates.md)

O atualizador consulta releases somente no aplicativo empacotado. Builds de
desenvolvimento e smoke de pacote não acessam o serviço de release.

## Fluxo do usuário

1. Após iniciar, o pacote consulta atualizações e repete a consulta a cada seis
   horas sem requests sobrepostos.
2. Quando existe release, o aplicativo mostra versão e notas sanitizadas.
3. O download começa somente após confirmação; o progresso aparece no sistema
   operacional e o aplicativo atual continua utilizável.
4. `electron-updater` valida o artefato baixado.
5. A instalação ocorre após uma segunda confirmação ou ao encerrar o aplicativo,
   conforme o fluxo normal do atualizador.

Se o download falhar, o progresso é limpo e **Retomar download** inicia uma nova
tentativa validada. Recusar ou adiar não remove dados locais nem desabilita a
versão atual. Rollback do binário pertence ao instalador e ao sistema
operacional; a responsabilidade do Nocturne é preservar e recuperar os dados no
próximo startup.

Releases estáveis usam a política de metadados estável `release`. A configuração
de prerelease não promete que toda beta receberá toda build estável; o caminho
`0.9.5-beta` para `1.0.0` é ensaiado com metadados reais antes da release
estável. Veja o [workflow de release](github-actions.md).
