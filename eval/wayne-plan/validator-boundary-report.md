# Plan runtime-validator removal hotfix

## Reproduced failure

The former `snapshot` / `check` workflow recursively opened every repository file.
Unrelated unreadable stale `.pyc` files blocked plan authoring and pushed the agent
to request deletion or permission changes outside plan scope. This was an evaluator
defect, not a plan or environment defect.

## Corrected ownership

- `wayne-plan/scripts/validate_plan.py` is removed.
- Plan Markdown has no runtime grammar, heading/order, table-shape, regex, manifest,
  or five-line blocker gate.
- Test-matrix U/E information is consumed by ownership and meaning, not one fixed
  heading or table layout.
- Starting `HEAD` and `git status`, agent write history, and final diff prove that
  plan authoring changed only the new plan file.
- Two independent AI reviews own source fidelity, U/E ownership, plan completeness,
  and execution readiness by reading the full sources and repository context.
- A real future non-AI consumer may justify its own narrow interface validation;
  agent-to-agent Markdown does not.

## Current proof

- Forge loader validation: PASS.
- No runtime validator command or manifest reference remains under `wayne-plan/`.
- Validator-specific calibration scripts are removed. The remaining checker emits
  bounded observations and always requires independent AI review for a verdict.
- Cross-agent behavioral rerun: pending harness migration; no superiority claim is
  made from static evidence alone.
