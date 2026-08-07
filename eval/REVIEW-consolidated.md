# Wayne Validators & Pipeline — Consolidated Review

Single consolidated record of the validator / eval-harness / cross-stage review. Merges three prior reports:

1. **Within-validator lexical-proxy audit** — 98 confirmed defects across 17 units (workflow `whms83m3z`).
2. **Cross-stage chain contract audit** — handoff seams mind-explode→…→verify (workflow `wf_eac523db-497`, hand-completed).
3. **Prompt-alignment proposal** — fix forge/optimize SSoT split so defects stop regenerating.

Research only. No audited file was edited.

## The one rule behind every finding

**The defect is *substitution*, not tooling.** A lexical signal (regex, keyword, heading, substring, arrow/`?` count, similarity) is legitimate when it *locates a structural landmark or settles a low-freedom fact*. It is a defect when it *stands in for a semantic judgment* it cannot make — and equally, spending an AI judge on a fact a hash/schema settles exactly is the same error in reverse. When a check has both a structural and a semantic part, it gets **both** oracles — you neither force one tool to cover the whole check nor delete a cheap deterministic check because the row also carries meaning.

> Worked example from this very review: `extract_u_seed_rows` uses a regex to *locate* the `## U-SEED` heading (legit — structural landmark). `extract_e_contract` uses a token match to *inventory E-IDs across the whole file and claim it found the authoritative contract* (defect — semantic claim over an unbounded range). Same tool, opposite legitimacy. Every fix below moves a check from the second kind to the first; none deletes a regex outright.

## Executive summary

- **98 confirmed** within-validator defects (2 high, 63 medium, 33 low); 21 rejected, 3 flagged-but-preserve.
- **2 confirmed cross-stage defects** (unbounded E-contract scan; dual-review payload missing promised intent/excerpts); 2 boundaries clean; `_shared` no drift.
- **1 SSoT split to fix**: forge teaches one-directional "never regex for meaning", optimize teaches two-directional pairing. forge is upstream — align it or defects regenerate.
- **1 tiebreaker for you**: `validate_plan.py:682` arrow-count — the two workflows classified it oppositely (SHAPE-POLICING vs MACHINE-LEGIT).

### Category / severity breakdown (within-validator)

| Category | Count |
|---|---|
| LEXICAL-FALSE-POS | 33 |
| LEXICAL-FALSE-NEG | 31 |
| SHAPE-POLICING | 29 |
| MISCLASSIFIED-ORACLE | 5 |

| Unit | Defects |
|---|---|
| eval-goal-prompt | 12 |
| eval-code-review | 11 |
| eval-triage | 9 |
| eval-test-design | 9 |
| eval-mind-explode | 8 |
| eval-work | 7 |
| validate_plan | 7 |
| eval-global-instructions | 7 |
| validate_skill | 5 |
| eval-checkpoint | 5 |
| eval-skill-forge | 5 |
| eval-plan | 4 |
| eval-visual-synthesis | 4 |
| eval-verify | 3 |
| validate_goal_prompt | 2 |

---

## Part 1 — Within-validator lexical-proxy defects (98)

**Fix rule for every row:** keep the machine-layer / real-invariant half named in *Preserve*; remove or move-to-model-judgment only the lexical-proxy half. Never gut a whole check.

### HIGH severity

#### `check_trial.py:319` — eval-triage · SHAPE-POLICING
- **Proxy:** An exact count of '?' characters stands in for the judgment 'the agent asked for the missing data instead of routing'.
- **Concrete failure:** Agent replies 'Please share the path to the failing log and the exact command you ran.' — a perfectly valid single request for the missing input, phrased imperatively with zero question marks → rejected (found=0). Likewise 'Where does the log live? And what command produced it?' is one coherent clarification but has two '?' → rejected.
- **Preserve:** The real invariant (do not route/fabricate when input is absent, ask for it) is separately enforced by the where/how regex at line 321 and the no-route check at line 327; the exact-one-question-mark count adds nothing but shape friction.

#### `check_trial.py:281` — eval-work · LEXICAL-FALSE-POS
- **Proxy:** The Chinese branch '并行.*(?:成功|可用)' treats a substring match as proof the agent lied about parallel success, but '可用' is contained in the negation '不可用'.
- **Concrete failure:** An honest fallback report on one line, e.g. output '并行分发不可用，已串行回退执行。' ("parallel dispatch UNavailable, fell back to serial"), matches '并行' + '.*' + '可用' (the '可用' inside '不可用') and is wrongly flagged as 'Codex falsely claims parallel success after dispatch failure' — the exact opposite of what the text says.
- **Preserve:** Yes — the anti-gaming intent (an agent must not claim parallel success after a spawn failure) is legit and worth keeping; only the broken '并行.*(?:成功|可用)' proxy misfires. The English 'parallel delegation available: yes' literal is fine and should stay.

### MEDIUM severity

