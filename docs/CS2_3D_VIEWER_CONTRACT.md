# CS2 3D Viewer — integration contract

**Documentation only. Nothing in this document is implemented.** No iframe, no
viewer key, no Arena, no public configuration variable has been added.

This records what was verified about the SteamWebAPI / cs2screen interactive
viewer so the next phase can be designed without re-investigating, and so the
credential boundary is written down before anyone writes the embed.

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

## Explicitly not done in this batch

No iframe, no `NEXT_PUBLIC_CS2_VIEWER_KEY`, no viewer key obtained or committed,
no Arena, no generic asset→inspect-link mapping, no Connect Steam, no change to
any product page.
