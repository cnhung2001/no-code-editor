// ── Loading UI: spinner/skeleton dùng chung cho toàn app ───────────────────

/** Loader chiếm cả vùng: 2 vòng xoay + nhãn shimmer + progress bar vô định. */
export function Loader({ label, compact = false }: { label?: string; compact?: boolean }) {
    return (
        <div className={'ldr' + (compact ? ' ldr--compact' : '')}>
            <div className="ldr-rings" aria-hidden>
                <span className="ldr-ring" />
                <span className="ldr-ring ldr-ring--in" />
                <span className="ldr-core" />
            </div>
            {label && <div className="ldr-label">{label}</div>}
            <div className="ldr-bar" aria-hidden><i /></div>
            <span className="sr-only" role="status">{label || 'Đang tải'}</span>
        </div>
    );
}

/** Ba chấm nhảy — dùng inline trong dòng chữ. */
export function Dots({ label }: { label?: string }) {
    return (
        <span className="ldr-dots" role="status">
            {label && <span className="ldr-dots-label">{label}</span>}
            <i /><i /><i />
        </span>
    );
}

/** Khối skeleton shimmer, dùng khi biết trước hình dáng nội dung. */
export function Skeleton({ w, h = 12, r = 6 }: { w?: number | string; h?: number; r?: number }) {
    return <span className="skel" style={{ width: w ?? '100%', height: h, borderRadius: r }} />;
}

/** Skeleton cho danh sách item ở sidebar. */
export function SkeletonRows({ n = 3 }: { n?: number }) {
    return (
        <div className="skel-rows" role="status" aria-label="Đang tải">
            {Array.from({ length: n }, (_, i) => (
                <div className="skel-row" key={i}>
                    <Skeleton w={16} h={16} r={5} />
                    <Skeleton w={`${68 - i * 12}%`} h={10} />
                </div>
            ))}
        </div>
    );
}

/** Skeleton cho lưới card ở Browser. */
export function SkeletonCards({ n = 8 }: { n?: number }) {
    return (
        <>
            {Array.from({ length: n }, (_, i) => (
                <div className="skel-card" key={i} style={{ animationDelay: `${i * 70}ms` }}>
                    <div className="skel-card-thumb"><span className="skel-sheen" /></div>
                    <div className="skel-card-body">
                        <Skeleton w="72%" h={11} />
                        <Skeleton w="44%" h={9} />
                    </div>
                </div>
            ))}
        </>
    );
}
