#!/bin/bash
# A folder holding two repos (the layout of a multi-repo workspace); the folder itself is not a repo.
set -e
for r in web api; do
  mkdir -p $r/src $r/scripts $r/.claude
  (cd $r && git init -q && git config user.email eval@example.com && git config user.name eval)
done
cat > web/scripts/check.sh <<'X'
#!/bin/bash
# Fails on arbitrary Tailwind values and on weights other than normal/medium.
if grep -rnE -- '-\[[^]]*\]|font-(semibold|bold|extrabold|black)' "$@"; then
  echo "Design rule broken: use the Tailwind default scale; weights are font-normal and font-medium only." >&2
  exit 1
fi
X
cat > web/src/Card.tsx <<'X'
export function Card({ title }: { title: string }) {
  return <h3 className="text-sm font-medium">{title}</h3>
}
X
cat > web/.claude/sdlc.json <<'X'
{
  "verify": "bash scripts/check.sh src",
  "check": [{ "glob": "src/**/*.tsx", "run": "bash scripts/check.sh {file}" }]
}
X
echo 'export const ok = true' > api/src/index.ts
echo '{ "verify": "true" }' > api/.claude/sdlc.json
for r in web api; do (cd $r && git add -A && git commit -qm init); done
