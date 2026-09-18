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
identity to an identity provider, checks which orgs that person may touch, and mints its own
short-lived access token with an `aud` of that system. Link holds the tokens for the browser session and forwards
them with every compare and sync. A person who is not granted access to an org on a system cannot
see or change it there, which is the key thing Billy wants on stage. `POST /token` and
`GET /.well-known/jwks.json`, promised on every landing page since the scaffold, become real.

**Scope**:

- In: ES256 token minting and verification with `jose` in the library; a store wrapper that scopes
  reads and writes to the principal's orgs; an OAuth authorization server per portal (`authorize`,
  `callback`, `token`, JWKS) with a Google identity provider and a dev-only fake one on the same
  callback path; a PKCE client in Link with a connect screen; per-source token forwarding on one
  request header; demo users in the seed; e2e fixtures that obtain real tokens through the fake
  provider; docs. Added 2026-09-14 (T5–T8): a Plaid-style modal (a system picker with stub
  systems, a Google sign-in step in a popup, an organization picker locked to the first-linked
  EIN), a success banner, two more seed orgs per system, and `GET /api/orgs` on Link. T9 stands
  real Google sign-in up after the demo.
- Out: refresh tokens; one-time-use authorization codes (stateless codes are replayable for their
  sixty-second life, named in a comment); Link verifying tokens itself (it only forwards);
  spec-complete `authorize` parameter validation; auth on the portals' own pages; a same-tab
  connect as the primary path (the modal needs the popup, and same-tab stays only as the
  blocked-popup fallback); connecting the five stub systems, which are catalog entries only. The
  "which of my several orgs" chooser was out of scope per Billy for T1–T4 and is in scope from T7.

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
- **The demo runs on the stand-in sign-in form, not Google** (decided 2026-09-14). Both portals
  stay on `IDENTITY_PROVIDER=fake` through T8, which is also what `pnpm e2e` drives. The Google
  provider is written, unit-tested against a local JWKS, and unverified against Google itself;
  T9 stands it up afterwards. Nothing in T5–T8 needs a Google account, and no ticket is blocked
  on the console work.
- Google Cloud, when T9 lands: one project, one "Web application" OAuth client, redirect URIs
  `http://localhost:5173/oauth/callback` and `http://localhost:5174/oauth/callback`, scopes
  `openid email`, consent screen in Testing with the demo Gmail accounts as test users. Only the
  portals hold the client id and secret.
- Google's sign-in page will not render in an iframe, so when Link is embedded (#1189) the flow
  runs in a popup. Through T4 the standalone flow ran in the same tab, which is the path the e2e
  suite drove; from T6 the popup is the only primary path, standalone or embedded.
- Capabilities are spelled `{ read: boolean; write: boolean }` on `SourceConfig`; the UI words are
  pull and push. #1189-T3 and #1191-T2 build on this field.
- From T6 the connect flow always runs in a popup because the modal has to stay open to show a
  loading state and to receive the token. Google renders no sign-in page inside another origin's
  frame and a third party never collects a Google password, so the modal holds a "Continue with
  Google" button rather than credential inputs; the form inside the popup is what looks like the
  "Enter your credentials" screenshot, and for the demo that form is the stand-in. The button says
  Google either way, because the popup is the only thing that changes when T9 flips the provider.
  The e2e suite drives the popup with Playwright's `page.waitForEvent("popup")`.
- The five unconnectable systems in the picker carry real vendor names (Temelio, SimplerGrants,
  Fluxx, Submittable, Foundant GLM) marked "Coming soon"; none is called, linked or described
  beyond a name and a website.

**Open questions**:

- Which Gmail accounts play the admin and the portal-only user once Google is real. Deferred to
  T9 with the rest of the Google work; the stand-in takes any address, and env overrides the seed
  placeholders either way.
- Whether 404 (this plan) or 403 is the right answer for an org outside the principal's grants.
  404 hides existence and needs no handler change; revisit when the protocol says.
- Whether stub systems should show a capabilities line (pull/push) at all, since nothing is known
  about them. Plan says no.

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

### #1188-T4: [✓] End-to-end proof through the fake provider, fixtures, and docs

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

### #1188-T5: [✓] Seed two more organizations per system and list a person's orgs

Depends on: #1188-T1 (scoped store), #1188-T3 (token forwarding)

- **Acceptance criteria**:
  - When either system boots, then its store holds three orgs: Agile Six plus two invented ones,
    each with a distinct EIN, the same EIN for the same org on both systems, Agile Six first.
  - When the admin signs in on either system, then `GET /common-grants/orgs` lists all three; when
    the portal-only person signs in on GrantPortal, then it lists Agile Six only.
  - When `POST /__test/reset` runs, then all three come back to seed.
  - When `GET /api/orgs?source=<id>` is called on Link with a token for that source, then it
    returns `{ connection, orgs: [{ id, name, ein }] }` in the system's order; with no token for
    that source it answers 401 with `connection: "not-connected"` and sends the source nothing; a
    401 from the source maps to `"expired"`.
  - When a listed org has no `org:us:ein` identifier, then `ein` is `null` rather than the org
    being dropped.
- **Implementation plan**:
  1. `packages/seed/src/other-orgs.ts` (new): two invented orgs per system (four `Organization`
     objects, two EINs, ids in the existing UUID series), copies deliberately identical across
     systems so they never show as drift. Export from `index.ts`, plus `PORTAL_SEEDS` and
     `FUNDERHUB_SEEDS` arrays alongside the existing singletons, which stay for the specs.
  2. `packages/seed/src/demo-users.ts`: the admin's grants gain the two new ids on both systems;
     portal-only is unchanged.
  3. `apps/portal` and `apps/funderhub` `src/lib/server/store.ts`: `new MemoryOrgStore(*_SEEDS)`.
  4. `packages/cg-org-sync/src/client/org-client.ts`: `OrgClient.list(): Promise<Organization[]>`
     over `GET /common-grants/orgs` (the paginated envelope `findByIdentifier` already parses),
     with the same `OrgClientError` mapping. `src/utils/orgs.ts` (new): `summarizeOrg(org):
OrgSummary { id, name, ein: string | null }` reading `identifiers["org:us:ein"].id`; export
     both.
  5. `client/fanout.ts`: `listOrgsAt(sourceId, options: FanoutOptions): Promise<OrgListResult>`
     returning `{ connection, orgs }`, with `NotConnectedError` → `"not-connected"` and no request,
     401 → `"expired"`, reusing the resolution logic `compareAcrossSources` has.
  6. `apps/link/src/routes/api/orgs/+server.ts` (new, thin): Zod-validate `?source=`, call
     `listOrgsAt` with `tokensFromHeader(request)`, `json()` it, 401 when not connected so the page
     can offer Connect. `src/lib/api-types.ts` re-exports `OrgSummary` and `OrgListResult`.
