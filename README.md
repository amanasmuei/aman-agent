# aman-agent

Your AI companion, running locally. Powered by the aman ecosystem.

## Quick Start

```bash
npx @aman_asmuei/aman-agent
```

First run: configure your LLM (Claude or GPT). After that, just run and talk.

## What it does

Loads your entire aman ecosystem and runs a local AI agent:

- **Identity** (acore) — your AI knows who it is and who you are
- **Memory** (amem) — your AI remembers past sessions
- **Tools** (akit) — your AI can use GitHub, search the web, query databases
- **Workflows** (aflow) — your AI follows your defined processes
- **Guardrails** (arules) — your AI respects your boundaries
- **Skills** (askill) — your AI applies learned capabilities

## Commands

Inside the agent:

| Command | What it does |
|:--------|:-------------|
| `/help` | Show available commands |
| `/identity` | View your AI identity |
| `/tools` | View installed tools |
| `/workflows` | View defined workflows |
| `/rules` | View guardrails |
| `/skills` | View installed skills |
| `/model` | Show current LLM model |
| `/clear` | Clear conversation history |
| `/quit` | Exit |

## Supported LLMs

- **Claude** (Anthropic) — recommended, supports tool use
- **GPT** (OpenAI) — supports tool use
- More coming (Gemini, Ollama)

## Configuration

Config stored in `~/.aman-agent/config.json`. Treat this file like a credential — it contains your API key.

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250514"
}
```

Override model per session:
```bash
npx @aman_asmuei/aman-agent --model claude-opus-4-6
```

## The Ecosystem

```
aman
├── acore       → identity
├── amem        → memory
├── akit        → tools
├── aflow       → workflows
├── arules      → guardrails
├── aeval       → evaluation
├── askill      → skills
└── aman-agent  → runtime  ← THIS
```

## License

MIT
