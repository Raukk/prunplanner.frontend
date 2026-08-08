import { ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";

// Calculations
import { calculateChainCxSplit } from "@/features/raukk_sourcing/calculations/shippingChains";
import {
	calculateRepairBillCost,
	RAUKK_REPAIR_BILL,
} from "@/features/raukk_sourcing/calculations/shipping";
import {
	RAUKK_FUEL_TICKERS,
	raukkResolveShipProfile,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";
import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";

// Types & Interfaces
import {
	IRaukkChain,
	IRaukkChainConfig,
	IRaukkChainFlow,
	IRaukkChainFlowCost,
	IRaukkChainCosting,
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkShippingConfig,
	IRaukkShippingPriceResolver,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainFlowResult,
	IRaukkChainInput,
	IRaukkChainShipping,
	IRaukkCxSplitResult,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * Tickers the account level chain step needs prices for: the four ship
 * repair bill tickers and the two fuels the derived ȼ constants are
 * priced with. No cargo price is ever needed — a chain moves freight, it
 * does not value it.
 *
 * @author raukk
 */
export const RAUKK_CHAIN_PRICE_TICKERS: string[] = [
	...Object.keys(RAUKK_REPAIR_BILL),
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
 * With shipping disabled nothing is computed and nothing is written:
 * chains are inert and snapshots stay byte identical to the pre shipping
 * ones.
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

	if (!shippingConfig.enabled) return errors;

	const chainConfig: IRaukkChainConfig = sourcingStore.chainConfig;

	for (const chain of Object.values(sourcingStore.chains) as IRaukkChain[]) {
		try {
			sourcingStore.setChainResult(
				chain.chainId,
				await computeOneChain(
					chain,
					shippingConfig,
					chainConfig,
					loadPrices
				)
			);
		} catch (error) {
			errors.push({
				chainId: chain.chainId,
				message:
					error instanceof Error ? error.message : "unknown error",
			});
		}
	}

	return errors;
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
 * @returns {Promise<IRaukkChainResult>} Chain Result
 */
async function computeOneChain(
	chain: IRaukkChain,
	shippingConfig: IRaukkShippingConfig,
	chainConfig: IRaukkChainConfig,
	loadPrices: IRaukkChainPriceLoader
): Promise<IRaukkChainResult> {
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

	const anchorPlanet: string | undefined = memberPlanUuids
		.map((planUuid) => sourcingStore.snapshots[planUuid]?.planetNaturalId)
		.find((planet) => planet !== undefined);

	const resolvePrice: IRaukkShippingPriceResolver =
		await loadPrices(anchorPlanet);

	const profileId: string =
		sourcingStore.assignments[raukkChainAssignmentKey(chain.chainId)] ??
		chain.profileId ??
		shippingConfig.defaultProfileId;

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

	return {
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
		flows: claimed,
		perUnit: mergedPerUnit(claimed),
		memberPlanUuids,
		config: { ...chainConfig },
	};
}
