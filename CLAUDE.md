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
of them are written and tested, and `apps/link` now serves `GET /api/compare` and `POST /api/sync`
for real against both systems over its source registry — so two systems _are_ read together, and a
chosen value does reach them — and `pnpm e2e` now proves it end to end: the `e2e/` Playwright
workspace boots all three apps and drives Link's two routes against the real portal and funderhub,
so the data exchange is pinned by a test rather than by a curl someone ran once. Link's **page** is
now the widget: `apps/link/+page.svelte` renders the comparison grid, picks a value, syncs it, and
shows what each target said, and `e2e/specs/widget.spec.ts` drives that in a browser. Auth is
half-built: each system now signs, verifies and publishes its own ES256 keys, scopes every read and
write to the caller's orgs, and serves `GET /.well-known/jwks.json` for real — but nothing mints a
token for a person yet, so Link still connects with the static service credential. Not started: the
OAuth flow that gets a person a token (`POST /token`, Google SSO, Link's connect screen), the embed
loader (the widget is a standalone page, not an iframe in a host app), and `temelio-adapter`. `README.md` is the short overview for someone new —
why the project exists, what the widget does with screenshots, and setup. `docs/demo-script.md`
is the presenter's runbook: the click path, the `curl` block per system, and what to check when
something is off. Keep both in step with the code.

**Running portal or funderhub needs a `.env`.** Copy each app's `.env.example` to `.env`
(gitignored). Three variables:

- `CG_ACCESS_TOKEN` — the static service credential that app accepts on `/common-grants/*`, scoped
  to every org. It is what the `curl` block, the `api-*` specs and Link currently use.
- `SIGNING_KEY_JWK` — that system's own private ES256 JWK, on one line. It backs
  `GET /.well-known/jwks.json` and verifies the access tokens the system mints for a person. Unset
  or malformed, the system logs one line naming the variable, verifies no tokens and serves no
  keys — it still honours `CG_ACCESS_TOKEN`, so the demo and the specs keep working. The
  `.env.example` comment carries a `node -e` one-liner that generates a fresh key.
- `ENABLE_TEST_ROUTES=true` — mounts `POST /__test/reset`, which re-seeds that system's store;
  unset, the route 404s.

The guard fails closed: a system with neither credential configured 401s every request. All three
are read through `$env/dynamic/private`, so `svelte-check` does not need them present. Keep
`ENABLE_TEST_ROUTES` out of `wrangler.jsonc` `vars` so a deploy can never turn it on. The JWKs in
`.env.example` are real private keys that live in git — placeholders for localhost and nothing
else.

**Link needs a `.env` too.** `apps/link/.env.example` holds `PORTAL_ACCESS_TOKEN` and
`FUNDERHUB_ACCESS_TOKEN` — one per source, and each must match that system's own
`CG_ACCESS_TOKEN`, since a token minted for one system is meant to be useless at another. A source
whose variable is unset is reported in the comparison as "no access token is configured" rather than
silently 401ing. Read per request via `$env/dynamic/private`, not at module load: on the Workers
runtime the env is only populated inside a request, so a module-level read comes back empty.

**`pnpm e2e` needs all three `.env` files**, since it drives the real servers. A missing one shows
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
- `packages/seed` (`@cg-link/seed`) — seed org profiles for the demo, deliberately inconsistent across systems, plus `demo-users.ts`: the two people the demo signs in as and which orgs each may touch on each system. The grants live next to the profiles they point at, and `grantsFor(systemId, email)` is the lookup; placeholder emails, overridden by env in #1188-T2.
- `apps/portal`, `apps/funderhub`, `apps/temelio-adapter`, `apps/link` — SvelteKit apps on the Cloudflare adapter, deployed as Workers. `portal`/`funderhub` are CommonGrants-native systems, `temelio-adapter` is a conformant proxy over a non-protocol vendor, `link` is the widget. `portal` and `funderhub` serve the org routes; `link` serves its own `/api/compare` and `/api/sync` fan-out routes and the widget page over them; `temelio-adapter` is still a scaffold.
- Wiring in `portal`/`funderhub` is the same ten files in each, differing only in seed, `SYSTEM_ID`, `unwritableFields`, and the signing key: `src/lib/server/store.ts` (module-level `MemoryOrgStore`, `SYSTEM_ID`, and `routesFor(principal)` — the only way the routes reach the store, so one cannot serve it unscoped), `src/lib/server/keys.ts` (imports `SIGNING_KEY_JWK` once per isolate, memoized by value), `src/routes/common-grants/orgs/{+server.ts,[orgId]/+server.ts}`, `src/routes/[x+2e]well-known/jwks.json/+server.ts` (the `[x+2e]` escape is how SvelteKit spells a leading dot, which its router otherwise skips), `src/routes/__test/reset/+server.ts`, `src/hooks.server.ts` (`requireAccess` on `/common-grants/`, principal onto `event.locals`), `src/app.d.ts` (which declares `Locals.principal`), `.env.example`, and the route list on `src/routes/+page.svelte` — plus `@cg-link/seed` in `package.json`. Two app trees instead of one parameterised app is deliberate — the demo's story is two independent vendors that happen to speak the same contract.
- Wiring in `link` is four files: `src/lib/server/sources.ts` (the `SourceConfig[]` registry and the per-request `tokenProvider()`), `src/routes/api/{compare,sync}/+server.ts` (thin — validate with a small Zod schema, call the fan-out, `json()` the result), and `src/lib/api-types.ts` (type-only re-exports so the page and the e2e specs name one type). Adding a third system is an entry in `sources.ts` and a token in `.env`; no route changes.
- The widget is `src/routes/+page.server.ts` (calls `compareAcrossSources` directly, so first paint has data), `src/routes/+page.svelte` (all the state and both `fetch`es), `src/lib/components/{ComparisonGrid,SyncResults}.svelte`, and `src/lib/demo.ts` (the default EIN, the `Selection` type, and a re-export of `EIN_REGISTRY`/`formatFieldValue` — client-safe, unlike `$lib/server/sources.ts`). Controls carry `data-testid`s the browser specs select by, and `<main>` publishes `data-ready` on mount because everything is server-rendered and clickable a moment before it is live.
- `e2e` (`@cg-link/e2e`) — the Playwright workspace, and the only test in the repo that runs the real apps. `playwright.config.ts` holds one `webServer` per app; `env.ts` holds the three origins; `fixtures.ts` holds the single automatic `api` fixture (it resets both systems, so a browser spec gets isolation without asking for `api`); `specs/` holds the specs — the `api-*` pair drives Link's routes over HTTP, `widget.spec.ts` drives the page in Chromium. It is a root-level workspace, not under `packages/`, because it is not a package anything imports — `pnpm-workspace.yaml` lists `e2e` alongside the two globs.

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
config, not any one app. A system supplies an `OrgRoutesConfig`: its `store`, its `source` name
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
`DEMO_FIELDS`. `EIN_REGISTRY` names the registry the demo matches an org by, and
`utils/format.ts`'s `formatFieldValue` turns one held value into the line the grid shows — an
address collapses to one line, anything unrecognised falls back to JSON, and a value with nothing
to say renders as `""` for the caller to label. Both live in the library rather than in the widget
because `apps/*` has no test harness. `buildMergePatch` is the inverse of the path walk: it wraps a chosen value back into
the nested RFC 7396 body that sets that one field.

**One client per source, built from config.** `src/client/org-client.ts` holds `OrgClient` —
`findByIdentifier` (the EIN lookup the widget starts from, since ids are assigned per system),
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
`compareAcrossSources` and `syncToTargets`, the two things Link actually does, kept here because
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

**Shared plain types** (`src/types.ts`) — `JsonValue`/`JsonObject` and `FieldComparison`, plus
`SourceConfig` and `TokenProvider`. Deliberately Zod-free so app config and UI can import them
without the schema layer. `SourceConfig.tokenUrl` is optional and currently ignored — the demo uses
a static bearer token per source and `POST /token` is a later ticket.

## Conventions

- **ESM with `verbatimModuleSyntax`.** Imports use `.js` extensions even for `.ts` sources; `import type` is required for type-only imports.
- **Dependency versions are pinned in the `catalog:` of `pnpm-workspace.yaml`**, not in each package. Reference a catalogued dep as `"catalog:"`; add or bump versions there.
- `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` — index access is `T | undefined`, so guard it.
- Prettier: 100 cols, double quotes, trailing commas. Svelte lint/format runs through `eslint-plugin-svelte` + `prettier-plugin-svelte`.
- Generated files (`.svelte-kit/`, `.wrangler/`, `worker-configuration.d.ts`) are excluded from lint — don't hand-edit them.
