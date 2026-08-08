import { computed, ComputedRef, ref, Ref, watch } from "vue";

// Stores
import { usePlanningStore } from "@/stores/planningStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";
import { useExchangeData } from "@/database/services/useExchangeData";
import { useMaterialData } from "@/database/services/useMaterialData";

// Calculations
import { calculateTrueCosts } from "@/features/raukk_sourcing/calculations/trueCost";
import {
	calculateRepairCostPerDay,
	calculateRepairMaterialsPerDay,
} from "@/features/raukk_sourcing/calculations/repairCapitalCost";
import { calculateBaseFraction } from "@/features/raukk_sourcing/calculations/baseFraction";
import { resolveLocalPrice } from "@/features/raukk_sourcing/calculations/priceMode";
import { raukkSplitCargoBuckets } from "@/features/raukk_sourcing/calculations/cargoBuckets";
import {
	calculateRepairBillCost,
	calculateShipping,
	RAUKK_REPAIR_BILL,
} from "@/features/raukk_sourcing/calculations/shipping";
import {
	buildShippingPairs,
	resolvePlanLaneCargo,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	buildPlanChainFlows,
	mergeClaimedShipping,
	raukkClaimedUnitsLookup,
	raukkCxAnchorCode,
} from "@/features/raukk_sourcing/calculations/shippingFlows";
import { RAUKK_CX_SYSTEM_ID_BY_CODE } from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkAssignedShipTypeId } from "@/features/raukk_sourcing/calculations/shippingFleet";
import { raukkCadenceCaps } from "@/features/raukk_sourcing/calculations/shippingCadence";
import {
	RAUKK_FUEL_TICKERS,
	RAUKK_STARTER_FLEET,
	raukkResolveShipProfile,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	buildInputRows,
	buildSourceOptions,
	createRaukkPriceResolver,
	isAggregateSource,
	outputsSettled,
	resolveCxExchangeCode,
	splitAggregateDraws,
	withFuelDraws,
} from "@/features/raukk_sourcing/raukkSourcingPricing";
import { raukkFuelUnitsPerDay } from "@/features/raukk_sourcing/calculations/shippingFuel";
import { raukkStorageFilledDays } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
import {
	getVolumeOfAllStorages,
	getWeightOfAllStorages,
} from "@/features/planning/calculations/infrastructureCalculations";

// Util
import { inertClone } from "@/util/data";

// Types & Interfaces
import { ICXData } from "@/stores/planningStore.types";
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkChainFlow,
	IRaukkChainFlowCost,
	IRaukkChainResult,
	IRaukkLeaseCargo,
	IRaukkLocalPrice,
	IRaukkPlanConfig,
	IRaukkShippingConfig,
	IRaukkSnapshot,
	IRaukkSnapshotLane,
	IRaukkTickerSource,
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
import { IMaterial } from "@/features/api/gameData.types";
import {
	IRaukkInputRow,
	IRaukkOutputRow,
	IRaukkSourceOption,
} from "@/features/raukk_sourcing/raukkSourcingUi.types";

/** Reactive plan context the snapshot computation runs against */
export interface IRaukkSnapshotContext {
	planUuid: Ref<string | undefined>;
	planName: Ref<string>;
	planetNaturalId: Ref<string | undefined>;
	cxUuid: Ref<string | undefined>;
	planResult: Ref<IPlanResult>;
}

/** Plain plan context of a single snapshot computation */
export interface IRaukkPlanSnapshotContext {
	planUuid: string;
	planName: string;
	planetNaturalId: string;
	cxUuid: string | undefined;
	planResult: IPlanResult;
}

/** Prices the cost math of one computation runs against */
export interface IRaukkPriceCaches {
	/** CX preference buy price per ticker */
	defaultPrices: Record<string, number>;
	/** CX preference sell price per ticker */
	sellPrices: Record<string, number>;
	/** Raw exchange data per ticker, backs the explicit price modes */
	exchangePrices: Record<string, IRaukkExchangePrices>;
	/**
	 * Weight and volume per unit of every relevant ticker.
	 *
	 * The netted material I/O carries them already; the REPAIR materials
	 * do not appear in it at all and are cargo since the cadence model, so
	 * their dimensions are loaded from the material database alongside the
	 * prices. A ticker the database does not know stays absent and ships
	 * weightless, the same degradation an unpriced ticker takes.
	 */
	dimensions: Record<string, IRaukkCargoDimension>;
}

/** Outcome of one snapshot computation */
export interface IRaukkPlanSnapshotResult {
	snapshot: IRaukkSnapshot;
	prices: IRaukkPriceCaches;
}

/** Iteration cap of the self supply fixed point, see
 * {@link computePlanSnapshot} */
const RAUKK_SELF_LOOP_MAX_ITERATIONS: number = 10;

// The self supply loop settles within the hybrid tolerance of
// {@link outputsSettled}, over the `RAUKK_EPSILON_SETTLE` floor: an
// output whose ȼ per unit no longer moves at its own magnitude.

