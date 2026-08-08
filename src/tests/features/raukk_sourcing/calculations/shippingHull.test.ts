import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_DENSITY_VOLUME_BIASED,
	RAUKK_DENSITY_WEIGHT_BIASED,
	RAUKK_HCB_PROMOTION_FACTOR,
	raukkHullLoads,
	raukkLegDensity,
	raukkPickHull,
} from "@/features/raukk_sourcing/calculations/shippingHull";

// Types & Interfaces
import {
	IRaukkHullCandidate,
	IRaukkHullPick,
	IRaukkLegDemand,
	IRaukkResolvedShipProfile,
} from "@/features/raukk_sourcing/calculations/shipping.types";

const profile: IRaukkResolvedShipProfile = {
	id: "test",
	name: "Test Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 10,
	stlBlockCost: 0,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0,
	damagePerStlBlock: 0,
	shipsAvailable: 1,
};

/** One candidate of the given hold, named after it as the presets are */
function hull(cargoWeight: number, cargoVolume: number): IRaukkHullCandidate {
	const shipTypeId: string = `${cargoWeight}x${cargoVolume}-standard`;

	return {
		shipTypeId,
		profile: { ...profile, id: shipTypeId, cargoWeight, cargoVolume },
	};
}

/** The six real hulls, all of them owned */
const SCB: IRaukkHullCandidate = hull(500, 500);
const MCB: IRaukkHullCandidate = hull(1000, 1000);
const LCB: IRaukkHullCandidate = hull(2000, 2000);
const VCB: IRaukkHullCandidate = hull(1000, 3000);
const WCB: IRaukkHullCandidate = hull(3000, 1000);
const HCB: IRaukkHullCandidate = hull(5000, 5000);

const ALL: IRaukkHullCandidate[] = [SCB, MCB, LCB, VCB, WCB, HCB];

/** Daily cargo arriving at the plan, nothing leaving it */
function inbound(weightPerDay: number, volumePerDay: number): IRaukkLegDemand {
	return {
		weightOutPerDay: 0,
		volumeOutPerDay: 0,
		weightBackPerDay: weightPerDay,
		volumeBackPerDay: volumePerDay,
	};
}

