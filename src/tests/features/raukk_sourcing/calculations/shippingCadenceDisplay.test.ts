import { describe, it, expect } from "vitest";

// Calculations
import { raukkVisitCadence } from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";

describe("Raukk Shipping: Cadence Display", () => {
	describe("raukkVisitCadence", () => {
		it("inverts a trip rate into days per visit", () => {
			expect(raukkVisitCadence(0.5)).toStrictEqual({
				tripsPerDay: 0.5,
				visitDays: 2,
			});
		});

		it("states a sub-day interval as a fraction of a day", () => {
			expect(raukkVisitCadence(4)).toStrictEqual({
				tripsPerDay: 4,
				visitDays: 0.25,
			});
		});

		it("has no interval for a lane nothing is shipped on", () => {
			expect(raukkVisitCadence(0)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
			});
		});

		it("has no interval for a negative rate", () => {
			expect(raukkVisitCadence(-1)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
			});
		});

		it("has no interval for an infinite rate", () => {
			expect(raukkVisitCadence(Infinity)).toStrictEqual({
				tripsPerDay: Infinity,
				visitDays: null,
			});
		});

		it("has no interval for a rate that is not a number", () => {
			expect(raukkVisitCadence(NaN)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
			});
		});

		it("has no interval for a missing figure", () => {
			expect(raukkVisitCadence(null)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
			});
			expect(raukkVisitCadence(undefined)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
			});
		});
	});
});