/**
 * All tickers a plans sourcing numbers need prices for: everything
 * moving through its material I/O plus all construction materials of
 * its buildings, those are the repairable ones.
 *
 * With shipping enabled the four ship repair bill tickers join them, and
 * so do the two fuels FF and SF. None of them is cargo of the plan and
 * none appears in its material I/O, but the repair cost per trip prices
 * the bill and the derived ȼ constants price the fuels — without loading
 * them the resolvers `?? 0` fallback would silently zero those terms.
 *
 * @author raukk
 *
 * @param {IPlanResult} planResult Plan Calculation Result
 * @param {boolean} withShipRepair Include the ship repair bill tickers
 * @returns {string[]} Material Tickers
 */
function collectRelevantTickers(
	planResult: IPlanResult,
	withShipRepair: boolean = false
): string[] {
	const tickers: Set<string> = new Set();

	planResult.materialio.forEach((element) => tickers.add(element.ticker));
	planResult.production.buildings.forEach((building) =>
		building.constructionMaterials.forEach((material) =>
			tickers.add(material.ticker)
		)
	);

	if (withShipRepair) {
		Object.keys(RAUKK_REPAIR_BILL).forEach((ticker) => tickers.add(ticker));
		tickers.add(RAUKK_FUEL_TICKERS.ftl);
		tickers.add(RAUKK_FUEL_TICKERS.stl);
	}

	return Array.from(tickers).sort();
}

/** Everything one shipping computation needs beyond the store */
interface IRaukkShippingInput {
	planUuid: string;
	planetNaturalId: string;
	planResult: IPlanResult;
	resolver: IRaukkPriceResolver;
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
 * every 90 days. The ship repair bill tickers stay out: they are priced
 * through the resolver without booking a draw, the quantities are tiny
 * and take part in neither cycle guard nor base fraction.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkShippingPair[]} Route pairs the plan owns
 */
