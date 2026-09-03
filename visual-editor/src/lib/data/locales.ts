// ── Danh sách ngôn ngữ hỗ trợ cho i18n (locale_ dict vars) ────────────────
// Nguồn chân lý duy nhất cho: nhãn hiển thị + tập ngôn ngữ đích khi auto-translate.

export const LOCALE_LABELS: Record<string, string> = {
    en: 'English', vi: 'Tiếng Việt', ar: 'العربية', zh: '中文',
    fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português',
    ru: 'Русский', ja: '日本語', ko: '한국어', it: 'Italiano',
    nl: 'Nederlands', tr: 'Türkçe', pl: 'Polski', uk: 'Українська',
    th: 'ภาษาไทย', id: 'Bahasa Indonesia', ms: 'Bahasa Melayu',
    hi: 'हिन्दी', cs: 'Čeština', da: 'Dansk', fi: 'Suomi',
    el: 'Ελληνικά', he: 'עברית', hr: 'Hrvatski', hu: 'Magyar',
    no: 'Norsk', ro: 'Română', sk: 'Slovenčina', sv: 'Svenska',
    ca: 'Català'
};

/** Tất cả mã ngôn ngữ hỗ trợ (đích cho auto-translate). */
export const SUPPORTED_LOCALES: string[] = Object.keys(LOCALE_LABELS);
