# Session lifecycle spec

- R1: Delta strict policy gate may reject before a session starts; native proof is `session.policy_state=verified`.
- R2: In supported unverified mode, user starts a session and sees streaming tokens plus `POLICY UNVERIFIED`.
- R3: User disconnects, resumes the same session, and sees the remaining tokens once.
- R4: On terminal failure, child processes and the session lease are cleaned up.

Streaming, resume, policy attestation, and cleanup are independent acceptance claims.
