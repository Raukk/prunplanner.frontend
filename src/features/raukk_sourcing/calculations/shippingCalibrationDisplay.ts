// Display side of the calibration flow: which fields the observed
// flights actually determined, which ones the blueprint seeded, which
// ones stayed at the reference, and how a solver warning code becomes a
// translatable message.
// The order is blueprint seed → BTF flights refine → manual override
// wins. Pure functions, no store and no Vue.

// Types & Interfaces
import { IRaukkBlueprintSeed } from "@/features/raukk_sourcing/calculations/shippingBlueprint";
import {
	IRaukkCalibrationConstants,
	IRaukkCalibrationResidual,
	IRaukkCalibrationResult,
} from "@/features/raukk_sourcing/calculations/shippingCalibration";

/** Where one calibrated constant came from */
export type RAUKK_CALIBRATION_SOURCE = "flight" | "blueprint" | "reference";

/** One constant of a finished calibration, as the result table shows it */
export interface IRaukkCalibrationRow {
	field: keyof IRaukkCalibrationConstants;
	value: number;
	/** What the profile holds today, for the before/after column */
	previous: number;
	source: RAUKK_CALIBRATION_SOURCE;
	/** Largest absolute distance of an estimate from the adopted mean */
	spread: number | null;
	/** The same, relative to the mean */
	relativeSpread: number | null;
	/** Estimates the value was averaged from, empty when unsolved */
	estimates: number[];
}

/** A calibration merged out of the blueprint seed and the flights */
export interface IRaukkMergedCalibration {
	constants: IRaukkCalibrationConstants;
	sources: Record<string, RAUKK_CALIBRATION_SOURCE>;
}

/**
 * Solver warning codes mapped to the i18n key that words them.
 *
 * The solver is pure and emits codes; the wording lives in
 * `raukk_sourcing.json` under `fleet.calibration.warnings`.
 *
 * @author raukk
 */
export const RAUKK_CALIBRATION_WARNING_KEYS: Record<string, string> = {
	"unresolved-route": "unresolved_route",
	"same-system-route": "same_system_route",
	"not-solvable": "not_solvable",
	"charge-minutes-seeded": "charge_minutes_seeded",
	"stl-block-minutes-empty-seeded": "stl_block_minutes_empty_seeded",
	"damage-per-stl-block-seeded": "damage_per_stl_block_seeded",
	"damage-below-block-seed": "damage_below_block_seed",
	"loaded-flight-empty": "loaded_flight_empty",
	"cargo-exceeds-hull": "cargo_exceeds_hull",
	"negative-solved-time": "negative_solved_time",
	"unknown-density": "unknown_density",
};

/**
 * The constants the two flights genuinely determined.
 *
 * The FTL burn, the block burn and the damage rate are constrained by
 * every usable flight; the jump speed needs the empty one and the
 * loaded block time needs a flight that actually carries cargo. Anything
 * outside this list is a seed, however plausible it looks in the table.
 *
 * @author raukk
 *
 * @param {IRaukkCalibrationResult} result Solver result
 * @returns {string[]} Field names the flights solved
 */
export function raukkSolvedCalibrationFields(
	result: IRaukkCalibrationResult
): string[] {
	if (!result.solved) return [];

	const fields: string[] = [
		"ftlFuelPerParsec",
		"stlFuelPerBlock",
		"damagePerParsec",
	];

	if (result.empty.usable) fields.push("minutesPerParsec");

	if (result.loaded.usable && result.loaded.loadFactor > 0)
		fields.push("stlBlockMinutesLoaded");

	return fields;
}

/**
 * Blueprint seed and flight solution, merged in the documented order.
 *
 * A flight beats the blueprint wherever it constrains something at all;
 * everywhere else the blueprint's own Performance numbers beat the
 * reference flight of a different ship, which is the whole point of
 * seeding. What neither could state stays at the reference and is
 * labelled as such rather than presented as a measurement.
 *
 * @author raukk
 *
 * @param {IRaukkCalibrationResult} result Solver result
 * @param {IRaukkBlueprintSeed | null} seed Blueprint seed, null if none
 * @returns {IRaukkMergedCalibration} Constants and their provenance
 */
export function raukkMergeCalibration(
	result: IRaukkCalibrationResult,
	seed: IRaukkBlueprintSeed | null
): IRaukkMergedCalibration {
	const solved: string[] = raukkSolvedCalibrationFields(result);
	const constants: IRaukkCalibrationConstants = { ...result.constants };
	const sources: Record<string, RAUKK_CALIBRATION_SOURCE> = {};

	(Object.keys(constants) as (keyof IRaukkCalibrationConstants)[]).forEach(
		(field) => {
			sources[field] = solved.includes(field) ? "flight" : "reference";
		}
	);

	if (seed === null) return { constants, sources };

	seed.seededFields.forEach((field) => {
		if (solved.includes(field)) return;

		constants[field as keyof IRaukkCalibrationConstants] = seed[
			field as keyof IRaukkBlueprintSeed
		] as number;
		sources[field] = "blueprint";
	});

	return { constants, sources };
}

/**
 * One row per calibrated constant, with the residual spread attached.
 *
 * The spread is what makes a mistyped flight visible: a field whose two
 * estimates disagree by half is not a calibration, it is a typo.
 *
 * @author raukk
 *
 * @param {IRaukkMergedCalibration} merged Merged calibration
 * @param {IRaukkCalibrationResidual[]} residuals Solver residuals
 * @param {Partial<IRaukkCalibrationConstants>} previous Profile today
 * @returns {IRaukkCalibrationRow[]} Result rows
 */
export function raukkCalibrationRows(
	merged: IRaukkMergedCalibration,
	residuals: IRaukkCalibrationResidual[],
	previous: Partial<IRaukkCalibrationConstants>
): IRaukkCalibrationRow[] {
	const byField: Map<string, IRaukkCalibrationResidual> = new Map(
		residuals.map((residual) => [residual.field, residual])
	);

	return (
		Object.keys(merged.constants) as (keyof IRaukkCalibrationConstants)[]
	).map((field) => {
		const residual: IRaukkCalibrationResidual | undefined = byField.get(
			field as string
		);
		const solved: boolean = merged.sources[field] === "flight";

		return {
			field,
			value: merged.constants[field],
			previous: previous[field] ?? 0,
			source: merged.sources[field] ?? "reference",
			spread: residual && solved ? residual.maxAbsoluteDeviation : null,
			relativeSpread:
				residual && solved ? residual.maxRelativeDeviation : null,
			estimates: residual && solved ? residual.estimates : [],
		};
	});
}
