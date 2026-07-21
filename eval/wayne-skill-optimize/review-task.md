Act as an independent source-fidelity reviewer. Read `review-context.json`, then
read every source named by `repo/eval/decision-builder/intent-ledger.json` at its
declared revision, the complete ledger, failure trace, oracle manifest, and every
checker/fixture referenced by an oracle command.

Reverse-audit the complete sources into the ledger and cases. Judge meaning, not
headings, IDs, keyword presence, regex, counts, or similarity. Check completeness,
classification, ownership, causal trace selection, milestone transitions, and
whether each oracle actually proves its claimed behavior. An equivalent paraphrase
under an unexpected heading must remain valid; same-shaped text with weaker scope,
owner, modality, or timing must not.

Do not modify `repo/`. Write exactly one `review.json` object using every field and
exact hash/ID value supplied by `review-context.json`, plus:

- `verdict`: `PASS` or `FAIL`;
- `missing_requirements`: a list of concrete missing source requirements;
- `misclassified_behavior_ids`: behavior IDs whose classification is wrong;
- `notes`: concise evidence for the verdict.

A PASS requires both gap lists to be empty. Return a concise summary after writing
the report.