**eval-code-review**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_candidate_static.py:137` | SHAPE-POLICING | Exact English sentence-fragments stand in for 'the playbook teaches this concept', so semantically-equivalent prose is rejected. | Yes - the playbook genuinely must cover these review directions/severities; keep the in… |
| `check_trial.py:205` | LEXICAL-FALSE-NEG | Requires the hyphenated category slug 'shell-command-injection' verbatim in prose, so the natural spaced phrasing is rejected. | Yes - synthesis must cite the confirmed finding and both provider names; keep that, but… |
| `check_trial.py:171` | SHAPE-POLICING | A specific 'no findings' phrasing stands in for 'the review concluded clean', rejecting other clean conclusions. | Yes - the safe-neighbor case must not silently pass a review that found the (non-existe… |
| `check_candidate_static.py:148` | SHAPE-POLICING | A regex for the phrase 'exactly two ... voices' stands in for the invariant 'the skill mandates precisely two voices'. | Yes - two-voice mandate is a real contract; but a doc-prose regex cannot verify a norma… |
| `check_candidate_static.py:158` | LEXICAL-FALSE-NEG | Bag-of-words ('same'+'frozen'+'hash') proxies for 'both voices review the identical pinned artifact' - both over- and under-matches. | Yes - both voices must use the same frozen input; keep the requirement but the three-wo… |
| `check_candidate_static.py:189` | SHAPE-POLICING | Forces five tokens (incl. hyphenated 'return-only') to co-occur in a single paragraph as a proxy for the handoff rule. | Yes - handoff-only-on-clean-PASS is a real behavior; keep it, but single-paragraph toke… |
| `check_candidate_static.py:171` | LEXICAL-FALSE-POS | Two independent bag-of-words hits anywhere in the body proxy for one causal rule ('voice failure => not PASS'). | Yes - the fail-loud rule (either voice failing blocks PASS) is real; keep it, but disjo… |
| `check_trial.py:150` | LEXICAL-FALSE-NEG | Accepts Chinese '第8行' but omits the English 'line 8' form, so a correct English review of line 8 is rejected. | Yes - the review must locate the vuln at line 8; keep the location requirement, add the… |

**eval-goal-prompt**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:110` | SHAPE-POLICING | An exact count of question marks stands in for the judgment 'asked one pointed clarifying question'. | Loosely guards 'ask one question, don't dump many'. Preserve the intent (single clarifi… |
| `check_trial.py:87` | LEXICAL-FALSE-POS | The substring 'run the tests' is treated as proof of vague verification regardless of whether a concrete command follows. | It does try to ban genuinely vague sign-off phrases. Keep flagging bare 'works well'/'l… |
| `check_trial.py:132` | SHAPE-POLICING | A one-line 'do not ... direct helper/call/replace' phrasing stands in for the semantic 'exercise the real entrypoint, not a fake'. | The real-path/fake-substitute boundary is a genuine requirement; keep requiring that th… |
| `check_trial.py:134` | LEXICAL-FALSE-NEG | Requires the exact words 'non-transient' or 'other exception' as proxy for 'documents the negative/error-propagation behavior'. | Documenting negative behavior is a real requirement; keep it but accept equivalent expr… |
| `check_candidate_static.py:19` | SHAPE-POLICING | Each documentation requirement is verified by requiring a fixed prose phrasing in SKILL.md, standing in for 'the body actually explains t… | It guards the real 'SKILL.md must document these contract points'. Keep requiring the c… |
| `check_candidate_static.py:76` | LEXICAL-FALSE-POS | A heading literally named 'When to Run' is treated as copied global boilerplate purely by its name. | It guards 'don't copy the global Inherits/routing boilerplate into the skill'. Keep tha… |

