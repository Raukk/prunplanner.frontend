// Absolute comparison tolerances of the raukk sourcing tool.
// See docs/raukk_sourcing/shipping-cadence-plan.md, "Phase 0a —
// absolute tolerances": everything Raukk-side displays at two decimals,
// so a difference the user cannot even read must never flip a verdict
// or cascade staleness. Both constants are ABSOLUTE — ȼ, units or
// trips — never relative to a magnitude.

/**
 * Difference below which two displayed values count as the SAME.
 *
 * Two decimals is what the tool renders, so anything under a hundredth
 * is invisible: sub-cent snapshot changes leave downstream plans
 * current, and a hair-width difference no longer decides a comparison.
 *
 * @author raukk
 */
export const RAUKK_EPSILON_EQUAL: number = 0.01;

/**
 * Difference below which an iterating loop counts as SETTLED.
 *
 * Five hundredths, deliberately looser than {@link RAUKK_EPSILON_EQUAL}:
 * a settled pass must also count as materially unchanged, or the final
 * pass of a settled supply loop would re-flag the rest of the loop
 * stale and the loop never shows current.
 *
 * @author raukk
 */
export const RAUKK_EPSILON_SETTLE: number = 0.05;
