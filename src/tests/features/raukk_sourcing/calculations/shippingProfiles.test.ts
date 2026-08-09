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

	it("builds one preset per hull and reactor, plus an STL-only one", () => {
		const presets: IRaukkShipProfile[] = raukkShipProfilePresets();

		expect(presets).toHaveLength(
			RAUKK_SHIP_HULLS.length * (RAUKK_FTL_REACTORS.length + 1)
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
		it("derives the 3000t class block from the campaign WCB", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 3000, cargoVolume: 1000 },
				"standard"
			);

			expect(preset.minutesPerParsec).toBe(27.5);
			expect(preset.chargeMinutes).toBeCloseTo(52 / 60, 10);
			// ENG at 931 t, acceleration capped at 98.1 m/s²
			expect(preset.stlBlockMinutesEmpty).toBe(28.9);
			expect(preset.stlBlockMinutesLoaded).toBe(50.8);
		});

		it("uses the batch 1 HCB legs for the 5000/5000 block", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"quick-charge"
			);

			expect(preset.minutesPerParsec).toBe(33);
			expect(preset.chargeMinutes).toBeCloseTo(74 / 60, 10);
			// TO 6m59s + TRA 53m48s + a landing at the takeoff's cost
			expect(preset.stlBlockMinutesEmpty).toBeCloseTo(67.767, 3);
			// TO 13m20s + TRA 2h24m + landing, with 5,000 t aboard
			expect(preset.stlBlockMinutesLoaded).toBeCloseTo(170.667, 3);
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
				// a fresh game account starts with TWO SCB ships, counted
				// on the offered quick-charge preset
				expect(preset.shipsAvailable).toBe(
					preset.id === "500x500-quick-charge" ? 2 : 1
				);
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

			// calibration batch 3: 168 FTL units over 36 pc
			expect(standard.ftlFuelPerParsec).toBeCloseTo(168 / 36, 10);
			expect(standard.stlFuelPerBlock).toBe(123);
			// 105 FTL units over 18 pc, batch 7 reproduces it at 268 / 46
			expect(quick.ftlFuelPerParsec).toBeCloseTo(105 / 18, 10);
			// batch 1: TO 24 u + TRA 38 u + LND, and 46 + 49 + 46 loaded
			expect(quick.stlFuelPerBlock).toBe((86 + 141) / 2);
		});

		it("copies the fuel burn of the nearest covered profile", () => {
			const small: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 500, cargoVolume: 500 },
				"standard"
			);

			expect(small.ftlFuelPerParsec).toBeCloseTo(168 / 36, 10);
			expect(small.stlFuelPerBlock).toBe(123);
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
				(168 / 36) * 100,
				10
			);
			expect(raukkDerivedStlBlockCost(preset, resolvePrice)).toBeCloseTo(
				123 * 10,
				10
			);
		});

		it("derives both constants of an untouched preset", () => {
			const resolved: IRaukkResolvedShipProfile = raukkResolveShipProfile(
				preset,
				resolvePrice
			);

			expect(resolved.costPerParsec).toBeCloseTo((168 / 36) * 100, 10);
			expect(resolved.stlBlockCost).toBe(1230);
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

			expect(completed.ftlFuelPerParsec).toBeCloseTo(168 / 36, 10);
			expect(completed.stlFuelPerBlock).toBe(123);
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

		it("gives every hull an STL-only preset of its own", () => {
			const presets: IRaukkShipProfile[] = raukkShipProfilePresets();

			const stl: IRaukkShipProfile[] = presets.filter(
				(preset) => preset.stlOnly
			);

			// exactly one per hull, and it never shadows an FTL build
			expect(stl).toHaveLength(RAUKK_SHIP_HULLS.length);
			expect(stl.map((preset) => preset.id)).toStrictEqual(
				RAUKK_SHIP_HULLS.map(
					(hull) => `${hull.cargoWeight}x${hull.cargoVolume}-stl`
				)
			);

			presets
				.filter((preset) => !preset.stlOnly)
				.forEach((preset) => {
					expect(preset.id).not.toContain("-stl");
				});
		});

		it("reads an absent STL-only flag as the FTL ship it was", () => {
			const stored = { ...preset, stlOnly: undefined };

			expect(raukkCompleteShipProfile(stored).stlOnly).toBe(false);
			expect(
				raukkCompleteShipProfile({ ...preset, stlOnly: true }).stlOnly
			).toBe(true);
		});

		it("splits damage into the calibrated jump and block terms", () => {
			raukkShipProfilePresets().forEach((preset) => {
				// calibration §6: a flat 0.0011 % per parsec, reactor blind
				expect(preset.damagePerParsec).toBeCloseTo(0.000011, 12);
				// and the meteoroid law over the reference sublight leg
				expect(preset.damagePerStlBlock).toBeCloseTo(
					(25_000_000 * (2.2e-10 + 5.5e-10 * 3.28)) / 100,
					12
				);
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
		// the SCB starter hull every new game account flies
		expect(RAUKK_DEFAULT_SHIP_PROFILE_ID).toBe("500x500-quick-charge");
	});
});