- **Edge cases**: an org with several identifiers (only `org:us:ein` is read); the source down
  (`OrgClientError` becomes `{ message }` with the source's status, not a crash); a source with
  `read: false` (refused before any request, as `syncToTargets` does for writes); the seed spec in
  `packages/seed` that asserts the two Agile Six copies differ must not start comparing the new
  orgs, which agree by design.
- **Unit tests**: `packages/seed`: every seed parses with `OrganizationBaseSchema`, ids and EINs
  are unique per system, the same EIN maps to the same name on both systems;
  `demo-users.test.ts`: the admin lists three on each system, portal-only one on portal and none
  on funderhub. `org-client.test.ts`: `list` parses the envelope and surfaces an error envelope as
  `OrgClientError`. `orgs.test.ts`: `summarizeOrg` with and without an EIN. `fanout.test.ts`:
  `listOrgsAt` not connected sends nothing; 401 is `"expired"`; the happy path returns summaries
  in order. `org-routes.test.ts`: `listOrgs` under a scoped store for both demo users.
- **Trade-offs**: Four more seed objects to keep conformant when the protocol moves. The new orgs
  agree across systems on purpose: the demo's drift story stays Agile Six's, and the others exist
  to be greyed out.

### #1188-T6: [✓] Empty state, system picker modal, and the Google sign-in step in a popup

Depends on: #1188-T3 (connect routes). Parallel with #1188-T5.

- **Acceptance criteria**:
  - When the widget opens with nothing linked, then the page shows only a title, a subtitle and a
    button reading "Link Grant Management System" (`data-testid="link-system"`): no system list,
    no EIN field, no grid, and no comparison request is made.
  - When that button is clicked, then a modal (`data-testid="link-modal"`, `role="dialog"`, focus
    trapped, closed by Escape and by ×) titled "Select your grant management system" lists
    GrantPortal, FunderHub, Temelio, SimplerGrants, Fluxx, Submittable and Foundant GLM in that
    order, each with a monogram, name and website line, and a search field that filters by name.
  - When a stub row is clicked, then nothing navigates; the row is greyed with a "Coming soon"
    note, and the stub never appears in `/api/compare` or `/api/sync` results.
  - When an available row is clicked, then the modal moves to a sign-in step showing the system's
    name and a "Continue with Google" button (`data-testid="continue-with-google"`); clicking it
    opens the portal's authorize URL in a popup and the modal shows a spinner with "Waiting for
    sign-in…" (`data-testid="signing-in"`) until the popup posts back. The spinner does not name
    Google, because with the stand-in provider that is not where the popup went.
  - When the popup posts a token, then the modal advances (to T7's org step; until T7 lands, it
    closes and the system shows as linked); when it posts `denied`, then the modal shows "No
    organization on <system> for that account" with "Try another account" and Close
    (`data-testid="denied-{id}"` inside the modal).
  - When `IDENTITY_PROVIDER=fake`, which is what the demo and the e2e suite run on, then the
    popup's form looks like the "Enter your credentials" screenshot: system name, email and
    password inputs, Submit. The password is accepted and ignored, and the page says in one line
    that it stands in for Google, so nobody watching mistakes it for the real thing.
  - When the popup is blocked, then the tab navigates instead, and on return the modal reopens
    where it left off.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/types.ts`: `SourceConfig.website?: string` and
     `SourceConfig.status?: "available" | "coming-soon"` (default available).
     `utils/sources.ts`: `isConnectable(source)`. In Link, `enabledSources()` excludes
     `coming-soon` from the fan-out and a new `catalogSources()` includes them for the picker.
  2. `apps/link/src/lib/server/sources.ts`: `website` on the two real entries; five `coming-soon`
     entries with `website` and no URLs. `+page.server.ts` returns the catalog as
     `{ id, label, website, capabilities, status }`.
  3. `apps/link/src/lib/components/LinkModal.svelte` (new): a `<dialog>`-based modal owning a
     small state machine `{ step: "pick" | "sign-in" | "waiting" | "denied" | "problem" }` plus
     the chosen source, steps as snippets. `SystemList.svelte` (new) for the searchable rows with
     a monogram from the label. Colours from the existing palette in `+page.svelte`.
  4. `+page.svelte`: strip the systems section, the EIN form and the `nothing-connected` prompt;
     render the empty state; open the modal; `connect(sourceId)` always tries `window.open` first
     and falls back to navigation with `?resume=<sourceId>&step=sign-in` in `returnPath()`, which
     the page reads on mount to reopen the modal. `listenForConnect` already receives the popup's
     message; route it into the modal's machine.
  5. `packages/cg-org-sync/src/server/identity.ts`: `fakeLoginPage` restyled, with the system
     label passed in (a new optional argument, wired from each portal's `fake-login` route), email
     plus a password input the form does not submit, and one sentence saying it stands in for
     Google. Escaping unchanged.
  6. Linked-system chips under the header once anything is connected (`connected-{id}`,
     `reconnect-{id}` and `denied-{id}` keep their meaning), with the "Link Grant Management
     System" button still shown.
- **Edge cases**: two popups (`window.open` with a fixed name reuses one); the popup closed by
  hand (poll `popup.closed` and return the modal to the sign-in step with a note); a
  `postMessage` for a source the modal is not waiting on (still stored, chip updates, modal
  untouched); search with no matches ("No systems match"); an available system with
  `read: false` (listed, but the sign-in step says it cannot be read); `resume=` naming an unknown
  source (ignored); the stand-in form pre-filling from `login_hint`.
- **Unit tests**: `sources.test.ts`: `isConnectable` and the default. `identity.test.ts`:
  `fakeLoginPage` renders the system name, still escapes `state` and the hint, and submits no
  password field. Everything else is app code, pinned in T8.
- **Trade-offs**: Real behaviour lands in Svelte (the modal machine) where no Vitest reaches it;
  kept to state transitions, with every decision about tokens and orgs in the library. A
  decorative password field is a lie the demo tells on purpose, and it is labelled. Real vendor
  names on a "coming soon" row carry a small reputational risk, accepted on 2026-09-14.

### #1188-T7: [✓] Organization step, EIN lock-in on the second connect, and the success banner

Depends on: #1188-T5, #1188-T6

- **Acceptance criteria**:
  - When the popup posts a token for the first system linked, then the modal shows "Select your
    organization" listing that system's orgs from `GET /api/orgs` as name and EIN
    (`data-testid="org-{id}"`), Agile Six first, with Continue disabled.
  - When one org is picked, then Continue enables and every other row is disabled and greyed;
    picking the same row again clears it.
  - When Continue is clicked, then the modal closes, a dismissible banner reads "<System> linked"
    (`data-testid="linked-banner"`), the header shows the org's name and EIN
    (`data-testid="linked-org"`), and the grid loads for that EIN.
  - When a second system is connected, then only the row whose EIN matches the linked org is
    selectable and it is pre-selected; the rest are greyed with "Different organization"; when no
    row matches, the step says "<System> holds no organization with EIN <ein>" and offers Close,
    and that system's column then reads "No record of this organization" as it does today.
  - When the tab reloads, then the linked org and every token survive from `sessionStorage`, the
    modal stays closed, and the grid reloads.
- **Implementation plan**:
  1. `packages/cg-org-sync/src/utils/orgs.ts`: `selectableOrgs(orgs, lockedEin: string | null)`
     returning each `OrgSummary` with `selectable: boolean` and an optional `reason`. Pure and
     tested; the lock rule lives here and the component only renders it.
  2. `apps/link/src/lib/tokens.ts`: `rememberLinkedOrg({ registry, id, name })`,
     `readLinkedOrg()` and `forgetLinkedOrg()` on the same `sessionStorage` wrappers.
  3. `LinkModal.svelte`: steps `"orgs"` and `"no-match"`; on entering `"orgs"` fetch
     `/api/orgs?source=` with the `x-source-tokens` header; on Continue call an `onlinked` prop
     with the summary.
  4. `+page.svelte`: `linkedOrg` state seeded from storage on mount; `registry`/`id` derive from it
     (`EIN_REGISTRY` plus the EIN); `reload()` requires a linked org, not just a token; banner
     state with a Dismiss control. `DEFAULT_EIN` stops being the opening state (nothing linked
     is), but `?registry=&id=` is still honoured as a pre-locked EIN for the demo script.
  5. `OrgSummary` and the lock reason strings exported from `api-types.ts` so the e2e specs and
     the page name one type.
- **Edge cases**: a token arrives for a system with no matching org and the person closes the
  modal (token kept, chip says linked, column says no record; not an error); the linked org has
  no EIN (lock by org name as a fallback, and say so); `/api/orgs` 401 mid-step (return to
  sign-in with "This connection expired"); Reconnect on a linked system (skip the org step when
  the EIN still matches, otherwise run it); the deep-link EIN and a stored linked org disagree
  (the URL wins and the storage is replaced, since the URL is what the presenter typed).
- **Unit tests**: `orgs.test.ts`: `selectableOrgs` with no lock (all selectable), with a lock (one
  selectable, the others carrying the reason), with no match (none selectable), and with a `null`
  EIN. App behaviour is pinned in T8.
- **Trade-offs**: The org list is the system's own answer, so a person granted several orgs sees
  several; "you may link one at a time" is enforced only in Link's UI, since the contract has no
  notion of a linked org. Storage of the linked org is per tab, like the tokens.

### #1188-T8: [✓] End-to-end specs for the Plaid flow, and docs

Depends on: #1188-T7

- **Acceptance criteria**:
  - When `pnpm e2e` runs, then every existing assertion in `widget.spec.ts`, `connect.spec.ts` and
    the `api-*` specs still passes, driven through the modal and popup rather than the old list.
  - When the new `link-flow.spec.ts` runs, then it proves: the empty state shows one button; the
    picker lists seven systems with five greyed; a stub click goes nowhere; the first connect
    shows three orgs and Continue disabled until a pick; the banner and linked header appear; the
    second connect pre-selects the matching org and greys the other two; and picking a different
    org first, then connecting a system holding no org with that EIN, shows "holds no organization
    with EIN".
  - When the README and demo script are followed, then the click path matches the modal, both say
    plainly that sign-in is the stand-in form and that Google is T9, and `CLAUDE.md`'s "The project
    is early" paragraph and the `apps/link` wiring list name the new components and route.
- **Implementation plan**:
  1. `e2e/fixtures.ts`: `connect(page, sourceId, email, { orgId? })` becomes open modal → click
     the system row → Continue with Google → `page.waitForEvent("popup")` → fill the stand-in form
     in the popup → wait for the org step → pick → Continue → wait for `connected-{id}`;
     `connectExpectingDenial` waits for the modal's `denied-{id}`; `openWidget` is unchanged;
     `connectViaApi` and `tokenFor` are unchanged, since they never touch the page.
  2. `e2e/specs/link-flow.spec.ts` (new) with the beats above; `widget.spec.ts` swaps the `ein`
     assertion for `linked-org`; `connect.spec.ts` asserts against the modal and the chips.
  3. `e2e/env.ts`: the second seed org's EIN from `@cg-link/seed` for the no-match beat.
  4. Docs: `README.md` (what the widget does, with new screenshots of the three modal steps, and
     a line in the Google section saying the stand-in is what the demo runs on until T9),
     `docs/demo-script.md` (the click path rewritten
     around the modal, the "second system pre-selects the org" beat, and what to check when the
     popup is blocked), `CLAUDE.md` (the widget paragraph, the `link` wiring list, the new
     `SourceConfig` fields, `GET /api/orgs`), and all three landing-page route lists.
- **Edge cases**: Vite compiling the popup's first route (reuse the retry helper); Playwright's
  popup must be awaited before the click that opens it; the `problem` banner must stay absent in
  every happy path; the blocked-popup fallback gets one spec that stubs `window.open` to return
  `null`.
- **Unit tests**: none new; this ticket is the suite and the docs.
- **Trade-offs**: The Google path is neither driven by the suite nor verified by hand at this
  point; T9 is where it becomes real, and until then every sign-in on screen is the stand-in. The
  specs now depend on the popup mechanism, with the same-tab fallback covered by the one stubbed
  spec.

### #1188-T9: Stand real Google sign-in up behind the stub, after the demo

Depends on: #1188-T8. Deliberately the last ticket: the demo runs on the stand-in, and nothing
before this ticket needs a Google account.

- **Acceptance criteria**:
  - When a portal has `IDENTITY_PROVIDER=google` with a client id and secret, then clicking
    "Continue with Google" in the modal opens Google's own account chooser in the popup, and
    signing in as the admin account returns to the modal on the organization step with that
    system's orgs listed.
  - When the same flow is run as an account with no grant on that system, then the popup returns
    the modal to its denied step, exactly as the stand-in does.
  - When a portal starts, then one log line names which identity provider it is using, so a
    presenter can tell a misconfigured portal from a working one without reading `.env`.
  - When `IDENTITY_PROVIDER` is unset or `google` while the client id or secret is missing, then
    `/oauth/authorize` fails with a sentence naming the missing variable rather than sending
    someone to Google with an empty client id.
  - When `pnpm e2e` runs with both portals back on `fake`, then the whole suite still passes.
  - When the README is followed by someone with no Google project, then the console steps, the
    redirect URIs, the test-user list and the popup settings are all there.
- **Implementation plan**:
  1. Google Cloud console, by hand (see "Google sign-in setup" below): one project, consent screen
     in Testing with both demo accounts as test users, one Web application OAuth client with each
     portal's own `/oauth/callback` as a redirect URI.
  2. `apps/portal` and `apps/funderhub` `src/lib/server/oauth.ts`: refuse to build a
     `GoogleIdentityProvider` with an empty client id or secret, returning the same shape
     `oauthConfig` already returns for a missing signing key so `authorize` answers a sentence;
     add the provider-name log line, emitted once per isolate like `keys.ts` memoizes.
  3. Both `.env.example` files: the Google variables move from "fill these in later" to the real
     instructions, with the callback URI spelled out per app.
  4. `README.md`: the "Signing in with Google instead" section becomes the verified procedure,
     including the popup allowance and the one-time unverified-app screen. `docs/demo-script.md`
     gains a short "if we are running on Google today" note beside the stand-in click path.
  5. Run the whole demo script by hand against Google, both people, both systems, and record what
     the unverified-app screen looks like so nobody meets it for the first time on stage.
- **Edge cases**: a redirect URI that differs from `SYSTEM_ORIGIN` by a trailing slash (Google
  refuses with nothing in the request explaining why; `callbackUrl` already trims, and the README
  says to match them); an account that is not on the test-user list (Google returns
  `access_denied` before our callback runs, which the modal shows as denied and the portal logs
  through `onProblem`); `email_verified` false (already refused in `GoogleIdentityProvider`); the
  browser already signed into a different Google account (the chooser, not a silent sign-in);
  Chrome blocking the popup on the demo machine (the same-tab fallback still works, and the README
  says to allow popups beforehand); `pnpm e2e` run while a portal is on `google` (the suite
  already fails with a sentence naming that app).
- **Unit tests**: none new. `identity.test.ts` already pins `GoogleIdentityProvider` against a
  local JWKS, and nothing here can be reached from a test that does not talk to Google.
- **Trade-offs**: This is mostly console work and a by-hand run, which is why it is a ticket of its
  own and why it sits after the demo. Until it lands, every sign-in in this repo is the stand-in
  form, which proves nothing about who someone is — acceptable while the grant model, not the
  identity, is what the demo is claiming.

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

### #1189-T1: [✓] Add an editable org profile page to GrantPortal and FunderHub

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

### #1189-T2: [✓] Embed Link in the portals as an iframe with a postMessage bridge

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

### #1189-T3: [✓] Make direction explicit: push to, pull from, driven by capabilities

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

**Goal**: Temelio appears in Link as a third system through `apps/temelio-adapter`: a
CommonGrants-conformant proxy that holds a Temelio sandbox credential server-side and translates
the three org routes onto Temelio's own API. The framing for Temelio is wrapper first, native
later — this is what their existing API looks like behind the contract today, and the routes are
what they would serve themselves eventually. The adapter writes as well as reads if the sandbox
allows it, because the demo this issue builds toward is a push into a system we do not control.

**Target demo** — the whole beat, and which ticket delivers each step. Steps 1, 4 and 5 are the
Temelio-specific ones; the rest are #1189 and #1191, listed so the dependencies are visible:

1. The same organization is open in GrantPortal, FunderHub and Temelio, and the three copies
   disagree — #1190-T3 puts Agile Six behind the adapter; #1189-T1 gives the two portals a profile
   page.
2. The person changes the website or the address on GrantPortal's profile page — #1189-T1.
3. They click "Sync profile" on that page and Link opens as a modal over GrantPortal — #1189-T2.
4. In the modal they pick FunderHub and Temelio, sign in to each, and see the three-column
   comparison — #1188 (done) plus #1190-T3, which makes the adapter its own authorization server.
5. They select the fields that differ and click Push — #1191-T1 for several fields in one patch,
   #1190-T4 for Temelio accepting the write.
6. They open FunderHub's and Temelio's own pages and see the change — #1189-T1 for FunderHub;
   Temelio's sandbox UI when the adapter is on the sandbox, or the adapter's own page in fixture
   mode (#1190-T5).

**Scope**:

- In: a time-boxed spike against the sandbox that answers the two day-0 blockers; a
  `TemelioOrgStore` implementing `OrgStore` over Temelio's records, under Vitest in the adapter's
  own suite; the same fifteen-file wiring the two portals carry (bearer guard, own ES256 key and
  JWKS, own OAuth server on the fake or Google provider, reset route); a write path guarded by an
  allowlist of sandbox org ids; a fixture mode so `pnpm e2e` runs offline; Link's registry entry
  flipped from `coming-soon`; README, CLAUDE.md and demo-script updates; the findings-memo entries
  this work produces.
- Out: Temelio's per-relationship profile copies (the spec names them as follow-on work — the
  adapter syncs the root record only); embedding Link in Temelio; fields beyond what the mapping
  carries; a registry-catalog PR for `org:temelio:system` (a memo item, not code); a D1 store.

**Assumptions**:

- **The vendor-facing detail lives in Billy's spec, not here.** The endpoints, record shapes and
  field-by-field mapping are in the "The Temelio proxy" section of the Org Profile Sync Spec doc,
  which is marked internal. This repo is public. `PLAN.md`, `README.md` and `docs/` describe the
  vendor side only by pointing at that section. The adapter's source has to name what it calls,
  so everything that does is confined to one directory, `apps/temelio-adapter/src/lib/server/temelio/`,
  and imported from exactly one place — so it can be lifted into a private package with a single
  import change if that is what Billy decides. See the open question.
- **Settled by the spike (2026-09-16):** our access is a funder account, and a funder cannot
  read a nonprofit's own record — the reachable one is the per-funder copy, a single record that
  carries the legal name, EIN, mission, founding date, socials, both addresses, email and phone.
  The adapter wraps that record. A read is one call and a write is one merge POST, so there is
  no two-record compose and no read-modify-write. The credential is a foundation API key on the
  `X-API-Key` header; it reads, searches and merge-writes, and cannot use the single-field route. Billy's plan assumed the root record; the
  difference is a memo finding. The findings file has the field-by-field mapping.
- The sandbox is shared and real. Every write the adapter makes is gated by
  `TEMELIO_ORG_ALLOWLIST`, whatever credential the caller presented — the service token included.
- Temelio records are matched by EIN like everyone else's; the funder-scoped search filters on
  it directly (digits only). We created our own grantee, Agile Six with the demo's EIN, so the
  adapter writes to a record nobody else uses.
- The adapter is its own authorization server exactly like the two portals — same shared
  handlers, same fake or Google identity provider — so signing in to Temelio in the modal looks
  like signing in anywhere else. Grants: the admin may touch every allowlisted org; the
  portal-only person nothing, so Temelio refuses them the way FunderHub does.
- Capabilities start at `{ read: true, write: false }` (#1190-T3) and flip to `write: true` when
  #1190-T4 lands. If the spike finds writes impossible, T4 is cut, `write: false` stays, and the
  Temelio beat becomes a pull from Temelio into GrantPortal (#1189-T3).

**Open questions**:

- Public repo versus internal API detail: does the vendor-facing directory stay in this repo, or
  move to a private package the adapter depends on? Decide with Billy before #1190-T2 merges. The
  plan assumes it stays and the prose stays abstract.
- Public repo versus internal detail also covers the findings file: it stays gitignored, and the
  memo entries move to Billy's doc in T5.

### #1190-T1: [✓] Spike the Temelio sandbox and record what the adapter can rely on

Depends on: sandbox access from Ruthwick. Time-box: half a day, before any adapter code.

**Status 2026-09-16**: done. Findings are in `apps/temelio-adapter/SANDBOX-FINDINGS.local.md`
(gitignored via `*.local.md`, because the repo is public). All five questions are answered
against the real foundation with the credential the adapter will use; the test grantee exists,
is seeded with drift, and is findable by EIN. Branches in T2–T4 are resolved below.

- **Acceptance criteria**:
  - When the spike is done, then `apps/temelio-adapter/SANDBOX-FINDINGS.local.md` (gitignored;
    the repo is public) answers, in plain words: (a) how the sandbox authenticates and whether one token can be held
    server-side for the length of a demo; (b) whether the metadata write merges into the record or
    replaces it; (c) whether the org search by EIN returns the record we expect, and what a miss
    looks like; (d) whether the thin record can be written, and whether a nonprofit carrying the
    demo's EIN can be created, or an existing sandbox org has to be adopted; (e) what a refused
    write looks like — status and body — so the adapter can pass it through faithfully.
  - When those are answered, then every "Branch on T1" note in T2–T4 below is resolved in this
    file, and any ticket the answers make impossible is marked cut rather than left open.
  - When the spike is finished, then `apps/temelio-adapter/.env.example` exists and names
    `TEMELIO_API_ORIGIN`, `TEMELIO_API_TOKEN`, `TEMELIO_ORG_ALLOWLIST` (comma-separated ids) and
    `TEMELIO_MODE` (`fixture` | `sandbox`), each with a comment and no value.
  - When a recorded request or response is kept for T2's tests, then it is scrubbed of anything
    beyond the demo org — other orgs, tokens, people — before it is committed.
- **Implementation plan**:
  1. Sign in to the sandbox with devtools open and capture the calls its own profile page makes on
     load and on save: the auth header's shape, and the token's lifetime (decode `exp` if it is a
     JWT).
  2. With the captured token, read the demo org by hand with `curl`, then search for it by EIN.
     Compare what comes back with the spec's mapping table and note every field the table names
     that is absent, renamed or shaped differently.
  3. On a sandbox org we own: write a metadata body carrying one field, read back, and check
     whether everything else survived. That is the merge-or-replace answer. Restore the value.
  4. Try the thin-record write. If the sandbox lets us, create a nonprofit with EIN `123456789`
     (the demo's, a registry example value); otherwise record the adopted org's EIN for T2's seed.
  5. Write the findings into the doc, resolve the branches in this file, write `.env.example`.
- **Edge cases**: the token expires within a demo (record the lifetime; if it is short, T3 mints
  or refreshes it at first request rather than reading a stale one from `.env`); the sandbox
  rate-limits a read-per-org list; the UI uses a call the published OpenAPI document does not
  list (prefer the documented one, note the difference).
- **Unit tests**: none. The output is the findings section and the resolved branches.
- **Trade-offs**: Half a day that produces no code, so that T2, T3 and T4 do not each rediscover
  the same blocker on their own day.

### #1190-T2: [✓] `TemelioOrgStore`: the mapping between Temelio's records and `Organization`, under test

Depends on: #1190-T1 for the confirmed shapes. Can start against the spec's table and adjust.

- **Acceptance criteria**:
  - When `apps/temelio-adapter` gains a `test` script, then `pnpm test` runs its Vitest suite
    alongside the packages' (`pnpm -r run test` picks it up).
  - When `toOrganization(record)` is given the fixture record (the per-funder copy), then it
    returns an `Organization` that parses under `OrganizationBaseSchema`, with `id` set to
    Temelio's nonprofit id, `identifiers.systemId` under `org:temelio:system`, the EIN under
    `org:us:ein`, and the four demo fields where the findings file's table puts them.
  - When a vendor value has no counterpart, or a lossy one (the org type), then it lands in
    `customFields` or is dropped as the table says, and one test names every dropped field so the
    list T5 publishes cannot drift from the code.
  - When `toMetadataPatch(before, after)` is given the current and the patched `Organization`,
    then it returns one merge body holding only the top-level Temelio keys that changed — with
    sub-objects such as `headquarters` sent whole, since Temelio's merge is shallow — `""` for a
    cleared field (Temelio ignores `null`), and nothing for `name`, which a funder cannot change.
    So a patch to the website sends exactly one call carrying exactly one key.
  - When `TemelioOrgStore.list()` runs, then it returns one `Organization` per allowlisted org id
    in allowlist order (one read each); an id the foundation has no interaction with (403) is
    skipped with one log line; a 401 or 5xx throws, so the route answers an error rather than an
    empty list that reads as "no record".
  - When `read(orgId)` is asked for an id outside the allowlist, then `undefined`, with no request
    sent — the same answer `scopedStore` gives for an org outside a grant.
  - When `write(org)` runs, then it diffs against the current record, sends one merge POST,
    re-reads (writes return an empty body), and returns the result; the api client refuses a
    write outside the allowlist by throwing before any request, so no path — route, script or
    test — can reach Temelio for an org not on the list.
- **Implementation plan**:
  1. `apps/temelio-adapter/package.json`: `"test": "vitest run"`, `vitest` as a `catalog:`
     devDependency, `@cg-link/seed` as a dependency; a `vitest.config.ts` matching
     `packages/seed`'s (`src/**/*.test.ts`).
  2. `src/lib/server/temelio/records.ts`: a Zod schema for the per-funder record as the adapter
     reads it — only the fields it maps, every one nullable, `null` and `""` both meaning empty —
     plus the search page and the `ApiError` envelope. Parsed at the boundary the way `OrgClient`
     parses its responses, so a vendor change fails loudly rather than leaking a half-mapped
     profile into the grid.
  3. `src/lib/server/temelio/mapping.ts`: `toOrganization`, `toMetadataPatch`,
     `TEMELIO_SYSTEM_REGISTRY = "org:temelio:system"`, `yearFounded` from the `YYYY-MM-DD`
     founding date (and back as `<year>-01-01`), the `customFields` pass-through for `dba`,
     `vision`, `description`, `legalStatus`, and `DROPPED_FIELDS` — the funder-side fields the
     mapping leaves behind.
  4. `src/lib/server/temelio/api.ts`: a `TemelioApi` interface with three methods — search the
     foundation's grantees by EIN, read one grantee's record, merge-write one record — and
     `TemelioHttpApi` implementing it over an injectable `fetch`, scoped to `TEMELIO_FOUNDATION_ID`,
     sending the key as `X-API-Key`, with the allowlist guard on the write; failures as
     `TemelioApiError { status, message }` from the `ApiError` envelope (and from the bare Spring
     403 body, which has no `message`).
  5. `src/lib/server/temelio/store.ts`: `TemelioOrgStore implements OrgStore` over a `TemelioApi`
     and the allowlist. Its doc comment says plainly that it is a projection, not a round trip —
     see trade-offs.
  6. `src/lib/server/temelio/fixture.ts`: `FakeTemelioApi implements TemelioApi` — in memory,
     seeded with a hand-written vendor-shape record for Agile Six matching what we seeded in the
     real foundation (findings file, "as seeded"), plus two funder-side fields, with `reset()`.
     This is also T3's fixture mode and T5's offline e2e.
  7. `packages/seed/src/agile-six.ts`: `TEMELIO_ORG_ID` (the real grantee's id, since fixture and
     sandbox should agree) and `TEMELIO_SEED: Organization`, drifted the way the real record is —
     website `http://www.agile6.com`, Suite 210, no LinkedIn — so a three-column comparison has
     three answers for the website and two for the address. `TEMELIO_SEEDS = [TEMELIO_SEED]`. `agile-six.test.ts` covers it as it does the
     other two. `DEMO_USERS` is left alone and `demo-users.test.ts` keeps pinning
     `grantsFor("temelio", …)` empty: Temelio's grants come from the allowlist (T3), not the seed,
     because in sandbox mode the ids are whatever the sandbox assigned.
  8. Tests. `mapping.test.ts`: `toOrganization(fixture)` equals `TEMELIO_SEED` (which is what
     keeps the vendor-shape fixture and the CommonGrants-shape seed in step);
     `toMetadataPatch(seed, seed with a new website)` is exactly `{ website }`; a changed suite
     number yields the whole `headquarters` object; a cleared field yields `""`; a changed `name`
     yields nothing; `DROPPED_FIELDS` matches what the fixture loses on a round trip. `store.test.ts` over `FakeTemelioApi`: `list` is the allowlist;
     `read` outside it is `undefined` and sends nothing; `write` re-reads; a refused write never
     reaches the fake's write. `api.test.ts`: `TemelioHttpApi` against a stubbed `fetch` with the
     scrubbed pair from T1 — the bearer header, the search query, a 401 and a 5xx each becoming
     `TemelioApiError`.
- **Settled by T1**: writes merge at the top level, so `write` diffs and sends one merge POST
  with whole sub-objects — no read-modify-write of the record, but the address is sent complete.
  `""` clears and `null` is ignored. The single-field route exists but refuses the API key, so
  it is not used. The EIN lookup is the funder-scoped typed search with a string filter on `ein`,
  digits only, 1-based pages; the same EIN can match several records, so take the first active
  hit and log the rest. Address keys are `address1`/`address2`/`zipcode`; `records.ts` follows the
  findings file, not Billy's table.
- **Edge cases**: a record with no EIN (mapped with no `org:us:ein` entry; it matches nothing,
  which the fan-out already reports as "no record" rather than an error); a null founding date
  (no `yearFounded`); a mailing address that is all `null`/`""` (no `otherAddresses`); `null`
  versus `""` for empty (both read as absent, and a cleared field is written as `""`); a
  `name` change (no update sent, and T4 names `name` in `unwritableFields` so the sender hears
  about it).
- **Unit tests**: as above, in the adapter's own suite.
- **Trade-offs**: `OrgStore.write`'s contract says unknown keys must survive a write, and a store
  that projects onto a vendor's columns cannot honour it — an older sender's field that Temelio
  has no home for is gone after one patch. Documented on the class rather than papered over, and
  it is the memo's "a real vendor covers a fraction of OrganizationBase" finding, observed rather
  than contrived. The bigger memo item is that the funder-side copy, not the nonprofit's own
  record, is the surface a funder integration can reach — which is the opposite of what the plan
  assumed and exactly the "which copy does GET /orgs/{orgId} return" question ADR-0026 leaves open. Vendor code in a public repo is the open question above;
  the one-directory rule is what keeps that decision cheap.

### #1190-T3: [✓] Serve the CommonGrants routes over Temelio, and put Temelio in Link's picker

Depends on: #1190-T2.

- **Acceptance criteria**:
  - When the adapter runs with `TEMELIO_MODE=sandbox`, a token and an allowlist, then
    `GET /common-grants/orgs?registry=org:us:ein&id=<ein>` returns Agile Six as an `Organization`
    carrying Temelio's own id, `GET /common-grants/orgs/{orgId}` returns the composed profile, and
    `PATCH` answers 405 until T4 (SvelteKit's answer for an unexported method — assert it, so the
    read-only claim is pinned rather than assumed).
  - When it runs with `TEMELIO_MODE=fixture`, then the same routes answer from `FakeTemelioApi`
    and no request leaves the process; `POST /__test/reset` behind `ENABLE_TEST_ROUTES` resets the
    fake; in sandbox mode that route answers 409 with a sentence saying a shared sandbox cannot be
    reset, so the e2e fixture fails by name rather than by a mystery assertion.
  - When `/common-grants/*` is hit with no credential, then 401 in the portals' envelope; with a
    token the adapter minted, reads are scoped to that person's grants; with `CG_ACCESS_TOKEN`,
    everything the allowlist exposes and nothing beyond it.
  - When someone signs in to Temelio through Link's modal as the admin, then the organization step
    lists the allowlisted org and locks to the linked EIN like any other system; as the portal-only
    person, the modal lands on its denied step — Temelio refuses them as FunderHub does.
  - When Link's registry entry is flipped, then Temelio is a third column in the comparison with
    `capabilities: { read: true, write: false }`, its picker row starts a flow, and the
    `coming-soon` assertions in `connect.spec.ts` and `link-flow.spec.ts` move to another named
    system.
  - When the adapter starts serving, then one log line names its mode and its identity provider,
    so a presenter can tell fixture from sandbox without opening `.env`.
- **Implementation plan**:
  1. The portal wiring, adapted. `src/lib/server/store.ts`: `SYSTEM_ID = "temelio"`;
     `temelioApi()` picks `TemelioHttpApi` or `FakeTemelioApi` from `TEMELIO_MODE`, built once per
     isolate on first request and memoized by the values it was built from, the way `keys.ts`
     memoizes the key — `$env/dynamic/private` is empty at module load, and in fixture mode the
     fake must be a singleton or writes vanish between requests; a module-level `TemelioOrgStore`
     over it; `routesFor(principal)`. Then `keys.ts`, `hooks.server.ts`, `app.d.ts`,
     `oauth.ts` (grants computed here: `roleFor(email, users) === "admin"` → the allowlist ids,
     anyone else → `[]`), routes `common-grants/orgs/{+server.ts,[orgId]/+server.ts}` with GET
     only, `[x+2e]well-known/jwks.json`, `oauth/{authorize,callback,fake-login}`, `token`,
     `__test/reset` (with the 409 branch), and `.env.example` gaining the portals' variables
     (`CG_ACCESS_TOKEN`, `SIGNING_KEY_JWK` with its own fresh key, `ENABLE_TEST_ROUTES`,
     `IDENTITY_PROVIDER`, `SYSTEM_ORIGIN`, `LINK_ORIGIN`, `DEMO_*_EMAIL`). The landing page's
     route list loses "Not implemented yet" and shows the mode.
  2. `packages/seed/src/demo-users.ts`: `roleFor(email, users): DemoRole | undefined`, since the
     adapter cannot use `grantsFor` when its ids come from the environment. Tested beside
     `grantsFor`.
  3. `apps/link/src/lib/server/sources.ts`: replace `comingSoon("temelio", …)` with a real entry —
     `baseUrl` on 5175, `authorizeUrl`, `tokenUrl`, `website: "temelio.com"`,
     `capabilities: { read: true, write: false }`, and a comment saying T4 flips it.
  4. `e2e/env.ts`: `TEMELIO_ORIGIN` and `SYSTEM_ORIGINS.temelio`; `playwright.config.ts`: a fourth
     `webServer`; `fixtures.ts`: the reset and the per-system token now cover three systems (it
     already iterates `SYSTEM_ORIGINS`; check nothing is hard-coded to two). Move the coming-soon
     assertions to `simpler-grants`. `api-compare.spec.ts` asserts the third column and that the
     website row now holds three distinct values.
  5. Docs: the README's app table row for the adapter stops saying placeholder and the variable
     table gains its four variables; CLAUDE.md's `.env` paragraph covers three apps and says
     `pnpm e2e` needs the adapter's `.env` with `TEMELIO_MODE=fixture`.
- **Settled by T1**: the session JWT lives sixty seconds, so it is not a credential the adapter
  can hold. `TEMELIO_API_TOKEN` is the funder API key (`cg-link-adapter`, Edit), sent as
  `X-API-Key`; it covers read, search and merge-write on the grantee routes. The adapter also
  needs `TEMELIO_FOUNDATION_ID`, since every reachable route is under the foundation.
- **Edge cases**: the sandbox is down or the token has expired (the store throws, the route
  answers 502, and the Temelio column reads as an error — never as agreement or as "no record");
  an empty allowlist (an empty list plus one log line naming the variable); `TEMELIO_MODE` unset
  (default to `fixture`, so a fresh checkout with no sandbox works, and the start-up line says so);
  sandbox mode with `ENABLE_TEST_ROUTES=true` (the 409, not a reset); the admin's grant when the
  allowlist has two ids (both listed, the EIN lock picks one).
- **Unit tests**: `store.test.ts` gains the 401-and-5xx-throw case if T2 did not. The wiring itself
  is covered by `pnpm e2e`, as the portals' is.
- **Trade-offs**: The same fifteen files a third time. One parameterised app was rejected for the
  two portals, and the argument is stronger here: the adapter is the copy that is _not_ a copy,
  and its differences — mode, allowlist, projection — read more clearly next to a full copy than
  threaded through a shared app as flags.

### #1190-T4: [✓] Push to Temelio: `PATCH` through the adapter, guarded by the allowlist

Depends on: #1190-T3, and T1's answer that the sandbox accepts writes. If it does not, mark this
ticket cut, keep `write: false`, and the Temelio beat is a pull into GrantPortal via #1189-T3.

- **Acceptance criteria**:
  - When `PATCH /common-grants/orgs/{orgId}` arrives with a merge patch setting `socials.website`,
    then the adapter reads the current record, applies the patch, sends one merge POST carrying
    `website`, re-reads, and answers an `OrgRevision` whose snapshot carries the new website — and
    the grantee's page in Temelio shows it.
  - When the patch sets `name`, which Temelio does not let a funder change, then the field is
    dropped and named in the message through `unwritableFields: ["name"]`, exactly as FunderHub
    does, so the widget's existing handling applies and #1191-T2's grey-out can list it in Link's
    config.
  - When the patch targets an id outside the allowlist, then 404 and no sandbox request.
  - When the sandbox refuses the write, then the adapter answers 502 with the sandbox's status and
    message in `errors`, so `SyncResults` shows what Temelio said rather than "accepted".
  - When Link's entry flips to `capabilities: { read: true, write: true }`, then Temelio is offered
    as a target, and `api-sync.spec.ts` pushes GrantPortal's address to Temelio in fixture mode and
    then sees the address row agree across all three.
  - When fixture mode receives that write, then `FakeTemelioApi` holds it and the vendor-only
    fields survive — asserted through the fake in a store test, since the e2e suite can only see
    the composed profile.
- **Implementation plan**:
  1. `[orgId]/+server.ts`: export `PATCH` calling `updateOrg(orgId, request, routesFor(principal))`.
     `store.ts`: `unwritableFields` from T2's dropped list, so the shared handler does the naming.
  2. A store that talks to a network fails in ways `MemoryOrgStore` never does, and `updateOrg`
     has nowhere to put that today. Add `StoreError { status, message, errors }` to
     `packages/cg-org-sync/src/server/store.ts`; `updateOrg` (and `readOrg`, `listOrgs`) catch it
     and answer `failure(502, …)` with the cause in `errors`. `TemelioOrgStore` wraps
     `TemelioApiError` in it. Pinned in `org-routes.test.ts` with a throwing store. The alternative
     — a try/catch in the adapter's route — leaves every future non-memory store re-inventing it.
  3. `TemelioOrgStore.write`: one merge POST carrying only the changed top-level keys, so the
     demo's website or address push is exactly one vendor call.
  4. Flip Link's capabilities; update `api-sync.spec.ts` and `widget.spec.ts` (Temelio appears as a
     target checkbox).
  5. By hand against the sandbox: push the website from GrantPortal to Temelio, screenshot the
     sandbox UI for the README, then put the old value back so the drift is there for the next run.
     The restore steps go in `docs/demo-script.md` as "reset Temelio by hand", since
     `/__test/reset` refuses in sandbox mode.
