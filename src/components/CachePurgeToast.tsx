// ── Kết quả xoá cache CDN, hiện sau khi modal Push đã đóng ────────────────
// Publish trả về ngay khi file lên tới S3; purge mất thêm ~25s vì endpoint hạ
// tầng chờ CloudFront tới Completed. Bắt người ta ngồi nhìn modal chừng đó là
// trả giá sai chỗ — nhưng bỏ lửng thì họ báo QC trong lúc app còn ăn bản cũ.
// Nên nó ra khỏi modal, sống ở tầng App, và tự cập nhật tại chỗ.

import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { Dots } from './Loader';
import { s3 } from '../s3';
import type { PurgeState } from '../types';

/** Nhịp hỏi. 2s: purge ~25s nên khoảng chục lượt, không đáng kể. */
const POLL_MS = 2000;
/** Quá lâu thì thôi. Endpoint hạ tầng có trần ~29s; 90s là đã bất thường. */
const GIVE_UP_MS = 90_000;

interface Props {
    purgeId: string;
    onDismiss(): void;
}

export function CachePurgeToast({ purgeId, onDismiss }: Props) {
    const [state, setState] = useState<PurgeState>('pending');
    const [reason, setReason] = useState<string | undefined>();

    useEffect(() => {
        let alive = true;
        let timer: number | undefined;
        const startedAt = Date.now();

        setState('pending');
        setReason(undefined);

        async function poll() {
            if (!alive) return;
            if (Date.now() - startedAt > GIVE_UP_MS) {
                setState('unknown');
                return;
            }
            try {
                const status = await s3.purgeStatus(purgeId);
                if (!alive) return;
                if (status.state === 'pending') {
                    timer = window.setTimeout(poll, POLL_MS);
                    return;
                }
                setState(status.state);
                setReason(status.reason);
            } catch {
                // Mạng chập hay server vừa restart: chưa kết luận được gì, hỏi
                // lại. Hết giờ ở trên sẽ chốt thành 'unknown'.
                timer = window.setTimeout(poll, POLL_MS);
            }
        }

        void poll();
        return () => {
            alive = false;
            if (timer) window.clearTimeout(timer);
        };
    }, [purgeId]);

    // Sạch rồi thì tự biến mất — không có việc gì để làm thì đừng bắt bấm.
    useEffect(() => {
        if (state !== 'done') return;
        const timer = window.setTimeout(onDismiss, 4000);
        return () => window.clearTimeout(timer);
    }, [state, onDismiss]);

    if (state === 'pending') {
        return (
            <div className="toast toast--busy">
                <Dots label="Đang xoá cache CDN" />
                <span className="toast-note">~25s · publish đã xong, cứ làm việc tiếp</span>
            </div>
        );
    }

    if (state === 'done') {
        return <div className="toast">{Icon.check} Cache CDN đã sạch — báo QC được rồi</div>;
    }

    // 'failed' và 'unknown' KHÔNG tự tắt: đây là hai trạng thái có việc phải làm.
    return (
        <div className="toast toast--warn">
            <span>
                {state === 'failed'
                    ? 'Xoá cache CDN hỏng — app có thể còn ăn bản cũ.'
                    : 'Không rõ cache CDN đã sạch chưa (server khởi động lại giữa chừng?).'}
                {reason && <em className="toast-reason">{reason}</em>}
                <em className="toast-reason">Xử lý xong hãy báo QC.</em>
            </span>
            <button className="btn ghost sm" onClick={onDismiss}>Đã hiểu</button>
        </div>
    );
}
