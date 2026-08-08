import { computed, ComputedRef, ref, Ref, watch } from "vue";

// Stores
import { usePlanningStore } from "@/stores/planningStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";
import { useExchangeData } from "@/database/services/useExchangeData";

// Calculations
import { calculateTrueCosts } from "@/features/raukk_sourcing/calculations/trueCost";
import { calculateRepairCostPerDay } from "@/features/raukk_sourcing/calculations/repairCapitalCost";
import { calculateBaseFraction } from "@/features/raukk_sourcing/calculations/baseFraction";
import {
	calculateRepairBillCost,
	calculateShipping,
	RAUKK_REPAIR_BILL,
} from "@/features/raukk_sourcing/calculations/shipping";
import { buildShippingPairs } from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	buildInputRows,
	buildSourceOptions,
	createRaukkPriceResolver,
	isAggregateSource,
	resolveCxExchangeCode,
	splitAggregateDraws,
} from "@/features/raukk_sourcing/raukkSourcingPricing";

// Util
import { inertClone } from "@/util/data";

// Types & Interfaces
import { ICXData } from "@/stores/planningStore.types";
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkPlanConfig,
	IRaukkShippingConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkShippedTicker,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkTickerOrigin } from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	IRaukkExchangePrices,
	IRaukkMaterialUnits,
	IRaukkPriceResolver,
	IRaukkRepairBuilding,
	IRaukkRepairCost,
	IRaukkTrueCostResult,
} from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkProducerOption } from "@/features/raukk_sourcing/raukkSourcingStore.types";
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
}

/** Outcome of one snapshot computation */
export interface IRaukkPlanSnapshotResult {
	snapshot: IRaukkSnapshot;
	prices: IRaukkPriceCaches;
}

/**
 * All tickers a plans sourcing numbers need prices for: everything
 * moving through its material I/O plus all construction materials of
 * its buildings, those are the repairable ones.
 *
 * With shipping enabled the four ship repair bill tickers join them.
 * They are no cargo of the plan and appear nowhere in its material I/O,
 * but the repair cost per trip prices them — without loading them the
 * resolvers `?? 0` fallback would silently zero that whole term.
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

	if (withShipRepair)
		Object.keys(RAUKK_REPAIR_BILL).forEach((ticker) => tickers.add(ticker));

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
 * v1 limitation, deliberate: building repair materials are priced and
 * drawn like any other ticker but never appear in the material I/O, so
 * they ride no pair and pay no freight. The ship repair bill tickers are
 * priced through the resolver as well, without booking a draw — the
 * quantities are tiny and stay out of cycle guard and base fraction.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkShippingPair[]} Route pairs the plan owns
 */
function buildPlanShippingPairs(
	input: IRaukkShippingInput
): IRaukkShippingPair[] {
	const sourcingStore = useRaukkSourcingStore();

	const inputs: IRaukkShippedTicker[] = [];
	const outputs: IRaukkShippedTicker[] = [];

	input.planResult.materialio.forEach((element) => {
		if (element.delta === 0) return;

		const cargo: IRaukkShippedTicker = {
			ticker: element.ticker,
			unitsPerDay: Math.abs(element.delta),
			weightPerUnit: element.individualWeight,
			volumePerUnit: element.individualVolume,
		};

		if (element.delta < 0) inputs.push(cargo);
		else outputs.push(cargo);
	});

	return buildShippingPairs(
		{
			planUuid: input.planUuid,
			planetNaturalId: input.planetNaturalId,
			inputs,
			outputs,
		},
		{
			originOf: (ticker: string): IRaukkTickerOrigin[] => {
				const fromPlanUuid: string | undefined =
					input.resolver(ticker).fromPlanUuid;

				if (fromPlanUuid === undefined) return [];

				if (!isAggregateSource(fromPlanUuid))
					return [{ planUuid: fromPlanUuid, share: 1 }];

				// an aggregate draws from the whole producer pool, split
				// exactly as `splitAggregateDraws` splits the draws
				const producers: IRaukkProducerOption[] =
					input.getProducers(ticker);
				const unitsTotal: number = producers.reduce(
					(sum, producer) => sum + producer.unitsPerDay,
					0
				);

				return producers.map((producer) => ({
					planUuid: producer.planUuid,
					share:
						unitsTotal > 0
							? producer.unitsPerDay / unitsTotal
							: 1 / producers.length,
				}));
			},
			planetOf: (planUuid: string): string | undefined =>
				sourcingStore.snapshots[planUuid]?.planetNaturalId,
			subscribedOf: (ticker: string): number =>
				sourcingStore.subscription(input.planUuid, ticker)
					.totalDrawnPerDay,
			profileOf: (pairKey: string) =>
				sourcingStore.getShipProfile(
					input.shippingConfig.perEdgeProfile?.[pairKey] ??
						input.shippingConfig.defaultProfileId
				),
		},
		input.shippingConfig
	);
}

