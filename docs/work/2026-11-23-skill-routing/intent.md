# Intent: skill routing by path, restate step, business map
Author: repo owner. Status: accepted (the owner delegated the calls: "cứ tự đề xuất mà làm", 2026-11-23).
Source: conversation 2026-11-23. Record: none

## Problem
Agents rarely invoke the skills a repo installs for its stack (vercel-react-best-practices on Next.js code,
fastapi and supabase-postgres-best-practices on the backend) until the owner forces them. A skill only shows as a
name and a description among ~100 others, and nothing makes the agent load it. It happens on every session in the
wattprint repos. BA and testers also have no view of the project's business flows tied to the code.

## Proposed outcome
1. A repo maps code paths to skills in `sdlc.json`; the first edit of a matching file is refused once until that
   skill is loaded, in the main agent and in each subagent.
2. Lanes M and L start with a short restatement of the goal, the problem, assumptions and the questions that would
   change the direction.
3. (Second change) a `business-map` skill builds an evidence-linked map of business flows (`map.json` + HTML), and
   the review package lists the flows whose evidence a change touched.
4. The work runs through sdlc on this repo, and every slow, stalled, repeated or costly step is logged in
   `friction.md` with a fix.

## Affected users and systems
Hooks (`hooks/sdlc.mjs`), the `sdlc` and `sdlc-init` skills, the config template, README. Every repo that opts in.

## Constraints
No new hook events or matchers (each hook call is a node start on every tool use). Never wedge a session: a refusal
happens once per skill per agent. Repos without a `skills` key behave exactly as today. Out of scope for change 1:
business-map and the review-package flow section.

## Open questions
None blocking; the owner delegated the calls.
