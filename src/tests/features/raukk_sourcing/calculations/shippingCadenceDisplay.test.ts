import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_CADENCE_RATE_MIN_TRIPS,
	raukkShipTimeByBucket,
	raukkShipTimeByType,
	raukkVisitCadence,
} from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";

// Types & Interfaces
import { IRaukkSnapshotLane } from "@/features/raukk_sourcing/raukkSourcing.types";

/**
 * Lane leg fixture with the fields the ship time rollup reads.
 */
function lane(overrides: Partial<IRaukkSnapshotLane>): IRaukkSnapshotLane {
	return {
		pairKey: "plan>CX",
		shipTypeId: "3000x1000-standard",
		tripsPerDay: 0.25,
		roundTripMinutes: 960,
		hired: false,
		...overrides,
	};
}

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

	describe("raukkShipTimeByType", () => {
		it("states one hull flying one lane: 16 h trips every 4 days", () => {
			const entries = raukkShipTimeByType([
				lane({ tripsPerDay: 0.25, roundTripMinutes: 960 }),
			]);

			expect(entries).toHaveLength(1);
			expect(entries[0].shipTypeId).toBe("3000x1000-standard");
			expect(entries[0].hoursPerTrip).toBeCloseTo(16, 10);
			expect(entries[0].tripsPerDay).toBeCloseTo(0.25, 10);
			expect(entries[0].visitDays).toBeCloseTo(4, 10);
			expect(entries[0].hoursPerDay).toBeCloseTo(4, 10);
		});

		it("sums the lanes of one hull, trips weighting the mean trip", () => {
			const entries = raukkShipTimeByType([
				lane({ tripsPerDay: 0.25, roundTripMinutes: 960 }),
				lane({
					pairKey: "plan>source",
					tripsPerDay: 0.75,
					roundTripMinutes: 120,
				}),
			]);

			expect(entries).toHaveLength(1);
			// (0.25 × 960 + 0.75 × 120) / 1 trip = 330 min = 5.5 h
			expect(entries[0].hoursPerTrip).toBeCloseTo(5.5, 10);
			expect(entries[0].tripsPerDay).toBeCloseTo(1, 10);
			expect(entries[0].visitDays).toBeCloseTo(1, 10);
			expect(entries[0].hoursPerDay).toBeCloseTo(5.5, 10);
		});

		it("keeps hull types apart and orders them busiest first", () => {
			const entries = raukkShipTimeByType([
				lane({
					shipTypeId: "500x500-standard",
					tripsPerDay: 1,
					roundTripMinutes: 60,
				}),
				lane({ tripsPerDay: 0.25, roundTripMinutes: 960 }),
			]);

			expect(entries.map((entry) => entry.shipTypeId)).toStrictEqual([
				"3000x1000-standard",
				"500x500-standard",
			]);
		});

		it("skips hired legs: the operator flies its own ships", () => {
			expect(raukkShipTimeByType([lane({ hired: true })])).toStrictEqual(
				[]
			);
		});

		it("skips legs moving nothing", () => {
			expect(
				raukkShipTimeByType([lane({ tripsPerDay: 0 })])
			).toStrictEqual([]);
		});

		it("has no entries without any lanes", () => {
			expect(raukkShipTimeByType([])).toStrictEqual([]);
		});
	});

	describe("raukkShipTimeByBucket", () => {
		it("reports the three buckets apart, tightest cadence first", () => {
			const groups = raukkShipTimeByBucket([
				lane({ bucket: "repair", tripsPerDay: 1 / 90 }),
				lane({ bucket: "workforce", tripsPerDay: 1 / 30 }),
				lane({ bucket: "production", tripsPerDay: 1 / 14 }),
			]);

			expect(groups.map((group) => group.bucket)).toStrictEqual([
				"production",
				"workforce",
				"repair",
			]);
			expect(groups.map((group) => group.entries.length)).toStrictEqual([
				1, 1, 1,
			]);
		});

		it("states each bucket's own interval, never their sum", () => {
			// the two used to roll into one 22.5 day line: 1/30 + 1/90
			const groups = raukkShipTimeByBucket([
				lane({ bucket: "workforce", tripsPerDay: 1 / 30 }),
				lane({ bucket: "repair", tripsPerDay: 1 / 90 }),
			]);

			expect(groups[0].entries[0].visitDays).toBeCloseTo(30, 10);
			expect(groups[1].entries[0].visitDays).toBeCloseTo(90, 10);
		});

		it("shows a bucket its legs fly on two hulls as two entries", () => {
			const groups = raukkShipTimeByBucket([
				lane({
					bucket: "workforce",
					shipTypeId: "1000x1000-standard",
					tripsPerDay: 1 / 30,
					roundTripMinutes: 600,
				}),
				lane({
					bucket: "workforce",
					pairKey: "plan>other",
					shipTypeId: "500x500-standard",
					tripsPerDay: 1 / 30,
					roundTripMinutes: 60,
				}),
			]);

			expect(groups).toHaveLength(1);
			expect(
				groups[0].entries.map((entry) => entry.shipTypeId)
			).toStrictEqual(["1000x1000-standard", "500x500-standard"]);
		});

		it("keeps pre cadence legs in their own unlabelled group", () => {
			const groups = raukkShipTimeByBucket([
				lane({ bucket: undefined }),
				lane({ bucket: "production" }),
			]);

			expect(groups.map((group) => group.bucket)).toStrictEqual([
				"production",
				undefined,
			]);
		});

		it("drops buckets whose every leg is hired or empty", () => {
			const groups = raukkShipTimeByBucket([
				lane({ bucket: "production", hired: true }),
				lane({ bucket: "workforce", tripsPerDay: 0 }),
				lane({ bucket: "repair" }),
			]);

			expect(groups.map((group) => group.bucket)).toStrictEqual([
				"repair",
			]);
		});

		it("has no groups without any lanes", () => {
			expect(raukkShipTimeByBucket([])).toStrictEqual([]);
		});
	});
});