describe("Raukk Sourcing: Shipping Hull Selection", () => {
	describe("raukkLegDensity", () => {
		it("sums both directions", () => {
			expect(
				raukkLegDensity({
					weightOutPerDay: 300,
					volumeOutPerDay: 100,
					weightBackPerDay: 200,
					volumeBackPerDay: 100,
				})
			).toBeCloseTo(2.5, 10);
		});

		it("reads volumeless cargo as infinitely dense", () => {
			expect(raukkLegDensity(inbound(100, 0))).toBe(Infinity);
		});

		it("reads nothing at all as balanced", () => {
			expect(raukkLegDensity(inbound(0, 0))).toBe(1);
		});
	});

	describe("raukkHullLoads", () => {
		it("takes the busier direction, never their sum", () => {
			expect(
				raukkHullLoads(MCB, {
					weightOutPerDay: 400,
					volumeOutPerDay: 0,
					weightBackPerDay: 600,
					volumeBackPerDay: 0,
				})
			).toBeCloseTo(0.6, 10);
		});

		it("takes the more demanding dimension of a direction", () => {
			expect(raukkHullLoads(MCB, inbound(200, 900))).toBeCloseTo(0.9, 10);
		});

		it("guards a hull without capacity", () => {
			expect(raukkHullLoads(hull(0, 0), inbound(100, 100))).toBe(0);
		});
	});

	describe("raukkPickHull", () => {
		it("assigns nothing without a single owned hull", () => {
			expect(raukkPickHull([], inbound(100, 100), 14)).toBeNull();
		});

		it("puts dense cargo into the weight hull", () => {
			// 5 t per m³, far past the weight biased threshold
			const pick: IRaukkHullPick = raukkPickHull(
				ALL,
				inbound(100, 20),
				14
			)!;

			expect(RAUKK_DENSITY_WEIGHT_BIASED).toBe(2.5);
			expect(pick.candidate.shipTypeId).toBe(WCB.shipTypeId);
		});

		it("puts bulky cargo into the volume hull", () => {
			// 0.2 t per m³, below the volume biased threshold
			const pick: IRaukkHullPick = raukkPickHull(
				ALL,
				inbound(20, 100),
				14
			)!;

			expect(RAUKK_DENSITY_VOLUME_BIASED).toBe(0.4);
			expect(pick.candidate.shipTypeId).toBe(VCB.shipTypeId);
		});

		it("keeps balanced cargo in a balanced hull", () => {
			const pick: IRaukkHullPick = raukkPickHull(
				ALL,
				inbound(100, 100),
				14
			)!;

			expect([SCB, MCB, LCB, HCB].map((c) => c.shipTypeId)).toContain(
				pick.candidate.shipTypeId
			);
		});

		it("falls back to any owned hull when the class is missing", () => {
			// dense cargo, but the fleet owns no weight hull at all: the
			// balanced ones are ranked by the same size rule, and only the
			// 2000 t hull covers a whole 14 day cadence
			const pick: IRaukkHullPick = raukkPickHull(
				[MCB, LCB],
				inbound(100, 20),
				14
			)!;

			expect(pick.candidate.shipTypeId).toBe(LCB.shipTypeId);
		});

		it("takes the smallest hull that covers a whole cadence", () => {
			// 25 t a day: the 500 t hull fills in 20 days, past the 14 day
			// cap, so it already flies once per visit — a bigger one would
			// fly the same trip half empty
			const pick: IRaukkHullPick = raukkPickHull(
				[SCB, LCB, HCB],
				inbound(25, 25),
				14
			)!;

			expect(pick.candidate.shipTypeId).toBe(SCB.shipTypeId);
			expect(pick.fillDays).toBeCloseTo(20, 10);
			expect(pick.visitDays).toBe(14);
			expect(pick.tripsPerDay).toBeCloseTo(1 / 14, 10);
		});

		it("takes the biggest hull when none covers the cadence", () => {
			// 1000 t a day: every hull is filled long before the cap, so
			// the biggest one is the one flying least often
			const pick: IRaukkHullPick = raukkPickHull(
				[SCB, LCB],
				inbound(1000, 1000),
				14
			)!;

			expect(pick.candidate.shipTypeId).toBe(LCB.shipTypeId);
			expect(pick.tripsPerDay).toBeCloseTo(0.5, 10);
		});

		it("promotes a busy weight hull to the heavy one", () => {
			// 6000 t and 2400 m³ a day: the WCB flies 2.4 times a day, the
			// HCB 1.2 — twice the promotion factor
			const pick: IRaukkHullPick = raukkPickHull(
				[WCB, HCB],
				inbound(6000, 2400),
				14
			)!;

			expect(RAUKK_HCB_PROMOTION_FACTOR).toBe(1.5);
			expect(pick.candidate.shipTypeId).toBe(HCB.shipTypeId);
			expect(pick.tripsPerDay).toBeCloseTo(1.2, 10);
		});

		it("never promotes to a hull the fleet does not own", () => {
			const pick: IRaukkHullPick = raukkPickHull(
				[WCB],
				inbound(6000, 2400),
				14
			)!;

			expect(pick.candidate.shipTypeId).toBe(WCB.shipTypeId);
			expect(pick.tripsPerDay).toBeCloseTo(2.4, 10);
		});

		it("leaves a hull below one trip a day alone", () => {
			// dense cargo well inside one trip a day: no promotion, the
			// weight hull stays
			const pick: IRaukkHullPick = raukkPickHull(
				[WCB, HCB],
				inbound(1500, 500),
				14
			)!;

			expect(pick.candidate.shipTypeId).toBe(WCB.shipTypeId);
			expect(pick.tripsPerDay).toBeCloseTo(0.5, 10);
		});
	});
});
