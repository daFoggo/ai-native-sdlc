import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

import { HOSTS, check, findSecret, guard, hostOf, markTouched, normalize, start, verify } from "./sdlc.mjs"

const SCRIPT = fileURLToPath(new URL("./sdlc.mjs", import.meta.url))

// Every repo of this run lives under one folder, removed at the end, so parent-folder tests see only their own.
const BASE = mkdtempSync(join(tmpdir(), "sdlc-suite-"))
after(() => rmSync(BASE, { recursive: true, force: true }))

function repo(config, dir = ".claude", parent = BASE) {
  const root = mkdtempSync(join(parent, "repo-"))
  mkdirSync(join(root, dir))
  writeFileSync(join(root, dir, "sdlc.json"), JSON.stringify(config))
  execFileSync("git", ["init", "-q"], { cwd: root })
  return root
}

const edit = (root, rel, extra = {}) => ({ tool_name: "Edit", tool_input: { file_path: join(root, rel), ...extra }, cwd: root })
const reason = (g) => g?.reason ?? null
const fixture = (name, cwd, host = "codex") =>
  JSON.parse(readFileSync(new URL(`./fixtures/${host}/${name}`, import.meta.url), "utf8").replaceAll("__CWD__", JSON.stringify(cwd).slice(1, -1))) // escaped: a Windows path has "\"

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
  const root = repo({}, ".claude", mkdtempSync(join(BASE, "parent-")))
  writeFileSync(join(root, ".claude", "sdlc.json"), JSON.stringify({ denyBash: [{ pattern: "shadcn(@\\S+)? add https://hairlineui", reason: "use pnpm hairline" }] }))
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

test("start names where artifacts and debt go, from sdlc.json or the defaults", () => {
  assert.match(start({ cwd: repo({}) }), /artifacts in docs\/work\/<date>-<slug>\/, debt in docs\/debt\.md/)
  const own = start({ cwd: repo({ artifacts: "plans", debt: "TODO.md" }) })
  assert.match(own, /artifacts in plans\/<date>-<slug>\/, debt in TODO\.md/)
  // A parent of several repos: each gets its own paths, and one broken sdlc.json does not silence the rest.
  const parent = mkdtempSync(join(tmpdir(), "sdlc-multi-"))
  repo({ artifacts: "plans" }, ".claude", parent)
  writeFileSync(join(repo({}, ".claude", parent), ".claude", "sdlc.json"), "{bad")
  const m = start({ cwd: parent })
  assert.match(m, /invoke the `sdlc` skill/)
  assert.match(m, /artifacts in plans\//)
  assert.match(m, /sdlc\.json unreadable/)
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

test("a subagent or MCP tool that writes files gets the same check as the shell", () => {
  const root = repo({ check: [{ glob: "**/*.ts", run: "! grep -q bad {file}" }] })
  const run = (call, mode) => spawnSync("node", [SCRIPT, mode], { input: JSON.stringify(call), encoding: "utf8" }).stdout
  const agent = { session_id: `s${process.pid}${Date.now()}`, tool_use_id: "a1", tool_name: "Agent", tool_input: { prompt: "write a.ts" }, cwd: root }
  run(agent, "guard")
  writeFileSync(join(root, "a.ts"), "bad") // what the subagent wrote
  assert.match(JSON.parse(run(agent, "bash")).hookSpecificOutput.additionalContext, /check failed on a\.ts/)
  const mcp = { ...agent, tool_use_id: "m1", tool_name: "mcp__fs__write_file", tool_input: { path: join(root, "b.ts"), content: "bad" } }
  run(mcp, "guard")
  writeFileSync(join(root, "b.ts"), "bad")
  assert.match(run(mcp, "bash"), /check failed on b\.ts/)
})

// ---- R1 review findings (each test failed before its fix) ----------------------------------

const gitc = (root, ...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root })
const stateFile = () => join(mkdtempSync(join(tmpdir(), "sdlc-state-")), "s.json")

test("R1-2a: committing the change does not dodge verify (base recorded at session start)", () => {
  const root = repo({ verify: "test ! -f broken" })
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "init")
  const state = stateFile()
  start({ cwd: root }, state)
  writeFileSync(join(root, "broken"), "1")
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "break it") // clean tree, new HEAD
  markTouched("nosession", root) // what the bash hook does after a commit made through the shell
  assert.equal(verify({ cwd: root }, state).block.length, 1)
})

test("R1-2b: a session started in a subfolder still verifies its repo", () => {
  const root = repo({ verify: "test ! -f broken" })
  mkdirSync(join(root, "apps", "web"), { recursive: true })
  writeFileSync(join(root, "broken"), "1")
  assert.equal(verify({ cwd: join(root, "apps", "web") }, stateFile()).block.length, 1)
})

