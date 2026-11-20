import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { repoStats, workItems } from "./metrics.mjs"

test("metrics read stage times, rework and repo-wide counts from git", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-metrics-"))
  execFileSync("git", ["init", "-q"], { cwd: root })
  let t = 1_800_000_000
  const commit = (path, body, msg) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), body)
    execFileSync("git", ["add", "-A"], { cwd: root })
    const date = `${t} +0000`
    execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=e", "commit", "-qm", msg], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } })
    t += 3600
  }
  const w = "docs/work/2026-11-01-x"
  commit(`${w}/intent.md`, "i", "docs: intent")
  commit(`${w}/spec.md`, "s", "docs: spec") // +1 h
  commit(`${w}/plan.md`, "p", "docs: plan") // +1 h
  commit(`${w}/spec.md`, "s2", "docs: spec rework")
  commit(`${w}/plan.md`, "p2", "docs: plan update")
  commit("CLAUDE.md", "c", "docs: rule from a repeated mistake")
  commit("docs/debt.md", "- one\n- two\n", "fix: thing")
  assert.deepEqual(workItems(root), [{ item: "2026-11-01-x", intentToSpecH: 1, specToPlanH: 1, specReworkAfterPlan: 1, planUpdates: 1 }])
  const s = repoStats(root, "2020-01-01")
  assert.equal(s.commits, 7)
  assert.equal(s.fixCommits, 1)
  assert.equal(s.agentInstructionChanges, 1)
  assert.equal(s.debtItemsAdded, 2)
})
