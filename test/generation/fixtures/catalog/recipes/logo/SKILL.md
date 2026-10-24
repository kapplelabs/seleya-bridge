---
name: logo
version: 1.0.0
title: Logo
description: A brand logo as a clean vector (symbol + wordmark), delivered as SVG and PNG.
planned_steps:
  [Writing the brief, Choosing a direction, Laying out the design, Rendering, Checking the design]
needs_image: false
time_limit_ms: 900000
typical_ms: [120000, 300000]
---

# Logo

Follow `skills/CREATIVE.md`. This format needs **no generated visual**: the mark is drawn as vector shapes. Skip step 3.

**Brief fields** (`out/brief.json`): `brand_name` (exact), `tagline` (only if given), `industry`, `personality` (3 adjectives), `palette` (2–3 hex), `mark_idea` (one line).

**Pages**: one page `logo`, 1000×1000.

1. Write `out/logo.svg`: `viewBox="0 0 800 800"`, a simple mark plus the wordmark, flat colours. The wordmark is real `<text>` with a font-family fallback, or paths. No raster images, no gradients thinner than 2 px, recognisable at 64×64.
2. Write `out/logo.html`: a 1000×1000 body on a plain light background, with the SVG inlined and centred at 800×800.

The brand name must appear exactly as given. Do not invent a tagline.

Manifest: `pages: [{"name":"logo","html":"out/logo.html","width":1000,"height":1000}]`, plus `"vector":"out/logo.svg"`.
