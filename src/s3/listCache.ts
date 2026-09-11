// ── Cache danh sách thư mục, sống trong một phiên ─────────────────────────
// Đổi qua lại giữa mấy project là chuyện làm cả ngày, mà mỗi lần quay lại một
// chỗ vừa xem xong thì cả hai danh sách (nông + đệ quy) lại được hỏi lại từ
// đầu, và lưới nhường chỗ cho skeleton thêm một nhịp nữa. Dữ liệu thì y hệt
// lần trước.
//
// Bọc ở lớp adapter, không rải ở từng component: chỗ này thấy được CẢ lệnh đọc
// lẫn lệnh ghi, nên không có đường nào ghi vào S3 mà quên dọn cache.

import type { LayoutMeta, LayoutStatus, PublishOptions, S3Adapter, S3Item } from '../types';

const cache = new Map<string, S3Item[]>();

const keyOf = (prefix: string, recursive?: boolean) => (recursive ? 'r:' : 'n:') + prefix;

/**
 * Danh sách đã tải trước đó, nếu có. Đồng bộ — để component vẽ được NGAY trong
 * lần render đầu thay vì bật skeleton rồi mới thay bằng đúng thứ nó vừa có.
 */
export function peekList(prefix: string, recursive?: boolean): S3Item[] | undefined {
    return cache.get(keyOf(prefix, recursive));
}

/**
 * Xoá sạch, không xoá chọn lọc.
 *
 * Một lần ghi có thể làm sai nhiều entry cùng lúc: danh sách nông của thư mục
 * cha, danh sách đệ quy của project, và của mọi thư mục trên đường đi. Tính cho
 * đúng tập đó là chỗ dễ sai mà chẳng được gì — ghi là việc hiếm (lưu, publish,
 * xoá, upload), còn đọc lại sau đó cùng lắm tốn đúng một vòng như trước khi có
 * cache này.
 */
function invalidate(): void {
    cache.clear();
}

export function withListCache(adapter: S3Adapter): S3Adapter {
    return {
        ...adapter,

        async listPath(prefix: string, opts?: { recursive?: boolean; signal?: AbortSignal }) {
            const items = await adapter.listPath(prefix, opts);
            // Chỉ ghi cache khi request còn sống: một request đã bị huỷ giữa
            // chừng không có gì đảm bảo danh sách trả về là đầy đủ.
            if (!opts?.signal?.aborted) {
                cache.set(keyOf(prefix, opts?.recursive), items);
            }
            return items;
        },

        async putObject(key: string, body: string, status?: LayoutStatus, meta?: LayoutMeta) {
            await adapter.putObject(key, body, status, meta);
            invalidate();
        },

        async deleteObject(key: string) {
            await adapter.deleteObject(key);
            invalidate();
        },

        async uploadAsset(project: string, file: File) {
            const url = await adapter.uploadAsset(project, file);
            invalidate();
            return url;
        },

        async publish(key: string, body: string, opts: PublishOptions) {
            await adapter.publish(key, body, opts);
            invalidate();
        }
    };
}
