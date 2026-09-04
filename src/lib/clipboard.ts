// ── Copy text vào clipboard ────────────────────────────────────────────────

/**
 * Ném lỗi nếu không copy được, để caller báo cho user tự copy tay.
 *
 * `navigator.clipboard` chỉ tồn tại trong secure context (https hoặc
 * localhost). App chạy sau reverse proxy http thì rơi về `execCommand` —
 * deprecated nhưng vẫn là đường lùi duy nhất ở đó.
 */
export async function copyText(text: string): Promise<void> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // Bị chặn quyền hoặc không có gesture — thử tiếp bằng execCommand.
    }

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    if (!copied) {
        throw new Error('clipboard unavailable');
    }
}
