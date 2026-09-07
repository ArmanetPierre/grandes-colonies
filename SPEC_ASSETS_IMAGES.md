# Image specification — Grandes Colonies

> Art direction, production constraints and control method for the game's images.
>
> **The prompts themselves are not in this document**: they live in [assets/prompts.json](assets/prompts.json), which is their only source of truth. Duplicating them here would make them wrong at the first iteration — that is exactly what happened with the first version of this spec.
>
> Pipeline and usage: [assets/README.md](assets/README.md) · Project: [PLAN_DE_DEVELOPPEMENT.md](PLAN_DE_DEVELOPPEMENT.md)

---

## 1. Art direction

**Ancient Greece, stylized 3D rendering.** Soft volumes and matte material, ambient light, slight top-down relief — the look of modern digital board games, transposed into an Aegean setting: umbrella pines and cypresses, dry-stone agricultural terraces, marble quarries, column drums, olive trees.

Adopted on 2026-08-26 after a comparative trial of five directions ([assets/style-tests.json](assets/style-tests.json)):

| Direction | Verdict |
|---|---|
| Mediterranean watercolour | Rejected — the rendering felt too "loose" |
| Minoan fresco | Rejected — a palette common to all tiles: terrain stops being colour-coded, and blue means the sea everywhere else |
| Vector flats | Rejected |
| Ancient mosaic | Rejected |
| **Stylized 3D rendering** | **Adopted** |

---

## 2. The four rules that condition the result

**① Never ask for a hexagonal shape.**
The tiles must butt together to the pixel. No model produces geometry precise enough to tessellate. We generate **square images** of terrain, cut into a hexagon by a CSS mask on the client side.

**② Never ask for text, a number or a symbol.**
Models remain unreliable on text. Tokens 2–12, port ratios, card names: everything is set in typography in the code.

**③ One clear dominant colour per tile.**
It is colour, and colour alone, that lets you recognize a terrain on a zoomed-out board of 50 hexes. Each subject must impose its dominant — that is the `clearly dominant` phrasing in the prompts. The "Minoan fresco" direction was rejected precisely for failing on this point.

**④ Never generate a tile on its own.**
Harmony is a *relational* property: it exists only between the images, not in each one. Ten tiles described separately, however carefully, are ten images that have never seen each other — and they drift. The first series paid for it (§7). Since then, a **series sheet** is generated in one go, validated by eye, then **attached as a reference to every tile generation**: see §3.

---

## 3. The series sheet

`sheet_terrains` is a single image showing the **ten terrains side by side**, in a grid of five columns by two rows. It illustrates nothing and never appears in the game: it serves as a constraint.

**Why a single image.** Asking for ten tiles separately amounts to asking ten times "make a nice image", never "make them go together". By placing them in one frame, the model is forced to arbitrate them against one another — that is where, and only where, the range is decided.

**How it constrains the rest.** Each tile declares `"ref": ["sheet_terrains"]` in `prompts.json`. The script then attaches the sheet to the request, **before** the text, and adds the instruction to align with it. The tile is no longer described: it is situated. A missing reference fails the generation, never a silent fallback — an off-range tile shows up only on the control sheet, ten images later.

**Order of work.** The sheet first, validated by eye; the tiles next.

```bash
node scripts/generate-assets.mjs --id sheet_terrains --best
```

```bash
node scripts/generate-assets.mjs --priority P0 --force
```

Regenerating the sheet invalidates the series: the tiles must follow.

---

## 4. Readability constraints

Functional constraints, not aesthetic ones: game pieces will be drawn **on top of** these images.

- **Calm centre**: it holds an opaque numbered token.
- **Calm edges**: roads are drawn on the edges, settlements on the corners.
- **Full-frame composition**: the pattern extends beyond the four edges, with no margin, frame or vignette.
- **The sea is the most repeated tile on the board**: it must be the most discreet of all. It had to be regenerated once for this reason.
- **Low visual noise**: the tile must stay identifiable at 120 px.

---

## 5. Traps encountered in production

Each one cost a regeneration. They are all covered by the negative prompt in `prompts.json` — do not lighten it.

