// Chọn adapter S3 theo cấu hình. Mặc định dùng S3 thật (qua backend proxy).
import type { S3Adapter } from '../types';
import { apiAdapter } from './api';
import { mockAdapter } from './mock';
import { withListCache } from './listCache';

const useMock = (import.meta.env.VITE_USE_MOCK || 'false') === 'true';

// Cache bọc ngoài adapter đã chọn, nên mock và S3 thật hành xử như nhau.
export const s3: S3Adapter = withListCache(useMock ? mockAdapter : apiAdapter);
export const IS_MOCK = useMock;
export { peekList } from './listCache';
