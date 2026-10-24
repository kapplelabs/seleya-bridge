# Nhật ký tối ưu generation (đo liên tục)

Mỗi vòng ghi đủ: **giả thuyết → thay đổi duy nhất → số đo → quyết định**. Số liệu lấy từ `bench.jsonl`
(`node scripts/bench-report.ts --home <bench home>`). Không có số đo thì không ghi là "cải thiện".
Bối cảnh, cách đo và research: [generation-performance.md](generation-performance.md).

## Mục tiêu (GOAL) — đo được

Đặt ngày 2026-10-24, từ mốc tham chiếu r0. Vòng lặp chỉ dừng khi mọi dòng đạt, hoặc khi số đo cho thấy không thể
đạt thêm mà không hy sinh chất lượng (khi đó ghi lý do).

| Luồng nghiệp vụ | Mốc r0 (đo) | Mục tiêu | Chất lượng bắt buộc |
|---|---|---|---|
| Tạo poster | 269 s, 151k input, 31 tool | ≤ 150 s, ≤ 60k input | pass mọi check, điểm chấm (khi có) không giảm |
| Edit chữ trên poster | 520 s, 385k input | ≤ 60 s | đúng chữ mới, phần còn lại không đổi |
| Edit ảnh nền poster | 201 s, 118k input | ≤ 120 s | ảnh mới, chữ không đổi |
| Tạo deck 5 slide | (đang đo) | ≤ 50% mốc r0 | pass mọi check, không còn vòng sửa vô ích |
| Refine deck | (chưa đo) | ≤ 50% mốc r0 | chỉ đổi đúng phần được yêu cầu |

Model: Antigravity `gemini-3.8-flash-medium`, máy của người dùng, không chạy hai run cùng lúc.

## Vòng đã chạy

### baseline — code `main` (2026-10-24 17:2x)

- **Đo**: poster `rnxke1d6` agent xong 250 s, mọi check pass, rồi **timeout 900 s** khi xuất PDF.
- **Nguyên nhân (tái hiện được)**: `Page.printToPDF` treo với `visual.png` 2.2 MB (>5 phút); cùng trang với JPEG in
  trong 2.5 s. Lệnh đóng tab trong `finally` không có hạn, nên deadline 120 s của PDF không cứu được run.
- **Quyết định**: sửa trước mọi tối ưu tốc độ (R0); `main` không dùng làm mốc vì không ra kết quả.

### r0-pdf-fix — chỉ thêm R0

- **Thay đổi**: PDF in từ bản sao trỏ tới JPEG của các PNG lớn (`render/print.ts`); mọi lệnh CDP có hạn, Chrome
  kẹt thì khởi động lại.
- **Đo**: test riêng trên đúng poster đã treo → PDF 2.3 s. Poster `qm4dd138` pass, 269 s.
- **Quyết định**: **giữ**. Đây là mốc tham chiếu r0.
- **Phát hiện mới từ r0** (đo, chưa sửa):
  - Edit chữ `wi22dc78`: bước sửa 37 s, nhưng agent mất 111 s khởi động. Rồi check "quoted text" đòi chữ
    "Hạt Mộc Coffee Talk" của request gốc, **chính chữ người dùng vừa yêu cầu thay**. Vòng fix 352 s chen lại chữ
    cũ: tốn 68% thời gian, và có thể đi ngược ý người dùng. → R8.
  - Edit ảnh `7r5lfcbe`: 79 s khởi động, 97 s cho bước edit (chủ yếu tạo ảnh).

<!-- Các vòng tiếp theo được thêm bên dưới, theo thứ tự chạy. -->

### Phân tích điểm nghẽn từ r0 (đo từng lượt trong log agent)

| Run | Lượt model | Thời gian trong lượt model | Thời gian chạy tool | Đọc file | printf tiến độ |
|---|---|---|---|---|---|
| poster `qm4dd138` | 31 | 232 s (trung vị 3.9 s/lượt; một lượt 78 s chờ ảnh) | 5 s | 13 | 9 |
| edit chữ `wi22dc78` | 76 | 489 s | 16 s | 29 | 5 |
| edit ảnh `7r5lfcbe` | 20 | 114 s | 3 s | 10 | 3 |
| slides `c6hr22c1` | 75 | 386 s | 8 s | 5 | 14 |

