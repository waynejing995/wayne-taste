# Internal Model Provider Setup (pi)

How to wire the AMD internal models into pi on a new machine. This is **not shipped as a live config** because it is machine/proxy/secret specific — follow this guide to reconstruct `~/.pi/agent/models.json` by hand.

Docs: `pi` custom models → `docs/models.md` in the pi package.

## Prerequisites

- A local proxy that injects real credentials, listening on `http://127.0.0.1:8888` (Anthropic-compatible at `/`, OpenAI-compatible at `/openai`).
- For the OpenAI/APIM path: an APIM subscription key. **Never hardcode it.** Put it in an env var and reference it from `models.json` (`${AMD_APIM_KEY}`), or use a secret-manager command (`"!op read '...'"`). See "Secrets" below.

## `~/.pi/agent/models.json`

Three providers. Keys shown as placeholders — substitute your own mechanism.

```json
{
  "providers": {
    "anthropic": {
      "baseUrl": "http://127.0.0.1:8888",
      "apiKey": "PROXY_INJECTS_REAL_KEY",
      "models": [
        { "id": "Claude-Opus-4.7",  "name": "Claude Opus 4.7 (1M, via proxy)", "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"] },
        { "id": "claude-sonnet-4.6","name": "Claude Sonnet 4.6 (via proxy)",   "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"] },
        { "id": "claude-haiku-4.5", "name": "Claude Haiku 4.5 (via proxy)",    "contextWindow": 200000,  "maxTokens": 64000,  "reasoning": true, "input": ["text","image"] }
      ]
    },

    "amd-internal-anthropic": {
      "baseUrl": "http://127.0.0.1:8888",
      "api": "anthropic-messages",
      "apiKey": "PROXY_INJECTS_REAL_KEY",
      "compat": { "forceAdaptiveThinking": true },
      "models": [
        { "id": "Claude-Opus-4.8", "name": "Claude Opus 4.8 (1M, via proxy)", "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"], "thinkingLevelMap": { "xhigh": "xhigh" } },
        { "id": "claude-sonnet-5", "name": "Claude Sonnet 5 (via proxy)",     "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"], "thinkingLevelMap": { "xhigh": "xhigh" } }
      ]
    },

    "openai-amd": {
      "baseUrl": "http://127.0.0.1:8888/openai",
      "api": "openai-responses",
      "apiKey": "${AMD_APIM_KEY}",
      "headers": {
        "Ocp-Apim-Subscription-Key": "${AMD_APIM_KEY}",
        "user": "YOUR_USER_ID"
      },
      "models": [
        { "id": "gpt-5.5", "name": "GPT-5.5 Codex (via proxy)", "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"] },
        { "id": "gpt-5.6-sol",   "name": "GPT-5.6 Sol (via proxy)",   "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"], "thinkingLevelMap": { "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" } },
        { "id": "gpt-5.6-terra", "name": "GPT-5.6 Terra (via proxy)", "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"], "thinkingLevelMap": { "minimal": null, "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" } }
      ]
    }
  }
}
```

## thinkingLevelMap — why it differs per family

pi thinking levels: `off, minimal, low, medium, high, xhigh, max`.

- **Claude (amd-internal-anthropic):** `"xhigh": "xhigh"` exposes the extended xhigh level (the default map only goes through `high`). `forceAdaptiveThinking` is required for these adaptive-thinking Anthropic models via the proxy.
- **GPT-5.6 (sol/terra):** supports `none, low, medium, high, xhigh, max` — but **not `minimal`**. The map exposes `xhigh`/`max` and sets `minimal: null` to hide the unsupported level. Default is `medium`.
- **GPT-5.5 and the base `anthropic` proxy models:** no map needed (standard levels through `high`; xhigh/max not exposed).

## Secrets — never commit the key

The only real secret is the APIM subscription key. Options, cleanest first:

1. **Env var** (used above): `export AMD_APIM_KEY=...` in `~/.bashrc` (or a machine-local untracked file). `models.json` references `${AMD_APIM_KEY}`.
2. **Secret manager command:** `"apiKey": "!op read 'op://vault/amd/apim'"` — resolved at request time.

The Anthropic proxy entries use a literal placeholder (`PROXY_INJECTS_REAL_KEY`) because the local proxy injects the real credential; pi just needs a non-empty value so the model shows as authed in `/model`.

## Verify

```bash
pi --list-models | grep -E "Claude-Opus-4.8|gpt-5.6"
```

Reload `/model` in-session (the file reloads each time you open `/model`; no restart needed). If a model shows but is unavailable, auth (env var / proxy) is not resolving.
