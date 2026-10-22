# Trace triage status

> [!SUMMARY]
> Key points
> - The close gate is [not fixed]{.bad}; the open change only raises a log level.
> - Local validation: [340 / 400 loops passed]{.warn}.

|  |  |
|---|---|
| Ticket | EXAMPLE-101, assessed, not closed |
| Owner | Alex Example [(since Oct 9)]{.muted} |
| Reproduces | [Yes]{.bad}, intermittent |

## Changes

| # | Change | Status |
|---|---|---|
| 1 | Close gate needs fix verification | [Merged to main (Oct 15)]{.ok} |
| 2 | Drop `trace-done` on merge | [Done]{.ok} |
| 3 | Extra review policy | [To do]{.muted} |
| 4 | Windows host for the reproducer | [Blocked]{.bad} |

Run the local check before merging:

```sh
uv run pytest tests/ -k close_gate
```

- Tracking: [example tracker](https://tracker.example.com/browse/EXAMPLE-101)
- The owner handoff is waiting on review.

This paragraph is deliberately long enough that it has to wrap when it is laid out at sixty columns, so a wrapping bug in the renderer or in the terminal shows up in this fixture first.

中文测试
