# Review instructions

Read by the `reviewer` agent before every review. Keep it under a page.

## What blocks a merge (Must fix)
- Behavior breaks, data leaks or is lost, or a rule in `.claude/rules/` is broken.

## Should fix
- Risky logic without a test that fails when it breaks.

## Do not report
- Anything the linter, formatter or type checker enforces.
- Generated and vendored paths: <list>.

## Cap
- At most five Minor findings; summarize the rest as a count.
