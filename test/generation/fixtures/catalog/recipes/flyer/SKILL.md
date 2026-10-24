---
name: flyer
version: 1.0.0
title: Flyer
description: A flyer (sale, event, service, opening…) with a visual, a key message and details, as PNG and PDF.
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

# Flyer

Follow `skills/CREATIVE.md`, all five steps.

**Brief fields** (`out/brief.json`):

- `purpose`
- `flyer_type`: sale, event, service, opening, recruitment or information
- `subject`
- `key_message`: at most 8 words
- `offer`: only if given
- `details[]`
- `contact`: only if given
- `palette`

**Pages**: one page `flyer`. Use the requested size; the default is 1000×1400 (5:7).

**Layout**: the key message is dominant. Details go in a scannable list. Contact details or the CTA sit in a footer band.
