#!/usr/bin/env node
// Checks a business map (map.json) and renders it to one HTML page for people who do not read the code: a chart per
// flow whose boxes are colored by how sure the map is of each step, and every step with its sources and its open
// questions in plain words. The agent writes only the JSON; this script owns the page, so the page costs no tokens.
//   node render.mjs <dir>   reads <dir>/map.json, writes <dir>/index.html; exit 1 with every problem on bad input

import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Strongest first: a step's box takes the color of its strongest source.
const KINDS = ["verified", "observed", "documented", "inferred"]
const GAP_TYPES = ["owner", "error-path", "transition", "code-vs-doc", "untested", "dependency", "no-outcome"]

const TEXT = {
  en: {
    title: "Business map",
    howTo: "How to read this map",
    howToText:
      "Each flow is one piece of the business, drawn as boxes and arrows; a label on an arrow says when that path is taken. A box's border says how sure the map is of that step, and ⚠ marks a step with an open question. Click a box to jump to its step below, where each source is listed.",
    who: "Who",
    steps: "Steps",
    attention: "Needs attention",
    none: "Nothing flagged.",
    built: "Built from commit",
    nSteps: "steps",
    nGaps: "need attention",
    sources: "Where this comes from",
    proof: "proof",
    kinds: { verified: "Proven by running it", observed: "Seen in the code", documented: "Stated in a document", inferred: "A guess, not yet confirmed" },
    gaps: {
      owner: "No clear owner",
      "error-path": "Error or exception path",
      transition: "Unclear condition for this change",
      "code-vs-doc": "Code and documents disagree",
      untested: "No test covers it",
      dependency: "Waits on another system",
      "no-outcome": "Ends with nothing the user sees",
    },
  },
  vi: {
    title: "Bản đồ nghiệp vụ",
    howTo: "Cách đọc bản đồ",
    howToText:
      "Mỗi luồng là một phần nghiệp vụ, vẽ bằng ô và mũi tên; chữ trên mũi tên cho biết khi nào đi theo nhánh đó. Viền của ô cho biết bản đồ chắc chắn đến đâu về bước đó, dấu ⚠ đánh dấu bước còn câu hỏi mở. Bấm vào một ô để nhảy tới bước đó bên dưới, nơi ghi rõ từng nguồn.",
    who: "Ai thực hiện",
    steps: "Các bước",
    attention: "Cần chú ý",
    none: "Chưa ghi nhận gì.",
    built: "Dựng từ commit",
    nSteps: "bước",
    nGaps: "cần chú ý",
    sources: "Lấy từ đâu",
    proof: "bằng chứng",
    kinds: { verified: "Đã chạy thử, đúng", observed: "Đã thấy trong code", documented: "Tài liệu ghi vậy", inferred: "Đoán, chưa xác nhận" },
    gaps: {
      owner: "Chưa rõ ai chịu trách nhiệm",
      "error-path": "Nhánh lỗi hoặc ngoại lệ",
      transition: "Chưa rõ điều kiện chuyển",
      "code-vs-doc": "Code và tài liệu nói khác nhau",
      untested: "Chưa có test",
      dependency: "Phụ thuộc hệ thống khác",
      "no-outcome": "Kết thúc mà người dùng không thấy kết quả",
    },
  },
}

const target = (n) => (n !== null && typeof n === "object" ? n.to : n) // next: "id" or { to, when }

/** Every problem in a map, as one line each; [] means it renders. */
export function validate(map) {
  const out = []
  if (!Array.isArray(map?.flows)) return ["map.flows must be an array"]
  if (map.lang !== undefined && !Object.hasOwn(TEXT, map.lang)) out.push(`lang ${map.lang} is not ${Object.keys(TEXT).join("|")}`)
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
      for (const n of list(s.next, `${at}, step ${s.id}: next`)) if (!ids.has(target(n))) out.push(`${at}, step ${s.id}: next ${target(n)} is not a step`)
      const evidence = list(s.evidence, `${at}, step ${s.id}: evidence`)
      if (Array.isArray(s.evidence) && !evidence.length) out.push(`${at}, step ${s.id} has no evidence (use kind inferred for a guess)`)
      if (s.evidence === undefined) out.push(`${at}, step ${s.id} has no evidence (use kind inferred for a guess)`)
      for (const e of objects(evidence, `${at}, step ${s.id}: evidence`)) {
        if (!KINDS.includes(e.kind)) out.push(`${at}, step ${s.id}: evidence kind ${e.kind} is not ${KINDS.join("|")}`)
        if (e.kind === "verified" && !e.proof) out.push(`${at}, step ${s.id}: verified evidence needs a proof path`)
        if (!e.file) out.push(`${at}, step ${s.id}: evidence without a file`)
      }
    }
    for (const g of objects(list(f.gaps, `${at}: gaps`), `${at}: gap`)) {
      if (!GAP_TYPES.includes(g.type)) out.push(`${at}: gap type ${g.type} is not ${GAP_TYPES.join("|")}`)
      if (g.step !== undefined && !ids.has(g.step)) out.push(`${at}: gap names step ${g.step}, which is not a step`)
    }
  }
  return out
}

