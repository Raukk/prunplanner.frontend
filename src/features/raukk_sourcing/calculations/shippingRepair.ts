// The ship repair bill, derived from what a hull is BUILT of.
// Sourced from docs/raukk_sourcing/repair_and_damage.json — the PrUn
// community repair calculator, whose formulas were read out of the sheet
// itself — and recorded in docs/raukk_sourcing/shipping-calibration.md
// §14. This replaces the four fixed quantities round 3 observed on one
// 3000 t hull, which shipping-calibration.md §6 flagged as owing a BOM
// derivation.
// Prices never appear here: quantities are all this module knows, and
// the caller resolves each ticker through the app's normal price
// resolver, which is fed from the API.
// Pure functions, no store and no Vue.

// Types & Interfaces
import { IRaukkShippingPriceResolver } from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * Damage share at which players repair their ships.
 *
 * TWENTY percent, which is the eighty percent CONDITION the in-game
 * repair screen and the community calculator both talk about — the two
 * readings of "repair at 80 %" are four times apart, and rounds 2 and 3
 * of shipping-decisions.md took the wrong one.
 *
 * The bill those rounds observed was right: `SSC 11` is exactly
 * `ceil(71 × 0.20 × 0.75)` for the 71 structural elements of the 3000 t
 * hull it was read off, which only works at a fifth of condition lost,
 * not four fifths. So the quantities stay and the divisor moves, and the
 * effect is that a trip's repair share is FOUR TIMES what the app
 * charged before.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_AT_DAMAGE: number = 0.2;

/**
 * Share of a component's count a repair consumes, per unit of damage.
 *
 * `count = ceil(componentCount × damage × 0.75 × factor)`. Verified on
 * the calculator's own worked examples: a 90 plate ship at 20 % damage
 * takes 14 plates, and a fully shielded one 8.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_HULL_SHARE: number = 0.75;

/**
 * The same share for a SHIELD rather than for the hull.
 *
 * A shield is replaced against a flat 0.662 where the hull plate is
 * replaced against the relief its shields give it — a shield takes the
 * damage instead of the plate, so it wears whether or not other shields
 * are fitted.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_SHIELD_SHARE: number = 0.662;

/**
 * How much of the HULL's repair each installed shield spares.
 *
 * Fitting an advanced whipple array means 15 % fewer plates and
 * structural elements to replace, because the array took that damage
 * itself. Distinct from the damage modifiers of
 * shipping-calibration.md §2.3, which reduce damage TAKEN; this is what
 * the repair afterwards costs.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_SHIELD_RELIEF: Record<string, number> = {
	BPT: 0.05,
	BWH: 0.05,
	BRP: 0.05,
	ARP: 0.1,
	APT: 0.15,
	AWH: 0.15,
	SRP: 0.15,
};

/**
 * Components every repair consumes whatever the ship and the damage.
 *
 * Flat in the calculator and flat in the round 3 observation, which is
 * the one thing the two agree on exactly.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_FIXED_UNITS: Record<string, number> = {
	MFK: 12,
	FLP: 8,
};

/** Hull plates a repair can consume, by their in-game ticker */
export const RAUKK_HULL_PLATE_TICKERS: string[] = [
	"BHP",
	"LHP",
	"RHP",
	"HHP",
	"AHP",
];

/**
 * Every ticker a repair bill can possibly contain.
 *
 * The price loaders take this rather than the tickers of one particular
 * bill: a user who fits a whipple array to one profile must not find the
 * array unpriced because no OTHER profile carries one.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_TICKERS: string[] = [
	...RAUKK_HULL_PLATE_TICKERS,
	...Object.keys(RAUKK_REPAIR_SHIELD_RELIEF),
	...Object.keys(RAUKK_REPAIR_FIXED_UNITS),
	"SSC",
];

/** What a repair needs to know about how a ship is built */
export interface IRaukkShipRepairBom {
	/** Hull plate ticker, e.g. `LHP` */
	hullPlate: string;
	/** Hull plates the design carries */
	hullPlateCount: number;
	/** Structural elements (SSC) the design carries */
	structuralElements: number;
	/** Shield tickers fitted, e.g. `["AWH", "APT"]` */
	shields: string[];
}