**Kết luận đo được:** khoảng 95% thời gian là các lượt model, không phải tool. Thời gian ≈ số lượt × ~4 s + thời gian tạo ảnh.
Các vòng R1–R6 bớt lượt từng chút một nên chỉ có thể nhanh thêm khoảng 1.5–2 lần. Muốn ×5–×10 thì phải **bỏ vòng lặp agent**.

Ghi chú về slides r0: vòng sửa 175 s là để bỏ con số "100%" bị bịa. Check bắt đúng; chi phí nằm ở phiên agent mới.

### Đo sàn thời gian trên máy người dùng (2026-10-24 18:08–18:12)

| Phép đo | Thời gian | Token |
|---|---|---|
| 1 lần gọi `agy --print`, trả `{"ok":true}`, flash-low | 7.7 s (model 3.4 s, CLI khởi động ~4 s) | 11.4k input: prompt hệ thống cố định của agy |
| 1 lần gọi trả **trọn spec: brief + concept + image_prompt + HTML poster**, flash-low | **17.9 s** | 11.7k in, 2.0k out |
| như trên, flash-medium | 24.1 s | 11.7k in, 2.5k out, 0.8k think |
| tạo 1 ảnh 2:3 qua agy (subagent ảnh), flash-low | **66.1 s** (các lượt model ~12 s, tạo ảnh ~50 s) | 48.6k in |
| render + check bản HTML một lần gọi | 2.3–6.6 s | 0 |

**Chất lượng của HTML một lần gọi (đo bằng check của Seleya):**
- Cả bản low và medium đều qua **facts, quoted text, contrast, layout**.
- So mắt với poster r0 (agent, 269 s): bố cục và độ dễ đọc ngang nhau.
- Bản một lần gọi thêm nhãn trang trí "SPECIALTY GATHERING". Đây không phải fact nên check không bắt; cần siết prompt.
- Ảnh so sánh được xem trên máy lúc đo, không lưu trong repo.

**Hệ quả cho mục tiêu:**
- Tạo ảnh qua agy (~66 s) là sàn cho bản cuối có ảnh.
- Kiến trúc chuỗi cố định (spec ∥ ảnh → render) cho phép:
  - **bản xem trước sau ~20–25 s**, khoảng ×10 so với 269 s;
  - **bản cuối khoảng 75–85 s**, khoảng ×3.5.
- Đây là ước tính từ các sàn ở trên; phải đo sau khi xây xong.

### r1-lean-folder (R1) — poster

- **Đo**: `mkm127b1` pass, 228 s (r0: 269 s), 128k input (r0: 151k), cache 452k (r0: 810k), 26 tool (r0: 31).
- **Nhiễu**: chạy trùng 18:06–18:10 với các phép đo sàn ở trên (hai agent cùng lúc), nên thời gian có thể bị đội lên.
- **Quyết định**: giữ (token giảm rõ). Thời gian chờ lặp lại để xác nhận.

### Hướng mới: E4 "pipeline" (đang xây)

Giả thuyết: một recipe khai báo `pipeline: spec` chạy chuỗi cố định, không có vòng lặp agent:

1. một lần gọi ra spec, với `image_prompt` đứng đầu JSON để bắt đầu tạo ảnh ngay khi đọc được;
2. tạo ảnh song song;
3. ghi brief, concept, HTML và render bản xem trước trên nền màu;
4. ảnh về thì render bản cuối và check;
5. nếu fail thì sửa bằng một lần gọi.

Biến thay đổi: kiến trúc (agent loop → pipeline), cùng model flash-low. Đo bằng cùng bench-drive.

### r2-procedure-in-prompt (R2) — poster

- **Đo**: `rk0qa50e` pass. Thời gian khởi động **24 s** (r0 79 s, r1 59 s), nhưng tổng 314 s và agent 278 s.
  Input 132k, 30 tool.
- **Nhiễu**: chạy trùng 18:10–18:15 với phép đo tạo ảnh (hai agent cùng lúc), nên tổng thời gian không đáng tin.
- **Đọc số liệu**: R2 xoá được phần khám phá ban đầu như mục tiêu, nhưng số lượt vẫn ~30, nên tổng gần như không đổi.
  Điều này xác nhận đo ở trên: tối ưu từng lượt không đủ để đạt ×5.

### Dừng suite tối ưu từng vòng (18:19)

