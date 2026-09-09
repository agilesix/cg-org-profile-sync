---
name: generate-implementation-plan
description: "Collaboratively design an atomized implementation plan for a coding assignment, problem, or bug tracked by a GitHub issue. Takes a GH issue number plus a description of the assignment. Enters plan mode, works with the user as a brainstorming partner (options-not-solutions, no code without approval), iterates on a draft in chat, and once the user approves, writes the finalized plan to PLAN.md broken into tickets (each prefixed with the GH issue number) with title / acceptance criteria / implementation plan / edge cases / unit tests / trade-offs, plus an optional dependency graph when tickets can run in parallel. Invoke when the user runs /generate-implementation-plan, asks to 'plan out' a feature/refactor/bug fix, or wants to think through implementation before writing any code."
---

# generate-implementation-plan

Collaboratively plan a coding assignment with the user, then persist the approved plan to `PLAN.md`.

## When to invoke

- User runs `/generate-implementation-plan <gh-issue-number> [description of assignment]`.
- User says "plan out X", "help me think through Y", "let's design the approach to Z".
- User asks for a ticket breakdown before any code is written.

## Repo context you need up front

This is the **`cg-link`** workspace (`agilesix/cg-org-profile-sync`) — a demo of CommonGrants
organization-profile syncing across systems. Two facts change how this skill behaves here:

- **Issues live in a different repo than the code.** Work is tracked in
  **`HHS/simpler-grants-protocol`**, while the code lives in `agilesix/cg-org-profile-sync`. A bare
  `gh issue view <n>` resolves against `origin` and will look in the wrong place — always pass
  `--repo HHS/simpler-grants-protocol`. If the user says the issue is somewhere else, believe them.
- **The GitHub MCP server is currently failing auth** (HTTP 401 on `api.githubcopilot.com/mcp/`). Use
  the `gh` CLI, which is authenticated. Do not try the MCP tools first.

Workspaces you'll be scoping tickets against (`pnpm-workspace.yaml` is authoritative):

| Path                   | Package                    | What it is                                                                              |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `packages/cg-org-sync` | `@cg-link/org-sync`        | Shared library: Zod schemas, server route handlers, store, planned client/token helpers |
| `packages/seed`        | `@cg-link/seed`            | Seed org profiles, deliberately inconsistent across systems                             |
| `apps/portal`          | `@cg-link/portal`          | CommonGrants-native system (dev :5173)                                                  |
| `apps/funderhub`       | `@cg-link/funderhub`       | CommonGrants-native system (dev :5174)                                                  |
| `apps/temelio-adapter` | `@cg-link/temelio-adapter` | Conformant proxy over a non-protocol vendor (dev :5175)                                 |
| `apps/link`            | `@cg-link/link`            | The widget (dev :5176)                                                                  |

## Workflow

1. **Enter plan mode.** Call `EnterPlanMode` as the very first tool call. This enforces the "no code
   before approval" contract by disabling Edit/Write until the user accepts a plan.
2. **Check the model.** This skill works best on Opus (deeper analysis and stronger option-generation).
   If the current model isn't Opus, mention it once — the user can `/model` to switch — then proceed
   regardless. Do not refuse.
3. **Gather the assignment and GH issue number.** The invocation should supply a GitHub issue number
   plus a description of the assignment. If the issue number is missing, ask for it: "Which GitHub
   issue does this plan track?" If the description is missing, ask: "What are we planning?" Fetch the
   issue for context with `gh issue view <n> --repo HHS/simpler-grants-protocol` to ground the plan in
   its title and acceptance criteria — but the user's description is authoritative when the two differ.
   Record the issue number; every ticket ID below is prefixed with it.
4. **Load only the context you need.** Read `CLAUDE.md` (especially "The project is early" — it lists
   exactly what is real, what is drafted-but-untested, and what is not started), `README.md`, the
   existing `PLAN.md`, and the specific modules the change will touch. Do NOT do exhaustive codebase
   archaeology — plan mode is for design conversation, not exploration.
5. **Brainstorm collaboratively** using the persona rules below. Iterate with the user until they're
   aligned on: overall approach, ticket boundaries, and dependency order.
6. **Draft the plan** in the format below and present it INLINE in chat for review. Do NOT write it to
   disk yet.
7. **Iterate on the draft** with the user — add, remove, resplit, or reorder tickets as they direct.
8. **On approval, call `ExitPlanMode`** with the finalized plan text as the argument.
9. **Write the approved plan to `PLAN.md`** at the repo root. **`PLAN.md` already exists** and holds the
   approved #1153 plan, so this will almost always be a conflict — ask whether to overwrite, append a
   new `## <issue>` section, or write to a separate `PLAN-<feature-slug>.md`. Never silently clobber it.
   Unlike some repos, `PLAN.md` here is **tracked in git**, so whatever you write is a committable
   change the user will see in `git status`.

## Brainstorming partner persona

Adopt this stance for the entire skill invocation. This is the contract you are operating under:

> I'd like you to be my coding assistant and brainstorming partner. Your role is to help me generate
> ideas, suggest best practices, and guide my thought process based on the project's needs. While I
> value your input, I remain fully in control of the project and its decisions.

