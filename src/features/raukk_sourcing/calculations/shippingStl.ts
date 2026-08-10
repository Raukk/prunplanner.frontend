// STL-only ships: which legs they may fly, and what a gate served leg
// costs them.
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
	IRaukkRoute,
	IRaukkRouteDistance,
	IRaukkRouteHop,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";
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
 * Exactly what the gate calibration measured and nothing beyond it: one
 * fee per traversal charged by the ORIGIN side gate, 25 STL units of
 * traversal overhead priced at the profiles own STL fuel price, the
 * traversal minutes the multi modal search already timed, and a flat
 * hull damage per traversal. Currencies trade ~1:1, so a fee is taken
 * at face value whatever it is denominated in.
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
 * An STL-only hull has to clear TWO bars to be offered, and clears the
 * second one far less often:
 *
 *  1. `gateServable` — the whole lane or loop is gate or same-system
 *     servable. The rule is deliberately coarse — a hull that could
 *     serve some legs of a loop but not others is not offered at all —
 *     because the automatic pick is a suggestion, and a suggestion that
 *     produces a validation error is worse than no suggestion.
 *  2. `depotServed` — the lane or loop actually CALLS at a depot. An
 *     STL ship is based at one: it cannot jump out of the gate network
 *     it sits in, so a route that never touches its home is a route it
 *     could only reach by being flown there once and stranded. Since
 *     every leg of a gate-servable route is gate-connected, one depot
 *     among the stops puts the whole route inside that depots reach.
 *
 * Where it clears both, it does not merely COMPETE with the FTL hulls,
 * it takes the route: an STL-only hull can fly nothing but its gate
 * network and its own system, so the little work it is able to do is
 * work it must be given FIRST — an FTL hull holding a gate lane can be
 * moved to any other lane in the account, an STL hull denied one cannot.
 * The FTL hulls are therefore dropped from the choice entirely as soon
 * as one STL-only hull survives the two bars, and {@link raukkPickHull}
 * then picks the best STL hull for the cargo exactly as it always picks.
 *
 * A MANUAL assignment passes neither bar and is never filtered: a
 * deliberate STL run between two planets that share a gate is a real
 * thing to want, it is simply not something to guess at. Where such a
 * run is not flyable at all the user gets the validation error instead,
 * which is the point of the error.
 *
 * @author raukk
 *
 * @param {IRaukkHullCandidate[]} candidates Hulls to choose from
 * @param {boolean} gateServable Whether every leg is gate servable
 * @param {boolean} depotServed Whether a depot is among the stops
 * @returns {IRaukkHullCandidate[]} Hulls the pick may assign
 */
export function raukkStlOnlyCandidates(
	candidates: IRaukkHullCandidate[],
	gateServable: boolean,
	depotServed: boolean
): IRaukkHullCandidate[] {
	if (!gateServable || !depotServed)
		return candidates.filter((candidate) => !candidate.profile.stlOnly);

	const stlOnly: IRaukkHullCandidate[] = candidates.filter(
		(candidate) => candidate.profile.stlOnly
	);

	return stlOnly.length > 0 ? stlOnly : candidates;
}

/**
 * What the gate comparison needs to know about the hull flying it.
 *
 * @author raukk
 */
export interface IRaukkGateComparisonShip {
	/** SHIP volume in m³, gate links below it do not admit it */
	shipVolumeM3: number;
	/** Minutes per parsec of FTL flight, absent bars the comparison */
	minutesPerParsec?: number;
	/** Minutes the reactor takes to charge, per jump */
	chargeMinutes?: number;
}

