#!/usr/bin/env python3
"""Calibrate Wayne Test Design artifact checks."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from check_trial import check


H = Path(__file__).resolve().parent
SKILL = H.parent.parent / "wayne-test-design"
HEADER = "| ID | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |"
Mutation = Callable[[Path], None]


def seed(root: Path, case: str, body: str) -> Path:
    subprocess.run(["bash", str(H / "prepare_trial.sh"), case, str(SKILL), str(root)], check=True, capture_output=True)
    path = root / "repo/docs/test-matrix/matrix.md"
    path.parent.mkdir(parents=True)
    path.write_text(body, encoding="utf-8")
    return root


def common(e: str, extra: str = "") -> str:
    return f"""# Matrix

## U-SEED (wayne-plan re-authors + locks)
| # | Unit | Dimension | Case | Layer | Status |
|---|---|---|---|---|---|
| U1 | core | positive | input → action → expected | unit | ☐ |

{extra}
## E2E Verification Contract
{HEADER}
|---|---|---|---|---|---|---|
{e}
"""


def common_without_useed(e: str, extra: str = "") -> str:
    return f"""# Matrix

## U-SEED (wayne-plan re-authors + locks)
U-SEED: none — no stable implementation-independent unit behavior exists

{extra}
## E2E Verification Contract
{HEADER}
|---|---|---|---|---|---|---|
{e}
"""


def replace(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise AssertionError(f"missing mutation source {old!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="test-design-cal-") as temp:
        root = Path(temp)
        provider_rows = "\n".join([
            "| E1 | Alpha user streams in unverified mode | alpha process | alpha data | alpha CLI | streaming output includes POLICY UNVERIFIED | ⬜ |",
            "| E2 | Alpha operator checks strict policy | alpha process | alpha data | alpha strict CLI | runtime.policy_verified=true | ⬜ |",
            "| E3 | Beta user streams in unverified mode | beta process | beta data | beta CLI | streaming output includes POLICY UNVERIFIED | ⬜ |",
            "| E4 | Beta operator checks strict policy | beta process | beta data | beta strict CLI | response.attestation_state=verified | ⬜ |",
            "| E5 | User fans a request out to Alpha and Beta while one provider fails | batch process | two inputs | batch CLI | combined output retains both Alpha and Beta result entries, including the named failure | ⬜ |",
        ])
        provider = seed(root / "provider", "provider-isolation", common(provider_rows, "## E2E Proof-Axis Audit\nFunctional, attestation, and fan-out axes are isolated.\n"))

        proof_rows = "\n".join([
            "| E1 | Delta streams | process | data | CLI | stream output says POLICY UNVERIFIED | ⬜ |",
            "| E2 | Delta disconnects mid-stream and resumes | process | session | resume CLI | resume emits remaining tokens exactly once | ⬜ |",
            "| E3 | Delta attests | process | policy | strict CLI | session.policy_state=verified | ⬜ |",
            "| E4 | Delta terminal failure | process | failure | CLI | child processes are gone and the lease is released | ⬜ |",
        ])
        proof = seed(root / "proof", "proof-axis", common(proof_rows))

        missing_rows = "| E1 | User asks planning to implement Gamma encrypted reasoning | planner | approved spec | plan command | planning stops on the unresolved proof conflict because native runtime evidence is missing | ⬜ |"
        missing = seed(root / "missing", "missing-native-evidence", common_without_useed(missing_rows, "## Capability conflicts requiring scope resolution\nR1 capability conflict: `--encrypted-reasoning` proves requested intent only. No native runtime proof is available.\n"))

        simple_body = """# Matrix
