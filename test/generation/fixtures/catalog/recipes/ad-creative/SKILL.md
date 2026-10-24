---
name: ad-creative
version: 1.0.0
title: Ad creative
description: An ad or banner at an exact size, with a main visual, a headline and a prominent call to action.
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
typical_ms: [150000, 300000]
---

# Ad creative

Follow `skills/CREATIVE.md`, all five steps.

**Brief fields** (`out/brief.json`):

- `ad_creative_type`: banner, display, social ad or cover
- `format`: the size id
- `product_or_offer`
- `headline`: at most 7 words
- `cta`: exactly as given (`request.cta`). If none is given, use a neutral one such as "Learn more"; never an invented offer.
- `palette`

**Pages**: one page `ad`, at the exact requested size:

- banner: 1500×500
- landscape: 1200×628
- square: 1080×1080
- vertical: 1080×1920

**Rules**:

- The call to action is a clear button-like element and the most prominent text after the headline.
- On wide banners, put the text on one side and the visual on the other.
