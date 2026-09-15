# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A demo of organization-profile syncing across grant systems, built against the
[CommonGrants](https://commongrants.org) v0.4.0 org routes and the contract in ADR-0026. Several
systems each hold a nonprofit's profile; the copies drift; a widget reads all of them, shows where
they disagree, and pushes corrections back. The build plan lives outside this repo — ask Billy.

**The project is early.** The workspace, shared schema layer, `applyMergePatch`, and seed data are
real and tested. The org route handlers are tested (`src/server/org-routes.test.ts`) and wired into
`apps/portal` and `apps/funderhub`: both serve the three org routes for real, behind an access
token that names the orgs its bearer may touch, over their own drifted seed. The comparison engine, the org client and the fan-out over both
of them are written and tested, and `apps/link` now serves `GET /api/compare`, `POST /api/sync` and
`GET /api/orgs` for real against both systems over its source registry — so two systems _are_ read together, and a
chosen value does reach them — and `pnpm e2e` now proves it end to end: the `e2e/` Playwright
workspace boots all three apps and drives Link's two routes against the real portal and funderhub,
so the data exchange is pinned by a test rather than by a curl someone ran once. Link's **page** is
now the widget: `apps/link/+page.svelte` renders the comparison grid, picks a value, syncs it, and
shows what each target said, and `e2e/specs/widget.spec.ts` drives that in a browser. Auth is
real on the portal side: each system signs, verifies and publishes its own ES256 keys, scopes every
read and write to the caller's orgs, serves `GET /.well-known/jwks.json`, and is its own OAuth
authorization server — `/oauth/authorize`, `/oauth/callback` and `POST /token` run a full PKCE flow
that delegates identity to Google or to a dev-only form, and mints a token scoped to the orgs that
person may touch there. A person granted an org on GrantPortal and nothing on FunderHub is refused
at FunderHub, which is the beat the demo turns on. Both portals now also serve `/orgs/{orgId}`:
that system's own copy of a profile, with the four demo fields editable, saving through the same
`applyOrgPatch` its `PATCH` route goes through — so the demo can start where the data lives rather
than in the widget, and an edit typed on a portal is the disagreement the widget then finds. Link
uses it, and now in the Plaid shape: the widget opens on a title and one "Link Grant Management
System" button, which opens a modal listing every system in the catalog — the two real ones and
five named `coming-soon` — and walks pick → sign in → choose an organization → linked. The
organization step lists what that system says the person may touch, and once one is chosen every
later system is locked to it: `selectableOrgs` marks the rows a second system may offer (by EIN,
falling back to name when the linked organization publishes none) and the widget pre-selects the
single remaining choice. The linked organization lives in `sessionStorage` beside the tokens, so a
reload keeps it. Each sign-in happens in that system's own popup, so the modal can stay up and show
what is happening; a browser that blocks the popup falls back to navigating this tab, and
`?resume=` brings the modal back on the right step. Tokens live in `sessionStorage` for the tab and
are forwarded on `x-source-tokens`. A source it has no token for
reads as "not connected" in its own column while the rest of the fan-out proceeds; one that answers
401 offers Reconnect. `pnpm e2e` proves the whole of it: every spec signs in through the stand-in
provider and holds no credential of its own, and `specs/connect.spec.ts` pins the beat the issue
exists for — a person granted an org on GrantPortal and nothing on FunderHub is refused by FunderHub
alone, with the comparison still showing what GrantPortal holds. The widget is also **embedded**: each
portal serves an Open Link control that fetches `embed.js` from Link's own origin and mounts the
widget in an overlay iframe over the profile page, pointed at that org; a sync inside the frame
posts `synced` to the host, which re-reads without a reload, and Close posts `close`. Link names
the origins allowed to frame it in `EMBED_ALLOWED_ORIGINS` and enforces it both ways — a
`frame-ancestors` policy the browser applies, and the same list deciding which `?parent=` origin it
will post to. `e2e/specs/embedded.spec.ts` drives the whole of it, popup sign-in included. Direction is
explicit: the widget names every action — **Push** a value out of the page you are on, **Pull**
another system's value into it — carries `push`/`pull` on a `data-testid="direction"` element, and
confines a pull to the host, so a value can never land somewhere nobody asked for. A source
declaring `write: false` is never offered as a target and is refused by `syncToTargets` without a
request. Not started: `temelio-adapter`. `README.md` is the short overview for someone new —
why the project exists, what the widget does with screenshots, and setup. `docs/demo-script.md`
is the presenter's runbook: the click path, the `curl` block per system, and what to check when
something is off. Keep both in step with the code.

**All three apps need a `.env`.** Copy each app's `.env.example` to `.env` (gitignored). Link's
holds one variable and no secrets — `EMBED_ALLOWED_ORIGINS`, the comma-separated origins allowed to
frame the widget, which is both the `frame-ancestors` policy and the set of `?parent=` origins it
will post a message to. Unset, Link fails closed: `frame-ancestors 'self'`, and it posts nothing.
The portals read:

- `CG_ACCESS_TOKEN` — the static service credential that app accepts on `/common-grants/*`, scoped
  to every org. It is what the `curl` block, the `api-*` specs and Link currently use.
- `SIGNING_KEY_JWK` — that system's own private ES256 JWK, on one line. It backs
  `GET /.well-known/jwks.json` and verifies the access tokens the system mints for a person. Unset
  or malformed, the system logs one line naming the variable, verifies no tokens and serves no
  keys — it still honours `CG_ACCESS_TOKEN`, so the demo and the specs keep working. The
  `.env.example` comment carries a `node -e` one-liner that generates a fresh key.
- `ENABLE_TEST_ROUTES=true` — mounts `POST /__test/reset`, which re-seeds that system's store;
  unset, the route 404s.
- `IDENTITY_PROVIDER=fake` — mounts `GET /oauth/fake-login`, a form standing in for Google so the
  demo and `pnpm e2e` need no Google account. Unset or `google`, that route 404s and the real
  provider is used, which needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- `SYSTEM_ORIGIN` — this system's own public origin, used as the token issuer and to build the
  callback URL the provider returns to. Falls back to the origin the request arrived on, so a local
  checkout works without it. **Not** `PUBLIC_ORIGIN`: `$env/dynamic/private` excludes every
  variable starting with `PUBLIC_`, so that name would always read as unset.
- `LINK_ORIGIN` — the only origin this system will send an authorization code to. Unset, no
  redirect URI is registered and every `/oauth/authorize` request is refused.
- `DEMO_ADMIN_EMAIL` / `DEMO_PORTAL_ONLY_EMAIL` — the addresses the demo's two people sign in with,
  overriding the seed's placeholders. An empty value is ignored rather than blanking an address.

The guard fails closed: a system with neither credential configured 401s every request. All three
are read through `$env/dynamic/private`, so `svelte-check` does not need them present. Keep
`ENABLE_TEST_ROUTES` out of `wrangler.jsonc` `vars` so a deploy can never turn it on. The JWKs in
`.env.example` are real private keys that live in git — placeholders for localhost and nothing
else.

**Link holds no credentials.** Each system issues its own token through its own OAuth flow, the
browser keeps them in `sessionStorage` for the session, and Link forwards them on the
`x-source-tokens` header. `apps/link/.env.example` is deliberately empty of secrets. Note that
Chromium partitions storage inside a third-party frame, so tokens taken in the overlay and tokens
taken standalone are separate sets — acceptable for the demo, and said out loud in
`docs/demo-script.md`.

**`pnpm e2e` needs all three `.env` files and `IDENTITY_PROVIDER=fake`**, since it drives the
real servers and signs in through the stand-in form. A portal set to `google` fails the suite with a
sentence naming that app — the suite cannot drive Google, and the Google path is verified by hand. A missing one shows
up as the reset fixture failing with a sentence naming the app, rather than as a spec that mystery-
fails on an assertion. The suite itself holds no credentials: `/__test/reset` is gated by the env
flag rather than the bearer, and Link's own routes are unauthenticated, so the tokens only ever
matter server-side.

## Commands

Run from the repo root. Everything is a pnpm workspace (`pnpm@11`, Node >= 22, `engine-strict`).

| Command                             | What it does                                                                |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `pnpm install`                      | Install all workspaces                                                      |
| `pnpm dev`                          | Run every app in parallel (`--no-bail`, so one crash doesn't stop the rest) |
| `pnpm build`                        | Build every app and package                                                 |
| `pnpm check`                        | Type-check every workspace (`tsc --noEmit`, or `svelte-check` for apps)     |
| `pnpm test`                         | Run every package's Vitest suite                                            |
| `pnpm e2e`                          | Playwright: boot all three apps and run the integration specs in `e2e/`     |
| `pnpm lint`                         | ESLint the repo                                                             |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                                      |

Per-package work:

- Test one package: `pnpm --filter @cg-link/org-sync test` (also `@cg-link/seed`).
- Run one test file / name: `pnpm --filter @cg-link/org-sync exec vitest run src/utils/merge-patch.test.ts` or add `-t "pattern"`. Watch mode: drop `run`.
- Type-check one package: `pnpm --filter @cg-link/org-sync check`.
- Regenerate a Worker's Cloudflare types after editing its `wrangler.jsonc`: `pnpm --filter @cg-link/portal gen` (writes `worker-configuration.d.ts`, which is gitignored from lint).
- First `pnpm e2e` on a machine needs a browser: `pnpm --filter @cg-link/e2e install-browsers`.
- Run one spec / name: `pnpm --filter @cg-link/e2e exec playwright test specs/api-sync.spec.ts -g "pattern"`. Add `--ui` for the inspector.
- The e2e script is `e2e`, not `test`, deliberately — `pnpm test` is `pnpm -r run test`, and a `test` script here would boot three dev servers every time you ran the unit suite.

## Layout

- `packages/cg-org-sync` (`@cg-link/org-sync`) — the shared library. Schemas, server route handlers, store, client, and token helpers. Consumed by everything else. Subpath exports: `./schemas`, `./server`, `./utils`, `./types`, `./client`.
- `packages/seed` (`@cg-link/seed`) — seed org profiles for the demo, deliberately inconsistent across systems. GrantPortal seeds **three** orgs and FunderHub **two**: Agile Six (the drifted pair the demo is about) from `agile-six.ts`, plus invented ones from `other-orgs.ts`, which exist so the organization picker has a choice in it and something to grey out. One of the invented pair is GrantPortal-only — a `funderhubId` of `null` — which is what makes the picker's "holds no organization with that EIN" reachable, and what keeps FunderHub partial about whole records as well as about fields. Both copies of each extra org are derived from one shared description, so they cannot drift apart and read as a second disagreement; `PORTAL_SEEDS`/`FUNDERHUB_SEEDS` are the full per-system lists, Agile Six first, and the singletons stay for the specs. Plus `demo-users.ts`: the two people the demo signs in as and which orgs each may touch on each system. The grants live next to the profiles they point at; `demoUsers({ admin, "portal-only" })` applies the environment's addresses over the placeholders (an empty override is ignored, so an unset variable cannot blank out an address and strip someone's access), and `grantsFor(systemId, email, users)` is the lookup. Each user carries a `role`, so a caller can tell which person is which without matching on an address that may have been overridden.
- `apps/portal`, `apps/funderhub`, `apps/temelio-adapter`, `apps/link` — SvelteKit apps on the Cloudflare adapter, deployed as Workers. `portal`/`funderhub` are CommonGrants-native systems, `temelio-adapter` is a conformant proxy over a non-protocol vendor, `link` is the widget. `portal` and `funderhub` serve the org routes; `link` serves its own `/api/compare`, `/api/sync` and `/api/orgs` routes and the widget page over them; `temelio-adapter` is still a scaffold.
- Wiring in `portal`/`funderhub` is the same eighteen files in each, differing only in seed, `SYSTEM_ID`, `unwritableFields`, the signing key, and the system's own name on its two pages: `src/lib/server/store.ts` (module-level `MemoryOrgStore`, `SYSTEM_ID`, and `routesFor(principal)` — the only way `/common-grants/*` reaches the store, so a protocol route cannot serve it unscoped, plus `unscopedRoutes` for this system's own pages), `src/lib/server/keys.ts` (imports `SIGNING_KEY_JWK` once per isolate, memoized by value), `src/routes/common-grants/orgs/{+server.ts,[orgId]/+server.ts}`, `src/routes/[x+2e]well-known/jwks.json/+server.ts` (the `[x+2e]` escape is how SvelteKit spells a leading dot, which its router otherwise skips), `src/routes/__test/reset/+server.ts`, `src/hooks.server.ts` (`requireAccess` on `/common-grants/`, principal onto `event.locals`), `src/app.d.ts` (which declares `Locals.principal` and the `CgLink` global the embed loader provides), `src/lib/server/oauth.ts` (builds an `OAuthConfig` per request from env, since `$env/dynamic/private` is empty at module load), `src/routes/oauth/{authorize,callback,fake-login}/+server.ts`, `src/routes/token/+server.ts`, `.env.example`, the route list and profile link on `src/routes/{+page.svelte,+page.server.ts}`, and the profile page itself, `src/routes/orgs/[orgId]/{+page.server.ts,+page.svelte}` (which also carries the Open Link control) — plus `@cg-link/seed` in `package.json`. The profile page is deliberately outside the bearer guard (which matches `/common-grants/` only) and reads `unscopedRoutes` rather than `routesFor`: it is the system's own screen, and auth on it is out of scope for the demo. Whether it offers a website box is read off that system's own `unwritableFields`, so FunderHub has none without the file saying so. The `oauth` routes and `/token` sit outside the bearer guard by construction: it matches `/common-grants/` only, and a sign-in route that needed a credential would have nowhere to get one. Two app trees instead of one parameterised app is deliberate — the demo's story is two independent vendors that happen to speak the same contract.
- Wiring in `link`: `src/lib/server/sources.ts` (the `SourceConfig[]` registry, now carrying each system's `authorizeUrl`, `tokenUrl`, `capabilities`, `website` and `status`), `src/lib/server/embed.ts` (the `EMBED_ALLOWED_ORIGINS` list, read per request, and the `frame-ancestors` directive built from it), `src/hooks.server.ts` (that directive onto every HTML response — a hook rather than `kit.csp` because the list comes from env, which `svelte.config.js` cannot see), `static/embed.js` (the loader a host page includes; plain script, no bundling, `CgLink.open({ linkOrigin, registry, id, host, onSynced, onClose })`), `src/routes/api/{compare,sync,orgs}/+server.ts` (thin — validate with a small Zod schema, call the fan-out with `tokensFromHeader(request)`, `json()` the result; `orgs` additionally answers 401 when the result's `connection` is `not-connected`, since an empty list and "we never asked" mean opposite things to the picker), `src/lib/api-types.ts` (type-only re-exports so the page and the e2e specs name one type), and the connect flow: `src/routes/api/connect/start/+server.ts` (generate the PKCE pair, keep the verifier in an `HttpOnly` cookie keyed by `state`, 302 to the system), `src/routes/connect/callback/+server.ts` (exchange the code server-to-server, then either `postMessage` to the opener or write `sessionStorage` and return to the widget; `Accept: application/json` takes a third exit for the e2e suite), `src/lib/server/connect.ts` (the cookie's name and shape), and `src/lib/tokens.ts` (the browser's `sessionStorage` half, client-safe). Adding a third system is still one entry in `sources.ts`; no route changes.
- The widget is `src/routes/+page.server.ts` (returns the source catalog, plus the `?host=`/`?parent=` the embed loader introduces itself with, both judged against configuration before they reach the browser — first paint is a title and one button, since Link has no credentials until someone signs in), `src/routes/+page.svelte` (all the state, both `fetch`es, the popup that each sign-in runs in, and the `postMessage` bridge to a host page), `src/lib/components/{LinkModal,SystemList,ComparisonGrid,SyncResults}.svelte` — `LinkModal` is a native `<dialog>` owning only which step someone is on (`pick`, `sign-in`, `waiting`, `orgs`, `no-match`, `denied`), so every decision with a consequence stays in the page or the library; it is handed a `loadOrgs` callback rather than the tokens, and an `OrgLock` rather than the rule for applying one — and `src/lib/demo.ts` (the default EIN, the `Selection` type, and re-exports of `EIN_REGISTRY`/`formatFieldValue`/`directionOf`/`syncTargets` — client-safe, unlike `$lib/server/sources.ts`). Embedded, a host bar names the system whose page is framing us and offers Close. Controls carry `data-testid`s the browser specs select by, and `<main>` publishes `data-ready` on mount because everything is server-rendered and clickable a moment before it is live.
- `e2e` (`@cg-link/e2e`) — the Playwright workspace, and the only test in the repo that runs the real apps. `playwright.config.ts` holds one `webServer` per app; `env.ts` holds the three origins; `fixtures.ts` holds the single automatic `api` fixture — it resets both systems and obtains a real token per system through the fake sign-in flow, so a browser spec gets isolation without asking for `api` and every API call carries `x-source-tokens`. `tokenFor`/`connectViaApi` drive the four hops over HTTP; `connect`/`connectExpectingDenial` drive them in a browser. `specs/` holds the specs — the `api-*` pair drives Link's routes, `widget.spec.ts` drives the grid, `connect.spec.ts` drives signing in and being refused, `link-flow.spec.ts` walks the whole Plaid flow, `portal-profile.spec.ts` edits a portal's own profile page and reads the change back through Link's comparison, and `embedded.spec.ts` drives the overlay: the `frame-ancestors` policy from both sides, popup sign-in inside the frame, and the push and pull beats end to end. Note that a `page.route` stand-in host page cannot test `frame-ancestors` — a fulfilled response does not carry the origin Chromium checks against, so the spec frames Link from the portal's real origin and contrasts it with the same server reached as `127.0.0.1`. It is a root-level workspace, not under `packages/`, because it is not a package anything imports — `pnpm-workspace.yaml` lists `e2e` alongside the two globs.

## Architecture

**One contract, many systems.** Every server exposes the identical CommonGrants org routes, so the
widget can treat a new source as configuration (a `SourceConfig` entry) rather than new code:

```
GET   /common-grants/orgs             list, filtered by ?registry= &id=
GET   /common-grants/orgs/{orgId}     read one profile
PATCH /common-grants/orgs/{orgId}     apply a JSON Merge Patch
POST  /token                          mint this system's own access token (#1188-T2)
GET   /.well-known/jwks.json          this system's public keys
```

The shared handlers live in `packages/cg-org-sync/src/server/org-routes.ts` and are written against
config, not any one app. Every rule a change has to pass lives in `applyOrgPatch(orgId, patch,
config)` — drop unwritable, apply, re-validate, write — which `updateOrg` calls after parsing the
body, and which the portals' own edit forms call directly with their own parse. An edit typed into a
portal and one pushed by the widget are then the same edit rather than two paths that agree today;
the parse stays the caller's, since only the caller knows what a rejection should look like to
whoever sent it. A system supplies an `OrgRoutesConfig`: its `store`, its `source` name
(recorded on every change), and optional `unwritableFields`. A patch that sets an unwritable field
is **not** an error — the field is dropped and named in the response message, so the sender learns
the value went no further (top-level keys only — `socials`, not `socials.website`). `updateOrg`
validates the patched result but stores the _unvalidated_ object, because the schemas strip unknown
keys and a patch must never be what deletes what an older sender left behind. Each app is expected
to import these handlers and wire them to its own routes; `portal` and `funderhub` do.

**Every system mints and verifies its own access tokens.** `server/tokens.ts` holds the ES256
half: `loadSigningKey` imports a system's private JWK and derives its `kid` from the RFC 7638
thumbprint (a thumbprint, not a random id, so two isolates booting from the same key publish the
same JWKS), `mintAccessToken` signs `{ iss, aud, sub, orgs }`, `verifyAccessToken` checks signature,
audience, expiry and `kid` and returns a `Principal { sub, orgs }`, and `jwks` serves the public
half. `aud` is what makes a token per-system: one minted by GrantPortal names GrantPortal and is
refused at FunderHub, which never had the key that signed it.

`createSigningKeyCache(onProblem)` memoizes the import against the value it came from, and
resolves to `undefined` rather than rejecting when there is no usable key — it lives in the library
rather than inline in each app because "no key is configured" has to leave the system serving its
service token and refusing everything else, not answering 500 to every route, and `apps/*` has no
harness to pin that with.

`requireAccess(request, { key, audience, serviceToken })` (`server/auth.ts`) is the guard. It
resolves to a `Principal` or to the 401 envelope to return unchanged, so a SvelteKit hook reads as
`const principal = await requireAccess(...); if (principal instanceof Response) return principal;`.
Two credentials are accepted: a JWT this system signed, and the static `CG_ACCESS_TOKEN`, which
answers `{ sub: "service", orgs: "*" }` — nobody behind it, scoped to everything. The service token
stays because a system reachable only through an OAuth round trip is one nobody can debug at a
terminal, and because it is what the `curl` block and the `api-*` specs use. It fails closed on
every axis: no credentials configured, no signing key plus a non-service bearer, or any token that
does not verify. `requireBearer` stays for callers that want a yes-or-no on a shared secret and
have no use for a principal.

**Each portal is its own OAuth authorization server.** `server/oauth-routes.ts` holds
`authorize`, `callback` and `token`, config-driven from an `OAuthConfig` the way the org routes are
from `OrgRoutesConfig`. The flow is PKCE with S256, and **everything is stateless** — Workers
isolates share no memory, so there is nowhere to keep a pending-authorizations map. The `state` sent
to the identity provider and the authorization code handed back are both short-lived JWTs signed
with the system's own key (five minutes and sixty seconds), carrying what a server-side map would
have held. All three JWTs this system signs use distinct audiences — `<systemId>`,
`<systemId>:oauth-state`, `<systemId>:oauth-code` — because the audience is the only thing stopping
an authorization code, which carries `sub` and `orgs`, from being spent directly as a bearer token.
The cost of statelessness is that a code is replayable for its sixty-second life; a real server
marks one spent on redemption, which needs storage.

`server/identity.ts` is who a portal asks about the person in front of it. The contract is
deliberately "give me a verified email", not "give me an ID token", which is what lets
`FakeIdentityProvider` exist with no signing key of its own and lets the e2e suite run offline.
`GoogleIdentityProvider` exchanges the code and verifies the ID token against Google's JWKS,
requiring `email_verified` — the one claim holding the grant model up, since without it anyone could
sign up to Google with someone else's address and inherit what that address is granted. Both `fetch`
and the key set are injectable, so the Google path is tested against a local JWKS rather than the
network.

**A principal scopes the store, not the handlers.** `scopedStore(store, principal)`
(`server/store.ts`) narrows an `OrgStore` to the orgs a principal may touch: `list` is filtered,
`read` and `write` answer `undefined` outside the grant, so `readOrg` and `updateOrg` 404 without
either handler learning what a principal is. 404 rather than 403 is deliberate — to someone with no
grant, an org they cannot touch and an org that does not exist should be the same answer. `"*"` is
returned unwrapped. An **absent** principal is granted nothing, so a route mounted outside the guard
serves an empty store rather than every profile. This is why `OrgStore.write` returns
`Organization | undefined`: a declined write has to be distinguishable from a completed one.

**Storage is behind an interface.** `OrgStore` (`server/store.ts`) has `list`/`read`/`write`.
`MemoryOrgStore` is the only implementation — seeded once per Worker isolate, so writes live only as
long as the isolate. It `structuredClone`s on every boundary to avoid shared references. The routes
depend on the interface so a D1-backed store can replace it without the handlers changing.
`ResettableOrgStore` adds `reset()` (re-clones the seed), which backs `resetStore(store)` in
`server/test-routes.ts` — the shared body of each app's dev-only `POST /__test/reset`. Gating that
route behind an env flag is the app's job.

**Schemas are hand-written Zod, checked against the protocol's own fixtures.** The org models live
in `src/schemas/zod/` (`types.ts` → `fields.ts` → `models.ts` → `patch.ts`, re-exported through
`schemas/index.ts`). Rather than diffing shapes against the spec's emitted JSON Schema, conformance
is verified by _behaviour_: `schemas/conformance.test.ts` loads
`schemas/__fixtures__/protocol-orgs.json` (copied verbatim from the CommonGrants repo) and asserts
every published record parses, plus a corpus of records that each break a documented rule must fail.
Refresh the fixture from the protocol repo when the spec moves. The fixtures still carry pre-v0.4.0
top-level `ein`/`uei`/`duns`; schemas ignore unknown keys on read, which is the intended
old-sender/new-receiver behaviour.

**The patch schema is derived, not hand-written.** `patch.ts`'s `toMergePatch()` rewrites a Zod
object into its RFC 7396 form (every property optional + nullable, recursively) so the patch models
can't drift from the base models. Distinct from `src/utils/merge-patch.ts`'s `applyMergePatch`,
which _applies_ a patch to a value. `updateOrg` uses both: validate the incoming body against the
patch schema, apply it, then re-validate the result against `OrganizationBaseSchema` before storing.
`id` is always forced back to the existing value — a patch can never move a record.

**Comparison is a flat list of field specs.** `src/utils/compare.ts` holds `DEMO_FIELDS` — the four
paths the demo compares — and `compareProfiles`, which returns one `FieldComparison` per field with
the value each source holds. A source that lacks a field, holds `null`, or holds an empty string is
absent from the row rather than counted as a disagreement, so a missing field never reads as a
conflict. Values compare by canonical JSON with keys sorted, so two systems that serialize the same
address in a different key order still agree. Adding a field to the demo is one entry in
`DEMO_FIELDS`. `utils/direction.ts` holds the other half of what the widget does with a comparison:
`directionOf(pickedSourceId, hostId)` is `push` when the value came from the host or there is no
host and `pull` otherwise, and `syncTargets(sources, pickedSourceId, hostId)` is the four rules
deciding where a change may go — never the source it came from, never one with an error or no
record, never one declaring `write: false`, and on a pull only the host. Both live here rather than
in the widget because they decide _where a change is sent_; an unknown `hostId` reads as standalone
in both, so an unrecognised `?host=` cannot redirect a write. `EIN_REGISTRY` names the registry the demo matches an org by, and
`utils/format.ts`'s `formatFieldValue` turns one held value into the line the grid shows — an
address collapses to one line, anything unrecognised falls back to JSON, and a value with nothing
to say renders as `""` for the caller to label. Both live in the library rather than in the widget
because `apps/*` has no test harness. `buildMergePatch` is the inverse of the path walk: it wraps a chosen value back into
the nested RFC 7396 body that sets that one field.

**One client per source, built from config.** `src/client/org-client.ts` holds `OrgClient` —
`findByIdentifier` (the EIN lookup the widget starts from, since ids are assigned per system),
`list` (the unfiltered sibling, scoped by nothing but the token — what the organization picker asks),
`read`, and `patch`. It is constructed from a `SourceConfig` and a `TokenProvider`, with `fetch`
injectable so tests stub the transport rather than the global. Reads are behind the same bearer
guard as writes, so every call carries the token. Responses are parsed with
`OrganizationBaseSchema`, so a non-conformant source fails at the boundary instead of leaking a
half-built profile into the comparison grid; `patch` parses its response through `OrgRevisionSchema`
the same way, since `PATCH /common-grants/orgs/{orgId}` returns `Responses.OkT<OrgRevision>` and the
revision carries the post-change `snapshot`. Note that parsing coerces `createdAt`/`lastModifiedAt`
to `Date` — the SDK's `UTCDateTimeSchema` is a `ZodTransform<Date, string>` — so a parsed revision
is not identical to its wire form. Every failure — error envelope, unreachable host, missing
envelope, schema mismatch — surfaces as an `OrgClientError` carrying `sourceId`, `status`, and
`errors`; the widget fans out across systems at once, so an error that cannot say which source it
came from is one it cannot render. `patch` returns the envelope's `message` verbatim, because that
sentence is where a system names the fields it declined to store. `StaticTokenProvider` is the
demo's token source: a map of source id to bearer token.

**The fan-out is the library's job, not the route's.** `src/client/fanout.ts` holds
`compareAcrossSources` and `syncToTargets`, the two things Link actually does, plus `listOrgsAt` —
which is not a fan-out at all, but asks one source which orgs a person may touch there, because the
picker asks one system at a time and two systems' lists are two questions rather than rows of one
table. Every resolution also carries the source's `capabilities`, with the default applied, because a
read-only system has to read as read-only in the browser rather than only in the server-side
registry. It maps each answer through `utils/orgs.ts`'s `summarizeOrg`, so what reaches a picker is a
name and an EIN rather than everyone's full profile, and an org with no EIN comes back with
`ein: null` rather than being dropped. A source that is unknown, disabled or declares `read: false`
is refused without a request and reports `connection: "connected"` — `connection` says which control
to offer, and for those the answer is "none, read the error" rather than a Connect button that leads
back here. All three are kept here because
`apps/*` has no test harness and "one source is down but the rest still answer" is precisely the
behaviour worth pinning. Both take a `FanoutOptions` — the registry, a `TokenProvider`, and an
injectable `fetch` — so a source is configuration on the way in. Each source is handled in its own
`try`/`catch` inside `Promise.all`, so no task can reject and one system failing costs only that
system: it comes back with `orgId: null` and a reason, and the comparison is built from whoever
answered. A source that is reachable but simply holds no matching record is **not** an error — it
gets `orgId: null` with no `error`, because "no record of you" must not render as a conflict.
`syncToTargets` builds the merge patch once, resolves each target's own org id (no two systems agree
on ids), dedupes repeated targets so one change is not recorded twice, and reports each target
separately as `{ ok, status, message }` — passing the target's own sentence through untouched, since
that is where a system says which fields it declined. `null` is a legal value throughout: it is how
RFC 7396 spells clearing a field.

**Link forwards tokens; it never holds or verifies them.** `SOURCE_TOKENS_HEADER`
(`x-source-tokens`, `client/org-client.ts`) carries one token per source as
`portal=<jwt>, funderhub=<jwt>`; `tokensFromHeader(request)` parses it into a `TokenProvider` and
`sourceTokensHeader(tokens)` builds it. The parse is deliberately lenient — an entry it cannot read
is skipped rather than failing the request, so one malformed pair costs only that source, and a
source left out simply reads as not connected. A missing token raises `NotConnectedError`, which the
fan-out turns into `SourceResolution.connection: "not-connected"` **without sending a request**;
a 401 from a source becomes `"expired"`; everything else stays `"connected"`, because being reached
and refused is not the same as never being let in. That three-way split is what decides whether the
widget offers Connect, Reconnect, or nothing. `client/pkce.ts` holds `createPkcePair` and
`challengeFor`, in the library rather than in Link because a challenge that disagrees with the
server's fails only at the token exchange, with nothing on either side saying which half was wrong.

**Shared plain types** (`src/types.ts`) — `JsonValue`/`JsonObject` and `FieldComparison`, plus
`SourceConfig` and `TokenProvider`. Deliberately Zod-free so app config and UI can import them
without the schema layer. `SourceConfig` carries `authorizeUrl`, `tokenUrl`, an optional
`capabilities` (`utils/sources.ts`'s `capabilitiesOf` applies the both-true default in one place;
the UI words are pull and push), and `website`/`status` for the picker. `status: "coming-soon"` is
a system the picker names and will not connect; `isConnectable` is what both Link's registry and
the library's fan-out filter on, so a named system is never contacted even if a caller hands the
whole registry in.

## Conventions

- **ESM with `verbatimModuleSyntax`.** Imports use `.js` extensions even for `.ts` sources; `import type` is required for type-only imports.
- **Dependency versions are pinned in the `catalog:` of `pnpm-workspace.yaml`**, not in each package. Reference a catalogued dep as `"catalog:"`; add or bump versions there.
- `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` — index access is `T | undefined`, so guard it.
- Prettier: 100 cols, double quotes, trailing commas. Svelte lint/format runs through `eslint-plugin-svelte` + `prettier-plugin-svelte`.
- Generated files (`.svelte-kit/`, `.wrangler/`, `worker-configuration.d.ts`) are excluded from lint — don't hand-edit them.
