# Business map — Implementation Plan

> Build role: inline. Review: the sdlc loop.

**Goal:** `/business-map` produces a validated `map.json` and an HTML view; the review package lists flows a change touches.
**Spec:** docs/work/2026-11-23-business-map/spec.md. Approved by: owner (delegated), 2026-11-23. Record: none
Base: 12f31ac34e2c18041f00f0e67224c80bee28d5bd

## Global constraints
- No new dependency; Node ≥22.5; Mermaid `11.4.1` from jsdelivr.
- Version 0.5.0 in all five manifests.

## Review focus
1. A label with `"`, `<` or a newline must not break the Mermaid source or inject HTML.
2. Step ids with characters Mermaid rejects (`-`, `.`, spaces) still render (map ids to `s0..sN`).
3. Windows paths in evidence (`a\b.ts`) still match changed files (normalize to `/`).
4. A `state` flow whose steps form a cycle renders.
5. A map folder that exists without `map.json` → no section, no crash.

### Task 1: validate and render
- Files: create `skills/business-map/scripts/render.mjs`, `render.test.mjs`; `package.json` test glob adds
  `skills/*/scripts/*.test.mjs`.
- Interfaces: `validate(map) → string[]`, `render(map) → string`, CLI `render.mjs <dir>`.
- Tests: valid fixture → `[]`; each invalid case in spec 2 → a problem naming it; render output contains
  `flowchart TD`, `stateDiagram-v2`, escaped `&lt;`, the Mermaid URL, and no raw `<script>` from a label;
  ids `a-b.c` render; CLI on an invalid map exits 1 and writes no `index.html`.

### Task 2: flows touched and artifacts in the review package
- Files: `skills/sdlc/scripts/review-package.mjs`, `review-package.test.mjs`.
- Interfaces: `touchedFlows(map, files, exists) → { touched: string[], missing: string[] }`.
- Tests: a changed file matches its step line; `a\b.ts` evidence matches `a/b.ts`; a missing file lands in
  `missing`; end-to-end package in a temp repo with `map` set shows `## Flows touched`, without it shows none; a
  changed file under `docs/work/` is listed, not in the diff.

### Task 3: the skill and the wiring
- Files: create `skills/business-map/SKILL.md`; modify `skills/sdlc/SKILL.md` (§1 spec line),
  `skills/sdlc/references/reviewer.md` (one line), `README.md`, `skills/sdlc/templates/sdlc.json`, manifests → 0.5.0.
- Test: `npm test` green; render an example map from this repo's own hooks (dogfood) and open it once.

## Departures during the build
- Task 1: opening the page as a file snapshot showed nothing: a failed static `import` of Mermaid killed the script
  while every flow was hidden. Now the first flow is visible without script and Mermaid loads by `await import` in a
  try (test `render works without Mermaid`).
- Task 2: the map's rendered `index.html` is listed, not inlined, like artifacts (generated from `map.json`).
- Dogfood: `docs/business-map/` maps this repo's edit flow and review loop; `.claude/sdlc.json` names it;
  `.claude/launch.json` serves it for viewing.

## Risks
- Escaping: Mermaid labels and HTML both; pinned by focus 1.
- The artifacts exclusion hides a real code file only if someone sets `artifacts` to a code folder; the list still names it.
