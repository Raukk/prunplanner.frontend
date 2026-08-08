import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkRouteDistance,
	IRaukkSystemNode,
	createRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	RAUKK_DEFAULT_ROUTES,
	buildShippingPairs,
	raukkCxPairKey,
	raukkLaneCargo,
	raukkSourcingPairKey,
	resolveMutualLanes,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import { calculateShipping } from "@/features/raukk_sourcing/calculations/shipping";

// Types & Interfaces
import {
	IRaukkCargoDimension,
	IRaukkMutualVerdict,
	IRaukkPairLookups,
	IRaukkPairPlanFlows,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	IRaukkCadenceCaps,
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	IRaukkShippingResult,
	RAUKK_CARGO_BUCKET,
} from "@/features/raukk_sourcing/calculations/shipping.types";

const profile: IRaukkResolvedShipProfile = {
	id: "test",
	name: "Test Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 100,
	stlBlockCost: 50,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0.001,
	damagePerStlBlock: 0.002,
	shipsAvailable: 1,
};

function system(
	naturalId: string,
	position: [number, number, number],
	connections: string[]
): IRaukkSystemNode {
	return {
		SystemId: `sys-${naturalId}`,
		NaturalId: naturalId,
		Connections: connections.map((element) => ({
			ConnectingId: `sys-${element}`,
		})),
		PositionX: position[0],
		PositionY: position[1],
		PositionZ: position[2],
	};
}

/**
 * A line of four systems. CX-001 is the only exchange and sits next to
 * the consumer AA-002, the source AA-003 is one hop further out and
 * AA-004 is the unreachable island.
 */
const graph: IRaukkSystemNode[] = [
	system("CX-001", [0, 0, 0], ["AA-002"]),
	system("AA-002", [10, 0, 0], ["AA-003"]),
	system("AA-003", [30, 0, 0], []),
	system("AA-004", [1000, 0, 0], []),
];

const routes: IRaukkRouteDistance = createRouteDistance(graph, ["sys-CX-001"]);

function cargo(
	ticker: string,
	unitsPerDay: number,
	weightPerUnit: number = 1,
	volumePerUnit: number = 1,
	bucket: RAUKK_CARGO_BUCKET = "production"
): IRaukkShippedTicker {
	return { ticker, bucket, unitsPerDay, weightPerUnit, volumePerUnit };
}

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "test",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

/** Account defaults, days per visit */
const CAPS: IRaukkCadenceCaps = {
	production: 14,
	workforce: 30,
	repair: 90,
};

const flows: IRaukkPairPlanFlows = {
	planUuid: "consumer",
	planetNaturalId: "AA-002b",
	inputs: [cargo("ORE", 100), cargo("RAT", 10)],
	outputs: [cargo("MET", 50)],
};

function lookups(
	overrides: Partial<IRaukkPairLookups> = {}
): IRaukkPairLookups {
	return {
		originOf: () => [],
		planetOf: () => undefined,
		subscribedOf: () => 0,
		profileOf: () => profile,
		routes,
		...overrides,
	};
}

