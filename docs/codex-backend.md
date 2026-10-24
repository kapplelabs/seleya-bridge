# Spec: kết nối seleya-bridge tới Codex (OpenAI)

Trạng thái: **Draft / đề xuất** · Ngày: 2026-10-24 · Codex tham chiếu: `codex-cli 0.164.0`

Mục tiêu: **thêm đường kết nối tới Codex** để Seleya chat được với Codex trên máy người dùng, qua đúng hợp
đồng HTTP/SSE hiện tại.

Thay đổi này **chỉ bổ sung**:

- Mọi logic đang có (chat Claude, Daily Briefing, Calendar, Mail, connector, redact) giữ nguyên và vẫn chạy
  bằng Claude.
- Không refactor `claude.ts`, `report.ts` hay `connectors.ts`.

---

## 1. Phạm vi

**Trong phạm vi**

- `POST /v1/runs` nhận thêm `agent: "codex"`. Chat được stream qua đúng các sự kiện `seleya.*` của chat
  Claude, có resume hội thoại và cancel.
- Bridge giữ một tiến trình `codex app-server` và nói chuyện với nó bằng JSON-RPC qua stdio.
- Codex chạy **cách ly**:
  - `CODEX_HOME` riêng của bridge.
  - Không có shell, web search, MCP hay apps.
  - Mọi yêu cầu duyệt đều bị từ chối.
- Đăng nhập Codex riêng cho bridge (`seleya-bridge codex login`).
- `GET /v1/health` báo trạng thái của Codex.

**Ngoài phạm vi (để sau, xem §9)**

- Connector (Gmail, Calendar…) trong chat Codex.
- Chạy Daily Briefing, Calendar hoặc Mail bằng Codex. Các endpoint này vẫn chỉ dùng Claude.
- Tool đọc file workspace cho Codex. Chat Codex v1 **không có tool nào**.
- Luồng approval.

---

## 2. Vì sao chọn `codex app-server`

| Bề mặt | Đánh giá |
|---|---|
| `@openai/codex-sdk` / `codex exec --json` | Chữ chỉ đến **cả khối** khi item kết thúc, không có delta; huỷ bằng cách kill tiến trình; không có server→client request nên không từ chối approval một cách có kiểm soát. OpenAI khuyên dùng bề mặt này cho CI và tự động hoá. |
| **`codex app-server`** | JSON-RPC 2.0 qua stdio (JSONL, bỏ header `jsonrpc`), là giao thức mà IDE extension và app desktop của Codex dùng. Có `item/agentMessage/delta` (stream từng đoạn), `turn/interrupt`, server request để từ chối approval, quản lý thread và resume, `account/*`. OpenAI khuyên dùng cho client tuỳ biến. |

`codex mcp-server` đã bị gỡ.

---

## 3. Protocol dùng tới

Lấy từ type sinh bằng `codex app-server generate-ts --experimental` trên bản 0.164.0.

