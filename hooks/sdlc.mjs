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

// Paths in messages, globs and git commands use "/" on every OS (Windows' relative() gives "\").
const posixRelative = (from, to) => relative(from, to).replaceAll("\\", "/")

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

/** The repo above `dir`, or, from a folder that holds several repos, each child repo with an sdlc.json. */
const rootsFor = (dir) => (findRoot(dir) ? [findRoot(dir)] : verifyRoots(dir))
export const stateFileFor = (session) => join(tmpdir(), `sdlc-${session}.json`)
const readState = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {})

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
    // A Codex patch carries removed lines too ("-..."): removing a leaked key must stay possible.
    .map((v) => (v.includes("*** Begin Patch") ? v.split("\n").filter((l) => !l.startsWith("-")).join("\n") : v))
    .join("\n")

// ---- guard -----------------------------------------------------------------------------------

const SDD = /(^|:)subagent-driven-development$/

/** Claude's Skill and Agent calls: the build role and the model of each subagent come from sdlc.json, not from
 *  what the agent remembers. {decision, reason, updatedInput?} or null. */
function guardDispatch(e) {
  const configs = rootsFor(e.cwd).map(loadConfig)
  if (!configs.length) return null
  if (e.tool === "Skill" && SDD.test(String(e.ti.skill ?? ""))) {
    if (configs.some((c) => SDD.test(String(c.providers?.build ?? "")))) return null
    return {
      decision: "deny",
      reason:
        "sdlc: build is inline in this repo (providers.build in sdlc.json), so work the plan here; the review is the sdlc loop. " +
        "A subagent per task re-reads the code and the startup context for every task.",
    }
  }
  if (e.tool !== "Agent" && e.tool !== "Task") return null
  const type = String(e.ti.subagent_type ?? "")
  let model = configs.map((c) => c.models?.[type]).find(Boolean)
  if (!model && type === "sdlc:reviewer" && e.ti.model === "haiku") model = "sonnet" // the cheapest tier misses defects
  if (!model || model === e.ti.model) return null
  return { decision: "allow", reason: `sdlc: ${type || "subagent"} runs on ${model} (sdlc.json)`, updatedInput: { ...e.ti, model } }
}

/** {decision: "deny" | "ask" | "allow", reason, updatedInput?} or null. */
export function guard(input) {
  const e = normalize(input)
  if (e.tool === "Skill" || e.tool === "Agent" || e.tool === "Task") return guardDispatch(e)
  if (e.shell) {
    // From a multi-repo parent folder the command may `cd` into any child repo: apply all of theirs.
    const configs = rootsFor(e.cwd).map(loadConfig)
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
    const rel = posixRelative(root, abs)
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
  const rel = posixRelative(root, abs)
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
  const roots = rootsFor(e.cwd)
  if (roots.length) writeFileSync(bashMark(e), JSON.stringify({ since: Date.now(), heads: Object.fromEntries(roots.map((r) => [r, headOf(r)])) }))
}

// Dirty files (tracked or untracked) under root modified at or after `since`, and every deleted path.
export function changedSince(root, since) {
  const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "-uall"], {
    cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"],
  })
  const entries = out.split("\0")
  const files = []
  const deleted = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.length < 4) continue
    // Rename: the next entry is the old path, gone from where it was (git mv of a protected file).
    if (e[0] === "R") deleted.push(join(root, entries[++i]))
    else if (e[0] === "C") i++
    const abs = join(root, e.slice(3))
    if (e[0] === "D" || e[1] === "D") deleted.push(abs) // no mtime to compare: a deleted path is always reported
    else
      try {
        if (statSync(abs).isFile() && statSync(abs).mtimeMs >= since) files.push(abs)
      } catch {}
  }
  return { files, deleted }
}

