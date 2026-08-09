import { describe, it, expect, beforeEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";
import {
	createRouter,
	createMemoryHistory,
	Router,
	RouteLocationRaw,
} from "vue-router";

// the page loads universe prices on mount and re-costs chains on the
// recompute button; neither is what these tests are about
vi.mock("@/features/raukk_sourcing/useRaukkChainCompute", () => ({
	raukkLoadChainPrices: vi.fn(async () => () => 0),
	computeChainResults: vi.fn(async () => []),
}));

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Components
import RaukkShippingPage from "@/features/raukk_sourcing/components/RaukkShippingPage.vue";

// UI
import { PButton } from "@/ui";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

/** Every section stubbed to a marker — the strip is what is under test */
const STUBS: Record<string, unknown> = {
	RaukkShippingSettingsSection: { template: '<div id="s-settings" />' },
	RaukkSourcingDefaultsSection: { template: '<div id="s-defaults" />' },
	RaukkFleetSection: { template: '<div id="s-fleet" />' },
	RaukkChainSection: { template: '<div id="s-chains" />' },
	RaukkDepotSection: { template: '<div id="s-depots" />' },
	RaukkGateSection: { template: '<div id="s-gates" />' },
	RaukkShippingVisualsSection: { template: '<div id="s-visuals" />' },
	RaukkShippingCalibrationSection: { template: '<div id="s-calibration" />' },
};

function makeRouter(): Router {
	return createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: "/", component: { template: "<div />" } },
			{ path: "/shipping", component: { template: "<div />" } },
		],
	});
}

async function render(to: RouteLocationRaw = "/shipping"): Promise<{
	wrapper: VueWrapper;
	router: Router;
}> {
	const router: Router = makeRouter();
	await router.push(to);
	await router.isReady();

	const wrapper = mount(RaukkShippingPage, {
		global: { plugins: [i18n, router], stubs: STUBS },
	});
	// the deep-link strip is a router.replace fired from setup
	await flushPromises();

	return { wrapper, router };
}

/** Labels of the section strip, in order */
function tabLabels(wrapper: VueWrapper): string[] {
	return wrapper
		.findAllComponents(PButton)
		.map((button) => button.text())
		.filter((label) => !label.startsWith("Recompute "));
}

async function clickTab(wrapper: VueWrapper, label: string): Promise<void> {
	const button = wrapper
		.findAllComponents(PButton)
		.find((candidate) => candidate.text() === label);

	expect(button, `no "${label}" tab`).toBeDefined();
	await button!.trigger("click");
	await wrapper.vm.$nextTick();
}

/** Marker id of every stubbed section, by component name */
const MARKERS: Record<string, string> = {
	RaukkShippingSettingsSection: "#s-settings",
	RaukkSourcingDefaultsSection: "#s-defaults",
	RaukkFleetSection: "#s-fleet",
	RaukkChainSection: "#s-chains",
	RaukkDepotSection: "#s-depots",
	RaukkGateSection: "#s-gates",
	RaukkShippingVisualsSection: "#s-visuals",
	RaukkShippingCalibrationSection: "#s-calibration",
};

/** Which section markers are currently in the DOM */
function shown(wrapper: VueWrapper): string[] {
	return Object.entries(MARKERS)
		.filter(([, id]) => wrapper.find(id).exists())
		.map(([name]) => name);
}

