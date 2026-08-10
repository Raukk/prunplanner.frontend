import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

// prices come from the exchange layer, which is mocked here: this
// exercises the snapshot pipeline, not the price loading
const mockGetPrice = vi.fn();
const mockGetExchangeTicker = vi.fn();

vi.mock("@/features/cx/usePrice", () => ({
	usePrice: async () => ({ getPrice: mockGetPrice }),
}));

vi.mock("@/database/services/useExchangeData", () => ({
	useExchangeData: async () => ({
		getExchangeTicker: mockGetExchangeTicker,
	}),
}));

// Composables
import { computePlanSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";
import { useRaukkTransport } from "@/features/raukk_sourcing/useRaukkTransport";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Graph
import {
	buildDependencyGraph,
	collectDependents,
	orderUpstreamFirst,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// Calculations
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IMaterialIO,
	IPlanResult,
	IProductionBuilding,
} from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkShipProfile,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";

/** The shared planet: host and lease dock at the very same site */
const SITE_PLANET: string = "ZV-759b";
/** Antares III, one jump away — the refinery selling ship fuel */
const REMOTE_PLANET: string = "ZV-194a";

/** Everything but the distance is free, so the numbers stay checkable */
const flatProfile: Partial<IRaukkShipProfile> = {
	cargoWeight: 1000,
	cargoVolume: 1000,
	costPerParsec: 10,
	stlBlockCost: 0,
	damagePerParsec: 0,
	damagePerStlBlock: 0,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	shipsAvailable: 1,
};

function mio(
	ticker: string,
	input: number,
	output: number,
	weight: number = 0,
	volume: number = 0
): IMaterialIO {
	return {
		ticker,
		input,
		output,
		delta: output - input,
		individualWeight: weight,
		individualVolume: volume,
		totalWeight: (output - input) * weight,
		totalVolume: (output - input) * volume,
		price: 0,
	};
}

/** One building running one recipe over the given material I/O */
function makePlanResult(
	recipeInputs: [string, number][],
	recipeOutputs: [string, number][],
	materialio: IMaterialIO[]
): IPlanResult {
	const buildings: IProductionBuilding[] = [
		{
			name: "EXT",
			amount: 1,
			totalBatchTime: TOTALMSDAY,
			workforceDailyCost: 0,
			constructionMaterials: [],
			activeRecipes: [
				{
					recipeId: "EXT#0",
					amount: 1,
					dailyShare: 1,
					time: TOTALMSDAY,
					cogm: undefined,
					recipe: {
						inputs: recipeInputs.map(([ticker, amount]) => ({
							material_ticker: ticker,
							material_amount: amount,
						})),
						outputs: recipeOutputs.map(([ticker, amount]) => ({
							material_ticker: ticker,
							material_amount: amount,
						})),
					},
				},
			],
		} as unknown as IProductionBuilding,
	];

	return {
		production: { buildings, materialio: [] },
		materialio,
		workforceMaterialIO: [],
		productionMaterialIO: materialio,
	} as unknown as IPlanResult;
}

/** 100 ORE a day in, 100 ALO a day out. 1 t and 3 t per unit. */
function oreToAlo(): IPlanResult {
	return makePlanResult(
		[["ORE", 100]],
		[["ALO", 100]],
		[mio("ALO", 0, 100, 3, 0), mio("ORE", 100, 0, 1, 0)]
	);
}

/** 100 ALO and 50 H2O a day in, 100 SSC a day out */
function aloToSsc(): IPlanResult {
	return makePlanResult(
		[
			["ALO", 100],
			["H2O", 50],
		],
		[["SSC", 100]],
		[
			mio("SSC", 0, 100, 2, 0),
			mio("ALO", 100, 0, 3, 0),
			mio("H2O", 50, 0, 1, 0),
		]
	);
}

function planContext(
	planUuid: string,
	planName: string,
	planResult: IPlanResult
) {
	return {
		planUuid,
		planName,
		planetNaturalId: SITE_PLANET,
		cxUuid: undefined,
		planResult,
	};
}

function hostContext(planResult: IPlanResult = oreToAlo()) {
	return planContext("host", "Deimos", planResult);
}

function leaseContext(planResult: IPlanResult = oreToAlo()) {
	return planContext("lease", "Deimos_Lease1", planResult);
}

/** Flows of one ticker, in the direction the plan states them */
function flowsOf(snapshot: IRaukkSnapshot, ticker: string): IRaukkChainFlow[] {
	return (snapshot.flows ?? []).filter((flow) => flow.ticker === ticker);
}

/** Daily units of one ticker over every flow of a snapshot */
function unitsOf(snapshot: IRaukkSnapshot, ticker: string): number {
	return flowsOf(snapshot, ticker).reduce(
		(sum, flow) => sum + flow.unitsPerDay,
		0
	);
}

/** Trips per day over every leg of a snapshots lanes */
function tripsOf(snapshot: IRaukkSnapshot): number {
	return (snapshot.lanes ?? []).reduce(
		(sum, lane) => sum + lane.tripsPerDay,
		0
	);
}

describe("Raukk Sourcing: Lease link and shipping delegation", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();

		mockGetPrice.mockReset();
		mockGetExchangeTicker.mockReset();

		mockGetPrice.mockImplementation(async (ticker: string) => {
			const prices: Record<string, number> = {
				ORE: 100,
				ALO: 200,
				SSC: 300,
				H2O: 10,
				FF: 50,
				SF: 5,
			};

			return prices[ticker] ?? 0;
		});
		mockGetExchangeTicker.mockRejectedValue(new Error("no exchange data"));

		store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, flatProfile);
	});

	/** Both plans computed once, standing on their own */
	async function computeBoth(
		lease: IPlanResult = oreToAlo()
	): Promise<{ host: IRaukkSnapshot; lease: IRaukkSnapshot }> {
		const host = await computePlanSnapshot(hostContext());
		const leased = await computePlanSnapshot(leaseContext(lease));

		return { host: host.snapshot, lease: leased.snapshot };
	}

	/** Stores the plans snapshot again, clearing its stale flag */
	function refresh(planUuid: string): void {
		store.setSnapshot(
			planUuid,
			store.getSnapshot(planUuid) as IRaukkSnapshot
		);
	}

	describe("link validation", () => {
		beforeEach(async () => {
			await computeBoth();
		});

		it("links two plans on one planet", () => {
			store.setLeaseHost("lease", "host");

			expect(store.configs.lease.leaseHostPlanUuid).toBe("host");
			expect(store.leasesOf("host")).toStrictEqual(["lease"]);
			// both sides move, so both go stale
			expect(store.snapshots.lease.stale).toBe(true);
			expect(store.snapshots.host.stale).toBe(true);
		});

		it("refuses a host on another planet", async () => {
			await computePlanSnapshot({
				planUuid: "remote",
				planName: "Remote",
				planetNaturalId: REMOTE_PLANET,
				cxUuid: undefined,
				planResult: oreToAlo(),
			});

			expect(() => store.setLeaseHost("lease", "remote")).toThrowError(
				/docking site/
			);
			expect(store.configs.lease?.leaseHostPlanUuid).toBeUndefined();
		});

		it("refuses a self link", () => {
			expect(() => store.setLeaseHost("lease", "lease")).toThrowError(
				/itself/
			);
		});

		it("refuses an unknown host", () => {
			expect(() => store.setLeaseHost("lease", "ghost")).toThrowError(
				/no snapshot/
			);
		});

		it("refuses a chain of leases", async () => {
			await computePlanSnapshot(
				planContext("second", "Deimos_Lease2", oreToAlo())
			);

			store.setLeaseHost("lease", "host");

			// the lease as a host of its own
			expect(() => store.setLeaseHost("second", "lease")).toThrowError(
				/never chained/
			);
			// and the host as a lease of a third plan
			expect(() => store.setLeaseHost("host", "second")).toThrowError(
				/never chained/
			);
		});

		it("clears the link again", () => {
			store.setLeaseHost("lease", "host");
			refresh("host");
			refresh("lease");

			store.clearLeaseHost("lease");

			expect(store.configs.lease.leaseHostPlanUuid).toBeUndefined();
			expect(store.leasesOf("host")).toStrictEqual([]);
			expect(store.snapshots.host.stale).toBe(true);
			expect(store.snapshots.lease.stale).toBe(true);
		});

		it("drops the link when the host plan is deleted", () => {
			store.setLeaseHost("lease", "host");

			store.deletePlanData("host");

			expect(store.configs.lease.leaseHostPlanUuid).toBeUndefined();
			expect(store.snapshots.lease.stale).toBe(true);
		});

		it("stales the host when the lease plan is deleted", () => {
			store.setLeaseHost("lease", "host");
			refresh("host");

			store.deletePlanData("lease");

			expect(store.leasesOf("host")).toStrictEqual([]);
			expect(store.snapshots.host.stale).toBe(true);
		});
	});

	describe("delegation", () => {
		it("leaves the lease without pairs, lanes or freight", async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");

			const { snapshot } = await computePlanSnapshot(leaseContext());

			expect(snapshot.flows).toStrictEqual([]);
			expect(snapshot.lanes).toStrictEqual([]);
			expect(snapshot.advisories).toStrictEqual([]);
			// no denominator rather than a reassuring zero
			expect(snapshot.shippingFraction).toBeNull();
			expect(snapshot.outputs.ALO.breakdown.shipping).toBe(0);
			// the freight free input price, exactly the bare market one
			expect(snapshot.inputPrices).toStrictEqual({ ORE: 100 });
		});

		it("freezes the residual cargo the host has to fly", async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");

			const { snapshot } = await computePlanSnapshot(leaseContext());

			expect(snapshot.leaseCargo).toStrictEqual({
				inbound: [
					{
						ticker: "ORE",
						bucket: "production",
						unitsPerDay: 100,
						weightPerUnit: 1,
						volumePerUnit: 0,
					},
				],
				outbound: [
					{
						ticker: "ALO",
						bucket: "production",
						unitsPerDay: 100,
						weightPerUnit: 3,
						volumePerUnit: 0,
					},
				],
			});
		});

		it("carries the combined cargo on the hosts own exchange pair", async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");
			await computePlanSnapshot(leaseContext());

			const { snapshot } = await computePlanSnapshot(hostContext());

			// the whole sites cargo, authored by the host: the lease and
			// its own rows state the same lane and are summed on it
			expect(unitsOf(snapshot, "ORE")).toBe(200);
			expect(unitsOf(snapshot, "ALO")).toBe(200);
			expect(
				(snapshot.flows ?? []).every(
					(flow) => flow.ownerPlanUuid === "host"
				)
			).toBe(true);
			// and exactly one exchange pair serves the whole site
			expect(
				new Set((snapshot.lanes ?? []).map((lane) => lane.pairKey)).size
			).toBe(1);
		});

		it("ships the summed tonnage of the two plans", async () => {
			const separate = await computeBoth();

			store.setLeaseHost("lease", "host");
			await computePlanSnapshot(leaseContext());

			const { snapshot } = await computePlanSnapshot(hostContext());

			// nothing is transferred between the two here, so the site
			// flies exactly what the two plans flew apart
			expect(tripsOf(snapshot)).toBeCloseTo(
				tripsOf(separate.host) + tripsOf(separate.lease),
				10
			);
			expect(snapshot.shippingFraction).toBeCloseTo(
				(separate.host.shippingFraction ?? 0) +
					(separate.lease.shippingFraction ?? 0),
				10
			);
		});

		it("keeps a between-base draw off every lane", async () => {
			await computeBoth(aloToSsc());

			// the lease buys its ALO from the host next door
			store.setTickerSource("lease", "ALO", {
				mode: "plan",
				sourcePlanUuid: "host",
			});
			store.setLeaseHost("lease", "host");

			const { snapshot: leased } = await computePlanSnapshot(
				leaseContext(aloToSsc())
			);

			// the drawn ALO rides nothing, the local transfer rule of
			// round 12 having taken it off the lane before delegation
			expect(
				leased.leaseCargo?.inbound.map((entry) => entry.ticker)
			).toStrictEqual(["H2O"]);
			expect(leased.draws.host?.ALO).toBe(100);

			const { snapshot: host } = await computePlanSnapshot(hostContext());

			// the hosts whole ALO output is drawn next door: nothing of it
			// leaves the planet, while the residual H2O of the lease does
			// join the hosts inbound market cargo
			expect(flowsOf(host, "ALO")).toStrictEqual([]);
			expect(flowsOf(host, "H2O")[0].unitsPerDay).toBe(50);
			expect(flowsOf(host, "ORE")[0].unitsPerDay).toBe(100);
		});

		it("books the burnt ship fuel on the host alone", async () => {
			store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, {
				...flatProfile,
				costPerParsec: null,
				stlBlockCost: null,
				ftlFuelPerParsec: 2,
				stlFuelPerBlock: 10,
			});

			store.setSnapshot("refinery", {
				computedAt: "2026-01-01T00:00:00.000Z",
				stale: false,
				planName: "Refinery",
				planetNaturalId: REMOTE_PLANET,
				outputs: {
					FF: {
						ticker: "FF",
						unitsPerDay: 1000,
						costPerUnit: 500,
						breakdown: {
							workforce: 0,
							repair: 0,
							inputs: 500,
							shipping: 0,
						},
					},
				},
				draws: {},
			});

			await computeBoth();
			store.setLeaseHost("lease", "host");

			// account wide: which producer the fleet fuels at is a fleet
			// question, not a per base one
			store.setShipTickerSource("FF", {
				mode: "plan",
				sourcePlanUuid: "refinery",
			});

			const { snapshot: leased } =
				await computePlanSnapshot(leaseContext());
			const { snapshot: host } = await computePlanSnapshot(hostContext());

			// the host flies the ships, so the host burns the fuel
			expect(leased.draws.refinery).toBeUndefined();
			expect(host.draws.refinery?.FF).toBeGreaterThan(0);
		});
	});

	describe("staleness and ordering", () => {
		it("stales the host when its lease is recomputed", async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");

			// host current again, the link change having flagged it
			await computePlanSnapshot(hostContext());
			expect(store.snapshots.host.stale).toBe(false);

			// the lease now ships 50 H2O more, which the host has to fly
			await computePlanSnapshot(leaseContext(aloToSsc()));

			expect(store.snapshots.host.stale).toBe(true);
		});

		it("names the host a dependent of its lease", async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");

			const graph = buildDependencyGraph(store.configs, store.snapshots);

			expect(collectDependents(graph, "lease")).toContain("host");
			// the empire pass orders along this very graph
			expect(orderUpstreamFirst(graph, ["host", "lease"])).toStrictEqual([
				"lease",
				"host",
			]);
		});
	});

	describe("schema", () => {
		it("round trips the lease link and the delegated cargo", async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");
			await computePlanSnapshot(leaseContext());

			const exported: string = store.exportJSON();
			const configs = JSON.parse(JSON.stringify(store.configs));
			const cargo = JSON.parse(
				JSON.stringify(store.snapshots.lease.leaseCargo)
			);

			store.$reset();
			store.importJSON(exported);

			expect(JSON.parse(JSON.stringify(store.configs))).toStrictEqual(
				configs
			);
			expect(store.configs.lease.leaseHostPlanUuid).toBe("host");
			expect(
				JSON.parse(JSON.stringify(store.snapshots.lease.leaseCargo))
			).toStrictEqual(cargo);
		});

		it("imports a payload predating the lease link", () => {
			store.importJSON(
				JSON.stringify({
					version: 1,
					configs: { a: { repairDay: 90, sources: {} } },
					snapshots: {
						a: {
							computedAt: "2026-01-01T00:00:00.000Z",
							stale: false,
							planName: "A",
							planetNaturalId: SITE_PLANET,
							outputs: {},
							draws: {},
						},
					},
				})
			);

			expect(store.configs.a.leaseHostPlanUuid).toBeUndefined();
			expect(store.snapshots.a.leaseCargo).toBeUndefined();
			expect(store.leasesOf("a")).toStrictEqual([]);
		});
	});

	/*
	 * The lease link was written before depots, planned gates and the
	 * account wide fleet sourcing landed. A delegated lease is the one
	 * plan in the account that holds no lanes at all, so every rollup
	 * that walks lanes meets it as an edge case — these pin that it
	 * stays an empty contributor rather than a broken one.
	 */
	describe("against the rounds that landed after it", () => {
		beforeEach(async () => {
			await computeBoth();
			store.setLeaseHost("lease", "host");
		});

		it("burns no fuel of its own, the host flies the site", async () => {
			store.setShipTickerSource("FF", {
				mode: "plan",
				sourcePlanUuid: "refinery",
			});

			const { snapshot: leased } =
				await computePlanSnapshot(leaseContext());
			const { snapshot: host } = await computePlanSnapshot(hostContext());

			expect(leased.fuelUnitsPerDay ?? {}).toStrictEqual({});
			expect((host.fuelUnitsPerDay ?? {}).FF).toBeGreaterThan(0);
		});

		it("still delegates when a depot hands the site over", async () => {
			// a depot on the own planet is a free handover: the plan flies
			// nothing out of it, lease or no lease
			const lone = await computePlanSnapshot(hostContext());
			expect(tripsOf(lone.snapshot)).toBeGreaterThan(0);

			store.setDepot(SITE_PLANET, { weeklyCostAic: 700 });

			const { snapshot: leased } =
				await computePlanSnapshot(leaseContext());
			const { snapshot: host } = await computePlanSnapshot(hostContext());

			// the delegation still happens under the depot: the lease
			// freezes its cargo rather than quietly shipping again
			expect(leased.lanes ?? []).toStrictEqual([]);
			expect(leased.leaseCargo).toBeDefined();
			// and the host hands the whole site over, the leases included
			expect(tripsOf(host)).toBe(0);
			expect(host.leaseCargo).toBeUndefined();
		});

		it("contributes no lane to the account transport view", async () => {
			await computePlanSnapshot(leaseContext());
			await computePlanSnapshot(hostContext());

			const { rows } = useRaukkTransport(ref(0));

			expect(
				rows.value.some((row) => row.identity.planUuid === "lease")
			).toBe(false);
			expect(rows.value.length).toBeGreaterThan(0);
		});
	});
});
