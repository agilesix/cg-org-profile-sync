# Implementation plan: Local org-profile data exchange demo (#1153)

**GitHub issue**: #1153 — [Data exchange] Set up a local running example of data exchange
(https://github.com/HHS/simpler-grants-protocol/issues/1153)

**Goal**: Stand up two locally running CommonGrants-native systems (GrantPortal and FunderHub) that
each hold a drifted copy of the Agile Six org profile, plus the Link widget that reads both over the
v0.4.0 org routes, shows where they disagree on a small set of fields, and pushes a chosen value back
to the systems the person selects via JSON Merge Patch. The point is the thin vertical slice for the
Sept 18 demo: prove the contract moves data between running apps, in a way where a third source is a
config entry rather than new code. The whole flow is covered by Playwright: HTTP integration specs
against Link's fan-out routes and browser end-to-end specs against the widget.

**Scope**:

- In: testing and wiring the drafted org route handlers into `apps/portal` and `apps/funderhub`;
  a static per-system bearer token; a dev-only store reset route per system; an org client and
  comparison engine in `@cg-link/org-sync`; Link's server-side `/api/compare` and `/api/sync`
  routes with a source registry; a standalone widget page in `apps/link`; four fields (`name`,
  EIN, `socials.website`, `addresses.primary`); a root-level `e2e/` Playwright workspace with
  integration and end-to-end specs; setup docs so someone else can run it.
- Out (follow-ups, not this issue): `temelio-adapter`; embed loader + iframe/postMessage into
  portal; real JWT minting (`POST /token`) and JWKS; Google SSO; D1-backed store; any field
  beyond the four above; direct HTTP specs against portal/funderhub (Link's specs exercise them
  transitively, and T1's Vitest covers the handlers).

**Assumptions**:

- Node >= 22, pnpm 11, SvelteKit on the Cloudflare adapter, as already scaffolded. Local dev runs
  via `pnpm dev` (`vite dev`), not `wrangler dev`; the in-memory store resetting on restart is fine.
- Each system's dev port is whatever its `vite.config.ts` sets (portal is 5173). Link's source
  registry and the Playwright `webServer` block hardcode those localhost origins.
- Auth is a static bearer token per system, read from env (`.env` per app, via
  `$env/dynamic/private`). Link holds one token per source. No token minting.
- The org is matched across systems by EIN via `GET /common-grants/orgs?registry=org:us:ein&id=`.
  Both seeds already carry `AGILE_SIX_EIN`.
- Seed data stays as-is: portal is current, FunderHub is behind on the suite number and lacks
  `socials`, which is exactly what the four fields exercise.
- Unit tests (Vitest) live in `@cg-link/org-sync`. Integration and end-to-end tests (Playwright)
  live in a root `e2e/` workspace and run against the real dev servers. The SvelteKit apps get no
  test harness of their own; their routes stay thin wrappers over tested library code.
- `@playwright/test` is added to the `catalog:` in `pnpm-workspace.yaml`; Chromium is the only
  browser project. `pnpm e2e` at the root runs the suite.
- Test isolation comes from a dev-only `POST /__test/reset` route on each system that re-seeds its
  store, gated behind an env flag so it cannot exist in a deployed Worker.
- Per Billy: proof of concept over polish. PRs are fine but self-merge is fine too.

**Open questions**:

- Naming: Billy suggested renaming "FunderHub" to avoid collision with a real product. Deferred;
  rename is a find/replace whenever you decide.
- Whether the widget should also let the person type a brand-new value (not just pick one system's
  copy). Plan below picks-from-a-source only; free-text entry is a small add-on if wanted for demo.
- Who takes `temelio-adapter` after this lands (you or Billy). Not in this plan.
- Whether to run `pnpm e2e` in CI. No CI exists in the repo today; the harness is written so a
  GitHub Actions job is one file later, but wiring it is not in scope.

## Tickets

### #1153-T1: [✓] Test the shared org route handlers, add a bearer guard and store reset

- **Acceptance criteria**:
  - When `listOrgs` is called with `?registry=org:us:ein&id=<ein>`, then only orgs carrying that
    active identifier are returned, paginated in the standard envelope.
  - When `updateOrg` receives a valid merge patch with the right content type, then the store holds
    the patched profile, `id` is unchanged, and the response is an accepted revision.
  - When a patch touches a field in `unwritableFields`, then the field is dropped, the rest is
    applied, and the response message names the dropped field.
  - When the content type is wrong, the body is not JSON, the patch fails schema validation, or the
    result would be invalid, then the matching 4xx envelope is returned and nothing is stored.
  - When a request lacks `Authorization: Bearer <expected>`, then the new guard returns a 401
    envelope; when it matches, the guard returns nothing and the handler proceeds.
  - When `MemoryOrgStore.reset()` is called after writes, then `list()` returns the original seed.
- **Implementation plan**:
  1. Add `packages/cg-org-sync/src/server/org-routes.test.ts` driving `listOrgs`/`readOrg`/
     `updateOrg` against a `MemoryOrgStore` seeded from `@cg-link/seed` (add it as a devDependency
     of `@cg-link/org-sync`; seed depends on org-sync types only, so a devDependency back is fine —
     if pnpm complains about the cycle, inline a small fixture instead).
  2. `MemoryOrgStore` keeps its seed and gains `reset(): Promise<void>` (add to the `OrgStore`
     interface as optional, or a separate `ResettableOrgStore` interface — pick the smaller).
  3. Add `unauthorized` to `packages/cg-org-sync/src/server/responses.ts`.
  4. Add `packages/cg-org-sync/src/server/auth.ts` with `requireBearer(request, expectedToken)`
     returning a `Response` on failure and `undefined` on success. Export from `server/index.ts`.
  5. Add `packages/cg-org-sync/src/server/test-routes.ts` with `resetStore(store)` returning a
     204 — the shared body of each app's `/__test/reset`. Gating by env is the app's job (T2).
  6. Fix anything the tests surface in `org-routes.ts` (this is the first time it runs).
- **Edge cases**: `registry` without `id` (400); `page=0` or non-numeric (falls back); identifier
  present only in `allIds` with `archived` status (excluded); patch that nulls a required field like
  `name` (400 from re-validation); empty `Authorization` header vs. wrong scheme vs. wrong token
  (all 401); expected token unset in env (guard fails closed — 401); reset on a store that was never
  written (no-op).
- **Unit tests**: one per acceptance criterion above, plus the archived-identifier case, the
  unwritable-field case using `FUNDERHUB_UNWRITABLE_FIELDS`, and reset-restores-seed.
- **Trade-offs**: A static shared secret is not the architecture's end state (per-system JWT with
  `aud`), but it demonstrates "one credential per source" with ~20 lines and keeps `POST /token`
  honest as a future ticket. The reset route is test-only code in the library; it is small, clearly
  named, and inert unless an app mounts it.

### #1153-T2: [✓] Wire the org routes into GrantPortal and FunderHub

Depends on: #1153-T1

- **Acceptance criteria**:
  - When both apps are running, then `GET /common-grants/orgs?registry=org:us:ein&id=123456789`
    with the right bearer token returns the seeded Agile Six record on each.
  - When `PATCH /common-grants/orgs/{orgId}` is sent to portal, then a subsequent `GET` reflects the
    change for the life of the dev server.
  - When the same patch sets `socials.website` on FunderHub, then the response message says
    FunderHub does not store `socials` and the rest of the patch is applied.
  - When the bearer token is missing or wrong, then both apps return 401.
  - When `ENABLE_TEST_ROUTES=true`, then `POST /__test/reset` re-seeds the store and returns 204;
    when the flag is unset, then the route returns 404.
  - When the placeholder page loads, then it no longer says "Not implemented yet".
- **Implementation plan** (same pattern in both apps; described once):
  1. Add `@cg-link/seed` as a dependency of `@cg-link/portal` and `@cg-link/funderhub`.
  2. `src/lib/server/store.ts`: a module-level `MemoryOrgStore` seeded with `PORTAL_SEED` (or
     `FUNDERHUB_SEED`) and an exported `OrgRoutesConfig` with `source: "portal"` (or `"funderhub"`
     with `unwritableFields: FUNDERHUB_UNWRITABLE_FIELDS`).
  3. `src/routes/common-grants/orgs/+server.ts` → `GET` calls `listOrgs(url, config)`.
     `src/routes/common-grants/orgs/[orgId]/+server.ts` → `GET` calls `readOrg`, `PATCH` calls
     `updateOrg(params.orgId, request, config)`.
  4. `src/routes/__test/reset/+server.ts` → `POST` returns 404 unless
     `env.ENABLE_TEST_ROUTES === "true"`, else calls `resetStore(store)`.
  5. `src/hooks.server.ts`: for paths under `/common-grants/`, run `requireBearer` with the token
     from `$env/dynamic/private` and return its response if present. `/__test/` is not behind the
     bearer (it is behind the flag).
  6. Add `.env.example` per app with the token variable and `ENABLE_TEST_ROUTES=true`; `.env`
     gitignored.
  7. Trim the "Not implemented yet" line on `+page.svelte`; leave the route list.
- **Edge cases**: SvelteKit's `request.json()` consumed twice (hooks must not read the body).
  Trailing slash on `/common-grants/orgs/` (SvelteKit default `never` handles it). `svelte-check`
  needs the env vars present in `.env` to type `$env` — document it. `ENABLE_TEST_ROUTES` must be
  absent from `wrangler.jsonc` `vars` so a deploy can never enable it.
- **Unit tests**: none in the apps (no harness). The handlers are covered in T1; the wiring is
  covered transitively by the T6 integration specs and by the `curl` block in T8.
- **Trade-offs**: Two nearly identical app trees instead of one parameterised app. Deliberate: the
  demo's story is "two independent vendors happen to speak the same contract", and the duplication
  is about seven small files.

### #1153-T3: [✓] Add the org client to `@cg-link/org-sync`

Depends on: #1153-T1 (for the 401 envelope and response shapes to test against)

- **Acceptance criteria**:
  - When `findByIdentifier(registry, id)` is called, then it returns the first matching
    `Organization` or `undefined`, having unwrapped the paginated envelope.
  - When `read(orgId)` is called, then it returns the `Organization` from the `data` field.
  - When `patch(orgId, mergePatch)` is called, then it sends `application/merge-patch+json` with the
    bearer token and returns `{ revision, message }` so the caller can surface skipped fields.
  - When the server returns an error envelope, then the client throws an `OrgClientError` carrying
    status, message, and the `errors` array; a network failure throws with the source id attached.
- **Implementation plan**:
  1. Create `packages/cg-org-sync/src/client/index.ts` and `client/org-client.ts` (the package.json
     `./client` export already points here). Constructor takes a `SourceConfig` and a
     `TokenProvider` (both from `src/types.ts`); the `fetch` implementation is injectable for tests.
  2. Parse response bodies with the existing Zod schemas (`OrganizationBaseSchema`) so a
     non-conformant source fails loudly rather than leaking bad shapes into the comparison.
  3. Add a `StaticTokenProvider` (map of sourceId → token) alongside; it is what Link will use.
  4. Tests in `client/org-client.test.ts` with a stubbed `fetch`.
- **Edge cases**: empty `items`; more than one match (take first, note it); 401 from a source
  (surface as a distinct error so the widget can say "not connected" rather than "not found");
  response missing the envelope entirely (non-CommonGrants server); `tokenUrl` on `SourceConfig`
  unused for now — make it optional and document that it is ignored.
- **Unit tests**: happy path per method; error envelope → typed error; network failure; schema
  mismatch in a response is rejected.
- **Trade-offs**: A hand-rolled client rather than generating one from the spec. Fine for four
  calls, and it keeps `@common-grants/sdk` usage limited to what it already models.

### #1153-T4: [✓] Add the comparison engine and patch builder

No dependencies (pure functions over `Organization` and `FieldComparison`)

- **Acceptance criteria**:
  - When given profiles from N sources and the demo's field list, then `compareProfiles` returns one
    `FieldComparison` per field with `values` keyed by source id, `distinctCount`, and `status`.
  - When every source that holds a field agrees, then status is `agree`; when a source lacks the
    field, then it is absent from `values` and does not count as a disagreement.
  - When two sources hold structurally equal objects (the address), then they compare as equal
    regardless of key order.
  - When `buildMergePatch("addresses.primary", value)` is called, then it returns a nested
    RFC 7396 body (`{ addresses: { primary: value } }`), and `null` values produce a deletion.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/utils/compare.ts`: `FieldSpec { path, label }`, the exported
     `DEMO_FIELDS` list (`name`, `identifiers.org:us:ein.id`, `socials.website`,
     `addresses.primary`), `getAtPath`, `compareProfiles`, `buildMergePatch`.
  2. Deep-equality by canonical JSON (sorted keys) — small and sufficient here.
  3. Export from `utils/index.ts`; tests in `utils/compare.test.ts` using the two seeds directly so
     the expected disagreements (suite number, website absent on FunderHub) are asserted from real
     data.
- **Edge cases**: path segments containing `:` (the EIN registry key) — split on `.` only; a source
  whose profile failed to load (`undefined`) must not crash the comparison; empty string vs. missing
  (treat both as absent for `distinctCount`); a single source (everything "agrees").
- **Unit tests**: the four AC cases plus the seed-driven assertion that exactly `addresses.primary`
  differs and `socials.website` is held by portal only.
- **Trade-offs**: A flat list of field specs instead of walking the whole schema. Adding a field is
  one line, which is the "then it's just engineering" story Billy wants to tell.

### #1153-T5: [✓] Add Link's source registry and `/api/compare`, `/api/sync` routes

Depends on: #1153-T2, #1153-T3, #1153-T4

- **Acceptance criteria**:
  - When `GET /api/compare?registry=org:us:ein&id=123456789` is called with both systems running,
    then the response lists each enabled source with its resolved `orgId` (or an error), plus the
    `FieldComparison[]` for `DEMO_FIELDS`.
  - When one source is down or returns 401, then the response still includes the other source's
    values and reports the failing source by id with a short reason.
  - When `POST /api/sync` receives `{ path, value, targets: [sourceId...] }`, then it builds one
    merge patch and PATCHes each target's org, returning per-target `{ ok, status, message }`.
  - When a target declines a field, then its message (from the server) is passed through verbatim.
- **Implementation plan**:
  1. `apps/link/src/lib/server/sources.ts`: the `SourceConfig[]` registry (portal, funderhub; a
     commented-out `temelio` entry showing how a third joins) and a `StaticTokenProvider` fed from
     `$env/dynamic/private`.
  2. `apps/link/src/routes/api/compare/+server.ts` and `api/sync/+server.ts`, thin: validate query/
     body with small Zod schemas, fan out with `Promise.allSettled`, shape the response.
  3. `apps/link/src/lib/api-types.ts` for the compare/sync response shapes shared by the routes,
     the page, and the e2e specs (import path documented for T6).
  4. `.env.example` for link with both tokens.
- **Edge cases**: org not found in one source (report `orgId: null`, keep the other); sync targets
  that include a source with no resolved orgId (skip with a message, do not 500); duplicate targets;
  `value` of `null` (allowed — it means clear the field); request to sync a path not in
  `DEMO_FIELDS` (400); malformed body (400 with Zod issues).
- **Unit tests**: none in the app. Logic worth unit-testing lives in T3/T4; these routes are the
  subject of the T6 integration specs.
- **Trade-offs**: Server-side fan-out means portal/funderhub need no CORS and Link is the only thing
  holding source tokens, which mirrors where a Plaid-style host keeps credentials. It also means
  Link's server is on the request path for every read, which is fine for a demo.

### #1153-T6: [✓] Add the Playwright harness and Link API integration specs

Depends on: #1153-T5

- **Acceptance criteria**:
  - When `pnpm e2e` runs from a clean checkout with `.env` files in place, then Playwright boots
    portal, funderhub, and link, waits for each to answer, runs the suite, and shuts them down.
  - When a developer already has `pnpm dev` running, then `pnpm e2e` reuses those servers instead of
    failing on the ports.
  - When any spec starts, then both systems have been reset to seed via `POST /__test/reset`, so
    specs pass in any order and on repeat runs.
  - When `GET /api/compare` is exercised, then the spec asserts `addresses.primary` is `differs`
    (Suite 300 vs 210), `name` and EIN `agree`, and `socials.website` has a value for portal only.
  - When `POST /api/sync` pushes portal's address to funderhub, then the per-target result is
    `ok`, and a follow-up compare shows the row as `agree`.
  - When `POST /api/sync` pushes portal's website to funderhub, then the result is `ok` with a
    message naming `socials` as not stored, and a follow-up compare still shows the website for
    portal only.
  - When `POST /api/sync` is sent a path outside `DEMO_FIELDS` or a malformed body, then 400.
- **Implementation plan**:
  1. Add `@playwright/test` to the `catalog:` in `pnpm-workspace.yaml`. Create `e2e/` as a
     workspace package (`@cg-link/e2e`, private) with `package.json` scripts `test` →
     `playwright test` and `install-browsers` → `playwright install chromium`. Add `pnpm e2e` to the
     root `package.json`. Add `e2e/` to the `packages:` list (or it is already matched — check).
  2. `e2e/playwright.config.ts`: three `webServer` entries (`pnpm --filter @cg-link/portal dev`,
     same for funderhub and link) with their `url`s from each `vite.config.ts` port and
     `reuseExistingServer: !process.env.CI`; a single `chromium` project; `baseURL` = link's
     origin; `fullyParallel: false` and `workers: 1` because the two systems are shared mutable
     state.
  3. `e2e/fixtures.ts`: a `test` extension with a `reset` fixture that POSTs `/__test/reset` to
     portal and funderhub before each test (using the `request` fixture), plus a typed `api` helper
     for `compare(ein)` and `sync(body)` against link. Read ports/tokens from one `e2e/env.ts`.
  4. `e2e/specs/api-compare.spec.ts` and `e2e/specs/api-sync.spec.ts` covering the AC above.
  5. Wire `e2e/` into root ESLint/Prettier (it is TypeScript like everything else); exclude
     `playwright-report/` and `test-results/` in `.gitignore`.
  6. `tsconfig.json` in `e2e/` extending `tsconfig.base.json`.
- **Edge cases**: a webServer that is up but not yet serving the route (use `url` pointing at a
  route that only exists once SvelteKit has compiled, e.g. `/common-grants/orgs` with the token —
  or the placeholder page, then let the reset fixture retry once); `.env` missing → servers boot
  with no token and every call is 401 — fail fast with a clear message in `env.ts`; a leftover
  `pnpm dev` from a previous session with stale code (documented, `reuseExistingServer` is a
  trade-off); Playwright's default 30s `webServer` timeout vs. three cold Vite boots (raise to 120s).
- **Unit tests**: n/a. The specs themselves are the deliverable; the harness is proven by them
  passing twice in a row without a restart.
- **Trade-offs**: Serial workers because the systems are shared state. That keeps the suite honest
  and small; parallelism would need per-worker seed namespaces, which is over-building for a demo.
  Booting real dev servers makes the suite slower than mocked route tests, but it is the only test
  that proves the three apps actually exchange data, which is the point of the issue.

### #1153-T7: Build the widget page in `apps/link` with browser end-to-end specs

Depends on: #1153-T6

- **Acceptance criteria**:
  - When the page loads with the default EIN, then it shows a grid: one row per demo field, one
    column per source, rows visually marked `agree` or `differs`.
  - When a row differs and the person clicks a source's value, then that value is selected and the
    other sources become checkable targets.
  - When "Sync" is clicked, then `/api/sync` is called, per-target results are shown inline
    (including FunderHub's "does not store socials" message), and the grid refreshes from
    `/api/compare`.
  - When a source is unreachable, then its column shows an error state and the rest of the grid
    still renders.
  - When the e2e suite runs, then a browser spec reproduces the address fix (differs → agree) and
    the website push (message shown, row unchanged), and a spec asserts the initial grid state.
- **Implementation plan**:
  1. Replace `apps/link/src/routes/+page.svelte` scaffold with the widget; `+page.server.ts` load
     calls the compare logic directly so first paint has data.
  2. Components under `apps/link/src/lib/components/`: `ComparisonGrid.svelte`, `SyncResult.svelte`.
     Svelte 5 runes as the vite config already enforces. Add stable `data-testid` attributes on
     rows, cells, target checkboxes, the sync button, and result lines — the specs select by these.
  3. Render `addresses.primary` as a short formatted string in the cell; other fields as text.
  4. Keep the existing palette/type from the scaffold pages so the three apps look like a family.
  5. `e2e/specs/widget.spec.ts`: uses the `reset` fixture from T6; three tests matching the last
     AC. Assert on `data-testid` and visible text, not on layout.
- **Edge cases**: selecting a value then changing the EIN; sync while a previous sync is in flight
  (disable button — the spec waits on the result line, not a timeout); a field held by only one
  source (still a valid push; the FunderHub case demonstrates the drop message); the "source
  unreachable" state is hard to reproduce in e2e without stopping a server — cover it by hand, not
  in the suite.
- **Unit tests**: none (demo UI). The browser specs are the acceptance test.
- **Trade-offs**: A standalone page rather than an embedded iframe. It loses the Plaid-style "loaded
  inside the host app" moment for the 18th but removes an entire plumbing layer from the critical
  path; embedding is a clean follow-up once this works. `data-testid` hooks are a small cost that
  keeps the specs from breaking on copy or styling changes.

### #1153-T8: Document setup, tests, and the demo walkthrough

Depends on: #1153-T7 (prose can be drafted in parallel, finalised last)

- **Acceptance criteria**:
  - When someone new clones the repo and follows README "Running the demo", then `pnpm install`,
    copying `.env.example` files, and `pnpm dev` gets all three apps up on documented ports.
  - When they follow the `curl` section, then they can hit each system's org routes directly with
    the documented tokens and see the seeded record and a patch land.
  - When they follow the "Tests" section, then `pnpm test` and `pnpm e2e` both pass, including the
    one-time `playwright install chromium`.
  - When they follow the demo script, then they reproduce the address fix and the website push in
    the widget in under five minutes.
- **Implementation plan**:
  1. README: update the "Where this actually is" table; add "Running the demo" (ports, env vars,
     order of operations), "Poke the routes directly" (`curl` block per app), "Tests" (Vitest vs.
     Playwright, what each proves, the reset route and why it is gated), and "Demo script" (the
     click path from T7). Add "What's next" pointing at temelio-adapter, embed loader, JWT/JWKS.
  2. CLAUDE.md: update "The project is early", the not-started list, and the Commands table with
     `pnpm e2e` and how to run one spec (`pnpm --filter @cg-link/e2e exec playwright test
specs/widget.spec.ts`).
  3. Keep `.env.example` files where T2/T5 put them; document once.
- **Edge cases**: port collisions on the developer's machine (say which `vite.config.ts` and
  `playwright.config.ts` to edit together); `svelte-check` failing when `.env` is missing (T2
  note); Playwright browsers not installed (the error is clear, but say it up front).
- **Unit tests**: n/a. `pnpm check`, `pnpm test`, `pnpm e2e`, `pnpm lint`, `pnpm format:check` all
  green is the bar for the PR.
- **Trade-offs**: Docs as a separate last ticket risks drifting from T2/T5/T6 details; mitigated by
  writing the `.env.example` files and config in those tickets and only the prose here.

## Dependency graph

- #1153-T1 → #1153-T2, #1153-T3
- #1153-T2, #1153-T3, #1153-T4 → #1153-T5
- #1153-T5 → #1153-T6
- #1153-T6 → #1153-T7
- #1153-T7 → #1153-T8
- **Parallel**: #1153-T4 has no dependencies and can start immediately alongside #1153-T1. Once T1
  lands, #1153-T2 and #1153-T3 can run in parallel. T8's prose can be drafted any time after T2.

## Verification (end to end)

1. `pnpm test` — org-sync suites pass (existing 47 + new route, client, compare tests).
2. `pnpm check && pnpm lint && pnpm format:check` clean across workspaces, including `e2e/`.
3. `pnpm e2e` — boots all three apps, resets stores, runs API integration specs and widget browser
   specs, passes; run it twice in a row to prove the reset route isolates state.
4. `pnpm dev`; `curl` each system's `GET /common-grants/orgs?registry=org:us:ein&id=123456789` with
   its bearer token; confirm 401 without it; confirm `POST /__test/reset` is 404 with the flag off.
5. Open Link; grid shows `addresses.primary` as `differs` (Suite 300 vs Suite 210) and
   `socials.website` held by portal only.
6. Select portal's address, target FunderHub, Sync → FunderHub now Suite 300; grid shows `agree`.
7. Select portal's website, target FunderHub, Sync → result shows "does not store socials"; grid
   unchanged for that row. That is the demo.
