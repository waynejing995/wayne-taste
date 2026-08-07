# Request

Use the supplied lens to judge the claim: release `R42` caused the checkout crash.

# Evidence pack

- [E1] A 50/50 canary sent the same production traffic mix to `R41` and `R42` on
  identical hosts; only `R42` crashed, at 31.8%, while `R41` had 0 crashes.
- [E2] Swapping the assigned release between the same two host pools moved the
  crashes with `R42`, not with the hosts.
- [E3] Rolling the canary back to `R41` stopped crashes within one request cycle.
- [E4] Reapplying `R42` reproduced the crash at the same parser call site.
- [E5] The `R42` diff changed that parser's null handling; configuration, traffic
  policy, and dependency versions were unchanged during the experiment.