- **Settled by T1**: shallow merge via one POST; a cleared field is sent as `""`, since Temelio
  ignores `null`; the funder cannot rename a grantee.
- **Found during T4's by-hand run, and folded in**: `ein` is the one key that does _not_ merge — a
  write naming any other field silently blanks it, after which the grantee cannot be found by EIN
  at all. `toMetadataPatch` restates `ein` on every non-empty write, with a unit test and the
  reproduction in the findings file. Every other mapped field survives a single-field write, so
  this is a narrow quirk rather than a change of model.
- **Beyond the criteria**: `unwritableFields` is `["name", "orgType"]`, not `["name"]` alone.
  Temelio has no field for an organization type — its own entity type is a two-value flag and its
  legal status is free text — so a patch setting `orgType` would otherwise be dropped in silence,
  which is the exact failure this mechanism exists to convert into a sentence. Not reachable from
  the widget, since `orgType` is not in `DEMO_FIELDS`; verified by hand against the route.
- **Edge cases**: the last-write-wins race — someone edits in Temelio's UI between the adapter's
  read and its write, and the adapter overwrites (memo item: the spec should say LWW plainly and
  there is no `If-Match` to lean on); a merge body Temelio accepts with 200 but stores
  differently (the re-read is the truth, and the revision echoes what was stored); the allowlist changing
  between a compare and a sync (404 at sync time, already handled per target).
