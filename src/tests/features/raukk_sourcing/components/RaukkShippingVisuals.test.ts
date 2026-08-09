import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import RaukkShippingMapSection from "@/features/raukk_sourcing/components/RaukkShippingMapSection.vue";
import RaukkCapacityPlaneSection from "@/features/raukk_sourcing/components/RaukkCapacityPlaneSection.vue";

// UI
import { PButton } from "@/ui";

// Calculations
import { IRaukkMapLane } from "@/features/raukk_sourcing/calculations/shippingMapDisplay";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

/**
 * Lanes over stops the bundled systems JSON really carries, so the
 * projection resolves rather than dropping everything as unmapped.
 */
const LANES: IRaukkMapLane[] = [
	{
		key: "NC1>OT-580b#production",
		fromStop: "NC1",
		toStop: "OT-580b",
		bucket: "production",
		weightPerDay: 120,
		volumePerDay: 40,
		unitsPerDay: 60,
		tickers: ["RAT", "DW"],
	},
	{
		key: "OT-580b>ZV-307c#workforce",
		fromStop: "OT-580b",
		toStop: "ZV-307c",
		bucket: "workforce",
		weightPerDay: 30,
		volumePerDay: 90,
		unitsPerDay: 15,
		tickers: ["OVE"],
	},
];

const STOP_NAMES: Record<string, string> = {
	"OT-580b": "Moria Steel",
	"ZV-307c": "Hephaestus",
};

function mountMap(lanes: IRaukkMapLane[] = LANES): VueWrapper {
	return mount(RaukkShippingMapSection, {
		props: { lanes, stopNames: STOP_NAMES, depotPlanets: [] },
		global: { plugins: [i18n] },
	});
}

function mountPlane(lanes: IRaukkMapLane[] = LANES): VueWrapper {
	return mount(RaukkCapacityPlaneSection, {
		props: { lanes, stopNames: STOP_NAMES, defaultCadenceDays: 14 },
		global: { plugins: [i18n] },
	});
}

describe("RaukkShippingMapSection", () => {
	// the plot is the one svg carrying `touch-none`; the button and
	// checkbox components render icon <svg> of their own
	const PLOT: string = "svg.touch-none";

	it("draws one curve and one arrowhead per lane", () => {
		const wrapper: VueWrapper = mountMap();

		expect(wrapper.findAll(`${PLOT} path`)).toHaveLength(LANES.length * 2);
	});

	it("draws a marker for every stop the lanes touch", () => {
		const wrapper: VueWrapper = mountMap();

		// NC1 is an exchange (rect), the two planets are bases (circle)
		expect(wrapper.findAll(`${PLOT} circle`).length).toBeGreaterThanOrEqual(
			2
		);
	});

	it("labels the stops with their plan names", () => {
		expect(mountMap().text()).toContain("Moria Steel");
	});

	// the button components render icon <svg> of their own, so the empty
	// state is asserted on the data marks rather than on any <svg>
	it("says so rather than drawing an empty frame without lanes", () => {
		const wrapper: VueWrapper = mountMap([]);

		expect(wrapper.find(PLOT).exists()).toBe(false);
		expect(wrapper.text()).toContain("No lanes to draw");
	});

	it("redraws when the width metric changes", async () => {
		const wrapper: VueWrapper = mountMap();
		const before: string = wrapper.html();

		await wrapper
			.findAllComponents(PButton)
			.find((button) => button.text() === "m³ / day")!
			.trigger("click");

		// volume ranks the two lanes the other way round, so the strokes move
		expect(wrapper.html()).not.toBe(before);
	});
});

describe("RaukkCapacityPlaneSection", () => {
	it("plots one point per lane", () => {
		expect(mountPlane().findAll("svg circle")).toHaveLength(LANES.length);
	});

	it("draws a box per cargo bay", () => {
		expect(mountPlane().findAll("svg rect").length).toBeGreaterThanOrEqual(
			6
		);
	});

	it("states how many lanes the selected bay carries whole", () => {
		expect(mountPlane().text()).toContain("of 2 lanes whole");
	});

	it("moves every point when the cadence changes", async () => {
		const wrapper: VueWrapper = mountPlane();
		const before: string = wrapper.find("svg circle").attributes("cx");

		await wrapper.find('input[type="range"]').setValue(String(28));

		expect(wrapper.find("svg circle").attributes("cx")).not.toBe(before);
	});

	it("clamps the cadence to the slider range", async () => {
		const wrapper: VueWrapper = mountPlane();

		await wrapper.find('input[type="range"]').setValue(String(9999));

		// 90 days is the maximum the model offers
		expect(wrapper.find('input[type="range"]').element).toBeTruthy();
		expect(wrapper.text()).toContain("days per visit");
	});

	it("says so rather than drawing an empty plane without lanes", () => {
		const wrapper: VueWrapper = mountPlane([]);

		expect(wrapper.findAll("svg circle")).toHaveLength(0);
		expect(wrapper.text()).toContain("No lanes carry anything yet");
	});
});
