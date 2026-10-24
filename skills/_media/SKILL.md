---
name: _media
version: 1.0.0
title: Media
description: Internal. Makes the images, videos or audio another skill asked for, one file per job.
planned_steps: []
time_limit_ms: 720000
typical_ms: [60000, 240000]
---
# Making media

Another skill finished its work and needs media from you. Your prompt says which **kind** (image, video or audio) and which jobs file (`out/media/jobs-<kind>.json`) to read. Each job has:

- `id`, `prompt` (what to make), optionally `aspect` (for example `16:9`, `4:5`, `1:1`) and `purpose`;
- `save_as`: the exact file to write.

For every job, in order:

1. Make it with your **built-in generation tool for that kind** (image generation for images, and so on). Follow the prompt and the aspect ratio.
   - Images: **no text, letters, numbers, logos or watermark** in the picture, unless the prompt explicitly asks for one.
2. Save it exactly at `save_as`. If your tool gives another file type (JPEG, WebP, WAV…), save it with the same name and that extension, for example `out/media/cover.jpg`; Seleya converts it.
3. If you cannot make a job (the tool is missing, it refused, it failed twice), write one short reason in `out/media/<id>.error.txt` and go on to the next job.

Rules:

- Do not write `out/result.json`, `progress.jsonl` or any other file. Change nothing outside `out/media/`.
- Do not ask questions; there is nobody to answer. When every job has a file or an error note, stop.
