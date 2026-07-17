# Provider status evidence

- Observable: every signed request returns `503 provider unavailable`.
- Provider incident `NET-88` confirms the upstream region is drained.
- Local request serialization matches the published contract byte-for-byte.
- Repro rate: 5 of 5 requests in the supplied capture.
