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
	raukkSourcingPairKey,
} from "@/features/raukk_sourcing/calculations/shippingPairs";

// Types & Interfaces
import {
	IRaukkPairLookups,
	IRaukkPairPlanFlows,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
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
	volumePerUnit: number = 1
): IRaukkShippedTicker {
	return { ticker, unitsPerDay, weightPerUnit, volumePerUnit };
}

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "test",
	routingMode: "direct",
	sameSystemFlatCost: 0,
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
		// the cycle guard forbids the reverse edge: nothing rides out
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
});
