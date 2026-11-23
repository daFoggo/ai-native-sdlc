#!/usr/bin/env node
// Checks a business map (map.json) and renders it to one HTML page: a Mermaid chart per flow, each step opening its
// evidence and gaps. The agent writes only the JSON; this script owns the page, so the page costs no tokens.
//   node render.mjs <dir>   reads <dir>/map.json, writes <dir>/index.html; exit 1 with every problem on bad input

import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const EVIDENCE = { observed: "read in code", documented: "a doc states it", inferred: "the agent's guess", verified: "proven by running it" }
const GAPS = {
  owner: "no clear owner",
  "error-path": "error or exception path",
  transition: "state change condition",
  "code-vs-doc": "code and docs disagree",
  untested: "no test",
  dependency: "depends on another system",
  "no-outcome": "ends without an observable result",
}

/** Every problem in a map, as one line each; [] means it renders. */
export function validate(map) {
  const out = []
  if (!Array.isArray(map?.flows)) return ["map.flows must be an array"]
  // The JSON comes from an agent: a wrong shape is a listed problem, never a crash further down.
  const list = (v, what) => (v === undefined || Array.isArray(v) ? v ?? [] : (out.push(`${what} must be a list`), []))
  const isObj = (v) => v !== null && typeof v === "object"
  const objects = (items, what) => items.filter((v, i) => isObj(v) || (out.push(`${what} ${i} is not an object`), false))
  const actors = new Set(objects(list(map.actors, "actors"), "actor").map((a) => a.id))
  const flowIds = new Set()
  for (const [fi, f] of map.flows.entries()) {
    if (!isObj(f)) {
      out.push(`flow ${fi} is not an object`)
      continue
    }
    const at = `flow ${f.id}`
    if (flowIds.has(f.id)) out.push(`duplicate flow id ${f.id}`)
    flowIds.add(f.id)
    if (!["flow", "state"].includes(f.kind)) out.push(`${at}: kind ${f.kind} is not flow or state`)
    if (f.actor !== undefined && !actors.has(f.actor)) out.push(`${at}: actor ${f.actor} is not in actors`)
    const steps = objects(list(f.steps, `${at}: steps`), `${at}: step`)
    if (!steps.length) out.push(`${at}: no steps`)
    const ids = new Set()
    for (const s of steps) if (ids.has(s.id)) out.push(`${at}: duplicate step id ${s.id}`); else ids.add(s.id)
    for (const s of steps) {
      for (const n of list(s.next, `${at}, step ${s.id}: next`)) if (!ids.has(n)) out.push(`${at}, step ${s.id}: next ${n} is not a step`)
      const evidence = list(s.evidence, `${at}, step ${s.id}: evidence`)
      if (Array.isArray(s.evidence) && !evidence.length) out.push(`${at}, step ${s.id} has no evidence (use kind inferred for a guess)`)
      if (s.evidence === undefined) out.push(`${at}, step ${s.id} has no evidence (use kind inferred for a guess)`)
      for (const e of objects(evidence, `${at}, step ${s.id}: evidence`)) {
        if (!EVIDENCE[e.kind]) out.push(`${at}, step ${s.id}: evidence kind ${e.kind} is not ${Object.keys(EVIDENCE).join("|")}`)
        if (e.kind === "verified" && !e.proof) out.push(`${at}, step ${s.id}: verified evidence needs a proof path`)
        if (!e.file) out.push(`${at}, step ${s.id}: evidence without a file`)
      }
    }
    for (const g of objects(list(f.gaps, `${at}: gaps`), `${at}: gap`)) {
      if (!GAPS[g.type]) out.push(`${at}: gap type ${g.type} is not ${Object.keys(GAPS).join("|")}`)
      if (g.step !== undefined && !ids.has(g.step)) out.push(`${at}: gap names step ${g.step}, which is not a step`)
    }
  }
  return out
}

