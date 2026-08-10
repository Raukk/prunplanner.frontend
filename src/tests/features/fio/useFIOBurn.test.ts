import { ref } from "vue";
import { beforeAll, describe, expect, it } from "vitest";

// Stores
import { usePlanningStore } from "@/stores/planningStore";
import { createPinia, setActivePinia } from "pinia";

import { useFIOBurn } from "@/features/fio/useFIOBurn";

const plan_A = {
	uuid: "A",
	plan_name: "test plan A",
	planet_natural_id: "A",
};
const plan_B = {
	uuid: "B",
	planet_natural_id: "B",
};

const result_A = {
	materialio: [
		{
			ticker: "Foo",
			input: 2,
			output: 1,
			delta: -1,
		},
		{
			ticker: "Moo",
			input: 5,
			output: 0,
			delta: -5,
		},
	],
};

const result_B = {
	materialio: [],
};

const fakePlans = [plan_A, plan_B];
const fakeData = {
	A: result_A,
	B: result_B,
};

describe("useFIOBurn", async () => {
	let planningStore: ReturnType<typeof usePlanningStore>;

	beforeAll(() => {
		setActivePinia(createPinia());
		planningStore = usePlanningStore();

		// @ts-expect-error mock data
		planningStore.fio_storage_planets["A"] = {
			StorageItems: [
				{
					MaterialTicker: "Foo",
					MaterialAmount: 2,
				},
				{
					MaterialTicker: "Moo",
					MaterialAmount: 100,
				},
			],
		};
	});

	it("planRecord", async () => {
		// @ts-expect-error mock data
		const { planRecord } = useFIOBurn(ref(fakePlans), ref(fakeData));

		expect(Object.keys(planRecord.value).length).toBe(2);
		expect(planRecord.value["A"]).toStrictEqual(plan_A);
		expect(planRecord.value["B"]).toStrictEqual(plan_B);
	});

	it("burnTable", async () => {
		// @ts-expect-error mock data
		const { burnTable } = useFIOBurn(ref(fakePlans), ref(fakeData));

		const result = burnTable.value;

		expect(result.length).toBe(2);
		expect(result[0]).toStrictEqual({
			burnMaterials: [],
			hasStorage: false,
			key: "B",
			minDays: 0,
			planName: "Unnamed",
			planUuid: "B",
			planetId: "B",
		});
		expect(result[1]).toStrictEqual({
			burnMaterials: [
				{
					delta: -1,
					exhaustion: 2,
					input: 2,
					output: 1,
					stock: 2,
					ticker: "Foo",
				},
				{
					delta: -5,
					exhaustion: 20,
					input: 5,
					output: 0,
					stock: 100,
					ticker: "Moo",
				},
			],
			hasStorage: true,
			key: "A",
			minDays: 2,
			planName: "test plan A",
			planUuid: "A",
			planetId: "A",
		});
	});

	it("burnTable: shared planet stock over multiple plans", async () => {
		const plan_C = {
			uuid: "C",
			plan_name: "test plan C",
			planet_natural_id: "C",
		};
		const plan_D = {
			uuid: "D",
			plan_name: "test plan D",
			planet_natural_id: "C",
		};

		// @ts-expect-error mock data
		planningStore.fio_storage_planets["C"] = {
			StorageItems: [
				{ MaterialTicker: "Foo", MaterialAmount: 100 },
				{ MaterialTicker: "Bar", MaterialAmount: 50 },
			],
		};

		const sitePlans = [plan_C, plan_D];
		const siteData = {
			C: {
				materialio: [
					{ ticker: "Foo", input: 5, output: 0, delta: -5 },
					{ ticker: "Bar", input: 10, output: 0, delta: -10 },
				],
			},
			D: {
				materialio: [
					{ ticker: "Foo", input: 15, output: 0, delta: -15 },
				],
			},
		};

		// @ts-expect-error mock data
		const { burnTable } = useFIOBurn(ref(sitePlans), ref(siteData));

		const result = burnTable.value;
		expect(result.length).toBe(2);

		const rowC = result.find((r) => r.planUuid === "C")!;
		const rowD = result.find((r) => r.planUuid === "D")!;

		// Foo: shared pool, 100 stock over 20 daily need => 5 days both
		const fooC = rowC.burnMaterials.find((m) => m.ticker === "Foo")!;
		const fooD = rowD.burnMaterials.find((m) => m.ticker === "Foo")!;
		expect(fooC.exhaustion).toBe(5);
		expect(fooD.exhaustion).toBe(5);
		// stock attributed by share of the planets need
		expect(fooC.stock).toBe(25);
		expect(fooD.stock).toBe(75);

		// Bar: only consumed by plan C, full pool applies
		const barC = rowC.burnMaterials.find((m) => m.ticker === "Bar")!;
		expect(barC.stock).toBe(50);
		expect(barC.exhaustion).toBe(5);

		expect(rowC.minDays).toBe(5);
		expect(rowD.minDays).toBe(5);
	});

	it("burnTable: multiple plans, planet without storage", async () => {
		const plan_E = {
			uuid: "E",
			plan_name: "test plan E",
			planet_natural_id: "NOSTORAGE",
		};
		const plan_F = {
			uuid: "F",
			plan_name: "test plan F",
			planet_natural_id: "NOSTORAGE",
		};

		const sitePlans = [plan_E, plan_F];
		const siteData = {
			E: {
				materialio: [{ ticker: "Foo", input: 5, output: 0, delta: -5 }],
			},
			F: {
				materialio: [{ ticker: "Foo", input: 5, output: 0, delta: -5 }],
			},
		};

		// @ts-expect-error mock data
		const { burnTable } = useFIOBurn(ref(sitePlans), ref(siteData));

		burnTable.value.forEach((row) => {
			expect(row.hasStorage).toBe(false);
			expect(row.burnMaterials[0].stock).toBe(0);
			expect(row.burnMaterials[0].exhaustion).toBe(0);
			expect(row.minDays).toBe(0);
		});
	});

	it("burnTable: producing plan keeps full stock and infinite burn", async () => {
		const plan_G = {
			uuid: "G",
			plan_name: "test plan G",
			planet_natural_id: "G",
		};
		const plan_H = {
			uuid: "H",
			plan_name: "test plan H",
			planet_natural_id: "G",
		};

		// @ts-expect-error mock data
		planningStore.fio_storage_planets["G"] = {
			StorageItems: [{ MaterialTicker: "Foo", MaterialAmount: 60 }],
		};

		const sitePlans = [plan_G, plan_H];
		const siteData = {
			G: {
				materialio: [{ ticker: "Foo", input: 0, output: 3, delta: 3 }],
			},
			H: {
				materialio: [{ ticker: "Foo", input: 6, output: 0, delta: -6 }],
			},
		};

		// @ts-expect-error mock data
		const { burnTable } = useFIOBurn(ref(sitePlans), ref(siteData));

		const rowG = burnTable.value.find((r) => r.planUuid === "G")!;
		const rowH = burnTable.value.find((r) => r.planUuid === "H")!;

		expect(rowG.burnMaterials[0].stock).toBe(60);
		expect(rowG.burnMaterials[0].exhaustion).toBe(Infinity);
		// only consumer, pool is not shared with the producing plan
		expect(rowH.burnMaterials[0].stock).toBe(60);
		expect(rowH.burnMaterials[0].exhaustion).toBe(10);
	});

	it("planTable", async () => {
		// @ts-expect-error mock data
		const { planTable } = useFIOBurn(ref(fakePlans), ref(fakeData));

		const result = planTable.value;

		expect(result[0]).toStrictEqual({
			minDays: 0,
			planName: "Unnamed",
			planUuid: "B",
			planetId: "B",
		});
	});
});
