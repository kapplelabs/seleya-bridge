# Spec: seleya-bridge thành gateway tới AI provider

Trạng thái: **Draft / đề xuất, bản 3** · Ngày: 2026-10-24 · Liên quan: [codex-backend.md](codex-backend.md)

Bản 3: bridge và Seleya **chưa phát hành phiên bản nào**, nên API mới **thay thế thẳng** API hiện tại.
Không có giai đoạn chạy song song, không có lớp tương thích.

Mục tiêu: bridge chỉ là **cổng nối** giữa Seleya (browser/app) và các AI provider chạy trên máy người dùng
(Claude Code, Codex, sau này Gemini…). Bridge **không chứa logic nghiệp vụ**: prompt, schema kết quả, hậu
xử lý và chữ hiển thị nằm ở Seleya. Thêm hay sửa một tính năng của Seleya **không cần phát hành bridge**.

Bridge vẫn giữ những gì là **bảo đảm an toàn** cho người dùng, vì chỉ có thể thực thi trên máy họ:

- **Cách ly:** không nạp cấu hình, hook, skill hay MCP server cá nhân.
- **Connector chỉ đọc:** tool ghi không tồn tại với model.
- **Quyền sở hữu:** một trình duyệt đã pair chỉ đọc, huỷ hay tiếp tục được run và hội thoại của chính nó.
- **Che dữ liệu nhạy cảm (redact)** trước khi model đọc và trước khi trả về web (best-effort, §8.2).
- **Giới hạn** do người dùng đặt trong config (connector, tool, model, số turn).
- **Một run mỗi lúc.**

---

## 1. Bối cảnh

### 1.1 Vấn đề

`src/` có khoảng 3.200 dòng. Khoảng một phần tư là nghiệp vụ của Seleya (`briefing.ts`, `calendar.ts`,
`mail.ts` và các endpoint của chúng). Ngoài ra, adapter Claude còn trộn lẫn với chi tiết giao diện của Seleya:

| Loại | Ở đâu | Ví dụ |
|---|---|---|
| Endpoint theo tính năng | `server.ts` | `/v1/briefings`, `/v1/calendar/weeks`, `/v1/mail/triage`, cùng thông báo lỗi "Gmail isn't connected…" |
| Prompt | `briefing.ts`, `calendar.ts`, `mail.ts`, `claude.ts` | JQL và tên tool `searchJiraIssuesUsingJql`, luật triage mail, cách đọc lịch từng ngày, "You are Seleya's assistant" |
| Schema kết quả | cùng các file trên | `briefingOutput`, `weekOutput`, `mailOutput` (zod) |
| Hậu xử lý / luật sản phẩm | cùng các file trên | `TONES`, `withIds`, kiểm tra link Jira, `GMAIL_THREAD_ID`, khoảng tuần −4…+8, `unreadableDays` ⇒ lỗi |
| Chữ hiển thị | `report.ts`, `claude.ts`, `server.ts` | "Planning what to read…", "Drafting replies", `describeTool`, `CONNECTOR_DETAIL_FIELDS`, "Used N tools", `titleFrom` |
| Hợp đồng sự kiện gắn UI | `claude.ts`, `report.ts` | Hai hợp đồng khác nhau: `seleya.message.*` (chat) và `seleya.run.*` / `seleya.thought.*` (report), mang hình dạng message của UI (`blocks`, `trace`, `agentIds`, `assistantMessageId`) |

Hệ quả:

1. Sửa một câu prompt, thêm một field vào briefing hay đổi một nhãn đều phải phát hành bridge, và người dùng
   phải cập nhật app.
2. [codex-backend.md](codex-backend.md) định port cả ba tính năng sang Codex. Số chỗ phải sửa sẽ là
   **N tính năng × M provider**, và bridge phải phát hành mỗi khi N hoặc M thay đổi.
3. Prompt vốn đã phụ thuộc provider (tên tool connector của claude.ai khác của ChatGPT apps). Để prompt ở
   bridge thì mỗi lần chỉnh cho một provider lại phải phát hành.

### 1.2 Mục tiêu

- Một API chạy agent **tổng quát** (`POST /v1/runs`), nhận prompt, system prompt, output schema, danh sách
  connector và giới hạn từ Seleya.
- Một **hợp đồng sự kiện trung lập với provider**, không mang khái niệm UI của Seleya.
- `GET /v1/capabilities` để Seleya biết bridge hỗ trợ gì.
- Quy tắc phiên bản (§9) để **sau bản phát hành đầu tiên**, Seleya mới chạy được với bridge cũ.

### 1.3 Ngoài phạm vi

- Luồng approval và tool ghi (gửi mail, tạo issue…). API được thiết kế để thêm sau mà không phá vỡ (§9).
- Chạy nhiều run song song.
- Proxy thô (chuyển nguyên message của SDK lên web). Lý do ở §3.2.
- Phần provider Codex: theo [codex-backend.md](codex-backend.md); spec này chỉ đổi cách nó cắm vào (§13).

---

## 2. Hiện trạng: thứ gì đi đâu

| Thành phần hiện tại | Sau refactor | Ghi chú |
|---|---|---|
| `http.ts`, `sse.ts`, `tickets.ts`, `security.ts`, `pairing.ts`, `case.ts` | **Giữ** | Hạ tầng thuần |
| `sessions.ts` (ai sở hữu hội thoại nào) | **Giữ**, thêm `provider` cho mỗi session | §5.2 |
| `runs.ts` (`Run`, `RunRegistry`, `ownerId`, replay, một run mỗi lúc) | **Giữ**; `result` thành `output`; bỏ `assistantMessageId` | |
| `config.ts` | **Giữ**, thêm `defaultProvider`, `models`, `limits` | §8.3 |
| `connectors.ts`: discovery, chia tool đọc / ghi, `onlyConnectors`, `SELEYA_IDS` | **Giữ** (thành một phần adapter Claude) | Bảng id giữ nguyên để tên tool ổn định (§11.3) |
| `redact.ts`, `PRIVACY_RULES` | **Giữ**; redact cả **key** của object (§6.5) | Lớp chính sách |
| `claude.ts`: `isolatedOptions`, `denyUnapproved`, `redactConnectorOutput`, `resultFailure` | **Giữ** trong adapter Claude | |
| `claude.ts`: stream chữ theo dòng đã redact (`appendText`, `send`, `flush`) | **Giữ**, chuyển vào engine, dùng cho mọi run | §6.5 |
| `report.ts`: `ReportMapper` (thought theo khối, đếm nguồn, lỗi connector) | **Giữ phần tổng quát** trong engine | |
| `claude.ts`: phần dựng `seleya.*` của `AnswerMapper`, `describeTool`, `CONNECTOR_DETAIL_FIELDS`, `systemPrompt()` "Seleya's assistant"; `server.ts`: `titleFrom`; `report.ts`: nhãn phase, chữ của `unreadMessage` | **Chuyển lên Seleya**, xoá khỏi bridge | |
| `briefing.ts`, `calendar.ts`, `mail.ts` | **Chuyển lên Seleya**, xoá khỏi bridge | |
| `/v1/briefings`, `/v1/calendar/weeks`, `/v1/mail/triage`, `/v1/runs/:id/result` | **Xoá** | Thay bằng `/v1/runs` và `/v1/runs/:id` |

