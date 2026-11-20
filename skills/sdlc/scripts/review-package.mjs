#!/usr/bin/env node
// Writes one file a reviewer reads instead of running git itself: the commits, the stat, the diff with context,
// and the project rule cards whose `paths:` match a changed file, so a reviewer on any agent host gets them.
//   node review-package.mjs <base> [head]     run inside the repo; prints the file path. Without head: base to
//                                             the working tree, uncommitted and untracked files included

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, matchesGlob } from "node:path"
import { fileURLToPath } from "node:url"

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

function main() {
  // With a head: that commit range. Without: everything since base, committed or not, untracked files included,
  // because the sdlc loop reviews work before the user has asked for a commit.
  const [base, head] = process.argv.slice(2)
  if (!base) throw new Error("usage: review-package.mjs <base> [head]")
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 })
  const root = git("rev-parse", "--show-toplevel").trim()
  const range = head ? `${base}..${head}` : base
  const untracked = head ? [] : git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)
  // `git diff --no-index` exits 1 when files differ, which is the point here.
  const newFileDiff = (f) => spawnSync("git", ["diff", "--no-index", "-U10", "/dev/null", f], { cwd: root, encoding: "utf8" }).stdout
  const files = [...git("diff", "--name-only", range).split("\n").filter(Boolean), ...untracked]
  const rules = matchingRules(root, files)
  const review = existsSync(join(root, "REVIEW.md")) ? "REVIEW.md (read it first)" : "none (no REVIEW.md)"
  const parts = [
    `# Review package ${head ? range : `${base}..working tree`}`,
    `Repo: ${root}\nReview policy: ${review}\nRules that bind these files: ${rules.map((r) => r.name).join(", ") || "none"}`,
    `## Commits\n${git("log", "--oneline", `${base}..${head ?? "HEAD"}`) || "(none yet; the work is uncommitted)"}`,
    `## Stat\n${git("diff", "--stat", range)}${untracked.map((f) => ` ${f} (new, untracked)`).join("\n")}`,
    ...rules.map((r) => `## Rule: ${r.name}\n${r.text}`),
    `## Diff\n${git("diff", "-U10", range)}${untracked.map(newFileDiff).join("")}`,
  ]
  const short = (r) => git("rev-parse", "--short", r).trim()
  const out = join(tmpdir(), `sdlc-review-${short(base)}-${head ? short(head) : `wt${Date.now()}`}.md`)
  writeFileSync(out, parts.join("\n\n"))
  console.log(out)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
