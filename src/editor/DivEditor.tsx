// ── React wrapper quanh DivProEditor (thư viện Svelte) ────────────────────
// Editor tự mount vào 1 DOM node nên framework-agnostic; React chỉ cấp div + ref.

import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { DivProEditor } from '@divkitframework/visual-editor';
import type { DivProEditorInstance } from '@divkitframework/visual-editor';
import '@divkitframework/visual-editor/dist/divkit-editor.css';
import { s3 } from '../s3';
import { translate } from '../mt';
import { FILE_LIMITS, VIEWPORT_LIST, CUSTOM_ACTIONS } from './editorConfig';

export interface DivEditorHandle {
    getValue(): string;
    getErrors(): { message: string; level: 'error' | 'warn' }[];
}

interface Props {
    /** JSON khởi tạo (đã resolve assets) */
    value: string;
    /** project prefix để upload asset đúng chỗ */
    project: string;
    readOnly?: boolean;
    theme?: 'light' | 'dark';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layout: any[];
    onChange?: () => void;
}

export const DivEditor = forwardRef<DivEditorHandle, Props>(function DivEditor(
    { value, project, readOnly = false, theme = 'light', layout, onChange },
    ref
) {
    const hostRef = useRef<HTMLDivElement>(null);
    const instRef = useRef<DivProEditorInstance | null>(null);

    useImperativeHandle(ref, () => ({
        getValue: () => instRef.current?.getValue() ?? value,
        getErrors: () => instRef.current?.getErrors() ?? []
    }));

    useEffect(() => {
        if (!hostRef.current) return;
        const inst = DivProEditor.init({
            renderTo: hostRef.current,
            value,
            theme,
            readOnly,
            layout,
            locale: 'en',
            paletteEnabled: true,
            rootConfigurable: true,
            fitViewportOnCreate: true,
            viewportList: VIEWPORT_LIST,
            customActions: CUSTOM_ACTIONS,
            fileLimits: FILE_LIMITS,
            api: {
                async uploadFile(file: File) {
                    // Ảnh kéo-thả trong editor → đẩy lên <project>/assets/
                    return s3.uploadAsset(project, file);
                },
                // Localize: dịch 1 chuỗi nguồn sang nhiều locale (engine ở backend).
                async translate(text: string, from: string, targets: string[]) {
                    return translate(text, from, targets, project);
                },
                onChange() {
                    onChange?.();
                }
            }
        });
        instRef.current = inst;
        return () => {
            inst.destroy();
            instRef.current = null;
        };
        // Khởi tạo 1 lần theo value/project/layout; đổi file → component remount qua key.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div ref={hostRef} className="div-editor-host" />;
});
