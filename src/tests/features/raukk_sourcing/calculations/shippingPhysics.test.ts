import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_DEFAULT_G_FACTOR,
	RAUKK_STANDARD_GRAVITY,
	RAUKK_STL_ENGINES,
	RAUKK_STL_TANKS,
	raukkAccelerationMax,
	raukkCruiseSpeed,
	raukkFtlDamagePerParsec,
	raukkInferStlEngine,
	raukkStlBlock,
	raukkStlDamage,
	raukkSurfaceLegFuel,
	raukkSurfaceLegSeconds,
	raukkTransitFuel,
	raukkTransitSeconds,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

/*
 * Every expectation below is an observation transcribed from the
 * Blueprint Test Flight campaign. Batch 9 is exact enough to assert on
 * directly: its surface legs carry printed seconds and its three
 * blueprints all sit on an 8 g plate, so the acceleration is known to be
 * 78.48 m/s².
 */

/** Acceleration of every batch 9 blueprint: a Basic plate at 8 g */
const BATCH_9_ACCELERATION: number = 8 * RAUKK_STANDARD_GRAVITY;

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
		it("flies every batch 9 surface leg to the printed second", () => {
			// km and seconds straight off the panels, §11.1
			const legs: [number, number][] = [
				[1_925, 222], // TO  Nike
				[5_439, 373], // TO  Vulcan
				[34_044, 932], // TO  Ashyn, the longest of the batch
				[679, 132], // TO  Aceland, the shortest
				[2_010, 227], // LND Aceland
				[5_297, 368], // LND Lom Palanka
				[26_898, 828], // LND Ashyn
			];

			legs.forEach(([km, seconds]) => {
				expect(
					raukkSurfaceLegSeconds(km, BATCH_9_ACCELERATION)
				).toBeCloseTo(seconds, -0.5);
			});
		});

		it("takes off and lands on one law, same planet same answer", () => {
			// Nike: 1,925 km up in 222 s, 5,582 km down in 378 s — the two
			// legs differ in length and return the same acceleration
			const up: number =
				(2 * 1_925 * 1_000) / raukkSurfaceLegSeconds(1_925, 78.48) ** 2;
			const down: number =
				(2 * 5_582 * 1_000) / raukkSurfaceLegSeconds(5_582, 78.48) ** 2;

			expect(up).toBeCloseTo(down, 6);
		});

		it("burns 7.55 times the rated rate over the leg", () => {
			// batch 9, standard engine: 222 s → 25 u, 932 s → 105 u
			const rate: number = RAUKK_STL_ENGINES.ENG.fuelRatePerSecond;

			expect(Math.round(raukkSurfaceLegFuel(rate, 222))).toBe(25);
			expect(Math.round(raukkSurfaceLegFuel(rate, 932))).toBe(106);
			// and the campaign's own back-prediction of batch 1
			expect(
				raukkSurfaceLegFuel(
					RAUKK_STL_ENGINES.FSE.fuelRatePerSecond,
					419
				)
			).toBeCloseTo(23.7, 1);
		});

		it("goes nowhere without acceleration or distance", () => {
			expect(raukkSurfaceLegSeconds(5_000, 0)).toBe(0);
			expect(raukkSurfaceLegSeconds(0, 78.48)).toBe(0);
		});
	});

	describe("transit", () => {
		it("prices the batch 5 engine sweep off its top speeds", () => {
			// ~25.09 M km at 50 %: Glass 35m12s, Standard 22m19s,
			// Advanced 15m47s, Hyperthrust 11m47s — all at their ceiling
			const sweep: [keyof typeof RAUKK_STL_ENGINES, number][] = [
				["GEN", 2112],
				["ENG", 1339],
				["AEN", 947],
				["HTE", 707],
			];

			sweep.forEach(([code, seconds]) => {
				expect(
					raukkTransitSeconds(
						25_090_000,
						RAUKK_STL_ENGINES[code].topSpeedKmPerSecond
					)
				).toBeCloseTo(seconds, -2);
			});
		});

		it("reproduces the batch 9 outbound leg from its fuel", () => {
			// 37 units at 78.48 m/s² on a standard engine bought 5,790 km/s
			const cruise: number = raukkCruiseSpeed(
				37,
				BATCH_9_ACCELERATION,
				RAUKK_STL_ENGINES.ENG.fuelRatePerSecond,
				RAUKK_STL_ENGINES.ENG.topSpeedKmPerSecond
			);

			expect(cruise).toBeGreaterThan(5_500);
			expect(cruise).toBeLessThan(6_000);
			// and that speed flies the 105.0 M km Antares III leg in 5h02m
			expect(raukkTransitSeconds(105_026_115, cruise)).toBeCloseTo(
				18_120,
				-3
			);
		});

		it("pins the fuel saver to its own speed cap, empty or loaded", () => {
			// batch 1 at 25 %: 875 units, 43m47s over 25.08 M km — the same
			// 43m47s empty at 59.81 m/s² and loaded at 14.99
			const empty: number = raukkCruiseSpeed(
				875,
				59.81,
				RAUKK_STL_ENGINES.FSE.fuelRatePerSecond,
				RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond
			);
			const loaded: number = raukkCruiseSpeed(
				875,
				100_000 / 6672,
				RAUKK_STL_ENGINES.FSE.fuelRatePerSecond,
				RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond
			);

			expect(empty).toBe(RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond);
			expect(loaded).toBe(empty);
			expect(raukkTransitSeconds(25_084_752, loaded)).toBeCloseTo(
				2627,
				-2
			);
		});

		it("lets a thin budget fall short of the ceiling", () => {
			// MIN on a heavily loaded fuel saver: batch 1 flew 2h24m
			const cruise: number = raukkCruiseSpeed(
				49,
				100_000 / 6672,
				RAUKK_STL_ENGINES.FSE.fuelRatePerSecond,
				RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond
			);

			expect(cruise).toBeLessThan(
				RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond
			);
			expect(raukkTransitSeconds(24_136_995, cruise)).toBeGreaterThan(
				2627
			);
		});
	});

	describe("the sublight block", () => {
		it("is a surface hop and the two transit legs of one flight", () => {
			const block = raukkStlBlock({
				accelerationMax: BATCH_9_ACCELERATION,
				fuelRatePerSecond: RAUKK_STL_ENGINES.ENG.fuelRatePerSecond,
				topSpeedKmPerSecond: RAUKK_STL_ENGINES.ENG.topSpeedKmPerSecond,
				tankCapacity: RAUKK_STL_TANKS.SSL,
				sliderFraction: 0,
				meteoroidDensity: 3.28,
			});

			expect(block.seconds).toBeCloseTo(
				block.surfaceSeconds +
					block.planetTransitSeconds +
					block.stationTransitSeconds,
				6
			);
			// the planet side leg is the long one, by a factor of three
			expect(block.planetTransitSeconds).toBeGreaterThan(
				3 * block.stationTransitSeconds
			);
			// two transit budgets plus the surface hop's rated burn
			expect(block.fuel).toBeCloseTo(
				2 * 40 +
					raukkSurfaceLegFuel(
						RAUKK_STL_ENGINES.ENG.fuelRatePerSecond,
						block.surfaceSeconds
					),
				6
			);
		});

		it("carries the meteoroid law of both transit legs", () => {
			const dense = raukkStlBlock({
				accelerationMax: 98.1,
				fuelRatePerSecond: 0.0075,
				topSpeedKmPerSecond: 9_550,
				tankCapacity: RAUKK_STL_TANKS.MSL,
				sliderFraction: 0.05,
				meteoroidDensity: 2.93,
			});
			const clean = raukkStlBlock({
				accelerationMax: 98.1,
				fuelRatePerSecond: 0.0075,
				topSpeedKmPerSecond: 9_550,
				tankCapacity: RAUKK_STL_TANKS.MSL,
				sliderFraction: 0.05,
				meteoroidDensity: 0.028,
			});

			expect(dense.damage).toBeGreaterThan(clean.damage);
			// and both include the one landing a one way flight ends with
			expect(clean.damage).toBeGreaterThan(0.018 / 100);
		});
	});

	describe("the fuel slider", () => {
		it("spends a fraction of the TANK, not of the engine", () => {
			// 25 % of a 3,500 unit MSL burned 874 units on batch 1
			expect(raukkTransitFuel(RAUKK_STL_TANKS.MSL, 0.25)).toBeCloseTo(
				875,
				10
			);
			// a smaller tank at the same slider costs proportionally less
			expect(raukkTransitFuel(RAUKK_STL_TANKS.SSL, 0.25)).toBeCloseTo(
				375,
				10
			);
		});

		it("clamps past the quarter tank nobody flies beyond", () => {
			expect(raukkTransitFuel(RAUKK_STL_TANKS.MSL, 1)).toBeCloseTo(
				raukkTransitFuel(RAUKK_STL_TANKS.MSL, 0.25),
				10
			);
		});

		it("burns a flat economy budget at MIN instead", () => {
			// §1.1 and every MIN leg of batches 4, 7 and 9: 37 to 49 units,
			// whatever the tank, the mass and above all the distance
			expect(raukkTransitFuel(RAUKK_STL_TANKS.MSL, 0)).toBe(40);
			expect(raukkTransitFuel(RAUKK_STL_TANKS.SSL, 0)).toBe(40);
		});
	});

	describe("defaults", () => {
		it("assumes the fleet the user actually flies", () => {
			// USER DECISION: fuel saver and Lightweight Hull Plate
			expect(RAUKK_DEFAULT_G_FACTOR).toBe(10);
			expect(RAUKK_STL_ENGINES.FSE.fuelRatePerSecond).toBe(0.0075);
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
