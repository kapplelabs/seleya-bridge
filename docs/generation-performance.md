# Hiệu năng luồng generation: token, thời gian, chất lượng

Trạng thái: **Đo và tối ưu, vòng 1** · Ngày: 2026-10-24 · Nhật ký audit: [agent-harness-audits/seleya-generation-audit-log.md](agent-harness-audits/seleya-generation-audit-log.md)

Mục tiêu: người dùng nhận kết quả **tốt hơn, nhanh hơn, tốn ít token hơn**, đặc biệt khi **sửa** một thiết kế đã có.
Tài liệu này ghi cách đo, những gì đo được, các thay đổi đã làm (mỗi thay đổi một vòng đo riêng) và việc còn lại.

## 1. Cách đo

Hai script trong `scripts/`, chạy với agent thật (Antigravity, `gemini-3.8-flash-medium`):

- `scripts/bench-drive.ts`: chạy **một task** qua engine ngay trong tiến trình, ở một thư mục home riêng (không đụng
  bridge đang dùng), rồi ghi kết quả vào `<home>/bench.jsonl`.
  - Task: `poster`, `poster-edit-text`, `poster-edit-visual`, `slides`, `slides-refine`.
  - Request lấy từ lịch sử dùng thật (poster "Hạt Mộc Coffee Talk", deck giới thiệu Hạt Mộc 5 slide).
- `scripts/bench-runs.ts`: đọc lại mọi run đã xong (bảng `runs` + log của agent) và in bảng số liệu:

```bash
node scripts/bench-runs.ts --home ~/.config/seleya-bridge/generation
```

| Cột | Ý nghĩa |
|---|---|
| `wall s` | Tổng thời gian run, từ lúc bắt đầu đến khi xong (gồm render, check, sửa). |
| `startup` | Từ lúc agent khởi động đến bước đầu tiên nó báo: thời gian đọc và tìm hiểu trước khi làm. |
| `agent` | Phần việc của agent chính. |
| `fix` | Các vòng sửa sau khi check fail. |
| `media` | Tạo ảnh ủy quyền (slides). |
| `render` | Seleya render và check. |
| `sessions` | Số phiên agent đã chạy (phiên chính, mỗi vòng sửa, mỗi job media). |
| `reads` / `tools` | Số lần đọc file và tổng số lần gọi tool. |
| `in` / `out+think` / `cache` | Token, lấy từ sự kiện `result` của agent (Antigravity và Claude Code đều báo `usage`), **không ước lượng**. |

Quy tắc tính pass, viết trước khi chạy:

- Một run **pass** khi trạng thái là `completed`, tức mọi check đều qua.
- `poster-edit-text` còn phải có tiêu đề mới đúng nguyên văn trong `out/poster.html`.

Lưu ý về độ nhiễu:

- Mỗi run chỉ chạy một agent; không chạy song song hai run.
- Một số task chỉ chạy 1–2 lần vì mỗi poster tốn 5–15 phút và vài trăm nghìn token quota. Con số là **giai thoại có
  đo**, chưa phải trung bình thống kê. Chỗ nào có lặp lại thì ghi khoảng.
- Thời gian tạo ảnh của model dao động nhiều giữa các lần.

## 2. Hiện trạng trước khi tối ưu

### 2.1 Luồng chạy

```
Seleya web ──POST──▶ bridge /v1/generation ──▶ RunManager.create ──▶ RunRunner
  RunRunner: copy toàn bộ skills/ + recipe vào run folder, ghi request.json, chạy CLI agent (agy/claude/codex)
  agent: đọc SKILL.md → CREATIVE.md → PROGRESS.md → request.json → … → ghi brief/concept/visual/html/result.json
         mỗi bước 1–2 lệnh printf vào progress.jsonl; mỗi file draft 1 lệnh printf nữa
  runner: thấy result.json → dừng agent → render (Chrome) → check → fail? → MỞ PHIÊN AGENT MỚI để sửa (≤2 lần)
          → publish PNG/PDF
  edit: tạo run mới, copy out/ của bản cũ, chạy LẠI skill đầy đủ với edit_instruction (phiên mới, đọc lại hết)
```