describe("Raukk Sourcing: Shipping Pairs", () => {
	it("exposes the real route index as the default", () => {
		// the real systems JSON, ZV-307 is Antares I
		expect(RAUKK_DEFAULT_ROUTES.resolveSystemId("ZV-307")).toBe(
			"8ecf9670ba070d78cfb5537e8d9f1b6c"
		);
		expect(
			RAUKK_DEFAULT_ROUTES.parsecDistance(
				"8ecf9670ba070d78cfb5537e8d9f1b6c",
				"8ecf9670ba070d78cfb5537e8d9f1b6c"
			)
		).toBe(0);
		expect(
			RAUKK_DEFAULT_ROUTES.jumpCount(
				"8ecf9670ba070d78cfb5537e8d9f1b6c",
				"8ecf9670ba070d78cfb5537e8d9f1b6c"
			)
		).toBe(0);
		expect(
			RAUKK_DEFAULT_ROUTES.nearestCx("8ecf9670ba070d78cfb5537e8d9f1b6c")
				?.systemId
		).toBe("8ecf9670ba070d78cfb5537e8d9f1b6c");
	});

	it("returns nothing while shipping is disabled", () => {
		expect(
			buildShippingPairs(flows, lookups(), {
				...config,
				enabled: false,
			})
		).toStrictEqual([]);
	});

	it("returns nothing for an unresolvable planet", () => {
		expect(
			buildShippingPairs(
				{ ...flows, planetNaturalId: "XX-999a" },
				lookups(),
				config
			)
		).toStrictEqual([]);
	});

	it("puts every market buy and the unsold outputs on one CX pair", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups(),
			config
		);

		expect(pairs.length).toBe(1);
		expect(pairs[0].pairKey).toBe(raukkCxPairKey("consumer"));
		expect(pairs[0].back.map((entry) => entry.ticker)).toStrictEqual([
			"ORE",
			"RAT",
		]);
		expect(pairs[0].out.map((entry) => entry.ticker)).toStrictEqual([
			"MET",
		]);
		// consumer to its exchange, one hop of 10 position units
		expect(pairs[0].route.jumps).toBe(1);
	});

	it("ships through the anchored exchange instead of the nearest", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			// AA-003 stands in for a further exchange the account anchored
			// the plan at: two hops out instead of the one to CX-001
			lookups({ anchorCxSystemId: "sys-AA-003" }),
			config
		);

		expect(pairs[0].route.jumps).toBe(1);
		expect(pairs[0].route.parsecs).toBeCloseTo(20 / 12, 10);
	});

	it("falls back to the nearest exchange when the anchor is unreachable", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({ anchorCxSystemId: "sys-AA-004" }),
			config
		);

		expect(pairs[0].route.parsecs).toBeCloseTo(10 / 12, 10);
	});

	it("clamps the CX sells at zero when oversubscribed", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({ subscribedOf: () => 80 }),
			config
		);

		// 50 produced, 80 drawn by others: nothing is left for the market
		expect(pairs[0].out).toStrictEqual([]);
		expect(pairs[0].back.length).toBe(2);
	});

	it("subtracts subscriber draws from the CX sells", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({ subscribedOf: () => 20 }),
			config
		);

		expect(pairs[0].out).toStrictEqual([cargo("MET", 30)]);
	});

	it("moves a sourced ticker onto a consumer owned sourcing pair", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				originOf: (ticker: string) =>
					ticker === "ORE" ? [{ planUuid: "source", share: 1 }] : [],
				planetOf: () => "AA-003a",
			}),
			config
		);

		expect(pairs.length).toBe(2);

		const sourcing: IRaukkShippingPair = pairs[0];
		expect(sourcing.pairKey).toBe(
			raukkSourcingPairKey("consumer", "source")
		);
		// a sourcing pair never carries a backhaul: nothing rides out
		expect(sourcing.out).toStrictEqual([]);
		expect(sourcing.back).toStrictEqual([cargo("ORE", 100)]);
		expect(sourcing.route.jumps).toBe(1);

		// the market buy stays on the CX pair
		expect(pairs[1].back).toStrictEqual([cargo("RAT", 10)]);
	});

	it("splits an aggregate source across its producers", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				originOf: (ticker: string) =>
					ticker === "ORE"
						? [
								{ planUuid: "a", share: 0.25 },
								{ planUuid: "b", share: 0.75 },
							]
						: [],
				planetOf: () => "AA-003a",
			}),
			config
		);

		expect(pairs.length).toBe(3);
		expect(pairs[0].back).toStrictEqual([cargo("ORE", 25)]);
		expect(pairs[1].back).toStrictEqual([cargo("ORE", 75)]);
	});

	it("drops a source without a resolvable planet", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				originOf: (ticker: string) =>
					ticker === "ORE" ? [{ planUuid: "source", share: 1 }] : [],
				planetOf: () => undefined,
			}),
			config
		);

		expect(pairs.length).toBe(1);
		expect(pairs[0].pairKey).toBe(raukkCxPairKey("consumer"));
	});

	it("drops a source that cannot be reached", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				originOf: (ticker: string) =>
					ticker === "ORE" ? [{ planUuid: "source", share: 1 }] : [],
				planetOf: () => "AA-004a",
			}),
			config
		);

		expect(pairs.length).toBe(1);
		expect(pairs[0].pairKey).toBe(raukkCxPairKey("consumer"));
	});

	it("substitutes the hub distance in cx-hub mode", () => {
		const direct: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				originOf: (ticker: string) =>
					ticker === "ORE" ? [{ planUuid: "source", share: 1 }] : [],
				planetOf: () => "AA-003a",
			}),
			config
		);

		const hub: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				originOf: (ticker: string) =>
					ticker === "ORE" ? [{ planUuid: "source", share: 1 }] : [],
				planetOf: () => "AA-003a",
			}),
			{ ...config, routingMode: "cx-hub" }
		);

		// direct 20 units, hub 30 (source to CX) + 10 (CX to consumer)
		expect(hub[0].route.parsecs).toBeCloseTo(
			direct[0].route.parsecs * 2,
			10
		);
		expect(hub[0].route.jumps).toBe(3);
		// still one consumer owned pair, the CX pair is untouched
		expect(hub.length).toBe(2);
		expect(hub[1].route).toStrictEqual(direct[1].route);
	});

	it("uses the per pair profile override", () => {
		const other: IRaukkResolvedShipProfile = { ...profile, id: "other" };

		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			flows,
			lookups({
				profileOf: (pairKey: string) =>
					pairKey === raukkCxPairKey("consumer") ? other : profile,
			}),
			config
		);

		expect(pairs[0].profile.id).toBe("other");
	});

	it("skips a CX pair that would carry nothing", () => {
		const pairs: IRaukkShippingPair[] = buildShippingPairs(
			{ ...flows, inputs: [], outputs: [] },
			lookups(),
			config
		);

		expect(pairs).toStrictEqual([]);
	});

	describe("cargo buckets", () => {
		/** ORE feeds production and the workforce at once, on one lane */
		const split: IRaukkPairPlanFlows = {
			...flows,
			inputs: [
				cargo("ORE", 60, 1, 1, "production"),
				cargo("ORE", 40, 1, 1, "workforce"),
				cargo("RAT", 10),
			],
		};

		it("keeps the bucket rows of one ticker apart on a lane", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				split,
				lookups({
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [{ planUuid: "source", share: 1 }]
							: [],
					planetOf: () => "AA-003a",
				}),
				config
			);

			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 60, 1, 1, "production"),
				cargo("ORE", 40, 1, 1, "workforce"),
			]);
		});

		it("keeps them apart on the exchange lane as well", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				split,
				lookups(),
				config
			);

			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 60, 1, 1, "production"),
				cargo("ORE", 40, 1, 1, "workforce"),
				cargo("RAT", 10),
			]);
		});

		it("shares one chain claim across the bucket rows", () => {
			// the claim is per ticker and lane: 50 of the 100 ORE ride
			// the chain, both buckets give up half of their units
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				split,
				lookups({
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [{ planUuid: "source", share: 1 }]
							: [],
					planetOf: () => "AA-003a",
					claimedUnitsOf: (ticker: string) =>
						ticker === "ORE" ? 50 : 0,
				}),
				config
			);

			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 30, 1, 1, "production"),
				cargo("ORE", 20, 1, 1, "workforce"),
			]);
		});

		it("flies the bucket rows as legs of their own cadence", () => {
			// one lane, two legs: the production row rides the 14 day
			// cadence, the workforce row the 30 day one
			const apart: IRaukkShippingResult = calculateShipping(
				buildShippingPairs(split, lookups(), config),
				config,
				() => 0,
				CAPS
			);

			expect(apart.pairs[0].legs.map((leg) => leg.bucket)).toStrictEqual([
				"production",
				"workforce",
			]);

			// 60 ORE + 10 RAT = 70 t on a 1000 t hull fills in 14.29 days,
			// which the cap shortens to 14 — a partial trip, paying a full
			// one
			expect(apart.pairs[0].legs[0].fillDays).toBeCloseTo(1000 / 70, 10);
			expect(apart.pairs[0].legs[0].visitDays).toBe(14);
			expect(apart.pairs[0].legs[0].tripsPerDay).toBeCloseTo(1 / 14, 10);

			// 40 ORE fill in 25 days, inside the 30 day workforce cap
			expect(apart.pairs[0].legs[1].visitDays).toBeCloseTo(25, 10);
			expect(apart.pairs[0].legs[1].tripsPerDay).toBeCloseTo(0.04, 10);

			expect(apart.pairs[0].tripsPerDay).toBeCloseTo(1 / 14 + 0.04, 10);
		});

		it("keeps an unsplit ticker on a single leg", () => {
			const together: IRaukkShippingResult = calculateShipping(
				buildShippingPairs(flows, lookups(), config),
				config,
				() => 0,
				CAPS
			);

			// 110 t a day fill the hull in 9.09 days, well inside the cap
			expect(together.pairs[0].legs).toHaveLength(1);
			expect(together.pairs[0].tripsPerDay).toBeCloseTo(0.11, 10);
		});
	});

	describe("mutual lanes", () => {
		it("buys a rerouted source at the own exchange instead", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [{ planUuid: "source", share: 1 }]
							: [],
					planetOf: () => "AA-003a",
					viaCxSourceOf: (planUuid: string) => planUuid === "source",
				}),
				config
			);

			// no sourcing pair at all, the ORE rides the exchange lane
			expect(pairs.length).toBe(1);
			expect(pairs[0].pairKey).toBe(raukkCxPairKey("consumer"));
			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 100),
				cargo("RAT", 10),
			]);
		});

		it("merges a ticker rerouted from several sources", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [
									{ planUuid: "a", share: 0.25 },
									{ planUuid: "b", share: 0.75 },
								]
							: [],
					planetOf: () => "AA-003a",
					viaCxSourceOf: () => true,
				}),
				config
			);

			// one entry, not two: a ticker charged over its own units
			// twice would double its ȼ per unit
			expect(pairs.length).toBe(1);
			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 100),
				cargo("RAT", 10),
			]);
		});

		it("leaves the chain claimed units off the rerouted cargo", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [{ planUuid: "source", share: 1 }]
							: [],
					planetOf: () => "AA-003a",
					viaCxSourceOf: () => true,
					// the chain still hauls the DIRECT lane, its units
					// must not ride the exchange lane on top
					claimedUnitsOf: (
						ticker: string,
						counterpart: string | undefined,
						inbound: boolean
					) =>
						ticker === "ORE" && counterpart === "AA-003a" && inbound
							? 40
							: 0,
				}),
				config
			);

			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 60),
				cargo("RAT", 10),
			]);
		});

		it("sells what a rerouted counterpart no longer collects", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					subscribedOf: () => 50,
					viaCxSoldOf: (ticker: string) =>
						ticker === "MET" ? 20 : 0,
				}),
				config
			);

			// 50 produced, all 50 subscribed, 20 of them by a counterpart
			// whose lane was rerouted: those 20 leave through the exchange
			expect(pairs[0].out).toStrictEqual([cargo("MET", 20)]);
		});
	});

	describe("local market", () => {
		it("keeps an LM sold output off the exchange lane", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({ localSaleOf: (ticker) => ticker === "MET" }),
				config
			);

			// nobody draws the MET, so all 50 units are market bound
			// excess and sell on the own planet instead
			expect(pairs[0].out).toStrictEqual([]);
			expect(pairs[0].back).toStrictEqual([
				cargo("ORE", 100),
				cargo("RAT", 10),
			]);
		});

		it("keeps an LM sold output off it with subscribers as well", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					subscribedOf: (ticker) => (ticker === "MET" ? 30 : 0),
					localSaleOf: (ticker) => ticker === "MET",
				}),
				config
			);

			// 30 of the 50 are drawn and were never market bound; the
			// remaining 20 are, and those are what the flag removes
			expect(pairs[0].out).toStrictEqual([]);
		});

		it("still ships what a counterpart draws off an LM sold output", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					subscribedOf: () => 50,
					viaCxSoldOf: (ticker: string) =>
						ticker === "MET" ? 20 : 0,
					localSaleOf: (ticker) => ticker === "MET",
				}),
				config
			);

			// exactly the rerouted 20 units stay outbound: they are
			// consumed on another planet and cannot sell on this one
			expect(pairs[0].out).toStrictEqual([cargo("MET", 20)]);
		});

		it("leaves the chain claim on the rerouted portion", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					subscribedOf: () => 50,
					viaCxSoldOf: (ticker: string) =>
						ticker === "MET" ? 20 : 0,
					localSaleOf: (ticker) => ticker === "MET",
					claimedUnitsOf: (
						ticker: string,
						counterpart: string | undefined,
						inbound: boolean
					) =>
						ticker === "MET" &&
						counterpart === undefined &&
						!inbound
							? 5
							: 0,
				}),
				config
			);

			expect(pairs[0].out).toStrictEqual([cargo("MET", 15)]);
		});

		it("keeps an LM bought input off the exchange lane", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({ localBuyOf: (ticker) => ticker === "ORE" }),
				config
			);

			// the ORE is bought where it is consumed, the RAT is not
			expect(pairs[0].back).toStrictEqual([cargo("RAT", 10)]);
			expect(pairs[0].out).toStrictEqual([cargo("MET", 50)]);
		});

		it("keeps every bucket of an LM bought input off it", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				{
					...flows,
					inputs: [
						cargo("ORE", 60),
						cargo("ORE", 20, 1, 1, "workforce"),
						cargo("ORE", 20, 1, 1, "repair"),
						cargo("RAT", 10),
					],
				},
				lookups({ localBuyOf: (ticker) => ticker === "ORE" }),
				config
			);

			expect(pairs[0].back).toStrictEqual([cargo("RAT", 10)]);
		});

		it("drops the exchange pair when both sides are local", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					localBuyOf: () => true,
					localSaleOf: () => true,
				}),
				config
			);

			expect(pairs).toStrictEqual([]);
		});

		it("leaves a hub/spoke rerouted draw untouched", () => {
			const pairs: IRaukkShippingPair[] = buildShippingPairs(
				flows,
				lookups({
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [{ planUuid: "source", share: 1 }]
							: [],
					planetOf: () => "AA-003a",
					viaCxSourceOf: () => true,
					localBuyOf: (ticker) => ticker === "RAT",
				}),
				config
			);

			// the ORE is a plan sourced draw rerouted through the
			// exchange, not a market buy: the flag never reaches it
			expect(pairs[0].back).toStrictEqual([cargo("ORE", 100)]);
		});
	});
});