test("R1-2c: stopping again on the same failing tree warns instead of passing silently", () => {
  const root = repo({ verify: "test ! -f broken" })
  writeFileSync(join(root, "broken"), "1")
  const state = stateFile()
  assert.equal(verify({ cwd: root }, state).block.length, 1)
  const again = verify({ cwd: root }, state)
  assert.equal(again.block.length, 0)
  assert.match(again.warn.join(), /still fails/)
})

test("R1-7: a turn that only changed docs or artifacts skips the full verify", () => {
  const root = repo({ verify: "exit 1", artifacts: "docs/work" })
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "init")
  mkdirSync(join(root, "docs", "work", "x"), { recursive: true })
  writeFileSync(join(root, "docs/work/x/intent.md"), "i")
  writeFileSync(join(root, "README.md"), "r")
  assert.deepEqual(verify({ cwd: root }, stateFile()), { block: [], warn: [] })
  writeFileSync(join(root, "a.ts"), "1")
  assert.equal(verify({ cwd: root }, stateFile()).block.length, 1)
})

test("R1-3: a protected file changed through the shell is reported", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }] })
  mkdirSync(join(root, "vendor"))
  const call = { session_id: `p${process.pid}${Date.now()}`, tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "sed -i s/a/b/ vendor/x.ts" }, cwd: root }
  const run = (mode) => spawnSync("node", [SCRIPT, mode], { input: JSON.stringify(call), encoding: "utf8" }).stdout
  run("guard")
  writeFileSync(join(root, "vendor/x.ts"), "b")
  assert.match(run("bash"), /vendor\/x\.ts is protected: vendored/)
})

test("R1-4: a broken config never wedges Antigravity and is visible on Claude", () => {
  const root = repo({ protect: [{ glob: "v/**", reason: "vendored" }] })
  writeFileSync(join(root, ".claude", "sdlc.local.json"), "{ broken,")
  const call = (host, payload) => spawnSync("node", [SCRIPT, "guard", ...(host ? [host] : [])], { input: JSON.stringify(payload), encoding: "utf8" })
  const ag = call("antigravity", { conversationId: "e", workspacePaths: [root], toolCall: { name: "write_file", args: { Path: join(root, "a.ts"), Content: "x" } } })
  assert.equal(JSON.parse(ag.stdout).decision, "ask")
  const cl = call(null, edit(root, "v/a.ts"))
  assert.match(JSON.parse(cl.stdout).systemMessage, /sdlc hook error/)
})

test("R1-6: a Codex patch that removes a leaked secret is allowed", () => {
  const root = repo({})
  const key = "AKIA" + "ABCDEFGHIJKLMNOP"
  const patch = `*** Begin Patch\n*** Update File: a.ts\n@@\n-const k = "${key}"\n+const k = process.env.K\n*** End Patch`
  assert.equal(guard({ tool_name: "apply_patch", tool_input: { command: patch }, cwd: root, turn_id: "t" }), null)
  const add = patch.replace(`-const k = "${key}"\n+const k = process.env.K`, `+const k = "${key}"`)
  assert.match(reason(guard({ tool_name: "apply_patch", tool_input: { command: add }, cwd: root, turn_id: "t" })), /AWS access key/)
})

// ---- R2 review findings ---------------------------------------------------------------------

test("R2-2c: on Antigravity a repeated failing stop continues once with the reason, then lets go", () => {
  const root = repo({ verify: "test ! -f broken" })
  writeFileSync(join(root, "broken"), "1")
  const stop = { conversationId: `r2c${process.pid}${Date.now()}`, workspacePaths: [root], terminationReason: "NO_TOOL_CALL" }
  const run = () => JSON.parse(spawnSync("node", [SCRIPT, "verify", "antigravity"], { input: JSON.stringify(stop), encoding: "utf8" }).stdout)
  assert.equal(run().decision, "continue") // first failure: block
  const again = run()
  assert.equal(again.decision, "continue") // same tree: said once more, not silently passed
  assert.match(again.reason, /still fails/)
  assert.deepEqual(run(), {}) // and only once
})

