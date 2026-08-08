import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import RaukkLocalPriceInput from "@/features/raukk_sourcing/components/RaukkLocalPriceInput.vue";

// UI
import { PSelect } from "@/ui";

// Locales
import common from "@/locales/en_US/common.json";
import raukk_sourcing from "@/locales/en_US/raukk_sourcing.json";

// Types & Interfaces
import { IRaukkLocalPrice } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { common, raukk_sourcing } },
});

/** A real order book, both sides quoted */
const exchange: IRaukkExchangePrices = {
	bid: 100,
	ask: 140,
	vwap_7d: 115,
	vwap_30d: 125,
};

function render(
	price: IRaukkLocalPrice,
	exchangePrices: IRaukkExchangePrices | undefined = exchange
): VueWrapper {
	return mount(RaukkLocalPriceInput, {
		props: {
			price,
			exchange: exchangePrices,
			exchangeCode: "AI1",
		},
		global: { plugins: [i18n] },
	});
}

/**
 * Emits a basis selection the way the dropdown does and returns the
 * price the component re-emitted.
 *
 * @author raukk
 *
 * @param {VueWrapper} wrapper Mounted Component
 * @param {string} basis Selected basis
 * @returns {IRaukkLocalPrice} Re-emitted price
 */
function selectBasis(wrapper: VueWrapper, basis: string): IRaukkLocalPrice {
	wrapper.findComponent(PSelect).vm.$emit("update:value", basis);

	const emitted = wrapper.emitted("update:price");
	expect(emitted).toBeTruthy();

	return (emitted as IRaukkLocalPrice[][])[
		(emitted as unknown[][]).length - 1
	][0];
}

describe("Raukk Sourcing: Local Price Input", () => {
	describe("basis switching", () => {
		it("resets the value leaving MANUAL", () => {
			const wrapper = render({ basis: "MANUAL", value: 175 });

			expect(selectBasis(wrapper, "BID")).toStrictEqual({
				basis: "BID",
				value: 0,
			});
		});

		it("resets the value entering MANUAL", () => {
			const wrapper = render({ basis: "BID", value: 25 });

			expect(selectBasis(wrapper, "MANUAL")).toStrictEqual({
				basis: "MANUAL",
				value: 0,
			});
		});

		it("keeps the offset between two market bases", () => {
			const wrapper = render({ basis: "BID", value: 25 });

			expect(selectBasis(wrapper, "AVG30D")).toStrictEqual({
				basis: "AVG30D",
				value: 25,
			});
		});
	});

	describe("readout", () => {
		it("shows the resolved price and the exchange of the basis", () => {
			const text = render({ basis: "BID", value: 25 }).text();

			expect(text).toContain("= 75.00 ȼ/u");
			expect(text).toContain("@ AI1");
		});

		it("names the exchange only for a market basis", () => {
			const text = render({ basis: "MANUAL", value: 175 }).text();

			expect(text).toContain("= 175.00 ȼ/u");
			expect(text).not.toContain("@ AI1");
		});

		it("marks a price the offset clamped away", () => {
			const wrapper = render({ basis: "MID", value: 23213 });

			expect(wrapper.text()).toContain(
				raukk_sourcing.local_price.clamped
			);
			expect(wrapper.html()).toContain("text-negative");
		});

		it("leaves an honest 0 unmarked", () => {
			const wrapper = render({ basis: "MANUAL", value: 0 });

			expect(wrapper.text()).not.toContain(
				raukk_sourcing.local_price.clamped
			);
			expect(wrapper.html()).not.toContain("text-negative");
		});
	});
});
