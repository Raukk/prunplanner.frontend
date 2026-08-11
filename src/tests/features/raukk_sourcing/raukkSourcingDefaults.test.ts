import { describe, it, expect } from "vitest";

// Functions
import {
	classifyInputBuckets,
	defaultedTickers,
	defaultSourceOf,
	mergeSnapshotBuckets,
	overriddenTickersOf,
	RAUKK_BUILTIN_DEFAULT_SOURCE,
	resolveEffectiveSources,
} from "@/features/raukk_sourcing/raukkSourcingDefaults";

// Types & Interfaces
import {
	IRaukkSnapshot,
	IRaukkSourcingDefaults,
	IRaukkTickerSource,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkInputRowSource } from "@/features/raukk_sourcing/raukkSourcingUi.types";

const AVERAGE: IRaukkTickerSource = {
	mode: "plan",
	sourcePlanUuid: "AGG_AVG",
};

const TOP_UP: IRaukkTickerSource = {
	mode: "plan",
	sourcePlanUuid: "AGG_AVG_MKT",
};

/** A base eating rations, running ORE and repairing with BSE */
const PLAN_RESULT: IRaukkInputRowSource = {
	materialio: [
		{ ticker: "RAT", delta: -12 },
		{ ticker: "ORE", delta: -300 },
		{ ticker: "ALO", delta: 100 },
		// a net input in neither gross list, e.g. netted away upstream
		{ ticker: "MCG", delta: -4 },
	],
	workforceMaterialIO: [{ ticker: "RAT", input: 12 }],
	productionMaterialIO: [{ ticker: "ORE", input: 300 }],
};

function snapshotWith(
	inputBuckets: IRaukkSnapshot["inputBuckets"]
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Plan",
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
		inputBuckets,
	};
}

