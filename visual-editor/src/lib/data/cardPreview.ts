import {
    render, createVariable, createGlobalVariablesController, evalExpression
} from '@divkitframework/divkit/client-devtool';
import type { CustomComponentDescription } from '@divkitframework/divkit/typings/custom';
import type {
    CustomActionCallback, Direction, DivJson, DivVariable, StatCallback, WrappedError
} from '@divkitframework/divkit/typings/common';
import type { Variable, VariableType } from '@divkitframework/divkit/typings/variables';
import { collectCustomComponents } from './customComponents';
import { createDivExtensions } from './divExtensions';

/**
 * Read-only render of a card, for showing a layout as a picture rather than a filename.
 *
 * This is the editor's preview minus the editor: no selection overlays, no leaf tree, no error
 * store — just the same DivKit render with the same extensions and custom components, so a
 * thumbnail cannot show something the editor would not. The caller sizes the node and scales it
 * down; nothing here knows about thumbnails.
 */

/**
 * Action như khi nó tới `onCustomAction`/`onStat`. Dẫn xuất từ type của DivKit
 * chứ không gõ lại: gõ lại là mời hai bên lệch nhau khi DivKit đổi.
 */
export type PreviewAction = Parameters<CustomActionCallback>[0];

/**
 * Lỗi/cảnh báo từ engine. KHÔNG phải `Error` thường: `level` phân biệt lỗi với
 * cảnh báo, và `additional` mới là chỗ chứa nguyên nhân — `message` một mình
 * thường vô dụng, vd "Video playing error" không nói video nào hay vì sao,
 * trong khi `additional.originalText` có đúng lý do browser từ chối play.
 */
export type PreviewError = WrappedError;

export interface CardPreviewOptions {
    node: HTMLElement;
    /** Wrapper (`{ screen_id, remote_layout, variables }`) or a bare DivKit card. */
    value: string;
    theme?: 'light' | 'dark';
    /** Value for the `language_code` variable the SDK injects on device. */
    languageCode?: string;
    direction?: Direction;
    onError?(error: PreviewError): void;
    /**
     * Chỉ những scheme LẠ (`myapp://…`). Đã kiểm: `div-action://purchase` KHÔNG
     * tới đây — DivKit coi `div-action` là protocol có sẵn nên mọi path dưới nó,
     * kể cả path nó không biết, đều đi đường builtin. Muốn bắt action paywall
     * thì dùng `onStat`.
     */
    onCustomAction?: CustomActionCallback;
    /**
     * Mọi action DivKit thực thi, gồm cả `div-action://purchase|close|restore`
     * và `set_variable`. Đây là chỗ duy nhất thấy được action của paywall.
     *
     * `action.url` là url như KHAI BÁO trong layout, không phải bản đã tính:
     * `product_id=@{selected}_plan` tới đây vẫn còn nguyên `@{…}`, dù cùng
     * expression đó trong `background.color` thì được tính bình thường.
     */
    onStat?: StatCallback;
}

export interface CardPreviewInstance {
    destroy(): void;
}

/**
 * Kind of json a `.json` in the bucket turns out to be.
 *
 * Extension and filename say nothing: a Lottie animation and a DivKit card are both `.json`, and
 * both live next to each other in a project folder. Only the content settles it, and the caller
 * needs to know before it decides how to render — and what shape to give it.
 */
export type JsonKind = 'divkit' | 'lottie' | 'unknown';

export function detectJsonKind(value: string): JsonKind {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return 'unknown';
    }
    if (!parsed || typeof parsed !== 'object') {
        return 'unknown';
    }

    const obj = parsed as Record<string, unknown>;
    // Same condition renderCardPreview and State.setDivJson insist on, kept here so the two
    // cannot disagree about what counts as a card.
    const card = ((obj.remote_layout ?? obj) as { card?: { states?: unknown[] } })?.card;
    if (Array.isArray(card?.states) && card.states.length) {
        return 'divkit';
    }
    // Lottie's header: a frame rate and a layer list. `layers` alone is not enough — it sits
    // after `assets`, which in a card exported with embedded images is most of the file.
    if (typeof obj.fr === 'number' && Array.isArray(obj.layers)) {
        return 'lottie';
    }
    return 'unknown';
}

export interface LottiePreviewOptions {
    node: HTMLElement;
    /** Lottie animation json. */
    value: string;
    loop?: boolean;
}

export interface LottiePreviewInstance {
    destroy(): void;
}

/**
 * Plays a Lottie animation into `node`.
 *
 * lottie-web is loaded on demand — it is a 165 KB chunk that most sessions never touch, and it is
 * already here for the `lottie` div extension, so previews cost no extra dependency.
 */