/**
 * The build every profile is repaired as until it says otherwise.
 *
 * The 3000 t weight hull round 3 read its bill off — 71 structural
 * elements, as batch 10's blueprint panel shows, and a plate count the
 * same, which is what reproduces that round's `LHP 11`. Lightweight
 * plate and no shielding, matching
 * {@link RAUKK_DEFAULT_G_FACTOR} and the campaign's damage baseline.
 *
 * The plate count is the one number here nothing derives yet: a real BOM
 * would give it, and shipping-calibration.md §2.3 has the component
 * table that would let a ship designer compute it.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_REPAIR_BOM: IRaukkShipRepairBom = {
	hullPlate: "LHP",
	hullPlateCount: 71,
	structuralElements: 71,
	shields: [],
};

/**
 * Relief the hull gets from the shields a design carries, 0 to 1.
 *
 * @author raukk
 *
 * @param {string[]} shields Shield tickers fitted
 * @returns {number} Factor the hull's own repair count is scaled by
 */
export function raukkRepairShieldRelief(shields: string[]): number {
	const relief: number = shields.reduce(
		(sum, ticker) => sum + (RAUKK_REPAIR_SHIELD_RELIEF[ticker] ?? 0),
		0
	);

	return Math.min(Math.max(1 - relief, 0), 1);
}

/**
 * Units of every ticker one repair consumes.
 *
 * `count = ceil(componentCount × damage × 0.75 × factor)` per component,
 * plus the flat {@link RAUKK_REPAIR_FIXED_UNITS}. A component the design
 * does not carry is absent rather than zero, so the bill reads as a
 * shopping list.
 *
 * @author raukk
 *
 * @param {IRaukkShipRepairBom} bom How the ship is built
 * @param {number} [damage] Damage repaired, a FRACTION
 * @returns {Record<string, number>} Units per ticker
 */
export function raukkRepairBill(
	bom: IRaukkShipRepairBom,
	damage: number = RAUKK_REPAIR_AT_DAMAGE
): Record<string, number> {
	const bill: Record<string, number> = {};

	if (damage <= 0) return { ...RAUKK_REPAIR_FIXED_UNITS };

	const relief: number = raukkRepairShieldRelief(bom.shields);

	/** Adds a component's units, skipping the ones that come to nothing */
	function add(ticker: string, count: number, factor: number): void {
		const units: number = Math.ceil(
			Math.max(count, 0) * damage * RAUKK_REPAIR_HULL_SHARE * factor
		);

		if (units > 0) bill[ticker] = (bill[ticker] ?? 0) + units;
	}

	add(bom.hullPlate, bom.hullPlateCount, relief);
	add("SSC", bom.structuralElements, relief);

	bom.shields.forEach((ticker) =>
		add(ticker, bom.hullPlateCount, RAUKK_REPAIR_SHIELD_SHARE)
	);

	return { ...bill, ...RAUKK_REPAIR_FIXED_UNITS };
}

/**
 * Prices one repair bill through the app's own resolver.
 *
 * No price is hardcoded anywhere in this module: every ticker goes
 * through the same resolver the rest of the shipping math prices fuel
 * with, which is fed from the API.
 *
 * @author raukk
 *
 * @param {Record<string, number>} bill Units per ticker
 * @param {IRaukkShippingPriceResolver} resolvePrice Unit price lookup
 * @returns {number} ȼ of the whole bill
 */
export function raukkRepairBillCost(
	bill: Record<string, number>,
	resolvePrice: IRaukkShippingPriceResolver
): number {
	return Object.entries(bill).reduce(
		(sum, [ticker, units]) => sum + units * resolvePrice(ticker),
		0
	);
}
