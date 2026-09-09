---
name: implement-ticket
description: "Pick up a specific ticket from PLAN.md and drive it to completion via TDD. Tickets are identified by GH-issue-prefixed IDs in the form #<issue>-T<n> (e.g. #1034-T3). Reads the ticket, delegates failing-test authorship to the test-writer subagent, implements the feature to make tests pass, delegates review to the reviewer subagent, prompts the user for approval, and on approval commits via GitHub MCP with a descriptive message (including ticket ID and files changed) and marks the ticket done in PLAN.md. Invoke when the user runs /implement-ticket <ticket-id>, says 'implement #1034-T3 from PLAN.md', or asks to work on a specific ticket from the plan."
---

# implement-ticket

Drive one ticket from `PLAN.md` to a committed, reviewed implementation using TDD.

## Model preference

This skill is designed for **Sonnet** — the work is mechanical (read spec → write failing test → implement → run review), not architectural. If the current model is Opus, mention it once ("you can `/model` to Sonnet 4.6 to save cost and iterate faster") and proceed regardless. Do not refuse.

*Note*: the current top Sonnet is `claude-sonnet-4-6`. There is no Sonnet 5 yet — if the user asks for it, use 4.6.

## When to invoke

- User runs `/implement-ticket <ticket-id>` (e.g. `/implement-ticket #1034-T3`).
- User says "implement #1034-T2", "work on ticket #1034-T5", "let's do #1034-T1 next", "pick up #1034-T4".
- User asks to pull a specific ticket from the plan and ship it.

Ticket IDs are GH-issue-prefixed: `#<issue>-T<n>` (e.g. `#1034-T3`), as written by `generate-implementation-plan`. Accept a bare `T<n>` too — if the user omits the `#<issue>-` prefix and PLAN.md has exactly one issue's tickets, resolve it; if PLAN.md mixes multiple issues, ask which issue they mean.

## Preflight

1. **PLAN.md must exist** at the repo root. If not, tell the user and stop — they may want `/generate-implementation-plan` first.
2. **Locate the ticket.** Read PLAN.md and find the requested ticket ID. If the ID doesn't exist, list available ticket IDs and ask which one.
3. **Check dependencies.** If the ticket has a "Depends on:" line, verify each dependency is marked complete (`[✓]`). If not, warn the user and ask whether to proceed anyway.
4. **Check git state.** Run `git status`. If there are uncommitted changes unrelated to this ticket, warn the user and ask whether to stash, commit them first, or proceed with a mixed working tree.
5. **Check the branch.** If on `main` or `master`, ask whether to create a feature branch before implementing. Derive the branch name from the ticket ID, dropping the `#` (invalid in git refs) — e.g. `#1034-T3` → `ticket/1034-T3-<slug>`.
6. **Confirm test-writer and reviewer agents are available.** They are at `.claude/agents/test-writer.md` and `.claude/agents/reviewer.md`. If either is missing, tell the user and stop.
7. **Determine the target package and command set.** From the ticket's implementation-plan file paths, identify which workspace package the change lives in, then use that package's commands for the test/checks steps below. This is a pnpm monorepo (`pnpm@10.33.0`, Node 22); `pnpm-workspace.yaml` is authoritative. A ticket usually touches one package — if it spans several, run the relevant command set for each affected package.

   | Package (path) | pnpm filter / tool | Checks command | Test command | Single test |
   | --- | --- | --- | --- | --- |
   | `lib/core` (`@common-grants/core`) | pnpm | `pnpm --filter @common-grants/core run checks` | *(no tests — validated by `tsp compile`)* | — |
   | `lib/cli` (`@common-grants/cli`) | pnpm | `pnpm --filter @common-grants/cli run checks` | `pnpm --filter @common-grants/cli run test` | `pnpm --filter @common-grants/cli exec vitest run <file> -t "<name>"` |
   | `lib/ts-sdk` (`@common-grants/sdk`) | pnpm | `pnpm --filter @common-grants/sdk run checks` | `pnpm --filter @common-grants/sdk run test` | `pnpm --filter @common-grants/sdk exec vitest run <file> -t "<name>"` |
   | `lib/changelog-emitter` (`typespec-versioning-changelog`) | pnpm | `pnpm --filter typespec-versioning-changelog run checks` | `pnpm --filter typespec-versioning-changelog run test` | `pnpm --filter typespec-versioning-changelog exec vitest run <file> -t "<name>"` |
   | `website` | pnpm | `pnpm --filter website run checks` (adds `astro check` + `cspell`) | `pnpm --filter website run test` (vitest) | `pnpm --filter website exec vitest run <file> -t "<name>"` |
   | `lib/python-sdk` (`common-grants-sdk`) | Poetry + Makefile | `make checks` (black + ruff + pyright), run from `lib/python-sdk/` | `make test` (pytest) | `poetry run pytest -k "<expr>"` |

   For all TS packages the convention is uniform: `checks` = lint (eslint) + format (prettier; core/website also `tsp format`) + typecheck (`tsc --noEmit`); `ci` = checks + build + test. Below, **"the package's checks command"** and **"the package's test command"** mean the row for the target package. If the ticket is in `lib/python-sdk`, use the Makefile/Poetry commands; otherwise use the `pnpm --filter <pkg>` commands.

