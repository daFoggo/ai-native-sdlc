import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { loadConfig, matchingRules, rulePaths, touchedFlows } from "./review-package.mjs"

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

test("--since packages only the fix made after an earlier round, and leaves the index alone", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  const pkg = (...a) => readFileSync(execFileSync("node", [SCRIPT, ...a], { cwd: root, encoding: "utf8" }).trim(), "utf8")
  git("init", "-q")
  writeFileSync(join(root, "a.ts"), "export const a = 1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "a.ts"), "export const a = 2\n")
  writeFileSync(join(root, "b.ts"), "export const b = 1\n")
  const r1 = pkg(base)
  const snap = r1.match(/^Snapshot: ([0-9a-f]{40})/m)[1]
  writeFileSync(join(root, "b.ts"), "export const b = 3\n") // the fix
  const r2 = pkg(base, "--since", snap)
  assert.match(r2, /\+export const b = 3/)
  assert.doesNotMatch(r2, /export const a = 2/) // reviewed in R1, not re-read
  assert.equal(git("status", "--porcelain"), " M a.ts\n?? b.ts\n") // nothing staged by the snapshots
})

test("a file with a huge diff is listed, not inlined", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(root, "a.ts"), "export const a = 1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "lock.json"), "x\n".repeat(2000))
  writeFileSync(join(root, "a.ts"), "export const a = 2\n")
  const p = readFileSync(execFileSync("node", [SCRIPT, base], { cwd: root, encoding: "utf8" }).trim(), "utf8")
  assert.match(p, /Not inlined[^\n]*\nlock\.json/)
  assert.match(p, /\+export const a = 2/)
  assert.doesNotMatch(p.split("## Diff")[1], /lock\.json/)
})

test("a head given by name prints its sha, and a huge non-ASCII file is still left out", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(root, "a.ts"), "export const a = 1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "é.json"), "x\n".repeat(900))
  git("add", "-A"); git("commit", "-qm", "big")
  const p = readFileSync(execFileSync("node", [SCRIPT, base, "HEAD"], { cwd: root, encoding: "utf8" }).trim(), "utf8")
  assert.match(p, new RegExp(`^Snapshot: ${git("rev-parse", "HEAD").trim()} `, "m")) // not "HEAD", which moves
  assert.match(p, /Not inlined[^\n]*\né\.json/)
  assert.doesNotMatch(p.split("## Diff")[1], /^\+x$/m)
})

test("--snapshot as base: work already dirty at the start stays out of the package", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(root, "a.ts"), "export const a = 1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  writeFileSync(join(root, "old.ts"), "export const leftover = 1\n") // someone's uncommitted work
  const base = execFileSync("node", [SCRIPT, "--snapshot"], { cwd: root, encoding: "utf8" }).trim()
  assert.match(base, /^[0-9a-f]{40}$/)
  writeFileSync(join(root, "a.ts"), "export const a = 2\n") // this change
  const p = readFileSync(execFileSync("node", [SCRIPT, base], { cwd: root, encoding: "utf8" }).trim(), "utf8")
  assert.match(p, /\+export const a = 2/)
  assert.doesNotMatch(p, /leftover/)
})

const bmap = {
  flows: [
    {
      id: "pay",
      name: "Checkout",
      steps: [
        { id: "a", label: "Pay", evidence: [{ file: "app\\pay.ts", line: 3, kind: "observed" }] },
        { id: "b", label: "Receipt", evidence: [{ file: "app/gone.ts", kind: "inferred" }, { file: "docs/r.md", kind: "documented" }] },
      ],
    },
  ],
}

test("touchedFlows lists steps whose evidence changed and evidence files that are gone", () => {
  const r = touchedFlows(bmap, ["app/pay.ts"], (f) => f !== "app/gone.ts")
  assert.deepEqual(r.touched, ["Checkout › Pay — app/pay.ts:3 (observed)"])
  assert.deepEqual(r.missing, ["Checkout › Receipt — app/gone.ts"])
  assert.deepEqual(touchedFlows(bmap, ["x.ts"], () => true), { touched: [], missing: [] })
})

