import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cổng của gateway Express (server/index.mjs) — cũng là origin DUY NHẤT mà
// browser được dùng, vì redirect URI đăng ký ở authz khớp tuyệt đối một origin.
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 8080);

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Lắng nghe mọi interface → truy cập được qua IP LAN từ máy/điện thoại khác.
        host: true,
        // KHÔNG proxy /api ở đây nữa: dev server này không phải cửa vào.
        // Mở app tại http://localhost:<GATEWAY_PORT>; Express serve /api + /auth
        // và proxy phần còn lại xuống Vite. Mở thẳng :5173 sẽ hỏng /api và HMR —
        // hỏng ồn ào có chủ đích, để không ai chạy sai origin mà không biết.
        hmr: {
            clientPort: GATEWAY_PORT
        }
    },
    optimizeDeps: {
        // Editor lib là ESM đã bundle sẵn (Svelte + DivKit, deps rỗng). EXCLUDE khỏi
        // pre-bundle: mỗi lần rebuild lib (dist đổi) sẽ KHÔNG gây lệch chunk cache
        // ("chunk-XXXX.js ... does not exist"). Vite phục vụ trực tiếp dạng ESM.
        exclude: ['@divkitframework/visual-editor']
    }
});
