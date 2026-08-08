// Cargo bucket attribution: which CLASS of demand a shipped unit
// serves. See docs/raukk_sourcing/shipping-cadence-plan.md, "Phase 0b —
// per-ticker, per-bucket flow identity". The same two material I/O
// lists `buildInputRows` flags its input table rows from, read here as
// daily UNITS instead of booleans, because cadence caps are set per
// bucket and every shipped unit therefore has to name exactly one.
//
// Pure functions: the plan result arrives as plain data.

// Types & Interfaces
import {
	IRaukkBucketSource,
	IRaukkBucketUnits,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Daily input units of one ticker in one of the two material I/O lists */
function inputUnitsOf(
	rows: { ticker: string; input: number }[],
	ticker: string
): number {
	return rows.reduce(
		(sum, row) =>
			row.ticker === ticker ? sum + Math.max(row.input, 0) : sum,
		0
	);
}

/**
 * Splits the daily NET input of one ticker across its cargo buckets.
 *
 * `buildInputRows` already answers WHICH buckets a ticker belongs to,
 * from the very same two lists; a ticker consumed by production and by
 * the workforce at once belongs to both. Cargo needs units rather than
 * flags, so the net input — the material I/O delta, which nets outputs
 * against every consumer at once and cannot be attributed exactly — is
 * split in the ratio of the two gross demands. One sided demand keeps
 * its whole amount in one bucket, untouched by any arithmetic.
 *
 * A ticker neither list claims is `production`: that is the in/out
 * class, which is what everything not workforce or repair ships as.
 *
 * Repair materials never appear in the material I/O and therefore never
 * in this split — they are added by their own demand list, see
 * `buildInputRows`.
 *
 * @author raukk
 *
 * @param {string} ticker Material Ticker
 * @param {number} unitsPerDay Net daily input units
 * @param {IRaukkBucketSource} planResult Plan Result material I/O
 * @returns {IRaukkBucketUnits[]} Daily units per cargo bucket
 */
export function raukkSplitCargoBuckets(
	ticker: string,
	unitsPerDay: number,
	planResult: IRaukkBucketSource
): IRaukkBucketUnits[] {
	const workforce: number = inputUnitsOf(
		planResult.workforceMaterialIO,
		ticker
	);
	const production: number = inputUnitsOf(
		planResult.productionMaterialIO,
		ticker
	);

	if (workforce <= 0) return [{ bucket: "production", unitsPerDay }];
	if (production <= 0) return [{ bucket: "workforce", unitsPerDay }];

	const productionUnits: number =
		unitsPerDay * (production / (production + workforce));

	return [
		{ bucket: "production", unitsPerDay: productionUnits },
		{ bucket: "workforce", unitsPerDay: unitsPerDay - productionUnits },
	];
}