describe("RaukkShippingPage section tabs", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		useRaukkSourcingStore().setShippingConfig({ enabled: true });
	});

	it("offers every section and opens on Fleet", async () => {
		const { wrapper } = await render();

		expect(tabLabels(wrapper)).toStrictEqual([
			"Settings",
			"Defaults",
			"Fleet",
			"Chains",
			"Depots",
			"Gates",
			"Visuals",
			"Calibration",
		]);
		expect(wrapper.find("#s-fleet").exists()).toBe(true);
	});

	it("shows exactly one section at a time", async () => {
		const { wrapper } = await render();

		await clickTab(wrapper, "Visuals");

		expect(shown(wrapper)).toStrictEqual(["RaukkShippingVisualsSection"]);
	});

	it("reaches the visualisations in one click, not a scroll", async () => {
		const { wrapper } = await render();

		expect(wrapper.find("#s-visuals").exists()).toBe(false);
		await clickTab(wrapper, "Visuals");
		expect(wrapper.find("#s-visuals").exists()).toBe(true);
	});

	it("gives the gate planning tool a tab of its own", async () => {
		// the tool was a section appended below the page before the strip
		// existed; the merge had to make it a tab or it would render on
		// every one of them
		const { wrapper } = await render();

		expect(wrapper.find("#s-gates").exists()).toBe(false);
		await clickTab(wrapper, "Gates");

		expect(shown(wrapper)).toStrictEqual(["RaukkGateSection"]);
	});

	it("collapses to the switch-independent sections while shipping is off", async () => {
		useRaukkSourcingStore().setShippingConfig({ enabled: false });

		const { wrapper } = await render();

		// the sourcing defaults price inputs, they fly nothing, so the
		// shipping switch must not take them away
		expect(tabLabels(wrapper)).toStrictEqual(["Settings", "Defaults"]);
		expect(wrapper.find("#s-settings").exists()).toBe(true);
	});

	it("reaches the sourcing defaults with shipping off", async () => {
		useRaukkSourcingStore().setShippingConfig({ enabled: false });

		const { wrapper } = await render();
		await clickTab(wrapper, "Defaults");

		expect(shown(wrapper)).toStrictEqual(["RaukkSourcingDefaultsSection"]);
	});

	it("does not strand the page when shipping is switched off", async () => {
		const { wrapper } = await render();
		await clickTab(wrapper, "Depots");
		expect(wrapper.find("#s-depots").exists()).toBe(true);

		useRaukkSourcingStore().setShippingConfig({ enabled: false });
		await wrapper.vm.$nextTick();

		expect(wrapper.find("#s-depots").exists()).toBe(false);
		expect(wrapper.find("#s-settings").exists()).toBe(true);
	});

	it("hides the recompute actions while shipping is off", async () => {
		useRaukkSourcingStore().setShippingConfig({ enabled: false });

		const { wrapper } = await render();

		expect(wrapper.text()).not.toContain("Recompute Chains");
		expect(wrapper.text()).not.toContain("Recompute Snapshots");
	});

	it("offers both page-level recompute actions while shipping is on", async () => {
		const { wrapper } = await render();

		expect(wrapper.text()).toContain("Recompute Chains");
		expect(wrapper.text()).toContain("Recompute Snapshots");
	});
});

describe("RaukkShippingPage section state", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		useRaukkSourcingStore().setShippingConfig({ enabled: true });
	});

	it("keeps a section's unsaved local state across a tab switch", async () => {
		// the real Chains section holds the chain editor's whole draft in
		// local refs — it only reaches the store on save — so tabbing away
		// and back must NOT remount it
		const router: Router = makeRouter();
		await router.push("/shipping");
		await router.isReady();

		const wrapper = mount(RaukkShippingPage, {
			global: {
				plugins: [i18n, router],
				stubs: {
					...STUBS,
					RaukkChainSection: {
						template:
							'<div id="s-chains"><input v-model="draft" /></div>',
						data: () => ({ draft: "" }),
					},
				},
			},
		});
		await flushPromises();

		await clickTab(wrapper, "Chains");
		await wrapper.find("#s-chains input").setValue("half-typed chain");

		await clickTab(wrapper, "Depots");
		expect(wrapper.find("#s-chains").exists()).toBe(false);

		await clickTab(wrapper, "Chains");
		expect(
			(wrapper.find("#s-chains input").element as HTMLInputElement).value
		).toBe("half-typed chain");
	});
});

describe("RaukkShippingPage ?section= deep link", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		useRaukkSourcingStore().setShippingConfig({ enabled: true });
	});

	it("opens the named section", async () => {
		const { wrapper } = await render("/shipping?section=visuals");

		expect(wrapper.find("#s-visuals").exists()).toBe(true);
	});

	it("strips the param so a back-nav cannot resurrect the section", async () => {
		const { router } = await render("/shipping?section=visuals");

		expect(router.currentRoute.value.query.section).toBeUndefined();
		expect(router.currentRoute.value.path).toBe("/shipping");
	});

	it("falls back to Fleet on an unknown section", async () => {
		const { wrapper } = await render("/shipping?section=nope");

		expect(wrapper.find("#s-fleet").exists()).toBe(true);
	});

	it("will not deep link past the shipping switch", async () => {
		useRaukkSourcingStore().setShippingConfig({ enabled: false });

		const { wrapper } = await render("/shipping?section=visuals");

		expect(wrapper.find("#s-visuals").exists()).toBe(false);
		expect(wrapper.find("#s-settings").exists()).toBe(true);
	});
});
