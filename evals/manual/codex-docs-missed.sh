#!/bin/bash
# b3-docs-missed on Codex: the task copies pixel values from a vendored file and nothing points at docs/, so only
# the sdlc hooks can catch the off-scale classes. N runs with the plugin, N with Codex hooks switched off (the skill
# still loads, so the difference is what the hooks add).
# Needs: `codex plugin add sdlc@ai-native-sdlc`. Uses your Codex plan, not an API key.
# Usage: evals/manual/codex-docs-missed.sh [runs]
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PROMPT=$(sed -n 's/^  prompt: "\(.*\)"$/\1/p' "$ROOT/evals/b3-docs-missed/case.yaml")
for arm in with hooks-off; do
  for i in $(seq "${1:-3}"); do
    dir=$(mktemp -d)
    (cd "$dir" && bash "$ROOT/evals/b3-docs-missed/scaffold.sh" >/dev/null)
    extra=(); [ "$arm" = hooks-off ] && extra=(--disable hooks)
    (cd "$dir" && timeout 900 codex exec --trust --dangerously-bypass-hook-trust --skip-git-repo-check -s workspace-write \
      "${extra[@]}" "$PROMPT" < /dev/null > "$dir/out.txt" 2>&1)
    f="$dir/src/LocationCard.tsx"
    if [ ! -f "$f" ]; then v=missing; elif grep -qE -- '-\[[^]]*\]|font-(semibold|bold|extrabold|black)' "$f"; then v=broken; else v=on-standard; fi
    hooks=$(grep -c "^hook: PostToolUse" "$dir/out.txt")
    echo "$arm run $i: $v (PostToolUse hooks run: $hooks)"
    [ "$v" = missing ] && tail -5 "$dir/out.txt" | sed 's/^/    /'
    rm -rf "$dir"
  done
done
