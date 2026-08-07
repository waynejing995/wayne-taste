# Proposal — align wayne-skill-forge to the two-directional oracle rule

Status: **proposal only, nothing applied.** Awaiting review.

## The problem: two SSoTs, two philosophies for one concept

Two skills both teach "how to write a checker," and after the mid-state edits they
now disagree:

- **`wayne-skill-optimize`** (already edited, two-directional): the defect is
  *substitution*, not tooling. Deterministic code owns structural facts; contextual
  AI owns meaning; a check with both parts gets **both** oracles — "do not force one
  tool to cover the whole check, and do not drop a cheap deterministic check because
  the row also carries meaning." Pair, don't pick a side.

- **`wayne-skill-forge`** (mid-state, still one-directional): "regex/keyword ...
  must **never** serve as a semantic oracle" and "must be **replaced by**
  independent AI source-fidelity review."

Forge *creates* checkers; optimize *revises* them. Same author, same task, opposite
guidance. This violates the CLAUDE.md SSoT rule directly: same concept, different
semantics in two places → drift. A new checker forged today can read forge's
wording as "if there's any meaning, drop the regex and go pure-AI" — which is the
one-size-fits-all failure optimize just abandoned, and the disease behind the 98
confirmed defects (they will regenerate).

## Why the forge wording matters more, not less

Forge is upstream. optimize only fixes checkers that already exist; forge decides
what gets born. If forge stays one-directional, the fix at optimize is downstream
cleanup of a defect the generator keeps minting. Aligning forge is the root-cause
fix; aligning optimize alone is symptom control.

## Three forge locations to change

All three currently carry the one-directional "never regex for meaning / replace
with AI" framing. Proposed replacement = optimize's two-directional wording,
verbatim in spirit.

### 1. `wayne-skill-forge/SKILL.md` — D. Draft, split-ownership paragraph

Current (mid-state):

> Then split semantic from deterministic ownership. Contextual AI review owns
> intent, classification, completeness, equivalence, and causality. Scripts own
> only low-freedom grammar, hashes, literal existence, exact snapshots, IDs,
> closure, mutations, and observed event order. Headings, keywords, ID prefixes,
> substrings, regex, and similarity may locate text but **must never serve as a
> semantic oracle**.

Proposed:

> Then match each check's oracle to what it verifies, and let the two types
> coexist. Contextual AI review owns meaning: intent, classification, completeness,
> equivalence, and causality. Scripts own low-freedom facts: grammar, hashes,
> literal existence, exact snapshots, IDs, closure, mutations, and observed event
> order. A check with both a structural and a semantic part gets both oracles — do
> not force one tool to cover the whole check, and do not drop a cheap
> deterministic check because the row also carries meaning. The defect is
> substitution, not tooling: a lexical match (heading, keyword, ID prefix,
> substring, regex, similarity) standing in for a semantic judgment, or an AI judge
> re-deriving a fact a hash would settle exactly. Lexical signals may locate text
> and settle structural facts; when a deterministic check can only approximate
> meaning, pair it with a contextual oracle rather than deleting either.

### 2. `wayne-skill-forge/SKILL.md` — Red lines

Current (mid-state):

> - Do not encode contextual understanding in lexical rules. A regex/keyword
>   checker that claims semantic presence, absence, equivalence, classification,
>   causality, or completeness is an evaluator defect and **must be replaced by
>   independent AI source-fidelity review**.

Proposed:

> - Do not make a lexical rule (regex, keyword, heading, substring, similarity)
>   stand in for a semantic judgment, and do not spend an AI judge on a fact a hash
>   or schema settles exactly. Wrong-tool substitution in either direction is an
>   evaluator defect; keep the deterministic check for the structural part and pair
>   a contextual oracle for the meaning when the check needs both.

### 3. `wayne-skill-forge/references/eval.md` — §2 proof-owner bullet (line ~91)

Current:

> - Never use headings, ID prefixes, keywords, substring scans, regex, or string
>   similarity as a semantic oracle. Include a paraphrase/heading variation that
>   keeps meaning and a same-shaped weakening that changes meaning; a lexical
>   checker that separates them is an evaluator defect.

Proposed:

> - Match each check's oracle to what it verifies; the two types coexist.
>   Deterministic code settles structural facts, contextual AI settles meaning, and
>   a check with both parts uses both. The defect is substitution in either
>   direction: a lexical rule (heading, ID prefix, keyword, substring, regex,
>   similarity) standing in for a semantic judgment, or an AI judge re-deriving a
>   fact a hash settles exactly. Calibrate every semantic check with a
>   paraphrase/heading variation that keeps meaning (must pass) and a same-shaped
>   weakening that changes meaning (must fail); a deterministic checker that
>   separates them is being used as a semantic oracle it cannot be — pair a
>   contextual oracle for the meaning and keep the deterministic check for the
>   structural part.

## What this proposal deliberately does NOT touch

- The 98 checker code defects — those are downstream of the prompt; fix the prompt
  first so regeneration stops, then clean the code.
- The three "do not gut" checks — legit machine-layer invariants; unaffected.
- Any file. This is a written proposal per the stop-hands instruction.

## Open question for review

Was the one-directional forge wording deliberate (strict at *creation*, flexible at
*revision*), or an un-updated mid-state? If deliberate, this proposal is void and
the SSoT split should instead be documented as intentional. If mid-state, apply the
three edits above.
