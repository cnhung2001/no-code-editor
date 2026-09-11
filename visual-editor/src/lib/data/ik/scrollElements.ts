import type { DivExtensionContext } from '@divkitframework/divkit/typings/common';
import { attributeProps, objectProps, type IkProps } from './props';

/**
 * The two scrolling containers `IKCustomContainerAdapter` renders natively on Android, rebuilt as
 * custom elements so the editor preview scrolls the same content the device does.
 *
 * Children arrive as light-DOM nodes — DivKit renders a custom div's `items` inside the element —
 * so both elements are shadow roots with a `<slot>` and the scroll box around it.
 */

export const NESTED_SCROLL_VIEW = 'nested_scroll_view';
export const BOTTOM_SHEET_SCROLL = 'bottom_sheet_scroll';

export const NESTED_SCROLL_TAG = 'ik-nested-scroll-view';
export const BOTTOM_SHEET_TAG = 'ik-bottom-sheet-scroll';

const DEFAULT_CORNER_RADIUS_DP = 18;
const DEFAULT_EXPANDED_OFFSET_PX = 140;
const DEFAULT_BANNER_ASPECT = 1.15;
/** Past this share of the travel a release snaps to the far end rather than back. */
const SNAP_FRACTION = 0.5;

/**
 * `NestedScrollView` wrapping a vertical, horizontally-centred content column.
 *
 * ```json
 * { "type": "custom", "custom_type": "nested_scroll_view", "items": [] }
 * ```
 */
class NestedScrollViewElement extends HTMLElement {
    connectedCallback(): void {
        if (this.shadowRoot) {
            return;
        }
        this.attachShadow({ mode: 'open' }).innerHTML = `<style>
            :host {
                display: block;
                box-sizing: border-box;
                width: 100%;
                height: 100%;
                overflow-y: auto;
                overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
                /* The preview is inert -- renderer__content-inner's child is pointer-events:
                   none -- with scroll containers exempted so off-screen content can be reached,
                   the same exemption the editor grants a gallery or pager. */
                pointer-events: auto;
            }
            ::slotted(*) { pointer-events: none; }
            .content {
                display: flex;
                flex-direction: column;
                align-items: center;
                min-height: 100%;
            }
        </style><div class="content"><slot></slot></div>`;
    }
}

/**
 * Material `BottomSheetBehavior` with a scrollable content area.
 *
 * Collapsed, the sheet's top edge sits `width / banner_aspect` below the container's top, leaving
 * room for the banner artwork the layout draws underneath it; expanded, it stops `expanded_offset`
 * from the top. Dragging the sheet snaps between the two, and reaching the collapsed state writes
 * `false` into `collapse_variable` — the same signal the card reacts to on device.
 *
 * ```json
 * {
 *   "type": "custom",
 *   "custom_type": "bottom_sheet_scroll",
 *   "custom_props": {
 *     "corner_radius": 18,
 *     "expanded_offset": 140,
 *     "collapse_variable": "is_collapsed",
 *     "banner_aspect": 1.15
 *   },
 *   "items": []
 * }
 * ```
 */
class BottomSheetScrollElement extends HTMLElement {
    private context: DivExtensionContext | undefined;
    private sheet: HTMLElement | undefined;
    private resizeObserver: ResizeObserver | undefined;
    private propsObserver: MutationObserver | undefined;

    private cornerRadius = DEFAULT_CORNER_RADIUS_DP;
    private expandedOffset = DEFAULT_EXPANDED_OFFSET_PX;
    private bannerAspect = DEFAULT_BANNER_ASPECT;
    private collapseVariable: string | undefined;

    private expanded = false;
    private dragFrom = 0;
    private dragTop = 0;
    private dragging = false;

    connectedCallback(): void {
        if (!this.shadowRoot) {
            const root = this.attachShadow({ mode: 'open' });
            root.innerHTML = `<style>
                :host {
                    display: block;
                    position: relative;
                    box-sizing: border-box;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    /* See the note in the nested scroll view: the sheet is a scroller, so it is
                       exempt from the preview's inert pointer-events. */
                    pointer-events: auto;
                }
                ::slotted(*) { pointer-events: none; }
                .sheet {
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    overflow-y: auto;
                    overscroll-behavior: contain;
                    background: #fff;
                    touch-action: pan-y;
                    transition: top .25s ease-out;
                }
                .sheet.dragging { transition: none; }
                .content { display: block; }
            </style><div class="sheet" part="sheet"><div class="content"><slot></slot></div></div>`;
            this.sheet = root.querySelector('.sheet') as HTMLElement;
            this.sheet.addEventListener('pointerdown', event => this.onPointerDown(event));
            this.sheet.addEventListener('pointermove', event => this.onPointerMove(event));
            this.sheet.addEventListener('pointerup', event => this.onPointerUp(event));
            this.sheet.addEventListener('pointercancel', event => this.onPointerUp(event));
        }

        this.resizeObserver = new ResizeObserver(() => this.layout());
        this.resizeObserver.observe(this);
        this.propsObserver = new MutationObserver(() => this.apply());
        this.propsObserver.observe(this, { attributes: true });
        // See the note in the lucky wheel: the component context only arrives after mount.
        queueMicrotask(() => this.apply());
    }

