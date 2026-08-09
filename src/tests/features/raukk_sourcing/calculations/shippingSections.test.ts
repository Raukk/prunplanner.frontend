import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_SHIPPING_DEFAULT_SECTION,
	RAUKK_SHIPPING_SECTIONS,
	raukkShippingResolveSection,
	raukkShippingSectionFromQuery,
	raukkShippingSections,
} from "@/features/raukk_sourcing/calculations/shippingSections";

describe("raukkShippingSections", () => {
	it("offers every section while shipping is charged", () => {
		expect(raukkShippingSections(true)).toStrictEqual([
			...RAUKK_SHIPPING_SECTIONS,
		]);
	});

	it("keeps the switch-independent sections while shipping is off", () => {
		// Settings carries the switch itself; the sourcing defaults only
		// price inputs, they fly nothing, so shipping must not hide them
		expect(raukkShippingSections(false)).toStrictEqual([
			"settings",
			"defaults",
		]);
	});

	it("does not hand out the shared constant array", () => {
		const first = raukkShippingSections(true);
		first.pop();

		expect(raukkShippingSections(true)).toHaveLength(
			RAUKK_SHIPPING_SECTIONS.length
		);
	});
});

describe("raukkShippingResolveSection", () => {
	it("keeps a reachable section", () => {
		expect(raukkShippingResolveSection("depots", true)).toBe("depots");
	});

	it("rescues a section the shipping switch just closed off", () => {
		// turning shipping off while standing on Depots must not strand
		// the page on a tab that no longer renders
		expect(raukkShippingResolveSection("depots", false)).toBe("settings");
	});

	it("leaves the sourcing defaults reachable with shipping off", () => {
		expect(raukkShippingResolveSection("defaults", false)).toBe("defaults");
	});

	it("leaves Settings alone either way", () => {
		expect(raukkShippingResolveSection("settings", false)).toBe("settings");
		expect(raukkShippingResolveSection("settings", true)).toBe("settings");
	});
});

describe("raukkShippingSectionFromQuery", () => {
	it("opens a known section named by the deep link", () => {
		expect(raukkShippingSectionFromQuery("visuals", true)).toBe("visuals");
	});

	it("falls back on anything it cannot use", () => {
		[undefined, null, "", "nope", ["visuals"], 3].forEach((raw) =>
			expect(raukkShippingSectionFromQuery(raw, true)).toBe(
				RAUKK_SHIPPING_DEFAULT_SECTION
			)
		);
	});

	it("honours an explicit fallback over the default", () => {
		expect(raukkShippingSectionFromQuery(undefined, true, "chains")).toBe(
			"chains"
		);
	});

	it("will not deep link into a section shipping has closed off", () => {
		expect(raukkShippingSectionFromQuery("visuals", false)).toBe(
			"settings"
		);
	});

	it("still deep links to the defaults with shipping off", () => {
		expect(raukkShippingSectionFromQuery("defaults", false)).toBe(
			"defaults"
		);
	});

	it("resolves every section key it advertises", () => {
		RAUKK_SHIPPING_SECTIONS.forEach((section) =>
			expect(raukkShippingSectionFromQuery(section, true)).toBe(section)
		);
	});
});
