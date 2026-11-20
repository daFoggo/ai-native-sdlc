import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { HOSTS, check, findSecret, guard, hostOf, normalize, start, verify } from "./sdlc.mjs"

const SCRIPT = fileURLToPath(new URL("./sdlc.mjs", import.meta.url))

function repo(config, dir = ".claude") {
  const root = mkdtempSync(join(tmpdir(), "sdlc-test-"))
  mkdirSync(join(root, dir))
  writeFileSync(join(root, dir, "sdlc.json"), JSON.stringify(config))
  execFileSync("git", ["init", "-q"], { cwd: root })
  return root
}

const edit = (root, rel, extra = {}) => ({ tool_name: "Edit", tool_input: { file_path: join(root, rel), ...extra }, cwd: root })
const reason = (g) => g?.reason ?? null
const fixture = (name, cwd, host = "codex") =>
  JSON.parse(readFileSync(new URL(`./fixtures/${host}/${name}`, import.meta.url), "utf8").replaceAll("__CWD__", cwd))

test("guard denies protected paths and allows the rest", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }] })
  assert.match(reason(guard(edit(root, "vendor/a.ts"))), /protected: vendored/)
  assert.equal(guard(edit(root, "src/a.ts")), null)
})

test("guard does nothing outside an opted-in repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-none-"))
  assert.equal(guard(edit(dir, "a.ts")), null)
  assert.equal(guard({ tool_name: "Bash", tool_input: { command: "rm -rf x" }, cwd: dir }), null)
})

test("guard bans shell commands, also from a parent folder of several repos", () => {
  const root = repo({ denyBash: [{ pattern: "shadcn(@\\S+)? add https://hairlineui", reason: "use pnpm hairline" }] })
  const bash = (cwd) => reason(guard({ tool_name: "Bash", tool_input: { command: "cd x && pnpm dlx shadcn@latest add https://hairlineui.com/r/a" }, cwd }))
  assert.match(bash(root), /use pnpm hairline/)
  assert.match(bash(join(root, "..")), /use pnpm hairline/)
  assert.equal(guard({ tool_name: "Bash", tool_input: { command: "pnpm check" }, cwd: root }), null)
})

test("fix mode makes tests read-only until it is switched off", () => {
  const root = repo({ tests: ["**/*.test.ts"] })
  const fix = (arg) => execFileSync("node", [SCRIPT, "fix", arg], { cwd: root, encoding: "utf8" })
  assert.equal(guard(edit(root, "src/a.test.ts")), null)
  fix("on")
  assert.match(reason(guard(edit(root, "src/a.test.ts"))), /Fix mode/)
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

test("bash: files a shell command changed get the same check, and fix mode reports changed tests", () => {
  const root = repo({ check: [{ glob: "**/*.ts", run: "! grep -q bad {file}" }], tests: ["**/*.test.ts"] })
  writeFileSync(join(root, "old.ts"), "bad") // dirty before the command: not ours to report
  const hook = (mode, cmd) =>
    spawnSync("node", [SCRIPT, mode], {
      input: JSON.stringify({ session_id: `b${process.pid}`, tool_use_id: "t1", tool_name: "Bash", tool_input: { command: cmd }, cwd: root }),
      encoding: "utf8",
    }).stdout
  const runBash = (cmd) => {
    hook("guard", cmd)
    execFileSync("bash", ["-c", cmd], { cwd: root })
    return hook("bash", cmd)
  }
  // Touch old.ts back in time so only the command's own writes count.
  execFileSync("touch", ["-d", "2020-01-01", join(root, "old.ts")])
  assert.equal(runBash("echo good > a.ts"), "")
  const out = JSON.parse(runBash("echo bad > 'b c.ts'")).hookSpecificOutput.additionalContext
  assert.match(out, /check failed on b c\.ts/)
  assert.doesNotMatch(out, /old\.ts/)
  execFileSync("node", [SCRIPT, "fix", "on"], { cwd: root })
  assert.match(runBash("echo ok > x.test.ts"), /Fix mode: this command changed tests \(x\.test\.ts\)/)
  assert.equal(hook("bash", "true"), "") // no mark: nothing to do
})

test("config and rule cards may live in .agents/ instead of .claude/", () => {
  const root = repo({ protect: [{ glob: "gen/**", reason: "generated" }] }, ".agents")
  assert.match(reason(guard(edit(root, "gen/a.ts"))), /generated/)
  assert.match(start({ cwd: root }), /sdlc/)
})

test("Codex apply_patch: guard reads the paths inside the patch, check runs on them (real payloads)", () => {
  const root = repo({ protect: [{ glob: "src/**", reason: "frozen" }], check: [{ glob: "**/*.ts", run: "! grep -q 2 {file}" }] })
  const pre = fixture("pre-apply-patch.json", root)
  assert.deepEqual(normalize(pre).files, [join(root, "src/a.ts")])
  assert.equal(hostOf(pre), "codex")
  assert.match(reason(guard(pre)), /src\/a\.ts is protected: frozen/)
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "src/a.ts"), "export const a = 2\n")
  assert.match(check(fixture("post-apply-patch.json", root)), /check failed on src\/a\.ts/)
  assert.equal(normalize(fixture("pre-bash.json", root)).command, "cat src/a.ts")
  assert.equal(hostOf(edit(root, "x.ts")), "claude")
  assert.deepEqual(normalize({ tool_name: "read_file", tool_input: { file_path: join(root, "src/a.ts") }, cwd: root }).files, [])
})