| Việc | Method / message |
|---|---|
| Bắt tay | `initialize { clientInfo: {name, title, version}, capabilities: {experimentalApi: false} }`, sau đó notification `initialized` |
| Tài khoản | `account/read {refreshToken:false}` → `{account: {type:"chatgpt", planType} \| {type:"apiKey"} \| null, requiresOpenaiAuth}` |
| Đăng nhập | `account/login/start {type:"chatgptDeviceCode"}` → `{loginId, verificationUrl, userCode}`; notification `account/login/completed {loginId, success, error}`. Hoặc `{type:"apiKey", apiKey}`. |
| Mở hội thoại | `thread/start {cwd, model, approvalPolicy, sandbox, config, developerInstructions, serviceName, ephemeral}` → `{thread: {id, …}}` |
| Tiếp hội thoại | `thread/resume {threadId}` |
| Đặt tên | `thread/name/set {threadId, name}` |
| Gửi prompt | `turn/start {threadId, input: [{type:"text", text}], model?, effort?}` → `{turn: {id, status}}` |
| Huỷ | `turn/interrupt {threadId, turnId}`, sau đó turn kết thúc với `status:"interrupted"` |
| Stream | `item/started`, `item/agentMessage/delta {threadId, turnId, itemId, delta}`, `item/completed`, `turn/completed {threadId, turn: {status, error}}`, `error` |
| Server → client | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/tool/call`, `account/chatgptAuthTokens/refresh`, `currentTime/read` |
| Lỗi turn | `turn.error = {message, codexErrorInfo, additionalDetails}`. `codexErrorInfo` gồm `unauthorized`, `usageLimitExceeded`, `rateLimitExceeded`, `sessionBudgetExceeded`, `contextWindowExceeded`, `serverOverloaded`, `{httpConnectionFailed}`… và là **union mở** |

---

## 4. Thiết kế

### 4.1 Tổng quan

```
Seleya ──HTTP/SSE──▶ server.ts ── POST /v1/runs ──┬─ agent = "claude" (mặc định) ─▶ runClaude()        (không đổi)
                                                   └─ agent = "codex" ───────────▶ runCodexChat()
                                                                                       │
                                                       CodexAppServer (1 tiến trình) ◀─┘ JSON-RPC stdio
                                                       CODEX_HOME = <bridgeHome>/codex
```

Mọi thứ của Codex nằm trong `src/codex/`. Phần code cũ chỉ bị chạm ở các chỗ sau:

- `server.ts`: thêm nhánh `agent` trong `/v1/runs`, thêm field `agents` trong `/v1/health`.
- `config.ts`: thêm khối `codex`.
- `index.ts`: khởi động và tắt app-server, thêm lệnh `codex login` và `codex status`.
- `README.md`.

```
src/codex/
  appServer.ts   tiến trình + JSON-RPC client (request, notification, server request)
  home.ts        tạo CODEX_HOME, viết config.toml
  chat.ts        runCodexChat(): thread/turn → sự kiện seleya.* của chat
  status.ts      account/read, trạng thái cho health và CLI
  protocol/      type sinh bởi `codex app-server generate-ts` (ghim 0.164.0)
```

`Run`, `RunRegistry`, `sse.ts`, `tickets.ts`, pairing và security dùng lại nguyên vẹn. Quy tắc **một run mỗi
lúc** áp dụng chung cho cả hai agent.

### 4.2 `CodexAppServer` (`src/codex/appServer.ts`)

**Khởi động**

- Spawn khi bridge chạy, nếu `config.codex.enabled`:
  `spawn(executable, ["app-server"], { env: { ...process.env, CODEX_HOME }, stdio: ["pipe","pipe","pipe"] })`.
- stderr của app-server chuyển vào log của bridge, có tiền tố `codex:`.
- Bắt tay: gửi `initialize`, rồi `initialized`. Sau đó gọi `account/read` để biết trạng thái đăng nhập.

**JSON-RPC client**

- `request(method, params, timeoutMs = 30_000)` dùng map `id → {resolve, reject, timer}`.
- `on(method, listener)` cho notification.
- `handle(method, handler)` cho server request. Server request không có handler ⇒ lỗi `-32601`.
- Đọc từng dòng JSONL. Dòng không parse được thì ghi log và bỏ qua.

**Định tuyến:** notification nào có `threadId` thì chỉ chuyển tới run đang giữ thread đó.

**Sự cố**

- Tiến trình thoát ⇒ run đang chạy kết thúc với `codex_error` (retryable) và trạng thái thành `unavailable`.
- Bridge spawn lại theo backoff 1 s, 2 s, 4 s…, tối đa 30 s.
- Lỗi `-32001` (server overloaded) ⇒ retry có jitter, tối đa 3 lần.

**Tắt:** khi bridge nhận `SIGINT`/`SIGTERM`, gọi `turn/interrupt` cho turn đang chạy, rồi đóng stdin và kill
sau 2 s.

**Phiên bản:** commit type sinh từ 0.164.0 vào `protocol/`. Khi khởi động, đọc `userAgent` trong kết quả
`initialize`; nếu khác minor đã ghim thì in cảnh báo nhưng vẫn chạy.

**Binary:** `config.codex.executable`, mặc định là `codex` trong `PATH`. Không thêm dependency npm.

### 4.3 Cách ly (`src/codex/home.ts`)

Bridge dùng `CODEX_HOME=<bridgeHome>/codex` (mode 700), tương đương `settingSources: []` bên Claude:

- Không nạp `~/.codex/config.toml`, hooks, skills, plugins, MCP server hay `AGENTS.md` toàn cục của người
  dùng.
- Bridge ghi `config.toml` mỗi lần khởi động:

```toml
# Do seleya-bridge viết; mọi thay đổi sẽ bị ghi đè.
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
project_doc_max_bytes = 0            # không đọc AGENTS.md trong workspace
history.persistence = "none"

