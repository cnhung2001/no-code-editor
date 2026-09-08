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

// Adapter S3 — frontend gọi qua interface này (impl thật hoặc mock)
export interface S3Adapter {
    listProjects(): Promise<ProjectInfo[]>;
    /** recursive: mọi file dưới prefix, không gồm folder (dùng cho asset cả project). */
    listPath(prefix: string, opts?: { recursive?: boolean }): Promise<S3Item[]>;
    getObjectText(key: string): Promise<string>;
    getAssetUrl(key: string): Promise<string>;
    putObject(key: string, body: string, status?: LayoutStatus, meta?: LayoutMeta): Promise<void>;
    deleteObject(key: string): Promise<void>;
    uploadAsset(project: string, file: File): Promise<string>;
    publish(key: string, body: string, opts: PublishOptions): Promise<void>;
}
