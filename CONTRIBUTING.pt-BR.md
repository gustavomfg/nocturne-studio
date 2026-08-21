# Contribuindo

[English](CONTRIBUTING.md)

## Antes de começar

Antes de abrir um Pull Request:

- procure issues e discussões existentes;
- abra uma issue para mudanças significativas de comportamento ou novas
  funcionalidades;
- mantenha o Pull Request focado em um único objetivo;
- respeite as fronteiras Electron entre renderer, preload e processo principal.

# Diretrizes de desenvolvimento

## Arquitetura

Preserve a separação entre renderer, preload e processo principal. Não crie uma
ponte IPC genérica nem acople capacidades nativas ao renderer.

## Segurança

Nunca faça commit de chaves de API, tokens, bancos locais, logs sensíveis ou
credenciais pessoais. Dados de autenticação nunca devem ser expostos ao
renderer. Preserve isolamento, validação IPC, autorização de workspace, Review
somente leitura e escritas de Build limitadas.

## Qualidade do código

Antes de abrir um Pull Request, execute:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:abi
npm run build
npm run test:renderer
```

Quando aplicável, execute também os checks de empacotamento e smoke. Descreva no
Pull Request os riscos, os comandos executados e qualquer validação manual.

# Mensagens de commit

Commits Conventional Commits são recomendados, por exemplo:

```text
fix(ipc): validate renderer origin
docs(readme): update architecture overview
```

# Pull Requests

Um bom Pull Request explica a mudança, a motivação e os riscos, além dos passos
manuais de validação. Inclua screenshots para mudanças visuais e mantenha
alterações pequenas e revisáveis.

# Ambiente de desenvolvimento

O ambiente recomendado usa WebStorm, Node.js 24 e npm 11. O launcher `webstorm`
deve estar no `PATH` quando usado pelos fluxos de desenvolvimento.

# Filosofia do projeto

Cada contribuição deve respeitar estas prioridades:

1. segurança antes de conveniência;
2. workspace antes da IA;
3. conhecimento antes das conversas;
4. controle humano antes da automação;
5. extensibilidade antes de implementações específicas de Provider.
