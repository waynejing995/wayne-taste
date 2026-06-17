#!/usr/bin/env python3
"""Deterministic Phase-1 collector for wayne-distill.

Walks BOTH agents' session transcripts (*.jsonl) — Claude Code under
`~/.claude/projects/` and Codex CLI under `~/.codex/sessions/` — and emits a
compact digest: per-session summaries + cross-session recurrence signals
(tool n-grams, skill usage, prompt keywords). Semantic clustering + verdicts
are Phase 2, done by the skill runtime reading this digest — NOT here.

Both agents are valid evidence: Wayne's recurring workflow shows up in
whichever CLI he reached for. Codex worker/subagent runs (source="exec" or a
subagent payload) are machine-authored harness prompts, not Wayne's intent —
dropped, mirroring the Claude `isSidechain` exclusion.

Stdlib only on purpose: a skill helper must run anywhere with `python3`,
with no project venv / uv / extra deps. (This is the one place the global
"prefer click+loguru" rule yields to portability — logs go to stderr.)
"""

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# --- filters ---------------------------------------------------------------

# command wrappers / stdout / interrupt markers — not human intent
_NOISE = ("<local-command", "<command-name>", "<command-message>",
          "caveat:", "[request interrupted", "[request cancelled]")

# low-signal words dropped from the prompt-keyword frequency pass
_STOP = {
    "the", "and", "for", "you", "this", "that", "with", "have", "are", "but",
    "not", "can", "all", "use", "should", "would", "could", "from", "into",
    "your", "what", "when", "where", "which", "then", "than", "them", "they",
    "want", "need", "make", "just", "like", "now", "get", "got", "let", "see",
    "out", "add", "run", "one", "two", "also", "any", "how", "why", "its",
    "was", "were", "has", "had", "did", "does", "done", "will", "wont", "dont",
    "here", "there", "some", "more", "very", "please", "okay", "yeah", "yes",
    "claude", "codex", "code", "file", "files", "line", "lines",
}

_WORD = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{3,}")
_SLASH = re.compile(r"^/([a-z0-9][a-z0-9-]+)")


def log(msg: str) -> None:
    print(f"[wayne-distill] {msg}", file=sys.stderr)


def human_text(rec: dict) -> str | None:
    """Return the human-authored prompt text of a record, or None.

    Handles both transcript shapes:
      Claude — `type=user`, message.content (str | list of text parts)
      Codex  — `type=event_msg`, payload.type=`user_message`, payload.message
    """
    rtype = rec.get("type")
    if rtype == "event_msg":  # Codex
        p = rec.get("payload") or {}
        if p.get("type") != "user_message":
            return None
        text = p.get("message")
        if not isinstance(text, str):
            return None
    elif rtype == "user":  # Claude
        if rec.get("isMeta") or rec.get("isSidechain"):
            return None
        msg = rec.get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            parts = [p.get("text", "") for p in content
                     if isinstance(p, dict) and p.get("type") == "text"]
            if not parts:  # tool_result-only turn — not human intent
                return None
            text = "\n".join(parts)
        else:
            return None
    else:
        return None
    text = text.strip()
    if not text:
        return None
    low = text.lower()
    if any(tok in low for tok in _NOISE):
        return None
    return text


def tool_uses(rec: dict) -> list[str]:
    """Tool/function names invoked in a record (both shapes).

    Claude — `type=assistant`, content has `tool_use` parts with `.name`.
    Codex  — `type=response_item`, payload.type=`function_call`, payload.name.
    """
    rtype = rec.get("type")
    if rtype == "response_item":  # Codex
        p = rec.get("payload") or {}
        if p.get("type") == "function_call":
            return [p.get("name", "?")]
        return []
    if rtype == "assistant":  # Claude
        content = (rec.get("message") or {}).get("content")
        if not isinstance(content, list):
            return []
        return [p.get("name", "?") for p in content
                if isinstance(p, dict) and p.get("type") == "tool_use"]
    return []


def ngrams(seq: list[str], lo: int, hi: int) -> set[tuple]:
    out = set()
    for n in range(lo, hi + 1):
        for i in range(len(seq) - n + 1):
            ng = tuple(seq[i:i + n])
            if len(set(ng)) == 1:  # pure A>A>A run = no workflow shape
                continue
            out.add(ng)
    return out


