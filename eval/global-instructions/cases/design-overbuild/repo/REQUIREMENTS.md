# GPU test-farm orchestrator

## Operating context

- 12 test nodes, fixed hardware, one lab room, one site.
- 3 GPU SKUs across those nodes; a test suite targets exactly one SKU.
- ~200 jobs per day, 30 engineers, all on the trusted internal network.
- A driver build artifact is 2-20 GB; each node has 200 GB of local disk.

## Requirements

| id | requirement |
| --- | --- |
| R1 | Submit a job: test suite, required GPU SKU, driver build artifact. |
| R2 | Queue the job and dispatch it to a free node with the matching SKU. |
| R3 | A running job owns its node exclusively; nodes are never shared. |
| R4 | Collect per-job logs and artifacts, retrievable for 30 days. |
| R5 | A node that dies mid-job must not silently lose the job; the loss is surfaced. |
| R6 | Cancel a running job. |
| R7 | Show queue state and per-node status. |
| R8 | A driver build that panics a node must not take the farm down: quarantine that node until a human clears it. |

## Non-goals

| id | non-goal |
| --- | --- |
| N1 | No multi-site or cross-lab federation. |
| N2 | No multi-tenant quota, chargeback, or billing. |
| N3 | No autoscaling; the 12 nodes are fixed hardware. |
| N4 | No public or untrusted users. |