Suite R1–R8 bị dừng để đo pipeline trên máy không chạy agent nào khác. Run r3 `mvmaydtm61d0` bị bỏ dở, không tính.
R3–R8 sẽ chạy lại sau để đo phần agent-loop, vẫn dùng cho orchestrator, custom design và fallback.

### p1-pipeline (E4) — code `perf` + catalog v4 (poster có `SPEC.md`, `pipeline: spec`, `effort: low`)

Bộ đo: tạo poster ×3, edit chữ ×1, edit ảnh ×1. Chạy 18:20, không có agent nào khác chạy cùng.

**Kết quả đo p1 (18:19–18:25):**

| Run | Luồng | Kết quả | Tổng | Có bản xem trước sau | Spec | Ảnh | Sửa | Input token | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|
| `321baf99` | tạo poster | pass, có ảnh | **123 s** (r0 269 s, **×2.2**) | **47 s** (r0 269 s, **×5.7**) | 42 s | 95 s (song song) | 13.5 s (1 lần gọi sửa contrast) | 132k (r0 151k), cache 0 (r0 810k) | |
| `5rnad59d` | edit chữ | pass | **14 s** (r0 520 s, **×37**) | — | 7 s | — | — | **14k** (r0 385k, **−96%**) | HTML chỉ khác đúng tiêu đề (và `<title>`), đã diff |
| `65s1aa4f` | edit ảnh | **fail** | 127 s | — | 3.7 s | 119 s | — | 93k | **Hạ tầng**: tạo ảnh trả HTTP 429 RESOURCE_EXHAUSTED (Antigravity, rồi Agent Fabric) |
| `8zz61cb9` | tạo poster | **không tính** | 103 s | — | 15.9 s | 92 s, fail 429 | — | 108k | Không có ảnh do hết quota: không so được với r0 |

Đọc số liệu:

- **Bản xem trước** (trang render trên nền màu, trước khi ảnh về) xuất hiện sau 47 s. Người dùng thấy thiết kế sớm gấp 5.7 lần.
- **Spec dao động 16–42 s.** Lần 42 s chạy cùng lúc với agent tạo ảnh; đo sàn khi chạy riêng là 18 s.
- **Tạo ảnh 92–95 s là điểm nghẽn còn lại:**
  - agent ảnh đọc `_media/SKILL.md` và file jobs (~5 lượt);
  - có một lượt 38 s;
  - chạy model medium;
  - riêng bước tạo ảnh ~50 s.
- **Token:** spec 14k và sửa 27k là nhỏ. Agent ảnh chiếm ~90k trên 132k.
- **Sửa contrast trong 13.5 s** (r0: một vòng sửa ~200–350 s).
- **Chất lượng:**
  - pass mọi check;
  - model vẫn tự thêm nhãn "Specialty Coffee Event" và nhãn song ngữ "Thời gian / Time" dù prompt cấm. Check facts không bắt loại này → việc tiếp theo ở phần chất lượng.

**Quyết định p1:** **giữ pipeline cho poster.** Edit chữ đạt mục tiêu (≤ 60 s). Tạo poster chưa đạt (123 s so với mục tiêu ≤ 150 s là đạt về thời gian, nhưng input 132k > 60k) → p2.

**Sửa thêm:**
- Edit ảnh không có ảnh mới giờ báo đúng lý do ("no new picture could be made: 429 …") thay cho "changed nothing".
- bench-drive: poster và edit ảnh chỉ pass khi có ảnh (áp dụng từ đây; `8zz61cb9` ghi tay là không tính).

### Dừng đo ảnh (18:26) — hết quota tạo ảnh

- Quota tạo ảnh của Antigravity (và Agent Fabric) trả 429. Mọi phép đo có ảnh lúc này đều không so được, nên đã dừng p1 và p2 (p2 chưa chạy run nào).
- Mỗi poster có ảnh tốn 1 lượt quota ảnh. Bộ đo đầy đủ cần khoảng 10–15 ảnh.

### p3-slides-pipeline — slides bằng pipeline (catalog v5: slides có `SPEC.md`, `pipeline: spec`, `effort: low`)

- **Thay đổi**: một câu trả lời trọn deck JSON. Mỗi slide hiện ra ngay khi đã đầy đủ trong câu trả lời đang stream. Ảnh gửi cho media agent; theme của Seleya render; sửa lỗi bằng một lần gọi.
- **Đo** (18:28–18:36). Quota ảnh vẫn hết (429) nên media fail, deck dùng artwork của theme. Thời gian **không tính media** được so với phần không-media của r0 (482 − 95 = 387 s):

