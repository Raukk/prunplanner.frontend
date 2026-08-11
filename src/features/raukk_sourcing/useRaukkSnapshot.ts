import { computed, ComputedRef, ref, Ref, watch } from "vue";

// Stores
import { usePlanningStore } from "@/stores/planningStore";
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";
import { useExchangeData } from "@/database/services/useExchangeData";
import { useMaterialData } from "@/database/services/useMaterialData";

// Compute core & environment
import {
	IRaukkPlanShipping,
	IRaukkProducerPriceOverride,
	IRaukkShippingInput,
	buildPlanShippingPairs,
	computePlanShipping,
	othersDrawnPerDay,
	raukkComputeSnapshotOnce,
} from "@/features/raukk_sourcing/calculations/raukkComputeCore";
import { createRaukkStoreComputeEnv } from "@/features/raukk_sourcing/raukkComputeEnv";

// Calculations
import { calculateTrueCosts } from "@/features/raukk_sourcing/calculations/trueCost";
import {
	calculateRepairCostPerDay,
	calculateRepairMaterialsPerDay,
} from "@/features/raukk_sourcing/calculations/repairCapitalCost";
import {
	RAUKK_LOOP_SOLVE_MAX_UNKNOWNS,
	solveAffineFixedPoint,
} from "@/features/raukk_sourcing/calculations/raukkLoopSolve";
import { resolveLocalPrice } from "@/features/raukk_sourcing/calculations/priceMode";
import { calculateRepairBillCost } from "@/features/raukk_sourcing/calculations/shipping";
import { RAUKK_REPAIR_TICKERS } from "@/features/raukk_sourcing/calculations/shippingRepair";
import { raukkCadenceCaps } from "@/features/raukk_sourcing/calculations/shippingCadence";
import { RAUKK_FUEL_TICKERS } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	buildInputRows,
	buildSourceOptions,
	createRaukkPriceResolver,
	inputDemandPerDay,
	isAggregateSource,
	outputsSettled,
	resolveCxExchangeCode,
} from "@/features/raukk_sourcing/raukkSourcingPricing";
import {
	classifyInputBuckets,
	defaultedTickers,
	resolveEffectiveSources,
} from "@/features/raukk_sourcing/raukkSourcingDefaults";
// raukk: fuel and the ship repair bill are sourced account wide, never
// per base — one fleet serves every plan
import { createRaukkShipPriceResolver } from "@/features/raukk_sourcing/useRaukkShipSourcing";

// Util
import { inertClone } from "@/util/data";

// Types & Interfaces
import { ICXData } from "@/stores/planningStore.types";
import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkComputeCoreInput,
	IRaukkComputeEnv,
	IRaukkPriceCaches,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
import {
	IRaukkLocalPrice,
	IRaukkOutputCost,
	IRaukkPlanConfig,
	IRaukkShippingConfig,
	IRaukkSnapshot,
	IRaukkTickerSource,
	RAUKK_SOURCE_BUCKET,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkCadenceCaps,
	IRaukkShippingPair,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkCargoDimension } from "@/features/raukk_sourcing/calculations/shippingPairs";
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

export type {
	IRaukkPriceCaches,
	IRaukkComputeCoreInput,
} from "@/features/raukk_sourcing/calculations/raukkComputeEnv.types";
export type { IRaukkProducerPriceOverride } from "@/features/raukk_sourcing/calculations/raukkComputeCore";

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
	/**
	 * Fingerprint of the plan version `planResult` was calculated from,
	 * stamped onto the stored snapshot. Omitted, the store falls back to
	 * the plan it currently holds — which is only the same thing while
	 * nothing has moved under the computing view.
	 */
	planFingerprint?: string;
}

/** Outcome of one snapshot computation */
export interface IRaukkPlanSnapshotResult {
	snapshot: IRaukkSnapshot;
	prices: IRaukkPriceCaches;
}

/**
 * One plans snapshot pipeline, prepared once and probed many times.
 *
 * The seam the loop solves probe the cost math through: `computeOnce`
 * is one full synchronous computation at the current store state and
 * writes NOTHING, an optional producer price override substitutes trial
 * prices, and `store` freezes a computed snapshot as the plans stored
 * value. Prices are the caches every computation of this preparation
 * runs against.
 */
