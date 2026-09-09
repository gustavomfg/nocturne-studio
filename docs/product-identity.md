# Identidade estável do produto

Este documento define os identificadores do Nocturne Studio que devem
permanecer estáveis durante a linha 1.x.

| Finalidade | Identificador |
| --- | --- |
| Nome de exibição e processo | `Nocturne Studio` |
| Pacote npm e cliente do Codex App Server | `nocturne-studio` |
| App ID de distribuição | `com.nocturne.codex` |
| Diretório atual de dados | `Nocturne Studio` |
| Diretório legado de dados | `Nocturne Codex` |
| Repositório canônico de publicação e atualização | `gustavomfg/nocturne-studio` |
| Label do runner autenticado | `nocturne-studio` |

`shared/product-identity.json` é a fonte canônica desses valores.

## Identificadores legados preservados

O App ID e o diretório de dados legado continuam preservados para manter a
continuidade de instalação e dados. O slug antigo `gustavomfg/Nocturne-Codex`
deixou de ser a identidade principal de publicação, mas o rename do GitHub
mantém redirects para a release existente e funciona como ponte para clientes
`v1.0.0`.

O diretório `Nocturne Codex` é reconhecido somente pela migração de dados. Em
uma instalação existente, ele é renomeado atomicamente para `Nocturne Studio`
quando isso pode ser feito sem ocultar ou substituir um banco válido. Se a
migração falhar, o aplicativo continua usando o diretório legado.

## Compatibilidade do updater

O build `v1.0.0` publicado no SHA `310f86a1a71814f8cc05ef3275ce27e1babbb15d`
embute `gustavomfg/Nocturne-Codex` no `app-update.yml`. A API e os downloads
desse slug retornam redirect para `gustavomfg/nocturne-studio`, que é seguido
pelo `electron-updater`; por isso não é necessário duplicar metadata ou assets
no repositório legado. O `v1.0.1` passa a embutir diretamente o repositório
canônico.

## Artefatos

- macOS: `Nocturne-Studio-Mac-<versão>-Installer`
- Windows: `Nocturne-Studio-Windows-<versão>-Setup`
- Linux: `Nocturne.Studio-Linux-<versão>`

Qualquer mudança futura nesses identificadores exige um plano explícito de
migração, validação de atualização nas plataformas afetadas e documentação de
rollback.
