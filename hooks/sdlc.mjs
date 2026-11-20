#!/usr/bin/env node
// sdlc hooks. One script, one mode per hook event, for every agent host:
//   start   SessionStart  one line telling the agent this repo follows the sdlc skill (skills trigger unreliably alone)
//   guard   before a tool deny edits to protected paths, secrets in new content, test edits in fix mode, banned
//                         shell commands; ask for approval on gated paths and commands
//   check   after an edit run the project's fast check on the edited files; silent when it passes. Hosts without
//                         path-scoped rules also get the matching rule cards the first time a file needs them
//   bash    after a shell, subagent or MCP tool: the same check on files it changed (guard marks the start),
//                         so writes that bypass the file tools (sed, a subagent, an MCP server) are checked too
//   verify  Stop          run the project's verify command when the tree changed since the last green run
//   fix on|off            mark the repo as fixing a bug: tests become read-only until `fix off`
// Usage: node sdlc.mjs <mode> [host]. Hosts: claude (also Codex, which speaks the same JSON), gemini, antigravity.
// A repo opts in with .agents/sdlc.json or .claude/sdlc.json (machine-only overrides in sdlc.local.json beside it).
// Without one every mode exits 0 and prints nothing, so the plugin is safe to install everywhere.

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, matchesGlob, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { matchingRules } from "../skills/sdlc/scripts/review-package.mjs"

const MAX_BLOCKS = 3 // Stop blocks per session and repo before verify only warns: the review-loop cap.
const CONFIG_DIRS = [".agents", ".claude"]

const configDir = (dir) => CONFIG_DIRS.map((c) => join(dir, c)).find((c) => existsSync(join(c, "sdlc.json")))

export function findRoot(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (configDir(dir)) return dir
    if (dirname(dir) === dir) return null
  }
}

export function loadConfig(root) {
  const dir = configDir(root)
  const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {})
  return { ...read(join(dir, "sdlc.json")), ...read(join(dir, "sdlc.local.json")) }
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
const fixFlag = (root) => join(gitDir(root) ?? configDir(root), "sdlc-fix-mode")

function gitIgnored(root, abs) {
  return spawnSync("git", ["check-ignore", "-q", abs], { cwd: root }).status === 0
}

// ---- input: one shape for every host ----------------------------------------------------------

const SHELL_TOOLS = /^(Bash|run_shell_command|run_command|shell|exec_command)$/i
// File-writing tools: Claude, Codex (apply_patch), Gemini CLI, Antigravity. Reads are never guarded or checked.
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch|write_file|replace|write_to_file|replace_file_content|multi_replace_file_content|edit_file)$/i
const PATH_KEYS = ["file_path", "notebook_path", "path", "Path", "filePath", "absolute_path", "TargetFile", "targetFile"]
const OLD_TEXT = (k) => k.startsWith("old") || k === "Target" // the text an edit replaces, never new content

/** Absolute paths a file tool will write: path fields, plus every file a Codex `apply_patch` touches. */
export function editedFiles(ti, cwd) {
  const files = PATH_KEYS.map((k) => ti[k]).filter((v) => typeof v === "string")
  const patch = [ti.command, ti.patch, ti.input].find((v) => typeof v === "string") ?? ""
  for (const m of patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) files.push(m[1].trim())
  return [...new Set(files.map((f) => resolve(cwd, f)))]
}

export function normalize(input) {
  // Claude/Codex/Gemini: tool_name, tool_input, cwd. Antigravity: toolCall {name, args}, workspacePaths[].
  const ti = input.tool_input ?? input.toolCall?.args ?? {}
  const tool = input.tool_name ?? input.toolCall?.name ?? ""
  const cwd = input.cwd ?? input.workspacePaths?.[0] ?? process.cwd()
  const shell = SHELL_TOOLS.test(tool)
  return {
    tool,
    ti,
    cwd,
    shell,
    command: shell ? String(ti.command ?? ti.CommandLine ?? ti.commandLine ?? "") : "",
    files: EDIT_TOOLS.test(tool) ? editedFiles(ti, cwd) : [],
    session: input.session_id ?? input.sessionId ?? input.conversationId ?? "nosession",
    toolUse: input.tool_use_id ?? input.toolUseId ?? input.toolCallId ?? "x",
  }
}

// ---- secrets ---------------------------------------------------------------------------------

const SECRETS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "a private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}/, "a GitHub token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/, "an API secret key"],
]

