import { describe, expect, it } from "vitest";

// Calculations
import {
	raukkEmpirePlanUuids,
	raukkEmpirePlanets,
	raukkScopedFlows,
	raukkScopedSnapshots,
} from "@/features/raukk_sourcing/calculations/shippingPlanScope";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";

function empire(
	uuid: string,
	planUuids: string[],
	planetNaturalId: string = "OT-580b"
): IPlanEmpireElement {
	return {
		uuid,
		name: uuid,
		plans: planUuids.map((planUuid) => ({
			uuid: planUuid,
			plan_name: planUuid,
			planet_natural_id: planetNaturalId,
		})),
	} as unknown as IPlanEmpireElement;
}

function snapshot(planName: string, flows?: IRaukkChainFlow[]): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName,
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
		...(flows !== undefined ? { flows } : {}),
	};
}

function flow(
	ticker: string,
	ownerPlanUuid?: string,
	sourcePlanUuid?: string
): IRaukkChainFlow {
	return {
		flowId: `${ownerPlanUuid ?? "-"}#${ticker}`,
		ticker,
		fromStop: "ZV-307c",
		toStop: "OT-580b",
		unitsPerDay: 1,
		weightPerUnit: 1,
		volumePerUnit: 1,
		...(ownerPlanUuid !== undefined ? { ownerPlanUuid } : {}),
		...(sourcePlanUuid !== undefined ? { sourcePlanUuid } : {}),
	};
}

describe("Raukk Sourcing: Plan Scope", () => {
	describe("raukkEmpirePlanUuids", () => {
		it("collects the plans of every empire, without duplicates", () => {
			const uuids: Set<string> = raukkEmpirePlanUuids({
				one: empire("one", ["a", "b"]),
				two: empire("two", ["b", "c"]),
			});

			expect([...uuids].sort()).toStrictEqual(["a", "b", "c"]);
		});

		it("is empty without any empire", () => {
			expect(raukkEmpirePlanUuids({}).size).toBe(0);
		});
	});

	describe("raukkScopedSnapshots", () => {
		const snapshots: Record<string, IRaukkSnapshot> = {
			assigned: snapshot("Assigned"),
			dropped: snapshot("Dropped"),
		};

		it("keeps the assigned plans only", () => {
			expect(
				Object.keys(
					raukkScopedSnapshots(snapshots, new Set(["assigned"]))
				)
			).toStrictEqual(["assigned"]);
		});

		it("keeps everything while no empire is loaded yet", () => {
			// an empty set is "not loaded", never "nothing assigned":
			// filtering on it would blank the page on every fresh load
			expect(
				Object.keys(raukkScopedSnapshots(snapshots, new Set()))
			).toStrictEqual(["assigned", "dropped"]);
		});

		it("does not invent snapshots for assigned plans without one", () => {
			expect(
				Object.keys(
					raukkScopedSnapshots(
						snapshots,
						new Set(["assigned", "ghost"])
					)
				)
			).toStrictEqual(["assigned"]);
		});

		it("drops the lanes of a kept plan that draw from an unassigned one", () => {
			const scoped: Record<string, IRaukkSnapshot> = raukkScopedSnapshots(
				{
					assigned: snapshot("Assigned", [
						flow("RAT", "assigned"),
						flow("ORE", "assigned", "dropped"),
					]),
					dropped: snapshot("Dropped", [flow("ORE", "dropped")]),
				},
				new Set(["assigned"])
			);

			expect(
				(scoped.assigned.flows ?? []).map((entry) => entry.ticker)
			).toStrictEqual(["RAT"]);
		});

		it("passes an untouched snapshot through by reference", () => {
			const kept: IRaukkSnapshot = snapshot("Assigned", [
				flow("RAT", "kept"),
			]);

			expect(raukkScopedSnapshots({ kept }, new Set(["kept"])).kept).toBe(
				kept
			);
		});
	});

	describe("raukkScopedFlows", () => {
		it("keeps a market lane, which names no counterpart plan", () => {
			expect(
				raukkScopedFlows(
					[flow("RAT", "assigned")],
					new Set(["assigned"])
				)
			).toHaveLength(1);
		});

		it("drops a lane whose owner is out of scope", () => {
			expect(
				raukkScopedFlows(
					[flow("RAT", "dropped")],
					new Set(["assigned"])
				)
			).toStrictEqual([]);
		});

		it("drops a lane whose source is out of scope", () => {
			expect(
				raukkScopedFlows(
					[flow("ORE", "assigned", "dropped")],
					new Set(["assigned"])
				)
			).toStrictEqual([]);
		});

		it("keeps a lane both ends of which are in scope", () => {
			expect(
				raukkScopedFlows(
					[flow("ORE", "assigned", "other")],
					new Set(["assigned", "other"])
				)
			).toHaveLength(1);
		});

		it("keeps everything while no empire is loaded yet", () => {
			expect(
				raukkScopedFlows(
					[flow("ORE", "assigned", "dropped")],
					new Set()
				)
			).toHaveLength(1);
		});
	});

	describe("raukkEmpirePlanets", () => {
		it("collects the planets of every empire, without duplicates", () => {
			const planets: Set<string> = raukkEmpirePlanets({
				one: empire("one", ["a", "b"], "OT-580b"),
				two: empire("two", ["c"], "ZV-307c"),
			});

			expect([...planets].sort()).toStrictEqual(["OT-580b", "ZV-307c"]);
		});
	});

	describe("switched off planets", () => {
		/** The flows of an account that still knew no plan uuids */
		const legacy: IRaukkChainFlow[] = [flow("ORE")];

		it("drops a lane to a planet no assigned plan stands on", () => {
			// the uuid rule cannot see this one: an ownerless flow names
			// no plan to test, so its ENDPOINT has to answer instead
			expect(
				raukkScopedFlows(
					legacy,
					new Set(["assigned"]),
					new Set(["OT-580b"])
				)
			).toStrictEqual([]);
		});

		it("keeps a lane both planets of which are operated", () => {
			expect(
				raukkScopedFlows(
					legacy,
					new Set(["assigned"]),
					new Set(["OT-580b", "ZV-307c"])
				)
			).toHaveLength(1);
		});

		it("never switches off an exchange", () => {
			const market: IRaukkChainFlow = {
				...flow("RAT", "assigned"),
				fromStop: "AI1",
			};

			expect(
				raukkScopedFlows(
					[market],
					new Set(["assigned"]),
					new Set(["OT-580b"])
				)
			).toHaveLength(1);
		});

		it("checks no endpoint while the planets are not known yet", () => {
			expect(
				raukkScopedFlows(legacy, new Set(["assigned"]), new Set())
			).toHaveLength(1);
		});

		it("scopes the flows of a snapshot by their planets too", () => {
			const scoped: Record<string, IRaukkSnapshot> = raukkScopedSnapshots(
				{
					assigned: snapshot("Assigned", [
						...legacy,
						{ ...flow("RAT", "assigned"), fromStop: "AI1" },
					]),
				},
				new Set(["assigned"]),
				new Set(["OT-580b"])
			);

			expect(
				(scoped.assigned.flows ?? []).map((entry) => entry.ticker)
			).toStrictEqual(["RAT"]);
		});
	});
});
