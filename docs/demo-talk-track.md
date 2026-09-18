# The five-minute demo

Two systems, one edit, one push. `demo-script.md` has every beat the widget can do, the `curl`
block, and troubleshooting. Keep this open beside the browser.

On screen the button is **Open Link** and the portal is **GrantPortal**. Out loud, say "the portal"
and "the funder's system" — the names are stand-ins.

## Before you start

- `pnpm dev` from the repo root. `http://localhost:5176` loads.
- Reset both systems, then confirm the portal says **Suite 300** and the funder's system
  **Suite 210**:

  ```bash
  curl -X POST http://localhost:5173/__test/reset
  curl -X POST http://localhost:5174/__test/reset
  ```

- Two tabs: **(1)** `http://localhost:5173/orgs/018f2e77-1a2b-7c3d-8e4f-000000000001` — the
  portal's profile page; start and stay here. **(2)**
  `http://localhost:5174/orgs/018f2e77-1a2b-7c3d-8e4f-000000000002` — the funder's copy.
- Allow popups for `http://localhost:5176`. Share the whole screen so the sign-in window shows, or
  narrate it.
- Sign-in is the stand-in form (`IDENTITY_PROVIDER=fake`): the `DEMO_ADMIN_EMAIL` address, any
  password, **Submit**. Say once: "this stands in for Google."
- Tokens live **five minutes** from sign-in (`packages/cg-org-sync/src/server/tokens.ts:22`).
  Link nothing before you start. A **Reconnect** chip means the clock ran out — one click.
- The portal has to be linked too — the page hands the widget an EIN, not a session. Two sign-ins.
- Record one full run as backup. Run it once the morning of.

## Timing

| Clock | Beat                             |
| ----- | -------------------------------- |
| 0:00  | The problem, two tabs            |
| 0:25  | Open Link                        |
| 0:45  | Link the portal                  |
| 1:10  | Link the funder's system         |
| 1:35  | Read the grid                    |
| 1:55  | Change the address on the portal |
| 2:25  | Push                             |
| 2:45  | Check the funder's system        |
| 3:05  | Frame it                         |
| 3:45  | Done; the rest is for questions  |

## Script

Bold is what the screen says.

### 0:00 — The problem

**Do.** Tab 1, point at Suite 300. Tab 2, Suite 210. Back to tab 1.

**Say.** "One nonprofit, two systems, two copies of its profile — and they disagree. Today the
nonprofit fixes that by retyping in each one. CommonGrants gives every system one way to read and
update a profile. This widget is built on it."

### 0:25 — Open Link

**Do.** **Open Link**. Overlay headed **Opened from GrantPortal**. **Link Grant Management
System**. Picker: GrantPortal, FunderHub, Temelio, four marked **Coming soon**.

**Say.** "It opens over the portal's own page. Nothing loads yet — the widget has no credentials
until I link a system. The list is configuration, not code."

### 0:45 — Link the portal

**Do.** **GrantPortal** → **Continue with Google** → sign in → pick **Agile Six Applications,
Inc.** → **Continue**. Chip reads **Linked**; name and **EIN 123456789** above the grid.

**Say.** "Each system signs me in itself — the widget never sees a password — then says which
organizations I may act for."

### 1:10 — Link the funder's system

**Do.** **Link Grant Management System** → **FunderHub** → sign in → **You have already linked
Agile Six Applications, Inc.**, other row greyed → **Continue**.

**Say.** "Held to the organization I already picked — matched by EIN, since no two systems share
ids."

### 1:35 — Read the grid

**Do.** Seven rows. **Legal name**, **EIN**, **Phone** agree. **Primary address** and **Email**
read **differs**. **Website** and **Mission** read **agree** with the funder's cell **—**.

**Say.** "One row per field, one column per system. Two things disagree: the address, and the email
— the funder has a mailbox that stopped routing. Two more are blank on the funder's side, and
that's a gap rather than a conflict: it has no website field at all, and nobody ever filled in the
mission. And most of it simply agrees, which is what you'd hope."

### 1:55 — Change the address

**Do.** **Close**. Under **Edit**, set **Suite or unit** to `Suite 400`, **Save** → **Change
applied**. **Open Link** again: still linked; the address row shows Suite 400 against Suite 210.

**Say.** "We've moved. I fix it where the profile lives — same rules as a write from the widget.
Reopen: still linked, and it finds what I typed."

### 2:25 — Push

**Do.** Click the portal's address cell → **Push Primary address from GrantPortal to FunderHub** →
**Push** → **pushed to FunderHub**. Row flips to **agree**.

**Say.** "I pick the value that's right. The widget names the direction before anything is sent.
One patch, and the row agrees."

_If time:_ click the portal's website → **Push** → **not stored — This system does not store
socials.** "It dropped what it can't hold and said so."

### 2:45 — Check

**Do.** **Close** — the portal's page underneath already shows Suite 400. Tab 2, refresh:
**Suite 400**.

**Say.** "The portal updated without a reload. The funder's system: Suite 400, typed by nobody
there. I refreshed by hand — notifying pages is a layer you could add."

### 3:05 — Frame it

**Say.** "This is a proof of concept for one pattern. The protocol defines only how to read and
write an organization in a system. How data moves _between_ systems is this layer — a widget the
nonprofit drives, a scheduled sync on client credentials, webhooks — and we don't prescribe it. To
take part a system needs three things: OAuth with PKCE, a GET, and a PATCH — natively, or through
an adapter, which is how Temelio is on that list. The win is the nonprofit's time: update once,
every portal is current."

## If it goes sideways

- **Reconnect** chip — token expired. Click it.
- **Open Link does nothing / blank overlay** — Link is down, or `EMBED_ALLOWED_ORIGINS` lacks
  `http://localhost:5173`.
- **No sign-in window** — popup blocked. The flow falls back to this tab and resumes.
- **Reopen comes back unlinked** — make the edit before the first **Open Link** instead (the order
  `e2e/specs/embedded.spec.ts` pins).
- Anything else: "If something is off" in `demo-script.md`.

## Slides, if wanted

1. **As built.** Widget ↔ GrantPortal, FunderHub (native), Temelio adapter → Temelio API. Arrows:
   `OAuth + PKCE`, `GET`, `PATCH`.
2. **Generalized.** "Sync widget" ↔ simpler.grants.gov (native), Fluxx wrapper, Temelio wrapper.
   Caption: _the protocol defines the read and the write; what sits in the middle is a product
   decision._

## Say / don't say

| Say                                   | Not                             |
| ------------------------------------- | ------------------------------- |
| "the portal", "the funder's system"   | GrantPortal, FunderHub          |
| "push" — the widget names direction   | "sync" for one change           |
| "one pattern", "proof of concept"     | anything sounding like the only |
| "not stored — it told me"             | "an error"                      |
| "a gap, not a conflict"               | "FunderHub is wrong"            |
| "I refreshed by hand; a layer to add" | letting the refresh pass        |
