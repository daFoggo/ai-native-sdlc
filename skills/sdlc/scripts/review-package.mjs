#!/usr/bin/env node
// Writes one file a reviewer reads instead of running git itself: the commits, the stat, the diff, and the project
// rule cards whose `paths:` match a changed file, so a reviewer on any agent host gets them.
//   node review-package.mjs <base> [head]              run inside the repo; prints the file path. Without head: base
//                                                      to the working tree, uncommitted and untracked files included
//   node review-package.mjs --snapshot                  prints a commit of the working tree as it is now: the <base>
//                                                      for a change that starts on a dirty tree
//   node review-package.mjs <base> --since <snapshot>  the fix only: what changed since the snapshot an earlier
//                                                      package printed (scoped R2/R3), so a re-review never re-reads
//                                                      the whole change

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, matchesGlob, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const CONTEXT = "-U5" // the reviewer reads the files for more; wider context is paid again on every round
const MAX_FILE_LINES = 800 // a lockfile or generated file this big is listed, not inlined

/** The `paths:` globs of a rule file's frontmatter: a YAML block list, a flow list `[a, b]`, or `a, b`. */
export function rulePaths(text) {
  const fm = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  const m = fm.match(/^paths:[ \t]*(.*)\n?((?:[ \t]*-.*\n?)*)/m)
  if (!m) return []
  const strip = (s) => s.trim().replace(/^["']|["']$/g, "")
  if (m[1].trim()) return m[1].trim().replace(/^\[|\]$/g, "").split(",").map(strip).filter(Boolean) // a, b or [a, b]
  return m[2].split("\n").map((l) => strip(l.replace(/^\s*-\s*/, ""))).filter(Boolean)
}

/** Rule cards (`.claude/rules` or `.agents/rules`) whose `paths:` match one of the files; name is the card's path. */
export function matchingRules(root, files) {
  const out = []
  for (const base of [".claude/rules", ".agents/rules"]) {
    const dir = join(root, base)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir, { recursive: true }).filter((n) => n.endsWith(".md")).sort()) {
      const text = readFileSync(join(dir, name), "utf8")
      const globs = rulePaths(text)
      // A rule without paths loads for every session, so it binds every review too.
      if (!globs.length || files.some((f) => globs.some((g) => matchesGlob(f, g)))) out.push({ name: `${base}/${name}`, text })
    }
  }
  return out
}

/** From a business map (business-map skill): the steps whose evidence file is among the changed files, and the
 *  evidence files that no longer exist. Paths compare with `/`, whatever the map was written on. */
export function touchedFlows(map, files, exists) {
  const changed = new Set(files)
  const touched = []
  const missing = new Set()
  for (const f of map.flows ?? [])
    for (const s of f.steps ?? [])
      for (const e of s.evidence ?? []) {
        const file = String(e.file ?? "").replaceAll("\\", "/")
        const at = `${f.name ?? f.id} › ${s.label ?? s.id} — ${file}`
        if (changed.has(file)) touched.push(`${at}${e.line ? `:${e.line}` : ""} (${e.kind})`)
        if (file && !exists(file)) missing.add(at)
      }
  return { touched, missing: [...missing] }
}

/** The folder that holds the repo's sdlc.json (`.agents/` wins). */
export const configDir = (dir) => [".agents", ".claude"].map((c) => join(dir, c)).find((c) => existsSync(join(c, "sdlc.json")))

/** sdlc.json with sdlc.local.json beside it; {} for a repo that has none. Shared with the hooks. */
export function loadConfig(root) {
  const dir = configDir(root)
  if (!dir) return {}
  const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {})
  const shared = read(join(dir, "sdlc.json"))
  const local = read(join(dir, "sdlc.local.json"))
  // Lists add up (a machine adds a ban or a PATH entry without copying the team's); other values are overridden.
  for (const [k, v] of Object.entries(local)) shared[k] = Array.isArray(v) && Array.isArray(shared[k]) ? [...shared[k], ...v] : v
  return shared
}

/** A commit of the working tree as it is now (untracked files included), made in a scratch index: the real index,
 *  HEAD and files are untouched. It is unreachable, so git's gc drops it after the usual grace period. */
function snapshot(git, root) {
  const index = join(tmpdir(), `sdlc-index-${process.pid}-${Date.now()}`)
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    // A copy of the real index keeps its stat cache, so only changed files are hashed again.
    const real = resolve(root, git({}, "rev-parse", "--git-path", "index").trim())
    if (existsSync(real)) copyFileSync(real, index)
    else git({ env }, "read-tree", "HEAD")
    git({ env, stdio: ["ignore", "pipe", "ignore"] }, "add", "-A", "--", ".") // line-ending warnings are noise the agent pays for
    const tree = git({ env }, "write-tree").trim()
    return git({}, "commit-tree", tree, "-p", "HEAD", "-m", "sdlc review snapshot").trim()
  } finally {
    rmSync(index, { force: true })
  }
}

