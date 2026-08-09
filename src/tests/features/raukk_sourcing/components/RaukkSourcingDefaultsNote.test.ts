import { describe, it, expect, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";

// Components
import RaukkSourcingDefaultsNote from "@/features/raukk_sourcing/components/RaukkSourcingDefaultsNote.vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Locales
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { raukk_sourcing } },
});

function render(): VueWrapper {
	return mount(RaukkSourcingDefaultsNote, {
		global: { plugins: [i18n], stubs: { RouterLink: true } },
	});
}

describe("RaukkSourcingDefaultsNote", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	it("stays invisible while no default is set", () => {
		expect(render().text()).toBe("");
	});

	it("names the group and the source of every default in force", () => {
		store.setSourcingDefault("workforce", {
			mode: "plan",
			sourcePlanUuid: "AGG_AVG_MKT",
		});
		store.setSourcingDefault("repair", {
			mode: "plan",
			sourcePlanUuid: "AGG_AVG",
		});

		const text: string = render().text();

		expect(text).toContain(raukk_sourcing.inputs.groups.workforce);
		expect(text).toContain(raukk_sourcing.source_option.agg_avg_mkt);
		expect(text).toContain(raukk_sourcing.inputs.groups.repair);
		// the group without a default is not listed
		expect(text).not.toContain(raukk_sourcing.inputs.groups.production);
	});
});
