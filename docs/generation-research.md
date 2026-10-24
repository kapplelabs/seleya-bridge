# Research: làm generation nhanh hơn, rẻ hơn, đẹp hơn

Ngày: 2026-10-24 · Dùng cho: [generation-perf-log.md](generation-perf-log.md) (mỗi hướng ở đây thành một vòng đo).
**[M]** = kết quả có đo trong nguồn · **[C]** = hướng dẫn của vendor hoặc tuyên bố chưa có phương pháp công bố.

## 1. Load skill và format skill

| Nguồn | Điểm chính | Ý nghĩa với Seleya |
|---|---|---|
| [C] [Anthropic skill best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Body SKILL.md < 500 dòng; reference một tầng; checklist; vòng validate → sửa; bước tất định nên là script (chỉ output tốn token); "plan → validate → execute" bằng JSON trung gian; tránh đưa nhiều lựa chọn. | Quy trình 6 KB nhỏ, inline được (R2). Đòn bẩy lớn hơn là chuyển phần tất định sang code. |
| [C] [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3) | "Be concise", Gemini 3 dễ phân tích quá mức với prompt dài, phức tạp; đặt chỉ dẫn **cuối**, sau dữ liệu; giữ temperature 1.0. | Prompt nên gọn; phần thay đổi theo run (request) để cuối. |
| [C] [Gemini prompting strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) | Luôn có few-shot; format ví dụ giống hệt nhau; XML hay Markdown đều được nếu nhất quán. | Thêm một ví dụ mẫu brief → concept → spec. |
| [M] [Lost in the Middle](https://arxiv.org/abs/2307.03172) | Thông tin ở đầu hoặc cuối context được dùng tốt nhất. | Luật quan trọng (facts, contrast) ở đầu hoặc cuối, không vùi giữa. |
| [M] [Prompt format effects](https://arxiv.org/abs/2411.10541) | Đổi template (plain/Markdown/JSON/YAML) làm GPT-3.5 lệch đến 40%; GPT-4 ổn định hơn. | Model Flash có thể nhạy với format: phải đo, không đoán. |

## 2. Structured output thay cho vòng lặp agent

- [C] Cả ba CLI đều có schema:
  - `agy --json-schema` (kiểm tra bằng `agy --help` trên máy);
  - `claude --json-schema` ([docs](https://code.claude.com/docs/en/cli-reference.md));
  - `codex exec --output-schema` ([docs](https://developers.openai.com/codex/noninteractive)).
- [M] [Let Me Speak Freely?](https://arxiv.org/abs/2408.02442): ép JSON làm giảm khả năng suy luận; phân loại thì không bị ảnh hưởng. Cách tốt: để model nghĩ tự do rồi mới xuất schema (field `rationale` đặt đầu schema).
- [M] [AutoPresent / SlidesBench](https://arxiv.org/abs/2501.00912):
  - sinh chương trình tốt hơn sinh ảnh trực tiếp;
  - thư viện cấp cao cắt chương trình từ ~170 dòng còn 13 dòng và tăng điểm;
  - vòng tự sửa đầu tiên mang lại nhiều nhất.
- [M] [LayoutGPT](https://arxiv.org/abs/2305.15393): layout dạng CSS-like kèm ví dụ hơn text-to-image 20–40% về độ đúng vị trí và số lượng.
- [C] [PosterLlama](https://arxiv.org/abs/2404.00995) (layout là HTML), [Graphist](https://arxiv.org/abs/2404.14368) (JSON draft protocol từng phần tử).
- [C] [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): việc phân rã cố định thì dùng prompt chaining; evaluator–optimizer khi tiêu chí rõ.

## 3. Pipeline thiết kế tách bước

- [M/C] [COLE](https://arxiv.org/abs/2311.16974):
  - các bước: ý định → JSON plan → ảnh nền và vật thể → typography (~15 thuộc tính mỗi khối chữ) → renderer tất định;
  - khoảng một lần gọi mỗi bước, không có vòng lặp agent;
  - GPT-4V chấm tốt layout và nội dung nhưng **kém về typography và màu**.
- [M] [OpenCOLE](https://arxiv.org/abs/2406.08232): GPT-3.5 viết plan trong một lần gọi, rồi tạo ảnh, typography và render; đạt ngang COLE.
- [M] [PosterAgent / Paper2Poster](https://arxiv.org/abs/2505.21497):
  - Parser → Planner (layout cây) → Painter–Commenter (VLM sửa tràn và căn lề trên bản render);
  - bản Qwen-2.5 thắng hệ multi-agent GPT-4o với **ít hơn 87% token**.
- [M] [PPTAgent](https://arxiv.org/abs/2501.03936): phân tích slide mẫu → outline → thao tác edit trên slide mẫu; PPTEval 3.67/5.

## 4. Chấm chất lượng tự động

- [M] PPTEval: GPT-4o chấm 1–5 theo Content, Design, Coherence; tương quan Pearson 0.71 với người chấm.
- [M] [Can GPTs evaluate graphic design](https://arxiv.org/abs/2410.08885):
  - GPT-4o tương quan với người tốt hơn các thước đo heuristic;
  - không thấy lỗi nhỏ, điểm dao động giữa các lần, nên lấy trung vị nhiều mẫu.
- **Rubric áp dụng cho Seleya:**
  - **Cổng cứng, chấm bằng code** (VLM yếu phần này): tràn chữ, tiêu đề bị ngắt dòng, contrast < 4.5:1, thiếu fact, ảnh hỏng. Đây là các check đang có.
  - **VLM chấm 1–5:**
    - layout và thứ bậc;
    - đúng brief;
    - typography và màu;
    - ảnh có hợp không, có chừa chỗ cho chữ không;
    - độ mới so với template;
    - riêng slides: mạch lạc giữa các slide.
  - **Cách chấm:** JSON output, lấy trung vị 3 lần, judge khác model sinh; so A/B từng cặp thay vì điểm tuyệt đối.

## 5. Gemini: cache và mức suy nghĩ

- [C] [Implicit caching](https://ai.google.dev/gemini-api/docs/caching): bật mặc định; ngưỡng tối thiểu 4,096 token với 3.x Flash; prefix đặt đầu và ổn định thì mới trúng cache.
- Với Seleya:
  - Khoảng 800k cache read trên 150k input mới nghĩa là mỗi lượt trong ~31 lượt gửi lại toàn bộ context đang lớn dần.
  - **Bớt lượt thì token và thời gian giảm gần tuyến tính.** Đây là suy luận; cần đo để xác nhận.
- [C] Thinking level của Gemini 3 Flash: minimal / low / medium / high, **mặc định high**. `agy --effort` là núm chỉnh; chưa xác nhận nó ánh xạ thế nào sang `thinking_level`, phải đo.

## 6. Edit nhanh

- [C] [Aider edit formats](https://aider.chat/docs/more/edit-formats.html): trả cả file thì chậm và tốn; dùng khối search/replace.
- [C] Predicted Outputs: chỉ có ở OpenAI; Gemini không có tương đương.
- Hướng cho Seleya:
  - mỗi phần tử có `data-id` cố định;
  - router rẻ (Flash, ít suy nghĩ, enum `text_only | style | layout | image_regen`);
  - `text_only` thay thế tất định rồi render lại, không cần agent;
  - chỉ `image_regen` và `layout` mới gọi agent.

## 7. Thí nghiệm xếp theo đòn bẩy (mỗi cái là một vòng đo)

| # | Giả thuyết | Biến duy nhất | Đo |
|---|---|---|---|
| E1 | Mức suy nghĩ cao (mặc định) lãng phí cho các bước theo template | `--effort` cho lần tạo | thời gian, out+think token, pass rate |
| E2 | Poster dạng spec JSON + renderer của Seleya (như slides) bớt lượt và bớt lỗi check | đích output: HTML tự do → spec | tool, thời gian, token, pass rate, A/B VLM |
| E3 | Phần lớn edit là đổi chữ, không cần agent | router + thay chữ tất định | thời gian edit, đúng/sai định tuyến |
| E4 | Chuỗi cố định 2 lần gọi (plan, rồi ảnh ∥ layout) thay cho vòng lặp agent | kiến trúc | thời gian, token, rubric |
| E5 | Một ví dụ mẫu và prefix ổn định ≥ 4k token tăng cache và tỷ lệ đúng ngay lần đầu | cách sắp prompt | tỷ lệ cache, tỷ lệ pass lần đầu |
