import { describe, expect, it } from "vitest";

// Calculations
import {
	createRouteDistance,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_POSITION_UNITS_PER_PARSEC,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	buildCxSplitChains,
	calculateChainCxSplit,
	detectCxSplit,
	raukkChainAnchors,
	raukkChainSideKey,
	raukkDefaultChainConfig,
	RAUKK_CHAIN_SIDE_KEYS,
} from "@/features/raukk_sourcing/calculations/shippingChains";
import {
	raukkDepotDailyCosts,
	raukkDepotDailyTotal,
	raukkDepotStopKey,
	RAUKK_DEPOT_DAYS_PER_WEEK,
} from "@/features/raukk_sourcing/calculations/shippingDepots";

// Schemas
import {
	RaukkChainSchema,
	RaukkDepotSchema,
	RaukkSourcingExportSchema,
} from "@/features/raukk_sourcing/raukkSourcingStore.schemas";

// Types & Interfaces
import {
	IRaukkGateLink,
	IRaukkRouteDistance,
	IRaukkSystemNode,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkResolvedShipProfile,
	IRaukkShippingConfig,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainFlow,
	IRaukkChainInput,
	IRaukkChainLegResult,
	IRaukkChainShipping,
	IRaukkCxSplitResult,
	IRaukkCxSplitTrigger,
	IRaukkCxSubChain,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { IRaukkDepotDailyCost } from "@/features/raukk_sourcing/calculations/shippingDepots";

/** One parsec, in the position units of the systems JSON */
const PC: number = RAUKK_POSITION_UNITS_PER_PARSEC;

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
	} as unknown as IRaukkSystemNode;
}

/**
 * The HRT ⇄ Hephaestus shape, in fixture form.
 *
 * `HRT-001a` is the base, `ZV-307c` the depot planet and `NC-001` carries
 * the exchange. The three systems sit in an FTL line 10 pc apart, so the
 * base to exchange leg passes the depot at zero detour — the anchor a
 * split has to find. `VH-331` is off the FTL line entirely and only
 * carries the gate hop the STL-only side flies: HRT → Promitor →
 * Hephaestus, both hops gate served.
 */
const SYSTEMS: IRaukkSystemNode[] = [
	system("HRT-001", [0, 0, 0], ["ZV-307"]),
	system("ZV-307", [10 * PC, 0, 0], ["NC-001"]),
	system("NC-001", [20 * PC, 0, 0], []),
	system("VH-331", [0, 30 * PC, 0], []),
];

function gate(
	a: string,
	b: string,
	aFee: number,
	bFee: number
): IRaukkGateLink {
	return {
		a,
		aName: a,
		b,
		bName: b,
		aGate: {
			id: `GTW-${a}`,
			fee: aFee,
			cur: "AIC",
			maxM3: 6000,
			jumps24h: 250,
			up: "0/5 c",
			est: "200d",
		},
		bGate: {
			id: `GTW-${b}`,
			fee: bFee,
			cur: "AIC",
			maxM3: 6000,
			jumps24h: 250,
			up: "0/5 c",
			est: "200d",
		},
		maxTraversalM3: 6000,
		hcbCapable: false,
	};
}

/** The Promitor gate, both of its hops */
const GATES: IRaukkGateLink[] = [
	gate("HRT-001a", "VH-331a", 1000, 1200),
	gate("VH-331a", "ZV-307c", 1200, 1400),
];

const routes: IRaukkRouteDistance = createRouteDistance(
	SYSTEMS,
	RAUKK_CX_SYSTEM_IDS,
	GATES
);

/** The exchange of the fixture, injected exactly as the chain math takes it */
const cxSystems: Record<string, string> = { NC1: "sys-NC-001" };

const HRT: string = "HRT-001a";
const HEPH: string = "ZV-307c";

const ftlProfile: IRaukkResolvedShipProfile = {
	id: "ftl-hauler",
	name: "FTL Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	stlOnly: false,
	costPerParsec: 10,
	stlBlockCost: 200,
	ftlFuelPerParsec: 4,
	stlFuelPerBlock: 100,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0.001,
	damagePerStlBlock: 0.002,
	shipsAvailable: 1,
};

/** The gate side hopper: no FTL drive, so every leg has to be gated */
const stlProfile: IRaukkResolvedShipProfile = {
	...ftlProfile,
	id: "stl-hopper",
	name: "STL Hopper",
	stlOnly: true,
};

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "ftl-hauler",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

function flow(
	ticker: string,
	fromStop: string,
	toStop: string,
	unitsPerDay: number
): IRaukkChainFlow {
	return {
		flowId: `${ticker}:${fromStop}>${toStop}`,
		ticker,
		fromStop,
		toStop,
		unitsPerDay,
		weightPerUnit: 1,
		volumePerUnit: 1,
	};
}

