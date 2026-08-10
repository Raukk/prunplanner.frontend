import { describe, it, expect } from "vitest";

import {
	calculateProductionFeeBatch,
	calculateProductionFeeDaily,
	calculateProductionFeePerUnit,
	calculateProductionFeeRate,
} from "@/features/planning/calculations/productionFeeCalculations";

// Types & Interfaces
import { IBuilding } from "@/features/api/gameData.types";
import { IFIOPlanetFees } from "@/features/api/fioData.types";

const fakeBuilding = {
	ticker: "SME",
	expertise: "METALLURGY",
	pioneers: 50,
	settlers: 20,
	technicians: 0,
	engineers: 0,
	scientists: 0,
} as unknown as IBuilding;

const fakeFees = {
	planet_natural_id: "ZV-759c",
	currency_code: "AIC",
	governing_entity: "gov",
	base_local_market_fee: 50,
	local_market_fee_factor: 3,
	warehouse_fee: 100,
	establishment_fee: 0,
	production_fees: {
		METALLURGY: {
			pioneer: 50,
			settler: 80,
			technician: 140,
			engineer: 800,
			scientist: 1500,
		},
	},
} as IFIOPlanetFees;

describe("productionFeeCalculations", () => {
	describe("calculateProductionFeeRate", () => {
		it("sums worker count times tier rate", () => {
			// 50 * 50 + 20 * 80 = 4100
			expect(calculateProductionFeeRate(fakeBuilding, fakeFees)).toBe(
				4100
			);
		});

		it("returns 0 on unknown fees", () => {
			expect(calculateProductionFeeRate(fakeBuilding, null)).toBe(0);
		});

		it("returns 0 without building expertise", () => {
			const noExpertise = {
				...fakeBuilding,
				expertise: null,
			} as IBuilding;
			expect(calculateProductionFeeRate(noExpertise, fakeFees)).toBe(0);
		});

		it("returns 0 on missing industry fee table", () => {
			const otherExpertise = {
				...fakeBuilding,
				expertise: "CHEMISTRY",
			} as IBuilding;
			expect(calculateProductionFeeRate(otherExpertise, fakeFees)).toBe(
				0
			);
		});
	});

	describe("calculateProductionFeeBatch", () => {
		it("charges the rate on the batches real runtime", () => {
			// 12h nominal: 4100 * 0.5 = 2050
			expect(
				calculateProductionFeeBatch(
					fakeBuilding,
					fakeFees,
					12 * 60 * 60 * 1000,
					1
				)
			).toBe(2050);
		});

		it("shrinks the fee with building efficiency", () => {
			// 12h nominal at 150%: 8h real, 4100 * (1/3)
			expect(
				calculateProductionFeeBatch(
					fakeBuilding,
					fakeFees,
					12 * 60 * 60 * 1000,
					1.5
				)
			).toBeCloseTo(4100 / 3, 8);
		});

		it("returns 0 on non-positive efficiency", () => {
			expect(
				calculateProductionFeeBatch(
					fakeBuilding,
					fakeFees,
					12 * 60 * 60 * 1000,
					0
				)
			).toBe(0);
		});
	});

	describe("calculateProductionFeePerUnit", () => {
		it("splits the batch fee evenly over all produced units", () => {
			// 2050 over 4 + 1 units
			expect(
				calculateProductionFeePerUnit(2050, [
					{ material_ticker: "AL", material_amount: 4 },
					{ material_ticker: "SCR", material_amount: 1 },
				])
			).toBe(410);
		});

		it("returns 0 for a recipe without any output", () => {
			expect(calculateProductionFeePerUnit(2050, [])).toBe(0);
		});
	});

	describe("calculateProductionFeeDaily", () => {
		it("is one day of the fee rate as negative cost", () => {
			expect(calculateProductionFeeDaily(fakeBuilding, fakeFees)).toBe(
				-4100
			);
		});

		it("is 0 on unknown fees", () => {
			expect(calculateProductionFeeDaily(fakeBuilding, null)).toBe(0);
		});

		it("matches a full day of batch fees at any efficiency", () => {
			const recipeTimeMs: number = 6 * 60 * 60 * 1000;
			const dayMs: number = 24 * 60 * 60 * 1000;

			[1, 1.5, 2.75].forEach((efficiency) => {
				const batch: number = calculateProductionFeeBatch(
					fakeBuilding,
					fakeFees,
					recipeTimeMs,
					efficiency
				);
				const batchesPerDay: number =
					dayMs / (recipeTimeMs / efficiency);

				expect(batch * batchesPerDay).toBeCloseTo(
					-1 * calculateProductionFeeDaily(fakeBuilding, fakeFees),
					8
				);
			});
		});
	});
});