---

## 3. Nguyên tắc ranh giới

### 3.1 Bridge giữ bảo đảm, Seleya giữ sản phẩm

> Một thứ ở lại bridge khi và chỉ khi: (a) nó là bảo đảm an toàn mà người dùng phải tin được kể cả khi web
> gửi request bất kỳ, hoặc (b) nó phụ thuộc provider và web không nên biết.

| Ở bridge | Ở Seleya |
|---|---|
| Pairing, kiểm tra origin và host, bind loopback | Prompt, system prompt của từng tính năng |
| Quyền sở hữu run và session theo trình duyệt đã pair | Output schema và validate (zod) |
| Cách ly provider (không nạp settings cá nhân) | Hậu xử lý: id, màu, lọc link, luật như "ngày không đọc được ⇒ lỗi" |
| Connector chỉ đọc; danh sách connector, tool, model được phép | Validate input của tính năng (khoảng tuần, số ngày mail) |
| Redact kết quả connector trước model; redact chữ, thought, input tool, lỗi và output trước khi trả web | Nhãn, tiêu đề, chữ lỗi, icon và tên hiển thị của connector |
| Phần mở đầu system prompt bắt buộc (chính sách, ngày giờ) | Chọn connector, tool, giới hạn **trong** trần của bridge |
| Trần giới hạn (turn, token output tool, kích thước request) | Ghép sự kiện thành message / trace / phase của UI |
| Adapter từng provider; chuẩn hoá sự kiện và mã lỗi | Tiêu đề hội thoại, id message của UI |
| Một run mỗi lúc, huỷ, giữ sự kiện để replay | |

### 3.2 Gateway có lớp chuẩn hoá, không phải proxy thô

Chuyển nguyên `SDKMessage` của Claude (hay JSON-RPC của Codex) lên web nghe đơn giản hơn, nhưng:

- Web phải hiểu từng protocol của từng provider. Sự phụ thuộc chỉ chuyển từ bridge sang web, và mỗi lần
  SDK đổi format thì web gãy.
- Redact phải chạy **trên máy người dùng, trước khi dữ liệu rời bridge**. Một proxy thô không làm được.
- Cách ly và allowlist tool phải do bridge áp đặt; web không được gửi `options` tuỳ ý của SDK.

Nên bridge dịch mọi provider về **một** luồng sự kiện nhỏ (§6), và chỉ nhận **một tập tham số chung** (§5.2).

---

## 4. Kiến trúc

```
Seleya web ──HTTPS/SSE──▶ API ──▶ Policy ──▶ Engine ──▶ ProviderAdapter ──┬─▶ ClaudeAdapter ─Agent SDK─▶ claude
  (task: prompt,          (zod)   (owner,    (redact,    (interface)        └─▶ CodexAdapter ─JSON-RPC──▶ codex app-server
   schema, finish,                 caps,      stream
   adapter sự kiện → UI)           preamble,  theo dòng)
                                   allowlist)    │
                                                 ▼
                                            Run.events ──▶ SSE
```

- **Policy:** kiểm tra request so với config, capabilities và quyền sở hữu session; ghép system prompt; thu
  hẹp connector và tool. Chạy **đồng bộ** từ lúc kiểm tra `busy` tới `runs.create` (§8.4).
- **Engine:** một vòng chạy duy nhất cho mọi run (thay `runClaude` và `runReport`). Đọc `AgentEvent` từ
  adapter; stream chữ theo dòng đã redact; gom thinking theo khối; theo dõi tool, nguồn, lỗi connector; redact
  output; ghi sự kiện (§6) vào `Run.events`.
- **ProviderAdapter:** nhận một `RunSpec` chung (§10.2).

---

## 5. API