| Trap | Symptom | Trigger |
|---|---|---|
| **Paper margin** | The model paints a work *on a sheet*, white edges included | Pictorial styles ("watercolour on paper") |
| **Slab on white** | The tile is rendered as a placed object, with its base | 3D styles ("product render") |
| **Perspective** | The patterns tilt outward; the tessellation breaks | 3D styles, if orthography is not imposed |
| **Directional patterns** | Stripes or bands that "catch" from one tile to its neighbour | Furrows, terraces, waves described as regular |
| **Dominant ridge** | A strong line crosses the centre, where the token goes | Reliefs described in the singular ("a ridge", "a furrow") |
| **Parallel bands** | The hills' terraces become regular stripes from edge to edge | "Terraces", "furrows", if not said to be short and disoriented |
| **Paving** | The barley field renders as stone paving, not vegetation | Plots "bordered with stone" — the model keeps the stone |
| **Repeated scrolls** | The mist becomes a pattern of identical spirals | "Scrolls", "swirls" |
| **Dead surface** | The sea comes out as a flat with no material (internal contrast 9) | Discretion instructions pushed too far, without demanding texture |
| **Garish saturation** | A tile right in hue but twice as saturated as its neighbours | Silence: with no common range imposed, each image is saturated for itself |
| **Lifeless series** | A perfectly coherent series, with no life — the "vector flats" direction rejected in §1, rediscovered by accident | Confusing a *narrow* saturation band with a *low* one, and stacking "low contrast", "calm", "low visual noise" |
| **Repeated motif** | The same group of objects reproduced 2×2 within the tile; very visible on the quarry | "Evenly distributed motifs", if variety is not asked for — the model produces a tileable texture |

---

## 6. What is not AI-generated

