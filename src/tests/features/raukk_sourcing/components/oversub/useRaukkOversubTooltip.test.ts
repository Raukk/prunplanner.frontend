import { describe, expect, it } from "vitest";

// Composables
import { raukkTooltipFromText } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

describe("raukkTooltipFromText", () => {
	it("reads the first line as the title and the rest as the body", () => {
		const payload = raukkTooltipFromText("NC1 → OT-580b\n120 t/d\nRAT, DW");

		expect(payload.title).toBe("NC1 → OT-580b");
		expect(payload.lines.map((line) => line.text)).toStrictEqual([
			"120 t/d",
			"RAT, DW",
		]);
	});

	it("drops empty lines, so a message with no tickers has no blank row", () => {
		const payload = raukkTooltipFromText("NC1 → OT-580b\n120 t/d\n");

		expect(payload.lines).toHaveLength(1);
	});

	it("carries a single line message as a title with no body", () => {
		const payload = raukkTooltipFromText("QQ-999a — never visited");

		expect(payload.title).toBe("QQ-999a — never visited");
		expect(payload.lines).toStrictEqual([]);
	});

	it("states no tone, so the host paints every line neutrally", () => {
		const payload = raukkTooltipFromText("a\nb");

		expect(payload.lines[0].tone).toBeUndefined();
	});
});
