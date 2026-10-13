#!/usr/bin/env python3
"""Calibrate check.py: validate verdicts and mutations."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


def run_check(case: str, answer_content: str) -> tuple[bool, dict]:
    """Run check.py on given answer; return (passed, result_dict)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        answer_file = tmpdir_path / "answer.md"
        answer_file.write_text(answer_content, encoding="utf-8")
        result = subprocess.run(
            [sys.executable, "check.py", case, str(tmpdir_path)],
            cwd=Path(__file__).parent,
            capture_output=True,
            text=True,
        )
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            return False, {"error": result.stdout}
        return result.returncode == 0, data


print("Calibrating check.py for v2 lens evaluation...\n")

# Test 1: straightforward ACCEPTABLE
valid = """VERDICT: ACCEPTABLE

## Application use

- Parses SQL (§1).

## Change summary

- No breaking changes (§4).

## Impact scenarios

- No impact (line 42-47).

## Risk classification

Safe.
"""
p, r = run_check("straightforward-safe-upgrade", valid)
assert p, f"Valid should pass: {r.get('findings')}"
print("✓ straightforward: valid ACCEPTABLE")

# Mutation: prose before VERDICT
p, r = run_check("straightforward-safe-upgrade", "Text\nVERDICT: ACCEPTABLE\n\n## Application use\n- Text")
assert not p, "VERDICT not first should fail"
print("✓ straightforward: VERDICT not first line fails")

# Mutation: missing section
p, r = run_check("straightforward-safe-upgrade", valid.replace("## Risk classification", ""))
assert not p
print("✓ straightforward: missing section fails")

# Mutation: wrong section order
swap = valid.replace("## Impact scenarios", "## TEMP").replace("## Risk classification", "## Impact scenarios").replace("## TEMP", "## Risk classification")
p, r = run_check("straightforward-safe-upgrade", swap)
assert not p
print("✓ straightforward: wrong section order fails")

# Mutation: invented section reference
p, r = run_check("straightforward-safe-upgrade", valid.replace("§1", "§99"))
assert not p
print("✓ straightforward: invented section ref fails")

# Mutation: invented evidence ID
p, r = run_check("straightforward-safe-upgrade", valid.replace("(§4)", "([E99])"))
assert not p
print("✓ straightforward: invented evidence ID fails")

# Mutation: out-of-range line reference
p, r = run_check("straightforward-safe-upgrade", valid.replace("line 42-47", "line 999"))
assert not p
print("✓ straightforward: out-of-range line fails")

# Mutation: wrong verdict
p, r = run_check("straightforward-safe-upgrade", valid.replace("ACCEPTABLE", "UNACCEPTABLE"))
assert not p
print("✓ straightforward: wrong verdict fails")

# Test 2: breaking-change-workaround AWP with source-line ref
valid2 = """VERDICT: ACCEPTABLE-WITH-PRECAUTIONS

## Application use

- Interceptor at line 15-22 (§2).

## Change summary

- Breaking change (§5.1).

## Impact scenarios

- Fallback works.

## Risk classification

Proven fallback (§3, [E3]).

## Precautions

- Test in staging.
"""
p, r = run_check("breaking-change-workaround-exists", valid2)
assert p, f"Valid AWP with source-line ref should pass: {r.get('findings')}"
print("✓ breaking-change-workaround: valid with source-line ref")

# Mutation: missing Precautions
p, r = run_check("breaking-change-workaround-exists", valid2.replace("## Precautions\n\n- Test", ""))
assert not p
print("✓ breaking-change-workaround: missing Precautions fails")

# Mutation: empty Precautions
p, r = run_check("breaking-change-workaround-exists", valid2.replace("- Test in staging.", ""))
assert not p
print("✓ breaking-change-workaround: empty Precautions fails")

# Test 3: UNACCEPTABLE critical-path
valid3 = """VERDICT: UNACCEPTABLE

## Application use

- Critical path (§2).

## Change summary

- Breaking change (§5.3).

## Impact scenarios

- Workers disconnected (§5.3).

## Risk classification

Unacceptable.

## Precautions

None.
"""
p, r = run_check("breaking-change-critical-path", valid3)
assert p, f"Valid UNACCEPTABLE should pass: {r.get('findings')}"
print("✓ breaking-change-critical-path: valid UNACCEPTABLE")

# Mutation: empty core section
p, r = run_check("breaking-change-critical-path", """VERDICT: UNACCEPTABLE

## Application use


## Change summary

- Text.

## Impact scenarios

- Text.

## Risk classification

- Text.

## Precautions

- None.
""")
assert not p
print("✓ breaking-change-critical-path: empty core section fails")

# Test 4: unlock-security-fix AWP
valid4 = """VERDICT: ACCEPTABLE-WITH-PRECAUTIONS

## Application use

- HMAC API (line 52-67).

## Change summary

- API removed (§5.2).

## Impact scenarios

- Won't compile.

## Risk classification

Security fix required ([E1]).

## Precautions

- Migrate.
"""
p, r = run_check("unlock-security-fix", valid4)
assert p, f"Valid AWP should pass: {r.get('findings')}"
print("✓ unlock-security-fix: valid AWP")

# Test 5: mixed-breaking-and-capability AWP
valid5 = """VERDICT: ACCEPTABLE-WITH-PRECAUTIONS

## Application use

- Mounts at line 55-60 (§2).

## Change summary

- API change (§5.4).

## Impact scenarios

- Migrate code.

## Risk classification

Low-cost fix.

## Precautions

- Migrate.
"""
p, r = run_check("mixed-breaking-and-capability", valid5)
assert p, f"Valid AWP should pass: {r.get('findings')}"
print("✓ mixed-breaking-and-capability: valid AWP")

# Test 6: partial-decline ACCEPTABLE + decline
valid6 = """VERDICT: ACCEPTABLE

## Application use

- _.pick, _.omit (§2).

## Change summary

- Unchanged (§5.1).

## Impact scenarios

- No impact.

## Risk classification

Acceptable.

---

Part B requests a judgment for the Data Platform team, which is outside this skill's scope.
"""
p, r = run_check("partial-decline-mixed-scope", valid6)
assert p, f"Valid ACCEPTABLE + decline should pass: {r.get('findings')}"
print("✓ partial-decline-mixed-scope: valid ACCEPTABLE + decline")

# Mutation: pure DECLINE for partial-decline
p, r = run_check("partial-decline-mixed-scope", "VERDICT: DECLINE\n\nOut of scope.")
assert not p
print("✓ partial-decline-mixed-scope: pure DECLINE fails")

# Test 7: decline-no-context
valid7 = "VERDICT: DECLINE\n\nNo application context."
p, r = run_check("decline-no-context", valid7)
assert p
print("✓ decline-no-context: valid DECLINE")

# Mutation: DECLINE with review sections
p, r = run_check("decline-no-context", "VERDICT: DECLINE\n\n## Application use\n\nText.")
assert not p
print("✓ decline-no-context: DECLINE with sections fails")

# Mutation: DECLINE without reason line
p, r = run_check("decline-no-context", "VERDICT: DECLINE")
assert not p
print("✓ decline-no-context: DECLINE without reason fails")

# Test 8: decline-holistic-monorepo
valid8 = "VERDICT: DECLINE\n\nMonorepo-wide decision is out of scope."
p, r = run_check("decline-holistic-monorepo", valid8)
assert p
print("✓ decline-holistic-monorepo: valid DECLINE")

print("\n✅ All calibration tests passed!")
