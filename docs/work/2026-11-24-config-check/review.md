# Review: config check at session start

Base: f8ea4b7b3c5291c190686c30982870b310a08152

## R1 (full, sonnet) — snapshot 61798aa23ca8d4287bab9198cd1a78863e425b00 — verdict: fix 1
1. **Should** — `configProblems` throws on a malformed `skills` (`{}`, `"x"`, `[null]`) outside start's try/catch:
   SessionStart crashes and every repo loses its pointer. Same shape already threw in `skillGate`.
   Fixed: one reader `skillMap()` (drops malformed entries) for the guard and start; start's try/catch covers
   `configProblems`; start reports the malformed shape. Test: four malformed shapes, start and guard both survive.
2. **Minor** — a fresh repo with `artifacts: "docs/work"` and no `docs/` warned on day one. Fixed in the same pass
   (cheap): only a path outside the repo is reported; inside it the folder is made on first use.

## R2 (scoped, sonnet) — package since 61798aa
Verdict: ship. Both findings addressed. Two Minors to debt: an in-repo folder named `..foo` counts as outside;
an absolute `debt`/`artifacts` on another Windows drive is not checked (a missed warning only).
