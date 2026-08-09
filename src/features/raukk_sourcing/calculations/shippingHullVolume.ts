// Ship HULL volume: how big the ship itself is, which is what a gate
// measures when it decides whether the ship fits through.
//
// This is NOT the cargo hold's volume capacity, and the two are easy to
// confuse because both are quoted in m³ and the cargo figure is the one
// every other part of the shipping model cares about. The in-game
// blueprint screen states them separately — "SHIP OVERVIEW → VOLUME"
// against "CARGO → VOLUME CAPACITY" — and the gateway panel's "Max. ship
// volume" clearance is compared against the former.
//
// THE MODEL is a delta off a reference ship rather than a sum of part
// volumes: a fixed 963 m³ baseline, plus a signed delta for each module
// that differs from the reference fit. Sources, which agree with each
// other and with the user's own blueprints:
//
// - DryDock (https://drydock.cc, github.com/Zillatron27/drydock), whose
//   volume model is regression tested against 24 in-game blueprint
//   screenshots and 561 real blueprint combinations from PUNoted.
// - The PCT community wiki (https://pct.fnar.net/ship-blueprints/),
//   which publishes ABSOLUTE component volumes. Its standard fit sums to
//   239 + 70 + 126 + 3 + 525 = 963, the same reference, independently.
// - The in-game handbook and dev log #459 for the gateway side: "A
//   standard gateway will allow ships up to 1500m³."
//
// Only the NUMBERS are taken from those sources; the implementation is
// this file's own.
//
// Pure functions over plain numbers, no store and no Vue.

// Types & Interfaces
import {
	IRaukkShipHull,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * Volume of the reference ship, m³: ENG, SSL, RCT, SFL, SCB, BHP.
 *
 * Every other fit is this plus the deltas of the modules it swapped.
 *
 * @author raukk
 */
export const RAUKK_HULL_VOLUME_REFERENCE: number = 963;

/**
 * Volume each cargo bay adds over the reference bay, m³, by its capacity.
 *
 * TCB, VSC, SCB, MCB and WCB, LCB, VCB, HCB — keyed by the capacity that
 * identifies them, since a ship profile knows a capacity and not a bay
 * name. WCB and MCB share the 1,000 m³ entry because they share a bay
 * volume; they differ in TONNAGE, which no gate measures.
 *
 * A table rather than a formula on purpose. The bays are roughly 1.05 m³
 * of ship per m³ of capacity against the 500 m³ reference bay, but only
 * roughly — five of the seven carry a further half unit that the closed
 * form misses, and half a unit is exactly the amount that decides a
 * `Math.floor` at a gate clearance boundary.
 *
 * @author raukk
 */
export const RAUKK_CARGO_BAY_VOLUME_DELTA: Record<number, number> = {
	100: -420.5,
	250: -263,
	500: 0,
	1000: 524.5,
	2000: 1575,
	3000: 2624.5,
	5000: 4724.5,
};

/**
 * Volume a cargo bay adds over the reference bay, m³.
 *
 * The published figure when the capacity names a real bay, and the
 * closed form `1.05 * capacity - 525` otherwise — so a bay the game adds
 * later is priced approximately rather than not at all. The fallback is
 * flagged nowhere because it cannot be: a caller cannot tell a real bay
 * from an invented capacity, and the profiles only ever carry real ones.
 *
 * @author raukk
 *
 * @param {number} cargoVolume Cargo capacity, m³
 * @returns {number} Volume delta, m³
 */
export function raukkCargoBayVolumeDelta(cargoVolume: number): number {
	const capacity: number = Math.max(cargoVolume, 0);

	return RAUKK_CARGO_BAY_VOLUME_DELTA[capacity] ?? 1.05 * capacity - 525;
}

/**
 * Volume deltas of the modules a ship profile does NOT model, m³.
 *
 * This application's ship profiles carry a cargo hold and an FTL reactor
 * flag and nothing else — no STL engine, no fuel tanks — so the rest of
 * the fit has to be assumed. These are DryDock's default preset and the
 * commonest hauler build, and they are exactly the fit the user's own six
 * blueprints turned out to have.
 *
 * The assumption is worth stating loudly because it MOVES ACROSS GATE
 * TIERS: a large sublight tank (LSL) instead of the medium one adds
 * 284 m³, which is enough on its own to push a hull over a clearance it
 * would otherwise have cleared. A user whose ships carry big tanks
 * should read the volume off their own blueprint and set
 * {@link IRaukkShipHull.hullVolumeM3}, which always wins over this.
 *
 * @author raukk
 */
export const RAUKK_HULL_VOLUME_ASSUMED = {
	/** FSE, the fuel saving sublight engine */
	stlEngine: -1,
	/** MSL, the medium sublight tank */
	stlTank: 126,
	/** LFL, the large FTL tank */
	ftlTank: 17.5,
} as const;

/**
 * Volume delta of the FTL reactor, m³, by the flag profiles carry.
 *
 * RCT is the reference and adds nothing; QCR, the quick charge reactor,
 * adds 7. The high and hyper power reactors (+117.5, +127.5) are not
 * modelled because no profile can express them.
 *
 * @author raukk
 */
export const RAUKK_HULL_VOLUME_REACTOR: Record<RAUKK_FTL_REACTOR, number> = {
	standard: 0,
	"quick-charge": 7,
};

/**
 * Volume a hull SHEDS by carrying no FTL drive at all, m³.
 *
 * The reactor and the FTL tank come out together — 126 + 3 of absolute
 * volume — and the game removes a further fixed amount with them.
 *
 * @author raukk
 */
export const RAUKK_HULL_VOLUME_NO_FTL: number = -129;

/**
 * Volume of a ship, m³, as the blueprint screen would state it.
 *
 * A stored {@link IRaukkShipHull.hullVolumeM3} always wins: it is the
 * figure the user read off their own ship, and no derivation beats
 * being told. Absent, the fit is derived from the cargo hold, the
 * reactor flag and the assumed modules of
 * {@link RAUKK_HULL_VOLUME_ASSUMED}.
 *
 * Floored, as the game floors it: the deltas carry halves, and a ship
 * that computes to 1,050.5 displays and behaves as 1,050.
 *
 * @author raukk
 *
 * @param {IRaukkShipHull} hull Cargo hold of the ship
 * @param {boolean} stlOnly Whether the hull carries no FTL drive
 * @param {RAUKK_FTL_REACTOR} ftlReactor Reactor fitted, ignored when STL
 * @returns {number} Ship volume, m³
 */
export function raukkHullVolumeM3(
	hull: IRaukkShipHull,
	stlOnly: boolean = false,
	ftlReactor: RAUKK_FTL_REACTOR = "quick-charge"
): number {
	if (
		hull.hullVolumeM3 !== undefined &&
		Number.isFinite(hull.hullVolumeM3) &&
		hull.hullVolumeM3 > 0
	)
		return hull.hullVolumeM3;

	let volume: number =
		RAUKK_HULL_VOLUME_REFERENCE +
		raukkCargoBayVolumeDelta(hull.cargoVolume) +
		RAUKK_HULL_VOLUME_ASSUMED.stlEngine +
		RAUKK_HULL_VOLUME_ASSUMED.stlTank;

	if (stlOnly) {
		volume += RAUKK_HULL_VOLUME_NO_FTL;
	} else {
		volume +=
			RAUKK_HULL_VOLUME_REACTOR[ftlReactor] +
			RAUKK_HULL_VOLUME_ASSUMED.ftlTank;
	}

	return Math.floor(volume);
}