- **Unit tests**: `store.test.ts`: a write touching two fields sends one POST with two keys; an
  unchanged field is absent from the body; a refused write throws before any request; a 4xx
  surfaces as `StoreError`. `org-routes.test.ts`: a store that throws `StoreError` becomes a 502 envelope.
- **Trade-offs**: The write is one call, so there is nothing to roll back — but a shallow merge
  means a one-line address change ships the whole address, which is the read-modify-write in
  miniature and has the same last-write-wins window. Said in the memo.

### #1190-T5: [✓] Prove it end to end, and tell the story

Depends on: #1190-T3 for the reads and, if it lands, #1190-T4 for the push.

- **Acceptance criteria**:
  - When `pnpm e2e` runs, then it boots four apps and covers: Temelio as a third column holding
    its own website value; signing in to Temelio as the admin lists the org and as the portal-only
    person is refused; and, with T4, pushing to Temelio lands and the comparison agrees.
  - When the adapter runs in fixture mode, then its landing page shows the profile it currently
    holds — the four demo fields, re-read on every load — so step 6 of the target demo has a
    screen when the sandbox is unavailable. In sandbox mode the page links to the sandbox UI
    instead.
  - When the README is read, then the adapter is described as the wrapper-first pattern, with
    setup (`.env`, the two modes) and no endpoint or record detail beyond "Temelio's own API";
    `docs/demo-script.md` gets the three-system click path, a `curl` block for the adapter beside
    the portals', the by-hand sandbox reset, and the adapter's log lines in "what to check when
    something is off".
  - When the memo is drafted, then it carries what this work produced: which copy of a profile a
    funder integration can actually reach; projection versus round trip in `OrgStore.write`; the
    LWW race, widened by a shallow merge on sub-objects; the field that did not merge at all and
    what that implies for conformance testing; `org:temelio:system` needing a catalog entry; and
    whatever T1–T4 turned up beyond that. Written to `docs/adr-0026-memo.local.md` rather than to
    Billy's doc — gitignored, because it names the vendor's private API and this repo is public.
    The shareable version is that file with the endpoint shapes removed.
  - When CLAUDE.md is read, then "Not started" no longer names the adapter, the layout section
    describes the adapter's directory and modes, and the `.env` paragraph covers three apps.
