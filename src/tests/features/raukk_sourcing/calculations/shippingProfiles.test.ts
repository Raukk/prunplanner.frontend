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
import {
	RAUKK_FTL_FUEL_UNITS_PER_PARSEC,
	raukkStlBlockDamage,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

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
		it("takes the WCB jump constants from the flight that flew them", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 3000, cargoVolume: 1000 },
				"standard"
			);

			// §10: 4 pc in 1h44m over 3.93 real parsecs
			expect(preset.minutesPerParsec).toBe(26.5);
			// §11.3: 4m53s of charge, measured seven times on batch 9
			expect(preset.chargeMinutes).toBeCloseTo(293 / 60, 10);
		});

		it("takes the SCB jump constants from batch 9's eight-hop fit", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 500, cargoVolume: 500 },
				"standard"
			);

			expect(preset.minutesPerParsec).toBe(22.51);
			expect(preset.ftlFuelPerParsec).toBe(
				RAUKK_FTL_FUEL_UNITS_PER_PARSEC
			);
		});

		it("keeps the HCB on batch 7's own jump constants", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"quick-charge"
			);

			expect(preset.minutesPerParsec).toBe(33);
			expect(preset.chargeMinutes).toBeCloseTo(74 / 60, 10);
		});

		it("times a block as a surface hop and two transit legs", () => {
			const preset: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 5000, cargoVolume: 5000 },
				"quick-charge"
			);

			/*
			 * §11.6: 67.3 M km planet side and 20.8 M km station side, both
			 * at the fuel saver's 9,550 km/s ceiling on the default slider,
			 * plus a surface hop. Loading 5,000 t only stretches the hop.
			 */
			expect(preset.stlBlockMinutesEmpty).toBeGreaterThan(
				88_100_000 / 9_550 / 60
			);
			expect(preset.stlBlockMinutesLoaded).toBeGreaterThan(
				preset.stlBlockMinutesEmpty
			);
			expect(preset.stlBlockMinutesLoaded).toBeLessThan(
				preset.stlBlockMinutesEmpty * 1.1
			);
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

			expect(small.hull.cargoVolume).toBe(500);
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
				// a fresh game account starts with TWO SCB standard ships
				expect(preset.shipsAvailable).toBe(
					preset.id === "500x500-standard" ? 2 : 1
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
			// 105 FTL units over 18 pc, batch 7 reproduces it at 268 / 46
			expect(quick.ftlFuelPerParsec).toBeCloseTo(105 / 18, 10);
			/*
			 * §11.2: a block flies two transit legs, each spending the
			 * slider's whole budget out of the profile's own tank — 175
			 * units at the default 5 % of a 3,500 unit MSL — plus the
			 * slider-blind surface hop.
			 */
			[standard, quick].forEach((preset) => {
				expect(preset.stlFuelPerBlock).toBeGreaterThan(2 * 175);
				expect(preset.stlFuelPerBlock).toBeLessThan(2 * 175 + 80);
			});
		});

		it("copies the fuel burn of the nearest covered profile", () => {
			// no quick-charge SCB was ever flown, so it copies the standard
			// one across the reactor flag: same hull, same 1,500 unit tank
			const small: IRaukkShipProfile = raukkShipProfilePreset(
				{ cargoWeight: 500, cargoVolume: 500 },
				"quick-charge"
			);

			expect(small.ftlFuelPerParsec).toBe(
				RAUKK_FTL_FUEL_UNITS_PER_PARSEC
			);
			expect(small.stlFuelPerBlock).toBeGreaterThan(2 * 75);
			expect(small.stlFuelPerBlock).toBeLessThan(2 * 75 + 40);
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
				preset.stlFuelPerBlock * 10,
				10
			);
		});

		it("derives both constants of an untouched preset", () => {
			const resolved: IRaukkResolvedShipProfile = raukkResolveShipProfile(
				preset,
				resolvePrice
			);

			expect(resolved.costPerParsec).toBeCloseTo((168 / 36) * 100, 10);
			expect(resolved.stlBlockCost).toBeCloseTo(
				preset.stlFuelPerBlock * 10,
				10
			);
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
			expect(completed.stlFuelPerBlock).toBe(preset.stlFuelPerBlock);
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

		it("presets an FTL ship, never an STL-only one", () => {
			raukkShipProfilePresets().forEach((preset) => {
				expect(preset.stlOnly).toBe(false);
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
				// §11.4: the meteoroid law over both transit legs, plus one
				// landing, stated at the reference density
				expect(preset.damagePerStlBlock).toBeCloseTo(
					raukkStlBlockDamage(3.28),
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
		expect(RAUKK_DEFAULT_SHIP_PROFILE_ID).toBe("500x500-standard");
	});
});
