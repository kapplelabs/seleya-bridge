---
name: business-card
version: 1.0.0
title: Business card
description: A two-sided business card (front and back) with exact name, title, company and contact lines.
planned_steps:
  [Writing the brief, Choosing a direction, Laying out the design, Rendering, Checking the design]
needs_image: false
time_limit_ms: 900000
typical_ms: [150000, 300000]
---

# Business card

Follow `skills/CREATIVE.md`. No generated visual: skip step 3.

**Brief fields** (`out/brief.json`):

- `name`, `title`, `company`
- `contact_lines[]`: phone, email, website, address, exactly as given (`request.contact_lines` when the form was used)
- `industry`
- `palette`

**Pages**: two pages, both 1050×600 (7:4).

- `front`: the person's name, their title and the company.
- `back`: the company or logo side, and the contact lines.

**Rules**:

- Every contact line appears exactly once, character for character.
- Keep text at least 48 px from the edges (print safe area).

Manifest pages: `[{"name":"front","html":"out/front.html","width":1050,"height":600},{"name":"back","html":"out/back.html","width":1050,"height":600}]`.
