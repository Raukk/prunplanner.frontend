import { describe, expect, it } from "vitest";

// Calculations
import {
	createRouteDistance,
	RAUKK_CX_SYSTEM_IDS,
	RAUKK_GATE_TRAVERSAL,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	raukkGateLegCost,
	raukkGateOnlyPath,
	raukkStlFuelUnitCost,
	raukkStlOnlyCandidates,
} from "@/features/raukk_sourcing/calculations/shippingStl";

// Types & Interfaces
import {
	IRaukkGateLink,
	IRaukkMultiModalPath,
	IRaukkRouteDistance,
	IRaukkSystemNode,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkHullCandidate,
	IRaukkResolvedShipProfile,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkGateLegCost } from "@/features/raukk_sourcing/calculations/shippingStl";

/**
 * Three systems in a row, plus one gate spanning the whole row.
 *
 * SS-001 → SS-003 is gate servable; SS-001 → SS-002 is one plain FTL
 * jump and no gate reaches it, which is the leg an STL-only ship has to
 * be refused on.
 */
function system(
	naturalId: string,
	position: number[],
	connections: string[]
): IRaukkSystemNode {
	return {
		SystemId: `sys-${naturalId}`,
		NaturalId: naturalId,
		Name: naturalId,
		PositionX: position[0],
		PositionY: position[1],
		PositionZ: position[2],
		Connections: connections.map((target) => `sys-${target}`),
	} as unknown as IRaukkSystemNode;
}

const SYSTEMS: IRaukkSystemNode[] = [
	system("SS-001", [0, 0, 0], ["SS-002"]),
	system("SS-002", [120, 0, 0], ["SS-003"]),
	system("SS-003", [240, 0, 0], []),
];

const GATES: IRaukkGateLink[] = [
	{
		a: "SS-001b",
		aName: "One - b",
		b: "SS-003a",
		bName: "Three - a",
		aGate: {
			id: "GTW-SSS-001",
			fee: 2000,
			cur: "NCC",
			maxM3: 3000,
			jumps24h: 250,
			up: "0/5 c",
			est: "100d",
		},
		bGate: {
			id: "GTW-SSS-002",
			fee: 3000,
			cur: "AIC",
			maxM3: 3000,
			jumps24h: 250,
			up: "0/5 c",
			est: "100d",
		},
		maxTraversalM3: 3000,
		hcbCapable: false,
	},
];

const ROUTES: IRaukkRouteDistance = createRouteDistance(
	SYSTEMS,
	RAUKK_CX_SYSTEM_IDS,
	GATES
);

/** A resolved profile whose STL block is 100 units at 2 ȼ each */
const PROFILE: IRaukkResolvedShipProfile = {
	id: "1000x1000-standard",
	name: "Test Hauler",
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
	damagePerParsec: 0.0002,
	damagePerStlBlock: 0,
	shipsAvailable: 1,
};

/** One hull candidate of the given id and STL-only flag */
function candidate(id: string, stlOnly: boolean): IRaukkHullCandidate {
	return { shipTypeId: id, profile: { ...PROFILE, id, stlOnly } };
}

describe("raukk shipping STL-only", () => {
	describe("raukkStlFuelUnitCost", () => {
		it("recovers the SF price the resolved block carries", () => {
			expect(raukkStlFuelUnitCost(PROFILE)).toBe(2);
		});

		it("is zero without a burn to price", () => {
			expect(
				raukkStlFuelUnitCost({ ...PROFILE, stlFuelPerBlock: 0 })
			).toBe(0);
		});
	});

	describe("raukkGateOnlyPath", () => {
		it("finds a gate served pair", () => {
			const found: IRaukkMultiModalPath | null = raukkGateOnlyPath(
				ROUTES,
				"sys-SS-001",
				"sys-SS-003"
			);

			expect(found?.gateHops).toBe(1);
			expect(found?.hops[0].kind).toBe("gate");
		});

		it("is null on a pair only FTL connects", () => {
			expect(
				raukkGateOnlyPath(ROUTES, "sys-SS-001", "sys-SS-002")
			).toBeNull();
		});

		it("is null for a hull the link does not admit", () => {
			expect(
				raukkGateOnlyPath(ROUTES, "sys-SS-001", "sys-SS-003", 5000)
			).toBeNull();
		});

		it("is null when the lookups know no gate metric", () => {
			const legacy: IRaukkRouteDistance = {
				route: ROUTES.route,
				parsecDistance: ROUTES.parsecDistance,
				jumpCount: ROUTES.jumpCount,
				nearestCx: ROUTES.nearestCx,
				resolveSystemId: ROUTES.resolveSystemId,
			};

			expect(
				raukkGateOnlyPath(legacy, "sys-SS-001", "sys-SS-003")
			).toBeNull();
		});
	});

	describe("raukkGateLegCost", () => {
		it("charges fee, fuel, minutes and damage per traversal", () => {
			const path: IRaukkMultiModalPath = raukkGateOnlyPath(
				ROUTES,
				"sys-SS-001",
				"sys-SS-003"
			)!;
			const cost: IRaukkGateLegCost = raukkGateLegCost(path, PROFILE);

			expect(cost.hops).toBe(1);
			// the ORIGIN side gate charges, see the asset
			expect(cost.fees).toBe(2000);
			expect(cost.fuelUnits).toBe(RAUKK_GATE_TRAVERSAL.stlFuel);
			expect(cost.fuelCost).toBe(RAUKK_GATE_TRAVERSAL.stlFuel * 2);
			expect(cost.minutes).toBe(path.hops[0].minutes);
			// 0.006 PERCENT per traversal, as a fraction
			expect(cost.damage).toBeCloseTo(
				RAUKK_GATE_TRAVERSAL.damagePercent / 100,
				10
			);
		});

		it("charges the other gate flying the other way", () => {
			const back: IRaukkMultiModalPath = raukkGateOnlyPath(
				ROUTES,
				"sys-SS-003",
				"sys-SS-001"
			)!;

			expect(raukkGateLegCost(back, PROFILE).fees).toBe(3000);
		});
	});

	describe("raukkStlOnlyCandidates", () => {
		const FTL: IRaukkHullCandidate = candidate("ftl", false);
		const STL: IRaukkHullCandidate = candidate("stl", true);

		it("drops STL-only hulls from an unservable lane", () => {
			expect(
				raukkStlOnlyCandidates([FTL, STL], false, true)
			).toStrictEqual([FTL]);
		});

		it("drops them from a servable lane that calls at no depot", () => {
			expect(
				raukkStlOnlyCandidates([FTL, STL], true, false)
			).toStrictEqual([FTL]);
		});

		it("keeps every hull on a servable, depot served lane", () => {
			expect(
				raukkStlOnlyCandidates([FTL, STL], true, true)
			).toStrictEqual([FTL, STL]);
		});
	});
});
