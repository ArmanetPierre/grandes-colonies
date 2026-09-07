# Assets — Grandes Colonies

Generation, storage and quality control of the game's images.

Reference specification: [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md)

---

## Architecture

```text
assets/
├── prompts.json              source of truth: 29 images, their prompts and priorities
├── generated/                raw AI outputs, never touched by hand
│   ├── index.json            identifier -> real file path
│   ├── index.js              same content, loadable over file:// by the sheet
│   ├── sheets/               sheet_terrains — the series sheet, never shown in game
│   ├── tiles/                tile_forest.jpg … 1024×1024, square
│   ├── cards/                card_dev_*, card_obj_*, card_back_* … 2:3
│   └── backgrounds/          bg_* … 16:9
├── processed/                calibrated versions, which take precedence over generated/
│   └── tiles/                same filenames: pure replacement
└── preview/
    └── index.html            quality-control sheet (open it in a browser)
```

**Why `generated/` and `processed/` are separate**: a generated image can be regenerated identically from `prompts.json`, whereas a retouched image cannot. Keeping both lets you redo everything without losing anything. `generated/` is never modified by hand.

**The model gives the material, the code gives the numbers.** Three prompt iterations showed that it does not hold a value scale — it respects the direction and drops the measurement, always where its prior is strong. `scripts/etalonner.py` imposes lightness, saturation and contrast afterwards, exactly, for free, and reversibly. See [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md) §9.

**Tiles are never generated on their own.** `sheet_terrains` shows the ten terrains in a single frame; each tile declares it in `ref` and the script attaches it to the request. Harmony is a *relational* property: ten images described separately have never seen each other, and they drift — that is what happened to the first series. See [../SPEC_ASSETS_IMAGES.md](../SPEC_ASSETS_IMAGES.md) §3.

**Tiles are square, not hexagonal.** The hexagon cut is done at display time by a CSS/SVG mask, on the client side. An AI does not produce geometry precise enough for hexagons to butt together seamlessly. It is the most important rule of the pipeline.

**File extensions are not fixed.** The model returns JPEG or PNG depending on the case; the script names the file after its actual content and keeps `index.json` / `index.js` up to date. Every consumer (control sheet, future client) must go through that index rather than guess the extension.

---

## Usage

### 1. Provide the API key

The key is **never** written into the repo. Two options:

```bash
export GEMINI_API_KEY="your-key"
```

or a `.env` file at the project root (already in `.gitignore`):

```bash
echo 'GEMINI_API_KEY=your-key' > .env
```

Key to be created at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

### 2. Check before spending

```bash
node scripts/generate-assets.mjs --list
```

```bash
node scripts/generate-assets.mjs --dry-run --priority P0
```

`--dry-run` prints the composed prompts without calling the API: useful for reviewing what is about to be sent.

### 3. Generate — the sheet first

```bash
node scripts/generate-assets.mjs --id sheet_terrains --best
```

To look at before going further: it fixes the range, the material, the light and the value scale of the whole series. As long as it is not right, regenerating it costs one image; letting it through costs ten.

```bash
node scripts/generate-assets.mjs --priority P0
```

The tiles are then generated **with the sheet attached**. A missing reference fails the generation rather than producing an off-range image. `--no-ref` bypasses it — for comparison or troubleshooting, not for production.

An image already present is skipped. To redo it:

```bash
node scripts/generate-assets.mjs --id tile_forest --force
```

Regenerating the sheet invalidates the series: the tiles must follow (`--priority P0 --force`).

### 4. Calibrate

```bash
python3 scripts/etalonner.py
```

Brings each tile onto its rung — lightness, saturation, contrast — and writes to `processed/tiles/` under the same name. `generated/` is not touched, and the step replays as many times as you want at no cost.

What it does not recover: geometry. A flat stays a flat, a continuous band stays a band. Those defects are regenerated.

### 5. Check — measurement before the eye

```bash
python3 scripts/mesure-gamme.py --planche
```

Measures the ten panels of the sheet **before** cutting the tiles from it: an inverted rung is fixed there for the price of one image, and for the price of ten if you only see it afterwards.

```bash
python3 scripts/mesure-gamme.py
```

Measures the tiles as they will ship — calibrated if they are — and exits with code 1 if a single one departs from its rung. `--brut` measures the model's output before calibration: that is the one that says whether to regenerate.

```bash
python3 scripts/contact-sheet.py /tmp/planches
```

Produces `planche_120px.png`, `planche_gris.png` (the harshest test: without the hue, only the value remains) and `planche_plateau.png`.

`assets/preview/index.html` remains the full sheet to open in a browser — tiles at their real size, demo board, checklist.

