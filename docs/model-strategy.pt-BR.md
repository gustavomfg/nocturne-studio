# Estratégia de modelos

Este documento é uma orientação de seleção, não uma funcionalidade automática
do runtime.

Na release atual, o usuário seleciona o modelo. O Nocturne não encaminha uma
tarefa automaticamente para Sol, Terra ou Lua e ainda não permite definir o
nível efetivo de raciocínio de uma execução.

## Papéis

| Papel | Uso recomendado | Nível sugerido |
| --- | --- | --- |
| **Sol** | Arquitetura, segurança e decisões críticas | High a Max |
| **Terra** | Desenvolvimento diário, debugging e revisão | Medium |
| **Lua** | Documentação, manutenção e automação | Low a Medium |

O nível é apenas uma recomendação. O valor efetivo pode ser o padrão do modelo
ou do Provider, e os valores disponíveis podem variar por Provider. Não assuma
que Sol significa Max.

## Controle planejado

Um fluxo futuro de seleção deve mostrar separadamente:

- estratégia: Sol, Terra ou Lua;
- modelo: o modelo selecionado;
- nível de raciocínio: Auto, Low, Medium, High, Extra High ou Max quando houver
  suporte;
- nível efetivo: o valor realmente aplicado ou “Padrão do Provider” quando ele
  não puder ser informado.

A implementação não deve alegar controle em um Provider que não exponha o nível
de raciocínio. Qualquer recomendação automática deve ficar visível e poder ser
substituída pelo usuário.