export function bashCheck(input, mark, { rules = false } = {}) {
  const e = normalize(input)
  const msgs = []
  for (const root of rootsFor(e.cwd)) {
    let changed
    try {
      changed = changedSince(root, mark.since - 1000) // mtime granularity on some filesystems is 1 s
    } catch {
      continue // not a git repo
    }
    // A command that also committed leaves a clean tree: take what its own commits changed. Only commits on top of
    // the old HEAD, made since the command started and not merges, so a checkout, pull or merge of others' work is not blamed.
    const before = mark.heads?.[root]
    const head = headOf(root)
    let committed = []
    if (before && head && before !== head)
      try {
        gitOut(root, "merge-base", "--is-ancestor", before, head)
        const since = `--since=@${Math.floor(mark.since / 1000) - 2}`
        const log = gitOut(root, "log", "--no-merges", "--no-renames", "--name-only", "--format=", since, `${before}..${head}`)
        committed = [...new Set(log.split("\n").filter(Boolean))].map((f) => join(root, f))
      } catch {} // not an ancestor (branch switch, rebase) or `before` is gone: nothing to attribute
    const written = [...new Set([...changed.files, ...committed.filter((f) => existsSync(f))])]
    const touched = [...new Set([...written, ...changed.deleted, ...committed])]
    if (!touched.length) continue
    const config = loadConfig(root)
    // Protect and fix mode look at every path; a guard cannot see inside a shell command, so this is after the fact.
    for (const rel of touched.map((f) => posixRelative(root, f))) {
      const p = (config.protect ?? []).find((x) => matches(rel, x.glob))
      if (p) msgs.push(`${rel} is protected: ${p.reason}. This command changed or removed it; restore it with \`git checkout ${before ?? "HEAD"} -- ${rel}\`.`)
    }
    if (existsSync(fixFlag(root))) {
      const tests = touched.map((f) => posixRelative(root, f)).filter((r) => matches(r, config.tests ?? []))
      if (tests.length)
        msgs.push(`Fix mode: this command changed tests (${tests.join(", ")}). Restore them with \`git checkout -- <file>\` and fix the code instead, or ask the user if a test is wrong.`)
    }
    if (written.length > MAX_BASH_FILES) continue // linting this many is verify's job
    for (const f of written) {
      const m = checkFile(f, { rules, session: e.session })
      if (m) msgs.push(m)
    }
  }
  return msgs.length ? msgs.join("\n\n") : null
}

// ---- verify ----------------------------------------------------------------------------------

const gitOut = (root, ...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] })
const headOf = (root) => {
  try {
    return gitOut(root, "rev-parse", "HEAD").trim()
  } catch {
    return null // no commits yet
  }
}

/** Paths that differ from `base`: uncommitted changes plus commits made since the session started. */
function changedPaths(root, base, head) {
  const paths = []
  const entries = gitOut(root, "status", "--porcelain=v1", "-z", "-uall").split("\0")
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].length < 4) continue
    paths.push(entries[i].slice(3))
    if (/[RC]/.test(entries[i][0])) i++
  }
  if (base && head && base !== head) paths.push(...gitOut(root, "diff", "--name-only", base, head).split("\n").filter(Boolean))
  return paths
}

