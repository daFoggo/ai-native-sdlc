# Spec: business map with evidence (change 2 of 2)
Intent: docs/work/2026-11-23-business-map/intent.md. Status: approved (delegated). Record: none

## Requirements
1. `map.json` shape: `{ version: 1, commit, actors: [{id, name}], flows: [{id, name, actor, kind: "flow"|"state",
   steps: [{id, label, next: [stepId], evidence: [{file, line?, kind, proof?, note?}]}], gaps: [{step?, type, text}]}] }`.
   Evidence `kind` ∈ `observed` (read in code), `documented` (a doc states it), `inferred` (the agent's guess),
   `verified` (needs `proof`: a verify-skill feature file or a statechart output). Gap `type` ∈ `owner`, `error-path`,
   `transition`, `code-vs-doc`, `untested`, `dependency`, `no-outcome`.
2. `node skills/business-map/scripts/render.mjs <dir>` validates `<dir>/map.json` and writes `<dir>/index.html`.
   Invalid input (unknown kind or gap type, a `next` or gap `step` naming no step, a duplicate id, `verified` without
   `proof`, a step without evidence) → exit 1 listing every problem, no HTML written.
3. The HTML is one file: a flow list, a Mermaid chart per flow (`flowchart TD` for `flow`, `stateDiagram-v2` for
   `state`), each step clickable to a panel with its evidence (kind badge, file:line, note) and its gaps; a gap list
   per flow; a legend of the four kinds. Mermaid from `cdn.jsdelivr.net/npm/mermaid@11.4.1`. Labels and notes are
   HTML-escaped; Mermaid labels are quoted.
4. `review-package.mjs` reads `map` (a folder) from `.agents/sdlc.json` or `.claude/sdlc.json`. When the map exists,
   the package gets `## Flows touched`: one line per step whose evidence file changed (`flow › step — file:line
   (kind)`), and `## Map evidence missing` for evidence files no longer in the repo. No `map` key → no section.
5. `review-package.mjs` lists files under the config's `artifacts` folder (default `docs/work`) instead of inlining
   their diff (friction 8).
6. `skills/business-map/SKILL.md` (`disable-model-invocation: true`): how to read the repo (routes, schema, tests,
   docs; one subagent per area on a mid-tier model), domain words over code names, evidence kinds, gaps, render,
   and `--since` upkeep (re-check only steps whose evidence files changed since `commit`).
7. sdlc SKILL.md: lane L spec reads the map's steps for the files it will touch into **Areas of concern**. Reviewer
   prompt: flows touched are checked against the change. README and template document `map`.

## Design
Validation and rendering in one script with an exported `validate(map)` → problems[] and `render(map)` → string,
tested by `node:test`. `touchedFlows(map, files, exists)` in review-package (pure; `exists` injected for the stale
check). Config read is three lines in review-package (it cannot import the hooks: the hooks import it).

## Approaches considered
- **Agent writes JSON, a script renders (chosen).** Deterministic HTML, validation at the boundary, the agent pays
  only for the JSON; review and spec read the JSON, never the HTML.
- Agent writes the HTML directly: every run costs the page's tokens and nothing checks the evidence.
- Mermaid files only (no HTML): no click-through to evidence, which is the point for BA and testers.

## Areas of concern
- The HTML loads Mermaid from a CDN; offline viewing shows the source text. Accepted.
- Evidence lines drift as code changes; the map records `commit` and the upkeep re-checks changed files only.
- Large maps: one HTML file; flows are listed and charts render on demand per flow to keep the page fast.

## Open questions carried forward
None.
