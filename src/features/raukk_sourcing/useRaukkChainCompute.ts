import { ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";

// Calculations
import {
	calculateChainCxSplit,
	calculateChainShipping,
	raukkChainGateServable,
	RAUKK_CX_SYSTEM_ID_BY_CODE,
} from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkStlOnlyCandidates } from "@/features/raukk_sourcing/calculations/shippingStl";
import {
	raukkAutoChainDemand,
	raukkBuildAutoChains,
} from "@/features/raukk_sourcing/calculations/shippingAutoChains";
import { calculateRepairBillCost } from "@/features/raukk_sourcing/calculations/shipping";
import { RAUKK_REPAIR_TICKERS } from "@/features/raukk_sourcing/calculations/shippingRepair";
import {
	RAUKK_FUEL_TICKERS,
	raukkResolveShipProfile,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	raukkChainAssignmentKey,
	raukkOwnedHullCandidates,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import { raukkPickHull } from "@/features/raukk_sourcing/calculations/shippingHull";
import { raukkCxAnchorCode } from "@/features/raukk_sourcing/calculations/shippingFlows";
import {
	RAUKK_DEFAULT_CADENCE_REPAIR_DAYS,
	raukkCadenceCaps,
	raukkCapDaysOf,
} from "@/features/raukk_sourcing/calculations/shippingCadence";

// Types & Interfaces
import {
	IRaukkChain,
	IRaukkChainConfig,
	IRaukkChainFlow,
	IRaukkChainFlowCost,
	IRaukkChainCosting,
	IRaukkChainResult,
	IRaukkPlanConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkFleetAdvisory,
	IRaukkHullCandidate,
	IRaukkHullPick,
	IRaukkLegDemand,
	IRaukkShippingConfig,
	IRaukkResolvedShipProfile,
	IRaukkShippingPriceResolver,
	RAUKK_CARGO_BUCKET,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainFlowResult,
	IRaukkChainInput,
	IRaukkChainShipping,
	IRaukkCxSplitResult,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { IRaukkAutoChain } from "@/features/raukk_sourcing/calculations/shippingAutoChains.types";

/**
 * Tickers the account level chain step needs prices for: the four ship
 * repair bill tickers and the two fuels the derived ȼ constants are
 * priced with. No cargo price is ever needed — a chain moves freight, it
 * does not value it.
 *
 * @author raukk
 */
export const RAUKK_CHAIN_PRICE_TICKERS: string[] = [
	...RAUKK_REPAIR_TICKERS,
	RAUKK_FUEL_TICKERS.ftl,
	RAUKK_FUEL_TICKERS.stl,
];

/** Loads the freight prices one chain is costed with */
export type IRaukkChainPriceLoader = (
	planetNaturalId: string | undefined
) => Promise<IRaukkShippingPriceResolver>;

/**
 * Prices of the repair bill and the two fuels at one planets exchange
 * preference.
 *
 * A chain has no single owning plan, so it is priced at its first PLANET
 * stop — the anchor the user authored it from. A ticker that fails to
 * price degrades to 0, exactly as the snapshot pipeline does.
 *
 * @author raukk
 *
 * @param {string | undefined} planetNaturalId Anchor Planet
 * @returns {Promise<IRaukkShippingPriceResolver>} Unit price lookup
 */
export const raukkLoadChainPrices: IRaukkChainPriceLoader = async (
	planetNaturalId: string | undefined
) => {
	const { getPrice } = await usePrice(ref(undefined), ref(planetNaturalId));

	const prices: Record<string, number> = {};

	await Promise.all(
		RAUKK_CHAIN_PRICE_TICKERS.map(async (ticker) => {
			try {
				prices[ticker] = await getPrice(ticker, "BUY");
			} catch {
				prices[ticker] = 0;
			}
		})
	);

	return (ticker: string): number => prices[ticker] ?? 0;
};

/** One chain the pass could not compute */
export interface IRaukkChainComputeError {
	chainId: string;
	message: string;
}

/** The costing that was actually applied, split or not */
interface IRaukkAppliedCosting {
	results: IRaukkChainShipping[];
	splitApplied: boolean;
}

/** The lane identity a claim and a plan flow have in common */
interface IRaukkChainLane {
	ownerPlanUuid?: string;
	ticker: string;
	fromStop: string;
	toStop: string;
}

/** One computed chain plus the flow ids it took off the account */
interface IRaukkComputedChain {
	result: IRaukkChainResult;
	claimedFlowIds: string[];
}

/** One chain costing, reduced to the numbers the store keeps */
function storedCosting(
	stops: string[],
	result: IRaukkChainShipping
): IRaukkChainCosting {
	return {
		stops: [...stops],
		tripsPerDay: result.tripsPerDay,
		roundTripMinutes: result.roundTripMinutes,
		bindingLegIndex: result.bindingLegIndex,
		dailyCost: result.dailyCost,
		shippingFraction: result.shippingFraction,
	};
}

/**
 * Flow id a split half came from.
 *
 * `buildCxSplitChains` rewrites a crossing flow into `<id>>cx` and
 * `cx><id>`, both of which still have to be charged to the ONE lane the
 * member plan authored.
 *
 * @author raukk
 *
 * @param {string} flowId Flow Id of a costing result
 * @returns {string} Flow Id of the original plan flow
 */
function originalFlowId(flowId: string): string {
	if (flowId.startsWith("cx>")) return flowId.slice(3);
	if (flowId.endsWith(">cx")) return flowId.slice(0, -3);

	return flowId;
}

/**
 * Charges every original plan flow with what the applied costings billed
 * it, halves of a CX split summed back together.
 *
 * Flow ids are unique per OWNING plan and per occurrence (see
 * `raukkFlowId`), so no two flows share a bucket here — a shared
 * one would charge each of them the sum of both.
 *
 * @author raukk
 *
 * @param {IRaukkChainFlow[]} flows Original plan flows of the chain
 * @param {IRaukkChainShipping[]} results Applied costings
 * @returns {IRaukkChainFlowCost[]} Claimed flows and their ȼ per unit
 */
function claimedFlowCosts(
	flows: IRaukkChainFlow[],
	results: IRaukkChainShipping[]
): IRaukkChainFlowCost[] {
	const daily: Map<string, number> = new Map();

	results.forEach((result) =>
		result.flows.forEach((flow: IRaukkChainFlowResult) => {
			const id: string = originalFlowId(flow.flowId);

			daily.set(id, (daily.get(id) ?? 0) + flow.dailyCost);
		})
	);

	const costs: IRaukkChainFlowCost[] = [];

	flows.forEach((flow, index) => {
		const id: string = flow.flowId ?? `${index}`;
		const dailyCost: number | undefined = daily.get(id);

		if (dailyCost === undefined) return;

		const units: number = Math.max(flow.unitsPerDay, 0);

		costs.push({
			ownerPlanUuid: flow.ownerPlanUuid,
			sourcePlanUuid: flow.sourcePlanUuid,
			ticker: flow.ticker,
			fromStop: flow.fromStop,
			toStop: flow.toStop,
			unitsPerDay: flow.unitsPerDay,
			costPerUnit: units > 0 ? dailyCost / units : 0,
		});
	});

	return costs;
}

/** ȼ per unit per ticker over all claimed flows, units weighted */
function mergedPerUnit(costs: IRaukkChainFlowCost[]): Record<string, number> {
	const cost: Record<string, number> = {};
	const units: Record<string, number> = {};

	costs.forEach((flow) => {
		const daily: number = Math.max(flow.unitsPerDay, 0);
		if (daily <= 0) return;

		cost[flow.ticker] = (cost[flow.ticker] ?? 0) + flow.costPerUnit * daily;
		units[flow.ticker] = (units[flow.ticker] ?? 0) + daily;
	});

	const perUnit: Record<string, number> = {};

	Object.entries(units).forEach(([ticker, daily]) => {
		perUnit[ticker] = cost[ticker] / daily;
	});

	return perUnit;
}

/**
 * Computes and stores the result of every chain.
 *
 * The load bearing rule of the whole v2 model (shipping-chains-v2.md,
 * "Architecture"): a chains trips depend on EVERY member plans flows, so
 * it is never computed live inside one plans snapshot. It is an account
 * level step over the STORED snapshots frozen flows — the same treatment
 * the base fraction and the subscription percentages get — run after the
 * member snapshots inside the recompute chain pass.
 *
 * Convergence, accepted and documented rather than fought: the flows a
 * chain reads were frozen by the snapshots of the PREVIOUS pass, and
 * those snapshots in turn priced their claimed flows from the previous
 * chain result. Numbers therefore settle one round later, exactly like
 * the subscription data of v1.
 *
 * Both costings — the authored loop and the CX split — are always
 * computed and stored; which one is APPLIED follows the per chain
 * `autoCxSplit` override and, absent it, the account default.
 *
 * With shipping disabled nothing is computed and the AUTHORED results
 * stay untouched — they are inert while shipping is off and are the
 * users own data. The DERIVED ones are purged instead: they are rebuilt
 * from scratch on every pass anyway, and a set left behind would keep
 * claiming freight the moment shipping is switched back on, before any
 * pass had a chance to rebuild it. Snapshots stay byte identical to the
 * pre shipping ones either way.
 *
 * ORDER, the rule of phase 2: the user authored chains claim their flows
 * FIRST and the automatic builder runs on what is left. An authored loop
 * is a decision, a derived one is a suggestion — a suggestion never takes
 * cargo off a decision.
 *
 * @author raukk
 *
 * @param {IRaukkChainPriceLoader} loadPrices Freight price loader
 * @returns {Promise<IRaukkChainComputeError[]>} Chains that failed
 */
export async function computeChainResults(
	loadPrices: IRaukkChainPriceLoader = raukkLoadChainPrices
): Promise<IRaukkChainComputeError[]> {
	const sourcingStore = useRaukkSourcingStore();

	const shippingConfig: IRaukkShippingConfig = sourcingStore.shippingConfig;
	const errors: IRaukkChainComputeError[] = [];

	if (!shippingConfig.enabled) {
		// nothing may be left claiming that this pass did not compute; the
		// pins are kept, the derived set they name is rebuilt on the first
		// pass after shipping comes back
		sourcingStore.setAutoChainResults([], false);

		return errors;
	}

	const chainConfig: IRaukkChainConfig = sourcingStore.chainConfig;

	/** Flows the authored chains already took over */
	const claimedFlowIds: Set<string> = new Set();
	/** Lanes an OLD authored result still claims, its chain having failed */
	const claimedLanes: Set<string> = new Set();

	for (const chain of Object.values(sourcingStore.chains) as IRaukkChain[]) {
		try {
			const computed: IRaukkComputedChain = await computeOneChain(
				chain,
				shippingConfig,
				chainConfig,
				loadPrices
			);

			sourcingStore.setChainResult(chain.chainId, computed.result);
			computed.claimedFlowIds.forEach((flowId) =>
				claimedFlowIds.add(flowId)
			);
		} catch (error) {
			errors.push({
				chainId: chain.chainId,
				message:
					error instanceof Error ? error.message : "unknown error",
			});

			/*
			 * The stored result of a failed chain KEEPS claiming: the
			 * member plans price their freight from it, and deleting it
			 * would drop that freight until the next successful pass. It is
			 * flagged stale so the user sees the numbers are old, and the
			 * lanes it claims are withheld from the automatic pass — a
			 * derived loop taking cargo the stored result still charges
			 * would bill the very same freight twice.
			 */
			sourcingStore.markChainResultStale(chain.chainId);
			(sourcingStore.chainResults[chain.chainId]?.flows ?? []).forEach(
				(flow: IRaukkChainFlowCost) =>
					claimedLanes.add(claimedLaneKey(flow))
			);
		}
	}

	try {
		sourcingStore.setAutoChainResults(
			await computeAutoChains(
				claimedFlowIds,
				claimedLanes,
				shippingConfig,
				chainConfig,
				loadPrices
			)
		);
	} catch (error) {
		errors.push({
			chainId: "",
			message: error instanceof Error ? error.message : "unknown error",
		});

		/*
		 * Wholesale replacement holds on failure as well: the previous
		 * derived set was built from flows this pass could not even read,
		 * and leaving it live and fresh would let loops nothing vouches
		 * for keep claiming. Purging costs the freight of one pass — the
		 * plans fall back to their own lanes and the exchange hub/spoke,
		 * which is exactly the state before any chain existed — while
		 * keeping it costs correctness. The pins survive, see
		 * `setAutoChainResults`.
		 */
		sourcingStore.setAutoChainResults([], false);
	}

	return errors;
}

/**
 * Lane identity of one claimed flow: owner, ticker and both endpoints.
 *
 * Deliberately coarser than the flow id — several occurrences of one
 * lane share a key — because it guards an ERROR path, where withholding
 * one occurrence too many only sends that cargo through the exchange,
 * while withholding one too few would claim it twice.
 *
 * @author raukk
 *
 * @param {IRaukkChainLane} flow Claimed flow or plan flow
 * @returns {string} Lane Key
 */
function claimedLaneKey(flow: IRaukkChainLane): string {
	return `${flow.ownerPlanUuid ?? ""}|${flow.ticker}|${flow.fromStop}|${
		flow.toStop
	}`;
}

/**
 * Flows of every stored snapshot the authored chains did not claim.
 *
 * Frozen flows only, never live numbers — the very rule the authored
 * chains follow, for the very same reason: a derived loop depends on
 * every member plans cargo and cannot be built inside one plans snapshot.
 *
 * @author raukk
 *
 * @param {Set<string>} claimedFlowIds Flow ids the authored chains took
 * @param {Set<string>} claimedLanes Lanes a failed chains result claims
 * @returns {IRaukkChainFlow[]} Unclaimed flows, account wide
 */
function unclaimedAccountFlows(
	claimedFlowIds: Set<string>,
	claimedLanes: Set<string>
): IRaukkChainFlow[] {
	const sourcingStore = useRaukkSourcingStore();

	return Object.entries(sourcingStore.snapshots)
		.sort(([left], [right]) => (left < right ? -1 : 1))
		.flatMap(([planUuid, snapshot]: [string, IRaukkSnapshot]) =>
			(snapshot.flows ?? []).filter(
				(flow, index) =>
					!claimedFlowIds.has(
						flow.flowId ?? `${planUuid}#${index}`
					) && !claimedLanes.has(claimedLaneKey(flow))
			)
		);
}

/**
 * Cadence cap of one consuming plan for one cargo class.
 *
 * @author raukk
 *
 * @param {string | undefined} planUuid Consuming Plan Uuid
 * @param {RAUKK_CARGO_BUCKET} bucket Cargo bucket
 * @param {IRaukkShippingConfig} shippingConfig Shipping configuration
 * @returns {number} Days per visit
 */
function planCapDays(
	planUuid: string | undefined,
	bucket: RAUKK_CARGO_BUCKET,
	shippingConfig: IRaukkShippingConfig
): number {
	const sourcingStore = useRaukkSourcingStore();

	const config: IRaukkPlanConfig | undefined =
		planUuid === undefined ? undefined : sourcingStore.configs[planUuid];

	return raukkCapDaysOf(
		raukkCadenceCaps(
			shippingConfig,
			config?.repairDay ?? RAUKK_DEFAULT_CADENCE_REPAIR_DAYS,
			config?.cadence
		),
		bucket
	);
}

/**
 * Exchange one planet is anchored at, over the plans sitting on it.
 *
 * Several plans may share a planet; their per plan overrides are read in
 * plan uuid order and the first one wins, so the answer is stable no
 * matter in which order the snapshots were written.
 *
 * @author raukk
 *
 * @param {IRaukkShippingConfig} shippingConfig Shipping configuration
 * @returns {Function} Exchange code of one planet
 */
function planetAnchorLookup(
	shippingConfig: IRaukkShippingConfig
): (planetNaturalId: string) => string | undefined {
	const sourcingStore = useRaukkSourcingStore();

	const overrides: Map<string, string> = new Map();

	Object.keys(sourcingStore.snapshots)
		.sort()
		.forEach((planUuid) => {
			const planet: string | undefined =
				sourcingStore.snapshots[planUuid]?.planetNaturalId;
			const anchor: string | undefined =
				sourcingStore.configs[planUuid]?.cxAnchor;

			if (planet === undefined || anchor === undefined) return;
			if (overrides.has(planet)) return;

			overrides.set(planet, anchor);
		});

	return (planetNaturalId: string): string | undefined =>
		raukkCxAnchorCode(
			planetNaturalId,
			shippingConfig.cxAnchorMode,
			overrides.get(planetNaturalId)
		);
}

/**
 * Builds and costs the chains nobody authored.
 *
 * Derived from the unclaimed flows on every pass and never stored as
 * chains: what the store keeps is their RESULT, marked `auto`, and the
 * next pass replaces the whole set (see `setAutoChainResults`). Member
 * plans read their claimed freight from those results exactly as they do
 * from an authored chains one, so a derived loop needs no special case
 * anywhere downstream.
 *
 * @author raukk
 *
 * @param {Set<string>} claimedFlowIds Flow ids the authored chains took
 * @param {Set<string>} claimedLanes Lanes a failed chains result claims
 * @param {IRaukkShippingConfig} shippingConfig Shipping configuration
 * @param {IRaukkChainConfig} chainConfig Chain configuration
 * @param {IRaukkChainPriceLoader} loadPrices Freight price loader
 * @returns {Promise<IRaukkChainResult[]>} Derived chain results
 */
async function computeAutoChains(
	claimedFlowIds: Set<string>,
	claimedLanes: Set<string>,
	shippingConfig: IRaukkShippingConfig,
	chainConfig: IRaukkChainConfig,
	loadPrices: IRaukkChainPriceLoader
): Promise<IRaukkChainResult[]> {
	const autoChains: IRaukkAutoChain[] = raukkBuildAutoChains({
		flows: unclaimedAccountFlows(claimedFlowIds, claimedLanes),
		anchorOf: planetAnchorLookup(shippingConfig),
		capDaysOf: (planUuid: string | undefined, bucket: RAUKK_CARGO_BUCKET) =>
			planCapDays(planUuid, bucket, shippingConfig),
		chainConfig,
	});

	const results: IRaukkChainResult[] = [];

	for (const autoChain of autoChains) {
		results.push(
			await computeOneAutoChain(
				autoChain,
				shippingConfig,
				chainConfig,
				loadPrices
			)
		);
	}

	return results;
}

/**
 * Costs one derived chain.
 *
 * Hull: a manual assignment on the derived chains key still wins, exactly
 * as it does on an authored one; otherwise the automatic pick runs over
 * the OWNED fleet against the binding legs demand and the loops cadence
 * cap. A better unowned hull never becomes an assignment, it becomes an
 * advisory on the chain — the loop is account level and belongs to no
 * single plan.
 *
 * The CX split is not evaluated: a derived loop already opens and closes
 * at its regions exchange, which is what the split rule exists to
 * arrange.
 *
 * @author raukk
 *
 * @param {IRaukkAutoChain} autoChain Derived chain
 * @param {IRaukkShippingConfig} shippingConfig Shipping configuration
 * @param {IRaukkChainConfig} chainConfig Chain configuration
 * @param {IRaukkChainPriceLoader} loadPrices Freight price loader
 * @returns {Promise<IRaukkChainResult>} Chain Result
 */
async function computeOneAutoChain(
	autoChain: IRaukkAutoChain,
	shippingConfig: IRaukkShippingConfig,
	chainConfig: IRaukkChainConfig,
	loadPrices: IRaukkChainPriceLoader
): Promise<IRaukkChainResult> {
	const sourcingStore = useRaukkSourcingStore();

	const anchorPlanet: string | undefined = autoChain.stops.find(
		(stopRef) => !(stopRef in RAUKK_CX_SYSTEM_ID_BY_CODE)
	);

	const resolvePrice: IRaukkShippingPriceResolver =
		await loadPrices(anchorPlanet);

	const candidateOf = (shipTypeId: string): IRaukkHullCandidate => ({
		shipTypeId,
		profile: raukkResolveShipProfile(
			sourcingStore.getShipProfile(shipTypeId),
			resolvePrice
		),
	});

	const manual: string | undefined =
		sourcingStore.assignments[raukkChainAssignmentKey(autoChain.chainId)];

	const demand: IRaukkLegDemand = raukkAutoChainDemand(
		autoChain.stops,
		autoChain.flows
	);

	/*
	 * raukk: an STL-only hull is only ever OFFERED for a loop it can
	 * actually fly — every leg same system or gate served. The check is
	 * hull independent (no volume cap), so it never depends on the very
	 * pick it gates; a link too narrow for the chosen hull is caught
	 * afterwards, by the per leg validation of `buildChainLegs`.
	 */
	const gateServable: boolean = raukkChainGateServable(autoChain.stops);

	const owned: IRaukkHullPick | null =
		manual !== undefined
			? null
			: raukkPickHull(
					raukkStlOnlyCandidates(
						raukkOwnedHullCandidates(
							sourcingStore.fleet,
							candidateOf
						),
						gateServable
					),
					demand,
					autoChain.capDays
				);

	const profileId: string =
		manual ??
		owned?.candidate.shipTypeId ??
		shippingConfig.defaultProfileId;

	const ideal: IRaukkHullPick | null =
		manual !== undefined
			? null
			: raukkPickHull(
					raukkStlOnlyCandidates(
						sourcingStore
							.listShipProfiles()
							.map((profile) => candidateOf(profile.id)),
						gateServable
					),
					demand,
					autoChain.capDays
				);

	const advisories: IRaukkFleetAdvisory[] =
		ideal !== null && ideal.candidate.shipTypeId !== profileId
			? [
					{
						pairKey: raukkChainAssignmentKey(autoChain.chainId),
						bucket: autoChain.bucket,
						shipTypeId: profileId,
						tripsPerDay: owned?.tripsPerDay ?? 0,
						suggestedShipTypeId: ideal.candidate.shipTypeId,
						suggestedTripsPerDay: ideal.tripsPerDay,
					},
				]
			: [];

	const input: IRaukkChainInput = {
		chain: { chainId: autoChain.chainId, stops: autoChain.stops },
		profile: raukkResolveShipProfile(
			sourcingStore.getShipProfile(profileId),
			resolvePrice
		),
		flows: autoChain.flows,
		config: shippingConfig,
		chainConfig,
		repairBillCost: calculateRepairBillCost(resolvePrice),
		capDays: autoChain.capDays,
	};

	const shipping: IRaukkChainShipping = calculateChainShipping(input);
	const claimed: IRaukkChainFlowCost[] = claimedFlowCosts(autoChain.flows, [
		shipping,
	]);

	return {
		chainId: autoChain.chainId,
		computedAt: new Date().toISOString(),
		stale: false,
		profileId,
		hired: false,
		splitApplied: false,
		unsplit: storedCosting(autoChain.stops, shipping),
		split: [],
		splitTrigger: null,
		tripsPerDay: shipping.tripsPerDay,
		roundTripMinutes: shipping.roundTripMinutes,
		bindingLegIndex: shipping.bindingLegIndex,
		dailyCost: shipping.dailyCost,
		shippingFraction: shipping.shippingFraction,
		shipMinutesPerDay: shipping.tripsPerDay * shipping.roundTripMinutes,
		damagePerDay: shipping.tripsPerDay * shipping.damagePerTrip,
		flows: claimed,
		perUnit: mergedPerUnit(claimed),
		memberPlanUuids: autoChain.memberPlanUuids,
		config: { ...chainConfig },
		auto: true,
		capDays: autoChain.capDays,
		advisories,
	};
}

/**
 * Planet a chain is priced at: the first PLANET stop the user authored
 * that a member plan actually sits on.
 *
 * Derived from the AUTHORED stop order, never from the stored member
 * list — that one follows snapshot record insertion order and would move
 * the anchor around as plans are recomputed. Several plans on one planet
 * name the same planet, so the anchor is unaffected by them; only the
 * fallback for a chain whose stops are all exchanges has to tie break,
 * which it does over sorted member uuids.
 *
 * @author raukk
 *
 * @param {IRaukkChain} chain Chain
 * @param {string[]} memberPlanUuids Member Plan Uuids
 * @returns {(string | undefined)} Anchor planet, undefined without one
 */
function chainAnchorPlanet(
	chain: IRaukkChain,
	memberPlanUuids: string[]
): string | undefined {
	const sourcingStore = useRaukkSourcingStore();

	const planets: Set<string> = new Set(
		memberPlanUuids
			.map(
				(planUuid) => sourcingStore.snapshots[planUuid]?.planetNaturalId
			)
			.filter((planet): planet is string => planet !== undefined)
	);

	return (
		chain.stops.find((stop) => planets.has(stop)) ??
		[...memberPlanUuids]
			.sort()
			.map(
				(planUuid) => sourcingStore.snapshots[planUuid]?.planetNaturalId
			)
			.find((planet) => planet !== undefined)
	);
}

/**
 * Computes one chains result from the stored snapshots of its members.
 *
 * @author raukk
 *
 * @param {IRaukkChain} chain Chain
 * @param {IRaukkShippingConfig} shippingConfig Shipping configuration
 * @param {IRaukkChainConfig} chainConfig Chain configuration
 * @param {IRaukkChainPriceLoader} loadPrices Freight price loader
 * @returns {Promise<IRaukkComputedChain>} Result and claimed flow ids
 */
async function computeOneChain(
	chain: IRaukkChain,
	shippingConfig: IRaukkShippingConfig,
	chainConfig: IRaukkChainConfig,
	loadPrices: IRaukkChainPriceLoader
): Promise<IRaukkComputedChain> {
	const sourcingStore = useRaukkSourcingStore();

	const memberPlanUuids: string[] = sourcingStore.chainMemberPlans(
		chain.stops
	);

	/** Frozen flows of every member plan, never live numbers */
	const flows: IRaukkChainFlow[] = memberPlanUuids.flatMap((planUuid) => {
		const snapshot: IRaukkSnapshot | undefined =
			sourcingStore.snapshots[planUuid];

		return snapshot?.flows ?? [];
	});

	const anchorPlanet: string | undefined = chainAnchorPlanet(
		chain,
		memberPlanUuids
	);

	const resolvePrice: IRaukkShippingPriceResolver =
		await loadPrices(anchorPlanet);

	const profileId: string =
		sourcingStore.assignments[raukkChainAssignmentKey(chain.chainId)] ??
		chain.profileId ??
		shippingConfig.defaultProfileId;

	/*
	 * raukk: a loop cut at an anchor is flown by two ships. Each side
	 * resolves its own hull where the user named one — the gate side
	 * hopper and the FTL hauler of the depot case — and falls back to the
	 * chains own profile, which is what a chain without sides has always
	 * flown.
	 */
	const sideProfiles: Record<string, IRaukkResolvedShipProfile> =
		Object.fromEntries(
			Object.entries(chain.sideProfiles ?? {}).map(([side, sideId]) => [
				side,
				raukkResolveShipProfile(
					sourcingStore.getShipProfile(sideId),
					resolvePrice
				),
			])
		);

	const input: IRaukkChainInput = {
		chain,
		profile: raukkResolveShipProfile(
			sourcingStore.getShipProfile(profileId),
			resolvePrice
		),
		flows,
		config: shippingConfig,
		chainConfig,
		repairBillCost: calculateRepairBillCost(resolvePrice),
		// raukk: marked depots anchor a split exactly as an exchange does
		depots: sourcingStore.depotStopRefs(),
		sideProfiles,
	};

	const comparison: IRaukkCxSplitResult = calculateChainCxSplit(input);

	const autoSplit: boolean = chain.autoCxSplit ?? chainConfig.autoCxSplit;
	const applied: IRaukkAppliedCosting =
		autoSplit &&
		comparison.trigger !== null &&
		comparison.subChains.length > 0
			? { results: comparison.subChains, splitApplied: true }
			: { results: [comparison.unsplit], splitApplied: false };

	// the sub chains own stops: the split rewrote the loop, and a legs
	// origin stop per position is exactly that loop again
	const split: IRaukkChainCosting[] = comparison.subChains.map((result) =>
		storedCosting(
			result.legs.map((leg) => leg.fromStop),
			result
		)
	);

	const busiest: IRaukkChainShipping = applied.results.reduce(
		(best, result) =>
			result.tripsPerDay * result.roundTripMinutes >
			best.tripsPerDay * best.roundTripMinutes
				? result
				: best,
		applied.results[0]
	);

	const claimed: IRaukkChainFlowCost[] = claimedFlowCosts(
		flows,
		applied.results
	);

	const result: IRaukkChainResult = {
		chainId: chain.chainId,
		computedAt: new Date().toISOString(),
		stale: false,
		profileId,
		hired: comparison.unsplit.hired,
		splitApplied: applied.splitApplied,
		unsplit: storedCosting(chain.stops, comparison.unsplit),
		split,
		splitTrigger:
			comparison.trigger !== null
				? {
						legIndex: comparison.trigger.legIndex,
						cxCode: comparison.trigger.cxCode,
						detourParsecs: comparison.trigger.detourParsecs,
						// raukk: which kind of anchor cut here
						anchorKind: comparison.trigger.anchorKind ?? "cx",
					}
				: null,
		tripsPerDay: busiest.tripsPerDay,
		roundTripMinutes: busiest.roundTripMinutes,
		bindingLegIndex: busiest.bindingLegIndex,
		dailyCost: applied.results.reduce(
			(sum, result) => sum + result.dailyCost,
			0
		),
		shippingFraction: applied.results.reduce(
			(sum, result) => sum + result.shippingFraction,
			0
		),
		shipMinutesPerDay: applied.results.reduce(
			(sum, result) => sum + result.tripsPerDay * result.roundTripMinutes,
			0
		),
		damagePerDay: applied.results.reduce(
			(sum, result) => sum + result.tripsPerDay * result.damagePerTrip,
			0
		),
		flows: claimed,
		perUnit: mergedPerUnit(claimed),
		memberPlanUuids,
		config: { ...chainConfig },
		// an authored chain flies the profile the user picked; the
		// automatic hull advice is a property of the DERIVED chains
		advisories: [],
	};

	return {
		result,
		claimedFlowIds: applied.results.flatMap((costing) =>
			costing.flows.map((flow) => originalFlowId(flow.flowId))
		),
	};
}
