# Spec: lịch chạy agent qua seleya-server (server link)

Trạng thái: **Bridge đã implement (B1, B2); server và web đang làm**, bản 2 · Ngày: 2026-10-24 · Liên quan: [gateway.md](gateway.md)

Bridge, Seleya web và seleya-server **chưa phát hành phiên bản nào**: API mới thay thẳng API hiện tại, không
có lớp tương thích.

Mục tiêu: người dùng đặt lịch chạy (Daily Briefing, Mail, Calendar…) và preference **trên Seleya web**. Lịch
được **lưu trong database của seleya-server**. Server **đẩy lịch và lệnh xuống bridge** qua một kết nối do bridge
mở ra. Bridge **tự chạy theo lịch** trên máy người dùng, kể cả khi không có tab Seleya nào mở.

Quyết định đã chốt:

- Server lưu **lịch, template và trạng thái** của các lần chạy. Server **không bao giờ** nhận output, chữ trả
  lời, thought hay input của tool.
- **Output ở lại bridge** (lưu trên đĩa, mode 600). Web **đọc output từ bridge local**.

---

## 1. Bối cảnh

### 1.1 Vấn đề

| Thành phần | Hiện trạng | Hệ quả |
|---|---|---|
| Web (`src/service/bridge-tasks/*`) | Task definition (prompt, schema zod, `finish`) nằm ở browser. Mọi run do người dùng bấm tay | Không có tab mở thì không có briefing |
| Web (localStorage `seleya.bridge.<uid>.briefing`, `.mail`, `.calendar`) | Kết quả chỉ nằm trong browser đã bấm chạy | Browser khác, profile khác hay máy khác không thấy |
| Bridge (`runs.ts`) | Run đã xong giữ trong RAM 10 phút. Run thuộc về token đã tạo nó | Bridge không giữ được kết quả cho lần mở web sau |
| Bridge (`server.ts`) | Chỉ nghe `127.0.0.1`, chỉ browser gọi vào | Server không gọi xuống bridge được |
| seleya-server | Chỉ còn sign-in và `/me`. DB có `users`, `audit_log` | Không có chỗ lưu lịch, không có kênh tới bridge |
| Web (`Automation`, `AgentDraft.schedule`) | Chỉ là mock | |

### 1.2 Mục tiêu

- Lịch chạy và preference được tạo và sửa trên web, lưu ở seleya-server, áp dụng cho bridge của người dùng.
- Bridge tự chạy theo lịch. Máy vừa ngủ dậy thì chạy bù lần bị lỡ gần nhất.
- Server ra lệnh được cho bridge theo thời gian thực: chạy ngay, huỷ, cấu hình vừa đổi.
- Kết quả, của run tay lẫn run theo lịch, nằm ở bridge. Mọi browser đã pair trên máy đều đọc được.
- Server có lịch sử trạng thái của run (thành công hay lỗi, mã lỗi, thời lượng, connector nào đọc được) để
  hiển thị, **không có nội dung**.
- Server không cần scheduler, WebSocket hay SSE mới.

### 1.3 Ngoài phạm vi

- Upload output lên server, xem kết quả trên thiết bị không chạy bridge.
- Trigger theo sự kiện (mail mới, webhook…). Spec này chỉ lo lịch theo thời gian và lệnh "chạy ngay".
- Một lịch chạy trên nhiều máy (failover). Mỗi lịch gắn với đúng một máy (§7.1).
- Mã hoá kết quả trên đĩa bằng Keychain (§13).
- Đưa task definition về backend (câu hỏi mở 2 của gateway.md). Spec này giữ task ở web, server chỉ lưu
  bản template web dựng ra.

---

## 2. Các quyết định thiết kế

| # | Quyết định | Lý do | Phương án đã bỏ |
|---|---|---|---|
| D1 | **Bridge mở kết nối ra server** (HTTPS long-poll) | Bridge chỉ nghe loopback, nằm sau NAT. Server không gọi xuống được | Server gọi vào bridge: không thể |
| D2 | **Long-poll** thay vì WebSocket hay SSE | Server có grpc-gateway (unary) và Redis, không có thư viện WS. Long-poll chạy qua proxy `/api` hiện tại, không cần sticky routing giữa các replica | WebSocket: thêm thư viện, handler riêng, nginx upgrade, routing theo pod |
| D3 | **Bridge giữ đồng hồ**, server giữ dữ liệu gốc | Máy ngủ thì server cũng không chạy hộ được. Bridge biết lúc nào máy thức để chạy bù. Server không cần scheduler. Bridge lưu bản cấu hình cuối, nên server sập thì lịch vẫn chạy | Server tick rồi đẩy job: cần vòng scheduler, phải xử lý máy offline, lỡ lịch khi mạng chập chờn |
| D4 | **Template là `RunRequest` có biến**, bridge điền biến lúc chạy | Bridge vẫn không chứa logic nghiệp vụ (gateway.md §3.1). Prompt của run tay và run theo lịch giống hệt nhau | Port task sang Go: hai chỗ giữ prompt. Bridge có registry task: trái nguyên tắc gateway |
| D5 | **Output lưu ở bridge** (`ResultStore`), web đọc qua `GET /v1/results/:key` | Đã chốt: dữ liệu connector không rời máy | Upload lên server |
| D6 | Server chỉ nhận **báo cáo dạng enum và số đếm** | Kênh báo cáo không thể dùng để chuyển dữ liệu ra ngoài (§9) | Báo cáo có `message` tự do |
| D7 | Liên kết bằng **enrollment token** web chuyển cho bridge qua kênh đã pair | Dùng lại pairing có sẵn, người dùng không phải copy mã | Bridge tự đăng nhập Google: cần OAuth trên máy |
| D8 | Server URL = **Origin của browser** + `server_path` | Một origin đã pair không trỏ được bridge sang server khác | Web gửi URL tuỳ ý: origin bị XSS chuyển được bridge sang server lạ |
| D9 | Run do server yêu cầu có **policy riêng, hẹp hơn** browser (§6.5) | Server là principal mới. Nếu bị chiếm, nó không được làm nhiều hơn cần thiết | Coi server như browser đã pair |

---

## 3. Kiến trúc