export interface IRaukkPreparedSnapshot {
	prices: IRaukkPriceCaches;
	/**
	 * Everything ONE computation of this plan needs as plain data.
	 *
	 * The prepared half a worker can be handed: `computeOnce` below is
	 * exactly this input plus the live store environment, so a solve
	 * running elsewhere reproduces it over a frozen slice instead.
	 */
	coreInput: IRaukkComputeCoreInput;
	computeOnce(priceOverride?: IRaukkProducerPriceOverride): IRaukkSnapshot;
	store(snapshot: IRaukkSnapshot): void;
}

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
		RAUKK_REPAIR_TICKERS.forEach((ticker: string) => tickers.add(ticker));
		tickers.add(RAUKK_FUEL_TICKERS.ftl);
		tickers.add(RAUKK_FUEL_TICKERS.stl);
	}

	return Array.from(tickers).sort();
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
 * A plan may source from itself — own output feeding own repairs — which
 * makes its own output cost both an input and a result of its cost math.
 * That fixed point is SOLVED or it is REPORTED, never iterated: all cost
 * math is units × price and the allocation weights are unit based, so the
 * map from the self prices onto the computed ones is affine and one linear
 * solve answers it (`calculations/raukkLoopSolve.ts`). The pipeline is
 * probed at trial prices through an override that writes nothing, then
 * evaluated once at the solution and verified there.
 *
 * A solve that does not apply — too many unknowns, a singular system, a
 * non finite probe, a verification the solved point failed — keeps the
 * SEED snapshot, the single honest computation this function already
 * stored and exactly what an acyclic plan gets, and says so on the
 * console. Nothing crawls towards a fixed point here. Repeated user
 * triggered recomputes still walk a plan towards a piecewise fixed point
 * on their own, which is the users doing and not this functions job.
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
	const prepared: IRaukkPreparedSnapshot = await preparePlanSnapshot(context);
	const prices: IRaukkPriceCaches = prepared.prices;
	const computeOnce = prepared.computeOnce;

	/*
	 * The SEED: one honest computation at the current store state, stored
	 * straight away. An acyclic plan is finished right here, and a self
	 * supplying one whose fixed point cannot be solved keeps exactly this,
	 * see {@link warnSelfLoopUnsolved}.
	 */
	const snapshot: IRaukkSnapshot = computeOnce();
	prepared.store(snapshot);

	/*
	 * Self supply fixed point, solved in CLOSED FORM.
	 *
	 * The unknowns are the own output tickers the plan draws from itself:
	 * their ȼ per unit is both an input and an output of the cost math.
	 * Every other price the computation sees is a constant of this
	 * system, so the map from the k self prices onto the k freshly
	 * computed ones is affine and `solveAffineFixedPoint` recovers it
	 * exactly from k + 1 probe computations, none of which writes to the
	 * store. See `calculations/raukkLoopSolve.ts`.
	 */
	const selfDraw: IRaukkMaterialUnits | undefined =
		snapshot.draws[context.planUuid];

	const unknowns: string[] =
		selfDraw === undefined
			? []
			: Object.keys(selfDraw)
					.filter((ticker) => snapshot.outputs[ticker] !== undefined)
					.sort();

	if (unknowns.length === 0) return { snapshot, prices };

	if (unknowns.length > RAUKK_LOOP_SOLVE_MAX_UNKNOWNS) {
		warnSelfLoopUnsolved(
			context.planUuid,
			`${unknowns.length} self supplied tickers are more than the ${RAUKK_LOOP_SOLVE_MAX_UNKNOWNS} the closed form solve attempts`
		);

		return { snapshot, prices };
	}

	/** One trial point as a producer price override of this plan */
	const overrideOf = (selfPrices: number[]): IRaukkProducerPriceOverride => ({
		[context.planUuid]: Object.fromEntries(
			unknowns.map((ticker, index) => [ticker, selfPrices[index]])
		),
	});

	const solved: number[] | null = await solveAffineFixedPoint(
		(selfPrices: number[]) => {
			const probe: IRaukkSnapshot = computeOnce(overrideOf(selfPrices));

			return unknowns.map(
				(ticker) => probe.outputs[ticker]?.costPerUnit ?? Number.NaN
			);
		},
		unknowns.map((ticker) => snapshot.outputs[ticker].costPerUnit)
	);

	if (solved === null) {
		warnSelfLoopUnsolved(
			context.planUuid,
			"the system has no finite fixed point — a loop consuming 100 % of its own output has none — or a probe produced no finite number"
		);

		return { snapshot, prices };
	}

	const final: IRaukkSnapshot = computeOnce(overrideOf(solved));

	/*
	 * VERIFICATION: the solve assumes ONE affine map, and a discrete
	 * decision inside the pipeline — an `AGG_MAX` argmax picking another
	 * producer, an automatic hull pick — may flip between two price points
	 * and split it into two. Evaluating at the solved prices has to
	 * reproduce them within the tolerance of {@link outputsSettled};
	 * anything else means the solved point is not a fixed point of the map
	 * that actually applies there.
	 */
	const predicted: Record<string, IRaukkOutputCost> = {};
	const produced: Record<string, IRaukkOutputCost> = {};

	unknowns.forEach((ticker, index) => {
		const output: IRaukkOutputCost | undefined = final.outputs[ticker];

		// a ticker the solved point no longer produces at all is a
		// structural change, which the count check below refuses
		if (output === undefined) return;

		produced[ticker] = output;
		predicted[ticker] = { ...output, costPerUnit: solved[index] };
	});

	if (
		Object.keys(produced).length !== unknowns.length ||
		!outputsSettled(predicted, produced)
	) {
		warnSelfLoopUnsolved(
			context.planUuid,
			"the solved point did not reproduce itself, a discrete decision flips between the two price points"
		);

		return { snapshot, prices };
	}

	prepared.store(final);

	return { snapshot: final, prices };
}

