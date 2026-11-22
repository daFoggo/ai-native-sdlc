#!/usr/bin/env node
// Writes one file a reviewer reads instead of running git itself: the commits, the stat, the diff, and the project
// rule cards whose `paths:` match a changed file, so a reviewer on any agent host gets them.
//   node review-package.mjs <base> [head]              run inside the repo; prints the file path. Without head: base
//                                                      to the working tree, uncommitted and untracked files included
//   node review-package.mjs <base> --since <snapshot>  the fix only: what changed since the snapshot an earlier
//                                                      package printed (scoped R2/R3), so a re-review never re-reads
//                                                      the whole change

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, matchesGlob } from "node:path"
import { fileURLToPath } from "node:url"

const CONTEXT = "-U5" // the reviewer reads the files for more; wider context is paid again on every round
const MAX_FILE_LINES = 800 // a lockfile or generated file this big is listed, not inlined

/** The `paths:` globs of a rule file's frontmatter: a YAML block list, a flow list `[a, b]`, or `a, b`. */
export function rulePaths(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
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

/** A commit of the working tree as it is now (untracked files included), made in a scratch index: the real index,
 *  HEAD and files are untouched. It is unreachable, so git's gc drops it after the usual grace period. */
function snapshot(git, root) {
  const index = join(tmpdir(), `sdlc-index-${process.pid}-${Date.now()}`)
  const env = { ...process.env, GIT_INDEX_FILE: index }
  try {
    git({ env }, "read-tree", "HEAD")
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
  if (!base || (at >= 0 && !since)) throw new Error("usage: review-package.mjs <base> [head] | <base> --since <snapshot>")
  const git = (opts, ...a) =>
    execFileSync("git", ["-c", "user.name=sdlc", "-c", "user.email=sdlc@localhost", ...a], { encoding: "utf8", maxBuffer: 256 << 20, ...opts })
  const root = git({}, "rev-parse", "--show-toplevel").trim()
  const run = (...a) => git({ cwd: root }, ...a)
  // Always a commit: the working tree becomes one, so new files need no special case and the next round can diff from it.
  const to = head ?? snapshot((o, ...a) => git({ cwd: root, ...o }, ...a), root)
  const from = since ?? base
  const range = `${from}..${to}`

  const files = run("diff", "--name-only", range).split("\n").filter(Boolean)
  const big = run("diff", "--numstat", range)
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([a, d, f]) => f && (a === "-" || Number(a) + Number(d) > MAX_FILE_LINES))
    .map(([, , f]) => f)
  const rules = matchingRules(root, files)
  const review = existsSync(join(root, "REVIEW.md")) ? "REVIEW.md (read it first)" : "none (no REVIEW.md)"
  const diff = run("diff", CONTEXT, range, "--", ".", ...big.map((f) => `:(exclude,literal)${f}`))
  const parts = [
    `# Review package ${since ? `fix since ${since.slice(0, 9)}` : head ? range : `${base.slice(0, 9)}..working tree`}`,
    `Repo: ${root}\nSnapshot: ${to} (for the next round: review-package.mjs ${base} --since ${to})\n` +
      `Review policy: ${review}\nRules that bind these files: ${rules.map((r) => r.name).join(", ") || "none"}`,
    since
      ? "Scope: the fix only. The rest of the change was reviewed in an earlier round; read a file when the fix needs its context."
      : `## Commits\n${run("log", "--oneline", `${base}..${head ?? "HEAD"}`) || "(none yet; the work is uncommitted)"}`,
    `## Stat\n${run("diff", "--stat", range)}`,
    big.length ? `## Not inlined (binary or over ${MAX_FILE_LINES} changed lines; read them if they matter)\n${big.join("\n")}` : "",
    ...rules.map((r) => `## Rule: ${r.name}\n${r.text}`),
    `## Diff\n${diff || "(no changes)"}`,
  ]
  const short = (r) => run("rev-parse", "--short", r).trim()
  const out = join(tmpdir(), `sdlc-review-${short(from)}-${short(to)}.md`)
  writeFileSync(out, parts.filter(Boolean).join("\n\n"))
  console.log(out)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
