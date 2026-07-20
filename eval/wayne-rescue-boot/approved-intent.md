# Approved intent

| ID | Behavior | Source | Gate |
|---|---|---|---|
| R1 | Operate only on a non-booting box with a BMC, console, or on-site rescue path | description; `SKILL.md@708779e`, boundary/When to Run | Flow access branch |
| R2 | A booted box with a broken service routes to triage/verify; log-only input is not execution authority | `SKILL.md@708779e`, boundary/When to Run | boundary review |
| R3 | Mount, SMART, and read-only fsck evidence decide hardware health before any chroot write | `SKILL.md@708779e`, Phase 3 before Phase 5 | Flow ordering |
| R4 | Unhealthy media stops for preservation/replacement and cannot reach chroot | Phase 3 bad-sector action | graph non-reachability |
| R5 | Healthy media continues through software diagnosis, chroot repair, human reboot gate, and real-disk verification loop | Flow; Phases 4-6 | graph reachability |
| R6 | Global engineering rules have one owner outside the skill | repository policy; Forge boundary | static heading |
