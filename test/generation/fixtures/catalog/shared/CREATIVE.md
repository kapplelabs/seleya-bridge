# Creative pipeline (every Creative Studio skill follows it)

You are designing a still visual for a real person. Seleya renders your HTML at an exact size, checks it, and shows it to them. Follow `skills/PROGRESS.md` for every step: one `active` line before a step, one `done` line after it, at the moment it happens.

The request is in `request.json`. It has `prompt` (what they asked for, in their words) and may have:

- `size` / `width` / `height`: the exact size to use;
- `style`;
- `variation` and `of`: which concept direction this is out of how many;
- `negative_prompt`;
- `brand_kit`: colours, font, logo URL;
- format-specific fields, described in your SKILL.md.

## Steps (use these exact step labels)

1. **"Writing the brief"**: write `out/brief.json` with the fields your SKILL.md lists.
   - Use only facts from the request: names, dates, times, prices, addresses, phone numbers, emails, links.
   - Never add a fact the request does not give: no "free entry", no invented phone number, price, date or slogan.
   - Text in quotes in the request is used exactly as written.
   - Then announce the draft: `{"type":"draft","path":"out/brief.json","slot":"brief"}`.
2. **"Choosing a direction"**: write `out/concept.json` with `title`, `core_concept`, `style`, `visual_description`, `typography` (a display face and a body face from Google Fonts that support Vietnamese, e.g. "Be Vietnam Pro", "Inter", "Playfair Display", "Montserrat", "Lexend") and `palette` (3–5 hex colours).
   - If `variation` is given, make this direction clearly different from the others: a different layout idea and a different palette.
   - If `brand_kit` is given, its colours and font win.
3. **"Generating the visual"**: only if your SKILL.md says the format needs a visual.
   - Use your built-in image generation tool to create the main visual with **no text, letters, numbers, logos or watermark** in it, at the design's aspect ratio. Save it as `out/visual.png` (convert to PNG if needed, e.g. `sips -s format png in.jpg --out out/visual.png`).
   - Then announce it: `{"type":"draft","path":"out/visual.png","slot":"visual"}`.
   - If you cannot generate images, skip the image and build the visual from CSS/SVG shapes, gradients and patterns instead. Say so in the step's detail.
4. **"Laying out the design"**: write one HTML file per page (names and sizes in your SKILL.md). For each page:
   - **Size**: `<body>` exactly the page size (`width` and `height` in px), `margin:0`, `overflow:hidden`, inline CSS only. Fonts load from Google Fonts only; images load from the run folder (`visual.png`, relative URL).
   - **Text**: all text is real HTML text, laid out in named regions: headline, subline, details, cta, logo, footer… Never draw text inside the image. Keep every text at least 48 px from the page edges.
   - **Readability**: every text needs contrast ≥ 4.5:1 against what is behind it. Over a photo, put a solid or gradient backing under the text region rather than over the whole image.
   - **No wrapping inside facts**: a name, date, time, price or address must never wrap onto two lines. Use `white-space: nowrap` on those spans, and size the text so they fit.
   - **Draft**: announce each page as a draft as soon as it is written: `{"type":"draft","path":"out/<page>.html","slot":"<page>"}`.
5. **Self-check, then the manifest**: re-read `out/brief.json` and your HTML.
   - Every fact from the request is present, exactly once where it belongs.
   - Nothing invented.
   - Nothing overflows.

   Then write `out/result.json`:

   ```json
   {"skill":"<your skill>","pages":[{"name":"<page>","html":"out/<page>.html","width":W,"height":H}],
    "visual":"out/visual.png","keep_together":["<every name, date, time, price, address on the design>"]}
   ```

   - Omit `visual` if there is none.
   - Logos also add `"vector":"out/logo.svg"`.
   - `keep_together` lists phrases that must not wrap. Seleya checks them.

Seleya then renders and checks the design. If something fails, you will be asked to fix only that.

## Edits and resizes (a new version of an existing design)

The run folder may already contain a finished design (`out/` files from the previous version). If `request.json` has:

- **`edit_instruction`**: change **only** what the instruction asks.
  - If `edit_region` is given (`x`, `y`, `width`, `height` as fractions 0–1 of the design), only touch elements inside that area.
  - If the change is inside the generated visual, regenerate only the visual (step "Generating the visual"), with the same mood. Everything else stays identical.
  - Report a single step "Applying the edit".
- **`resize_from`**: lay out the **same content** (same brief, same visual, same text) for the new `width` × `height`.
  - Re-flow the layout for the new proportions. Regenerate the visual only if it cannot be cropped or extended to fit.
  - Report a single step "Re-laying out for the new size".

In both cases, rewrite `out/result.json` at the end, exactly as in step 5.
