import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	RAUKK_DEFAULT_SHIP_PROFILE_ID,
	raukkDefaultShippingConfig,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

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
	});

	describe("wouldCreateCycle", () => {
		beforeEach(() => {
			store.setSnapshot("a", makeSnapshot("A", { ORE: 100 }));
			store.setSnapshot("b", makeSnapshot("B", { MET: 50 }));
			store.setTickerSource("b", "ORE", {
				mode: "plan",
				sourcePlanUuid: "a",
			});
		});

		it("refuses an edge closing the loop", () => {
			expect(store.wouldCreateCycle("a", { sourcePlanUuid: "b" })).toBe(
				true
			);
		});

		it("allows an edge in dependency direction", () => {
			expect(store.wouldCreateCycle("b", { sourcePlanUuid: "a" })).toBe(
				false
			);
		});

		it("refuses self references", () => {
			expect(store.wouldCreateCycle("a", { sourcePlanUuid: "a" })).toBe(
				true
			);
		});

		it("refuses aggregates containing a downstream plan", () => {
			// a would source MET, produced by b, which draws from a
			expect(
				store.wouldCreateCycle("a", {
					aggregate: "AGG_AVG",
					ticker: "MET",
				})
			).toBe(true);
		});

		it("refuses aggregates containing the consumer itself", () => {
			expect(
				store.wouldCreateCycle("a", {
					aggregate: "AGG_MAX",
					ticker: "ORE",
				})
			).toBe(true);
		});

		it("allows aggregates of unrelated producers", () => {
			store.setSnapshot("c", makeSnapshot("C", { DW: 10 }));

			expect(
				store.wouldCreateCycle("a", {
					aggregate: "AGG_AVG",
					ticker: "DW",
				})
			).toBe(false);
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
			// the shipped-off defaults, not the previous state
			expect(store.shippingConfig).toStrictEqual(
				raukkDefaultShippingConfig()
			);
			expect(store.shipProfiles).toStrictEqual({});
			expect(
				store.getShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID)
					.costPerParsec
			).toBe(0);
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
			).toBe(0);
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
			).toBe(0);
		});

		it("lists every preset with the overrides applied", () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				costPerParsec: 12,
			});

			const list = store.listShipProfiles();

			expect(list.length).toBe(12);
			expect(
				list.find(
					(profile) => profile.id === RAUKK_DEFAULT_SHIP_PROFILE_ID
				)?.costPerParsec
			).toBe(12);
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
			store.setShippingConfig({ sameSystemFlatCost: 100 });

			expect(store.snapshots.a.stale).toBe(false);
			expect(store.snapshots.b.stale).toBe(false);
		});

		it("marks all stale when shipping is switched on", () => {
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
});
