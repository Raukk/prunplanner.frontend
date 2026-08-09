import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_DEFAULT_FUEL_RATE_PER_SECOND,
	raukkBlueprintSeed,
} from "@/features/raukk_sourcing/calculations/shippingBlueprint";
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	RAUKK_FTL_FUEL_UNITS_PER_PARSEC,
	RAUKK_STL_ENGINES,
	RAUKK_STL_TANKS,
	raukkStlBlockDamage,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

// Types & Interfaces
import { IRaukkShipHull } from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkBlueprintSeed } from "@/features/raukk_sourcing/calculations/shippingBlueprint";

/** The 3000 t / 1000 m³ weight hull of the campaign's BP-EXRX-5540 */
const WCB: IRaukkShipHull = { cargoWeight: 3000, cargoVolume: 1000 };

/** The 5000 t / 5000 m³ heavy hull of the campaign's BP-ELTK-1115 */
const HCB: IRaukkShipHull = { cargoWeight: 5000, cargoVolume: 5000 };

describe("Raukk Shipping: Blueprint Seed", () => {
	it("corrects the FTL maximum the panel advertises", () => {
		/*
		 * calibration §11.3: the panel stat is a ceiling, not a speed.
		 * The three hulls of §3 fly 4 pc in 59m49s, 1h29m and 1h44m at
		 * 8.6, 3.9 and 2.8 pc/h — 2.1×, 1.5× and 1.2× slower than the
		 * `60 / speed` this seed used to assume.
		 */
		const observed: [number, number][] = [
			[8.6, 59.82 / 4],
			[3.9, 89 / 4],
			[2.8, 104 / 4],
		];

		observed.forEach(([speed, minutesPerParsec]) => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: WCB,
				ftlReactor: "standard",
				ftlSpeedMaxParsecPerHour: speed,
			});

			expect(seed.minutesPerParsec).toBeGreaterThan(
				minutesPerParsec * 0.94
			);
			expect(seed.minutesPerParsec).toBeLessThan(minutesPerParsec * 1.06);
			expect(seed.seededFields).toContain("minutesPerParsec");
		});
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

	it("seeds every law-only term with or without stats", () => {
		const bare: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
		});

		// calibration §6: a flat 0.0011 % per parsec, reactor independent
		expect(bare.damagePerParsec).toBeCloseTo(0.000011, 12);
		// §11.3: a flat 4.687 units per real parsec
		expect(bare.ftlFuelPerParsec).toBe(RAUKK_FTL_FUEL_UNITS_PER_PARSEC);
		// §11.4: the meteoroid law over both transit legs, plus a landing
		expect(bare.damagePerStlBlock).toBeCloseTo(
			raukkStlBlockDamage(3.28),
			12
		);
		expect(bare.seededFields).toContain("damagePerParsec");
		expect(bare.seededFields).toContain("damagePerStlBlock");
		expect(bare.seededFields).toContain("ftlFuelPerParsec");
	});

	it("prices a clean system far below a dirty one", () => {
		const hortus: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: HCB,
			ftlReactor: "standard",
			meteoroidDensity: 0.028,
		});
		const romulan: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: HCB,
			ftlReactor: "standard",
			meteoroidDensity: 2.93,
		});

		expect(romulan.damagePerStlBlock).toBeGreaterThan(
			4 * hortus.damagePerStlBlock
		);
	});

	describe("batch 1: the HCB of BP-ELTK-1115, FSE at 1,672 t", () => {
		/** The blueprint panel of the batch 1 ship */
		const stats = {
			hull: HCB,
			ftlReactor: "standard" as const,
			accelerationMax: 59.8,
			operatingEmptyMassTons: 1672,
			stlFuelRatePerSecond: RAUKK_DEFAULT_FUEL_RATE_PER_SECOND,
			stlTankCapacity: RAUKK_STL_TANKS.MSL,
		};

		it("flies both transit legs at the fuel saver's own ceiling", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed(stats);

			/*
			 * At the default 5 % slider a 3,500 unit tank buys far more
			 * speed than the fuel saver can use, so the block is the two
			 * reference transit legs at 9,550 km/s plus one surface hop —
			 * which is exactly the regime batch 1 measured at 25, 50 and
			 * 100 %, three prices for one duration.
			 */
			expect(seed.cruiseSpeedKmPerSecond).toBe(
				RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond
			);
			expect(seed.stlBlockMinutesEmpty).toBeCloseTo(160.8, 0);
			expect(seed.seededFields).toContain("stlBlockMinutesEmpty");
		});

		it("charges cargo once it pulls the ship off the ceiling", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed(stats);

			/*
			 * 5,000 t on a 1,672 t hull drops accelMax from 59.8 to 15.0
			 * m/s², which is far enough to leave the fuel saver's ceiling
			 * behind — so the loaded block runs about half again as long.
			 * Cargo is free only while the ceiling still binds, which is
			 * what the g-capped case below shows.
			 */
			expect(seed.stlBlockMinutesLoaded).toBeGreaterThan(
				1.4 * seed.stlBlockMinutesEmpty
			);
			expect(seed.seededFields).toContain("stlBlockMinutesLoaded");
		});

		it("leaves a light load free while the ceiling still binds", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				hull: { cargoWeight: 500, cargoVolume: 500 },
			});

			// batch 10 flew 0, 200 and 400 t at an identical 4h16m
			expect(seed.stlBlockMinutesLoaded).toBeLessThan(
				1.02 * seed.stlBlockMinutesEmpty
			);
		});

		it("lets MIN cost the loaded ship its whole day", () => {
			const min: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 0,
			});

			/*
			 * MIN buys a flat ~40 units, which at 15.0 m/s² is nowhere near
			 * the ceiling — batch 1 flew 2h24m loaded against 43m47s at any
			 * slider setting at all.
			 */
			expect(min.cruiseSpeedKmPerSecond).toBeLessThan(
				RAUKK_STL_ENGINES.FSE.topSpeedKmPerSecond
			);
			expect(min.stlBlockMinutesLoaded).toBeGreaterThan(
				3 * min.stlBlockMinutesEmpty
			);
		});

		it("spends a quarter tank per transit leg at a 25% slider", () => {
			const min: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 0,
			});
			const fast: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 0.25,
			});

			/*
			 * The slider is a BUDGET, not a throttle: 25 % of the 3,500
			 * unit MSL burned 874 units on a whole transit leg of batch 1.
			 * A block flies two HALF legs — a departure and an approach at
			 * 0.49 and 0.63 of that budget (§13.2) — plus its slider-blind
			 * surface hop.
			 */
			expect(fast.stlFuelPerBlock).toBeGreaterThan(1.12 * 875);
			expect(fast.stlFuelPerBlock).toBeLessThan(1.12 * 875 + 60);
			expect(fast.stlFuelPerBlock).toBeGreaterThan(min.stlFuelPerBlock);
			// MIN is the other operating point: two flat 40 unit budgets
			expect(min.stlFuelPerBlock).toBeGreaterThan(2 * 40);
			expect(min.stlFuelPerBlock).toBeLessThan(2 * 40 + 60);
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

		it("burns the observed surface-hop fuel at the rated rate", () => {
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
				...stats,
				stlFuelSliderFraction: 0,
				surfaceLegKm: 5_250,
			});

			/*
			 * 5,250 km is what batch 1's own takeoff implies through
			 * §11.1, and 7.55 × 0.0075 u/s × 419 s = 23.7 units is what the
			 * campaign back-predicted against the 24 on the panel. The
			 * block is that plus its two MIN transit budgets.
			 */
			expect(seed.stlFuelPerBlock).toBeGreaterThan(2 * 40 + 23);
			expect(seed.stlFuelPerBlock).toBeLessThan(2 * 40 + 50);
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
				stlFuelSliderFraction: 0,
			});
			const standard: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: WCB,
				ftlReactor: "standard",
				accelerationMax: 98.1,
				operatingEmptyMassTons: 931,
				stlFuelRatePerSecond: 0.015,
				stlFuelSliderFraction: 0,
			});

			// the glass engine loses far more of its cruise to the cargo
			expect(glass.stlBlockMinutesLoaded).toBeGreaterThan(
				standard.stlBlockMinutesLoaded
			);
			// and neither reaches its ceiling on a MIN budget
			expect(glass.cruiseSpeedKmPerSecond).toBeLessThan(
				RAUKK_STL_ENGINES.GEN.topSpeedKmPerSecond
			);
		});

		it("keeps a g-capped design fast until the cap is left behind", () => {
			/*
			 * The advanced engine at 250,000 t·m/s² gives a 931 t hull far
			 * more than its 10 g cap allows, so the first tonnes of cargo
			 * cost NOTHING.
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

		it("falls back to the fleet's own engine when nothing matches", () => {
			/*
			 * USER DECISION (2026-08-09): an unknown burn rate identifies no
			 * engine, and the app then assumes what the user's fleet flies —
			 * the fuel saver on a Lightweight plate — rather than reading a
			 * thrust off the panel figure.
			 */
			const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
				hull: WCB,
				ftlReactor: "standard",
				operatingEmptyMassTons: 936,
				stlFuelRatePerSecond: 0.0123,
				stlFuelSliderFraction: 0,
			});

			/*
			 * The fuel saver's 100,000 t·m/s² over 936 t is 106.8, above the
			 * 98.1 a 10 g plate allows, so the design flies at the cap — and
			 * the panel's own burn rate is still what prices it, because a
			 * stated stat beats an assumed one wherever it exists.
			 */
			expect(seed.cruiseSpeedKmPerSecond).toBeCloseTo(
				(40 * 98.1) / (34 * 0.0123),
				6
			);
			expect(RAUKK_DEFAULT_FUEL_RATE_PER_SECOND).toBe(0.0075);
		});
	});
});
