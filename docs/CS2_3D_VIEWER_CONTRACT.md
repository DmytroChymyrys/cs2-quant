# CS2 3D Viewer — integration contract

**Status: implemented and live.** The viewer ships on Asset Intelligence and,
since V1.1, is the default representation for assets whose category is known to
render well. Sections 1-11 below are the discovery record and are kept as
written; sections 12-14 describe what is actually deployed.

This records what was verified about the SteamWebAPI / cs2screen interactive
viewer so the integration did not have to be re-investigated, and so the
credential boundary was written down before anyone wrote the embed.

---

## 1. Availability

The interactive CS2 3D Viewer is **included with the active Item Small plan**.
It is configured through a separate cs2screen panel rather than the SteamWebAPI
market-data dashboard.

The interactive viewer and the **screenshot API are different products**. The
discovery probe exercised the screenshot API and measured its own separate
allowance — 2/minute, 50/day, **500/month**, metered independently of market
credits. Provider documentation states that interactive viewer usage does
**not** consume normal SteamWebAPI API credits. These two must not be conflated
when reasoning about cost: a 500/month screenshot ceiling says nothing about
interactive viewer capacity.

## 2. Embedding

The viewer is embedded from **`3d.cs2screen.com`**.

It is identified by a **public viewer key beginning `pk_`**, which the provider
explicitly describes as safe to publish. The key identifies the configured
viewer, not the account.

An optional **Steam inspect link** identifies the actual CS2 item. When building
the viewer URL the complete inspect link must be **URL-encoded as a single query
parameter** — inspect links contain characters that will otherwise break the
query string.

Viewer activity is tracked separately in the cs2screen dashboard.

## 3. Credential boundary — the part that must not be got wrong

Two credentials exist and they are **not interchangeable**:

| Credential | Classification | Where it may appear |
|---|---|---|
| `STEAMWEBAPI_API_KEY` | **SECRET** | Server only. Never in a browser bundle, a URL, a log, an error, a screenshot, a fixture or committed documentation. |
| cs2screen viewer key (`pk_…`) | **PUBLIC** | Intended for browser and iframe use. |

When the viewer is implemented, the public key should use a clearly named
public configuration variable consistent with repository conventions —
conceptually `NEXT_PUBLIC_CS2_VIEWER_KEY`. **It has deliberately not been added
in this batch**, because nothing yet reads it and an unused public variable is
an invitation to put the wrong value in it.

The private market-data key is never required by the iframe. If an
implementation ever appears to need it client-side, that is a design error, not
a configuration problem.

## 4. Domain authorization

The cs2screen panel supports an allowed-website/domain list, and the intended
embed sites are expected to be added there. `floatalpha.com` should eventually
be authorized.

Wildcard preview domains should not be assumed safe or necessary. Domain
allowlisting is operational setup; it is not a reason to expose the private key.

## 5. Appearance and branding

The panel exposes configurable interface theme, main colour, background, text
colour, secondary/accent/neutral colours, switches, boxes, buttons and fields,
lighting, item size, rotation behaviour, background colour/image/map video,
layout and logo/branding.

Observed lighting modes: **Studio, CS2, Dust2, Inferno, Night, Glow**.

Any eventual integration should be configured from FloatAlpha's existing visual
tokens rather than an unrelated palette invented in the vendor panel.

## 6. Visitor capabilities

Optional visitor controls include catalog browsing, Customize, own inspect
links, camera behaviour, a rotate button, photo download, background picker,
map-video background, lighting switcher, language selection, hide-controls
behaviour, agent selection and glove selection.

**Customize** can permit changing float, seed and StatTrak.

Not every feature should be enabled. See §8.

## 7. Arena

Arena mode is available. Observed description: *"Hold the item in first person:
deploy, inspect, shoot and reload."* The panel also exposes a default agent,
visitor agent selection and visitor glove selection.

Arena is interesting to FloatAlpha because it completes a path that starts with
evidence:

```
research asset → inspect market intelligence → view asset in 3D → experience it
```

Documented for later. Not implemented.

## 8. Intended public Asset Intelligence experience

FloatAlpha is the intelligence product. Asset Intelligence must not become an
embedded generic skin browser — the viewer is the last step of an evidence
journey, not the point of the page:

