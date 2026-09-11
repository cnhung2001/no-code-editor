import { SizeProvider } from '@divkitframework/divkit/client-devtool';
import type { DivExtensionClass } from '@divkitframework/divkit/typings/common';
import { Lottie } from './lottieExt';
import { ScratchCard } from './ik/scratchCardExt';
import { TweenAnim } from './ik/tweenAnimExt';
import { MarqueeAnim } from './ik/marqueeAnimExt';

/**
 * Extensions every DivKit render in the editor gets — DivKit's own plus the ones ik-paywall
 * implements natively (ported in ./ik). Shared so the full preview and the thumbnail preview
 * cannot drift apart: a card that animates in the editor has to animate on a card thumbnail too.
 */
export function createDivExtensions(): Map<string, DivExtensionClass> {
    return new Map<string, DivExtensionClass>([
        ['size_provider', SizeProvider],
        ['lottie', Lottie],
        ['scratch_card', ScratchCard],
        ['tween_anim', TweenAnim],
        ['marquee_anim', MarqueeAnim]
    ]);
}
