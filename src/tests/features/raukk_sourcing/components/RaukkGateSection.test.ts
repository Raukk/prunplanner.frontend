import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Components
import RaukkGateSection from "@/features/raukk_sourcing/components/RaukkGateSection.vue";

// Calculations
import { setRaukkPlannedGateLinks } from "@/features/raukk_sourcing/calculations/routeDistance";

// UI
import { PButton, PCheckbox, PInput } from "@/ui";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

/**
 * Planets the bundled systems JSON really carries.
 *
 * `HEPH` to `FAR` is 12.88 parsecs, which a gate reaches with one range
 * upgrade; `MONTEM` is 56 parsecs from `HEPH`, past what any gate links.
 */
const HEPH: string = "ZV-307c";
const FAR: string = "IA-335b";
const MONTEM: string = "OT-580b";

function render(): VueWrapper {
	return mount(RaukkGateSection, { global: { plugins: [i18n] } });
}

/** The add button of the last row, told apart from the remove buttons */
function addButton(wrapper: VueWrapper) {
	return wrapper
		.findAllComponents(PButton)
		.find((button) => button.text() === "Add Gate")!;
}

/**
 * Types both endpoints into the add form.
 *
 * The add row holds three inputs — name, A side, B side — in that order,
 * and every row above it holds one, its name field.
 *
 * @author raukk
 *
 * @param {VueWrapper} wrapper Mounted Component
 * @param {string} planetA Planet Natural Id of the a side
 * @param {string} planetB Planet Natural Id of the b side
 */
async function typeLink(
	wrapper: VueWrapper,
	planetA: string,
	planetB: string
): Promise<void> {
	const inputs = wrapper.findAllComponents(PInput);

	inputs[inputs.length - 2].vm.$emit("update:value", planetA);
	inputs[inputs.length - 1].vm.$emit("update:value", planetB);
	await wrapper.vm.$nextTick();
}

describe("Raukk Sourcing: RaukkGateSection", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	afterEach(() => {
		setRaukkPlannedGateLinks([]);
	});

	it("says both ends are needed while the button is off", () => {
		const wrapper: VueWrapper = render();

		expect(addButton(wrapper).props("disabled")).toBe(true);
		expect(wrapper.text()).toContain("Type both planet ids");
		expect(wrapper.text()).toContain("No planned gates yet");
	});

	it("adds a switched OFF gate once both ends are entered", async () => {
		const wrapper: VueWrapper = render();

		await typeLink(wrapper, ` ${HEPH} `, FAR);

		expect(addButton(wrapper).props("disabled")).toBe(false);

		await addButton(wrapper).trigger("click");

		const gates = store.listPlannedGates();

		expect(gates).toHaveLength(1);
		expect(gates[0]).toMatchObject({
			planetA: HEPH,
			planetB: FAR,
			enabled: false,
			status: "proposed",
			// the add form buys the range the gap actually needs
			rangeUpgrades: 1,
		});
		// nothing may be routed over it before the user says so
		expect(wrapper.text()).not.toContain("are switched on");
	});

	it("warns about planets no system carries, without refusing them", async () => {
		const wrapper: VueWrapper = render();
		await typeLink(wrapper, "NOWHERE-9z", FAR);

		expect(addButton(wrapper).props("disabled")).toBe(false);
		expect(wrapper.text()).toContain("would route nothing");
	});

	it("refuses two planets of one system", async () => {
		const wrapper: VueWrapper = render();
		await typeLink(wrapper, "ZV-307c", "ZV-307d");

		expect(wrapper.text()).toContain("bridges nothing");
		// a gate nobody could build must not be addable either
		expect(addButton(wrapper).props("disabled")).toBe(true);
	});

	it("states what a planned gate would save", () => {
		store.setPlannedGate("g1", {
			planetA: HEPH,
			planetB: FAR,
			rangeUpgrades: 1,
		});

		const text: string = render().text();

		// a 12.9 pc hop against a seventeen hour FTL detour
		expect(text).toContain("%)");
		expect(text).not.toContain("Unroutable");
	});

	it("refuses a gap no gate can link, before it is even added", async () => {
		const wrapper: VueWrapper = render();
		await typeLink(wrapper, HEPH, MONTEM);

		expect(wrapper.text()).toContain("no gate can link them");
		// warning AND refusing: a row for an impossible gate would sit
		// in the table permanently red, waiting to be deleted
		expect(addButton(wrapper).props("disabled")).toBe(true);

		await addButton(wrapper).trigger("click");

		expect(store.listPlannedGates()).toHaveLength(0);
	});

	it("tags a gate whose range falls short of its own gap", () => {
		store.setPlannedGate("g1", {
			planetA: HEPH,
			planetB: FAR,
			rangeUpgrades: 0,
		});

		expect(render().text()).toContain("Out of Range");
	});

	it("says a gate saves nothing when a real one already spans it", () => {
		// the transcribed Antares corridor admits 6,000 m³, so a 3,000 m³
		// planned link over the same pair adds exactly nothing
		store.setPlannedGate("g1", {
			planetA: HEPH,
			planetB: "IA-158b",
			rangeUpgrades: 2,
		});

		const wrapper: VueWrapper = render();

		expect(wrapper.text()).not.toContain("%)");
		expect(wrapper.text()).toContain("—");
	});

	it("tags a gate the route index cannot place and bars planning it", () => {
		store.setPlannedGate("g1", { planetA: "NOWHERE-9z", planetB: FAR });

		const wrapper: VueWrapper = render();

		expect(wrapper.text()).toContain("Unroutable");
		expect(wrapper.findComponent(PCheckbox).props("disabled")).toBe(true);
	});

	it("warns while gates are switched on, and routes over them", async () => {
		store.setPlannedGate("g1", {
			planetA: HEPH,
			planetB: FAR,
			rangeUpgrades: 1,
			enabled: true,
		});

		const wrapper: VueWrapper = render();

		expect(wrapper.text()).toContain("are switched on");

		await wrapper
			.findComponent(PCheckbox)
			.vm.$emit("update:checked", false);

		expect(store.plannedGates["g1"].enabled).toBe(false);
		expect(wrapper.text()).not.toContain("are switched on");
	});

	it("lets a stranded gate be switched off, and says it is not routed", async () => {
		// switched on while valid, then its range spent elsewhere: the
		// routing has already let go of it, and the row must both say so
		// and stay correctable rather than only deletable
		store.setPlannedGate("g1", {
			planetA: HEPH,
			planetB: FAR,
			rangeUpgrades: 1,
			enabled: true,
		});
		store.setPlannedGate("g1", { rangeUpgrades: 0 });

		const wrapper: VueWrapper = render();

		expect(wrapper.text()).toContain("Not Routed");
		expect(wrapper.findComponent(PCheckbox).props("disabled")).toBe(false);

		await wrapper
			.findComponent(PCheckbox)
			.vm.$emit("update:checked", false);

		expect(store.plannedGates["g1"].enabled).toBe(false);
		expect(wrapper.text()).not.toContain("Not Routed");
	});

	it("removes a gate", async () => {
		store.setPlannedGate("g1", { planetA: HEPH, planetB: FAR });

		const wrapper: VueWrapper = render();

		await wrapper
			.findAllComponents(PButton)
			.find((button) => button.text() === "Remove")!
			.trigger("click");

		expect(store.plannedGates).toStrictEqual({});
	});
});
