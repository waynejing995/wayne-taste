#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "sentence-transformers",
#   "leidenalg",
#   "python-igraph",
#   "numpy",
# ]
# ///
"""Phase-1 collector for wayne-distill — semantic prompt clustering.

Walks BOTH agents' session transcripts (*.jsonl) — Claude Code under
`~/.claude/projects/` and Codex CLI under `~/.codex/sessions/` — and emits
`clusters.json`: semantic communities of individual human prompts, each with
its representative prompts and the set of distinct sessions it spans
(recurrence). Phase 2 (the skill runtime) fans an LLM analyst over the
communities to induce patterns and decide their fate.

Why prompt-level, not session-level: a recurring workflow (e.g. image-gen)
is often scattered mid-session across many sessions whose top-level topic is
something else. Session vectors bury it; per-prompt vectors surface it, and
recurrence = # distinct sessions a community spans.

Why embedding+Leiden, not word frequency: raw document-frequency is language-
blind (misses Chinese), can't merge synonyms ("生成图片" / "make an icon"),
and drowns signal words under generic ones. Multilingual sentence embeddings
cluster by MEANING across zh/en; Leiden finds communities without a preset K.

Run with `uv run` (PEP 723 header pulls deps). CPU is forced — never CUDA.
Cheap lexical signals (keyword / skill-usage) are still emitted as a weak
cross-check, but the communities are the primary product.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

# --- filters ---------------------------------------------------------------

# substrings anywhere → machine-authored, not human intent
_NOISE = (
    "<command-name>", "<command-message>", "caveat:", "local command",
    "<system-reminder", "<user-prompt-submit",
    "review this change for security vulnerabilities",
    "<task-notification", "<local-command-stdout", "<local-command-stderr",
    "<tool-use-id", "task-notification", "monitor event:",
    "this session is being continued from a previous",
    "you previously flagged these candidate",
)
# text STARTING with any of these → system turn leaked in as "user"
_JUNK_PREFIX = (
    "<task-notification", "<local-command-stdout", "<local-command-stderr",
    "[request interrupted", "[request cancelled", "<tool-use-id",
    "<system-reminder", "<command-",
)

# low-signal words dropped from the (secondary) keyword pass
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


def _is_junk(t: str) -> bool:
    low = t.lstrip().lower()
    return any(low.startswith(p) for p in _JUNK_PREFIX) or \
        any(n in low for n in _NOISE)


# --- transcript record shapes ---------------------------------------------

def claude_prompt(rec: dict) -> "str | None":
    if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isSidechain"):
        return None
    c = (rec.get("message") or {}).get("content")
    if isinstance(c, str):
        t = c
    elif isinstance(c, list):
        parts = [p.get("text", "") for p in c
                 if isinstance(p, dict) and p.get("type") == "text"]
        if not parts:  # tool_result-only turn — not human intent
            return None
        t = "\n".join(parts)
    else:
        return None
    t = t.strip()
    return None if (not t or _is_junk(t)) else t


def codex_prompt(rec: dict) -> "str | None":
    if rec.get("type") != "event_msg":
        return None
    p = rec.get("payload") or {}
    if p.get("type") != "user_message":
        return None
    t = p.get("message")
    if not isinstance(t, str):
        return None
    t = t.strip()
    return None if (not t or _is_junk(t)) else t


# --- collection ------------------------------------------------------------

def discover(claude_dir, codex_dir):
    src = []
    if claude_dir:
        src += [(fp, "claude") for fp in claude_dir.glob("*/*.jsonl")]
    if codex_dir:
        src += [(fp, "codex") for fp in codex_dir.glob("*/*/*/*.jsonl")]
    src.sort(key=lambda t: t[0].stat().st_mtime)
    return src


def collect(claude_dir, codex_dir, min_len, max_len):
    """Return (rows, kw_doc, kw_ex, skill_doc, skill_total, by_agent, skipped).

    rows: list of {text, session, agent} — one per unique human prompt.
    The rest are cheap secondary signals kept for cross-checking.
    """
    rows, seen = [], set()
    kw_doc = Counter()
    kw_ex = defaultdict(list)
    skill_doc = Counter()
    skill_total = Counter()
    by_agent = Counter()
    skipped = 0

    for fp, agent in discover(claude_dir, codex_dir):
        sid = fp.stem if agent == "claude" else fp.name
        meta_source = None
        prompts = []
        skills_here = Counter()
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
                        meta_source = (rec.get("payload") or {}).get("source")
                        continue
                    t = claude_prompt(rec) if agent == "claude" else codex_prompt(rec)
                    if t is None:
                        continue
                    prompts.append(t)
                    m = _SLASH.match(t)
                    if m:
                        skills_here[m.group(1)] += 1
                    sk = rec.get("attributionSkill")
                    if sk:
                        skills_here[sk] += 1
        except OSError as e:
            log(f"skip {fp}: {e}")
            continue

        # Codex worker/subagent runs = machine-authored harness, not intent
        if agent == "codex" and not (
                isinstance(meta_source, str) and meta_source != "exec"):
            skipped += 1
            continue
        if not prompts:
            continue

        by_agent[agent] += 1
        for s, c in skills_here.items():
            skill_doc[s] += 1
            skill_total[s] += c

        seen_words = set()
        for t in prompts:
            if min_len <= len(t) <= max_len:
                key = (sid, t)
                if key not in seen:
                    seen.add(key)
                    rows.append({"text": t, "session": sid, "agent": agent})
            for w in {w.lower() for w in _WORD.findall(t)} - _STOP:
                seen_words.add(w)
                if len(kw_ex[w]) < 3:
                    kw_ex[w].append({"session": sid, "prompt": t[:200]})
        for w in seen_words:
            kw_doc[w] += 1

    return rows, kw_doc, kw_ex, skill_doc, skill_total, by_agent, skipped


# --- semantic clustering ---------------------------------------------------

def cluster(rows, min_sessions, knn, thresh, resolution, model_name):
    import numpy as np
    from sentence_transformers import SentenceTransformer
    import igraph as ig
    import leidenalg as la

    texts = [r["text"] for r in rows]
    log(f"embedding {len(texts)} prompts on CPU ({model_name})…")
    model = SentenceTransformer(model_name, device="cpu")
    emb = model.encode(texts, batch_size=64, normalize_embeddings=True,
                       show_progress_bar=True)
    emb = np.asarray(emb, dtype=np.float32)

    log("building kNN similarity graph…")
    sims = emb @ emb.T
    n = len(texts)
    edges, weights = [], []
    for i in range(n):
        idx = np.argpartition(-sims[i], min(knn + 1, n - 1))[:knn + 1]
        for j in idx:
            if j <= i:
                continue
            w = float(sims[i, j])
            if w >= thresh:
                edges.append((i, j))
                weights.append(w)
    log(f"graph: {n} nodes, {len(edges)} edges")

    g = ig.Graph(n=n, edges=edges)
    g.es["weight"] = weights
    part = la.find_partition(
        g, la.RBConfigurationVertexPartition,
        weights="weight", resolution_parameter=resolution, seed=42)
    log(f"leiden: {len(part)} communities")

    comms = []
    for members in part:
        if len(members) < 3:
            continue
        sess = {rows[m]["session"] for m in members}
        if len(sess) < min_sessions:
            continue
        sub = emb[members]
        centroid = sub.mean(axis=0)
        order = np.argsort(-(sub @ centroid))
        reps, seen_r = [], set()
        for o in order:
            r = rows[members[o]]
            if r["text"] in seen_r:
                continue
            seen_r.add(r["text"])
            reps.append(r)
            if len(reps) >= 18:
                break
        comms.append({
            "sessions": len(sess),
            "prompts": len(members),
            "representative_prompts": reps,
        })
    comms.sort(key=lambda c: (-c["sessions"], -c["prompts"]))
    for i, c in enumerate(comms, 1):
        c["rank"] = i
    return comms


# --- main ------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="wayne-distill semantic collector")
    ap.add_argument("--projects-dir", type=Path,
                    default=Path.home() / ".claude" / "projects")
    ap.add_argument("--codex-dir", type=Path,
                    default=Path.home() / ".codex" / "sessions")
    ap.add_argument("--out", type=Path, default=Path("/tmp/wayne-distill-clusters.json"))
    ap.add_argument("--min-sessions", type=int, default=3,
                    help="a community must span >= N distinct sessions")
    ap.add_argument("--min-len", type=int, default=6,
                    help="drop prompts shorter than this (chars)")
    ap.add_argument("--max-len", type=int, default=500,
                    help="drop prompts longer than this (chars)")
    ap.add_argument("--knn", type=int, default=8)
    ap.add_argument("--threshold", type=float, default=0.45,
                    help="min cosine similarity for a graph edge")
    ap.add_argument("--resolution", type=float, default=1.2,
                    help="Leiden resolution; higher = more, smaller communities")
    ap.add_argument("--model", default="paraphrase-multilingual-MiniLM-L12-v2")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    claude_dir = args.projects_dir if args.projects_dir.is_dir() else None
    codex_dir = args.codex_dir if args.codex_dir.is_dir() else None
    if claude_dir is None and codex_dir is None:
        log(f"FATAL: neither {args.projects_dir} nor {args.codex_dir} found")
        return 1
    if claude_dir is None:
        log(f"WARNING: Claude dir {args.projects_dir} missing — Codex only")
    if codex_dir is None:
        log(f"WARNING: Codex dir {args.codex_dir} missing — Claude only")

    rows, kw_doc, kw_ex, skill_doc, skill_total, by_agent, skipped = collect(
        claude_dir, codex_dir, args.min_len, args.max_len)
    log(f"collected {len(rows)} unique human prompts "
        f"by_agent={dict(by_agent)} (codex spawned/skipped={skipped})")
    if not rows:
        log("FATAL: no human prompts collected")
        return 1

    comms = cluster(rows, args.min_sessions, args.knn, args.threshold,
                    args.resolution, args.model)

    def recurring(counter):
        return sorted(
            ({"word": k, "sessions": v, "examples": kw_ex[k][:3]}
             for k, v in counter.items() if v >= args.min_sessions),
            key=lambda d: -d["sessions"])

    digest = {
        "sources": {"claude": str(claude_dir), "codex": str(codex_dir)},
        "min_sessions": args.min_sessions,
        "prompts_total": len(rows),
        "sessions_by_agent": dict(by_agent),
        "codex_spawned_skipped": skipped,
        "communities": comms,
        "skill_usage": sorted(
            ({"skill": k, "sessions": skill_doc[k], "invocations": skill_total[k]}
             for k in skill_doc), key=lambda d: -d["sessions"]),
        "recurring_prompt_keywords": recurring(kw_doc),  # weak cross-check
    }
    args.out.write_text(json.dumps(digest, indent=1, ensure_ascii=False),
                        encoding="utf-8")
    log(f"wrote {args.out} ({len(comms)} communities)")

    by = digest["sessions_by_agent"]
    print(f"\n# wayne-distill clusters  ({len(rows)} prompts "
          f"[claude={by.get('claude', 0)} codex={by.get('codex', 0)}], "
          f"{len(comms)} communities >= {args.min_sessions} sessions)\n")
    for c in comms:
        reps = " | ".join(r["text"][:46].replace("\n", " ")
                          for r in c["representative_prompts"][:3])
        print(f"  [{c['rank']:>2}] s={c['sessions']:>3} p={c['prompts']:>3}  {reps}")
    if args.verbose:
        print("\n## skill usage")
        for d in digest["skill_usage"][:20]:
            print(f"  [{d['sessions']:>3} sess]  {d['skill']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