export async function renderLottiePreview(
    opts: LottiePreviewOptions
): Promise<LottiePreviewInstance> {
    const { loadAnimation } = await import('./lottieApi');
    // The same node may have held a card before (a tile is reused across files), and
    // prepareTarget leaves flex behind on it — lottie wants a plain box to size its svg in.
    opts.node.style.removeProperty('display');
    opts.node.style.removeProperty('align-items');
    const animation = loadAnimation({
        container: opts.node,
        animationData: JSON.parse(opts.value),
        renderer: 'svg',
        loop: opts.loop ?? true,
        autoplay: true
    });

    return {
        destroy() {
            animation.destroy();
        }
    };
}

/**
 * Products carry no price until billing answers, and the editor's Products panel starts them at
 * "0" — a preview does the same so `@{annual_plan}` renders a number instead of failing.
 */
const PRICE_PLACEHOLDER = '0';

interface Wrapper {
    remote_layout?: unknown;
    variables?: { id?: string }[];
}

/**
 * Giá trị thay cho biến mà host app cấp lúc chạy trên máy thật — "rỗng" của
 * từng kiểu, không phải nội dung bịa: preview để xem layout, không phải để xem
 * dữ liệu tưởng tượng. Ô nào trống thì đúng là chỗ app sẽ điền.
 *
 * Phải thử nhiều kiểu vì tên biến không nói lên kiểu, mà dùng sai kiểu thì
 * expression vẫn hỏng y như lúc thiếu biến: `@{system_back_count > 0}` với
 * chuỗi rỗng cho "Operator '>' cannot be applied to String and Integer", còn
 * `getOptStringFromDict(…, locale_x, lang)` thì đòi dict. Thứ tự = độ phổ biến.
 */
const PLACEHOLDER_TYPES: { type: VariableType; value: unknown }[] = [
    { type: 'string', value: '' },
    { type: 'integer', value: 0 },
    { type: 'number', value: 0 },
    { type: 'boolean', value: false },
    { type: 'dict', value: {} },
    { type: 'array', value: [] }
];

/** Bao nhiêu biến thiếu chịu khó moi ra từ MỘT expression trước khi bỏ cuộc. */
const MAX_MISSING_PER_EXPRESSION = 12;

const MISSING_VARIABLE_RE = /^Variable '(.+?)' is missing\.$/;

/** Mọi chuỗi có `@{…}` trong json — chính là thứ DivKit sẽ đem đi tính. */
function collectExpressions(node: unknown, out: Set<string>): void {
    if (Array.isArray(node)) {
        for (const item of node) {
            collectExpressions(item, out);
        }
        return;
    }
    if (!node || typeof node !== 'object') {
        return;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
        if (typeof value === 'string') {
            if (value.includes('@{')) {
                out.add(value);
            }
        } else {
            collectExpressions(value, out);
        }
    }
}

/**
 * Biến mà card TỰ khai báo ở cấp card.
 *
 * Chỉ cấp card, cố ý. `card.variables` bị bỏ qua nếu tên đó đã có sẵn trong
 * bảng biến (Root.svelte: `!variables.has(name)`), nên bơm một global trùng tên
 * sẽ NUỐT luôn khai báo thật của layout. Biến khai báo trên một div thì ngược
 * lại — nó `set()` đè lên map của scope con, nên global trùng tên vô hại.
 */
function declaredCardVariables(json: DivJson): Map<string, Variable> {
    const map = new Map<string, Variable>();
    for (const variable of json.card?.variables || []) {
        if (!variable?.name || !variable?.type) {
            continue;
        }
        try {
            // `property` là biến TÍNH RA (`value_type` + expression), không phải
            // một trong 8 kiểu lưu trữ — createVariable không dựng được. Kiểu
            // không quan trọng ở đây: map này chỉ để trả lời "tên đã có chưa".
            const type = variable.type === 'property' ? 'string' : variable.type;
            map.set(variable.name, createVariable(
                variable.name,
                type,
                'value' in variable ? variable.value : undefined
            ));
        } catch {
            // Khai báo hỏng (sai kiểu, thiếu value) — vẫn phải chiếm chỗ, nếu
            // không tên này sẽ bị coi là "thiếu" rồi bơm global đè lên nó.
            map.set(variable.name, createVariable(variable.name, 'string', ''));
        }
    }
    return map;
}

/**
 * Tên những biến mà expression của card đọc nhưng không nơi nào khai báo.
 *
 * Dùng chính parser của DivKit thay vì bắt tên bằng regex: `getOptStringFromDict`
 * và `locale_i18n_greeting` nằm cạnh nhau trong cùng một expression, mà chỉ cái
 * sau là biến. `evalExpression` đã biết đâu là hàm, đâu là biến, đâu là chuỗi —
 * nó báo đúng tên còn thiếu, từng cái một, nên cứ tính lại sau mỗi lần bù.
 */
