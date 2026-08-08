// Display helpers of the shipping section: pure functions turning the
// route pairs a plan owns into the rows the UI renders. No store, no Vue
// and no price fetching — the components hand in plain data, exactly as
// `shipping.ts` and `shippingPairs.ts` do.

// Calculations
import {
	calculateCostPerTrip,
	raukkLaneLegs,
} from "@/features/raukk_sourcing/calculations/shipping";

// Types & Interfaces
import {
	IRaukkCadenceCaps,
	IRaukkLaneLeg,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Exchange pair of the plan itself, or a lane to one source plan */
export type RAUKK_PAIR_KIND = "cx" | "sourcing";

/** What a pair key says about the pair it identifies */
export interface IRaukkPairIdentity {
	kind: RAUKK_PAIR_KIND;
	/** Owning plan, always the plan whose snapshot computed the pair */
	planUuid: string;
	/** Source plan of a sourcing pair, undefined on the exchange pair */
	sourcePlanUuid: string | undefined;
}

/** One lane of the hired versus own fleet comparison */
export interface IRaukkLmComparisonRow {
	pairKey: string;
	identity: IRaukkPairIdentity;
	tripsPerDay: number;
	/** Units per day riding this pair, both directions summed */
	unitsPerDay: number;
	/** ȼ per trip with the plans own ship */
	ownCostPerTrip: number;
	/** Own fleet ȼ per unit shipped, averaged over the whole lane */
	ownCostPerUnit: number;
	/** Manually entered LM rate, undefined while the lane is not hired */
	lmRatePerTrip: number | undefined;
	/** Hired ȼ per unit shipped, undefined without a rate */
	hiredCostPerUnit: number | undefined;
	/** `own − hired`, positive means hiring is the cheaper option */
	savingPerUnit: number | undefined;
}

/** Counterpart marker of the exchange pair, see `raukkCxPairKey` */
const CX_PAIR_SUFFIX: string = "CX";

/**
 * Reads a pair key back into the pair it identifies.
 *
 * Keys are built by `shippingPairs.ts` as `owner>counterpart`, the
 * counterpart being either a source plan uuid or the `CX` marker. Plan
 * uuids never contain the separator, so the first one splits the key.
 *
 * @author raukk
 *
 * @param {string} pairKey Pair Key
 * @returns {IRaukkPairIdentity} Owning plan and counterpart
 */
export function raukkPairIdentity(pairKey: string): IRaukkPairIdentity {
	const separator: number = pairKey.indexOf(">");

	if (separator < 0)
		return {
			kind: "sourcing",
			planUuid: pairKey,
			sourcePlanUuid: undefined,
		};

	const planUuid: string = pairKey.slice(0, separator);
	const counterpart: string = pairKey.slice(separator + 1);

	if (counterpart === CX_PAIR_SUFFIX)
		return { kind: "cx", planUuid, sourcePlanUuid: undefined };

	return { kind: "sourcing", planUuid, sourcePlanUuid: counterpart };
}

/**
 * Daily units riding one pair, both directions summed.
 *
 * The unit count is the denominator of the lane wide ȼ per unit the LM
 * comparison shows. It deliberately mixes tickers: a lane is hired as a
 * whole, so the comparison is a lane average and not a per ticker
 * freight rate — those live in the inputs table.
 *
 * @author raukk
 *
 * @param {IRaukkShippedTicker[]} tickers Daily cargo of both directions
 * @returns {number} Units per day
 */
function unitsOf(tickers: IRaukkShippedTicker[]): number {
	return tickers.reduce(
		(sum, entry) => sum + Math.max(entry.unitsPerDay, 0),
		0
	);
}

/**
 * Builds the hired versus own fleet comparison of every pair a plan
 * owns.
 *
 * Trips per day are cadence driven and therefore identical either way —
 * hiring replaces the ȼ per trip, not the amount of freight. They are
 * summed over the LANES LEGS, one per cargo bucket riding it, and the
 * own ȼ per trip is the trip weighted mean over those legs: a lane whose
 * production and repair cargo fly on two different hulls has no single
 * cost per trip, only an average one. A lane moving nothing is still
 * listed with zero trips so the user can enter a rate before the flows
 * exist.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair[]} pairs Route pairs the plan owns
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {number} repairBillCost ȼ of a full repair bill
 * @param {IRaukkCadenceCaps} caps Cadence caps of the consuming plan
 * @returns {IRaukkLmComparisonRow[]} Comparison rows
 */
export function buildLmComparison(
	pairs: IRaukkShippingPair[],
	config: IRaukkShippingConfig,
	repairBillCost: number,
	caps: IRaukkCadenceCaps
): IRaukkLmComparisonRow[] {
	return pairs.map((pair) => {
		const legs: IRaukkLaneLeg[] = raukkLaneLegs(pair, caps);

		const tripsPerDay: number = legs.reduce(
			(sum, leg) => sum + leg.tripsPerDay,
			0
		);
		const unitsPerDay: number = unitsOf(pair.out) + unitsOf(pair.back);

		const ownDailyCost: number = legs.reduce(
			(sum, leg) =>
				sum +
				leg.tripsPerDay *
					calculateCostPerTrip(
						pair.route,
						leg.profile,
						config,
						repairBillCost
					),
			0
		);

		const ownCostPerTrip: number =
			tripsPerDay > 0
				? ownDailyCost / tripsPerDay
				: calculateCostPerTrip(
						pair.route,
						pair.profile,
						config,
						repairBillCost
					);

		const lmRatePerTrip: number | undefined =
			config.lmRates?.[pair.pairKey];

		/** ȼ per unit of a ȼ per trip rate, zero without any cargo */
		function perUnit(costPerTrip: number): number {
			return unitsPerDay > 0
				? (tripsPerDay * costPerTrip) / unitsPerDay
				: 0;
		}

		const ownCostPerUnit: number = perUnit(ownCostPerTrip);
		const hiredCostPerUnit: number | undefined =
			lmRatePerTrip === undefined ? undefined : perUnit(lmRatePerTrip);

		return {
			pairKey: pair.pairKey,
			identity: raukkPairIdentity(pair.pairKey),
			tripsPerDay,
			unitsPerDay,
			ownCostPerTrip,
			ownCostPerUnit,
			lmRatePerTrip,
			hiredCostPerUnit,
			savingPerUnit:
				hiredCostPerUnit === undefined
					? undefined
					: ownCostPerUnit - hiredCostPerUnit,
		};
	});
}