## U-SEED (wayne-plan re-authors + locks)
| # | Unit | Dimension | Case | Layer | Status |
|---|---|---|---|---|---|
| U1 | slug | positive | `"Hello World"` → normalize → `"hello-world"` | unit | ☐ |
| U2 | slug | edge | `""` → normalize → `""` | unit | ☐ |
| U3 | slug | invalid | non-string → normalize → TypeError | unit | ☐ |
## E2E Verification Contract
| ID | User path | Env: process | Env: data | Env: entrypoint | Observable (pass = ?) | Status |
|---|---|---|---|---|---|---|
E2E: none — pure function has no user-observable runtime path
"""
        simple = seed(root / "simple", "simple", simple_body)

        exact = '| E-EXACT | User exports the report | `tool service --port 9000` | fixture `reports/demo.db` | `tool export --format json` | downloaded `report.json` contains exact JSON `{"ok":true}` | ⬜ |'
        absorb = seed(root / "absorb", "absorb-existing", common(exact, "Absorbed the spec draft; this matrix is the single source of truth (SSoT).\n"))

        bases = [(provider, "provider-isolation"), (proof, "proof-axis"), (missing, "missing-native-evidence"), (simple, "simple"), (absorb, "absorb-existing")]
        for workspace, case in bases:
            findings = check(workspace, case)
            if findings:
                raise AssertionError(f"positive {case}: {findings}")

        mutations: list[tuple[Path, str, str, Mutation, str]] = []
        def add(base: Path, case: str, label: str, fn: Mutation, needle: str) -> None:
            mutations.append((base, case, label, fn, needle))

        for base, case in bases:
            add(base, case, "no-matrix", lambda p: (p / "repo/docs/test-matrix/matrix.md").unlink(), "artifact missing")
            add(base, case, "outside", lambda p: (p / "repo/product.py").write_text("bad\n"), "outside")
            add(base, case, "no-useed", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "U-SEED", "Unit candidates"), "U-SEED")
            add(base, case, "bad-header", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "Env: process", "Environment"), "locked E2E header")
        add(provider, "provider-isolation", "u-completed", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "| U1 | core | positive | input → action → expected | unit | ☐ |", "| U1 | core | positive | input → action → expected | unit | ☑ |"), "U-SEED contains executor-owned")
        add(provider, "provider-isolation", "e-completed", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "| E1 | Alpha user streams in unverified mode | alpha process | alpha data | alpha CLI | streaming output includes POLICY UNVERIFIED | ⬜ |", "| E1 | Alpha user streams in unverified mode | alpha process | alpha data | alpha CLI | streaming output includes POLICY UNVERIFIED | ✅ |"), "E2E design contains executor-owned")
        add(provider, "provider-isolation", "no-audit", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "Proof-Axis Audit", "Notes"), "Proof-Axis")
        add(provider, "provider-isolation", "no-alpha-functional", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "| E1 | Alpha user streams in unverified mode | alpha process | alpha data | alpha CLI | streaming output includes POLICY UNVERIFIED | ⬜ |", "| E1 | Alpha user runs in unverified mode | alpha process | alpha data | alpha CLI | output includes POLICY UNVERIFIED | ⬜ |"), "functional row: alpha")
        add(provider, "provider-isolation", "no-beta-native", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "response.attestation_state", "flag accepted"), "native attestation row: beta")
        add(provider, "provider-isolation", "no-unverified", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "POLICY UNVERIFIED", "normal",), "POLICY UNVERIFIED")
        add(provider, "provider-isolation", "no-fanout", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "fans a request out", "runs separately"), "fan-out row")
        add(provider, "provider-isolation", "drops-failed-outcome", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "retains both Alpha and Beta result entries, including the named failure", "returns only the successful Beta result"), "fan-out row")
        add(proof, "proof-axis", "no-resume", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "| E2 | Delta disconnects mid-stream and resumes | process | session | resume CLI | resume emits remaining tokens exactly once | ⬜ |", "| E2 | Delta continues | process | session | continue CLI | emits remaining tokens | ⬜ |"), "proof axis: resume")
        add(proof, "proof-axis", "weak-resume", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "resume emits remaining tokens exactly once", "resume exits zero"), "proof axis: resume")
        add(proof, "proof-axis", "coupled", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "resume emits remaining tokens exactly once", "resume makes the remaining tokens appear progressively and exactly once"), "multiple proof axes")
        add(proof, "proof-axis", "no-cleanup", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "child processes are gone and the lease is released", "failure is reported"), "proof axis: cleanup")
        add(missing, "missing-native-evidence", "no-conflict", lambda p: (replace(p / "repo/docs/test-matrix/matrix.md", "Capability conflicts", "Capability notes"), replace(p / "repo/docs/test-matrix/matrix.md", "capability conflict", "capability note"), replace(p / "repo/docs/test-matrix/matrix.md", "proof conflict", "proof note")), "conflict is not surfaced")
        add(missing, "missing-native-evidence", "plan-continues", lambda p: (replace(p / "repo/docs/test-matrix/matrix.md", "planning stops", "planning continues"), replace(p / "repo/docs/test-matrix/matrix.md", "proof conflict", "proof gap")), "does not block planning")
        add(missing, "missing-native-evidence", "flag-as-proof", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "requested intent", "effective capability"), "requested intent")
        add(missing, "missing-native-evidence", "implicit-no-useed", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "U-SEED: none — no stable implementation-independent unit behavior exists", "No unit rows"), "provisional U-SEED")
        add(missing, "missing-native-evidence", "positive-capability-row", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "planning stops on the unresolved proof conflict because native runtime evidence is missing", "Gamma encrypted reasoning is effective in production"), "unreachable positive")
        add(simple, "simple", "no-lower", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", '`"hello-world"`', '`"Hello World"`'), "misses behavior: lower")
        add(simple, "simple", "no-empty", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", '`""` → normalize → `""`', '`""` → normalize → `"x"`'), "misses behavior: empty")
        add(simple, "simple", "invent-e2e", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "E2E: none — pure function has no user-observable runtime path", "| E1 | user runs | proc | data | CLI | result | ⬜ |"), "invented E2E")
        add(absorb, "absorb-existing", "drift", lambda p: replace(p / "repo/docs/test-matrix/matrix.md", "reports/demo.db", "reports/other.db"), "carried verbatim")
        add(absorb, "absorb-existing", "no-owner", lambda p: (replace(p / "repo/docs/test-matrix/matrix.md", "Absorbed", "Copied"), replace(p / "repo/docs/test-matrix/matrix.md", "single source of truth (SSoT)", "copy")), "absorbed E2E ownership")

        out = root / "mutations"; out.mkdir()
        for i, (base, case, label, fn, needle) in enumerate(mutations):
            trial = out / f"{i:02d}-{case}-{label}"; shutil.copytree(base, trial); fn(trial)
            findings = check(trial, case)
            if not any(needle in finding for finding in findings):
                raise AssertionError(f"{case}/{label} escaped {needle}: {findings}")
    print(f"PASS: 5 positive lanes and {len(mutations)} independent mutations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