const heavy: IRaukkShippedTicker[] = [cargo("ORE", 300, 1, 1)];
const light: IRaukkShippedTicker[] = [cargo("RAT", 100, 1, 1)];

describe("Raukk Sourcing: Mutual Lane Verdict", () => {
	it("lets the heavier direction keep its direct lane", () => {
		const verdict: IRaukkMutualVerdict = resolveMutualLanes(
			{ consumerPlanUuid: "a", cargo: light, profile },
			{ consumerPlanUuid: "b", cargo: heavy, profile }
		);

		expect(verdict.directConsumerPlanUuid).toBe("b");
		expect(verdict.cxConsumerPlanUuid).toBe("a");
		expect(verdict.directLoads).toBeCloseTo(0.3, 10);
		expect(verdict.cxLoads).toBeCloseTo(0.1, 10);
	});

	it("reaches the same verdict from either side", () => {
		// plan a and plan b run this independently over the same frozen
		// data, only the argument order differs
		const fromA: IRaukkMutualVerdict = resolveMutualLanes(
			{ consumerPlanUuid: "a", cargo: light, profile },
			{ consumerPlanUuid: "b", cargo: heavy, profile }
		);
		const fromB: IRaukkMutualVerdict = resolveMutualLanes(
			{ consumerPlanUuid: "b", cargo: heavy, profile },
			{ consumerPlanUuid: "a", cargo: light, profile }
		);

		expect(fromA).toStrictEqual(fromB);
	});

	it("weighs each direction with its own hull and dimension", () => {
		// 100 units of 1 m³ on a volume hull of 10 beat 300 units of
		// 1 t on a weight hull of 10000
		const verdict: IRaukkMutualVerdict = resolveMutualLanes(
			{
				consumerPlanUuid: "a",
				cargo: light,
				profile: { ...profile, cargoWeight: 10000, cargoVolume: 10 },
			},
			{
				consumerPlanUuid: "b",
				cargo: heavy,
				profile: { ...profile, cargoWeight: 10000, cargoVolume: 10000 },
			}
		);

		expect(verdict.directConsumerPlanUuid).toBe("a");
		expect(verdict.directLoads).toBeCloseTo(10, 10);
	});

	it("gives a tie to the lower consumer plan uuid", () => {
		const verdict: IRaukkMutualVerdict = resolveMutualLanes(
			{ consumerPlanUuid: "zulu", cargo: heavy, profile },
			{ consumerPlanUuid: "alpha", cargo: [...heavy], profile }
		);

		expect(verdict.directConsumerPlanUuid).toBe("alpha");
		expect(verdict.cxConsumerPlanUuid).toBe("zulu");
		expect(
			resolveMutualLanes(
				{ consumerPlanUuid: "alpha", cargo: [...heavy], profile },
				{ consumerPlanUuid: "zulu", cargo: heavy, profile }
			)
		).toStrictEqual(verdict);
	});

	it("counts a sub deadband difference as a tie", () => {
		// 300 versus 300.5 units of a 1000 t hull: the load counts differ
		// by 0.0005, far under the equality deadband, so the lower uuid
		// keeps its lane instead of the marginally heavier direction
		const verdict: IRaukkMutualVerdict = resolveMutualLanes(
			{ consumerPlanUuid: "alpha", cargo: heavy, profile },
			{
				consumerPlanUuid: "zulu",
				cargo: [cargo("ORE", 300.5, 1, 1)],
				profile,
			}
		);

		expect(verdict.directConsumerPlanUuid).toBe("alpha");
		expect(verdict.cxConsumerPlanUuid).toBe("zulu");
	});

	it("ties an empty relationship to the lower uuid as well", () => {
		const verdict: IRaukkMutualVerdict = resolveMutualLanes(
			{ consumerPlanUuid: "b", cargo: [], profile },
			{ consumerPlanUuid: "a", cargo: [], profile }
		);

		expect(verdict.directConsumerPlanUuid).toBe("a");
		expect(verdict.directLoads).toBe(0);
	});

	it("does not depend on the ticker order of a direction", () => {
		const one: IRaukkShippedTicker[] = [
			cargo("ORE", 0.1, 0.1, 0),
			cargo("RAT", 0.2, 0.2, 0),
			cargo("MET", 0.3, 0.3, 0),
		];

		expect(
			resolveMutualLanes(
				{ consumerPlanUuid: "a", cargo: one, profile },
				{ consumerPlanUuid: "b", cargo: light, profile }
			)
		).toStrictEqual(
			resolveMutualLanes(
				{ consumerPlanUuid: "a", cargo: [...one].reverse(), profile },
				{ consumerPlanUuid: "b", cargo: light, profile }
			)
		);
	});
});

describe("Raukk Sourcing: Lane Cargo", () => {
	const dimensions: Record<string, IRaukkCargoDimension> = {
		ORE: { weightPerUnit: 1, volumePerUnit: 2 },
		RAT: { weightPerUnit: 3, volumePerUnit: 4 },
	};

	it("normalises the ticker order and drops empty entries", () => {
		expect(
			raukkLaneCargo(
				{ RAT: 10, ORE: 100, MET: 0 },
				(ticker: string) => dimensions[ticker]
			)
		).toStrictEqual([
			{
				ticker: "ORE",
				bucket: "production",
				unitsPerDay: 100,
				weightPerUnit: 1,
				volumePerUnit: 2,
			},
			{
				ticker: "RAT",
				bucket: "production",
				unitsPerDay: 10,
				weightPerUnit: 3,
				volumePerUnit: 4,
			},
		]);
	});

	it("rides an unknown ticker along weightless", () => {
		expect(raukkLaneCargo({ XXX: 5 }, () => undefined)).toStrictEqual([
			{
				ticker: "XXX",
				bucket: "production",
				unitsPerDay: 5,
				weightPerUnit: 0,
				volumePerUnit: 0,
			},
		]);
	});
});