| Element | Reason | Solution |
|---|---|---|
| Roads, settlements, cities, trading posts, knights | Recoloured into 12 colours at runtime | Parametrized SVG shapes |
| Numbered tokens 2–12, ports | Text | SVG typography |
| Resource icons | Must stay sharp at 24 px | [game-icons.net](https://game-icons.net), CC BY 4.0 |
| Interface icons | — | lucide-react |
| Logo / title | Text | Typography |

---

## 7. Formats

| Category | Dimensions | Ratio | Background |
|---|---|---|---|
| Terrain tile | 1024 × 1024 | 1:1 | opaque, full-frame |
| Card illustration | 1024 × 1536 | 2:3 | opaque |
| Card back | 1024 × 1536 | 2:3 | opaque |
| Wallpaper | 2560 × 1440 | 16:9 | opaque |
| Series sheet | — | 21:9 | grid of 10 panels, never shown in game |

A tile displays at ~120 px in the overview; the 8× factor of the source covers high-density screens and close-up zoom.

**The extension is not fixed**: the model returns JPEG or PNG depending on the case. The script names the file after its actual content and keeps `assets/generated/index.json` up to date. Every consumer goes through that index — never through a guessed extension.

---

## 8. Palette and value scale

Two distinct properties, and it is their confusion that failed the first series:

- **Harmony comes from saturation**, which must be *common* — a single band, shared by the ten tiles. Narrow, not low: the first correction dropped it to 14–46 % and produced a series that was right, harmonious and lifeless. The band adopted is **22–58 %**, rich and tight.
- **Distinction comes from lightness**, which must be *stepped* — ten rungs from the lightest to the darkest, never two tiles on the same one.

The original series did exactly the opposite. Measured: saturations from **8 % to 57 %** — a factor of seven, the sea and the hills shouting while the quarry and the unexplored tile were washed out; and **five tiles crammed between 140 and 153** lightness, indistinguishable in greyscale, therefore indistinguishable in the overview.

The scale descends in steps of about 16 points. Its order is also the order of the panels on the sheet (§3), to which the prompts refer one by one.

| # | Tile | Resource | Dominant | Lightness | Saturation |
|---:|---|---|---|---:|---:|
| 1 | Dry scrubland | — | `#E0C182` warm sand | 195 | 42 % |
| 2 | Marble quarry | Ore | `#9EB8CA` cold grey | 178 | 22 % |
| 3 | Barley field | Wheat | `#C0A355` gold | 163 | 56 % |
| 4 | Pasture | Wool | `#86A54F` olive green | 146 | 52 % |
| 5 | Shallows | Fish | `#479B99` turquoise | 130 | 54 % |
| 6 | Clay hills | Brick | `#A16344` terracotta | 114 | 58 % |
| 7 | Unexplored | — | `#665C7F` grey-violet | 99 | 28 % |
| 8 | Aegean Sea | — | `#345975` deep blue | 81 | 56 % |
| 9 | Pine forest | Wood | `#25532C` pine green | 65 | 55 % |
| 10 | Gold mine | Gold | `#3C3325` dark rock + golden accents | 52 | 38 % |

**The two low values are deliberate**: the quarry (22 %) and the unexplored tile (28 %) are stone and mist. The other eight sit between 38 and 58 %.

**The two pairs to watch.** Scrubland and quarry are the lightest: 17 points, plus the warm / cold opposition, plus a cut geometry against an organic ground. Forest and mine are the darkest: the mine is more desaturated, and its gold veins are its only light accents.

**These values are not an intention, they are a constraint.** The model does not hold them — see §9. They are imposed afterwards, and checked: `scripts/mesure-gamme.py` reads them right here and rejects a series that departs from them (§10).

---

## 9. Calibration

**The model does not hold numbers.** Three iterations of the sheet prompt established it. The scale was first given in relative terms ("one notch darker than the previous one"): marble and scrubland came out inverted, clay and mist drifted by +33 and +39. It was then given in absolute values (`brightness 76` … `brightness 20`): the drift changed tiles, not magnitude — shallows and pasture inverted by **sixty points**. The model respects the direction and drops the measurement, and it always drops it where its prior is strong: shallow water seen from above *is* light.

Continuing to rephrase would mean paying for an image on every try for a result a calculation gives exactly. The split is therefore:

| To the model | To the code |
|---|---|
| The material, the volumes, the light, the subject | Lightness, saturation, contrast |
| What a calculation cannot invent | What a model cannot hold |

```bash
python3 scripts/etalonner.py
```

Reads `generated/tiles/`, writes `processed/tiles/` under the **same filename** — the calibrated tile is a pure replacement, `index.json` stays valid, and `scripts/assets.mjs` makes it take precedence when copying to the client. `generated/` is never modified: everything stays regenerable from `prompts.json`.

Three corrections, in this order, which is not indifferent:

1. **contrast** compressed if it exceeds 34 — roads and settlements are drawn on top;
2. **saturation** brought into the common band;
3. **lightness** brought onto its rung by a gamma curve, last — a per-pixel gain preserves saturation exactly, the reverse is false; a linear offset would clip the highlights.

**What calibration does not recover**: geometry. A flat tile stays flat — you do not compute absent material; a band continuous from edge to edge stays a band. Those defects are fixed at the prompt, and that is why `mesure-gamme.py --brut` exists: it is the raw output you look at to decide whether to regenerate.

---

## 10. Quality control

```text
☐ Exact dimensions
☐ No text, number or symbol
☐ No hexagonal shape, no slab, no base
☐ Pattern to all four edges, with no frame or vignette
☐ Centre free of important detail
☐ Calm edges, no strong contrast
☐ Style consistent with the rest of the series
☐ Identifiable when reduced to 120 px
☐ Lightness, saturation and contrast conform to §8   ← measured, blocking
☐ The 10 tiles are distinguishable in greyscale       ← measured, blocking
```

**The numeric check comes before the glance**, because the first series had passed the glance:

```bash
python3 scripts/mesure-gamme.py
```

It measures each tile **as it will ship to the client** — calibrated if it is — compares it to its rung from §8 and exits with code 1 if a single one departs from it — lightness, saturation, internal contrast, and distance to its neighbours on the scale. It names the offending tiles. `--brut` measures the model's output before calibration: that is the one that says whether to regenerate.

```bash
python3 scripts/mesure-gamme.py --planche
```

Measures the ten panels of the sheet **before** cutting the tiles from it. An inverted rung is fixed there for the price of one image, and for the price of ten if you only see it afterwards.

**Decisive test by eye**: the 10 tiles side by side at 120 px, then the same in greyscale. If two blend together, or if one draws the eye much more than the others, regenerate — whatever its beauty at full size.

```bash
python3 scripts/contact-sheet.py /tmp/planches
```

produces `planche_120px.png` (the decisive test), `planche_gris.png` (the same without the hue: it is the harshest test, it leaves only the value) and `planche_plateau.png` (the tessellation). Prefer it to the HTML sheet when iterating: **the preview panels cache the images aggressively**, and a regeneration rewrites the same filename — so you think you are looking at the new tile when you see the old one.

`assets/preview/index.html` remains the full sheet, cards and backgrounds included, to open in a real browser.
