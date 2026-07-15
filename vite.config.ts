import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API backend (S3 proxy) địa chỉ mặc định khi dev
const API_TARGET = process.env.API_TARGET || 'http://localhost:8787';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        // Lắng nghe trên mọi interface → truy cập được qua IP LAN (vd http://10.10.21.134:5173)
        // từ máy/điện thoại khác cùng mạng, không chỉ localhost.
        host: true,
        proxy: {
            // Forward /api → backend proxy giữ AWS credentials
            '/api': {
                target: API_TARGET,
                changeOrigin: true
            }
        }
    },
    optimizeDeps: {
        // Editor lib là ESM đã bundle sẵn (Svelte + DivKit, deps rỗng). EXCLUDE khỏi
        // pre-bundle: mỗi lần rebuild lib (dist đổi) sẽ KHÔNG gây lệch chunk cache
        // ("chunk-XXXX.js ... does not exist"). Vite phục vụ trực tiếp dạng ESM.
        exclude: ['@divkitframework/visual-editor']
    }
});
