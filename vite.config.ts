import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

// Cổng của gateway Express (server/index.mjs) — cũng là origin DUY NHẤT mà
// browser được dùng, vì redirect URI đăng ký ở authz khớp tuyệt đối một origin.
// PORT là tên server thật sự đọc; nhận cả hai để banner không in cổng sai khi
// chỉ có PORT được set.
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 8080);

// Cổng Vite PHẢI khớp VITE_DEV_URL mà gateway proxy tới, nếu không gateway proxy
// vào hư không. Nên lấy cổng từ chính biến đó thay vì hard-code lần thứ hai:
// đổi cổng = sửa VITE_DEV_URL (shell hoặc .env), không phải sửa file này.
// Biến shell đọc trước — dotenv của server cũng ưu tiên nó, hai bên khớp nhau.
function devPort(mode: string): number {
    const url = process.env.VITE_DEV_URL ||
        loadEnv(mode, process.cwd(), 'VITE_').VITE_DEV_URL;

    try {
        const port = Number(new URL(url).port);
        if (Number.isInteger(port) && port > 0) {
            return port;
        }
    } catch {
        // URL rỗng hoặc sai cú pháp → về mặc định
    }

    return 5173;
}

// Vite tự in "Local/Network: http://localhost:5173" — đó là origin SAI cho app
// này (mở trực tiếp sẽ hỏng /api + /auth). Thay khối URL đó bằng một dòng trỏ về
// gateway, để log của hai process cạnh nhau không dạy người đọc mở lầm cổng.
function gatewayUrlBanner(): Plugin {
    return {
        name: 'gateway-url-banner',
        configureServer(server: ViteDevServer) {
            server.printUrls = () => {
                server.config.logger.info(
                    `\n  ➜  Mở app:   \x1b[36mhttp://localhost:${GATEWAY_PORT}\x1b[0m  (gateway) — ` +
                    `đừng mở cổng ${server.config.server.port} trực tiếp\n`
                );
            };
        }
    };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [react(), gatewayUrlBanner()],
    server: {
        port: devPort(mode),
        // Nếu cổng bị chiếm, Vite mặc định nhảy sang cổng kế tiếp và im lặng làm
        // gateway proxy vào hư không — strictPort biến chuyện đó thành lỗi khởi
        // động thấy ngay (cổng bị chiếm thì đổi VITE_DEV_URL, đừng để nó trôi).
        strictPort: true,
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
}));
