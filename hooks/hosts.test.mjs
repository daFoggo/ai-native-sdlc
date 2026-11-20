// Keeps the per-host packaging in step: one version, one reviewer prompt, hook files that call real modes.
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"

import { HOSTS } from "./sdlc.mjs"

const root = new URL("../", import.meta.url)
const read = (p) => readFileSync(new URL(p, root), "utf8")
const json = (p) => JSON.parse(read(p))

test("every manifest carries the package version", () => {
  const v = json("package.json").version
  for (const m of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".antigravity-plugin/plugin.json", "gemini-extension.json"])
    assert.equal(json(m).version, v, m)
})

test("the Claude reviewer agent is the shared reviewer prompt plus frontmatter", () => {
  const body = read("claude/agents/reviewer.md").split(/^---$/m).slice(2).join("---").trim()
  assert.equal(body, read("skills/sdlc/references/reviewer.md").trim())
})

test("hook files call sdlc.mjs with a real mode and host, and none sits where another host auto-loads it", () => {
  const modes = ["start", "guard", "check", "bash", "verify", "flush"]
  const files = { "hooks/claude-codex.json": "claude", "hooks/gemini.json": "gemini", "hooks.json": "antigravity" }
  for (const [file, host] of Object.entries(files)) {
    const cmds = JSON.stringify(json(file)).match(/sdlc\.mjs\\?"? [a-z]+(?: [a-z]+)?/g)
    assert.ok(cmds?.length, file)
    for (const c of cmds) {
      const [, mode, named = "claude"] = c.replace(/\\?"/g, "").split(" ")
      assert.ok(modes.includes(mode), `${file}: ${mode}`)
      assert.equal(named, host, `${file}: ${c}`)
      assert.ok(HOSTS[named], named)
    }
  }
  // Gemini auto-loads hooks/hooks.json and Claude/Codex discover it too, with different event names.
  assert.equal(existsSync(new URL("hooks/hooks.json", root)), false)
  assert.equal(json(".claude-plugin/plugin.json").hooks, "./hooks/claude-codex.json")
  assert.equal(json(".codex-plugin/plugin.json").hooks, "./hooks/claude-codex.json")
})
