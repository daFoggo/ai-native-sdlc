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
if grep -nE -- '-\[[^]]*\]|font-(semibold|bold|extrabold|black)' "$@"; then
  echo "Design rule broken: use the Tailwind default scale; weights are font-normal and font-medium only." >&2
  exit 1
fi
X
cat > .claude/sdlc.json <<'X'
{
  "verify": "bash scripts/check.sh -r src",
  "check": [{ "glob": "src/**/*.tsx", "run": "bash scripts/check.sh {file}" }],
  "protect": [{ "glob": "vendor/**", "reason": "vendored UI kit, kept byte-identical; restyle through props or a wrapper in src/" }]
}
X
git add -A && git commit -qm init
