# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A demo of organization-profile syncing across grant systems, built against the
[CommonGrants](https://commongrants.org) v0.4.0 org routes and the contract in ADR-0026. Several
systems each hold a nonprofit's profile; the copies drift; a widget reads all of them, shows where
they disagree, and pushes corrections back. The build plan lives outside this repo — ask Billy.

**The project is early.** The workspace, shared schema layer, `applyMergePatch`, and seed data are
real and tested. The org route handlers are now tested (`src/server/org-routes.test.ts`) and carry a
static bearer guard and a store reset, but they are still not wired into any app — all four apps
currently serve a placeholder page listing the routes they *will* expose. `pnpm dev` working is not
the same as the demo working. Not started: comparison engine, org client, source registry, the
widget itself, real auth (Google SSO + per-system JWTs), and `temelio-adapter`.

## Commands

Run from the repo root. Everything is a pnpm workspace (`pnpm@11`, Node >= 22, `engine-strict`).

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspaces |
| `pnpm dev` | Run every app in parallel (`--no-bail`, so one crash doesn't stop the rest) |
| `pnpm build` | Build every app and package |
| `pnpm check` | Type-check every workspace (`tsc --noEmit`, or `svelte-check` for apps) |
| `pnpm test` | Run every package's Vitest suite |
| `pnpm lint` | ESLint the repo |
| `pnpm format` / `pnpm format:check` | Prettier write / check |

Per-package work:

- Test one package: `pnpm --filter @cg-link/org-sync test` (also `@cg-link/seed`).
- Run one test file / name: `pnpm --filter @cg-link/org-sync exec vitest run src/utils/merge-patch.test.ts` or add `-t "pattern"`. Watch mode: drop `run`.
- Type-check one package: `pnpm --filter @cg-link/org-sync check`.
- Regenerate a Worker's Cloudflare types after editing its `wrangler.jsonc`: `pnpm --filter @cg-link/portal gen` (writes `worker-configuration.d.ts`, which is gitignored from lint).

## Layout

- `packages/cg-org-sync` (`@cg-link/org-sync`) — the shared library. Schemas, server route handlers, store, and (planned) client/token helpers. Consumed by everything else. Subpath exports: `./schemas`, `./server`, `./utils`, `./types`, `./client` (client not yet written).
- `packages/seed` (`@cg-link/seed`) — seed org profiles for the demo, deliberately inconsistent across systems.
- `apps/portal`, `apps/funderhub`, `apps/temelio-adapter`, `apps/link` — SvelteKit apps on the Cloudflare adapter, deployed as Workers. `portal`/`funderhub` are CommonGrants-native systems, `temelio-adapter` is a conformant proxy over a non-protocol vendor, `link` is the widget. All four are currently scaffolds.

## Architecture

**One contract, many systems.** Every server exposes the identical CommonGrants org routes, so the
widget can treat a new source as configuration (a `SourceConfig` entry) rather than new code:

```
GET   /common-grants/orgs             list, filtered by ?registry= &id=
GET   /common-grants/orgs/{orgId}     read one profile
PATCH /common-grants/orgs/{orgId}     apply a JSON Merge Patch
POST  /token                          mint this system's own access token
GET   /.well-known/jwks.json          this system's public keys
```

The shared handlers live in `packages/cg-org-sync/src/server/org-routes.ts` and are written against
config, not any one app. A system supplies an `OrgRoutesConfig`: its `store`, its `source` name
(recorded on every change), and optional `unwritableFields`. A patch that sets an unwritable field
is **not** an error — the field is dropped and named in the response message, so the sender learns
the value went no further. Each app is expected to import these handlers and wire them to its own
routes (not done yet).

**Storage is behind an interface.** `OrgStore` (`server/store.ts`) has `list`/`read`/`write`.
`MemoryOrgStore` is the only implementation — seeded once per Worker isolate, so writes live only as
long as the isolate. It `structuredClone`s on every boundary to avoid shared references. The routes
depend on the interface so a D1-backed store can replace it without the handlers changing.

**Schemas are hand-written Zod, checked against the protocol's own fixtures.** The org models live
in `src/schemas/zod/` (`types.ts` → `fields.ts` → `models.ts` → `patch.ts`, re-exported through
`schemas/index.ts`). Rather than diffing shapes against the spec's emitted JSON Schema, conformance
is verified by *behaviour*: `schemas/conformance.test.ts` loads
`schemas/__fixtures__/protocol-orgs.json` (copied verbatim from the CommonGrants repo) and asserts
every published record parses, plus a corpus of records that each break a documented rule must fail.
Refresh the fixture from the protocol repo when the spec moves. The fixtures still carry pre-v0.4.0
top-level `ein`/`uei`/`duns`; schemas ignore unknown keys on read, which is the intended
old-sender/new-receiver behaviour.

**The patch schema is derived, not hand-written.** `patch.ts`'s `toMergePatch()` rewrites a Zod
object into its RFC 7396 form (every property optional + nullable, recursively) so the patch models
can't drift from the base models. Distinct from `src/utils/merge-patch.ts`'s `applyMergePatch`,
which *applies* a patch to a value. `updateOrg` uses both: validate the incoming body against the
patch schema, apply it, then re-validate the result against `OrganizationBaseSchema` before storing.
`id` is always forced back to the existing value — a patch can never move a record.

**Comparison is a flat list of field specs.** `src/utils/compare.ts` holds `DEMO_FIELDS` — the four
paths the demo compares — and `compareProfiles`, which returns one `FieldComparison` per field with
the value each source holds. A source that lacks a field, holds `null`, or holds an empty string is
absent from the row rather than counted as a disagreement, so a missing field never reads as a
conflict. Values compare by canonical JSON with keys sorted, so two systems that serialize the same
address in a different key order still agree. Adding a field to the demo is one entry in
`DEMO_FIELDS`. `buildMergePatch` is the inverse of the path walk: it wraps a chosen value back into
the nested RFC 7396 body that sets that one field.

**Shared plain types** (`src/types.ts`) — `JsonValue`/`JsonObject` and `FieldComparison`, plus the
not-yet-used `SourceConfig` and `TokenProvider` interfaces the widget will build on. Deliberately
Zod-free so app config and UI can import them without the schema layer.

## Conventions

- **ESM with `verbatimModuleSyntax`.** Imports use `.js` extensions even for `.ts` sources; `import type` is required for type-only imports.
- **Dependency versions are pinned in the `catalog:` of `pnpm-workspace.yaml`**, not in each package. Reference a catalogued dep as `"catalog:"`; add or bump versions there.
- `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` — index access is `T | undefined`, so guard it.
- Prettier: 100 cols, double quotes, trailing commas. Svelte lint/format runs through `eslint-plugin-svelte` + `prettier-plugin-svelte`.
- Generated files (`.svelte-kit/`, `.wrangler/`, `worker-configuration.d.ts`) are excluded from lint — don't hand-edit them.