describe("Raukk Sourcing Defaults", () => {
	describe("classifyInputBuckets", () => {
		it("splits net inputs and the repair demand into buckets", () => {
			expect(
				classifyInputBuckets(PLAN_RESULT, { BSE: 0.25, RAT: 0 })
			).toStrictEqual({
				RAT: ["workforce"],
				ORE: ["production"],
				// a net input matching no gross list groups with production
				MCG: ["production"],
				BSE: ["repair"],
			});
		});

		it("keeps a ticker in every bucket it belongs to", () => {
			expect(
				classifyInputBuckets(PLAN_RESULT, { RAT: 2, ORE: 1 })
			).toStrictEqual({
				RAT: ["workforce", "repair"],
				ORE: ["repair", "production"],
				MCG: ["production"],
			});
		});

		it("ignores outputs and an empty repair demand", () => {
			expect(classifyInputBuckets(PLAN_RESULT).ALO).toBeUndefined();
		});
	});

	describe("defaultSourceOf", () => {
		const defaults: IRaukkSourcingDefaults = {
			workforce: AVERAGE,
			repair: TOP_UP,
		};

		it("takes the first bucket of the precedence order", () => {
			expect(defaultSourceOf(["workforce", "repair"], defaults)).toBe(
				AVERAGE
			);
			expect(defaultSourceOf(["repair"], defaults)).toBe(TOP_UP);
		});

		it("skips buckets without a default", () => {
			expect(defaultSourceOf(["production", "repair"], defaults)).toBe(
				TOP_UP
			);
		});

		it("falls back to the built-in default with no bucket default", () => {
			expect(defaultSourceOf(["production"], defaults)).toStrictEqual(
				RAUKK_BUILTIN_DEFAULT_SOURCE
			);
			expect(defaultSourceOf(["workforce"], {})).toStrictEqual(
				RAUKK_BUILTIN_DEFAULT_SOURCE
			);
		});

		it("has none without buckets", () => {
			expect(defaultSourceOf(undefined, defaults)).toBeUndefined();
			expect(defaultSourceOf([], defaults)).toBeUndefined();
		});
	});

	describe("resolveEffectiveSources", () => {
		const buckets: Record<
			string,
			("workforce" | "repair" | "production")[]
		> = {
			RAT: ["workforce"],
			BSE: ["repair"],
			ORE: ["production"],
		};

		it("fills tickers without an own entry from the bucket default", () => {
			expect(
				resolveEffectiveSources({}, buckets, {
					workforce: AVERAGE,
					repair: TOP_UP,
				})
				// production stores no default and takes the built-in one
			).toStrictEqual({
				RAT: AVERAGE,
				BSE: TOP_UP,
				ORE: RAUKK_BUILTIN_DEFAULT_SOURCE,
			});
		});

		it("fills every bucket from the built-in default without any", () => {
			expect(resolveEffectiveSources({}, buckets, {})).toStrictEqual({
				RAT: RAUKK_BUILTIN_DEFAULT_SOURCE,
				BSE: RAUKK_BUILTIN_DEFAULT_SOURCE,
				ORE: RAUKK_BUILTIN_DEFAULT_SOURCE,
			});
		});

		it("never overrides a stored per plan entry", () => {
			const stored: Record<string, IRaukkTickerSource> = {
				RAT: { mode: "market", priceMode: "ASK" },
				// the explicit opt out of the default
				BSE: { mode: "cx" },
			};

			expect(
				resolveEffectiveSources(stored, buckets, {
					workforce: AVERAGE,
					repair: TOP_UP,
				})
			).toStrictEqual({
				...stored,
				ORE: RAUKK_BUILTIN_DEFAULT_SOURCE,
			});
		});

		describe("dangling plan sources", () => {
			const gone: Record<string, IRaukkTickerSource> = {
				RAT: { mode: "plan", sourcePlanUuid: "removed-base" },
			};

			/** Only "living-base" still makes anything */
			const producerUuidsOf = (): string[] => ["living-base"];

			/** Nothing is produced at all any more */
			const emptyPool = (): string[] => [];

			it("heals an entry whose producer is gone onto the default", () => {
				expect(
					resolveEffectiveSources(
						gone,
						buckets,
						{ workforce: AVERAGE },
						producerUuidsOf
					).RAT
				).toBe(AVERAGE);
			});

			it("keeps an entry whose producer still makes it", () => {
				const stored: Record<string, IRaukkTickerSource> = {
					RAT: { mode: "plan", sourcePlanUuid: "living-base" },
				};

				expect(
					resolveEffectiveSources(
						stored,
						buckets,
						{ workforce: AVERAGE },
						producerUuidsOf
					).RAT
				).toBe(stored.RAT);
			});

			it("never treats the market top up as dangling", () => {
				const stored: Record<string, IRaukkTickerSource> = {
					RAT: TOP_UP,
				};

				expect(
					resolveEffectiveSources(
						stored,
						buckets,
						{ workforce: AVERAGE },
						emptyPool
					).RAT
				).toBe(TOP_UP);
			});

			it("keeps a pool only aggregate while a pool exists", () => {
				const stored: Record<string, IRaukkTickerSource> = {
					RAT: AVERAGE,
				};

				expect(
					resolveEffectiveSources(
						stored,
						buckets,
						{},
						producerUuidsOf
					).RAT
				).toBe(AVERAGE);
			});

			it("heals a pool only aggregate over an empty pool", () => {
				const stored: Record<string, IRaukkTickerSource> = {
					RAT: AVERAGE,
				};

				expect(
					resolveEffectiveSources(
						stored,
						buckets,
						{ workforce: TOP_UP },
						emptyPool
					).RAT
				).toBe(TOP_UP);
			});

			it("heals a pool only bucket default onto the market top up", () => {
				// the whole table of dead rows: nothing produces the
				// ticker and the account default names the empty pool
				expect(
					resolveEffectiveSources(
						{},
						buckets,
						{ workforce: AVERAGE },
						emptyPool
					).RAT
				).toStrictEqual(RAUKK_BUILTIN_DEFAULT_SOURCE);
			});

			it("leaves stored entries alone without the producer check", () => {
				expect(
					resolveEffectiveSources(gone, buckets, {
						workforce: AVERAGE,
					}).RAT
				).toBe(gone.RAT);
			});

			it("counts a healed ticker as following the default", () => {
				const followed: Set<string> = defaultedTickers(
					gone,
					buckets,
					{ workforce: AVERAGE },
					producerUuidsOf
				);

				expect(followed.has("RAT")).toBe(true);
			});
		});

		it("keeps stored entries of tickers the plan no longer consumes", () => {
			expect(
				resolveEffectiveSources({ PWO: AVERAGE }, buckets, {})
			).toStrictEqual({
				PWO: AVERAGE,
				RAT: RAUKK_BUILTIN_DEFAULT_SOURCE,
				BSE: RAUKK_BUILTIN_DEFAULT_SOURCE,
				ORE: RAUKK_BUILTIN_DEFAULT_SOURCE,
			});
		});
	});

	describe("defaultedTickers", () => {
		it("lists only the tickers following a default", () => {
			const followed: Set<string> = defaultedTickers(
				{ BSE: { mode: "cx" } },
				{ RAT: ["workforce"], BSE: ["repair"], ORE: ["production"] },
				{ workforce: AVERAGE, repair: TOP_UP }
			);

			// BSE opted out and stores its own; ORE follows the built-in
			expect(Array.from(followed)).toStrictEqual(["RAT", "ORE"]);
		});
	});

	describe("mergeSnapshotBuckets", () => {
		it("unions the frozen classifications of every plan", () => {
			expect(
				mergeSnapshotBuckets({
					a: snapshotWith({ RAT: ["workforce"], BSE: ["repair"] }),
					b: snapshotWith({ RAT: ["workforce", "production"] }),
					// written before the classification existed
					c: snapshotWith(undefined),
				})
			).toStrictEqual({
				RAT: ["workforce", "production"],
				BSE: ["repair"],
			});
		});
	});

	describe("overriddenTickersOf", () => {
		const buckets: Record<
			string,
			("workforce" | "repair" | "production")[]
		> = {
			RAT: ["workforce"],
			DW: ["workforce"],
			BSE: ["repair"],
			// both, so the workforce default owns it while it is set
			OVE: ["workforce", "repair"],
		};

		const configs = {
			a: {
				sources: {
					RAT: AVERAGE,
					BSE: AVERAGE,
					OVE: AVERAGE,
					// no bucket at all, never claimed by a default
					FF: AVERAGE,
				},
			},
			b: { sources: { DW: AVERAGE } },
			c: { sources: {} },
		};

		it("lists the entries the bucket default would replace", () => {
			expect(
				overriddenTickersOf(configs, buckets, "workforce", {
					workforce: AVERAGE,
				})
			).toStrictEqual({ a: ["OVE", "RAT"], b: ["DW"] });
		});

		it("leaves a multi bucket ticker to the winning bucket", () => {
			expect(
				overriddenTickersOf(configs, buckets, "repair", {
					workforce: AVERAGE,
					repair: TOP_UP,
				})
			).toStrictEqual({ a: ["BSE"] });
		});

		it("claims the multi bucket ticker once its own bucket wins", () => {
			expect(
				overriddenTickersOf(configs, buckets, "repair", {
					repair: TOP_UP,
				})
			).toStrictEqual({ a: ["BSE", "OVE"] });
		});
	});
});
