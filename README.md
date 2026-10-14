# HanNgu API

API đồng bộ dùng Node.js 24.12+ (`.nvmrc`), Firebase Authentication và Firestore REST. Frontend là repository `hanngu-frontend`. Source dùng TypeScript strict. `tsx` chạy source/test khi phát triển; `tsc` build ra `dist/` cho Node.js production.

## Cấu trúc

```text
src/
  server.ts                      # Khởi động, signal và graceful shutdown
  app.ts                         # Ghép dependency, middleware và route
  config/                         # Kiểm tra biến môi trường; Firebase token verifier
  routes/sync.routes.ts           # URL và HTTP method
  controllers/sync.controller.ts  # HTTP input/output
  services/sync.service.ts        # Điều phối nghiệp vụ đồng bộ
  validators/sync.validator.ts    # Wire format, query, batch và cursor
  repositories/                   # Firestore REST; không xử lý HTTP frontend
  mappers/                        # Chuyển JSON sang Firestore values
  middleware/                     # CORS, xác thực, rate limit
  http/                           # JSON request/response
  errors/                         # Lỗi có status và code ổn định
```

Luồng: route → controller → service → repository. `createApiServer` nhận repository, token verifier và logger qua tham số để kiểm thử độc lập với Firebase.

## Chạy và kiểm tra

```sh
npm ci
cp .env.example .env
npm run dev
```

PowerShell dùng `Copy-Item .env.example .env`. Server mặc định ở `http://localhost:8080`; `GET /health` kiểm tra server đang chạy, không thực hiện request Firestore.

```sh
npm run typecheck
npm test
npm run build
npm run test:coverage
```

Test dùng transport/repository giả và HTTP server thật trên port ngẫu nhiên. Không ghi dữ liệu vào Firebase. CI chạy TypeScript, test và build trên Node 24; job `emulator` chạy test rules. Các file test được giữ để bảo vệ base, Docker chỉ chứa mã runtime và dependency production.

`npm run test:emulator` chạy API thật với Auth và Firestore emulator (cần Java 21+) để kiểm Security Rules: phân trang 201 thẻ, retry log, log bất biến, LWW thẻ/settings, commit nguyên tử và cách ly UID. Test chỉ dùng project `demo-hanngu` và tự bỏ qua khi không có emulator. Chạy API thủ công với emulator: `npm run emulators`, sao chép `.env.emulator.example` thành `.env` rồi `npm run dev`; Firestore emulator dùng port 8180 để không trùng API. Frontend hiện chưa nối Auth emulator nên vẫn dùng token Firebase thật.

## Hợp đồng API

Đăng nhập bằng Firebase ở frontend. Các endpoint `/v1/sync/*` yêu cầu `Authorization: Bearer <Firebase-ID-token>`. UID chỉ lấy từ token đã xác thực. API chuyển chính ID token đến Firestore REST để Security Rules tiếp tục kiểm ownership, LWW và log bất biến.

| Method | Endpoint | Kết quả |
| --- | --- | --- |
| GET | `/health` | `{ ok: true, project }` |
| GET | `/v1/sync/settings` | `{ settings: object hoặc null }` |
| GET | `/v1/sync/cards?since=0&cursor=...` | `{ documents, next? }` |
| GET | `/v1/sync/reviews?since=0&cursor=...` | `{ documents, next? }` |
| POST | `/v1/sync/batch` | Body `{ writes: [{ collection, id, data }] }`; kết quả `{ ok: true }` |

`since` là mili giây UTC; `cursor` là JSON của `next`, URL-encode. Mỗi trang tối đa 200 document, batch tối đa 450 writes và body tối đa 8 MB. Cursor giữ timestamp nano. Các Date trong wire format là số mili giây; repository đặt `serverUpdatedAt` bằng `REQUEST_TIME`. Xem [OpenAPI](docs/openapi.json).

Success payload giữ định dạng frontend hiện tại. Lỗi luôn có dạng:

```json
{ "error": "Thông báo", "code": "VALIDATION_ERROR", "requestId": "uuid" }
```

Mọi response có `X-Request-ID`. Các mã chính: `UNAUTHENTICATED` (401), `ORIGIN_FORBIDDEN` (403), `VALIDATION_ERROR` (400), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (502), `UPSTREAM_TIMEOUT` (504). Log JSON chỉ chứa request ID, method, path, status và thời gian; không log token, body hoặc query. `Retry-After` được trả khi rate limit.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `PORT` | `8080` | Port từ nền tảng deploy |
| `HOST` | `127.0.0.1` local; `0.0.0.0` production | Địa chỉ bind |
| `FIREBASE_PROJECT_ID` | `hanngu-91a22` | Project của token và Firestore |
| `CORS_ORIGINS` | Hai origin localhost | Danh sách origin cách nhau bằng dấu phẩy; production yêu cầu HTTPS và cấu hình rõ |
| `BODY_LIMIT_BYTES` | `8388608` | Giới hạn body, tối đa 8 MB |
| `UPSTREAM_TIMEOUT_MS` | `20000` | Timeout Firestore, tối đa 25 giây |
| `RATE_LIMIT_MAX` | `120` | Request mỗi địa chỉ socket trong một cửa sổ |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Cửa sổ rate limit |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Thời gian đợi request đang chạy khi dừng server |

Rate limit trong process dùng địa chỉ socket, không tin `X-Forwarded-For`. Nếu chạy sau proxy hoặc nhiều replica, đặt rate limit theo client tại gateway và cấu hình giới hạn process phù hợp lượng traffic chung. Health không bị rate limit. Production từ chối cấu hình emulator; không cần service-account key cho luồng REST dùng token người dùng này.

## Deploy

Nền tảng Node.js: install `npm ci`, build `npm run build`, start `npm start`. Sau build có thể dùng `npm prune --omit=dev`; gói runtime gồm `dist/`, `package.json`, `package-lock.json` và dependency production. Đặt `NODE_ENV=production`, `HOST=0.0.0.0`, project và `CORS_ORIGINS` theo domain frontend; `PORT` do nền tảng cung cấp. Server dừng nhận request mới khi nhận SIGTERM/SIGINT và đợi request đang chạy trong giới hạn shutdown.

Docker:

```sh
docker build -t hanngu-api .
docker run --rm -p 8080:8080 -e CORS_ORIGINS=https://your-frontend.example hanngu-api
```

Container build TypeScript trong một stage riêng, chạy `dist/server.js` dưới user `node`, có healthcheck và không chứa test, env hay Firebase CLI. Docker image chạy local cũng yêu cầu CORS origin HTTPS vì dùng cấu hình production.

Deploy Firestore rules/indexes sau khi Firebase CLI đã đăng nhập:

```sh
npm ci --include=dev
npm run firebase:deploy
```

Lệnh này chỉ triển khai rules/indexes; server API triển khai riêng. Frontend cần cấu hình `NEXT_PUBLIC_SYNC_API_URL` rồi build lại để kết nối API đã deploy.
