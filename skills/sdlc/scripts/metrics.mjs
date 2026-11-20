#!/usr/bin/env node
// The playbook's leading and lagging indicators that git alone can answer, for one repo.
//   node metrics.mjs [since]     run inside the repo; since is any git date ("30 days ago", 2026-11-01)
// Per artifact folder (docs/work/<date>-<slug>): intent → spec → plan hours, spec commits after the first plan
// commit (requirements rework), plan commits after it (plan kept in step with the build). Repo-wide since `since`:
// changes to agent instructions and rule cards (each one a mistake turned into a rule), fix commits, debt added.

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const git = (root, ...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 }).trim()
const times = (root, path) => git(root, "log", "--format=%ct", "--", path).split("\n").filter(Boolean).map(Number) // newest first

function artifactsDir(root) {
  for (const c of [".agents/sdlc.json", ".claude/sdlc.json"])
    if (existsSync(join(root, c))) return JSON.parse(readFileSync(join(root, c), "utf8")).artifacts ?? "docs/work"
  return "docs/work"
}

/** One row per artifact folder; hours are null when a stage was never committed. */
export function workItems(root) {
  const dir = artifactsDir(root)
  if (!existsSync(join(root, dir))) return []
  const hours = (a, b) => (a && b ? Math.round(((b - a) / 3600) * 10) / 10 : null)
  return readdirSync(join(root, dir), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const at = (f) => times(root, `${dir}/${d.name}/${f}`)
      const [intent, spec, plan] = ["intent.md", "spec.md", "plan.md"].map(at)
      const first = (t) => (t.length ? t[t.length - 1] : null)
      const planStart = first(plan)
      return {
        item: d.name,
        intentToSpecH: hours(first(intent), first(spec)),
        specToPlanH: hours(first(spec), planStart),
        specReworkAfterPlan: planStart ? spec.filter((t) => t > planStart).length : null,
        planUpdates: planStart ? plan.length - 1 : null,
      }
    })
}

export function repoStats(root, since = "30 days ago") {
  const count = (...paths) => git(root, "log", `--since=${since}`, "--format=%h", "--", ...paths).split("\n").filter(Boolean).length
  const subjects = git(root, "log", `--since=${since}`, "--format=%s").split("\n").filter(Boolean)
  const debtFile = (() => {
    for (const c of [".agents/sdlc.json", ".claude/sdlc.json"])
      if (existsSync(join(root, c))) return JSON.parse(readFileSync(join(root, c), "utf8")).debt ?? "docs/debt.md"
    return "docs/debt.md"
  })()
  const debtAdded = git(root, "log", `--since=${since}`, "-p", "--format=", "--", debtFile)
    .split("\n").filter((l) => /^\+\s*[-*]\s/.test(l)).length
  return {
    since,
    commits: subjects.length,
    fixCommits: subjects.filter((s) => /^fix(\(.+\))?!?:/.test(s)).length,
    agentInstructionChanges: count("CLAUDE.md", "AGENTS.md", "GEMINI.md"),
    ruleCardChanges: count(".claude/rules", ".agents/rules", "REVIEW.md"),
    debtItemsAdded: debtAdded,
    shortcutsInTree: (() => {
      try { return git(root, "grep", "-c", "shortcut:").split("\n").reduce((n, l) => n + Number(l.split(":").pop()), 0) } catch { return 0 }
    })(),
  }
}

function main() {
  const root = git(process.cwd(), "rev-parse", "--show-toplevel")
  const since = process.argv[2] ?? "30 days ago"
  const items = workItems(root)
  console.log(`# sdlc metrics for ${root}\n`)
  if (items.length) {
    console.log("| Work item | intent→spec h | spec→plan h | spec rework after plan | plan updates |\n|---|---|---|---|---|")
    for (const r of items) console.log(`| ${r.item} | ${r.intentToSpecH ?? "-"} | ${r.specToPlanH ?? "-"} | ${r.specReworkAfterPlan ?? "-"} | ${r.planUpdates ?? "-"} |`)
  } else console.log("No artifact folders yet (lane L writes them).")
  const s = repoStats(root, since)
  console.log(`\nSince ${s.since}: ${s.commits} commits, ${s.fixCommits} fixes; agent instructions changed ${s.agentInstructionChanges}x, rule cards/REVIEW.md ${s.ruleCardChanges}x; debt items added ${s.debtItemsAdded}; shortcut: comments in tree ${s.shortcutsInTree}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