test("the package gets flows touched from sdlc.json map, and lists artifacts instead of inlining them", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  const pkg = () => readFileSync(execFileSync("node", [SCRIPT, base], { cwd: root, encoding: "utf8" }).trim(), "utf8")
  git("init", "-q")
  mkdirSync(join(root, "app"))
  writeFileSync(join(root, "app/pay.ts"), "export const a = 1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "app/pay.ts"), "export const a = 2\n")
  mkdirSync(join(root, "docs/work/x"), { recursive: true })
  writeFileSync(join(root, "docs/work/x/spec.md"), "SPEC BODY\n")
  assert.doesNotMatch(pkg(), /Flows touched/) // no sdlc.json map
  mkdirSync(join(root, ".claude"))
  mkdirSync(join(root, "docs/map"))
  writeFileSync(join(root, ".claude/sdlc.json"), JSON.stringify({ map: "docs/map" }))
  assert.doesNotMatch(pkg(), /Flows touched/) // map folder without map.json
  writeFileSync(join(root, "docs/map/map.json"), JSON.stringify(bmap))
  writeFileSync(join(root, "docs/map/index.html"), "RENDERED PAGE\n")
  const p = pkg()
  assert.match(p, /^docs\/map\/index\.html$/m)
  assert.doesNotMatch(p, /RENDERED PAGE/)
  assert.match(p, /## Flows touched[^\n]*\n- Checkout › Pay — app\/pay\.ts:3 \(observed\)/)
  assert.match(p, /## Map evidence missing[^\n]*\n- Checkout › Receipt — app\/gone\.ts/)
  assert.match(p, /docs\/work\/x\/spec\.md/) // listed
  assert.doesNotMatch(p, /SPEC BODY/) // not inlined
})

test("rulePaths reads a card saved with CRLF line endings", () => {
  assert.deepEqual(rulePaths("---\r\npaths:\r\n  - apps/**\r\n  - lib/*.ts\r\n---\r\nbody"), ["apps/**", "lib/*.ts"])
  assert.deepEqual(rulePaths("---\r\npaths: src/**\r\n---\r\n"), ["src/**"])
})

test("loadConfig adds sdlc.local.json lists to the team's; a repo without sdlc.json gives {}", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-cfg-"))
  assert.deepEqual(loadConfig(root), {})
  mkdirSync(join(root, ".claude"))
  writeFileSync(join(root, ".claude/sdlc.json"), JSON.stringify({ tests: ["a"], map: "m" }))
  writeFileSync(join(root, ".claude/sdlc.local.json"), JSON.stringify({ tests: ["b"], map: "n" }))
  assert.deepEqual(loadConfig(root), { tests: ["a", "b"], map: "n" })
})

test("a non-string map in sdlc.json does not crash the package", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  git("init", "-q")
  writeFileSync(join(root, "a.ts"), "1\n")
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "a.ts"), "2\n")
  mkdirSync(join(root, ".claude"))
  writeFileSync(join(root, ".claude/sdlc.json"), JSON.stringify({ map: { dir: "x" } }))
  assert.match(readFileSync(execFileSync("node", [SCRIPT, base], { cwd: root, encoding: "utf8" }).trim(), "utf8"), /## Stat/)
})

test("a <base> <head> package reads the map and evidence as they were at head, not the working tree", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-pkg-"))
  const git = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, encoding: "utf8" })
  git("init", "-q")
  mkdirSync(join(root, "app"))
  mkdirSync(join(root, ".claude"))
  mkdirSync(join(root, "docs/map"), { recursive: true })
  writeFileSync(join(root, ".claude/sdlc.json"), JSON.stringify({ map: "./docs\\map/", artifacts: "./docs/work" }))
  writeFileSync(join(root, "app/pay.ts"), "1\n")
  writeFileSync(join(root, "app/gone.ts"), "1\n")
  writeFileSync(join(root, "docs/map/map.json"), JSON.stringify(bmap))
  git("add", "-A"); git("commit", "-qm", "init")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(root, "app/pay.ts"), "2\n")
  mkdirSync(join(root, "docs/work/x"), { recursive: true })
  writeFileSync(join(root, "docs/work/x/spec.md"), "SPEC BODY\n")
  git("add", "-A"); git("commit", "-qm", "pay")
  // After head: the map is emptied and gone.ts deleted, uncommitted. A package of base..HEAD must not see either.
  writeFileSync(join(root, "docs/map/map.json"), JSON.stringify({ flows: [] }))
  rmSync(join(root, "app/gone.ts"))
  const p = readFileSync(execFileSync("node", [SCRIPT, base, "HEAD"], { cwd: root, encoding: "utf8" }).trim(), "utf8")
  assert.match(p, /## Flows touched[^\n]*\n- Checkout › Pay/)
  assert.doesNotMatch(p, /app\/gone\.ts/)
  assert.doesNotMatch(p, /SPEC BODY/) // `./docs/work` in sdlc.json still lists artifacts instead of inlining them
})