### 6. Bring within the client's reach

```bash
npm run assets
```

The client requests its images from `/assets/…`, i.e. from `packages/client/public/`,
which is **ignored by git** — so it is empty on a freshly cloned repo. Nothing
connected the two: the images were generated here, the client looked for them
there, and nobody made the trip. The board then displayed without its terrains,
with no message signalling the missing step.

A tile present in `processed/` takes precedence over its raw version: it is the
one that holds the value scale. The command reports it ("including 10
calibrated").

`npm run play` makes the copy at startup; the command above remakes it on
demand, and `node scripts/assets.mjs --force` overwrites what is already in
place after a regeneration or a calibration.

---

## Priorities

| Priority | Content | Count | When |
|---|---|---:|---|
| **REF** | Series sheet | 1 | **Before everything else** — it constrains the ten tiles |
| **P0** | Base terrain tiles | 6 | Needed for the first playable version |
| **P1** | Sea, gold, fish, unexplored | 4 | Complete ruleset |
| **P2** | Cards and card backs | 15 | After gameplay validation |
| **P3** | Wallpapers | 3 | Comfort, non-blocking |

Generate REF first and validate it, then P0, check, adjust the prompts if needed, then continue. Since the game's scope is not yet validated by playtest, generating the 29 images in one go amounts to paying for assets that could be cut.

---

## Cost

Prices noted on 2026-08-26 at [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing). **No free tier exists for image generation**: billing must be enabled on the Google project.

| Model | Price / image (1K) | Notes |
|---|---:|---|
| Nano Banana 2 Lite (`gemini-3.1-flash-lite-image`) | $0.034 | `--cheap` |
| Nano Banana 2 (`gemini-3.1-flash-image`) | $0.067 | **default** — $0.101 in 2K |
| Nano Banana Pro (`gemini-3-pro-image`) | $0.134 | `--best` |
| Nano Banana (`gemini-2.5-flash-image`) | $0.039 | retired on 2026-10-02, to be avoided |

The Batch API applies **-50 %** on all these prices, at the cost of asynchronous processing: worthwhile for the final pass once the prompts are frozen, unsuited to iterative work.

### Estimate for the 29 images

| Scenario | Generations | Lite | Default | Pro |
|---|---:|---:|---:|---:|
| Single pass, no retries | 29 | $0.97 | ~$2.25 | $3.89 |
| **Realistic** (tiles ×4, cards ×2.5, backgrounds ×2) | ~84 | $2.80 | ~$6.70 | $11.30 |
| P0 only, realistic (6 tiles ×4) | 24 | $0.81 | $1.61 | $3.22 |

The iteration factor dominates the cost. It is high on the tiles because the constraint is not the beauty of an isolated image but the **coherence of the series**: a tile that steps out of the style forces a regeneration, sometimes several.

That is precisely what the series sheet aims to reduce: the iterations concentrate on one image instead of ten, and the tiles follow. The ×4 factor on the "realistic" line predates this change — it remains the prudent assumption until a full pass has re-measured it.

The cost of the input tokens (the prompts, ~250 tokens each) is negligible. The reference images attached to the tiles add to it — an input image costs a few hundred tokens, an order of magnitude below the price of a generated image. A sheet that avoids a single regeneration already pays for itself.

The script prints the chosen model and the estimated cost before generating, then leaves 4 seconds to cancel (`--yes` to bypass).

---

## Model used

The script **hard-codes no model name**. It queries the API to find the image-generation models available on the key and picks according to the requested tier.

This is deliberate: Google's image models change often — the Imagen family was discontinued on 17 August 2026 in favour of Nano Banana, and Nano Banana itself is discontinued on 2 October 2026. A hard-coded name would break the script at the next rotation.

By default, the script favours a **flash** model over a **pro** one. On this project the difficulty is the coherence of a series of tiles, not the rendering of an isolated image — a pro model costs double without answering it better.

```bash
node scripts/generate-assets.mjs --priority P0            # flash (default)
node scripts/generate-assets.mjs --priority P0 --cheap    # lite
node scripts/generate-assets.mjs --priority P0 --best     # pro
node scripts/generate-assets.mjs --model gemini-3-pro-image --priority P0
```

---

## What is not AI-generated

| Element | Reason | Solution |
|---|---|---|
| Roads, settlements, cities, trading posts | Recoloured into 12 colours at runtime | Parametrized SVG shapes |
| Numbered tokens 2–12, ports | Text | SVG typography |
| Resource icons | Must stay sharp at 24 px | [game-icons.net](https://game-icons.net), CC BY 4.0 |
| Interface icons | — | lucide-react |
| Logo / title | Text | Typography |
