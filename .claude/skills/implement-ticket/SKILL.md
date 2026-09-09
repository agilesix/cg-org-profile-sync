---
name: implement-ticket
description: "Pick up a specific ticket from PLAN.md and drive it to completion via TDD. Tickets are identified by GH-issue-prefixed IDs in the form #<issue>-T<n> (e.g. #1153-T3). Reads the ticket and runs preflight, then STOPS and asks the user for explicit approval before writing any code — being invoked is not approval to begin. Once approved, delegates failing-test authorship to the test-writer subagent, implements the feature to make tests pass, delegates review to the reviewer subagent, prompts the user for approval, and on approval commits locally with a descriptive message (including ticket ID and files changed) and marks the ticket done in PLAN.md. Invoke when the user runs /implement-ticket <ticket-id>, says 'implement #1153-T3 from PLAN.md', or asks to work on a specific ticket from the plan."
---

# implement-ticket

Drive one ticket from `PLAN.md` to a committed, reviewed implementation using TDD, in the **`cg-link`**
workspace (`agilesix/cg-org-profile-sync`).

## Model preference

This skill is designed for **Sonnet** — the work is mechanical (read spec → write failing test →
implement → run review), not architectural. If the current model is Opus, mention it once ("you can
`/model` to Sonnet to save cost and iterate faster") and proceed regardless. Do not refuse.

## When to invoke

- User runs `/implement-ticket <ticket-id>` (e.g. `/implement-ticket #1153-T3`).
- User says "implement #1153-T2", "work on ticket #1153-T5", "let's do #1153-T1 next", "pick up
  #1153-T4".
- User asks to pull a specific ticket from the plan and ship it.

Ticket IDs are GH-issue-prefixed: `#<issue>-T<n>`, as written by `generate-implementation-plan`. The
current `PLAN.md` holds `#1153-T1` through `#1153-T8`. Accept a bare `T<n>` too — if the user omits the
`#<issue>-` prefix and PLAN.md has exactly one issue's tickets, resolve it; if PLAN.md mixes multiple
issues, ask which issue they mean.

## Environment facts that change how this skill works

- **Issues are tracked in `HHS/simpler-grants-protocol`, not in this repo.** `gh issue view <n>` needs
  `--repo HHS/simpler-grants-protocol`. Commit trailers must use the cross-repo form
  `Refs HHS/simpler-grants-protocol#<issue>` — a bare `#1153` would link to a nonexistent issue in
  `agilesix/cg-org-profile-sync`.
- **The GitHub MCP server is currently failing auth** (HTTP 401). Commit **locally with `git`**. The
  `gh` CLI is authenticated if you need issue/PR reads.
- **`PLAN.md`, `CLAUDE.md`, and `.claude/` are all tracked in git here** — they are NOT gitignored.
  Marking a ticket done in `PLAN.md` is a real, committable change, and any `.claude/` edits show up in
  `git status`. Decide deliberately what goes in the commit rather than assuming workflow files are
  invisible.

## Preflight

1. **PLAN.md must exist** at the repo root. If not, tell the user and stop — they may want
   `/generate-implementation-plan` first.
2. **Locate the ticket.** Read PLAN.md and find the requested ticket ID. If the ID doesn't exist, list
   available ticket IDs and ask which one.
3. **Check dependencies.** If the ticket has a "Depends on:" line, verify each dependency is marked
   complete (`[✓]`). If not, warn the user and ask whether to proceed anyway. PLAN.md's "Dependency
   graph" section has the aggregate view.
4. **Check git state.** Run `git status`. If there are uncommitted changes unrelated to this ticket,
   warn the user and ask whether to stash, commit them first, or proceed with a mixed working tree.
5. **Check the branch.** The default branch is `main`. If on `main`, ask whether to create a feature
   branch before implementing. The repo's existing convention is `<author>/<issue>-<slug>` (e.g.
   `karina/1153-data-exchange-example`); a per-ticket branch derived from the ticket ID with the `#`
   dropped — `ticket/1153-T3-<slug>` — is also fine. Confirm which the user wants.
6. **Confirm the test-writer and reviewer agents are available** at `.claude/agents/test-writer.md` and
   `.claude/agents/reviewer.md`. If either is missing, tell the user and stop.
