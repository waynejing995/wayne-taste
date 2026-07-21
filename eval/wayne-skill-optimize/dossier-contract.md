# Intent dossier contract

The optimizer writes these exact files under `eval/<target>/` before candidate
generation:

- `intent-ledger.json`
- `failure-trace.json`
- `oracle-manifest.json`

Generated checkers, fixtures, and cases may use additional direct paths below the
dossier. The deterministic harness validates shape and evidence integrity only.
It never infers intent from prose.

## Intent ledger

```json
{
  "version": 1,
  "target": "<skill name>",
  "control_commit": "<current 40-hex HEAD before any optimization edit>",
  "sources": [
    {"id": "<unique ID>", "path": "<repo-relative path>", "revision": "WORKTREE", "sha256": "<64-hex>"}
  ],
  "behaviors": [
    {
      "id": "I1",
      "classification": "intended",
      "source_refs": [
        {"source_id": "<source ID>", "exact": "<non-empty exact excerpt>"}
      ],
      "owner": "<non-empty owner>",
      "oracle_ids": ["O1"],
      "status": "FROZEN"
    }
  ],
  "milestones": [
    {
      "id": "M1",
      "precondition": "<non-empty>",
      "setter": "<non-empty>",
      "allowed_next": "<non-empty>",
      "forbidden_next": "<non-empty>",
      "mutable_artifact": "<non-empty>"
    }
  ]
}
```

All IDs are unique non-empty strings matching `[A-Z][A-Za-z0-9_-]*`.
Classifications are `intended`, `control-defect`, or `incidental`. `revision` is
`WORKTREE` or an exact 40-hex commit readable with `git show <revision>:<path>`.
Every source is hashed; every exact excerpt must occur in that source. IDs and
references must close. `FROZEN` means the row has a source and executable oracle;
it does not claim semantic completeness. These checks do not prove that all source
behavior was recovered.

## Failure trace

```json
{
  "version": 1,
  "histories": [{"path": "session-history/claude-session.jsonl", "sha256": "<64-hex>"}],
  "pre_state": {"source": "<history path>", "exact": "<exact excerpt>"},
  "user_transition": {"source": "<history path>", "exact": "<exact excerpt>"},
  "first_wrong_mutation": {"source": "<history path>", "exact": "<exact excerpt>"}
}
```

The checker proves hashes and literal occurrence. AI review decides whether the
selected excerpts really are the durable pre-state, transition, and first error.

## Oracle manifest

```json
{
  "version": 1,
  "oracles": [
    {
      "id": "O1",
      "kind": "temporal",
      "behavior_ids": ["I1"],
      "positive": ["uv", "run", "--no-project", "python", "check.py", "valid.json"],
      "mutations": [
        ["uv", "run", "--no-project", "python", "check.py", "wrong-order.json"]
      ]
    }
  ]
}
```

Commands run from the dossier. `positive` must exit zero; every mutation must exit
nonzero. The checker proves execution, not that the oracle captures the right
meaning.

## External independent semantic reviews

After the author exits, fresh Claude and Codex contexts each receive a neutral copy
of the sources and dossier. Each writes one JSON report with exactly:

- `version`, `provider`, `source_sha256`, `ledger_sha256`, and `verdict`;
- `reviewed_source_ids`, `reviewed_behavior_ids`, and `reviewed_oracle_ids`;
- `missing_requirements`, `misclassified_behavior_ids`, and `notes`.

`provider` is exactly `claude` or `codex`; `verdict` is `PASS` or `FAIL`. Reviewed
ID sets must equal the dossier sets. A PASS requires empty missing/misclassified
lists. Both reviewers independently reverse-audit source → ledger → cases and judge
semantic completeness, classification, causal trace selection, milestone meaning,
and whether each oracle proves its claimed behavior. They must not use headings,
IDs, keywords, substring scans, regex, or similarity as a semantic oracle. Any FAIL
or report/hash mismatch leaves intent unverified. The author must not create these
reports itself.
