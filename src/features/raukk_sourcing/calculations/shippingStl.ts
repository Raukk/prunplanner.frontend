// STL-only ships: which legs they may fly, and what a gate served leg
// costs them. See docs/raukk_sourcing/shipping-calibration.md section 4
// for the gate constants and shipping-decisions.md for the model itself.
//
// An STL-only hull carries neither FTL drive nor reactor — roughly a
// quarter cheaper to build — and can therefore only reach another system
// through a GATE. A leg it has no gate route for is a VALIDATION ERROR,
// never a quiet fallback onto the FTL network: the ship physically
// cannot fly it, and pricing it as if it could would hide the mistake
// inside a freight rate.
//
// Pure functions over plain numbers, in the style of the rest of the
// calculation layer: no store, no Vue, no price fetching.

// Types & Interfaces
import {
	IRaukkMultiModalPath,
	IRaukkRouteDistance,
	IRaukkRouteHop,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkHullCandidate,
	IRaukkResolvedShipProfile,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * Why a leg cannot be flown.
 *
 * `unresolved` is what the chain model has always flagged — a stop, a
 * system or a path that does not resolve. `stl-only-no-gate` is the new
 * one: everything resolves, the route simply is not one an STL-only
 * hull can take.
 *
 * @author raukk
 */
export type RAUKK_LEG_UNROUTABLE = "unresolved" | "stl-only-no-gate";

/**
 * What one gate served leg costs and takes, gate terms only.
 *
 * The planet↔gate sublight portions are NOT in here: the surrounding
 * model already charges one STL block per leg (`stlBlockCost` and
 * {@link stlBlockMinutes}), and a gate drops the ship in the
 * destination orbit, so that single block is exactly the planet↔gate
 * flying an STL-only ship does on top of the traversals.
 *
 * @author raukk
 */
export interface IRaukkGateLegCost {
	/** Gate traversals of the leg */
	hops: number;
	/** ȼ of gate fees, charged at LOCK by the origin side gate */
	fees: number;
	/** STL fuel units of the traversal overheads */
	fuelUnits: number;
	/** ȼ of that fuel at the profiles own STL fuel pricing */
	fuelCost: number;
	/** Minutes of the traversals, one way */
	minutes: number;
	/** Hull damage of the traversals, as a fraction */
	damage: number;
}

/**
 * ȼ one STL fuel unit costs this profile.
 *
 * Derived from the profiles own resolved sublight block: `stlBlockCost`
 * is `stlFuelPerBlock` units at the current SF price, so dividing gives
 * that very price back — including a manual ȼ override, which is the
 * point. Nothing new is priced and no price ever reaches this layer.
 *
 * Zero when the profile burns nothing per block: a burn rate of zero
 * carries no price to recover, and inventing one would be worse than an
 * obvious zero.
 *
 * @author raukk
 *
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @returns {number} ȼ per STL fuel unit
 */
export function raukkStlFuelUnitCost(
	profile: IRaukkResolvedShipProfile
): number {
	if (profile.stlFuelPerBlock <= 0) return 0;

	return profile.stlBlockCost / profile.stlFuelPerBlock;
}

/**
 * The gate-only path of one inter-system leg, `null` when none exists.
 *
 * Nothing but gate edges is searched, so an FTL detour never sneaks in:
 * either the whole leg is gate servable or the ship cannot fly it. The
 * hulls own volume is passed to the search, which skips links that do
 * not admit it.
 *
 * Returns `null` as well when the lookups know no `fastestPath` at all —
 * the fixture graphs of the v1 tests and every implementation predating
 * gates. An unknown gate network is not a gate route.
 *
 * @author raukk
 *
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {string} fromSystemId Source system id
 * @param {string} toSystemId Target system id
 * @param {number} shipVolumeM3 Hull volume in m³, 0 skips the cap
 * @returns {(IRaukkMultiModalPath | null)} Gate path, null when none
 */
export function raukkGateOnlyPath(
	routes: IRaukkRouteDistance,
	fromSystemId: string,
	toSystemId: string,
	shipVolumeM3: number = 0
): IRaukkMultiModalPath | null {
	const found: IRaukkMultiModalPath | null | undefined = routes.fastestPath?.(
		fromSystemId,
		toSystemId,
		{ useGates: true, gatesOnly: true, shipVolumeM3 }
	);

	if (found === null || found === undefined) return null;

	// belt and braces: the search may not emit an FTL hop under
	// `gatesOnly`, and a path that did would be unflyable
	if (found.hops.some((hop: IRaukkRouteHop) => hop.kind !== "gate")) {
		return null;
	}

	return found;
}

/**
 * Prices the gate terms of one leg an STL-only ship flies.
 *
 * Exactly what shipping-calibration.md section 4 states and nothing
 * beyond it: one fee per traversal charged by the ORIGIN side gate,
 * 25 STL units of traversal overhead priced at the profiles own STL
 * fuel price, the traversal minutes the multi modal search already
 * timed, and a flat hull damage per traversal. Currencies trade ~1:1,
 * so a fee is taken at face value whatever it is denominated in.
 *
 * Hop damage arrives as a PERCENTAGE — 0.006 meaning 0.006% — while the
 * profiles damage constants are fractions, so it is divided by a hundred
 * here, once, where both meanings meet.
 *
 * @author raukk
 *
 * @param {IRaukkMultiModalPath} path Gate-only path of the leg
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @returns {IRaukkGateLegCost} Gate terms of the leg
 */
export function raukkGateLegCost(
	path: IRaukkMultiModalPath,
	profile: IRaukkResolvedShipProfile
): IRaukkGateLegCost {
	const unitCost: number = raukkStlFuelUnitCost(profile);

	const cost: IRaukkGateLegCost = {
		hops: 0,
		fees: 0,
		fuelUnits: 0,
		fuelCost: 0,
		minutes: 0,
		damage: 0,
	};

	path.hops.forEach((hop: IRaukkRouteHop) => {
		if (hop.kind !== "gate") return;

		cost.hops += 1;
		cost.fees += Math.max(hop.fee ?? 0, 0);
		cost.fuelUnits += Math.max(hop.stlFuel ?? 0, 0);
		cost.minutes += Math.max(hop.minutes, 0);
		cost.damage += Math.max(hop.damagePercent ?? 0, 0) / 100;
	});

	cost.fuelCost = cost.fuelUnits * unitCost;

	return cost;
}

/**
 * The hulls an automatic pick may choose from.
 *
 * STL-only hulls are excluded unless the caller has established that the
 * whole lane or loop is gate or same-system servable. The rule is
 * deliberately coarse — a hull that could serve some legs of a loop but
 * not others is not offered at all — because the automatic pick is a
 * suggestion, and a suggestion that produces a validation error is worse
 * than no suggestion. A MANUAL assignment is never filtered: the user
 * gets the error instead, which is the point of the error.
 *
 * @author raukk
 *
 * @param {IRaukkHullCandidate[]} candidates Hulls to choose from
 * @param {boolean} gateServable Whether every leg is gate servable
 * @returns {IRaukkHullCandidate[]} Hulls the pick may assign
 */
export function raukkStlOnlyCandidates(
	candidates: IRaukkHullCandidate[],
	gateServable: boolean
): IRaukkHullCandidate[] {
	if (gateServable) return candidates;

	return candidates.filter((candidate) => !candidate.profile.stlOnly);
}
