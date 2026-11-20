#!/bin/bash
# Shared scaffold: a tiny repo with one standard (Tailwind default scale, two weights) and a vendored folder.
set -e
git init -q
git config user.email eval@example.com
git config user.name eval
mkdir -p src vendor scripts .claude
cat > src/Card.tsx <<'X'
export function Card({ title }: { title: string }) {
  return (
    <div className="rounded-xl border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
    </div>
  )
}
X
cat > vendor/button.tsx <<'X'
// Vendored from a UI kit. Keep byte-identical for upgrades.
export function Button(props: { children: React.ReactNode }) {
  return <button className="rounded-md px-3 py-2">{props.children}</button>
}
X
cat > scripts/check.sh <<'X'
#!/bin/bash
# Fails on arbitrary Tailwind values and on weights other than normal/medium.
if grep -rnE -- '-\[[^]]*\]|font-(semibold|bold|extrabold|black)' "$@"; then
  echo "Design rule broken: use the Tailwind default scale; weights are font-normal and font-medium only." >&2
  exit 1
fi
X
cat > .claude/sdlc.json <<'X'
{
  "verify": "bash scripts/check.sh src",
  "check": [{ "glob": "src/**/*.tsx", "run": "bash scripts/check.sh {file}" }],
  "protect": [{ "glob": "vendor/**", "reason": "vendored UI kit, kept byte-identical; restyle through props or a wrapper in src/" }]
}
X
git add -A && git commit -qm init
cat > src/cart.ts <<'X'
export function total(items: { price: number; qty: number }[]) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0)
}
X
git add -A && git commit -qm "cart total"
cat > src/cart.ts <<'X'
export function total(lines: { price: number; qty: number }[]) {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0)
}

/** Price after a percentage discount, e.g. applyDiscount(200, 10) === 180. */
export function applyDiscount(price: number, percent: number) {
  return price * (percent / 100)
}

/** The items on 1-based page `n` of the given size. */
export function page<T>(items: T[], n: number, size: number) {
  return items.slice((n - 1) * size, n * size - 1)
}
X
git add -A && git commit -qm "feat(cart): discounts and paging"
git diff HEAD~1 HEAD > change.diff
