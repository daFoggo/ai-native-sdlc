# Spec: a business map page people can read (lane M)
Status: approved (owner: "giao diện business map … khó hiểu quá", calls delegated). Base: fccb53e.

## Requirements
1. The page explains itself: a "how to read" paragraph and a legend in plain words next to the flow list.
2. `map.lang` (`vi` | `en`, default `en`) sets every word the page itself prints; any other value is a validation problem.
3. Each flow shows its optional `summary` under the title, then "Needs attention" (its gaps) before the chart.
4. `next` items may be `{ to, when }`; `when` is drawn on the arrow (flowchart `-->|"when"|`, state `--> : when`,
   with `:` escaped). A `{}` without a valid `to` is a validation problem.
5. Each box's border shows the strongest evidence of its step (verified > observed > documented > inferred; inferred
   dashed); a step with a gap gets "⚠ " in its box.
6. Every step's sources and open questions are visible without clicking; clicking a box scrolls to and highlights
   its step.
7. The commit moves to a footer ("Built from commit <7 chars>"). The page never scrolls sideways; a wide chart
   scrolls inside its frame and keeps at least 640px on narrow screens.
8. Existing guarantees hold: escaping, no static import, first flow visible without script, index-based clicks.
9. `map.title` (optional) names the page in `<title>` and `<h1>`; without it the page uses the language's default title.
