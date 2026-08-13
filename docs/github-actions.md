# GitHub Actions e releases

Os workflows são separados por responsabilidade para que uma falha indique
claramente qual parte do processo precisa de atenção.

## Workflows

| Workflow | Gatilho | Responsabilidade |
| --- | --- | --- |
| `CI · source, renderer and packages` | pull request, `main`, tags e execução manual | valida workflows, código, testes de renderer e pacotes multiplataforma |
| `Security · dependencies` | alterações de dependências em PR ou `main`, agenda semanal e execução manual | audita dependências de produção e gera um SBOM |
| `Compatibility · Codex CLI` | somente execução manual | exercita o contrato experimental do App Server em uma instalação autenticada |
| `Release · stable` | somente execução manual | valida a origem, assina as três plataformas e publica uma GitHub Release estável |

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
- o GitHub Environment `stable-release`, com as credenciais de assinatura.

Configure estes secrets no environment `stable-release`:

| Plataforma | Secrets |
| --- | --- |
| Linux | `GPG_PRIVATE_KEY`, `GPG_PASSPHRASE` |
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

O environment é deliberado aqui: ele limita o acesso às chaves e permite
proteção por aprovação. Os jobs de assinatura falham antes do empacotamento se
alguma credencial obrigatória estiver ausente.

Para publicar, abra `Release · stable` na branch padrão e informe a tag e o ID
da execução do smoke. O workflow faz checkout da tag e confirma que ela aponta
para o commit efetivamente validado. O gate final só cria ou atualiza a GitHub
Release depois que os artifacts, checksums e assinaturas das três plataformas
forem reunidos e verificados.

Recomenda-se configurar no environment:

- revisores obrigatórios;
- prevenção de autoaprovação;
- deployment restrito a tags protegidas de release.

Não use o workflow de validação de pacotes para publicar artifacts. Ele sempre
executa o `electron-builder` com `--publish never`.
