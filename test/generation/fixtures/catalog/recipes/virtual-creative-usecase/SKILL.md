---
name: virtual-creative-usecase
version: 1.0.0
title: Custom design
description: Any still visual design that no specific skill covers (invitation, certificate, thumbnail, ticket, badge, label, book cover, infographic, sticker sheet, voucher…). Defines the usecase on the fly, then follows the shared creative pipeline.
planned_steps: [Defining the design, Writing the brief, Choosing a direction, Laying out the design, Rendering, Checking the design]
needs: [image]
time_limit_ms: 1200000
typical_ms: [180000, 420000]
---
# Custom design (virtual creative usecase)

Follow `skills/PROGRESS.md`. The request is in `request.json`: `prompt` is the request; `width`/`height`/`pages` are given only if the person chose them.

## 1. Step "Defining the design"

**If `request.json` has `"definition_edited": true`**, the person corrected the definition:
`out/definition.json` is already theirs. Do not redefine anything. Read it, report the step as done
("Using your corrected definition"), and design from it exactly (size, pages, content, required parts).

Otherwise write `out/definition.json`:

```json
{"deliverable":"<what it is, e.g. wedding invitation>","purpose":"…","audience":"…",
 "size":{"width_px":W,"height_px":H,"why":"<the convention you followed>"},
 "pages":[{"name":"<page>","width":W,"height":H}],
 "needs_visual":true|false,
 "content_inventory":["<every text item and fact from the request, verbatim>"],
 "required_parts":["<parts this kind of deliverable must have>"],
 "assumptions":["<anything you had to assume>"]}
```

- **Size**: use the requested size if there is one. Otherwise use the conventional size for this deliverable, and say which convention in `why`. Cap the long side at 6000 px.
- **Pages**: two-sided or multi-panel deliverables (a ticket, a tri-fold brochure) list each page.
- **Missing content**: if the request mentions something it does not supply (a QR code to an unknown link, a map), list it in `required_parts` as a placeholder. Never invent it.

Then announce the definition: `{"type":"draft","path":"out/definition.json","slot":"definition"}`.

## 2. Steps 2–5

Follow `skills/CREATIVE.md`:
- Use the brief fields that suit this deliverable.
- Generate a visual only if `needs_visual` is true, and add the step "Generating the visual" to your plan when you do.
- Write one HTML page per entry in `pages`.
- Every item of `content_inventory` appears **exactly once** as real text.
- Every required part is present. Missing content appears as a clearly labelled placeholder box.

The manifest (`out/result.json`) uses `"skill":"virtual-creative-usecase"`, the `pages` from your definition, and `keep_together` with every name, date, time and address. Seleya checks the size, the content inventory and the parts against `out/definition.json`.