test("R2-3: shell deletes, same-command commits and big commands still report protected files", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }] })
  mkdirSync(join(root, "vendor"))
  writeFileSync(join(root, "vendor/x.ts"), "a")
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "init")
  let n = 0
  const shell = (cmd) => {
    const call = { session_id: `r23${process.pid}${Date.now()}`, tool_use_id: `b${n++}`, tool_name: "Bash", tool_input: { command: cmd }, cwd: root }
    const run = (mode) => spawnSync("node", [SCRIPT, mode], { input: JSON.stringify(call), encoding: "utf8" }).stdout
    run("guard")
    execFileSync("bash", ["-c", cmd], { cwd: root })
    return run("bash")
  }
  assert.match(shell("rm vendor/x.ts"), /vendor\/x\.ts is protected/)
  gitc(root, "checkout", "-q", "--", "vendor/x.ts")
  assert.match(shell("echo b > vendor/x.ts && git -c user.email=e@x -c user.name=e commit -qam p"), /vendor\/x\.ts is protected/)
  assert.match(shell("for i in $(seq 30); do echo $i > f$i.txt; done; echo c > vendor/x.ts"), /vendor\/x\.ts is protected/)
})

// ---- R3 review leftovers --------------------------------------------------------------------

test("R3-1: moving a protected file away with git mv is reported", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }] })
  mkdirSync(join(root, "vendor"))
  writeFileSync(join(root, "vendor/x.ts"), "a")
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "init")
  const call = { session_id: `r31${process.pid}${Date.now()}`, tool_use_id: "m1", tool_name: "Bash", tool_input: { command: "git mv vendor/x.ts x.ts" }, cwd: root }
  const run = (mode) => spawnSync("node", [SCRIPT, mode], { input: JSON.stringify(call), encoding: "utf8" }).stdout
  run("guard")
  gitc(root, "mv", "vendor/x.ts", "x.ts")
  assert.match(run("bash"), /vendor\/x\.ts is protected/)
  // and committed in the same command
  gitc(root, "reset", "-q", "--hard")
  call.tool_use_id = "m2"
  run("guard")
  gitc(root, "mv", "vendor/x.ts", "x.ts"); gitc(root, "commit", "-qm", "mv")
  assert.match(run("bash"), /vendor\/x\.ts is protected/)
})

test("R3-2: commits brought in by merge, pull or checkout are not blamed on the command", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored" }] })
  mkdirSync(join(root, "vendor"))
  writeFileSync(join(root, "vendor/x.ts"), "a")
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "init")
  const main = gitc(root, "rev-parse", "--abbrev-ref", "HEAD").toString().trim()
  // someone else's work, written earlier, on another branch
  const old = { ...process.env, GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" }
  const gitOld = (...a) => execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", ...a], { cwd: root, env: old })
  gitOld("checkout", "-qb", "up")
  writeFileSync(join(root, "vendor/x.ts"), "upstream")
  gitOld("commit", "-qam", "vendor bump")
  gitc(root, "checkout", "-q", main)
  writeFileSync(join(root, "a.ts"), "1")
  gitc(root, "add", "-A"); gitc(root, "commit", "-qm", "local")
  let n = 0
  const shell = (cmd) => {
    const call = { session_id: `r32${process.pid}${Date.now()}`, tool_use_id: `c${n++}`, tool_name: "Bash", tool_input: { command: cmd }, cwd: root }
    const run = (mode) => spawnSync("node", [SCRIPT, mode], { input: JSON.stringify(call), encoding: "utf8" }).stdout
    run("guard")
    execFileSync("bash", ["-c", cmd], { cwd: root })
    return run("bash")
  }
  const git = "git -c user.email=e@x -c user.name=e"
  assert.doesNotMatch(shell(`${git} checkout -q up`), /protected/) // switch branch
  assert.doesNotMatch(shell(`${git} checkout -q ${main}`), /protected/)
  assert.doesNotMatch(shell(`${git} merge -q --no-edit up`), /protected/) // merge commit made now
  assert.match(shell(`echo mine > vendor/x.ts && ${git} commit -qam own`), /vendor\/x\.ts is protected/) // own commit still caught
})

test("subagent-driven-development is refused unless sdlc.json names it as build", () => {
  const skill = (cwd) => guard({ tool_name: "Skill", tool_input: { skill: "superpowers:subagent-driven-development" }, cwd })
  assert.equal(skill(repo({})).decision, "deny")
  assert.equal(skill(repo({ providers: { build: "superpowers:subagent-driven-development" } })), null)
  assert.equal(guard({ tool_name: "Skill", tool_input: { skill: "superpowers:writing-plans" }, cwd: repo({}) }), null)
  assert.equal(skill(mkdtempSync(join(tmpdir(), "sdlc-none-"))), null) // no sdlc.json: not ours to judge
})