## TDD implementation loop

**First check the ticket's "Unit tests" field.** If it says there are no meaningful unit tests (e.g. infra/dependency/config tickets like "covered by a green build"), skip the failing-test step for those criteria and instead verify each acceptance criterion by the means the ticket names — a successful build (`pnpm --filter <pkg> run build`), the presence of a generated file, a passing type/lint check, or manual runtime verification. Note in the approval summary that verification was build/manual rather than unit tests. Otherwise, run the loop below.

For **each acceptance criterion** in the ticket, in the order listed:

1. **Delegate a failing test to the test-writer subagent.** Pass:
   - The specific acceptance criterion, verbatim
   - The file/function it applies to (from the ticket's implementation plan)
   - The target package and its test framework (vitest for TS/website packages; pytest for `lib/python-sdk`) so the test lands in the right place and style
   - Any relevant edge cases from the ticket's "Edge cases" section that apply to this criterion
   Wait for the agent to report back with the test path and failure line. Verify the test actually fails before proceeding.
2. **Implement just enough** to make that test pass. Follow the conventions in `CLAUDE.md` and the patterns already in the target package. In particular:
   - **TS packages / website**: match the existing module's style; prefer reusing existing utilities over new ones; keep full TypeScript types (no `any` escape hatches); respect the repo's eslint/prettier config (don't hand-format against it). For `lib/core`, protocol changes are made in **TypeSpec** (`lib/core/lib/`) — never hand-edit generated OpenAPI/JSON-Schema outputs.
   - **`lib/python-sdk`**: PEP 604 unions (`X | None`) and builtin generics, Google-style docstrings, full type annotations (pyright-clean), and follow the SDK's established patterns rather than adding ad-hoc branches.
   - Reference `path:function` for anything you reuse.
3. **Run the package's test command** (from the preflight step-7 table) to confirm no regressions. If a previously-passing test now fails, the implementation broke something — fix it before moving on.
4. **Loop** to the next acceptance criterion.

## Post-implementation gates

Once every acceptance criterion is satisfied (passing test, or the build/manual verification for no-test tickets):

5. **Run the package's checks command** (from the preflight step-7 table) — the CI gate. For TS/website packages that's `pnpm --filter <pkg> run checks`; for `lib/python-sdk` it's `make checks`. Fix any failures. Do not proceed if this doesn't pass. If the ticket also has a build acceptance criterion, run the package's `build` too.
6. **Delegate review to the reviewer subagent.** The reviewer runs the package's linters/type-checker (eslint + prettier + `tsc` for TS/website; black + ruff + pyright for `lib/python-sdk`), checks test style, and surfaces implementation opinions.
7. **Triage reviewer findings**:
   - lint / format / type-check / test-style findings → **fix them all** before proceeding
   - `[correctness]` and `[pattern]` implementation opinions → **fix them** unless you have a specific reason not to
   - `[reuse]` / `[simplify]` / `[api]` / `[docs]` opinions → surface to the user in the approval summary; let them decide
8. **Re-run the package's checks command** if you made any fixes in step 7.

## User approval gate

9. **Summarize the work** for the user in this format:

```
Ticket: #1034-T3 — <title>
Package: <target package>
Files changed:
  <path 1>  (+X / -Y)
  <path 2>  (+X / -Y)
  ...
Tests added: <count, or "none — verified by build/manual">
checks: PASS  (<package's checks command>)
Reviewer verdict: <clean | worth discussing>
Unresolved reviewer opinions:
  - [<severity>] <opinion 1>
  - [<severity>] <opinion 2>
  (or "None" if all addressed)
```

10. **Ask explicitly**: "Approve this implementation and commit? (yes / no / changes: <what>)"
11. **If the user says no or requests changes**, address the changes and loop back to step 5. Do NOT commit.
12. **If the user approves**, proceed to commit.

## Commit via GitHub MCP

The user has asked for commits to go through the GitHub MCP. Before doing so, be aware of the trade-offs and communicate them:

- GitHub MCP commits (`push_files`) are made against the **remote HEAD** — they **bypass local pre-commit hooks** and **skip the local git commit entirely**.
- The local working tree will still contain the uncommitted changes after the push — the user will need to `git pull` (or `git reset --hard origin/<branch>`) to sync local state.
- The target branch must already exist on GitHub. If it doesn't, use `mcp__github__create_branch` first.

**The AI-workflow files are intentionally gitignored and MUST NOT be committed.** `PLAN.md`, `.claude/`, `CLAUDE.md`, and the ADR are in `.gitignore` by design. The commit contains **only the real code/artifact changes** the ticket produced (e.g. `website/package.json`, `pnpm-lock.yaml`, `website/public/mockServiceWorker.js`). `PLAN.md` is updated **locally after** the commit lands (see "Mark the ticket done") and is never part of `push_files`. Before pushing, sanity-check with `git status --short` / `git check-ignore <file>` that no ignored workflow file slipped into the file list.

Workflow:

13. **Assemble the commit message** in this format:

```
[#1034-T3] <ticket title verbatim from PLAN.md>

<one-paragraph summary of what the change does and why — pulled from the ticket's Goal/Acceptance criteria>

Refs #1034

Files changed:
- <file 1>
- <file 2>
```

The `Refs #<issue>` line links the commit back to the originating GitHub issue (use the issue number embedded in the ticket ID). Do NOT list `PLAN.md` here — it is gitignored and updated locally after the commit.

14. **Resolve the GitHub target.** Determine `owner` and `repo` from `git remote get-url origin`. Determine the branch (current branch, confirmed with the user if `main`/`master`).
15. **Read the current contents** of every changed file to be committed — the real code/artifact files only, NOT `PLAN.md` or any gitignored workflow file.
16. **Push via `mcp__github__push_files`** with those files in a single call. This creates one atomic commit on GitHub with the code changes.

If the user objects to the trade-offs (bypassed hooks, out-of-sync local tree), offer a local `git commit` fallback and confirm before doing either.

## Mark the ticket done in PLAN.md

`PLAN.md` is gitignored, so this is a **local-only edit made after the commit has landed** — it is never pushed and never part of `push_files`.

17. **After the commit succeeds**, edit the local `PLAN.md` — in the ticket's heading, prepend `[✓] ` so:
    ```
    ### #1034-T3: <title>
    ```
    becomes:
    ```
    ### #1034-T3: [✓] <title>
    ```
    Do NOT delete the ticket body. Keep it as a historical record of what shipped. This edit stays on the local machine only (the file is in `.gitignore`); do not attempt to commit or push it.

## Final report

After the commit lands:

```
Committed: <commit SHA from GitHub MCP response>
Branch: <branch>
Ticket #1034-T3 marked complete locally in PLAN.md (gitignored — not pushed).
Next: <next unblocked ticket ID from the dependency graph, or "PLAN.md is fully complete">
```

## What NOT to do

- Do NOT skip the test-writer subagent when the ticket has meaningful unit tests. TDD is the point — the failing test comes first. (The only exception is a ticket whose "Unit tests" field says there are none, e.g. infra/config work verified by a build; handle those per the note at the top of the TDD loop.)
- Do NOT skip the reviewer subagent. Even if the package's checks pass, the reviewer catches things the checks miss.
- Do NOT commit without explicit user approval. A yes on the approval prompt is the gate; anything else means keep iterating.
- Do NOT commit files unrelated to the ticket. If the working tree has other changes, deal with them in preflight (step 4).
- Do NOT mark a ticket complete if any acceptance criterion is unmet.
- Do NOT invent a ticket ID or acceptance criteria not present in PLAN.md. If the ticket is under-specified, ask the user before implementing.
- Do NOT push to `main` or `master` without explicit confirmation.
- Do NOT run more than one ticket per invocation. If the user asks to "do #1034-T3 and #1034-T4", pick #1034-T3, complete it, and offer to invoke the skill again for #1034-T4.
