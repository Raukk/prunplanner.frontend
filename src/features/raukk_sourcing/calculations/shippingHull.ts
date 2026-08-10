// Automatic hull selection: which OWNED ship type flies one leg of a
// lane. Pure functions over plain numbers: the candidates, their
// capacities and the legs daily cargo arrive from the caller, no store
// and no Vue.

// Calculations
import { raukkCadenceOf } from "@/features/raukk_sourcing/calculations/shippingCadence";
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

// Types & Interfaces
import {
	IRaukkHullCandidate,
	IRaukkHullPick,
	IRaukkLegDemand,
	IRaukkShipHull,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkCadence } from "@/features/raukk_sourcing/calculations/shippingCadence";

/**
 * Tonnes per m³ from which cargo counts as DENSE and belongs into a
 * weight hull (WCB, 3000 t / 1000 m³): its volume bays would ride empty
 * in any balanced hull.
 *
 * @author raukk
 */
export const RAUKK_DENSITY_WEIGHT_BIASED: number = 2.5;

/**
 * Tonnes per m³ up to which cargo counts as BULKY and belongs into a
 * volume hull (VCB, 1000 t / 3000 m³).
 *
 * @author raukk
 */
export const RAUKK_DENSITY_VOLUME_BIASED: number = 0.4;

/**
 * The heavy hull, the only one the promotion below ever reaches for.
 *
 * It costs roughly twice a WCB and is slower in FTL even empty, so it
 * only earns its keep inside the balanced density band — or when a leg
 * is flying so often that fewer, bigger trips beat the hull premium.
 *
 * @author raukk
 */
export const RAUKK_HCB_HULL: IRaukkShipHull = {
	cargoWeight: 5000,
	cargoVolume: 5000,
};

/**
 * Trip frequency factor an HCB has to save before a leg is promoted to
 * it: flying 1.4× less often is not worth twice the hull.
 *
 * @author raukk
 */
export const RAUKK_HCB_PROMOTION_FACTOR: number = 1.5;

/** Shape of a hull, the cargo class it is built for */
type RAUKK_HULL_SHAPE = "weight" | "volume" | "balanced";

/** Hull shape of one candidate, by which capacity dominates */
function shapeOf(candidate: IRaukkHullCandidate): RAUKK_HULL_SHAPE {
	const { cargoWeight, cargoVolume } = candidate.profile;

	if (cargoWeight > cargoVolume) return "weight";
	if (cargoVolume > cargoWeight) return "volume";

	return "balanced";
}

/**
 * Cargo density of one leg in tonnes per m³, both directions summed.
 *
 * `Infinity` for weightless volume and `0` for volumeless weight are
 * deliberate: they fall into the outer density bands, which is where
 * cargo without one of the two dimensions belongs.
 *
 * @author raukk
 *
 * @param {IRaukkLegDemand} demand Daily cargo of the leg
 * @returns {number} Tonnes per m³
 */
export function raukkLegDensity(demand: IRaukkLegDemand): number {
	const weight: number =
		Math.max(demand.weightOutPerDay, 0) +
		Math.max(demand.weightBackPerDay, 0);
	const volume: number =
		Math.max(demand.volumeOutPerDay, 0) +
		Math.max(demand.volumeBackPerDay, 0);

	if (volume <= 0) return weight > 0 ? Infinity : 1;

	return weight / volume;
}

/** Hull shape the legs density asks for */
function preferredShape(density: number): RAUKK_HULL_SHAPE {
	if (density >= RAUKK_DENSITY_WEIGHT_BIASED) return "weight";
	if (density <= RAUKK_DENSITY_VOLUME_BIASED) return "volume";

	return "balanced";
}

/**
 * Ship loads per day one candidate needs for one legs cargo.
 *
 * The busier DIRECTION decides: a round trip carries the outbound and
 * the inbound cargo on two separate holds, so the fuller of them sets
 * the trip count, never their sum.
 *
 * @author raukk
 *
 * @param {IRaukkHullCandidate} candidate Hull
 * @param {IRaukkLegDemand} demand Daily cargo of the leg
 * @returns {number} Ship loads per day
 */
export function raukkHullLoads(
	candidate: IRaukkHullCandidate,
	demand: IRaukkLegDemand
): number {
	const { cargoWeight, cargoVolume } = candidate.profile;

	function directionLoads(weight: number, volume: number): number {
		return Math.max(
			cargoWeight > 0 ? Math.max(weight, 0) / cargoWeight : 0,
			cargoVolume > 0 ? Math.max(volume, 0) / cargoVolume : 0
		);
	}

	return Math.max(
		directionLoads(demand.weightOutPerDay, demand.volumeOutPerDay),
		directionLoads(demand.weightBackPerDay, demand.volumeBackPerDay)
	);
}

/** One candidate measured against the legs cadence */
function measure(
	candidate: IRaukkHullCandidate,
	demand: IRaukkLegDemand,
	capDays: number
): IRaukkHullPick {
	const cadence: IRaukkCadence = raukkCadenceOf(
		raukkHullLoads(candidate, demand),
		capDays
	);

	return {
		candidate,
		fillDays: cadence.fillDays,
		visitDays: cadence.visitDays,
		tripsPerDay: cadence.tripsPerDay,
	};
}

