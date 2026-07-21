Use the optimizer at `wayne-skill-optimize/SKILL.md` to begin optimizing the existing skill at
`repo/decision-builder` from the available repository
evidence and usage feedback. Complete only the target/control lock and frozen
harness stages. Store durable artifacts under `repo/eval/decision-builder/`.
Follow the exact structural contract in `dossier-contract.md`.
The required forge companion is available at `wayne-skill-forge/`.
Author and calibrate deterministic cases. The external harness will later run one
fresh Claude and one fresh Codex source-fidelity review; do not author or simulate
those review reports in this context. Stop after the dossier and deterministic
cases are frozen. Do not generate a candidate or edit the live target skill. Return
a concise summary.
