---
name: orchestrator
version: 1.1.0
title: Understanding your request
description: Entry point for free-text requests. Picks the skill that fits and runs it in the same session.
planned_steps: [Understanding your request]
needs: [image]
time_limit_ms: 1800000
typical_ms: [180000, 420000]
---
# Orchestrator

Follow `skills/PROGRESS.md`. The request is in `request.json` (`prompt` is what the person asked for).

1. Step **"Understanding your request"**: read `skills/INDEX.md`, which lists every skill available here.
   - Pick the **one** skill whose description fits best.
   - Specific skills win over `virtual-creative-usecase`. Use the generic one only when the request is a still design that no specific skill covers.
   - If no skill fits (a website, code, a spreadsheet…), or the request is mainly a kind of media that the **"Media this computer can make"** section of `INDEX.md` marks **no** (for example a video or music when no agent here makes them), do not make anything. Write `out/result.json` as `{"skill":"none","reason":"<one plain sentence>"}` and stop. The reason says what is missing in the person's terms, for example "No agent on this computer can make videos yet, so I can't make this one." or "Seleya makes designs and slide decks, not websites."
   - A skill that uses a media kind marked **no** still fits when it can do without it (its pictures fall back to artwork); pick it.

   Then write `out/route.json` as `{"skill":"<name>","reason":"<one line>"}`, and finish the step with the chosen skill in the detail.
2. Declare the chosen skill's steps: `{"type":"plan","steps":[...the planned_steps of that skill...]}`.
3. Read `skills/<name>/SKILL.md` and follow it exactly, in this same session. Do not hand the work to another agent.
4. The chosen skill writes `out/result.json`. Its `"skill"` field must be the chosen skill's name.

Never invent facts (names, dates, times, prices, numbers, addresses, phone numbers, emails, links) that are not in the request.
