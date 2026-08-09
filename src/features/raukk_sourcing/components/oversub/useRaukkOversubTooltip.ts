// One tooltip for every oversubscription visualization tab: the section
// mounts a single `RaukkOversubTooltip` host, tabs drive it through
// this provide/inject pair. Payloads are pre-rendered text lines — the
// tab owns wording and i18n, the host only positions and paints.

import { inject, InjectionKey, provide, ref, Ref } from "vue";

/** One tooltip body line with an optional tone */
export interface IRaukkOversubTooltipLine {
	text: string;
	tone?: "muted" | "warning" | "negative";
}

/** What one tooltip shows */
export interface IRaukkOversubTooltipPayload {
	title: string;
	lines: IRaukkOversubTooltipLine[];
}

/** Viewport rect of the hovered element the tooltip follows */
export interface IRaukkOversubTooltipRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

/** The tooltip state and its driving API */
export interface IRaukkOversubTooltip {
	payload: Ref<IRaukkOversubTooltipPayload | null>;
	targetRect: Ref<IRaukkOversubTooltipRect | null>;
	/** Show a payload anchored to the hovered element */
	show: (payload: IRaukkOversubTooltipPayload, target: Element) => void;
	hide: () => void;
}

const RAUKK_OVERSUB_TOOLTIP_KEY: InjectionKey<IRaukkOversubTooltip> = Symbol(
	"RaukkOversubTooltip"
);

/**
 * Creates the shared tooltip state and provides it to the section's
 * subtree. Called once by `RaukkOversubReportSection`, which also
 * mounts the one `RaukkOversubTooltip` host rendering it.
 *
 * @author raukk
 *
 * @returns {IRaukkOversubTooltip} The tooltip state
 */
export function provideRaukkOversubTooltip(): IRaukkOversubTooltip {
	const payload: Ref<IRaukkOversubTooltipPayload | null> = ref(null);
	const targetRect: Ref<IRaukkOversubTooltipRect | null> = ref(null);

	const tooltip: IRaukkOversubTooltip = {
		payload,
		targetRect,
		show: (nextPayload: IRaukkOversubTooltipPayload, target: Element) => {
			const rect: DOMRect = target.getBoundingClientRect();

			payload.value = nextPayload;
			targetRect.value = {
				top: rect.top,
				left: rect.left,
				width: rect.width,
				height: rect.height,
			};
		},
		hide: () => {
			payload.value = null;
			targetRect.value = null;
		},
	};

	provide(RAUKK_OVERSUB_TOOLTIP_KEY, tooltip);
	return tooltip;
}

/**
 * The section's tooltip, from any component below it.
 *
 * @author raukk
 *
 * @returns {IRaukkOversubTooltip} The shared tooltip state
 */
export function useRaukkOversubTooltip(): IRaukkOversubTooltip {
	const tooltip: IRaukkOversubTooltip | undefined = inject(
		RAUKK_OVERSUB_TOOLTIP_KEY
	);

	if (tooltip === undefined)
		throw new Error(
			"useRaukkOversubTooltip outside RaukkOversubReportSection"
		);

	return tooltip;
}