test("a subagent's model comes from sdlc.json, and the reviewer never runs on haiku", () => {
  const agent = (cwd, ti) => guard({ tool_name: "Agent", tool_input: { prompt: "p", description: "d", ...ti }, cwd })
  const root = repo({ models: { implementer: "sonnet" } })
  const g = agent(root, { subagent_type: "implementer", model: "opus" })
  assert.equal(g.decision, "allow")
  assert.deepEqual(g.updatedInput, { prompt: "p", description: "d", subagent_type: "implementer", model: "sonnet" })
  assert.equal(agent(root, { subagent_type: "implementer", model: "sonnet" }), null) // already right
  assert.equal(agent(root, { subagent_type: "scout" }), null) // not in the map
  assert.equal(agent(root, { subagent_type: "sdlc:reviewer", model: "haiku" }).updatedInput.model, "sonnet")
  assert.equal(agent(root, { subagent_type: "sdlc:reviewer", model: "opus" }), null)
  assert.equal(agent(repo({ models: { implementer: "opus-4.5" } }), { subagent_type: "implementer" }), null) // not an alias: left alone
  const out = spawnSync("node", [SCRIPT, "guard"], {
    input: JSON.stringify({ tool_name: "Agent", tool_input: { prompt: "p", subagent_type: "implementer" }, cwd: root }),
    encoding: "utf8",
  })
  const h = JSON.parse(out.stdout).hookSpecificOutput
  assert.equal(h.permissionDecision, "allow")
  assert.deepEqual(h.updatedInput, { prompt: "p", subagent_type: "implementer", model: "sonnet" })
})

test("verify runs only in repos this session changed, once start has tracked them", () => {
  const parent = mkdtempSync(join(BASE, "parent-"))
  const mine = repo({ verify: "exit 1" }, ".claude", parent)
  const other = repo({ verify: "exit 1" }, ".claude", parent)
  const session = `v${process.pid}${Date.now()}`
  const state = stateFile()
  start({ cwd: parent, session_id: session }, state)
  writeFileSync(join(other, "x.ts"), "1") // another agent's edit
  writeFileSync(join(mine, "a.ts"), "1")
  assert.equal(verify({ cwd: parent, session_id: session }, state).block.length, 0) // nothing this session did
  check({ tool_name: "Write", tool_input: { file_path: join(mine, "a.ts") }, cwd: mine, session_id: session })
  const r = verify({ cwd: parent, session_id: session }, state)
  assert.equal(r.block.length, 1)
  assert.match(r.block[0], new RegExp(basename(mine)))
  assert.equal(verify({ cwd: parent, session_id: session }, state).block.length, 0) // mark used up
})

test("a verify that runs out of time warns instead of blocking the turn", () => {
  const root = repo({ verify: "sleep 30", verifyTimeout: 1 })
  writeFileSync(join(root, "a.ts"), "1")
  const r = verify({ cwd: root }, stateFile())
  assert.equal(r.block.length, 0)
  assert.match(r.warn.join(), /did not finish/)
})

test("shell rules follow cd into another repo", () => {
  const parent = mkdtempSync(join(BASE, "parent-"))
  const here = repo({}, ".claude", parent)
  const there = repo({ denyBash: [{ pattern: "npm install", reason: "pnpm only" }] }, ".claude", parent)
  const name = basename(there)
  const bash = (command) => reason(guard({ tool_name: "Bash", tool_input: { command }, cwd: here }))
  assert.match(bash(`cd ../${name} && npm install`), /pnpm only/)
  assert.match(bash(`git -C "../${name}" status; npm install`), /pnpm only/)
  assert.equal(bash("npm install"), null) // this repo allows it
})

test("sdlc.local.json adds to the team's lists and overrides other values", () => {
  const root = repo({ denyBash: [{ pattern: "npm install", reason: "pnpm only" }], verify: "a" })
  writeFileSync(join(root, ".claude", "sdlc.local.json"), JSON.stringify({ denyBash: [{ pattern: "yarn", reason: "no yarn" }], verify: "b" }))
  const bash = (command) => reason(guard({ tool_name: "Bash", tool_input: { command }, cwd: root }))
  assert.match(bash("npm install"), /pnpm only/)
  assert.match(bash("yarn add x"), /no yarn/)
})

