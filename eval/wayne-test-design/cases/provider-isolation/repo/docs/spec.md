# Multi-provider execution spec

- R1: Alpha and Beta each support streaming through their public `--policy unverified` mode; the visible banner must include `POLICY UNVERIFIED`.
- R2: Alpha strict attestation is proven only by native field `runtime.policy_verified=true`.
- R3: Beta strict attestation is proven only by native field `response.attestation_state=verified`.
- R4: strict attestation may reject before prompt submission and therefore cannot prove streaming.
- R5: fan-out across Alpha and Beta returns both results even when one provider fails; this aggregation behavior is intentionally cross-provider.
