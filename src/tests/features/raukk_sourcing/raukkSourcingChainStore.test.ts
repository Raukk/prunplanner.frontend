import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

function makeSnapshot(
	name: string,
	planetNaturalId: string,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId,
		outputs: {
			ORE: {
				ticker: "ORE",
				unitsPerDay: 100,
				costPerUnit: 42,
				breakdown: {
					workforce: 2,
					repair: 5,
					inputs: 35,
					shipping: 0,
				},
			},
		},
		draws,
	};
}

function makeChainResult(
	chainId: string,
	memberPlanUuids: string[]
): IRaukkChainResult {
	const costing = {
		stops: ["ZV-194a", "ZV-759b"],
		tripsPerDay: 1,
		roundTripMinutes: 100,
		bindingLegIndex: 0,
		dailyCost: 500,
		shippingFraction: 0.1,
	};

	return {
		chainId,
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		profileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
		hired: false,
		splitApplied: false,
		unsplit: costing,
		split: [],
		splitTrigger: null,
		tripsPerDay: 1,
		roundTripMinutes: 100,
		bindingLegIndex: 0,
		dailyCost: 500,
		shippingFraction: 0.1,
		shipMinutesPerDay: 100,
		flows: [
			{
				ticker: "ORE",
				fromStop: "ZV-194a",
				toStop: "ZV-759b",
				unitsPerDay: 100,
				costPerUnit: 5,
			},
		],
		perUnit: { ORE: 5 },
		memberPlanUuids,
		config: raukkDefaultChainConfig(),
	};
}