### 2.2 Số liệu từ lịch sử dùng thật (12 run, trước khi đo có kiểm soát)

| Run | Loại | Kết quả | Tổng | Startup | Agent | Sửa | Phiên | Đọc | Tool | Token in | out+think | cache |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| jki0f16a | poster | completed, check fail | 273 s | 110 s | 204 s | 0 | 1 | 8 | 37 | 167k | 32k | 888k |
| 91kib28f | poster | ✓ | 488 s | 108 s | 259 s | 200 s | 2 | 18 | 57 | 356k | 72k | 1.42M |
| 0vsr44a6 | poster | ✓ | 460 s | 97 s | 199 s | 211 s | 2 | 29 | 69 | 363k | 76k | 2.26M |
| mmx9b0f4 | slides | completed, check fail | 687 s | 70 s | 136 s | 298 s | 4 | 22 | 98 | 604k | 61k | 2.45M |
| bed5e6b8 | **edit** poster | **timed out** | 1105 s | 202 s | — | — | 1 | 11 | 21 | 116k | 39k | 409k |

Đọc từng bước trong log của một poster (0vsr44a6):

- **94 giây đầu agent chỉ đi "khám phá"**: `ls` thư mục, đọc `_media/SKILL.md`, đọc **chính `harness.log` của nó**
  (40 s suy nghĩ trên log), đọc `INDEX.md` và `orchestrator/SKILL.md` (22 s, 5k token suy nghĩ). Chưa có bước nào
  của poster.
- **Mỗi lần gọi tool tốn một lượt model khoảng 2–3 s.** 24 lệnh shell thì khoảng 15 lệnh chỉ để `printf` một dòng
  tiến độ hoặc thông báo draft.
- **Chờ ảnh bằng `sleep 5`, `echo`, `manage_subagents list` lặp 4 lần**, khoảng 26 s ngồi không.
- **Vòng sửa (1 finding) mất 206 s**: phiên mới đọc lại 15 file, 57 s suy nghĩ để hiểu lại thiết kế.
- **Edit "Sửa lại là by KappleLabs"** (chỉ đổi chữ ở footer): 200 s đọc file trước khi bắt đầu sửa, rồi timeout ở
  18 phút.
- **Slides**: 2 vòng sửa (298 s) cho một lỗi "chữ tràn slide" mà vẫn không hết.

## 3. Hướng tiếp cận của các chuyên gia (research)