```
Asset Intelligence
  → price / supply / sales / market evidence
  → View in 3D
  → interactive visualization of THIS asset
  → optional Arena
```

A focused initial configuration therefore suggests:

| Control | Public asset page |
|---|---|
| Catalog browsing | **off** |
| Own inspect-link input | **off** |
| Visitor agent selection | **off** |
| Visitor glove selection | **off** |
| Background picker | **off** |
| Rotation, camera, 3D inspection | on |
| Arena | on |

This is product direction, not a requirement to implement now.

## 9. Generic asset vs specific item — the structural problem

**A FloatAlpha canonical market asset is not necessarily a particular CS2 item.**

A canonical asset is a *type* — "AK-47 | Redline (Field-Tested)" — describing a
price and a supply across many individual items. A Steam inspect link addresses
a *specific physical item*, with its own float, paint seed, stickers and charms.

The discovery probe confirmed this split at the data layer: `/items` describes
types, while `/inventory` returns `assetid`, `inspectlink`, `float`,
`paintseed`, `stickers`, `keychains`, `tradelocked` and `tradeprotected` for
individual items.

So generic Asset Intelligence 3D and user-owned inventory 3D likely require
**different mechanisms**. A generic asset page has no single true inspect link;
at best it can show a representative item, and that representativeness would
need to be stated rather than implied.

The collector already stores each provider asset's `inspectlink` in
`provider_assets.static_metadata`, which is the raw material for the generic
case when it is designed.

## 10. Future Connect Steam experience

**Not implemented. Not in scope.** Recorded so the architecture is not closed
off:

```
Connect Steam → My Inventory → actual owned item
  → FloatAlpha market intelligence + item-specific characteristics
  → Steam inspect link → View MY ITEM in 3D → optional Arena
```

That experience may justify richer viewer controls than the public asset page,
because the user owns the item being shown.

## 11. Branding economics, as observed

Observed at the time of writing, **not an immutable contract**:

- Until **2026-12-31**, custom branding is included for eligible plans —
  logo, watermark, interface theme, background, and removal of the normal
  powered-by presentation.
- From **2027-01-01**, the interactive viewer itself remains included with
  standard branding, while custom branding becomes a **€20/month add-on**.

This is provider pricing and configuration observed on a date. It should be
re-checked before any commitment depends on it.

---

## 12. Required cs2screen panel configuration (V1)

The URL carries the key, the inspect link, `embed=1` and a language. Everything
about presentation is a **panel setting** — a query parameter cannot override
one — so the intended FloatAlpha experience depends on these being set.

| Setting | Required value | Why |
|---|---|---|
| Showroom background | **Black / near-black** | It is the viewer's default here and it blends into FloatAlpha instead of announcing a third-party site |
| Background selector | **Hidden** | The map chooser (Dust II, Mirage, Nuke, Office…) turns the asset page into a generic skin viewer. The environment experience belongs in Arena |
| Lighting | Studio or CS2 | Even lighting reads best against black; a map preset fights the page |
| Rotate on open | **On** | The item should be alive when the reader arrives |
| Initial item size | Fit the frame | Geometry varies enormously between a knife and an AWP |
| Reset camera | **On** | Cheap recovery from an awkward angle |
| Fullscreen | **On** | Explicit user action only; entering 3D never auto-fullscreens |
| **Arena** | **On** | The second state V1 is built around |
| Catalog browsing | **Off** | FloatAlpha chooses the asset; browsing makes it a marketplace |
| Customize (float/seed/StatTrak) | **Off** | Editing the item would contradict the representative-item disclaimer |
| Own inspect-link input | **Off** | The application controls what is inspected |
| Visitor agent selection | **Off** | Not needed to inspect an asset |
| Visitor glove selection | **Off** | Distinct from *inspecting* a glove asset, which works normally |
| Language picker | Optional | The URL already requests English |
| Branding | FloatAlpha logo + watermark | Already configured and visible in production |
| **Origin allowlist** | **`floatalpha.com`** | Keys are locked to up to 16 origins; the viewer will not load on an unlisted domain |

Controls that **cannot** be hidden from the application side: everything in the
table above is panel-side only. FloatAlpha code cannot suppress a provider
control, so anything left enabled in the panel will appear inside the frame.

