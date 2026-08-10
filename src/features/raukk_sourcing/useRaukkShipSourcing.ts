import { computed, ComputedRef, ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";
import { useExchangeData } from "@/database/services/useExchangeData";

// Pricing
import {
	buildSourceOptions,
	createRaukkPriceResolver,
} from "@/features/raukk_sourcing/raukkSourcingPricing";

// Calculations
import {
	RAUKK_SHIP_SOURCE_GROUPS,
	raukkEffectiveShipSources,
	raukkShipDefaultedTickers,
	raukkShipGroupTickers,
	raukkShipSourceGroupOf,
	raukkShipSourcingDemand,
	raukkShipSourcingTickers,
} from "@/features/raukk_sourcing/calculations/shipSourcing";
import { raukkFleetLoadEntries } from "@/features/raukk_sourcing/calculations/oversubReport";

// Types & Interfaces
import {
	IRaukkExchangePrices,
	IRaukkMaterialUnits,
	IRaukkPriceResolver,
	IRaukkResolvedPrice,
} from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import {
	IRaukkShipSourcing,
	IRaukkShipTickerSource,
	IRaukkTickerSource,
	RAUKK_SHIP_SOURCE_GROUP,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkProducerOption } from "@/features/raukk_sourcing/raukkSourcingStore.types";
import { IRaukkSourceOption } from "@/features/raukk_sourcing/raukkSourcingUi.types";

/** Prices the account wide ship resolver falls back to */
export interface IRaukkShipPriceLookups {
	/** Exchange price of the ticker, the "no source configured" answer */
	getDefaultPrice: (ticker: string) => number;
	/** Raw exchange data, backs the explicit price modes. Without it a
	 * configured market mode resolves to 0, as everywhere else. */
	getExchange?: (ticker: string) => IRaukkExchangePrices | undefined;
}

/** Raw prices of everything the fleet consumes, no source applied */
export interface IRaukkShipPriceCaches {
	/** CX preference buy price per ticker */
	prices: Record<string, number>;
	/** Raw exchange data per ticker, backs the explicit price modes */
	exchange: Record<string, IRaukkExchangePrices>;
}

/**
 * Exchange the account level price modes read.
 *
 * Universe averages, deliberately: an account level caller has no plan
 * and therefore no CX preference to resolve a home exchange from. The CX
 * preference price itself is still per planet — `usePrice` resolves it
 * from the anchor below — this is only what a `BID`/`ASK` mode reads.
 */
const RAUKK_SHIP_EXCHANGE_CODE: string = "UNIVERSE";

/**
 * Loads the exchange prices of the fuels and the ship repair bill.
 *
 * The RAW prices, with no ship source applied: they are what an
 * unconfigured ticker costs and what a configured market top up blends
 * against, so applying a source to them would be circular. A ticker that
 * fails to price degrades to 0, exactly as the snapshot pipeline does.
 *
 * @author raukk
 *
 * @param {string | undefined} planetNaturalId Planet whose CX preference
 * prices the tickers, `undefined` for the universe average
 * @returns {Promise<IRaukkShipPriceCaches>} Prices and exchange data
 */
export async function raukkLoadShipPrices(
	planetNaturalId: string | undefined
): Promise<IRaukkShipPriceCaches> {
	const { getPrice } = await usePrice(ref(undefined), ref(planetNaturalId));
	const { getExchangeTicker } = await useExchangeData();

	const prices: Record<string, number> = {};
	const exchange: Record<string, IRaukkExchangePrices> = {};

	await Promise.all(
		raukkShipSourcingTickers().map(async (ticker) => {
			try {
				prices[ticker] = await getPrice(ticker, "BUY");
			} catch {
				prices[ticker] = 0;
			}

			try {
				exchange[ticker] = await getExchangeTicker(
					`${ticker}.${RAUKK_SHIP_EXCHANGE_CODE}`
				);
			} catch {
				// thinly traded or unknown exchange: the price modes
				// resolve to 0, as they do everywhere else
			}
		})
	);

	return { prices, exchange };
}

/**
 * Units of fuel and repair material the whole fleet consumes per day.
 *
 * Read from the FROZEN state — the fuel burn each snapshot stores and the
 * damage the stored lanes and chain results took — never from live
 * numbers, the rule every account level rollup follows.
 *
 * @author raukk
 *
 * @returns {IRaukkMaterialUnits} Units per day, keyed by ticker
 */
export function raukkShipDemandPerDay(): IRaukkMaterialUnits {
	const sourcingStore = useRaukkSourcingStore();

	// scoped: a plan the account no longer operates flies nothing, so its
	// hulls burn nothing either
	const snapshots = sourcingStore.scopedSnapshots();

	return raukkShipSourcingDemand(
		snapshots,
		raukkFleetLoadEntries(snapshots, sourcingStore.chainResults)
	);
}

/**
 * The price resolver every fuel and ship repair charge is priced with.
 *
 * ACCOUNT WIDE by construction: it reads the ship sourcing rather than
 * any plans configuration, so the same fuel costs the same wherever a
 * hull tops up. A ticker the configuration says nothing about falls
 * through to `getDefaultPrice`, which is what the caller considers the
 * market — the consuming plans CX preference in the snapshot pipeline,
 * the universe average on the account level pages. That fallback is the
 * whole behaviour of an unconfigured account, so nothing changes for a
 * user who never opens the Sourcing tab.
 *
 * Fuel drawn from a producing plan books a draw against it exactly as it
 * did per base; the ship repair bill still books none, see
 * {@link withFuelDraws}.
 *
 * @author raukk
 *
 * @param {IRaukkShipPriceLookups} lookups Fallback prices
 * @returns {IRaukkPriceResolver} Price resolver of the fleets materials
 */
export function createRaukkShipPriceResolver(
	lookups: IRaukkShipPriceLookups
): IRaukkPriceResolver {
	const sourcingStore = useRaukkSourcingStore();

	const sources: Record<string, IRaukkTickerSource> =
		raukkEffectiveShipSources(sourcingStore.shipSourcing);

	/*
	 * The market top up aggregate blends against a DEMAND, and the demand
	 * for fuel is the fleets, not any one bases: coverage is computed once
	 * for the whole account. "Others" is therefore everything drawn from
	 * the producer pool that is NOT that fleet demand — the fleets own
	 * draws are already stored on the consuming plans snapshots and would
	 * otherwise be counted twice.
	 */
	const demand: IRaukkMaterialUnits = raukkShipDemandPerDay();

	function othersDrawn(ticker: string): number {
		const drawn: number = sourcingStore
			.producersOf(ticker)
			.reduce(
				(sum, producer) =>
					sum +
					sourcingStore.subscription(producer.planUuid, ticker)
						.totalDrawnPerDay,
				0
			);

		return Math.max(0, drawn - (demand[ticker] ?? 0));
	}

	return createRaukkPriceResolver({
		sources,
		getExchange: (ticker: string) => lookups.getExchange?.(ticker),
		getDefaultPrice: lookups.getDefaultPrice,
		getProducers: (ticker: string) => sourcingStore.producersOf(ticker),
		getDemand: (ticker: string) => demand[ticker] ?? 0,
		getOthersDrawn: othersDrawn,
	});
}

/** One row of the account wide ship sourcing table */
export interface IRaukkShipSourcingRow {
	ticker: string;
	group: RAUKK_SHIP_SOURCE_GROUP;
	/** Units the whole fleet consumes per day, 0 while nothing flies */
	unitsPerDay: number;
	/** Effective source, undefined falls back to the exchange price */
	source: IRaukkShipTickerSource | undefined;
	/** The source is the group default, the ticker stores none of its own */
	fromDefault: boolean;
	/** ȼ of one unit at the effective source */
	price: number;
	/** `unitsPerDay * price` */
	costPerDay: number;
	/** Plan the units are drawn from, an aggregate sentinel for a pool */
	fromPlanUuid: string | undefined;
}

/**
 * The account wide ship sourcing section: what the fleet consumes, where
 * it comes from and what that costs.
 *
 * Rows are every ticker of both groups, not only the ones currently in
 * demand: a whipple array has to be sourcable before the first repair
 * bill asks for it, and a fleet that flies nothing yet still has fuel to
 * configure.
 *
 * @author raukk
 *
 * @param {IRaukkShipPriceLookups} lookups Fallback prices
 * @returns Rows, dropdown options and the two group setters
 */
export function useRaukkShipSourcing(lookups: IRaukkShipPriceLookups) {
	const sourcingStore = useRaukkSourcingStore();

	const sourcing: ComputedRef<IRaukkShipSourcing> = computed(
		() => sourcingStore.shipSourcing
	);

	const demand: ComputedRef<IRaukkMaterialUnits> = computed(() =>
		raukkShipDemandPerDay()
	);

	const resolve: ComputedRef<IRaukkPriceResolver> = computed(() =>
		createRaukkShipPriceResolver(lookups)
	);

	const rows: ComputedRef<IRaukkShipSourcingRow[]> = computed(() => {
		const effective: Record<string, IRaukkTickerSource> =
			raukkEffectiveShipSources(sourcing.value);
		const defaulted: Set<string> = raukkShipDefaultedTickers(
			sourcing.value
		);

		return RAUKK_SHIP_SOURCE_GROUPS.flatMap((group) =>
			raukkShipGroupTickers(group).map((ticker) => {
				const resolved: IRaukkResolvedPrice = resolve.value(ticker);
				const unitsPerDay: number = demand.value[ticker] ?? 0;

				return {
					ticker,
					group,
					unitsPerDay,
					source: effective[ticker] as
						| IRaukkShipTickerSource
						| undefined,
					fromDefault: defaulted.has(ticker),
					price: resolved.price,
					costPerDay: unitsPerDay * resolved.price,
					fromPlanUuid: resolved.fromPlanUuid,
				};
			})
		);
	});

	const totalCostPerDay: ComputedRef<number> = computed(() =>
		rows.value.reduce((sum, row) => sum + row.costPerDay, 0)
	);

	/**
	 * Source dropdown entries of one ticker, the fleets daily need as the
	 * prospective draw: the percentages a base sees are per base, the ones
	 * here are what the WHOLE fleet would take off a producer.
	 *
	 * @author raukk
	 *
	 * @param {string} ticker Material Ticker
	 * @returns {IRaukkSourceOption[]} Dropdown Options
	 */
	function sourceOptions(ticker: string): IRaukkSourceOption[] {
		return buildSourceOptions({
			ticker,
			// account wide: no consuming plan, so no plans own draw is
			// removed from the "others" share — the fleet is the consumer
			consumerPlanUuid: undefined,
			prospectiveDrawPerDay: demand.value[ticker] ?? 0,
			producers: sourcingStore.producersOf(ticker),
			subscriptionOf: (
				sourcePlanUuid: string,
				subscribedTicker: string
			) => sourcingStore.subscription(sourcePlanUuid, subscribedTicker),
			snapshots: sourcingStore.snapshots,
			marketPrice: lookups.getDefaultPrice(ticker),
		});
	}

	/** Producers of a ticker, the "has any source at all" gate */
	function producersOf(ticker: string): IRaukkProducerOption[] {
		return sourcingStore.producersOf(ticker);
	}

	function setGroupDefault(
		group: RAUKK_SHIP_SOURCE_GROUP,
		source: IRaukkShipTickerSource | undefined
	): void {
		sourcingStore.setShipSourcingDefault(group, source);
	}

	function setTickerSource(
		ticker: string,
		source: IRaukkShipTickerSource | undefined
	): void {
		sourcingStore.setShipTickerSource(ticker, source);
	}

	/** Group of a ticker, the table groups its rows by it */
	function groupOf(ticker: string): RAUKK_SHIP_SOURCE_GROUP | undefined {
		return raukkShipSourceGroupOf(ticker);
	}

	return {
		sourcing,
		rows,
		totalCostPerDay,
		sourceOptions,
		producersOf,
		setGroupDefault,
		setTickerSource,
		groupOf,
	};
}
