# Review: tests stop leaking temp files (lane M)
Base: aabd83511947775fc7d131d945e53e0fde3c8a35.

## R1 (full, sonnet) — verdict: ship
- No findings. Reviewer checked: tmpdir() reads env per call; `node --test` passes `--import` to per-file children;
  every explicit child `env` copies process.env; a run on Windows left no `sdlc-*` entry.
- Minor → debt: a killed test process (timeout, Ctrl-C) skips the exit handler and leaves its folder.
- Not checked: Linux/macOS (TMPDIR). Measured here: old command 57 entries per run, new 0.