    disconnectedCallback(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        this.propsObserver?.disconnect();
        this.propsObserver = undefined;
    }

    divKitApiCallback(context: DivExtensionContext): void {
        this.context = context;
        this.apply();
    }

    private readProps(): IkProps {
        const customProps = this.context?.getComponentProperty<unknown>('custom_props');
        return customProps ? objectProps(customProps) : attributeProps(this);
    }

    private apply(): void {
        const props = this.readProps();
        this.cornerRadius = props.number('corner_radius') ?? DEFAULT_CORNER_RADIUS_DP;
        this.expandedOffset = Math.trunc(props.number('expanded_offset') ?? DEFAULT_EXPANDED_OFFSET_PX);
        this.bannerAspect = props.number('banner_aspect') ?? DEFAULT_BANNER_ASPECT;
        this.collapseVariable = props.string('collapse_variable');

        if (this.sheet) {
            this.sheet.style.borderRadius = `${this.cornerRadius}px ${this.cornerRadius}px 0 0`;
        }
        this.layout();
    }

    /** Top offset, in px from the container's top, of each snap position. */
    private collapsedTop(): number {
        return Math.max(this.clientWidth / (this.bannerAspect || DEFAULT_BANNER_ASPECT), 0);
    }

    private layout(): void {
        if (!this.sheet || this.dragging) {
            return;
        }
        const top = this.expanded ? this.expandedOffset : this.collapsedTop();
        this.sheet.style.top = `${Math.min(top, Math.max(this.clientHeight - 1, 0))}px`;
    }

    private setExpanded(expanded: boolean): void {
        const wasExpanded = this.expanded;
        this.expanded = expanded;
        this.layout();
        if (!expanded && wasExpanded !== expanded) {
            this.reportCollapsed();
        }
    }

    /**
     * Android writes the string `"false"` on collapse, which goes through the same coercion
     * `div-action://set_variable` uses — so a boolean variable ends up `false`, not truthy.
     */
    private reportCollapsed(): void {
        if (!this.collapseVariable) {
            return;
        }
        this.context?.variables.get(this.collapseVariable)?.set('false');
    }

    private onPointerDown(event: PointerEvent): void {
        const sheet = this.sheet;
        if (!sheet) {
            return;
        }
        // The sheet only takes over the gesture when its own scroll is already at the top;
        // otherwise the content scrolls, same as a nested scroll on device.
        if (this.expanded && sheet.scrollTop > 0) {
            return;
        }
        this.dragging = true;
        this.dragFrom = event.clientY;
        this.dragTop = sheet.offsetTop;
        sheet.classList.add('dragging');
        sheet.setPointerCapture(event.pointerId);
    }

    private onPointerMove(event: PointerEvent): void {
        if (!this.dragging || !this.sheet) {
            return;
        }
        const collapsed = this.collapsedTop();
        const next = this.dragTop + (event.clientY - this.dragFrom);
        this.sheet.style.top = `${Math.min(Math.max(next, this.expandedOffset), collapsed)}px`;
        // The editor arms its drag-to-move on pointerdown and does the moving from a
        // document-level pointermove. Dragging the sheet has to stop there — pointerdown itself
        // is left to propagate, so clicking the sheet still selects the component.
        event.stopPropagation();
        event.preventDefault();
    }

    private onPointerUp(event: PointerEvent): void {
        if (!this.dragging || !this.sheet) {
            return;
        }
        this.dragging = false;
        this.sheet.classList.remove('dragging');
        this.sheet.releasePointerCapture(event.pointerId);

        const collapsed = this.collapsedTop();
        const travel = collapsed - this.expandedOffset;
        const progress = travel > 0 ? (collapsed - this.sheet.offsetTop) / travel : 0;
        this.setExpanded(progress > SNAP_FRACTION);
    }
}

export function defineNestedScrollElement(): string {
    if (!customElements.get(NESTED_SCROLL_TAG)) {
        customElements.define(NESTED_SCROLL_TAG, NestedScrollViewElement);
    }
    return NESTED_SCROLL_TAG;
}

export function defineBottomSheetElement(): string {
    if (!customElements.get(BOTTOM_SHEET_TAG)) {
        customElements.define(BOTTOM_SHEET_TAG, BottomSheetScrollElement);
    }
    return BOTTOM_SHEET_TAG;
}
