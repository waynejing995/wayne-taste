Read `/workspace/skill/SKILL.md` completely and follow it, including only the
direct references and template needed for this case. Use no globally installed
copy of the skill.

Work in `/workspace/repo`. Read `AGENTS.md` and `case.md`, then perform exactly one
triage pass. All permitted input is already in the repository. Do not use network
or tracker APIs unless `case.md` explicitly supplies a fetch command. Do not edit
product code, tests, input artifacts, or tracker state. Do not implement a fix,
write a plan, mutate the KB, commit, branch, push, or publish.

Use the handoff approval stated in `case.md`; never infer approval. For an approved
internal route, read `/workspace/support/wayne-checkpoint/SKILL.md` and its packet
template, then emit that real return-only contract. Validate its caller-selected
target against `/workspace/support/available-skills.md`. For an external or
unresolved route, emit no checkpoint. When data or a decision is missing, ask one
recommended question and stop. Return only the concise user-visible triage result.

No evaluator, expected route, other skill version, or hidden test is available.
