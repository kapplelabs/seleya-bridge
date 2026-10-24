---
name: menu
version: 1.0.0
title: Menu
description: A restaurant or café menu that lists every item and price exactly as given, as PNG and PDF.
planned_steps:
  [Writing the brief, Choosing a direction, Laying out the design, Rendering, Checking the design]
needs_image: false
time_limit_ms: 900000
typical_ms: [150000, 300000]
---

# Menu

Follow `skills/CREATIVE.md`. A generated visual is optional. Skip step 3 unless the request asks for food imagery; decoration can be drawn in CSS/SVG.

**Brief fields** (`out/brief.json`):

- `venue_name`
- `industry`: café, restaurant, bar or bakery
- `sections[]`, each `{ name, items: [{ name, price, description? }] }`, copied exactly from the request (`request.items` lists the items as "Name — price" lines when the form was used)
- `item_count`
- `footer`: only if given (address, opening hours, wifi…)
- `palette`

**Pages**: one page `menu`, 1240×1754 (A4 portrait).

**Rules**:

- Every item appears **exactly once**, with its exact price, under its section. Never add, rename or reprice items.
- Align prices in a column; use dotted leaders or spacing.
- If more than 24 items do not fit, use two columns before shrinking the text below 20 px.