function buildPlanShippingPairs(
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

/**
 * Flows a chain already claimed off this plan, from the STORED chain
 * results.
 *
 * The OWNERSHIP gate of the chain model (shipping-plan.md, "Ownership
 * rule"): every chain flow was authored by exactly one member plans
 * snapshot, and only that plan may fold its freight or subtract its
 * units. Endpoints alone cannot say so — a plan to plan lane touches
 * both plans, and letting the SOURCE plan fold it too would bill the
 * same freight twice, once into the producers break even price and once
 * more into the consumers inbound.
 *
 * COMPATIBILITY, chosen and documented: a chain result frozen before
 * ownership was carried has no `ownerPlanUuid`. Such a flow degrades to
 * the old endpoint heuristic for INBOUND lanes only — the plan the cargo
 * arrives at is the plan that draws it, which is the authoring plan in
 * every case the old heuristic got right. Its outbound half is dropped,
 * so the worst an old result can do is leave freight on the plans own
 * pairs, never double bill it. The next chain pass rewrites the result
 * with owners and the fallback stops applying.
 *
 * STALENESS is deliberately not read here, and the invariant that makes
 * that safe is: a stored chain result claims, whatever its flag says.
 * `stale` means "the numbers are one pass old", the documented
 * convergence lag of the whole model — it never means "invalid". Both
 * sides of the claim read this same function, so a claimed lane is
 * subtracted from the pairs and paid from the chain, or from neither;
 * skipping stale results in ONE of them is what would double bill.
 * Results that must not claim are removed instead of flagged: the chain
 * pass purges the derived set when shipping is off or the automatic pass
 * failed, and `deleteChain` drops an authored one outright.
 *
 * @author raukk
 *
 * @param {string} planUuid Own plan uuid
 * @param {string} planetNaturalId Own planet
 * @returns {IRaukkChainFlowCost[]} Claimed flows this plan owns
 */
function planClaimedFlows(
	planUuid: string,
	planetNaturalId: string
): IRaukkChainFlowCost[] {
	const sourcingStore = useRaukkSourcingStore();

	const claimed: IRaukkChainFlowCost[] = [];

	Object.values(sourcingStore.chainResults).forEach(
		(result: IRaukkChainResult) =>
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

/** Outcome of the exchange hub/spoke routing of one plan */
interface IRaukkHubSpokeRouting {
	/** Own output units a counterpart no longer hauls off this planet */
	viaCxSold: Record<string, number>;
}

/**
 * Units per day a chain already hauls on one directed lane, over the
 * flows ONE named plan authored.
 *
 * The counterpart of a rerouted lane subtracts its chain claimed units
 * itself, through `claimedUnitsOf`; the source plan adding the same
 * units back to its exchange sells has to subtract them as well, or a
 * chain carried flow would be shipped twice. Chain results are account
 * level, so both sides again see the same numbers. A result frozen
 * before ownership was carried falls back to the endpoint heuristic of
 * {@link planClaimedFlows}: the plan the cargo arrives at authored it.
 * Staleness is not read, for the reason stated there.
 *
 * The PRODUCING plan is named as well, and endpoints alone cannot say
 * it: `fromStop` is a planet, and two plans on one planet author two
 * flows that are identical in every endpoint. Keyed by the planet alone,
 * both producers would subtract the whole claim of both and one of them
 * would ship its cargo for free. A claim frozen before `sourcePlanUuid`
 * existed names no producer and still counts for every plan on its
 * origin planet, which is exactly the old behaviour.
 *
 * @author raukk
 *
 * @param {string} ownerPlanUuid Plan whose flows count
 * @param {string} sourcePlanUuid Producing plan whose flows count
 * @param {string} fromStop Origin stop
 * @param {string} toStop Destination stop
 * @returns {Record<string, number>} Claimed units per ticker
 */
function chainClaimedUnits(
	ownerPlanUuid: string,
	sourcePlanUuid: string,
	fromStop: string,
	toStop: string
): Record<string, number> {
	const sourcingStore = useRaukkSourcingStore();

	const claimed: Record<string, number> = {};

	Object.values(sourcingStore.chainResults).forEach(
		(result: IRaukkChainResult) =>
			result.flows.forEach((flow: IRaukkChainFlowCost) => {
				if (
					flow.ownerPlanUuid !== undefined &&
					flow.ownerPlanUuid !== ownerPlanUuid
				)
					return;

				if (
					flow.sourcePlanUuid !== undefined &&
					flow.sourcePlanUuid !== sourcePlanUuid
				)
					return;

				if (flow.fromStop !== fromStop || flow.toStop !== toStop)
					return;

				claimed[flow.ticker] =
					(claimed[flow.ticker] ?? 0) + Math.max(flow.unitsPerDay, 0);
			})
	);

	return claimed;
}

/**
 * The exchange hub/spoke half of this plans routing
 * (shipping-cadence-plan.md, Phase 2).
 *
 * Cargo no chain carries does NOT get a direct lane: the consumer buys
 * it at its own exchange and the producers excess ships out on its own
 * exchange lane. A plan to plan haul is worth a ship only when several
 * bases share it — which is exactly what a chain is — so everything
 * below the automatic chain cutoff, outside its detour budget or in
 * another region travels through the exchange as a plain sale and a
 * plain purchase. The round 7 mutual verdict is the special case this
 * generalises: the lighter direction of an A⇄B pair already routed this
 * way, now both do.
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
 * them over. `subscribedOf` took them off this plans exchange sells when
 * the draw was recorded and nothing puts them back, which is the whole
 * of the local transfer rule on the producers side.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkHubSpokeRouting} Own output sold at the exchange again
 */
function planHubSpokeRouting(
	input: IRaukkShippingInput
): IRaukkHubSpokeRouting {
	const sourcingStore = useRaukkSourcingStore();

	const routing: IRaukkHubSpokeRouting = { viaCxSold: {} };

	if (!input.shippingConfig.enabled) return routing;

	Object.keys(sourcingStore.snapshots)
		.sort()
		.forEach((counterpartUuid) => {
			if (counterpartUuid === input.planUuid) return;

			const counterpart: IRaukkSnapshot = sourcingStore.snapshots[
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
			const claimed: Record<string, number> = chainClaimedUnits(
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
	const sourcingStore = useRaukkSourcingStore();

	const claimedUnits = raukkClaimedUnitsLookup(
		planClaimedFlows(input.planUuid, input.planetNaturalId),
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

		return sourcingStore.snapshots[planUuid]?.planetNaturalId;
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
			sourcingStore.getShipProfile(
				raukkAssignedShipTypeId(
					pairKey,
					sourcingStore.assignments,
					input.shippingConfig
				)
			),
			(ticker: string) => input.resolver(ticker).price
		);

	const hubSpoke: IRaukkHubSpokeRouting = planHubSpokeRouting(input);

	/** One ship type as a hull candidate, its ȼ constants resolved */
	function candidateOf(shipTypeId: string): IRaukkHullCandidate {
		return {
			shipTypeId,
			profile: raukkResolveShipProfile(
				sourcingStore.getShipProfile(shipTypeId),
				(ticker: string) => input.resolver(ticker).price
			),
		};
	}

	/*
	 * The automatic hull pick assigns OWNED types only, so the fleet is
	 * the candidate list: a type without a single hull is an advisory at
	 * best. `all` is every known type and answers what would be better.
	 * An account that never configured a fleet is assumed to fly the
	 * two SCB starter ships every new game account owns — see
	 * {@link RAUKK_STARTER_FLEET} — rather than a phantom bigger hull.
	 */
	const configuredCandidates: IRaukkHullCandidate[] = Object.entries(
		sourcingStore.fleet
	)
		.filter(([, ship]) => ship.count > 0)
		.map(([shipTypeId]) => candidateOf(shipTypeId));

	const ownedCandidates: IRaukkHullCandidate[] =
		configuredCandidates.length > 0
			? configuredCandidates
			: [candidateOf(RAUKK_STARTER_FLEET.shipTypeId)];

	const allCandidates: IRaukkHullCandidate[] = sourcingStore
		.listShipProfiles()
		.map((profile) => candidateOf(profile.id));

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
			sourcingStore.subscription(input.planUuid, ticker).totalDrawnPerDay,
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
			const assigned: string | undefined =
				sourcingStore.assignments[pairKey];

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
		}))
	);
}

/** Shipping of one plan: the costed pairs and what they burn */
interface IRaukkPlanShipping {
	shipping: IRaukkShippingResult;
	/** Ship fuel the plans own lanes burn per day, keyed by ticker */
	fuelUnitsPerDay: IRaukkMaterialUnits;
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
 * The FUEL those pairs burn is reported alongside, in units: it is the
 * pairs — never a chain, which no plan owns — that a plan sources fuel
 * for. Its ȼ is already inside the pair cost through the resolved ship
 * profile, the units exist so the burn can be sourced and drawn.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkPlanShipping} Per pair shipping and fuel burn
 */
function computePlanShipping(input: IRaukkShippingInput): IRaukkPlanShipping {
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
		(ticker: string) => input.resolver(ticker).price,
		input.caps
	);

	const fuelUnitsPerDay: IRaukkMaterialUnits = raukkFuelUnitsPerDay(
		pairs,
		result
	);

	if (!input.shippingConfig.enabled)
		return { shipping: result, fuelUnitsPerDay };

	return {
		shipping: mergeClaimedShipping(
			result,
			pairs,
			planClaimedFlows(input.planUuid, input.planetNaturalId),
			input.planetNaturalId,
			input.planUuid
		),
		fuelUnitsPerDay,
	};
}

/**
 * Loads CX preference prices, sell prices and exchange data of the
 * given tickers.
 *
 * A ticker that fails to price degrades to 0 with a console warning
 * instead of rejecting the whole load: `usePrice` already resolves
 * unknown materials and missing exchange data to 0, so one broken
 * ticker must not take the tools numbers down with it.
 *
 * @author raukk
 *
 * @param {object} params Load Parameters
 * @returns {Promise<IRaukkPriceCaches>} Price Caches
 */
async function loadRaukkPrices(params: {
	tickers: string[];
	exchangeCode: string;
	getPrice: (ticker: string, type: "BUY" | "SELL") => Promise<number>;
	getExchangeTicker: (
		exchangeTicker: string
	) => Promise<IRaukkExchangePrices>;
	getMaterial: (ticker: string) => Promise<IMaterial>;
}): Promise<IRaukkPriceCaches> {
	const defaultPrices: Record<string, number> = {};
	const sellPrices: Record<string, number> = {};
	const exchangePrices: Record<string, IRaukkExchangePrices> = {};
	const dimensions: Record<string, IRaukkCargoDimension> = {};

	await Promise.all(
		params.tickers.map(async (ticker) => {
			try {
				const material: IMaterial = await params.getMaterial(ticker);

				dimensions[ticker] = {
					weightPerUnit: material.weight,
					volumePerUnit: material.volume,
				};
			} catch {
				// unknown material: the ticker stays without dimensions and
				// ships weightless, as it did before it was cargo at all
			}

			try {
				defaultPrices[ticker] = await params.getPrice(ticker, "BUY");
				sellPrices[ticker] = await params.getPrice(ticker, "SELL");
			} catch (error) {
				defaultPrices[ticker] = 0;
				sellPrices[ticker] = 0;

				console.warn(
					`[raukk] price of '${ticker}' unavailable, using 0`,
					error
				);
			}

			try {
				exchangePrices[ticker] = await params.getExchangeTicker(
					`${ticker}.${params.exchangeCode}`
				);
			} catch {
				// thinly traded or unknown exchange, price modes
				// resolve to 0 as usePrice does as well
			}
		})
	);

	return { defaultPrices, sellPrices, exchangePrices, dimensions };
}

/**
 * Computes one plans snapshot and stores it.
 *
 * This is the whole pipeline — price load, source resolver, true costs,
 * aggregate draw splitting, base fraction, store write — detached from
 * any component: {@link useRaukkSnapshot} runs it for the plan the
 * sourcing tool is open on, `useRaukkChainRecompute` runs it for every
 * plan of a dependency chain and `useRaukkAutoSnapshot` keeps the open
 * plans snapshot current. Prices are returned alongside the stored
 * snapshot so a caller displaying live numbers can adopt exactly the
 * ones the frozen values were computed from.
 *
 * A plan may source from itself — own output feeding own repairs — in
 * which case the pipeline reruns against its own freshly stored value
 * until the numbers settle (a fixed point exists because the self drawn
 * share is a fraction of the total cost) or the iteration cap is hit.
 * Cross plan loops settle the same way, but across chain recompute
 * passes instead of within one call.
 *
 * Aggregate draws are pre split into concrete producer uuids before
 * storing, the persisted `draws` keys are always plan uuids. The base
 * fraction is derived from those concrete draws and the stored
 * snapshots of the sources, it is frozen with the rest. The effective
 * input prices and the market sell prices of the outputs are frozen
 * alongside, they back the read only sourced cost notes.
 *
 * @author raukk
 *
 * @param {IRaukkPlanSnapshotContext} context Plan Context
 * @returns {Promise<IRaukkPlanSnapshotResult>} Snapshot and Prices
 */
export async function computePlanSnapshot(
	context: IRaukkPlanSnapshotContext
): Promise<IRaukkPlanSnapshotResult> {
	const planningStore = usePlanningStore();
	const sourcingStore = useRaukkSourcingStore();

	const cxUuid: Ref<string | undefined> = ref(context.cxUuid);
	const { getPrice } = await usePrice(cxUuid, ref(context.planetNaturalId));
	const { getExchangeTicker } = await useExchangeData();
	const { getMaterial } = useMaterialData();

	let cxData: ICXData | undefined = undefined;

	if (context.cxUuid) {
		try {
			cxData = planningStore.getCX(context.cxUuid).cx_data;
		} catch {
			cxData = undefined;
		}
	}

	const shippingConfig: IRaukkShippingConfig = inertClone(
		sourcingStore.shippingConfig
	);

	const prices: IRaukkPriceCaches = await loadRaukkPrices({
		tickers: collectRelevantTickers(
			context.planResult,
			shippingConfig.enabled
		),
		exchangeCode: resolveCxExchangeCode(cxData, context.planetNaturalId),
		getPrice,
		getExchangeTicker,
		getMaterial,
	});

	const getProducers = (ticker: string): IRaukkProducerOption[] =>
		sourcingStore.producersOf(ticker);

	/**
	 * One full snapshot computation against the current store state.
	 * Reads the configuration and the producer snapshots live, so a
	 * rerun after a store write picks up the plans own new value.
	 */
	function computeOnce(): IRaukkSnapshot {
		const config: IRaukkPlanConfig = sourcingStore.getConfig(
			context.planUuid
		);

		const resolver: IRaukkPriceResolver = createRaukkPriceResolver({
			sources: config.sources,
			getExchange: (ticker: string) => prices.exchangePrices[ticker],
			getDefaultPrice: (ticker: string) =>
				prices.defaultPrices[ticker] ?? 0,
			getProducers,
		});

		const repairBuildings: IRaukkRepairBuilding[] =
			context.planResult.production.buildings.map((building) => ({
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
			calculateRepairMaterialsPerDay(
				repairBuildings,
				config.repairDay
			).total;

		/*
		 * Lease delegation. A lease reads no cargo of its own leases —
		 * links are never chained — and its cadence override never
		 * governs anything: the host flies the site and its caps decide.
		 */
		const delegated: boolean = config.leaseHostPlanUuid !== undefined;

		const leaseCargo: IRaukkLeaseCargo[] = delegated
			? []
			: sourcingStore
					.leasesOf(context.planUuid)
					.map(
						(leaseUuid) =>
							sourcingStore.snapshots[leaseUuid]?.leaseCargo
					)
					.filter(
						(cargo): cargo is IRaukkLeaseCargo =>
							cargo !== undefined
					);

		const shippingInput: IRaukkShippingInput = {
			planUuid: context.planUuid,
			planetNaturalId: context.planetNaturalId,
			planResult: context.planResult,
			resolver,
			getProducers,
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

		const { shipping, fuelUnitsPerDay } =
			computePlanShipping(shippingInput);

		const repairCost: IRaukkRepairCost = calculateRepairCostPerDay(
			repairBuildings,
			config.repairDay,
			(ticker: string) =>
				resolver(ticker).price + (shipping.inbound[ticker] ?? 0)
		);

		const result: IRaukkTrueCostResult = calculateTrueCosts({
			planResult: context.planResult,
			repairCostPerDayByBuilding: repairCost.perBuilding,
			repairMaterialUnitsPerDay: repairCost.materialUnitsPerDay,
			resolveInputPrice: resolver,
			shippingPerUnitIn: shipping.inbound,
			shippingPerUnitOut: shipping.outbound,
		});

		const draws: Record<string, IRaukkMaterialUnits> = splitAggregateDraws(
			withFuelDraws(result.draws, fuelUnitsPerDay, resolver),
			getProducers
		);

		const inputPrices: Record<string, number> = {};
		buildInputRows(
			context.planResult,
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
					? resolveLocalPrice(
							localSale,
							prices.exchangePrices[ticker]
						)
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
				context.planResult.storage === undefined ||
				context.planResult.materialio === undefined
			)
				return null;

			return raukkStorageFilledDays(
				getWeightOfAllStorages(context.planResult.storage),
				getVolumeOfAllStorages(context.planResult.storage),
				context.planResult.materialio
			);
		}

		/*
		 * Shipping is account global: the configuration it was frozen
		 * with is embedded, and only while it is enabled. A snapshot
		 * computed with shipping off stays byte identical to the ones
		 * written before the shipping model existed.
		 */
		return {
			computedAt: new Date().toISOString(),
			stale: false,
			planName: context.planName,
			planetNaturalId: context.planetNaturalId,
			outputs: inertClone(result.outputs),
			draws,
			config: shippingConfig.enabled
				? { ...inertClone(config), shipping: shippingConfig }
				: inertClone(config),
			baseFraction: calculateBaseFraction(
				draws,
				(sourcePlanUuid) => sourcingStore.getSnapshot(sourcePlanUuid),
				context.planUuid
			),
			inputPrices,
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
							advisories: shipping.advisories,
							shippingFraction: shipping.shippingFraction,
							storageFilledDays: planStorageFilledDays(),
						}
				: {}),
		};
	}

	let snapshot: IRaukkSnapshot = computeOnce();
	sourcingStore.setSnapshot(context.planUuid, snapshot);

	// self supply fixed point: rerun against the own stored value until
	// the outputs settle, see the function doc
	for (
		let iteration = 1;
		snapshot.draws[context.planUuid] !== undefined &&
		iteration < RAUKK_SELF_LOOP_MAX_ITERATIONS;
		iteration++
	) {
		const next: IRaukkSnapshot = computeOnce();
		const settled: boolean = outputsSettled(snapshot.outputs, next.outputs);

		snapshot = next;
		sourcingStore.setSnapshot(context.planUuid, snapshot);

		if (settled) break;
	}

	return { snapshot, prices };
}

/**
 * Everything the sourcing tool needs to price, display and freeze one
 * plans true output costs.
 *
 * Prices are pulled asynchronously and cached in local state, the actual
 * cost math stays synchronous: `calculateTrueCosts` gets a resolver that
 * only reads that cache, the plans sourcing configuration and the stored
 * snapshots of the producing plans.
 *
 * Nothing is written to the store until `computeSnapshot` is called, the
 * displayed numbers are always live while the stored snapshot stays the
 * frozen value other plans consume.
 *
 * @author raukk
 *
 * @param {IRaukkSnapshotContext} context Plan Context
 * @returns Sourcing tool state and actions
 */
export async function useRaukkSnapshot(context: IRaukkSnapshotContext) {
	const planningStore = usePlanningStore();
	const sourcingStore = useRaukkSourcingStore();

	const { getPrice } = await usePrice(
		context.cxUuid,
		context.planetNaturalId
	);
	const { getExchangeTicker } = await useExchangeData();
	const { getMaterial } = useMaterialData();

	// price caches, filled by refreshPrices
	const defaultPrices: Ref<Record<string, number>> = ref({});
	const sellPrices: Ref<Record<string, number>> = ref({});
	const exchangePrices: Ref<Record<string, IRaukkExchangePrices>> = ref({});
	/** Cargo dimensions, the repair materials need them */
	const dimensions: Ref<Record<string, IRaukkCargoDimension>> = ref({});

	// must read through the reactive store state, not getConfig: its
	// inert clone drops the proxy, nested source changes would not
	// invalidate this computed
	const config: ComputedRef<IRaukkPlanConfig> = computed(() => {
		const stored: IRaukkPlanConfig | undefined =
			sourcingStore.configs[context.planUuid.value ?? ""];

		if (!stored)
			return sourcingStore.getConfig(context.planUuid.value ?? "");

		return {
			repairDay: stored.repairDay,
			sources: { ...stored.sources },
			localSales: { ...stored.localSales },
			cadence: { ...stored.cadence },
			cxAnchor: stored.cxAnchor,
			leaseHostPlanUuid: stored.leaseHostPlanUuid,
		};
	});

	const cxData: ComputedRef<ICXData | undefined> = computed(() => {
		if (!context.cxUuid.value) return undefined;

		try {
			return planningStore.getCX(context.cxUuid.value).cx_data;
		} catch {
			return undefined;
		}
	});

	/**
	 * Producers of a ticker, the plan itself included: production and
	 * workforce self consumption is netted by the material I/O already,
	 * but repair demand is not — own output feeding own repairs is a
	 * legitimate source edge.
	 */
	function getProducers(ticker: string): IRaukkProducerOption[] {
		return sourcingStore.producersOf(ticker);
	}

	const resolver: ComputedRef<IRaukkPriceResolver> = computed(() =>
		createRaukkPriceResolver({
			sources: config.value.sources,
			getExchange: (ticker: string) => exchangePrices.value[ticker],
			getDefaultPrice: (ticker: string) =>
				defaultPrices.value[ticker] ?? 0,
			getProducers,
		})
	);

	const repairBuildings: ComputedRef<IRaukkRepairBuilding[]> = computed(() =>
		context.planResult.value.production.buildings.map((building) => ({
			name: building.name,
			amount: building.amount,
			constructionMaterials: building.constructionMaterials,
		}))
	);

	/** Repair demand in UNITS, cargo of the repair bucket */
	const repairUnitsPerDay: ComputedRef<IRaukkMaterialUnits> = computed(
		() =>
			calculateRepairMaterialsPerDay(
				repairBuildings.value,
				config.value.repairDay
			).total
	);

	const shippingConfig: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	/** Days per visit per cargo bucket this plan may not exceed */
	const caps: ComputedRef<IRaukkCadenceCaps> = computed(() =>
		raukkCadenceCaps(
			shippingConfig.value,
			config.value.repairDay,
			config.value.cadence
		)
	);

	const shippingInput: ComputedRef<IRaukkShippingInput> = computed(() => ({
		planUuid: context.planUuid.value ?? "",
		planetNaturalId: context.planetNaturalId.value ?? "",
		planResult: context.planResult.value,
		resolver: resolver.value,
		getProducers,
		shippingConfig: shippingConfig.value,
		sources: config.value.sources,
		localSales: config.value.localSales ?? {},
		repairUnitsPerDay: repairUnitsPerDay.value,
		dimensionOf: (ticker: string) => dimensions.value[ticker],
		caps: caps.value,
		cxAnchor: config.value.cxAnchor,
		// the displayed numbers are the frozen ones a computation would
		// write: a lease shows no freight, a host shows its leases cargo
		delegated: config.value.leaseHostPlanUuid !== undefined,
		leaseCargo:
			config.value.leaseHostPlanUuid !== undefined
				? []
				: sourcingStore
						.leasesOf(context.planUuid.value ?? "")
						.map(
							(leaseUuid) =>
								sourcingStore.snapshots[leaseUuid]?.leaseCargo
						)
						.filter(
							(cargo): cargo is IRaukkLeaseCargo =>
								cargo !== undefined
						),
	}));

	/** Live shipping of the pairs this plan owns, empty while disabled */
	const planShipping: ComputedRef<IRaukkPlanShipping> = computed(() =>
		computePlanShipping(shippingInput.value)
	);

	const shipping: ComputedRef<IRaukkShippingResult> = computed(
		() => planShipping.value.shipping
	);

	/** Ship fuel the plans own lanes burn per day, empty while disabled */
	const fuelUnitsPerDay: ComputedRef<IRaukkMaterialUnits> = computed(
		() => planShipping.value.fuelUnitsPerDay
	);

	/**
	 * Repair capital cost, freight INCLUDED: repair materials are cargo
	 * since the cadence model, so what a repair costs is the material
	 * plus getting it there. Units are priced before the freight is
	 * known, see {@link computePlanSnapshot} — only the cost waits.
	 */
	const repairCost: ComputedRef<IRaukkRepairCost> = computed(() =>
		calculateRepairCostPerDay(
			repairBuildings.value,
			config.value.repairDay,
			(ticker: string) =>
				resolver.value(ticker).price +
				(shipping.value.inbound[ticker] ?? 0)
		)
	);

	/** The pairs themselves, the LM rate comparison prices them again */
	const shippingPairs: ComputedRef<IRaukkShippingPair[]> = computed(() =>
		buildPlanShippingPairs(shippingInput.value)
	);

	/** ȼ of one full ship repair bill at the plans configured sources */
	const repairBillCost: ComputedRef<number> = computed(() =>
		calculateRepairBillCost(
			(ticker: string) => resolver.value(ticker).price
		)
	);

	const trueCost: ComputedRef<IRaukkTrueCostResult> = computed(() =>
		calculateTrueCosts({
			planResult: context.planResult.value,
			repairCostPerDayByBuilding: repairCost.value.perBuilding,
			repairMaterialUnitsPerDay: repairCost.value.materialUnitsPerDay,
			resolveInputPrice: resolver.value,
			shippingPerUnitIn: shipping.value.inbound,
			shippingPerUnitOut: shipping.value.outbound,
		})
	);

	// sorted at the CX preference price so configuring a source does not
	// reorder the table
	const inputRows: ComputedRef<IRaukkInputRow[]> = computed(() =>
		buildInputRows(
			context.planResult.value,
			repairCost.value.materialUnitsPerDay,
			config.value.sources,
			resolver.value,
			shipping.value.inbound,
			(ticker: string) => defaultPrices.value[ticker] ?? 0,
			fuelUnitsPerDay.value
		)
	);

	// the live mirror of the frozen sell prices, see {@link
	// computePlanSnapshot}: an LM sold ticker shows its local price here
	// as well, before any snapshot is stored
	const outputRows: ComputedRef<IRaukkOutputRow[]> = computed(() =>
		Object.values(trueCost.value.outputs)
			.map((output) => {
				const localSale: IRaukkLocalPrice | undefined =
					config.value.localSales?.[output.ticker];

				const marketPrice: number =
					localSale !== undefined
						? resolveLocalPrice(
								localSale,
								exchangePrices.value[output.ticker]
							)
						: (sellPrices.value[output.ticker] ?? 0);

				return {
					ticker: output.ticker,
					unitsPerDay: output.unitsPerDay,
					costPerUnit: output.costPerUnit,
					breakdown: output.breakdown,
					marketPrice,
					marginPerUnit: marketPrice - output.costPerUnit,
				};
			})
			.sort((a, b) => b.unitsPerDay - a.unitsPerDay)
	);

	/** Stored snapshot of this plan, undefined until first computation */
	const snapshot: ComputedRef<IRaukkSnapshot | undefined> = computed(() =>
		context.planUuid.value
			? sourcingStore.snapshots[context.planUuid.value]
			: undefined
	);

	/** Producers the current configuration draws from. The plan itself
	 * is skipped, its own staleness is surfaced by the snapshot tag. */
	const usedSources: ComputedRef<IRaukkProducerOption[]> = computed(() => {
		const seen: Set<string> = new Set();
		const result: IRaukkProducerOption[] = [];

		Object.entries(config.value.sources).forEach(([ticker, source]) => {
			if (source.mode !== "plan") return;

			getProducers(ticker)
				.filter(
					(producer) =>
						producer.planUuid !== context.planUuid.value &&
						(source.sourcePlanUuid === "AGG_AVG" ||
							source.sourcePlanUuid === "AGG_MAX" ||
							source.sourcePlanUuid === producer.planUuid)
				)
				.forEach((producer) => {
					if (seen.has(producer.planUuid)) return;

					seen.add(producer.planUuid);
					result.push(producer);
				});
		});

		return result;
	});

	/** Upstream snapshots feeding this plan that are flagged stale */
	const staleSources: ComputedRef<IRaukkProducerOption[]> = computed(() =>
		usedSources.value.filter((producer) => producer.stale)
	);

	/**
	 * Source dropdown entries of one ticker.
	 *
	 * @author raukk
	 *
	 * @param {string} ticker Material Ticker
	 * @param {number} prospectiveDrawPerDay Daily need of this plan
	 * @returns {IRaukkSourceOption[]} Dropdown Options
	 */
	function sourceOptions(
		ticker: string,
		prospectiveDrawPerDay: number
	): IRaukkSourceOption[] {
		return buildSourceOptions({
			ticker,
			consumerPlanUuid: context.planUuid.value,
			prospectiveDrawPerDay,
			producers: getProducers(ticker),
			subscriptionOf: sourcingStore.subscription,
			snapshots: sourcingStore.snapshots,
		});
	}

	/** All tickers the tool needs prices for */
	const relevantTickers: ComputedRef<string[]> = computed(() =>
		collectRelevantTickers(
			context.planResult.value,
			shippingConfig.value.enabled
		)
	);

	const isRefreshing: Ref<boolean> = ref(false);

	/**
	 * Reloads CX preference prices, sell prices and exchange data of all
	 * relevant tickers into the local caches.
	 *
	 * Single tickers that fail to price degrade to 0, see
	 * {@link loadRaukkPrices}. The refreshing flag is always reset, even
	 * when something throws.
	 *
	 * @author raukk
	 */
	async function refreshPrices(): Promise<void> {
		isRefreshing.value = true;

		try {
			adoptPrices(
				await loadRaukkPrices({
					tickers: relevantTickers.value,
					exchangeCode: resolveCxExchangeCode(
						cxData.value,
						context.planetNaturalId.value
					),
					getPrice,
					getExchangeTicker,
					getMaterial,
				})
			);
		} finally {
			isRefreshing.value = false;
		}
	}

	/**
	 * Takes over a set of loaded prices as the displayed ones.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkPriceCaches} prices Price Caches
	 */
	function adoptPrices(prices: IRaukkPriceCaches): void {
		defaultPrices.value = prices.defaultPrices;
		sellPrices.value = prices.sellPrices;
		exchangePrices.value = prices.exchangePrices;
		dimensions.value = prices.dimensions;
	}

	/**
	 * Computes and stores this plans snapshot through the shared
	 * {@link computePlanSnapshot} pipeline and adopts the prices it was
	 * computed with, the displayed numbers therefore match the frozen
	 * ones exactly.
	 *
	 * @author raukk
	 *
	 * @returns {Promise<boolean>} Snapshot was stored
	 */
	async function computeSnapshot(): Promise<boolean> {
		const planUuid: string | undefined = context.planUuid.value;
		if (!planUuid) return false;

		isRefreshing.value = true;

		try {
			const { prices } = await computePlanSnapshot({
				planUuid,
				planName: context.planName.value,
				planetNaturalId: context.planetNaturalId.value ?? "",
				cxUuid: context.cxUuid.value,
				planResult: context.planResult.value,
			});

			adoptPrices(prices);
		} finally {
			isRefreshing.value = false;
		}

		return true;
	}

	watch(
		() => relevantTickers.value.join("#"),
		async () => await refreshPrices()
	);

	await refreshPrices();

	return {
		config,
		shippingConfig,
		caps,
		shipping,
		shippingPairs,
		repairBillCost,
		inputRows,
		outputRows,
		repairCost,
		snapshot,
		staleSources,
		isRefreshing,
		sourceOptions,
		refreshPrices,
		computeSnapshot,
	};
}
