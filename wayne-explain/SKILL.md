---
name: wayne-explain
description: Re-explain in plain Chinese only on request ("我不懂", "说人话", "这fix了个啥玩意", "你在干啥", "咋回事", "plain chinese", or an ELI level / audience). Not for prose polishing or a TL;DR.
---

Restore the missing context and re-explain in plain Chinese; don't just shorten the answer that failed. Keep it short, preserve real project names, and use a concrete example when helpful.

ELI means "Explain Like I'm". A leading number or `ELI<number>` selects a level; default to `25`. If no topic follows, use the current topic. Honor an explicitly named audience.

- `5`: Assume no background; use simple words and an everyday example.
- `10`: Add basic cause and effect.
- `15`: Explain mechanisms and define unfamiliar terms.
- `25`: Explain mechanisms and trade-offs to an adult without assuming specialist knowledge.
