// Fuel the lanes of one plan burn per day, in UNITS.
// Pure math over the pairs and their costed legs: exactly the terms
// `calculateCostPerTrip` prices, stated in fuel units instead of ȼ. No
// store, no Vue, no prices — what a unit costs is the resolvers answer.

// Calculations
import { RAUKK_FUEL_TICKERS } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkMaterialUnits } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import {
	IRaukkResolvedShipProfile,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * Ship profile one costed leg really flew.
 *
 * The leg names its ship TYPE, the hull candidates of the pair carry the
 * resolved profiles. A pair that knows no fleet — every caller predating
 * the cadence model — puts its own profile on every leg, which is what
 * `raukkLaneLegs` falls back to as well.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Route pair the leg belongs to
 * @param {string} shipTypeId Ship type the leg flew
 * @returns {IRaukkResolvedShipProfile} Ship profile
 */
function legProfile(
	pair: IRaukkShippingPair,
	shipTypeId: string
): IRaukkResolvedShipProfile {
	const candidates = [
		...(pair.hulls?.manual ? [pair.hulls.manual] : []),
		...(pair.hulls?.owned ?? []),
		...(pair.hulls?.all ?? []),
	];

	return (
		candidates.find((candidate) => candidate.shipTypeId === shipTypeId)
			?.profile ?? pair.profile
	);
}

/**
 * FTL and STL fuel one plans own lanes burn per day.
 *
 * Mirrors {@link calculateCostPerTrip} term by term: both directions of
 * a round trip pay the distance in FTL fuel — a pair that never leaves
 * its system flies no FTL leg at all — and one sublight block each. Every
 * leg burns on its own cadence, so the daily burn is its trips times the
 * burn of one round trip.
 *
 * HIRED lanes burn nothing of the players own fuel: the LM rate is what
 * that trip costs, the operator buys its own. A manual ȼ override on a
 * profile does not change the burn either — it overrides what a parsec
 * COSTS, never how much fuel it takes.
 *
 * Chain carried flows are deliberately absent: a chain is flown for the
 * whole account and has no owning plan to source its fuel from.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair[]} pairs Route pairs the plan owns
 * @param {IRaukkShippingResult} shipping Costed shipping of those pairs
 * @returns {IRaukkMaterialUnits} Fuel units per day, keyed by ticker
 */
export function raukkFuelUnitsPerDay(
	pairs: IRaukkShippingPair[],
	shipping: IRaukkShippingResult
): IRaukkMaterialUnits {
	const fuel: IRaukkMaterialUnits = {};

	function burn(ticker: string, unitsPerDay: number): void {
		if (!(unitsPerDay > 0)) return;
		fuel[ticker] = (fuel[ticker] ?? 0) + unitsPerDay;
	}

	const pairByKey: Map<string, IRaukkShippingPair> = new Map(
		pairs.map((pair) => [pair.pairKey, pair])
	);

	shipping.pairs.forEach((result) => {
		if (result.hired) return;

		const pair: IRaukkShippingPair | undefined = pairByKey.get(
			result.pairKey
		);
		if (pair === undefined) return;

		result.legs.forEach((leg) => {
			const profile: IRaukkResolvedShipProfile = legProfile(
				pair,
				leg.shipTypeId
			);

			const ftlPerTrip: number = pair.route.sameSystem
				? 0
				: 2 *
					pair.route.parsecs *
					Math.max(profile.ftlFuelPerParsec, 0);
			const stlPerTrip: number = 2 * Math.max(profile.stlFuelPerBlock, 0);

			burn(RAUKK_FUEL_TICKERS.ftl, leg.tripsPerDay * ftlPerTrip);
			burn(RAUKK_FUEL_TICKERS.stl, leg.tripsPerDay * stlPerTrip);
		});
	});

	return fuel;
}
