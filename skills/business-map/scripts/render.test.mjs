import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import { render, validate } from "./render.mjs"

// What the browser reads from the page: the Mermaid source is HTML-escaped inside <pre>.
const text = (h) => h.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")

const SCRIPT = fileURLToPath(new URL("./render.mjs", import.meta.url))

const map = () => ({
  version: 1,
  commit: "abc1234",
  actors: [{ id: "buyer", name: "Buyer" }],
  flows: [
    {
      id: "checkout",
      name: "Checkout",
      actor: "buyer",
      kind: "flow",
      steps: [
        { id: "a-b.c", label: 'Pay "now" <script>x</script>', next: ["done"], evidence: [{ file: "app/pay.ts", line: 12, kind: "observed" }] },
        { id: "done", label: "Paid", next: [], evidence: [{ file: "docs/pay.md", kind: "documented", note: "a < b" }] },
      ],
      gaps: [{ step: "done", type: "untested", text: "no test asserts the receipt" }],
    },
    {
      id: "order",
      name: "Order",
      actor: "buyer",
      kind: "state",
      steps: [
        { id: "open", label: "Open", next: ["closed"], evidence: [{ file: "app/order.ts", kind: "verified", proof: "verify/features/order.md" }] },
        { id: "closed", label: "Closed\nfor good", next: ["open"], evidence: [{ file: "app/order.ts", kind: "inferred" }] },
      ],
      gaps: [],
    },
  ],
})

test("validate accepts a good map", () => {
  assert.deepEqual(validate(map()), [])
})

test("validate names every problem", () => {
  const m = map()
  const [pay, done] = m.flows[0].steps
  pay.evidence[0].kind = "guess"
  pay.next = ["nowhere"]
  done.evidence = []
  m.flows[0].gaps.push({ step: "ghost", type: "owner", text: "x" }, { type: "vibes", text: "x" })
  m.flows[1].steps[0].evidence[0].proof = undefined
  m.flows[1].steps[1].id = "open"
  m.flows[1].actor = "nobody"
  const problems = validate(m).join("\n")
  for (const p of [/guess/, /nowhere/, /done.*no evidence/, /ghost/, /vibes/, /verified.*proof/, /duplicate.*open/, /nobody/])
    assert.match(problems, p)
  assert.ok(validate({}).length) // no flows array
})

test("render escapes labels for HTML and Mermaid and uses both chart kinds", () => {
  const html = render(map())
  assert.match(html, /flowchart TD/)
  assert.match(html, /stateDiagram-v2/)
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/mermaid@11\.4\.1/)
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.match(html, /a &lt; b/)
  assert.doesNotMatch(html, /a-b\.c\[/) // raw ids never reach Mermaid
  assert.match(html, /app\/pay\.ts:12/)
})

test("render works without Mermaid: the first flow is visible and the CDN load cannot stop the script", () => {
  const html = render(map())
  assert.match(html, /<section id="flow-0" data-flow="checkout">/) // not hidden before any script runs
  assert.match(html, /<section id="flow-1" data-flow="order" hidden>/)
  assert.doesNotMatch(html, /^import mermaid/m) // a static import that fails kills the whole module
  assert.doesNotMatch(html, /^\s*(let \w+ = )?.*await import\(/m) // a CDN that hangs must not hold the clicks
  assert.ok(html.indexOf('addEventListener("click"') < html.indexOf('import("https://cdn.jsdelivr.net/npm/mermaid@11.4.1'))
})

test("R1-2: validate reports wrong shapes instead of throwing or passing", () => {
  const m = map()
  m.flows[0].steps[0].next = "done"
  assert.match(validate(m).join("\n"), /next must be a list/)
  assert.match(validate({ actors: {}, flows: [] }).join("\n"), /actors must be a list/)
  assert.match(validate({ flows: [null] }).join("\n"), /flow 0 is not an object/)
  const e = map()
  e.flows[0].steps[0].evidence = "app/pay.ts"
  assert.match(validate(e).join("\n"), /evidence must be a list/)
})

test("readable: how-to-read, summary, conditions on arrows, confidence colors, attention first", () => {
  const m = map()
  m.flows[0].summary = "Buyer pays and gets a receipt"
  m.flows[0].steps[0].next = [{ to: "done", when: "card accepted" }]
  const html = render(m)
  assert.match(html, /How to read this map/)
  assert.match(html, /Buyer pays and gets a receipt/)
  assert.match(text(html), /s0 -->\|"card accepted"\| s1/)
  assert.match(html, /class s0 observed/) // node colored by its strongest evidence
  assert.match(html, /class s1 documented/)
  assert.ok(html.indexOf("Needs attention") < html.indexOf('<pre class="mermaid">')) // gaps before the chart
  assert.match(html, /⚠ Paid/) // a step with a gap is marked on the chart
  assert.doesNotMatch(html, /<div class="ev" hidden>/) // evidence is visible without clicking
  assert.match(html, /Built from commit abc1234/)
})

test("readable: Vietnamese page when the map says lang vi; conditions on state arrows", () => {
  const m = map()
  m.lang = "vi"
  m.flows[1].steps[0].next = [{ to: "closed", when: "đã giao: xong" }]
  const html = render(m)
  assert.match(html, /<html lang="vi">/)
  assert.match(html, /Cách đọc bản đồ/)
  assert.match(html, /Đã thấy trong code/)
  assert.match(text(html), /s0 --> s1 : đã giao#58; xong/)
  assert.match(validate({ ...map(), lang: "fr" }).join("\n"), /lang fr/)
  const bad = map()
  bad.flows[0].steps[0].next = [{ when: "x" }]
  assert.match(validate(bad).join("\n"), /next undefined is not a step/)
})

test("readable R1: the map's title names the page; an inherited name is not a language", () => {
  const html = render({ ...map(), title: "Shop <map>" })
  assert.match(html, /<title>Shop &lt;map&gt;<\/title>/)
  assert.match(html, /<h1>Shop &lt;map&gt;<\/h1>/)
  assert.match(render(map()), /<title>Business map<\/title>/)
  assert.match(validate({ ...map(), lang: "constructor" }).join("\n"), /lang constructor/)
})

test("R2-1: a null inside evidence, gaps or actors is a listed problem, not a render crash", () => {
  const m = map()
  m.flows[0].steps[0].evidence.push(null)
  m.flows[0].gaps.push(null)
  m.actors.push(null)
  const problems = validate(m).join("\n")
  assert.match(problems, /evidence 1 is not an object/)
  assert.match(problems, /gap 1 is not an object/)
  assert.match(problems, /actor 1 is not an object/)
})

test("R1-3: a flow id with quotes or commas still gives a clickable chart", () => {
  const m = map()
  m.flows[0].id = 'a"b,)'
  const html = render(m)
  assert.match(html, /click s0 call showStep\(0, 0\)/)
})

test("the CLI writes index.html for a valid map and nothing for an invalid one", () => {
  const ok = mkdtempSync(join(tmpdir(), "bmap-"))
  writeFileSync(join(ok, "map.json"), JSON.stringify(map()))
  assert.equal(spawnSync("node", [SCRIPT, ok]).status, 0)
  assert.ok(existsSync(join(ok, "index.html")))
  const bad = mkdtempSync(join(tmpdir(), "bmap-"))
  writeFileSync(join(bad, "map.json"), JSON.stringify({ version: 1, flows: [{ id: "f", kind: "nope", steps: [] }] }))
  const r = spawnSync("node", [SCRIPT, bad], { encoding: "utf8" })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /nope/)
  assert.equal(existsSync(join(bad, "index.html")), false)
})
