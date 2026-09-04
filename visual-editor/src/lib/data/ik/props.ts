/**
 * Lenient reader for the `custom_props` / extension `params` objects the paywall SDK consumes.
 *
 * Mirrors `IKJsonLuckyWheelProps` / `IKJsonScratchCardProps` on Android: a number written as a
 * JSON string still parses, and a scalar where an array is expected counts as a one-element
 * array. Remote config is hand-edited, so being strict here would turn a typo into a blank
 * widget instead of a rendered one.
 */
export interface IkProps {
    string(key: string): string | undefined;
    stringList(key: string): string[] | undefined;
    number(key: string): number | undefined;
    bool(key: string): boolean | undefined;
}

function asString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const str = typeof value === 'string' ? value : String(value);
    return str || undefined;
}

function asNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function asBool(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    // Kotlin's toBooleanStrictOrNull: only the two exact literals count
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    return undefined;
}

export function objectProps(json: unknown): IkProps {
    const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;

    return {
        string: key => asString(obj[key]),
        stringList(key) {
            const value = obj[key];
            if (value === null || value === undefined) {
                return undefined;
            }
            if (!Array.isArray(value)) {
                return [String(value)];
            }
            return value
                .filter(item => item !== null && item !== undefined)
                .map(item => String(item));
        },
        number: key => asNumber(obj[key]),
        bool: key => asBool(obj[key])
    };
}

/**
 * Fallback for the rare pass where the DivKit component context is not available yet: custom
 * props also arrive as attributes on the custom element, but stringified — an array of strings
 * comes through as `"a,b,c"`.
 */
export function attributeProps(element: Element): IkProps {
    const raw = (key: string) => element.getAttribute(key) ?? undefined;

    return {
        string: key => raw(key) || undefined,
        stringList(key) {
            const value = raw(key);
            if (value === undefined) {
                return undefined;
            }
            return value ? value.split(',') : [];
        },
        number: key => asNumber(raw(key)),
        bool: key => asBool(raw(key))
    };
}