```
                    ┌──────────────── seleya-server ────────────────┐
 Seleya web ─/api──▶│ ScheduleService, BridgeService (session auth) │
 (lịch, preference, │      │ ghi DB, bump config_revision           │
  liên kết máy,     │      ▼ PUBLISH bridge:wake:<device>            │
  "chạy ngay")      │ BridgeLinkService (device auth)                │
                    │   poll (long-poll ≤25s) · reports · enroll     │
                    └──────────────────▲─────────────────────────────┘
                                       │ HTTPS, bridge mở ra
 ┌──────────────────── seleya-bridge (máy người dùng) ─────────────────────────┐
 │ LinkClient ── config ──▶ Scheduler ── job ──▶ startRun (policy → engine) ──▶ provider │
 │      ▲  báo cáo (outbox)                              │                       │
 │      └────────────────────────────────────────────────┤                       │
 │                                                        ▼                       │
 │                                                  ResultStore (đĩa, 600)        │
 │ HTTP 127.0.0.1:47821: /v1/runs, /v1/results, /v1/link ◀── Seleya web (browser) │
 └──────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Các luồng chính

**Liên kết máy (một lần):**

1. Web (đã pair với bridge) gọi server `POST /bridge/devices/enrollments` và nhận `enrollment_token` (5 phút,
   dùng một lần).
2. Web gọi bridge `POST /v1/link { enrollment_token }`.
3. Bridge gọi `POST {origin}{server_path}/bridge/v1/enroll`, nhận `device_id` và `device_token`, lưu
   `link.json`.
4. Bridge bắt đầu poll.

**Đặt lịch:**

1. Web dựng template từ task (§5) rồi gọi `POST /schedules`.
2. Server ghi DB, tăng `config_revision` của máy, `PUBLISH` wake.
3. Poll đang treo của bridge trả về ngay với cấu hình mới.
4. Bridge lưu cấu hình xuống `link-config.json` và tính lại giờ chạy.

**Chạy theo lịch:**

1. Tới giờ, Scheduler đưa job vào hàng đợi.
2. Khi bridge rảnh, job đi qua đúng policy và engine của `POST /v1/runs`.
3. Output vào `ResultStore`.
4. Báo cáo `started` rồi `completed` hoặc `failed` vào outbox và gửi lên server.

**Chạy ngay từ xa** (web đang mở ở thiết bị khác):

1. Web gọi `POST /schedules/{id}/run`.
2. Server tạo command và `PUBLISH` wake.
3. Bridge nhận command trong lần poll, chạy và báo cáo. Kết quả chỉ xem được trên máy đó (§10).

**Web xem kết quả:** web gọi bridge `GET /v1/results/<key>`. Nếu có run theo lịch đang chạy, `GET /v1/link`
trả `active_run`, và web mở stream như run của chính nó.

---

## 4. Dữ liệu nằm ở đâu

| Dữ liệu | Ở đâu | Rời máy người dùng? |
|---|---|---|
| Lịch (timing, time zone, bật/tắt), tên | Server `schedules` | Có (do người dùng tạo trên web) |
| Template (prompt, system prompt có biến, output schema, connector, limits, `store.meta`) | Server `schedules.template`, bản sao ở bridge `link-config.json` | Có, nhưng đây là prompt của Seleya, không có dữ liệu người dùng |
| Preference (`favorite_agent_ids`, số ngày mail, …) | Server `user_preferences` | Có |
| Output, text, sources, connector errors của run | Bridge `results/` | **Không** |
| Trạng thái run: status, mã lỗi, thời lượng, connector id đã đọc, loại lỗi connector, số giá trị đã redact | Server `schedule_runs` | Có, chỉ enum và số |
| Device token | Bridge `link.json` (600), server lưu SHA-256 | Không (chỉ hash ở server) |
| Pairing token của browser | Không đổi (gateway.md) | Không |

Câu "Nothing leaves it" ở web (`methodMeta.local.description`) đổi thành: *"Results stay on this machine.
Seleya only keeps your schedules and whether each run worked."*

---

## 5. Template và biến

### 5.1 Request

`POST /v1/runs` có thêm hai field tuỳ chọn. Run theo lịch dùng đúng hình dạng này (§6.4).

```jsonc
{
  "prompt": "Create the user's Daily Briefing. It is {{now_text}} ({{time_zone}}). You can read: {{connectors}}.",
  "system_prompt": "…",
  "connectors": "all",
  "output_schema": { /* … */ },
  "limits": { "max_turns": 40 },

  "template": {                 // có thì bridge điền biến vào prompt và system_prompt
    "week_offset": 0            // tuỳ chọn, -4…8: tuần của {{week_start}}
  },
  "store": {                    // có thì output được lưu vào ResultStore (§6.2)
    "key": "u_01J…:briefing",
    "meta": { "task_id": "briefing", "task_version": 7, "input": {} }   // ≤ 8 KB, trả lại nguyên vẹn
  }
}
```

### 5.2 Biến

Cú pháp là `{{name}}`. Biến ngày nhận thêm độ lệch theo ngày: `{{name:+N}}` hoặc `{{name:-N}}`, với N từ 0 đến
31. Mọi giá trị tính theo múi giờ của máy (`Intl.DateTimeFormat().resolvedOptions().timeZone`), cùng nguồn với
`capabilities.time_zone`.

| Biến | Ví dụ | Ghi chú |
|---|---|---|
| `now` | `2026-10-24T08:00:00+07:00` | ISO 8601 có offset, tới phút |
| `now_text` | `Saturday, October 24, 2026 at 8:00 AM` | `en-US`, giống `nowLabel` hiện tại của web |
| `today` | `2026-10-24` | Biến ngày |
| `time_zone` | `Asia/Ho_Chi_Minh` | IANA |
| `week_start` | `2026-10-19` | Thứ Hai của tuần hiện tại cộng `week_offset`. Biến ngày: `{{week_start:+4}}` là thứ Sáu |
| `connectors` | `Gmail, Google Calendar` | Tên các connector run thật sự nhận (sau `"all"` và policy). Không có connector nào thì là `none` |

Quy tắc:

- Chỉ thay trong `prompt` và `system_prompt`, **trước** khi ghép preamble (gateway.md §8.1). Độ dài được kiểm
  tra trên bản gốc (schema) và kiểm tra lại sau khi điền (`400 invalid_request` nếu vượt).
- Biến đổi theo phút (`{{now}}`, `{{now_text}}`) nên nằm trong `prompt`, không nằm trong `system_prompt`, để
  provider vẫn cache được system prompt.
- `}}` đứng một mình là chữ thường (JSON lồng nhau kết thúc bằng `}}`); `{{` còn sót lại sau khi điền là lỗi.
- Nếu `{{…}}` không phải biến đã biết hoặc sai cú pháp thì trả `400 invalid_template` (`details: {variable}`). Thêm
  biến mới là thay đổi phải công bố trong `capabilities.features.template_vars` (§6.1).
- Không có `template` thì không thay gì, giữ đúng hành vi hiện tại.
- Giá trị đã điền được trả lại trong `run.started.template_vars` và lưu trong kết quả (`vars`). Web dựng lại
  `BridgeTaskContext` (`now`, `timeZone`, `input`) cho `finish` từ đó.

Biến chỉ là ngày giờ và tên connector, không có khái niệm sản phẩm nào, nên D4 không trái gateway.md §3.1.

### 5.3 Hệ quả cho web

Task không dựng prompt bằng giá trị thật nữa (`nowLabel(now, timeZone)`, `label(monday)`) mà dùng biến. Run tay và
run theo lịch dùng **cùng một** hàm `renderRequest(task, input)`, nên hai loại run luôn có prompt giống nhau (§8.1).

---

## 6. Bridge

### 6.1 API mới và API thay đổi

Mọi endpoint dưới đây đòi `Authorization: Bearer <pairing token>` như gateway.md §5.

| Method | Path | Mô tả |
|---|---|---|
| `POST` | `/v1/runs` | Thêm `template`, `store` (§5.1) |
| `GET` | `/v1/results` | Danh sách kết quả (không có output) |
| `GET` | `/v1/results/:key` | Một kết quả đầy đủ |
| `DELETE` | `/v1/results/:key` | Xoá một kết quả |
| `GET` | `/v1/link` | Trạng thái liên kết, lịch, lần chạy kế tiếp, run đang chạy |
| `POST` | `/v1/link` | Liên kết với tài khoản Seleya (enrollment token) |
| `DELETE` | `/v1/link` | Huỷ liên kết |
| `GET` | `/v1/capabilities` | Thêm `features` ở cấp gốc (hiện chỉ có `providers[].features`): `{ template_vars: [...], results: true, link: true }` |

`GET /v1/results` trả:

```jsonc
{ "results": [ { "key": "u_01J…:briefing", "status": "completed", "finished_at": "…", "trigger": "schedule",
                 "schedule_id": "sch_…", "meta": { … }, "has_failure": false } ] }
```

`GET /v1/results/:key` trả:

```jsonc
{
  "key": "u_01J…:briefing",
  "latest": {                       // lần completed gần nhất; null nếu chưa có
    "run_id": "…", "finished_at": "…", "trigger": "manual",   // manual | schedule | catch_up | remote
    "schedule_id": null,
    "meta": { … },                  // store.meta, nguyên vẹn
    "vars": { "now": "…", "time_zone": "…", "week_start": "…", "connectors": "…" },
    "output": { … },                // đã redact, như run.output
    "text": "…",
    "sources": [ … ], "connector_errors": [ … ], "redactions": 3
  },
  "last_failure": {                 // chỉ khi mới hơn latest; null nếu không
    "run_id": "…", "finished_at": "…", "trigger": "schedule", "schedule_id": "sch_…",
    "meta": { … }, "error": { "code": "provider_auth_required", "message": "…", "retryable": true },
    "connector_errors": [ … ]
  }
}
```

Lỗi: `404 result_not_found`, `400 invalid_key`.

`GET /v1/link` trả:

```jsonc
{
  "linked": true,
  "server": "https://seleya.example.com/api",
  "user_id": "01J…", "device_id": "dev_…", "device_name": "MacBook của Dung",
  "state": "online",               // online | connecting | offline | revoked | unlinked
  "last_sync_at": "…", "config_revision": 13,
  "paused": false,                 // link.enabled = false trong config, hoặc server tạm dừng
  "schedules": [
    { "id": "sch_…", "name": "Daily Briefing", "enabled": true, "next_run_at": "…",
      "last_run": { "scheduled_for": "…", "status": "completed", "code": null, "result_key": "u_01J…:briefing" } }
  ],
  "queue": [ { "schedule_id": "sch_…", "scheduled_for": "…", "trigger": "catch_up" } ],
  "active_run": { "run_id": "…", "schedule_id": "sch_…" }   // null khi không có run theo lịch nào đang chạy
}
```

`POST /v1/link { enrollment_token, server_path?: "/api", device_name? }`:

- Server = `Origin` của request + `server_path` (D8). `server_path` khớp `^/[A-Za-z0-9/_-]{0,100}$`. Origin phải
  https, trừ origin loopback (cùng luật với `allowedOrigins`).
- Bridge gọi enroll (§7.4). Thành công thì ghi `link.json`, trả hình dạng của `GET /v1/link`.
- Lỗi:
  - `409 already_linked` (`details: {user_id}`): đã liên kết với một tài khoản khác, phải huỷ trước. Liên kết lại
    cùng tài khoản thì thay token cũ.
  - `401 enrollment_invalid`
  - `502 server_unreachable`
  - `400 invalid_request`

`DELETE /v1/link`: gọi `POST /bridge/v1/unlink` (best effort, timeout 3s), xoá `link.json`, `link-config.json`,
`schedule-state.json` và outbox, huỷ run theo lịch đang chạy. **Giữ** `results/`; người dùng xoá riêng. Trả `204`.

CLI: `seleya-bridge link` (in trạng thái), `seleya-bridge unlink`.

### 6.2 ResultStore

- Thư mục `<home>/results/` (mode 700), mỗi (origin, key) một file `<sha256(origin + "\n" + key)>.json` (mode 600). Ghi kiểu atomic
  (file tạm rồi `rename`).
- `key` khớp `^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$`. Web đặt key có user id (`u_<userId>:briefing`,
  `u_<userId>:calendar:2026-10-19`) để hai tài khoản Seleya dùng chung một máy không đè kết quả của nhau.
- Mỗi key giữ một `latest` và tối đa một `last_failure`. Run completed xoá `last_failure` cũ hơn nó. Run bị
  huỷ (`cancelled`) không được ghi.
- Output lưu đúng như `run.output` **đã redact** (gateway.md §6.5). Bridge không redact lại `meta`, vì đó là
  dữ liệu web tự gửi.
- Giới hạn:
  - Tối đa `results.maxKeys` (200). Vượt thì xoá key cũ nhất.
  - Kết quả nào cũ hơn `results.retentionDays` (14) thì bị xoá khi bridge khởi động và sau mỗi lần ghi.
  - Một file tối đa 2 MB. Vượt thì không lưu, và kết quả ghi `store_failed` vào `run.completed.store`.
- Ai đọc được: **mọi pairing token còn hiệu lực có cùng origin** với run đã ghi. Run theo lịch thì là origin của
  liên kết (`link.origin`). Đây là chỗ nới lỏng có chủ ý so với quyền sở hữu run (gateway.md §8.2): kết quả
  theo lịch phải đọc được từ browser không tạo ra run. Bridge là của một user hệ điều hành, và threat model vẫn
  là "origin đã pair là đáng tin". Một origin khác (ví dụ localhost khi dev) không thấy kết quả của origin
  production.
- `run.completed` của run có `store` thêm `store: { key, ok }`.

### 6.3 LinkClient

`link.json`: `{ server, origin, device_id, device_token, user_id, device_name, linked_at }`, mode 600.

Vòng lặp:

```
while linked:
  if !config.link.enabled: chờ tới khi bật
  res = POST {server}/bridge/v1/poll { config_revision, status, acks }      // timeout 35s
  200 → nếu config_revision đổi: ghi link-config.json, scheduler.apply(config)
        với mỗi command: scheduler.command(cmd); thêm id vào acks
        poll lại ngay
  401 device_revoked → huỷ liên kết tại chỗ (như DELETE /v1/link, giữ results), state = revoked
  409 bridge_outdated → state = offline, lặp lại sau 1h (details.min_version)
  lỗi mạng / 5xx / 429 → backoff 1s, 2s, 4s… tối đa 60s, jitter ±20%; state = offline sau 3 lần liên tiếp
```

`status` gửi kèm mỗi poll:

```jsonc
{
  "bridge_version": "0.2.0", "platform": "darwin-arm64", "time_zone": "Asia/Ho_Chi_Minh",
  "busy": false, "paused": false,
  "providers": [ { "id": "claude", "state": "ready" } ],
  "connectors": [ { "id": "gmail", "state": "connected" }, { "id": "calendar", "state": "needs-auth" } ]
}
```

Không gửi email tài khoản, danh sách tool hay đường dẫn workspace.

**Outbox báo cáo** (`link-outbox.json`, tối đa 500 mục, cũ nhất bị bỏ trước): mỗi thay đổi trạng thái của job thêm
một báo cáo. Bridge gửi theo lô qua `POST /bridge/v1/reports` (tối đa 50 mục một lần) sau mỗi poll và ngay khi
có mục mới. Server trả `200` thì xoá các mục đó. Báo cáo idempotent theo `report_id`.

`link-config.json` là bản cấu hình cuối cùng nhận được. Khi bridge khởi động, Scheduler chạy theo file này
**trước** khi poll thành công, nên lịch vẫn chạy khi mất mạng hoặc server sập.

### 6.4 Scheduler

**Timing** (giống hình dạng `Automation.schedule` sẵn có ở web):

```jsonc
{ "kind": "weekly",   "days": ["Mon","Tue","Wed","Thu","Fri"], "time": "08:00" }
{ "kind": "interval", "days": ["Mon","Tue","Wed","Thu","Fri"], "from": "08:00", "to": "19:00", "every_minutes": 120 }
```

- Tính theo `schedule.time_zone` (IANA) bằng `Intl`. Giờ không tồn tại khi chuyển DST thì dời tới giờ hợp lệ kế
  tiếp. Giờ lặp lại thì lấy lần đầu.
- `interval`: mốc đầu tiên ở `from`, sau đó mỗi `every_minutes`, mốc cuối không quá `to`. `every_minutes` ≥
  `link.minIntervalMinutes` (30).

**Đồng hồ:** một `setTimeout` tới mốc gần nhất, tối đa 60s rồi tính lại. Nếu thời gian thực tế trôi hơn 2 phút
so với dự kiến (máy ngủ dậy hoặc đổi giờ) thì chạy bước chạy bù.

**Hàng đợi:** FIFO, mỗi lịch giữ tối đa một job (job mới thay job cũ của cùng lịch). Một job là
`{ schedule_id, scheduled_for, trigger: schedule | catch_up | remote, command_id? }`.

**Chạy một job,** khi `runs.busy === false`. Bridge nghe `onBusyChange`, nên run tay của browser luôn được ưu
tiên vì nó chiếm `busy` trước:

1. Hết hạn (`now > scheduled_for + template.expires_after_minutes`, mặc định 120) thì bỏ, báo `skipped expired`.
2. Vượt `link.maxRunsPerDay` (24, cửa sổ trượt 24h, chỉ đếm run theo lịch) thì bỏ, báo `skipped daily_limit`.
3. Provider chưa `ready` hoặc connector đang `discovering` thì chờ tối đa 5 phút, sau đó báo `failed
   provider_unavailable`.
4. Dựng `RunRequest` từ `schedule.template.request`, áp **link policy** (§6.5), rồi gọi `startRun(body, owner =
   LINK_OWNER)`. Hàm này tách ra từ handler `POST /v1/runs` hiện tại, nên dùng chung `buildRunSpec`, kiểm tra
   `busy`, `runs.create` và `runOnce` (gateway.md §8.4).
5. Lỗi policy (`connector_unavailable`, `invalid_template`, `model_not_allowed`…) thì báo `failed <code>`.
6. Báo `started`. Khi run kết thúc, kết quả vào ResultStore (`template.store`), rồi báo `completed`, `failed`
   hoặc `cancelled`.

**Chạy bù:** khi khởi động, khi máy ngủ dậy, khi vừa áp cấu hình mới, và ở mỗi lần đánh thức (≤ 60s), với mỗi
lịch đang bật (một luật chung cho cả chạy đúng giờ: trễ ≤ 2 phút là `schedule`, trễ hơn là `catch_up`):

- Gọi `prev` là mốc gần nhất ≤ now.
- Nếu `prev > state.last_scheduled_for` và `now - prev ≤ template.catch_up_minutes` (mặc định bằng
  `expires_after_minutes`) thì thêm một job `catch_up` cho `prev`. Chỉ chạy bù **lần gần nhất**, không chạy
  từng lần bị lỡ.
- Lịch vừa tạo không chạy bù mốc trước thời điểm tạo (`created_at`).
- Mốc quá cửa sổ chạy bù được báo `skipped expired`, trừ khi đây là lần đầu bridge thấy lịch đó (vừa liên kết,
  vừa nhận lịch): khi đó chỉ đánh dấu đã xử lý, không báo.

**Command:**

- `run_now { id, schedule_id, expires_at }` thêm job `remote`, hết hạn theo `expires_at`.
- `cancel { id, schedule_id }` bỏ job khỏi hàng đợi, hoặc `abort` run theo lịch đang chạy của lịch đó.
- Command được ack trong poll kế tiếp. Id đã xử lý giữ 100 cái gần nhất trong state để bỏ trùng.

`schedule-state.json` (600): `{ [schedule_id]: { last_scheduled_for, last_run: { run_id, status, code, at,
result_key } } }`, cùng `processed_commands` và lịch sử đếm của `maxRunsPerDay`.

### 6.5 Link policy và config

```jsonc
// config.json
{
  "link": {
    "enabled": true,              // false: không poll, không chạy theo lịch (app: "Pause schedules")
    "connectors": "all",          // trần connector cho run theo lịch, giao với `connectors`
    "maxRunsPerDay": 24,
    "minIntervalMinutes": 30
  },
  "results": { "retentionDays": 14, "maxKeys": 200 }
}
```

Run theo lịch luôn bị ép như sau, **trước** `buildRunSpec`:

| Field | Ép thành | Lý do |
|---|---|---|
| `workspace_tools` | `[]` | Server không có lý do đọc file trên máy |
| `session` | bỏ (không persist, không resume) | Không để lại transcript; server không tiếp tục hội thoại của browser nào |
| `connectors` | Giao với `link.connectors`. Một id ngoài trần thì `failed connector_not_allowed` | Người dùng giới hạn được những gì server yêu cầu đọc |
| `provider`, `model`, `limits` | Như browser (allowlist, kẹp trần) | |

`LINK_OWNER = "link"`. `GET /v1/runs/:id`, `tickets` và `cancel` chấp nhận chủ sở hữu thật, **hoặc**
`run.ownerId === "link"` khi origin của token bằng `link.origin`. Nhờ vậy web xem và dừng được run theo lịch
(§6.2, cùng lý do).

### 6.6 App (macOS)

- Overview thêm thẻ **Seleya account**: đã liên kết hay chưa, tài khoản, state, nút *Unlink*.
- Thẻ **Schedules**: tên, lần chạy kế tiếp, kết quả lần cuối, công tắc *Pause schedules* (`link.enabled`).
- Log ghi mỗi run theo lịch: giờ, lịch, kết quả. Không ghi nội dung.
- Thông báo hệ thống tuỳ chọn khi một run theo lịch xong ("Daily Briefing is ready"). Thông báo không chứa nội
  dung run.
- *Start at Login* đã có. Spec khuyến nghị bật mặc định khi người dùng liên kết máy.

### 6.7 Cấu trúc file

```
src/
  runs/start.ts         startRun(body, owner): tách từ server.ts (policy → busy → create → runOnce)
  engine/template.ts    điền biến (§5.2), invalid_template
  results.ts            ResultStore
  link/
    store.ts            link.json, link-config.json, schedule-state.json, outbox
    client.ts           LinkClient: poll, backoff, reports
    scheduler.ts        timing, hàng đợi, chạy bù, command
    timing.ts           mốc kế tiếp theo IANA time zone, DST
    policy.ts           link policy (§6.5), LINK_OWNER
    service.ts          LinkService: ghép store, scheduler, client; view cho GET /v1/link và app
  server.ts             thêm /v1/results*, /v1/link*; quyền xem run "link"
  bridge.ts             khởi động ResultStore, LinkClient, Scheduler; dừng chúng trong stop()
```

---

## 7. seleya-server

Server **không** có scheduler. Mọi việc đều là CRUD cộng một long-poll.

### 7.1 Data model (migration `000002_bridge_link`)

```sql
CREATE TABLE bridge_devices (
  id              VARCHAR(32) PRIMARY KEY,
  user_id         VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  token_hash      CHAR(64)     NOT NULL UNIQUE,      -- sha256 hex của device token
  platform        VARCHAR(32),
  bridge_version  VARCHAR(32),
  time_zone       VARCHAR(64),
  status          JSONB        NOT NULL DEFAULT '{}', -- status của poll gần nhất (§6.3)
  config_revision BIGINT       NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX bridge_devices_user ON bridge_devices (user_id) WHERE revoked_at IS NULL;

CREATE TABLE schedules (
  id           VARCHAR(32) PRIMARY KEY,
  user_id      VARCHAR(32) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    VARCHAR(32) NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,
  task_id      VARCHAR(64)  NOT NULL,                -- "briefing", "mail", "calendar", …
  task_version INT          NOT NULL,
  name         VARCHAR(200) NOT NULL,
  enabled      BOOLEAN      NOT NULL DEFAULT true,
  timing       JSONB        NOT NULL,                -- §6.4
  time_zone    VARCHAR(64)  NOT NULL,
  template     JSONB        NOT NULL,                -- §7.3
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX schedules_device ON schedules (device_id);

CREATE TABLE schedule_runs (
  report_id      UUID PRIMARY KEY,                   -- do bridge sinh, idempotent
  schedule_id    VARCHAR(32) NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  device_id      VARCHAR(32) NOT NULL,
  user_id        VARCHAR(32) NOT NULL,
  command_id     VARCHAR(32),
  trigger        VARCHAR(16) NOT NULL,               -- schedule | catch_up | remote
  scheduled_for  TIMESTAMPTZ NOT NULL,
  status         VARCHAR(16) NOT NULL,               -- started | completed | failed | skipped | cancelled
  code           VARCHAR(48),
  retryable      BOOLEAN,
  task_version   INT,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  duration_ms    INT,
  connectors_read  TEXT[]  NOT NULL DEFAULT '{}',
  connector_errors JSONB   NOT NULL DEFAULT '[]',    -- [{connector, kind}]
  redactions     INT,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX schedule_runs_schedule ON schedule_runs (schedule_id, scheduled_for DESC);

CREATE TABLE bridge_commands (
  id          VARCHAR(32) PRIMARY KEY,
  device_id   VARCHAR(32) NOT NULL REFERENCES bridge_devices(id) ON DELETE CASCADE,
  user_id     VARCHAR(32) NOT NULL,
  kind        VARCHAR(16) NOT NULL,                  -- run_now | cancel
  schedule_id VARCHAR(32) NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  acked_at    TIMESTAMPTZ
);
CREATE INDEX bridge_commands_pending ON bridge_commands (device_id) WHERE acked_at IS NULL;

CREATE TABLE user_preferences (
  user_id    VARCHAR(32) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- Id theo `internal/ids`.
- Mọi thay đổi tới `schedules` của một máy (tạo, sửa, xoá) tăng `bridge_devices.config_revision` trong **cùng
  transaction**, rồi `PUBLISH` sau khi commit.
- Thu hồi máy là soft delete (`revoked_at`). Lịch của máy đó vẫn còn để web cho người dùng chuyển sang máy khác
  (`PATCH /schedules/{id} {device_id}`). Xoá hẳn máy (`DELETE … ?purge=true`) thì cascade.
- `schedule_runs` giữ 100 dòng mới nhất mỗi lịch, xoá phần dư khi insert (không cần cron).

### 7.2 Xác thực device

- Device token: 32 byte ngẫu nhiên, base64url, gửi trong header `Authorization: Device <token>`.
- Thêm `middleware.IsBridgeLinkAPI(fullMethod)`, đúng với `/seleya_server.v1.BridgeLinkService/`.
  - Method thuộc service này chỉ nhận device token: tra `token_hash`, kiểm tra `revoked_at IS NULL`, đặt `user_id`
    và `device_id` vào context (`authctx`). Session cookie và staff bearer bị từ chối.
  - `Enroll` được miễn auth (token nằm trong body), có rate limit theo IP (10/phút).
  - Mọi method khác: scheme `Device` trả `401 unauthenticated`. **Device token không bao giờ gọi được API của người
    dùng.**
- Kết quả tra token cache trong Redis 60s. Thu hồi máy thì xoá cache, nên lần gọi kế tiếp nhận `401
  device_revoked`.
- `last_seen_at` ghi mỗi poll. Máy được coi là **online** nếu `last_seen_at` trong vòng 90s.

### 7.3 API cho web (session auth)

Service `BridgeService` và `ScheduleService`, JSON snake_case qua grpc-gateway như `UserService`.

| Method | Path | Body / Response |
|---|---|---|
| `POST` | `/bridge/devices/enrollments` | → `{ enrollment_token, expires_at }` (5 phút, một lần dùng) |
| `GET` | `/bridge/devices` | → `[{ id, name, platform, bridge_version, time_zone, online, last_seen_at, revoked, status }]` |
| `PATCH` | `/bridge/devices/{id}` | `{ name }` |
| `DELETE` | `/bridge/devices/{id}` | Thu hồi (`?purge=true` xoá hẳn) → `204` |
| `GET` | `/schedules?device_id=` | → `[Schedule]` |
| `POST` | `/schedules` | `{ device_id, task_id, task_version, name, enabled, timing, time_zone, template }` → `Schedule` |
| `PATCH` | `/schedules/{id}` | Field bất kỳ ở trên → `Schedule` |
| `DELETE` | `/schedules/{id}` | → `204` |
| `POST` | `/schedules/{id}/run` | `{ expires_in_minutes?: 15 }` → `{ command_id, device_online }` |
| `POST` | `/schedules/{id}/cancel` | → `{ command_id }` |
| `GET` | `/schedules/{id}/runs?limit=20` | → `[ScheduleRun]` (§7.1, bỏ `user_id`) |
| `GET` | `/me/preferences` | → `{ data }` |
| `PATCH` | `/me/preferences` | `{ data }`: merge nông theo key, `null` xoá key → `{ data }` |

`template` (server kiểm tra hình dạng và kích thước, không diễn giải):

```jsonc
{
  "request": { /* RunRequest của bridge (gateway.md §5.2 + §5.1 ở đây), BẮT BUỘC có "template" và "store" */ },
  "expires_after_minutes": 120,   // 5…1440
  "catch_up_minutes": 120         // 0…1440, ≤ expires_after_minutes
}
```

Kiểm tra phía server:

- `template` ≤ 128 KB. `request.prompt` là chuỗi không rỗng. Không có `request.session`, và
  `request.workspace_tools` rỗng (bridge cũng ép như vậy, §6.5; server từ chối sớm để web biết).
- `timing`: `days` ⊂ Mon…Sun và không rỗng; `time`, `from`, `to` dạng `HH:MM`; `every_minutes` từ 30 tới 1440.
- `time_zone` hợp lệ theo `time.LoadLocation`.
- `device_id` thuộc người dùng và chưa bị thu hồi.
- Tối đa 50 lịch mỗi máy.

Lỗi theo `apperr`: `invalid_request` / `Validation` (field sai), `not_found`, `Conflict("device_revoked", …)`,
`Conflict("too_many_schedules", …)`.

### 7.4 API cho bridge (device auth)

Service `BridgeLinkService`:

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/bridge/v1/enroll` | `{ enrollment_token, name, platform, bridge_version, time_zone }` | `{ device_id, device_token, user_id }` |
| `POST` | `/bridge/v1/poll` | `{ config_revision, status, acks: [command_id] }` | `{ config_revision, config?, commands: [Command] }` |
| `POST` | `/bridge/v1/reports` | `{ reports: [Report] }` (≤ 50) | `{ accepted: n }` |
| `POST` | `/bridge/v1/unlink` | `{}` | `204` (tự thu hồi) |

`enroll`:

- `GETDEL` trong Redis key `<prefix>:bridge:enroll:<sha256(token)>` để lấy `user_id`. Không có thì trả `401
  enrollment_invalid`.
- Tạo `bridge_devices`. Nếu cùng `user_id` và cùng `name` có một máy chưa thu hồi **không online** thì thu hồi máy
  đó (liên kết lại sau khi cài lại app).

`poll`:

```jsonc
// response
{
  "config_revision": 13,
  "config": {                         // chỉ khi revision khác revision bridge gửi lên
    "schedules": [
      { "id": "sch_…", "name": "Daily Briefing", "task_id": "briefing", "task_version": 7, "enabled": true,
        "timing": { … }, "time_zone": "Asia/Ho_Chi_Minh", "created_at": "…", "template": { … } }
    ]
  },
  "commands": [ { "id": "cmd_…", "kind": "run_now", "schedule_id": "sch_…", "expires_at": "…" } ]
}
```

`Report`:

```jsonc
{
  "report_id": "uuid", "schedule_id": "sch_…", "command_id": null,
  "trigger": "schedule",              // schedule | catch_up | remote
  "scheduled_for": "…", "status": "completed",   // started | completed | failed | skipped | cancelled
  "code": null,                       // RunFailureCode (gateway.md §7) | expired | daily_limit | provider_unavailable
                                      // | connector_not_allowed | connector_unavailable | invalid_template
                                      // | model_not_allowed | store_failed
  "retryable": null, "task_version": 7,
  "started_at": "…", "finished_at": "…", "duration_ms": 41230,
  "connectors_read": ["gmail", "calendar"],
  "connector_errors": [ { "connector": "slack", "kind": "auth_expired" } ],
  "redactions": 12
}
```

Server **từ chối cả lô** nếu có field lạ, chuỗi ngoài enum, connector id không khớp `^[a-z][a-z0-9_-]{0,63}$`, hoặc
`schedule_id` không thuộc máy đó. Không có field văn bản tự do nào (D6). Một `report_id` đã có thì bỏ qua (upsert
theo trạng thái mới hơn: `started` không ghi đè trạng thái kết thúc).

### 7.5 Long-poll

```
Poll(ctx, req):
  device := ctx device
  update last_seen_at, status, bridge_version, time_zone
  ack commands in req.acks (acked_at = now, chỉ của device này)
  if resp := ready(device, req): return resp
  sub := redis.Subscribe("<prefix>:bridge:wake:" + device.id)
  select { case <-sub: case <-time.After(25s): case <-ctx.Done(): }
  return ready(device, req) ?? { config_revision: device.config_revision, commands: [] }

ready: config_revision khác req.config_revision, hoặc có command chưa ack và chưa hết hạn
```

- Mọi chỗ ghi (CRUD lịch, `run`, `cancel`, thu hồi máy) `PUBLISH` lên channel của máy sau khi commit. Replica nào
  giữ poll cũng nhận được, nên không cần sticky routing.
- Command chưa ack được gửi lại ở mỗi poll cho tới khi hết hạn (at-least-once; bridge bỏ trùng theo id).
- Hạ tầng phải chịu được request treo 25s:
  - HTTP server: `WriteTimeout` ≥ 40s (kiểm tra cấu hình kitchen server).
  - Mọi proxy đứng trước `/api` (proxy của dev server web, ingress production; `docker/nginx.conf` của web
    hiện không proxy `/api`): read timeout ≥ 60s cho `/api/bridge/v1/poll`.
  - Rate limiter: poll không tính vào giới hạn per-user thông thường; giới hạn riêng là 6 poll/phút mỗi máy.
- Một máy chỉ có một poll treo. Poll mới của cùng máy thì poll cũ trả về rỗng ngay (Redis key
  `<prefix>:bridge:poller:<device>` chứa id của poll hiện tại).

### 7.6 Cấu trúc code

| Lớp | Thêm |
|---|---|
| `proto/` | `seleya_server_bridge_service.proto` (BridgeService, ScheduleService, BridgeLinkService), message trong `seleya_server_message.proto` / `seleya_server_data.proto`; `GetPreferences`, `UpdatePreferences` vào `UserService` |
| `internal/usecases/bridge`, `internal/usecases/schedule` | Luật nghiệp vụ, validate timing/template, revision, publish |
| `internal/repositories/postgres` | `bridge_devices.go`, `schedules.go`, `schedule_runs.go`, `bridge_commands.go`, `preferences.go` |
| `internal/auth` | Xác thực device token (§7.2) |
| `internal/middleware` | `IsBridgeLinkAPI`, nhánh device trong `SessionAuth`, rate limit poll |
| `internal/services` | Transport của ba service |

---

## 8. Seleya web

### 8.1 Task

- `BridgeTask` thêm `version: number`. Tăng khi prompt, schema hay `finish` đổi theo cách làm kết quả cũ không còn
  đọc được.
- `prompt` và `systemPrompt` chỉ dùng biến của §5.2. `BridgeTaskContext.now` và `timeZone` lấy từ
  `run.started.template_vars` hoặc từ `vars` của kết quả, không lấy từ đồng hồ browser nữa.
- `renderRequest(task, input, userId)` trả `RunRequest` gồm `template` và `store: { key: task.resultKey(userId,
  input), meta: { task_id, task_version, input } }`. Hàm này dùng cho cả `POST /v1/runs` lẫn `template.request`
  khi lưu lịch.
- `connectors`: briefing dùng `"all"` thay vì danh sách connector đang connected, để lịch không hỏng khi người dùng
  nối thêm hay ngắt một connector. Calendar giữ `["calendar"]`, Mail giữ `["gmail"]`.

### 8.2 Kết quả

- `getBriefing`, `mailSyncService`, `calendarSyncService` đọc từ `GET /v1/results/<key>`, rồi chạy `output.parse`,
  `problem` và `finish` với context dựng từ `meta` và `vars`. Bỏ các key localStorage `.briefing`, `.mail`,
  `.calendar` (pre-release, không migrate). `.mail.handled` (trạng thái UI) vẫn giữ ở localStorage.
- `meta.task_version` < `task.version`, hoặc parse lỗi, thì hiện *"Kết quả này từ phiên bản cũ"* kèm nút chạy lại,
  không coi là lỗi.
- Có `last_failure` mới hơn `latest` thì hiện kết quả cũ kèm cảnh báo lần chạy lỗi (mã lỗi → chữ bằng
  `bridgeFailureMessage`).
- Bridge offline thì hiện *"Mở Seleya Bridge để xem kết quả"* cùng nút `seleya-bridge://open` có sẵn
  (`bridgeApp.ts`). Đây là cái giá của D5.
- `GET /v1/link` có `active_run` thuộc trang đang xem thì mở stream của run đó (`POST /v1/runs/:id/tickets`), dùng
  lại `createRunAdapter`.

### 8.3 Liên kết và lịch

- Trang Providers, thẻ "On this machine": nút **Link to your Seleya account**.
  1. Gọi `POST /api/bridge/devices/enrollments`, sau đó gọi bridge `POST /v1/link`.
  2. Sau đó hiện tên máy, trạng thái và *Unlink* (`DELETE /v1/link`, kèm `DELETE /api/bridge/devices/{id}`).
  3. Danh sách các máy khác lấy từ `GET /api/bridge/devices`.
- Mỗi workspace (Briefing, Mail, Calendar) có phần **Run automatically**:
  - Bật/tắt, timing (weekly hoặc interval), máy chạy (mặc định là máy của `GET /v1/link`).
  - Preference của task (số ngày mail, tuần hiện tại và tuần sau cho Calendar) được nướng vào template lúc lưu.
  - Lịch sử từ `GET /api/schedules/{id}/runs`. Lần chạy kế tiếp lấy từ `GET /v1/link` nếu đang ở máy đó.
- Calendar "tuần này và tuần sau" là **hai lịch** (`week_offset` 0 và 1). UI gộp thành một công tắc.
- **Đồng bộ template:** khi tải app (đã đăng nhập), với mỗi lịch có `task_version` < version hiện tại, web gọi `PATCH
  /schedules/{id}` với template mới. Web không mở thì bridge chạy template cũ, và §8.2 xử lý kết quả cũ.
- Web không ở trên máy chạy lịch (bridge không trả lời, hoặc `device_id` khác) thì nút chạy là **Run on
  <tên máy>** (`POST /api/schedules/{id}/run`), và chỉ hiện trạng thái: *"Kết quả nằm trên <tên máy>"*.
- `favoriteAgentIds` chuyển sang `PATCH /api/me/preferences` (`favorite_agent_ids`). Pre-release nên không
  migrate localStorage.

---

## 9. Bảo mật

Giả định giữ từ gateway.md §8.2: origin Seleya đã pair là đáng tin; trang web khác không gọi được bridge. Thêm một
principal mới là **seleya-server**, qua liên kết.

| Rủi ro | Biện pháp |
|---|---|
| Server bị chiếm gửi template độc tới mọi bridge để đọc mail hay lịch | Connector chỉ đọc, như mọi run. Output **không rời máy**. Báo cáo chỉ là enum và số đếm (D6), nên kênh báo cáo không chở được dữ liệu. Không có workspace tool, không persist session (§6.5). Bridge không bao giờ có tool mạng (WebFetch/WebSearch không có tên trung lập, gateway.md §10.3) |
| Model bị prompt "nhét" dữ liệu vào query gửi tới connector (ví dụ Slack search) | Query chỉ đi tới tài khoản của chính người dùng ở provider. Đây là rủi ro sẵn có của run browser, server không làm nó tệ hơn |
| Server bị chiếm làm tiêu quota Claude | `maxRunsPerDay`, `minIntervalMinutes`, `link.enabled` tắt được ngay trong app. Log trong app cho thấy mọi run theo lịch |
| Origin bị XSS liên kết bridge với server của kẻ tấn công | Server URL = Origin + path (D8), không đổi được sang host khác. XSS trên origin Seleya vốn đã là "toàn quyền" trong threat model |
| Lộ device token (đọc trộm đĩa) | File mode 600. Token chỉ gọi được `BridgeLinkService`: đọc lịch của máy đó, gửi báo cáo. Không gọi được API của người dùng (§7.2). Thu hồi được từ web |
| Lộ enrollment token | 5 phút, một lần dùng (`GETDEL`), chỉ đi qua kênh web ↔ bridge đã pair |
| Replay hoặc trùng command, báo cáo | Command có id và hạn; bridge bỏ trùng. Báo cáo idempotent theo `report_id` |
| Browser khác cùng origin đọc kết quả | Có chủ ý (§6.2). Origin khác (localhost dev) không đọc được kết quả của production |
| Kết quả nằm trên đĩa | Đã redact. Mode 600, dir 700. Xoá theo `retentionDays`. Mã hoá bằng Keychain: §13 |
| Server từ chối báo cáo, bridge bị DoS outbox | Outbox giới hạn 500 mục; cũ nhất bị bỏ trước |

---

## 10. Trường hợp biên

| Tình huống | Hành vi |
|---|---|
| Máy tắt hoặc ngủ lúc 08:00, thức dậy lúc 09:10 | Chạy bù một lần nếu trong `catch_up_minutes` (mặc định 120); quá thì báo `skipped expired` |
| Người dùng đang chat lúc tới giờ | Job chờ trong hàng đợi tới khi bridge rảnh, trong hạn `expires_after_minutes` |
| Người dùng bấm chạy tay trong lúc run theo lịch đang chạy | `409 busy` như hiện nay. Web thấy `active_run` và mời người dùng xem run đó |
| Mất mạng hoặc server sập | Lịch vẫn chạy theo `link-config.json`. Báo cáo nằm trong outbox tới khi gửi được |
| Thu hồi máy trên web | Poll kế tiếp nhận `401 device_revoked`; bridge huỷ liên kết tại chỗ, giữ kết quả |
| Bridge bị huỷ liên kết tại chỗ (CLI, app) | Gọi `unlink`. Nếu không gọi được, máy hiện offline trên web tới khi người dùng thu hồi |
| Cài lại app, liên kết lại | `enroll` thu hồi máy cũ cùng tên đang offline (§7.4); web chuyển lịch sang máy mới |
| Đổi múi giờ (đi công tác) | Lịch chạy theo `schedule.time_zone`. Web gợi ý cập nhật khi `status.time_zone` của máy khác `time_zone` của lịch |
| Connector bị ngắt sau khi đặt lịch | `connectors: ["gmail"]` thì báo `failed connector_unavailable`. `"all"` thì chạy với phần còn lại |
| Claude Code hết hạn đăng nhập | `failed provider_auth_required`; web và app hiện như hiện nay |
| Web deploy prompt mới, người dùng chưa mở web | Bridge chạy template cũ; web xử lý kết quả cũ theo §8.2 rồi đồng bộ template |
| Hai tài khoản Seleya trên một máy | Một bridge chỉ liên kết một tài khoản (`409 already_linked`). Key kết quả có user id |
| Đồng hồ máy sai | Lịch theo đồng hồ máy. Server chỉ dùng `scheduled_for` để hiển thị |

---

## 11. Kế hoạch

| Bước | Repo | Nội dung | Phụ thuộc |
|---|---|---|---|
| **B1** | bridge | `startRun` tách khỏi server.ts; `template` + biến; `store` + ResultStore + `/v1/results*`; capabilities features | Không |
| **W1** | web | Task dùng biến và `version`; `renderRequest`; đọc kết quả từ bridge; bỏ localStorage kết quả | B1 |
| **S1** | server | Migration, device auth, enrollment, BridgeService, ScheduleService, BridgeLinkService (poll, reports), preferences; nginx timeout | Không (theo spec) |
| **B2** | bridge | LinkClient, Scheduler, link policy, quyền xem run `link`, `/v1/link*`, CLI, app (thẻ account, schedules) | B1; dùng mock poll server khi S1 chưa xong |
| **W2** | web | Liên kết máy, phần "Run automatically", lịch sử, run từ xa, preferences lên server, đổi chữ "Nothing leaves it" | S1, B2 |

B1 + W1 có ích ngay cả khi chưa có lịch: kết quả không mất khi tải lại tab và mọi browser đã pair đều thấy.

---

## 12. Test

**Bridge**

- `template.ts`: mỗi biến; độ lệch ngày; `week_offset`; DST; biến lạ hay cú pháp sai trả `invalid_template`; thay
  trước khi kiểm tra độ dài; không có `template` thì không thay gì.
- `results.ts`: ghi atomic; `latest` / `last_failure`; quyền theo origin; giới hạn key, kích thước, retention;
  key không hợp lệ.
- `timing.ts`: weekly, interval, ranh giới `to`, ngày không có trong `days`, DST (giờ không tồn tại, giờ lặp lại),
  nhiều múi giờ.
- `scheduler.ts` (đồng hồ giả):
  - Tới giờ thì chạy; đang `busy` thì chờ; hết hạn thì `skipped expired`; `daily_limit`.
  - Chạy bù đúng một lần; không chạy bù mốc trước `created_at`.
  - `run_now` và `cancel`; bỏ trùng command.
- `client.ts` (server giả): revision đổi thì áp cấu hình; `401` thì huỷ liên kết; backoff; outbox gửi lại sau khi mất
  mạng; khởi động với `link-config.json` khi server không trả lời.
- `policy.ts` (link): ép `workspace_tools`, `session`; connector ngoài trần.
- `server.test.ts`: `/v1/results*`, `/v1/link*` (origin dùng làm server URL, `already_linked`); quyền xem và huỷ run
  `link` theo origin.

**Server**

- Device token không gọi được `UserService` hay `ScheduleService`; session cookie không gọi được
  `BridgeLinkService`.
- Enrollment dùng một lần và hết hạn.
- Revision tăng trong cùng transaction với thay đổi lịch.
- Poll: trả ngay khi revision khác; trả sau khi `PUBLISH`; hết 25s thì trả rỗng; ack; command hết hạn không gửi;
  poll thứ hai thay poll thứ nhất.
- Report: field lạ hay enum sai thì từ chối cả lô; idempotent; `started` không ghi đè trạng thái kết thúc;
  `schedule_id` của máy khác bị từ chối.
- Validate template và timing; giữ 100 dòng `schedule_runs`.

**Web**

- `renderRequest` cho từng task, prompt chỉ chứa biến hợp lệ.
- `finish` với context dựng từ `vars`.
- Kết quả phiên bản cũ; đồng bộ template.

---

## 13. Câu hỏi mở

1. **Mã hoá `results/` bằng Keychain** (app) hay để mode 600 là đủ cho bản đầu?
2. **Run tay có báo cáo lên server không?** Hiện chỉ run do liên kết gây ra mới báo cáo. Báo cả run tay thì có lịch
   sử đầy đủ, đổi lại server biết thêm người dùng dùng gì lúc nào.
3. **Thông báo khi run theo lịch xong:** chỉ thông báo hệ thống của app, hay thêm thông báo trong web khi mở lại?
4. **Task definition ở backend** (gateway.md §15.2): nếu chuyển, server sẽ tự dựng template theo phiên bản mới, và
   web không cần đồng bộ template (§8.3).
5. **Nhiều máy cho một lịch** (failover giữa laptop và máy bàn) có cần không?
