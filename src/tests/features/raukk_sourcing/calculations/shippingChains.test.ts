import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkRouteDistance,
	IRaukkSystemNode,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_POSITION_UNITS_PER_PARSEC,
	createRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { calculatePairShipping } from "@/features/raukk_sourcing/calculations/shipping";
import {
	IRaukkChainStaticData,
	RAUKK_METEOROID_JSON,
	RAUKK_ORBITS_JSON,
	createChainStaticData,
} from "@/features/raukk_sourcing/calculations/shippingChainData";
import {
	RAUKK_CX_SYSTEM_ID_BY_CODE,
	RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS,
	RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS,
	RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE,
	RAUKK_DEFAULT_CHAIN_ROUTES,
	buildChainLegs,
	buildCxSplitChains,
	calculateChainCxSplit,
	calculateChainShipping,
	calculateReversedChainShipping,
	chainStopSystemId,
	claimChainFlows,
	detectCxSplit,
	evaluateChainDrops,
	raukkChainGateServable,
	raukkDefaultChainConfig,
	reverseChainStops,
} from "@/features/raukk_sourcing/calculations/shippingChains";

// Schemas
import { RaukkChainConfigSchema } from "@/features/raukk_sourcing/raukkSourcingStore.schemas";

// Types & Interfaces
import {
	IRaukkCadenceCaps,
	IRaukkPairShipping,
	IRaukkResolvedShipProfile,
	IRaukkShippingConfig,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainClaim,
	IRaukkChainConfig,
	IRaukkChainDropEvaluation,
	IRaukkChainFlow,
	IRaukkChainInput,
	IRaukkChainLeg,
	IRaukkChainShipping,
	IRaukkCxSplitResult,
	IRaukkCxSplitTrigger,
	IRaukkCxSubChain,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

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
	};
}

/**
 * A, B and C in a row, every pair connected: A→B and B→C are 10 pc,
 * A→C is 20 pc. AA-004 hangs 40 pc off A and is only there to give the
 * same system legs a nearest neighbor.
 */
const lineGraph: IRaukkSystemNode[] = [
	system("AA-001", [0, 0, 0], ["AA-002", "AA-003", "AA-004"]),
	system("AA-002", [10 * PC, 0, 0], ["AA-003"]),
	system("AA-003", [20 * PC, 0, 0], []),
	system("AA-004", [0, 40 * PC, 0], []),
];

const routes: IRaukkRouteDistance = createRouteDistance(lineGraph);

/** Every fixture system sits exactly at the reference density */
const flatDensities: RAUKK_METEOROID_JSON = {
	"sys-AA-001": 3.28,
	"sys-AA-002": 3.28,
	"sys-AA-003": 3.28,
	"sys-AA-004": 3.28,
};

const orbits: RAUKK_ORBITS_JSON = {
	"AA-001a": [100, 0.01],
	"AA-001b": [300, 0.02],
	"AA-002b": [200, 0.01],
	"AA-003c": [200, 0.01],
};

const data: IRaukkChainStaticData = createChainStaticData(
	orbits,
	flatDensities
);

const profile: IRaukkResolvedShipProfile = {
	id: "chain",
	name: "Chain Hauler",
	cargoWeight: 1000,
	cargoVolume: 1000,
	ftlReactor: "standard",
	costPerParsec: 10,
	stlBlockCost: 5,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	damagePerParsec: 0.001,
	damagePerStlBlock: 0.002,
	shipsAvailable: 1,
};

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "chain",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

const chainConfig: IRaukkChainConfig = raukkDefaultChainConfig();

const REPAIR_BILL: number = 1000;

function flow(
	ticker: string,
	fromStop: string,
	toStop: string,
	unitsPerDay: number,
	weightPerUnit: number = 1,
	volumePerUnit: number = 1
): IRaukkChainFlow {
	return {
		flowId: `${ticker}:${fromStop}>${toStop}`,
		ticker,
		fromStop,
		toStop,
		unitsPerDay,
		weightPerUnit,
		volumePerUnit,
	};
}

function chainInput(
	stops: string[],
	flows: IRaukkChainFlow[],
	overrides: Partial<IRaukkChainInput> = {}
): IRaukkChainInput {
	return {
		chain: { chainId: "chain-1", stops },
		profile,
		flows,
		config,
		chainConfig,
		repairBillCost: REPAIR_BILL,
		routes,
		data,
		cxSystems: {},
		...overrides,
	};
}

/**
 * Account default caps. Chain parity holds exactly while the cadence
 * does not bind: every parity fixture fills its hull in far under 14
 * days, so the cap never shortens the interval.
 */
const CAPS: IRaukkCadenceCaps = {
	production: 14,
	workforce: 30,
	repair: 90,
};

