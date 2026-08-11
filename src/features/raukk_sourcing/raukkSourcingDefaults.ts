// Account wide sourcing defaults of the raukk sourcing tool.
// No store, Pinia or Vue access: every function takes plain data so the
// logic stays unit testable in isolation.

// Functions
import { isDanglingSource } from "@/features/raukk_sourcing/raukkSourcingPricing";

// Types & Interfaces
import {
	IRaukkSnapshot,
	IRaukkSourcingDefaults,
	IRaukkTickerSource,
	RAUKK_SOURCE_BUCKET,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkMaterialUnits } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkInputRowSource } from "@/features/raukk_sourcing/raukkSourcingUi.types";

/**
 * Precedence a ticker sitting in several buckets resolves its default in.
 *
 * Multi bucket tickers are rare — a prefab that is both a repair material
 * and a recipe input, food a base both eats and processes — but they
 * carry ONE source, so one of the defaults has to win. Workforce first:
 * consumables are the case the defaults exist for, and their bucket is
 * the narrowest of the three.
 *
 * @author raukk
 */
export const RAUKK_SOURCE_BUCKET_ORDER: RAUKK_SOURCE_BUCKET[] = [
	"workforce",
	"repair",
	"production",
];

/**
 * Buckets every sourcable input ticker of a plan belongs to.
 *
 * The classification the input table groups its rows by, without any
 * price: net inputs of the material I/O (`delta < 0`) split into workforce
 * consumables and production inputs by their gross demand, plus the repair
 * material demand, which never shows up in the material I/O at all. A
 * ticker may land in several buckets and a net input matching none of the
 * gross lists counts as a production input — exactly what the table does
 * with it.
 *
 * Ship fuel is deliberately absent: its cost is already inside the
 * shipping model, so it takes no account wide default.
 *
 * @author raukk
 *
 * @param {IRaukkInputRowSource} planResult Plan Result
 * @param {IRaukkMaterialUnits} repairUnitsPerDay Repair demand per day
 * @returns {Record<string, RAUKK_SOURCE_BUCKET[]>} Buckets per ticker
 */
export function classifyInputBuckets(
	planResult: IRaukkInputRowSource,
	repairUnitsPerDay: IRaukkMaterialUnits = {}
): Record<string, RAUKK_SOURCE_BUCKET[]> {
	const buckets: Record<string, Set<RAUKK_SOURCE_BUCKET>> = {};

	function add(ticker: string, bucket: RAUKK_SOURCE_BUCKET): void {
		const known: Set<RAUKK_SOURCE_BUCKET> =
			buckets[ticker] ?? new Set<RAUKK_SOURCE_BUCKET>();

		known.add(bucket);
		buckets[ticker] = known;
	}

	planResult.materialio.forEach((element) => {
		if (element.delta >= 0) return;

		const workforce: boolean = planResult.workforceMaterialIO.some(
			(entry) => entry.ticker === element.ticker && entry.input > 0
		);
		const production: boolean = planResult.productionMaterialIO.some(
			(entry) => entry.ticker === element.ticker && entry.input > 0
		);

		if (workforce) add(element.ticker, "workforce");
		// a net input in neither gross list must not fall out of every
		// bucket, the table groups it with the production inputs as well
		if (production || !workforce) add(element.ticker, "production");
	});

	Object.entries(repairUnitsPerDay).forEach(([ticker, unitsPerDay]) => {
		if (unitsPerDay <= 0) return;

		add(ticker, "repair");
	});

	return Object.fromEntries(
		Object.entries(buckets).map(([ticker, set]) => [
			ticker,
			RAUKK_SOURCE_BUCKET_ORDER.filter((bucket) => set.has(bucket)),
		])
	);
}

/**
 * Source every input bucket falls back to while the account stores no
 * default of its own.
 *
 * The market topping aggregate, because it is the only source that stays
 * right no matter what the account produces: it prices the share the own
 * bases cover at their pool average and buys the rest at the exchange, so
 * a ticker nothing produces costs EXACTLY what the CX preference price
 * charged before this fallback existed. Adding or removing a producing
 * base moves the numbers on its own, without a single row having to be
 * re-pointed by hand — which is the entire reason the sourcing tool
 * defaults to it rather than to the plain CX price.
 *
 * @author raukk
 */
export const RAUKK_BUILTIN_DEFAULT_SOURCE: IRaukkTickerSource = {
	mode: "plan",
	sourcePlanUuid: "AGG_AVG_MKT",
};

