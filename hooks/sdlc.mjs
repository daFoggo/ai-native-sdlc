#!/usr/bin/env node
// sdlc-core hooks. One script, one mode per hook event:
//   start   SessionStart one line telling Claude this repo follows the sdlc skill (skills trigger unreliably alone)
//   guard   PreToolUse   deny edits to protected paths, test edits in fix mode, banned shell commands
//   check   PostToolUse  run the project's fast check on the edited file; silent when it passes
//   verify  Stop         run the project's verify command when the tree changed since the last green run
//   fix on|off           mark the repo as fixing a bug: tests become read-only until `fix off`
// A repo opts in with .claude/sdlc.json (machine-only overrides in .claude/sdlc.local.json).
// Without one every mode exits 0 and prints nothing, so the plugin is safe to install everywhere.

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const MAX_BLOCKS = 3 // Stop blocks per session and repo before verify only warns: the review-loop cap.

export function findRoot(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".claude", "sdlc.json"))) return dir
    if (dirname(dir) === dir) return null
  }
}

export function loadConfig(root) {
  const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {})
  return { ...read(join(root, ".claude", "sdlc.json")), ...read(join(root, ".claude", "sdlc.local.json")) }
}

const matches = (rel, globs) => [globs].flat().some((g) => matchesGlob(rel, g))

function env(config) {
  const extra = (config.pathPrepend ?? []).map((p) => p.replace(/^~(?=\/|$)/, homedir()))
  return { ...process.env, PATH: [...extra, process.env.PATH].join(":") }
}

function run(cmd, cwd, config, timeoutSec = 120) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, env: env(config), encoding: "utf8", timeout: timeoutSec * 1000 })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim()
  return { ok: r.status === 0, out: r.error ? `${out}\n${r.error.message}` : out }
}

const tail = (text, n = 30) => text.split("\n").slice(-n).join("\n")
const quote = (s) => `'${s.replaceAll("'", `'\\''`)}'`

function gitDir(root) {
  try {
    return resolve(root, execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" }).trim())
  } catch {
    return null
  }
}
const fixFlag = (root) => join(gitDir(root) ?? join(root, ".claude"), "sdlc-fix-mode")

// ---- guard ----------------------------------------------------------------------------------

export function guard(input) {
  const { tool_name: tool, tool_input: ti = {}, cwd = process.cwd() } = input
  if (tool === "Bash") {
    // From a multi-repo parent folder the command may `cd` into any child repo: apply all of theirs.
    const roots = findRoot(cwd) ? [findRoot(cwd)] : verifyRoots(cwd)
    const bans = roots.flatMap((r) => loadConfig(r).denyBash ?? [])
    const ban = bans.find((b) => new RegExp(b.pattern).test(ti.command ?? ""))
    return ban ? `Blocked by .claude/sdlc.json: ${ban.reason}` : null
  }
  const file = ti.file_path ?? ti.notebook_path
  if (!file) return null
  const abs = isAbsolute(file) ? file : resolve(cwd, file)
  const root = findRoot(dirname(abs))
  if (!root) return null
  const config = loadConfig(root)
  const rel = relative(root, abs)
  const p = (config.protect ?? []).find((x) => matches(rel, x.glob))
  if (p) return `${rel} is protected: ${p.reason}`
  if (existsSync(fixFlag(root)) && matches(rel, config.tests ?? []))
    return `Fix mode: ${rel} is a test. Fix the code, not the test. If the test itself is wrong, say so and ask; the user ends fix mode with \`sdlc fix off\`.`
  return null
}

// ---- check ----------------------------------------------------------------------------------

export function check(input) {
  const ti = input.tool_input ?? {}
  const file = ti.file_path ?? ti.notebook_path
  if (!file || !existsSync(file)) return null
  const root = findRoot(dirname(resolve(input.cwd ?? process.cwd(), file)))
  if (!root) return null
  const config = loadConfig(root)
  const abs = resolve(input.cwd ?? process.cwd(), file)
  const rel = relative(root, abs)
  const failures = []
  for (const c of config.check ?? []) {
    if (!matches(rel, c.glob)) continue
    const cwd = join(root, c.cwd ?? ".")
    const r = run(c.run.replaceAll("{file}", quote(relative(cwd, abs))), cwd, config, c.timeout ?? 60)
    if (!r.ok) failures.push(`$ ${c.run} (in ${c.cwd ?? "."})\n${tail(r.out)}`)
  }
  return failures.length ? `Project check failed on ${rel}. Fix it before moving on:\n${failures.join("\n\n")}` : null
}

