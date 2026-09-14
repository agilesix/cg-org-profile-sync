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
- Out (follow-ups, not this issue; ticketed below under #1188–#1191): `temelio-adapter`;
  embed loader + iframe/postMessage into portal; real JWT minting (`POST /token`) and JWKS;
  Google SSO; D1-backed store; any field beyond the four above; direct HTTP specs against
  portal/funderhub (Link's specs exercise them transitively, and T1's Vitest covers the handlers).

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

### #1153-T7: [✓] Build the widget page in `apps/link` with browser end-to-end specs

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

### #1153-T8: [✓] Document setup, tests, and the demo walkthrough

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

## #1188: Implement the OAuth flow (Plaid pattern)

**GitHub issue**: #1188 — [Data exchange] implement Oauth flow
(https://github.com/HHS/simpler-grants-protocol/issues/1188)

**Goal**: Replace Link's static per-system bearer tokens with a Plaid-style connect flow. The
widget opens on a list of the systems this Link is configured to talk to, each labelled with what
it allows (read, write). Clicking one runs that portal's own OAuth flow; the portal delegates
identity to Google, checks which orgs that person may touch, and mints its own short-lived access
token with an `aud` of that system. Link holds the tokens for the browser session and forwards
them with every compare and sync. A person who is not granted access to an org on a system cannot
see or change it there, which is the key thing Billy wants on stage. `POST /token` and
`GET /.well-known/jwks.json`, promised on every landing page since the scaffold, become real.

**Scope**:

- In: ES256 token minting and verification with `jose` in the library; a store wrapper that scopes
  reads and writes to the principal's orgs; an OAuth authorization server per portal (`authorize`,
  `callback`, `token`, JWKS) with a Google identity provider and a dev-only fake one on the same
  callback path; a PKCE client in Link with a connect screen; per-source token forwarding on one
  request header; demo users in the seed; e2e fixtures that obtain real tokens through the fake
  provider; docs.
- Out: refresh tokens; one-time-use authorization codes (stateless codes are replayable for their
  sixty-second life, named in a comment); the "which of my several orgs" chooser (per Billy);
  Link verifying tokens itself (it only forwards); spec-complete `authorize` parameter validation;
  auth on the portals' own pages.

**Assumptions**:

- Each portal is an OAuth authorization server that delegates identity to Google (Model A). The
  alternative, Link signing in with Google once and exchanging the Google token at each portal,
  was weighed and rejected: it collapses the "authenticate with this portal" beat into one login.
- The portal side stays stateless because Workers isolates do not share memory. Everything that
  would have been kept in a pending-codes map is a short-lived JWT signed with the portal's key:
  the `state` sent to Google carries the code challenge, redirect URI, and Link's own state; the
  authorization code carries `sub`, `orgs`, challenge, and redirect URI.
- Signing keys come from env (`SIGNING_KEY_JWK`, a private ES256 JWK), imported per request. A key
  generated per isolate would make JWKS differ between isolates and tokens fail across them.
- The static `CG_ACCESS_TOKEN` stays accepted by the portals as a service credential (principal
  `{ sub: "service", orgs: "*" }`) so the `curl` block and the `api-*` specs keep working. Link
  stops holding it, otherwise the negative case cannot be shown.
- Google Cloud: one project, one "Web application" OAuth client, redirect URIs
  `http://localhost:5173/oauth/callback` and `http://localhost:5174/oauth/callback`, scopes
  `openid email`, consent screen in Testing with the demo Gmail accounts as test users. Only the
  portals hold the client id and secret.
- Google's sign-in page will not render in an iframe, so when Link is embedded (#1189) the flow
  runs in a popup; standalone it runs in the same tab, which is the path `pnpm e2e` drives.
- Capabilities are spelled `{ read: boolean; write: boolean }` on `SourceConfig`; the UI words are
  pull and push. #1189-T3 and #1191-T2 build on this field.

**Open questions**:

- Which Gmail accounts play the admin and the portal-only user on the 18th. Env overrides the
  seed placeholders, so this can be decided the day before.
- Whether 404 (this plan) or 403 is the right answer for an org outside the principal's grants.
  404 hides existence and needs no handler change; revisit when the protocol says.

### #1188-T1: [✓] Per-system access tokens, guard, org scoping, and JWKS

- **Acceptance criteria**:
  - When a portal receives `Authorization: Bearer <JWT>` signed by its own key with `aud` equal
    to its system id, then the request proceeds with `locals.principal = { sub, orgs }`.
  - When the JWT is signed by another system's key, carries another `aud`, or has expired, then
    401 with the existing envelope.
  - When the bearer equals `CG_ACCESS_TOKEN`, then the principal is `{ sub: "service", orgs: "*" }`
    and nothing is filtered.
  - When a principal whose `orgs` excludes the seeded org lists, reads, or patches it, then the
    list is empty and read and patch 404 without storing anything.
  - When `GET /.well-known/jwks.json` is requested, then it returns the public ES256 JWK with a
    `kid`, unauthenticated.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/server/tokens.ts` (new): `Principal { sub; orgs: readonly string[]
| "*" }`; `loadSigningKey(jwk: string)` (jose `importJWK`, `kid` from the JWK thumbprint);
     `mintAccessToken(key, { iss, aud, sub, orgs }, ttlSeconds)`; `verifyAccessToken(key, token,
{ audience })` → `Principal`; `jwks(key)` → `Response`. Export from `server/index.ts`.
  2. `server/auth.ts`: add `requireAccess(request, { key, audience, serviceToken? })` returning a
     `Principal` or the 401 `Response`, reusing `requireBearer`'s header parsing. `requireBearer`
     stays for callers that want the old behaviour.
  3. `server/store.ts`: `scopedStore(store, principal): OrgStore` — `list` filtered to the
     principal's orgs, `read`/`write` answer `undefined` outside them, so `readOrg` and
     `updateOrg` 404 with zero handler changes.
  4. `packages/seed/src/demo-users.ts` (new): `DemoUser { email; grants: Record<systemId,
orgId[]> }`, `DEMO_USERS` with an admin (both org ids) and a portal-only user, and
     `grantsFor(systemId, email)`. Placeholder emails; env overrides them in T2.
  5. `apps/portal` and `apps/funderhub`, mirrored: `src/lib/server/keys.ts` reads
     `env.SIGNING_KEY_JWK` per request and fails closed with a sentence naming the variable;
     `src/hooks.server.ts` swaps `requireBearer` for `requireAccess` on `/common-grants/*` and sets
     `event.locals.principal` (declare `Locals` in `src/app.d.ts`); both org routes pass
     `{ ...orgRoutes, store: scopedStore(store, locals.principal) }`; new
     `src/routes/.well-known/jwks.json/+server.ts`; `.env.example` gains `SIGNING_KEY_JWK` with a
     one-line `node -e` generator in a comment; landing pages flip the JWKS route to live.
- **Edge cases**: `SIGNING_KEY_JWK` unset or malformed (fail closed, 401 plus a server log naming
  the variable); `orgs: "*"` bypasses the filter; `write` outside scope must return `undefined`
  before `store.write` is reached; the reset route stays outside the guard; a token with a `kid`
  that does not match the current key (401, since key rotation is out of scope).
- **Unit tests**: `tokens.test.ts`: mint and verify round trip, wrong key, wrong audience,
  expired. `auth.test.ts`: JWT, service token, garbage, missing header. `store.test.ts`: scoped
  list, read, write, and the `"*"` case. `demo-users.test.ts`: grants lookup for both users on
  both systems.
- **Trade-offs**: 404 rather than 403 for an out-of-scope org. The service token keeps `curl` and
  the API specs alive but is a credential with no person behind it; it never leaves the portals'
  `.env` and Link stops reading it in T3. This is the largest ticket of the four; if it runs long,
  step 5's app wiring can split off on its own.

### #1188-T2: [✓] Portal OAuth authorization server with Google and fake identity providers

Depends on: #1188-T1

- **Acceptance criteria**:
  - When `GET /oauth/authorize` arrives with `client_id=link`, an allow-listed `redirect_uri`, an
    S256 `code_challenge`, and `state`, then it 302s to the identity provider carrying a signed
    portal `state` that wraps those values.
  - When the identity provider calls back with a verified email that has grants on this system,
    then the portal 302s to `redirect_uri?code=<signed code>&state=<link's state>`.
  - When the email has no grants here, then the redirect carries `error=access_denied`.
  - When `POST /token` receives a code and a `code_verifier` whose S256 hash matches the code's
    challenge, then it returns a T1 access token for the code's `sub` and `orgs`; a mismatched
    verifier, an expired code, or a different `redirect_uri` returns 400 `invalid_grant`.
  - When `IDENTITY_PROVIDER=fake`, then `GET /oauth/fake-login?state=` renders an email form whose
    submit completes the same callback path; when the variable is unset or `google`, that route
    404s.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/server/identity.ts` (new): `IdentityProvider { authorizeUrl(state,
callbackUrl, loginHint?): URL; identityFromCallback(url, callbackUrl): Promise<{ email }> }`.
     `GoogleIdentityProvider` exchanges the code with the client secret and verifies the ID token
     with jose `createRemoteJWKSet`, requiring `email_verified`. `FakeIdentityProvider` reads
     `email` from the callback query; `fakeLoginPage(state, loginHint?)` renders the form. The
     fake provider needs no key of its own because the contract is "give me an email", not "give
     me an ID token".
  2. `packages/cg-org-sync/src/server/oauth-routes.ts` (new): `OAuthConfig { key; systemId;
issuer; identity; redirectUris; grantsFor(email) }` and handlers `authorize(url, config)`,
     `callback(url, config)`, `token(request, config)`, each config-driven like `OrgRoutesConfig`.
     `state` and codes are short-lived JWTs signed with `config.key` (five minutes and sixty
     seconds).
  3. Apps, mirrored: `src/routes/oauth/{authorize,callback,fake-login}/+server.ts`,
     `src/routes/token/+server.ts`, `src/lib/server/oauth.ts` building `OAuthConfig` from env:
     `IDENTITY_PROVIDER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_ORIGIN`,
     `LINK_ORIGIN` (the only allowed redirect base), `DEMO_ADMIN_EMAIL` and
     `DEMO_PORTAL_ONLY_EMAIL` overriding the seed placeholders. `.env.example` lists them; the
     guard already covers only `/common-grants/*`, so these routes are open by construction.
  4. Landing pages flip `POST /token` to live.
- **Edge cases**: the identity provider returns `error=`; portal `state` signature invalid or
  expired; `redirect_uri` on `/token` differs from the one in the code; unverified Google email;
  `login_hint` passed through so the second portal's Google step is one click; a person signed
  into Google as a different account than expected (shows as access denied, which is the demo's
  negative beat).
- **Unit tests**: `oauth-routes.test.ts` with `FakeIdentityProvider` and an injected `fetch`: the
  full authorize → callback → token round trip; bad verifier; no grants; unknown `redirect_uri`;
  fake-login 404 when disabled; expired code. `identity.test.ts`: Google ID-token verification
  against a stubbed JWKS.
- **Trade-offs**: Stateless codes are replayable within sixty seconds; acceptable for a demo and
  named in a comment. The Google path cannot run in CI, so only the fake path is pinned by tests;
  Google is verified by hand before the 18th.

### #1188-T3: [✓] Link connect screen, PKCE client, and per-source token forwarding

Depends on: #1188-T1 (header parsing and `capabilities`); end-to-end usable once #1188-T2 lands

- **Acceptance criteria**:
  - When the widget opens with no tokens, then it shows every enabled source with its
    capabilities and a Connect control, and fetches no comparison.
  - When Connect is clicked standalone, then the tab navigates through the portal's flow and
    returns to the widget with `sessionStorage["link:token:<sourceId>"]` set and that source shown
    as connected; when embedded, a popup does the same and posts the token to the opener.
  - When `/api/compare` or `/api/sync` is called and a source has no token in the header, then
    that source reports "not connected" in its column and the rest of the request proceeds.
  - When a source answers 401 to a forwarded token, then its column says the connection expired
    and offers Reconnect.
  - When every connected source has answered, then the existing grid renders and the existing
    `data-testid`s still work.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/types.ts`: `SourceConfig.capabilities?: { read: boolean; write:
boolean }` (default both true) and `authorizeUrl?`; `tokenUrl` is now honoured.
     `client/org-client.ts`: `SOURCE_TOKENS_HEADER = "x-source-tokens"`,
     `tokensFromHeader(request): TokenProvider` (parses `portal=<jwt>, funderhub=<jwt>` into a
     `StaticTokenProvider`; a missing source resolves to no token, which the fan-out reports as
     not connected), `sourceTokensHeader(tokens): string`.
  2. `apps/link/src/lib/server/sources.ts`: drop `TOKEN_VARS` and `tokenProvider()`; each entry
     gains `capabilities`, `authorizeUrl`, `tokenUrl`. `api/compare` and `api/sync` use
     `tokensFromHeader(request)`. Remove both token variables from `.env.example`.
  3. `apps/link/src/routes/api/connect/start/+server.ts` (new): `?source=` → generate the PKCE
     verifier, set an HttpOnly `SameSite=Lax` cookie keyed by `state` holding `{ sourceId,
verifier }` (five minutes), 302 to the source's `authorizeUrl`. The cookie is set in the
     window that will receive the callback (the tab or the popup), so a Lax cookie is enough.
  4. `apps/link/src/routes/connect/callback/+server.ts` (new): read `code` and `state`, look up
     the cookie, `POST tokenUrl` server-to-server with the verifier (no CORS on the portals),
     clear the cookie, and render a tiny page with two exits: if `window.opener`, post
     `{ type: "cg-link:token", sourceId, token }` to the opener on Link's own origin and close;
     otherwise write `sessionStorage` and `location.replace("/")` (preserving `registry`/`id`).
     With `Accept: application/json` it returns `{ sourceId, token }` instead, for the API specs.
  5. `apps/link/src/lib/tokens.ts` (new, client-safe): `sessionStorage` helpers and the
     `message` listener with an origin check. `+page.server.ts` returns `{ registry, id, sources }`
     only. `+page.svelte`: a connect panel (`data-testid="connect-{id}"`, `"connected-{id}"`,
     `"reconnect-{id}"`), the Connect control uses `window.open` only when
     `window.self !== window.top`, and both fetches send the header. The grid mounts once at least
     one source is connected.
- **Edge cases**: callback with `error=access_denied` (source shown as "no access on this
  system", not an error banner); missing or expired cookie (message, retry); `state` mismatch;
  a `postMessage` from any origin but Link's own ignored; popup blocked by the browser (fall back
  to same-tab navigation with a note that the frame will reload); the deep link `?registry=&id=`
  survives the round trip.
- **Unit tests**: `org-client.test.ts`: header round trip, malformed header, missing source.
  `fanout.test.ts`: a source with no token comes back `orgId: null` with a "not connected" reason
  and no request sent. App code is covered by T4.
- **Trade-offs**: First paint is no longer data; the Plaid pattern wants the connect list first
  anyway. Tokens in `sessionStorage` are per tab and vanish on close, which is what Billy asked
  for. Link never verifies a token; it forwards, and the portal decides.

### #1188-T4: End-to-end proof through the fake provider, fixtures, and docs

Depends on: #1188-T2, #1188-T3

- **Acceptance criteria**:
  - When the widget spec connects both systems as the admin through the fake provider, then the
    existing grid and sync assertions pass unchanged.
  - When it connects as the portal-only user, then FunderHub's column says access was denied and
    the comparison shows GrantPortal's values only.
  - When the `api-*` specs run, then they obtain real tokens through the fake flow and pass
    without any static token.
  - When a new developer follows the README, then the Google Cloud setup and every new env
    variable per app is listed, and `pnpm e2e` works with `IDENTITY_PROVIDER=fake`.
- **Implementation plan**:
  1. `e2e/fixtures.ts`: `connect(page, sourceId, email)` browser helper (click Connect, fill the
     fake-login email, submit, wait for `connected-{id}`); `tokenFor(request, sourceId, email)`
     API helper (start → fake-login form POST → callback with `Accept: application/json`);
     `LinkApi` sends the `x-source-tokens` header on every call.
  2. `e2e/specs/connect.spec.ts` (new): the negative case; `widget.spec.ts` and the `api-*` specs
     connect first. `e2e/env.ts` adds the demo emails from `@cg-link/seed`.
  3. The auto `api` fixture fails with a named sentence if a portal is running with
     `IDENTITY_PROVIDER=google`, since the suite cannot drive Google.
  4. Docs: `README.md` (Google setup, env table), `docs/demo-script.md` (the connect beat, the
     negative beat, a `/token` walkthrough; the `curl` block keeps the service token), `CLAUDE.md`
     auth paragraph and "not started" list, every `.env.example`, all four landing-page route
     lists.
- **Edge cases**: Vite compiling `/oauth/*` on first hit (reuse the reset fixture's retry);
  `reuseExistingServer` joining a portal whose `.env` still lacks `SIGNING_KEY_JWK` (the 401
  message names it); running the suite twice (tokens are per browser context, so no bleed).
- **Unit tests**: none new; this ticket is the e2e suite and the docs.
- **Trade-offs**: The Google path is verified only by hand before the demo. The JSON exit on the
  callback exists solely for the API specs.

## #1189: End-to-end field edit and sync flow across portals

**GitHub issue**: #1189 — [Data Exchange] End-to-end field edit and sync flow across portals
(https://github.com/HHS/simpler-grants-protocol/issues/1189)

**Goal**: Show a change flowing, not just two drifted profiles being reconciled. The demo beat:
GrantPortal and FunderHub open side by side; the presenter edits a field on GrantPortal's own org
profile page, opens Link from that page (an iframe overlay), picks the destination and the fields
to push, syncs, closes the widget, and sees the new value on FunderHub's profile page. Along the
way the widget stops saying "sync" as if it were bidirectional: every action reads as a push to or a
pull from a named portal, and only portals whose configuration allows writes are offered as targets.

**Scope**:

- In: an org profile page in `apps/portal` and `apps/funderhub` with the four demo fields editable
  through the same validation and unwritable-field rules as the `PATCH` route; an embed loader
  script served by Link plus a `frame-ancestors` policy and a postMessage bridge; a `host` mode in
  the widget; push/pull wording driven by per-source capabilities; browser specs for the embedded
  flow; README and demo-script updates.
- Out: auth on the portals' own pages (the demo pretends the presenter is already signed into the
  portal; Link's auth is #1188); editing fields beyond the four demo fields; a published embed
  package (a static script is enough); pulling from several sources at once.

**Assumptions**:

- Both portals get the profile page, so the "pull into GrantPortal" beat and the "see it land on
  FunderHub" beat both have a screen to look at. Same seven-file duplication rule as before.
- `SourceConfig.capabilities` (`{ read, write }`) is introduced by #1188-T1 as Link-level
  configuration. #1189-T3 consumes it; if #1188-T1 has not landed, T3 adds the field itself.
- Google's sign-in page refuses to render inside an iframe, so #1188's connect flow runs in a
  popup. Nothing in this issue depends on that beyond not breaking `window.open` from the frame.
- The iframe host origins are `http://localhost:5173` and `:5174` in dev, listed in Link's `.env`.

**Open questions**:

- Whether a pull may target more than the host. Plan says no: pull is "into the host" only.
- Whether the portals' profile pages should sit behind the #1188 login too. Not for Sept 18.

### #1189-T1: Add an editable org profile page to GrantPortal and FunderHub

- **Acceptance criteria**:
  - When `/orgs/{orgId}` loads in either app, then it renders that system's copy of the org:
    legal name, EIN, website, and primary address as editable fields, the rest of the profile
    read-only. FunderHub's page has no website field, because FunderHub does not store `socials`.
  - When the form is saved, then the change goes through the same validation and
    unwritable-field rules as `PATCH /common-grants/orgs/{orgId}`, the store holds the new value,
    and the page re-renders showing it; a rejected change shows the system's own message inline.
  - When `POST /__test/reset` runs, then the page shows seed values again.
  - When the landing page (`/`) loads, then it links to the seeded org's profile page.
  - When the e2e suite runs, then a browser spec edits the suite number on GrantPortal's page and
    `GET /api/compare` on Link reports the new value for `portal`.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/server/org-routes.ts`: extract the post-parse body of `updateOrg`
     (drop unwritable → `applyMergePatch` → re-validate → `store.write`) into an exported
     `applyOrgPatch(orgId, patch: JsonObject, config: OrgRoutesConfig)` returning either the
     revision plus the `skipped` list or a typed failure `{ status, message, errors }`. `updateOrg`
     becomes parse + `applyOrgPatch` + envelope; behaviour and messages unchanged.
  2. `apps/portal/src/routes/orgs/[orgId]/+page.server.ts` and the same path in `apps/funderhub`:
     `load` reads via `store.read` and 404s when missing; a default form action turns the posted
     fields into one merge patch with `buildMergePatch` (`@cg-link/org-sync/utils`) and calls
     `applyOrgPatch`, returning `fail(status, { message })` on rejection.
  3. `+page.svelte` in each: a read-only summary of the full profile above an edit form for the
     four demo fields (address as its component inputs). `data-testid`s: `profile`,
     `field-{path}`, `input-{name}`, `save`, `save-message`. Match the existing landing-page
     palette so the three apps still look like a family.
  4. `src/routes/+page.svelte` in each: add a link to `/orgs/<seed org id>` (ids from
     `@cg-link/seed`).
  5. `e2e/specs/portal-profile.spec.ts`: the browser edit above, asserted through the `api`
     fixture's `compare()`.
  6. `docs/demo-script.md`: the click path now starts on GrantPortal's profile page.
- **Edge cases**: empty legal name (400 from re-validation, shown inline); address inputs left
  blank (omit the key rather than write empty strings, since the comparison treats empty as
  absent); a field the system does not store (FunderHub website) is not rendered, so the form
  cannot produce a "declined" outcome by hand; the page is not behind the bearer guard (the guard
  covers `/common-grants/*` only), which is intended; the page is stale if Link changes the store
  while it is open — T2's bridge refreshes it.
- **Unit tests**: `org-routes.test.ts` covers `applyOrgPatch` directly: applies and reports
  `skipped`, rejects an invalid result, never changes `id`. The page itself is covered by the e2e
  spec.
- **Trade-offs**: A little real behaviour lands in a form action (mapping inputs to a patch),
  which the apps cannot unit-test. Kept to that mapping; every rule stays in the library. Two
  copies of the page, one per app, on purpose.

### #1189-T2: Embed Link in the portals as an iframe with a postMessage bridge

Depends on: #1189-T1

- **Acceptance criteria**:
  - When "Open Link" is clicked on a profile page, then Link renders in an overlay iframe on that
    page, already looking up the same org (EIN in the URL) and knowing which system it is hosted
    in (`?host=portal`).
  - When a sync completes inside the frame, then Link posts a `synced` message to the host page,
    which re-reads the org and updates the displayed values without a full reload.
  - When the overlay's Close control is used, then Link posts `close`, the host removes the frame,
    and the page shows the current values.
  - When a page on an origin outside Link's allow-list frames Link, then the browser refuses
    (`Content-Security-Policy: frame-ancestors`).
  - When Link is opened standalone, then nothing changes from today.
  - When the e2e suite runs, then a browser spec starts on GrantPortal's profile page, edits the
    suite number, opens Link in the frame, pushes the address to FunderHub, closes, and then opens
    FunderHub's profile page and sees the new suite.
- **Implementation plan**:
  1. `apps/link/src/hooks.server.ts` (new): add `Content-Security-Policy: frame-ancestors 'self'
<origins>` to page responses, origins from `env.EMBED_ALLOWED_ORIGINS` (comma-separated) via
     `$env/dynamic/private`; add it to `.env.example`. Read per request, not at module load.
  2. `apps/link/static/embed.js`: the loader. A global `CgLink.open({ linkOrigin, registry, id,
host, onSynced, onClose })` builds the overlay and iframe (`data-testid="cg-link-frame"`),
     passes `parent=<host origin>` in the frame URL, listens for `message` events and ignores any
     whose `origin` is not `linkOrigin`. Plain script, no bundling.
  3. `apps/link/src/routes/+page.server.ts` and `+page.svelte`: read `host` and `parent` from the
     URL; accept `parent` only if it is in the allow-list; after a successful sync post
     `{ type: "cg-link:synced", targets, results }` to `parent`; a Close button posts
     `{ type: "cg-link:close" }`. Both only when `window.parent !== window`.
  4. Profile pages in both apps: include the loader from `PUBLIC_LINK_ORIGIN` (add to each app's
     `.env.example`, read via `$env/dynamic/public`), an "Open Link" button
     (`data-testid="open-link"`), `onSynced` → `invalidateAll()`.
  5. `e2e/specs/embedded.spec.ts`: drives the frame with `page.frameLocator` and the widget's
     existing `data-testid`s. No Playwright config change; all servers already boot.
  6. README screenshots and `docs/demo-script.md` for the embedded path.
- **Edge cases**: origin checks in both directions (loader checks `event.origin`; Link checks
  `parent` against the allow-list before posting); SvelteKit's `kit.csp` config versus a hook —
  use the hook so the list comes from env; Chromium partitions storage inside a third-party frame,
  so #1188's tokens saved while embedded are separate from standalone (acceptable, note it in
  docs); `window.open` from inside the frame for #1188's popup works and `opener` is the frame;
  the host page open in two tabs (only the one that opened Link refreshes); a sync that partly
  fails still posts `synced` with the per-target results so the host can refresh.
- **Unit tests**: n/a — verified by the embedded browser spec and by hand in the demo run-through.
- **Trade-offs**: A hand-written loader rather than a package, mirroring how Plaid's
  `link-initialize.js` is included from their origin. Enough for the demo; packaging is a later
  concern. Dev-only `http://` origins in the allow-list.

### #1189-T3: Make direction explicit: push to, pull from, driven by capabilities

Depends on: #1189-T2, #1188-T1 (for `SourceConfig.capabilities`)

- **Acceptance criteria**:
  - When a value is picked, then the action reads as "Push <field> from <source> to <targets>"
    when the source is the host (or Link is standalone), and "Pull <field> from <source> into
    <host>" when the picked source is not the host; a `data-testid="direction"` element carries
    `push` or `pull`.
  - When Link is embedded and the pick is a pull, then the only target offered is the host.
  - When a source is configured `write: false`, then it is never offered as a target, the connect
    list (from #1188) labels it read-only, and `syncToTargets` refuses it without sending a
    request, reporting `{ ok: false, status: null, message }` for that target.
  - When `GET /api/compare` responds, then each source carries its `capabilities`.
  - When the e2e suite runs, then the embedded spec asserts the push wording from GrantPortal and
    a pull of FunderHub's value into GrantPortal lands on GrantPortal's profile page.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/types.ts`: `SourceResolution.capabilities`.
     `client/fanout.ts`: `compareAcrossSources` copies capabilities onto each resolution;
     `syncToTargets` refuses `write: false` targets before any lookup or PATCH.
  2. `apps/link/src/routes/+page.svelte`: `direction` derived from `selection.sourceId === host`;
     candidate targets filtered by capability and, for a pull, to the host; wording in the sync
     panel and in `SyncResults` ("Pushed to FunderHub", "Pulled into GrantPortal").
  3. Connect-list badges in #1188's list component: "read and write" / "read only".
  4. `e2e/specs/embedded.spec.ts`: the pull beat; `widget.spec.ts`: the `direction` attribute.
  5. `docs/demo-script.md`: the two beats Billy described — push GrantPortal → FunderHub, then pull
     into GrantPortal.
- **Edge cases**: `host` not among enabled sources (ignore it; standalone behaviour); host column
  in error (no pull possible; the prompt says why); picking the host's own value when no other
  source is writable ("no targets" message, not a disabled button with no explanation); a pull
  where several non-host sources differ (the picked one wins; one target).
- **Unit tests**: `fanout.test.ts`: read-only target refused with the stubbed `fetch` never called
  for it; `capabilities` present on every resolution; an unspecified capability defaults to read
  and write.
- **Trade-offs**: A pull is implemented as a PATCH to the host, identical over the protocol to a
  push. Direction is labelling plus capability filtering, not new transport, which is why it is
  small enough to ship before the 18th.

## #1190: Temelio integration

**GitHub issue**: #1190 — [Data exchange] Temelio Integration
(https://github.com/HHS/simpler-grants-protocol/issues/1190)

**Goal**: Temelio appears in Link as a third system with no route changes, through a
CommonGrants-compatible adapter. The shape of that adapter is not decidable until after the
Sept 14 conversation with Ruthwick (what API and auth Temelio exposes, whether a sandbox exists),
so this issue holds one planning ticket that turns into implementation tickets on Monday.

**Scope**: In: the decisions and the known scaffolding below. Out until Monday: everything else.

**Assumptions**:

- Temelio is read-only for the demo (we cannot push to it or embed Link in it), so it registers
  with `capabilities: { read: true, write: false }` and the demo beat is a pull from Temelio into
  GrantPortal.
- Temelio delegates sign-in to Google SSO, so the adapter can reuse #1188's shared auth handlers as
  its own authorization server and hold any Temelio API credential server-side.

### #1190-T1: Decide the Temelio adapter's shape after Monday's conversation with Ruthwick

Depends on: the Sept 14 conversation; #1188-T1 for `capabilities` and the shared auth handlers.

- **Acceptance criteria**:
  - When the conversation has happened, then this ticket is replaced in `PLAN.md` by two to four
    implementation tickets that answer: what the adapter wraps (a real Temelio sandbox API, or a
    fixture-shaped stand-in defined in this repo); how identity is mapped between Temelio's org
    records and the EIN lookup; whether Temelio joins `pnpm e2e` (a fourth `webServer` entry) or
    is demoed by hand only; and how the pull beat is shown given Link cannot be embedded in
    Temelio.
- **Implementation plan** (what is already known, so the split is quick):
  1. `apps/temelio-adapter` is a scaffold on port 5175 with no routes, no `src/lib`, no
     `hooks.server.ts`, no `.env.example`, and no dependency on `@cg-link/seed`. `.claude/launch.json`
     already knows it; `e2e/playwright.config.ts` does not.
  2. The registry entry already exists, commented out, in `apps/link/src/lib/server/sources.ts`
     (id `temelio`, `http://localhost:5175`). Adding Temelio to Link is uncommenting it, adding
     `capabilities`, and adding its token to `apps/link/.env.example`.
  3. Recommended architecture regardless of Monday's answer: implement the `OrgStore` interface
     (`packages/cg-org-sync/src/server/store.ts`) over Temelio's shape — a `TemelioOrgStore`
     that maps vendor records to `Organization` on `list`/`read` and rejects `write` — and wire
     `listOrgs`/`readOrg` from the shared handlers unchanged. If fixture-backed, the vendor side
     is a `TEMELIO_SEED` in `@cg-link/seed` in Temelio's own field names, so the translation layer
     is real even though the API is not.
  4. If Temelio joins e2e, `e2e/env.ts` gains its origin and `SYSTEM_ORIGINS` gains a reset
     route for it.
- **Edge cases**: a Temelio record with no EIN (cannot be matched; reported as "no record" rather
  than an error); vendor fields with no CommonGrants counterpart (dropped on read, listed in the
  adapter's README).
- **Unit tests**: n/a for the placeholder. The split tickets will put the store mapping under
  Vitest in `@cg-link/org-sync` or in the adapter's own small suite.
- **Trade-offs**: Deferring the split costs one planning pass on Monday but avoids writing tickets
  against an API we have not seen.

## #1191: Multi-field patch support and unsupported-field guardrails (nice-to-have)

**GitHub issue**: #1191 — [Data exchange] NTH - multi-field patch support, unsupported fields
(https://github.com/HHS/simpler-grants-protocol/issues/1191)

**Goal**: Two small changes to the widget Billy called out. First, a person can pick several
fields (say legal name, EIN, and website) and push them as one merge patch per target instead of
one field per sync. Second, when a selected field cannot be stored by a chosen target, the widget
says so before anything is sent and disables Sync, instead of reporting "accepted" while the
system silently drops the field.

**Scope**:

- In: multi-change `buildMergePatch` and `SyncChange`; the `/api/sync` body; multi-pick state in
  the page; a per-source `unwritableFields` list in Link's configuration surfaced through
  `/api/compare`; a library function that derives which picks a target would decline; the
  greyed-out button and message; updated e2e specs and demo script.
- Out: a scrollable full-profile view in the widget (Billy: nice-to-have on a nice-to-have; the
  portal profile pages from #1189-T1 show the full profile instead); systems advertising their own
  writability over the protocol (not defined in v0.4.0).

**Assumptions**:

- Link's per-source `unwritableFields` are top-level keys, mirroring `OrgRoutesConfig`, and are
  hand-maintained in `sources.ts` for the demo. The server's rule stays authoritative, so a stale
  list can only over-block, never misreport.
- The unused `SourceConfig.writableFields` allowlist is removed in favour of the denylist; nothing
  sets it today, and `sources.ts` already explains why an allowlist does not work here.

**Open questions**: none.

### #1191-T1: Select several fields and sync them as one merge patch per target

- **Acceptance criteria**:
  - When `buildMergePatch` is given several `{ path, value }` changes, then it returns one nested
    RFC 7396 body setting all of them, with changes under the same parent merged
    (`socials.website` and `socials.linkedin` share one `socials` object) and `null` still meaning
    clear.
  - When `POST /api/sync` receives `{ registry, id, changes: [...], targets }`, then each target
    receives exactly one PATCH carrying every change, and the per-target result shape is unchanged.
  - When a path is repeated or one path is a prefix of another, then `/api/sync` returns 400.
  - When a person picks a value in several rows (one source per row), then the sync panel lists the
    picks, each removable, and Sync sends them together; picking again in a row replaces that
    row's pick.
  - When the e2e suite runs, then a spec picks GrantPortal's address and website and pushes both to
    FunderHub in one request; the address row turns to `agree` and the result names `socials`.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/types.ts`: `FieldChange { path: string; value: JsonValue }`.
     `utils/compare.ts`: `buildMergePatch(changes: readonly FieldChange[]): JsonObject` (deep-merge
     the per-path shells; throw on duplicate or prefix-overlapping paths so the route can 400).
  2. `client/fanout.ts`: `SyncChange.changes: readonly FieldChange[]` replaces `path`/`value`;
     every path checked with `isDemoFieldPath`.
  3. `apps/link/src/routes/api/sync/+server.ts`: `BodySchema.changes` as a non-empty array of
     `{ path, value }`, with the same 400 message for a bad path.
  4. `apps/link/src/lib/demo.ts`: `Selection` stays one row's pick; the page holds
     `selections: Record<path, Selection>`. `+page.svelte`: `pick` replaces by path, a per-pick
     remove control, `canSync` needs at least one pick; candidates exclude a source only if every
     pick came from it. `ComparisonGrid` marks the selected cell per row. `data-testid`s:
     `pick-{path}-{sourceId}` unchanged, plus `selected-{path}` and `unpick-{path}`.
  5. `e2e/fixtures.ts`: `SyncRequest.changes`; update `api-sync.spec.ts` and `widget.spec.ts`;
     add the two-field spec.
  6. `docs/demo-script.md`: the `curl` sync example gets a two-change body.
- **Edge cases**: pushing a source its own value (harmless no-op, allowed); picks from two
  different sources with FunderHub as the only target (both changes go, one PATCH); clearing all
  picks returns the panel to the prompt; a target that lost its `orgId` between compare and sync
  (already handled per target).
- **Unit tests**: `compare.test.ts`: several changes under one parent, `null` deletion, duplicate
  and prefix paths rejected, single change identical to today's output. `fanout.test.ts`: one PATCH
  per target carrying all changes.
- **Trade-offs**: A breaking change to the `/api/sync` body. Its only consumers are the page and
  the e2e specs, which move in the same ticket.

### #1191-T2: Grey out Sync and explain when a target cannot store a selected field

Depends on: #1191-T1

- **Acceptance criteria**:
  - When a pick's top-level key is in a chosen target's `unwritableFields`, then Sync is disabled
    and a message names the system and the field ("FunderHub can't store Website. Unselect it or
    drop FunderHub as a target."), with `data-testid="blocked-{sourceId}"`.
  - When the pick is removed or the target unchecked, then Sync is enabled again.
  - When `GET /api/compare` responds, then each source carries `unwritableFields`, so the page
    needs no extra request.
  - When `POST /api/sync` is nonetheless asked to send a blocked change to a target, then
    `syncToTargets` reports `{ ok: false, status: null, message }` for that target without sending
    a request, so the API cannot say "accepted" either.
  - When the e2e suite runs, then the former "pushing portal's website reports what funderhub
    declined" browser spec becomes "pushing portal's website to funderhub is blocked before
    send", and `api-sync.spec.ts` keeps proving the server itself drops `socials` when asked
    directly with a config that does not list it.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/types.ts`: `SourceConfig.unwritableFields?: readonly string[]`
     (remove `writableFields`); `SourceResolution.unwritableFields: readonly string[]`.
  2. `packages/cg-org-sync/src/utils/writability.ts` (new): `topLevelKey(path)` (the segment
     before the first `.`, so `identifiers.org:us:ein.id` → `identifiers`) and
     `blockedChanges(changes, source): FieldChange[]`. Export from `utils/index.ts`.
  3. `client/fanout.ts`: `compareAcrossSources` copies `unwritableFields` onto each resolution;
     `syncToTargets` refuses blocked changes per target using `blockedChanges`.
  4. `apps/link/src/lib/server/sources.ts`: FunderHub's entry lists
     `["socials", "yearFounded", "orgType"]` literally, with a comment that this is Link-level
     knowledge and the server's rule remains authoritative. Replace the `writableFields` comment.
  5. `apps/link/src/routes/+page.svelte`: `blocked` derived per chosen target from
     `blockedChanges`; button disabled when any target is blocked; one message line per blocked
     target above the button.
  6. e2e updates as above; `docs/demo-script.md` gets the "try to push website, see it blocked"
     beat and drops the "declined" screenshot or re-shoots it.
- **Edge cases**: a source with no `unwritableFields` blocks nothing; no targets chosen (the
  "no targets" prompt wins over "blocked"); several targets blocked on different fields (one line
  each); a target blocked on one of three picks (the whole sync is blocked, since a partial send
  is exactly the surprise Billy wants to avoid); config drift where Link does not list a field the
  server drops (the server's message still shows, as today).
- **Unit tests**: `writability.test.ts`: dotted and colon-bearing paths map to their top-level
  key; blocked list for FunderHub with the four demo paths. `fanout.test.ts`: blocked target
  refused with `fetch` never called for it; unblocked target still patched.
- **Trade-offs**: Link duplicating each system's denylist by hand is smoke and mirrors. The honest
  fix is a capability document served by each system, which the protocol does not define yet; the
  server rule staying authoritative keeps the duplication safe.

## Cross-issue dependency graph

- #1188-T1 → #1188-T2, #1188-T3; #1188-T2, #1188-T3 → #1188-T4
- #1188-T1 → #1189-T3, #1190-T1
- #1189-T1 → #1189-T2 → #1189-T3
- #1191-T1 → #1191-T2
- **Parallel**: #1188-T1, #1189-T1, and #1191-T1 have no dependencies on each other and can start
  now. Once #1188-T1 lands, #1188-T2 and #1188-T3 can run in parallel. #1191 touches
  `apps/link/src/routes/+page.svelte` heavily, as do #1188-T3's connect screen and #1189-T3; land
  #1191-T1 early or expect merge work there. #1190-T1 waits for Monday Sept 14.