function findMissingVariables(
    json: DivJson,
    known: Map<string, Variable>
): Map<string, { type: VariableType; value: unknown }> {
    const expressions = new Set<string>();
    collectExpressions(json, expressions);

    const missing = new Map<string, { type: VariableType; value: unknown }>();
    const pool = new Map(known);

    const place = (name: string, index: number) => {
        const pick = PLACEHOLDER_TYPES[index];
        pool.set(name, createVariable(name, pick.type, pick.value));
        missing.set(name, pick);
    };

    for (const expression of expressions) {
        // Biến do CHÍNH expression này lòi ra. Chỉ những cái đó mới được phép
        // đổi kiểu bên dưới: một biến đã chốt kiểu từ expression trước thì giữ
        // nguyên, nếu không hai chỗ dùng cùng một biến sẽ giằng co nhau.
        const introduced: string[] = [];

        for (let i = 0; i < MAX_MISSING_PER_EXPRESSION; ++i) {
            const result = evalExpression(expression, { variables: pool, type: 'json' });
            if (result.type !== 'error') {
                break;
            }
            const name = MISSING_VARIABLE_RE.exec(String(result.value))?.[1];
            if (name) {
                introduced.push(name);
                place(name, 0);
                continue;
            }
            // Hết biến thiếu mà vẫn lỗi: có thể do kiểu mình vừa đoán. Thử các
            // kiểu còn lại, giữ cái nào làm expression chạy được.
            if (!retypePlaceholder(expression, pool, introduced, place)) {
                // Không phải chuyện kiểu (chia cho 0, hàm không tồn tại, layout
                // sai thật) — để nguyên, engine sẽ báo đúng lỗi đó cho người dùng.
                break;
            }
        }
    }
    return missing;
}

/**
 * Đổi kiểu placeholder cho tới khi expression chạy được. `true` nếu đổi được.
 *
 * Tham lam từng biến một: đủ cho mọi trường hợp trong bucket hiện tại (mỗi
 * expression chỉ có một biến host). Hai biến cùng cần đổi kiểu trong một
 * expression thì chịu — và kết quả đúng bằng lúc chưa có hàm này, nên không mất gì.
 */
function retypePlaceholder(
    expression: string,
    pool: Map<string, Variable>,
    introduced: string[],
    place: (name: string, index: number) => void
): boolean {
    for (const name of introduced) {
        const original = pool.get(name);
        for (let index = 1; index < PLACEHOLDER_TYPES.length; ++index) {
            const pick = PLACEHOLDER_TYPES[index];
            let candidate: Variable;
            try {
                candidate = createVariable(name, pick.type, pick.value);
            } catch {
                continue;
            }
            pool.set(name, candidate);
            if (evalExpression(expression, { variables: pool, type: 'json' }).type !== 'error') {
                place(name, index);
                return true;
            }
        }
        if (original) {
            pool.set(name, original);
        }
    }
    return false;
}

let nextId = 0;

