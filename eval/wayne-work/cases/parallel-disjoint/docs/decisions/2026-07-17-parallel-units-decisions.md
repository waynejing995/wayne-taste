# Parallel Units Decisions

Status: approved

- Destination formatting and attempt limiting are independent pure functions.
- Empty destinations and non-positive limits fail loud with `ValueError`.
- No export aggregation or shared source file is part of this change.