| Run | Luồng | Viết deck | Sửa | Render | Tổng không tính media | r0 tương ứng | Input token (không tính agent ảnh) | Check |
|---|---|---|---|---|---|---|---|---|
| `fhzhb7a2` | deck 5 slide | **15 s** | 0 | 10 s | **25 s** | 387 s (**×15**) | ~12k (r0 396k) | mọi check nội dung pass; media fail 429 |
| `hzup0d4d` | refine "ít chữ hơn" | **11 s** | 0 | 10 s | **21 s** | (chưa đo r0) | ~11k | pass; media fail 429 |
| `kyoi0182` | deck 5 slide | 13 s | **12 s** (bỏ "100%" bịa) | 19 s | 44 s | 387 s (**×8.8**) | ~25k | pass sau sửa; media fail 429 |

- **Chất lượng**: theme ember đúng chủ đề quán cà phê; layout cover, image-left, stats, cards, closing đúng luật đa dạng. Model vẫn bịa con số "100%" ở 1/3 run (r0 cũng bịa đúng số này); check bắt được và sửa trong 12 s.
- **Media**: mỗi run tốn 87–166 s để media agent thử rồi nhận 429. Đây là thời gian lãng phí do hết quota, không tính.
- **Quyết định**: **giữ pipeline cho slides**. Phần chữ đạt ×9–×15. Thời gian tổng có ảnh chưa đo được (cần quota).

### Tổng kết đến 18:36 (chỉ số đo được)

| Luồng | r0 (agent loop) | Pipeline | Tăng tốc | Ghi chú |
|---|---|---|---|---|
| Edit chữ poster | 520 s, 385k token | **14 s, 14k token** | **×37**, −96% token | đạt mục tiêu ≤ 60 s |
| Poster: bản xem trước | 269 s | **47 s** | **×5.7** | |
| Poster: bản cuối có ảnh | 269 s | **123 s** (1 run hợp lệ) | ×2.2 | ảnh 95 s là sàn |
| Deck 5 slide: phần chữ, render, sửa | 387 s | **25–44 s** | **×9–×15** | ảnh chưa đo được |
| Refine deck: phần chữ | — | **21 s** | — | |

**Điểm nghẽn còn lại: tạo ảnh**, ~50 s mỗi ảnh trong agent ảnh của Antigravity, cộng các lượt đọc file của agent đó.
Hướng tiếp theo (cần quota ảnh để đo):
- p2: đưa sẵn job vào prompt của agent ảnh (đã code xong);
- p4: chạy các job ảnh song song (mỗi ảnh một agent);
- p5: hoàn tất deck ngay với artwork theme, gắn ảnh khi về.

### Sự cố "Chrome did not start its DevTools endpoint" (2026-10-24 19:2x)

**Nguyên nhân (tái hiện được):**
- Khi bridge bị dừng (restart bằng `kill`), Chrome nó đã chạy không tắt theo. Tiến trình đó thành mồ côi (cha là `launchd`) và vẫn giữ `SingletonLock` của profile dùng chung `generation/chrome`.
- Chrome của bridge mới thấy profile bị khoá nên in "Failed to create a ProcessSingleton … Aborting" rồi thoát.
- Bridge chờ 10 s không thấy `DevToolsActivePort` và làm fail run.

**Sửa theo lớp:**

| Lớp | Thay đổi |
|---|---|
| Phòng | Mỗi tiến trình bridge một profile riêng (`chrome/<pid>`). Khi khởi động, dọn profile của bridge đã chết (kill Chrome mồ côi chỉ khi nó chạy đúng profile đó; xoá lock cũ, kể cả của profile dùng chung đời cũ). Chrome bị kill khi bridge thoát theo bất kỳ đường nào (`process.on("exit")`). |
| Hồi phục | Chrome không lên thì thử lại với profile mới. Báo kèm dòng lỗi của Chrome. Chrome treo giữa chừng thì khởi động lại (đã có từ R0). |
| Engine khác | Thử lần lượt Chrome, Chromium, Edge, Brave (macOS, Linux, Windows). |
| Fallback | Không render được (`RenderError`) thì run không fail. |