describe("Raukk Sourcing Store: chains and fleet", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	/** Two plans, one on each stop of the canonical two stop chain */
	function withMembers(): void {
		store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));
		store.setSnapshot(
			"consumer",
			makeSnapshot("Consumer", "ZV-759b", { source: { ORE: 100 } })
		);
	}

	describe("chain crud", () => {
		it("stores and returns a detached chain", () => {
			store.setChain({ chainId: "c1", stops: ["A", "B"], name: "Loop" });

			const chain = store.getChain("c1")!;
			chain.stops.push("C");

			expect(store.chains.c1.stops).toStrictEqual(["A", "B"]);
			expect(store.getChain("nope")).toBeUndefined();
		});

		it("refuses a loop of fewer than two stops", () => {
			expect(() =>
				store.setChain({ chainId: "c1", stops: ["A"] })
			).toThrowError(/at least two stops/);
			expect(store.chains.c1).toBeUndefined();
		});

		it("refuses a chain reaching two stops another chain reaches", () => {
			store.setChain({ chainId: "c1", stops: ["A", "B", "C"] });

			expect(() =>
				store.setChain({ chainId: "c2", stops: ["B", "C", "D"] })
			).toThrowError(/already reaches both/);
			expect(store.chains.c2).toBeUndefined();

			// claiming is by stop SET, so the reverse loop is refused too
			expect(() =>
				store.setChain({ chainId: "c2", stops: ["C", "B", "D"] })
			).toThrowError(/already reaches both/);

			// one shared stop stays legal: that is how chains meet at a CX
			expect(() =>
				store.setChain({ chainId: "c2", stops: ["C", "D", "E"] })
			).not.toThrow();
		});

		it("lets a chain be saved unchanged", () => {
			store.setChain({ chainId: "c1", stops: ["A", "B", "C"] });

			expect(() =>
				store.setChain({ chainId: "c1", stops: ["A", "B", "C"] })
			).not.toThrow();
			expect(store.chainConflictOf("c1", ["A", "B", "C"])).toBeNull();
			expect(store.chainConflictOf("c2", ["A", "B"])).toStrictEqual({
				chainId: "c1",
				fromStop: "A",
				toStop: "B",
			});
		});

		it("derives the member plans from the stored snapshots", () => {
			withMembers();
			store.setSnapshot("elsewhere", makeSnapshot("Else", "OT-580b"));

			expect(
				store.chainMemberPlans(["ZV-194a", "ZV-759b"]).sort()
			).toStrictEqual(["consumer", "source"]);
		});

		it("deletes the chain with its result and its assignment", () => {
			withMembers();
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setAssignment(
				raukkChainAssignmentKey("c1"),
				"5000x5000-standard"
			);

			store.deleteChain("c1");

			expect(store.chains.c1).toBeUndefined();
			expect(store.chainResults.c1).toBeUndefined();
			expect(store.assignments).toStrictEqual({});
		});
	});

	describe("staleness", () => {
		beforeEach(() => {
			withMembers();
		});

		it("stales the chain result and its member plans on an edit", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));
			store.setSnapshot(
				"consumer",
				makeSnapshot("Consumer", "ZV-759b", { source: { ORE: 100 } })
			);
			store.setSnapshot("elsewhere", makeSnapshot("Else", "OT-580b"));

			store.setChain({
				chainId: "c1",
				stops: ["ZV-194a", "ZV-759b"],
				name: "renamed",
			});

			expect(store.chainResults.c1.stale).toBe(true);
			expect(store.snapshots.source.stale).toBe(true);
			expect(store.snapshots.consumer.stale).toBe(true);
			// a plan no chain touches is NOT flagged: this is not an
			// account wide event
			expect(store.snapshots.elsewhere.stale).toBe(false);
		});

		it("stales the plans a deleted chain served", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));

			store.deleteChain("c1");

			expect(store.snapshots.source.stale).toBe(true);
		});

		it("stales every chain on a chain configuration change", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));

			store.setChainConfig({ cxSplitDetourParsecs: 12 });

			expect(store.chainConfig.cxSplitDetourParsecs).toBe(12);
			expect(store.chainResults.c1.stale).toBe(true);
			expect(store.snapshots.source.stale).toBe(true);
		});

		/*
		 * Review finding 5: a chain is costed from the shipping
		 * configuration and the profile of its ship type, so the account
		 * global mutations that stale every snapshot have to stale every
		 * chain result with them.
		 */
		it("stales every chain on a shipping or profile change", () => {
			function freshChain(): void {
				store.setChain({
					chainId: "c1",
					stops: ["ZV-194a", "ZV-759b"],
				});
				store.setChainResult("c1", makeChainResult("c1", ["source"]));
				store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));
			}

			store.setShippingConfig({ enabled: true });

			freshChain();
			store.setShippingConfig({ sameSystemFlatCost: 42 });
			expect(store.chainResults.c1.stale).toBe(true);
			expect(store.snapshots.source.stale).toBe(true);

			freshChain();
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
			});
			expect(store.chainResults.c1.stale).toBe(true);

			freshChain();
			store.resetShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID);
			expect(store.chainResults.c1.stale).toBe(true);
		});

		it("leaves the chains fresh while shipping stays off", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));

			// off before and off after: nothing can have moved
			store.setShippingConfig({ sameSystemFlatCost: 42 });
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
			});

			expect(store.chainResults.c1.stale).toBe(false);
		});

		it("leaves everything alone on a fleet count change", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));

			store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				count: 4,
				designName: "FSE_MCB_STD",
			});
			store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, { count: 5 });

			expect(store.fleet[RAUKK_DEFAULT_SHIP_PROFILE_ID]).toStrictEqual({
				count: 5,
				designName: "FSE_MCB_STD",
			});
			// utilization is derived at read time, no number moved
			expect(store.snapshots.source.stale).toBe(false);
			expect(store.chainResults.c1.stale).toBe(false);
		});

		it("stales the owning plan when a lane changes its ship type", () => {
			store.setAssignment("source>CX", "5000x5000-standard");

			expect(store.snapshots.source.stale).toBe(true);
			expect(store.snapshots.consumer.stale).toBe(true);
			expect(store.assignedShipTypeId("source>CX")).toBe(
				"5000x5000-standard"
			);
		});

		it("stales the chain when it changes its ship type", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));

			store.setAssignment(raukkChainAssignmentKey("c1"), "HCB");

			expect(store.chainResults.c1.stale).toBe(true);
			expect(store.snapshots.source.stale).toBe(true);
		});

		it("puts a lane back to auto", () => {
			store.setAssignment("source>CX", "5000x5000-standard");
			store.setAssignment("source>CX", undefined);

			expect(store.assignments).toStrictEqual({});
			expect(store.assignedShipTypeId("source>CX")).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});

		it("keeps a stored result current until something changes it", () => {
			store.setChainResult("c1", {
				...makeChainResult("c1", ["source"]),
				stale: true,
			});

			expect(store.chainResults.c1.stale).toBe(false);
			expect(store.getChainResult("c1")?.perUnit.ORE).toBe(5);
			expect(store.getChainResult("nope")).toBeUndefined();
		});
	});

	describe("deletePlanData", () => {
		it("scrubs the lane assignments and stales the chains", () => {
			withMembers();
			store.setChainResult(
				"c1",
				makeChainResult("c1", ["source", "consumer"])
			);
			store.setChainResult("c2", makeChainResult("c2", ["consumer"]));
			store.setAssignment("source>CX", "a");
			store.setAssignment("consumer>source", "b");
			store.setAssignment("consumer>CX", "c");
			store.setAssignment(raukkChainAssignmentKey("c1"), "d");

			store.deletePlanData("source");

			// both lane key shapes go, the chain assignment stays
			expect(store.assignments).toStrictEqual({
				"consumer>CX": "c",
				"chain:c1": "d",
			});
			expect(store.chainResults.c1.stale).toBe(true);
			expect(store.chainResults.c2.stale).toBe(false);
			// the chain itself survives, its stops are planets
			expect(store.chainResults.c1.chainId).toBe("c1");
		});

		it("leaves the fleet alone", () => {
			store.setFleetShip("WCB", { count: 2 });
			store.deletePlanData("source");

			expect(store.fleet.WCB).toStrictEqual({ count: 2 });
		});
	});

	describe("fleet", () => {
		it("removes a ship type but keeps its assignments", () => {
			store.setFleetShip("WCB", { count: 2 });
			store.setAssignment("source>CX", "WCB");

			store.deleteFleetShip("WCB");

			expect(store.fleet.WCB).toBeUndefined();
			// an assigned type without a hull is the over-ration the
			// utilization display exists to show
			expect(store.assignments["source>CX"]).toBe("WCB");
		});
	});

	describe("export and import", () => {
		it("round trips the chain and fleet slices", () => {
			store.setChain({
				chainId: "c1",
				stops: ["ZV-194a", "ZV-759b", "AI1"],
				name: "Antares loop",
				lmRatePerTrip: 1500,
				autoCxSplit: false,
			});
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setFleetShip("WCB", { count: 3, designName: "FSE_WCB_QCR" });
			store.setAssignment(raukkChainAssignmentKey("c1"), "WCB");
			store.setChainConfig({ densityRef: 2.5 });

			const exported: string = store.exportJSON();
			const before = JSON.parse(
				JSON.stringify({
					chains: store.chains,
					chainResults: store.chainResults,
					fleet: store.fleet,
					assignments: store.assignments,
					chainConfig: store.chainConfig,
				})
			);

			store.$reset();
			expect(store.chains).toStrictEqual({});
			expect(store.chainConfig).toStrictEqual(raukkDefaultChainConfig());

			store.importJSON(exported);

			expect(
				JSON.parse(
					JSON.stringify({
						chains: store.chains,
						chainResults: store.chainResults,
						fleet: store.fleet,
						assignments: store.assignments,
						chainConfig: store.chainConfig,
					})
				)
			).toStrictEqual(before);
		});

		it("imports a v2.0 payload that predates chains and the fleet", () => {
			store.setChain({ chainId: "c1", stops: ["A", "B"] });
			store.setFleetShip("WCB", { count: 3 });

			// exactly what the shipped v2.0 exportJSON produced
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 30, sources: {} } },
					snapshots: { a: makeSnapshot("A", "ZV-759b") },
					shipProfiles: {},
					shippingConfig: {
						enabled: true,
						defaultProfileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
						routingMode: "direct",
						sameSystemFlatCost: 0,
					},
				})
			);

			expect(store.shippingConfig.enabled).toBe(true);
			expect(store.chains).toStrictEqual({});
			expect(store.chainResults).toStrictEqual({});
			expect(store.fleet).toStrictEqual({});
			expect(store.assignments).toStrictEqual({});
			expect(store.chainConfig).toStrictEqual(raukkDefaultChainConfig());
		});

		it("imports a snapshot without the v2 flow and lane arrays", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {},
					snapshots: { a: makeSnapshot("A", "ZV-759b") },
				})
			);

			expect(store.snapshots.a.flows).toBeUndefined();
			expect(store.snapshots.a.lanes).toBeUndefined();
		});

		it("round trips a snapshots frozen flows and lanes", () => {
			store.setSnapshot("a", {
				...makeSnapshot("A", "ZV-759b"),
				flows: [
					{
						flowId: "ORE@ZV-194a>ZV-759b",
						ticker: "ORE",
						fromStop: "ZV-194a",
						toStop: "ZV-759b",
						unitsPerDay: 100,
						weightPerUnit: 1,
						volumePerUnit: 0.5,
					},
				],
				lanes: [
					{
						pairKey: "a>CX",
						shipTypeId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
						tripsPerDay: 0.3,
						roundTripMinutes: 400,
						hired: false,
					},
				],
			});

			const exported: string = store.exportJSON();
			const before = JSON.parse(JSON.stringify(store.snapshots));

			store.$reset();
			store.importJSON(exported);

			expect(JSON.parse(JSON.stringify(store.snapshots))).toStrictEqual(
				before
			);
		});

		it("rejects a broken chain configuration", () => {
			expect(() =>
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: {},
						snapshots: {},
						chainConfig: { sameSystemPricing: "teleport" },
					})
				)
			).toThrowError();
		});

		it("rejects a negative ship count", () => {
			expect(() =>
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: {},
						snapshots: {},
						fleet: { WCB: { count: -1 } },
					})
				)
			).toThrowError();
		});
	});

	describe("$reset", () => {
		it("clears the chain and fleet slices", () => {
			store.setChain({ chainId: "c1", stops: ["A", "B"] });
			store.setChainResult("c1", makeChainResult("c1", []));
			store.setFleetShip("WCB", { count: 2 });
			store.setAssignment("a>CX", "WCB");
			store.setChainConfig({ autoCxSplit: false });

			store.$reset();

			expect(store.chains).toStrictEqual({});
			expect(store.chainResults).toStrictEqual({});
			expect(store.fleet).toStrictEqual({});
			expect(store.assignments).toStrictEqual({});
			expect(store.chainConfig).toStrictEqual(raukkDefaultChainConfig());
		});
	});
});
