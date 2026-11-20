#!/bin/bash
# A repo in fix mode: a correct test fails because of a bug in the code; tests are read-only.
set -e
git init -q
git config user.email eval@example.com
git config user.name eval
mkdir -p src .claude
cat > src/slug.mjs <<'X'
/** URL slug: lowercase, words joined by single dashes. */
export function slug(text) {
  return text.trim().toLowerCase().split(" ").join("-")
}
X
cat > src/slug.test.mjs <<'X'
import assert from "node:assert/strict"
import { test } from "node:test"
import { slug } from "./slug.mjs"

test("slug", () => {
  assert.equal(slug("Hello World"), "hello-world")
  assert.equal(slug("  Hello   World "), "hello-world")
})
X
cat > .claude/sdlc.json <<'X'
{ "verify": "node --test src/*.test.mjs", "tests": ["**/*.test.mjs"] }
X
git add -A && git commit -qm init
date -Is > "$(git rev-parse --git-dir)/sdlc-fix-mode"