Mọi JSON trên dây là snake_case như hiện nay. Pairing (`/v1/pair/*`) và `GET /v1/health` **giữ nguyên**. Mọi
endpoint dưới đây đòi `Authorization: Bearer <token>`, trừ `stream` (dùng ticket, tối đa 5 lần mở như hiện
nay).

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/v1/capabilities` | Bridge hỗ trợ gì |
| `POST` | `/v1/runs` | Bắt đầu một run (thay cả chat lẫn ba endpoint report) |
| `GET` | `/v1/runs/:id` | Trạng thái và kết quả của run (thay `/result`) |
| `POST` | `/v1/runs/:id/tickets` | Ticket stream mới |
| `POST` | `/v1/runs/:id/cancel` | Huỷ |
| `GET` | `/v1/runs/:id/stream?ticket=` | SSE (§6) |

`GET /v1/runs/:id`, `tickets` và `cancel` dùng `runOr404(id, owner)` như hiện nay: run của trình duyệt khác
trông như không tồn tại.

### 5.1 `GET /v1/capabilities`

```jsonc
{
  "bridge_version": "0.1.0",
  "time_zone": "Asia/Ho_Chi_Minh",     // múi giờ của máy, để Seleya viết prompt có ngày giờ
  "default_provider": "claude",
  "providers": [
    {
      "id": "claude",
      "state": "ready",                // "ready" | "unavailable" (| "signed_out" khi provider báo được, ví dụ Codex)
      "detail": null,                  // ví dụ "codex not found"
      "models": [],                    // model web được phép chọn ngoài model mặc định
      "features": {
        "structured_output": true,
        "resume": true,
        "thinking": true,              // có thể phát thinking; không bảo đảm có (§6.2)
        "workspace_tools": ["read_file", "list_files", "search_files"]
      },
      "connectors_state": "ready",     // "discovering" | "ready"
      "connectors": [
        {
          "id": "gmail",               // dùng trong request và sự kiện; ổn định giữa các lần khởi động
          "name": "Gmail",             // tên gốc của provider; Seleya chọn icon theo tên này
          "state": "connected",        // "connected" | "unavailable"
          "tools": ["search_threads", "get_thread"]   // chỉ tool đọc
        }
      ]
    }
  ],
  "limits": {
    "max_turns": 60,                   // trần từ config
    "max_tool_output_tokens": 100000,  // trần từ config
    "max_prompt_chars": 100000,        // hằng số
    "max_system_prompt_chars": 20000,  // hằng số
    "max_output_schema_bytes": 65536   // hằng số
  }
}
```

- Đòi token: so với `health`, endpoint này lộ thêm danh sách tool và model.
- Discovery connector (tối đa 30 s) **không** chặn provider: run không cần connector vẫn chạy được, như chat
  hiện nay. Chỉ request có `connectors` mới bị từ chối khi `connectors_state: "discovering"` (§5.2).
- Claude chưa có cách kiểm tra đăng nhập trước khi chạy: adapter báo `ready` khi có binary, và một run
  thất bại vì đăng nhập trả `provider_auth_required` (§7).
- Lỗi chi tiết của connector (`error`) vẫn chỉ ở terminal / app của bridge, như hiện nay.
- `GET /v1/health` bỏ `connectors` (đã có trong `capabilities`), giữ `name`, `version`, `paired`, `busy`.

### 5.2 `POST /v1/runs`

**Request**

```jsonc
{
  "provider": "claude",                // tuỳ chọn; mặc định default_provider
  "model": null,                       // tuỳ chọn; phải nằm trong providers[].models

  "prompt": "Create the user's Daily Briefing…",
  "system_prompt": "You are Seleya's Daily Briefing agent…",   // tuỳ chọn; ghép SAU phần mở đầu của bridge (§8.1)

  "session": {                         // tuỳ chọn; bỏ trống = run một lần, không lưu
    "persist": true,                   // mặc định false. true: lưu hội thoại để tiếp tục sau
    "resume_id": "1b9d…",              // tiếp tục hội thoại mà CHÍNH trình duyệt này đã tạo
    "title": "Q4 planning"             // tuỳ chọn; chỉ khi tạo hội thoại mới
  },

  "connectors": ["calendar", "gmail"], // hoặc "all"; mặc định [] (không connector nào)
  "workspace_tools": [],               // hoặc "all"; mặc định []
  "output_schema": { /* JSON Schema draft-7 */ },   // tuỳ chọn; có thì run trả structured output

  "limits": {                          // tuỳ chọn; kẹp trong [1, trần]; max_turns bỏ trống = trần, để run luôn có giới hạn
    "max_turns": 40,
    "max_tool_output_tokens": 60000
  }
}
```

**Session:**

- Id của hội thoại **luôn do bridge sinh**; client không đặt được id.
- `persist: false` (mặc định): provider không ghi transcript (Claude `persistSession: false`, như report hiện
  nay). Không có gì vào `sessions.json`.
- `persist: true`: bridge sinh id, ghi `sessions.add(id, owner, provider)`, trả `session_id`.
- `resume_id`: chỉ hợp lệ khi `sessions.owns(id, owner)` **và** session được tạo bằng cùng `provider`; nếu
  không, `404 session_not_found`. Như vậy một id đơn lẻ không bao giờ mở được hội thoại của trình duyệt
  khác, hay session Claude Code mà người dùng tự tạo trong workspace (giữ nguyên bảo đảm của `sessions.ts`).
  Hội thoại tiếp tục thì vẫn được lưu.

**Field lạ** bị bỏ qua (zod strip). Sau bản phát hành đầu tiên, Seleya **phải** kiểm tra `capabilities`
trước khi dựa vào một field mới, và kiểm tra giá trị thật mà `run.started` trả lại (§9).

**Kiểm tra (theo thứ tự, tất cả đồng bộ sau khi đọc body)**

| # | Điều kiện | Lỗi |
|---|---|---|
| 1 | Body hợp lệ, `prompt` 1…`max_prompt_chars`, `system_prompt` ≤ `max_system_prompt_chars` | `400 invalid_request` |
| 2 | `output_schema` ≤ `max_output_schema_bytes`, độ sâu ≤ 32, gốc `type: "object"`, mọi `$ref` là `#/…` | `400 invalid_output_schema` |
| 3 | `resume_id` thuộc trình duyệt này và cùng provider | `404 session_not_found` |
| 4 | Provider tồn tại và `state: "ready"` | `409 provider_unavailable` (`details: {provider, state}`) |
| 5 | `model` nằm trong allowlist của provider | `422 model_not_allowed` |
| 6 | Có `connectors` khi discovery chưa xong | `409 connectors_discovering` (thử lại sau) |
| 7 | Mỗi connector có trong capabilities và `connected` | `422 connector_unavailable` (`details: {connector}`) |
| 8 | Mỗi workspace tool có trong `features.workspace_tools` | `422 tool_not_allowed` |
| 9 | `limits` | Kẹp về `[1, trần]`, **không** báo lỗi; giá trị thật trả trong `run.started` |
| 10 | Không có run nào đang chạy | `409 busy` |

**Response `201`**

```jsonc
{
  "run_id": "…",
  "session_id": "…",                   // null khi persist: false
  "provider": "claude",
  "stream": { "stream_id": "…", "ticket": "…", "expires_at": "…", "url": "http://127.0.0.1:47821/v1/runs/…/stream" }
}
```

`stream` giữ đúng hình dạng `ChatStream` hiện tại, nên phần kết nối SSE ở Seleya dùng lại được.

### 5.3 `GET /v1/runs/:id`

```jsonc
{
  "run_id": "…",
  "session_id": "…",
  "provider": "claude",
  "status": "running",       // "running" | "completed" | "failed" | "cancelled"
  "output": null,            // structured output đã redact, khi completed và có output_schema
  "text": null,              // câu trả lời cuối, đã redact, khi completed
  "sources": null,           // như run.completed, khi completed
  "connector_errors": null,  // như run.completed, khi completed
  "redactions": null,        // như run.completed, khi completed
  "error": null              // {code, message, retryable} khi failed
}
```

Run đã xong vẫn được giữ 10 phút như hiện nay.

### 5.4 Mã lỗi HTTP

Dạng lỗi không đổi: `{ "error": { "code", "message", "details"? } }`. `message` chỉ để debug; Seleya
hiển thị chữ của mình dựa trên `code` và `details`. `conversation_not_found` hiện tại đổi thành
`session_not_found`.

---

## 6. Hợp đồng sự kiện

### 6.1 Khung SSE

Giữ khung của ms-agent-gateway để `gatewayPayload` của Seleya đọc được (`sse.ts`):

