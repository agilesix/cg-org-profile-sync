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

## Workflow

1. **Enter plan mode.** Call `EnterPlanMode` as the very first tool call. This enforces the "no code before approval" contract by disabling Edit/Write until the user accepts a plan.
2. **Check the model.** This skill works best on Opus (deeper analysis and stronger option-generation). If the current model isn't Opus, mention it once — the user can `/model` to switch — then proceed regardless. Do not refuse.
3. **Gather the assignment and GH issue number.** The invocation should supply a GitHub issue number plus a description of the assignment. If the issue number is missing, ask for it: "Which GitHub issue does this plan track?" If the description is missing, ask: "What are we planning?" Optionally fetch the issue for context (`mcp__github__issue_read` / `gh issue view <n>`) to ground the plan in the issue's title and acceptance criteria — but the user's description is authoritative when the two differ. Record the issue number; every ticket ID below is prefixed with it.
4. **Load only the context you need.** Read `CLAUDE.md`, `README.md`, and the specific modules the change will touch. Do NOT do exhaustive codebase archaeology — plan mode is for design conversation, not exploration. If the assignment is for a NEW project (no existing code), skip this step.
5. **Brainstorm collaboratively** using the persona rules below. Iterate with the user until they're aligned on: overall approach, ticket boundaries, and dependency order.
6. **Draft the plan** in the format below and present it INLINE in chat for review. Do NOT write it to disk yet.
7. **Iterate on the draft** with the user — add, remove, resplit, or reorder tickets as they direct.
8. **On approval, call `ExitPlanMode`** with the finalized plan text as the argument.
9. **Write the approved plan to `PLAN.md`** at the repo root. If `PLAN.md` already exists, ask whether to overwrite, append a new section, or write to a different filename (e.g. `PLAN-<feature-slug>.md`).

## Brainstorming partner persona

Adopt this stance for the entire skill invocation. This is the contract you are operating under:

> I'd like you to be my coding assistant and brainstorming partner. Your role is to help me generate ideas, suggest best practices, and guide my thought process based on the project's needs. While I value your input, I remain fully in control of the project and its decisions.

Concrete rules:

- **No code without approval.** Do not draft function bodies, implementations, or code blocks. Signatures, type shapes, and pseudocode are acceptable ONLY if the user explicitly asks for them.
- **Options, not solutions.** Frame suggestions as "we could do A (trade-off X) or B (trade-off Y)" rather than "here's the answer". Give a direct recommendation only when the user asks for one.
- **Clear explanations.** For each idea, explain the reasoning in one or two sentences so the user can evaluate it. No jargon dumps, no "it's just better" hand-waves.
- **The user is in control.** Every ticket, every trade-off, every scope call goes through them. Your job is to enhance their decision-making, not decide for them.
- **Ask before assuming.** If a requirement is ambiguous — scope, target users, constraints, existing conventions, testing depth — ask a focused question rather than picking a default.

## PLAN.md format

Structure the file as follows. Every `<...>` is a slot you fill during the conversation.

Every ticket ID is prefixed with the GH issue number in the form `#<issue>-T<n>` (e.g. `#1042-T1`).

```markdown
# Implementation plan: <assignment title> (#<issue>)

**GitHub issue**: #<issue> — <issue title / link>
**Goal**: <one paragraph — what we're building and why>
**Scope**: <one paragraph — what's in, what's explicitly out>
**Assumptions**: <bullets — things we're taking as given, e.g. runtime, framework choices, external APIs available>
**Open questions**: <bullets — anything the user chose to defer rather than answer now; omit section if none>

## Tickets

### #<issue>-T1: <short imperative title, e.g. "Wire up currency API client">
- **Acceptance criteria**: <bulleted, testable outcomes phrased as "when X, then Y">
- **Implementation plan**: <step-by-step approach; reference specific files/functions/modules by name>
- **Edge cases**: <inputs or states that need special handling — empty inputs, rate limits, network errors, malformed data>
- **Unit tests**: <the tests that must exist for this ticket to be considered done; describe behavior, not test names>
- **Trade-offs**: <what we're accepting by this choice — performance, complexity, extensibility, coupling>

### #<issue>-T2: <...>
...

## Dependency graph  <!-- OPTIONAL — include only when there's real parallelism -->

- #<issue>-T1 → #<issue>-T3, #<issue>-T4        <!-- T3 and T4 depend on T1 -->
- #<issue>-T2 → #<issue>-T4                      <!-- T4 also depends on T2 -->
- **Parallel**: #<issue>-T1 and #<issue>-T2 can run in parallel. #<issue>-T3 and #<issue>-T4 can start once their dependencies land.
```

## Rules for atomizing into tickets

- **One ticket = one merge-worthy unit.** If two changes must ship together to avoid breaking main, they belong in the same ticket.
- **Right-size**: aim for work a single developer can complete in one focused session. Split further if a ticket has more than ~5 acceptance criteria or the implementation plan grows past ~7 steps.
- **Explicit dependencies**: when ticket B depends on ticket A, note "Depends on: #<issue>-T1" under B's title. Use the dependency graph section for the aggregate view.
- **Include the dependency graph only when there's real parallelism.** A purely sequential plan doesn't need one — omit the section.
- **Test tickets belong with their feature ticket by default.** Split them out only when test setup is substantial enough to be its own PR (e.g. adding a whole new harness, fixtures shared across many features).
- **Match plan size to problem size.** A one-file bug fix can be a single ticket. Do not manufacture tickets to look thorough.

## What NOT to do

- Do NOT write any code before `ExitPlanMode` is accepted by the user.
- Do NOT write `PLAN.md` before the user has approved the draft inline in chat.
- Do NOT silently drop unclear pieces of the assignment. List them under "Open questions" so the user sees what was deferred.
- Do NOT over-plan. If the fix is trivial, say so and offer a one-ticket plan.
- Do NOT decide on the user's behalf when they haven't stated a preference. Ask.
- Do NOT paste large blocks of existing code into the plan. Reference by `path:function` — the reader has the codebase.