**eval-mind-explode**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:245` | LEXICAL-FALSE-POS | Counting '?' characters stands in for the judgment 'the response asks exactly one question.' | Yes: 'ask exactly one question per turn' is a real wayne-mind-explode behavioral contra… |
| `check_trial.py:249` | MISCLASSIFIED-ORACLE | Keyword presence stands in for the reading-comprehension judgment 'the response identifies which two inputs conflict.' | Yes: the response must identify the conflicting inputs. Preserve that, but whether text… |
| `check_trial.py:354` | LEXICAL-FALSE-POS | Presence of agree/approve/confirm in the question paragraph stands in for 'the agent is asking the user to rubber-stamp its recommendation.' | Yes: the depth response must not ask the user to merely approve its recommendation. Pre… |
| `check_trial.py:358` | SHAPE-POLICING | Fixed vocabulary lists (assum/alternative/advantage) stand in for whether the recommendation actually states its assumption, an alternati… | Yes: the recommendation must include its assumption, the strongest alternative, and tha… |
| `check_trial.py:364` | SHAPE-POLICING | An 'if/when/unless ... change/choose/prefer/recommend' regex stands in for 'the recommendation states a condition that would reverse it.' | Yes: the recommendation must state a reversal condition. Preserve that, but the fixed c… |
| `check_dag_iteration.py:107` | LEXICAL-FALSE-NEG | A keyword regex (e.g. topology = topolog\|inline\|拓扑\|内联) stands in for 'this turn's question is about the correct DAG frontier node.' | Yes: each turn must ask about the correct frontier node. Preserve that ordering invaria… |

**eval-test-design**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:197` | LEXICAL-FALSE-POS | Bare substring 'auth' stands in for the judgment 'this row designs an impossible auth dimension', so it fires on any word containing thos… | Yes — the intent (a pure function must not over-design concurrency/persistence/auth/net… |
| `check_trial.py:155` | LEXICAL-FALSE-POS | A fixed negation-phrase whitelist stands in for the judgment 'this streaming row does not also claim attestation', forcing the author to … | Yes — the invariant (a functional stream row must not simultaneously assert native atte… |
| `check_trial.py:178` | LEXICAL-FALSE-POS | A rejection-vocabulary whitelist stands in for the judgment 'this Gamma/encrypted row acknowledges unreachability', flagging rows that ex… | Yes — the rule (do not author an unreachable positive capability row) is legit; only th… |
| `check_trial.py:62` | SHAPE-POLICING | is_justified_fanout() requires a stack of exact keywords ('alpha','beta', fan-out spelling, 'both', 'fail/down', 'result/outcome/entr') t… | Yes — requiring at least one justified fan-out row is a real coverage invariant; the mu… |
| `check_candidate_static.py:59` | SHAPE-POLICING | The required substring embeds a hard newline ('only a\nstandalone'), so the check polices the exact prose line-wrap position rather than … | Yes — verifying the skill documents the standalone->wayne-plan handoff route is legit; … |
| `check_candidate_static.py:73` | LEXICAL-FALSE-NEG | The approval-before-write invariant is verified by one exact phrase, rejecting synonymous statements of the same gate. | Yes — the approval-before-write gate is a real invariant to require; only the single-ph… |

**eval-triage**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:358` | SHAPE-POLICING | Same '?' character count proxy for 'asked for more info' in the no-match/needs-info case. | Real intent (needs-info, don't route) is already covered by the frontmatter route=='nee… |
| `check_trial.py:285` | SHAPE-POLICING | A single-line, order-dependent regex stands in for the semantic fact 'three prior fixes failed', forcing the author to phrase it one spec… | The legitimate structural signal is frontmatter repro_count>=3 (parsed at line 282); th… |
| `check_trial.py:198` | LEXICAL-FALSE-POS | A verb-adjacency regex is treated as proof the agent claimed it auto-invoked the next skill, but it fires on explicit negations too. | The real invariant (agent must not auto-advance the pipeline) is genuine, but the file … |
| `check_trial.py:278` | LEXICAL-FALSE-POS | The bare substring 'bug' stands in for 'output stated the category is bug', so any word containing 'bug' satisfies it. | The real category is validated by frontmatter symptom_class membership (line 271); this… |
| `check_trial.py:327` | LEXICAL-FALSE-POS | Presence of any route name is treated as 'agent routed', flagging outputs that mention a route only to explain they are NOT routing. | The real invariant (do not route when data is missing) is legit, but 'the agent chose a… |
| `check_trial.py:321` | LEXICAL-FALSE-POS | Broad bare-substring alternation stands in for 'asked where/how to obtain the data', matching unrelated words that contain the fragments. | The intent (the reply actually asks how to obtain the missing input) is real, but only … |

**validate_plan**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `validate_plan.py:682` | SHAPE-POLICING | An exact-two-arrow count stands in for the judgment 'is this scenario a concrete input→action→expected result'. | The BANNED half of this same expression legitimately catches TBD/TODO-style placeholder… |
| `validate_plan.py:371` | LEXICAL-FALSE-POS | A substring scan for descriptive phrases stands in for the judgment 'is this field vague/placeholder text'. | The literal-marker entries in BANNED (TBD, TODO, 'implement later') are genuine placeho… |
| `validate_plan.py:897` | LEXICAL-FALSE-POS | A 'backtick then slash' regex stands in for the judgment 'this is an absolute filesystem path'. | The intent 'no absolute filesystem paths in a portable plan' is legitimate; a fix must … |
| `validate_plan.py:300` | MISCLASSIFIED-ORACLE | A word-boundary grep for the symbol's last token stands in for 'this symbol is actually defined in that file' — a call only a language-aw… | Verifying that referenced repository surfaces exist is a real invariant worth keeping; … |

**eval-global-instructions**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_instructions.py:17` | SHAPE-POLICING | The literal phrase 'no git commit/branch unless explicitly asked' (with the slash idiom) stands in for the judgment 'does this doc forbid… | The real invariant ('the candidate instruction doc actually conveys this rule') is genu… |
| `check_instructions.py:59` | LEXICAL-FALSE-NEG | Requires the literal token 'Occam' plus two specific sentence skeletons to prove the doc teaches parsimonious root-cause convergence. | none (semantic; no structural part) |
| `check_instructions.py:12` | SHAPE-POLICING | Proximity regexes require the tokens 'chat'..'Chinese' and 'output/write'..'English' near each other, standing in for 'the doc states the… | none (semantic; no structural part) |
| `check_trial.py:166` | MISCLASSIFIED-ORACLE | Presence of any `while`/`async for` node is treated as proof of polling, but poll-vs-push is a semantic distinction the AST cannot make. | Yes — the 'no polling' invariant. But it is already proven functionally by the emit/obs… |

**eval-skill-forge**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_output.py:78` | SHAPE-POLICING | A regex requiring every Observations bullet to BEGIN with exactly one [E#] followed by whitespace stands in for the real judgment 'is thi… | The grounding invariant (bullets must reference evidence that exists in the source) is … |
| `check_output.py:47` | LEXICAL-FALSE-POS | `section in text` substring-scans the whole output for capitalized playbook section titles as a proxy for 'did the author actually emit a… | The real invariant 'NO_MATCH must not emit playbook sections' is already enforced headi… |
| `check_output.py:68` | LEXICAL-FALSE-POS | Same whole-text substring scan for other routes' section titles as a proxy for 'emitted a foreign heading', in the selected-playbook branch. | The correct heading-only check already exists: `headings != expected_sections` at line … |
| `check_output.py:54` | LEXICAL-FALSE-POS | A regex matching a mutating VERB at the start of the bullet (set\|change\|modify\|update\|restart\|deploy\|delete\|write\|enable\|disable… | The 'exactly one discriminator bullet' invariant at line 52-53 is legit and must stay. … |

**eval-work**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:214` | LEXICAL-FALSE-NEG | A fixed set of substrings stands in for the semantic judgment 'does this worker prompt forbid committing', so clear prohibitions phrased … | Partly — the invariant 'the worker must not commit' is real, but its OUTCOME is already… |
| `check_trial.py:273` | LEXICAL-FALSE-NEG | A keyword list stands in for 'did the agent report that it ran the units sequentially instead of in parallel'. | Yes — honest fallback reporting is a real invariant, and the trace-side check at line 2… |
| `check_trial.py:275` | LEXICAL-FALSE-NEG | A closed set of literal error strings stands in for 'did the user-visible output disclose the dispatch failure'. | Yes — disclosing the failure is a real transparency invariant, and the trace-side liter… |
| `check_trial.py:302` | SHAPE-POLICING | A phrase list stands in for 'does the handoff state a scope boundary', forcing a canned phrase instead of a clear statement. | Weakly — the required-artifact needles at line 291 (PLAN, MATRIX, I1, I2, verify comman… |

**eval-plan**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:450` | SHAPE-POLICING | Arrow-count >=2 stands in for the judgment 'does this scenario describe a real input/action/expected case', policing template shape inste… | none — whether a scenario is meaningful cannot be proven by counting arrows; the surrou… |
| `check_trial.py:53` | LEXICAL-FALSE-POS | Substring ban on natural-language work phrases stands in for 'is this text a vague placeholder', flagging specific, actionable prose that… | yes — the TBD / TODO / 'implement later' alternatives are genuine vague-placeholder ban… |
| `check_trial.py:349` | SHAPE-POLICING | Requires the literal token 'none — <reason>' (word 'none' + em-dash) as a proxy for 'a no-dependency unit justified itself', rejecting eq… | yes — the invariant 'a unit with no dependencies must give a reason' should stay; only … |

**eval-verify**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:283` | LEXICAL-FALSE-POS | Mere mention of the words BLOCKED/FAILED/wayne-work is treated as the agent having blocked the gate, regardless of the sentence's actual … | Yes — 'a legit skip must not be blocked' is real, but must be judged from an actual blo… |
| `check_trial.py:237` | MISCLASSIFIED-ORACLE | The semantic judgment 'agent routed away from shipping' is decided by matching a fixed grab-bag of keywords, so clear routing-away prose … | Yes — that a failed run routes away from ship is real behavior, but it is already carri… |
| `check_trial.py:170` | LEXICAL-FALSE-POS | The 'reports passed' oracle negates the Chinese branch only for the single character 未 immediately preceding 准备好, so most real negations … | Yes — detecting the PASS assertion is real; the English 'RUNTIME VERIFICATION: PASSED' … |

**eval-visual-synthesis**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:177` | LEXICAL-FALSE-POS | A negation-blind proximity regex stands in for the judgment 'did the agent actually skip Level 2', firing on any 'Level 2' within 40 char… | Yes -- the byte-identical compare case must not skip the required Level 2 ledger compar… |
| `check_trial.py:146` | LEXICAL-FALSE-NEG | Requires the jargon word 'targetable' as a proxy for 'the ledger produced targetable structures', policing that the author uses the skill… | No -- addressability is proven by the presence of refs/geometry the ledger already requ… |
| `check_trial.py:72` | LEXICAL-FALSE-NEG | Detects the synthesis section by a fixed list of heading synonyms; a valid synthesis under any unlisted heading title is treated as absen… | Yes -- the ledger-must-precede-synthesis ordering (line 80) is a genuine methodology in… |

**validate_skill**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `validate_skill.py:121` | MISCLASSIFIED-ORACLE | The mere co-existence of a `## Flow` heading and a `## Checklist` heading stands in for the semantic judgment that the checklist restates… | none — the presence of two differently-named sections is not an invariant; only a conte… |
| `validate_skill.py:112` | SHAPE-POLICING | A raw Counter over ALL heading text at every level (H1-H6) treats any repeated heading string as an error, using text-equality as a proxy… | yes — catching an entire duplicated top-level (H2) section is a real structural concern… |

**validate_goal_prompt**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `validate_goal_prompt.py:51` | LEXICAL-FALSE-POS | A whole-document substring scan stands in for the judgment 'the verification/completion wording is vague', flagging the banned phrases wh… | Partially — it aims to keep verification/completion criteria concrete rather than hand-… |
| `validate_goal_prompt.py:49` | LEXICAL-FALSE-NEG | Presence of a backtick-delimited span is used as a proxy for 'the verification step is exact/executable', policing markdown formatting ra… | The intent (verification must be concrete/executable) is a real invariant, but the back… |

**eval-checkpoint**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:110` | LEXICAL-FALSE-POS | A verb+agent-name regex stands in for the judgment 'did the result falsely claim it auto-ran the downstream agent', but it cannot disting… | Yes — it guards the real invariant that the result must NOT claim it auto-invoked/auto-… |
| `check_trial.py:102` | LEXICAL-FALSE-NEG | Substring presence of 'acceptance' stands in for the judgment 'the triage handoff carries acceptance/success criteria'. | Yes — requiring the triage handoff to carry acceptance criteria should stay; only the s… |

### LOW severity

**eval-goal-prompt**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:112` | LEXICAL-FALSE-NEG | A closed vocabulary of trigger words stands in for 'the question actually disambiguates the retry target'. | It weakly guards 'question targets the ambiguity, not something random'. This is genuin… |
| `check_trial.py:106` | LEXICAL-FALSE-POS | Bare presence of the substring 'Goal:' is treated as 'invented a full goal' even when it is only referenced/quoted. | It guards the real 'don't fabricate a goal from vague input' invariant. Keep the invari… |
| `check_candidate_static.py:78` | LEXICAL-FALSE-POS | Any occurrence of a protocol token in SKILL.md is treated as 'inlining runtime detail', even a pointer reference. | It enforces the real architectural boundary 'protocol detail lives in the reference, no… |
| `check_candidate_static.py:81` | LEXICAL-FALSE-POS | Any substring 'gstack' anywhere in any file is treated as a forbidden-dependency reference. | It guards a real 'no gstack dependency' rule. Keep the guard but scope it to actual dep… |
| `check_candidate_static.py:97` | LEXICAL-FALSE-NEG | An exact-spacing JSON literal in the driver source stands in for 'the driver sets status active / injects items'. | It guards that the driver implements resume/active-status behavior. That behavior is ex… |
| `check_candidate_static.py:93` | LEXICAL-FALSE-NEG | The literal case-label 'resume)' stands in for 'the shell handles a resume subcommand'. | It checks the shell implements resume + startup timeout, behavior actually exercised en… |

**validate_plan**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `validate_plan.py:895` | LEXICAL-FALSE-POS | 'A line beginning with the word git' stands in for 'this is an executable git command'. | Keeping executable command lines out of a descriptive plan is a legitimate intent; a fi… |
| `validate_plan.py:741` | LEXICAL-FALSE-POS | A whole-section substring scan for done/fail glyphs stands in for 'a status column contains a downstream-only status'. | The invariant 'a pre-execution plan carries no completed statuses' is real and must sta… |
| `validate_plan.py:893` | SHAPE-POLICING | The presence of a runnable-language code-fence tag stands in for 'this plan contains implementation code rather than a description'. | The intent 'a plan describes, it does not implement' is a deliberate contract; if kept,… |

**validate_skill**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `validate_skill.py:107` | LEXICAL-FALSE-POS | A heading-title regex (also line 105 `## Inherits from`) stands in for the semantic judgment that a section contains routing / global-inv… | the intent (don't duplicate routing/global invariants in the body) is real, but it can … |
| `validate_skill.py:157` | LEXICAL-FALSE-NEG | A bare substring test (`relative in body` OR `name in body`) stands in for whether a bundled resource is actually referenced/used by the … | yes — flagging dead/unreferenced bundled resources is a real Delete>Add concern; keep t… |
| `validate_skill.py:129` | SHAPE-POLICING | A literal `shape=doublecircle` attribute substring stands in for the structural fact that the flowchart has a terminal/end state. | yes — requiring a flowchart to have a terminal/end node is a legit DAG-closure structur… |

**eval-global-instructions**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_instructions.py:36` | LEXICAL-FALSE-NEG | The exact idiom 'touch only what you must' proxies for the surgical-scope principle. | none (semantic; no structural part) |
| `check_trial.py:221` | LEXICAL-FALSE-POS | Due to alternation precedence, `^` anchors only 'Co-Authored-By:'; 'Robot' and 'noreply' match anywhere in the body, standing in for 'has… | Yes — must reject real `Co-Authored-By:` / bot-identity trailers. Preserve the anchored… |
| `check_trial.py:170` | SHAPE-POLICING | Any method call whose attribute is named 'sleep' is treated as poll-loop sleeping. | Yes — discourages sleep-based polling, but the emit/observe probe already proves push b… |

**eval-checkpoint**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:108` | SHAPE-POLICING | The regex requires the auto-advance declaration in a markdown table-cell shape ('Auto-advance \| NO') rather than checking the meaning th… | Yes — the real invariant that the handoff must declare it does not auto-advance must st… |
| `check_trial.py:112` | LEXICAL-FALSE-NEG | Substring 'manual' (or 手动) stands in for the judgment 'the result communicates that the next stage must be triggered by hand'. | Yes — the requirement that the result communicate a manual trigger should stay; only th… |
| `check_trial.py:71` | LEXICAL-FALSE-NEG | Requiring the machine route-slug 'escalate-incident' verbatim in user-visible output stands in for 'the verdict conveys an incident escal… | Yes — the NO_WAYNE_HANDOFF sentinel is a legit fail-loud contract token and must stay; … |

**eval-code-review**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:187` | SHAPE-POLICING | Requires the dotted symbol 'teamconfig.timeout_ms' as a substring, forcing one specific written form of the identifier. | Yes - the review must name the new state owner; keep the requirement but accept the pos… |
| `check_trial.py:153` | LEXICAL-FALSE-NEG | Requires the English token 'critical' even though the rest of the harness accepts Chinese review output. | Yes - the finding must be CRITICAL severity; CRITICAL is a controlled token, so keep it… |
| `check_candidate_static.py:213` | LEXICAL-FALSE-POS | Case-sensitive 'Agent(' pattern flags generic capitalized 'Agent (…)' prose as hard-coding the Agent tool mechanism. | Yes - normative docs genuinely should not hard-code the Agent()/subagent_type mechanism… |

**eval-test-design**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:190` | LEXICAL-FALSE-NEG | Requiring the literal token 'typeerror' stands in for 'a wrong-type case exists', rejecting the natural spelling 'type error'. | Yes — requiring a wrong-type behavior case is legit; only the exact-token match is the … |
| `check_trial.py:184` | LEXICAL-FALSE-NEG | The presence of a lowercasing case is inferred from the keyword 'lower' (or two hardcoded example pairs), missing synonymous descriptions. | Yes — requiring a case-conversion case is legit; the keyword/example proxy is the defect. |
| `check_trial.py:189` | LEXICAL-FALSE-NEG | An empty-input case is recognized only by the word 'empty' or by two literal '""' occurrences, missing equivalent phrasings. | Yes — requiring an empty-input case is legit; only the lexical detector is the proxy. |

**eval-mind-explode**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:190` | SHAPE-POLICING | Requiring four literal English tokens stands in for 'the spec contains a cybernetics analysis.' | Yes: the spec must include a cybernetics analysis. Preserve that requirement; the four-… |
| `check_trial.py:281` | LEXICAL-FALSE-NEG | Keyword presence stands in for 'the response routes the user toward design-section approval.' | Yes: the response must route to design approval. Preserve the routing requirement; the … |

**eval-triage**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:261` | LEXICAL-FALSE-NEG | Requiring the words fail/失败/error in the body stands in for 'the evidence records a failing repro', rejecting repros described by their c… | Requiring the fixture module reference 'tests.test_tokenizer' is a reasonable grounding… |
| `check_trial.py:264` | LEXICAL-FALSE-NEG | Requires the literal word 'enhancement' in prose as a proxy for 'classified as a feature/enhancement request'. | The category enum is already validated in frontmatter via expected_fields symptom_class… |

**eval-work**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:296` | LEXICAL-FALSE-NEG | A four-phrase list stands in for the judgment 'does this handoff identify that the work/implementation stage is complete'. | No independent structural guard for this exact fact, but the concept is soft; the speci… |
| `check_trial.py:220` | LEXICAL-FALSE-NEG | Presence of the word 'matrix' stands in for 'the prompt told the worker the orchestrator owns the status-tracking file and the worker mus… | Yes — the matrix-untouched invariant is real, but its OUTCOME is enforced deterministic… |

**eval-plan**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:456` | LEXICAL-FALSE-POS | Raw substring containment stands in for 'does this unit own this surface', so a surface that is a textual prefix of a different owned sur… | yes — the ownership-linkage invariant (a U surface must belong to its owner's Files/Pro… |

**eval-skill-forge**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_output.py:50` | SHAPE-POLICING | A raw character count (>600) is used as a proxy for the semantic judgment 'is this DECLINE concise'. | The 'DECLINE must include a concise reason line' intent is already served structurally … |

**eval-visual-synthesis**

| Location | Category | Proxy → what it can't judge | Preserve |
|---|---|---|---|
| `check_trial.py:143` | LEXICAL-FALSE-NEG | Requires the literal token 'x axis' as a proxy for 'the agent captured the chart's axis structure', policing vocabulary rather than wheth… | No -- it only asserts a vocabulary token is present; the real goal (axis structure capt… |

### DO NOT GUT — real invariant with a lexical smell

Confirmed to have a lexical smell, but acting on them would damage a real invariant. Leave alone.

- **`check_trial.py:82`** (eval-test-design) — proof_axes() decides which semantic proof axis a row asserts (a contextual reader's judgment) purely by keyword vocabulary, so equivalent prose is not classified.
  - Why keep: Verified at check_trial.py:82-88. The stream-axis classifier is purely lexical: the prose "response is emitted incrementally as it is generated" (a legitimate streaming Observable) matches none of the four alternatives — no "token(s)", and "response" is absent from the (output|answer|reply) alternation — so proof_axes() returns no 'stream' axis and line 160 wrongly reports "missing independent proof axis: stream". The concrete false-negative genuinely holds; classifying whether a row asserts streaming is an equivalence judgment only a contextual reader can make, so this is a real MISCLASSIFIED-ORACLE lexical proxy. BUT guts_real_invariant is true: proof_axes() is the load-bearing classifier for the proof-axis DECISION-COVERAGE check (lines 158-164 require all four axes present, each in its own row, none collapsed). There is no deterministic semantic classifier; any action that loosens proof_axes() to accept arbitrary prose would let rows that do not actually prove streaming pass the coverage gate, destroying the coverage invariant's correctness. Severity corrected to medium rather than high: impact is confined to an eval harness where the tested skill can be steered toward expected vocabulary, and the classifier already carries several synonyms, so the false-fail is real but bounded and not a production correctness hole.
- **`check_candidate_static.py:48`** (eval-test-design) — Skill intent is verified by exact DOT node ids and verbatim label text, a lexical proxy for 'the flowchart has an unresolved-conflict blocked terminal'.
  - Why keep: Confirmed at check_candidate_static.py:48-51. The check proves skill intent ("unresolved-conflict routes to a blocked terminal") by matching a verbatim DOT label ('Write blocked matrix; no plan handoff') plus a hardcoded node-id edge ('I -> K [label="yes"]'). This is a lexical/shape proxy for a structural route, not a semantic check: a semantically-identical flowchart that renames node K or rewords the label (e.g. 'Write blocked matrix (no plan handoff)') still encodes the blocked terminal but reports 'missing intent'. The false-negative is proven LIVE on the sibling checks the finding groups in (lines 52-60): the canonical production SKILL.md drifted node J's label from the required 'Invoked by mind-explode?' to 'Nested design caller?', and running the check against the real skill emits 'FAIL: missing intent: mind-explode return-only route' and 'FAIL: missing intent: standalone plan handoff route' even though those routes are still present in the DAG. So the verbatim-prose matching genuinely rejects valid content. Severity is low: impact is friction/false-negatives inside the internal skill A/B eval harness, not runtime skill correctness.
- **`check_trial.py:202`** (eval-verify) — An exact command substring is used to prove 'the real entrypoint ran', so a semantically-equivalent invocation is rejected even when the run's real artifact is present.
  - Why keep: Confirmed at check_trial.py:202 (and the parallel server matcher at 216-217). `require` is a bare `needle not in text` (line 163) over real agent trace commands (lines 71-97), so the exact-substring proxy genuinely false-negatives on semantically identical invocations: quoted args, `./data/input.txt`, or — most realistically — curl flag reordering (`curl -sS -f` vs the required `curl -fsS` at line 217). That lexical brittleness is real. HOWEVER the finding's remediation rationale is wrong: it claims the require is REDUNDANT because 204-210 already proves the entrypoint ran. It does not. The artifact check (line 204: result.txt == 'ALPHA') is trivially spoofable by `echo ALPHA > output/result.txt`; combined with editing the ✅ row and printing 'RUNTIME VERIFICATION: PASSED', a fabricating agent passes cli-success with the require removed. The require is the anti-fabrication / proof-of-execution guard, distinct from the content check. So the defect is a brittle matcher, not a redundant one — the correct fix is to normalize/tokenize the command match (order-independent flags, quote-insensitive args), NOT to delete the check.

---

## Part 2 — Cross-stage chain contract audit

Cross-stage handoff audit. Complements `AUDIT-lexical-proxy.md` (within-validator
lexical proxies). This one asks: does each consumer re-parse upstream *meaning*
instead of consuming a structured fact from the one owner, and has `_shared`
drifted.

Research only. Nothing edited.

## Method note

The workflow (`wf_eac523db-497`) stalled: 6 of 17 agents hung on provider timeouts,
synthesize never ran. 4 of 5 handoffs + 7 verdicts were salvaged from its journal.
The missing boundary (**plan→work**) and the **`_shared` drift** check were
completed by hand (direct file reads). All findings below are verified against the
actual source.

## Confirmed cross-stage defects

### 1. `extract_e_contract` scans the whole file — violates the id-contract

- **File:** `wayne-plan/scripts/validate_plan.py:247-273`
- **Boundary:** test-design → plan
- **Severity:** high
- **Contract violated:**
  - `_shared/pipeline-id-contract.md:22` — "Never inventory IDs by scanning a whole
    file for `R\d+`, `D\d+`, or similar tokens."
  - `_shared/pipeline-id-contract.md:41-43` — E`<number>` is defined "only in its
    bounded E2E contract table."
- **What it observes vs claims:** `extract_e_contract` iterates
  `markdown_tables(matrix_text)` over the ENTIRE matrix file (line 250) and treats
  any table whose first column `fullmatch(r"E\d+")` (line 254) as an E-contract
  candidate. It claims to isolate "the one authoritative E contract" but actually
  scans every table anywhere in the file for E-shaped tokens — the exact move the
  contract forbids.
- **The asymmetry (this is the tell):** the sibling `extract_u_seed_rows`
  (line 200-211) does it CORRECTLY — it first locates the bounded `## U-SEED`
  section by heading, slices to the next heading, and only searches for a table
  *inside* that section. `plan-contract.md:76` even spells out the rule for U-SEED:
  "Do not discover seeds from prose or tables outside that section." E-extraction
  has no equivalent bounding, and no equivalent contract clause. **Same file, two
  standards for two ID namespaces.**
- **Concrete failure:** `plan-contract.md:172` requires the plan to copy the
  complete E table byte-for-byte into the plan as a design-time E snapshot. So a
  plan file legitimately contains the source E table AND its snapshot copy — two
  tables with `E\d+` first columns. `extract_e_contract` then sees
  `len(candidates) == 2`, trips `len(none_lines) + len(candidates) != 1` (line 258),
  and emits a false `source-e-contract` error. U-SEED never hits this because its
  section boundary scopes the search; E does.
- **The fix anchor exists:** the E2E table lives under `## Layer 2: E2E
  Verification Contract` in `test-matrix-template.md:62`, exactly parallel to
  `### U-SEED`. `extract_e_contract` can bound to that section the same way
  `extract_u_seed_rows` bounds to `## U-SEED`. Not a design dead-end.
- **Preserve:** the row-level checks (E\d+ id shape, `⬜` status presence, id
  uniqueness at lines 267-272) are legit machine-layer invariants — keep them; only
  the unbounded whole-file table scan is the defect.

### 2. Dual-review payload omits the intent/excerpts the SKILL contract promises

- **File:** `wayne-code-review/scripts/run_dual_review.py:246-288` (build_payload)
- **Boundary:** work → code-review
- **Severity:** medium (salvaged from workflow; verified)
- **What it observes vs claims:** `build_payload()` constructs the sole packet both
  review voices ever see. SKILL.md section A states reviewers receive the "intent
  summary" and "selected source excerpts," but the built payload carries the frozen
  git patch + playbook text only. The two voices are asked to judge intent fidelity
  against an artifact that does not include the intent. Format (a well-formed
  packet) is produced; the semantic input the contract promises is absent.
- **Note:** verify independently against current lines — the workflow verdict cited
  256-288; treat the line number as approximate and confirm before acting.

## Clean boundaries (audited, no defect)

- **plan → work** — `wayne-work/SKILL.md:16` links `pipeline-id-contract.md` and
  states "consume IDs only from their defining structures and never renumber
  upstream artifacts." Lines 148-149 restrict Work to flipping plan-owned U rows
  `☐→☑` and explicitly forbid editing U scenario text, the plan's E snapshot, or
  any authoritative E `⬜`. State ownership is clean; no re-parse, no reverse-edit.
- **`_shared` drift** — the LOCKED 7-column E2E format is defined once in
  `test-matrix-template.md:80`. `wayne-verify` and `wayne-test-design` reference the
  columns (`User path`, `Env: process`, …) but do not redeclare the format table.
  No copy, no drift.

## Cross-workflow disagreement to resolve (validate_plan.py:682, the arrow count)

The two audits disagree on the arrow-count rule and you should be the tiebreaker:

- **`AUDIT-lexical-proxy.md` (workflow 1)** classified `:682`
  `scenario.count("→") != 2` as **SHAPE-POLICING (medium)** — a template-shape proxy
  that rejects concrete 1-arrow (`missing config → ConfigError`) and 4-arrow
  two-branch scenarios.
- **This chain audit (workflow 2 verdict)** classified the same line as
  **MACHINE-LEGIT** — "a legit machine-layer SHAPE gate, not a semantic proxy."

Both cannot be right. My read: it is a shape gate (deterministic, low-freedom) that
is being *sold* as a concreteness check. The finding message claims the row "must
use concrete input → action → expected," which is a semantic claim; the code only
counts arrows. So it is a deterministic check mislabeled as a semantic oracle — the
`AUDIT-lexical-proxy` classification is the more accurate one, but the *fix* is to
correct the claim/message and loosen the count, not to delete the gate. Your call.

## What this audit did NOT do

- Did not re-run the failed workflow to completion (provider stalls, not a script
  bug). Hand-completed the two missing pieces instead.
- Did not touch any audited file.

---

## Part 3 — Prompt-alignment proposal (forge ↔ optimize)

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
