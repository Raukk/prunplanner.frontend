import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkAssignedShipTypeId,
	raukkChainAssignmentKey,
	raukkChainIdOfAssignmentKey,
	raukkFleetUtilization,
	raukkOwnedHullCandidates,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import {
	RAUKK_STARTER_FLEET,
	raukkDefaultShippingConfig,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkHullCandidate,
	IRaukkShippingConfig,
} from "@/features/raukk_sourcing/calculations/shipping.types";

const MINUTES_PER_DAY: number = 24 * 60;

describe("Raukk Shipping: Fleet", () => {
	describe("assignment keys", () => {
		it("round trips a chain key and rejects a lane key", () => {
			const key: string = raukkChainAssignmentKey("c1");

			expect(raukkChainIdOfAssignmentKey(key)).toBe("c1");
			expect(raukkChainIdOfAssignmentKey("plan>CX")).toBeUndefined();
			expect(raukkChainIdOfAssignmentKey("plan>source")).toBeUndefined();
		});
	});

	describe("raukkAssignedShipTypeId", () => {
		const config: IRaukkShippingConfig = {
			...raukkDefaultShippingConfig(),
			perEdgeProfile: { "a>CX": "2000x2000-standard" },
		};

		it("falls back to the account default", () => {
			expect(raukkAssignedShipTypeId("b>CX", {}, config)).toBe(
				config.defaultProfileId
			);
		});

		it("takes the v1 per edge override", () => {
			expect(raukkAssignedShipTypeId("a>CX", {}, config)).toBe(
				"2000x2000-standard"
			);
		});

		it("lets the fleet assignment win over the override", () => {
			expect(
				raukkAssignedShipTypeId(
					"a>CX",
					{ "a>CX": "5000x5000-quick-charge" },
					config
				)
			).toBe("5000x5000-quick-charge");
		});
	});

	describe("raukkFleetUtilization", () => {
		it("sums the assigned work per ship type", () => {
			const rows = raukkFleetUtilization(
				{ WCB: { count: 2, designName: "FSE_WCB_QCR" } },
				[
					{
						key: "a>CX",
						shipTypeId: "WCB",
						tripsPerDay: 2,
						roundTripMinutes: 600,
					},
					{
						key: "chain:c1",
						shipTypeId: "WCB",
						tripsPerDay: 1,
						roundTripMinutes: 240,
					},
				]
			);

			expect(rows.length).toBe(1);
			expect(rows[0].shipMinutesPerDay).toBe(2 * 600 + 240);
			expect(rows[0].utilization).toBeCloseTo(
				1440 / (MINUTES_PER_DAY * 2),
				10
			);
			expect(rows[0].designName).toBe("FSE_WCB_QCR");
			expect(rows[0].keys).toStrictEqual(["a>CX", "chain:c1"]);
		});

		it("reports an idle ship type at zero", () => {
			const rows = raukkFleetUtilization({ LCB: { count: 1 } }, []);

			expect(rows[0].utilization).toBe(0);
			expect(rows[0].keys).toStrictEqual([]);
		});

		it("gives an unowned ship type no row at all", () => {
			const rows = raukkFleetUtilization({}, [
				{
					key: "a>CX",
					shipTypeId: "HCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
				},
			]);

			// the table lists what the user added; a hull nobody owns is
			// an advisory, never a fleet row
			expect(rows).toStrictEqual([]);
		});

		it("reports a held type at count zero with a null utilization", () => {
			const rows = raukkFleetUtilization({ HCB: { count: 0 } }, [
				{
					key: "a>CX",
					shipTypeId: "HCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
				},
			]);

			// zero would read as infinite capacity, the opposite of
			// "there is no hull to fly it"
			expect(rows[0].count).toBe(0);
			expect(rows[0].utilization).toBeNull();
			expect(rows[0].shipMinutesPerDay).toBe(100);
		});

		it("does not clamp an over-rationed type", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 2,
					roundTripMinutes: MINUTES_PER_DAY,
				},
			]);

			expect(rows[0].utilization).toBe(2);
		});

		it("lists every type of the fleet only, sorted", () => {
			const rows = raukkFleetUtilization(
				{ WCB: { count: 1 }, LCB: { count: 0 } },
				[
					{
						key: "a>CX",
						shipTypeId: "HCB",
						tripsPerDay: 1,
						roundTripMinutes: 10,
					},
				]
			);

			// HCB carries work but is not in the fleet, so it has no row
			expect(rows.map((row) => row.shipTypeId)).toStrictEqual([
				"LCB",
				"WCB",
			]);
			expect(
				rows.find((row) => row.shipTypeId === "LCB")?.utilization
			).toBeNull();
		});

		it("ignores negative trips and times", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: -5,
					roundTripMinutes: 100,
				},
			]);

			expect(rows[0].shipMinutesPerDay).toBe(0);
		});

		it("lists the stale work of a type separately", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
					stale: true,
				},
				{
					key: "b>CX",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
				},
			]);

			expect(rows[0].keys).toStrictEqual(["a>CX", "b>CX"]);
			expect(rows[0].staleKeys).toStrictEqual(["a>CX"]);
		});

		it("dedupes the stale keys like the assigned ones", () => {
			// one lane contributes one entry per leg, all of them stale
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
					stale: true,
				},
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 50,
					stale: true,
				},
			]);

			expect(rows[0].keys).toStrictEqual(["a>CX"]);
			expect(rows[0].staleKeys).toStrictEqual(["a>CX"]);
		});

		it("holds no stale work without a stale result", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
				},
			]);

			expect(rows[0].staleKeys).toStrictEqual([]);
		});

		it("sums the assigned wear per ship type", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 2 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 2,
					roundTripMinutes: 600,
					damagePerDay: 0.004,
				},
				{
					key: "chain:c1",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 240,
					damagePerDay: 0.001,
				},
			]);

			expect(rows[0].damagePerDay).toBeCloseTo(0.005, 10);
		});

		it("reports the wear unknown once one entry predates it", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 2 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 2,
					roundTripMinutes: 600,
					damagePerDay: 0.004,
				},
				// a stored result frozen before the wear rollup
				{
					key: "chain:c1",
					shipTypeId: "WCB",
					tripsPerDay: 1,
					roundTripMinutes: 240,
				},
			]);

			// a sum that skipped the unknown term would understate the wear
			expect(rows[0].damagePerDay).toBeNull();
		});

		it("knows an idle types wear perfectly: zero", () => {
			const rows = raukkFleetUtilization({ LCB: { count: 1 } }, []);

			expect(rows[0].damagePerDay).toBe(0);
		});
	});

	describe("raukkOwnedHullCandidates", () => {
		/** Candidate stub, only the ship type id matters here */
		const candidateOf = (shipTypeId: string): IRaukkHullCandidate =>
			({ shipTypeId }) as IRaukkHullCandidate;

		it("falls back to the starter ship for an empty fleet", () => {
			expect(
				raukkOwnedHullCandidates({}, candidateOf).map(
					(candidate) => candidate.shipTypeId
				)
			).toStrictEqual([RAUKK_STARTER_FLEET.shipTypeId]);
		});

		it("offers the owned types of a configured fleet", () => {
			expect(
				raukkOwnedHullCandidates(
					{ WCB: { count: 1 }, LCB: { count: 3 } },
					candidateOf
				).map((candidate) => candidate.shipTypeId)
			).toStrictEqual(["WCB", "LCB"]);
		});

		it("excludes a held type without a single hull", () => {
			expect(
				raukkOwnedHullCandidates(
					{ WCB: { count: 1 }, LCB: { count: 0 } },
					candidateOf
				).map((candidate) => candidate.shipTypeId)
			).toStrictEqual(["WCB"]);
		});

		it("falls back when every held type has a count of zero", () => {
			expect(
				raukkOwnedHullCandidates(
					{ WCB: { count: 0 } },
					candidateOf
				).map((candidate) => candidate.shipTypeId)
			).toStrictEqual([RAUKK_STARTER_FLEET.shipTypeId]);
		});
	});
});
