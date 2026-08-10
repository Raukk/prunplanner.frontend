// One tooltip for every raukk visualization: the section mounts a
// single `RaukkOversubTooltip` host, its views drive it through this
// provide/inject pair. Payloads are pre-rendered text lines — the view
// owns wording and i18n, the host only positions and paints.
//
// Provided by `RaukkOversubReportSection` for the oversubscription tabs
// and by `RaukkShippingVisualsSection` for the star map and the
// weight/volume plane. Both mount their own host; the injection key is
// module level, so a view only ever reaches the section it sits in.

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
 * A payload from one newline separated i18n string: the first line is
 * the title and the rest are the body, blank lines dropped.
 *
 * The map and the plane already state their readings as multi-line
 * message strings, which is exactly the shape an SVG `<title>` wants
 * and exactly the wrong shape for a hover host that lays lines out
 * itself. Splitting here keeps ONE wording per reading — a second,
 * line-by-line set of keys would drift from the first.
 *
 * @author raukk
 *
 * @param {string} text Newline separated message
 * @returns {IRaukkOversubTooltipPayload} Title and body lines
 */
export function raukkTooltipFromText(
	text: string
): IRaukkOversubTooltipPayload {
	const [title, ...rest]: string[] = text.split("\n");

	return {
		title: title ?? "",
		lines: rest
			.filter((line) => line.trim() !== "")
			.map((line) => ({ text: line })),
	};
}

/**
 * Creates the shared tooltip state and provides it to the section's
 * subtree. Called once per section that shows visualizations, which
 * also mounts the one `RaukkOversubTooltip` host rendering it.
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
			"useRaukkOversubTooltip outside a section providing it"
		);

	return tooltip;
}