/**
 * Shipping cost of every route pair one plan owns.
 *
 * @author raukk
 *
 * @param {IRaukkShippingInput} input Plan flows, resolver and config
 * @returns {IRaukkShippingResult} Per pair and per ticker shipping
 */
function computePlanShipping(input: IRaukkShippingInput): IRaukkShippingResult {
	return calculateShipping(
		buildPlanShippingPairs(input),
		input.shippingConfig,
		(ticker: string) => input.resolver(ticker).price
	);
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
}): Promise<IRaukkPriceCaches> {
	const defaultPrices: Record<string, number> = {};
	const sellPrices: Record<string, number> = {};
	const exchangePrices: Record<string, IRaukkExchangePrices> = {};

	await Promise.all(
		params.tickers.map(async (ticker) => {
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

	return { defaultPrices, sellPrices, exchangePrices };
}

/**
 * Computes one plans snapshot and stores it.
 *
 * This is the whole pipeline — price load, source resolver, true costs,
 * aggregate draw splitting, base fraction, store write — detached from
 * any component: {@link useRaukkSnapshot} runs it for the plan the
 * sourcing tool is open on, `useRaukkChainRecompute` runs it for every
 * plan of a dependency chain. Prices are returned alongside the stored
 * snapshot so a caller displaying live numbers can adopt exactly the
 * ones the frozen values were computed from.
 *
 * Aggregate draws are pre split into concrete producer uuids before
 * storing, the persisted `draws` keys are always plan uuids. The base
 * fraction is derived from those concrete draws and the stored
 * snapshots of the sources, it is frozen with the rest.
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
	});

	const config: IRaukkPlanConfig = sourcingStore.getConfig(context.planUuid);

	const getProducers = (ticker: string): IRaukkProducerOption[] =>
		sourcingStore
			.producersOf(ticker)
			.filter((producer) => producer.planUuid !== context.planUuid);

	const resolver: IRaukkPriceResolver = createRaukkPriceResolver({
		sources: config.sources,
		getExchange: (ticker: string) => prices.exchangePrices[ticker],
		getDefaultPrice: (ticker: string) => prices.defaultPrices[ticker] ?? 0,
		getProducers,
	});

	const repairCost: IRaukkRepairCost = calculateRepairCostPerDay(
		context.planResult.production.buildings.map((building) => ({
			name: building.name,
			amount: building.amount,
			constructionMaterials: building.constructionMaterials,
		})),
		config.repairDay,
		(ticker: string) => resolver(ticker).price
	);

	const shipping: IRaukkShippingResult = computePlanShipping({
		planUuid: context.planUuid,
		planetNaturalId: context.planetNaturalId,
		planResult: context.planResult,
		resolver,
		getProducers,
		shippingConfig,
	});

	const result: IRaukkTrueCostResult = calculateTrueCosts({
		planResult: context.planResult,
		repairCostPerDayByBuilding: repairCost.perBuilding,
		repairMaterialUnitsPerDay: repairCost.materialUnitsPerDay,
		resolveInputPrice: resolver,
		shippingPerUnitIn: shipping.inbound,
		shippingPerUnitOut: shipping.outbound,
	});

	const draws: Record<string, IRaukkMaterialUnits> = splitAggregateDraws(
		result.draws,
		getProducers
	);

	/*
	 * Shipping is account global: the configuration it was frozen with is
	 * embedded, and only while it is enabled. A snapshot computed with
	 * shipping off stays byte identical to the ones written before the
	 * shipping model existed.
	 */
	const snapshot: IRaukkSnapshot = {
		computedAt: new Date().toISOString(),
		stale: false,
		planName: context.planName,
		planetNaturalId: context.planetNaturalId,
		outputs: inertClone(result.outputs),
		draws,
		config: shippingConfig.enabled
			? { ...inertClone(config), shipping: shippingConfig }
			: inertClone(config),
		baseFraction: calculateBaseFraction(draws, (sourcePlanUuid) =>
			sourcingStore.getSnapshot(sourcePlanUuid)
		),
		...(shippingConfig.enabled
			? { shippingFraction: shipping.shippingFraction }
			: {}),
	};

	sourcingStore.setSnapshot(context.planUuid, snapshot);

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

	// price caches, filled by refreshPrices
	const defaultPrices: Ref<Record<string, number>> = ref({});
	const sellPrices: Ref<Record<string, number>> = ref({});
	const exchangePrices: Ref<Record<string, IRaukkExchangePrices>> = ref({});

	const config: ComputedRef<IRaukkPlanConfig> = computed(() =>
		sourcingStore.getConfig(context.planUuid.value ?? "")
	);

	const cxData: ComputedRef<ICXData | undefined> = computed(() => {
		if (!context.cxUuid.value) return undefined;

		try {
			return planningStore.getCX(context.cxUuid.value).cx_data;
		} catch {
			return undefined;
		}
	});

	/**
	 * Producers of a ticker, without the plan itself. Same planet self
	 * consumption is already netted by the material I/O, a plan must
	 * never draw from its own snapshot.
	 */
	function getProducers(ticker: string): IRaukkProducerOption[] {
		return sourcingStore
			.producersOf(ticker)
			.filter((producer) => producer.planUuid !== context.planUuid.value);
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

	const repairCost: ComputedRef<IRaukkRepairCost> = computed(() =>
		calculateRepairCostPerDay(
			repairBuildings.value,
			config.value.repairDay,
			(ticker: string) => resolver.value(ticker).price
		)
	);

	const shippingConfig: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	const shippingInput: ComputedRef<IRaukkShippingInput> = computed(() => ({
		planUuid: context.planUuid.value ?? "",
		planetNaturalId: context.planetNaturalId.value ?? "",
		planResult: context.planResult.value,
		resolver: resolver.value,
		getProducers,
		shippingConfig: shippingConfig.value,
	}));

	/** Live shipping of the pairs this plan owns, empty while disabled */
	const shipping: ComputedRef<IRaukkShippingResult> = computed(() =>
		computePlanShipping(shippingInput.value)
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

	const inputRows: ComputedRef<IRaukkInputRow[]> = computed(() =>
		buildInputRows(
			context.planResult.value,
			repairCost.value.materialUnitsPerDay,
			config.value.sources,
			resolver.value,
			shipping.value.inbound
		)
	);

	const outputRows: ComputedRef<IRaukkOutputRow[]> = computed(() =>
		Object.values(trueCost.value.outputs)
			.map((output) => {
				const marketPrice: number =
					sellPrices.value[output.ticker] ?? 0;

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

	/** Producers the current configuration draws from */
	const usedSources: ComputedRef<IRaukkProducerOption[]> = computed(() => {
		const seen: Set<string> = new Set();
		const result: IRaukkProducerOption[] = [];

		Object.entries(config.value.sources).forEach(([ticker, source]) => {
			if (source.mode !== "plan") return;

			getProducers(ticker)
				.filter(
					(producer) =>
						source.sourcePlanUuid === "AGG_AVG" ||
						source.sourcePlanUuid === "AGG_MAX" ||
						source.sourcePlanUuid === producer.planUuid
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
			configs: sourcingStore.configs,
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