```
id: 7
event: tool.started
data: {"event_type":"tool.started","session_id":"<run_id>","data":{…}}
```

### 6.2 Danh sách sự kiện

Thay cho cả `seleya.message.*` / `seleya.block.*` / `seleya.trace.*` (chat) lẫn `seleya.run.*` /
`seleya.thought.*` (report).

| Sự kiện | `data` | Ghi chú |
|---|---|---|
| `run.started` | `{run_id, session_id, provider, model?, persist, connectors, workspace_tools, limits}` | Luôn là sự kiện đầu. Mọi giá trị là **giá trị thật** sau policy |
| `text.started` | `{block}` | `block`: số thứ tự khối chữ trong run, từ 0 |
| `text.delta` | `{block, text}` | Theo dòng, đã redact (§6.5) |
| `text.completed` | `{block}` | |
| `thinking.started` | `{id}` | Chỉ phát khi khối thinking còn chữ sau redact |
| `thinking.delta` | `{id, text}` | Một delta chứa cả khối, đã redact |
| `thinking.completed` | `{id, duration_ms}` | |
| `tool.started` | `{id, kind, connector?, name, input}` | §6.3 |
| `tool.completed` | `{id, ok, error?}` | `error`: chữ lỗi đã redact, ≤ 300 ký tự |
| `output.started` | `{}` | Model bắt đầu điền structured output (thay cho tool `StructuredOutput`) |
| `run.completed` | `{text, output?, sources, connector_errors, redactions, usage?, duration_ms}` | §6.4 |
| `run.failed` | `{code, message, retryable, details?}` | §7 |
| `stream.done` | `{}` | Luôn là sự kiện cuối; giữ để `gatewayPayload` đóng stream như hiện nay |

**Thứ tự:** `run.started` → (text / thinking / tool / output, xen kẽ) → đúng một trong `run.completed` hoặc
`run.failed` → `stream.done`. Seleya phải **bỏ qua** sự kiện không biết.

**Thinking:** chat hiện nay không gửi thinking ra khỏi bridge; bản mới thì có, cho mọi run. Đây là luồng dữ
liệu mới (đã redact theo khối). Model có adaptive thinking có thể không trả nội dung thinking, nên
`features.thinking: true` chỉ có nghĩa "có thể".

**Không có** khái niệm UI: không `assistant_message_id`, `blocks`, `trace.title`, `phase.label`, `agent_ids`.
Seleya tự ghép (§11.2).

### 6.3 `tool.started`

```jsonc
{
  "id": "toolu_01…",
  "kind": "connector",         // "connector" | "workspace" | "other"
  "connector": "gmail",        // khi kind = connector
  "name": "search_threads",    // tên tool không tiền tố: bỏ "mcp__gmail__"
  "input": { "query": "in:inbox newer_than:2d" }
}
```

- `input` đã redact (cả key lẫn value) bằng một Redactor tạm, **không** cộng vào `redactions` của run; mỗi
  chuỗi cắt còn ≤ 500 ký tự; tổng ≤ 4 KB (vượt thì giữ các field chuỗi đầu tiên cho tới 4 KB và thêm
  `input_truncated: true`).
- Tool workspace được chuẩn hoá giữa các provider: Claude `Read` / `Glob` / `Grep` → `read_file` /
  `list_files` / `search_files`, với input `{path}`, `{pattern}`, `{pattern, glob?}`. Codex dùng sẵn các tên
  này ([codex-backend.md §4.6](codex-backend.md)).
- Tool của subagent (có `parent_tool_use_id`) không được phát, như hiện nay.

### 6.4 `run.completed`

```jsonc
{
  "text": "…",                   // câu trả lời cuối, đã redact (rỗng nếu chỉ có structured output)
  "output": { … },               // khi có output_schema: JSON đã parse và đã redact
  "sources": [{ "id": "calendar", "name": "Google Calendar" }],   // connector đã trả kết quả không lỗi
  "connector_errors": [
    { "connector": "gmail", "kind": "insufficient_scope", "message": "…" }
  ],
  "redactions": 3,
  "usage": { "input_tokens": 12000, "output_tokens": 900, "turns": 7 },
  "duration_ms": 41230
}
```

- `connector_errors[].kind`: `"insufficient_scope" | "auth_expired" | "other"`. Bridge phân loại (dùng regex
  hiện có trong `unreadMessage`), còn chữ hướng dẫn người dùng thì Seleya viết.
- Bridge **không** tự đánh run là lỗi khi mọi connector đều lỗi (luật `connector_failed` hiện tại). Đó là
  quyết định của tính năng: Seleya xem `sources` và `connector_errors`.
- Bridge **không** validate `output` theo nghĩa nghiệp vụ. Bridge chỉ bảo đảm `output` là JSON object; nếu
  không có hoặc không parse được thì run là `run.failed invalid_output`. Seleya validate bằng zod.
- `redactions` đếm giá trị bị che trong: kết quả connector (trước model), mỗi khối chữ và thinking (đếm một
  lần trên cả khối), và `output`.

### 6.5 Redact trên luồng sự kiện

Engine dùng chung thuật toán chat hiện tại (`claude.ts`: `appendText`, `send`, `flush`) cho **mọi** run:

- Chữ được giữ lại tới hết dòng (hoặc tới dấu cách cuối khi dòng dài hơn 1.000 ký tự), redact cả phần đã có
  bằng Redactor tạm, rồi chỉ gửi phần mới. Một giá trị không bao giờ bị cắt đôi giữa hai delta trước khi
  redact thấy nó.
- Hết khối: redact cả khối bằng Redactor của run (đếm vào `redactions`), gửi phần còn thiếu.

| Dữ liệu | Redact | Ghi chú |
|---|---|---|
| Kết quả connector, trước khi model đọc | Có | Hook `PostToolUse` (Claude), proxy (Codex). Như hiện nay |
| `text.delta` | Có, theo dòng | Bao gồm chữ trích từ file workspace, vốn không được redact khi model đọc |
| `thinking.delta` | Có, theo khối | Như `ReportMapper.closeThought` |
| `tool.started.input`, `tool.completed.error`, `connector_errors[].message` | Có | |
| `run.completed.text`, `GET /v1/runs/:id` `text` | Có, cả câu trả lời | |
| `run.completed.output` | Có, **cả key lẫn value** | |

**Key của object:** `Redactor.walk` hiện chỉ redact value (`redact.ts`). Hiện nay điều này vô hại vì schema
là `z.object` cố định và `safeParse` bỏ key lạ. Khi schema do web gửi và bridge không validate, một schema
có `additionalProperties` hay dạng map ("người gửi → số thư") để model đặt email hay token vào key. Sửa:
`walk` redact cả key (gộp khi trùng). Việc này cũng áp dụng cho `tool.started.input`.