/** The kind of the first secret found in text, or null. */
export function findSecret(text) {
  return SECRETS.find(([re]) => re.test(text))?.[1] ?? null
}

// New content a file tool is about to write: its input minus path fields and the text being replaced (old_*),
// nested values included (MultiEdit's edits[]).
const newContent = (ti) =>
  Object.entries(ti)
    .filter(([k]) => !PATH_KEYS.includes(k) && !OLD_TEXT(k))
    .map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v, (k, x) => (OLD_TEXT(k) ? undefined : x))))
    .join("\n")

// ---- guard -----------------------------------------------------------------------------------

/** {decision: "deny" | "ask", reason} or null. */
export function guard(input) {
  const e = normalize(input)
  if (e.shell) {
    // From a multi-repo parent folder the command may `cd` into any child repo: apply all of theirs.
    const roots = findRoot(e.cwd) ? [findRoot(e.cwd)] : verifyRoots(e.cwd)
    const configs = roots.map(loadConfig)
    const hit = (list) => list.find((b) => new RegExp(b.pattern).test(e.command))
    const ban = hit(configs.flatMap((c) => c.denyBash ?? []))
    if (ban) return { decision: "deny", reason: `Blocked by sdlc.json: ${ban.reason}` }
    const gate = hit(configs.flatMap((c) => (c.approve ?? []).filter((a) => a.pattern)))
    if (gate) return { decision: "ask", reason: `Needs approval (sdlc.json): ${gate.reason}` }
    return null
  }
  for (const abs of e.files) {
    const root = findRoot(dirname(abs))
    if (!root) continue
    const config = loadConfig(root)
    const rel = relative(root, abs)
    const p = (config.protect ?? []).find((x) => matches(rel, x.glob))
    if (p) return { decision: "deny", reason: `${rel} is protected: ${p.reason}` }
    if (existsSync(fixFlag(root)) && matches(rel, config.tests ?? []))
      return {
        decision: "deny",
        reason: `Fix mode: ${rel} is a test. Fix the code, not the test. If the test itself is wrong, say so and ask; the user ends fix mode with \`sdlc fix off\`.`,
      }
    const secret = config.secrets !== false && !gitIgnored(root, abs) && findSecret(newContent(e.ti))
    if (secret)
      return {
        decision: "deny",
        reason: `This edit would put ${secret} into ${rel}, a tracked file. Read it from the environment or a gitignored file instead.`,
      }
    const gate = (config.approve ?? []).find((a) => a.glob && matches(rel, a.glob))
    if (gate) return { decision: "ask", reason: `Needs approval (sdlc.json): ${gate.reason}` }
  }
  return null
}

// ---- check -----------------------------------------------------------------------------------

function seenOnce(session, key) {
  const f = join(tmpdir(), `sdlc-seen-${session}.json`)
  const seen = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : []
  if (seen.includes(key)) return true
  writeFileSync(f, JSON.stringify([...seen, key]))
  return false
}

/** Checks one existing file. `rules`: also return the rule cards it needs that this session has not seen. */
export function checkFile(abs, { rules = false, session = "nosession" } = {}) {
  if (!existsSync(abs)) return null
  const root = findRoot(dirname(abs))
  if (!root) return null
  const config = loadConfig(root)
  const rel = relative(root, abs)
  const out = []
  if (rules) {
    const cards = matchingRules(root, [rel]).filter((r) => !seenOnce(session, `${root}:${r.name}`))
    if (cards.length) out.push(`Project rules for ${rel}:\n${cards.map((r) => r.text).join("\n\n")}`)
  }
  const failures = []
  for (const c of config.check ?? []) {
    if (!matches(rel, c.glob)) continue
    const cwd = join(root, c.cwd ?? ".")
    const r = run(c.run.replaceAll("{file}", quote(relative(cwd, abs))), cwd, config, c.timeout ?? 60)
    if (!r.ok) failures.push(`$ ${c.run} (in ${c.cwd ?? "."})\n${tail(r.out)}`)
  }
  const secret = config.secrets !== false && !gitIgnored(root, abs) && findSecret(readFileSync(abs, "utf8"))
  if (secret) failures.push(`${rel} contains ${secret}. Remove it and read it from the environment instead.`)
  if (failures.length) out.push(`Project check failed on ${rel}. Fix it before moving on:\n${failures.join("\n\n")}`)
  return out.length ? out.join("\n\n") : null
}

