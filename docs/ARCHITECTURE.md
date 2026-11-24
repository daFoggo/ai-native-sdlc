# Architecture: how the plugin stays correct and cheap

Written 2026-11-24 from the 30 bugs found so far (friction logs 1–23, pilot P1–P7). Almost none were in the core
logic: they sat where the plugin meets something it does not control. So the design puts all the risk at three
boundaries, keeps the inside small and pure, and sets one rule for when a hook may block.

```
 host payload ──► normalize() ─┐                                  ┌─► HOSTS[host] adapter ──► host output
 (Claude, Codex,               │     pure decisions                │   (JSON, exit code, message)
  Antigravity, Gemini)         ├──► guard / check / bash / verify ─┤
 shell & git    ──► runnable(), git -z, snapshot ─┤                 └─► once per session or per turn
 repo config    ──► loadConfig() + configProblems() at start ─┘
```

## 1. Three boundaries, each parsed once

| Boundary | What broke there | The rule |
|---|---|---|
| **Host payload** (field names, modes, what a host does with an answer) | `"ask"` still prompted in bypassPermissions (P7); `stop_hook_active` assumed; Codex `apply_patch` paths | Only `normalize()` and the `HOSTS` adapters know a host. A field or behavior the code relies on comes from a **recorded real payload** in `hooks/fixtures/<host>/`, not from the docs; until it is recorded, the code must be safe when it is missing |
| **Shell and git** | Regex over raw text banned a grep that only mentioned `pnpm add` (P1); racy-git index mtime (P6); quoted non-ASCII paths; CRLF | Read input the way the tool reads it: `runnable()` keeps only what a shell runs, git output with `-z` and `--no-renames`, text with `\r\n` normalized. Never pattern-match raw command text |
| **Repo config** (sdlc.json, settings) | A ban that also stopped `pnpm install` (P2); a mapped skill turned off (P3); `debt` in a renamed folder (P5); a typo'd key does nothing | `loadConfig()` is the only reader. `configProblems()` checks once at session start what can never work (dead paths, unknown keys, a mapped skill that is off) and says so in one line. sdlc-init proves every `denyBash` against a legit command beside the banned one |

## 2. When a hook may block

| Kind | Examples | Behavior |
|---|---|---|
| **Safety** (damage that is hard to undo) | secrets, `protect`, `denyBash`, fix-mode tests | Always block, in every permission mode |
| **Human gate** | `approve` | Ask through the host's prompt; silent when the user chose `bypassPermissions` |
| **Nudge** (process, not safety) | skill gate, verify on Stop, rule cards | At most once per skill per agent / three blocks per user turn; then pass with a warning. A nudge the agent cannot satisfy (a skill turned off) never fires |

A nudge that can repeat forever is a bug, whatever it protects. Every new block names its kind and its cap.

## 3. Token budget

- **Silent when healthy.** Hooks print nothing on pass; `start` adds config problems only when there are some.
- **Once, then remembered.** Seen keys per session (`sdlc-seen-<session>.json`) for skills and rule cards.
- **Pay for a file once.** The review package lists artifacts and huge files by path, inlines only the diff at 5
  lines of context; R2/R3 package only the fix (`--since`).
- **Cheapest model that does not miss.** Lane M R1 and scoped rounds on sonnet; never haiku for review.
- **Text the agent re-reads every session is short.** The start line, the skill and the deny reasons are budgeted
  like code: a new sentence must remove a wasted turn somewhere.

## 4. How a bug is closed

1. Rebuild it from the **real input** (payload, command, config) as a failing test; the pilot logs say where.
2. Fix it at the boundary layer above, once, for every caller; test both sides (the bad case and a legit neighbour).
3. Bump the version in the five manifests; a pushed hook change is live only after `claude plugin update`.
4. A second report of the same class becomes a rule here or in the skill, not another patch.

## Open

- Record real Claude payloads for Stop (`stop_hook_active` on a new turn), Skill and subagent calls as fixtures (ROADMAP).
- Verify under load (P4): a slow box turns verify into a warning; a `verifyFast` per area is the candidate.
