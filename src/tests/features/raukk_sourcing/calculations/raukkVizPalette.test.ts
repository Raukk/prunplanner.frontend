import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_VIZ_ACCENT,
	RAUKK_VIZ_ALERT,
	RAUKK_VIZ_CSS_VARS,
	RAUKK_VIZ_INK,
	RAUKK_VIZ_INK_RGB,
	RAUKK_VIZ_RAMP,
	RAUKK_VIZ_SURFACE,
} from "@/features/raukk_sourcing/calculations/raukkVizPalette";
import {
	RAUKK_OVERSUB_SLOT_COLORS,
	RAUKK_OVERSUB_STATUS_COLORS,
} from "@/features/raukk_sourcing/calculations/oversubDisplay";
import { RAUKK_MAP_BUCKET_COLORS } from "@/features/raukk_sourcing/calculations/shippingMapDisplay";

/** "#aabbcc" → "170, 187, 204", the form the inline rgba() ramps take */
function toChannels(hex: string): string {
	const value: number = parseInt(hex.slice(1), 16);

	return [(value >> 16) & 255, (value >> 8) & 255, value & 255].join(", ");
}

describe("raukkVizPalette", () => {
	it("keeps the channel forms in step with their hex", () => {
		// they are declared separately so the inline rgba() washes can
		// interpolate them; nothing else stops them drifting apart
		expect(RAUKK_VIZ_INK_RGB).toBe(toChannels(RAUKK_VIZ_INK.base));
		expect(RAUKK_VIZ_ALERT.rgb).toBe(toChannels(RAUKK_VIZ_ALERT.solid));
		expect(RAUKK_VIZ_RAMP.stroke).toContain(RAUKK_VIZ_RAMP.rgb);
		expect(RAUKK_VIZ_RAMP.rgb).toBe(toChannels(RAUKK_VIZ_RAMP.solid));
	});

	it("exposes every token as a CSS var", () => {
		const declared: string[] = Object.values(RAUKK_VIZ_CSS_VARS as object);

		[
			...Object.values(RAUKK_VIZ_SURFACE),
			...Object.values(RAUKK_VIZ_INK),
			...Object.values(RAUKK_VIZ_ALERT),
			...Object.values(RAUKK_VIZ_ACCENT),
		].forEach((token) => expect(declared).toContain(token));
	});

	it("names each surface and ink weight exactly once", () => {
		const ramp: string[] = [
			...Object.values(RAUKK_VIZ_SURFACE),
			...Object.values(RAUKK_VIZ_INK),
		];

		expect(new Set(ramp).size).toBe(ramp.length);
	});

	it("keeps the oversubscription status colors on the shared pair", () => {
		// one red and one amber across every view: a second red would
		// read as a second, different verdict
		expect(RAUKK_OVERSUB_STATUS_COLORS.over).toBe(RAUKK_VIZ_ALERT.solid);
		expect(RAUKK_OVERSUB_STATUS_COLORS.overText).toBe(RAUKK_VIZ_ALERT.text);
		expect(RAUKK_OVERSUB_STATUS_COLORS.stale).toBe(RAUKK_VIZ_ALERT.warn);
		expect(RAUKK_OVERSUB_STATUS_COLORS.other).toBe(RAUKK_VIZ_INK.muted);
		expect(RAUKK_OVERSUB_STATUS_COLORS.external).toBe(RAUKK_VIZ_INK.faint);
	});

	it("never lets a series color double as a status or an accent", () => {
		const reserved: string[] = [
			RAUKK_VIZ_ALERT.solid,
			RAUKK_VIZ_ALERT.text,
			RAUKK_VIZ_ALERT.warn,
			RAUKK_VIZ_ACCENT.solid,
		];

		[
			...RAUKK_OVERSUB_SLOT_COLORS,
			...Object.values(RAUKK_MAP_BUCKET_COLORS),
		].forEach((series) => expect(reserved).not.toContain(series));
	});
});
