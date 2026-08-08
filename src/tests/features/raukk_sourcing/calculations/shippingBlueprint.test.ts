import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_FSE_FUEL_RATE_PER_SECOND,
	raukkBlueprintSeed,
} from "@/features/raukk_sourcing/calculations/shippingBlueprint";
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import { RAUKK_STL_TANKS } from "@/features/raukk_sourcing/calculations/shippingPhysics";

// Types & Interfaces
import { IRaukkShipHull } from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkBlueprintSeed } from "@/features/raukk_sourcing/calculations/shippingBlueprint";

/** The 3000 t / 1000 m³ weight hull of the campaign's BP-EXRX-5540 */
const WCB: IRaukkShipHull = { cargoWeight: 3000, cargoVolume: 1000 };

/** The 5000 t / 5000 m³ heavy hull of the campaign's BP-ELTK-1115 */
const HCB: IRaukkShipHull = { cargoWeight: 5000, cargoVolume: 5000 };

describe("Raukk Shipping: Blueprint Seed", () => {
	it("reads the jump speed straight off the FTL maximum", () => {
		const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "quick-charge",
			ftlSpeedMaxParsecPerHour: 2.5,
		});

		expect(seed.minutesPerParsec).toBeCloseTo(24);
		expect(seed.seededFields).toContain("minutesPerParsec");
	});

	it("reports what the blueprint never stated and seeds nothing there", () => {
		const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
		});

		expect(seed.missing).toEqual([
			"ftlSpeedMaxParsecPerHour",
			"accelerationMax",
			"operatingEmptyMassTons",
		]);
		expect(seed.seededFields).not.toContain("minutesPerParsec");
		expect(seed.seededFields).not.toContain("stlBlockMinutesEmpty");
		expect(seed.minutesPerParsec).toBe(
			raukkNearestCalibration(WCB, "standard").minutesPerParsec
		);
	});

	it("seeds both damage terms from the laws, with or without stats", () => {
		const bare: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
		});

		// calibration §6: a flat 0.0011 % per parsec, reactor independent
		expect(bare.damagePerParsec).toBeCloseTo(0.000011, 12);
		// and the meteoroid law over the reference sublight leg
		expect(bare.damagePerStlBlock).toBeCloseTo(
			(25_000_000 * (2.2e-10 + 5.5e-10 * 3.28)) / 100,
			12
		);
		expect(bare.seededFields).toContain("damagePerParsec");
		expect(bare.seededFields).toContain("damagePerStlBlock");
	});

	it("prices a Hortus run at the damage the campaign observed", () => {
		// batch 1 flew VH-331a → HRT, density 0.028, and took 0.006 %
		const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: HCB,
			ftlReactor: "standard",
			meteoroidDensity: 0.028,
		});

		// the game reports damage to three decimals: 0.005885 reads 0.006
		expect(seed.damagePerStlBlock * 100).toBeCloseTo(0.006, 3);
	});

	describe("batch 1: the HCB of BP-ELTK-1115, FSE at 1,672 t", () => {
		/** The blueprint panel of the batch 1 ship */
		const stats = {
			hull: HCB,
			ftlReactor: "standard" as const,
			accelerationMax: 59.8,
			operatingEmptyMassTons: 1672,
			stlFuelRatePerSecond: RAUKK_FSE_FUEL_RATE_PER_SECOND,
			stlTankCapacity: RAUKK_STL_TANKS.MSL,
		};

		it("reproduces the observed takeoff and transit legs", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed(stats);

			/*
			 * Observed: TO 6m59s and, once the slider is off MIN, a transit
			 * of 43m47s that the fuel saver's speed cap pins there. Adding
			 * the landing §1.3 gives the block, so the whole block is
			 * 6m59s + 43m47s + 6m59s ≈ 57.9 minutes. Two percent is the
			 * band the campaign's own constants are quoted at.
			 */
			const observed: number = (419 + 2627 + 419) / 60;

			expect(seed.stlBlockMinutesEmpty).toBeGreaterThan(observed * 0.98);
			expect(seed.stlBlockMinutesEmpty).toBeLessThan(observed * 1.02);
			expect(seed.seededFields).toContain("stlBlockMinutesEmpty");
		});

		it("slows the loaded block through the acceleration alone", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed(stats);

			/*
			 * 5,000 t aboard drops accelMax from 59.8 to 100,000 / 6,672 =
			 * 15.0 m/s², and the observed takeoff grows from 6m59s to
			 * 13m20s — the campaign needs no separate mass term at all.
			 */
			const observed: number = (800 + 2627 + 800) / 60;

			expect(seed.stlBlockMinutesLoaded).toBeGreaterThan(observed * 0.95);
			expect(seed.stlBlockMinutesLoaded).toBeLessThan(observed * 1.1);
			expect(seed.seededFields).toContain("stlBlockMinutesLoaded");
		});

		it("spends a quarter tank per transit leg at a 25% slider", () => {
			const min: IRaukkBlueprintSeed = raukkBlueprintSeed(stats);
			const fast: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 0.25,
			});

			/*
			 * The slider is a BUDGET, not a throttle: 25 % of the 3,500
			 * unit MSL burned 874 units on batch 1, whatever the engine,
			 * the mass or the distance. Every block then costs that plus
			 * its two slider-blind takeoff legs, ~47 units empty and ~94
			 * loaded, so the flat mean lands just past 945.
			 */
			expect(fast.stlFuelPerBlock).toBeCloseTo(945, 0);
			expect(fast.stlFuelPerBlock).toBeGreaterThan(min.stlFuelPerBlock);
			// MIN is the other operating point: rated burn, ~91 units
			expect(min.stlFuelPerBlock).toBeCloseTo(91, 0);
		});

		it("clamps a slider past the quarter tank the campaign caps at", () => {
			const quarter: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 0.25,
			});
			const wide: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 1,
			});

			expect(wide.stlFuelPerBlock).toBeCloseTo(
				quarter.stlFuelPerBlock,
				10
			);
		});

		it("burns the observed takeoff fuel at the rated rate", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed(stats);
			const empty: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				hull: { cargoWeight: 0, cargoVolume: 0 },
			});

			/*
			 * 7.55 × 0.0075 u/s × 419 s = 23.7 units, and the campaign read
			 * 24 off the panel. A hold that holds nothing makes the block
			 * two of those plus the MIN transit burn.
			 */
			expect(empty.stlFuelPerBlock).toBeGreaterThan(2 * 23.7);
			expect(seed.stlFuelPerBlock).toBeGreaterThan(empty.stlFuelPerBlock);
		});
	});

	describe("engine inference from the panel", () => {
		it("separates the glass and the standard engine by consistency", () => {
			/*
			 * Both burn 0.015 u/s. The campaign's GEN at 753 t reaches
			 * 66.4 m/s², which only 50,000 t·m/s² of thrust explains
			 * exactly; its ENG at 931 t reads 98.1, which the glass engine
			 * could never reach — 50,000 / 931 is 53.7 — so that one is the
			 * 125,000 engine, running into its 10 g cap.
			 */
			const glass: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: WCB,
				ftlReactor: "standard",
				accelerationMax: 66.4,
				operatingEmptyMassTons: 753,
				stlFuelRatePerSecond: 0.015,
			});
			const standard: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: WCB,
				ftlReactor: "standard",
				accelerationMax: 98.1,
				operatingEmptyMassTons: 931,
				stlFuelRatePerSecond: 0.015,
			});

			// the glass engine is thrust limited: 50,000 / 3,753 = 13.3
			expect(
				glass.stlBlockMinutesLoaded / glass.stlBlockMinutesEmpty
			).toBeCloseTo(Math.sqrt(66.4 / (50_000 / 3753)), 1);
			// the standard one keeps far more of its acceleration
			expect(standard.stlBlockMinutesLoaded).toBeLessThan(
				glass.stlBlockMinutesLoaded
			);
		});

		it("keeps a g-capped design fast until the cap is left behind", () => {
			/*
			 * The advanced engine at 250,000 t·m/s² gives a 931 t hull far
			 * more than its 10 g cap allows, so the first tonnes of cargo
			 * cost NOTHING — the plain √(gross / empty) scaling the seed
			 * used before this file knew any engine constants would have
			 * charged for them.
			 */
			const light: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: { cargoWeight: 100, cargoVolume: 100 },
				ftlReactor: "standard",
				accelerationMax: 98.1,
				operatingEmptyMassTons: 931,
				stlFuelRatePerSecond: 0.02,
			});

			expect(light.stlBlockMinutesLoaded).toBeCloseTo(
				light.stlBlockMinutesEmpty,
				10
			);
		});

		it("falls back to constant thrust when no engine matches", () => {
			/*
			 * An unknown burn rate identifies no engine, so the panel
			 * reading is all there is: thrust = accel × empty mass, which
			 * is the √(gross / empty) law of the pre-campaign seed.
			 */
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: WCB,
				ftlReactor: "standard",
				accelerationMax: 98.1,
				operatingEmptyMassTons: 936,
				stlFuelRatePerSecond: 0.0123,
			});

			expect(
				seed.stlBlockMinutesLoaded / seed.stlBlockMinutesEmpty
			).toBeCloseTo(Math.sqrt((936 + 3000) / 936), 6);
		});
	});
});
