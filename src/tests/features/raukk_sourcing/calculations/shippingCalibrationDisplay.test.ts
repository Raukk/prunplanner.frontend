import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_CALIBRATION_WARNING_KEYS,
	raukkCalibrationRows,
	raukkMergeCalibration,
	raukkSolvedCalibrationFields,
} from "@/features/raukk_sourcing/calculations/shippingCalibrationDisplay";
import { RAUKK_CALIBRATION_WARNINGS } from "@/features/raukk_sourcing/calculations/shippingCalibration";

// Types & Interfaces
import {
	IRaukkCalibrationConstants,
	IRaukkCalibrationGeometry,
	IRaukkCalibrationResult,
} from "@/features/raukk_sourcing/calculations/shippingCalibration";
import { IRaukkBlueprintSeed } from "@/features/raukk_sourcing/calculations/shippingBlueprint";
import {
	IRaukkCalibrationRow,
	IRaukkMergedCalibration,
} from "@/features/raukk_sourcing/calculations/shippingCalibrationDisplay";

const CONSTANTS: IRaukkCalibrationConstants = {
	minutesPerParsec: 27.5,
	chargeMinutes: 1,
	stlBlockMinutesEmpty: 70,
	stlBlockMinutesLoaded: 420,
	ftlFuelPerParsec: 4,
	stlFuelPerBlock: 90,
	damagePerParsec: 0.0002,
	damagePerStlBlock: 0,
};

function geometry(
	usable: boolean,
	loadFactor: number = 0
): IRaukkCalibrationGeometry {
	return {
		parsecs: 4,
		jumps: 1,
		sameSystem: false,
		pathMeanDensity: 3.28,
		densityFactor: 1,
		loadFactor,
		usable,
	};
}

function result(
	overrides: Partial<IRaukkCalibrationResult> = {}
): IRaukkCalibrationResult {
	return {
		constants: { ...CONSTANTS },
		residuals: [
			{
				field: "ftlFuelPerParsec",
				estimates: [3.8, 4.2],
				mean: 4,
				maxAbsoluteDeviation: 0.2,
				maxRelativeDeviation: 0.05,
			},
		],
		warnings: [],
		empty: geometry(true),
		loaded: geometry(true, 1),
		solved: true,
		...overrides,
	};
}

const SEED: IRaukkBlueprintSeed = {
	minutesPerParsec: 24,
	stlBlockMinutesEmpty: 55,
	stlBlockMinutesLoaded: 110,
	stlFuelPerBlock: 37,
	seededFields: [
		"minutesPerParsec",
		"stlBlockMinutesEmpty",
		"stlBlockMinutesLoaded",
		"stlFuelPerBlock",
	],
	missing: [],
};

describe("Raukk Shipping: Calibration Display", () => {
	describe("raukkSolvedCalibrationFields", () => {
		it("lists everything two usable flights constrain", () => {
			expect(raukkSolvedCalibrationFields(result()).sort()).toEqual(
				[
					"damagePerParsec",
					"ftlFuelPerParsec",
					"minutesPerParsec",
					"stlBlockMinutesLoaded",
					"stlFuelPerBlock",
				].sort()
			);
		});

		it("drops the jump speed without a usable empty flight", () => {
			expect(
				raukkSolvedCalibrationFields(result({ empty: geometry(false) }))
			).not.toContain("minutesPerParsec");
		});

		it("drops the loaded block when the loaded flight carries nothing", () => {
			expect(
				raukkSolvedCalibrationFields(
					result({ loaded: geometry(true, 0) })
				)
			).not.toContain("stlBlockMinutesLoaded");
		});

		it("solves nothing at all when the solver gave up", () => {
			expect(
				raukkSolvedCalibrationFields(result({ solved: false }))
			).toHaveLength(0);
		});
	});

	describe("raukkMergeCalibration", () => {
		it("lets a flight beat the blueprint wherever it measured", () => {
			const merged: IRaukkMergedCalibration = raukkMergeCalibration(
				result(),
				SEED
			);

			expect(merged.constants.minutesPerParsec).toBe(27.5);
			expect(merged.sources.minutesPerParsec).toBe("flight");
			expect(merged.constants.stlFuelPerBlock).toBe(90);
		});

		it("lets the blueprint beat the reference where no flight spoke", () => {
			const merged: IRaukkMergedCalibration = raukkMergeCalibration(
				result(),
				SEED
			);

			expect(merged.constants.stlBlockMinutesEmpty).toBe(55);
			expect(merged.sources.stlBlockMinutesEmpty).toBe("blueprint");
		});

		it("falls back to the whole blueprint seed on an unsolved run", () => {
			const merged: IRaukkMergedCalibration = raukkMergeCalibration(
				result({ solved: false }),
				SEED
			);

			expect(merged.constants.minutesPerParsec).toBe(24);
			expect(merged.sources.minutesPerParsec).toBe("blueprint");
			expect(merged.sources.chargeMinutes).toBe("reference");
		});

		it("labels everything a reference without a blueprint seed", () => {
			const merged: IRaukkMergedCalibration = raukkMergeCalibration(
				result({ solved: false }),
				null
			);

			expect(merged.constants).toEqual(CONSTANTS);
			expect(
				Object.values(merged.sources).every(
					(source) => source === "reference"
				)
			).toBe(true);
		});
	});

	describe("raukkCalibrationRows", () => {
		it("attaches the residual spread only to solved fields", () => {
			const merged: IRaukkMergedCalibration = raukkMergeCalibration(
				result(),
				SEED
			);

			const rows: IRaukkCalibrationRow[] = raukkCalibrationRows(
				merged,
				result().residuals,
				{ ...CONSTANTS, ftlFuelPerParsec: 3 }
			);

			const ftl: IRaukkCalibrationRow = rows.find(
				(row) => row.field === "ftlFuelPerParsec"
			)!;

			expect(ftl.previous).toBe(3);
			expect(ftl.source).toBe("flight");
			expect(ftl.relativeSpread).toBeCloseTo(0.05);
			expect(ftl.estimates).toEqual([3.8, 4.2]);

			const block: IRaukkCalibrationRow = rows.find(
				(row) => row.field === "stlBlockMinutesEmpty"
			)!;

			expect(block.spread).toBeNull();
			expect(block.source).toBe("blueprint");
		});

		it("covers every constant, in the constants' own order", () => {
			const rows: IRaukkCalibrationRow[] = raukkCalibrationRows(
				raukkMergeCalibration(result(), null),
				[],
				{}
			);

			expect(rows).toHaveLength(Object.keys(CONSTANTS).length);
			expect(rows.every((row) => row.previous === 0)).toBe(true);
		});
	});

	describe("RAUKK_CALIBRATION_WARNING_KEYS", () => {
		it("words every code the solver can raise", () => {
			Object.values(RAUKK_CALIBRATION_WARNINGS).forEach((code) => {
				expect(RAUKK_CALIBRATION_WARNING_KEYS[code]).toBeDefined();
			});
		});
	});
});
