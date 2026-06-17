# Golden exemplar — Alfred one-key TUI startup

The reference goal prompt this skill's anatomy is anchored on. Note how every
constraint is a "Do not" red-line inlined at the task it governs, verification
names exact commands + a real pty/xterm path, and completion criteria are each
testable. Use it as the bar a composed prompt must clear.

---

Goal: Finish Alfred one-key TUI startup and real TUI chat verification.

Context:
- This is a fork/adaptation of opencode TUI, not a rewrite.
- The frontend should keep the opencode OpenTUI/SolidJS structure, but the runtime identity must be Alfred.
- The backend should expose an opencode-compatible TUI adapter over IPC to Alfred's Python kernel.
- Do not use opencode-vs-Alfred pixelmatch. Pixelmatch is only for Alfred self-regression.
- Semantic parity with opencode is about UI elements and behavior, not exact pixels.
- Do not claim the goal is complete until a real TUI chat path has been driven through xterm/pty.

Current correction:
- Bare `alfred` should launch the TUI.
- The visible provider/agent/model label must be Alfred-branded, not `opencode` / `OpenCode Zen`.
- The real test model must come from Codex config, not Anthropic defaults:
  - `~/.codex/config.toml`
  - `model_provider = "custom"`
  - `model = "gpt-5.5"`
  - provider base_url `http://127.0.0.1:8888/openai`
  - `query_params.api-version = "2025-04-01-preview"`
  - `wire_api = "responses"`
  - headers include `Ocp-Apim-Subscription-Key` and `user`; do not print or copy secret values into Alfred config.
  - preserve secret hygiene: if Alfred needs headers, materialize them through an env var name such as `ALFRED_CODEX_HTTP_HEADERS`, then pass `http_headers_env`.

Tasks:
1. Fix Alfred TUI runtime labels.
   - User-visible provider/agent/model surface should say Alfred, not OpenCode Zen.
   - The UI may remain opencode-like structurally because it is a fork, but branding/runtime identity must be Alfred.
   - Update semantic fixtures/tests accordingly; do not keep `Build · DeepSeek V4 Flash Free OpenCode Zen` as Alfred's golden label.

2. Add Codex provider config resolution for Alfred TUI auto mode.
   - Read `~/.codex/config.toml`.
   - Use `model_provider` to select `[model_providers.<name>]`.
   - Use top-level `model = "gpt-5.5"`.
   - Preserve `base_url`, `query_params`, and `wire_api`.
   - Do not persist plaintext secrets in Alfred config or logs.
   - If `http_headers` must be forwarded, put the serialized headers into a process env var and pass only `http_headers_env` to Alfred's provider config.
   - If current `LiteLLMParams` cannot represent `wire_api = "responses"`, add the minimal provider-field support needed and verify it against the gateway.

3. Reproduce and fix the TUI hang.
   - Start the real user entrypoint: `uv run alfred`.
   - Drive it through a real pty/xterm harness.
   - Type `hi` and press Enter.
   - Observe whether the prompt sends, whether the bridge receives the request, whether Python returns, and whether OpenTUI renders the assistant message.
   - Fix the actual broken layer. Do not replace this with direct Agent/CLI calls.

4. Add a real TUI chat regression test.
   - Use node-pty + xterm/Playwright or equivalent.
   - Start `uv run alfred` or `uv run alfred tui`.
   - Use Codex `gpt-5.5` provider config.
   - Type a deterministic prompt such as `Reply exactly: ALFRED_TUI_REAL_OK`.
   - Pass only when the terminal buffer visibly contains `ALFRED_TUI_REAL_OK`.
   - Capture failure buffer/screenshot artifacts on timeout.

5. Verification required before completion:
   - `uv run pytest tests/cli/test_output_formats.py tests/control/test_tui_bridge.py tests/tui/test_semantic_parity.py tests/tui/test_tui_fork_contract.py -q`
   - `bun test --timeout 60000 test/app-lifecycle.test.tsx test/keymap.test.tsx test/runtime.test.tsx test/l1`
   - Real xterm TUI chat test with `gpt-5.5` from Codex config.
   - Manual/command evidence: `uv run alfred` starts, input `hi` does not hang, assistant response appears in the TUI.

Completion criteria:
- `alfred` starts the TUI with one command.
- Alfred UI labels are Alfred-branded.
- TUI chat works through the actual terminal UI, not just CLI or internal Agent calls.
- The real model path is Codex config `gpt-5.5`.
- No secrets are printed, committed, or copied into Alfred-owned config.