function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf("--since")
  const since = at >= 0 ? args.splice(at, 2)[1] : null
  const [base, head] = args
  const git = (opts, ...a) =>
    execFileSync("git", ["-c", "user.name=sdlc", "-c", "user.email=sdlc@localhost", ...a], { encoding: "utf8", maxBuffer: 256 << 20, ...opts })
  const root = git({}, "rev-parse", "--show-toplevel").trim()
  const run = (...a) => git({ cwd: root }, ...a)
  // The start of a change on a tree that is already dirty: the review base must hold that work, or the package
  // reviews it again as part of this change.
  if (base === "--snapshot") return console.log(snapshot((o, ...a) => git({ cwd: root, ...o }, ...a), root))
  if (!base || (at >= 0 && !since)) throw new Error("usage: review-package.mjs <base> [head] | <base> --since <snapshot> | --snapshot")
  // Always a commit: the working tree becomes one, so new files need no special case and the next round can diff from it.
  const to = head ? run("rev-parse", "--verify", `${head}^{commit}`).trim() : snapshot((o, ...a) => git({ cwd: root, ...o }, ...a), root)
  const from = since ?? base
  const range = `${from}..${to}`

  // -z: raw paths (no quoting of non-ASCII names); --no-renames: one plain path per entry, both sides of a rename.
  const files = run("diff", "--name-only", "-z", "--no-renames", range).split("\0").filter(Boolean)
  const big = run("diff", "--numstat", "-z", "--no-renames", range)
    .split("\0")
    .map((l) => l.split("\t"))
    .filter(([a, d, f]) => f && (a === "-" || Number(a) + Number(d) > MAX_FILE_LINES))
    .map(([, , f]) => f)
  const rules = matchingRules(root, files)
  const review = existsSync(join(root, "REVIEW.md")) ? "REVIEW.md (read it first)" : "none (no REVIEW.md)"
  const config = loadConfig(root)
  // As git spells repo paths: `./docs\map/` in sdlc.json is `docs/map`.
  const gitPath = (p) => p.replaceAll("\\", "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "")
  const map = typeof config.map === "string" ? gitPath(config.map) : null
  // The change's own intent/spec/plan reach the reviewer by path; inlining them here pays for them twice.
  const artifacts = `${gitPath(String(config.artifacts ?? "docs/work"))}/`
  const docs = files.filter((f) => f.startsWith(artifacts) || (map && f === `${map}/index.html`)) // rendered from map.json
  // The map and its evidence as they are at `to` (the head, or the snapshot of the working tree), not on disk now.
  const atTo = map ? new Set(run("ls-tree", "-r", "--name-only", "-z", to).split("\0").filter(Boolean)) : null
  const flows = map && atTo.has(`${map}/map.json`) ? touchedFlows(JSON.parse(run("show", `${to}:${map}/map.json`)), files, (f) => atTo.has(f)) : null
  const diff = run("diff", CONTEXT, range, "--", ".", ...[...big, ...docs].map((f) => `:(exclude,literal)${f}`))
  const parts = [
    `# Review package ${since ? `fix since ${since.slice(0, 9)}` : head ? range : `${base.slice(0, 9)}..working tree`}`,
    `Repo: ${root}\nSnapshot: ${to} (for the next round: review-package.mjs ${base} --since ${to})\n` +
      `Review policy: ${review}\nRules that bind these files: ${rules.map((r) => r.name).join(", ") || "none"}`,
    since
      ? "Scope: the fix only. The rest of the change was reviewed in an earlier round; read a file when the fix needs its context."
      : `## Commits\n${run("log", "--oneline", `${base}..${head ?? "HEAD"}`) || "(none yet; the work is uncommitted)"}`,
    `## Stat\n${run("diff", "--stat", range)}`,
    big.length ? `## Not inlined (binary or over ${MAX_FILE_LINES} changed lines; read them if they matter)\n${big.join("\n")}` : "",
    docs.length ? `## Listed, not inlined (artifacts reach you by path; the map's index.html is rendered from map.json)\n${docs.join("\n")}` : "",
    flows?.touched.length ? `## Flows touched (check the change against each step)\n${flows.touched.map((l) => `- ${l}`).join("\n")}` : "",
    flows?.missing.length ? `## Map evidence missing (the business map is stale here)\n${flows.missing.map((l) => `- ${l}`).join("\n")}` : "",
    ...rules.map((r) => `## Rule: ${r.name}\n${r.text}`),
    `## Diff\n${diff || "(no changes)"}`,
  ]
  const short = (r) => run("rev-parse", "--short", r).trim()
  const out = join(tmpdir(), `sdlc-review-${short(from)}-${short(to)}.md`)
  writeFileSync(out, parts.filter(Boolean).join("\n\n"))
  console.log(out)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