/**
 * Bucket whose default a ticker follows, given the buckets it sits in.
 *
 * The first bucket of {@link RAUKK_SOURCE_BUCKET_ORDER} carrying a stored
 * default wins. A ticker none of whose buckets stores one is owned by its
 * first bucket in that order anyway: nothing else can claim it, and the
 * "replace on every base" action of a bucket set back to NO default has
 * to know which tickers that bucket still speaks for. Only a ticker in no
 * bucket at all — ship fuel, a ticker the plan does not consume — has no
 * owning bucket.
 *
 * @author raukk
 *
 * @param {RAUKK_SOURCE_BUCKET[]} buckets Buckets of the ticker
 * @param {IRaukkSourcingDefaults} defaults Account wide defaults
 * @returns {RAUKK_SOURCE_BUCKET | undefined} Owning bucket
 */
export function owningBucketOf(
	buckets: RAUKK_SOURCE_BUCKET[] | undefined,
	defaults: IRaukkSourcingDefaults
): RAUKK_SOURCE_BUCKET | undefined {
	if (!buckets || buckets.length === 0) return undefined;

	return (
		RAUKK_SOURCE_BUCKET_ORDER.find(
			(candidate) => buckets.includes(candidate) && defaults[candidate]
		) ??
		RAUKK_SOURCE_BUCKET_ORDER.find((candidate) =>
			buckets.includes(candidate)
		)
	);
}

/**
 * Account wide default source of a ticker, given the buckets it sits in.
 *
 * The default of its owning bucket, see {@link owningBucketOf}. A ticker
 * in a bucket none of which stores one falls back to
 * {@link RAUKK_BUILTIN_DEFAULT_SOURCE}; only a ticker in no bucket at all
 * has no default.
 *
 * @author raukk
 *
 * @param {RAUKK_SOURCE_BUCKET[]} buckets Buckets of the ticker
 * @param {IRaukkSourcingDefaults} defaults Account wide defaults
 * @returns {IRaukkTickerSource | undefined} Default Source
 */
export function defaultSourceOf(
	buckets: RAUKK_SOURCE_BUCKET[] | undefined,
	defaults: IRaukkSourcingDefaults
): IRaukkTickerSource | undefined {
	const bucket: RAUKK_SOURCE_BUCKET | undefined = owningBucketOf(
		buckets,
		defaults
	);

	if (bucket === undefined) return undefined;

	return defaults[bucket] ?? { ...RAUKK_BUILTIN_DEFAULT_SOURCE };
}

/**
 * Merges the account wide bucket defaults into a plans stored sources.
 *
 * The result is what the plan is really priced with: every stored entry
 * survives untouched — a per base setting always wins, `cx` being the
 * entry that pins a ticker back to the CX preference price — and every
 * ticker of a bucket carrying a default without such an entry gets it.
 * Tickers this plan does not consume are left alone, a stored entry of a
 * ticker that vanished from the plan stays stored.
 *
 * The one stored entry that does NOT survive is a source the producer
 * pool cannot honour, see {@link isDanglingSource}: it heals back onto
 * the bucket default rather than sitting on the row as an unpickable
 * dead end. A bucket default the pool cannot honour either — a pool only
 * aggregate on a ticker the account stopped producing, which is the case
 * a whole table full of dead rows comes from — heals one step further
 * onto {@link RAUKK_BUILTIN_DEFAULT_SOURCE}, the market topping
 * aggregate. That heal never moves a number: an aggregate over an empty
 * pool is priced at the market price by the resolver, which is exactly
 * what the market topping one charges there.
 *
 * The stored config is left alone — the heal is what the plan is priced
 * and displayed with, and the entry is overwritten the next time the row
 * is set or the snapshot is frozen.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkTickerSource>} sources Stored per plan
 * @param {Record<string, RAUKK_SOURCE_BUCKET[]>} buckets Buckets per ticker
 * @param {IRaukkSourcingDefaults} defaults Account wide defaults
 * @param {Function} producerUuidsOf Plans producing a ticker
 * @returns {Record<string, IRaukkTickerSource>} Effective sources
 */
export function resolveEffectiveSources(
	sources: Record<string, IRaukkTickerSource>,
	buckets: Record<string, RAUKK_SOURCE_BUCKET[]>,
	defaults: IRaukkSourcingDefaults,
	producerUuidsOf?: (ticker: string) => string[]
): Record<string, IRaukkTickerSource> {
	const effective: Record<string, IRaukkTickerSource> = { ...sources };

	Object.entries(buckets).forEach(([ticker, tickerBuckets]) => {
		const own: IRaukkTickerSource | undefined = effective[ticker];

		if (
			own !== undefined &&
			!isDanglingSource(ticker, own, producerUuidsOf)
		)
			return;

		const fallback: IRaukkTickerSource | undefined = defaultSourceOf(
			tickerBuckets,
			defaults
		);

		if (!fallback) return;

		effective[ticker] = isDanglingSource(ticker, fallback, producerUuidsOf)
			? { ...RAUKK_BUILTIN_DEFAULT_SOURCE }
			: fallback;
	});

	return effective;
}