// ---- verify ---------------------------------------------------------------------------------

function fingerprint(root) {
  const git = (...a) =>
    execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] })
  const status = git("status", "--porcelain=v1", "-uall")
  if (!status.trim()) return null // clean tree: nothing of ours to verify
  const h = createHash("sha1").update(status).update(git("diff")).update(git("diff", "--cached")) // works before the first commit too
  // Untracked files are only names in `git status`; hash their content too.
  for (const line of status.split("\n").filter((l) => l.startsWith("?? "))) {
    try {
      h.update(readFileSync(join(root, line.slice(3))))
    } catch {} // a directory or a file removed meanwhile: its name is already hashed
  }
  return h.digest("hex")
}

export function verifyRoots(base) {
  const dirs = [base]
  try {
    for (const d of readdirSync(base, { withFileTypes: true }))
      if (d.isDirectory() && !d.name.startsWith(".")) dirs.push(join(base, d.name))
  } catch {}
  return dirs.filter((d) => existsSync(join(d, ".claude", "sdlc.json")))
}

export function verify(input, stateFile) {
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {}
  const base = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
  const block = []
  const warn = []
  for (const root of verifyRoots(base)) {
    const config = loadConfig(root)
    if (!config.verify) continue
    let fp
    try {
      fp = fingerprint(root)
    } catch {
      continue // not a git repo
    }
    const s = (state[root] ??= { blocks: 0 })
    if (!fp || fp === s.green || fp === s.failed) continue
    const r = run(config.verify, root, config, config.verifyTimeout ?? 540)
    if (r.ok) Object.assign(s, { green: fp, failed: null, blocks: 0 })
    else {
      Object.assign(s, { failed: fp, blocks: s.blocks + 1 })
      const msg = `verify failed in ${root}: \`${config.verify}\`\n${tail(r.out, 40)}`
      ;(s.blocks <= MAX_BLOCKS ? block : warn).push(msg)
    }
  }
  writeFileSync(stateFile, JSON.stringify(state))
  return { block, warn }
}

// ---- start ---------------------------------------------------------------------------------

export function start(input) {
  const base = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()
  const roots = findRoot(base) ? [findRoot(base)] : verifyRoots(base)
  if (!roots.length) return null
  const where = roots.map((r) => relative(base, r) || ".").join(", ")
  return `This workspace follows the sdlc process (.claude/sdlc.json in: ${where}). Before any code change, review or plan there, invoke the \`sdlc\` skill and state the lane (S, M or L) with its reason.`
}

// ---- main -----------------------------------------------------------------------------------

function main() {
  const [mode, arg] = process.argv.slice(2)
  if (mode === "fix") {
    const root = findRoot(process.cwd())
    if (!root) return console.log("No .claude/sdlc.json above this folder.")
    const flag = fixFlag(root)
    if (arg === "on") writeFileSync(flag, new Date().toISOString())
    else rmSync(flag, { force: true })
    return console.log(`fix mode ${arg === "on" ? "on: tests are read-only" : "off"} in ${root}`)
  }
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}")
  } catch {}
  if (mode === "start") {
    const msg = start(input)
    if (msg) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: msg } }))
  } else if (mode === "guard") {
    const reason = guard(input)
    if (reason)
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }))
  } else if (mode === "check") {
    const msg = check(input)
    if (msg) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } }))
  } else if (mode === "verify") {
    const { block, warn } = verify(input, join(tmpdir(), `sdlc-${input.session_id ?? "nosession"}.json`))
    if (block.length) {
      process.stderr.write(`Not done yet: the project's verify command fails. Fix it, then finish.\n\n${block.join("\n\n")}\n`)
      process.exit(2)
    }
    if (warn.length)
      console.log(JSON.stringify({ systemMessage: `sdlc: verify still fails after ${MAX_BLOCKS} tries; stopping anyway.\n${warn.join("\n\n")}` }))
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    // A broken hook must never wedge the session; say why and let the tool run.
    process.stderr.write(`sdlc hook error: ${e.message}\n`)
  }
}