/**
 * Reports a self supply fixed point the closed form solve did not deliver.
 *
 * The plan keeps its SEED snapshot — the one honest computation at the
 * current prices, exactly what an acyclic plan gets — and the failure is
 * surfaced instead of being crawled towards: a loop consuming 100 % of its
 * own output has no finite fixed point, and no number of reruns would
 * find one.
 *
 * @author raukk
 *
 * @param {string} planUuid Plan Uuid
 * @param {string} reason Why the solve did not apply
 * @returns {void}
 */
function warnSelfLoopUnsolved(planUuid: string, reason: string): void {
	console.warn(
		`[raukk] self supply loop of plan '${planUuid}' could not be solved: ${reason}; the single pass numbers are kept`
	);
}

/**
 * Prepares one plans snapshot pipeline for repeated probe computations.
 *
 * The asynchronous half of {@link computePlanSnapshot} — price load, CX
 * resolution, shipping configuration — runs ONCE here; what comes back
 * is the synchronous `computeOnce` over that fixed price state, the
 * caches themselves and a `store` writing a computed snapshot as the
 * plans frozen value. The cross plan loop solve probes many plans at
 * many trial prices, and paying the asynchronous half per probe is what
 * this split avoids.
 *
 * `computeOnce` reads the CONFIGURATION and the producer snapshots live
 * from the store on every call; only the loaded prices are fixed. A
 * probe therefore sees exactly the store state the caller holds it at,
 * plus whatever producer prices its override substitutes.
 *
 * @author raukk
 *
 * @param {IRaukkPlanSnapshotContext} context Plan Context
 * @returns {Promise<IRaukkPreparedSnapshot>} Probe-ready pipeline
 */
