# Wayne Skill Forge eval

This harness covers the three archetypes claimed by `wayne-skill-forge`.

## Procedure smoke harness

`procedure/` contains the rollout fixture used by the original Forge meta-eval.
The harness now writes an append-only `events.jsonl`, so checks can prove command
order and exactly-once apply rather than infer them from an overwritten marker.

Run its deterministic calibration with:

```bash
uv run --no-project python eval/wayne-skill-forge/procedure/calibrate.py
```

This is a smoke case, not evidence that Forge handles complex child skills.
Complex generator behavior must be evaluated through the corresponding child
harness, such as `eval/wayne-plan/`.

## Lens and router harness

Run the frozen checker calibration with:

```bash
uv run --no-project python eval/wayne-skill-forge/archetypes/calibrate.py
```

The router `multiple-signals` case is an exact historical regression: a generated
router passed its structural checker but instructed a production configuration
mutation to obtain routing evidence. The checker now requires a read-only or
isolated discriminator and rejects imperative live-system mutations.

For a Forge A/B, generate anonymous child skills from the same `intent.md`, then
run fresh Claude and Codex agents on every case. Deterministic checks gate the
result; a blind judge may compare semantic quality only after hard gates pass.
