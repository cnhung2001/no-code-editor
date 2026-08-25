// ── Nạp env sớm nhất, không phụ thuộc cwd ─────────────────────────────────
// `import 'dotenv/config'` nạp .env theo CWD: chạy `npm run server` từ repo root
// thì nó đọc <root>/.env và bỏ qua server/.env → thiếu AUTHZ_API_KEY.
// Module này phải là import ĐẦU TIÊN của index.mjs: ESM chạy side-effect của các
// import theo thứ tự, và authz.mjs throw ngay lúc khởi tạo nếu thiếu biến.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

// server/.env là nguồn chính (nơi giữ AUTHZ_API_KEY).
dotenv.config({ path: path.join(here, '.env') });
// Rồi .env ở cwd cho cách chạy cũ. dotenv không ghi đè biến đã có → server/.env thắng.
dotenv.config();
