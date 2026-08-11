import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

// stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { usePlanningStore } from "@/stores/planningStore";

// Calculations
import {
	RAUKK_DEFAULT_SHIP_PROFILE_ID,
	raukkDefaultShippingConfig,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Schemas
import { RaukkLocalPriceSchema } from "@/features/raukk_sourcing/raukkSourcingStore.schemas";

// Types & Interfaces
import {
	IRaukkChainFlow,
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IPlanEmpireElement } from "@/stores/planningStore.types";

function makeSnapshot(
	name: string,
	outputs: Record<string, number>,
	draws: Record<string, Record<string, number>> = {}
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: name,
		planetNaturalId: "OT-580b",
		outputs: Object.fromEntries(
			Object.entries(outputs).map(([ticker, unitsPerDay]) => [
				ticker,
				{
					ticker,
					unitsPerDay,
					costPerUnit: 42,
					breakdown: {
						workforce: 2,
						repair: 5,
						inputs: 35,
						shipping: 0,
					},
				},
			])
		),
		draws,
	};
}

/**
 * Puts exactly one plan into one empire, which takes every other stored
 * plan out of the accounts scope.
 *
 * @param {string} planUuid Plan Uuid
 */
function assignOnly(planUuid: string): void {
	usePlanningStore().setEmpires([
		{
			uuid: "empire",
			name: "My Empire",
			plans: [
				{
					uuid: planUuid,
					plan_name: planUuid,
					planet_natural_id: "OT-580b",
				},
			],
		} as unknown as IPlanEmpireElement,
	]);
}

