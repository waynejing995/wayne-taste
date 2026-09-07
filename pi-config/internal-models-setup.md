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
        { "id": "Claude-Opus-5@default", "name": "Claude Opus 5 (1M, via proxy)",   "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"], "thinkingLevelMap": { "xhigh": "xhigh" } },
        { "id": "Claude-Opus-4.8@default", "name": "Claude Opus 4.8 (1M, via proxy)", "contextWindow": 1000000, "maxTokens": 128000, "reasoning": true, "input": ["text","image"], "thinkingLevelMap": { "xhigh": "xhigh" } },
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

## Custom request headers

Pi already supports custom headers in `models.json`; no extension or Pi patch is
needed. Add a `headers` object inside the target provider, alongside `baseUrl`,
`api`, and `models`. It applies to that provider's models, not to other providers.

For `providers.openai-amd`, extend the existing object rather than replacing the
APIM subscription header. This is a provider fragment, not a complete `models.json`:

```json
{
  "headers": {
    "Ocp-Apim-Subscription-Key": "${AMD_APIM_KEY}",
    "user": "${AMD_USER_ID}",
    "X-Client-Name": "pi",
    "X-Team": "${AMD_TEAM}"
  }
}
```

`X-Client-Name` and `X-Team` are examples, not required AMD headers. Use only the
names your endpoint expects, and export the referenced variables in the process
that launches pi. The same `headers` field works on `amd-internal-anthropic` or
another custom provider; do not copy APIM credentials to unrelated endpoints.

| Value form | Example |
| --- | --- |
| Fixed value | `"X-Client-Name": "pi"` |
| Environment variable | `"user": "${AMD_USER_ID}"` (or `"$AMD_USER_ID"`) |
| Interpolated value | `"Authorization": "Bearer ${PROXY_TOKEN}"` |
| Secret-manager command | `"X-Proxy-Key": "!op read 'op://vault/proxy/key'"` |

Plain `"AMD_USER_ID"` is a literal, not an environment lookup. Missing environment
variables leave values unresolved. Secret-manager commands resolve at request
time; `/model` availability checks do not execute them. Do not commit real tokens
or add an `Authorization` override unless your endpoint requires it.

After editing, reopen `/model` to reload the file and select the target model.
Confirm header delivery with a real request and redacted proxy/server-side
inspection; seeing the model listed alone does not prove headers were sent.

## thinkingLevelMap — why it differs per family

pi thinking levels: `off, minimal, low, medium, high, xhigh, max`.

- **Claude (amd-internal-anthropic):** `"xhigh": "xhigh"` exposes the extended xhigh level (the default map only goes through `high`). `forceAdaptiveThinking` is required for these adaptive-thinking Anthropic models via the proxy.
- **GPT-5.6 (sol/terra):** supports `none, low, medium, high, xhigh, max` — but **not `minimal`**. The map exposes `xhigh`/`max` and sets `minimal: null` to hide the unsupported level. Default is `medium`.
- **GPT-5.5 and the base `anthropic` proxy models:** no map needed (standard levels through `high`; xhigh/max not exposed).

## Secrets — never commit the key

Keep the APIM subscription key and any custom-header tokens outside git. Options, cleanest first:

1. **Env var** (used above): `export AMD_APIM_KEY=...` in `~/.bashrc` (or a machine-local untracked file). `models.json` references `${AMD_APIM_KEY}`.
2. **Secret manager command:** `"apiKey": "!op read 'op://vault/amd/apim'"` — resolved at request time.

The Anthropic proxy entries use a literal placeholder (`PROXY_INJECTS_REAL_KEY`) because the local proxy injects the real credential; pi just needs a non-empty value so the model shows as authed in `/model`.

## Verify

```bash
pi --list-models | grep -E "Claude-Opus-5|gpt-5.6-sol"
```

Reload `/model` in-session (the file reloads each time you open `/model`; no restart needed). If a model shows but is unavailable, auth (env var / proxy) is not resolving.
