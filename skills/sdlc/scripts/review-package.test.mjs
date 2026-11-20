import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { matchingRules, rulePaths } from "./review-package.mjs"

const SCRIPT = fileURLToPath(new URL("./review-package.mjs", import.meta.url))

test("rulePaths reads a YAML list and a comma-separated string", () => {
  assert.deepEqual(rulePaths('---\npaths:\n  - "apps/**/*.tsx"\n  - packages/ui/**\n---\nbody'), ["apps/**/*.tsx", "packages/ui/**"])
  assert.deepEqual(rulePaths("---\npaths: src/**/*.ts, lib/*.ts\n---\n"), ["src/**/*.ts", "lib/*.ts"])
  assert.deepEqual(rulePaths('---\npaths: ["ui/**", \'lib/*.ts\']\n---\n'), ["ui/**", "lib/*.ts"])
  assert.deepEqual(rulePaths("---\ndescription: x\n---\n"), [])
})

test("matchingRules keeps rules whose paths match a changed file, plus unscoped ones", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-rules-"))
  mkdirSync(join(root, ".claude", "rules"), { recursive: true })
  writeFileSync(join(root, ".claude", "rules", "ui.md"), '---\npaths:\n  - "apps/**/*.tsx"\n---\nui')
  writeFileSync(join(root, ".claude", "rules", "db.md"), "---\npaths: db/**\n---\ndb")
  writeFileSync(join(root, ".claude", "rules", "all.md"), "always")
  assert.deepEqual(matchingRules(root, ["apps/a/b.tsx"]).map((r) => r.name), [".claude/rules/all.md", ".claude/rules/ui.md"])
})

test("R1-1: the package includes uncommitted and untracked work when no head is given", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(root, "a.ts"), "export const a = 1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "a.ts"), "export const a = 2\n") // modified, not committed
  writeFileSync(join(root, "b.ts"), "export const b = 1\n") // new, untracked
  const out = execFileSync("node", [SCRIPT, base], { cwd: root, encoding: "utf8" }).trim()
  const pkg = readFileSync(out, "utf8")
  assert.match(pkg, /\+export const a = 2/)
  assert.match(pkg, /\+export const b = 1/)
  assert.match(pkg, /working tree/)
})
