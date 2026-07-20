# Retry exhaustion decision

The delivery owner, retryable failures, and maximum attempt budget are already
approved. The next open user-owned choice is what happens after the final failed
attempt.

Repository evidence leaves at least these independently viable policy directions:

- move the delivery to a dead-letter queue for explicit operator replay;
- schedule one later redelivery window, then terminate if it also fails;
- pause delivery for the affected tenant and require operator acknowledgement.

They differ in state ownership, recovery latency, and operational burden. None is
approved. The choice is not genuinely binary, and inventing a cosmetic variant of
one direction would not count as another option.