| Nguồn | Ý chính | Áp dụng ở đây |
|---|---|---|
| Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Dùng giải pháp đơn giản nhất. Việc chia được thành chuỗi bước cố định thì dùng *workflow* (prompt chaining có cổng kiểm tra giữa các bước), không dùng agent tự khám phá. | Poster là chuỗi cố định brief → concept → ảnh → HTML: harness phải đưa sẵn quy trình, không để agent tự tìm hiểu. |
| Anthropic, [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | "Tập token nhỏ nhất mà giá trị cao nhất"; context càng to thì càng "mục". | Run folder chỉ chứa thứ skill cần; không để log, skill thừa, index. |
| Manus, [Context Engineering for AI Agents](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) | Tỷ lệ cache trúng là chỉ số quan trọng nhất. Giữ prefix ổn định. Giữ lỗi trong context thay vì làm lại từ đầu. | Prompt: phần quy trình (ổn định) trước, phần thay đổi theo run sau. Sửa lỗi thì nối tiếp phiên cũ. |
| Cognition, [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) | Mỗi hành động mang quyết định ngầm; tách phiên là mất các quyết định đó. | Vòng sửa và edit không mở phiên trắng. |
| Claude Code [headless](https://code.claude.com/docs/en/headless) / `agy --conversation` | `--resume <id>` mở lại phiên; `--effort` chỉnh độ suy nghĩ. | R4: sửa lỗi nối tiếp phiên. R5: edit dùng effort thấp. |
| Anthropic, [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) | Gộp nhiều lệnh gọi thành một làm giảm số lượt suy luận (−37% token trong đo của họ). | Harness tự nhận file thay vì bắt agent thông báo; gộp hai dòng tiến độ thành một lệnh. |
| Aider [edit formats](https://aider.chat/docs/more/edit-formats.html), Cursor [instant apply](https://cursor.com/blog/instant-apply) | Edit chỉ nên trả phần thay đổi, kèm đúng ngữ cảnh cần sửa. | Edit nhận sẵn HTML hiện tại và chữ trong vùng được khoanh. |
| AutoPresent, PPTAgent, LayoutGPT, PosterLlama (arXiv 2501.00912, 2501.03936, 2305.15393, 2404.00995) | Mẫu chung: layout có cấu trúc (JSON hoặc HTML) cộng template render tất định; sửa theo từng phần tử. | Slides đã theo hướng này. Poster nên đi tiếp theo hướng layout JSON + template (việc còn lại §7). |
| Huang et al. ICLR 2024 ([2310.01798](https://arxiv.org/abs/2310.01798)), Self-Refine ([2303.17651](https://arxiv.org/abs/2303.17651)) | Tự sửa không có tín hiệu ngoài thì không giúp. Có tín hiệu cụ thể thì giúp. Lỗi cơ học nên sửa bằng code. | Slides tràn chữ: Seleya tự thu nhỏ chữ trước khi nhờ agent. Vòng sửa không tiến triển thì dừng. |

## 4. Các phát hiện (audit 4 chiều)

Chi tiết và bảng điểm nằm ở [nhật ký audit](agent-harness-audits/seleya-generation-audit-log.md). Tóm tắt theo mức độ:

| # | Mức | Chiều | Phát hiện | Sửa ở |
|---|---|---|---|---|
| F1 | **Critical** | Fan-out / tài nguyên | `printToPDF` treo với ảnh PNG lớn; lệnh đóng tab trong `finally` không có hạn, nên run treo đến hết giới hạn 15 phút **dù mọi check đã pass**. Tái hiện được: PNG 2.2 MB treo hơn 5 phút, cùng trang với JPEG in xong 2.5 s. | R0 |
| F2 | High | Handoff | Mỗi vòng sửa mở **phiên agent mới**, đọc lại toàn bộ (≈200 s, 120–190k token input mỗi vòng). | R4 |
| F3 | High | Handoff / context | Edit chạy lại cả skill trong phiên mới; agent tự đi tìm thiết kế cũ, đoán vùng được khoanh. Đã gặp timeout 18 phút. | R5 |
| F4 | High | State / context | Run folder chứa mọi skill, `INDEX.md` và cả `harness.log` của agent; agent đọc chúng (≈90 s mỗi run). Đọc log của chính mình còn là rò rỉ dữ liệu. | R1 |
| F5 | Medium | Token | Agent mất 5–8 lượt đọc SKILL.md / CREATIVE.md / PROGRESS.md / request.json trước khi làm. | R2 |
| F6 | Medium | Token / latency | ≈15 lượt model chỉ để `printf` tiến độ và thông báo draft. | R3 |
| F7 | Medium | Fan-out | Agent chờ ảnh bằng cách poll `sleep`/`echo`, không làm song song layout. | R7 |
| F8 | Medium | Handoff | Vòng sửa slides lặp lại cùng một lỗi tràn chữ mà agent không sửa được; lỗi cơ học này code tự sửa được. | R6 |

## 5. Các vòng tối ưu và kết quả đo

<!-- BENCH-RESULTS -->

## 6. Quyết định

<!-- DECISIONS -->

## 7. Việc còn lại

<!-- NEXT -->