- **Implementation plan**: `e2e/specs/temelio.spec.ts`, or the Temelio cases folded into the
  `api-*` and `connect` specs where they fit; the adapter's `+page.server.ts` and `+page.svelte`;
  `README.md`, `docs/demo-script.md`, `CLAUDE.md`; memo bullets in the doc.
- **Edge cases**: `pnpm e2e` with the adapter in sandbox mode (the reset fixture's 409 surfaces as
  a sentence naming the adapter and `TEMELIO_MODE`); the adapter's `.env` missing (the same
  fail-by-name the portals' missing `.env` already produces).
- **Unit tests**: none new.
- **Trade-offs**: Fixture mode proves the adapter's translation and the widget's three-way fan-out;
  only the by-hand run proves the sandbox. That is the honest split for a shared external sandbox
  that CI cannot reset.

### #1190-T6: Compare three more fields, chosen so Temelio can store them

The demo compares four fields and Temelio can store two of them: it declines `name` (the vendor
answers 200 to a new `legalName` and stores nothing) and FunderHub declines `socials`, so the
address is the only row all three systems will take. The adapter's claim is that a system nobody
built for this contract can still receive a correction through it, and one example is thin. The
three fields below are already in the mapping's writable set and already round-trip, so this is a
list change rather than vendor work: `mission`, `emails.primary` and `phones.primary.number`.

