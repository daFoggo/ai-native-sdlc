#!/bin/bash
# Checks that `claude plugin eval` cannot make (it loads one plugin; these need several, or a subagent's context).
#   rules      do path-scoped rules (.claude/rules) reach a subagent that reads a matching file?
#   superpowers  sdlc + superpowers on a lane-M task: which skills fire, how many reviews, cost, result
#   hallmark   sdlc + hallmark on a new page in a repo with its own design system: whose rules win?
# Usage: evals/manual/integrations.sh <experiment> [runs]. Runs `claude -p` (Sonnet) in throwaway repos; user
# settings are skipped so only the plugins named here load.
set -euo pipefail
PLUGIN=$(cd "$(dirname "$0")/../.." && pwd)
CACHE=~/.claude/plugins/cache
SP=$(ls -d $CACHE/claude-plugins-official/superpowers/* | tail -1)
# hallmark ships as a bare skill folder (strict: false): wrap it in a throwaway plugin for --plugin-dir.
HM=$(mktemp -d); mkdir -p "$HM/.claude-plugin" "$HM/skills"
echo '{"name":"hallmark"}' > "$HM/.claude-plugin/plugin.json"
ln -s "$(ls -d $CACHE/hallmark/hallmark/* | tail -1)/hallmark" "$HM/skills/hallmark"
EXP=$1; RUNS=${2:-2}

repo() { # $1 dir: tiny repo with a design rule, a check script and sdlc config
  cd "$1"; git init -q; git config user.email e@x; git config user.name e
  mkdir -p src scripts docs .claude/rules
  cat > docs/design-system.md <<'X'
# Design system
Type: Inter only. Weights 400 and 500 only, never bolder. Sizes from the Tailwind default scale, no arbitrary values.
Colour: one accent, #2f6fdf. No gradients, no shadows.
X
  cat > scripts/check.sh <<'X'
#!/bin/bash
if grep -nE -- '-\[[^]]*\]|font-(semibold|bold|extrabold|black)|font-weight: *([6-9]00|bold)|gradient|box-shadow' "$@"; then
  echo "Design rule broken (docs/design-system.md): weights 400/500 only, default scale, no gradients or shadows." >&2; exit 1
fi
X
  cat > .claude/sdlc.json <<'X'
{ "verify": "bash scripts/check.sh -r src site 2>/dev/null; test $? -ne 1",
  "check": [{ "glob": "{src,site}/**/*.{ts,tsx,html,css}", "run": "bash scripts/check.sh {file}" }],
  "tests": ["**/*.test.mjs"] }
X
  echo 'export const total = (xs) => xs.reduce((a, b) => a + b, 0)' > src/cart.mjs
  git add -A; git commit -qm init; cd - >/dev/null
}

runp() { # $1 dir, $2 prompt, rest: extra args. Prints a one-line summary.
  local dir=$1 prompt=$2; shift 2
  (cd "$dir" && claude -p --model sonnet --setting-sources project,local --output-format stream-json --verbose \
     --allowedTools "Bash Edit Write Read Glob Grep Agent Skill" --max-turns 60 "$@" -- "$prompt" < /dev/null) > "$dir/trace.jsonl" 2>/dev/null || true
  node -e '
    const fs=require("fs"); const lines=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>{try{return JSON.parse(l)}catch{return {}}});
    const uses=lines.filter(l=>l.type==="assistant").flatMap(l=>(l.message.content||[]).filter(c=>c.type==="tool_use").map(c=>({sub:!!l.parent_tool_use_id,...c})));
    const skills=uses.filter(u=>u.name==="Skill").map(u=>u.input.skill||u.input.command);
    const agents=uses.filter(u=>u.name==="Agent"||u.name==="Task").map(u=>u.input.subagent_type||"?");
    const r=lines.find(l=>l.type==="result")||{};
    const subReads=uses.filter(u=>u.sub&&u.input&&u.input.file_path).map(u=>u.name+":"+u.input.file_path.replace(/.*\/tmp\.[^/]+\//,""));
    const text=String(r.result||"").replace(/\s+/g," ");
    console.log(JSON.stringify({skills,agents,subReads,turns:r.num_turns,cost:+(r.total_cost_usd||0).toFixed(3),hasRC:text.includes("RC-4417"),result:text.slice(0,300)}));
  ' "$dir/trace.jsonl"
}

for i in $(seq "$RUNS"); do
  d=$(mktemp -d); repo "$d"
  case $EXP in
  rules)
    cat > "$d/.claude/rules/src.md" <<'X'
