// Chọn adapter S3 theo cấu hình. Mặc định dùng S3 thật (qua backend proxy).
import type { S3Adapter } from '../types';
import { apiAdapter } from './api';
import { mockAdapter } from './mock';

const useMock = (import.meta.env.VITE_USE_MOCK || 'false') === 'true';

export const s3: S3Adapter = useMock ? mockAdapter : apiAdapter;
export const IS_MOCK = useMock;
