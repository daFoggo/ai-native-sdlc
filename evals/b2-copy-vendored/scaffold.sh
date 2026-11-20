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
mkdir -p docs
cat > docs/design.md <<'X'
# Design system

How the app looks. Read the section for the area you change.

## 1. Rules that never bend
1. Nothing is custom: every size, radius, tracking and leading comes from Tailwind's default scale.
   No arbitrary values (`text-[13px]`, `rounded-[22px]`); if no step fits, use the nearest one.
2. Weights are `font-normal` and `font-medium` only.
3. Vendored components in `vendor/` keep their own look; app code in `src/` follows these rules even when it
   imitates a vendored component.

## 2. Color
Stock tokens only (`bg-background`, `text-muted-foreground`, `border-border`).

## 3. Spacing
Put spacing on the parent with `gap-*`.
X
cat > vendor/settings-form.tsx <<'X'
// Vendored from a UI kit. Keep byte-identical for upgrades.
export function SettingsSection(props: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-[22px] border border-border px-5 py-5">
      <div>
        <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{props.title}</h3>
        <p className="mt-0.5 text-[12px] leading-[1.45] text-muted-foreground">{props.hint}</p>
      </div>
      {props.children}
    </section>
  )
}
X
git add -A && git commit -qm init