/**
 * The gate route an FTL hull should fly a leg on, `null` when none.
 *
 * The whole question in one place: is there a path using at least one
 * gate that gets THIS hull from A to B sooner than the FTL network
 * alone? The multi modal search already answers it — one Dijkstra over
 * both edge sets on the minutes metric, so it will happily jump three
 * times, traverse a gate and jump twice more if that is the global
 * optimum, and it holds every link's clearance against the hull.
 *
 * Two guards, and both are load bearing:
 *
 * - `gateHops > 0`. Without a gate in it the search's answer is merely
 *   the FASTEST FTL path, which is not the SHORTEST one — many short
 *   jumps pay more reactor charges than one long jump. Adopting it would
 *   move the numbers of every user with no gate anywhere near them, for
 *   no reason at all. A leg with nothing to gain is left exactly as it
 *   was before gates could serve an FTL hull.
 * - it has to actually WIN, not tie. A ship can always ignore a gate.
 *
 * The hull's own speed is passed in, so a quick-charge hull is compared
 * on its own terms rather than a reference ship's. `edgeMinutes` times
 * an FTL hop as `(parsecs / ftlParsecsPerHour) * 60 + ftlJumpMinutes`,
 * which is identically the `minutesPerParsec` / `chargeMinutes` model
 * the leg costing uses — the two agree by construction, not by luck.
 *
 * @author raukk
 *
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {string} fromSystemId Source system id
 * @param {string} toSystemId Target system id
 * @param {IRaukkRoute} ftlRoute The FTL route it has to beat
 * @param {IRaukkGateComparisonShip} ship Hull flying it
 * @returns {(IRaukkMultiModalPath | null)} Faster gate path, or null
 */
export function raukkFasterGatePath(
	routes: IRaukkRouteDistance,
	fromSystemId: string,
	toSystemId: string,
	ftlRoute: IRaukkRoute,
	ship: IRaukkGateComparisonShip
): IRaukkMultiModalPath | null {
	if (
		ship.minutesPerParsec === undefined ||
		ship.minutesPerParsec <= 0 ||
		routes.fastestPath === undefined
	)
		return null;

	const chargeMinutes: number = ship.chargeMinutes ?? 0;

	const found: IRaukkMultiModalPath | null = routes.fastestPath(
		fromSystemId,
		toSystemId,
		{
			// the search states speed in parsecs per hour, a profile in
			// minutes per parsec: reciprocals
			ftlParsecsPerHour: 60 / ship.minutesPerParsec,
			ftlJumpMinutes: chargeMinutes,
			useGates: true,
			gatesOnly: false,
			shipVolumeM3: ship.shipVolumeM3,
		}
	);

	if (found === null || found.gateHops === 0) return null;

	const ftlOnlyMinutes: number =
		ftlRoute.parsecs * ship.minutesPerParsec +
		ftlRoute.jumps * chargeMinutes;

	return found.minutes < ftlOnlyMinutes - RAUKK_EPSILON_EQUAL ? found : null;
}

/**
 * Parsecs of the FTL hops of a path, gate hops excluded.
 *
 * The figure a per parsec rate — fuel, damage — may be multiplied by. A
 * gate hop covers distance without flying it, so it burns no FTL fuel
 * and takes no per parsec damage; it pays its own fee, sublight fuel and
 * flat damage instead, which {@link raukkGateLegCost} reports.
 *
 * @author raukk
 *
 * @param {IRaukkMultiModalPath} path Multi modal path
 * @returns {number} Parsecs flown under FTL
 */
export function raukkFtlParsecsOf(path: IRaukkMultiModalPath): number {
	return path.hops
		.filter((hop: IRaukkRouteHop) => hop.kind === "ftl")
		.reduce((sum: number, hop: IRaukkRouteHop) => sum + hop.parsecs, 0);
}

/**
 * FTL jumps of a path, gate hops excluded.
 *
 * @author raukk
 *
 * @param {IRaukkMultiModalPath} path Multi modal path
 * @returns {number} Jumps flown under FTL
 */
export function raukkFtlJumpsOf(path: IRaukkMultiModalPath): number {
	return path.hops.filter((hop: IRaukkRouteHop) => hop.kind === "ftl").length;
}
