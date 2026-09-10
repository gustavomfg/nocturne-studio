# GitHub Actions e releases

Os workflows são separados por responsabilidade para que uma falha indique
claramente qual parte do processo precisa de atenção.

## Workflows

| Workflow | Gatilho | Responsabilidade |
| --- | --- | --- |
| `CI · source, renderer and packages` | pull request, `main`, tags e execução manual | valida workflows, código, testes de renderer e pacotes multiplataforma |
| `Security · dependencies` | alterações de dependências em PR ou `main`, agenda semanal e execução manual | audita dependências de produção e gera um SBOM |
| `Compatibility · Codex CLI` | somente execução manual | exercita o contrato experimental do App Server em uma instalação autenticada |
| `Release · stable` | somente execução manual | valida a tag, empacota Linux/Windows/macOS, assina os checksums Linux e publica a release protegida |
| `Release · backfill cross-platform assets` | somente execução manual | reconcilia assets multiplataforma ausentes de uma release existente sem substituir assets já publicados |

Execuções substituídas no mesmo pull request ou branch são canceladas. Builds de
tag e releases estáveis nunca são cancelados automaticamente.

## Smoke do Codex CLI

O smoke completo envia turnos reais ao App Server. Por isso ele não roda em um
runner hospedado pelo GitHub nem deve receber credenciais por artifact, variável
ou secret do repositório.

Para habilitá-lo:

1. registre um runner dedicado, no escopo deste repositório;
2. adicione ao runner o label `nocturne-studio`;
3. instale e autentique uma versão do Codex CLI igual ou superior ao mínimo em
   `shared/codex-compatibility.json`;
4. execute manualmente `Compatibility · Codex CLI` sobre o commit desejado.

Não existe schedule para esse workflow: sem um runner autenticado disponível,
execuções agendadas apenas ficariam em fila e seriam canceladas. O workflow
também não usa GitHub Environment, pois ele valida compatibilidade e não realiza
deployment.

O relatório enviado como artifact é sanitizado e não deve conter credenciais ou
o conteúdo completo das conversas.

## Release estável

Uma release estável exige:

- uma tag existente exatamente igual a `v<versão>`;
- uma versão sem sufixo de pré-release no `package.json`;
- uma execução bem-sucedida do smoke do Codex, iniciada manualmente para o mesmo
  commit da tag;
- o GitHub Environment `stable-release`, com as credenciais de assinatura
  Linux e as aprovações configuradas.

Configure estes secrets no environment `stable-release`:

| Plataforma | Secrets e política |
| --- | --- |
| Linux | `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE`; assinatura destacada de `SHA256SUMS-Linux` é obrigatória |
| Windows | nenhum secret de assinatura é lido; o instalador é publicado unsigned com checksum |
| macOS | nenhum secret de assinatura/notarização é lido; DMG/ZIP são publicados unsigned com checksum |

O environment é deliberado: ele limita o acesso à chave Linux e permite
proteção por aprovação. A matriz do workflow usa os targets e `artifactName` do
`electron-builder` como fonte de verdade. Cada runner confirma o SHA da tag,
executa package smoke, valida `app-update.yml`, gera o manifesto de checksum e
passa pelo verificador de inventário da própria plataforma. Somente o job Linux
importa a chave e verifica a assinatura GPG.

O gate final reúne os três artifacts, rejeita arquivos ausentes, duplicados ou
inesperados, valida versão, blockmaps, metadata do updater, SHA512 de metadata e
SHA256 dos pacotes e só então cria a GitHub Release usando
`docs/releases/v<versão>.md` como fonte das notas em inglês. Ele não usa
`--generate-notes` como substituto das notas versionadas e não altera uma release
existente.

## Backfill de uma release existente

`Release · backfill cross-platform assets` é o caminho operacional para
reconciliar uma release já publicada. Informe a tag existente e o SHA que ela
deve referenciar. O workflow:

- faz checkout separado do código da tag e das ferramentas da branch em que o
  workflow foi executado;
- prova que o package foi construído do SHA da tag, nunca de `main`;
- empacota somente Windows x64 e macOS ARM64 quando esses assets estão ausentes;
- valida smoke, updater metadata, blockmaps, checksums e nomes exatos;
- verifica que os assets Linux atuais existem e que nenhum asset candidato já
  publicado será substituído;
- publica apenas os assets faltantes e atualiza o corpo com as notas inglesas
  versionadas, dentro do environment protegido.

Esse fluxo não recria tags, não cria uma nova versão, não assina artefatos sem
credencial e não modifica `v1.0.0`.

## Proteções de release

Configure no environment `stable-release`:

- revisores obrigatórios;
- prevenção de autoaprovação;
- deployment restrito a tags protegidas de release;
- secrets Linux indisponíveis fora dos jobs protegidos.

O workflow de validação de pacotes não publica artifacts. Ele sempre executa o
`electron-builder` com `--publish never` e permanece separado da publicação
estável.
