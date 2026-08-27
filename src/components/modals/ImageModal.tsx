// ── Lightbox xem ảnh từ S3 ────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Icon } from '../../lib/icons';
import { Loader } from '../Loader';
import { fmtSize } from '../../lib/format';
import { s3 } from '../../s3';
import type { S3Item } from '../../types';

export function ImageModal({ file, onClose }: { file: S3Item; onClose(): void }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (file.key) s3.getAssetUrl(file.key).then(setUrl).catch(() => {});
    }, [file.key]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal img-modal" onClick={(e) => e.stopPropagation()}>
                <header className="modal-head">
                    <span>{file.name}</span>
                    <button className="icon-btn" onClick={onClose}>{Icon.close}</button>
                </header>
                <div className="img-modal-body">{url ? <img src={url} alt={file.name} /> : <Loader label="Đang tải ảnh…" compact />}</div>
                <footer className="modal-foot">
                    <span>{fmtSize(file.size)}</span>
                    <div className="modal-foot-actions">
                        <button className="btn ghost sm">{Icon.upload} Replace</button>
                        {url && <a className="btn ghost sm" href={url} download={file.name}>{Icon.download} Download</a>}
                    </div>
                </footer>
            </div>
        </div>
    );
}