export async function preparePlanSnapshot(
	context: IRaukkPlanSnapshotContext
): Promise<IRaukkPreparedSnapshot> {
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

	const coreInput: IRaukkComputeCoreInput = {
		planUuid: context.planUuid,
		planName: context.planName,
		planetNaturalId: context.planetNaturalId,
		planResult: context.planResult,
		shippingConfig,
		prices,
	};

	const env: IRaukkComputeEnv = createRaukkStoreComputeEnv();

	return {
		prices,
		coreInput,
		/*
		 * One full computation over the LIVE store: the environment reads
		 * the configuration and the producer snapshots on every call, so a
		 * rerun after a store write picks up the plans own new value. Only
		 * the loaded prices are fixed.
		 */
		computeOnce: (
			priceOverride?: IRaukkProducerPriceOverride
		): IRaukkSnapshot =>
			raukkComputeSnapshotOnce(coreInput, env, priceOverride),
		store: (snapshot: IRaukkSnapshot): void =>
			sourcingStore.setSnapshot(
				context.planUuid,
				snapshot,
				context.planFingerprint
			),
	};
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

	/** The one seam to the store the displayed numbers share with the
	 * frozen ones, see {@link IRaukkComputeEnv} */
	const env: IRaukkComputeEnv = createRaukkStoreComputeEnv();

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

	/** Exchange every explicit price mode and every market basis of a
	 * local market ad reads, `UNIVERSE` without a CX preference */
	const cxExchangeCode: ComputedRef<string> = computed(() =>
		resolveCxExchangeCode(cxData.value, context.planetNaturalId.value)
	);

	/**
	 * Producers of a ticker, the plan itself included: production and
	 * workforce self consumption is netted by the material I/O already,
	 * but repair demand is not — own output feeding own repairs is a
	 * legitimate source edge.
	 */
	function getProducers(ticker: string): IRaukkProducerOption[] {
		return sourcingStore.producersOf(ticker);
	}

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

	/** Buckets every sourcable ticker of this plan sits in */
	const inputBuckets: ComputedRef<Record<string, RAUKK_SOURCE_BUCKET[]>> =
		computed(() =>
			classifyInputBuckets(
				context.planResult.value,
				repairUnitsPerDay.value
			)
		);

	/**
	 * Sources the plan is really priced with: its own entries, with the
	 * account wide bucket defaults merged into every ticker that has none.
	 * Everything downstream — resolver, shipping, rows — reads this, never
	 * the stored map, so the tool shows what a computation would freeze.
	 */
	/** Plans still producing the ticker, the dangling entry heal reads it */
	function producerUuidsOf(ticker: string): string[] {
		return getProducers(ticker).map((producer) => producer.planUuid);
	}

	const effectiveSources: ComputedRef<Record<string, IRaukkTickerSource>> =
		computed(() =>
			resolveEffectiveSources(
				config.value.sources,
				inputBuckets.value,
				// detached for the same reason `computePlanSnapshot` detaches
				// them: a merged entry travels into cloned structures
				inertClone(sourcingStore.sourcingDefaults),
				producerUuidsOf
			)
		);

	/** Tickers whose source is the account default, not an own entry */
	const followsDefault: ComputedRef<Set<string>> = computed(() =>
		defaultedTickers(
			config.value.sources,
			inputBuckets.value,
			sourcingStore.sourcingDefaults,
			producerUuidsOf
		)
	);

	/** Daily need per ticker, the market top up aggregate blends on it */
	const demandPerDay: ComputedRef<IRaukkMaterialUnits> = computed(() =>
		inputDemandPerDay(context.planResult.value, repairUnitsPerDay.value)
	);

	const resolver: ComputedRef<IRaukkPriceResolver> = computed(() =>
		createRaukkPriceResolver({
			sources: effectiveSources.value,
			getExchange: (ticker: string) => exchangePrices.value[ticker],
			getDefaultPrice: (ticker: string) =>
				defaultPrices.value[ticker] ?? 0,
			getProducers,
			getDemand: (ticker: string) => demandPerDay.value[ticker] ?? 0,
			getOthersDrawn: (ticker: string) =>
				othersDrawnPerDay(env, context.planUuid.value, ticker),
		})
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

	/** Live mirror of the frozen ship pricing, see `computePlanSnapshot` */
	const shipResolver: ComputedRef<IRaukkPriceResolver> = computed(() =>
		createRaukkShipPriceResolver({
			getDefaultPrice: (ticker: string) =>
				defaultPrices.value[ticker] ?? 0,
			getExchange: (ticker: string) => exchangePrices.value[ticker],
		})
	);

	const shippingInput: ComputedRef<IRaukkShippingInput> = computed(() => ({
		env,
		planUuid: context.planUuid.value ?? "",
		planetNaturalId: context.planetNaturalId.value ?? "",
		planResult: context.planResult.value,
		resolver: resolver.value,
		shipResolver: shipResolver.value,
		getProducers,
		shippingConfig: shippingConfig.value,
		sources: effectiveSources.value,
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
				: env.leaseCargoOf(context.planUuid.value ?? ""),
	}));

	/** Live shipping of the pairs this plan owns, empty while disabled */
	const planShipping: ComputedRef<IRaukkPlanShipping> = computed(() =>
		computePlanShipping(shippingInput.value)
	);

	const shipping: ComputedRef<IRaukkShippingResult> = computed(
		() => planShipping.value.shipping
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

	/** ȼ of one full ship repair bill at the ACCOUNT WIDE ship sourcing */
	const repairBillCost: ComputedRef<number> = computed(() =>
		calculateRepairBillCost(
			(ticker: string) => shipResolver.value(ticker).price
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
			effectiveSources.value,
			resolver.value,
			shipping.value.inbound,
			(ticker: string) => defaultPrices.value[ticker] ?? 0,
			followsDefault.value
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

		Object.entries(effectiveSources.value).forEach(([ticker, source]) => {
			if (source.mode !== "plan") return;

			getProducers(ticker)
				.filter(
					(producer) =>
						producer.planUuid !== context.planUuid.value &&
						(isAggregateSource(source.sourcePlanUuid) ||
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
			// the market half of the market top up aggregates price
			marketPrice: defaultPrices.value[ticker] ?? 0,
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
					exchangeCode: cxExchangeCode.value,
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
		effectiveSources,
		inputBuckets,
		shippingConfig,
		caps,
		shipping,
		shippingPairs,
		repairBillCost,
		inputRows,
		outputRows,
		exchangePrices,
		cxExchangeCode,
		repairCost,
		snapshot,
		staleSources,
		isRefreshing,
		sourceOptions,
		refreshPrices,
		computeSnapshot,
	};
}
