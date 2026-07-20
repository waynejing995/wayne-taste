# Queued Webhook Decisions

Status: in-progress

| # | Question | Decision | Rationale | Source |
|---|---|---|---|---|
| 1 | Existing queue | A reusable queue exists | Repository architecture | codebase |
| 2 | Lifecycle owner | Dispatcher is the sole delivery lifecycle owner | Preserve one state owner | codebase |

## Decision DAG

| Node | Parent | Kind | Decision | Status | Opens when |
|---|---|---|---|---|---|
| F1 | root | fact | Existing queue availability | resolved | start |
| F2 | root | fact | Delivery lifecycle ownership | resolved | start |
| N1 | root | choice | Delivery topology: inline or existing queue | open | F1 and F2 resolved |