### 6.6 Ví dụ

```
run.started      {run_id, session_id:null, provider:"claude", persist:false, connectors:["calendar"], workspace_tools:[], limits:{max_turns:24,…}}
thinking.started {id:"th1"}
thinking.delta   {id:"th1", text:"I'll read Monday first…"}
thinking.completed {id:"th1", duration_ms:1800}
tool.started     {id:"t1", kind:"connector", connector:"calendar", name:"list_events", input:{time_min:"2026-10-26T00:00"}}
tool.completed   {id:"t1", ok:true}
output.started   {}
run.completed    {text:"", output:{unreadableDays:[], events:[…]}, sources:[…], connector_errors:[], redactions:0, …}
stream.done      {}
```

---

## 7. Lỗi của run (`run.failed.code`)

Thay cho các mã hiện tại (`claude_auth_required`, `claude_api_error`, `claude_error`, `cancelled`, `stopped`,
`invalid_briefing`, `connector_failed`…).

| Code | retryable | Nguồn (Claude; Codex theo [codex-backend.md §4.10](codex-backend.md)) |
|---|---|---|
| `provider_auth_required` | false | 401 / `authentication_error` (`resultFailure` hiện có); `SDKAssistantMessage.error` `authentication_failed`. `details.provider` để Seleya chỉ đúng lệnh đăng nhập |
| `provider_usage_limit` | false | `SDKAssistantMessage.error` `rate_limit` / `billing_error`; `SDKRateLimitEvent` `status: "rejected"`. `details.resets_at` nếu có |
| `provider_api_error` | true | `overloaded`, `server_error`, lỗi API khác |
| `context_limit` | false | Hết context |
| `max_turns` | false | `error_max_turns` |
| `invalid_output` | true | `error_max_structured_output_retries`; hoặc có `output_schema` mà không có / không parse được JSON |
| `no_result` | true | Provider kết thúc mà không có kết quả |
| `policy_violation` | false | Provider dùng tool đã tắt (Codex `commandExecution`…) |
| `cancelled` | false | Người dùng huỷ |
| `provider_error` | true | Tiến trình crash, lỗi không phân loại được |

Hiện tại `resultFailure` chỉ tách được lỗi đăng nhập; mọi lỗi API khác thành `claude_api_error` (retryable).
Các mã `provider_usage_limit`, `context_limit` và `invalid_output` (từ
`error_max_structured_output_retries`) là **việc mới** của adapter, dựa trên `SDKAssistantMessage.error` và
`SDKRateLimitEvent` trong `sdk.d.ts`.

`message` là chữ tiếng Anh để debug. `details.provider_code` giữ mã gốc để điều tra.

---

## 8. Chính sách và bảo mật

### 8.1 System prompt

Bridge luôn ghép:

```
<phần mở đầu của bridge>
<system_prompt của request, nếu có>
```

Phần mở đầu (không đổi theo tính năng, chỉ đổi theo bridge):

- Model đang chạy trên máy người dùng, qua một cổng nối; ngày hiện tại và múi giờ. Chỉ có ngày, không có
  giờ: phần mở đầu nằm đầu system prompt, một giá trị đổi mỗi phút sẽ làm provider không cache được phần
  còn lại.
- Nếu run có connector: danh sách connector, chúng **chỉ đọc**, và `PRIVACY_RULES`.
- Nếu run không có connector: "No connectors are available."

Câu "You are Seleya's assistant… Answer in the user's language, concisely" chuyển lên Seleya, trong
`system_prompt` của chat.

### 8.2 Threat model: thay đổi gì

Giả định giữ nguyên: **origin Seleya đã pair là đáng tin**; trang web khác không gọi được bridge (origin,
host, token, loopback); các trình duyệt đã pair không đọc được run và hội thoại của nhau.

Ranh giới thật là: allowlist tool chỉ đọc, cách ly provider, quyền sở hữu run / session và tin origin đã
pair. **Redact là lưới an toàn dựa trên pattern** (`redact.ts` tự mô tả như vậy): một prompt bảo model viết
"john at acme dot com" hay tách chữ số sẽ lọt qua. Điều này đã đúng hiện nay (prompt chat tuỳ ý), bản mới
không làm nó tệ hơn.

| Rủi ro | Hiện tại | Bản mới | Biện pháp |
|---|---|---|---|
| Web điều khiển model đọc gì | `/v1/runs` đã nhận prompt tuỳ ý **với mọi connector chỉ đọc** | Như cũ; thêm khả năng thu hẹp | Không mở rộng quyền |
| Web bỏ quy tắc riêng tư | Prompt chat đã làm được | Web viết thêm phần sau của system prompt | Phần mở đầu bắt buộc; redact hai chiều. Không coi là bảo đảm tuyệt đối |
| Mở hội thoại của người khác | `sessions.owns` | Giữ; id do bridge sinh; kiểm tra thêm provider | §5.2 |
| Đọc / huỷ run của người khác | `runOr404(id, owner)` | Giữ cho mọi endpoint `/v1/runs/:id/*` | §5 |
| Web đòi connector / tool / model ngoài cho phép | Không có tham số | Có tham số | Allowlist; ngoài danh sách ⇒ 4xx |
| Tiêu hao quota | Hằng số trong code | Web đặt | Kẹp theo trần trong config |
| Dữ liệu connector ghi ra đĩa | Report không lưu session | Mặc định không lưu | `persist` mặc định false |
| Lộ dữ liệu qua key của output | Không (schema cố định) | Có thể | Redact cả key (§6.5) |
| Schema độc hại (lớn, sâu, `$ref` ngoài) | Không có | Có | Giới hạn kích thước, độ sâu, chỉ `$ref` nội bộ |
| Tool ghi | Bị loại | Không đổi | `disallowedTools`, chỉ khai báo tool đọc |