[features]
shell_tool = false
unified_exec = false
apps = false
hooks = false
memories = false
multi_agent = false
```

Mỗi `thread/start` vẫn truyền lại các giá trị quan trọng, phòng khi file bị sửa:

```jsonc
{
  "cwd": "<config.workspace>",
  "approvalPolicy": "never",
  "sandbox": "read-only",
  "model": "<config.codex.model | null>",
  "serviceName": "seleya-bridge",
  "developerInstructions": "<systemPrompt(EMPTY_CONNECTORS) — dùng lại hàm trong claude.ts>",
  "config": { "features.shell_tool": false, "features.unified_exec": false, "features.apps": false, "web_search": "disabled" }
}
```

**Lưới an toàn:** chat Codex v1 không có tool nào. Vì vậy chỉ được phép xuất hiện item loại `userMessage`,
`agentMessage`, `reasoning` và `plan`. Gặp bất kỳ item nào khác (`commandExecution`, `fileChange`,
`mcpToolCall`, `webSearch`, `dynamicToolCall`…) thì xử lý như sau:

1. Gọi `turn/interrupt`.
2. Kết thúc run với `codex_policy_violation`.
3. Ghi log tên item.

**Server request:**

| Request | Trả lời |
|---|---|
| `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` | `{decision:"decline"}` |
| `item/permissions/requestApproval` | Từ chối |
| `item/tool/requestUserInput` | `cancel` |
| `mcpServer/elicitation/request` | `{action:"decline"}` |
| `item/tool/call` | `{success:false, contentItems:[{type:"inputText", text:"No tools are available."}]}` |
| `currentTime/read` | `{currentTimeAt: Math.floor(Date.now()/1000)}` |
| `account/chatgptAuthTokens/refresh` | Lỗi: bridge không cung cấp token ngoài; Codex tự refresh `auth.json` |
| Method lạ | Lỗi `-32601` và ghi log cảnh báo |

### 4.4 Đăng nhập

`CODEX_HOME` riêng nên bridge có `auth.json` riêng.

**Không copy** `~/.codex/auth.json`: refresh token của ChatGPT được xoay vòng, nên hai bản sao sẽ làm bản
kia hết hạn.

```bash
seleya-bridge codex login            # account/login/start {type:"chatgptDeviceCode"}: in verificationUrl + userCode, chờ account/login/completed
seleya-bridge codex login --api-key  # đọc OPENAI_API_KEY từ env → account/login/start {type:"apiKey"}
seleya-bridge codex status           # account/read: loại tài khoản, gói; không in email
seleya-bridge codex logout           # account/logout
```

Các lệnh này tự spawn một app-server ngắn hạn với cùng `CODEX_HOME`, nên chạy được cả khi bridge đang tắt.

### 4.5 Luồng chat (`src/codex/chat.ts`)

```
POST /v1/runs {prompt, session_id?, title?, agent:"codex"}
  1. authorize, validate, runs.busy?                             (như hiện tại)
  2. codex.state !== "ready"  → 409 agent_unavailable (kèm lý do: disabled / signed_out / not running)
  3. sessionId =
       session_id có → thread/resume {threadId: session_id}      (lỗi not found → 404 session_not_found)
       không có      → thread/start {…§4.3}  → thread.id; thread/name/set {name: title}
  4. run = runs.create(sessionId)  → 201 {run_id, session_id, assistant_message_id, stream, agent:"codex"}
  5. nền: runCodexChat(run, prompt)
       emit seleya.message.started {conversationId: sessionId, conversationTitle, assistantMessageId, agentIds: []}
       turn/start {threadId, input:[{type:"text", text: prompt}], effort: config.codex.effort}
       lưu turn.id (cho cancel)
