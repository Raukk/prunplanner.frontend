import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_DEFAULT_SHIP_PROFILE_ID,
	RAUKK_FTL_REACTORS,
	RAUKK_FUEL_TICKERS,
	RAUKK_SHIP_HULLS,
	raukkCompleteShipProfile,
	raukkDefaultShippingConfig,
	raukkDerivedCostPerParsec,
	raukkDerivedStlBlockCost,
	raukkNearestCalibration,
	raukkResolveShipProfile,
	raukkShipProfileId,
	raukkShipProfilePreset,
	raukkShipProfilePresets,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkResolvedShipProfile,
	IRaukkShipProfile,
	IRaukkTimeCalibration,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** FF at 100 ȼ, SF at 10 ȼ, everything else free */
const fuelPrices: Record<string, number> = { FF: 100, SF: 10 };

function resolvePrice(ticker: string): number {
	return fuelPrices[ticker] ?? 0;
}

describe("Raukk Sourcing: Ship Profiles", () => {
	it("carries the six hulls of the visitation frequency tool", () => {
		expect(RAUKK_SHIP_HULLS).toStrictEqual([
			{ cargoWeight: 500, cargoVolume: 500 },
			{ cargoWeight: 1000, cargoVolume: 1000 },
			{ cargoWeight: 2000, cargoVolume: 2000 },
			{ cargoWeight: 1000, cargoVolume: 3000 },
			{ cargoWeight: 3000, cargoVolume: 1000 },
			{ cargoWeight: 5000, cargoVolume: 5000 },
		]);
	});

	it("builds one preset per hull and reactor", () => {
		const presets: IRaukkShipProfile[] = raukkShipProfilePresets();

		expect(presets).toHaveLength(
			RAUKK_SHIP_HULLS.length * RAUKK_FTL_REACTORS.length
		);
		expect(new Set(presets.map((preset) => preset.id)).size).toBe(
			presets.length
		);
	});

	it("names profiles by hull and reactor", () => {
		expect(
			raukkShipProfileId(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"quick-charge"
			)
		).toBe("5000x5000-quick-charge");
	});

	describe("calibration defaults", () => {
		it("uses the measured 3000t class standard reactor flight", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 3000, cargoVolume: 1000 },
				"standard"
			);

			expect(preset.minutesPerParsec).toBe(27.5);
			expect(preset.chargeMinutes).toBeCloseTo(52 / 60, 10);
			expect(preset.stlBlockMinutesEmpty).toBe(70);
			expect(preset.stlBlockMinutesLoaded).toBe(420);
		});

		it("uses the measured 5000/5000 quick-charge flight", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"quick-charge"
			);

			expect(preset.minutesPerParsec).toBe(33);
			expect(preset.chargeMinutes).toBeCloseTo(74 / 60, 10);
			expect(preset.stlBlockMinutesEmpty).toBe(150);
			expect(preset.stlBlockMinutesLoaded).toBe(360);
		});

		it("copies the nearest covered profile by hull volume", () => {
			const small: IRaukkTimeCalibration = raukkNearestCalibration(
				{ cargoWeight: 500, cargoVolume: 500 },
				"quick-charge"
			);
			const large: IRaukkTimeCalibration = raukkNearestCalibration(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"standard"
			);

			expect(small.hull.cargoVolume).toBe(1000);
			expect(large.hull.cargoVolume).toBe(5000);
		});

		it("breaks a volume tie on the reactor flag", () => {
			// the 1000/3000 hull sits 2000 m³ from both covered profiles
			expect(
				raukkNearestCalibration(
					{ cargoWeight: 1000, cargoVolume: 3000 },
					"standard"
				).ftlReactor
			).toBe("standard");
			expect(
				raukkNearestCalibration(
					{ cargoWeight: 1000, cargoVolume: 3000 },
					"quick-charge"
				).ftlReactor
			).toBe("quick-charge");
		});

		it("leaves the ȼ constants at derive, never at zero", () => {
			raukkShipProfilePresets().forEach((preset) => {
				expect(preset.costPerParsec).toBeNull();
				expect(preset.stlBlockCost).toBeNull();
				expect(preset.shipsAvailable).toBe(1);
			});
		});

		it("pre-fills the fuel burn of the covered reference flights", () => {
			const standard: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 3000, cargoVolume: 1000 },
				"standard"
			);
			const quick: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"quick-charge"
			);

			// 73 FTL units over 18 pc, block fuel the mean of 72 and 108
			expect(standard.ftlFuelPerParsec).toBeCloseTo(73 / 18, 10);
			expect(standard.stlFuelPerBlock).toBe(90);
			// 105 FTL units over 18 pc, block fuel the mean of 237 and 285
			expect(quick.ftlFuelPerParsec).toBeCloseTo(105 / 18, 10);
			expect(quick.stlFuelPerBlock).toBe(261);
		});

		it("copies the fuel burn of the nearest covered profile", () => {
			const small: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 500, cargoVolume: 500 },
				"standard"
			);

			expect(small.ftlFuelPerParsec).toBeCloseTo(73 / 18, 10);
			expect(small.stlFuelPerBlock).toBe(90);
		});
	});

	describe("fuel derived ȼ constants", () => {
		const preset: IRaukkShipProfile = raukkShipProfilePreset(
			{ cargoWeight: 3000, cargoVolume: 1000 },
			"standard"
		);

		it("prices the burn rates with FF and SF", () => {
			expect(RAUKK_FUEL_TICKERS).toStrictEqual({ ftl: "FF", stl: "SF" });
			expect(raukkDerivedCostPerParsec(preset, resolvePrice)).toBeCloseTo(
				(73 / 18) * 100,
				10
			);
			expect(raukkDerivedStlBlockCost(preset, resolvePrice)).toBeCloseTo(
				90 * 10,
				10
			);
		});

		it("derives both constants of an untouched preset", () => {
			const resolved: IRaukkResolvedShipProfile = raukkResolveShipProfile(
				preset,
				resolvePrice
			);

			expect(resolved.costPerParsec).toBeCloseTo((73 / 18) * 100, 10);
			expect(resolved.stlBlockCost).toBe(900);
		});

		it("lets a manual value win, a manual zero included", () => {
			const resolved: IRaukkResolvedShipProfile = raukkResolveShipProfile(
				{ ...preset, costPerParsec: 42, stlBlockCost: 0 },
				resolvePrice
			);

			expect(resolved.costPerParsec).toBe(42);
			expect(resolved.stlBlockCost).toBe(0);
		});

		it("derives zero while the fuel has no price", () => {
			const resolved: IRaukkResolvedShipProfile = raukkResolveShipProfile(
				preset,
				() => 0
			);

			expect(resolved.costPerParsec).toBe(0);
			expect(resolved.stlBlockCost).toBe(0);
		});

		it("fills the burn rates a pre round 5 profile lacks", () => {
			const stored = {
				...preset,
				ftlFuelPerParsec: undefined,
				stlFuelPerBlock: undefined,
			};

			const completed: IRaukkShipProfile =
				raukkCompleteShipProfile(stored);

			expect(completed.ftlFuelPerParsec).toBeCloseTo(73 / 18, 10);
			expect(completed.stlFuelPerBlock).toBe(90);
		});

		it("leaves burn rates the profile carries alone, zero included", () => {
			const completed: IRaukkShipProfile = raukkCompleteShipProfile({
				...preset,
				ftlFuelPerParsec: 0,
				stlFuelPerBlock: 7,
			});

			expect(completed.ftlFuelPerParsec).toBe(0);
			expect(completed.stlFuelPerBlock).toBe(7);
		});

		it("pre-fills the damage per parsec of the reference flights", () => {
			raukkShipProfilePresets().forEach((preset) => {
				// 0.088% over a 4 parsec leg
				expect(preset.damagePerParsec).toBeCloseTo(0.00022, 10);
				expect(preset.damagePerStlBlock).toBe(0);
			});
		});
	});

	it("defaults to an enabled, direct, free configuration", () => {
		expect(raukkDefaultShippingConfig()).toStrictEqual({
			enabled: true,
			defaultProfileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
			routingMode: "direct",
			sameSystemFlatCost: 0,
			cadenceInOutDays: 14,
			cadenceWorkforceDays: 30,
			cxAnchorMode: "nearest",
		});
		expect(RAUKK_DEFAULT_SHIP_PROFILE_ID).toBe("1000x1000-standard");
	});
});
