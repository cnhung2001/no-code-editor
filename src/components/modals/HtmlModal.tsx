// ── Modal cho file HTML: đường dẫn S3 + mở/tải ────────────────────────────
import { useEffect, useState } from 'react';
import { Icon } from '../../lib/icons';
import { fmtSize } from '../../lib/format';
import { s3 } from '../../s3';
import type { S3Item } from '../../types';

export function HtmlModal({ file, onClose }: { file: S3Item; onClose(): void }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (file.key) s3.getAssetUrl(file.key).then(setUrl).catch(() => {});
    }, [file.key]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal html-modal" onClick={(e) => e.stopPropagation()}>
                <header className="modal-head">
                    <span>{file.name}</span>
                    <button className="icon-btn" onClick={onClose}>{Icon.close}</button>
                </header>
                <div className="html-modal-body">
                    <span className="html-ic">{Icon.html}</span>
                    <code>s3://ik-nocode-paywall/{file.key}</code>
                    <div className="modal-foot-actions">
                        {url && <a className="btn primary sm" href={url} target="_blank" rel="noreferrer">{Icon.external} Open</a>}
                        {url && <a className="btn ghost sm" href={url} download={file.name}>{Icon.download} Download</a>}
                    </div>
                    <span className="html-size">{fmtSize(file.size)}</span>
                </div>
            </div>
        </div>
    );
}
