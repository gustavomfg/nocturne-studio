# Internal research: subscription access in AI providers

> This file is maintainer research, not a supported-provider contract. For
> product behavior, use [Providers](providers.md) and [Codex integration](codex-integration.md).

Levantamento de quais provedores permitem conectar ferramentas terceiras
usando assinatura/plano (OAuth) em vez de API key direta.

Data de referencia: Julho de 2026.

---

## OpenAI — conta ChatGPT pelo Codex CLI

**Suporte no Nocturne:** Sim, pelo Codex CLI oficial.

A autenticação oficial do Codex diferencia dois caminhos:

- `codex login`, que abre o navegador e usa o acesso disponível na conta
  ChatGPT;
- `codex login --with-api-key`, cujo uso é cobrado pela OpenAI Platform.

O Nocturne chama o primeiro fluxo no processo principal, consulta
`codex login status` e reutiliza a sessão protegida pelo próprio Codex CLI.
As credenciais não atravessam o preload e não chegam ao renderer.

Isso não transforma uma assinatura ChatGPT em uma chave de API genérica.
A conexão “OpenAI API” continua separada e exige uma chave da Platform.
Consulte a [documentação oficial de autenticação](https://learn.chatgpt.com/docs/auth.md).

---

## Anthropic — Claude Pro / Max

**Suporte:** Bloqueado desde 04/abril/2026.

A Anthropic mudou a politica: assinaturas Claude Pro ($20/mes) e Max
($100-200/mes) agora cobrem apenas os produtos oficiais:

- Claude.ai (web)
- Claude Code (CLI oficial)
- Claude Desktop
- Claude Cowork

Ferramentas terceiras precisam de:

1. **API key direta** — pay-per-token em console.anthropic.com.
2. **Extra Usage** — creditos pre-pagos por cima da assinatura.

---

## GitHub Copilot

**Suporte:** Parcial.

O GitHub Copilot permite login via conta GitHub em algumas ferramentas
(IDE, terminal). O suporte varia conforme o cliente.

---

## DeepSeek

**Suporte:** API key apenas.

Nao oferece plano com OAuth para terceiros. Pague por token via API key.

---

## Google Gemini

**Suporte:** API key apenas.

Gemini API e pay-per-token. Nao ha plano de assinatura que cubra uso
em ferramentas terceiras.

---

## OpenRouter

**Suporte:** API key apenas.

OpenRouter e um agregador de modelos. Voce paga por uso com creditos
pre-pagos ou cartao. Sem OAuth.

---

## Ollama / LM Studio

**Suporte:** Completamente gratuito e local.

Modelos rodam 100% na maquina do usuario. Nao precisa de assinatura nem
API key. O Nocturne Studio ja suporta via adaptador openai-compatible
apontando para `http://localhost:11434` (Ollama) ou `http://localhost:1234`
(LM Studio).

---

## Resumo

| Provedor          | OAuth / Plano | API key | Gratuito/local |
|-------------------|:---:|:---:|:---:|
| OpenAI            | Sim | Sim | - |
| Anthropic         | Bloqueado | Sim | - |
| GitHub Copilot    | Parcial | Sim | - |
| DeepSeek          | - | Sim | - |
| Google Gemini     | - | Sim | - |
| OpenRouter        | - | Sim | - |
| Ollama            | - | - | Sim |
| LM Studio         | - | - | Sim |

No Nocturne, acesso por plano mensal está implementado somente para conta
ChatGPT através do Codex CLI. OpenAI Platform, DeepSeek e OpenRouter usam
chaves de API separadas; Ollama e LM Studio permanecem locais.
