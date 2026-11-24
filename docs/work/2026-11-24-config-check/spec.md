# Spec: config check at session start (lane M)

Record: pilot friction P3, P5 (docs/pilot/wattprint-friction.md). Approval: user delegated ("làm thì làm đi").

**Goal.** A repo's sdlc.json that can never do what it says is reported once, at session start, instead of the agent
tripping on it later. Also the architecture model in docs/ARCHITECTURE.md.

**Requirements**
1. `configProblems(root, config, home)` returns one short line per problem, `[]` when healthy:
   - `artifacts` / `debt` set as a string pointing outside the repo whose parent folder does not exist (inside the
     repo the folder is created on first use: R1 Minor);
   - `map` set and `<map>/map.json` missing;
   - a top-level key no part of the plugin reads (keys starting `$`, `_`, `/` are comments);
   - a skill in `skills` that `skillOverrides` turns `off` in `~/.claude/settings.json`, `<repo>/.claude/settings.json`
     or `settings.local.json` (later layers win; names compare bare, `plugin:name` = `name`).
2. `start` appends `Config problems in <repo>: …` to its line only when there are problems; healthy config costs no
   tokens. A broken sdlc.json still gives "unreadable" for that repo only.
3. The skill gate skips a mapped skill that settings turn off (it can never be loaded, so the deny wastes a turn).

**Areas of concern**
- The known-key list must hold every key any part of the plugin reads, or a valid config is reported as a typo.
- Settings of a parent folder that holds several repos are not read (shortcut comment in code).
- `skillOverrides` values other than `"off"` are treated as on.
