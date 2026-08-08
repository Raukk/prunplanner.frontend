import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_CALIBRATION_WARNINGS,
	calibrateShipProfile,
} from "@/features/raukk_sourcing/calculations/shippingCalibration";
import {
	createRouteDistance,
	RAUKK_POSITION_UNITS_PER_PARSEC,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { createChainStaticData } from "@/features/raukk_sourcing/calculations/shippingChainData";
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkRouteDistance,
	IRaukkSystemNode,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { IRaukkChainStaticData } from "@/features/raukk_sourcing/calculations/shippingChainData";
import {
	IRaukkCalibrationInput,
	IRaukkCalibrationResidual,
	IRaukkCalibrationResult,
	IRaukkObservedFlight,
} from "@/features/raukk_sourcing/calculations/shippingCalibration";
import {
	IRaukkShipHull,
	IRaukkTimeCalibration,
} from "@/features/raukk_sourcing/calculations/shipping.types";

function system(
	naturalId: string,
	position: [number, number, number],
	connections: string[]
): IRaukkSystemNode {
	return {
		SystemId: `sys-${naturalId}`,
		NaturalId: naturalId,
		Connections: connections.map((element) => ({
			ConnectingId: `sys-${element}`,
		})),
		PositionX: position[0],
		PositionY: position[1],
		PositionZ: position[2],
	};
}

/**
 * Fixture map of the reference flight: one jump of exactly four parsecs
 * between CA-001 and CA-002, plus a second system pair four parsecs
 * further out for the multi jump cases.
 */
const PARSEC: number = RAUKK_POSITION_UNITS_PER_PARSEC;

const graph: IRaukkSystemNode[] = [
	system("CA-001", [0, 0, 0], ["CA-002"]),
	system("CA-002", [4 * PARSEC, 0, 0], ["CA-003"]),
	system("CA-003", [10 * PARSEC, 0, 0], []),
	system("CA-004", [0, 0, 100 * PARSEC], []),
];

const routes: IRaukkRouteDistance = createRouteDistance(graph);

/** Every system at the reference density, so nothing is normalized */
const flatData: IRaukkChainStaticData = createChainStaticData(
	{},
	{
		"sys-CA-001": 3.28,
		"sys-CA-002": 3.28,
		"sys-CA-003": 3.28,
	}
);

/** Twice the reference density on the whole path */
const denseData: IRaukkChainStaticData = createChainStaticData(
	{},
	{
		"sys-CA-001": 6.56,
		"sys-CA-002": 6.56,
	}
);

const hull: IRaukkShipHull = { cargoWeight: 3000, cargoVolume: 1000 };

const seed: IRaukkTimeCalibration = raukkNearestCalibration(hull, "standard");

/**
 * The two recorded runs of the reference flight, ANT to ZV-759c on a
 * 3000 t freighter, fuel MIN and reactor MIN (shipping-decisions.md,
 * round 2 item 5): run C empty and run B with 3000 t aboard.
 */
const emptyFlight: IRaukkObservedFlight = {
	originPlanetNaturalId: "CA-001a",
	destinationPlanetNaturalId: "CA-002b",
	cargoTons: 0,
	// 7h32m
	totalDurationMinutes: 452,
	stlFuelUsed: 72,
	ftlFuelUsed: 8,
	damagePercent: 0.088,
};

const loadedFlight: IRaukkObservedFlight = {
	originPlanetNaturalId: "CA-001a",
	destinationPlanetNaturalId: "CA-002b",
	cargoTons: 3000,
	// 15h18m
	totalDurationMinutes: 918,
	stlFuelUsed: 108,
	ftlFuelUsed: 8,
	damagePercent: 0.099,
};

function calibrate(
	empty: IRaukkObservedFlight = emptyFlight,
	loaded: IRaukkObservedFlight = loadedFlight,
	data: IRaukkChainStaticData = flatData,
	overrides: Partial<IRaukkCalibrationInput> = {}
): IRaukkCalibrationResult {
	return calibrateShipProfile({
		hull,
		ftlReactor: "standard",
		empty,
		loaded,
		routes,
		data,
		...overrides,
	});
}

function residual(
	result: IRaukkCalibrationResult,
	field: string
): IRaukkCalibrationResidual {
	const found: IRaukkCalibrationResidual | undefined = result.residuals.find(
		(entry) => entry.field === field
	);

	expect(found).toBeDefined();
	return found!;
}

describe("Raukk Sourcing: Shipping Calibration", () => {
	describe("geometry", () => {
		it("resolves both flights onto the map", () => {
			const result: IRaukkCalibrationResult = calibrate();

			expect(result.solved).toBe(true);
			expect(result.empty.parsecs).toBeCloseTo(4, 10);
			expect(result.empty.jumps).toBe(1);
			expect(result.empty.loadFactor).toBe(0);
			expect(result.loaded.loadFactor).toBe(1);
			expect(result.empty.pathMeanDensity).toBeCloseTo(3.28, 10);
			expect(result.empty.densityFactor).toBeCloseTo(1, 10);
		});

		it("clamps cargo beyond the hull and warns", () => {
			const result: IRaukkCalibrationResult = calibrate(emptyFlight, {
				...loadedFlight,
				cargoTons: 4500,
			});

			expect(result.loaded.loadFactor).toBe(1);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.cargoExceedsHull
			);
		});
	});

	describe("fuel", () => {
		it("recovers the FTL burn from both flights", () => {
			const result: IRaukkCalibrationResult = calibrate();

			// 8 units over 4 parsecs, and the load does not change it
			expect(result.constants.ftlFuelPerParsec).toBeCloseTo(2, 10);
			expect(
				residual(result, "ftlFuelPerParsec").estimates
			).toStrictEqual([2, 2]);
			expect(
				residual(result, "ftlFuelPerParsec").maxAbsoluteDeviation
			).toBe(0);
		});

		it("averages the block burn of both flights", () => {
			const result: IRaukkCalibrationResult = calibrate();

			// 72 empty and 108 loaded, the flat block charges the mean
			expect(result.constants.stlFuelPerBlock).toBe(90);
			expect(residual(result, "stlFuelPerBlock").estimates).toStrictEqual(
				[72, 108]
			);
			expect(
				residual(result, "stlFuelPerBlock").maxAbsoluteDeviation
			).toBe(18);
			expect(
				residual(result, "stlFuelPerBlock").maxRelativeDeviation
			).toBeCloseTo(0.2, 10);
		});

		it("makes a mistyped flight visible in the residual", () => {
			const result: IRaukkCalibrationResult = calibrate(emptyFlight, {
				...loadedFlight,
				// one digit too many
				ftlFuelUsed: 80,
			});

			expect(result.constants.ftlFuelPerParsec).toBeCloseTo(11, 10);
			expect(
				residual(result, "ftlFuelPerParsec").maxRelativeDeviation
			).toBeGreaterThan(0.8);
		});
	});

	describe("damage", () => {
		it("recovers the density normalized damage per parsec", () => {
			const result: IRaukkCalibrationResult = calibrate();

			/*
			 * 0.088% and 0.099% over 4 parsecs at the reference density,
			 * each MINUS the seeded sublight block of the meteoroid law:
			 * one block per flight, so what a jump costs is the remainder.
			 */
			const block: number = result.constants.damagePerStlBlock;

			expect(block).toBeCloseTo(
				(25_000_000 * (2.2e-10 + 5.5e-10 * 3.28)) / 100,
				12
			);
			expect(
				residual(result, "damagePerParsec").estimates[0]
			).toBeCloseTo((0.00088 - block) / 4, 12);
			expect(result.constants.damagePerParsec).toBeCloseTo(
				((0.00088 - block) / 4 + (0.00099 - block) / 4) / 2,
				12
			);
			expect(result.warnings).toContain("damage-per-stl-block-seeded");
		});

		it("takes a caller supplied block damage over the law", () => {
			const result: IRaukkCalibrationResult = calibrate(
				emptyFlight,
				loadedFlight,
				undefined,
				{ damagePerStlBlock: 0 }
			);

			expect(result.constants.damagePerStlBlock).toBe(0);
			expect(result.constants.damagePerParsec).toBeCloseTo(
				(0.00088 / 4 + 0.00099 / 4) / 2,
				12
			);
		});

		it("floors the jump term when the block alone explains it", () => {
			const result: IRaukkCalibrationResult = calibrate(
				{ ...emptyFlight, damagePercent: 0.001 },
				{ ...loadedFlight, damagePercent: 0.001 }
			);

			expect(result.constants.damagePerParsec).toBe(0);
			expect(result.warnings).toContain("damage-below-block-seed");
		});

		it("halves the rate on a path of twice the density", () => {
			const flat: IRaukkCalibrationResult = calibrate();
			const dense: IRaukkCalibrationResult = calibrate(
				emptyFlight,
				loadedFlight,
				denseData
			);

			expect(dense.empty.densityFactor).toBeCloseTo(2, 10);
			expect(dense.constants.damagePerParsec).toBeCloseTo(
				flat.constants.damagePerParsec / 2,
				12
			);
		});

		it("leaves the rate un-normalized without any density", () => {
			const result: IRaukkCalibrationResult = calibrate(
				emptyFlight,
				loadedFlight,
				createChainStaticData({}, {})
			);

			expect(result.empty.pathMeanDensity).toBeNull();
			expect(result.empty.densityFactor).toBe(1);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.unknownDensity
			);
		});
	});

	describe("time", () => {
		it("solves the speed from the empty flight", () => {
			const result: IRaukkCalibrationResult = calibrate();

			// (452 min − 1 charge − the seeded empty block) / 4 parsecs
			expect(result.constants.chargeMinutes).toBe(seed.chargeMinutes);
			expect(result.constants.stlBlockMinutesEmpty).toBe(
				seed.stlBlockMinutesEmpty
			);
			expect(result.constants.minutesPerParsec).toBeCloseTo(
				(452 - seed.chargeMinutes - seed.stlBlockMinutesEmpty) / 4,
				10
			);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.chargeMinutesSeeded
			);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.stlBlockMinutesEmptySeeded
			);
		});

		it("solves the loaded block from the second flight", () => {
			const result: IRaukkCalibrationResult = calibrate();

			// same lane, so the whole extra duration is block time and
			// the seeded speed cancels out entirely
			expect(result.constants.stlBlockMinutesLoaded).toBeCloseTo(
				seed.stlBlockMinutesEmpty + (918 - 452),
				10
			);
		});

		it("scales a half loaded flight up to the full hull", () => {
			const result: IRaukkCalibrationResult = calibrate(emptyFlight, {
				...loadedFlight,
				cargoTons: 1500,
			});

			expect(result.constants.stlBlockMinutesLoaded).toBeCloseTo(
				seed.stlBlockMinutesEmpty + 2 * (918 - 452),
				10
			);
		});

		it("takes a measured charge time over the reactor seed", () => {
			const result: IRaukkCalibrationResult = calibrateShipProfile({
				hull,
				ftlReactor: "standard",
				empty: emptyFlight,
				loaded: loadedFlight,
				routes,
				data: flatData,
				chargeMinutes: 10,
			});

			expect(result.constants.chargeMinutes).toBe(10);
			expect(result.constants.minutesPerParsec).toBeCloseTo(
				(452 - 10 - seed.stlBlockMinutesEmpty) / 4,
				10
			);
		});

		it("warns when a flight is too short for the model", () => {
			const result: IRaukkCalibrationResult = calibrate({
				...emptyFlight,
				totalDurationMinutes: 10,
			});

			expect(result.constants.minutesPerParsec).toBeLessThan(0);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.negativeSolvedTime
			);
		});

		it("cannot scale a loaded flight that carries nothing", () => {
			const result: IRaukkCalibrationResult = calibrate(emptyFlight, {
				...loadedFlight,
				cargoTons: 0,
			});

			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.loadedFlightEmpty
			);
			expect(result.constants.stlBlockMinutesLoaded).toBe(
				seed.stlBlockMinutesLoaded
			);
		});
	});

	describe("rejected flights", () => {
		it("rejects a calibration path inside one system", () => {
			const result: IRaukkCalibrationResult = calibrate(
				{ ...emptyFlight, destinationPlanetNaturalId: "CA-001c" },
				{ ...loadedFlight, destinationPlanetNaturalId: "CA-001c" }
			);

			expect(result.solved).toBe(false);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.sameSystemRoute
			);
			expect(result.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.notSolvable
			);
			// the seed is returned untouched, nothing is invented
			expect(result.constants.minutesPerParsec).toBe(
				seed.minutesPerParsec
			);
			expect(result.constants.ftlFuelPerParsec).toBe(
				seed.ftlFuelPerParsec
			);
		});

		it("rejects an unknown or unreachable planet", () => {
			const unknown: IRaukkCalibrationResult = calibrate(
				{ ...emptyFlight, originPlanetNaturalId: "ZZ-999a" },
				{ ...loadedFlight, originPlanetNaturalId: "ZZ-999a" }
			);
			const unreachable: IRaukkCalibrationResult = calibrate(
				{ ...emptyFlight, destinationPlanetNaturalId: "CA-004a" },
				{ ...loadedFlight, destinationPlanetNaturalId: "CA-004a" }
			);

			expect(unknown.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.unresolvedRoute
			);
			expect(unknown.solved).toBe(false);
			expect(unreachable.warnings).toContain(
				RAUKK_CALIBRATION_WARNINGS.unresolvedRoute
			);
			expect(unreachable.solved).toBe(false);
		});

		it("still solves from the one flight that is usable", () => {
			const result: IRaukkCalibrationResult = calibrate(emptyFlight, {
				...loadedFlight,
				destinationPlanetNaturalId: "CA-001c",
			});

			expect(result.solved).toBe(true);
			// only the empty flight constrains anything now
			expect(
				residual(result, "ftlFuelPerParsec").estimates
			).toStrictEqual([2]);
			expect(result.constants.stlFuelPerBlock).toBe(72);
			expect(result.constants.stlBlockMinutesLoaded).toBe(
				seed.stlBlockMinutesLoaded
			);
		});
	});

	describe("multi jump lanes", () => {
		it("counts every jump of the flown path", () => {
			const result: IRaukkCalibrationResult = calibrate(
				{ ...emptyFlight, destinationPlanetNaturalId: "CA-003a" },
				{ ...loadedFlight, destinationPlanetNaturalId: "CA-003a" }
			);

			expect(result.empty.parsecs).toBeCloseTo(10, 10);
			expect(result.empty.jumps).toBe(2);
			expect(result.constants.ftlFuelPerParsec).toBeCloseTo(0.8, 10);
			expect(result.constants.minutesPerParsec).toBeCloseTo(
				(452 - 2 * seed.chargeMinutes - seed.stlBlockMinutesEmpty) / 10,
				10
			);
		});
	});
});
