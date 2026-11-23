// Loaded with --import by `npm test`: each test process and the hooks it spawns write temp files into one folder
// that is removed on exit, so test repos and seen-state files do not pile up in the system temp folder.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "sdlc-test-"))
process.env.TMPDIR = process.env.TMP = process.env.TEMP = dir
process.on("exit", () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }))