/**
 * Tickers whose source a plan follows the account default for, rather than
 * an own stored entry. Drives the "default" marker of the input table.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkTickerSource>} sources Stored per plan
 * @param {Record<string, RAUKK_SOURCE_BUCKET[]>} buckets Buckets per ticker
 * @param {IRaukkSourcingDefaults} defaults Account wide defaults
 * @param {Function} producerUuidsOf Plans producing a ticker
 * @returns {Set<string>} Tickers following a default
 */
export function defaultedTickers(
	sources: Record<string, IRaukkTickerSource>,
	buckets: Record<string, RAUKK_SOURCE_BUCKET[]>,
	defaults: IRaukkSourcingDefaults,
	producerUuidsOf?: (ticker: string) => string[]
): Set<string> {
	const followed: Set<string> = new Set();

	Object.entries(buckets).forEach(([ticker, tickerBuckets]) => {
		const own: IRaukkTickerSource | undefined = sources[ticker];

		// a healed entry follows the default as much as an absent one
		if (
			own !== undefined &&
			!isDanglingSource(ticker, own, producerUuidsOf)
		)
			return;
		if (defaultSourceOf(tickerBuckets, defaults) === undefined) return;

		followed.add(ticker);
	});

	return followed;
}

/**
 * Union of the frozen bucket classifications of all stored snapshots.
 *
 * The account wide view of which ticker is a workforce consumable, a
 * repair material or a production input: a bucket a ticker holds on ANY
 * base it holds account wide, rations being rations everywhere. Backs the
 * "replace on every base" action, which has to know what a bucket default
 * covers without recalculating every plan.
 *
 * Snapshots written before the classification was frozen carry none and
 * simply contribute nothing.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots by plan uuid
 * @returns {Record<string, RAUKK_SOURCE_BUCKET[]>} Buckets per ticker
 */
export function mergeSnapshotBuckets(
	snapshots: Record<string, IRaukkSnapshot>
): Record<string, RAUKK_SOURCE_BUCKET[]> {
	const merged: Record<string, Set<RAUKK_SOURCE_BUCKET>> = {};

	Object.values(snapshots).forEach((snapshot) => {
		Object.entries(snapshot.inputBuckets ?? {}).forEach(
			([ticker, buckets]) => {
				const known: Set<RAUKK_SOURCE_BUCKET> =
					merged[ticker] ?? new Set<RAUKK_SOURCE_BUCKET>();

				buckets.forEach((bucket) => known.add(bucket));
				merged[ticker] = known;
			}
		);
	});

	return Object.fromEntries(
		Object.entries(merged).map(([ticker, set]) => [
			ticker,
			RAUKK_SOURCE_BUCKET_ORDER.filter((bucket) => set.has(bucket)),
		])
	);
}

/**
 * Per plan entries an account wide default would replace.
 *
 * Every stored source of a ticker the given bucket default covers, keyed
 * by plan uuid — the count the confirmation dialog states before the
 * entries are dropped. A ticker sitting in several buckets is only listed
 * for the bucket that owns it under `defaults`, so the dialog never
 * promises to touch an entry the merge would leave alone.
 *
 * A bucket set back to NO default still owns its tickers, see
 * {@link owningBucketOf}: clearing one is as much a change of what those
 * bases should follow — the builtin market top up — as setting one, and
 * the per base entries overriding it are the same entries either way.
 *
 * @author raukk
 *
 * @param {Record<string, { sources: ... }>} configs Stored plan configs
 * @param {Record<string, RAUKK_SOURCE_BUCKET[]>} buckets Buckets per ticker
 * @param {RAUKK_SOURCE_BUCKET} bucket Bucket being defaulted
 * @param {IRaukkSourcingDefaults} defaults Defaults after the change
 * @returns {Record<string, string[]>} Tickers per plan uuid
 */
export function overriddenTickersOf(
	configs: Record<string, { sources: Record<string, IRaukkTickerSource> }>,
	buckets: Record<string, RAUKK_SOURCE_BUCKET[]>,
	bucket: RAUKK_SOURCE_BUCKET,
	defaults: IRaukkSourcingDefaults
): Record<string, string[]> {
	const result: Record<string, string[]> = {};

	Object.entries(configs).forEach(([planUuid, config]) => {
		const tickers: string[] = Object.keys(config.sources)
			.filter((ticker) => {
				const tickerBuckets: RAUKK_SOURCE_BUCKET[] | undefined =
					buckets[ticker];

				if (!tickerBuckets?.includes(bucket)) return false;

				// the owning bucket owns the entry: a repair material that
				// is also a workforce consumable follows the workforce
				// default whenever that one is set, so the repair default
				// must not claim it
				return owningBucketOf(tickerBuckets, defaults) === bucket;
			})
			.sort();

		if (tickers.length > 0) result[planUuid] = tickers;
	});

	return result;
}