7. **Determine the target workspace and command set.** From the ticket's implementation-plan file paths,
   identify which workspace the change lives in. `pnpm-workspace.yaml` is authoritative
   (`packages/*`, `apps/*`). This is a pnpm workspace, `pnpm@11.20.0`, Node >= 22, `engine-strict`.

   | Path                   | Package                    | Type-check                                                                | Tests                                           |
   | ---------------------- | -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
   | `packages/cg-org-sync` | `@cg-link/org-sync`        | `pnpm --filter @cg-link/org-sync check` (`tsc --noEmit`)                  | `pnpm --filter @cg-link/org-sync test` (Vitest) |
   | `packages/seed`        | `@cg-link/seed`            | `pnpm --filter @cg-link/seed check`                                       | `pnpm --filter @cg-link/seed test`              |
   | `apps/portal`          | `@cg-link/portal`          | `pnpm --filter @cg-link/portal check` (`svelte-kit sync && svelte-check`) | none — no harness                               |
   | `apps/funderhub`       | `@cg-link/funderhub`       | `pnpm --filter @cg-link/funderhub check`                                  | none                                            |
   | `apps/temelio-adapter` | `@cg-link/temelio-adapter` | `pnpm --filter @cg-link/temelio-adapter check`                            | none                                            |
   | `apps/link`            | `@cg-link/link`            | `pnpm --filter @cg-link/link check`                                       | none                                            |

   Run one test file or name:
   `pnpm --filter @cg-link/org-sync exec vitest run src/utils/merge-patch.test.ts -t "<pattern>"`.

   **There is no per-package `checks` script.** Lint and format are configured once at the root and run
   across the whole repo. Below, **"the gate set"** means, for the target workspace:

   ```
   pnpm --filter <pkg> check      # types
   pnpm --filter <pkg> test       # tests (skip for apps — no harness)
   pnpm exec eslint <changed paths>              # or `pnpm lint` for the whole repo
   pnpm exec prettier --check <changed paths>    # or `pnpm format:check`
   ```

   If a ticket spans several workspaces, run `check`/`test` for each affected one; lint and format
   already cover everything.

   Regenerating a Worker's Cloudflare types after a `wrangler.jsonc` edit:
   `pnpm --filter @cg-link/<app> gen` (writes the gitignored-from-lint `worker-configuration.d.ts` —
   never hand-edit it).

## Approval to begin — BLOCKING

**Invoking this skill is not approval to write code.** It selects a ticket and runs preflight. Nothing
else happens until the user says go.

The user drives ticket sequencing. They kick off each ticket in `PLAN.md` individually, on their own
schedule, and may want to read the plan, reorder work, or change a ticket's scope in between. Starting
early takes that decision away from them, and burns tokens on work they may not want yet.

- **Summarize what you are about to do**, before touching anything:

```
Ticket: #1153-T3 — <title verbatim from PLAN.md>
Workspace: <target package>
Acceptance criteria: <count> — <one short line each>
Expect to touch: <files from the ticket's implementation plan>
Preflight notes: <unmet dependency / dirty tree / existing stashes / stale ticket detail / nothing>
```

- **Ask exactly this, then stop**: "Begin implementing `<ticket-id>`? (yes / no / changes: `<what>`)"
- **Wait for a direct yes in a NEW user message.** Until then: do not spawn the test-writer, do not edit
  or create any file, do not run `pnpm install` or add a dependency, and do not create a branch.

None of the following is approval to begin — holding only these, you are still at the gate:

- the skill being invoked, with or without a ticket ID in the arguments
- the user answering a question you asked about setup, tooling, file paths, or where the skill lives
- a branch already named after the ticket, or a stash holding earlier work on it
- the user approving a _different_ ticket earlier in the session, or saying the plan looks good
- the ticket being obviously next in the dependency graph

If the user says no or asks for changes, adjust and re-ask. Approval covers **one ticket**; the next one
needs its own yes.

## TDD implementation loop

**First check the ticket's "Unit tests" field.** Several tickets in this plan are explicitly `n/a` —
app wiring, the Playwright harness, docs — verified by a build, a passing `pnpm check`, a green e2e
spec, or manual runtime checks. For those criteria, skip the failing-test step and verify by the means
the ticket names, then note in the approval summary that verification was build/manual/e2e rather than
unit tests. Otherwise, run the loop below.

Remember the shape of the repo: **unit-testable logic belongs in `packages/cg-org-sync`**; the four
SvelteKit apps have no test harness, so a ticket that puts behavior in an app route should keep that
route a thin wrapper over tested library code.