const ENTITY = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
const html = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ENTITY[c])
// Mermaid reads entity codes inside a label; these characters would end it or become markup (":" ends a state edge).
const label = (s, extra = "") => String(s ?? "").replace(/\s+/g, " ").replace(new RegExp(`["<>#${extra}]`, "g"), (c) => `#${c.charCodeAt(0)};`)
const strongest = (s) => KINDS.find((k) => s.evidence.some((e) => e.kind === k))
const COLORS = { verified: "#8b5cf6", observed: "#22a05a", documented: "#3b82f6", inferred: "#d4a017" }

/** Mermaid source for one flow. Step ids become s0..sN, since a real id may hold characters Mermaid rejects. */
function chart(f, fi) {
  const key = new Map(f.steps.map((s, i) => [s.id, `s${i}`]))
  const flagged = new Set((f.gaps ?? []).map((g) => g.step))
  const text = (s) => `${flagged.has(s.id) ? "⚠ " : ""}${s.label}`
  const edges = f.steps.flatMap((s) =>
    (s.next ?? []).map((n) => {
      const [from, to, when] = [key.get(s.id), key.get(target(n)), typeof n === "object" ? n.when : ""]
      if (!when) return `  ${from} --> ${to}`
      return f.kind === "state" ? `  ${from} --> ${to} : ${label(when, ":")}` : `  ${from} -->|"${label(when)}"| ${to}`
    }),
  )
  // Dashed for a guess, so the border is not read by color alone.
  const styles = KINDS.map((k) => `  classDef ${k} stroke:${COLORS[k]},stroke-width:3px${k === "inferred" ? ",stroke-dasharray:6 4" : ""}`)
  const classes = f.steps.map((s, i) => `  class s${i} ${strongest(s)}`)
  if (f.kind === "state")
    return ["stateDiagram-v2", `  [*] --> s0`, ...f.steps.map((s, i) => `  state "${label(text(s))}" as s${i}`), ...edges, ...styles, ...classes].join("\n")
  const clicks = f.steps.map((_, i) => `  click s${i} call showStep(${fi}, ${i})`) // indexes: an id may hold quotes or commas
  return ["flowchart TD", ...f.steps.map((s, i) => `  s${i}["${label(text(s))}"]`), ...edges, ...styles, ...classes, ...clicks].join("\n")
}

const where = (e) => `${e.file}${e.line ? `:${e.line}` : ""}`
const badge = (k, t) => `<span class="k k-${k}">${html(t.kinds[k])}</span>`

function flowSection(f, i, actors, t) {
  const gapLine = (g) => `<li><b>${html(t.gaps[g.type])}</b>${g.step ? ` · ${html(f.steps.find((s) => s.id === g.step)?.label)}` : ""}: ${html(g.text)}</li>`
  const steps = f.steps
    .map((s, j) => {
      const sources = s.evidence
        .map((e) => `<li>${badge(e.kind, t)} ${e.note ? `${html(e.note)} ` : ""}<code>${html(where(e))}</code>${e.proof ? ` · ${t.proof} <code>${html(e.proof)}</code>` : ""}</li>`)
        .join("")
      const gaps = (f.gaps ?? []).filter((g) => g.step === s.id).map((g) => `<p class="warn">⚠ ${html(t.gaps[g.type])}: ${html(g.text)}</p>`).join("")
      return `<li id="f${i}-s${j}" class="step"><h4>${html(s.label)} ${badge(strongest(s), t)}</h4>${gaps}<p class="src">${t.sources}</p><ul>${sources}</ul></li>`
    })
    .join("")
  const gaps = (f.gaps ?? []).map(gapLine).join("")
  return `<section id="flow-${i}" data-flow="${html(f.id)}"${i ? " hidden" : ""}>
<h2>${html(f.name ?? f.id)}</h2>
${f.summary ? `<p class="summary">${html(f.summary)}</p>` : ""}${f.actor ? `<p class="meta">${t.who}: ${html(actors.get(f.actor) ?? f.actor)}</p>` : ""}
<div class="attention"><h3>${t.attention}</h3>${gaps ? `<ul>${gaps}</ul>` : `<p>${t.none}</p>`}</div>
<pre class="mermaid">${html(chart(f, i))}</pre>
<h3>${t.steps}</h3><ol class="steps">${steps}</ol>
</section>`
}

