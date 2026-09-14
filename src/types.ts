// ── Kiểu dữ liệu dùng chung toàn app ──────────────────────────────────────

// 'lottie' = .json chứa animation Lottie, do server nhận ra bằng nội dung.
// 'hls'    = một stream HLS (folder .m3u8 + .ts) gộp thành một mục; client tự
//            dựng khi liệt kê asset, server không bao giờ trả về loại này.
export type FileKind = 'folder' | 'json' | 'lottie' | 'image' | 'html' | 'other' | 'hls';
export type LayoutStatus = 'live' | 'draft' | 'archived';

// Một mục trong trình duyệt S3 (file hoặc folder)
export interface S3Item {
    name: string;
    type: FileKind;
    key?: string; // full S3 key cho file
    prefix?: string; // prefix cho folder
    size?: number; // bytes
    modified?: string; // ISO string
    version?: string; // từ object metadata, vd "v3"
    status?: LayoutStatus; // từ object metadata
    /** Có bản nháp chưa publish nằm ở <project>/.drafts/ */
    hasDraft?: boolean;
    /** Chỉ mới có nháp, chưa publish lần nào — `key` là nơi nó SẼ nằm sau khi push. */
    draftOnly?: boolean;
    /** Key thật của bản nháp (`<project>/.drafts/…`), do server tính. */
    draftKey?: string;
    config?: boolean; // true nếu là config.json
}

export interface ProjectInfo {
    name: string;
    prefix: string;
    layoutCount: number;
}

// Metadata cấp file (ngoài body DivKit thuần) — lưu vào S3 object metadata.
export interface LayoutMeta {
    screen_id?: string;
    label?: string;
}

export interface PublishOptions {
    commitMessage: string;
    bumpVersion: boolean;
    invalidateCdn: boolean;
    meta?: LayoutMeta;
}

export interface PublishResult {
    version: string;
    /**
     * Kết quả purge cache CDN: true = đã xoá, false = gọi endpoint purge hỏng
     * (file VẪN publish xong), null = không gọi — layout mới, hoặc bỏ tick
     * invalidate, hoặc server không cấu hình CDN_PURGE_URL.
     */
    cachePurged: boolean | null;
    /**
     * Vì sao purge hỏng, khi `cachePurged === false`. Có để người bấm Publish
     * biết phải làm gì tiếp: hết giờ chờ thì kiểm tra lại rồi mới xoá tay, còn
     * 403/504 thì phải gọi hạ tầng.
     */
    cachePurgeError?: string;
}

// Adapter S3 — frontend gọi qua interface này (impl thật hoặc mock)
export interface S3Adapter {
    listProjects(): Promise<ProjectInfo[]>;
    /**
     * recursive: mọi file dưới prefix, không gồm folder (dùng cho asset cả project).
     * signal: huỷ khi caller không còn cần kết quả — đổi tab liên tục mà không
     * huỷ thì request của tab cũ vẫn chiếm hết 6 kết nối/origin của browser và
     * tab mới phải xếp hàng sau chúng.
     */
    listPath(prefix: string, opts?: { recursive?: boolean; signal?: AbortSignal }): Promise<S3Item[]>;
    /** preferDraft: mở để sửa → lấy bản nháp nếu có. Mặc định lấy bản live. */
    getObjectText(key: string, signal?: AbortSignal, opts?: { preferDraft?: boolean }): Promise<string>;
    getAssetUrl(key: string): Promise<string>;
    putObject(key: string, body: string, status?: LayoutStatus, meta?: LayoutMeta): Promise<void>;
    deleteObject(key: string): Promise<void>;
    uploadAsset(project: string, file: File): Promise<string>;
    publish(key: string, body: string, opts: PublishOptions): Promise<PublishResult>;
}
