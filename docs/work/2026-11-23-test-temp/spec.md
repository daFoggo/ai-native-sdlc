# Spec: tests stop leaking temp files (lane M)

Goal: `npm test` leaves nothing in the system temp folder. Problem: test files make repos and seen/state files
with `mkdtempSync(tmpdir())` and unique session ids and never remove them; 2609 entries had piled up, 57 per run.

Requirements:
1. `npm test` loads `test-tmp.mjs` with `--import`; it points TMPDIR/TMP/TEMP at one new folder for the process
   and the hooks it spawns, and removes that folder on exit.
2. A run of `npm test` adds no entry to the system temp folder (measured: 57 before, 0 after).
3. Tests still pass (67).

Areas of concern: tests that pass an explicit `env` to a child process (do they copy process.env?); whether
`node --test` passes `--import` to the per-file child processes; Windows removal of read-only git objects.
