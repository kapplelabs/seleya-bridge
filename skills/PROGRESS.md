# Progress protocol (every skill follows it)

Seleya shows your work live by reading `progress.jsonl` in the current folder. Append one JSON object per line **at the moment it happens**, using the shell. Never write these lines in a batch at the end.

Before a step starts, and right after it ends:

    printf '%s\n' '{"type":"step","label":"<step name>","status":"active"}' >> progress.jsonl
    printf '%s\n' '{"type":"step","label":"<step name>","status":"done","detail":"<one short factual line>"}' >> progress.jsonl

When one step ends and the next starts, write both lines with **one** command (each command costs time):

    printf '%s\n' '{"type":"step","label":"<step>","status":"done","detail":"<…>"}' '{"type":"step","label":"<next step>","status":"active"}' >> progress.jsonl

Use `"status":"failed"` with a detail if a step fails. Use exactly the step names your skill lists.

When you add steps while working (for example one per slide), first declare the full list:

    printf '%s\n' '{"type":"plan","steps":["Outlining","Slide 1/5","Slide 2/5"]}' >> progress.jsonl

Seleya shows every file you write in `out/` as soon as it is written (a brief, a picture, a page, a slide): you never announce files yourself.

Rules for every skill:

- Work only inside the current folder. Everything you need is here. Never read, list or search outside it: no parent folders, no absolute paths, no other runs, no logs or transcripts of your own tools. Reads outside are refused and stop your work.
- If a tool you use saves its file somewhere else (an image helper does), bring in only that file, with one copy or convert command, then work on the copy here.
- Never invent facts (names, dates, times, prices, numbers, addresses, phone numbers, emails, links) that are not in the request.
- Text in quotes in the request is used verbatim.
