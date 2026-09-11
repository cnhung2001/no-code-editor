import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { minify_sync as minify } from 'terser';

/**
 * Emit dist/preview.css = style runtime của DivKit.
 *
 * Entry preview cần đúng những class .divkit-xxxxx mà engine render ra, và
 * chỉ thế — 32 KB, so với 223 KB của divkit-editor.css (phần lớn là UI editor).
 * Custom component ik/* tự mang style (shadow DOM / inline) nên không cần thêm.
 *
 * Emit thay vì `import` trong preview.ts: Vite lib mode gộp css của mọi entry
 * vào MỘT file, import chỉ làm client.css chảy vào divkit-editor.css.
 *
 * Emit từ đây thay vì để app tự import '@divkitframework/divkit/dist/client.css':
 * divkit là devDependency của package NÀY, app không khai báo nó (lockfile của
 * app ghi "dev": true). Thêm `--omit=dev` vào stage build là app vỡ. Còn
 * dist/preview.css thì nằm trong `files: ["dist/*"]`, đi cùng lib, và luôn khớp
 * version divkit đã build ra lib — tên class là hash nên lệch version là lệch css.
 */
function emitPreviewCss(): Plugin {
    return {
        name: 'emit-preview-css',
        generateBundle() {
            const require = createRequire(import.meta.url);
            // Đi qua entry có khai báo trong `exports` rồi lấy file cạnh nó:
            // subpath './dist/client.css' là dạng folder-mapping cũ, bundler
            // đọc được nhưng require.resolve của Node thì không.
            const distDir = dirname(require.resolve('@divkitframework/divkit/client-devtool'));
            this.emitFile({
                type: 'asset',
                fileName: 'preview.css',
                source: readFileSync(join(distDir, 'client.css'), 'utf-8')
            });
        }
    };
}

function minifyES(): Plugin {
    return {
        name: 'minifyES',
        generateBundle: {
            order: 'post',
            handler(_outputOptions, bundle) {
                for (const name in bundle) {
                    const chunk = bundle[name];
                    if (chunk.type === 'chunk') {
                        chunk.code = minify({
                            [chunk.name]: chunk.code,
                        }).code || '';
                    }
                }
            },
        }
    };
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        svelte()
    ],
    build: {
        minify: true,
        // HAI entry, một build: Rollup tự tách phần dùng chung (divkit engine)
        // thành chunk riêng nên preview.js KHÔNG nhân bản code của lib.js.
        //   divkit-editor.js  editor đầy đủ (Svelte + schema + CodeMirror)
        //   preview.js        chỉ render card/animation — xem src/preview.ts
        lib: {
            entry: {
                'divkit-editor': './src/lib.ts',
                preview: './src/preview.ts'
            },
            formats: ['es']
        },
        rollupOptions: {
            output: {
                entryFileNames(chunkInfo) {
                    return `${chunkInfo.name}.js`;
                },
                // Phần dùng chung của hai entry ra chunk riêng, Rollup tự đặt
                // tên `preview2.js` (đụng tên với entry `preview` nên thêm số).
                // Tên xấu nhưng là chi tiết nội bộ: consumer import preview.js,
                // và app build lại bundle hết nên tên này không ra tới browser.
                chunkFileNames(_chunkInfo) {
                    return '[name].js';
                },
                assetFileNames: assetInfo => {
                    if (assetInfo.originalFileNames?.includes('style.css')) {
                        return 'divkit-editor.css';
                    }
                    return '[name].[ext]';
                },
            },
            plugins: [
                // dts()
                minifyES(),
                emitPreviewCss(),
            ]
        }
    }
});
