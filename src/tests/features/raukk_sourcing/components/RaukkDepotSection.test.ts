import { describe, it, expect, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createPinia, setActivePinia } from "pinia";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Components
import RaukkDepotSection from "@/features/raukk_sourcing/components/RaukkDepotSection.vue";

// UI
import { PButton, PInput } from "@/ui";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

/** A planet the bundled systems JSON really carries */
const HEPH: string = "ZV-307c";

function render(): VueWrapper {
	return mount(RaukkDepotSection, { global: { plugins: [i18n] } });
}

/** The add button of the last row, told apart from the remove buttons */
function addButton(wrapper: VueWrapper) {
	return wrapper
		.findAllComponents(PButton)
		.find((button) => button.text() === "Add Depot")!;
}

/**
 * Types one planet id into the add field.
 *
 * @author raukk
 *
 * @param {VueWrapper} wrapper Mounted Component
 * @param {string} entered Planet Natural Id
 */
async function typePlanet(wrapper: VueWrapper, entered: string): Promise<void> {
	wrapper.findComponent(PInput).vm.$emit("update:value", entered);
	await wrapper.vm.$nextTick();
}

describe("Raukk Sourcing: RaukkDepotSection", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	it("says the field has to be filled while the button is off", async () => {
		const wrapper: VueWrapper = render();

		expect(addButton(wrapper).props("disabled")).toBe(true);
		expect(wrapper.text()).toContain("Type a planet id to enable");
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

	it("tags a marked depot the route index cannot place", () => {
		store.setDepot("NOWHERE-9z");

		expect(render().text()).toContain("Unknown Planet");
	});
});
