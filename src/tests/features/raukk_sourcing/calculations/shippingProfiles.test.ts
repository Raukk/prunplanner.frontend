import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_DEFAULT_SHIP_PROFILE_ID,
	RAUKK_FTL_REACTORS,
	RAUKK_SHIP_HULLS,
	raukkDefaultShippingConfig,
	raukkNearestCalibration,
	raukkShipProfileId,
	raukkShipProfilePreset,
	raukkShipProfilePresets,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkShipProfile,
	IRaukkTimeCalibration,
} from "@/features/raukk_sourcing/calculations/shipping.types";

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

		it("leaves the ȼ constants at zero, they are not derivable", () => {
			raukkShipProfilePresets().forEach((preset) => {
				expect(preset.costPerParsec).toBe(0);
				expect(preset.stlBlockCost).toBe(0);
				expect(preset.shipsAvailable).toBe(1);
			});
		});

		it("pre-fills the damage per parsec of the reference flights", () => {
			raukkShipProfilePresets().forEach((preset) => {
				// 0.088% over a 4 parsec leg
				expect(preset.damagePerParsec).toBeCloseTo(0.00022, 10);
				expect(preset.damagePerStlBlock).toBe(0);
			});
		});
	});

	it("defaults to a disabled, direct, free configuration", () => {
		expect(raukkDefaultShippingConfig()).toStrictEqual({
			enabled: false,
			defaultProfileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
			routingMode: "direct",
			sameSystemFlatCost: 0,
		});
		expect(RAUKK_DEFAULT_SHIP_PROFILE_ID).toBe("1000x1000-standard");
	});
});