```

`session_id` của Codex là `thread.id`, một UUIDv7, nên vẫn qua được `z.uuid()` hiện có. Seleya phải gửi lại
**đúng `agent`** khi tiếp hội thoại; bridge không đoán agent từ id.

**Ánh xạ sự kiện:** dùng cùng tên và payload với `AnswerMapper` của Claude, nên phía Seleya không phải sửa
gì.

| Codex | `seleya.*` |
|---|---|
| `item/started` `agentMessage` | `seleya.block.started {index, type:"text"}`. Mỗi `agentMessage` (kể cả `phase: commentary`) là một block. |
| `item/agentMessage/delta` | `seleya.block.delta {index, text: delta}` |
| `item/completed` `agentMessage` | Không phát; text đã đủ qua delta. Nếu chưa nhận delta nào thì phát cả `text` thành một delta. |
| `reasoning`, `plan` | Bỏ qua (chat Claude cũng không hiển thị thinking) |
| `turn/completed` `completed` | `seleya.message.completed {message: {id, role:"assistant", createdAt, blocks, trace: undefined, agentIds: [], status:"complete"}}`, rồi `stream.done` |
| `turn/completed` `interrupted` do người dùng huỷ | `seleya.error {code:"cancelled", message:"Stopped.", retryable:false}`, rồi `stream.done` |
| `turn/completed` `failed` | `seleya.error` theo §4.6, rồi `stream.done` |
| App-server chết, hoặc không có `turn/completed` trong 30 s sau `error` | `seleya.error {code:"codex_error", retryable:true}`, rồi `stream.done` |

Hàm dựng `message.completed` có thể copy từ `AnswerMapper.complete` (khoảng 15 dòng) thay vì sửa `claude.ts`.
Khi có agent thứ ba thì mới tách ra thành hàm dùng chung.

**Cancel:** `POST /v1/runs/:id/cancel` vẫn gọi `run.abort.abort()`. `runCodexChat` nghe sự kiện `abort` và gọi
`turn/interrupt`. Nếu cancel đến trước khi có `turn.id`, run kết thúc ngay sau khi `turn/start` trả về.

### 4.6 Lỗi

| Nguồn | `seleya.error.code` | retryable |
|---|---|---|
| `codexErrorInfo: "unauthorized"` | `codex_auth_required`: "Codex on this machine needs you to sign in: run `seleya-bridge codex login`." | false |
| `usageLimitExceeded`, `sessionBudgetExceeded` | `codex_usage_limit` (kèm `additionalDetails` nếu có) | false |
| `contextWindowExceeded` | `codex_context_limit` | false |
| `rateLimitExceeded`, `serverOverloaded`, `httpConnectionFailed`, `responseStream*`, giá trị lạ | `codex_api_error` (kèm `turn.error.message`) | true |
| Item ngoài danh sách cho phép (§4.3) | `codex_policy_violation` | false |
| Tiến trình chết hoặc timeout RPC | `codex_error` | true |

HTTP mới:

- `409 agent_unavailable`
- `404 session_not_found`
- `400 invalid_agent` khi `agent` là `"codex"` trong khi `codex.enabled` đang false. Có thể gộp vào
  `agent_unavailable`.

---

## 5. Thay đổi API và config

### 5.1 Config, tương thích ngược

```jsonc
{
  // ...các key hiện tại giữ nguyên...
  "codex": {
    "enabled": false,      // bật thì bridge spawn app-server lúc khởi động
    "executable": null,    // mặc định "codex" trong PATH
    "model": null,         // mặc định model của Codex
    "effort": null         // "low" | "medium" | "high"
  }
}
```

Config cũ không có khối `codex` vẫn hợp lệ (Codex tắt).

### 5.2 HTTP

| Endpoint | Thay đổi |
|---|---|
| `POST /v1/runs` | Body: `agent?: "claude" \| "codex"`, mặc định `"claude"`. Response thêm `agent`. |
| `GET /v1/health` | Thêm `agents: [{ id: "claude", state: "ready" }, { id: "codex", state: "ready" \| "signed_out" \| "unavailable" \| "disabled", detail? }]`. `detail` có dạng như `"ChatGPT Plus"` hoặc `"codex not found in PATH"` và không chứa email. Các field cũ giữ nguyên. |
| `seleya.message.started` | Thêm `agent` trong `data`; client cũ bỏ qua field này. |
| Còn lại (`/v1/briefings`, `/v1/calendar/weeks`, `/v1/mail/triage`, `/v1/runs/:id/*`, pairing) | **Không đổi** |

Phía Seleya web cần thêm bộ chọn agent cho chat và gửi `agent`, kể cả khi resume. Việc này nằm ngoài repo
bridge.

### 5.3 CLI

`seleya-bridge codex login [--api-key] | status | logout` (§4.4). In lúc khởi động:

```
  codex:           ready (ChatGPT Plus), codex-cli 0.164.0, model default
```

Hoặc, khi chưa đăng nhập:

```
  codex:           signed out — run `seleya-bridge codex login`
```

---

## 6. Bảo mật

| Rủi ro | Biện pháp |
|---|---|
| Codex chạy lệnh hoặc sửa file | Shell và `unified_exec` tắt, sandbox `read-only`, `approvalPolicy:"never"`, mọi approval bị `decline`. Item `commandExecution` hay `fileChange` xuất hiện ⇒ dừng run. |
| Cấu hình cá nhân (`~/.codex`) lọt vào | `CODEX_HOME` riêng; `project_doc_max_bytes=0`; `hooks=false` |
| Codex đọc dữ liệu cá nhân qua apps hoặc MCP | `features.apps=false` và không có `mcp_servers` trong `CODEX_HOME` riêng; item `mcpToolCall` ⇒ dừng run |
| Token ChatGPT | `<bridgeHome>/codex/auth.json` do Codex quản lý, thư mục mode 700. Bridge không đọc hay log file này, và health không trả email. |
| App-server bị truy cập từ ngoài | Chỉ dùng stdio, không bao giờ `--listen ws://` |
| Web page tự chọn agent | Vẫn phải qua origin allowlist, pairing token và ticket như hiện tại. Codex không có tool, nên quyền của nó còn hẹp hơn Claude. |

---

## 7. Spike cần làm trước khi code (≈ ½ ngày)

| # | Câu hỏi | Nếu không được |
|---|---|---|
| S1 | Với config §4.3, model còn tool native nào, ví dụ `update_plan`, `view_image`, `apply_patch`? | Tắt thêm qua config (`include_apply_patch_tool=false`, `tools.view_image=false`); lưới an toàn ở §4.3 vẫn chặn |
| S2 | Đăng nhập device code trong `CODEX_HOME` riêng chạy được với gói ChatGPT hiện tại không? | Dùng `--api-key`, hoặc đăng nhập bằng `CODEX_HOME=… codex login` |
| S3 | Độ trễ của `thread/start` và `thread/resume` (để trả 201 đồng bộ) | Bridge tự sinh `session_id` và lưu map sang `threadId` trong `codex-sessions.json` |
| S4 | Chat thử từ đầu đến cuối: delta, resume, interrupt, lỗi khi chưa đăng nhập | Điều chỉnh ánh xạ ở §4.5 |

---

## 8. Kế hoạch triển khai

| Giai đoạn | Việc | Hoàn thành khi | Ước lượng |
|---|---|---|---|
| **P0 Spike** | S1–S4 bằng script trong scratch | Chốt §4.3 và §4.5 | ½ ngày |
| **P1 Kết nối** | `appServer.ts`, `home.ts`, `status.ts`; khối `codex` trong config; spawn và tắt trong `index.ts`; CLI `codex login/status/logout` | `seleya-bridge codex status` báo đúng; bridge khởi động được khi Codex bật hoặc tắt; app-server chết thì tự spawn lại | 1½ ngày |
| **P2 Chat** | `chat.ts`; nhánh `agent` trong `/v1/runs`; `agents` trong health; cancel; bảng lỗi | Seleya chat được với Codex: stream, resume, cancel, `codex_auth_required`; chat Claude và các report **không đổi hành vi** | 1½ ngày |
| **P3 Test + tài liệu** | §10; cập nhật README (mục Codex, API, security) | `pnpm lint` và `pnpm test` xanh | 1 ngày |

Tổng cộng khoảng **4–5 ngày**.

---

## 9. Hướng mở rộng (chưa làm, ghi lại kết quả research)

Khi muốn Codex làm thêm việc, đây là những gì đã tìm hiểu:

- **Tool workspace** (`read_file`, `list_files`, `search_files`):
  - Khai báo bằng `thread/start.dynamicTools` (`{type:"function", name, description, inputSchema}`).
  - Bridge thực thi khi nhận `item/tool/call` và khoá trong `workspace`.
  - Không bật shell, vì sandbox `read-only` của Codex vẫn đọc được toàn bộ ổ đĩa.
- **Connector:**
  - ChatGPT apps xuất hiện qua MCP server dựng sẵn `codex_apps`. Mỗi tool có `annotations.readOnlyHint` và
    `_meta.connector_name`.
  - Hook `PostToolUse` của Codex **không thay được** output (`updatedMCPToolOutput` "not supported yet").
    Muốn redact trước khi model đọc thì bridge phải tự proxy:
    1. Khai báo tool đọc dưới dạng dynamic tool `{type:"namespace", name:"gmail", tools:[…]}`.
    2. Thực thi qua `mcpServer/tool/call` trên một thread phụ có bật apps.
    3. Redact kết quả rồi mới trả cho model.
  - Chưa xác minh `mcpServer/tool/call` có chạy được trên `codex_apps` hay không.
- **Report** (Briefing, Calendar, Mail):
  - Dùng `turn/start.outputSchema`.
  - Schema phải chuyển sang dạng strict (mọi key nằm trong `required`, field optional thành nullable).
  - Cần tách mapper khỏi `SDKMessage` của Claude.

---

## 10. Test

Dùng `node:test`, có sẵn trong Node 22.18 và chạy thẳng `.ts`, nên không thêm dependency.

- **Unit:**
  - Ánh xạ notification → `seleya.*` (§4.5) bằng fixture JSONL ghi lại từ app-server thật.
  - Bảng lỗi §4.6.
  - Lưới an toàn với item lạ.
  - Trả lời server request (§4.3).
  - Parse config có và không có khối `codex`.
- **Integration với app-server giả:**
  - Một script Node đóng vai `codex app-server`, phát lại kịch bản JSONL.
  - Kiểm tra: chat stream; resume; interrupt; `unauthorized`; tiến trình chết giữa run; spawn lại.
- **Hồi quy:** `POST /v1/runs` không có `agent` vẫn chạy Claude như cũ; các endpoint report không đổi.
- **Thử tay:**
  1. `codex login`, rồi `codex status`.
  2. Health hiển thị agent `codex`.
  3. Chat, resume, huỷ giữa chừng.
  4. Prompt "chạy lệnh ls" hoặc "tạo file", phải nhận lời từ chối hoặc `codex_policy_violation`.

---

## 11. Nguồn

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
- [Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI: Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness)
- Type protocol sinh bằng `codex app-server generate-ts --experimental` (codex-cli 0.164.0), và chạy thử
  `initialize`, `account/read`, `app/list`, `mcpServerStatus/list` trên máy này.
