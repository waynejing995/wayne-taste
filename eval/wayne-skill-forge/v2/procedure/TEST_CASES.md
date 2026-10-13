# v2 Procedure Test Cases — Multi-Tier Schema Rollout

## Overview

Eight discriminating cases covering the key hinge clauses in the intent. Each case is designed to fail if a common implementation mistake is made.

### Case 1: prod-success-with-backup

**What it tests:**

- Approval runs exactly once and succeeds
- Backup is required for prod + destructive, and runs before apply
- Canary and canary_verify must complete successfully before apply
- Apply runs exactly once
- Verify succeeds

**Intent clauses:**

- "Run approval_command exactly once"
- "If destructiveness is destructive and environment is prod, run backup_command exactly once before any mutation"
- "Run canary_command to deploy to a canary environment. If canary_command fails, stop"
- "Run canary_verify_command... If canary_verify_command reports metric_threshold_ok, proceed to apply_command"
- "Run apply_command exactly once"

**Error case:** Missing backup, approval runs twice, apply runs twice

---

### Case 2: staging-read-only

**What it tests:**

- Staging environment auto-approves even if approval_result is unapproved
- Read-only destructiveness does NOT require backup
- Canary and verify still run
- Skill respects the environment tier, not just the approval result

**Intent clauses:**

- "If environment is staging or test, treat unapproved as approved"
- "If destructiveness is read-only, do not run backup_command"

**Error case:** Backup runs for read-only, or approval gate blocks staging

---

### Case 3: prod-backup-fails

**What it tests:**

- Backup failure stops the entire rollout
- No canary, no apply, no verify should run after backup failure
- Backup is required and cannot be skipped for prod destructive

**Intent clauses:**

- "If destructiveness is destructive and environment is prod, run backup_command exactly once before any mutation"
- Backup failure must halt rollout (implicit in sequence)

**Error case:** Apply or canary run after backup fails

---

### Case 4: test-skips-approval

**What it tests:**

- Test environment skips approval entirely (treats it as auto-approved)
- Read-only test cases don't need backup
- Canary and verify still run

**Intent clauses:**

- "If environment is staging or test, treat unapproved as approved"
- "If destructiveness is read-only, do not run backup_command"

**Error case:** Approval is required for test, or backup runs

---

### Case 5: metric-threshold-breach

**What it tests:**

- Canary_verify result of "metric_threshold_breach" STOPS the rollout
- Apply must NOT run after metric threshold breach
- This is a gate that occurs BEFORE apply, not after

**Intent clauses:**

- "Run canary_verify_command... If the result reports a metric_threshold_breach, stop. Do not proceed to apply."

**Error case:** Apply runs after metric breach, or metric breach is ignored

---

### Case 6: rollback-short-circuits-retry

**What it tests:**

- When verify fails AND rollback is enabled, rollback runs INSTEAD of retry
- Rollback takes precedence over verify retry
- After rollback, no further verify attempts should be made
- This is the key "precedence of rollback over retry" clause

**Intent clauses:**

- "If rollback is enabled and rollback_command exists, run rollback_command exactly once. After rollback, stop. Do not retry."
- "Rollback always takes precedence over retry"

**Error case:** Verify retries after rollback, or rollback is skipped

---

### Case 7: canary-deploy-fails

**What it tests:**

- Canary deploy failure stops the rollout before apply
- Canary_verify doesn't run if canary deploy fails
- No apply, no verify after canary failure

**Intent clauses:**

- "Run canary_command to deploy to a canary environment. If canary_command fails, stop. Do not proceed to apply."

**Error case:** Apply or verify run after canary fails

---

### Case 8: maintenance-window-out-of-range

**What it tests:**

- Maintenance window check occurs after approval but before canary
- Out-of-range window value stops the rollout
- Window check is a gate distinct from other checks

**Intent clauses:**

- "After approval but before apply_command, check the request for a maintenance_window"
- "If maintenance_window is specified and the current time is outside the window... fail and report window_not_in_range"

**Error case:** Canary or apply run when outside maintenance window, or window check is skipped

---

## Discriminating Clauses Covered

| Clause                               | Cases      |
| ------------------------------------ | ---------- |
| Approval runs once                   | 1, 2, 4, 6 |
| Backup gate (destructive + prod)     | 1, 3, 6, 8 |
| Backup skipped (read-only)           | 2, 4       |
| Canary runs before apply             | 1, 5, 7, 8 |
| Metric threshold breach stops apply  | 5          |
| Rollback precedes retry              | 6          |
| Maintenance window gate              | 8          |
| Environment tier determines approval | 2, 4       |
| Apply runs exactly once              | 1          |
| Canary failure stops rollout         | 7          |
