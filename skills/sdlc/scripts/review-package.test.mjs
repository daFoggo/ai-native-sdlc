import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { matchingRules, rulePaths } from "./review-package.mjs"

test("rulePaths reads a YAML list and a comma-separated string", () => {
  assert.deepEqual(rulePaths('---\npaths:\n  - "apps/**/*.tsx"\n  - packages/ui/**\n---\nbody'), ["apps/**/*.tsx", "packages/ui/**"])
  assert.deepEqual(rulePaths("---\npaths: src/**/*.ts, lib/*.ts\n---\n"), ["src/**/*.ts", "lib/*.ts"])
  assert.deepEqual(rulePaths("---\ndescription: x\n---\n"), [])
})

test("matchingRules keeps rules whose paths match a changed file, plus unscoped ones", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-rules-"))
  mkdirSync(join(root, ".claude", "rules"), { recursive: true })
  writeFileSync(join(root, ".claude", "rules", "ui.md"), '---\npaths:\n  - "apps/**/*.tsx"\n---\nui')
  writeFileSync(join(root, ".claude", "rules", "db.md"), "---\npaths: db/**\n---\ndb")
  writeFileSync(join(root, ".claude", "rules", "all.md"), "always")
  assert.deepEqual(matchingRules(root, ["apps/a/b.tsx"]).map((r) => r.name), ["all.md", "ui.md"])
})