function chainInput(
	overrides: Partial<IRaukkChainInput> = {}
): IRaukkChainInput {
	return {
		chain: { chainId: "chain-heph", stops: [HRT, "NC1"] },
		profile: ftlProfile,
		flows: [flow("RAT", HRT, "NC1", 100)],
		config,
		chainConfig: raukkDefaultChainConfig(),
		repairBillCost: 1000,
		routes,
		cxSystems,
		depots: [HEPH],
		...overrides,
	};
}

describe("Raukk Sourcing: Depots", () => {
	describe("schema", () => {
		it("round trips one depot", () => {
			const depot = { planetNaturalId: HEPH, weeklyCostAic: 2850 };

			expect(RaukkDepotSchema.parse(depot)).toStrictEqual(depot);
		});

		it("takes a depot without a rent", () => {
			expect(
				RaukkDepotSchema.parse({ planetNaturalId: HEPH })
			).toStrictEqual({ planetNaturalId: HEPH });
		});

		it("refuses a negative rent", () => {
			expect(() =>
				RaukkDepotSchema.parse({
					planetNaturalId: HEPH,
					weeklyCostAic: -1,
				})
			).toThrow();
		});

		it("round trips the side profiles of a chain", () => {
			const chain = {
				chainId: "chain-heph",
				stops: [HRT, "NC1"],
				sideProfiles: { a: "ftl-hauler", b: "stl-hopper" },
			};

			expect(RaukkChainSchema.parse(chain)).toStrictEqual(chain);
		});

		it("defaults the depots of a payload written before them", () => {
			const parsed = RaukkSourcingExportSchema.parse({
				configs: {},
				snapshots: {},
			});

			expect(parsed.depots).toStrictEqual({});
		});

		it("round trips depots through the whole payload", () => {
			const parsed = RaukkSourcingExportSchema.parse({
				configs: {},
				snapshots: {},
				depots: {
					[HEPH]: { planetNaturalId: HEPH, weeklyCostAic: 2850 },
				},
			});

			expect(parsed.depots[HEPH].weeklyCostAic).toBe(2850);
		});
	});

	describe("raukkDepotStopKey", () => {
		it("compares planet ids case insensitively", () => {
			expect(raukkDepotStopKey(" zv-307c ")).toBe(HEPH.toUpperCase());
		});
	});

	describe("raukkChainAnchors", () => {
		it("offers exchanges and depots alike, exchanges first", () => {
			expect(raukkChainAnchors(routes, cxSystems, [HEPH])).toStrictEqual([
				{ kind: "cx", stopRef: "NC1", systemId: "sys-NC-001" },
				{ kind: "depot", stopRef: HEPH, systemId: "sys-ZV-307" },
			]);
		});

		it("drops a depot that resolves to no system", () => {
			expect(
				raukkChainAnchors(routes, cxSystems, ["NOWHERE-9z"])
			).toHaveLength(1);
		});
	});

	describe("detectCxSplit", () => {
		it("finds the depot on the leg that passes it", () => {
			const trigger: IRaukkCxSplitTrigger | null =
				detectCxSplit(chainInput());

			expect(trigger?.anchorKind).toBe("depot");
			expect(trigger?.cxCode).toBe(HEPH);
			expect(trigger?.cxSystemId).toBe("sys-ZV-307");
			expect(trigger?.detourParsecs).toBeCloseTo(0, 6);
		});

		it("finds nothing without the depot marked", () => {
			expect(detectCxSplit(chainInput({ depots: [] }))).toBeNull();
		});

		it("stays inside the detour budget", () => {
			expect(
				detectCxSplit(
					chainInput({
						chainConfig: {
							...raukkDefaultChainConfig(),
							cxSplitDetourParsecs: -1,
						},
					})
				)
			).toBeNull();
		});
	});

	describe("buildCxSplitChains", () => {
		it("cuts the loop at the depot, both halves calling there", () => {
			const input: IRaukkChainInput = chainInput();
			const trigger: IRaukkCxSplitTrigger = detectCxSplit(input)!;

			const subChains: IRaukkCxSubChain[] = buildCxSplitChains(
				input,
				trigger
			);

			expect(subChains).toHaveLength(2);
			subChains.forEach((sub) => expect(sub.chain.stops).toContain(HEPH));

			// one half carries the base, the other the exchange
			expect(subChains.some((sub) => sub.chain.stops.includes(HRT))).toBe(
				true
			);
			expect(
				subChains.some((sub) => sub.chain.stops.includes("NC1"))
			).toBe(true);
		});

		it("hands every side the profile the chain named for it", () => {
			const input: IRaukkChainInput = chainInput({
				chain: {
					chainId: "chain-heph",
					stops: [HRT, "NC1"],
					profileId: "ftl-hauler",
					sideProfiles: { b: "stl-hopper" },
				},
			});

			const subChains: IRaukkCxSubChain[] = buildCxSplitChains(
				input,
				detectCxSplit(input)!
			);

			expect(subChains[0].chain.profileId).toBe("ftl-hauler");
			expect(subChains[1].chain.profileId).toBe("stl-hopper");
		});

		it("trans-ships a crossing flow through the depot", () => {
			const input: IRaukkChainInput = chainInput();

			const subChains: IRaukkCxSubChain[] = buildCxSplitChains(
				input,
				detectCxSplit(input)!
			);

			const halves: IRaukkChainFlow[] = subChains.flatMap(
				(sub) => sub.flows
			);

			expect(halves).toHaveLength(2);
			halves.forEach((half) =>
				expect([half.fromStop, half.toStop]).toContain(HEPH)
			);
		});
	});

	describe("raukkChainSideKey", () => {
		it("reads the suffix of a sub chain id", () => {
			expect(raukkChainSideKey("chain-heph#a")).toBe(
				RAUKK_CHAIN_SIDE_KEYS[0]
			);
			expect(raukkChainSideKey("chain-heph#b")).toBe(
				RAUKK_CHAIN_SIDE_KEYS[1]
			);
		});

		it("is undefined for a whole chain and for a foreign suffix", () => {
			expect(raukkChainSideKey("chain-heph")).toBeUndefined();
			expect(raukkChainSideKey("chain-heph#z")).toBeUndefined();
		});
	});

	describe("calculateChainCxSplit", () => {
		it("flies each side with its own resolved profile", () => {
			const result: IRaukkCxSplitResult = calculateChainCxSplit(
				chainInput({
					chain: {
						chainId: "chain-heph",
						stops: [HRT, "NC1"],
						sideProfiles: { b: "stl-hopper" },
					},
					sideProfiles: { b: stlProfile },
				})
			);

			expect(result.trigger?.anchorKind).toBe("depot");
			expect(result.subChains).toHaveLength(2);

			/** The gate side: HRT ⇄ Hephaestus, flown by the STL hopper */
			const gateSide: IRaukkChainShipping = result.subChains[1];

			expect(
				gateSide.legs.every((leg: IRaukkChainLegResult) => leg.routable)
			).toBe(true);
			// every inter-system leg of that side went over the gates
			expect(
				gateSide.legs.every(
					(leg: IRaukkChainLegResult) =>
						leg.sameSystem || leg.gate !== null
				)
			).toBe(true);
			expect(
				gateSide.legs.some(
					(leg: IRaukkChainLegResult) =>
						(leg.gate?.hops ?? 0) === GATES.length
				)
			).toBe(true);

			/** The exchange side keeps the chains own FTL hauler */
			const ftlSide: IRaukkChainShipping = result.subChains[0];

			expect(
				ftlSide.legs.every(
					(leg: IRaukkChainLegResult) => leg.gate === null
				)
			).toBe(true);
		});

		it("refuses an STL-only side the gates cannot serve", () => {
			const result: IRaukkCxSplitResult = calculateChainCxSplit(
				chainInput({
					// the exchange side has no gate at all
					sideProfiles: { a: stlProfile },
				})
			);

			expect(
				result.subChains[0].legs.some(
					(leg: IRaukkChainLegResult) =>
						leg.reason === "stl-only-no-gate"
				)
			).toBe(true);
		});
	});

	describe("raukkDepotDailyCosts", () => {
		const depots = [{ planetNaturalId: HEPH, weeklyCostAic: 2850 }];

		it("charges the rent once however many chains call", () => {
			const rows: IRaukkDepotDailyCost[] = raukkDepotDailyCosts(depots, [
				{ chainId: "chain-a", stops: [HRT, HEPH] },
				{ chainId: "chain-b", stops: [HEPH, "NC1"] },
				{ chainId: "chain-c", stops: ["ZV-307C"] },
			]);

			expect(rows).toHaveLength(1);
			expect(rows[0].chainIds).toStrictEqual([
				"chain-a",
				"chain-b",
				"chain-c",
			]);
			expect(rows[0].dailyCost).toBeCloseTo(
				2850 / RAUKK_DEPOT_DAYS_PER_WEEK,
				10
			);
			expect(raukkDepotDailyTotal(rows)).toBeCloseTo(
				2850 / RAUKK_DEPOT_DAYS_PER_WEEK,
				10
			);
		});

		it("charges nothing for a depot nothing visits", () => {
			const rows: IRaukkDepotDailyCost[] = raukkDepotDailyCosts(depots, [
				{ chainId: "chain-a", stops: [HRT, "NC1"] },
			]);

			expect(rows[0].chainIds).toStrictEqual([]);
			expect(rows[0].dailyCost).toBe(0);
			expect(raukkDepotDailyTotal(rows)).toBe(0);
		});

		it("charges nothing for a free depot", () => {
			const rows: IRaukkDepotDailyCost[] = raukkDepotDailyCosts(
				[{ planetNaturalId: HEPH }],
				[{ chainId: "chain-a", stops: [HEPH] }]
			);

			expect(rows[0].weeklyCostAic).toBe(0);
			expect(rows[0].dailyCost).toBe(0);
		});
	});
});
