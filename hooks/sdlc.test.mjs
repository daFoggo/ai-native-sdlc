import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { check, guard, start, verify } from "./sdlc.mjs"

const SCRIPT = fileURLToPath(new URL("./sdlc.mjs", import.meta.url))

function repo(config) {
  const root = mkdtempSync(join(tmpdir(), "sdlc-test-"))
  mkdirSync(join(root, ".claude"))
  writeFileSync(join(root, ".claude", "sdlc.json"), JSON.stringify(config))
  execFileSync("git", ["init", "-q"], { cwd: root })
  return root
}

const edit = (root, rel) => ({ tool_name: "Edit", tool_input: { file_path: join(root, rel) }, cwd: root })

test("guard denies protected paths and allows the rest", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }] })
  assert.match(guard(edit(root, "vendor/a.ts")), /protected: vendored/)
  assert.equal(guard(edit(root, "src/a.ts")), null)
})

test("guard does nothing outside an opted-in repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-none-"))
  assert.equal(guard(edit(dir, "a.ts")), null)
  assert.equal(guard({ tool_name: "Bash", tool_input: { command: "rm -rf x" }, cwd: dir }), null)
})

test("guard bans shell commands, also from a parent folder of several repos", () => {
  const root = repo({ denyBash: [{ pattern: "shadcn(@\\S+)? add https://hairlineui", reason: "use pnpm hairline" }] })
  const bash = (cwd) => guard({ tool_name: "Bash", tool_input: { command: "cd x && pnpm dlx shadcn@latest add https://hairlineui.com/r/a" }, cwd })
  assert.match(bash(root), /use pnpm hairline/)
  assert.match(bash(join(root, "..")), /use pnpm hairline/)
  assert.equal(guard({ tool_name: "Bash", tool_input: { command: "pnpm check" }, cwd: root }), null)
})

test("fix mode makes tests read-only until it is switched off", () => {
  const root = repo({ tests: ["**/*.test.ts"] })
  const fix = (arg) => execFileSync("node", [SCRIPT, "fix", arg], { cwd: root, encoding: "utf8" })
  assert.equal(guard(edit(root, "src/a.test.ts")), null)
  fix("on")
  assert.match(guard(edit(root, "src/a.test.ts")), /Fix mode/)
  assert.equal(guard(edit(root, "src/a.ts")), null)
  fix("off")
  assert.equal(guard(edit(root, "src/a.test.ts")), null)
})

test("check is silent on pass and reports the failing command's output", () => {
  const root = repo({
    check: [
      { glob: "**/*.ts", run: "test -f {file}" },
      { glob: "bad/**", cwd: "bad", run: "echo lint says no about {file}; exit 1" },
    ],
  })
  mkdirSync(join(root, "bad"))
  writeFileSync(join(root, "ok.ts"), "")
  writeFileSync(join(root, "bad", "x y.ts"), "")
  assert.equal(check(edit(root, "ok.ts")), null)
  // {file} is relative to the check's cwd and quoted, so paths with spaces survive.
  assert.match(check(edit(root, "bad/x y.ts")), /lint says no about x y\.ts/)
})

test("verify blocks once per tree state, skips a green or clean tree, and stops blocking after 3", () => {
  const root = repo({ verify: "test ! -f broken" })
  const state = join(mkdtempSync(join(tmpdir(), "sdlc-state-")), "s.json")
  const stop = () => verify({ cwd: root }, state)
  process.env.CLAUDE_PROJECT_DIR = root
  try {
    assert.deepEqual(stop(), { block: [], warn: [] }) // only .claude/ untracked: verify runs and passes
    writeFileSync(join(root, "a.ts"), "1")
    assert.deepEqual(stop().block, []) // passes
    writeFileSync(join(root, "broken"), "1")
    assert.equal(stop().block.length, 1) // fails: block
    assert.equal(stop().block.length, 0) // same state: already reported
    for (const n of [2, 3]) {
      writeFileSync(join(root, "broken"), String(n))
      assert.equal(stop().block.length, 1)
    }
    writeFileSync(join(root, "broken"), "4")
    const r = stop()
    assert.equal(r.block.length, 0)
    assert.equal(r.warn.length, 1) // fourth failure: warn, never block forever
  } finally {
    delete process.env.CLAUDE_PROJECT_DIR
  }
})

test("hook output: guard denies through JSON, verify blocks with exit 2", () => {
  const root = repo({ protect: [{ glob: "v/**", reason: "vendored" }], verify: "exit 1" })
  const g = spawnSync("node", [SCRIPT, "guard"], { input: JSON.stringify(edit(root, "v/a.ts")), encoding: "utf8" })
  assert.equal(JSON.parse(g.stdout).hookSpecificOutput.permissionDecision, "deny")
  writeFileSync(join(root, "a.ts"), "")
  const v = spawnSync("node", [SCRIPT, "verify"], {
    input: JSON.stringify({ session_id: `t${process.pid}`, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  })
  assert.equal(v.status, 2)
  assert.match(v.stderr, /verify failed/)
})

test("start points Claude at the sdlc skill only in opted-in workspaces", () => {
  const root = repo({})
  assert.match(start({ cwd: root }), /invoke the `sdlc` skill/)
  assert.match(start({ cwd: join(root, "..") }), /sdlc/) // a parent folder of repos
  assert.equal(start({ cwd: mkdtempSync(join(tmpdir(), "sdlc-none-")) }), null)
})
