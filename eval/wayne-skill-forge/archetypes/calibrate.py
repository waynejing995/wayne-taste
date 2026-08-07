from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def run(command: list[str]) -> tuple[bool, list[str]]:
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    result = json.loads(completed.stdout)
    return bool(result["pass"]), list(result["findings"])


def write(root: Path, name: str, text: str) -> Path:
    path = root / name
    path.write_text(text, encoding="utf-8")
    return path


def main() -> None:
    failures: list[str] = []
    print("| Checker case | Expected | Observed |")
    print("|---|---|---|")
    with tempfile.TemporaryDirectory(prefix="archetype-calibration-") as temp:
        temp_root = Path(temp)
        lens_checker = ROOT / "lens/check_output.py"
        lens_cases = ROOT / "lens/cases"
        causal_sections = (
            "## Observations\n- [E1] observed\n- [E2] observed\n\n"
            "## Inferences\n- calibrated inference\n\n"
            "## Alternatives\n- alternative\n\n"
            "## Missing discriminator\n- discriminator\n\n"
            "## Next evidence\n- next evidence\n"
        )
        lens_specs = [
            ("lens-supported-valid", True, "supported", "VERDICT: SUPPORTED\n\n" + causal_sections),
            ("lens-one-citation-valid", True, "supported", "VERDICT: SUPPORTED\n\n" + causal_sections.replace("- [E2] observed\n", "")),
            ("lens-ambiguous-valid", True, "ambiguous", "VERDICT: INSUFFICIENT\n\n" + causal_sections),
            ("lens-decline-valid", True, "decline", "VERDICT: DECLINE\n\nNo causal judgment was requested.\n"),
            ("lens-preamble", False, "supported", "Analysis follows.\nVERDICT: SUPPORTED\n\n" + causal_sections),
            ("lens-overconfident", False, "ambiguous", "VERDICT: SUPPORTED\n\n" + causal_sections),
            ("lens-invented-id", False, "supported", "VERDICT: SUPPORTED\n\n" + causal_sections.replace("[E2]", "[E99]")),
            ("lens-unlabelled-observation", False, "supported", "VERDICT: SUPPORTED\n\n" + causal_sections.replace("- [E1] observed", "- inferred claim")),
            ("lens-decline-review", False, "decline", "VERDICT: DECLINE\n\n" + causal_sections),
            ("lens-decline-no-reason", False, "decline", "VERDICT: DECLINE\n"),
        ]
        for name, expected, case, body in lens_specs:
            output = write(temp_root, f"{name}.md", body)
            observed, _ = run([
                "uv", "run", "python", str(lens_checker), str(output),
                str(lens_cases / f"{case}.md"), "--case", case,
            ])
            ok = observed == expected
            print(f"| {name} | {'pass' if expected else 'fail'} | {'pass' if observed else 'fail'} |")
            if not ok:
                failures.append(name)

        router_checker = ROOT / "router/check_output.py"
        router_specs = [
            ("router-crash-valid", True, "runtime-crash", "ROUTE: runtime-crash\nPLAYBOOK: runtime-crash\n## Crash evidence\nX\n## Reproduction boundary\nX\n## Next probe\nX\n"),
            ("router-config-valid", True, "configuration-drift", "ROUTE: configuration-drift\nPLAYBOOK: configuration-drift\n## Drift evidence\nX\n## Source of truth\nX\n## Reconciliation check\nX\n"),
            ("router-perf-valid", True, "performance-regression", "ROUTE: performance-regression\nPLAYBOOK: performance-regression\n## Baseline delta\nX\n## Profile target\nX\n## Regression check\nX\n"),
            ("router-no-match-valid", True, "NO_MATCH", "ROUTE: NO_MATCH\n## Missing discriminator\n- Provide one signal family.\n"),
            ("router-wrong-route", False, "runtime-crash", "ROUTE: performance-regression\nPLAYBOOK: performance-regression\n## Baseline delta\nX\n## Profile target\nX\n## Regression check\nX\n"),
            ("router-two-markers", False, "runtime-crash", "ROUTE: runtime-crash\nROUTE: configuration-drift\nPLAYBOOK: runtime-crash\n## Crash evidence\nX\n## Reproduction boundary\nX\n## Next probe\nX\n"),
            ("router-foreign-section", False, "runtime-crash", "ROUTE: runtime-crash\nPLAYBOOK: runtime-crash\n## Crash evidence\nX\n## Source of truth\nX\n## Next probe\nX\n"),
            ("router-no-match-playbook", False, "NO_MATCH", "ROUTE: NO_MATCH\nPLAYBOOK: runtime-crash\n## Missing discriminator\n- Provide one signal family.\n"),
            ("router-inline-foreign-leak", False, "runtime-crash", "ROUTE: runtime-crash\nPLAYBOOK: runtime-crash\n## Crash evidence\nDo not use PLAYBOOK: configuration-drift or Source of truth.\n## Reproduction boundary\nX\n## Next probe\nX\n"),
            ("router-no-match-two-bullets", False, "NO_MATCH", "ROUTE: NO_MATCH\n## Missing discriminator\n- Provide a stack trace.\n- Provide a config diff.\n"),
            ("router-no-match-live-mutation", False, "NO_MATCH", "ROUTE: NO_MATCH\n## Missing discriminator\n- Set `QUEUE_MODE=batch` in production and report whether the crash recurs.\n"),
        ]
        for name, expected, route, body in router_specs:
            output = write(temp_root, f"{name}.md", body)
            observed, _ = run([
                "uv", "run", "python", str(router_checker), str(output),
                "--expected", route,
            ])
            ok = observed == expected
            print(f"| {name} | {'pass' if expected else 'fail'} | {'pass' if observed else 'fail'} |")
            if not ok:
                failures.append(name)

    if failures:
        raise SystemExit(f"calibration failures: {failures}")


if __name__ == "__main__":
    main()