/** A hash of the work since `base`, or null when there is nothing to verify (no change, or only docs). */
function fingerprint(root, base, config) {
  const head = headOf(root)
  const paths = changedPaths(root, base, head)
  if (!paths.length) return null
  const ignore = config.verifyIgnore ?? ["**/*.md", `${config.artifacts ?? "docs/work"}/**`]
  if (paths.every((p) => matches(p, ignore))) return null // docs-only turn: the full verify waits for code
  const status = gitOut(root, "status", "--porcelain=v1", "-uall")
  const h = createHash("sha1").update(status).update(gitOut(root, "diff")).update(gitOut(root, "diff", "--cached"))
  if (head !== base) h.update(String(head)) // committed work counts: a commit must not dodge verify
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
  process.env.CLAUDE_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || normalize(input).cwd

export function verify(input, stateFile = stateFileFor(normalize(input).session)) {
  const state = readState(stateFile)
  const block = []
  const warn = []
  for (const root of rootsFor(projectDir(input))) {
    const config = loadConfig(root)
    if (!config.verify) continue
    const s = (state[root] ??= { blocks: 0, base: headOf(root) })
    let fp
    try {
      fp = fingerprint(root, s.base, config)
    } catch {
      continue // not a git repo
    }
    if (!fp || fp === s.green) continue
    if (fp === s.failed) {
      // Said once per failing tree, so a host that can only "continue" (Antigravity) does not loop.
      if (s.warned !== fp) {
        warn.push(`verify still fails in ${root} on the same tree it failed on before (\`${config.verify}\`). Fix it, or tell the user why it is left failing.`)
        s.warned = fp
      }
      continue
    }
    const r = run(config.verify, root, config, config.verifyTimeout ?? 540)
    if (r.ok) Object.assign(s, { green: fp, failed: null, blocks: 0 })
    else {
      Object.assign(s, { failed: fp, blocks: s.blocks + 1 })
      const msg = `verify failed in ${root}: \`${config.verify}\`\n${tail(r.out, 40)}`
      if (s.blocks <= MAX_BLOCKS) block.push(msg)
      else if (s.warned !== fp) {
        warn.push(`verify still fails after ${MAX_BLOCKS} blocks; not blocking again.\n${msg}`)
        s.warned = fp
      }
    }
  }
  writeFileSync(stateFile, JSON.stringify(state))
  return { block, warn }
}

// ---- start -----------------------------------------------------------------------------------

export function start(input, stateFile = stateFileFor(normalize(input).session)) {
  const base = projectDir(input)
  const roots = rootsFor(base)
  if (!roots.length) return null
  // Remember where each repo stood, so verify also sees work that gets committed during the session.
  const state = readState(stateFile)
  for (const r of roots) state[r] ??= { blocks: 0, base: headOf(r) }
  writeFileSync(stateFile, JSON.stringify(state))
  // The paths are said up front: agents fall back to the skill's defaults when the repo set its own.
  const where = roots.map((r) => {
    let c
    try {
      c = loadConfig(r)
    } catch {
      return `${posixRelative(base, r) || "."} (sdlc.json unreadable: fix it)` // one bad repo must not drop the pointer for all
    }
    return `${posixRelative(base, r) || "."} (artifacts in ${c.artifacts ?? "docs/work"}/<date>-<slug>/, debt in ${c.debt ?? "docs/debt.md"})`
  })
  // Lane S is spelled out here so a copy or config edit does not load the whole skill.
  return `This workspace follows the sdlc process (sdlc.json in: ${where.join(", ")}). Lane S (copy, config, styling, a rename: no new logic, not even a short branch) needs no skill: say "Lane S" with the reason, edit, and the hooks check it. Before any other code change, review or plan there, invoke the \`sdlc\` skill and state the lane (M or L) with its reason.`
}

// ---- output: one adapter per host -------------------------------------------------------------
// Each returns { json } to print, and optionally { stderr, exit }. null means the host has no way to say it.

const pendingFile = (session) => join(tmpdir(), `sdlc-pending-${session}.txt`)

export const HOSTS = {
  // Claude Code. Codex reads the same JSON (and gets the plugin root as CLAUDE_PLUGIN_ROOT too).
  claude: {
    nativeRules: true,
    start: (m) => ({ json: { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: m } } }),
    guard: (g) => ({
      json: {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: g.decision,
          permissionDecisionReason: g.reason,
          ...(g.updatedInput && { updatedInput: g.updatedInput }), // replaces the whole input, so it carries every field
        },
      },
    }),
    context: (m) => ({ json: { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: m } } }),
    block: (m) => ({ stderr: m, exit: 2 }),
    warn: (m) => ({ json: { systemMessage: m } }),
  },
  // Codex: as Claude, but no path-scoped rules, and no documented "ask" from a hook.
  codex: {
    nativeRules: false,
    start: (m) => HOSTS.claude.start(m),
    guard: (g) =>
      g.decision === "allow"
        ? HOSTS.claude.guard(g)
        : HOSTS.claude.guard({ decision: "deny", reason: g.decision === "ask" ? `${g.reason}. Ask the user, and retry only after they approve.` : g.reason }),
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
    warn: (m) => ({ json: { decision: "continue", reason: m } }), // Stop's only channel; verify says it once
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
    else if (host.pass) emit(host.pass)
    // Any tool that runs and is not a file edit may still write files (a subagent whose model was set included).
    if ((!g || g.decision === "allow") && !normalize(input).files.length) markBash(input)
  } else if (mode === "check") {
    const msg = check(input, { rules })
    if (msg) emit(host.context(msg, session))
  } else if (mode === "bash") {
    const mark = bashMark(normalize(input))
    if (existsSync(mark)) {
      const m = JSON.parse(readFileSync(mark, "utf8"))
      rmSync(mark, { force: true })
      const msg = bashCheck(input, m, { rules })
      if (msg) emit(host.context(msg, session))
    }
  } else if (mode === "flush") {
    if (host.flush) emit(host.flush(session))
  } else if (mode === "verify") {
    const { block, warn } = verify(input)
    if (block.length) emit(host.block(`Not done yet: the project's verify command fails. Fix it, then finish.\n\n${block.join("\n\n")}`))
    else if (warn.length) emit(host.warn(`sdlc: ${warn.join("\n\n")}`))
  }
  if (emit.count === said && host.empty) emit(host.empty) // hosts that want JSON on every call
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (e) {
    // A broken hook (say, a typo in sdlc.json) must never wedge the session: answer the host's neutral reply,
    // and say so where the user sees it, since the check it should have made did not run.
    const [mode, named] = process.argv.slice(2)
    const msg = `sdlc hook error in ${mode}: ${e.message}. The check did not run; fix the cause (often sdlc.json).`
    process.stderr.write(`${msg}\n`)
    if (named === "antigravity") console.log(JSON.stringify(mode === "guard" ? { decision: "ask", reason: msg } : {}))
    else console.log(JSON.stringify({ systemMessage: msg }))
  }
}