For **each acceptance criterion** in the ticket, in the order listed:

1. **Delegate a failing test to the test-writer subagent.** Pass:
   - The specific acceptance criterion, verbatim
   - The file/function it applies to (from the ticket's implementation plan)
   - The target package (`@cg-link/org-sync` or `@cg-link/seed`) so the test lands in the right place
   - Any relevant edge cases from the ticket's "Edge cases" section that apply to this criterion

   Wait for the agent to report back with the test path and failure line. Verify the test actually fails
   before proceeding. If the criterion is about app or browser behavior, the agent will tell you there
   is no harness — take that as a signal to move the logic into the library or to defer to an e2e spec.

2. **Implement just enough** to make that test pass. Follow `CLAUDE.md` and the patterns already in the
   target module. In particular:
   - **ESM with `verbatimModuleSyntax`**: relative imports carry `.js` extensions even for `.ts`
     sources; type-only imports use `import type`.
   - **`noUncheckedIndexedAccess` is on** — index access is `T | undefined`, so guard or optional-chain.
   - **Dependency versions go in the `catalog:`** of `pnpm-workspace.yaml`, referenced as `"catalog:"`
     from a package's `package.json` — never a literal range in the package.
   - **Keep the shared handlers config-driven.** `src/server/org-routes.ts` is written against
     `OrgRoutesConfig`, storage goes through the `OrgStore` interface (not `MemoryOrgStore`), and
     responses go through `src/server/responses.ts`. An unwritable field in a patch is dropped and named
     in the response message — not an error.
   - **Never hand-edit** `src/schemas/__fixtures__/protocol-orgs.json` (copied verbatim from the
     CommonGrants protocol repo) or a generated `worker-configuration.d.ts`. Never hand-write a merge
     patch schema that `toMergePatch()` should derive.
   - **`src/types.ts` stays Zod-free** so apps and UI can import it without the schema layer.
   - **Workers runtime**: no Node-only APIs (`fs`, `path`, bare `process.env` — use SvelteKit's `$env`),
     and no module-level mutable state that assumes an isolate survives between requests.
   - Reference `path:function` for anything you reuse; prefer an existing helper over a new one.
3. **Run the target workspace's test command** to confirm no regressions. If a previously-passing test
   now fails, the implementation broke something — fix it before moving on.
4. **Loop** to the next acceptance criterion.

## Post-implementation gates

Once every acceptance criterion is satisfied (passing test, or the build/manual/e2e verification for
no-test tickets):

5. **Run the gate set** from preflight step 7 — types, tests, lint, format. Fix any failures. Prefer
   `pnpm format` (write) over hand-fixing prettier complaints. Do not proceed if these don't pass. If the
   ticket has a build acceptance criterion, run `pnpm --filter <pkg> build` too.
6. **Delegate review to the reviewer subagent.** It re-runs eslint/prettier/the workspace type-check on
   the changed paths, checks Vitest style, and surfaces implementation opinions against this repo's
   contract and source-of-truth rules.
7. **Triage reviewer findings**:
   - lint / format / type-check / test-style findings → **fix them all** before proceeding
   - `[correctness]` and `[pattern]` implementation opinions → **fix them** unless you have a specific
     reason not to
   - `[reuse]` / `[simplify]` / `[api]` / `[docs]` / `[risk]` opinions → surface to the user in the
     approval summary; let them decide
8. **Re-run the gate set** if you made any fixes in step 7.

## User approval gate

9. **Summarize the work** for the user in this format:

```
Ticket: #1153-T3 — <title>
Workspace: <target package>
Files changed:
  <path 1>  (+X / -Y)
  <path 2>  (+X / -Y)
  ...
Tests added: <count, or "none — verified by build/manual/e2e">
Gates: check PASS | test PASS | lint PASS | format PASS
Reviewer verdict: <clean | worth discussing | needs changes>
Unresolved reviewer opinions:
  - [<severity>] <opinion 1>
  - [<severity>] <opinion 2>
  (or "None" if all addressed)
```

10. **Ask explicitly**: "Approve this implementation and commit? (yes / no / changes: <what>)"
11. **If the user says no or requests changes**, address the changes and loop back to step 5. Do NOT
    commit.
12. **If the user approves**, proceed to commit.

## Commit

Commit locally with `git` — the GitHub MCP server is unauthenticated in this environment, so
`push_files` is not an option. If the user specifically wants a remote-side commit, tell them the MCP
needs re-authentication first.

13. **Stage deliberately.** `PLAN.md`, `CLAUDE.md`, and `.claude/` are tracked in this repo, so they will
    appear in `git status`. Stage the ticket's code changes, plus:
    - `CLAUDE.md` — if the ticket changed commands, layout, or the "The project is early" status, update
      and include it. Stale project docs are a real defect here.
    - `PLAN.md` — the done-marker edit (step 17) goes in a follow-up commit or is amended in; keep it out
      of the code commit unless the user wants one commit for both.
    - Do NOT stage unrelated working-tree changes, `.env` files, or anything under `.svelte-kit/`,
      `.wrangler/`, or `worker-configuration.d.ts`. Sanity-check with `git status --short`.
14. **Assemble the commit message.** The repo's existing history uses Conventional Commits with a scope
    (`feat(org-sync): add org route handlers`, `docs: say where the repo actually is`). Keep that, and
    add the ticket ID:

```
<type>(<scope>): <ticket title, lowercased to fit the subject>

<one-paragraph summary of what the change does and why — pulled from the ticket's
acceptance criteria>

Ticket: #1153-T3
Refs HHS/simpler-grants-protocol#1153
```

Scopes in use: `org-sync`, `seed`, `portal`, `funderhub`, `link`, `temelio-adapter`, or none for
repo-wide changes. The `Refs` line must be the cross-repo form — the issue lives in
`HHS/simpler-grants-protocol`, not here.

15. **Commit** with `git commit`. Let any hooks run; do not pass `--no-verify`.
16. **Do not push unless the user asks.** If they do, push the feature branch and offer to open a PR with
    `gh pr create --base main`. Never push to `main` without explicit confirmation.

## Mark the ticket done in PLAN.md

17. **After the commit succeeds**, edit `PLAN.md` — in the ticket's heading, prepend `[✓] ` so:
    ```
    ### #1153-T3: Add the org client to `@cg-link/org-sync`
    ```
    becomes:
    ```
    ### #1153-T3: [✓] Add the org client to `@cg-link/org-sync`
    ```
    Do NOT delete the ticket body. Keep it as a historical record of what shipped. `PLAN.md` is tracked
    here, so ask whether to commit the marker on its own (`docs: mark #1153-T3 done`) or amend it into
    the ticket commit.

## Final report

After the commit lands:

```
Committed: <short SHA>  <subject line>
Branch: <branch>
PLAN.md: #1153-T3 marked complete <committed as <sha> | staged, awaiting your call>
Pushed: <yes, <branch> | no — local only>
Next: <next unblocked ticket ID from the dependency graph, or "PLAN.md is fully complete">
```

## What NOT to do

- Do NOT start implementing before the user's explicit yes at the "Approval to begin" gate. Being
  invoked is not a yes. This is the single easiest rule to break, because preflight leaves you holding a
  fully-formed plan and the next step feels obvious — stop anyway, and ask.
- Do NOT skip the test-writer subagent when the ticket has meaningful unit tests. TDD is the point — the
  failing test comes first. (The exception is a ticket whose "Unit tests" field says there are none.)
- Do NOT skip the reviewer subagent. Even if the gates pass, the reviewer catches contract and
  source-of-truth violations the tools miss.
- Do NOT write tests under `apps/*` — there is no harness there and they will not run. Move the logic to
  `@cg-link/org-sync`, or note it for the planned `e2e/` Playwright workspace (#1153-T6).
- Do NOT reach for the GitHub MCP tools; they are unauthenticated. Use `git` and `gh`.
- Do NOT assume `PLAN.md` / `CLAUDE.md` / `.claude/` are gitignored — they are tracked here.
- Do NOT commit without explicit user approval. A yes on the approval prompt is the gate; anything else
  means keep iterating.
- Do NOT commit files unrelated to the ticket. If the working tree has other changes, deal with them in
  preflight (step 4).
- Do NOT mark a ticket complete if any acceptance criterion is unmet.
- Do NOT invent a ticket ID or acceptance criteria not present in PLAN.md. If the ticket is
  under-specified, ask the user before implementing.
- Do NOT push to `main` without explicit confirmation.
- Do NOT run more than one ticket per invocation. If the user asks to "do #1153-T3 and #1153-T4", pick
  #1153-T3, complete it, and offer to invoke the skill again for #1153-T4.
