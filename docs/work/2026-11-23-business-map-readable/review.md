# Review: readable business map (lane M)
Base: fccb53e0921dac63edadfaf4b26eca50a49218f0. R1 snapshot: 8a7c1ae51e1a61c5212ae12f249a2e45f5fc9e77.
Critique before the change (design:design-critique on the live page): no explanation of what the page is; the commit
hash was the first thing read; English jargon (flow/state, observed/inferred); branches without conditions; sources
hidden behind clicks and gaps at the bottom; the step list repeated the chart.

## R1 (full, sonnet) — verdict: fix 1
- Should 1 (`title` not in the spec, untested): kept and added to the spec (requirement 9) with a test.
- Minor 2 → Should. Ruling: raised — `lang` is agent-written input and "constructor" crashed the render — cost if
  wrong: one line. Fixed with `Object.hasOwn`; test.
- Minor 3 → fixed (one sentence: pick `lang` by the repo's readers). Ruling: raised — an English repo copying `vi`
  from the example is the likely mistake — cost if wrong: one sentence.
- Minor 4 → fixed (full SHA in the dogfood map).
- Declined: translating this repo's own map to Vietnamese (done on purpose: the owner reads Vietnamese).
- Not checked by the reviewer, checked here in the browser: `classDef` with dashes and `class` in `stateDiagram-v2`
  render (screenshots during the build), desktop fit and 640px scroll on a phone width with no page overflow.

## R2 (scoped, sonnet) — verdict: ship
- All four addressed. Minor: SKILL.md said the default title is "Business map" for every language; corrected
  after R2 (docs only). The default-title test covers English only (debt, low).
