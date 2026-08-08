import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_CADENCE_RATE_MIN_TRIPS,
	raukkVisitCadence,
} from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";

describe("Raukk Shipping: Cadence Display", () => {
	describe("raukkVisitCadence", () => {
		it("inverts a trip rate into days per visit", () => {
			expect(raukkVisitCadence(0.5)).toStrictEqual({
				tripsPerDay: 0.5,
				visitDays: 2,
				showRate: true,
			});
		});

		it("states a sub-day interval as a fraction of a day", () => {
			expect(raukkVisitCadence(4)).toStrictEqual({
				tripsPerDay: 4,
				visitDays: 0.25,
				showRate: true,
			});
		});

		it("has no interval for a lane nothing is shipped on", () => {
			expect(raukkVisitCadence(0)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
				showRate: false,
			});
		});

		it("has no interval for a negative rate", () => {
			expect(raukkVisitCadence(-1)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
				showRate: false,
			});
		});

		it("has no interval for an infinite rate", () => {
			expect(raukkVisitCadence(Infinity)).toStrictEqual({
				tripsPerDay: Infinity,
				visitDays: null,
				showRate: false,
			});
		});

		it("has no interval for a rate that is not a number", () => {
			expect(raukkVisitCadence(NaN)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
				showRate: false,
			});
		});

		it("has no interval for a missing figure", () => {
			expect(raukkVisitCadence(null)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
				showRate: false,
			});
			expect(raukkVisitCadence(undefined)).toStrictEqual({
				tripsPerDay: 0,
				visitDays: null,
				showRate: false,
			});
		});

		it("states the rate exactly at the threshold, one visit per 20 d", () => {
			const cadence = raukkVisitCadence(RAUKK_CADENCE_RATE_MIN_TRIPS);

			expect(cadence.visitDays).toBeCloseTo(20, 10);
			expect(cadence.showRate).toBe(true);
		});

		it("drops the rate just below the threshold", () => {
			expect(
				raukkVisitCadence(RAUKK_CADENCE_RATE_MIN_TRIPS - 0.001).showRate
			).toBe(false);
		});

		it("drops the rate of the 30, 90 and 365 day cadences", () => {
			const workforce = raukkVisitCadence(1 / 30);
			const repair = raukkVisitCadence(1 / 90);
			const yearly = raukkVisitCadence(1 / 365);

			expect(workforce.visitDays).toBeCloseTo(30, 10);
			expect(workforce.showRate).toBe(false);
			expect(repair.visitDays).toBeCloseTo(90, 10);
			expect(repair.showRate).toBe(false);
			expect(yearly.visitDays).toBeCloseTo(365, 10);
			expect(yearly.showRate).toBe(false);
		});

		it("keeps the rate of the fortnightly in/out default", () => {
			expect(raukkVisitCadence(1 / 14).showRate).toBe(true);
		});
	});
});
