import { describe, expect, it } from "vitest";

// Calculations
import { RAUKK_REPAIR_AT_DAMAGE } from "@/features/raukk_sourcing/calculations/shipping";
import {
	IRaukkShipWear,
	raukkDaysUntilRepair,
	raukkWearOf,
} from "@/features/raukk_sourcing/calculations/shippingWear";

describe("Raukk Sourcing: Shipping Wear", () => {
	describe("raukkWearOf", () => {
		it("states trips and days until the repair threshold", () => {
			// 0.4 % damage per trip, one trip every other day
			const wear: IRaukkShipWear = raukkWearOf(0.004, 0.5, 2400);

			expect(wear.damagePerTrip).toBe(0.004);
			expect(wear.tripsUntilRepair).toBeCloseTo(
				RAUKK_REPAIR_AT_DAMAGE / 0.004
			);
			expect(wear.tripsUntilRepair).toBeCloseTo(50);
			expect(wear.daysUntilRepair).toBeCloseTo(100);
		});

		it("charges the exact repair share of the cost model", () => {
			const wear: IRaukkShipWear = raukkWearOf(0.004, 0.5, 2400);

			// (0.004 / 0.2) * 2400
			expect(wear.repairCostPerTrip).toBeCloseTo(48);
			expect(wear.repairCostPerDay).toBeCloseTo(24);
		});

		it("never repairs while no trip takes damage", () => {
			const wear: IRaukkShipWear = raukkWearOf(0, 1, 2400);

			expect(wear.tripsUntilRepair).toBe(Infinity);
			expect(wear.daysUntilRepair).toBe(Infinity);
			expect(wear.repairCostPerTrip).toBe(0);
			expect(wear.repairCostPerDay).toBe(0);
		});

		it("knows the trips but not the days without any cadence", () => {
			const wear: IRaukkShipWear = raukkWearOf(0.004, 0, 2400);

			expect(wear.tripsUntilRepair).toBeCloseTo(50);
			expect(wear.daysUntilRepair).toBe(Infinity);
			expect(wear.repairCostPerDay).toBe(0);
		});

		it("clamps negative inputs to zero", () => {
			const wear: IRaukkShipWear = raukkWearOf(-1, -1, 2400);

			expect(wear.damagePerTrip).toBe(0);
			expect(wear.tripsUntilRepair).toBe(Infinity);
			expect(wear.repairCostPerTrip).toBe(0);
		});
	});

	describe("raukkDaysUntilRepair", () => {
		it("inverts a daily damage rate into the drydock cadence", () => {
			// 1 % per day reaches 20 % damage — 80 % condition — in 20 days
			expect(raukkDaysUntilRepair(0.01)).toBeCloseTo(20);
		});

		it("never repairs without damage", () => {
			expect(raukkDaysUntilRepair(0)).toBe(Infinity);
		});
	});
});