## 13. Readiness, and the failure we cannot observe

`iframe.onload` proves only that a document loaded. It does not prove the
inspect target was accepted, that WebGL started, or that a weapon is on screen,
so promoting 3D on load is how a reader gets shown an empty black box.

The viewer posts to its parent instead. Observed on the wire, it emits exactly
**two** message types:

| Message | Meaning |
|---|---|
| `cs2viewer:ready` | The viewer is usable. This is the only signal 3D is promoted on. |
| `cs2viewer:preview` | A screenshot the visitor took. Unused. |

**There is no error message.** Failure is therefore not directly observable.
The integration infers it from the absence of `cs2viewer:ready` within 20
seconds, which is a real limitation rather than a design choice: a viewer that
fails in under 20s still costs the reader the full timeout before the image
returns, and a viewer that is merely slow on a cold WebGL start is
indistinguishable from one that is broken.

This is mitigated, not solved, by never removing the image: it holds the hero
for the whole interval, so a timeout costs the reader nothing but the 3D view
they would not have got anyway. If the provider later emits an error message,
the timeout should become a backstop rather than the primary signal.

Messages are accepted only from `https://3d.cs2screen.com`. Any page can
postMessage into ours, and only the viewer's own origin is evidence that the
viewer is working.

## 14. V1.1 — 3D as the default representation

V1 offered 3D behind a toggle that defaulted to a 160x104 static thumbnail in a
600px hero. V1.1 inverts that for assets we have actually looked at.

**Eligibility is two separate questions**, and conflating them was the trap:

1. *Is there a target?* A renderable certificate inspect link in
   `provider_assets.static_metadata->>'inspectlink'`. Measured in production:
   **74 of the 100 tracked assets**. The other 26 are containers, which are not
   inspectable items — a real absence, not a gap to paper over.
2. *Is it known to render well?* The asset's `itemgroup`. A link only proves
   something will render, never that it renders **well**, so only verified
   categories are promoted into the hero unattended.

Verified categories: `rifle`, `pistol`, `sniper rifle`, `smg`, `shotgun`,
`machinegun`, `knife`, `gloves`, `sticker`. Rifle, pistol, sniper rifle, knife,
gloves and sticker were each opened in the viewer — a sticker renders as a
genuine embossed decal, and gloves and knives frame correctly despite very
different geometry. SMG, shotgun and machinegun are included as the same
weapon-skin family as the three weapon classes that were checked; they were not
each opened by hand, and that is the weakest claim in this table.

Everything else — `graffiti`, `charm`, `agent`, `music kit`, `patch`,
`container`, `equipment` — shows the image by default **even when a link
exists**, and keeps 3D on the switch. All 74 link-bearing tracked assets fall
in verified categories, so in practice every asset that can show 3D does.

**The image is never a consolation prize.** Both representations share one
stage, one aspect ratio and one width, so switching does not restructure the
page and the hero has stable dimensions from first paint. The image is centred
with `object-fit: contain` and never distorted; against production art (512x384
source, ~552x327 frame) it renders at roughly 436x327, scaled down rather than
up.

**Nothing waits for the viewer.** The image renders immediately and holds the
hero while the viewer starts behind it. There is no blank hero and no spinner
where the asset should be.

**The preference is per-session.** An explicit choice is remembered in
`sessionStorage` and outranks the default in both directions, so choosing the
image once does not mean re-choosing it on every asset. It is a display
preference, not a setting: no account field, no database, nothing that follows
the reader to another device or outlives the tab.

### Analytics

| Event | Fires when |
|---|---|
| `asset_3d_auto_initialized` | 3D started because it is the default. **Not evidence of interest.** |
| `asset_visual_mode_changed` | The reader switched, with `from` and `to`. The only event that measures intent. |
| `asset_3d_loaded` | The provider's readiness message arrived. |
| `asset_3d_failed` | With a `reason`: `READY_TIMEOUT` or `IFRAME_ERROR`. |

Under V1.1 most 3D sessions are automatic, so a single combined event would
report enthusiasm nobody expressed. Rotation and Arena happen inside a
cross-origin iframe and remain invisible to the parent; no event claims
otherwise.
