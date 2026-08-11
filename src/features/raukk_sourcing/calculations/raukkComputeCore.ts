// One plans whole snapshot computation, PURE.
//
// Everything below used to live inside `useRaukkSnapshot` and read the
// sourcing store directly. It reads {@link IRaukkComputeEnv} instead:
// no Pinia, no Vue reactivity, no IndexedDB and no wall clock of its
// own. That is what lets the very same code run on the main thread over
// the live store and inside a worker over a frozen plain data slice —
// the block solve of a supply loop is k + 1 rounds of this function per
// member, and the rounds are the only part of a sweep worth moving off
// the main thread.
//
// Nothing here writes: `computeOnce` produces a snapshot, the caller
// decides whether to freeze it.

// Calculations
import { calculateTrueCosts } from "@/features/raukk_sourcing/calculations/trueCost";
import {
	calculateRepairCostPerDay,
	calculateRepairMaterialsPerDay,
} from "@/features/raukk_sourcing/calculations/repairCapitalCost";
import { calculateBaseFraction } from "@/features/raukk_sourcing/calculations/baseFraction";
import { resolveLocalPrice } from "@/features/raukk_sourcing/calculations/priceMode";
import { raukkSplitCargoBuckets } from "@/features/raukk_sourcing/calculations/cargoBuckets";
import { calculateShipping } from "@/features/raukk_sourcing/calculations/shipping";
import {
	buildShippingPairs,
	resolvePlanLaneCargo,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import { raukkDepotStopKey } from "@/features/raukk_sourcing/calculations/shippingDepots";
import {
	buildPlanChainFlows,
	mergeClaimedShipping,
	raukkClaimedUnitsLookup,
	raukkCxAnchorCode,
} from "@/features/raukk_sourcing/calculations/shippingFlows";
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";
import {
	raukkAssignedShipTypeId,
	raukkOwnedHullCandidates,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import { raukkCadenceCaps } from "@/features/raukk_sourcing/calculations/shippingCadence";
import { raukkResolveShipProfile } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import { raukkFuelUnitsPerDay } from "@/features/raukk_sourcing/calculations/shippingFuel";
import { raukkRepairUnitsPerDay } from "@/features/raukk_sourcing/calculations/shippingRepairDraws";
import { raukkStorageFilledDays } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
import { raukkEffectiveShipSources } from "@/features/raukk_sourcing/calculations/shipSourcing";
import {
	getVolumeOfAllStorages,
	getWeightOfAllStorages,
} from "@/features/planning/calculations/infrastructureCalculations";

// Pricing
import {
	buildInputRows,
	createRaukkPriceResolver,
	inputDemandPerDay,
	isAggregateSource,
	splitAggregateDraws,
	withFleetDraws,
} from "@/features/raukk_sourcing/raukkSourcingPricing";
import {
	classifyInputBuckets,
	resolveEffectiveSources,
} from "@/features/raukk_sourcing/raukkSourcingDefaults";

// Util
import { inertClone } from "@/util/data";

// Types & Interfaces
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkComputeCoreInput,
	IRaukkComputeEnv,
	IRaukkPriceCaches,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import {
	IRaukkChainFlow,
	IRaukkChainFlowCost,
	IRaukkLeaseCargo,
	IRaukkLocalPrice,
	IRaukkPlanConfig,
	IRaukkShippingConfig,
	IRaukkSnapshot,
	IRaukkSnapshotLane,
	IRaukkTickerSource,
	RAUKK_SOURCE_BUCKET,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkCadenceCaps,
	IRaukkHullCandidate,
	IRaukkHullSelection,
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkCargoDimension,
	IRaukkPairLookups,
	IRaukkPairPlanFlows,
	IRaukkPlanLaneCargo,
	IRaukkTickerOrigin,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	IRaukkExchangePrices,
	IRaukkMaterialUnits,
	IRaukkPriceResolver,
	IRaukkRepairBuilding,
	IRaukkRepairCost,
	IRaukkTrueCostResult,
} from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkProducerOption } from "@/features/raukk_sourcing/raukkSourcingStore.types";

/**
 * Producer prices ONE computation is to use instead of the stored ones,
 * keyed by producing plan uuid and then by ticker.
 *
 * The probe hook of the closed form loop solve: an override lets a
 * computation be evaluated at a TRIAL price without writing anything to
 * the store, which is what makes the affine map of a supply loop
 * extractable at all. Absent entries keep the stored `costPerUnit`, so an
 * empty or omitted override is exactly the normal computation.
 */
export type IRaukkProducerPriceOverride = Record<
	string,
	Record<string, number>
>;

/**
 * Daily units EVERY OTHER plan draws from the producer pool of a ticker.
 *
 * The denominator half of the market top up aggregate: what the pool
 * already owes elsewhere, the consuming plans own stored draw removed so
 * its need is not counted twice — the very rule the source dropdown
 * states as "x % others".
 *
 * @author raukk
 *
 * @param {IRaukkComputeEnv} env Compute Environment
 * @param {string | undefined} consumerPlanUuid Consuming Plan Uuid
 * @param {string} ticker Material Ticker
 * @returns {number} Units per day drawn by other plans
 */
export function othersDrawnPerDay(
	env: IRaukkComputeEnv,
	consumerPlanUuid: string | undefined,
	ticker: string
): number {
	return env.producersOf(ticker).reduce((sum, producer) => {
		const subscription = env.subscription(producer.planUuid, ticker);

		const own: number =
			consumerPlanUuid === undefined
				? 0
				: (subscription.byPlan.find(
						(entry) => entry.planUuid === consumerPlanUuid
					)?.unitsPerDay ?? 0);

		return sum + Math.max(0, subscription.totalDrawnPerDay - own);
	}, 0);
}

/** Prices the account wide ship resolver falls back to */
export interface IRaukkShipPriceLookups {
	/** Exchange price of the ticker, the "no source configured" answer */
	getDefaultPrice: (ticker: string) => number;
	/** Raw exchange data, backs the explicit price modes. Without it a
	 * configured market mode resolves to 0, as everywhere else. */
	getExchange?: (ticker: string) => IRaukkExchangePrices | undefined;
	/**
	 * Producers of a ticker, the environments own list by default.
	 *
	 * The seam the snapshot probes substitute: a loop solve prices a plan
	 * at TRIAL producer prices, and a lane fuelled or repaired out of a
	 * plan inside that loop has to move with them. Every account level
	 * caller leaves it out.
	 */
	getProducers?: (ticker: string) => IRaukkProducerOption[];
}

/**
 * The price resolver every fuel and ship repair charge is priced with.
 *
 * ACCOUNT WIDE by construction: it reads the ship sourcing rather than
 * any plans configuration, so the same fuel costs the same wherever a
 * hull tops up. A ticker the configuration says nothing about falls
 * through to `getDefaultPrice`, which is what the caller considers the
 * market — the consuming plans CX preference in the snapshot pipeline,
 * the universe average on the account level pages.
 *
 * @author raukk
 *
 * @param {IRaukkComputeEnv} env Compute Environment
 * @param {IRaukkShipPriceLookups} lookups Fallback prices
 * @returns {IRaukkPriceResolver} Price resolver of the fleets materials
 */
export function raukkShipPriceResolver(
	env: IRaukkComputeEnv,
	lookups: IRaukkShipPriceLookups
): IRaukkPriceResolver {
	const getProducers = (ticker: string): IRaukkProducerOption[] =>
		lookups.getProducers?.(ticker) ?? env.producersOf(ticker);

	// healed against the same pool the resolver prices from: an entry the
	// pool cannot honour is priced at the exchange, and the table has to
	// say so rather than name a base that stopped making the ticker
	const sources: Record<string, IRaukkTickerSource> =
		raukkEffectiveShipSources(env.shipSourcing(), (ticker) =>
			getProducers(ticker).map((producer) => producer.planUuid)
		);

	/*
	 * The market top up aggregate blends against a DEMAND, and the demand
	 * for fuel and repair materials is the fleets, not any one bases:
	 * coverage is computed once for the whole account. "Others" is
	 * therefore everything drawn from the producer pool that is NOT that
	 * fleet demand — what the fleet burns on the plans OWN lanes, fuel and
	 * repair bill alike, is already stored as a draw on those plans
	 * snapshots and would otherwise be counted twice.
	 *
	 * The subtraction stays a `max(0, …)` because the two sets are not
	 * equal: the demand also contains the CHAIN burn, which no plan owns
	 * and which therefore books no draw anywhere. Subtracting it from the
	 * stored draws can only UNDERSTATE "others" — never double count it —
	 * and the clamp keeps that at zero rather than negative.
	 */
	const demand: IRaukkMaterialUnits = env.shipDemandPerDay();

	function othersDrawn(ticker: string): number {
		const drawn: number = getProducers(ticker).reduce(
			(sum, producer) =>
				sum +
				env.subscription(producer.planUuid, ticker).totalDrawnPerDay,
			0
		);

		return Math.max(0, drawn - (demand[ticker] ?? 0));
	}

	return createRaukkPriceResolver({
		sources,
		getExchange: (ticker: string) => lookups.getExchange?.(ticker),
		getDefaultPrice: lookups.getDefaultPrice,
		getProducers,
		getDemand: (ticker: string) => demand[ticker] ?? 0,
		getOthersDrawn: othersDrawn,
	});
}

/** Everything one shipping computation needs beyond the environment */
export interface IRaukkShippingInput {
	/** Everything this computation reads outside its own plan */
	env: IRaukkComputeEnv;
	planUuid: string;
	planetNaturalId: string;
	planResult: IPlanResult;
	resolver: IRaukkPriceResolver;
	/**
	 * Prices of what the FLEET consumes: the two fuels and the ship repair
	 * bill, resolved through the ACCOUNT WIDE ship sourcing rather than
	 * through this plans entries. A hull refuels and repairs at the
	 * exchange or the depot it is at — never at the base whose cargo it
	 * happens to be carrying — so the consuming plan is the wrong axis to
	 * price either on, and every plan would otherwise have to configure
	 * the same two fuels again.
	 */
	shipResolver: IRaukkPriceResolver;
	getProducers: (ticker: string) => IRaukkProducerOption[];
	shippingConfig: IRaukkShippingConfig;
	/** Per ticker sourcing configuration, the LM buy flags read it */
	sources: Record<string, IRaukkTickerSource>;
	/** LM sell ads of the plan, keyed by output ticker */
	localSales: Record<string, IRaukkLocalPrice>;
	/** Daily repair material demand of the plan, cargo of its own bucket */
	repairUnitsPerDay: IRaukkMaterialUnits;
	/** Weight and volume per unit, for cargo the material I/O does not
	 * carry — the repair materials */
	dimensionOf: (ticker: string) => IRaukkCargoDimension | undefined;
	/** Cadence caps of this plan as the consumer, days per visit */
	caps: IRaukkCadenceCaps;
	/** Exchange THIS plan is anchored at, overriding the account mode */
	cxAnchor?: string;
	/**
	 * True when this plan LEASES its base at another plans docking site
	 * and delegates its whole shipping to that host: no pairs, no flows,
	 * no lanes, no fuel and no freight cost of its own. Its residual cargo
	 * is frozen onto its snapshot for the host to fly instead.
	 */
	delegated?: boolean;
	/**
	 * Frozen residual cargo of the plans OWN leases, one entry per lease,
	 * read from their stored snapshots as the frozen snapshot rule
	 * demands. Empty on every plan hosting none — and on a lease itself,
	 * links are never chained.
	 */
	leaseCargo?: IRaukkLeaseCargo[];
}

/**
 * Shipping of every route pair one plan owns.
 *
 * The plans netted material I/O is the whole cargo manifest: net inputs
 * arrive, net outputs leave, and both carry their per unit weight and
 * volume already. Which pair an input rides is the price resolvers
 * answer — a ticker it prices from another plan travels that plans
 * sourcing pair, everything else is a market buy on the CX pair.
 *
 * Building repair materials never appear in the material I/O; since the
 * cadence model they are cargo all the same, minted from the plans own
 * repair demand into the `repair` bucket and flown on the repair cadence
 * — a base repaired every 90 days has its repair materials delivered
 * every 90 days. The ship repair bill tickers stay out of the CARGO: a
 * hull is repaired where it docks, not out of a base store, so its bill
 * rides no lane and pays no freight. Its units are drawn from the
 * producing plan all the same, see `withFleetDraws`.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkShippingPair[]} Route pairs the plan owns
 */
export function buildPlanShippingPairs(
	input: IRaukkShippingInput
): IRaukkShippingPair[] {
	return buildShippingPairs(
		planCargo(input),
		planLookups(input),
		input.shippingConfig
	);
}

/**
 * The plans netted material I/O plus its repair demand, split into
 * arriving and leaving cargo.
 *
 * Arriving cargo is split per CARGO BUCKET as well
 * ({@link raukkSplitCargoBuckets}): a ticker the workforce and the
 * production both consume rides as two rows, so every downstream
 * consumer can attribute it per class. Repair materials are added as a
 * third kind of row — they are absent from the material I/O and their
 * dimensions therefore come from the material database. Leaving cargo is
 * `production` throughout — an output and its exchange sale are the
 * in/out class by definition.
 *
 * This is the ONE place cargo rows are minted; every bucket a lane can
 * split on originates here.
 */
function planCargo(input: IRaukkShippingInput): IRaukkPairPlanFlows {
	const inputs: IRaukkShippedTicker[] = [];
	const outputs: IRaukkShippedTicker[] = [];

	input.planResult.materialio.forEach((element) => {
		if (element.delta === 0) return;

		const unitsPerDay: number = Math.abs(element.delta);

		if (element.delta > 0) {
			outputs.push({
				ticker: element.ticker,
				bucket: "production",
				unitsPerDay,
				weightPerUnit: element.individualWeight,
				volumePerUnit: element.individualVolume,
			});
			return;
		}

		raukkSplitCargoBuckets(
			element.ticker,
			unitsPerDay,
			input.planResult
		).forEach((share) => {
			if (share.unitsPerDay <= 0) return;

			inputs.push({
				ticker: element.ticker,
				bucket: share.bucket,
				unitsPerDay: share.unitsPerDay,
				weightPerUnit: element.individualWeight,
				volumePerUnit: element.individualVolume,
			});
		});
	});

	Object.entries(input.repairUnitsPerDay).forEach(([ticker, unitsPerDay]) => {
		if (unitsPerDay <= 0) return;

		const dimension: IRaukkCargoDimension | undefined =
			input.dimensionOf(ticker);

		inputs.push({
			ticker,
			bucket: "repair",
			unitsPerDay,
			weightPerUnit: dimension?.weightPerUnit ?? 0,
			volumePerUnit: dimension?.volumePerUnit ?? 0,
		});
	});

	const leases: IRaukkLeaseCargo[] = input.leaseCargo ?? [];

	return {
		planUuid: input.planUuid,
		planetNaturalId: input.planetNaturalId,
		inputs,
		outputs,
		// the leases of this plan dock where it docks: their residual
		// cargo joins its lanes already resolved, see {@link
		// resolvePlanLaneCargo}. Absent while it hosts none, so a plan
		// without a lease mints exactly the rows it always did
		...(leases.length > 0
			? {
					delegatedInputs: leases.flatMap((cargo) => cargo.inbound),
					delegatedOutputs: leases.flatMap((cargo) => cargo.outbound),
				}
			: {}),
	};
}

/**
 * The cargo a LEASE plan hands to its host, per day.
 *
 * Exactly the cargo its own exchange lane would have carried: the sorting
 * of {@link resolvePlanLaneCargo} over its own flows and its own lookups,
 * so market buys, LM flags, subscriber draws and the local transfer rule
 * of round 12 all apply on the leases side, where its configuration is.
 * The host folds the result as it stands.
 *
 * A DIRECT sourcing lane joins the inbound half rather than disappearing:
 * under the hub/spoke rule of the cadence model no such lane exists —
 * every plan to plan draw a chain does not carry is bought at the
 * consumers exchange — so the branch is the conservative answer to a
 * lookup set that says otherwise, never the normal path.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkLeaseCargo} Residual cargo of the lease
 */
function buildPlanLeaseCargo(input: IRaukkShippingInput): IRaukkLeaseCargo {
	const cargo: IRaukkPlanLaneCargo = resolvePlanLaneCargo(
		planCargo(input),
		planLookups(input)
	);

	return {
		inbound: [
			...cargo.marketBack,
			...Array.from(cargo.sourcedBack.values()).flat(),
		],
		outbound: cargo.cxOut,
	};
}

/** Outcome of the exchange hub/spoke routing of one plan */
interface IRaukkHubSpokeRouting {
	/** Own output units a counterpart no longer hauls off this planet */
	viaCxSold: Record<string, number>;
}

/**
 * The exchange hub/spoke half of this plans routing.
 *
 * Cargo no chain carries does NOT get a direct lane: the consumer buys
 * it at its own exchange and the producers excess ships out on its own
 * exchange lane. A plan to plan haul is worth a ship only when several
 * bases share it — which is exactly what a chain is — so everything
 * below the automatic chain cutoff, outside its detour budget or in
 * another region travels through the exchange as a plain sale and a
 * plain purchase.
 *
 * This half is the PRODUCERS: units a counterpart draws here were taken
 * off the exchange sells by `subscribedOf` because a direct lane was
 * hauling them, and nothing does any more. They are read from the same
 * stored draws that subtracted them, so the two always cancel exactly,
 * minus whatever a chain really does carry — which the drawing plan
 * subtracts on its own side as well and must not be shipped twice.
 *
 * A counterpart on the OWN PLANET is skipped whole, own plan included:
 * those units never leave the planet, a same-location contract hands
 * them over.
 *
 * The counterparts are read through `sourcingScopedSnapshots`, the very
 * set `subscription` answers from. A plan the user unassigned keeps its
 * snapshot and therefore keeps its stored `draws` — reading those raw
 * would let a base nobody operates hold an assigned plans output on its
 * exchange lane, invisibly, since every surface that reports a draw is
 * scoped. The two halves of one draw must come from one set or they
 * cannot cancel.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkHubSpokeRouting} Own output sold at the exchange again
 */
function planHubSpokeRouting(
	input: IRaukkShippingInput
): IRaukkHubSpokeRouting {
	const routing: IRaukkHubSpokeRouting = { viaCxSold: {} };

	if (!input.shippingConfig.enabled) return routing;

	const counterparts: Record<string, IRaukkSnapshot> =
		input.env.sourcingScopedSnapshots();

	Object.keys(counterparts)
		.sort()
		.forEach((counterpartUuid) => {
			if (counterpartUuid === input.planUuid) return;

			const counterpart: IRaukkSnapshot = counterparts[
				counterpartUuid
			] as IRaukkSnapshot;

			// local transfer: a counterpart on this very planet takes its
			// draw over a same-location contract, it never rides a lane
			if (counterpart.planetNaturalId === input.planetNaturalId) return;

			const outbound: Record<string, number> | undefined =
				counterpart.draws[input.planUuid];
			if (outbound === undefined) return;

			// the counterpart authored the lane, THIS plan produced on it:
			// a sibling plan on the same planet has its own claim and must
			// not have it subtracted here as well
			const claimed: Record<string, number> =
				input.env.chainClaimedUnitsOn(
					counterpartUuid,
					input.planUuid,
					input.planetNaturalId,
					counterpart.planetNaturalId
				);

			Object.entries(outbound).forEach(([ticker, units]) => {
				const sold: number = Math.max(
					units - (claimed[ticker] ?? 0),
					0
				);
				if (sold <= 0) return;

				routing.viaCxSold[ticker] =
					(routing.viaCxSold[ticker] ?? 0) + sold;
			});
		});

	return routing;
}

/** Everything about other plans, chains and profiles a plan needs */
function planLookups(input: IRaukkShippingInput): IRaukkPairLookups {
	const env: IRaukkComputeEnv = input.env;

	const claimedUnits = raukkClaimedUnitsLookup(
		env.claimedFlowsOf(input.planUuid, input.planetNaturalId),
		input.planetNaturalId
	);
	/*
	 * The exchange this base is ANCHORED at, which since phase 2 is what
	 * "its" exchange means: the account wide mode, a per plan override, or
	 * the nearest one — the default and the answer every caller predating
	 * the anchor gets.
	 */
	const cxCode: string | undefined = raukkCxAnchorCode(
		input.planetNaturalId,
		input.shippingConfig.cxAnchorMode,
		input.cxAnchor
	);
	const cxSystemId: string | undefined =
		cxCode === undefined ? undefined : RAUKK_CX_SYSTEM_ID_BY_CODE[cxCode];

	/**
	 * Planet a source plan sits on, own plan included.
	 *
	 * The snapshot of the plan is the answer, exactly as the `planetOf`
	 * lookup below reads it — the two must agree or the local exemption
	 * and the pair construction would disagree on what a lane is. The own
	 * plan is answered from the input instead: its snapshot is written by
	 * the very computation asking here and a first pass has none yet.
	 */
	function sourcePlanetOf(planUuid: string): string | undefined {
		if (planUuid === input.planUuid) return input.planetNaturalId;

		return env.snapshotPlanetOf(planUuid);
	}

	/*
	 * A draw from a plan on the SAME PLANET is a local transfer: a
	 * same-location contract moves the units, no ship flies. Supply loops
	 * are the special case of it — since main's loop change a plan may
	 * feed its own demand — and a leased or cloned base on the own planet
	 * is the general one. Such units ride NO pair; their share is zeroed
	 * rather than the origin dropped, an emptied origin list would fall
	 * through to the market lane and charge freight on cargo that never
	 * moved. The drawn units are removed from the producers CX outbound by
	 * `subscribedOf` and never added back by {@link planHubSpokeRouting},
	 * so nothing is double booked either. Per ORIGIN, so a mixed aggregate
	 * exempts its local producer and freights the remote ones.
	 */
	function withoutLocalFreight(
		origins: IRaukkTickerOrigin[]
	): IRaukkTickerOrigin[] {
		return origins.map((origin) =>
			sourcePlanetOf(origin.planUuid) === input.planetNaturalId
				? { ...origin, share: 0 }
				: origin
		);
	}

	/*
	 * The ȼ constants of a profile may be "derive": resolving them
	 * against the plans own price resolver is the ONLY place a price
	 * meets a profile, everything downstream is pure math over plain
	 * numbers.
	 */
	const profileOf = (pairKey: string): IRaukkResolvedShipProfile =>
		raukkResolveShipProfile(
			env.getShipProfile(
				raukkAssignedShipTypeId(
					pairKey,
					env.assignments(),
					input.shippingConfig
				)
			),
			(ticker: string) => input.shipResolver(ticker).price
		);

	const hubSpoke: IRaukkHubSpokeRouting = planHubSpokeRouting(input);

	/** One ship type as a hull candidate, its ȼ constants resolved */
	function candidateOf(shipTypeId: string): IRaukkHullCandidate {
		return {
			shipTypeId,
			profile: raukkResolveShipProfile(
				env.getShipProfile(shipTypeId),
				(ticker: string) => input.shipResolver(ticker).price
			),
		};
	}

	/*
	 * The automatic hull pick assigns OWNED types only, so the fleet is
	 * the candidate list, starter fallback included. `all` is every
	 * known type and answers what would be better.
	 */
	const ownedCandidates: IRaukkHullCandidate[] = raukkOwnedHullCandidates(
		env.fleet(),
		candidateOf
	);

	const allCandidates: IRaukkHullCandidate[] = env
		.listShipProfiles()
		.map((profile) => candidateOf(profile.id));

	const assignments: Record<string, string> = env.assignments();
	const depots = env.depots();

	return {
		originOf: (ticker: string): IRaukkTickerOrigin[] => {
			const fromPlanUuid: string | undefined =
				input.resolver(ticker).fromPlanUuid;

			if (fromPlanUuid === undefined) return [];

			if (!isAggregateSource(fromPlanUuid))
				return withoutLocalFreight([
					{ planUuid: fromPlanUuid, share: 1 },
				]);

			// an aggregate draws from the whole producer pool, split
			// exactly as `splitAggregateDraws` splits the draws
			const producers: IRaukkProducerOption[] =
				input.getProducers(ticker);
			const unitsTotal: number = producers.reduce(
				(sum, producer) => sum + producer.unitsPerDay,
				0
			);

			return withoutLocalFreight(
				producers.map((producer) => ({
					planUuid: producer.planUuid,
					share:
						unitsTotal > 0
							? producer.unitsPerDay / unitsTotal
							: 1 / producers.length,
				}))
			);
		},
		planetOf: sourcePlanetOf,
		subscribedOf: (ticker: string): number =>
			env.subscription(input.planUuid, ticker).totalDrawnPerDay,
		/*
		 * A lane whose cargo a chain carries must not be charged for it
		 * twice. The counterpart of the plans own market lane is its
		 * exchange, which a chain addresses by CODE.
		 *
		 * The producing plan is named as well: two source plans on one
		 * planet are two lanes, and a claim taken off both of them would
		 * under-ship the sibling. A claim frozen before `sourcePlanUuid`
		 * existed still counts for either of them, see
		 * {@link raukkClaimedUnitsLookup}.
		 */
		claimedUnitsOf: (
			ticker: string,
			counterpart: string | undefined,
			inbound: boolean,
			sourcePlanUuid?: string
		): number => {
			const stop: string | undefined = counterpart ?? cxCode;
			if (stop === undefined) return 0;

			return claimedUnits(ticker, stop, inbound, sourcePlanUuid);
		},
		profileOf,
		/*
		 * "Auto" is the density and cadence heuristic over the owned
		 * fleet since the cadence model, no longer the account default
		 * profile. A MANUAL assignment still wins outright — and only a
		 * manual one: the v1 per edge override keeps feeding `profileOf`,
		 * which is what a leg falls back to when nothing is owned.
		 */
		hullsOf: (pairKey: string): IRaukkHullSelection => {
			const assigned: string | undefined = assignments[pairKey];

			return {
				owned: ownedCandidates,
				all: allCandidates,
				manual:
					assigned === undefined ? undefined : candidateOf(assigned),
			};
		},
		/*
		 * Exchange hub/spoke (phase 2): a plan to plan haul that no chain
		 * claimed keeps NO direct lane. What a chain carries was already
		 * subtracted by `claimedUnitsOf` above; the rest is bought at this
		 * plans own exchange, so it joins its market lane. The producer
		 * side of the very same rule is `viaCxSoldOf`, see
		 * {@link planHubSpokeRouting}.
		 */
		viaCxSourceOf: (): boolean => true,
		viaCxSoldOf: (ticker: string): number =>
			hubSpoke.viaCxSold[ticker] ?? 0,
		/*
		 * The local market flags of this plan: an output carrying a sell
		 * ad keeps its excess on its own planet, an input whose source
		 * mode is "local" is bought on the planet it is consumed on. Both
		 * are per ticker and, for the buy side, bucket agnostic.
		 */
		localSaleOf: (ticker: string): boolean =>
			input.localSales[ticker] !== undefined,
		localBuyOf: (ticker: string): boolean =>
			input.sources[ticker]?.mode === "local",
		/*
		 * A base standing ON a depot hands its exchange cargo over at the
		 * warehouse next door and owns no exchange lane. The directed
		 * FLOWS are untouched — a chain calling at the depot may still
		 * claim the onward move and price it — only the plans own lane
		 * disappears, which is the whole meaning of "hands it over".
		 */
		depotOf: (planetNaturalId: string): boolean =>
			depots[raukkDepotStopKey(planetNaturalId)] !== undefined,
		anchorCxCode: cxCode,
		anchorCxSystemId: cxSystemId,
	};
}

/**
 * The plans own cargo as directed flows, frozen onto its snapshot for
 * the account level chain step.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkChainFlow[]} Directed flows the plan owns
 */
function buildPlanFlows(input: IRaukkShippingInput): IRaukkChainFlow[] {
	// a lease authors none: its cargo is stated among the hosts flows, so
	// a chain calling at the shared planet claims it exactly once
	if (input.delegated === true) return [];

	return buildPlanChainFlows(
		planCargo(input),
		planLookups(input),
		input.shippingConfig
	);
}

/**
 * Per LEG summary of a plans shipping, the fleet rollups input.
 *
 * One row per leg, not per lane: the legs of one lane may fly different
 * hulls on different cadences, and a rollup keyed by ship type has to see
 * them apart. The ship type is the one the leg really flew — the
 * automatic pick, or the manual assignment where one exists — never the
 * account default, which since the cadence model is only what a leg
 * falls back to when the fleet owns nothing.
 *
 * A lane whose legs all move nothing contributes no row at all, exactly
 * as an empty lane did before.
 *
 * @author raukk
 *
 * @param {IRaukkShippingResult} shipping Shipping result of the plan
 * @returns {IRaukkSnapshotLane[]} Leg summaries
 */
function buildPlanLanes(shipping: IRaukkShippingResult): IRaukkSnapshotLane[] {
	return shipping.pairs.flatMap((pair) =>
		pair.legs.map((leg) => ({
			pairKey: pair.pairKey,
			bucket: leg.bucket,
			shipTypeId: leg.shipTypeId,
			visitDays: leg.visitDays,
			tripsPerDay: leg.tripsPerDay,
			roundTripMinutes: leg.roundTripMinutes,
			hired: pair.hired,
			damagePerTrip: leg.damagePerTrip,
			ownCostPerTrip: leg.ownCostPerTrip,
			ownDamagePerTrip: leg.ownDamagePerTrip,
			unitsPerDay: leg.unitsPerDay,
		}))
	);
}

/** Shipping of one plan: the costed pairs and what they burn */
export interface IRaukkPlanShipping {
	shipping: IRaukkShippingResult;
	/** Ship fuel the plans own lanes burn per day, keyed by ticker */
	fuelUnitsPerDay: IRaukkMaterialUnits;
	/**
	 * Repair bill materials those same lanes consume per day, keyed by
	 * ticker. Disjoint from the fuel tickers by construction.
	 */
	repairBillUnitsPerDay: IRaukkMaterialUnits;
}

/**
 * Shipping cost of every route pair one plan owns, plus the freight of
 * the flows a chain took over.
 *
 * Claimed flows left the pairs — the pair construction subtracted them —
 * and take their ȼ per unit from the STORED chain result instead, which
 * is where the one round convergence lag of the chain model becomes
 * visible: on the first pass a chain result is still the previous
 * rounds. The shipping FRACTION stays the plans own lanes only; a chain
 * is flown for the whole empire and is accounted on the fleet page.
 *
 * What those pairs CONSUME is reported alongside, in units: the fuel
 * they burn and the repair bills their wear buys. It is the pairs —
 * never a chain, which no plan owns — that a plan sources both for. The
 * ȼ of either is already inside the pair cost, through the resolved ship
 * profile and the priced repair bill; the units exist so the burn can be
 * sourced and drawn.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkPlanShipping} Per pair shipping, fuel and repair burn
 */
export function computePlanShipping(
	input: IRaukkShippingInput
): IRaukkPlanShipping {
	/*
	 * A LEASE owns no pair at all: it shares its hosts docking site, the
	 * host plans and pays the whole sites shipping. The skip happens HERE,
	 * at the shipping input, so everything downstream — freight per unit,
	 * repair freight, fuel burn, lanes, advisories — falls out empty on
	 * its own instead of asking about leases one conditional at a time.
	 */
	const pairs: IRaukkShippingPair[] =
		input.delegated === true ? [] : buildPlanShippingPairs(input);

	const result: IRaukkShippingResult = calculateShipping(
		pairs,
		input.shippingConfig,
		// the only price this needs is the ship repair bill, a fleet cost
		(ticker: string) => input.shipResolver(ticker).price,
		input.caps
	);

	const fuelUnitsPerDay: IRaukkMaterialUnits = raukkFuelUnitsPerDay(
		pairs,
		result
	);
	// the plans OWN lanes, exactly as the fuel: the claimed flows below
	// fly on a chain, whose wear belongs to the account not to this plan
	const repairBillUnitsPerDay: IRaukkMaterialUnits =
		raukkRepairUnitsPerDay(result);

	if (!input.shippingConfig.enabled)
		return { shipping: result, fuelUnitsPerDay, repairBillUnitsPerDay };

	return {
		shipping: mergeClaimedShipping(
			result,
			pairs,
			input.env.claimedFlowsOf(input.planUuid, input.planetNaturalId),
			input.planetNaturalId,
			input.planUuid
		),
		fuelUnitsPerDay,
		repairBillUnitsPerDay,
	};
}

/**
 * ONE full snapshot computation of one plan, start to finish.
 *
 * The body `preparePlanSnapshot` used to close over, lifted out whole: it
 * reads its plan from {@link IRaukkComputeCoreInput} and everything else
 * from {@link IRaukkComputeEnv}, so the same call produces the same bytes
 * on the main thread and inside a worker. Writes nothing.
 *
 * `priceOverride` substitutes producer prices for THIS computation only:
 * it is how the loop solve probes the pipeline at trial prices. Every
 * consumer of a producer price inside this function goes through the
 * wrapped lookup below — the resolver, the aggregate pools, the shipping
 * origins and the draw splitting — so an overridden self price is seen by
 * all of them, an aggregate pool the plan is itself a member of included.
 *
 * @author raukk
 *
 * @param {IRaukkComputeCoreInput} input Plan, prices and shipping config
 * @param {IRaukkComputeEnv} env Everything outside this plan
 * @param {IRaukkProducerPriceOverride} priceOverride Trial prices
 * @returns {IRaukkSnapshot} Computed snapshot, unstored
 */
export function raukkComputeSnapshotOnce(
	input: IRaukkComputeCoreInput,
	env: IRaukkComputeEnv,
	priceOverride?: IRaukkProducerPriceOverride
): IRaukkSnapshot {
	const prices: IRaukkPriceCaches = input.prices;
	const shippingConfig: IRaukkShippingConfig = input.shippingConfig;

	/** The environments producers, with the overridden prices applied */
	const producersOf = (ticker: string): IRaukkProducerOption[] => {
		const producers: IRaukkProducerOption[] = env.producersOf(ticker);

		if (priceOverride === undefined) return producers;

		return producers.map((producer) => {
			const costPerUnit: number | undefined =
				priceOverride[producer.planUuid]?.[ticker];

			return costPerUnit === undefined
				? producer
				: { ...producer, costPerUnit };
		});
	};

	const config: IRaukkPlanConfig = env.getConfig(input.planUuid);

	const repairBuildings: IRaukkRepairBuilding[] =
		input.planResult.production.buildings.map((building) => ({
			name: building.name,
			amount: building.amount,
			constructionMaterials: building.constructionMaterials,
		}));

	/*
	 * Repair material UNITS come first: they are cargo since the
	 * cadence model, so the shipping needs them, and their freight in
	 * turn is part of what a repair really costs. Units depend on the
	 * buildings and the repair day alone, never on a price, so there
	 * is no circle — only an order.
	 */
	const repairUnitsPerDay: IRaukkMaterialUnits =
		calculateRepairMaterialsPerDay(repairBuildings, config.repairDay).total;

	/*
	 * The account wide bucket defaults are merged in before anything
	 * is priced, so the whole pipeline — resolver, shipping, rows and
	 * the frozen config alike — sees ONE set of sources: the effective
	 * ones. Which bucket a ticker sits in is a property of the plan,
	 * so the classification is frozen onto the snapshot as well.
	 */
	const inputBuckets: Record<string, RAUKK_SOURCE_BUCKET[]> =
		classifyInputBuckets(input.planResult, repairUnitsPerDay);

	// the merged entries are frozen onto the snapshot, and a reactive
	// proxy out of the store cannot be structured cloned
	config.sources = resolveEffectiveSources(
		config.sources,
		inputBuckets,
		env.sourcingDefaults(),
		(ticker: string) =>
			producersOf(ticker).map((producer) => producer.planUuid)
	);

	const demandPerDay: IRaukkMaterialUnits = inputDemandPerDay(
		input.planResult,
		repairUnitsPerDay
	);

	const resolver: IRaukkPriceResolver = createRaukkPriceResolver({
		sources: config.sources,
		getExchange: (ticker: string) => prices.exchangePrices[ticker],
		getDefaultPrice: (ticker: string) => prices.defaultPrices[ticker] ?? 0,
		getProducers: producersOf,
		getDemand: (ticker: string) => demandPerDay[ticker] ?? 0,
		getOthersDrawn: (ticker: string) =>
			othersDrawnPerDay(env, input.planUuid, ticker),
	});

	/*
	 * What the FLEET consumes is priced account wide, see
	 * {@link IRaukkShippingInput.shipResolver}. The exchange price of
	 * this plan is the fallback, so a user who configures nothing keeps
	 * exactly the prices the pipeline charged before.
	 */
	const shipResolver: IRaukkPriceResolver = raukkShipPriceResolver(env, {
		getDefaultPrice: (ticker: string) => prices.defaultPrices[ticker] ?? 0,
		getExchange: (ticker: string) => prices.exchangePrices[ticker],
		// the WRAPPED producers, so a probes trial price reaches the
		// fuel and the repair bill as well: a lane sourced from a plan
		// inside a supply loop has to move with that loops prices
		getProducers: producersOf,
	});

	/*
	 * Lease delegation. A lease reads no cargo of its own leases —
	 * links are never chained — and its cadence override never
	 * governs anything: the host flies the site and its caps decide.
	 */
	const delegated: boolean = config.leaseHostPlanUuid !== undefined;

	const leaseCargo: IRaukkLeaseCargo[] = delegated
		? []
		: env.leaseCargoOf(input.planUuid);

	const shippingInput: IRaukkShippingInput = {
		env,
		planUuid: input.planUuid,
		planetNaturalId: input.planetNaturalId,
		planResult: input.planResult,
		resolver,
		shipResolver,
		getProducers: producersOf,
		shippingConfig,
		sources: config.sources,
		localSales: config.localSales ?? {},
		repairUnitsPerDay,
		dimensionOf: (ticker: string) => prices.dimensions[ticker],
		caps: raukkCadenceCaps(
			shippingConfig,
			config.repairDay,
			config.cadence
		),
		cxAnchor: config.cxAnchor,
		delegated,
		leaseCargo,
	};

	const { shipping, fuelUnitsPerDay, repairBillUnitsPerDay } =
		computePlanShipping(shippingInput);

	const repairCost: IRaukkRepairCost = calculateRepairCostPerDay(
		repairBuildings,
		config.repairDay,
		(ticker: string) =>
			resolver(ticker).price + (shipping.inbound[ticker] ?? 0)
	);

	const result: IRaukkTrueCostResult = calculateTrueCosts({
		planResult: input.planResult,
		repairCostPerDayByBuilding: repairCost.perBuilding,
		repairMaterialUnitsPerDay: repairCost.materialUnitsPerDay,
		resolveInputPrice: resolver,
		shippingPerUnitIn: shipping.inbound,
		shippingPerUnitOut: shipping.outbound,
	});

	/*
	 * Both fleet materials in one map: the fuel tickers and the repair
	 * bills are disjoint sets, so a plain merge cannot collide, and one
	 * booking pass keeps the two on exactly the same rule.
	 */
	const fleetUnitsPerDay: IRaukkMaterialUnits = {
		...fuelUnitsPerDay,
		...repairBillUnitsPerDay,
	};

	const draws: Record<string, IRaukkMaterialUnits> = splitAggregateDraws(
		// account wide: which producer the fuel and the repair plates
		// come from is a fleet question, so the draw follows the ship
		// resolvers answer
		withFleetDraws(result.draws, fleetUnitsPerDay, shipResolver),
		producersOf
	);

	const inputPrices: Record<string, number> = {};
	buildInputRows(
		input.planResult,
		repairCost.materialUnitsPerDay,
		config.sources,
		resolver,
		shipping.inbound,
		(ticker: string) => prices.defaultPrices[ticker] ?? 0
	).forEach((row) => {
		// freight included: what the plan really pays per unit is
		// what the read only notes have to show. Identical to the
		// bare price while shipping is disabled
		inputPrices[row.ticker] = row.effectivePrice;
	});

	/*
	 * An LM sold ticker sells at its resolved local price, flat and
	 * for the whole ticker: the sell price simply BECOMES that value.
	 * Everything reading the frozen number — margin, overview profit,
	 * per base profit — follows without knowing about the flag.
	 */
	const sellPrices: Record<string, number> = {};
	Object.keys(result.outputs).forEach((ticker) => {
		const localSale: IRaukkLocalPrice | undefined =
			config.localSales?.[ticker];

		sellPrices[ticker] =
			localSale !== undefined
				? resolveLocalPrice(localSale, prices.exchangePrices[ticker])
				: (prices.sellPrices[ticker] ?? 0);
	});

	/**
	 * Days the plans own storage bridges at its throughput. A LEASE
	 * stores it too: its storage still buffers its cargo between the
	 * hosts visits, only the flying is delegated.
	 */
	function planStorageFilledDays(): number | null {
		// guarded: a minimal plan result of another caller may carry
		// no storage block at all
		if (
			input.planResult.storage === undefined ||
			input.planResult.materialio === undefined
		)
			return null;

		return raukkStorageFilledDays(
			getWeightOfAllStorages(input.planResult.storage),
			getVolumeOfAllStorages(input.planResult.storage),
			input.planResult.materialio
		);
	}

	/*
	 * Shipping is account global: the configuration it was frozen
	 * with is embedded, and only while it is enabled. A snapshot
	 * computed with shipping off stays byte identical to the ones
	 * written before the shipping model existed.
	 */
	return {
		computedAt: env.now(),
		stale: false,
		planName: input.planName,
		planetNaturalId: input.planetNaturalId,
		outputs: inertClone(result.outputs),
		draws,
		config: shippingConfig.enabled
			? { ...inertClone(config), shipping: shippingConfig }
			: inertClone(config),
		baseFraction: calculateBaseFraction(
			draws,
			(sourcePlanUuid) => env.getSnapshot(sourcePlanUuid),
			input.planUuid
		),
		inputPrices,
		inputBuckets,
		sellPrices,
		/*
		 * A LEASE freezes the mirror image of all this: no flows, no
		 * lanes, no advisories, and `null` rather than a reassuring
		 * zero for the fraction — the existing "no denominator"
		 * convention, its ship time being the hosts. What it does
		 * freeze is the cargo the host has to fly for it.
		 */
		...(shippingConfig.enabled
			? delegated
				? {
						flows: [],
						lanes: [],
						advisories: [],
						shippingFraction: null,
						leaseCargo: buildPlanLeaseCargo(shippingInput),
						storageFilledDays: planStorageFilledDays(),
					}
				: {
						flows: buildPlanFlows(shippingInput),
						lanes: buildPlanLanes(shipping),
						// the account wide ship sourcing states the fleets
						// fuel demand off the frozen snapshots
						fuelUnitsPerDay: inertClone(fuelUnitsPerDay),
						advisories: shipping.advisories,
						shippingFraction: shipping.shippingFraction,
						storageFilledDays: planStorageFilledDays(),
					}
			: {}),
	};
}

/**
 * Chain flows one plan owns, over a plain result map.
 *
 * The OWNERSHIP gate of the chain model: every chain flow was authored
 * by exactly one member plans snapshot, and only that plan may fold its
 * freight or subtract its units. Endpoints alone cannot say so — a plan
 * to plan lane touches both plans, and letting the SOURCE plan fold it
 * too would bill the same freight twice, once into the producers break
 * even price and once more into the consumers inbound.
 *
 * COMPATIBILITY, chosen and documented: a chain result frozen before
 * ownership was carried has no `ownerPlanUuid`. Such a flow degrades to
 * the old endpoint heuristic for INBOUND lanes only — the plan the cargo
 * arrives at is the plan that draws it, which is the authoring plan in
 * every case the old heuristic got right. Its outbound half is dropped,
 * so the worst an old result can do is leave freight on the plans own
 * pairs, never double bill it.
 *
 * STALENESS is deliberately not read here, and the invariant that makes
 * that safe is: a stored chain result claims, whatever its flag says.
 * `stale` means "the numbers are one pass old", the documented
 * convergence lag of the whole model — it never means "invalid". Both
 * sides of the claim read this same function, so a claimed lane is
 * subtracted from the pairs and paid from the chain, or from neither;
 * skipping stale results in ONE of them is what would double bill.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkChainResult>} chainResults Chain results
 * @param {string} planUuid Own plan uuid
 * @param {string} planetNaturalId Own planet
 * @returns {IRaukkChainFlowCost[]} Claimed flows this plan owns
 */
export function raukkClaimedFlowsOf(
	chainResults: Record<string, { flows: IRaukkChainFlowCost[] }>,
	planUuid: string,
	planetNaturalId: string
): IRaukkChainFlowCost[] {
	const claimed: IRaukkChainFlowCost[] = [];

	Object.values(chainResults).forEach((result) =>
		result.flows.forEach((flow: IRaukkChainFlowCost) => {
			if (flow.ownerPlanUuid !== undefined) {
				if (flow.ownerPlanUuid === planUuid) claimed.push(flow);
				return;
			}

			if (flow.toStop === planetNaturalId) claimed.push(flow);
		})
	);

	return claimed;
}