They were picked so each new row reads differently. `emails.primary` is already drifted in the seed
— GrantPortal and Temelio hold `hello@agile6.com`, FunderHub `grants@agile6.com` — so adding it is
what makes a second disagreement visible, with no invented seed value. `phones.primary.number` is
identical everywhere, so it stays an agreement. `mission` is held by GrantPortal and Temelio and was
never filled in at FunderHub, so it reads as a gap: a second example of the website beat without the
write refusal on top of it.

The compared path is the leaf `phones.primary.number`, not `phones.primary`. `formatFieldValue`
renders an address by shape and anything else unrecognised as raw JSON, so the object lands in a
grid cell as `{"countryCode":"+1","number":"619-555-0142"}`; and the two portals seed
`isMobile: false` while the adapter's mapping never produces `isMobile`, so comparing the object
would report a disagreement about a key nobody typed.

- **Acceptance criteria**:
  - When the widget opens on Agile Six, then it shows seven rows: the email row differs with
    FunderHub the outlier, the phone row agrees, and the mission row agrees with FunderHub's cell
    empty.
  - When a value from any of the three rows is pushed, then `POST /api/sync` accepts the path and
    the target's own page holds the new value; a path outside `DEMO_FIELDS` is still a 400.
  - When the seed comparison runs, then two rows differ — the address and the email — and each
    names which system is the outlier.