test("protect: an unchanged rewrite and the sanctioned command are not reported; a real change is", () => {
  const root = repo({ protect: [{ glob: "vendor/**", reason: "vendored", via: "pnpm hairline" }] })
  mkdirSync(join(root, "vendor"))
  writeFileSync(join(root, "vendor/x.ts"), "mine") // already dirty before the command
  const run = (command, write) => {
    const call = { session_id: `h${process.pid}${Date.now()}`, tool_use_id: `b${Math.random()}`, tool_name: "Bash", tool_input: { command }, cwd: root }
    const hook = (mode) => spawnSync("node", [SCRIPT, mode], { input: JSON.stringify(call), encoding: "utf8" }).stdout
    hook("guard")
    write()
    return hook("bash")
  }
  assert.doesNotMatch(run("node patch.mjs --check", () => writeFileSync(join(root, "vendor/x.ts"), "mine")), /protected/)
  assert.doesNotMatch(run("pnpm hairline", () => writeFileSync(join(root, "vendor/x.ts"), "upstream")), /protected/)
  assert.match(run("sed -i s/a/b/ vendor/x.ts", () => writeFileSync(join(root, "vendor/x.ts"), "edited")), /vendor\/x\.ts is protected/)
})

// ---- skill routing ----------------------------------------------------------------------------

let skillSession = 0
const routed = (extra = {}) => {
  const root = repo({ skills: [{ glob: "app/**/*.tsx", skill: "vercel-react-best-practices" }, { glob: "app/db/**", skill: "bar" }], ...extra })
  const session = `skills-${process.pid}-${Date.now()}-${skillSession++}`
  const call = (tool, ti, agent) => guard({ tool_name: tool, tool_input: ti, cwd: root, session_id: session, ...(agent && { agent_id: agent }) })
  return {
    root,
    edit: (rel, agent) => call("Edit", { file_path: join(root, rel), old_string: "a", new_string: "b" }, agent),
    write: (rel) => call("Write", { file_path: join(root, rel), content: "x" }),
    skill: (name, agent) => call("Skill", { skill: name }, agent),
  }
}

test("skill routing: the first edit of a mapped file is refused once, naming the skill; the next passes", () => {
  const r = routed()
  const g = r.edit("app/page.tsx")
  assert.equal(g?.decision, "deny")
  assert.match(g.reason, /`vercel-react-best-practices`/)
  assert.match(g.reason, /app\/page\.tsx/)
  assert.equal(r.edit("app/page.tsx"), null)
  assert.equal(r.edit("app/other.tsx"), null) // asked once per skill, not per file
  assert.equal(r.edit("lib/a.ts"), null) // unmapped
})

test("skill routing: a Skill call, plain or plugin-qualified, satisfies it; a near name does not", () => {
  const r = routed()
  assert.equal(r.skill("xbar"), null)
  assert.match(reason(r.edit("app/db/schema.sql")), /`bar`/)
  const q = routed()
  q.skill("vercel:vercel-react-best-practices")
  assert.equal(q.edit("app/page.tsx"), null)
})

test("skill routing: a subagent is asked on its own", () => {
  const r = routed()
  r.skill("vercel-react-best-practices")
  assert.equal(r.edit("app/page.tsx"), null)
  assert.equal(r.edit("app/page.tsx", "a1")?.decision, "deny")
  r.skill("vercel-react-best-practices", "a2")
  assert.equal(r.edit("app/page.tsx", "a2"), null)
})

test("skill routing: only missing skills are named, protect wins, a new file is routed, no key changes nothing", () => {
  const r = routed()
  r.skill("bar")
  const g = reason(r.edit("app/db/x.tsx")) // matches both globs; bar is loaded
  assert.match(g, /vercel-react-best-practices/)
  assert.doesNotMatch(g, /`bar`/)
  const p = routed({ protect: [{ glob: "app/vendor/**", reason: "vendored" }] })
  assert.match(reason(p.edit("app/vendor/a.tsx")), /protected: vendored/)
  assert.equal(routed().write("app/new.tsx")?.decision, "deny")
  const none = repo({})
  assert.equal(guard({ tool_name: "Edit", tool_input: { file_path: join(none, "app/page.tsx") }, cwd: none, session_id: "skills-none" }), null)
})

test("R1-1: a plugin-qualified name in sdlc.json is satisfied by the same Skill call", () => {
  const r = routed({ skills: [{ glob: "app/**", skill: "vercel:react-best-practices" }] })
  r.skill("vercel:react-best-practices")
  assert.equal(r.edit("app/page.tsx"), null)
})

test("R1-2: a repo without sdlc.json gets no seen file from Skill or MCP calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-none-"))
  const session = `skills-none-${process.pid}-${Date.now()}`
  guard({ tool_name: "Skill", tool_input: { skill: "bar" }, cwd: dir, session_id: session })
  guard({ tool_name: "mcp__x__y", tool_input: {}, cwd: dir, session_id: session })
  assert.equal(existsSync(join(tmpdir(), `sdlc-seen-${session}.json`)), false)
})
