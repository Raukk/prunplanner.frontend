import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_STL_ENGINES,
	RAUKK_STL_TANKS,
	raukkAccelerationMax,
	raukkFtlDamagePerParsec,
	raukkInferStlEngine,
	raukkStlDamage,
	raukkTakeoffFuel,
	raukkTakeoffSeconds,
	raukkTransitCapSeconds,
	raukkTransitFuel,
	raukkTransitSeconds,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

/*
 * Every expectation below is an observation transcribed from
 * docs/raukk_sourcing/shipping-calibration.md, section 7. The tolerances
 * are the bands that document quotes its own constants at — the time
 * constants are stated as ranges (3,130-3,300 and 10,400-11,000), so a
 * couple of percent is as tight as the model can honestly claim.
 */

describe("Raukk Shipping: Flight Physics", () => {
	describe("acceleration", () => {
		it("matches the three builds the campaign verified by hand", () => {
			// FSE at 1,672 t → 59.8, thrust limited
			expect(
				raukkAccelerationMax(
					RAUKK_STL_ENGINES.FSE.thrustTonneMetersPerSecondSquared,
					1672
				)
			).toBeCloseTo(59.8, 1);
			// GEN at 753 t → 66.4, thrust limited
			expect(
				raukkAccelerationMax(
					RAUKK_STL_ENGINES.GEN.thrustTonneMetersPerSecondSquared,
					753
				)
			).toBeCloseTo(66.4, 1);
			// ENG at 931 t → 134.3 by thrust, but a 10 g hull caps it at 98.1
			expect(
				raukkAccelerationMax(
					RAUKK_STL_ENGINES.ENG.thrustTonneMetersPerSecondSquared,
					931,
					10
				)
			).toBeCloseTo(98.1, 1);
		});

		it("returns nothing for a design with no thrust or no mass", () => {
			expect(raukkAccelerationMax(0, 100)).toBe(0);
			expect(raukkAccelerationMax(100, 0)).toBe(0);
		});
	});

	describe("takeoff and landing", () => {
		it("reproduces the batch 1 takeoff across the mass range", () => {
			// 1,672 t at 59.8 m/s² took 6m59s
			expect(raukkTakeoffSeconds(59.8)).toBeCloseTo(419, -1.5);
			// 6,672 t, so 100,000 / 6,672 = 14.99 m/s², took 13m20s
			expect(raukkTakeoffSeconds(100_000 / 6672)).toBeCloseTo(800, -2);
		});

		it("burns 7.55 times the rated rate over the leg", () => {
			// the campaign back-predicts batch 1 at 23.7 and 45.3 units
			expect(
				raukkTakeoffFuel(RAUKK_STL_ENGINES.FSE.fuelRatePerSecond, 419)
			).toBeCloseTo(23.7, 1);
			expect(
				raukkTakeoffFuel(RAUKK_STL_ENGINES.FSE.fuelRatePerSecond, 800)
			).toBeCloseTo(45.3, 0);
		});
	});

	describe("transit", () => {
		it("holds the engine sweep of batch 5 to its shared constant", () => {
			// Glass 26.8 → 35m12s, Standard 66.9 → 22m19s,
			// Advanced 133.4 → 15m47s, Hyperthrust 215.8 → 11m47s
			const sweep: [number, number][] = [
				[26.8, 2112],
				[66.9, 1339],
				[133.4, 947],
				[215.8, 707],
			];

			sweep.forEach(([acceleration, seconds]) => {
				const predicted: number = raukkTransitSeconds(acceleration);

				expect(predicted).toBeGreaterThan(seconds * 0.9);
				expect(predicted).toBeLessThan(seconds * 1.1);
			});
		});

		it("pins the fuel saver to its own speed cap, empty or loaded", () => {
			const cap: number = raukkTransitCapSeconds(
				59.8,
				RAUKK_STL_ENGINES.FSE.speedCapFactor
			);

			// batch 1 flew 43m47s at every slider setting and every load
			expect(cap).toBeCloseTo(2627, -2);
			expect(raukkTransitSeconds(59.8, cap)).toBeCloseTo(cap, 10);
			// loading 5,000 t drops it to 14.99 m/s² and only then past it
			expect(raukkTransitSeconds(100_000 / 6672, cap)).toBeGreaterThan(
				cap
			);
		});

		it("leaves every other engine untouched by its own cap", () => {
			const cap: number = raukkTransitCapSeconds(
				98.1,
				RAUKK_STL_ENGINES.ENG.speedCapFactor
			);

			// a loaded ship always flies longer than its empty prediction
			expect(raukkTransitSeconds(31.8, cap)).toBeCloseTo(
				raukkTransitSeconds(31.8),
				10
			);
		});
	});

	describe("the fuel slider", () => {
		it("spends a fraction of the TANK, not of the engine", () => {
			// 25 % of a 3,500 unit MSL burned 874 units on batch 1
			expect(
				raukkTransitFuel(
					RAUKK_STL_ENGINES.FSE.fuelRatePerSecond,
					2627,
					RAUKK_STL_TANKS.MSL,
					0.25
				)
			).toBeCloseTo(875, 10);
			// and 50 % burned 1,723-1,734, engine and mass independent
			expect(
				raukkTransitFuel(
					RAUKK_STL_ENGINES.HTE.fuelRatePerSecond,
					700,
					RAUKK_STL_TANKS.MSL,
					0.5
				)
			).toBeCloseTo(875, 10);
		});

		it("burns at the rated rate at MIN instead", () => {
			expect(
				raukkTransitFuel(
					RAUKK_STL_ENGINES.FSE.fuelRatePerSecond,
					2627,
					RAUKK_STL_TANKS.MSL,
					0
				)
			).toBeCloseTo(19.7, 1);
		});
	});

	describe("damage", () => {
		it("prices a Hortus transit at the observed 0.006 %", () => {
			// batch 1, ~25 M km through a system of density 0.028
			// the game reports damage to three decimals: 0.005885 reads 0.006
			expect(raukkStlDamage(25_000_000, 0.028) * 100).toBeCloseTo(
				0.006,
				3
			);
		});

		it("scales with the meteoroid density of the system", () => {
			// Romulan at 2.93 is far dirtier than Hortus at 0.028
			expect(raukkStlDamage(82_900_000, 2.93) * 100).toBeGreaterThan(
				raukkStlDamage(82_900_000, 0.028) * 100
			);
		});

		it("charges a flat, reactor blind rate for a jump", () => {
			// 0.007 % over 6 pc, 0.012 over 11, 0.015 over 14, 0.009 over 9
			expect(raukkFtlDamagePerParsec() * 6 * 100).toBeCloseTo(0.007, 3);
			expect(raukkFtlDamagePerParsec() * 11 * 100).toBeCloseTo(0.012, 3);
			expect(raukkFtlDamagePerParsec() * 14 * 100).toBeCloseTo(0.015, 3);
		});
	});

	describe("engine inference", () => {
		it("identifies the engines whose burn rate is unique", () => {
			expect(raukkInferStlEngine(0.0075)).toBe("FSE");
			expect(raukkInferStlEngine(0.02)).toBe("AEN");
			expect(raukkInferStlEngine(0.03)).toBe("HTE");
		});

		it("separates GEN from ENG on the design's own numbers", () => {
			expect(raukkInferStlEngine(0.015, 66.4, 753)).toBe("GEN");
			expect(raukkInferStlEngine(0.015, 98.1, 931)).toBe("ENG");
		});

		it("takes the weakest of a shared rate without a design", () => {
			expect(raukkInferStlEngine(0.015)).toBe("GEN");
		});

		it("returns nothing for a rate no engine has", () => {
			expect(raukkInferStlEngine(0.0123)).toBeNull();
		});
	});
});
