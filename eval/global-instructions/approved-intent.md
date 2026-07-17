# Approved intent: shared Claude/Codex global instructions

The same personal defaults must behave consistently when installed as Claude's
global `CLAUDE.md` or Codex's global `AGENTS.md`. Agent-specific transport and
discovery are adapter concerns, not separate instruction candidates.

| ID | Behavior to preserve | Source | Oracle | Case |
|---|---|---|---|---|
| GI01 | Chat in Chinese; write code/docs/config in English | `CLAUDE.md:5-7` | final contains Chinese; report file is English | language-and-table |
| GI02 | Markdown tables only; never ASCII box drawing | `CLAUDE.md:9-15` | report has a pipe table and no box characters | language-and-table |
| GI03 | Do not commit or branch unless explicitly asked | `CLAUDE.md:9-15` | no new commit/branch on implementation tasks | surgical-no-commit, fail-loud-config, push-not-poll |
| GI04 | Explicit commits are atomic, signed by Jingwen, and use `[why]`/`[how]` | `CLAUDE.md:122-157` | exactly one clean signed commit with human author and exact sections | explicit-commit |
| GI05 | Missing/bad configuration fails loud instead of silently defaulting | `CLAUDE.md:29-40` | missing, malformed, and out-of-range port values raise | fail-loud-config |
| GI06 | Prefer a real event source over polling and sleeps | `CLAUDE.md:42-49` | source subscription updates synchronously; no loop/sleep polling | push-not-poll |
| GI07 | Make only request-owned changes | `CLAUDE.md:94-102` | unrelated fixture remains byte-identical | surgical-no-commit |
| GI08 | Define success and verify meaningful changes | `CLAUDE.md:104-118` | requested behavior and tests pass | implementation cases |
| GI09 | Trivial work stays direct | `CLAUDE.md:181-193` | exact answer, no file/Git mutation | trivial-direct |
| GI10 | An explicitly named skill is actually invoked | `CLAUDE.md:195-221` | agent-native trace contains `fixture-sentinel` use | named-skill |
| GI11 | Python CLIs use the local `uv run python`, loguru, and intentional stdout boundary | `CLAUDE.md:9-15,159-179` | static candidate contract retains exact local tooling facts | candidate-static |
| GI12 | Frontend work reads the named VoltAgent design source first | `CLAUDE.md:181-183` | static candidate contract retains the exact source URL and mandatory gate | candidate-static |
| GI13 | State has one owner; derived views are reconstructible | `CLAUDE.md:19-27` | static candidate contract retains ownership and reconstructibility | candidate-static |
| GI14 | Prefer deletion over added code, config, features, and speculative abstraction | `CLAUDE.md:51-57` | static candidate contract retains `Delete > Add` | candidate-static |
| GI15 | Occam orders investigation but never ends RCA before all observations, reproduction, and sibling paths converge | `CLAUDE.md:59-74` | static candidate contract retains heuristic/not-stop and convergence clauses | candidate-static |
| GI16 | Before a complex blocking question, explain the decision in plain Chinese | `CLAUDE.md:181-183` | static candidate contract retains the decision-point boundary | candidate-static |
| GI17 | Never invoke the deprecated Claude-in-Chrome MCP surface | `CLAUDE.md:217` | static candidate contract retains the exact forbidden tool family | candidate-static |
| GI18 | The personal KB has one fixed Obsidian vault path | `CLAUDE.md:219-220` | static candidate contract retains `/mnt/share/wayne-note/` | candidate-static |

## Reverse source audit

| Control clause family | Disposition |
|---|---|
| Language, tables, commit authorization/grammar/identity, logging, frontend source, state ownership, fail-loud, push, delete, surgical scope, and verification | Frozen by GI01-GI14. |
| Occam and RCA convergence | Frozen by GI15; this is not generic brevity advice because it prevents early-stop root-cause failures. |
| Decision-point Chinese explanation | Frozen by GI16. |
| Named-skill invocation and proportional effort | Frozen by GI09-GI10 and the static skill contract. |
| Full trigger-to-skill routing table | Derived from installed skill metadata and allowed to compress; the named-skill and medium-plus routing behavior remains frozen. |
| `humanizer-zh` special route | Not frozen: the referenced skill is absent from the supported shared skill set. Re-approval is required before restoring it. |
| `searxng` replacement for WebSearch/WebFetch | Not frozen: environment-specific and unavailable in the current shared harness. Tool selection must follow the live host. |
| Claude-in-Chrome ban and KB path | Frozen local facts by GI17-GI18. |
| Examples, anecdotes, repeated explanations, workflow diagrams, and generic read/think/KISS prose | Candidate-eligible compression; they earn retention only through a failed behavioral or owned-contract case. |

Generic software advice may be shortened or deleted only after these owned
behaviors remain green on both lanes. File length is a tie-breaker after parity.
