#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click>=8.1", "loguru>=0.7"]
# ///
"""Deterministic structure scans for wayne-arch-sweep. No model call, no repository write.

    uv run scan_structure.py imports <root> [--boundary NAME=GLOB]... [--exclude GLOB]... [-o PATH]
    uv run scan_structure.py cochange <repo> [--since REV] [--root SUBDIR] [--boundary NAME=GLOB]...
    uv run scan_structure.py diff <old.json> <new.json>

`imports` reads Python sources only and skips dot-directories. Each scan prints one JSON object to stdout.
A boundary is the first path component unless a --boundary glob matches the path first.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
import warnings
from collections import Counter, defaultdict
from fnmatch import fnmatch
from itertools import combinations
from pathlib import Path

import click
from loguru import logger

SKIP_DIRS = {"venv", "node_modules", "__pycache__", "build", "dist"}
BULK_COMMIT_FILES = 50  # a commit touching more files is a sweep, not a signal that two boundaries change together


def parse_boundaries(specs: tuple[str, ...]) -> list[tuple[str, str]]:
    rules = []
    for spec in specs:
        name, sep, glob = spec.partition("=")
        if not sep or not name or not glob:
            raise click.BadParameter(f"expected NAME=GLOB, got {spec!r}", param_hint="--boundary")
        rules.append((name, glob))
    return rules


def boundary_of(rel_path: str, rules: list[tuple[str, str]]) -> str:
    for name, glob in rules:
        if fnmatch(rel_path, glob):
            return name
    head, sep, _ = rel_path.partition("/")
    return head if sep else "(root)"


def module_name(rel: Path, prefix: str) -> str:
    parts = list(rel.with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join([prefix, *parts] if prefix else parts)


def collect_modules(root: Path, excludes: tuple[str, ...], prefix: str) -> dict[str, Path]:
    modules: dict[str, Path] = {}
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        hidden = any(part.startswith(".") for part in rel.parts)
        if hidden or SKIP_DIRS.intersection(rel.parts) or any(fnmatch(rel.as_posix(), g) for g in excludes):
            continue
        name = module_name(rel, prefix)
        if name:
            modules[name] = rel
    return modules


def resolve(target: str, modules: dict[str, Path]) -> str | None:
    """Longest first-party module that `target` names or lives under."""
    parts = target.split(".")
    for end in range(len(parts), 0, -1):
        candidate = ".".join(parts[:end])
        if candidate in modules:
            return candidate
    return None

def _is_type_checking(expr: ast.expr) -> bool:
    return (isinstance(expr, ast.Name) and expr.id == "TYPE_CHECKING") or (
        isinstance(expr, ast.Attribute) and expr.attr == "TYPE_CHECKING"
    )


class ImportVisitor(ast.NodeVisitor):
    """Records (target, deferred) for every import; skips `if TYPE_CHECKING:` blocks."""

    def __init__(self, module: str, is_package: bool) -> None:
        self.package = module if is_package else module.rpartition(".")[0]
        self.depth = 0
        self.found: list[tuple[str, bool]] = []

    def visit_FunctionDef(self, node: ast.AST) -> None:
        self.depth += 1
        self.generic_visit(node)
        self.depth -= 1

    visit_AsyncFunctionDef = visit_FunctionDef
    visit_Lambda = visit_FunctionDef

    def visit_If(self, node: ast.If) -> None:
        if _is_type_checking(node.test):
            for child in node.orelse:
                self.visit(child)
            return
        if isinstance(node.test, ast.UnaryOp) and isinstance(node.test.op, ast.Not) and _is_type_checking(node.test.operand):
            for child in node.body:
                self.visit(child)
            return
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self.found.append((alias.name, self.depth > 0))

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        base = node.module or ""
        if node.level:
            anchor = self.package.split(".") if self.package else []
            anchor = anchor[: len(anchor) - (node.level - 1)] if node.level > 1 else anchor
            base = ".".join([*anchor, base] if base else anchor)
        for alias in node.names:
            # `from pkg import sub` names the submodule when one exists, else the package.
            self.found.append((f"{base}.{alias.name}" if base else alias.name, self.depth > 0))


def strongly_connected(nodes: set[str], edges: set[tuple[str, str]]) -> list[list[str]]:
    """Tarjan, iterative. Returns components with more than one node, largest first."""
    graph: dict[str, list[str]] = defaultdict(list)
    for src, dst in edges:
        graph[src].append(dst)
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    out: list[list[str]] = []
    counter = 0
    for start in sorted(nodes):
        if start in index:
            continue
        work = [(start, iter(graph[start]))]
        index[start] = low[start] = counter
        counter += 1
        stack.append(start)
        on_stack.add(start)
        while work:
            node, successors = work[-1]
            advanced = False
            for nxt in successors:
                if nxt not in index:
                    index[nxt] = low[nxt] = counter
                    counter += 1
                    stack.append(nxt)
                    on_stack.add(nxt)
                    work.append((nxt, iter(graph[nxt])))
                    advanced = True
                    break
                if nxt in on_stack:
                    low[node] = min(low[node], index[nxt])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                component = []
                while True:
                    member = stack.pop()
                    on_stack.discard(member)
                    component.append(member)
                    if member == node:
                        break
                if len(component) > 1:
                    out.append(sorted(component))
    return sorted(out, key=lambda c: (-len(c), c))


def git(repo: Path, *args: str) -> str:
    done = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if done.returncode != 0:
        logger.error(f"git {' '.join(args)} failed: {done.stderr.strip()}")
        sys.exit(2)
    return done.stdout


def head_sha(path: Path) -> str | None:
    done = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], capture_output=True, text=True)
    return done.stdout.strip() if done.returncode == 0 else None

def repo_relative_root(path: Path) -> str:
    resolved = path.resolve()
    done = subprocess.run(["git", "-C", str(resolved), "rev-parse", "--show-prefix"], capture_output=True, text=True)
    if done.returncode == 0:
        rel = done.stdout.strip().strip("/")
        return rel or "."
    return str(resolved)



@click.group()
@click.option("-v", "verbose", is_flag=True, help="Show DEBUG output.")
def cli(verbose: bool) -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO", format="{message}")


@cli.command()
@click.argument("root", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--boundary", "boundaries", multiple=True, help="NAME=GLOB over the path relative to ROOT; first match wins.")
@click.option("--exclude", "excludes", multiple=True, help="Glob over the relative path to leave out (tests, legacy).")
@click.option("--prefix", help="Dotted name that imports use for ROOT. Default: ROOT's name when ROOT is a package, else none.")
@click.option("--allow-sparse", is_flag=True, help="Accept a graph with almost no first-party edge.")
@click.option("-o", "--output", type=click.Path(dir_okay=False, path_type=Path), help="Write JSON atomically on success.")
def imports(
    root: Path,
    boundaries: tuple[str, ...],
    excludes: tuple[str, ...],
    prefix: str | None,
    allow_sparse: bool,
    output: Path | None,
) -> None:
    """First-party import graph: deferred share, edges that cross a boundary, and cycles."""
    rules = parse_boundaries(boundaries)
    if prefix is None:
        prefix = root.resolve().name if (root / "__init__.py").exists() else ""
    modules = collect_modules(root, excludes, prefix)
    if not modules:
        logger.error(f"no Python module under {root}: nothing was scanned")
        sys.exit(2)

    owner = {name: boundary_of(rel.as_posix(), rules) for name, rel in modules.items()}
    edges: dict[tuple[str, str], bool] = {}  # (src, dst) -> every import of dst in src is deferred
    unparsed: list[str] = []
    warnings.simplefilter("ignore", SyntaxWarning)  # warnings about the scanned sources are not scan output
    for name, rel in modules.items():
        try:
            tree = ast.parse((root / rel).read_text(encoding="utf-8", errors="replace"))
        except SyntaxError as exc:
            unparsed.append(f"{rel.as_posix()}:{exc.lineno}")
            continue
        visitor = ImportVisitor(name, rel.name == "__init__.py")
        visitor.visit(tree)
        for target, deferred in visitor.found:
            dst = resolve(target, modules)
            if dst and dst != name:
                edges[(name, dst)] = edges.get((name, dst), True) and deferred

    # A graph this sparse means the imports did not resolve (wrong ROOT or --prefix), not that the code is clean.
    if len(modules) >= 20 and len(edges) < len(modules) // 5 and not allow_sparse:
        logger.error(
            f"{len(edges)} first-party edges for {len(modules)} modules: ROOT or --prefix does not match how the code "
            "imports itself. Fix them, or pass --allow-sparse if the modules really are independent."
        )
        sys.exit(2)

    crossing = {pair: deferred for pair, deferred in edges.items() if owner[pair[0]] != owner[pair[1]]}
    pair_total: Counter[tuple[str, str]] = Counter()
    pair_deferred: Counter[tuple[str, str]] = Counter()
    target_boundaries: dict[str, set[str]] = defaultdict(set)
    target_importers: Counter[str] = Counter()
    for (src, dst), deferred in crossing.items():
        key = (owner[src], owner[dst])
        pair_total[key] += 1
        pair_deferred[key] += deferred
        target_boundaries[dst].add(owner[src])
        target_importers[dst] += 1

    top_cross_boundary_targets = [
        {
            "module": dst,
            "path": modules[dst].as_posix(),
            "boundary": owner[dst],
            "importing_boundaries": sorted(bset),
            "cross_boundary_importers": target_importers[dst],
        }
        for dst, bset in sorted(
            ((m, bs) for m, bs in target_boundaries.items() if len(bs) >= 2),
            key=lambda kv: (-len(kv[1]), -target_importers[kv[0]], kv[0]),
        )[:15]
    ]
    def cycles(include_deferred: bool) -> dict:
        kept = {pair for pair, deferred in edges.items() if include_deferred or not deferred}
        module_cycles = strongly_connected(set(modules), kept)
        boundary_edges = {(owner[s], owner[d]) for s, d in kept if owner[s] != owner[d]}
        return {
            "modules_in_cycles": sum(len(c) for c in module_cycles),
            "module_cycle_sizes": [len(c) for c in module_cycles],
            "largest_module_cycle_sample": module_cycles[0][:20] if module_cycles else [],
            "boundary_cycles": strongly_connected(set(owner.values()), boundary_edges),
        }

    result = {
        "scan": "imports",
        "root": str(root.resolve()),
        "relative_root": repo_relative_root(root),
        "prefix": prefix,
        "commit": head_sha(root),
        "boundary_rules": [f"{n}={g}" for n, g in rules] or "first path component",
        "excludes": sorted(excludes),
        "modules": len(modules),
        "unparsed": unparsed,
        "edges": {"total": len(edges), "deferred": sum(edges.values())},
        "cross_boundary": {
            "total": len(crossing),
            "deferred": sum(crossing.values()),
            "pairs": [
                {"from": a, "to": b, "edges": n, "deferred": pair_deferred[(a, b)]}
                for (a, b), n in sorted(pair_total.items(), key=lambda kv: (-kv[1], kv[0]))
            ],
            "top_cross_boundary_targets": top_cross_boundary_targets,
        },
        "cycles": {"import_time": cycles(False), "with_deferred": cycles(True)},
    }
    logger.info(
        f"{len(modules)} modules, {len(edges)} edges ({sum(edges.values())} deferred), "
        f"{len(crossing)} cross a boundary ({sum(crossing.values())} deferred)"
    )
    payload = json.dumps(result, indent=2, ensure_ascii=False)
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        tmp = output.with_name(f".{output.name}.tmp")
        tmp.write_text(payload + "\n", encoding="utf-8")
        tmp.replace(output)
    else:
        print(payload)


@cli.command()
@click.argument("repo", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--since", help="Revision of the previous sweep; scans REV..HEAD. Default: the last 300 commits.")
@click.option(
    "--root",
    "subdir",
    help="Repository-relative directory matching `imports <root>`; filters to files under it and strips the prefix before applying --boundary.",
)
@click.option("--boundary", "boundaries", multiple=True, help="NAME=GLOB over paths relative to --root (or repo root); first match wins.")
def cochange(repo: Path, since: str | None, subdir: str | None, boundaries: tuple[str, ...]) -> None:
    """Hot files and boundary pairs that change in the same commit."""
    rules = parse_boundaries(boundaries)
    strip_prefix = ""
    if subdir:
        cleaned = subdir.strip("/")
        if cleaned and cleaned != ".":
            strip_prefix = cleaned + "/"
    span = [f"{since}..HEAD"] if since else ["-n", "300"]
    log = git(repo, "log", "--no-merges", "--name-only", "--format=%x00%H", *span)
    commits = [block.strip().splitlines() for block in log.split("\x00") if block.strip()]
    if not commits and not since:
        logger.error(f"no commit in {' '.join(span)}: nothing was scanned")
        sys.exit(2)

    hot: Counter[str] = Counter()
    pairs: Counter[tuple[str, str]] = Counter()
    bulk = 0
    for lines in commits:
        files = [line for line in lines[1:] if line.strip()]
        if len(files) > BULK_COMMIT_FILES:
            bulk += 1
            continue
        if strip_prefix:
            scoped = [f[len(strip_prefix) :] for f in files if f.startswith(strip_prefix)]
        else:
            scoped = files
        if not scoped:
            continue
        hot.update(scoped)
        touched = sorted({boundary_of(f, rules) for f in scoped})
        pairs.update(combinations(touched, 2))

    result = {
        "scan": "cochange",
        "repo": str(repo.resolve()),
        "root": strip_prefix.rstrip("/") or ".",
        "commit": head_sha(repo),
        "range": " ".join(span),
        "commits": len(commits),
        "bulk_commits_skipped": bulk,
        "hot_files": [{"path": p, "commits": n} for p, n in hot.most_common(25)],
        "boundary_pairs": [{"a": a, "b": b, "commits": n} for (a, b), n in pairs.most_common(25)],
    }
    logger.info(f"{len(commits)} commits, {bulk} bulk skipped, {len(pairs)} boundary pairs changed together")
    print(json.dumps(result, indent=2, ensure_ascii=False))


@cli.command()
@click.argument("old", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.argument("new", type=click.Path(exists=True, dir_okay=False, path_type=Path))
def diff(old: Path, new: Path) -> None:
    """Drift between two `imports` scans. Exit 1 when the structure got worse."""
    try:
        before, after = (json.loads(p.read_text(encoding="utf-8")) for p in (old, new))
        if not isinstance(before, dict) or not isinstance(after, dict):
            raise TypeError("scan root must be a JSON object")
        if before.get("scan") != "imports" or after.get("scan") != "imports":
            logger.error("both files must be `imports` scans")
            sys.exit(2)
        before_key = (
            before["boundary_rules"],
            before["prefix"],
            before.get("excludes", []),
            before.get("relative_root", before.get("root")),
        )
        after_key = (
            after["boundary_rules"],
            after["prefix"],
            after.get("excludes", []),
            after.get("relative_root", after.get("root")),
        )
        if before_key != after_key:
            logger.error("the two scans used different relative_root, excludes, boundary rules, or prefix: their numbers are not comparable")
            sys.exit(2)

        def pair_map(scan: dict) -> dict[tuple[str, str], int]:
            return {(p["from"], p["to"]): p["edges"] for p in scan["cross_boundary"]["pairs"]}

        def cycle_set(scan: dict) -> set[tuple[str, ...]]:
            return {tuple(c) for c in scan["cycles"]["with_deferred"]["boundary_cycles"]}

        old_pairs, new_pairs = pair_map(before), pair_map(after)
        result = {
            "scan": "diff",
            "from_commit": before["commit"],
            "to_commit": after["commit"],
            "new_boundary_pairs": [
                {"from": a, "to": b, "edges": n} for (a, b), n in sorted(new_pairs.items()) if (a, b) not in old_pairs
            ],
            "grown_boundary_pairs": [
                {"from": a, "to": b, "before": old_pairs[(a, b)], "after": n}
                for (a, b), n in sorted(new_pairs.items())
                if (a, b) in old_pairs and n > old_pairs[(a, b)]
            ],
            "new_boundary_cycles": [list(c) for c in sorted(cycle_set(after) - cycle_set(before))],
            "cross_boundary_deferred": {
                "before": before["cross_boundary"]["deferred"],
                "after": after["cross_boundary"]["deferred"],
            },
            "modules_in_cycles_with_deferred": {
                "before": before["cycles"]["with_deferred"]["modules_in_cycles"],
                "after": after["cycles"]["with_deferred"]["modules_in_cycles"],
            },
        }
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        logger.error(f"invalid scan JSON: {exc}")
        sys.exit(2)
    worse = bool(
        result["new_boundary_pairs"]
        or result["grown_boundary_pairs"]
        or result["new_boundary_cycles"]
        or result["cross_boundary_deferred"]["after"] > result["cross_boundary_deferred"]["before"]
        or result["modules_in_cycles_with_deferred"]["after"] > result["modules_in_cycles_with_deferred"]["before"]
    )
    result["worse"] = worse
    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(1 if worse else 0)


if __name__ == "__main__":
    cli()
