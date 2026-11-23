# Review: business map (change 2)
Base: 12f31ac34e2c18041f00f0e67224c80bee28d5bd. R1 snapshot: f393bd3f092207d60f613fef80ebbe6f40973aa2.

## R1 (full, opus) — verdict: fix 1
- Must 1: the click handler waited on a top-level `await import(<CDN>)`, so a hanging CDN left the page dead. Fixed:
  handlers first, Mermaid loads without blocking (`ready` promise); test asserts the order.
- Minor 2 → raised to Should. Ruling: raised — map.json is agent-written input; a wrong shape passed validation and
  crashed the render, or threw inside validate — cost if wrong: a few lines. Fixed with `list()` checks; test `R1-2`.
- Minor 3 → raised to Should. Ruling: raised — validate accepts any flow id, and one with a quote broke the chart and
  the click — cost if wrong: none. Fixed: clicks pass indexes; test `R1-3`.
- Minor 4 (`repoConfig` ignores `sdlc.local.json`, a non-string `map` crashes) → debt.
- Minor 5 (the map is read from the working tree even for an older commit range) → debt.
- Minor 6 (`.claude/sdlc.json` reformatted) → restored to the compact form.
- Declined: `launch.json` needs python (viewing aid); `verified` on the review-loop `done` step: kept, the eval shows
  the loop stopping in two rounds 3/3, only a report grader missed once.

## R2 (scoped, sonnet) — verdict: fix 1
- Findings 1 and 3 addressed. Finding 2 partly: the four named shapes were reported, but non-object items inside
  evidence, gaps and actors were still dropped silently and crashed the render. Fixed with one `objects()` check
  used for steps, evidence, gaps and actors; test `R2-1`. R2 snapshot: 91236a412886e83d4f6ed76d6e135bcd4ba21803.
- Minor: `data-flow` is unused by the page script now (harmless, kept as a readable id).
- The SKILL.md provider wording (friction 13) and the sdlc.json reformat (R1 Minor 6) were in this package on purpose.

## R3 (scoped, sonnet) — verdict: ship
- Finding addressed; no new breakage. Loop closed at R3.
