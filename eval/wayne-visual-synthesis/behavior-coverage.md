# Original design-intent coverage

Sources:

- initial VEL design: `df0367a` (2026-06-16);
- compare/probe design: `2f3038e` (2026-07-06);
- current control and its direct references;
- approved intent in this harness.

Every row must have an executable behavioral or static oracle before a candidate
can be accepted. `UNVERIFIED` blocks the no-regression claim.

| ID | Original behavior | Owner / oracle | Coverage |
|---|---|---|---|
| V1 | One VEL per image precedes every summary | `describe`, `ocr`, `hidden-channel`, `multi-no-compare` | behavioral |
| V2 | VEL accounts for regions, elements, text, groups, relationships, quality, coverage | `describe`; compare facet checker | behavioral |
| V3 | Carrier semantic equivalents retain all chart/table/flowchart/diagram/document/text/map/equation/dense-UI fields | `describe`, `ocr`; `check_static.py` | behavioral + static |
| V4 | OCR preserves verbatim text and reading order | `ocr` exact-string/order oracle | behavioral |
| V5 | Addressable objects retain identity, geometry, layer/source/mask semantics | `describe`; `check_static.py` | behavioral + static |
| V6 | Missing image/backend fails loud without fabricated evidence | `missing-image` | behavioral |
| V7 | Multiple images are not compared unless comparison is explicitly requested | `multi-no-compare` | behavioral |
| V8 | Both channel and hidden-signal probes run; flagged payloads become VEL entries; uncovered watermark classes are named | `hidden-channel`; bundled-script execution | behavioral + script |
| V9 | Compare resolves set, same target, golden/symmetric semantics, and tolerance before metrics | `compare`, `pixel-noise`, `semantic-change` | behavioral |
| V10 | Compare Level 1 is tool-measured and includes hash/L1/region/structure plus cross-image channels | `compare`, `pixel-noise`, `semantic-change`; `compare_render.py` | behavioral + script |
| V11 | Compare Level 2 runs even for byte-identical images and reports all VEL/probe facets | compare facet oracle in all three compare cases | behavioral |
| V12 | Pixel and ledger evidence reconcile read-noise vs real-change | `pixel-noise`, `semantic-change` | behavioral |
| V13 | Verdict exists only for a pre-approved tolerance; byte identity only from exact hash | `compare`, no-verdict oracles in both delta cases | behavioral |
| V14 | Bundled scripts execute on the supported runtime | direct positive executions; NumPy 2.x dump regression | script |

Current status before candidate generation: every row has an oracle. Trial results
may be PASS or FAIL; coverage means the behavior is observable, not that control is
correct.