test("secrets: an edit that writes a key into a tracked file is denied; a gitignored file is fine", () => {
  const root = repo({})
  const key = "AKIA" + "ABCDEFGHIJKLMNOP"
  assert.equal(findSecret(`const k = "${key}"`), "an AWS access key")
  assert.equal(findSecret("const k = process.env.KEY"), null)
  assert.match(reason(guard(edit(root, "src/a.ts", { new_string: `k = "${key}"` }))), /AWS access key into src\/a\.ts/)
  const multi = { tool_name: "MultiEdit", tool_input: { file_path: join(root, "a.ts"), edits: [{ old_string: "x", new_string: `k="${key}"` }] }, cwd: root }
  assert.match(reason(guard(multi)), /AWS access key/)
  assert.equal(guard(edit(root, "src/a.ts", { old_string: `k = "${key}"`, new_string: "k = process.env.K" })), null) // removing one is fine
  writeFileSync(join(root, ".gitignore"), ".env\n")
  assert.equal(guard({ tool_name: "Write", tool_input: { file_path: join(root, ".env"), content: `K=${key}` }, cwd: root }), null)
})

test("approve gates ask instead of deny; Codex, which cannot ask from a hook, denies with the route", () => {
  const root = repo({ approve: [{ glob: "db/migrations/**", reason: "migrations need a change ticket" }, { pattern: "deploy.*prod", reason: "release manager signs off" }] })
  assert.deepEqual(guard(edit(root, "db/migrations/1.sql")), { decision: "ask", reason: "Needs approval (sdlc.json): migrations need a change ticket" })
  assert.equal(guard({ tool_name: "Bash", tool_input: { command: "make deploy env=prod" }, cwd: root }).decision, "ask")
  const out = HOSTS.codex.guard({ decision: "ask", reason: "x" }).json.hookSpecificOutput
  assert.equal(out.permissionDecision, "deny")
  assert.match(out.permissionDecisionReason, /Ask the user/)
})

test("hosts without path-scoped rules get each matching rule card once per session", () => {
  const root = repo({})
  mkdirSync(join(root, ".claude", "rules"), { recursive: true })
  writeFileSync(join(root, ".claude/rules/ui.md"), "---\npaths: [\"ui/**\"]\n---\nWeights 400 and 500 only.")
  mkdirSync(join(root, "ui"))
  writeFileSync(join(root, "ui/a.tsx"), "x")
  const input = { ...edit(root, "ui/a.tsx"), session_id: `r${process.pid}${Date.now()}` }
  assert.match(check(input, { rules: true }), /Project rules for ui\/a\.tsx:\n---[\s\S]*Weights 400/)
  assert.equal(check(input, { rules: true }), null) // already seen this session
  assert.equal(check({ ...input, session_id: "other" }), null) // Claude loads them natively
})