/** The whole page. Every text from the map is escaped; charts render one flow at a time, when it is opened. */
export function render(map) {
  const t = Object.hasOwn(TEXT, map.lang ?? "") ? TEXT[map.lang] : TEXT.en
  const actors = new Map((map.actors ?? []).map((a) => [a.id, a.name ?? a.id]))
  const nav = map.flows
    .map((f, i) => `<li><button type="button" data-open="${i}">${html(f.name ?? f.id)}<small>${f.steps.length} ${t.nSteps}${f.gaps?.length ? ` · ⚠ ${f.gaps.length} ${t.nGaps}` : ""}</small></button></li>`)
    .join("")
  const legend = KINDS.map((k) => `<li><span class="sw sw-${k}"></span>${html(t.kinds[k])}</li>`).join("")
  return `<!doctype html>
<html lang="${map.lang ?? "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(map.title ?? t.title)}</title>
<style>
:root{--bg:#fff;--fg:#1c1c1c;--muted:#5f5f5f;--line:#ddd;--card:#f6f6f6;--warn:#8a5a00;--hit:#fff4cc}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#e8e8e8;--muted:#a0a0a0;--line:#333;--card:#1d1d1d;--warn:#e0b05a;--hit:#3a3220}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif}
.wrap{display:grid;grid-template-columns:minmax(220px,280px) 1fr;gap:28px;max-width:1200px;margin:auto;padding:16px}
@media (max-width:760px){.wrap{grid-template-columns:1fr}}main{min-width:0}
h1{font-size:22px;margin:4px 0 8px}h2{margin:0 0 4px}h3{margin:20px 0 8px;font-size:16px}h4{margin:0 0 6px;font-size:15px}
nav ul,.legend{list-style:none;padding:0;margin:0}nav li{margin:6px 0}
nav button{display:block;width:100%;font:inherit;color:inherit;background:none;border:1px solid var(--line);border-radius:8px;padding:8px 10px;cursor:pointer;text-align:left}
nav button small{display:block;color:var(--muted)}nav button[aria-current=true]{border-color:var(--fg);background:var(--card)}
.howto{font-size:14px;color:var(--muted)}.legend li{display:flex;gap:8px;align-items:center;margin:4px 0;font-size:14px}
.sw{width:18px;height:12px;border:3px solid;border-radius:3px}.sw-inferred{border-style:dashed}
.sw-verified{border-color:${COLORS.verified}}.sw-observed{border-color:${COLORS.observed}}.sw-documented{border-color:${COLORS.documented}}.sw-inferred{border-color:${COLORS.inferred}}
.summary{font-size:16px;margin:0 0 4px}.meta,.src,footer{color:var(--muted);font-size:13px}
.attention{border-left:4px solid var(--warn);background:var(--card);padding:4px 14px;border-radius:4px}.attention h3{margin-top:8px;color:var(--warn)}
pre.mermaid{overflow-x:auto;background:transparent;margin:16px 0}pre.mermaid svg{min-width:min(640px,100%)}@media (max-width:760px){pre.mermaid svg{min-width:640px}}
.steps{padding-left:22px}.step{background:var(--card);border-radius:8px;padding:10px 14px;margin:10px 0;scroll-margin-top:16px}
.step.hit{background:var(--hit)}.step ul{margin:4px 0;padding-left:18px}.src{margin:6px 0 0}.warn{color:var(--warn);margin:4px 0}
code{font-size:12px;color:var(--muted)}
.k{font-size:12px;font-weight:500;border:2px solid;border-radius:4px;padding:0 5px;white-space:nowrap}.k-inferred{border-style:dashed}
.k-verified{border-color:${COLORS.verified}}.k-observed{border-color:${COLORS.observed}}.k-documented{border-color:${COLORS.documented}}.k-inferred{border-color:${COLORS.inferred}}
</style></head><body><div class="wrap">
<nav><h1>${html(map.title ?? t.title)}</h1>
<h3>${t.howTo}</h3><p class="howto">${t.howToText}</p><ul class="legend">${legend}</ul>
<ul>${nav}</ul>
<footer>${t.built} ${html(String(map.commit ?? "?").slice(0, 7))}</footer></nav>
<main>${map.flows.map((f, i) => flowSection(f, i, actors, t)).join("\n")}</main>
</div>
<script type="module">
// Clicks work before and without Mermaid: a blocked or hanging CDN leaves each chart as its source text.
window.showStep = (i, j) => {
  const li = document.getElementById("f" + i + "-s" + j)
  if (!li) return
  document.querySelectorAll(".step.hit").forEach((x) => x.classList.remove("hit"))
  li.classList.add("hit")
  li.scrollIntoView({ block: "start", behavior: "smooth" })
}
document.addEventListener("click", (ev) => {
  const open = ev.target.closest("[data-open]")
  if (open) openFlow(open.dataset.open)
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
