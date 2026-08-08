import { describe, expect, it } from "vitest";

// Calculations
import {
	quoteLocalPrice,
	resolveLocalPrice,
	resolveMarketPrice,
} from "@/features/raukk_sourcing/calculations/priceMode";

// Types & Interfaces
import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

const exchange: IRaukkExchangePrices = {
	bid: 100,
	ask: 140,
	vwap_7d: 115,
	vwap_30d: 125,
};

describe("Raukk Sourcing: Price Mode", () => {
	describe("resolveMarketPrice", () => {
		it("resolves each price mode", () => {
			expect(resolveMarketPrice(exchange, "BID")).toBe(100);
			expect(resolveMarketPrice(exchange, "ASK")).toBe(140);
			expect(resolveMarketPrice(exchange, "MID")).toBe(120);
			expect(resolveMarketPrice(exchange, "AVG7D")).toBe(115);
			expect(resolveMarketPrice(exchange, "AVG30D")).toBe(125);
		});

		it("returns 0 without exchange data", () => {
			expect(resolveMarketPrice(undefined, "BID")).toBe(0);
			expect(resolveMarketPrice(undefined, "MID")).toBe(0);
		});

		it("sanitizes non finite values", () => {
			const broken = {
				bid: NaN,
				ask: 50,
				vwap_7d: undefined,
				vwap_30d: null,
			} as unknown as IRaukkExchangePrices;

			expect(resolveMarketPrice(broken, "BID")).toBe(0);
			expect(resolveMarketPrice(broken, "AVG7D")).toBe(0);
			expect(resolveMarketPrice(broken, "AVG30D")).toBe(0);
		});

		it("prices MID as the only real side of a one sided book", () => {
			const oneSided = {
				bid: NaN,
				ask: 50,
				vwap_7d: undefined,
				vwap_30d: null,
			} as unknown as IRaukkExchangePrices;

			expect(resolveMarketPrice(oneSided, "MID")).toBe(50);
		});

		it("falls back to the 30 day vwap on an empty book side", () => {
			const universe: IRaukkExchangePrices = {
				bid: 0,
				ask: 0,
				vwap_7d: 118,
				vwap_30d: 125,
			};

			expect(resolveMarketPrice(universe, "BID")).toBe(125);
			expect(resolveMarketPrice(universe, "ASK")).toBe(125);
			expect(resolveMarketPrice(universe, "MID")).toBe(125);
			expect(resolveMarketPrice(universe, "AVG7D")).toBe(118);
			expect(resolveMarketPrice(universe, "AVG30D")).toBe(125);
		});

		it("falls back to the 7 day vwap without a 30 day one", () => {
			const weekly: IRaukkExchangePrices = {
				bid: 0,
				ask: 0,
				vwap_7d: 118,
				vwap_30d: 0,
			};

			expect(resolveMarketPrice(weekly, "BID")).toBe(118);
			expect(resolveMarketPrice(weekly, "MID")).toBe(118);
		});

		it("keeps a real book side over the vwap fallback", () => {
			const halfQuoted: IRaukkExchangePrices = {
				bid: 0,
				ask: 140,
				vwap_7d: 115,
				vwap_30d: 125,
			};

			expect(resolveMarketPrice(halfQuoted, "BID")).toBe(125);
			expect(resolveMarketPrice(halfQuoted, "ASK")).toBe(140);
			expect(resolveMarketPrice(halfQuoted, "MID")).toBe(132.5);
		});

		it("resolves to 0 without any quote at all", () => {
			const empty: IRaukkExchangePrices = {
				bid: 0,
				ask: 0,
				vwap_7d: 0,
				vwap_30d: 0,
			};

			expect(resolveMarketPrice(empty, "BID")).toBe(0);
			expect(resolveMarketPrice(empty, "MID")).toBe(0);
		});

		it("falls back to 0 on an unknown mode", () => {
			expect(
				resolveMarketPrice(exchange, "FOO" as unknown as "BID")
			).toBe(0);
		});

		it("accepts real exchange api data shape", () => {
			const apiLike = {
				ticker: "ALO.IC1",
				exchange_code: "IC1",
				bid: 240,
				ask: 260,
				vwap_7d: 249,
				vwap_30d: 251,
				supply: 100,
				demand: 200,
			};

			expect(resolveMarketPrice(apiLike, "MID")).toBe(250);
		});
	});

	describe("resolveLocalPrice", () => {
		it("takes a manual value as the absolute price", () => {
			expect(
				resolveLocalPrice({ basis: "MANUAL", value: 175 }, exchange)
			).toBe(175);
		});

		it("clamps a negative manual value at 0", () => {
			expect(
				resolveLocalPrice({ basis: "MANUAL", value: -20 }, exchange)
			).toBe(0);
		});

		it("follows each market basis with a zero offset", () => {
			expect(
				resolveLocalPrice({ basis: "BID", value: 0 }, exchange)
			).toBe(100);
			expect(
				resolveLocalPrice({ basis: "ASK", value: 0 }, exchange)
			).toBe(140);
			expect(
				resolveLocalPrice({ basis: "MID", value: 0 }, exchange)
			).toBe(120);
			expect(
				resolveLocalPrice({ basis: "AVG7D", value: 0 }, exchange)
			).toBe(115);
			expect(
				resolveLocalPrice({ basis: "AVG30D", value: 0 }, exchange)
			).toBe(125);
		});

		it("undercuts the market by a positive offset", () => {
			expect(
				resolveLocalPrice({ basis: "BID", value: 25 }, exchange)
			).toBe(75);
		});

		it("asks above the market for a negative offset", () => {
			expect(
				resolveLocalPrice({ basis: "ASK", value: -10 }, exchange)
			).toBe(150);
		});

		it("clamps an offset larger than the basis price at 0", () => {
			expect(
				resolveLocalPrice({ basis: "BID", value: 500 }, exchange)
			).toBe(0);
		});

		it("prices an offset basis without exchange data", () => {
			expect(
				resolveLocalPrice({ basis: "MID", value: 5 }, undefined)
			).toBe(0);
			expect(
				resolveLocalPrice({ basis: "MID", value: -5 }, undefined)
			).toBe(5);
			expect(
				resolveLocalPrice({ basis: "MANUAL", value: 12 }, undefined)
			).toBe(12);
		});

		it("prices a market basis off the vwap of an empty book", () => {
			const universe: IRaukkExchangePrices = {
				bid: 0,
				ask: 0,
				vwap_7d: 118,
				vwap_30d: 125,
			};

			expect(
				resolveLocalPrice({ basis: "BID", value: 0 }, universe)
			).toBe(125);
			expect(
				resolveLocalPrice({ basis: "MID", value: 25 }, universe)
			).toBe(100);
		});
	});

	describe("quoteLocalPrice", () => {
		it("reports a manual price as its own basis free value", () => {
			expect(
				quoteLocalPrice({ basis: "MANUAL", value: 175 }, exchange)
			).toStrictEqual({ price: 175, basisPrice: 0, clamped: false });
		});

		it("flags a clamped negative manual price", () => {
			expect(
				quoteLocalPrice({ basis: "MANUAL", value: -20 }, exchange)
			).toStrictEqual({ price: 0, basisPrice: 0, clamped: true });
		});

		it("reports the basis price a market offset was taken from", () => {
			expect(
				quoteLocalPrice({ basis: "BID", value: 25 }, exchange)
			).toStrictEqual({ price: 75, basisPrice: 100, clamped: false });
		});

		it("flags an offset that ate the whole basis price", () => {
			expect(
				quoteLocalPrice({ basis: "MID", value: 23213 }, exchange)
			).toStrictEqual({ price: 0, basisPrice: 120, clamped: true });
		});

		it("flags an offset that exactly reaches the basis price", () => {
			expect(
				quoteLocalPrice({ basis: "BID", value: 100 }, exchange)
			).toStrictEqual({ price: 0, basisPrice: 100, clamped: true });
		});

		it("does not flag a 0 without any basis price to clamp", () => {
			expect(
				quoteLocalPrice({ basis: "BID", value: 0 }, undefined)
			).toStrictEqual({ price: 0, basisPrice: 0, clamped: false });
		});
	});
});
