# Eval: Wayne Rescue Boot applicability and disk safety

- Control static: `inherits`, `when-to-run` errors.
- Candidate static: 0 errors.
- No rescue access: terminal; chroot unreachable.
- Unhealthy disk: preserve/replace terminal; chroot unreachable.
- Healthy disk: software diagnosis and chroot remain reachable.
- Calibration: missing access stop, missing healthy path, and unsafe-disk bypass
  mutations all fail with their expected finding.
- Runtime limitation: no destructive hardware trial was run; real evidence remains
  mandatory before the health decision.