Chi tiết lớp fallback:
- **Poster** được giao dưới dạng trang web `*.preview.html` có ảnh nhúng sẵn; Studio hiển thị trong iframe không chạy script. Check facts và trích dẫn chạy trên chữ của HTML, kèm finding "Not rendered on this computer …". Run ở trạng thái `completed_with_issues`.
- **Slides** được giao dưới dạng nội dung deck; Writing hiển thị từ JSON.
- **PDF** in lỗi thì bỏ PDF, vẫn giữ PNG.

**Kiểm chứng:**
- Test mới `render.test.ts` dựng một Chrome mồ côi giữ (a) profile dùng chung đời cũ và (b) profile của một bridge đã chết. Render đều thành công trong 2.6–2.9 s và Chrome mồ côi bị dừng.
- Trên thư mục thật `/tmp/seleya-bridge-live/generation/chrome` có lock cũ: render OK 3.8 s, lock được dọn, 0 Chrome mồ côi.
- Stop bridge giờ không còn để lại Chrome.
- Test fallback: renderer luôn lỗi thì vẫn ra `poster.preview.html` có ảnh dạng data URL, check facts và trích dẫn pass, check rendering fail.
- 222 test pass.

### p6 — không có ảnh thì agent thiết kế vẽ SVG; dùng MCP tạo ảnh của người dùng (2026-10-24 19:4x)

**Nguyên tắc:** agent chữ nào cũng viết được code; tạo ảnh thì tuỳ agent và quota. Thứ tự lấy ảnh:
1. **Agent có năng lực tạo ảnh**, theo thứ tự:
   - mặc định theo agent (Antigravity, Codex);
   - `capabilities.json`;
   - worker của Agent Fabric;
   - **MCP tạo ảnh người dùng đã cài cho Claude Code**: tự nhận theo tên hoặc lệnh (image, imagen, dall-e, flux, fal, replicate, stability, ideogram, midjourney, recraft, nano-banana…), hoặc khai báo `{"mcp": {"<server>": ["image"]}}`.
   Chỉ job ảnh mới được bật đúng các server đó (`--mcp-config` + `--strict-mcp-config`, cho phép `mcp__<server>` và `curl` để tải ảnh trả về dạng link). Mọi lần chạy khác của Claude Code vẫn cách ly.
2. **Không agent nào làm được** (hết quota, không có agent ảnh, agent lỗi): chính agent đã thiết kế vẽ ảnh dạng **SVG**, tiếp tục cùng cuộc hội thoại nên biết bố cục và palette. SVG được làm sạch: chỉ giữ `<svg>`, bỏ `<script>`, `<foreignObject>`, `on*=`, link ra ngoài, giới hạn 400 KB. Các trang chuyển sang `url('visual.svg')`, rồi render và check lại. Kết quả có check "picture" (passed) ghi "Drawn as artwork: …".
3. Vẽ cũng không được: kết quả báo "Completed with issues — No picture was made (…)".

**Đo thật** (`aasr6b62`, poster Hạt Mộc, quota ảnh vẫn 429):

| Mốc | Thời gian |
|---|---|
| Sẵn sàng (thiết kế trên nền màu) | **24 s** |
| Agent ảnh thử rồi nhận 429 | 91 s |
| Vẽ SVG (cùng hội thoại) | 29 s |
| Bản cuối có hình, mọi check pass | 132 s |

- **Chất lượng:** SVG 6.7 KB vẽ cửa sổ, tách cà phê bốc khói, lá cây, đúng palette nâu gỗ và xanh lá; chữ dễ đọc; facts, contrast và layout đều pass.
- **Chưa đo được:** MCP tạo ảnh thật, vì máy chưa cài MCP nào như vậy (chỉ có codebase-memory, agent-room, murmur, agent-fabric-peer, stitch). Đã có test cho phần nhận diện và cho việc chỉ job ảnh mới được dùng server đó.
- **Hướng tối ưu tiếp:** khi biết chắc không có agent ảnh nào (ví dụ không agent nào khai báo năng lực ảnh), vẽ SVG ngay thay vì chờ 91 s thử thất bại. Cần quyết định về độ tin của tín hiệu 429 (quota thường hồi trong vài giờ).

225 test pass.

### Bug: Studio hiển thị bản xem trước thay cho bản cuối (2026-10-24 20:0x)

