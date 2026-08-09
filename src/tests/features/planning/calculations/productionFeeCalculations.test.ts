import { describe, it, expect } from "vitest";

import {
	calculateProductionFeeBatch,
	calculateProductionFeeDaily,
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
		it("charges the rate on nominal recipe time", () => {
			// 12h nominal: 4100 * 0.5 = 2050
			expect(
				calculateProductionFeeBatch(
					fakeBuilding,
					fakeFees,
					12 * 60 * 60 * 1000
				)
			).toBe(2050);
		});
	});

	describe("calculateProductionFeeDaily", () => {
		it("scales with efficiency, negative cost", () => {
			expect(
				calculateProductionFeeDaily(fakeBuilding, fakeFees, 1.5)
			).toBe(-6150);
		});

		it("is 0 on unknown fees", () => {
			expect(calculateProductionFeeDaily(fakeBuilding, null, 1.5)).toBe(
				0
			);
		});
	});
});