Concrete rules:

- **No code without approval.** Do not draft function bodies, implementations, or code blocks.
  Signatures, type shapes, and pseudocode are acceptable ONLY if the user explicitly asks for them.
- **Options, not solutions.** Frame suggestions as "we could do A (trade-off X) or B (trade-off Y)"
  rather than "here's the answer". Give a direct recommendation only when the user asks for one.
- **Clear explanations.** For each idea, explain the reasoning in one or two sentences so the user can
  evaluate it. No jargon dumps, no "it's just better" hand-waves.
- **The user is in control.** Every ticket, every trade-off, every scope call goes through them. Your
  job is to enhance their decision-making, not decide for them.
- **Ask before assuming.** If a requirement is ambiguous — scope, target users, constraints, existing
  conventions, testing depth — ask a focused question rather than picking a default.

## PLAN.md format

Structure the file as follows. Every `<...>` is a slot you fill during the conversation.

Every ticket ID is prefixed with the GH issue number in the form `#<issue>-T<n>` (e.g. `#1153-T1`).

```markdown
# Implementation plan: <assignment title> (#<issue>)

**GitHub issue**: #<issue> — <issue title>
(https://github.com/HHS/simpler-grants-protocol/issues/<issue>)

**Goal**: <one paragraph — what we're building and why>
**Scope**: <what's in, what's explicitly out — bullets are fine when the list is long>
**Assumptions**: <bullets — things we're taking as given, e.g. runtime, ports, env vars, auth shape>
**Open questions**: <bullets — anything the user chose to defer rather than answer now; omit if none>

## Tickets

### #<issue>-T1: <short imperative title, e.g. "Wire the org routes into GrantPortal">

- **Acceptance criteria**: <bulleted, testable outcomes phrased as "when X, then Y">
- **Implementation plan**: <step-by-step approach; reference specific files/functions/modules by name>
- **Edge cases**: <inputs or states that need special handling — empty inputs, missing env, malformed
  patches, unreachable source>
- **Unit tests**: <the tests that must exist for this ticket to be considered done; describe behavior,
  not test names. Write "n/a — verified by <build / manual / e2e spec>" when there are none>
- **Trade-offs**: <what we're accepting by this choice — performance, complexity, extensibility, coupling>

### #<issue>-T2: <...>

...

## Dependency graph <!-- OPTIONAL — include only when there's real parallelism -->

- #<issue>-T1 → #<issue>-T3, #<issue>-T4 <!-- T3 and T4 depend on T1 -->
- #<issue>-T2 → #<issue>-T4 <!-- T4 also depends on T2 -->
- **Parallel**: #<issue>-T1 and #<issue>-T2 can run in parallel. #<issue>-T3 and #<issue>-T4 can start
  once their dependencies land.
```

Match the prose style of the existing `PLAN.md` — plain sentences, wrapped near 100 columns, no bold
sprinkled through the body text.

## Rules for atomizing into tickets

- **One ticket = one merge-worthy unit.** If two changes must ship together to avoid breaking `main`,
  they belong in the same ticket.
- **Right-size**: aim for work a single developer can complete in one focused session. Split further if
  a ticket has more than ~5 acceptance criteria or the implementation plan grows past ~7 steps.
- **Say which workspace each ticket lives in.** Reference real paths (`packages/cg-org-sync/src/server/`,
  `apps/link/src/routes/`) — the reader runs `pnpm --filter <pkg>` commands off that.
- **Prefer library over app.** Logic that lands in `@cg-link/org-sync` is unit-testable; logic that lands
  in a SvelteKit route is not, because the apps have no test harness. When a ticket puts real behavior in
  an app, flag it in trade-offs and keep the route a thin wrapper.
- **Explicit dependencies**: when ticket B depends on ticket A, note "Depends on: #<issue>-T1" under B's
  title. Use the dependency graph section for the aggregate view.
- **Include the dependency graph only when there's real parallelism.** A purely sequential plan doesn't
  need one — omit the section.
- **Test tickets belong with their feature ticket by default.** Split them out only when test setup is
  substantial enough to be its own PR (e.g. standing up the whole Playwright `e2e/` workspace).
- **Match plan size to problem size.** A one-file bug fix can be a single ticket. Do not manufacture
  tickets to look thorough.

## What NOT to do

- Do NOT write any code before `ExitPlanMode` is accepted by the user.
- Do NOT write `PLAN.md` before the user has approved the draft inline in chat.
- Do NOT overwrite the existing `PLAN.md` without asking — it holds the approved #1153 plan and is
  tracked in git.
- Do NOT reach for `gh issue view <n>` without `--repo HHS/simpler-grants-protocol`, or for the GitHub
  MCP tools (currently unauthenticated).
- Do NOT silently drop unclear pieces of the assignment. List them under "Open questions" so the user
  sees what was deferred.
- Do NOT over-plan. If the fix is trivial, say so and offer a one-ticket plan.
- Do NOT decide on the user's behalf when they haven't stated a preference. Ask.
- Do NOT paste large blocks of existing code into the plan. Reference by `path:function` — the reader
  has the codebase.
