# Spec: debt sweep after skill routing (lane M)

Goal: close the debt items that need no real-use data.
1. A rule card saved with CRLF keeps its `paths:` (`rulePaths` normalizes line endings).
2. `loadConfig` (sdlc.json + sdlc.local.json) lives once, in review-package.mjs next to `matchingRules`; the hooks
   import it. The package uses it, so `sdlc.local.json` reaches the package; a repo with no sdlc.json gives `{}`.
3. A non-string `map` in sdlc.json does not crash the package (treated as no map).
4. Claude's after-edit `check` also runs on `NotebookEdit`.
5. A test proves a skill loaded in one session does not open the gate in another.
6. Version 0.5.2.

Areas of concern: hooks now import more from a skill script (load order, the hooks file still runs when the skill
folder is present: it always ships with the plugin); `configDir` is used by `findRoot` and `fixFlag` in the hooks.
Also verified live (no code): a subagent's edit gets its own gate key from `agent_id`.
