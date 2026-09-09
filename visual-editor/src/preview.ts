// ── Entry "preview": render card/animation, KHÔNG kèm editor ──────────────
// Tách khỏi lib.ts vì lib.ts `import App from './App.svelte'` ở top-level, mà
// App.svelte kéo theo schema.ts — nơi `import.meta.glob(schema/*.json, { eager:
// true })` nhồi cả 185 file schema (988 KB) vào bundle. Grid ngoài browser chỉ
// cần vẽ thumbnail, nên import từ lib.ts là trả giá cả editor để làm việc đó:
// chunk khởi động của app phình lên 1.6 MB và mọi `lazy()` bên app thành vô nghĩa.
//
// Closure của cardPreview toàn leaf (divkit/client-devtool + ik/* + utils/colors)
// — không Svelte, không CodeMirror, không schema. Thêm export vào ĐÂY thì phải
// giữ đúng tính chất đó, nếu không entry này lặng lẽ béo lại như cũ.
//
// CSS đi kèm là dist/preview.css — style runtime của DivKit, 32 KB, do
// vite-lib.config.ts emit thẳng từ package divkit. KHÔNG `import` css ở đây:
// Vite lib mode gộp css của MỌI entry vào một file, nên import chỉ làm nó chảy
// vào divkit-editor.css (223 KB) chứ không sinh ra file riêng.

export { renderCardPreview, renderLottiePreview, detectJsonKind } from './lib/data/cardPreview';
export type {
    CardPreviewOptions, CardPreviewInstance, JsonKind,
    LottiePreviewOptions, LottiePreviewInstance
} from './lib/data/cardPreview';
