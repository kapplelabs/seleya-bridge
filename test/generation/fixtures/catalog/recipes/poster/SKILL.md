---
name: poster
version: 1.0.0
title: Poster
description: An event or promotional poster with a generated visual and real text, as PNG and print PDF.
planned_steps:
  [
    Writing the brief,
    Choosing a direction,
    Generating the visual,
    Laying out the design,
    Rendering,
    Checking the design,
  ]
needs_image: true
time_limit_ms: 900000
typical_ms: [180000, 330000]
---

# Poster

Follow `skills/CREATIVE.md`, all five steps.

**Brief fields** (`out/brief.json`):

- `purpose`
- `poster_type`: event, promotional, informational or announcement
- `headline`: at most 6 words
- `subline`
- `date`, `time`, `venue`, `cta`: only if given
- `details[]`
- `palette`

**Pages**: one page `poster`. Use the requested size; the default is 1000×1500 (2:3).

**Layout**: the headline first, then the facts in a clear block. The visual carries the mood; the text stays readable over it.
