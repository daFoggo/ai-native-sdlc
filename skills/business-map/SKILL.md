---
name: business-map
description: Build or update an evidence-linked map of a project's business flows (actors, flows, steps, state changes) from its code, docs and tests, rendered to one HTML page that BA, testers and devs read together; each step links to the file and line that shows it and says whether that was read in code, stated by a doc, guessed, or proven by running it. Use for /business-map.
disable-model-invocation: true
---

# Business map

The map is for people who do not read the code. Every claim on it says where it came from, so a reader can tell a
fact from a guess, and the review package can tell which flows a change touched.

## Output

`<map>/map.json`, where `<map>` is the folder sdlc.json names under `map` (add `"map": "docs/business-map"` when it
names none). You write only the JSON; `node <this skill dir>/scripts/render.mjs <map>` checks it and writes
`<map>/index.html`. It refuses a map with problems and lists every one: fix them, never loosen the map to pass.

```json
{
  "version": 1,
  "lang": "vi",
  "title": "Bản đồ nghiệp vụ: <product>",
  "commit": "<git rev-parse HEAD when you built it>",
  "actors": [{ "id": "buyer", "name": "Người mua" }],
  "flows": [{
    "id": "checkout", "name": "Thanh toán", "actor": "buyer", "kind": "flow",
    "summary": "Người mua trả tiền cho giỏ hàng. Kết quả cuối: đơn đã thanh toán và có biên nhận.",
    "steps": [{ "id": "pay", "label": "Người mua trả tiền",
      "next": [{ "to": "receipt", "when": "thẻ được chấp nhận" }, { "to": "declined", "when": "thẻ bị từ chối" }],
      "evidence": [{ "file": "app/api/pay.ts", "line": 42, "kind": "observed", "note": "từ chối tổng tiền bằng 0" }] }],
    "gaps": [{ "step": "pay", "type": "error-path", "text": "thẻ bị từ chối không có màn hình nào" }]
  }]
}
```

Write for a reader who has never seen the code. `lang` (`vi` or `en`, default `en`) sets the page's own words:
pick the language the repo's BA and testers read (its docs and tickets tell you), and write every label, summary,
condition and note in it. `title` names the page (the product), else it is the language's default ("Business map", "Bản đồ nghiệp vụ"). Each flow's `summary` says in one or two sentences
what the flow is for and what it ends with. Every branch (a step with more than one `next`) names its condition in
`when`; an arrow without one is read as "always". A label is what happens, in the reader's words, not a function
name. A `note` on evidence says in a few words what that source shows; the file and line come after it.

- `kind` of a flow: `flow` (steps in order) or `state` (an object whose status changes: an order, an application, an
  approval; steps are its states, `next` its transitions).
- `kind` of evidence: `observed` (you read it in code), `documented` (a doc states it; cite the doc), `inferred`
  (your reading, not confirmed), `verified` (proven by running it; `proof` names the verify-skill feature file or
  the `/statechart` output). Never mark a guess `observed`.
- `type` of a gap: `owner` (no clear owner), `error-path`, `transition` (a state change whose condition is unclear),
  `code-vs-doc`, `untested`, `dependency` (waits on another system), `no-outcome` (ends with nothing a user sees).

## Build

1. Read the entry points before the internals: routes and API handlers, the database schema and migrations, jobs
   and queues, the docs that describe the product, and the tests (each test names behavior someone cared about).
2. Split the repo into areas (one per module or bounded feature). One read-only subagent per area on a mid-tier
   model (Claude Code: `model: sonnet`); each returns that area's flows as JSON in the shape above, nothing else.
   Keep the main context for merging.
3. Name things in the business's words, not the code's: "Buyer pays", not `handlePaymentIntent`. When a doc or the
   UI names a thing, use that name; one name per thing across the map.
4. Every step gets at least one piece of evidence. A step you believe in but cannot point at is `inferred`, and a
   gap says what would confirm it.
5. Record gaps as you find them; they are the map's most useful part for testers.
6. Render, open `index.html` once, and click one step per flow to check the evidence panel.

## Update (`--since`)

Read `commit` from the map. `git diff --name-only <commit>` lists the changed files; recheck only the steps whose
evidence names one of them, plus new routes or tables among them. The review package already lists those steps
(`## Flows touched`, and `## Map evidence missing` for files that are gone). Set `commit` to the new HEAD.

## Level 2 (only when asked)

A step becomes `verified` when something ran it: a feature file of a project verification skill drove it, or a
`/statechart` model checked a `state` flow and its bug paths were replayed against the code. Link the proof; do not
build a harness here.
