---
name: slides
version: 2.0.0
title: Slides
description: A designed slide deck from a brief, written slide by slide as structured content, with generated pictures, that Seleya renders with its own themes.
planned_steps: [Outlining, Rendering, Checking the slides]
needs: [image]
media: delegated
resumable: true
time_limit_ms: 1740000
typical_ms: [300000, 600000]
---
# Slides

Follow `skills/PROGRESS.md` for every step. The request is in `request.json`. It contains:
- `brief`: what the deck is about;
- `audience`, `tone`, `language` (`vi` means write in Vietnamese, `en` means English);
- `count`: the exact number of slides;
- optionally `instruction` with `previous_deck` (a refine).

You write **content only**. Seleya renders it with its own themes, so never write HTML or CSS.
You also **describe the pictures**; you do not make them. Seleya has an agent that can make images do that after you finish (or, when this computer has none, the slides use the theme's artwork). So never try to generate an image yourself.

## 1. Step "Outlining"

Write `out/outline.json`:

```json
{"title": "<deck title>", "theme": "midnight|paper|aurora|ember|fresh", "slides": [{"layout": "...", "heading": "..."}]}
```

- The outline has exactly `count` slides. Slide 1 uses `cover`. Use `closing` for the last slide when it fits.
- Choose the theme by subject and tone:
  - `midnight`: technology, data, neutral;
  - `paper`: formal, editorial, leadership, finance;
  - `aurora`: launches, creative, inspiring;
  - `ember`: food, drinks, hospitality, lifestyle, warm brands;
  - `fresh`: health, education, sustainability, light and friendly.
- **Make it look designed**: vary the layouts. Never use the same layout on two slides in a row. A deck of 5 or more uses at least 4 different layouts, and at least one of `cards`, `stats` or an image layout.

Then:
- announce the outline: `{"type":"draft","path":"out/outline.json","slot":"outline"}`;
- declare one step per slide: `{"type":"plan","steps":["Outlining","Slide 1/N", …,"Slide N/N","Rendering","Checking the slides"]}`.
- **"Rendering" and "Checking the slides" are Seleya's steps**, done after you finish: never write step lines for them, and never render or check the slides yourself. Your work ends with `out/result.json`.

## 2. Writing the slides

For each slide, in order, use the step label "Slide i/N".

1. Write `out/slides/NN.json` (`01`, `02`, …):

   ```json
   {"layout": "<layout>", "kicker": "...", "heading": "...", "body": "...", "bullets": ["..."],
    "right": ["..."], "stats": [{"value": "...", "label": "..."}], "cards": [{"title": "...", "body": "..."}],
    "image": {"id": "slide-NN", "prompt": "..."}, "notes": "..."}
   ```

   Only the fields the layout uses. Layouts:
   - `cover`: heading = the deck title, body = the subtitle, optional kicker. **Always give the cover an image.**
   - `section`: a divider; heading plus an optional body.
   - `bullets`: heading, optional body, up to 5 bullets.
   - `two-column`: heading, `bullets` (left) and `right` (right), up to 4 each.
   - `image-left` / `image-right`: a picture on one half, heading + short body + up to 4 bullets on the other. Needs `image`.
   - `image-full`: a full-bleed picture with a heading and one short line over it. Needs `image`.
   - `stats`: 2–4 key numbers (`value` + `label`). **Only figures that are in the brief.** No figures → use `cards`.
   - `cards`: 2–4 short points, each a title (≤ 5 words) and a body (≤ 14 words).
   - `quote`: body = the quote, heading = who said it. Only quotes from the brief.
   - `closing`: heading, body, optional up to 4 short bullets (shown as chips); may have an image.

   `kicker` is an optional small label above the heading (≤ 3 words), for example the section name.

2. Announce the slide **right after writing it**: `{"type":"draft","path":"out/slides/NN.json","slot":"slide-i"}`.

### Pictures

- Give a picture to the cover and to **2 or 3 other slides** (image layouts, or `closing`); no more than 4 pictures in all.
- `image.id` is `slide-NN` (the slide number); `image.prompt` describes the picture in English, 1–2 sentences: subject, setting, mood, light, style (photographic or illustrated, consistent across the deck), colours that match the theme.
- A picture never contains text, letters, numbers, logos or a watermark; say "no text" in every prompt.
- Do not depict real, named people, or brand logos.

### Writing rules

- Headings have at most 8 words.
- A bullet has at most about 12 words.
- No paragraph is longer than 2 lines.
- Put extra detail in `notes` (speaker notes), not on the slide.
- **Never invent specific figures, dates, names or quotes.** Only use those in the brief. When you have no figure, describe it qualitatively.

## 3. Assembling

1. Write `out/deck.json` with the same shape as the outline, but every slide filled in.
2. Write `out/media/jobs.json`, one job per picture:

   ```json
   [{"id": "slide-01", "kind": "image", "prompt": "<the slide's image.prompt>", "aspect": "16:9", "purpose": "cover"}]
   ```

   `aspect`: `16:9` for `cover`, `image-full` and `closing`; `4:5` for `image-left` / `image-right`.
3. Write `out/result.json` last:

   ```json
   {"skill":"slides","deck":"out/deck.json"}
   ```

## Refine

When `instruction` is present, start from `previous_deck`:
- apply only the instruction (for example "Fewer slides", "Add speaker notes", "More visual, fewer words");
- keep everything else, including each slide's `image` (same id and prompt) unless the instruction is about pictures; earlier pictures are already in `out/media/`;
- write `out/media/jobs.json` only for pictures that are new or changed; a changed picture gets a new id (for example `slide-03b`);
- the slide count may change only if the instruction asks for it.