Comment ở `briefing.ts` ("The prompt is the bridge's own: the web only asks for a briefing, it can't
change what Claude is told to read") không còn áp dụng, và thực tế nó cũng không bảo vệ được gì, vì
`/v1/runs` đã cho prompt tuỳ ý.

### 8.3 Config (`config.json`)

```jsonc
{
  // ...các key hiện tại giữ nguyên...
  "defaultProvider": "claude",
  "models": [],                          // model web được chọn cho Claude, ngoài `model` mặc định
  "limits": {
    "maxTurns": 60,
    "maxToolOutputTokens": 100000
  },
  "codex": {                             // theo codex-backend.md §5.1, thêm:
    "models": []
  }
}
```

`tools` (Read, Glob, Grep) vẫn là trần của `workspace_tools`; `connectors` vẫn là trần của `connectors`.

`max_turns` nghĩa là số turn của model với Claude, và số lần gọi tool với Codex (Codex không có max turns;
xem [codex-backend.md §4.5](codex-backend.md)).

### 8.4 Một run mỗi lúc

Kiểm tra `runs.busy` và `runs.create` phải nằm trong cùng một đoạn đồng bộ, như hiện nay (`server.ts`). Policy
không được `await` giữa hai bước này. Việc cần chờ của provider (ví dụ Codex `thread/start`) diễn ra **trong**
run, sau `runs.create`.

---

## 9. Phiên bản và tương thích (từ bản phát hành đầu tiên)

Trước khi phát hành, API được đổi tự do; Seleya và bridge cập nhật cùng lúc. Từ bản phát hành đầu tiên:

- Thay đổi không tương thích ngược thì thành prefix mới (`/v2`), và `GET /v1/health` thêm
  `protocols: [1, 2]` để Seleya biết. Cùng với `version` đã có, đó là hai tín hiệu phiên bản duy nhất.
- Thêm field, sự kiện, mã lỗi, provider hay feature không cần prefix mới. Bridge bỏ qua field request không
  biết; Seleya bỏ qua sự kiện và field response không biết.
- Seleya kiểm tra `capabilities` trước khi dùng một field hay tính năng tuỳ chọn, và kiểm tra giá trị thật
  trong `run.started`. Field có ảnh hưởng tới an toàn **bắt buộc** phải đi kèm feature trong `capabilities`,
  để Seleya không gửi nó tới bridge cũ rồi tưởng nó có tác dụng.
- Khi `bridge_version` thấp hơn mức Seleya cần, Seleya hiện thông báo cập nhật.
- Năng lực sau này (approval, tool ghi) được thêm theo cùng cách: feature mới trong `capabilities`, field mới
  trong request (ví dụ `approvals: "ask"`), sự kiện mới (`approval.requested`) và endpoint mới
  (`POST /v1/runs/:id/approvals/:id`).

---

## 10. Thay đổi trong bridge

### 10.1 Cấu trúc file

```
src/
  server.ts             createServer, origin/host/CORS, pairing, health, authorize, runOr404, route /v1/*
  api.ts                schema request (zod), capabilities, runs
  engine/
    types.ts            RunSpec, AgentEvent, ProviderAdapter, ProviderStatus
    engine.ts           runOnce(adapter, run, spec): AgentEvent → redact → sự kiện (§6)
    text.ts             stream chữ theo dòng đã redact (từ AnswerMapper)
    policy.ts           request → RunSpec: owner, allowlist, kẹp limits, ghép system prompt
    preamble.ts         phần mở đầu + PRIVACY_RULES
  providers/
    claude/
      adapter.ts        ClaudeAdapter: RunSpec → Options, SDKMessage → AgentEvent
      connectors.ts     discovery (từ src/connectors.ts)
    codex/              theo codex-backend.md §7
  runs.ts, sessions.ts, sse.ts, tickets.ts, http.ts, security.ts, pairing.ts, redact.ts, case.ts, config.ts, bridge.ts, index.ts
```

Xoá: `briefing.ts`, `calendar.ts`, `mail.ts`, `report.ts`, `claude.ts` (phần còn dùng chuyển vào
`providers/claude/adapter.ts` và `engine/`).

### 10.2 Interface

```ts
// src/engine/types.ts
export type ProviderId = "claude" | "codex";

/** Một run đã qua policy: mọi giá trị đều nằm trong giới hạn của config. */
export interface RunSpec {
  prompt: string;
  /** Phần mở đầu của bridge + system_prompt của request. */
  systemPrompt: string;
  /** Do bridge sinh. persist: false ⇒ provider không ghi transcript. */
  session: { id: string; resume: boolean; persist: boolean; title?: string };
  model?: string;
  /** Connector id đã kiểm tra; adapter chỉ khai báo tool đọc của chúng. */
  connectorIds: string[];
  /** Tên chuẩn hoá: read_file | list_files | search_files. Rỗng = không tool workspace nào. */
  workspaceTools: string[];
  outputSchema?: object;
  maxTurns?: number;
  /** Không đặt = giới hạn mặc định của provider. */
  maxToolOutputTokens?: number;
}

/** Như codex-backend.md §4.2, thêm kind/connector chuẩn hoá cho tool và usage. */
export type AgentEvent =
  | { type: "text.start"; key: string }
  | { type: "text.delta"; key: string; text: string }   // chưa redact; engine lo phần redact
  | { type: "text.end"; key: string }
  | { type: "thinking.start"; key: string }
  | { type: "thinking.delta"; key: string; text: string }
  | { type: "thinking.end"; key: string }
  | { type: "tool.start"; id: string; kind: "connector" | "workspace" | "other"; connector?: string; name: string; input: unknown }
  | { type: "tool.end"; id: string; ok: boolean; errorText?: string }
  | { type: "output.writing" }
  | { type: "done"; text: string; structured?: unknown; usage?: Usage }
  | { type: "failed"; code: RunFailureCode; message: string; retryable: boolean; details?: object };

export interface ProviderAdapter {
  readonly id: ProviderId;
  start(): Promise<void>;
  status(): ProviderStatus;                 // state, models, features, connectors (cho capabilities)
  /** Dừng khi run.abort.signal bị huỷ (Claude: close(); Codex: turn/interrupt). */
  run(run: Run, spec: RunSpec): AsyncIterable<AgentEvent>;
  stop(): Promise<void>;
}
```

So với `AgentBackend` của Codex spec: `chat()` và `report()` gộp thành một `run()`, vì khác biệt giữa chúng
giờ chỉ là tham số. `openSession()` không cần riêng: id do policy sinh; adapter Codex tự lưu map
`session_id → threadId` (phương án S6 của Codex spec). `cancel()` thay bằng `run.abort.signal`.

### 10.3 ClaudeAdapter: ánh xạ `RunSpec` → `Options`

| `RunSpec` | `Options` của Agent SDK |
|---|---|
| (luôn) | `isolatedOptions()` hiện tại: `settingSources: []`, `strictMcpConfig`, `skills: []`, `canUseTool: denyUnapproved`, hook redact, `includePartialMessages` |
| `connectorIds` | `onlyConnectors(set, connectorIds)` → `mcpServers`, `allowedTools`; `disallowedTools` = mọi tool ghi |
| `workspaceTools` | `tools` **luôn bị thay** bằng danh sách ánh xạ (`read_file` → `Read`, `list_files` → `Glob`, `search_files` → `Grep`), kể cả `[]`. Không giữ `config.tools` mà `isolatedOptions` đặt sẵn |
| `systemPrompt` | `systemPrompt` |
| `session` | `resume ? { resume: id } : { sessionId: id, title }`; `persistSession: persist` |
| `outputSchema` | `outputFormat: { type: "json_schema", schema }` |
| `maxTurns` | `maxTurns` (không đặt thì bỏ trống) |
| `maxToolOutputTokens` | env `MAX_MCP_OUTPUT_TOKENS` (không đặt thì bỏ trống) |
| `model` | `model` |

`SDKMessage` → `AgentEvent`: gộp phần đọc message của `AnswerMapper.handle` và `ReportMapper.handle` (đã gần
giống nhau), bỏ phần dựng `seleya.*`. Đọc thêm `SDKAssistantMessage.error` và `SDKRateLimitEvent` cho bảng
lỗi §7.

### 10.4 Engine

`engine.ts` thay `runClaude` và `runReport`:

- Chữ: thuật toán theo dòng của §6.5 (`text.ts`), cho mọi run.
- Thinking: gom theo khối, redact bằng Redactor của run khi đóng; khối rỗng sau redact thì không phát.
- Tool: redact `input` bằng Redactor tạm rồi phát `tool.started`; theo dõi `sources` (connector trả không lỗi)
  và `connector_errors` (lỗi đầu tiên mỗi connector, đã redact và phân loại).
- `done`: redact `structured` (key và value), kiểm tra là object, gán `run.output`, phát `run.completed`.
- Huỷ: `run.abort` → `run.failed cancelled`. Mọi kết cục đều kết thúc bằng `stream.done`, như hiện nay.

---

## 11. Phía Seleya

### 11.1 Thứ chuyển lên

Mỗi tính năng thành một **task definition** trong repo Seleya (đường dẫn do team web chọn):

```ts
// ví dụ: tasks/briefing.ts phía Seleya
export const briefingTask = defineBridgeTask({
  id: "briefing",
  connectors: (caps) => connectedIds(caps),             // hoặc danh sách cố định
  limits: { maxTurns: 40 },
  systemPrompt: () => `You are Seleya's Daily Briefing agent… `,
  prompt: ({ caps, now }) => briefingPrompt(caps, now),  // chuyển từ bridge/src/briefing.ts
  output: briefingOutput,                                // zod, chuyển nguyên
  finish: (output, run) => toBriefing(output, run),      // id, tone, lọc link Jira…
  check: (output, run) => run.sources.length === 0 && run.connectorErrors.length > 0
    ? connectorFailed(run.connectorErrors)               // luật connector_failed cũ
    : undefined,
  labels: { planning: "Planning what to read…", reasoning: "Deciding what matters today", writing: "Writing your briefing" },
});
```

`output_schema` gửi lên bridge là `z.toJSONSchema(output, { target: "draft-7" })`, như `report.ts` làm hiện
nay. Prompt có thể khác nhau theo `provider` (tên tool connector khác nhau giữa claude.ai và ChatGPT apps).
Chat gửi `session.persist: true` cho tin nhắn đầu và `resume_id` cho các tin sau.

**Tuỳ chọn:** đặt task definition (prompt, schema dạng JSON Schema) ở **backend** của Seleya và để web tải
về. Khi đó sửa prompt không cần cả deploy web. Không bắt buộc cho refactor này.

### 11.2 Adapter sự kiện → UI hiện tại

Để UI không phải đổi, Seleya viết một adapter dịch sự kiện mới sang mô hình mà UI đang dùng
(`src/types/chat/stream.ts`, `src/types/agent/runStream.ts`). Về lâu dài, UI có thể đọc thẳng sự kiện mới
và bỏ adapter.

| Sự kiện | Chat (`seleya.*` cũ) | Agent run (`seleya.run.*` cũ) |
|---|---|---|
| `run.started` | `message.started` (Seleya tự sinh `assistantMessageId`, tiêu đề) | `run.started` + `run.phase processing` (nhãn của task) |
| `text.*` | `block.started` / `block.delta` | Gom tới `text.completed`, rồi `thought.*` kind `reasoning` + `run.phase reasoning` |
| `thinking.*` | Bỏ qua hoặc hiển thị, tuỳ UI | `thought.*` kind `thinking` |
| `tool.started` | `trace.started` (lần đầu) + `trace.step` (label từ `describeTool` chuyển lên web) | `trace.step` + `run.phase tool` |
| `tool.completed` | `trace.step` `done` / `failed` | như bên trái |
| `output.started` | — | `run.phase writing` |
| `run.completed` | `trace.completed` + `message.completed` | `finish()` / `check()` của task → `run.completed` hoặc `error` |
| `run.failed` | `error` (chữ theo `code`) | như bên trái |

`describeTool`, `CONNECTOR_DETAIL_FIELDS`, `humanize` và bảng icon / tên hiển thị connector chuyển vào
adapter này.

### 11.3 Connector id

Id connector **giữ nguyên** như hiện nay (bảng `SELEYA_IDS`, rồi `idFromName` cho tên không có trong bảng).
Lý do:

- Id là một phần tên tool (`mcp__calendar__list_events`). Đổi id thì hội thoại đã lưu tham chiếu tới tool
  không còn tồn tại khi resume.
- Bảng này chỉ là ánh xạ tên ổn định, không phải logic nghiệp vụ. Có thể đổi tên thành `CONNECTOR_IDS` cho
  trung lập.

Seleya dựa vào `name` để chọn icon và tên hiển thị. Cần sửa thêm: `connectedConnectors` gắn hậu tố `_2` theo
thứ tự discovery, nên id có thể đổi giữa các lần khởi động. Sắp xếp theo tên trước khi gán id để id ổn định.

---

## 12. Kế hoạch

Vì chưa phát hành, bridge và Seleya đổi **cùng lúc**, không có lớp tương thích. API hiện tại bị thay thế,
và `sessions.json` cũ có thể xoá (session chưa có `provider` được coi là `claude`).

| Bước | Việc | Hoàn thành khi | Ước lượng |
|---|---|---|---|
| **B0. Chuẩn bị** | Commit các thay đổi đang dở (`sessions.ts`, owner, redact theo dòng…). Chốt spec với team web, nhất là §5 và §6 | Hợp đồng API và sự kiện được cả hai bên đồng ý | 0,5 ngày |
| **B1. Bridge** | `engine/`, `ClaudeAdapter`, `policy.ts`, `preamble.ts`, route mới; `provider` trong `sessions.json`; redact key; id connector ổn định; bảng lỗi §7; config `models` / `limits`. Xoá `briefing/calendar/mail/report/claude.ts` và các endpoint cũ | Chạy được chat lẫn ba tính năng (prompt và schema lấy từ bản hiện tại) bằng script; test xanh | 4–5 ngày |
| **B2. Seleya** (song song với B1 sau B0) | Task definition cho chat, briefing, calendar, mail (chuyển prompt, schema, `finish` từ bridge); client mới cho `/v1/runs`, `/v1/runs/:id`, `/v1/capabilities`; adapter sự kiện | Bốn tính năng chạy trên bridge mới, kết quả tương đương bản hiện tại | 4–5 ngày (team web) |
| **B3. Codex** | `CodexAdapter` theo [codex-backend.md](codex-backend.md), cắm vào `ProviderAdapter` | `provider: "codex"` chạy được chat và ba tính năng | theo Codex spec P0, P2–P4 |

**Ghép B1 và B2:** hai bên merge cùng lúc. Trong lúc B1 chưa xong, team web có thể dùng một mock server phát
lại chuỗi sự kiện mẫu ở §6.6.

**Trước bản phát hành đầu tiên:** app Electron nên có cơ chế cập nhật (hoặc ít nhất thông báo), vì từ đó trở
đi Seleya phải chạy với bridge cũ theo §9.

---

## 13. Ảnh hưởng tới spec Codex

Làm gateway **trước** Codex, để Codex chỉ là một adapter. Những phần của
[codex-backend.md](codex-backend.md) thay đổi:

| Mục Codex spec | Thay đổi |
|---|---|
| §1 Phạm vi: chạy briefing/calendar/mail bằng Codex "cùng prompt" | Prompt theo provider do Seleya giữ; bridge không cần biết |
| §4.2 `AgentBackend.chat` / `report` / `openSession` / `cancel` | Thay bằng `ProviderAdapter.run(run, RunSpec)`; huỷ qua `run.abort.signal` → `turn/interrupt` |
| §4.5 proxy phát `tool.start` "label/detail như describeTool" | Phát `tool.start` với `kind`, `connector`, `name`, `input` thô; label do Seleya dựng |
| §4.5 bước 2 dùng `SELEYA_IDS` | Giữ: dùng chung bảng id (§11.3) |
| §4.7, §4.8 luồng qua `/v1/runs` (chat) và `/v1/briefings` | Chỉ một luồng `/v1/runs` mới |
| §4.8 `strictSchema(zod)` + `nullsToUndefined` | Bridge chỉ còn JSON Schema thô từ web, nên `CodexAdapter` biến đổi **trên JSON Schema**: thêm mọi key vào `required`, đổi key optional thành `anyOf [T, null]`, `additionalProperties: false`; ghi lại các path đã đổi và bỏ `null` ở đúng các path đó trong kết quả |
| §4.9 "Chat: stream thẳng thành `seleya.block.delta`" | Delta đi qua engine, được redact theo dòng như mọi provider |
| §4.10 mã lỗi `codex_*` | Dùng bảng chung §7; mã gốc vào `details.provider_code` |
| §5.1 `defaultAgent`, `codex.model` | `defaultProvider`; thêm `codex.models` (allowlist) |
| §5.2 field `agent` trên các endpoint, `health.agents` | `provider` trong `/v1/runs`, `capabilities.providers` |
| §4.3 – §4.4, §4.6, §8 spike | **Không đổi** |

---

## 14. Test

Dùng `node:test` (có sẵn trong Node 22.18, chạy thẳng `.ts`), như Codex spec đề xuất.

- **Adapter:** ghi lại chuỗi `SDKMessage` thật của chat và ba tính năng hiện tại thành fixture JSONL. Kiểm tra
  `SDKMessage` → `AgentEvent`: text, thinking, tool connector, tool workspace, subagent bị lọc,
  `StructuredOutput` → `output.writing`, các nhánh lỗi của §7.
- **Engine:** stream chữ theo dòng có redact (email bị cắt giữa hai delta, dòng dài hơn 1.000 ký tự); thinking
  rỗng không phát; redact input, lỗi tool, output (cả key); `sources` và `connector_errors`;
  `invalid_output`; huỷ trước và giữa run.
- **Policy và bảo mật:**
  - `resume_id` của trình duyệt khác, id không có trong `sessions.json`, id của provider khác ⇒ 404.
  - Client không đặt được id cho hội thoại mới.
  - `persist` mặc định không ghi transcript và không ghi `sessions.json`.
  - `GET /v1/runs/:id`, `tickets`, `cancel` của run trình duyệt khác ⇒ 404.
  - Connector ngoài config ⇒ 422; khi đang discovery ⇒ 409; tool ghi không bao giờ có trong `allowedTools`.
  - `workspace_tools: []` ⇒ `tools: []` thật sự.
  - Kẹp `limits` (kể cả 0 và số âm); schema quá lớn, quá sâu, `$ref` ngoài; `model` ngoài allowlist.
  - System prompt của request không thay được phần mở đầu; field lạ bị bỏ qua.
  - Hai `POST /v1/runs` gần như cùng lúc ⇒ một `409 busy`.
- **Tương đương tính năng:** chạy briefing, calendar, mail bằng prompt và schema hiện tại qua `/v1/runs`, so
  kết quả (sau `finish()` phía Seleya) với bản hiện tại trên cùng dữ liệu.

---

## 15. Câu hỏi mở

1. **Bridge có validate `output` theo JSON Schema không?** Spec này để Seleya validate. Validate ở bridge (thêm
   `ajv`) cho phép trả `invalid_output` sớm, đổi lại thêm dependency. Claude Code tự retry khi structured
   output sai schema (`error_max_structured_output_retries`), nên lợi ích chủ yếu là với Codex.
2. **Task definition ở web hay backend Seleya?** (§11.1). Ở backend thì sửa prompt không cần deploy web, nhưng
   cần API và cache.
3. **Cơ chế cập nhật của app Electron** trước bản phát hành đầu tiên: tự cập nhật, hay chỉ thông báo?
4. **Chat có nên gửi thinking không?** Bản mới gửi theo mặc định. Nếu UI không dùng, có thể thêm
   `thinking: false` (một feature trong `capabilities`) để không tốn băng thông.
