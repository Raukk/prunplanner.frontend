import { describe, it, expect, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { usePlanningStore } from "@/stores/planningStore";

// Components
import RaukkDepotSection from "@/features/raukk_sourcing/components/RaukkDepotSection.vue";

// UI
import { PButton, PInput, PSelect } from "@/ui";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IPlanEmpireElement } from "@/stores/planningStore.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

/** A planet the bundled systems JSON carries AND a gate stands on */
const HEPH: string = "ZV-307c";

/** A planet the systems JSON carries, with no transcribed gate */
const GATELESS: string = "ZV-194a";

/** A second gate planet, so a dropped suggestion is a scoping one */
const OTHER_GATE: string = "OT-580b";

function render(): VueWrapper {
	return mount(RaukkDepotSection, { global: { plugins: [i18n] } });
}

/** The bare minimum of a snapshot the candidate search reads */
function makeSnapshot(name: string, planetNaturalId: string): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId,
		outputs: {},
		draws: {},
	};
}

/** The add button of the last row, told apart from the remove buttons */
function addButton(wrapper: VueWrapper) {
	return wrapper
		.findAllComponents(PButton)
		.find((button) => button.text() === "Add Depot")!;
}

/** Switches the add row from the suggestion list to the id field */
async function goManual(wrapper: VueWrapper): Promise<void> {
	await wrapper
		.findAllComponents(PButton)
		.find((button) => button.text() === "Enter Id")!
		.trigger("click");
}

/**
 * Types one planet id into the add field, switching to it first.
 *
 * @author raukk
 *
 * @param {VueWrapper} wrapper Mounted Component
 * @param {string} entered Planet Natural Id
 */
async function typePlanet(wrapper: VueWrapper, entered: string): Promise<void> {
	if (wrapper.findComponent(PInput).exists() === false) {
		await goManual(wrapper);
	}

	wrapper.findComponent(PInput).vm.$emit("update:value", entered);
	await wrapper.vm.$nextTick();
}

/**
 * Picks one planet from the suggestion list.
 *
 * @author raukk
 *
 * @param {VueWrapper} wrapper Mounted Component
 * @param {string} picked Planet Natural Id
 */
async function pickPlanet(wrapper: VueWrapper, picked: string): Promise<void> {
	wrapper.findComponent(PSelect).vm.$emit("update:value", picked);
	await wrapper.vm.$nextTick();
}

describe("Raukk Sourcing: RaukkDepotSection", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	it("asks for a pick while the button is off", async () => {
		const wrapper: VueWrapper = render();

		expect(addButton(wrapper).props("disabled")).toBe(true);
		expect(wrapper.text()).toContain("Pick one of your bases");
	});

	it("says the field has to be filled once typing by hand", async () => {
		const wrapper: VueWrapper = render();
		await goManual(wrapper);

		expect(addButton(wrapper).props("disabled")).toBe(true);
		expect(wrapper.text()).toContain("Type a planet id to enable");
	});

	it("suggests own bases on gate planets, and nothing else", async () => {
		store.setSnapshot("gate", makeSnapshot("Hephaestus", HEPH));
		store.setSnapshot("plain", makeSnapshot("Somewhere", GATELESS));

		const wrapper: VueWrapper = render();

		expect(wrapper.findComponent(PSelect).props("options")).toStrictEqual([
			{ label: `Hephaestus (${HEPH})`, value: HEPH },
		]);
	});

	it("suggests no planet only an unassigned base stands on", async () => {
		store.setSnapshot("gate", makeSnapshot("Hephaestus", HEPH));
		store.setSnapshot("off", makeSnapshot("Switched Off", OTHER_GATE));

		usePlanningStore().empires = {
			e1: {
				uuid: "e1",
				name: "E1",
				plans: [
					{
						uuid: "gate",
						plan_name: "gate",
						planet_natural_id: HEPH,
					},
				],
			},
		} as unknown as Record<string, IPlanEmpireElement>;

		const wrapper: VueWrapper = render();

		expect(wrapper.findComponent(PSelect).props("options")).toStrictEqual([
			{ label: `Hephaestus (${HEPH})`, value: HEPH },
		]);
	});

	it("drops a suggestion the moment it becomes a depot", async () => {
		store.setSnapshot("gate", makeSnapshot("Hephaestus", HEPH));

		const wrapper: VueWrapper = render();
		await pickPlanet(wrapper, HEPH);
		await addButton(wrapper).trigger("click");

		expect(store.depots["ZV-307C"]?.planetNaturalId).toBe(HEPH);
		expect(wrapper.findComponent(PSelect).props("options")).toStrictEqual(
			[]
		);
	});

	it("adds the depot once a planet id is entered", async () => {
		const wrapper: VueWrapper = render();

		await typePlanet(wrapper, ` ${HEPH} `);

		expect(addButton(wrapper).props("disabled")).toBe(false);
		expect(wrapper.text()).not.toContain("Type a planet id to enable");

		await addButton(wrapper).trigger("click");

		expect(store.depots["ZV-307C"]).toStrictEqual({
			planetNaturalId: HEPH,
			weeklyCostAic: undefined,
		});
	});

	it("refuses a depot it already knows, whatever the case", async () => {
		store.setDepot(HEPH);

		const wrapper: VueWrapper = render();
		await typePlanet(wrapper, "zv-307C");

		expect(addButton(wrapper).props("disabled")).toBe(true);
		expect(wrapper.text()).toContain("already a depot");
	});

	it("warns about a planet no system carries, without refusing it", async () => {
		const wrapper: VueWrapper = render();
		await typePlanet(wrapper, "NOWHERE-9z");

		expect(addButton(wrapper).props("disabled")).toBe(false);
		expect(wrapper.text()).toContain("would anchor nothing");
	});

	it("warns about a gateless planet, without refusing it", async () => {
		const wrapper: VueWrapper = render();
		await typePlanet(wrapper, GATELESS);

		expect(addButton(wrapper).props("disabled")).toBe(false);
		expect(wrapper.text()).toContain("No gate is known there");
	});

	it("tags a marked depot the route index cannot place", () => {
		store.setDepot("NOWHERE-9z");

		expect(render().text()).toContain("Unknown Planet");
	});

	it("tags a marked depot no gate stands on", () => {
		store.setDepot(GATELESS);

		expect(render().text()).toContain("No Gate");
	});

	it("leaves a gate depot untagged", () => {
		store.setDepot(HEPH);

		const text: string = render().text();

		expect(text).not.toContain("No Gate");
		expect(text).not.toContain("Unknown Planet");
	});
});