export function renderCardPreview(opts: CardPreviewOptions): CardPreviewInstance {
    const parsed = JSON.parse(opts.value) as Wrapper;
    const json = (parsed?.remote_layout ?? parsed) as DivJson;

    if (!json?.card?.states?.[0]?.div) {
        throw new Error('Incorrect format');
    }

    const globalVariablesController = createGlobalVariablesController();
    globalVariablesController.setVariable(createVariable('theme', 'string', opts.theme || 'light'));
    globalVariablesController.setVariable(
        createVariable('language_code', 'string', opts.languageCode || 'en')
    );
    // Declared by the host app on device, so a card reading it must not fall over here.
    globalVariablesController.setVariable(createVariable('local_palette', 'dict', localPalette(json)));

    // Wrapper-level `variables` are the product list: they never reach card.variables, so
    // without them every price expression on the card is an undefined variable.
    if (Array.isArray(parsed?.variables)) {
        for (const variable of parsed.variables) {
            if (variable?.id) {
                globalVariablesController.setVariable(
                    createVariable(variable.id, 'string', PRICE_PLACEHOLDER)
                );
            }
        }
    }

    // Biến do host app cấp lúc chạy trên máy thật (`name` mang sang từ màn trước,
    // id người dùng, cờ A/B…). Tool render từng layout một, đứng riêng, nên chúng
    // không tồn tại — và một expression đọc phải biến thiếu KHÔNG chỉ trả về
    // rỗng: nó hỏng, `apply()` trả `undefined`, rồi `set_variable` gọi
    // `setValue(undefined)` và DivKit NÉM "Incorrect variable value". Cú ném đó
    // nằm trong `await` của action executor async nên không ai bắt được —
    // onError không thấy, try/catch quanh render() cũng không — chỉ còn
    // "Uncaught (in promise)" trong console, còn layout thì mất luôn phần chữ.
    //
    // Ba biến cố định bên trên đã theo đúng lối này rồi; đây là phần tổng quát
    // hoá nó cho biến mà chỉ bản thân layout mới biết là mình cần.
    const known = declaredCardVariables(json);
    for (const variable of globalVariablesController.list()) {
        known.set(variable.getName(), variable);
    }
    const stubbed = findMissingVariables(json, known);
    for (const [name, pick] of stubbed) {
        globalVariablesController.setVariable(createVariable(name, pick.type, pick.value));
    }

    muteVideos(json);
    prepareTarget(opts.node);

    const customComponents = new Map<string, CustomComponentDescription>();
    collectCustomComponents(json, customComponents);

    const instance = render({
        id: `card-preview-${++nextId}`,
        target: opts.node,
        json,
        globalVariablesController,
        platform: 'desktop',
        extensions: createDivExtensions(),
        customComponents,
        direction: opts.direction || 'ltr',
        onCustomAction: opts.onCustomAction,
        onStat: opts.onStat,
        onError(event) {
            opts.onError?.(event.error);
        }
    });

    // Nói ra, đừng im lặng. Ô trống trên màn có thể là do layout sai, cũng có
    // thể là do biến của app chưa có — hai chuyện khác hẳn nhau, và chỉ chỗ này
    // biết là chuyện nào.
    if (stubbed.size && opts.onError) {
        const notice = new Error('Biến do app cấp, preview để trống') as PreviewError;
        notice.level = 'warn';
        notice.additional = {
            variables: [...stubbed].map(([name, pick]) => `${name} (${pick.type})`).join(', ')
        };
        opts.onError(notice);
    }

    const silence = keepSilent(opts.node);

    return {
        destroy() {
            silence();
            instance.$destroy();
        }
    };
}

/**
 * A card's root resolves `height: match_parent` by stretching as a flex item, so the target has
 * to be a flex container — this is what the editor's own preview does from CSS
 * (`.renderer__content-inner`), and it is not optional.
 *
 * A plain block target leaves the root at content height, and every `match_parent` inside it
 * collapses with it: the card renders as a strip of `wrap_content` items at the top with white
 * space below, which reads as a broken layout rather than a wrong container. The matching
 * `width: 100%` on the root goes with it — stretch only settles the cross axis.
 */
function prepareTarget(node: HTMLElement): void {
    node.style.display = 'flex';
    node.style.alignItems = 'stretch';
}

/**
 * Forces every video div silent.
 *
 * A preview is something you look at, often several at once, so it must never make noise —
 * `muted` is not the card author's decision here. The web runtime reads `json.muted`, and a
 * template may bind that prop to a parameter, so the binding goes too or it would win.
 */
function muteVideos(node: unknown): void {
    if (Array.isArray(node)) {
        node.forEach(muteVideos);
        return;
    }
    if (!node || typeof node !== 'object') {
        return;
    }

    const obj = node as Record<string, unknown>;
    if (obj.type === 'video') {
        delete obj.$muted;
        obj.muted = true;
    }
    for (const key in obj) {
        muteVideos(obj[key]);
    }
}

/**
 * Belt to the `muteVideos` braces: mutes media elements as they appear.
 *
 * Whatever the json says, a `<video>` that reaches the DOM unmuted is audible — and elements
 * arrive late (a source resolving, a state swapping, a custom div building its own player), long
 * after the render call returns. Returns the teardown.
 */
function keepSilent(node: HTMLElement): () => void {
    const mute = (root: ParentNode) => {
        root.querySelectorAll('video, audio').forEach(element => {
            (element as HTMLMediaElement).muted = true;
        });
    };

    mute(node);
    const observer = new MutationObserver(records => {
        for (const record of records) {
            record.addedNodes.forEach(added => {
                if (added instanceof HTMLMediaElement) {
                    added.muted = true;
                } else if (added instanceof Element) {
                    mute(added);
                }
            });
        }
    });
    observer.observe(node, { childList: true, subtree: true });

    return () => observer.disconnect();
}

function localPalette(json: DivJson): object {
    const variable = json.card?.variables?.find(
        (it: DivVariable) => it.type === 'dict' && it.name === 'local_palette'
    );
    return variable && 'value' in variable && variable.value && typeof variable.value === 'object' ?
        variable.value :
        {};
}
