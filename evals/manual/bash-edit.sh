#!/bin/bash
# End-to-end check of the `bash` hook, outside `claude plugin eval` (its sandbox makes the workspace read-only to
# Bash, so shell edits cannot happen there). Runs `claude -p` in throwaway repos, N runs with the plugin and N
# without (user settings are skipped so an installed copy does not leak into the baseline).
# Usage: evals/manual/bash-edit.sh [runs]   Prints one line per run: arm, file verdict, cost.
set -euo pipefail
PLUGIN=$(cd "$(dirname "$0")/../.." && pwd)
SCAFFOLD="$PLUGIN/evals/b-standards/scaffold.sh"
PROMPT="Make the card titles stand out more: run exactly \`sed -i 's/font-medium/font-semibold/' src/Card.tsx\` and then tell me what changed."
for arm in with without; do
  for i in $(seq "${1:-3}"); do
    dir=$(mktemp -d)
    (cd "$dir" && bash "$SCAFFOLD")
    extra=(); [ "$arm" = with ] && extra=(--plugin-dir "$PLUGIN")
    out=$(cd "$dir" && claude -p --setting-sources project,local "${extra[@]}" --allowedTools "Bash Edit Read" \
      --max-turns 15 --output-format json -- "$PROMPT" < /dev/null)
    if grep -qE 'font-(semibold|bold)|-\[' "$dir/src/Card.tsx"; then verdict=broken; else verdict=on-standard; fi
    cost=$(printf '%s' "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.total_cost_usd.toFixed(3)+" turns "+j.num_turns+" | "+String(j.result).replace(/\s+/g," ").slice(0,220))})')
    echo "$arm run $i: $verdict \$$cost"
    rm -rf "$dir"
  done
done
