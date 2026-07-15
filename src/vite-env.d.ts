/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE?: string;
    readonly VITE_CDN_BASE?: string;
    readonly VITE_USE_MOCK?: string;
    readonly VITE_SAVE_FORMAT?: 'plain' | 'wrapper';
}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}

// Editor lib không kèm typings trong bản build → khai báo tối thiểu ở đây.
declare module '@divkitframework/visual-editor' {
    export interface DivProEditorInstance {
        getValue(): string;
        getCard(): { json: string; meta?: unknown };
        getErrors(): { message: string; level: 'error' | 'warn' }[];
        setTheme(theme: 'light' | 'dark'): void;
        setReadOnly(readOnly: boolean): void;
        destroy(): void;
    }
    export interface DivProEditorOptions {
        renderTo: HTMLElement;
        value?: string;
        card?: { json: string; meta?: unknown };
        theme?: 'light' | 'dark';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layout?: any[];
        locale?: 'ru' | 'en';
        readOnly?: boolean;
        paletteEnabled?: boolean;
        rootConfigurable?: boolean;
        fitViewportOnCreate?: boolean;
        viewportList?: string[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        customActions?: any[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fileLimits?: any;
        api?: {
            uploadFile?(file: File): Promise<string>;
            onChange?(): void;
            translate?(text: string, from: string, targets: string[]): Promise<Record<string, string>>;
        };
    }
    export const DivProEditor: {
        init(opts: DivProEditorOptions): DivProEditorInstance;
    };
}

declare module '@divkitframework/visual-editor/dist/divkit-editor.css';
