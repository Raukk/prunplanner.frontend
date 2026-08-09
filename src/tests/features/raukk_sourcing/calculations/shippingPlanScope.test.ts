import { describe, expect, it } from "vitest";

// Calculations
import {
	raukkEmpirePlanUuids,
	raukkScopedSnapshots,
} from "@/features/raukk_sourcing/calculations/shippingPlanScope";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

function empire(uuid: string, planUuids: string[]): IPlanEmpireElement {
	return {
		uuid,
		name: uuid,
		plans: planUuids.map((planUuid) => ({
			uuid: planUuid,
			plan_name: planUuid,
			planet_natural_id: "OT-580b",
		})),
	} as unknown as IPlanEmpireElement;
}

function snapshot(planName: string): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName,
		planetNaturalId: "OT-580b",
		outputs: {},
		draws: {},
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
				Object.keys(raukkScopedSnapshots(snapshots, new Set(["assigned"])))
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
					raukkScopedSnapshots(snapshots, new Set(["assigned", "ghost"]))
				)
			).toStrictEqual(["assigned"]);
		});
	});
});
