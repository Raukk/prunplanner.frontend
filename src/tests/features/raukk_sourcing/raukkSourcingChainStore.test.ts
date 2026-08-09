import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkAutoChainId } from "@/features/raukk_sourcing/calculations/shippingAutoChains";
import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	raukkPlannedGateLinks,
	setRaukkPlannedGateLinks,
} from "@/features/raukk_sourcing/calculations/routeDistance";

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
		advisories: [],
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
			store.setShippingConfig({ enabled: false });
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", ["source"]));

			// off before and off after: nothing can have moved
			store.setShippingConfig({ sameSystemFlatCost: 42 });
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
			});

			expect(store.chainResults.c1.stale).toBe(false);
		});

		/*
		 * The automatic hull pick assigns OWNED types only, so the owned
		 * set — types with a count above zero — is a costing input: a
		 * type entering or leaving it stales every stored result. The
		 * count on the same side of zero stays what it always was, the
		 * read time denominator of the utilization rollup.
		 */
		describe("fleet ownership staleness", () => {
			/** Fresh chain result and source snapshot to stale */
			function freshResults(): void {
				store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));
				store.setChainResult("c1", makeChainResult("c1", ["source"]));
			}

			it("stales everything when a type is added with hulls", () => {
				freshResults();

				store.setFleetShip("WCB", { count: 1 });

				expect(store.snapshots.source.stale).toBe(true);
				expect(store.chainResults.c1.stale).toBe(true);
			});

			it("stales everything when a count crosses zero", () => {
				store.setFleetShip("WCB", { count: 0 });
				freshResults();

				store.setFleetShip("WCB", { count: 1 });

				expect(store.snapshots.source.stale).toBe(true);
				expect(store.chainResults.c1.stale).toBe(true);

				freshResults();

				store.setFleetShip("WCB", { count: 0 });

				expect(store.snapshots.source.stale).toBe(true);
				expect(store.chainResults.c1.stale).toBe(true);
			});

			it("leaves everything alone while the owned set holds", () => {
				store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
					count: 2,
					designName: "FSE_MCB_STD",
				});
				freshResults();

				// still owned: only the utilization denominator moved
				store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
					count: 3,
				});
				// a label is no costing input at all
				store.setFleetShip(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
					designName: "FSE_MCB_QCR",
				});
				// a hull-less row never was a candidate
				store.setFleetShip("VCB", { count: 0 });

				expect(
					store.fleet[RAUKK_DEFAULT_SHIP_PROFILE_ID]
				).toStrictEqual({
					count: 3,
					designName: "FSE_MCB_QCR",
				});
				expect(store.snapshots.source.stale).toBe(false);
				expect(store.chainResults.c1.stale).toBe(false);
			});

			it("stales everything when an owned type is deleted", () => {
				store.setFleetShip("WCB", { count: 2 });
				freshResults();

				store.deleteFleetShip("WCB");

				expect(store.snapshots.source.stale).toBe(true);
				expect(store.chainResults.c1.stale).toBe(true);
			});

			it("leaves everything alone deleting a hull-less type", () => {
				store.setFleetShip("WCB", { count: 0 });
				freshResults();

				store.deleteFleetShip("WCB");

				expect(store.snapshots.source.stale).toBe(false);
				expect(store.chainResults.c1.stale).toBe(false);
			});

			it("leaves everything fresh while shipping stays off", () => {
				store.setShippingConfig({ enabled: false });
				freshResults();

				// off before and off after: nothing can have moved
				store.setFleetShip("WCB", { count: 1 });
				store.deleteFleetShip("WCB");

				expect(store.snapshots.source.stale).toBe(false);
				expect(store.chainResults.c1.stale).toBe(false);
			});
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

		it("stales the chain results when a members flows change", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setSnapshot("source", {
				...makeSnapshot("Source", "ZV-194a"),
				flows: [],
			});
			store.setChainResult("c1", makeChainResult("c1", ["source"]));

			// what the automatic snapshot upkeep does: one plan, no chain
			// pass afterwards
			store.setSnapshot("source", {
				...makeSnapshot("Source", "ZV-194a"),
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
			});

			expect(store.chainResults.c1.stale).toBe(true);
			// the plan itself stays current, otherwise the upkeep would
			// answer the flag with another recompute, forever
			expect(store.snapshots.source.stale).toBe(false);
		});

		it("leaves the chain results alone when the flows do not move", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));
			store.setChainResult("c1", makeChainResult("c1", ["source"]));

			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));

			expect(store.chainResults.c1.stale).toBe(false);
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
			// removing a hull is not un-assigning the work: the lane keeps
			// naming the type, it just no longer has a fleet row
			expect(store.assignments["source>CX"]).toBe("WCB");
		});

		it("toggles the spillover display without staling anything", () => {
			store.setSnapshot("source", makeSnapshot("A", "ZV-759b"));

			// defaulted on for a fresh store
			expect(store.fleetSpillover).toBe(true);

			store.setFleetSpillover(false);

			expect(store.fleetSpillover).toBe(false);
			// a display mode, not an input: nothing recomputes
			expect(store.snapshots.source.stale).toBe(false);
		});
	});

	describe("automatic chain results", () => {
		it("replaces every derived result and keeps the authored ones", () => {
			store.setChainResult("c1", makeChainResult("c1", ["source"]));
			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
				makeChainResult("auto:workforce:AI1:1", ["source"]),
			]);

			expect(Object.keys(store.chainResults).sort()).toStrictEqual([
				"auto:production:AI1:1",
				"auto:workforce:AI1:1",
				"c1",
			]);
			expect(store.chainResults["auto:production:AI1:1"].auto).toBe(true);
			expect(store.chainResults.c1.auto).toBeUndefined();

			// the next pass derives only one loop: the other one is gone
			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
			]);

			expect(Object.keys(store.chainResults).sort()).toStrictEqual([
				"auto:production:AI1:1",
				"c1",
			]);
		});

		it("stores nothing when nothing was derived", () => {
			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
			]);
			store.setAutoChainResults([]);

			expect(store.chainResults).toStrictEqual({});
		});

		/*
		 * A pin left behind by a loop that no longer exists would sit in
		 * the store forever and re-apply to whatever loop takes that id
		 * on a later pass.
		 */
		it("drops the hull pins of derived chains that vanished", () => {
			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
				makeChainResult("auto:production:AI1:2", ["source"]),
			]);
			store.setAssignment(
				raukkChainAssignmentKey("auto:production:AI1:1"),
				"WCB"
			);
			store.setAssignment(
				raukkChainAssignmentKey("auto:production:AI1:2"),
				"WCB"
			);
			store.setAssignment(raukkChainAssignmentKey("c1"), "WCB");
			store.setAssignment("source>CX", "WCB");

			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
			]);

			expect(Object.keys(store.assignments).sort()).toStrictEqual([
				raukkChainAssignmentKey("auto:production:AI1:1"),
				raukkChainAssignmentKey("c1"),
				"source>CX",
			]);
		});

		/*
		 * Content stable ids: the same loop keeps its pin across passes,
		 * a loop that changed becomes a DIFFERENT id and its pin is
		 * pruned as an orphan rather than transferring to a loop the user
		 * never pinned.
		 */
		it("keeps the pin of a loop whose stops did not change", () => {
			const chainId: string = raukkAutoChainId("production", "AI1", [
				"AI1",
				"ZV-194a",
				"ZV-759b",
			]);

			store.setAutoChainResults([makeChainResult(chainId, ["source"])]);
			store.setAssignment(raukkChainAssignmentKey(chainId), "WCB");

			// the next pass discovered the very same loop, other order
			store.setAutoChainResults([
				makeChainResult(
					raukkAutoChainId("production", "AI1", [
						"AI1",
						"ZV-759b",
						"ZV-194a",
					]),
					["source"]
				),
			]);

			expect(store.assignments[raukkChainAssignmentKey(chainId)]).toBe(
				"WCB"
			);
		});

		it("prunes the pin of a loop that gained a stop", () => {
			const before: string = raukkAutoChainId("production", "AI1", [
				"AI1",
				"ZV-194a",
				"ZV-759b",
			]);
			const after: string = raukkAutoChainId("production", "AI1", [
				"AI1",
				"ZV-194a",
				"ZV-759b",
				"ZV-307c",
			]);

			expect(after).not.toBe(before);

			store.setAutoChainResults([makeChainResult(before, ["source"])]);
			store.setAssignment(raukkChainAssignmentKey(before), "WCB");

			store.setAutoChainResults([makeChainResult(after, ["source"])]);

			expect(
				store.assignments[raukkChainAssignmentKey(before)]
			).toBeUndefined();
			expect(
				store.assignments[raukkChainAssignmentKey(after)]
			).toBeUndefined();
		});

		it("replaces a stored positional result and prunes its pin", () => {
			// a blob frozen under the old `auto:<class>:<cx>:<n>` scheme
			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
			]);
			store.setAssignment(
				raukkChainAssignmentKey("auto:production:AI1:1"),
				"WCB"
			);

			const contentId: string = raukkAutoChainId("production", "AI1", [
				"AI1",
				"ZV-194a",
				"ZV-759b",
			]);

			store.setAutoChainResults([makeChainResult(contentId, ["source"])]);

			expect(Object.keys(store.chainResults)).toStrictEqual([contentId]);
			expect(
				store.assignments[
					raukkChainAssignmentKey("auto:production:AI1:1")
				]
			).toBeUndefined();
		});

		it("keeps the pins of a purge it cannot vouch for", () => {
			store.setAutoChainResults([
				makeChainResult("auto:production:AI1:1", ["source"]),
			]);
			store.setAssignment(
				raukkChainAssignmentKey("auto:production:AI1:1"),
				"WCB"
			);

			// shipping off, or a failed pass: the derived set is unknown
			store.setAutoChainResults([], false);

			expect(store.chainResults).toStrictEqual({});
			expect(
				store.assignments[
					raukkChainAssignmentKey("auto:production:AI1:1")
				]
			).toBe("WCB");
		});

		it("flags one result stale without staling its member plans", () => {
			withMembers();
			store.setChainResult("c1", makeChainResult("c1", ["source"]));

			store.markChainResultStale("c1");
			store.markChainResultStale("nope");

			expect(store.chainResults.c1.stale).toBe(true);
			expect(store.snapshots.source.stale).toBe(false);
		});
	});

	describe("chain configuration", () => {
		/*
		 * A numeric input emits NaN for a lone "-" or ".". Stored, it
		 * exports as null and the users own backup no longer re-imports —
		 * and a NaN minimum share disables every automatic chain, since
		 * NaN compares false against any threshold.
		 */
		it("refuses a non finite chain knob and keeps the rest", () => {
			const detour: number = store.chainConfig.cxSplitDetourParsecs;

			store.setChainConfig({
				cxSplitDetourParsecs: Number.NaN,
				autoChainMinShare: Number.POSITIVE_INFINITY,
				densityRef: 4,
			});

			expect(store.chainConfig.cxSplitDetourParsecs).toBe(detour);
			expect(store.chainConfig.autoChainMinShare).toBe(
				raukkDefaultChainConfig().autoChainMinShare
			);
			expect(store.chainConfig.densityRef).toBe(4);
			expect(store.chainConfig.autoCxSplit).toBe(
				raukkDefaultChainConfig().autoCxSplit
			);
		});
	});

	describe("cx anchor", () => {
		it("stores the per plan anchor and stales the plan", () => {
			withMembers();

			store.setPlanCxAnchor("source", "NC1");

			expect(store.configs.source.cxAnchor).toBe("NC1");
			expect(store.snapshots.source.stale).toBe(true);

			store.setSnapshot("source", makeSnapshot("Source", "ZV-194a"));
			store.setPlanCxAnchor("source", undefined);

			expect(store.configs.source.cxAnchor).toBeUndefined();
			expect(store.snapshots.source.stale).toBe(true);
		});

		it("defaults the account mode to the nearest exchange", () => {
			expect(store.shippingConfig.cxAnchorMode).toBe("nearest");
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
			// against the on-default: an explicitly persisted false must
			// survive the round trip, never be overwritten by the default
			store.setFleetSpillover(false);

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
			expect(store.depots).toStrictEqual({});
			expect(store.fleetSpillover).toBe(true);

			store.importJSON(exported);
			expect(store.fleetSpillover).toBe(false);

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
			store.setFleetSpillover(false);

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
			expect(store.depots).toStrictEqual({});
			// absent before the spillover display existed, defaults on
			expect(store.fleetSpillover).toBe(true);
		});

		it("defaults the phase 2 fields of an older payload", () => {
			const result = makeChainResult("c1", ["source"]) as Record<
				string,
				unknown
			>;

			// a result written before the derived chains existed
			delete result.auto;
			delete result.advisories;

			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 30, sources: {} } },
					snapshots: {},
					shippingConfig: {
						enabled: true,
						defaultProfileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
						routingMode: "direct",
						sameSystemFlatCost: 0,
					},
					chainConfig: {
						cxSplitDetourParsecs: 6,
						legUtilizationSplitThreshold: 0.25,
						densityRef: 3.28,
						stlCostPerMegameter: 0,
						autoCxSplit: true,
						sameSystemPricing: "average",
					},
					chainResults: { c1: result },
				})
			);

			expect(store.shippingConfig.cxAnchorMode).toBe("nearest");
			expect(store.chainConfig.autoChainMinShare).toBe(0.05);
			expect(store.chainConfig.autoChainDetourInOutParsecs).toBe(2);
			expect(store.chainConfig.autoChainDetourLooseParsecs).toBe(6);
			expect(store.chainResults.c1.auto).toBeUndefined();
			expect(store.chainResults.c1.advisories).toStrictEqual([]);
			expect(store.configs.a.cxAnchor).toBeUndefined();
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

		/*
		 * The two branches that met in this merge each grew the snapshot
		 * shape on their own: the sourced cost notes added the frozen
		 * `inputPrices`/`sellPrices`, the shipping model the `flows` and
		 * `lanes` arrays with the chain and fleet slices. A user coming
		 * from either branch must be able to import their export.
		 */
		it("accepts an export written without the shipping slices", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 30, sources: {} } },
					snapshots: {
						a: {
							...makeSnapshot("A", "ZV-759b"),
							inputPrices: { ORE: 12.5 },
							sellPrices: { ORE: 55 },
						},
					},
				})
			);

			expect(store.snapshots.a.inputPrices).toStrictEqual({ ORE: 12.5 });
			expect(store.snapshots.a.sellPrices).toStrictEqual({ ORE: 55 });
			expect(store.snapshots.a.flows).toBeUndefined();
			expect(store.chains).toStrictEqual({});
		});

		it("accepts an export written without the frozen prices", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setSnapshot("a", {
				...makeSnapshot("A", "ZV-759b"),
				flows: [],
				lanes: [],
				shippingFraction: null,
			});

			const exported: string = store.exportJSON();
			store.$reset();
			store.importJSON(exported);

			expect(store.snapshots.a.flows).toStrictEqual([]);
			expect(store.snapshots.a.shippingFraction).toBeNull();
			expect(store.snapshots.a.inputPrices).toBeUndefined();
			expect(store.chains.c1.stops).toStrictEqual(["ZV-194a", "ZV-759b"]);
		});

		it("accepts both sides shapes in one payload", () => {
			store.importJSON(
				JSON.stringify({
					version: 2,
					configs: {},
					snapshots: {
						a: {
							...makeSnapshot("A", "ZV-759b"),
							inputPrices: { ORE: 1 },
							sellPrices: { ORE: 2 },
							flows: [],
							lanes: [],
							shippingFraction: 0.25,
						},
					},
				})
			);

			expect(store.snapshots.a.inputPrices).toStrictEqual({ ORE: 1 });
			expect(store.snapshots.a.shippingFraction).toBe(0.25);
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

	describe("depots", () => {
		it("marks a planet, keyed case blind and displayed as typed", () => {
			store.setDepot("ZV-307c", { weeklyCostAic: 2850 });

			expect(store.depots["ZV-307C"]).toStrictEqual({
				planetNaturalId: "ZV-307c",
				weeklyCostAic: 2850,
			});
			expect(store.depotStopRefs()).toStrictEqual(["ZV-307c"]);
		});

		it("patches the rent of a depot it already knows", () => {
			store.setDepot("ZV-307c", { weeklyCostAic: 2850 });
			store.setDepot("zv-307c", { weeklyCostAic: 1000 });

			expect(Object.keys(store.depots)).toHaveLength(1);
			expect(store.depots["ZV-307C"].weeklyCostAic).toBe(1000);
		});

		it("clears a non positive or non finite rent to free", () => {
			store.setDepot("ZV-307c", { weeklyCostAic: 2850 });
			store.setDepot("ZV-307c", { weeklyCostAic: 0 });

			expect(store.depots["ZV-307C"].weeklyCostAic).toBeUndefined();

			store.setDepot("ZV-307c", { weeklyCostAic: Number.NaN });

			expect(store.depots["ZV-307C"].weeklyCostAic).toBeUndefined();
		});

		it("stales every chain, marking and un-marking alike", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", []));

			store.setDepot("ZV-307c");

			expect(store.chainResults["c1"].stale).toBe(true);

			store.setChainResult("c1", makeChainResult("c1", []));
			store.deleteDepot("zv-307c");

			expect(store.chainResults["c1"].stale).toBe(true);
			expect(store.depots).toStrictEqual({});
		});

		it("stales the snapshots too, a base there loses its CX lane", () => {
			withMembers();

			store.setDepot("ZV-194a");

			expect(store.snapshots.source.stale).toBe(true);
			expect(store.snapshots.consumer.stale).toBe(true);
		});

		it("stales nothing when only the rent of a known depot moves", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setDepot("ZV-307c");
			store.setChainResult("c1", makeChainResult("c1", []));

			// the rent is no input of the chain math, it is summed next to it
			store.setDepot("zv-307c", { weeklyCostAic: 2850 });

			expect(store.chainResults["c1"].stale).toBe(false);
			expect(store.depots["ZV-307C"].weeklyCostAic).toBe(2850);
		});

		it("round trips through the export", () => {
			store.setDepot("ZV-307c", { weeklyCostAic: 2850 });

			const payload: string = store.exportJSON();
			store.$reset();
			store.importJSON(payload);

			expect(store.depots["ZV-307C"]).toStrictEqual({
				planetNaturalId: "ZV-307c",
				weeklyCostAic: 2850,
			});
		});

		it("imports a payload written before depots existed", () => {
			store.setDepot("ZV-307c", { weeklyCostAic: 2850 });

			store.importJSON(
				JSON.stringify({ version: 1, configs: {}, snapshots: {} })
			);

			expect(store.depots).toStrictEqual({});
		});
	});

	describe("planned gates", () => {
		afterEach(() => {
			// the store hands its enabled gates to the module level route
			// index; nothing may leak into another test file's routing
			setRaukkPlannedGateLinks([]);
		});

		it("stores a gate with the shipped defaults filled in", () => {
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
			});

			expect(store.plannedGates["g1"]).toStrictEqual({
				id: "g1",
				name: undefined,
				planetA: "ZV-307c",
				planetB: "OT-580b",
				fee: 4000,
				capacityUpgrades: 0,
				volumeUpgrades: 0,
				rangeUpgrades: 0,
				enabled: false,
				status: "proposed",
				note: undefined,
			});
			expect(store.listPlannedGates()).toHaveLength(1);
		});

		it("refuses a gate that is missing an end", () => {
			store.setPlannedGate("g1", { planetA: "ZV-307c" });
			store.setPlannedGate("  ", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
			});

			expect(store.plannedGates).toStrictEqual({});
		});

		it("patches what it is given and keeps the rest", () => {
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
				fee: 2500,
			});
			store.setPlannedGate("g1", {
				volumeUpgrades: 3,
				name: "Long Haul",
			});

			expect(store.plannedGates["g1"]).toMatchObject({
				planetA: "ZV-307c",
				fee: 2500,
				volumeUpgrades: 3,
				name: "Long Haul",
			});
		});

		it("refuses non finite and negative numbers", () => {
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
				fee: 2500,
			});
			store.setPlannedGate("g1", { fee: Number.NaN, volumeUpgrades: -1 });

			expect(store.plannedGates["g1"].fee).toBe(2500);
			expect(store.plannedGates["g1"].volumeUpgrades).toBe(0);
		});

		it("only an ENABLED gate reaches the route index", () => {
			// 12.88 pc apart, so one range upgrade makes it buildable
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "IA-335b",
				rangeUpgrades: 1,
			});

			expect(raukkPlannedGateLinks()).toHaveLength(0);

			store.setPlannedGate("g1", { enabled: true });

			expect(raukkPlannedGateLinks()).toHaveLength(1);
			expect(raukkPlannedGateLinks()[0]).toMatchObject({
				a: "ZV-307c",
				b: "IA-335b",
				planned: true,
			});

			store.setPlannedGate("g1", { enabled: false });

			expect(raukkPlannedGateLinks()).toHaveLength(0);
		});

		it("stales the chains when the graph moves", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setChainResult("c1", makeChainResult("c1", []));

			// authoring a switched OFF gate routes nothing
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
			});

			expect(store.chainResults["c1"].stale).toBe(false);

			store.setPlannedGate("g1", { enabled: true });

			expect(store.chainResults["c1"].stale).toBe(true);
		});

		it("stales nothing for a label, a note or a status", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
				enabled: true,
			});
			store.setChainResult("c1", makeChainResult("c1", []));

			store.setPlannedGate("g1", {
				name: "Long Haul",
				note: "opens in a week",
				status: "construction",
			});

			expect(store.chainResults["c1"].stale).toBe(false);
		});

		it("stales the snapshots only while shipping is enabled", () => {
			store.setShippingConfig({ enabled: false });
			store.setSnapshot("plan-1", makeSnapshot("Plan 1", "ZV-307c"));
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
				enabled: true,
			});

			expect(store.snapshots["plan-1"].stale).toBe(false);

			store.setShippingConfig({ enabled: true });
			store.setSnapshot("plan-1", makeSnapshot("Plan 1", "ZV-307c"));
			store.setPlannedGate("g1", { volumeUpgrades: 3 });

			expect(store.snapshots["plan-1"].stale).toBe(true);
		});

		it("deletes, taking the edge back out of the graph", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
				enabled: true,
			});
			store.setChainResult("c1", makeChainResult("c1", []));

			store.deletePlannedGate("g1");

			expect(store.plannedGates).toStrictEqual({});
			expect(raukkPlannedGateLinks()).toHaveLength(0);
			expect(store.chainResults["c1"].stale).toBe(true);
		});

		it("deleting a switched off gate stales nothing", () => {
			store.setChain({ chainId: "c1", stops: ["ZV-194a", "ZV-759b"] });
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
			});
			store.setChainResult("c1", makeChainResult("c1", []));

			store.deletePlannedGate("g1");
			store.deletePlannedGate("nope");

			expect(store.chainResults["c1"].stale).toBe(false);
		});

		it("round trips through the export", () => {
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "IA-335b",
				fee: 2500,
				volumeUpgrades: 1,
				rangeUpgrades: 1,
				enabled: true,
				status: "construction",
				name: "Long Haul",
			});

			const payload: string = store.exportJSON();
			store.$reset();

			expect(store.plannedGates).toStrictEqual({});
			expect(raukkPlannedGateLinks()).toHaveLength(0);

			store.importJSON(payload);

			expect(store.plannedGates["g1"]).toMatchObject({
				planetA: "ZV-307c",
				planetB: "IA-335b",
				fee: 2500,
				volumeUpgrades: 1,
				rangeUpgrades: 1,
				enabled: true,
				status: "construction",
				name: "Long Haul",
			});
			// the import has to reach the routing layer too
			expect(raukkPlannedGateLinks()).toHaveLength(1);
		});

		it("imports a payload written before planned gates existed", () => {
			store.setPlannedGate("g1", {
				planetA: "ZV-307c",
				planetB: "OT-580b",
				enabled: true,
			});

			store.importJSON(
				JSON.stringify({ version: 1, configs: {}, snapshots: {} })
			);

			expect(store.plannedGates).toStrictEqual({});
			expect(raukkPlannedGateLinks()).toHaveLength(0);
		});
	});

	describe("$reset", () => {
		it("clears the chain and fleet slices", () => {
			store.setChain({ chainId: "c1", stops: ["A", "B"] });
			store.setChainResult("c1", makeChainResult("c1", []));
			store.setFleetShip("WCB", { count: 2 });
			store.setAssignment("a>CX", "WCB");
			store.setChainConfig({ autoCxSplit: false });
			store.setDepot("ZV-307c", { weeklyCostAic: 2850 });

			store.$reset();

			expect(store.chains).toStrictEqual({});
			expect(store.chainResults).toStrictEqual({});
			expect(store.fleet).toStrictEqual({});
			expect(store.assignments).toStrictEqual({});
			expect(store.chainConfig).toStrictEqual(raukkDefaultChainConfig());
			expect(store.depots).toStrictEqual({});
		});
	});
});
