# Intent: business map with evidence
Author: repo owner. Status: accepted (calls delegated: "cứ tự đề xuất và làm tiếp", 2026-11-23).
Source: conversation 2026-11-23 (the `business-map` proposal). Record: none

## Problem
BA, testers and devs have no shared view of a project's business flows, and nobody can tell which claim about a flow
comes from code, from a doc, or from a guess. Reviews and specs also cannot see which flows a change touches.

## Proposed outcome
1. `/business-map` builds `map.json` (actors, flows, steps, evidence with file:line and its kind, gaps) and renders
   it to one HTML page with a Mermaid chart per flow; clicking a step shows its evidence.
2. The review package lists the flows and steps whose evidence files a change touched, so the reviewer and the spec
   check them; missing evidence files are flagged as stale.
3. Friction 8 from change 1: the review package stops inlining the change's own artifacts.

## Affected users and systems
New `skills/business-map/`, `skills/sdlc/scripts/review-package.mjs`, the sdlc skill (spec stage), the reviewer
prompt, README, sdlc.json key `map`.

## Constraints
Level 1 only: no app driving, no model checker. Level 2 is a slot in the schema (`verified` evidence with a proof
path from a verify skill or `/statechart`). The agent writes JSON only; a script renders HTML. No new dependency.

## Open questions
None blocking.