export function check(input, { rules = false } = {}) {
  const e = normalize(input)
  const msgs = e.files.map((f) => checkFile(f, { rules, session: e.session })).filter(Boolean)
  return msgs.length ? msgs.join("\n\n") : null
}

// ---- bash: files written outside the file tools (shell, subagents, MCP servers) -------------

const MAX_BASH_FILES = 20 // a codegen, install or big subagent task touching more is left to verify
const bashMark = (e) => join(tmpdir(), `sdlc-bash-${e.session}-${e.toolUse}`)

export function markBash(input) {
  const e = normalize(input)
  if (findRoot(e.cwd) || verifyRoots(e.cwd).length) writeFileSync(bashMark(e), String(Date.now()))
}

// Dirty files (tracked or untracked) under root modified at or after `since`.
export function changedSince(root, since) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall"], {
    cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"],
  })
  const entries = out.split("\0")
  const files = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    if (/[RC]/.test(e[0])) i++ // rename/copy: the next entry is the old path
    const abs = join(root, e.slice(3))
    try {
      if (statSync(abs).isFile() && statSync(abs).mtimeMs >= since) files.push(abs)
    } catch {} // deleted
  }
  return files
}

export function bashCheck(input, since, { rules = false } = {}) {
  const e = normalize(input)
  const roots = findRoot(e.cwd) ? [findRoot(e.cwd)] : verifyRoots(e.cwd)
  const msgs = []
  for (const root of roots) {
    let files
    try {
      files = changedSince(root, since)
    } catch {
      continue // not a git repo
    }
    if (!files.length || files.length > MAX_BASH_FILES) continue
    const config = loadConfig(root)
    if (existsSync(fixFlag(root))) {
      const tests = files.map((f) => relative(root, f)).filter((r) => matches(r, config.tests ?? []))
      if (tests.length)
        msgs.push(`Fix mode: this command changed tests (${tests.join(", ")}). Restore them with \`git checkout -- <file>\` and fix the code instead, or ask the user if a test is wrong.`)
    }
    for (const f of files) {
      const m = checkFile(f, { rules, session: e.session })
      if (m) msgs.push(m)
    }
  }
  return msgs.length ? msgs.join("\n\n") : null
}

// ---- verify ----------------------------------------------------------------------------------

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
  return dirs.filter((d) => configDir(d))
}

const projectDir = (input) =>
  process.env.CLAUDE_PROJECT_DIR ?? process.env.GEMINI_PROJECT_DIR ?? normalize(input).cwd

export function verify(input, stateFile) {
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {}
  const block = []
  const warn = []
  for (const root of verifyRoots(projectDir(input))) {
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

// ---- start -----------------------------------------------------------------------------------

export function start(input) {
  const base = projectDir(input)
  const roots = findRoot(base) ? [findRoot(base)] : verifyRoots(base)
  if (!roots.length) return null
  const where = roots.map((r) => relative(base, r) || ".").join(", ")
  return `This workspace follows the sdlc process (sdlc.json in: ${where}). Before any code change, review or plan there, invoke the \`sdlc\` skill and state the lane (S, M or L) with its reason.`
}

// ---- output: one adapter per host -------------------------------------------------------------
// Each returns { json } to print, and optionally { stderr, exit }. null means the host has no way to say it.

const pendingFile = (session) => join(tmpdir(), `sdlc-pending-${session}.txt`)

export const HOSTS = {
  // Claude Code. Codex reads the same JSON (and gets the plugin root as CLAUDE_PLUGIN_ROOT too).
  claude: {
    nativeRules: true,
    start: (m) => ({ json: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: m } } }),
    guard: (g) => ({ json: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: g.decision, permissionDecisionReason: g.reason } } }),
    context: (m) => ({ json: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: m } } }),
    block: (m) => ({ stderr: m, exit: 2 }),
    warn: (m) => ({ json: { systemMessage: m } }),
  },
  // Codex: as Claude, but no path-scoped rules, and no documented "ask" from a hook.
  codex: {
    nativeRules: false,
    start: (m) => HOSTS.claude.start(m),
    guard: (g) => HOSTS.claude.guard({ decision: "deny", reason: g.decision === "ask" ? `${g.reason}. Ask the user, and retry only after they approve.` : g.reason }),
    context: (m) => HOSTS.claude.context(m),
    block: (m) => HOSTS.claude.block(m),
    warn: (m) => HOSTS.claude.warn(m),
  },
  gemini: {
    nativeRules: false,
    start: (m) => ({ json: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: m } } }),
    guard: (g) => ({ json: { decision: g.decision, reason: g.reason } }),
    context: (m) => ({ json: { hookSpecificOutput: { hookEventName: "AfterTool", additionalContext: m } } }),
    block: (m) => ({ json: { decision: "deny", reason: m } }),
    warn: (m) => ({ json: { systemMessage: m } }),
  },
  // Antigravity: every hook answers JSON ({} = no opinion). PostToolUse can only return {}, so check failures
  // wait in a per-conversation file and the PostInvocation hook (mode `flush`) injects them before the next call.
  antigravity: {
    nativeRules: false,
    empty: { json: {} },
    // PreToolUse must decide; {} or no output denies. "ask" defers to the user's normal permission flow
    // (it honours "Always Allow"), which is what a tool call gets when no hook runs.
    pass: { json: { decision: "ask" } },
    start: (m) => ({ json: { injectSteps: [{ systemMessage: { systemMessage: m } }] } }),
    guard: (g) => ({ json: { decision: g.decision, reason: g.reason } }),
    context: (m, session) => {
      writeFileSync(pendingFile(session), `${existsSync(pendingFile(session)) ? readFileSync(pendingFile(session), "utf8") + "\n\n" : ""}${m}`)
      return { json: {} }
    },
    flush: (session) => {
      const f = pendingFile(session)
      if (!existsSync(f)) return null
      const m = readFileSync(f, "utf8")
      rmSync(f, { force: true })
      return { json: { injectSteps: [{ systemMessage: { systemMessage: m } }] } }
    },
    block: (m) => ({ json: { decision: "continue", reason: m } }),
    warn: () => null,
  },
}