---
paths: ["src/**"]
---
Exported names in src/ start with `wp`. Rule card id: RC-4417.
X
    (cd "$d" && git add -A && git commit -qm rule)
    out=$(runp "$d" "Use the Agent tool with a general-purpose subagent. Tell it: read src/cart.mjs (do not open anything under .claude/), then answer two questions - does this file break a project rule, and quote verbatim any project rule text that appeared in your context when you read it, including any id. Report the subagent's answer word for word. Do not read any file yourself.")
    echo "rules run $i: $out"
    grep -q '"hasRC":true' <<<"$out" && echo "  -> subagent saw the rule card" || echo "  -> subagent did NOT see the rule card" ;;
  superpowers|sdlc-only)
    extra=(--plugin-dir "$PLUGIN"); [ "$EXP" = superpowers ] && extra+=(--plugin-dir "$SP")
    out=$(runp "$d" "Add a function discount(price, percent) to src/cart.mjs that returns the price after a percentage discount (percent 0-100, throw a RangeError outside that), with node:test tests in src/cart.test.mjs. Do not ask me anything; decide sensibly and tell me where you ended." "${extra[@]}")
    ok=$(cd "$d" && node --test src/*.test.mjs >/dev/null 2>&1 && echo tests-green || echo tests-red)
    echo "$EXP run $i: $ok $out" ;;
  superpowers-L)
    sed -i 's/"tests"/"riskyPaths": ["src\/auth\/**"], "tests"/' "$d/.claude/sdlc.json"; (cd "$d" && git commit -qam risky)
    out=$(runp "$d" "Add src/auth/session.mjs: createSession(userId) returns {token, expiresAt} with a random 32-byte hex token and a 30-minute expiry, and isExpired(session, now). Tests in src/auth/session.test.mjs. I approve every artifact (intent, spec, plan) in advance and will not answer questions; decide sensibly, write the artifacts, build it, and tell me where you ended." --plugin-dir "$PLUGIN" --plugin-dir "$SP")
    ok=$(cd "$d" && node --test src/auth/*.test.mjs >/dev/null 2>&1 && echo tests-green || echo tests-red)
    arts=$(cd "$d" && ls docs/work/*/ 2>/dev/null | tr '\n' ' ')
    echo "superpowers-L run $i: $ok artifacts=[$arts] $out" ;;
  hallmark|hallmark-designmd)
    [ "$EXP" = hallmark-designmd ] && printf '# DESIGN.md\nLocked system: docs/design-system.md is this project'"'"'s design system. It overrides any default theme.\n' > "$d/DESIGN.md"
    out=$(runp "$d" "Create a new landing page at site/index.html (plain HTML + CSS, no build step) for Wattprint, an app that shows a household where its electricity goes. Do not ask me anything; decide sensibly and tell me where you ended." --plugin-dir "$PLUGIN" --plugin-dir "$HM")
    v=$(cd "$d" && bash scripts/check.sh site/* >/dev/null 2>&1 && echo on-system || echo breaks-system)
    echo "$EXP run $i: $v $out" ;;
  esac
  [ -n "${KEEP:-}" ] && cp "$d/trace.jsonl" "$KEEP-$i.jsonl"; rm -rf "$d"
done