const ENTITY = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const html = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ENTITY[c])
// Mermaid reads entity codes inside a quoted label; quotes and angle brackets would end it or become markup.
const label = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/["<>#]/g, (c) => `#${c.charCodeAt(0)};`)

/** Mermaid source for one flow. Step ids become s0..sN, since a real id may hold characters Mermaid rejects. */
function chart(f, fi) {
  const key = new Map(f.steps.map((s, i) => [s.id, `s${i}`]))
  const edges = f.steps.flatMap((s) => (s.next ?? []).map((n) => `  ${key.get(s.id)} --> ${key.get(n)}`))
  if (f.kind === "state")
    return ["stateDiagram-v2", `  [*] --> s0`, ...f.steps.map((s, i) => `  state "${label(s.label)}" as s${i}`), ...edges].join("\n")
  const clicks = f.steps.map((_, i) => `  click s${i} call showStep(${fi}, ${i})`) // indexes: an id may hold quotes or commas
  return ["flowchart TD", ...f.steps.map((s, i) => `  s${i}["${label(s.label)}"]`), ...edges, ...clicks].join("\n")
}

const where = (e) => `${e.file}${e.line ? `:${e.line}` : ""}`

function flowSection(f, i, actors) {
  const steps = f.steps
    .map((s, j) => {
      const ev = s.evidence
        .map((e) => `<li><span class="k k-${html(e.kind)}">${html(e.kind)}</span> <code>${html(where(e))}</code>${e.proof ? ` proof <code>${html(e.proof)}</code>` : ""}${e.note ? ` — ${html(e.note)}` : ""}</li>`)
        .join("")
      const gaps = (f.gaps ?? []).filter((g) => g.step === s.id).map((g) => `<li class="gap">${html(GAPS[g.type])}: ${html(g.text)}</li>`).join("")
      return `<li id="f${i}-s${j}"><button type="button" aria-expanded="false">${html(s.label)}</button><div class="ev" hidden><ul>${ev}${gaps}</ul></div></li>`
    })
    .join("")
  const flowGaps = (f.gaps ?? []).map((g) => `<li>${g.step ? `<b>${html(f.steps.find((s) => s.id === g.step)?.label)}</b> · ` : ""}${html(GAPS[g.type])}: ${html(g.text)}</li>`).join("")
  return `<section id="flow-${i}" data-flow="${html(f.id)}"${i ? " hidden" : ""}>
<h2>${html(f.name ?? f.id)}</h2>${f.actor ? `<p class="actor">Actor: ${html(actors.get(f.actor) ?? f.actor)}</p>` : ""}
<pre class="mermaid">${html(chart(f, i))}</pre>
<h3>Steps</h3><ol class="steps">${steps}</ol>
<h3>Gaps</h3>${flowGaps ? `<ul class="gaps">${flowGaps}</ul>` : "<p>None recorded.</p>"}
</section>`
}

/** The whole page. Every text from the map is escaped; charts render one flow at a time, when it is opened. */
export function render(map) {
  const actors = new Map((map.actors ?? []).map((a) => [a.id, a.name ?? a.id]))
  const nav = map.flows.map((f, i) => `<li><button type="button" data-open="${i}">${html(f.name ?? f.id)}</button> <small>${f.kind} · ${(f.gaps ?? []).length} gaps</small></li>`).join("")
  const legend = Object.entries(EVIDENCE).map(([k, v]) => `<li><span class="k k-${k}">${k}</span> ${v}</li>`).join("")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Business map</title>
<style>
:root{--bg:#fff;--fg:#1c1c1c;--muted:#666;--line:#ddd;--obs:#1f6f43;--doc:#1d4f91;--inf:#8a5a00;--ver:#5b2b8c}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e8e8;--muted:#9a9a9a;--line:#333;--obs:#6fcf97;--doc:#7aa7e8;--inf:#e0b05a;--ver:#c29ae8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
.wrap{display:grid;grid-template-columns:minmax(200px,260px) 1fr;gap:24px;max-width:1200px;margin:auto;padding:16px}
@media (max-width:720px){.wrap{grid-template-columns:1fr}}
nav ul,.legend{list-style:none;padding:0;margin:0}nav li{margin:4px 0}
button{font:inherit;color:inherit;background:none;border:1px solid var(--line);border-radius:6px;padding:4px 8px;cursor:pointer;text-align:left}
button[aria-current=true]{border-color:var(--fg)}small,.actor{color:var(--muted)}
pre.mermaid{overflow-x:auto;background:transparent}code{font-size:13px}
.k{font-size:12px;border:1px solid currentColor;border-radius:4px;padding:0 4px}
.k-observed{color:var(--obs)}.k-documented{color:var(--doc)}.k-inferred{color:var(--inf)}.k-verified{color:var(--ver)}
.steps li{margin:6px 0}.ev{margin:4px 0 8px}.gap{color:var(--inf)}
</style></head><body><div class="wrap">
<nav><h1>Business map</h1><p><small>commit ${html(map.commit ?? "unknown")}</small></p><ul>${nav}</ul>
<h3>Evidence</h3><ul class="legend">${legend}</ul></nav>
<main>${map.flows.map((f, i) => flowSection(f, i, actors)).join("\n")}</main>
</div>
<script type="module">
// Clicks work before and without Mermaid: a blocked or hanging CDN leaves each chart as its source text.
const toggle = (li, open) => { const b = li.querySelector("button"), ev = li.querySelector(".ev"); open ??= ev.hidden; ev.hidden = !open; b.setAttribute("aria-expanded", open) }
window.showStep = (i, j) => {
  const li = document.getElementById("f" + i + "-s" + j)
  if (!li) return
  toggle(li, true)
  li.scrollIntoView({ block: "nearest" })
}
document.addEventListener("click", (ev) => {
  const open = ev.target.closest("[data-open]")
  if (open) return openFlow(open.dataset.open)
  const step = ev.target.closest(".steps > li > button")
  if (step) toggle(step.parentElement)
})
const ready = import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs")
  .then(({ default: m }) => (m.initialize({ startOnLoad: false, securityLevel: "loose", theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" }), m))
  .catch(() => null)
async function openFlow(i) {
  document.querySelectorAll("main section").forEach((s) => (s.hidden = s.id !== "flow-" + i))
  document.querySelectorAll("nav [data-open]").forEach((b) => b.setAttribute("aria-current", b.dataset.open === String(i)))
  const pre = document.querySelector("#flow-" + i + " pre.mermaid")
  const mermaid = await ready
  if (mermaid && !pre.dataset.processed) await mermaid.run({ nodes: [pre] }).catch(() => {})
}
openFlow(0)
</script></body></html>
`
}

function main() {
  const dir = resolve(process.argv[2] ?? ".")
  const map = JSON.parse(readFileSync(join(dir, "map.json"), "utf8"))
  const problems = validate(map)
  if (problems.length) {
    console.error(`map.json has ${problems.length} problem(s):\n${problems.join("\n")}`)
    process.exit(1)
  }
  writeFileSync(join(dir, "index.html"), render(map))
  console.log(join(dir, "index.html"))
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main()