/** Candidates by rising hold size RELATIVE to the leg, ties by id */
function bySize(picks: IRaukkHullPick[]): IRaukkHullPick[] {
	return [...picks].sort((a, b) =>
		a.fillDays === b.fillDays
			? a.candidate.shipTypeId < b.candidate.shipTypeId
				? -1
				: 1
			: a.fillDays - b.fillDays
	);
}

/**
 * The HCB of a candidate list, the one with the fewest trips on ties.
 */
function heavyHull(picks: IRaukkHullPick[]): IRaukkHullPick | undefined {
	return bySize(
		picks.filter(
			(pick) =>
				pick.candidate.profile.cargoWeight ===
					RAUKK_HCB_HULL.cargoWeight &&
				pick.candidate.profile.cargoVolume ===
					RAUKK_HCB_HULL.cargoVolume
		)
	)[0];
}

/**
 * The hull one leg is flown with, out of a fixed set of candidates.
 *
 * Three rules, in this order:
 *
 *  - DENSITY. `r = tonnes per m³` over the whole leg decides which hull
 *    class is economical: from {@link RAUKK_DENSITY_WEIGHT_BIASED} up a
 *    weight hull (WCB), up to {@link RAUKK_DENSITY_VOLUME_BIASED} a
 *    volume hull (VCB), and only in the balanced band between them do the
 *    balanced hulls — the HCB included — earn their premium. A class the
 *    candidates hold nothing of simply does not restrict anything.
 *  - SIZE. Within that class the SMALLEST hull that still covers a whole
 *    cadence period in one trip wins: it is the cheapest hull that flies
 *    the leg exactly once per visit, and a bigger one would fly the same
 *    single trip while burning more fuel. Nothing covers the period —
 *    the leg needs more than one trip per visit whatever it flies — then
 *    the biggest hull wins, it is the one flying least often. This is the
 *    plans "largest hull whose load still fits the cadence, smaller only
 *    if it suffices" read as an interval: never downsize below
 *    sufficiency, never upsize past it.
 *  - PROMOTION. A leg still needing more than one trip per DAY is a leg
 *    the density band is not what limits; it is promoted to an HCB when
 *    that cuts the trip frequency by {@link RAUKK_HCB_PROMOTION_FACTOR}.
 *
 * Returns `null` for an empty candidate list — a fleet without a single
 * hull has nothing to assign and the caller keeps its own default.
 *
 * @author raukk
 *
 * @param {IRaukkHullCandidate[]} candidates Hulls to choose from
 * @param {IRaukkLegDemand} demand Daily cargo of the leg
 * @param {number} capDays Days per visit the bucket may not exceed
 * @returns {(IRaukkHullPick | null)} Chosen hull and its cadence
 */
export function raukkPickHull(
	candidates: IRaukkHullCandidate[],
	demand: IRaukkLegDemand,
	capDays: number
): IRaukkHullPick | null {
	if (candidates.length === 0) return null;

	const all: IRaukkHullPick[] = candidates.map((candidate) =>
		measure(candidate, demand, capDays)
	);

	const shape: RAUKK_HULL_SHAPE = preferredShape(raukkLegDensity(demand));
	const preferred: IRaukkHullPick[] = all.filter(
		(pick) => shapeOf(pick.candidate) === shape
	);

	const pool: IRaukkHullPick[] = bySize(
		preferred.length > 0 ? preferred : all
	);

	const chosen: IRaukkHullPick =
		pool.find((pick) => pick.fillDays >= capDays) ?? pool[pool.length - 1];

	if (chosen.tripsPerDay <= 1) return chosen;

	const heavy: IRaukkHullPick | undefined = heavyHull(all);

	if (
		heavy !== undefined &&
		heavy.tripsPerDay > 0 &&
		chosen.tripsPerDay / heavy.tripsPerDay >=
			RAUKK_HCB_PROMOTION_FACTOR - RAUKK_EPSILON_EQUAL
	)
		return heavy;

	return chosen;
}

/**
 * The smallest hull of a candidate list, the fallback of a pick that
 * found nothing to choose from.
 *
 * "Smallest" is the hold that carries least, weight times volume, ties
 * broken by weight and then by id so the answer never depends on the
 * order the candidates arrived in. It is deliberately the cheapest hull
 * to fly: a fallback assigns work the heuristic could not place, and
 * over-assigning a heavy hull to it would price freight that nobody
 * asked for.
 *
 * @author raukk
 *
 * @param {IRaukkHullCandidate[]} candidates Hulls to choose from
 * @returns {(IRaukkHullCandidate | null)} Smallest hull, null on empty
 */
export function raukkSmallestCandidate(
	candidates: IRaukkHullCandidate[]
): IRaukkHullCandidate | null {
	if (candidates.length === 0) return null;

	return [...candidates].sort((a, b) => {
		const holdA: number =
			a.profile.cargoWeight * a.profile.cargoVolume;
		const holdB: number =
			b.profile.cargoWeight * b.profile.cargoVolume;

		if (holdA !== holdB) return holdA - holdB;
		if (a.profile.cargoWeight !== b.profile.cargoWeight)
			return a.profile.cargoWeight - b.profile.cargoWeight;

		return a.shipTypeId < b.shipTypeId ? -1 : 1;
	})[0];
}