- **Triệu chứng:** người dùng thấy poster không có hình, dù bridge đã vẽ SVG và render lại (`run_063210_mvmfmwute1dd`, PNG cuối trên máy có hình).
- **Nguyên nhân:**
  - Khi run hoàn tất, các draft không được post-processor liệt kê lại vẫn được chuyển thành output "final".
  - Bản xem trước `out/poster.draft.png` (mới có từ pipeline) đứng trước `out/poster.png`.
  - `generationJson` lấy PNG đầu tiên, nên chọn nhầm bản xem trước.
- **Sửa:**
  - Bản xem trước `*.draft.*` không bao giờ thành output.
  - `generationJson` bỏ qua `*.draft.*` (sửa luôn cho các run cũ đã lưu).
  - Test: "Studio shows a design's final picture, never its preview".
- **Kiểm chứng:** tải lại Studio thì cùng run hiển thị `out/poster.png` có hình vẽ. 226 test pass.

### Mọi usecase chuyển sang pipeline; skill viết lại theo research thiết kế (2026-10-24 21:xx)

**Chuyển sang pipeline:** flyer, ad creative, social, business card, menu, logo, custom design (cùng poster và slides từ trước).
- Engine bổ sung:
  - `vector` (logo: SVG được làm sạch, lưu thành `logo.svg`, edit được);
  - `definition` (custom: kích thước và trang lấy từ định nghĩa, kể cả định nghĩa do người dùng sửa);
  - kích thước riêng cho từng trang;
  - usecase không có ảnh thì không hiện bước "Making the picture" (custom chọn không ảnh thì bước đó đánh dấu "No picture for this design").

**Đo** (dừng sớm theo yêu cầu, chênh lệch đã rõ):

| Logo "Mây Tea" | Kết quả |
|---|---|
| Pipeline | 44 s, mọi check pass |
| Agent loop | > 754 s chưa xong; 2 vòng sửa |

**Skill viết lại theo research** (`seleya/catalog/DESIGN-GUIDELINES.md`, có nguồn: Google Ads, LinkedIn, Meta, WCAG, NN/g, Butterick, COLE, arXiv 2410.08885):
- `CREATIVE-SPEC.md`:
  - `concept.plan` (archetype, grid, scale, focal, reading_order) trước HTML;
  - một điểm nhấn ≥ 3× chữ thường, ≤ 4 cỡ chữ, lề 5–8%, 30–40% khoảng trống;
  - quy tắc dấu tiếng Việt (line-height), 11 font đã xác nhận có bộ tiếng Việt với Google Fonts (Bebas Neue không có);
  - 60-30-10; danh sách dấu hiệu "AI-generic" bị cấm;
  - chữ theo ngôn ngữ của request; cho phép nhãn chức năng ngắn, cấm bịa slogan hoặc thông tin;
  - logo của brand kit không có trong run nên hiển thị tên thương hiệu bằng chữ.
- Mỗi `SPEC.md` có: thứ bậc thông tin, cỡ chữ theo px, 2–3 archetype, must-have, lỗi cấm. Ví dụ:
  - ad: đúng 1 CTA, safe zone story 14/35/6%;
  - menu: giá căn cột tabular, không dấu chấm dẫn;
  - logo: chạy được ở 32 px và một màu;
  - slides: tiêu đề nêu ý chính, ≤ 40 chữ/slide.

**Soát cuối (tự động trên catalog đã ký):**
- 9/9 recipe có cờ `pipeline`, `effort: low`, `SPEC.md`; tên trang và kích thước khớp `recipe.json`; không sót hướng dẫn agent loop.
- Prompt ghép 4–8.6k ký tự mỗi usecase.
- Đọc toàn văn prompt flyer, sửa 5 chỗ: luật chữ mâu thuẫn, thiếu luật ngôn ngữ, logo brand kit, phạm vi luật `<img>`, bước ảnh treo.
- Edit logo áp dụng lên SVG (có test).
- Studio: thời gian ước tính theo pipeline ("Each design is ready in about 25–45 s…"); `typical_ms` của từng recipe cập nhật (poster, logo, slides theo số đo; các usecase khác ước tính, bridge tự hiệu chỉnh theo lịch sử).

**Còn lại:**
- Orchestrator (yêu cầu câu tự do) vẫn chạy agent loop, nhưng giao diện hiện không dùng đường này.
- Chất lượng skill mới chưa được chấm A/B có số đo (dừng benchmark theo yêu cầu).

227 test pass.
