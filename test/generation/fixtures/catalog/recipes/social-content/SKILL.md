---
name: social-content
version: 1.0.0
title: Social post
description: A social media visual (post, square, story) with a generated main visual and short text.
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

# Social post

Follow `skills/CREATIVE.md`, all five steps.

**Brief fields** (`out/brief.json`):

- `social_content_type`: post, square or story
- `purpose`
- `message`: at most 10 words on the image
- `supporting_text`: optional
- `handle_or_link`: only if given
- `palette`

**Pages**: one page `post`. Sizes:

- post: 1080×1350
- square: 1080×1080
- story: 1080×1920

Use the requested size.

**Rules**:

- Big, short text; the design must read on a phone.
- For stories, keep all text out of the top 14% and the bottom 14% of the page (the platform's UI covers them).
