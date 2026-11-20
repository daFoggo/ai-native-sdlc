#!/usr/bin/env node
// Writes one file a reviewer reads instead of running git itself: the commits, the stat, the diff with context,
// and the project rules (.claude/rules/*.md) whose `paths:` match a changed file. Rules reach the reviewer here
// on purpose: path-scoped rules are not documented to load inside subagents.
//   node review-package.mjs <base> [head]     run inside the repo; prints the file path

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, matchesGlob } from "node:path"
import { fileURLToPath } from "node:url"

/** The `paths:` globs of a rule file's frontmatter: a YAML list or one comma-separated string. */
export function rulePaths(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ""
  const m = fm.match(/^paths:[ \t]*(.*)\n?((?:[ \t]*-.*\n?)*)/m)
  if (!m) return []
  const strip = (s) => s.trim().replace(/^["']|["']$/g, "")
  if (m[1].trim()) return m[1].split(",").map(strip).filter(Boolean)
  return m[2].split("\n").map((l) => strip(l.replace(/^\s*-\s*/, ""))).filter(Boolean)
}

export function matchingRules(root, files) {
  const dir = join(root, ".claude", "rules")
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir, { recursive: true }).filter((n) => n.endsWith(".md")).sort()) {
    const text = readFileSync(join(dir, name), "utf8")
    const globs = rulePaths(text)
    // A rule without paths loads for every session, so it binds every review too.
    if (!globs.length || files.some((f) => globs.some((g) => matchesGlob(f, g)))) out.push({ name, text })
  }
  return out
}

function main() {
  const [base, head = "HEAD"] = process.argv.slice(2)
  if (!base) throw new Error("usage: review-package.mjs <base> [head]")
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 256 << 20 })
  const root = git("rev-parse", "--show-toplevel").trim()
  const range = `${base}..${head}`
  const files = git("diff", "--name-only", range).split("\n").filter(Boolean)
  const rules = matchingRules(root, files)
  const review = existsSync(join(root, "REVIEW.md")) ? "REVIEW.md (read it first)" : "none (no REVIEW.md)"
  const parts = [
    `# Review package ${range}`,
    `Repo: ${root}\nReview policy: ${review}\nRules that bind these files: ${rules.map((r) => r.name).join(", ") || "none"}`,
    `## Commits\n${git("log", "--oneline", range)}`,
    `## Stat\n${git("diff", "--stat", range)}`,
    ...rules.map((r) => `## Rule: .claude/rules/${r.name}\n${r.text}`),
    `## Diff\n${git("diff", "-U10", range)}`,
  ]
  const out = join(tmpdir(), `sdlc-review-${git("rev-parse", "--short", base).trim()}-${git("rev-parse", "--short", head).trim()}.md`)
  writeFileSync(out, parts.join("\n\n"))
  console.log(out)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
