# Rubric: v2/router evaluation cases

## Case routing expectations and evidence-use criteria

Each case's expected route is deterministically derived from intent.md's routing algorithm. The blind judge verifies evidence use, not routing structure (which the check.py gate covers).

### resource-saturation-strong

**Expected route:** `resource-saturation`

**Why:** Intent step 3.1: "If `resource-saturation` strong signal is true, run `resource-saturation`." Evidence shows memory 91% (>85%) and disk free <10%.

**Evidence use to judge:** Does the playbook use memory 91% and disk 2.1GB/45GB (<10%) directly, and reason about resource exhaustion? Or does it assume a generic cause beyond the evidence provided?

### resource-and-deployment-precedence

**Expected route:** `resource-saturation`

**Why:** Intent step 3.1: "If `resource-saturation` strong signal is true, run `resource-saturation`." Memory 91% and disk <10% are present. Intent.md:24: "Deployment-rollout may co-occur with other strong signals without blocking them." The 09:10 deployment does not block the resource route.

**Evidence use to judge:** Does the playbook use the resource metrics (memory 91%, disk <10%), log evidence (OOMKilled errors), and the 09:10 deployment timestamp? Does the response reason about resource exhaustion from the observed metrics and cite the deployment timing and error type appropriately?

### latency-and-deployment-precedence

**Expected route:** `latency-trace`

**Why:** Intent step 3.2: "Else if `latency-trace` strong signal is true, run `latency-trace`." Latency 2850ms vs 400ms baseline is >50% degradation and SLO breach. Intent.md:24: "Deployment-rollout may co-occur with other strong signals without blocking them."

**Evidence use to judge:** Does the playbook use the latency metrics (2850ms vs 400ms, SLO 400ms) to set the trace target, and cite the 14:18 replica endpoint change and its timing without inventing values?

### error-spike-strong

**Expected route:** `error-spike`

**Why:** Intent step 3.3: "Else if `error-spike` strong signal is true, run `error-spike`." Error rate 6.1% vs baseline 0.3% is ≥2x. Log analysis confirms 87% are 503 errors (log pattern). Memory 51% <85%.

**Evidence use to judge:** Does the playbook use the downstream dependency signal (503 errors from dependency) appropriately, or does it misinterpret it as a local error?

### deployment-rollout-only

**Expected route:** `deployment-rollout`

**Why:** Intent Step 3.4: "Else if `deployment-rollout` strong signal is true, run `deployment-rollout`." No latency >50%, no error ≥2x, no resource saturation. Deployment occurred at 11:00, incident started at 11:03 (within 5 minutes).

**Evidence use to judge:** Does the playbook correctly identify the CACHE_TTL change as the rollout candidate? Does it distinguish incident start time from alert time?

### latency-weak-only

**Expected route:** `NO_MATCH`

**Why:** Intent step 2: "If no strong signals are true: return `NO_MATCH`." Latency 550ms vs 400ms is 37.5% increase (<50% threshold). Error rate 0.4% vs 0.3% is weak elevation. Memory 58% (<85%). No deployment. The elevated GC pause duration is contextual but does not meet a strong signal definition.

**Evidence use to judge (N/A for NO_MATCH, but the trap is critical):** If the agent routes to `resource-saturation` or `latency-trace`, it confused the mentioned memory pressure or GC pause with the strong signal definitions, failing the near-synonym discrimination.

### zero-signal

**Expected route:** `NO_MATCH`

**Why:** Intent step 2: "If no strong signals are true: return `NO_MATCH`." All metrics are within baseline: latency 390ms ≤ 400ms, error 0.25% is not ≥2x, memory 45%, disk normal, no deployment.

**Evidence use to judge:** The discriminator should request an actual metric (latency baseline, error baseline, resource snapshot) or deployment timestamp, not instruct an investigation.

### latency-and-error-forbidden-pair

**Expected route:** `NO_MATCH`

**Why:** Intent step 1: "If both `latency-trace` and `error-spike` strong signals are both true: return `NO_MATCH`." Latency 1850ms vs 400ms is 362% (>50%). Error rate 7.2% vs 0.3% is 24x (≥2x). Log analysis confirms timeout errors. Memory 52% (<85% for error-spike). Both strong signals fire independently; cannot determine root cause.

**Evidence use to judge (N/A for NO_MATCH):** If the agent routes to `latency-trace`, it ignored the error-spike strong signal and the forbidden-pair guard, failing the algorithm.

## Deterministic gate scope (check.py verifies only)

- First two non-empty lines are exactly ROUTE: and PLAYBOOK: markers
- Required sections present and in order
- No foreign playbook section names anywhere in any answer (matched route or NO_MATCH)
- NO_MATCH has exactly one `## Missing discriminator` heading containing exactly one list item (any marker: `- `, `* `, `+ `, or numbered `1. ` etc.)
- NO_MATCH contains no PLAYBOOK: marker anywhere

## Blind judge scope

- **Evidence use:** Does the selected playbook apply the case's provided metrics appropriately to its declared purpose (latency investigation, resource cause, error analysis, rollout scope), or does it invent values or misinterpret signals?
- **Signal discrimination:** For the trap case (latency-weak-only), does the agent correctly apply strong signal predicates, or does it conflate contextual signals (GC pause, memory pressure) with structural thresholds (memory >85%)?
- **Concurrent signals:** For precedence cases, does the agent correctly apply the routing priority (resource > latency > error > deployment), or does it ignore one signal or misorder them?
- **NO_MATCH reasoning:** For NO_MATCH cases, is the discriminator evidence read-only (metric query, log analysis, timestamp check) and concrete (one specific piece), or does it instruct a mutation or ask for vague "more data"?