- **Implementation plan**: three entries in `DEMO_FIELDS`
  (`packages/cg-org-sync/src/utils/compare.ts`), labelled Mission, Email and Phone and placed after
  the address so the opening row order is unchanged. Then the assertions that were written
  positionally against four fields: the status and `distinctCount` arrays in
  `utils/compare.test.ts`, and "the primary address is the only disagreement" in
  `packages/seed/src/compare.test.ts`. `packages/seed/src/other-orgs.test.ts` asserts every row
  agrees for the invented org pairs — both copies derive from one shared description so they should
  still agree, but confirm rather than assume. `e2e/specs/api-sync.spec.ts` uses `mission` as its
  example of a path outside the list, which inverts the moment mission joins it; `yearFounded` is
  the natural replacement, a real path the demo deliberately does not compare. Row assertions for
  the three new fields go beside the address and website cases in `e2e/specs/api-compare.spec.ts`.
  Nothing else in the library changes: `compareProfiles`, `getAtPath`, `buildMergePatch`,
  `syncToTargets`, Link's `isDemoFieldPath` validator and the adapter's own landing page all derive
  from the list.
- **Edge cases**: a patch on `phones.primary.number` against a record holding no `phones` merges to
  `{phones:{primary:{number}}}`, which fails `OrganizationBaseSchema` because `countryCode` is
  required — a 400 rather than a silent miss. Not reachable in the demo, where all three systems
  hold a phone, but it is what a future seed without one would hit. `emails.primary` is
  `z.email()`-validated, so a malformed address is refused by every system rather than only the
  sender. The adapter's `toPhone` drops a number with no leading `+NN`; writes always send
  `` `${countryCode} ${number}` ``, so a round trip is safe, but a vendor value typed without a
  country code reads as absent.
