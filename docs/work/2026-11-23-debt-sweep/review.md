# Review: debt sweep (lane M)
Base: 3a722a35759a99d1fa47e909d68144dbe9718681.

## R1 (full, sonnet) — verdict: ship
- No Must or Should. 71/71 tests.
- Minor 1 → debt: the payload item was ticked with no fixture file; a separate open line now asks for the files.
- Minor 2 → accepted: a malformed sdlc.local.json now fails the package loudly, as it already fails the hooks.
- Declined to judge (checked here instead): a subagent's edit gets its own gate key — seen in this session's seen
  file as `skill-asked:<agent_id>:ponytail-help` after the main agent had loaded that skill.
- Not checked: the NotebookEdit matcher live.
