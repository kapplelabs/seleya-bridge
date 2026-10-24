---
name: _hello
version: 1.0.0
title: Hello check
description: Tiny check used to verify a harness end to end (hidden from users).
planned_steps: [Reading the request, Writing the greeting]
typical_ms: [30000, 120000]
---

# Hello check

Follow `skills/PROGRESS.md` for every step.

1. Step "Reading the request": read `request.json`.
2. Step "Writing the greeting": write `out/hello.txt` containing one line: `Hello from <your agent name>` followed by the request's `prompt` value.
3. Write `out/result.json` as `{"skill":"_hello","outputs":[{"path":"out/hello.txt"}]}`.
