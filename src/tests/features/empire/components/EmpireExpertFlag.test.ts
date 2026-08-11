import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import EmpireExpertFlag from "@/features/empire/components/EmpireExpertFlag.vue";

// Locales
import empire from "@/locales/en_US/empire.json";
import terms from "@/locales/en_US/terms.json";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { empire, terms } },
});

function render(experts: number): VueWrapper {
	return mount(EmpireExpertFlag, {
		props: { experts },
		global: { plugins: [i18n] },
	});
}

describe("EmpireExpertFlag", () => {
	it.each([5, 6])("stays silent on %i experts", (experts: number) => {
		expect(render(experts).text()).toBe("");
	});

	it.each([0, 1, 4])("flags %i experts as understaffed", (experts) => {
		const wrapper = render(experts);

		expect(wrapper.text()).toBe(`${experts}/6 Experts`);
		expect(wrapper.attributes("title")).toContain(
			`Only ${experts} of 6 experts assigned`
		);
	});

	it("flags an over assigned plan with its own tooltip", () => {
		const wrapper = render(7);

		expect(wrapper.text()).toBe("7/6 Experts");
		expect(wrapper.attributes("title")).toBe(
			"7 experts assigned, a base holds at most 6"
		);
	});
});
