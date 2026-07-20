# Failure evidence: cross-stage contract migration drift

Observed while a real `wayne-plan` run consumed Mind Explode artifacts.

## Exact failures

- Mind Explode decision rows were bare `1..34`; Plan required `D<number>` and the
  agent tried to renumber the upstream decision log.
- Review outcomes used legacy `R01..R07`; Plan's whole-file requirement scan treated
  them as product requirements and demanded implementation-unit ownership.
- A `produce-file` mismatch was repaired by widening `RunState.bootstrap_done` to
  `RunState` and stripping `StateManager` from `write_context`, changing semantics
  merely to satisfy string equality.
- E Status existed in both the source matrix and a plan snapshot while Verify could
  choose either, leaving no single state owner.

## Causal classification

The root cause is contract migration drift, not strict validation itself: a new
Plan-local grammar was introduced without migrating producers, consumers, legacy
inputs, templates, and cross-stage harnesses. Lexical validators amplified the
drift and remained gameable because they did not preserve semantic ownership.

## Required later harness

Freeze one Mind Explode → Test Design → Plan → Work → Verify fixture and assert:

1. canonical `D/R/S/I/U/E/F/N` namespaces come only from the shared contract;
2. legacy numeric decisions map to `D<number>` without changing source bytes;
3. review `R01/R1` outside `## Requirements` never becomes a requirement;
4. plan `active` becomes `approved` only after both reviews;
5. Work changes only plan-owned U Status and Verify changes only authoritative
   `docs/test-matrix/` E Status;
6. checkpoint carries the exact matrix path; no stage guesses or renumbers it;
7. a surface-equality repair that widens or strips an owner fails even if the local
   validator would otherwise pass.
8. a converged small direct request enters Plan without Mind Explode; Plan may nest
   Test Design for the owned matrix, then resumes without auto-advancing any stage.

This evidence is frozen for the later pipeline-contract harness; it does not justify
weakening any current single-skill oracle.