describe("Raukk Sourcing Store", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	describe("configuration", () => {
		it("getConfig returns the default without persisting it", () => {
			expect(store.getConfig("a")).toStrictEqual({
				repairDay: 90,
				sources: {},
			});
			expect(store.configs.a).toBeUndefined();
			expect(Object.keys(store.configs).length).toBe(0);
		});

		it("getConfig returns a detached copy", () => {
			store.setTickerSource("a", "RAT", {
				mode: "market",
				priceMode: "BID",
			});

			const config = store.getConfig("a");
			config.sources.RAT = { mode: "market", priceMode: "ASK" };

			expect(store.configs.a.sources.RAT).toStrictEqual({
				mode: "market",
				priceMode: "BID",
			});
		});

		it("setTickerSource creates the config on demand", () => {
			store.setTickerSource("a", "ORE", {
				mode: "plan",
				sourcePlanUuid: "b",
			});

			expect(store.getConfig("a")).toStrictEqual({
				repairDay: 90,
				sources: { ORE: { mode: "plan", sourcePlanUuid: "b" } },
			});
		});

		it("clearTickerSource removes a source", () => {
			store.setTickerSource("a", "ORE", {
				mode: "plan",
				sourcePlanUuid: "b",
			});
			store.clearTickerSource("a", "ORE");

			expect(store.getConfig("a").sources).toStrictEqual({});
		});

		it("clearTickerSource is a no-op for unknown data", () => {
			store.clearTickerSource("a", "ORE");
			store.setTickerSource("a", "ORE", {
				mode: "market",
				priceMode: "MID",
			});
			store.clearTickerSource("a", "NOPE");

			expect(Object.keys(store.getConfig("a").sources)).toStrictEqual([
				"ORE",
			]);
		});

		it("setRepairDay stores the day", () => {
			store.setRepairDay("a", 30);
			expect(store.getConfig("a").repairDay).toBe(30);
		});

		it("setLocalSale creates the config on demand", () => {
			store.setLocalSale("a", "ALO", { basis: "BID", value: 0 });

			expect(store.getConfig("a")).toStrictEqual({
				repairDay: 90,
				sources: {},
				localSales: { ALO: { basis: "BID", value: 0 } },
			});
		});

		it("setLocalSale marks the plan and dependents stale", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 10 }, { a: { ORE: 50 } })
			);

			store.setLocalSale("a", "ORE", { basis: "MANUAL", value: 120 });

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("clearLocalSale removes one flag and marks stale", () => {
			store.setLocalSale("a", "ALO", { basis: "BID", value: 0 });
			store.setLocalSale("a", "SIO", { basis: "ASK", value: 5 });
			store.setSnapshot("a", makeSnapshot("A", { ALO: 100 }));

			store.clearLocalSale("a", "ALO");

			expect(store.getConfig("a").localSales).toStrictEqual({
				SIO: { basis: "ASK", value: 5 },
			});
			expect(store.snapshots.a.stale).toBe(true);
		});

		it("clearLocalSale is a no-op for unknown data", () => {
			store.clearLocalSale("a", "ALO");
			expect(store.configs.a).toBeUndefined();

			store.setLocalSale("a", "ALO", { basis: "BID", value: 0 });
			store.setSnapshot("a", makeSnapshot("A", { ALO: 100 }));

			store.clearLocalSale("a", "NOPE");

			expect(store.getConfig("a").localSales).toStrictEqual({
				ALO: { basis: "BID", value: 0 },
			});
			expect(store.snapshots.a.stale).toBe(false);
		});

		it("setPlanCadence stores and clears one bucket override", () => {
			store.setPlanCadence("a", "production", 365);
			store.setPlanCadence("a", "repair", 7);

			expect(store.getConfig("a").cadence).toStrictEqual({
				production: 365,
				repair: 7,
			});

			store.setPlanCadence("a", "production", undefined);

			expect(store.getConfig("a").cadence).toStrictEqual({ repair: 7 });
		});

		it("setPlanCadence refuses a non positive day count", () => {
			store.setPlanCadence("a", "workforce", 30);
			store.setPlanCadence("a", "workforce", 0);

			expect(store.getConfig("a").cadence).toStrictEqual({});
		});

		/*
		 * A numeric input emits NaN for a lone "-" or ".", and NaN passes
		 * every `<= 0` guard. Stored, it exports as null and the users own
		 * backup no longer re-imports.
		 */
		it("setPlanCadence refuses a day count that is not a number", () => {
			store.setPlanCadence("a", "workforce", 30);
			store.setPlanCadence("a", "workforce", Number.NaN);

			expect(store.getConfig("a").cadence).toStrictEqual({});

			store.setPlanCadence("a", "repair", 30);
			store.setPlanCadence("a", "repair", Number.POSITIVE_INFINITY);

			expect(store.getConfig("a").cadence).toStrictEqual({});
		});

		it("cadence changes mark the plan and dependents stale", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 10 }, { a: { ORE: 50 } })
			);

			store.setPlanCadence("a", "production", 21);

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("config changes mark the plan and dependents stale", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 10 }, { a: { ORE: 50 } })
			);

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(false);

			store.setRepairDay("a", 120);

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});
	});

	describe("account wide sourcing defaults", () => {
		/** A snapshot classifying RAT as workforce and BSE as repair */
		function classified(name: string): IRaukkSnapshot {
			return {
				...makeSnapshot(name, { ORE: 100 }),
				inputBuckets: { RAT: ["workforce"], BSE: ["repair"] },
			};
		}

		it("stores a bucket default and stales the whole store", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { RAT: 10 }));

			store.setSourcingDefault("workforce", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG_MKT",
			});

			expect(store.sourcingDefaults.workforce).toStrictEqual({
				mode: "plan",
				sourcePlanUuid: "AGG_AVG_MKT",
			});
			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("clears a bucket default again", () => {
			store.setSourcingDefault("repair", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
			store.setSourcingDefault("repair", undefined);

			expect(store.sourcingDefaults.repair).toBeUndefined();
		});

		it("stores a ship group default and stales the whole store", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { FF: 10 }));

			store.setShipSourcingDefault("fuel", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});

			expect(store.shipSourcing.defaults.fuel).toStrictEqual({
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
			// the fleet flies for every base, so every base was costed
			// with the old fuel price
			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("stores and clears a ship ticker entry", () => {
			store.setShipTickerSource("LHP", {
				mode: "market",
				priceMode: "BID",
			});

			expect(store.shipSourcing.sources.LHP).toStrictEqual({
				mode: "market",
				priceMode: "BID",
			});

			store.setShipTickerSource("LHP", undefined);

			expect(store.shipSourcing.sources.LHP).toBeUndefined();
		});

		it("clears a ship group default again", () => {
			store.setShipSourcingDefault("shipRepair", {
				mode: "plan",
				sourcePlanUuid: "AGG_MAX",
			});
			store.setShipSourcingDefault("shipRepair", undefined);

			expect(store.shipSourcing.defaults.shipRepair).toBeUndefined();
		});

		it("lists the per plan entries a default would replace", () => {
			store.setSnapshot("a", classified("A"));
			store.setSnapshot("b", classified("B"));

			store.setTickerSource("a", "RAT", {
				mode: "plan",
				sourcePlanUuid: "b",
			});
			store.setTickerSource("a", "BSE", {
				mode: "market",
				priceMode: "ASK",
			});
			store.setTickerSource("b", "RAT", { mode: "cx" });

			store.setSourcingDefault("workforce", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});

			expect(store.bucketOverrides("workforce")).toStrictEqual({
				a: ["RAT"],
				b: ["RAT"],
			});
			// a bucket without a default of its own still owns the tickers
			// no other bucket claims: setting one and clearing one are the
			// same change to the bases that override it
			expect(store.bucketOverrides("repair")).toStrictEqual({
				a: ["BSE"],
			});
		});

		it("drops the per plan entries of one bucket on every base", () => {
			store.setSnapshot("a", classified("A"));
			store.setTickerSource("a", "RAT", { mode: "cx" });
			store.setTickerSource("a", "BSE", {
				mode: "market",
				priceMode: "ASK",
			});

			store.setSourcingDefault("workforce", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
			store.snapshots.a.stale = false;

			expect(store.clearBucketOverrides("workforce")).toBe(1);
			expect(store.configs.a.sources.RAT).toBeUndefined();
			// a ticker of another bucket keeps its own setting
			expect(store.configs.a.sources.BSE).toStrictEqual({
				mode: "market",
				priceMode: "ASK",
			});
			expect(store.snapshots.a.stale).toBe(true);
		});

		it("knows nothing of a plan that never computed a snapshot", () => {
			store.setTickerSource("a", "RAT", { mode: "cx" });
			store.setSourcingDefault("workforce", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});

			expect(store.bucketOverrides("workforce")).toStrictEqual({});
			expect(store.clearBucketOverrides("workforce")).toBe(0);
		});
	});

	describe("snapshots and staleness", () => {
		/** a <- b <- c, c depends on b, b depends on a */
		function buildChain(): void {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
			);
			store.setSnapshot(
				"c",
				makeSnapshot("C", { ALO: 20 }, { b: { MET: 10 } })
			);
		}

		it("setSnapshot stores it as current", () => {
			store.setSnapshot("a", {
				...makeSnapshot("A", { ORE: 100 }),
				stale: true,
			});

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.getSnapshot("a")?.planName).toBe("A");
			expect(store.getSnapshot("nope")).toBeUndefined();
		});

		it("setSnapshot cascades staleness multiple levels", () => {
			buildChain();

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(false);
			expect(store.snapshots.c.stale).toBe(false);

			store.setSnapshot("a", makeSnapshot("A", { ORE: 120 }));

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(true);
			expect(store.snapshots.c.stale).toBe(true);
		});

		it("markStale cascades and includes the plan itself", () => {
			buildChain();
			store.markStale("b");

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(true);
			expect(store.snapshots.c.stale).toBe(true);
		});

		it("markStale on a plan without snapshot cascades via config", () => {
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
			);

			store.markStale("a");

			expect(store.snapshots.b.stale).toBe(true);
			expect(store.snapshots.a).toBeUndefined();
		});

		it("setSnapshot detaches the given object", () => {
			const snapshot = makeSnapshot("A", { ORE: 100 });
			store.setSnapshot("a", snapshot);
			snapshot.outputs.ORE.costPerUnit = 999;

			expect(store.snapshots.a.outputs.ORE.costPerUnit).toBe(42);
		});

		it("setSnapshot skips the cascade when the numbers are unchanged", () => {
			buildChain();

			// same numbers again, e.g. the automatic upkeep on view load
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

			expect(store.snapshots.b.stale).toBe(false);
			expect(store.snapshots.c.stale).toBe(false);
		});

		it("staleness cascades along a supply loop without hanging", () => {
			// a and b draw from each other
			store.setSnapshot(
				"a",
				makeSnapshot("A", { ORE: 100 }, { b: { FUEL: 5 } })
			);
			store.setSnapshot(
				"b",
				makeSnapshot("B", { FUEL: 50 }, { a: { ORE: 40 } })
			);

			store.markStale("a");

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});
	});

	describe("scopedSnapshots", () => {
		beforeEach(() => {
			store.setSnapshot("assigned", makeSnapshot("Assigned", { FE: 10 }));
			store.setSnapshot("dropped", makeSnapshot("Dropped", { FE: 10 }));
		});

		it("keeps every snapshot while no empire is loaded", () => {
			expect(Object.keys(store.scopedSnapshots()).sort()).toStrictEqual([
				"assigned",
				"dropped",
			]);
		});

		it("drops the plans no empire holds any more", () => {
			usePlanningStore().setEmpires([
				{
					uuid: "empire",
					name: "My Empire",
					plans: [
						{
							uuid: "assigned",
							plan_name: "Assigned",
							planet_natural_id: "OT-580b",
						},
					],
				} as unknown as IPlanEmpireElement,
			]);

			expect(Object.keys(store.scopedSnapshots())).toStrictEqual([
				"assigned",
			]);
		});

		it("drops a flow to a planet no empire plan stands on", () => {
			// an old snapshot froze this lane before flows named their
			// plans: only its ENDPOINT can say the base is switched off
			store.setSnapshot("assigned", {
				...makeSnapshot("Assigned", { FE: 10 }),
				flows: [
					{
						flowId: "legacy",
						ticker: "ORE",
						fromStop: "ZV-307c",
						toStop: "OT-580b",
						unitsPerDay: 10,
						weightPerUnit: 1,
						volumePerUnit: 1,
					},
				],
			});

			usePlanningStore().setEmpires([
				{
					uuid: "empire",
					name: "My Empire",
					plans: [
						{
							uuid: "assigned",
							plan_name: "Assigned",
							planet_natural_id: "OT-580b",
						},
					],
				} as unknown as IPlanEmpireElement,
			]);

			expect(store.scopedSnapshots().assigned.flows).toStrictEqual([]);
		});
	});

	describe("producersOf", () => {
		it("lists producing plans, stale ones flagged", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100, MET: 5 }));
			store.setSnapshot("b", makeSnapshot("B", { ORE: 30 }));
			store.setSnapshot("c", makeSnapshot("C", { DW: 12 }));
			store.markStale("b");

			const producers = store.producersOf("ORE");

			expect(producers.length).toBe(2);
			expect(producers.map((p) => p.planUuid).sort()).toStrictEqual([
				"a",
				"b",
			]);

			const b = producers.find((p) => p.planUuid === "b");
			expect(b).toStrictEqual({
				planUuid: "b",
				planName: "B",
				planetNaturalId: "OT-580b",
				costPerUnit: 42,
				unitsPerDay: 30,
				stale: true,
				computedAt: "2026-01-01T00:00:00.000Z",
			});

			expect(store.producersOf("NOPE")).toStrictEqual([]);
		});

		it("hides a plan no empire holds any more", () => {
			store.setSnapshot(
				"assigned",
				makeSnapshot("Assigned", { ORE: 100 })
			);
			store.setSnapshot("dropped", makeSnapshot("Dropped", { ORE: 30 }));
			assignOnly("assigned");

			expect(
				store.producersOf("ORE").map((p) => p.planUuid)
			).toStrictEqual(["assigned"]);
		});

		it("offers an unassigned plan again once the rule is switched off", () => {
			store.setSnapshot(
				"assigned",
				makeSnapshot("Assigned", { ORE: 100 })
			);
			store.setSnapshot("dropped", makeSnapshot("Dropped", { ORE: 30 }));
			assignOnly("assigned");
			store.setShippingConfig({ allowUnassignedSources: true });

			expect(
				store
					.producersOf("ORE")
					.map((p) => p.planUuid)
					.sort()
			).toStrictEqual(["assigned", "dropped"]);
		});
	});

	describe("recomputeGraphInputs", () => {
		/**
		 * One empire holding the given plans, everything else out of the
		 * accounts scope.
		 *
		 * @param {string[]} planUuids Plan Uuids
		 */
		function assignAll(planUuids: string[]): void {
			usePlanningStore().setEmpires([
				{
					uuid: "empire",
					name: "My Empire",
					plans: planUuids.map((uuid) => ({
						uuid,
						plan_name: uuid,
						planet_natural_id: "OT-580b",
					})),
				} as unknown as IPlanEmpireElement,
			]);
		}

		beforeEach(() => {
			store.setSnapshot(
				"assigned",
				makeSnapshot("Assigned", { ORE: 100 })
			);
			store.setSnapshot("dropped", makeSnapshot("Dropped", { ORE: 30 }));
			store.setTickerSource("assigned", "RAT", {
				mode: "plan",
				sourcePlanUuid: "dropped",
			});
			store.setTickerSource("dropped", "RAT", {
				mode: "plan",
				sourcePlanUuid: "assigned",
			});
			assignAll(["assigned"]);
		});

		it("mirrors the sourcing scope", () => {
			const { configs, snapshots } = store.recomputeGraphInputs();

			expect(Object.keys(snapshots)).toStrictEqual(["assigned"]);
			expect(Object.keys(configs)).toStrictEqual(["assigned"]);
		});

		it("answers with everything while unassigned sources are allowed", () => {
			store.setShippingConfig({ allowUnassignedSources: true });

			const { configs, snapshots } = store.recomputeGraphInputs();

			expect(Object.keys(snapshots).sort()).toStrictEqual([
				"assigned",
				"dropped",
			]);
			expect(Object.keys(configs).sort()).toStrictEqual([
				"assigned",
				"dropped",
			]);
		});

		it("unions the extra plan in from the full store", () => {
			const { configs, snapshots } =
				store.recomputeGraphInputs("dropped");

			expect(Object.keys(snapshots).sort()).toStrictEqual([
				"assigned",
				"dropped",
			]);
			expect(Object.keys(configs).sort()).toStrictEqual([
				"assigned",
				"dropped",
			]);
			expect(snapshots.dropped.planName).toBe("Dropped");
		});

		it("keeps the config of an assigned plan that never computed", () => {
			store.setTickerSource("fresh", "RAT", {
				mode: "plan",
				sourcePlanUuid: "assigned",
			});
			assignAll(["assigned", "fresh"]);

			const { configs, snapshots } = store.recomputeGraphInputs();

			expect(Object.keys(configs).sort()).toStrictEqual([
				"assigned",
				"fresh",
			]);
			expect(snapshots.fresh).toBeUndefined();
		});

		it("returns records the caller may not write back through", () => {
			const { configs, snapshots } = store.recomputeGraphInputs();

			delete configs.assigned;
			delete snapshots.assigned;

			expect(store.configs.assigned).toBeDefined();
			expect(store.snapshots.assigned).toBeDefined();
		});
	});

	describe("subscription", () => {
		it("sums draws and computes the output share", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 10 }, { a: { ORE: 40 } })
			);
			store.setSnapshot(
				"c",
				makeSnapshot("C", { ALO: 10 }, { a: { ORE: 10 } })
			);

			const result = store.subscription("a", "ORE");

			expect(result.totalDrawnPerDay).toBe(50);
			expect(result.pctOfOutput).toBe(0.5);
			expect(result.byPlan.length).toBe(2);
			expect(
				result.byPlan.find((p) => p.planUuid === "b")?.unitsPerDay
			).toBe(40);
		});

		it("allows oversubscription above 100%", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 10 }, { a: { ORE: 80 } })
			);
			store.setSnapshot(
				"c",
				makeSnapshot("C", { ALO: 10 }, { a: { ORE: 70 } })
			);

			const result = store.subscription("a", "ORE");

			expect(result.totalDrawnPerDay).toBe(150);
			expect(result.pctOfOutput).toBe(1.5);
		});

		it("guards zero and missing output", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 0 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 10 }, { a: { ORE: 5 } })
			);

			expect(store.subscription("a", "ORE").pctOfOutput).toBe(0);
			expect(store.subscription("a", "ORE").totalDrawnPerDay).toBe(5);

			expect(store.subscription("nope", "ORE")).toStrictEqual({
				totalDrawnPerDay: 0,
				byPlan: [],
				pctOfOutput: 0,
			});
		});

		it("ignores the draws of a plan no empire holds any more", () => {
			store.setSnapshot("assigned", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"dropped",
				makeSnapshot("Dropped", { MET: 10 }, { assigned: { ORE: 40 } })
			);
			assignOnly("assigned");

			expect(store.subscription("assigned", "ORE")).toStrictEqual({
				totalDrawnPerDay: 0,
				byPlan: [],
				pctOfOutput: 0,
			});
		});
	});

	describe("chainClaimedUnitsOn", () => {
		/** Two chain results over the same directed lane */
		function claimingChains(): void {
			store.setChainResult("c1", {
				flows: [
					{
						ownerPlanUuid: "b",
						sourcePlanUuid: "a",
						ticker: "ORE",
						fromStop: "OT-580b",
						toStop: "XK-745c",
						unitsPerDay: 30,
						costPerUnit: 1,
					},
					{
						// another lane entirely, never claimed here
						ownerPlanUuid: "b",
						sourcePlanUuid: "a",
						ticker: "ORE",
						fromStop: "XK-745c",
						toStop: "OT-580b",
						unitsPerDay: 500,
						costPerUnit: 1,
					},
				],
			} as unknown as IRaukkChainResult);

			store.setChainResult("c2", {
				chainId: "c2",
				flows: [
					{
						// frozen before ownership was carried: counts for
						// every plan on the lane
						ticker: "ORE",
						fromStop: "OT-580b",
						toStop: "XK-745c",
						unitsPerDay: 5,
						costPerUnit: 1,
					},
					{
						ownerPlanUuid: "other",
						sourcePlanUuid: "a",
						ticker: "ORE",
						fromStop: "OT-580b",
						toStop: "XK-745c",
						unitsPerDay: 900,
						costPerUnit: 1,
					},
				],
			} as unknown as IRaukkChainResult);
		}

		it("sums the flows of one lane, owner and source filtered", () => {
			claimingChains();

			expect(
				store.chainClaimedUnitsOn("b", "a", "OT-580b", "XK-745c")
			).toStrictEqual({ ORE: 35 });
		});

		it("claims nothing on a lane no flow runs on", () => {
			claimingChains();

			expect(
				store.chainClaimedUnitsOn("b", "a", "OT-580b", "ZV-307c")
			).toStrictEqual({});
		});

		it("follows a chain result that changed", () => {
			claimingChains();
			store.chainClaimedUnitsOn("b", "a", "OT-580b", "XK-745c");

			store.setChainResult("c2", {
				chainId: "c2",
				flows: [],
			} as unknown as IRaukkChainResult);

			expect(
				store.chainClaimedUnitsOn("b", "a", "OT-580b", "XK-745c")
			).toStrictEqual({ ORE: 30 });
		});
	});

	describe("shipDemandPerDay", () => {
		it("sums stored fuel burn and repairs of the own fleet", () => {
			const snapshot: IRaukkSnapshot = {
				...makeSnapshot("A", { ORE: 100 }),
				fuelUnitsPerDay: { FF: 2, SF: 1 },
			};

			store.setSnapshot("a", snapshot);
			assignOnly("a");

			expect(store.shipDemandPerDay()).toMatchObject({ FF: 2, SF: 1 });
		});

		it("drops a plan no empire holds any more", () => {
			store.setSnapshot("assigned", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("dropped", {
				...makeSnapshot("Dropped", { MET: 10 }),
				fuelUnitsPerDay: { FF: 7 },
			});
			assignOnly("assigned");

			expect(store.shipDemandPerDay()).toStrictEqual({});
		});

		it("hands out a fresh copy per call", () => {
			store.setSnapshot("a", {
				...makeSnapshot("A", { ORE: 100 }),
				fuelUnitsPerDay: { FF: 2 },
			});
			assignOnly("a");

			const first = store.shipDemandPerDay();
			first.FF = 999;

			expect(store.shipDemandPerDay().FF).toBe(2);
		});
	});

	describe("deletePlanData", () => {
		it("removes data and marks dependents stale", () => {
			store.setTickerSource("a", "DW", {
				mode: "market",
				priceMode: "BID",
			});
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
			);
			store.setSnapshot(
				"c",
				makeSnapshot("C", { ALO: 20 }, { b: { MET: 10 } })
			);

			store.deletePlanData("a");

			expect(store.configs.a).toBeUndefined();
			expect(store.snapshots.a).toBeUndefined();
			expect(store.snapshots.b.stale).toBe(true);
			expect(store.snapshots.c.stale).toBe(true);
		});

		it("marks the plans it drew FROM stale as well", () => {
			// "a" produces, "b" draws from it: deleting the consumer takes
			// the draw away, and the producers exchange lane carried it
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot(
				"b",
				makeSnapshot("B", { MET: 50 }, { a: { ORE: 40 } })
			);

			store.deletePlanData("b");

			// a producer does not DEPEND on its consumer, so nothing else
			// would ever stale it and its frozen lanes would keep flying
			// the 40 ORE a day for a base that no longer exists
			expect(store.snapshots.a.stale).toBe(true);
		});

		it("scrubs the shipping keys of the deleted plan", () => {
			store.setShippingConfig({
				enabled: true,
				lmRates: {
					"a>CX": 100,
					"b>a": 200,
					"b>CX": 300,
					"c>b": 400,
				},
				perEdgeProfile: {
					"a>CX": "2000x2000-standard",
					"c>a": "5000x5000-standard",
					"c>b": "1000x1000-standard",
				},
			});

			store.deletePlanData("a");

			// both key shapes go: the plans own exchange pair and every
			// sourcing pair naming it as the source
			expect(store.shippingConfig.lmRates).toStrictEqual({
				"b>CX": 300,
				"c>b": 400,
			});
			expect(store.shippingConfig.perEdgeProfile).toStrictEqual({
				"c>b": "1000x1000-standard",
			});
		});

		it("leaves an absent lm rate map absent", () => {
			store.deletePlanData("a");

			expect(store.shippingConfig.lmRates).toBeUndefined();
			expect(store.shippingConfig.perEdgeProfile).toBeUndefined();
		});
	});

	describe("export and import", () => {
		it("round trips the state", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setTickerSource("a", "DW", {
				mode: "market",
				priceMode: "AVG7D",
			});
			store.setRepairDay("a", 60);

			const exported: string = store.exportJSON();
			const parsed = JSON.parse(exported);
			expect(parsed.version).toBe(1);

			const before = JSON.parse(JSON.stringify(store.configs));
			const snapshotsBefore = JSON.parse(JSON.stringify(store.snapshots));

			store.$reset();
			expect(Object.keys(store.configs).length).toBe(0);
			expect(Object.keys(store.snapshots).length).toBe(0);

			store.importJSON(exported);

			expect(JSON.parse(JSON.stringify(store.configs))).toStrictEqual(
				before
			);
			expect(JSON.parse(JSON.stringify(store.snapshots))).toStrictEqual(
				snapshotsBefore
			);
		});

		it("round trips the local market slice", () => {
			store.setLocalSale("a", "ALO", { basis: "BID", value: 2.5 });
			store.setTickerSource("a", "DW", {
				mode: "local",
				price: { basis: "MANUAL", value: 90 },
			});

			const exported: string = store.exportJSON();
			const before = JSON.parse(JSON.stringify(store.configs));

			store.$reset();
			store.importJSON(exported);

			expect(JSON.parse(JSON.stringify(store.configs))).toStrictEqual(
				before
			);
			expect(store.configs.a.localSales).toStrictEqual({
				ALO: { basis: "BID", value: 2.5 },
			});
			expect(store.configs.a.sources.DW).toStrictEqual({
				mode: "local",
				price: { basis: "MANUAL", value: 90 },
			});
		});

		it("round trips the account wide bucket defaults", () => {
			store.setSourcingDefault("workforce", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG_MKT",
			});
			store.setSnapshot("a", {
				...makeSnapshot("A", { ORE: 100 }),
				inputBuckets: { RAT: ["workforce"] },
			});

			const exported: string = store.exportJSON();

			store.$reset();
			expect(store.sourcingDefaults).toStrictEqual({});

			store.importJSON(exported);

			expect(store.sourcingDefaults).toStrictEqual({
				workforce: { mode: "plan", sourcePlanUuid: "AGG_AVG_MKT" },
			});
			expect(store.snapshots.a.inputBuckets).toStrictEqual({
				RAT: ["workforce"],
			});
		});

		it("round trips the account wide ship sourcing", () => {
			store.setShipSourcingDefault("fuel", {
				mode: "plan",
				sourcePlanUuid: "AGG_AVG",
			});
			store.setShipTickerSource("SSC", {
				mode: "market",
				priceMode: "ASK",
			});

			const exported: string = store.exportJSON();

			store.$reset();
			expect(store.shipSourcing).toStrictEqual({
				defaults: {},
				sources: {},
			});

			store.importJSON(exported);

			expect(store.shipSourcing).toStrictEqual({
				defaults: { fuel: { mode: "plan", sourcePlanUuid: "AGG_AVG" } },
				sources: { SSC: { mode: "market", priceMode: "ASK" } },
			});
		});

		it("imports a payload predating the ship sourcing", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 90, sources: {} } },
					snapshots: {},
				})
			);

			expect(store.shipSourcing).toStrictEqual({
				defaults: {},
				sources: {},
			});
		});

		it("imports a payload predating the bucket defaults", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 90, sources: {} } },
					snapshots: {},
				})
			);

			expect(store.sourcingDefaults).toStrictEqual({});
		});

		it("imports a payload predating the local market model", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {
						a: {
							repairDay: 90,
							sources: {
								DW: { mode: "market", priceMode: "BID" },
								ORE: { mode: "plan", sourcePlanUuid: "b" },
							},
						},
					},
					snapshots: {},
				})
			);

			expect(store.configs.a.localSales).toBeUndefined();
			expect(store.configs.a.sources).toStrictEqual({
				DW: { mode: "market", priceMode: "BID" },
				ORE: { mode: "plan", sourcePlanUuid: "b" },
			});
		});

		it("defaults the cadence fields of a pre cadence payload", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 90, sources: {} } },
					snapshots: {},
					shippingConfig: {
						enabled: true,
						defaultProfileId: "1000x1000-standard",
						routingMode: "direct",
						sameSystemFlatCost: 0,
					},
				})
			);

			expect(store.shippingConfig.cadenceInOutDays).toBe(14);
			expect(store.shippingConfig.cadenceWorkforceDays).toBe(30);
			expect(store.configs.a.cadence).toBeUndefined();
		});

		it("keeps the per plan cadence overrides of a payload", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {
						a: {
							repairDay: 90,
							sources: {},
							cadence: { production: 365 },
						},
					},
					snapshots: {},
				})
			);

			expect(store.configs.a.cadence).toStrictEqual({ production: 365 });
		});

		it("refuses a non positive cadence override", () => {
			expect(() =>
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: {
							a: {
								repairDay: 90,
								sources: {},
								cadence: { production: 0 },
							},
						},
						snapshots: {},
					})
				)
			).toThrowError();
		});

		it("throws on non-JSON input", () => {
			expect(() => store.importJSON("{ nope")).toThrowError();
		});

		it("throws on schema violations", () => {
			expect(() =>
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: { a: { repairDay: 45, sources: {} } },
						snapshots: {},
					})
				)
			).toThrowError();

			expect(() =>
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: {},
						snapshots: { a: { computedAt: "now" } },
					})
				)
			).toThrowError();

			expect(() => store.importJSON(JSON.stringify([]))).toThrowError();
		});

		it("leaves state untouched on invalid input", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

			expect(() => store.importJSON("nope")).toThrowError();
			expect(store.snapshots.a).toBeDefined();
		});

		it("accepts a payload without version", () => {
			store.importJSON(
				JSON.stringify({
					configs: { a: { repairDay: 30, sources: {} } },
					snapshots: {},
				})
			);

			expect(store.getConfig("a").repairDay).toBe(30);
		});

		it("imports a v1 payload that predates shipping", () => {
			store.setShippingConfig({ enabled: true, routingMode: "cx-hub" });
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 999,
			});

			// exactly what the shipped v1 exportJSON produced
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 30, sources: {} } },
					snapshots: { a: makeSnapshot("A", { ORE: 100 }) },
				})
			);

			expect(store.getConfig("a").repairDay).toBe(30);
			expect(store.snapshots.a.outputs.ORE.unitsPerDay).toBe(100);
			// the defaults, not the previous state
			expect(store.shippingConfig).toStrictEqual(
				raukkDefaultShippingConfig()
			);
			expect(store.shipProfiles).toStrictEqual({});
			expect(
				store.getShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID)
					.costPerParsec
			).toBeNull();
		});

		it("round trips the shipping slice", () => {
			store.setShippingConfig({
				enabled: true,
				routingMode: "cx-hub",
				sameSystemFlatCost: 25,
				perEdgeProfile: { "a>b": "2000x2000-standard" },
				lmRates: { "a>CX": 1500 },
			});
			store.setShipProfile("2000x2000-standard", {
				costPerParsec: 42,
				shipsAvailable: 3,
			});

			const exported: string = store.exportJSON();
			const before = JSON.parse(JSON.stringify(store.shippingConfig));
			const profilesBefore = JSON.parse(
				JSON.stringify(store.shipProfiles)
			);

			store.$reset();
			expect(store.shippingConfig).toStrictEqual(
				raukkDefaultShippingConfig()
			);

			store.importJSON(exported);

			expect(
				JSON.parse(JSON.stringify(store.shippingConfig))
			).toStrictEqual(before);
			expect(
				JSON.parse(JSON.stringify(store.shipProfiles))
			).toStrictEqual(profilesBefore);
			expect(
				store.getShipProfile("2000x2000-standard").shipsAvailable
			).toBe(3);
		});

		it("keeps a profile exported before the fuel burn rates existed", () => {
			const preset = store.getShipProfile("2000x2000-standard");

			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {},
					snapshots: {},
					shipProfiles: {
						"2000x2000-standard": {
							id: "2000x2000-standard",
							name: preset.name,
							cargoWeight: 2000,
							cargoVolume: 2000,
							ftlReactor: "standard",
							// the v1 shape: ȼ present as a plain zero, no
							// fuel burn rates at all
							costPerParsec: 0,
							stlBlockCost: 0,
							minutesPerParsec: 27.5,
							stlBlockMinutesEmpty: 70,
							stlBlockMinutesLoaded: 420,
							chargeMinutes: 1,
							damagePerParsec: 0.0002,
							damagePerStlBlock: 0,
							shipsAvailable: 2,
						},
					},
				})
			);

			const imported = store.getShipProfile("2000x2000-standard");

			// a stored zero stays a manual zero, it is not guessed into
			// "derive"; the missing burn rates come from the preset
			expect(imported.costPerParsec).toBe(0);
			expect(imported.stlBlockCost).toBe(0);
			expect(imported.ftlFuelPerParsec).toBe(preset.ftlFuelPerParsec);
			expect(imported.stlFuelPerBlock).toBe(preset.stlFuelPerBlock);
			expect(imported.shipsAvailable).toBe(2);
			// a payload written before STL-only hulls existed is an FTL
			// ship, and the schema default has to say so
			expect(imported.stlOnly).toBe(false);
		});

		it("keeps a stored STL-only flag", () => {
			const preset = JSON.parse(
				JSON.stringify(store.getShipProfile("2000x2000-standard"))
			);

			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {},
					snapshots: {},
					shipProfiles: {
						"2000x2000-standard": { ...preset, stlOnly: true },
					},
				})
			);

			expect(store.getShipProfile("2000x2000-standard").stlOnly).toBe(
				true
			);
		});

		it("imports an absent ȼ constant as derive", () => {
			const preset = store.getShipProfile("2000x2000-standard");

			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {},
					snapshots: {},
					shipProfiles: {
						"2000x2000-standard": {
							...JSON.parse(JSON.stringify(preset)),
							costPerParsec: undefined,
							stlBlockCost: undefined,
							shipsAvailable: 4,
						},
					},
				})
			);

			expect(
				store.getShipProfile("2000x2000-standard").costPerParsec
			).toBeNull();
			expect(
				store.getShipProfile("2000x2000-standard").stlBlockCost
			).toBeNull();
		});

		it("rejects a profile with zero capacity or no ship", () => {
			const preset = JSON.parse(
				JSON.stringify(store.getShipProfile("2000x2000-standard"))
			);

			function importProfile(patch: Record<string, unknown>): void {
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: {},
						snapshots: {},
						shipProfiles: {
							"2000x2000-standard": { ...preset, ...patch },
						},
					})
				);
			}

			// a hand edited zero capacity used to import fine and then
			// produce FREE freight: no cargo ever fills a hull of size 0
			expect(() => importProfile({ cargoWeight: 0 })).toThrowError();
			expect(() => importProfile({ cargoVolume: 0 })).toThrowError();
			expect(() => importProfile({ shipsAvailable: 0 })).toThrowError();
			expect(() => importProfile({ shipsAvailable: 1.5 })).toThrowError();
			expect(() => importProfile({ shipsAvailable: 2 })).not.toThrow();
		});

		it("rejects a broken shipping configuration", () => {
			expect(() =>
				store.importJSON(
					JSON.stringify({
						version: 1,
						configs: {},
						snapshots: {},
						shippingConfig: { routingMode: "teleport" },
					})
				)
			).toThrowError();
		});
	});

	describe("ship profiles", () => {
		it("returns the preset of an untouched profile", () => {
			const preset = store.getShipProfile("5000x5000-quick-charge");

			expect(preset.cargoWeight).toBe(5000);
			expect(preset.ftlReactor).toBe("quick-charge");
			expect(store.shipProfiles).toStrictEqual({});
		});

		it("falls back to the default profile for an unknown id", () => {
			expect(store.getShipProfile("nope").id).toBe(
				RAUKK_DEFAULT_SHIP_PROFILE_ID
			);
		});

		it("returns a detached copy", () => {
			const profile = store.getShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID);
			profile.costPerParsec = 123;

			expect(
				store.getShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID)
					.costPerParsec
			).toBeNull();
		});

		it("stores an override and keeps the id", () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
				id: "hijacked",
			});

			expect(
				store.getShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID)
			).toMatchObject({
				id: RAUKK_DEFAULT_SHIP_PROFILE_ID,
				costPerParsec: 12,
			});
		});

		it("resets an override back to the preset", () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
			});
			store.resetShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID);

			expect(store.shipProfiles).toStrictEqual({});
			expect(
				store.getShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID)
					.costPerParsec
			).toBeNull();
		});

		it("lists every preset with the overrides applied", () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
			});

			const list = store.listShipProfiles();

			// six hulls, two reactors each plus the STL-only build
			expect(list.length).toBe(18);
			expect(
				list.find(
					(profile) => profile.id === RAUKK_DEFAULT_SHIP_PROFILE_ID
				)?.costPerParsec
			).toBe(12);
		});
	});

	describe("empire assignment", () => {
		it("stales nothing on the first assignment it sees", async () => {
			assignOnly("a");
			await nextTick();

			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));

			// the page load: the stored snapshots were computed under this
			// very set, staling them would recompute the account on boot
			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(false);
		});

		it("stales the whole store when the assignment changes", async () => {
			assignOnly("a");
			await nextTick();

			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));

			// the user edits the management screen: which plans the
			// account operates decides what every OTHER plan may see, in
			// both directions, so no dependency edge can carry it
			assignOnly("b");
			await nextTick();

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});
	});

	describe("markAllStale", () => {
		beforeEach(() => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));
		});

		it("flags every stored snapshot", () => {
			store.markAllStale();

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("stays quiet while shipping is off and stays off", () => {
			store.setShippingConfig({ enabled: false });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));

			store.setShippingConfig({ sameSystemFlatCost: 100 });

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(false);
		});

		it("marks all stale when shipping is switched on", () => {
			store.setShippingConfig({ enabled: false });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));

			store.setShippingConfig({ enabled: true });

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("marks all stale when shipping is switched off again", () => {
			store.setShippingConfig({ enabled: true });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));

			store.setShippingConfig({ enabled: false });

			expect(store.snapshots.a.stale).toBe(true);
			expect(store.snapshots.b.stale).toBe(true);
		});

		it("marks all stale on any change while shipping is on", () => {
			store.setShippingConfig({ enabled: true });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

			store.setShippingConfig({ routingMode: "cx-hub" });
			expect(store.snapshots.a.stale).toBe(true);
		});

		it("marks all stale on a profile change while shipping is on", () => {
			store.setShippingConfig({ enabled: true });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 5,
			});
			expect(store.snapshots.a.stale).toBe(true);
		});

		it("leaves snapshots alone on a profile change while off", () => {
			store.setShippingConfig({ enabled: false });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 5,
			});
			store.resetShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID);

			expect(store.snapshots.a.stale).toBe(false);
		});

		it("ignores resetting a profile that has no override", () => {
			store.setShippingConfig({ enabled: true });
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));

			store.resetShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID);
			expect(store.snapshots.a.stale).toBe(false);
		});

		it("accepts snapshots carrying frozen input and sell prices", () => {
			const snapshot: IRaukkSnapshot = {
				...makeSnapshot("A", { ORE: 100 }),
				inputPrices: { FUEL: 12.5 },
				sellPrices: { ORE: 55 },
			};

			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: {},
					snapshots: { a: snapshot },
				})
			);

			expect(store.getSnapshot("a")?.inputPrices).toStrictEqual({
				FUEL: 12.5,
			});
			expect(store.getSnapshot("a")?.sellPrices).toStrictEqual({
				ORE: 55,
			});
		});
	});

	describe("$reset", () => {
		it("clears all state", () => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setRepairDay("a", 120);

			store.$reset();

			expect(store.configs).toStrictEqual({});
			expect(store.snapshots).toStrictEqual({});
		});

		it("clears the shipping slice", () => {
			store.setShippingConfig({ enabled: true });
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 7,
			});

			store.$reset();

			expect(store.shipProfiles).toStrictEqual({});
			expect(store.shippingConfig).toStrictEqual(
				raukkDefaultShippingConfig()
			);
		});
	});

	describe("chain input notification", () => {
		/** One flow of a snapshot, the account level chain step reads these */
		function flow(unitsPerDay: number): IRaukkChainFlow {
			return {
				flowId: "a#0",
				ownerPlanUuid: "a",
				ticker: "ORE",
				fromStop: "OT-580b",
				toStop: "AI1",
				unitsPerDay,
				weightPerUnit: 1,
				volumePerUnit: 1,
			};
		}

		function withFlows(
			snapshot: IRaukkSnapshot,
			flows: IRaukkChainFlow[]
		): IRaukkSnapshot {
			return { ...snapshot, flows };
		}

		it("stays functional with nothing registered", () => {
			expect(() =>
				store.setChain({ chainId: "c1", stops: ["OT-580b", "AI1"] })
			).not.toThrow();
		});

		it("notifies the registered listener and stops on unregister", () => {
			const listener = vi.fn();
			const unregister = store.onChainInputsChanged(listener);

			store.setChain({ chainId: "c1", stops: ["OT-580b", "AI1"] });
			expect(listener).toHaveBeenCalledTimes(1);

			unregister();
			store.deleteChain("c1");
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("notifies every chain relevant mutation", () => {
			const listener = vi.fn();
			store.onChainInputsChanged(listener);

			const calls: [string, () => void][] = [
				[
					"setChain",
					() =>
						store.setChain({
							chainId: "c1",
							stops: ["OT-580b", "AI1"],
						}),
				],
				[
					"setChainConfig",
					() => store.setChainConfig({ autoCxSplit: true }),
				],
				["setDepot", () => store.setDepot("ZV-307c")],
				["deleteDepot", () => store.deleteDepot("ZV-307c")],
				[
					"setAssignment",
					() => store.setAssignment("chain:c1", "SHP_1"),
				],
				[
					"setShipProfile",
					() =>
						store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
							costPerParsec: 3,
						}),
				],
				[
					"resetShipProfile",
					() => store.resetShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID),
				],
				[
					"setShipSourcingDefault",
					() =>
						store.setShipSourcingDefault("fuel", {
							mode: "market",
							priceMode: "BID",
						}),
				],
				[
					"setShipTickerSource",
					() =>
						store.setShipTickerSource("FF", {
							mode: "market",
							priceMode: "ASK",
						}),
				],
				[
					"setShippingConfig",
					() => store.setShippingConfig({ enabled: true }),
				],
				["deleteChain", () => store.deleteChain("c1")],
			];

			calls.forEach(([name, mutate], index) => {
				mutate();

				expect(
					listener,
					`${name} did not notify`
				).toHaveBeenCalledTimes(index + 1);
			});
		});

		it("stays quiet for knobs no chain is costed from", () => {
			store.setDepot("ZV-307c");

			const listener = vi.fn();
			store.onChainInputsChanged(listener);

			// a rent patch of a KNOWN depot moves no anchor
			store.setDepot("ZV-307c", { weeklyCostAic: 5000 });
			// a lane pair assignment flies one plans own lane
			store.setAssignment("a>CX", "SHP_1");
			store.setFleetSpillover(false);

			expect(listener).not.toHaveBeenCalled();
		});

		it("notifies a snapshot write only when its flows moved", () => {
			const listener = vi.fn();
			store.onChainInputsChanged(listener);

			const base: IRaukkSnapshot = makeSnapshot("A", { ORE: 100 });

			// first write of a plan: nothing to compare against
			store.setSnapshot("a", withFlows(base, [flow(10)]));
			expect(listener).toHaveBeenCalledTimes(1);

			// same cargo, recomputed: the chains have nothing to re-cost
			store.setSnapshot("a", withFlows(base, [flow(10)]));
			expect(listener).toHaveBeenCalledTimes(1);

			store.setSnapshot("a", withFlows(base, [flow(12)]));
			expect(listener).toHaveBeenCalledTimes(2);

			// losing the field is a change of its own
			store.setSnapshot("a", base);
			expect(listener).toHaveBeenCalledTimes(3);
		});

		it("survives a listener that throws", () => {
			const warn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => undefined);

			store.onChainInputsChanged(() => {
				throw new Error("listener blew up");
			});
			const second = vi.fn();
			store.onChainInputsChanged(second);

			expect(() =>
				store.setChainConfig({ autoCxSplit: true })
			).not.toThrow();
			expect(second).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalled();

			warn.mockRestore();
		});
	});

	describe("RaukkLocalPriceSchema", () => {
		it("accepts a manual price and a signed market offset", () => {
			expect(
				RaukkLocalPriceSchema.parse({ basis: "MANUAL", value: 175 })
			).toStrictEqual({ basis: "MANUAL", value: 175 });

			// asking above the market is a signed offset, not an error
			expect(
				RaukkLocalPriceSchema.parse({ basis: "ASK", value: -10 })
			).toStrictEqual({ basis: "ASK", value: -10 });
		});

		it("rejects a non finite value", () => {
			expect(() =>
				RaukkLocalPriceSchema.parse({ basis: "BID", value: NaN })
			).toThrow();

			expect(() =>
				RaukkLocalPriceSchema.parse({ basis: "BID", value: Infinity })
			).toThrow();
		});

		it("rejects an unknown basis", () => {
			expect(() =>
				RaukkLocalPriceSchema.parse({ basis: "AVG90D", value: 0 })
			).toThrow();
		});
	});
});
