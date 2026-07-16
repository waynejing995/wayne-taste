# Comparison contract

Comparison is explicit, two-level, and blocked until its semantics are known.

## Intake

| Gate | Resolved when | Stop condition |
|---|---|---|
| image set | every reference maps to exactly one file | missing, extra, or ambiguous reference |
| same target | captures plausibly represent the same screen/scene | different subjects; offer separate VELs |
| scenario | golden-baseline or symmetric is explicit/inferable | neither image may be privileged silently |
| golden integrity | declared copies hash equal | golden disagrees with its own copy |
| tolerance | byte, raw-pixel, perceptual, or explicit no-verdict fixed before metrics | missing form/value or post-hoc choice |

Dimension mismatch for the same target is the result, not a reason to resize. Byte
identity is satisfied only by exact hash equality. Symmetric comparisons use neutral
A/B language; golden comparisons frame additions/removals as current drift.

## Level 1 — pixel and channel

Report dimensions, hash, changed pixels/ratio, max and thresholded L1, bbox and
centroid, color family, connected components, signed bias, methods, and any needed
structural cross-check. Add cross-image channel results, especially
`diff_only_in_channels`. Hash equality can skip later pixel measurements only.

## Level 2 — ledger

Create the VELs first, then report every row even when both sides are empty:

| Facet | Matched | Added | Removed | Changed |
|---|---|---|---|---|
| Regions | | | | |
| Elements | | | | |
| Text | | | | |
| Targetable structures | | | | |
| Groups | | | | |
| Semantic equivalents | | | | |
| Relationships | | | | |
| Quality issues | | | | |
| Channel probe | | | | |
| Hidden-signal probe | | | | |

For every delta, name the ref/region, pixel or channel support, and classification:

| Ledger delta | Pixel/channel support | Class |
|---|---|---|
| what changed | method + location or none | `real-change` / `read-noise` |

Zero pixel/channel support means two reads disagreed; correct it as read-noise rather
than reporting a visual change. Supported content drift is real-change. Pixel noise
without a ledger delta remains pixel truth and must still be reported.

## Conclusion

Reconcile both levels. State the tolerance and producing method when issuing a
verdict. With explicit no-verdict, report only measurement and noise/real-change
classification. Perceptual equality never means byte identity.