# --- main ------------------------------------------------------------------

def discover(claude_dir: "Path | None", codex_dir: "Path | None") -> list[tuple]:
    """All session transcripts across both agents, oldest-first.

    Claude: <projects>/<proj>/<sid>.jsonl
    Codex:  <sessions>/YYYY/MM/DD/rollout-*.jsonl
    """
    src: list[tuple] = []
    if claude_dir:
        src += [(fp, "claude") for fp in claude_dir.glob("*/*.jsonl")]
    if codex_dir:
        src += [(fp, "codex") for fp in codex_dir.glob("*/*/*/*.jsonl")]
    src.sort(key=lambda t: t[0].stat().st_mtime)
    return src


def scan(claude_dir: "Path | None", codex_dir: "Path | None",
         min_sessions: int, max_prompt: int) -> dict:
    sessions: list[dict] = []
    by_agent = Counter()         # agent -> # sessions kept as evidence
    skipped_spawned = 0          # codex exec/subagent runs = not human intent
    ngram_doc = Counter()        # ngram -> # sessions containing it
    skill_doc = Counter()        # skill/slash -> # sessions using it
    skill_total = Counter()      # skill/slash -> total invocations
    keyword_doc = Counter()      # word -> # sessions mentioning it
    bigram_doc = Counter()       # word bigram -> # sessions
    kw_examples = defaultdict(list)  # word -> [(session, prompt)]

    files = discover(claude_dir, codex_dir)
    log(f"scanning {len(files)} transcript files "
        f"(claude={claude_dir} codex={codex_dir})")

    for fp, agent in files:
        sid = fp.stem
        meta_source = None       # codex session_meta.source (interactivity probe)
        meta_cwd = None
        tools: list[str] = []
        skills_here = Counter()
        prompts: list[str] = []
        try:
            with fp.open(encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if agent == "codex" and rec.get("type") == "session_meta":
                        p = rec.get("payload") or {}
                        meta_source = p.get("source")
                        meta_cwd = p.get("cwd")
                        continue
                    t = human_text(rec)
                    if t is not None:
                        prompts.append(t)
                        m = _SLASH.match(t)
                        if m:
                            skills_here[m.group(1)] += 1
                    tools.extend(tool_uses(rec))
                    sk = rec.get("attributionSkill")
                    if sk:
                        skills_here[sk] += 1
        except OSError as e:
            log(f"skip {fp}: {e}")
            continue

        # Codex spawns worker/subagent runs (source="exec" or a subagent dict);
        # their prompts are machine-authored harness text, not Wayne's intent —
        # mirror the Claude isSidechain exclusion and drop them.
        if agent == "codex" and not (
                isinstance(meta_source, str) and meta_source != "exec"):
            skipped_spawned += 1
            continue

        if not prompts and not tools:
            continue

        proj = Path(meta_cwd).name if meta_cwd else fp.parent.name

        # cross-session recurrence accounting (per-session dedupe = doc freq)
        for ng in ngrams(tools, 2, 4):
            ngram_doc[ng] += 1
        seen_words: set[str] = set()
        seen_bigrams: set[tuple] = set()
        for p in prompts:
            words = [w.lower() for w in _WORD.findall(p)]
            words = [w for w in words if w not in _STOP]
            for w in set(words):
                seen_words.add(w)
                if len(kw_examples[w]) < 4:
                    kw_examples[w].append({"session": sid, "prompt": p[:max_prompt]})
            for a, b in zip(words, words[1:]):
                seen_bigrams.add((a, b))
        for w in seen_words:
            keyword_doc[w] += 1
        for bg in seen_bigrams:
            bigram_doc[bg] += 1
        for s, c in skills_here.items():
            skill_doc[s] += 1
            skill_total[s] += c

        by_agent[agent] += 1
        sessions.append({
            "agent": agent,
            "project": proj,
            "session": sid,
            "mtime": int(fp.stat().st_mtime),
            "human_turns": len(prompts),
            "first_prompt": prompts[0][:max_prompt] if prompts else "",
            "tool_counts": dict(Counter(tools).most_common(12)),
            "skills_used": dict(skills_here),
        })

    def recurring(counter, n=min_sessions):
        return {k: v for k, v in counter.items() if v >= n}

    tool_ngrams = sorted(
        ({"seq": " > ".join(k), "sessions": v} for k, v in recurring(ngram_doc).items()),
        key=lambda d: (-d["sessions"], -len(d["seq"])),
    )
    keywords = sorted(
        ({"word": k, "sessions": v, "examples": kw_examples[k][:3]}
         for k, v in recurring(keyword_doc).items()),
        key=lambda d: -d["sessions"],
    )
    bigrams = sorted(
        ({"phrase": " ".join(k), "sessions": v} for k, v in recurring(bigram_doc).items()),
        key=lambda d: -d["sessions"],
    )
    skills = sorted(
        ({"skill": k, "sessions": skill_doc[k], "invocations": skill_total[k]}
         for k in skill_doc),
        key=lambda d: -d["sessions"],
    )

    return {
        "sources": {"claude": str(claude_dir), "codex": str(codex_dir)},
        "min_sessions": min_sessions,
        "sessions_total": len(sessions),
        "sessions_by_agent": dict(by_agent),
        "codex_spawned_skipped": skipped_spawned,
        "recurring_tool_ngrams": tool_ngrams,
        "recurring_prompt_keywords": keywords,
        "recurring_prompt_bigrams": bigrams,
        "skill_usage": skills,
        "sessions": sessions,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="wayne-distill Phase-1 session collector")
    ap.add_argument("--projects-dir", type=Path,
                    default=Path.home() / ".claude" / "projects",
                    help="root of Claude Code session transcripts")
    ap.add_argument("--codex-dir", type=Path,
                    default=Path.home() / ".codex" / "sessions",
                    help="root of Codex CLI session transcripts")
    ap.add_argument("--out", type=Path, default=Path("/tmp/wayne-distill-digest.json"))
    ap.add_argument("--min-sessions", type=int, default=3,
                    help="recurrence threshold: signal must span >= N sessions")
    ap.add_argument("--max-prompt", type=int, default=280)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    claude_dir = args.projects_dir if args.projects_dir.is_dir() else None
    codex_dir = args.codex_dir if args.codex_dir.is_dir() else None
    if claude_dir is None and codex_dir is None:
        log(f"FATAL: neither {args.projects_dir} nor {args.codex_dir} found")
        return 1
    if claude_dir is None:
        log(f"WARNING: Claude dir {args.projects_dir} not found — Codex only")
    if codex_dir is None:
        log(f"WARNING: Codex dir {args.codex_dir} not found — Claude only")

    digest = scan(claude_dir, codex_dir, args.min_sessions, args.max_prompt)
    args.out.write_text(json.dumps(digest, indent=2, ensure_ascii=False), encoding="utf-8")

    log(f"sessions={digest['sessions_total']} "
        f"by_agent={digest['sessions_by_agent']} "
        f"(codex spawned/skipped={digest['codex_spawned_skipped']}) "
        f"tool_ngrams>={args.min_sessions}: {len(digest['recurring_tool_ngrams'])} "
        f"keywords: {len(digest['recurring_prompt_keywords'])} "
        f"skills: {len(digest['skill_usage'])}")
    log(f"digest written -> {args.out}")

    # readable head for the operator
    by = digest["sessions_by_agent"]
    print(f"\n# wayne-distill digest  ({digest['sessions_total']} sessions "
          f"[claude={by.get('claude', 0)} codex={by.get('codex', 0)}], "
          f"threshold {args.min_sessions}+)\n")
    print("## Top recurring tool workflows")
    for d in digest["recurring_tool_ngrams"][:15]:
        print(f"  [{d['sessions']:>3}]  {d['seq']}")
    print("\n## Top recurring prompt keywords")
    for d in digest["recurring_prompt_keywords"][:25]:
        print(f"  [{d['sessions']:>3}]  {d['word']}")
    print("\n## Skill usage")
    for d in digest["skill_usage"][:25]:
        print(f"  [{d['sessions']:>3} sess / {d['invocations']:>3} calls]  {d['skill']}")
    if args.verbose:
        print("\n## Top recurring prompt bigrams")
        for d in digest["recurring_prompt_bigrams"][:25]:
            print(f"  [{d['sessions']:>3}]  {d['phrase']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