test("every host adapter answers each mode in its own format", () => {
  assert.deepEqual(HOSTS.gemini.guard({ decision: "deny", reason: "r" }).json, { decision: "deny", reason: "r" })
  assert.equal(HOSTS.gemini.context("m").json.hookSpecificOutput.hookEventName, "AfterTool")
  assert.deepEqual(HOSTS.gemini.block("m").json, { decision: "deny", reason: "m" })
  assert.equal(HOSTS.antigravity.start("m").json.injectSteps[0].systemMessage.systemMessage, "m")
  assert.deepEqual(HOSTS.antigravity.block("m").json, { decision: "continue", reason: "m" })
  assert.equal(HOSTS.claude.block("m").exit, 2)
  for (const h of Object.values(HOSTS)) for (const k of ["start", "guard", "context", "block", "warn"]) assert.equal(typeof h[k], "function")
})

test("hook output for Codex: Stop blocks with exit 2 from the real payload", () => {
  const root = repo({ verify: "exit 1" })
  writeFileSync(join(root, "a.ts"), "")
  const env = { ...process.env }
  delete env.CLAUDE_PROJECT_DIR
  const v = spawnSync("node", [SCRIPT, "verify"], { input: JSON.stringify({ ...fixture("stop.json", root), session_id: `c${process.pid}${Date.now()}` }), encoding: "utf8", env })
  assert.equal(v.status, 2)
  assert.match(v.stderr, /verify failed/)
})

test("Antigravity (real payloads): guard reads toolCall, check failures reach the model through flush", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }], check: [{ glob: "src/**", run: "! grep -q bad {file}" }], verify: "exit 1" })
  const write = fixture("pre-write-file.json", root, "antigravity")
  const e = normalize(write)
  assert.deepEqual(e.files, [join(root, "src/b.ts")])
  assert.equal(e.cwd, root)
  assert.equal(normalize(fixture("pre-run-command.json", root, "antigravity")).command, "cat src/a.ts src/b.ts")
  const moved = { ...write, toolCall: { ...write.toolCall, args: { ...write.toolCall.args, Path: join(root, "vendor/x.ts") } } }
  assert.match(reason(guard(moved)), /protected: vendored/)
  const key = "AKIA" + "ABCDEFGHIJKLMNOP"
  assert.match(reason(guard({ ...write, toolCall: { name: "edit_file", args: { Path: join(root, "src/a.ts"), Target: "x", Replacement: key } } })), /AWS access key/)
  assert.equal(guard({ ...write, toolCall: { name: "edit_file", args: { Path: join(root, "src/a.ts"), Target: key, Replacement: "x" } } }), null)

  const session = `ag${process.pid}${Date.now()}`
  const hook = (mode, payload) => spawnSync("node", [SCRIPT, mode, "antigravity"], { input: JSON.stringify({ ...payload, conversationId: session }), encoding: "utf8", cwd: tmpdir() })
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "src/b.ts"), "bad")
  assert.equal(hook("check", write).stdout.trim(), "{}") // PostToolUse may only answer {}
  const flushed = JSON.parse(hook("flush", {}).stdout)
  assert.match(flushed.injectSteps[0].systemMessage.systemMessage, /check failed on src\/b\.ts/)
  assert.equal(hook("flush", {}).stdout.trim(), "{}") // delivered once
  assert.deepEqual(JSON.parse(hook("guard", write).stdout), { decision: "ask" }) // {} would deny
  const stop = JSON.parse(hook("verify", fixture("stop.json", root, "antigravity")).stdout)
  assert.equal(stop.decision, "continue")
  assert.match(stop.reason, /verify failed/)
})
