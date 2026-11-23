# Spec: last known bugs before real use (lane M)

1. The Stop hook's cap of three blocks is per user turn: a Stop whose payload has `stop_hook_active: false` (a new
   turn, Claude and Codex) resets the count. A payload without the field keeps one cap per session, so a host that
   omits it can never loop.
2. `review-package.mjs <base> <head>` reads `<map>/map.json` and checks evidence files as they are at the reviewed
   commit (`to`: head, or the working-tree snapshot), not on disk now.
3. Ruling, no code: a Skill call from a cwd outside any sdlc repo stays unrecorded (R1-2 forbids seen files there).
4. Version 0.5.3.

Areas of concern: Antigravity's Stop payload may lack the flag (then behavior is unchanged); a map path with a
trailing or Windows separator in sdlc.json; `ls-tree` cost on big repos (runs only when `map` is set). Rule cards
are still read from disk: the current rules are the ones a change must meet.
