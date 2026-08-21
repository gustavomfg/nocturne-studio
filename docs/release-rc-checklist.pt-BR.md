# Checklist do candidato de release 1.0.0

[English](release-rc-checklist.md)

Este é um checklist manual curto para o candidato final. Registre o SHA exato,
nome do artefato, plataforma e data de cada execução. Ele não publica a release
nem substitui o workflow protegido de release estável.

## Identidade do candidato

- [ ] Confirme `package.json` como `1.0.0`, registre o SHA candidato e confirme
      que a tag pretendida é `v1.0.0`.
- [ ] Confirme a arquitetura do artefato e compare o checksum com o manifesto da
      release.

## Instalação e primeiro uso

- [ ] Instale o AppImage ou arquivo Linux, o instalador NSIS x64 do Windows e o
      DMG do macOS nas plataformas correspondentes.
- [ ] Faça o primeiro startup com user data vazio e depois crie e reabra um
      workspace.
- [ ] Abra um workspace existente, mova-o e confirme que o novo local exige
      autorização explícita novamente.
- [ ] Execute o Review Mode e confirme que nenhum arquivo do workspace é
      alterado implicitamente.
- [ ] Execute uma pequena alteração aprovada no Build Mode e inspecione plano,
      aprovação, diff e rollback.
- [ ] Visualize e aplique uma pequena mudança no Docs Mode, incluindo uma
      rejeição por edição concorrente.

## IA e dados

- [ ] Configure um Provider suportado e verifique uma requisição bem-sucedida e
      um erro controlado de credencial inválida ou Provider indisponível.
- [ ] Em uma máquina autorizada, execute o smoke autenticado do Codex com o CLI
      `0.145.0` ou a recomendação verificada `0.146.0`.
- [ ] Reinicie o aplicativo e confirme que conversas, configurações, memória e
      histórico do workspace continuam disponíveis.
- [ ] Crie um backup, restaure-o em um teste isolado e verifique a preservação
      semântica dos dados, não apenas a existência do arquivo.
- [ ] Exercite o diálogo nativo de confirmação de recovery com um banco
      corrompido e um candidato válido; confirme quarentena e restart pós-recovery.

## Atualizações, privacidade e gates de release

- [ ] Verifique disponibilidade de atualização, confirmação de download,
      progresso e retry em cada plataforma empacotada sem usar dados reais no
      fixture.
- [ ] Confirme que logs e diagnósticos não contêm credenciais, tokens, prompts
      ou conteúdo privado do workspace.
- [ ] Verifique assinatura do Windows, assinatura/notarização do macOS e
      assinatura dos checksums Linux no ambiente protegido de release.
- [ ] Verifique que a tag exata `v1.0.0` aponta para o SHA testado e que o
      workflow estável passou antes da publicação.

Consentimento nativo de recovery e assinatura/notarização são gates de release;
eles não devem ser contornados no produto para automatizar testes.
