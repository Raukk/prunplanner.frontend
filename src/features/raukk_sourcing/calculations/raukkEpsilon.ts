// Comparison tolerances of the raukk sourcing tool.
// Everything Raukk-side displays at two decimals, so a difference the
// user cannot even read must never flip a verdict or cascade staleness.
//
// EQUALITY and SETTLE comparisons are HYBRID — an absolute floor plus a
// relative term, see {@link raukkEqualWithin}. One sided VERDICT
// thresholds (recommendDrop, the mutual lane verdict, the fleet over
// flag, the LM saving sign, the HCB promotion boundary) stay purely
// absolute: those are thresholds, not equality tests.

/**
 * Relative share of the larger magnitude two values may differ by and
 * still count as the same.
 *
 * A millionth: far below anything the two decimal display can show at
 * any magnitude, and exactly the relative tolerance the comparisons used
 * before the absolute epsilons landed.
 *
 * @author raukk
 */
export const RAUKK_EPSILON_RELATIVE: number = 1e-6;

/**
 * ABSOLUTE floor below which two displayed values count as the SAME.
 *
 * Two decimals is what the tool renders, so anything under a hundredth
 * is invisible: sub-cent snapshot changes leave downstream plans
 * current, and a hair-width difference no longer decides a comparison.
 *
 * It is a FLOOR, not the whole rule: {@link raukkEqualWithin} widens it
 * by {@link RAUKK_EPSILON_RELATIVE} of the larger magnitude. A pure
 * absolute hundredth is tighter than the relative tolerance it replaced
 * as soon as the numbers pass ten thousand — a 50,000 units/day draw
 * used to carry a ~0.05 deadband — so large plans would cascade
 * staleness on noise the display cannot show either.
 *
 * @author raukk
 */
export const RAUKK_EPSILON_EQUAL: number = 0.01;

/**
 * ABSOLUTE floor below which a recomputed loop value counts as SETTLED.
 *
 * Five hundredths, deliberately looser than {@link RAUKK_EPSILON_EQUAL}:
 * a settled recomputation must also count as materially unchanged, or a
 * solved supply loop would re-flag the rest of the loop stale and the
 * loop never shows current.
 *
 * Hybrid on the same terms as the equality floor, see
 * {@link raukkSettledWithin}: the looser floor must stay looser at every
 * magnitude, which it does — both grow by the same relative term.
 *
 * @author raukk
 */
export const RAUKK_EPSILON_SETTLE: number = 0.05;

/**
 * Tolerance of one hybrid comparison: the absolute floor, or the
 * relative share of the larger magnitude when that is wider.
 *
 * @author raukk
 *
 * @param {number} first One value
 * @param {number} second The other value
 * @param {number} absolute Absolute floor of the comparison
 * @returns {number} Tolerance the difference is measured against
 */
export function raukkToleranceOf(
	first: number,
	second: number,
	absolute: number
): number {
	return Math.max(
		absolute,
		RAUKK_EPSILON_RELATIVE * Math.max(Math.abs(first), Math.abs(second))
	);
}

/**
 * Whether two values count as the SAME number.
 *
 * Hybrid: `|a − b| <= max(RAUKK_EPSILON_EQUAL, RAUKK_EPSILON_RELATIVE ×
 * max(|a|, |b|))`. The absolute floor answers the small numbers — a
 * hundredth is what the display resolves — and the relative term answers
 * the large ones, where a hundredth is far below the precision anything
 * upstream actually carries and would flag noise as a change.
 *
 * The boundary is INCLUSIVE: a difference of exactly the tolerance is
 * still the same number.
 *
 * @author raukk
 *
 * @param {number} first One value
 * @param {number} second The other value
 * @returns {boolean} The two are the same number
 */
export function raukkEqualWithin(first: number, second: number): boolean {
	return (
		Math.abs(first - second) <=
		raukkToleranceOf(first, second, RAUKK_EPSILON_EQUAL)
	);
}

/**
 * Whether a value has SETTLED between two computations.
 *
 * The tolerance a loop solve is verified at: the same hybrid rule as
 * {@link raukkEqualWithin} over the looser {@link RAUKK_EPSILON_SETTLE}
 * floor, so a settled value always also counts as materially unchanged —
 * at every magnitude, since both tolerances share the relative term.
 *
 * @author raukk
 *
 * @param {number} previous Value of the previous computation
 * @param {number} next Value of the current computation
 * @returns {boolean} The value settled
 */
export function raukkSettledWithin(previous: number, next: number): boolean {
	return (
		Math.abs(next - previous) <=
		raukkToleranceOf(previous, next, RAUKK_EPSILON_SETTLE)
	);
}