/** The host a payload came from: the one named on the command line, except Codex, told apart by its payload. */
export function hostOf(input, named = "claude") {
  if (named === "claude" && (input.turn_id !== undefined || input.tool_name === "apply_patch")) return "codex"
  return HOSTS[named] ? named : "claude"
}

// ---- main ------------------------------------------------------------------------------------

function emit(res) {
  if (!res) return
  emit.count = (emit.count ?? 0) + 1
  if (res.json) console.log(JSON.stringify(res.json))
  if (res.stderr) process.stderr.write(`${res.stderr}\n`)
  if (res.exit) process.exit(res.exit)
}

function main() {
  const [mode, arg] = process.argv.slice(2)
  if (mode === "fix") {
    const root = findRoot(process.cwd())
    if (!root) return console.log("No sdlc.json above this folder.")
    const flag = fixFlag(root)
    if (arg === "on") writeFileSync(flag, new Date().toISOString())
    else rmSync(flag, { force: true })
    return console.log(`fix mode ${arg === "on" ? "on: tests are read-only" : "off"} in ${root}`)
  }
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}")
  } catch {}
  const host = HOSTS[hostOf(input, arg)]
  const rules = !host.nativeRules
  const session = normalize(input).session
  const said = emit.count
  if (mode === "start") {
    const msg = start(input)
    if (msg) emit(host.start(msg))
  } else if (mode === "guard") {
    const g = guard(input)
    if (g) emit(host.guard(g))
    else {
      if (host.pass) emit(host.pass)
      if (!normalize(input).files.length) markBash(input) // any tool that is not a file edit may still write files
    }
  } else if (mode === "check") {
    const msg = check(input, { rules })
    if (msg) emit(host.context(msg, session))
  } else if (mode === "bash") {
    const mark = bashMark(normalize(input))
    if (existsSync(mark)) {
      const since = Number(readFileSync(mark, "utf8")) - 1000 // mtime granularity on some filesystems is 1 s
      rmSync(mark, { force: true })
      const msg = bashCheck(input, since, { rules })
      if (msg) emit(host.context(msg, session))
    }
  } else if (mode === "flush") {
    if (host.flush) emit(host.flush(session))
  } else if (mode === "verify") {
    const { block, warn } = verify(input, join(tmpdir(), `sdlc-${normalize(input).session}.json`))
    if (block.length) emit(host.block(`Not done yet: the project's verify command fails. Fix it, then finish.\n\n${block.join("\n\n")}`))
    if (warn.length) emit(host.warn(`sdlc: verify still fails after ${MAX_BLOCKS} tries; stopping anyway.\n${warn.join("\n\n")}`))
  }
  if (emit.count === said && host.empty) emit(host.empty) // hosts that want JSON on every call
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    // A broken hook must never wedge the session; say why and let the tool run.
    process.stderr.write(`sdlc hook error: ${e.message}\n`)
  }
}
