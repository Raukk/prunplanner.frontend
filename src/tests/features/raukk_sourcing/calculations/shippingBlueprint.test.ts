import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_FSE_FUEL_RATE_PER_SECOND,
	raukkBlueprintSeed,
} from "@/features/raukk_sourcing/calculations/shippingBlueprint";
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkShipHull } from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkBlueprintSeed } from "@/features/raukk_sourcing/calculations/shippingBlueprint";

/** BP-TLRI-1286, the recorded 3000 t / 1000 m³ reference design */
const WCB: IRaukkShipHull = { cargoWeight: 3000, cargoVolume: 1000 };

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

	it("reproduces the reference block when the design IS the reference", () => {
		const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 98.1,
		});

		expect(seed.stlBlockMinutesEmpty).toBeCloseTo(
			raukkNearestCalibration(WCB, "standard").stlBlockMinutesEmpty
		);
	});

	it("slows the sublight block of a less agile design", () => {
		const agile: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 98.1,
		});
		const sluggish: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 55.3,
		});

		expect(sluggish.stlBlockMinutesEmpty).toBeGreaterThan(
			agile.stlBlockMinutesEmpty
		);
		// t ∝ 1/√a over a fixed distance
		expect(
			sluggish.stlBlockMinutesEmpty / agile.stlBlockMinutesEmpty
		).toBeCloseTo(Math.sqrt(98.1 / 55.3));
	});

	it("scales the loaded block with the gross mass", () => {
		const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 98.1,
			operatingEmptyMassTons: 936,
		});

		expect(
			seed.stlBlockMinutesLoaded / seed.stlBlockMinutesEmpty
		).toBeCloseTo(Math.sqrt((936 + 3000) / 936));
		expect(seed.seededFields).toContain("stlBlockMinutesLoaded");
	});

	it("turns the block minutes into fuel at the engine rate", () => {
		const seed: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 98.1,
			operatingEmptyMassTons: 936,
		});

		expect(seed.stlFuelPerBlock).toBeCloseTo(
			RAUKK_FSE_FUEL_RATE_PER_SECOND *
				((seed.stlBlockMinutesEmpty + seed.stlBlockMinutesLoaded) / 2) *
				60
		);
	});

	it("honours a non-FSE engine rate", () => {
		const fse: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 98.1,
		});
		const thirsty: IRaukkBlueprintSeed = raukkBlueprintSeed({
			hull: WCB,
			ftlReactor: "standard",
			accelerationMax: 98.1,
			stlFuelRatePerSecond: RAUKK_FSE_FUEL_RATE_PER_SECOND * 2,
		});

		expect(thirsty.stlFuelPerBlock).toBeCloseTo(fse.stlFuelPerBlock * 2);
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
		expect(seed.minutesPerParsec).toBe(
			raukkNearestCalibration(WCB, "standard").minutesPerParsec
		);
	});
});
