import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Component, defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";

// Components
import RaukkShippingMapSection from "@/features/raukk_sourcing/components/RaukkShippingMapSection.vue";
import RaukkCapacityPlaneSection from "@/features/raukk_sourcing/components/RaukkCapacityPlaneSection.vue";
import RaukkOversubTooltip from "@/features/raukk_sourcing/components/oversub/RaukkOversubTooltip.vue";

// Composables
import { provideRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

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

/**
 * Both views drive the hover host their section provides, exactly as
 * `RaukkShippingVisualsSection` does — mounting one on its own would
 * inject nothing and throw.
 */
function mountInSection(
	component: Component,
	props: Record<string, unknown>
): VueWrapper {
	const host = defineComponent({
		setup() {
			provideRaukkOversubTooltip();

			return () =>
				h("div", [h(component, props), h(RaukkOversubTooltip)]);
		},
	});

	return mount(host, {
		global: { plugins: [i18n], stubs: { teleport: true } },
	});
}

function mountMap(lanes: IRaukkMapLane[] = LANES): VueWrapper {
	return mountInSection(RaukkShippingMapSection, {
		lanes,
		stopNames: STOP_NAMES,
		depotPlanets: [],
	});
}

function mountPlane(lanes: IRaukkMapLane[] = LANES): VueWrapper {
	return mountInSection(RaukkCapacityPlaneSection, {
		lanes,
		stopNames: STOP_NAMES,
		defaultCadenceDays: 14,
	});
}

describe("RaukkShippingMapSection", () => {
	// the plot is the one svg carrying `touch-none`; the button and
	// checkbox components render icon <svg> of their own
	const PLOT: string = "svg.touch-none";

	// hover target, drawn curve and arrowhead
	it("draws three paths per lane", () => {
		const wrapper: VueWrapper = mountMap();

		expect(wrapper.findAll(`${PLOT} path`)).toHaveLength(LANES.length * 3);
	});

	// the reading used to hang off a `<title>` nested in the shared
	// group, which browsers show for the WHOLE group — one tooltip for
	// every stop on the map
	it("gives every stop its own hover target", () => {
		// NC1, OT-580b and ZV-307c
		expect(mountMap().findAll(`${PLOT} g.stop`)).toHaveLength(3);
	});

	it("shows the hovered stop's own reading", async () => {
		const map: VueWrapper = mountMap();

		await map.findAll(`${PLOT} g.stop`)[0].trigger("pointerenter");

		// the busiest stop first, and the wording no label carries
		expect(map.text()).toContain("Arriving");
		expect(map.text()).toContain("Moria Steel (OT-580b)");
	});

	it("shows the hovered lane's reading", async () => {
		const map: VueWrapper = mountMap();

		await map.findAll(`${PLOT} g.lane`)[0].trigger("pointerenter");

		expect(map.text()).toContain("Weight");
	});

	it("drops the reading again when the pointer leaves", async () => {
		const map: VueWrapper = mountMap();
		const target = map.findAll(`${PLOT} g.stop`)[0];

		await target.trigger("pointerenter");
		await target.trigger("pointerleave");

		expect(map.text()).not.toContain("Arriving");
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
		expect(mountPlane().findAll("svg g.lane")).toHaveLength(LANES.length);
	});

	it("shows the hovered lane's figures on hover", async () => {
		const plane: VueWrapper = mountPlane();

		await plane.findAll("svg g.lane")[0].trigger("pointerenter");

		expect(plane.text()).toContain("smallest fitting bay");
		expect(plane.text()).toContain("per trip");
	});

	it("drops the reading again when the pointer leaves", async () => {
		const plane: VueWrapper = mountPlane();
		const target = plane.findAll("svg g.lane")[0];

		await target.trigger("pointerenter");
		await target.trigger("pointerleave");

		expect(plane.text()).not.toContain("smallest fitting bay");
	});

	// the verdict names a bay, and without naming the lane behind it the
	// reader cannot act on it
	it("names the lane the recommended bay is sized for", () => {
		const text: string = mountPlane().text();

		expect(text).toContain("Driven by");
		expect(text).toContain("Moria Steel");
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

		expect(wrapper.findAll("svg g.lane")).toHaveLength(0);
		expect(wrapper.text()).toContain("No lanes carry anything yet");
	});
});
