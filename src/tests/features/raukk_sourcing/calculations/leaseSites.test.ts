import { describe, expect, it } from "vitest";

// Calculations
import {
	groupEmpireMaterialIOSites,
	groupMaterialIOSites,
} from "@/features/raukk_sourcing/calculations/leaseSites";

// Types & Interfaces
import {
	IEmpireMaterialIO,
	IEmpireMaterialIOPlanet,
} from "@/features/empire/empire.types";

function planet(
	planUuid: string,
	planName: string,
	values: { delta: number; input: number; output: number; price: number },
	planetId: string = "DEIMOS"
): IEmpireMaterialIOPlanet {
	return {
		planetId,
		planUuid,
		planName,
		planCOGC: "AGRICULTURE",
		...values,
	};
}

const host: IEmpireMaterialIOPlanet = planet("host", "Deimos", {
	delta: 10,
	input: 0,
	output: 10,
	price: 100,
});

const lease: IEmpireMaterialIOPlanet = planet("lease", "Deimos_Lease1", {
	delta: 5,
	input: 0,
	output: 5,
	price: 50,
});

const stranger: IEmpireMaterialIOPlanet = planet("stranger", "Deimos_Other", {
	delta: 2,
	input: 0,
	output: 2,
	price: 20,
});

/** `lease` leases at `host`, nothing else is linked */
const hostOf = (planUuid: string): string | undefined =>
	planUuid === "lease" ? "host" : undefined;

describe("groupMaterialIOSites", () => {
	it("folds a lease into its host", () => {
		const result = groupMaterialIOSites([host, lease], hostOf);

		expect(result).toHaveLength(1);
		expect(result[0].planUuid).toBe("host");
		expect(result[0].planName).toBe("Deimos");
		expect(result[0].planetId).toBe("DEIMOS");
		expect(result[0].baseCount).toBe(2);
		expect(result[0].planNames).toStrictEqual(["Deimos", "Deimos_Lease1"]);
		expect(result[0].delta).toBe(15);
		expect(result[0].output).toBe(15);
		expect(result[0].input).toBe(0);
		expect(result[0].price).toBe(150);
	});

	it("folds a lease listed before its host", () => {
		const result = groupMaterialIOSites([lease, host], hostOf);

		expect(result).toHaveLength(1);
		// the HOST leads its site, whatever the list order was
		expect(result[0].planUuid).toBe("host");
		expect(result[0].planNames).toStrictEqual(["Deimos", "Deimos_Lease1"]);
		expect(result[0].output).toBe(15);
	});

	it("leaves unlinked plans of one planet apart", () => {
		const result = groupMaterialIOSites([host, lease, stranger], hostOf);

		expect(result).toHaveLength(2);
		expect(result.map((site) => site.planUuid)).toStrictEqual([
			"host",
			"stranger",
		]);
		expect(result[1].baseCount).toBe(1);
		expect(result[1].output).toBe(2);
	});

	it("keeps a lease whose host contributes nothing", () => {
		const result = groupMaterialIOSites([lease], hostOf);

		expect(result).toHaveLength(1);
		expect(result[0].planUuid).toBe("lease");
		expect(result[0].baseCount).toBe(1);
		expect(result[0].output).toBe(5);
	});

	it("passes an unlinked list through unchanged", () => {
		const result = groupMaterialIOSites([host, stranger], () => undefined);

		expect(result.map((site) => site.planUuid)).toStrictEqual([
			"host",
			"stranger",
		]);
		expect(result.every((site) => site.baseCount === 1)).toBe(true);
	});

	it("groups nothing on an empty list", () => {
		expect(groupMaterialIOSites([], hostOf)).toStrictEqual([]);
	});
});

describe("groupEmpireMaterialIOSites", () => {
	const data: IEmpireMaterialIO[] = [
		{
			ticker: "RAT",
			input: 0,
			output: 15,
			delta: 15,
			deltaPrice: 150,
			inputPlanets: [],
			outputPlanets: [host, lease],
		},
		{
			ticker: "DW",
			input: 7,
			output: 0,
			delta: -7,
			deltaPrice: -70,
			inputPlanets: [stranger],
			outputPlanets: [],
		},
	];

	it("groups both contribution lists, totals untouched", () => {
		const result = groupEmpireMaterialIOSites(data, hostOf);

		expect(result).toHaveLength(2);
		expect(result[0].ticker).toBe("RAT");
		expect(result[0].delta).toBe(15);
		expect(result[0].deltaPrice).toBe(150);
		expect(result[0].outputPlanets).toHaveLength(1);
		expect(result[0].outputPlanets[0].baseCount).toBe(2);
		expect(result[0].inputPlanets).toStrictEqual([]);

		expect(result[1].inputPlanets).toHaveLength(1);
		expect(result[1].inputPlanets[0].baseCount).toBe(1);
	});

	it("leaves the source data alone", () => {
		groupEmpireMaterialIOSites(data, hostOf);

		expect(data[0].outputPlanets).toHaveLength(2);
	});
});