- **Unit tests**: the seed comparison reports the address and the email as the two disagreements,
  and names the outlier on each; a field held by two systems and missing at the third is `agree`,
  not `differs`; `buildMergePatch("phones.primary.number", …)` produces the three-level nested body.
- **Trade-offs**: seven rows makes the grid taller and the presenter's "read the grid" beat longer.
  Accepted because the three new rows are each a different shape — a disagreement, an agreement and
  a gap — which is the distinction the demo exists to teach.

### #1190-T7: Make the three fields editable on both portals

Depends on: #1190-T6.

The demo starts where the data lives: someone types the drift on a portal's own profile page and the
widget then finds it. That only works for fields the page can edit, so the three new fields move out
of the read-only list and into the form, saving through `applyOrgPatch` like the four already there.

- **Acceptance criteria**:
  - When GrantPortal's or FunderHub's profile page is open, then Mission, Email and Phone are
    editable, and none of the three is still in the read-only list.
  - When a new email is typed on FunderHub and saved, then the widget's FunderHub column holds it.
  - When a malformed email is saved, then the page names the field and the reason, the way it
    already does for the existing fields.
- **Implementation plan**: in each app's `src/routes/orgs/[orgId]/+page.svelte`, three inputs added
  to the form and the three paths removed from the read-only list; in each `+page.server.ts`, three
  more `buildMergePatch` calls in the spread. The phone input posts the number only, so the country
  code survives the merge. The spread stays correct because the three new roots — `mission`,
  `emails`, `phones` — are distinct from the existing four; the comment above it says what breaks if
  a later field shares a root. The taglines and the action's docstring both say "the four fields the
  demo compares", in both trees. `e2e/specs/portal-profile.spec.ts` gains a FunderHub email edit
  read back through Link's comparison, mirroring the existing suite-number case.
- **Edge cases**: the two app trees are identical here but for one link label, so the change lands
  in both or the pages diverge silently. Clearing mission posts `""`, which the action maps to
  `null` — an RFC 7396 delete — and the result must still validate. Whether a field is offered is
  read off that system's own `unwritableFields`, the way the website box already is; none of the
  three is in FunderHub's list, but read it rather than hardcoding that.
- **Unit tests**: none — the apps have no harness; the `portal-profile.spec.ts` cases above are the
  coverage.
- **Trade-offs**: three more duplicated literals in each of two app trees. Consistent with the
  two-tree decision; deriving the form from `DEMO_FIELDS` instead would couple each system's own
  screen to the widget's list, which is the coupling this repo has avoided throughout.

### #1190-T8: Prove the three land in Temelio, and refresh the story

Depends on: #1190-T6, #1190-T7.

- **Acceptance criteria**:
  - When `pnpm e2e` runs, then a spec pushes the new fields from GrantPortal to FunderHub and
    Temelio and finds each value in the target's own column afterwards, in fixture mode.
  - When the by-hand sandbox pass runs with `TEMELIO_MODE=sandbox`, then each of the three lands on
    the vendor's own record, the grantee is still findable by EIN afterwards, and what merged is
    recorded in `SANDBOX-FINDINGS.local.md`.
  - When the docs are read, then nothing says the demo compares four fields, and the screenshots
    show what the apps currently look like.
- **Implementation plan**: extend `e2e/specs/widget.spec.ts` with a push of the email and one of
  mission or phone, following the existing address case. Run the sandbox pass by hand — flip the
  adapter's `.env`, push each field through the widget, confirm on Temelio's record, push the seed
  values back. Then the prose that hardcodes the count: `README.md`, `CLAUDE.md`,
  `docs/demo-script.md` and the row-by-row reads in `docs/demo-talk-track.md`. Regenerate
  `docs/screenshots/*` with `e2e/capture/screenshots.spec.ts`; they are already stale on a second
  count, since the portals were re-themed after they were taken and every one still shows the old
  palette.
- **Edge cases**: the sandbox pass writes to a live system shared with other foundations. It is
  confined by `TEMELIO_ORG_ALLOWLIST` to the grantee we created, and every write must restate `ein`
  — `toMetadataPatch` already does, but that is the failure that makes a record invisible, so check
  the EIN search still finds it. `pnpm e2e` must stay on the fake: the config pins
  `TEMELIO_MODE=fixture` on an adapter it starts, but one already running in sandbox mode is joined
  rather than replaced, and the reset then 409s.
- **Unit tests**: none — the e2e specs and the by-hand pass are the coverage.
- **Trade-offs**: the screenshot refresh is manual and will go stale again. Worth it here because
  they are the README's only evidence and they are currently wrong twice over.

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
- #1188-T4 → #1188-T5, #1188-T6; #1188-T5, #1188-T6 → #1188-T7 → #1188-T8 → #1188-T9
- #1188-T1 → #1189-T3, #1190-T3
- #1190-T1 → #1190-T2 → #1190-T3 → #1190-T4 → #1190-T5 (T5 can start once T3 lands)
- #1190-T4 → #1191-T2 (Temelio's `unwritableFields` join FunderHub's in Link's config)
- #1189-T1, #1189-T2, #1191-T1 and #1190-T3 → the target demo in #1190
- #1189-T1 → #1189-T2 → #1189-T3
- #1191-T1 → #1191-T2
- **Parallel**: #1188-T1, #1189-T1, and #1191-T1 have no dependencies on each other and can start
  now. Once #1188-T1 lands, #1188-T2 and #1188-T3 can run in parallel. #1191 touches
  `apps/link/src/routes/+page.svelte` heavily, as do #1188-T3's connect screen and #1189-T3; land
  #1191-T1 early or expect merge work there. #1190-T1 needs only sandbox access and can start
  now; #1190-T2 can start against the spec's mapping table before T1 finishes and adjust. #1188-T5 and
  #1188-T6 can run in parallel now that T4 is done; #1188-T6 rewrites `+page.svelte` around the
  modal, so #1189-T3's "connect-list badges" land on its picker rows and chips instead, and
  #1189-T2's embed keeps working because the popup already reports to `window.opener`. #1188-T9 is
  console work plus a by-hand run and is deliberately last: the demo ships on the stand-in sign-in
  form, so nothing waits on a Google project.