describe("Raukk Sourcing: Shipping Chains", () => {
	describe("defaults", () => {
		it("carries the documented knob defaults", () => {
			expect(raukkDefaultChainConfig()).toStrictEqual({
				cxSplitDetourParsecs: 6,
				legUtilizationSplitThreshold: 0.25,
				densityRef: 3.28,
				stlCostPerMegameter: 0,
				autoCxSplit: true,
				sameSystemPricing: "average",
				autoChainMinShare: 0.05,
				autoChainDetourInOutParsecs: 2,
				autoChainDetourLooseParsecs: 6,
			});
		});

		it("takes its automatic chain knobs from the named constants", () => {
			const config = raukkDefaultChainConfig();

			expect(config.autoChainMinShare).toBe(
				RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE
			);
			expect(config.autoChainDetourInOutParsecs).toBe(
				RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS
			);
			expect(config.autoChainDetourLooseParsecs).toBe(
				RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS
			);
		});

		it("is mirrored by the zod defaults the persisted payload parses", () => {
			const parsed = RaukkChainConfigSchema.parse({});

			expect(parsed.autoChainMinShare).toBe(
				RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE
			);
			expect(parsed.autoChainDetourInOutParsecs).toBe(
				RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS
			);
			expect(parsed.autoChainDetourLooseParsecs).toBe(
				RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS
			);
		});

		it("knows the four exchange codes and the real routes", () => {
			expect(Object.keys(RAUKK_CX_SYSTEM_ID_BY_CODE)).toStrictEqual([
				"NC1",
				"AI1",
				"CI1",
				"IC1",
			]);
			expect(RAUKK_DEFAULT_CHAIN_ROUTES.path).toBeDefined();
			expect(RAUKK_DEFAULT_CHAIN_ROUTES.nearestNeighbor).toBeDefined();
			expect(
				chainStopSystemId(
					"NC1",
					RAUKK_DEFAULT_CHAIN_ROUTES,
					RAUKK_CX_SYSTEM_ID_BY_CODE
				)
			).toBe(RAUKK_CX_SYSTEM_ID_BY_CODE.NC1);
			expect(
				chainStopSystemId("OT-580b", RAUKK_DEFAULT_CHAIN_ROUTES, {})
			).toBe(RAUKK_CX_SYSTEM_ID_BY_CODE.NC1);
		});
	});

	describe("buildChainLegs", () => {
		it("closes the loop back to the first stop", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-002b", "AA-003c"],
				routes,
				{}
			);

			expect(legs).toHaveLength(3);
			expect(legs.map((leg) => [leg.fromStop, leg.toStop])).toStrictEqual(
				[
					["AA-001a", "AA-002b"],
					["AA-002b", "AA-003c"],
					["AA-003c", "AA-001a"],
				]
			);
			expect(legs[2].route?.parsecs).toBeCloseTo(20, 10);
		});

		it("allows repeated stops, legs are positions not stop ids", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-002b", "AA-003c", "AA-002b"],
				routes,
				{}
			);

			expect(legs).toHaveLength(4);
			expect(legs[1].fromIndex).toBe(1);
			expect(legs[3].fromIndex).toBe(3);
			expect(legs[3].fromStop).toBe("AA-002b");
			expect(legs[3].toStop).toBe("AA-001a");
			expect(legs[1].index).not.toBe(legs[3].index);
		});

		it("flags same system legs and unroutable stops", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-001b"],
				routes,
				{}
			);

			expect(legs[0].sameSystem).toBe(true);
			expect(legs[0].route?.parsecs).toBe(0);

			const broken: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "ZZ-999z"],
				routes,
				{}
			);

			expect(broken[0].routable).toBe(false);
			expect(broken[0].toSystemId).toBeNull();
		});

		it("is empty below two stops", () => {
			expect(buildChainLegs(["AA-001a"], routes, {})).toStrictEqual([]);
		});
	});

	describe("STL-only legs", () => {
		/** The very same line, with a gate spanning AA-001 to AA-003 */
		const gatedRoutes: IRaukkRouteDistance = createRouteDistance(
			lineGraph,
			RAUKK_CX_SYSTEM_IDS,
			[
				{
					a: "AA-001a",
					aName: "A - a",
					b: "AA-003c",
					bName: "C - c",
					aGate: {
						id: "GTW-AAA-001",
						fee: 1000,
						cur: "NCC",
						maxM3: 3000,
						jumps24h: 250,
						up: "0/5 c",
						est: "100d",
					},
					bGate: {
						id: "GTW-CCC-002",
						fee: 1000,
						cur: "NCC",
						maxM3: 3000,
						jumps24h: 250,
						up: "0/5 c",
						est: "100d",
					},
					maxTraversalM3: 3000,
					hcbCapable: false,
				},
			]
		);

		const stlProfile: IRaukkResolvedShipProfile = {
			...profile,
			stlOnly: true,
			stlFuelPerBlock: 100,
		};

		const ship = { stlOnly: true, shipVolumeM3: 1000 };

		it("refuses an inter system leg with no gate route", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-002b"],
				routes,
				{},
				ship
			);

			expect(legs[0].routable).toBe(false);
			expect(legs[0].reason).toBe("stl-only-no-gate");
			// the route itself resolves, it is simply not flyable
			expect(legs[0].route).not.toBeNull();
		});

		it("keeps an FTL profile on the very same leg", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-002b"],
				routes,
				{}
			);

			expect(legs[0].routable).toBe(true);
			expect(legs[0].reason).toBeUndefined();
			expect(legs[0].gatePath).toBeUndefined();
		});

		it("serves a same system leg without any gate", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-001b"],
				routes,
				{},
				ship
			);

			expect(legs.every((leg) => leg.routable)).toBe(true);
			expect(legs[0].gatePath).toBeUndefined();
		});

		it("takes the gate where one exists", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-003c"],
				gatedRoutes,
				{},
				ship
			);

			expect(legs[0].routable).toBe(true);
			expect(legs[0].gatePath?.gateHops).toBe(1);
			// still unroutable the other way round, that leg has none
			expect(
				buildChainLegs(["AA-001a", "AA-002b"], gatedRoutes, {}, ship)[0]
					.routable
			).toBe(false);
		});

		it("refuses a link the hull does not fit through", () => {
			const legs: IRaukkChainLeg[] = buildChainLegs(
				["AA-001a", "AA-003c"],
				gatedRoutes,
				{},
				{ stlOnly: true, shipVolumeM3: 5000 }
			);

			expect(legs[0].reason).toBe("stl-only-no-gate");
		});

		it("answers whether a whole loop is gate servable", () => {
			expect(
				raukkChainGateServable(
					["AA-001a", "AA-003c"],
					gatedRoutes,
					{},
					1000
				)
			).toBe(true);
			expect(
				raukkChainGateServable(
					["AA-001a", "AA-002b", "AA-003c"],
					gatedRoutes,
					{},
					1000
				)
			).toBe(false);
			expect(raukkChainGateServable([], gatedRoutes, {})).toBe(false);
		});

		it("prices a gate leg by fee, gate fuel, minutes and damage", () => {
			const shipping: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-003c"],
					[flow("RAT", "AA-001a", "AA-003c", 1000)],
					{ profile: stlProfile, routes: gatedRoutes }
				)
			);

			const leg = shipping.legs[0];

			expect(leg.routable).toBe(true);
			expect(leg.gate).not.toBeNull();
			expect(leg.gate!.hops).toBe(1);
			expect(leg.gate!.fees).toBe(1000);
			// 25 units of traversal overhead at the profiles own SF
			// price, which its resolved block implies as 5/100
			expect(leg.gate!.fuelCost).toBeCloseTo(25 * (5 / 100), 10);
			// no FTL jump is charged and no per parsec cost applies
			expect(leg.effectiveJumps).toBe(0);
			expect(leg.costPerTrip).toBeCloseTo(
				leg.gate!.fees +
					leg.gate!.fuelCost +
					stlProfile.stlBlockCost +
					leg.repairCostPerTrip,
				10
			);
			// gate minutes, not the hulls own FTL speed
			expect(leg.roundTripMinutes).toBeGreaterThan(leg.gate!.minutes);
		});

		it("flags the leg it cannot fly instead of pricing an FTL trip", () => {
			const shipping: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 1000)],
					{ profile: stlProfile }
				)
			);

			expect(shipping.legs[0].routable).toBe(false);
			expect(shipping.legs[0].reason).toBe("stl-only-no-gate");
			expect(shipping.legs[0].gate).toBeNull();
		});
	});

	describe("claimChainFlows", () => {
		const stops: string[] = ["AA-001a", "AA-002b", "AA-003c"];

		it("claims a flow whose both endpoints are stops", () => {
			const claim: IRaukkChainClaim = claimChainFlows(stops, [
				flow("RAT", "AA-001a", "AA-002b", 10),
			]);

			expect(claim.claimed).toHaveLength(1);
			expect(claim.claimed[0].legIndexes).toStrictEqual([0]);
			expect(claim.unclaimed).toHaveLength(0);
		});

		it("rides forward around the loop, direction matters", () => {
			// C→B is not one leg backwards, it is C→A and A→B
			const claim: IRaukkChainClaim = claimChainFlows(stops, [
				flow("RAT", "AA-003c", "AA-002b", 10),
			]);

			expect(claim.claimed[0].fromIndex).toBe(2);
			expect(claim.claimed[0].toIndex).toBe(1);
			expect(claim.claimed[0].legIndexes).toStrictEqual([2, 0]);
		});

		it("leaves flows with an outside endpoint to the v1 pairs", () => {
			const claim: IRaukkChainClaim = claimChainFlows(stops, [
				flow("RAT", "AA-001a", "ZZ-999z", 10),
				flow("DW", "AA-001a", "AA-001a", 10),
			]);

			expect(claim.claimed).toHaveLength(0);
			expect(claim.unclaimed).toHaveLength(2);
		});

		it("boards a repeated stop at the shortest ride", () => {
			const repeated: string[] = [
				"AA-001a",
				"AA-002b",
				"AA-003c",
				"AA-002b",
			];

			const claim: IRaukkChainClaim = claimChainFlows(repeated, [
				flow("RAT", "AA-002b", "AA-001a", 10),
				flow("DW", "AA-001a", "AA-002b", 10),
			]);

			expect(claim.claimed[0].fromIndex).toBe(3);
			expect(claim.claimed[0].legIndexes).toStrictEqual([3]);
			expect(claim.claimed[1].fromIndex).toBe(0);
			expect(claim.claimed[1].legIndexes).toStrictEqual([0]);
		});
	});

	describe("loads, binding leg and cost", () => {
		it("takes the busiest leg as the weakest link", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[
						flow("RAT", "AA-001a", "AA-002b", 200),
						flow("DW", "AA-002b", "AA-003c", 600),
						flow("OVE", "AA-003c", "AA-001a", 100),
					]
				)
			);

			expect(result.bindingLegIndex).toBe(1);
			expect(result.tripsPerDay).toBeCloseTo(0.6, 10);
			expect(result.legs[0].loads).toBeCloseTo(0.2, 10);
			expect(result.legs[1].utilization).toBe(1);
			expect(result.legs[0].utilization).toBeCloseTo(1 / 3, 10);
		});

		it("carries two pickups at once on the leg between them", () => {
			// pick up at A, pick up at B, drop both at C: the B→C leg
			// holds BOTH loads at the same time, and 1200 t of it does
			// not fit the 1000 t hull — the loop flies more often rather
			// than overloading the ship
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[
						flow("ALO", "AA-001a", "AA-003c", 600),
						flow("FEO", "AA-002b", "AA-003c", 600),
					]
				)
			);

			expect(result.legs[0].loads).toBeCloseTo(0.6, 10);
			expect(result.legs[1].loads).toBeCloseTo(1.2, 10);
			expect(result.bindingLegIndex).toBe(1);
			// 1.2 hull loads a day is 1.2 trips a day, never one full one
			expect(result.tripsPerDay).toBeCloseTo(1.2, 10);
		});

		it("holds two pickups on one lap while they still fit", () => {
			// the same shape under the hull: neither base fills the ship
			// and neither does their sum, so one lap takes both
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[
						flow("RAT", "AA-001a", "AA-003c", 300),
						flow("DW", "AA-002b", "AA-003c", 300),
					]
				)
			);

			expect(result.legs[1].loads).toBeCloseTo(0.6, 10);
			expect(result.tripsPerDay).toBeCloseTo(0.6, 10);
			expect(result.legs[1].utilization).toBe(1);
		});

		it("never lets a cadence cap send an overfull ship", () => {
			// a 90 day repair rhythm cannot stretch a leg that fills in
			// under a day: the cap only ever SHORTENS the interval
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[
						flow("ALO", "AA-001a", "AA-003c", 600),
						flow("FEO", "AA-002b", "AA-003c", 600),
					],
					{ capDays: 90 }
				)
			);

			expect(result.tripsPerDay).toBeCloseTo(1.2, 10);
		});

		it("visits at the cadence cap when the binding leg fills slower", () => {
			const flows = [flow("RAT", "AA-001a", "AA-002b", 50)];

			const uncapped: IRaukkChainShipping = calculateChainShipping(
				chainInput(["AA-001a", "AA-002b"], flows)
			);
			const capped: IRaukkChainShipping = calculateChainShipping(
				chainInput(["AA-001a", "AA-002b"], flows, { capDays: 5 })
			);

			// 50 t a day fills the 1000 t hull in 20 days; the cap sends
			// the ship every 5, a partial load paying a full trip
			expect(uncapped.tripsPerDay).toBeCloseTo(0.05, 10);
			expect(capped.tripsPerDay).toBeCloseTo(0.2, 10);
			expect(capped.legs[0].utilization).toBeCloseTo(0.25, 10);
			expect(capped.bindingLegIndex).toBe(0);
		});

		it("leaves a loop that fills faster than its cap alone", () => {
			const flows = [flow("RAT", "AA-001a", "AA-002b", 500)];

			const capped: IRaukkChainShipping = calculateChainShipping(
				chainInput(["AA-001a", "AA-002b"], flows, { capDays: 14 })
			);

			// two days to fill: the cap may only shorten the interval
			expect(capped.tripsPerDay).toBeCloseTo(0.5, 10);
		});

		it("prices one sublight block per stop visit and one distance term per leg", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[flow("RAT", "AA-001a", "AA-002b", 100)]
				)
			);

			// legs of 10, 10 and 20 parsecs
			const distance: number = (10 + 10 + 20) * profile.costPerParsec;
			const blocks: number = 3 * profile.stlBlockCost;
			const damage: number =
				40 * profile.damagePerParsec + 3 * profile.damagePerStlBlock;
			const repair: number = (damage / 0.2) * REPAIR_BILL;

			expect(result.costPerTrip).toBeCloseTo(
				distance + blocks + repair,
				10
			);
			expect(result.repairCostPerTrip).toBeCloseTo(repair, 10);
			expect(result.damagePerTrip).toBeCloseTo(damage, 10);
			expect(
				result.legs.reduce((sum, leg) => sum + leg.damagePerTrip, 0)
			).toBeCloseTo(damage, 10);
			expect(result.dailyCost).toBeCloseTo(
				result.tripsPerDay * result.costPerTrip,
				10
			);
		});

		it("allocates a legs cost by its binding dimension", () => {
			// leg A→B is volume bound: 100 units of 1 m³ against 100
			// units of 0.5 m³, so the bulky ticker pays two thirds
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[
						flow("BULK", "AA-001a", "AA-002b", 100, 0.1, 1),
						flow("LIGHT", "AA-001a", "AA-002b", 100, 0.1, 0.5),
					]
				)
			);

			expect(result.legs[0].binding).toBe("volume");
			expect(result.legs[0].bindingPerDay).toBeCloseTo(150, 10);

			// the empty return leg is spread evenly, both flows ride the
			// same single leg and carry the same units
			const spread: number = result.legs[1].dailyCost / 2;
			const loaded: number = result.legs[0].dailyCost;

			expect(result.flows[0].dailyCost).toBeCloseTo(
				(loaded * 2) / 3 + spread,
				10
			);
			expect(result.flows[1].dailyCost).toBeCloseTo(
				loaded / 3 + spread,
				10
			);
		});

		it("spreads a leg without any load over all flows by flow parsecs", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[
						flow("RAT", "AA-001a", "AA-002b", 100),
						flow("DW", "AA-002b", "AA-003c", 300),
					]
				)
			);

			// leg 2 (C→A, 20 pc) carries nothing
			expect(result.legs[2].loads).toBe(0);

			const empty: number = result.legs[2].dailyCost;
			const rat: number = result.legs[0].dailyCost + empty * 0.25;
			const dw: number = result.legs[1].dailyCost + empty * 0.75;

			expect(result.flows[0].dailyCost).toBeCloseTo(rat, 10);
			expect(result.flows[1].dailyCost).toBeCloseTo(dw, 10);
			expect(
				result.flows.reduce((sum, entry) => sum + entry.dailyCost, 0)
			).toBeCloseTo(result.dailyCost, 10);
		});

		it("charges per unit and merges tickers", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[
						flow("RAT", "AA-001a", "AA-002b", 100),
						flow("RAT", "AA-002b", "AA-001a", 100),
					]
				)
			);

			expect(result.flows[0].costPerUnit).toBeCloseTo(
				result.flows[0].dailyCost / 100,
				10
			);
			expect(result.perUnit.RAT).toBeCloseTo(result.dailyCost / 200, 10);
		});

		it("ships nothing without flows, disabled or below two stops", () => {
			const empty: IRaukkChainShipping = calculateChainShipping(
				chainInput(["AA-001a", "AA-002b"], [])
			);

			expect(empty.tripsPerDay).toBe(0);
			expect(empty.dailyCost).toBe(0);
			expect(empty.bindingLegIndex).toBe(-1);

			const off: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 100)],
					{ config: { ...config, enabled: false } }
				)
			);

			expect(off.dailyCost).toBe(0);
			expect(off.unclaimed).toHaveLength(1);

			const single: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a"],
					[flow("RAT", "AA-001a", "AA-002b", 100)]
				)
			);

			expect(single.legs).toHaveLength(0);
		});

		it("hires a chain out at a flat LM rate per trip", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 500)],
					{
						chain: {
							chainId: "chain-1",
							stops: ["AA-001a", "AA-002b"],
							lmRatePerTrip: 400,
						},
					}
				)
			);

			expect(result.hired).toBe(true);
			expect(result.costPerTrip).toBe(400);
			expect(result.repairCostPerTrip).toBe(0);
			expect(result.damagePerTrip).toBe(0);
			expect(result.shippingFraction).toBe(0);
			expect(result.dailyCost).toBeCloseTo(0.5 * 400, 10);
		});
	});

	describe("v1 pair parity", () => {
		it("reproduces a two stop pair exactly", () => {
			const out: IRaukkChainFlow = flow("RAT", "AA-001a", "AA-002b", 500);
			const back: IRaukkChainFlow = flow("DW", "AA-002b", "AA-001a", 500);

			const chain: IRaukkChainShipping = calculateChainShipping(
				chainInput(["AA-001a", "AA-002b"], [out, back])
			);

			const pair: IRaukkPairShipping = calculatePairShipping(
				{
					pairKey: "pair",
					profile,
					route: routes.route("sys-AA-001", "sys-AA-002")!,
					out: [
						{
							ticker: "RAT",
							unitsPerDay: 500,
							weightPerUnit: 1,
							volumePerUnit: 1,
						},
					],
					back: [
						{
							ticker: "DW",
							unitsPerDay: 500,
							weightPerUnit: 1,
							volumePerUnit: 1,
						},
					],
				},
				config,
				REPAIR_BILL,
				CAPS
			);

			expect(chain.tripsPerDay).toBeCloseTo(pair.tripsPerDay, 10);
			expect(chain.costPerTrip).toBeCloseTo(pair.costPerTrip, 10);
			expect(chain.repairCostPerTrip).toBeCloseTo(
				pair.repairCostPerTrip,
				10
			);
			expect(chain.dailyCost).toBeCloseTo(pair.dailyCost, 10);
			expect(chain.roundTripMinutes).toBeCloseTo(
				pair.roundTripMinutes,
				10
			);
			expect(chain.shippingFraction).toBeCloseTo(
				pair.shippingFraction,
				10
			);
			expect(chain.perUnit.RAT).toBeCloseTo(pair.perUnitOut.RAT, 10);
			expect(chain.perUnit.DW).toBeCloseTo(pair.perUnitBack.DW, 10);
		});

		/*
		 * Review finding 4: `sameSystemFlatCost` is a v1 per ROUND TRIP
		 * constant, so charging it whole on every same system LEG made a
		 * two stop loop pay it twice.
		 */
		it("reproduces a same system pair on the flat cost override", () => {
			const sameSystemConfig: IRaukkShippingConfig = {
				...config,
				sameSystemFlatCost: 42,
			};

			const chain: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-001b"],
					[
						flow("RAT", "AA-001a", "AA-001b", 500),
						flow("DW", "AA-001b", "AA-001a", 500),
					],
					{ config: sameSystemConfig }
				)
			);

			const pair: IRaukkPairShipping = calculatePairShipping(
				{
					pairKey: "pair",
					profile,
					route: routes.route("sys-AA-001", "sys-AA-001")!,
					out: [
						{
							ticker: "RAT",
							unitsPerDay: 500,
							weightPerUnit: 1,
							volumePerUnit: 1,
						},
					],
					back: [
						{
							ticker: "DW",
							unitsPerDay: 500,
							weightPerUnit: 1,
							volumePerUnit: 1,
						},
					],
				},
				sameSystemConfig,
				REPAIR_BILL,
				CAPS
			);

			expect(chain.legs[0].sameSystemMode).toBe("flat");
			expect(chain.tripsPerDay).toBeCloseTo(pair.tripsPerDay, 10);
			expect(chain.costPerTrip).toBeCloseTo(pair.costPerTrip, 10);
			expect(chain.dailyCost).toBeCloseTo(pair.dailyCost, 10);
			expect(chain.perUnit.RAT).toBeCloseTo(pair.perUnitOut.RAT, 10);
			expect(chain.perUnit.DW).toBeCloseTo(pair.perUnitBack.DW, 10);
		});

		it("matches a one directional pair on trips and total cost", () => {
			// empty backhaul: the loaded direction pays the full loop
			const chain: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-002b", "AA-001a", 500)]
				)
			);

			const pair: IRaukkPairShipping = calculatePairShipping(
				{
					pairKey: "pair",
					profile,
					route: routes.route("sys-AA-001", "sys-AA-002")!,
					out: [],
					back: [
						{
							ticker: "RAT",
							unitsPerDay: 500,
							weightPerUnit: 1,
							volumePerUnit: 1,
						},
					],
				},
				config,
				REPAIR_BILL,
				CAPS
			);

			expect(chain.tripsPerDay).toBeCloseTo(pair.tripsPerDay, 10);
			expect(chain.costPerTrip).toBeCloseTo(pair.costPerTrip, 10);
			expect(chain.dailyCost).toBeCloseTo(pair.dailyCost, 10);
			expect(chain.perUnit.RAT).toBeCloseTo(pair.perUnitBack.RAT, 10);
		});
	});

	describe("round trip time and shipping fraction", () => {
		it("times every leg and one block per stop visit", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-003c"],
					[flow("RAT", "AA-001a", "AA-002b", 1000)]
				)
			);

			// full hull on leg 0, empty on the other two
			const ftl: number =
				40 * profile.minutesPerParsec + 3 * profile.chargeMinutes;
			const blocks: number =
				profile.stlBlockMinutesLoaded +
				2 * profile.stlBlockMinutesEmpty;

			expect(result.roundTripMinutes).toBeCloseTo(ftl + blocks, 10);
			expect(result.shippingFraction).toBeCloseTo(
				(result.tripsPerDay * result.roundTripMinutes) / (24 * 60),
				10
			);
		});

		it("has no shipping fraction without a ship", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 100)],
					{ profile: { ...profile, shipsAvailable: 0 } }
				)
			);

			expect(result.shippingFraction).toBe(0);
		});
	});

	describe("reversed loop", () => {
		it("keeps the anchor and reverses the rest", () => {
			expect(reverseChainStops(["A", "B", "C", "D"])).toStrictEqual([
				"A",
				"D",
				"C",
				"B",
			]);
			expect(reverseChainStops(["A", "B"])).toStrictEqual(["A", "B"]);
		});

		it("costs the same distance but rides other legs", () => {
			const flows: IRaukkChainFlow[] = [
				flow("RAT", "AA-001a", "AA-002b", 100),
			];

			const forward: IRaukkChainShipping = calculateChainShipping(
				chainInput(["AA-001a", "AA-002b", "AA-003c"], flows)
			);
			const backward: IRaukkChainShipping =
				calculateReversedChainShipping(
					chainInput(["AA-001a", "AA-002b", "AA-003c"], flows)
				);

			// same three legs, so the same cost per trip
			expect(backward.costPerTrip).toBeCloseTo(forward.costPerTrip, 10);

			// but A→B now takes the long way round, A→C→B
			expect(forward.flows[0].legIndexes).toStrictEqual([0]);
			expect(backward.flows[0].legIndexes).toStrictEqual([0, 1]);
			expect(backward.flows[0].parsecs).toBeCloseTo(30, 10);
		});
	});

	describe("same system legs", () => {
		function sameSystemInput(
			overrides: Partial<IRaukkChainConfig> = {},
			shippingOverrides: Partial<IRaukkShippingConfig> = {}
		): IRaukkChainInput {
			return chainInput(
				["AA-001a", "AA-001b"],
				[flow("RAT", "AA-001a", "AA-001b", 100)],
				{
					chainConfig: { ...chainConfig, ...overrides },
					config: { ...config, ...shippingOverrides },
				}
			);
		}

		it("prices the orbital band at its midpoint when sublight wins", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput({ stlCostPerMegameter: 0.1 })
			);

			expect(result.legs[0].sameSystemBand).toStrictEqual({
				bestMegameters: 200,
				worstMegameters: 400,
				midpointMegameters: 300,
			});
			expect(result.legs[0].sameSystemMode).toBe("stl");
			expect(result.legs[0].effectiveParsecs).toBe(0);

			// 300 Mm at 0.1 ȼ/Mm plus the block, no distance damage
			expect(result.legs[0].costPerTrip).toBeCloseTo(
				30 +
					profile.stlBlockCost +
					(profile.damagePerStlBlock / 0.2) * REPAIR_BILL,
				10
			);
		});

		it("prices the band worst point in the worst pricing mode", () => {
			const average: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput({ stlCostPerMegameter: 0.1 })
			);
			const worst: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput({
					stlCostPerMegameter: 0.1,
					sameSystemPricing: "worst",
				})
			);

			// same band either way, only the priced point moves: 400 Mm of
			// opposition instead of the 300 Mm midpoint
			expect(worst.legs[0].sameSystemBand).toStrictEqual(
				average.legs[0].sameSystemBand
			);
			expect(worst.legs[0].sameSystemMode).toBe("stl");
			expect(
				worst.legs[0].costPerTrip - average.legs[0].costPerTrip
			).toBeCloseTo(10, 10);
		});

		it("treats an absent pricing mode as the average", () => {
			const implicit: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput({
					stlCostPerMegameter: 0.1,
					sameSystemPricing: undefined,
				})
			);
			const explicit: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput({
					stlCostPerMegameter: 0.1,
					sameSystemPricing: "average",
				})
			);

			expect(implicit.legs[0].costPerTrip).toBe(
				explicit.legs[0].costPerTrip
			);
		});

		it("jumps out and back when the sublight crossing is dearer", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput({ stlCostPerMegameter: 10 })
			);

			// nearest connected system is AA-002, 10 parsecs away
			expect(result.legs[0].sameSystemMode).toBe("two-jump");
			expect(result.legs[0].effectiveParsecs).toBeCloseTo(20, 10);
			expect(result.legs[0].effectiveJumps).toBe(2);
			expect(result.legs[0].costPerTrip).toBeCloseTo(
				200 +
					profile.stlBlockCost +
					((20 * profile.damagePerParsec +
						profile.damagePerStlBlock) /
						0.2) *
						REPAIR_BILL,
				10
			);
		});

		it("keeps the manual flat cost as an override", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				sameSystemInput(
					{ stlCostPerMegameter: 10 },
					{ sameSystemFlatCost: 42 }
				)
			);

			expect(result.legs[0].sameSystemMode).toBe("flat");
			expect(result.legs[0].effectiveParsecs).toBe(0);
			// halved per leg: the v1 constant is a per ROUND TRIP figure
			expect(result.legs[0].costPerTrip).toBeCloseTo(
				21 +
					profile.stlBlockCost +
					(profile.damagePerStlBlock / 0.2) * REPAIR_BILL,
				10
			);
		});

		it("is free when neither an orbit nor a neighbor is known", () => {
			const lonely: IRaukkRouteDistance = createRouteDistance([
				system("AA-001", [0, 0, 0], []),
			]);

			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001x", "AA-001y"],
					[flow("RAT", "AA-001x", "AA-001y", 100)],
					{ routes: lonely, chainConfig: { ...chainConfig } }
				)
			);

			expect(result.legs[0].sameSystemMode).toBe("free");
			expect(result.legs[0].costPerTrip).toBeCloseTo(
				profile.stlBlockCost +
					(profile.damagePerStlBlock / 0.2) * REPAIR_BILL,
				10
			);
		});

		it("has no separation at all between two identical stops", () => {
			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 100)],
					{ chainConfig: { ...chainConfig, stlCostPerMegameter: 1 } }
				)
			);

			expect(result.legs[1].sameSystemBand?.midpointMegameters).toBe(0);
			expect(result.legs[1].sameSystemMode).toBe("stl");
		});
	});

	describe("per system damage", () => {
		it("scales the damage rate by the density flown through", () => {
			const dense: IRaukkChainStaticData = createChainStaticData(orbits, {
				...flatDensities,
				"sys-AA-001": 6.56,
				"sys-AA-002": 6.56,
			});

			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 100)],
					{ data: dense }
				)
			);

			expect(result.legs[0].pathMeanDensity).toBeCloseTo(6.56, 10);
			expect(result.legs[0].damagePerParsec).toBeCloseTo(
				2 * profile.damagePerParsec,
				10
			);
			expect(result.legs[0].repairCostPerTrip).toBeCloseTo(
				((10 * 2 * profile.damagePerParsec +
					profile.damagePerStlBlock) /
					0.2) *
					REPAIR_BILL,
				10
			);
		});

		it("falls back to the reference density per missing system", () => {
			const partial: IRaukkChainStaticData = createChainStaticData(
				orbits,
				{ "sys-AA-001": 6.56 }
			);

			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 100)],
					{ data: partial }
				)
			);

			// (6.56 + 3.28) / 2 = 4.92, one and a half times the reference
			expect(result.legs[0].pathMeanDensity).toBeCloseTo(4.92, 10);
			expect(result.legs[0].damagePerParsec).toBeCloseTo(
				1.5 * profile.damagePerParsec,
				10
			);
		});

		it("stays flat without any path lookup", () => {
			const noPath: IRaukkRouteDistance = {
				route: routes.route,
				parsecDistance: routes.parsecDistance,
				jumpCount: routes.jumpCount,
				nearestCx: routes.nearestCx,
				resolveSystemId: routes.resolveSystemId,
			};

			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-002b"],
					[flow("RAT", "AA-001a", "AA-002b", 100)],
					{
						routes: noPath,
						data: createChainStaticData(orbits, {
							"sys-AA-001": 6.56,
							"sys-AA-002": 6.56,
						}),
					}
				)
			);

			expect(result.legs[0].pathMeanDensity).toBeNull();
			expect(result.legs[0].damagePerParsec).toBe(
				profile.damagePerParsec
			);
		});

		it("weights the density of a longer hop higher", () => {
			// A→C over B: both hops 10 pc, so a plain mean; the detour
			// graph proves the weighting on unequal hops
			const dense: IRaukkChainStaticData = createChainStaticData(orbits, {
				"sys-AA-001": 3.28,
				"sys-AA-002": 3.28,
				"sys-AA-003": 9.84,
			});

			const chained: IRaukkRouteDistance = createRouteDistance([
				system("AA-001", [0, 0, 0], ["AA-002"]),
				system("AA-002", [10 * PC, 0, 0], ["AA-003"]),
				system("AA-003", [40 * PC, 0, 0], []),
			]);

			const result: IRaukkChainShipping = calculateChainShipping(
				chainInput(
					["AA-001a", "AA-003c"],
					[flow("RAT", "AA-001a", "AA-003c", 100)],
					{ routes: chained, data: dense }
				)
			);

			// hop 1 (10 pc) at mean 3.28, hop 2 (30 pc) at mean 6.56
			expect(result.legs[0].pathMeanDensity).toBeCloseTo(
				(10 * 3.28 + 30 * 6.56) / 40,
				10
			);
		});
	});

	describe("CX split", () => {
		/**
		 * PA and PB are 20 pc apart and both 13 pc from the exchange, so
		 * the detour over it is exactly 6 parsecs — the default trigger.
		 */
		const splitGraph: IRaukkSystemNode[] = [
			system("CX-001", [0, Math.sqrt(69) * PC, 0], ["PA-001", "PB-001"]),
			system("PA-001", [-10 * PC, 0, 0], ["PB-001"]),
			system("PB-001", [10 * PC, 0, 0], []),
		];

		const splitRoutes: IRaukkRouteDistance = createRouteDistance(
			splitGraph,
			["sys-CX-001"]
		);

		const cxSystems: Record<string, string> = { XC1: "sys-CX-001" };

		function splitInput(
			stops: string[],
			flows: IRaukkChainFlow[],
			detour: number = 7
		): IRaukkChainInput {
			return chainInput(stops, flows, {
				routes: splitRoutes,
				cxSystems,
				data: createChainStaticData(orbits, {}),
				chainConfig: {
					...chainConfig,
					cxSplitDetourParsecs: detour,
				},
			});
		}

		it("triggers on the detour threshold, not below it", () => {
			const flows: IRaukkChainFlow[] = [
				flow("RAT", "PA-001a", "PB-001a", 100),
			];
			const stops: string[] = ["XC1", "PA-001a", "PB-001a"];

			const trigger: IRaukkCxSplitTrigger | null = detectCxSplit(
				splitInput(stops, flows, 7)
			);

			expect(trigger?.legIndex).toBe(1);
			expect(trigger?.cxCode).toBe("XC1");
			expect(trigger?.detourParsecs).toBeCloseTo(6, 8);

			// exactly at the detour it still fires, one parsec below not
			expect(
				detectCxSplit(splitInput(stops, flows, trigger!.detourParsecs))
			).not.toBeNull();
			expect(
				detectCxSplit(
					splitInput(stops, flows, trigger!.detourParsecs - 1)
				)
			).toBeNull();
		});

		it("cuts at an exchange the loop already visits", () => {
			const input: IRaukkChainInput = splitInput(
				["XC1", "PA-001a", "PB-001a"],
				[
					flow("RAT", "PA-001a", "PB-001a", 100),
					flow("DW", "XC1", "PA-001a", 100),
				]
			);

			const subChains: IRaukkCxSubChain[] = buildCxSplitChains(
				input,
				detectCxSplit(input)!
			);

			expect(subChains).toHaveLength(2);
			expect(subChains[0].chain.stops).toStrictEqual(["XC1", "PA-001a"]);
			expect(subChains[1].chain.stops).toStrictEqual(["XC1", "PB-001a"]);

			// the crossing flow becomes two, trans-shipped at the CX
			expect(
				subChains[0].flows.map((entry) => [
					entry.fromStop,
					entry.toStop,
				])
			).toStrictEqual([
				["PA-001a", "XC1"],
				["XC1", "PA-001a"],
			]);
			expect(
				subChains[1].flows.map((entry) => [
					entry.fromStop,
					entry.toStop,
				])
			).toStrictEqual([["XC1", "PB-001a"]]);
			expect(subChains[0].flows[0].unitsPerDay).toBe(100);
		});

		it("inserts the exchange twice when the loop has none", () => {
			const input: IRaukkChainInput = splitInput(
				["PA-001a", "PB-001a"],
				[flow("RAT", "PA-001a", "PB-001a", 100)]
			);

			const subChains: IRaukkCxSubChain[] = buildCxSplitChains(
				input,
				detectCxSplit(input)!
			);

			expect(subChains.map((sub) => sub.chain.stops)).toStrictEqual([
				["XC1", "PB-001a"],
				["XC1", "PA-001a"],
			]);
			expect(subChains[1].flows[0].toStop).toBe("XC1");
			expect(subChains[0].flows[0].fromStop).toBe("XC1");
		});

		it("exposes split and unsplit costs, split loses on symmetry", () => {
			const input: IRaukkChainInput = splitInput(
				["XC1", "PA-001a", "PB-001a"],
				[
					flow("RAT", "XC1", "PA-001a", 900),
					flow("DW", "PB-001a", "XC1", 900),
				]
			);

			const result: IRaukkCxSplitResult = calculateChainCxSplit(input);

			expect(result.trigger).not.toBeNull();
			expect(result.subChains).toHaveLength(2);
			expect(result.unsplitDailyCost).toBeCloseTo(
				result.unsplit.dailyCost,
				10
			);
			expect(result.splitDailyCost).toBeCloseTo(
				result.subChains.reduce(
					(sum, entry) => sum + entry.dailyCost,
					0
				),
				10
			);

			// both halves fly the full exchange leg: the durability
			// premium the rule accepts on purpose
			expect(result.splitDailyCost).toBeGreaterThan(
				result.unsplitDailyCost
			);
			expect(result.splitCheaper).toBe(false);
		});

		it("wins when one half of the loop is nearly idle", () => {
			const input: IRaukkChainInput = splitInput(
				["XC1", "PA-001a", "PB-001a"],
				[
					flow("RAT", "XC1", "PA-001a", 900),
					flow("PWO", "PA-001a", "XC1", 900),
					flow("DW", "PB-001a", "XC1", 5),
				]
			);

			const result: IRaukkCxSplitResult = calculateChainCxSplit(input);

			// unsplit, PA's return cargo has to ride through PB
			expect(result.unsplit.legs[1].loads).toBeCloseTo(0.9, 10);
			expect(result.splitCheaper).toBe(true);
			expect(result.splitDailyCost).toBeLessThan(result.unsplitDailyCost);
		});

		it("reports the unsplit cost twice when nothing triggers", () => {
			const result: IRaukkCxSplitResult = calculateChainCxSplit(
				splitInput(
					["XC1", "PA-001a", "PB-001a"],
					[flow("RAT", "XC1", "PA-001a", 100)],
					1
				)
			);

			expect(result.trigger).toBeNull();
			expect(result.subChains).toHaveLength(0);
			expect(result.splitDailyCost).toBe(result.unsplitDailyCost);
			expect(result.splitCheaper).toBe(false);
		});
	});

	describe("low utilization drop rule", () => {
		function dropGraph(
			p1: [number, number, number],
			p2: [number, number, number]
		): IRaukkRouteDistance {
			return createRouteDistance(
				[
					system("CX-001", [0, 0, 0], ["PP-001", "PP-002"]),
					system("PP-001", p1, ["PP-002"]),
					system("PP-002", p2, []),
				],
				["sys-CX-001"]
			);
		}

		function dropInput(
			dropRoutes: IRaukkRouteDistance,
			flows: IRaukkChainFlow[]
		): IRaukkChainInput {
			return chainInput(["XC1", "PP-001a", "PP-002a"], flows, {
				routes: dropRoutes,
				cxSystems: { XC1: "sys-CX-001" },
				data: createChainStaticData(orbits, {}),
			});
		}

		it("drops the tiny MFK stop when the exchange is near it", () => {
			// MFK sits 5 pc off the exchange but 30 pc off the producer:
			// riding along on every trip is a real detour, its own run
			// is one cheap hop
			const input: IRaukkChainInput = dropInput(
				dropGraph([30 * PC, 0, 0], [0, 5 * PC, 0]),
				[
					flow("FEO", "XC1", "PP-001a", 1000),
					flow("MFK", "PP-002a", "XC1", 5),
				]
			);

			const evaluations: IRaukkChainDropEvaluation[] =
				evaluateChainDrops(input);

			const mfk: IRaukkChainDropEvaluation = evaluations.find(
				(entry) => entry.stopRef === "PP-002a"
			)!;

			expect(mfk.utilization).toBeLessThan(0.25);
			expect(mfk.recommendDrop).toBe(true);
			expect(mfk.savingPerDay).toBeGreaterThan(0);
			expect(
				mfk.dailyCostWithoutStop + mfk.dailyCostStandalone
			).toBeCloseTo(mfk.dailyCostAsIs - mfk.savingPerDay, 10);

			/*
			 * The standalone pair runs at its own CADENCE: five units a
			 * day would fill the hull in 200 days, and the in/out cap of
			 * 14 days is what it really flies — a partial trip every two
			 * weeks, paying a full trip.
			 */
			expect(mfk.standalonePairs).toHaveLength(1);
			expect(mfk.standalonePairs[0].tripsPerDay).toBeCloseTo(1 / 14, 10);

			// nothing is mutated, the caller decides
			expect(input.chain.stops).toStrictEqual([
				"XC1",
				"PP-001a",
				"PP-002a",
			]);
		});

		it("keeps the stop when the exchange is far from both producers", () => {
			// 1 pc off the producer, 101 pc off the exchange: the stop is
			// almost free in the chain and ruinous on its own
			const input: IRaukkChainInput = dropInput(
				dropGraph([100 * PC, 0, 0], [101 * PC, 0, 0]),
				[
					flow("FEO", "XC1", "PP-001a", 1000),
					flow("MFK", "PP-002a", "XC1", 200),
				]
			);

			const mfk: IRaukkChainDropEvaluation = evaluateChainDrops(
				input
			).find((entry) => entry.stopRef === "PP-002a")!;

			expect(mfk.utilization).toBeLessThan(0.25);
			expect(mfk.recommendDrop).toBe(false);
			expect(mfk.savingPerDay).toBeLessThan(0);
			expect(mfk.dailyCostStandalone).toBeGreaterThan(
				mfk.dailyCostAsIs - mfk.dailyCostWithoutStop
			);
		});

		it("evaluates nothing while every leg is busy", () => {
			const input: IRaukkChainInput = dropInput(
				dropGraph([30 * PC, 0, 0], [0, 5 * PC, 0]),
				[
					flow("FEO", "XC1", "PP-001a", 1000),
					flow("PWO", "PP-001a", "PP-002a", 900),
					flow("MFK", "PP-002a", "XC1", 900),
				]
			);

			expect(evaluateChainDrops(input)).toStrictEqual([]);
		});

		it("skips repeated stops and chains that ship nothing", () => {
			const repeated: IRaukkChainInput = chainInput(
				["XC1", "PP-001a", "PP-002a", "PP-001a"],
				[
					flow("FEO", "XC1", "PP-001a", 1000),
					flow("MFK", "PP-002a", "XC1", 5),
				],
				{
					routes: dropGraph([30 * PC, 0, 0], [0, 5 * PC, 0]),
					cxSystems: { XC1: "sys-CX-001" },
					data: createChainStaticData(orbits, {}),
				}
			);

			expect(
				evaluateChainDrops(repeated).map((entry) => entry.stopRef)
			).not.toContain("PP-001a");

			expect(
				evaluateChainDrops(
					dropInput(dropGraph([30 * PC, 0, 0], [0, 5 * PC, 0]), [])
				)
			).toStrictEqual([]);
		});
	});
});
