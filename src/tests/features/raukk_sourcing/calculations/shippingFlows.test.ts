import { describe, it, expect } from "vitest";

// Calculations
import {
	buildPlanChainFlows,
	mergeClaimedShipping,
	raukkClaimedUnitsLookup,
	raukkFlowId,
	raukkPlanetCxCode,
} from "@/features/raukk_sourcing/calculations/shippingFlows";
import { buildShippingPairs } from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	raukkDefaultShippingConfig,
	raukkResolveShipProfile,
	raukkShipProfilePreset,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkFlowLookups,
	IRaukkClaimedFlowCost,
} from "@/features/raukk_sourcing/calculations/shippingFlows";
import {
	IRaukkPairLookups,
	IRaukkPairPlanFlows,
} from "@/features/raukk_sourcing/calculations/shippingPairs";
import {
	IRaukkResolvedShipProfile,
	IRaukkShippingConfig,
	IRaukkShippingResult,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Antares II, its exchange is AI1 on Antares I */
const OWN_PLANET: string = "ZV-759b";
/** Antares III, one jump away and not via the exchange */
const SOURCE_PLANET: string = "ZV-194a";

const config: IRaukkShippingConfig = {
	...raukkDefaultShippingConfig(),
	enabled: true,
};

const profile: IRaukkResolvedShipProfile = raukkResolveShipProfile(
	{
		...raukkShipProfilePreset(
			{ cargoWeight: 1000, cargoVolume: 1000 },
			"standard"
		),
		costPerParsec: 10,
		stlBlockCost: 0,
		damagePerParsec: 0,
		damagePerStlBlock: 0,
	},
	() => 0
);

function cargo(): IRaukkPairPlanFlows {
	return {
		planUuid: "own",
		planetNaturalId: OWN_PLANET,
		inputs: [
			{
				ticker: "ORE",
				unitsPerDay: 100,
				weightPerUnit: 1,
				volumePerUnit: 0,
			},
			{
				ticker: "DW",
				unitsPerDay: 20,
				weightPerUnit: 1,
				volumePerUnit: 0,
			},
		],
		outputs: [
			{
				ticker: "ALO",
				unitsPerDay: 60,
				weightPerUnit: 1,
				volumePerUnit: 0,
			},
		],
	};
}

/** ORE comes from the source plan, DW from the market, 10 ALO are drawn */
function lookups(
	claimedUnitsOf?: IRaukkPairLookups["claimedUnitsOf"]
): IRaukkPairLookups {
	return {
		originOf: (ticker: string) =>
			ticker === "ORE" ? [{ planUuid: "source", share: 1 }] : [],
		planetOf: (planUuid: string) =>
			planUuid === "source" ? SOURCE_PLANET : undefined,
		subscribedOf: (ticker: string) => (ticker === "ALO" ? 10 : 0),
		profileOf: () => profile,
		claimedUnitsOf,
	};
}

describe("Raukk Shipping: Plan flows", () => {
	describe("raukkPlanetCxCode", () => {
		it("names the nearest exchange by its code", () => {
			expect(raukkPlanetCxCode(OWN_PLANET)).toBe("AI1");
		});

		it("is undefined for an unknown planet", () => {
			expect(raukkPlanetCxCode("XX-999a")).toBeUndefined();
		});
	});

	describe("buildPlanChainFlows", () => {
		it("states the plans cargo as directed flows", () => {
			const flows = buildPlanChainFlows(
				cargo(),
				lookups() as IRaukkFlowLookups,
				config
			);

			expect(flows).toStrictEqual([
				{
					flowId: raukkFlowId(
						"ORE",
						SOURCE_PLANET,
						OWN_PLANET,
						"own"
					),
					ownerPlanUuid: "own",
					ticker: "ORE",
					fromStop: SOURCE_PLANET,
					toStop: OWN_PLANET,
					unitsPerDay: 100,
					weightPerUnit: 1,
					volumePerUnit: 0,
				},
				{
					flowId: raukkFlowId("DW", "AI1", OWN_PLANET, "own"),
					ownerPlanUuid: "own",
					ticker: "DW",
					fromStop: "AI1",
					toStop: OWN_PLANET,
					unitsPerDay: 20,
					weightPerUnit: 1,
					volumePerUnit: 0,
				},
				{
					// the subscriber draw never reaches the exchange
					flowId: raukkFlowId("ALO", OWN_PLANET, "AI1", "own"),
					ownerPlanUuid: "own",
					ticker: "ALO",
					fromStop: OWN_PLANET,
					toStop: "AI1",
					unitsPerDay: 50,
					weightPerUnit: 1,
					volumePerUnit: 0,
				},
			]);
		});

		it("splits an aggregate source by share, as the pairs do", () => {
			const flows = buildPlanChainFlows(
				cargo(),
				{
					...lookups(),
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [
									{ planUuid: "source", share: 0.25 },
									{ planUuid: "other", share: 0.75 },
								]
							: [],
					planetOf: (planUuid: string) =>
						planUuid === "source"
							? SOURCE_PLANET
							: planUuid === "other"
								? "ZV-307c"
								: undefined,
				} as IRaukkFlowLookups,
				config
			);

			expect(
				flows
					.filter((flow) => flow.ticker === "ORE")
					.map((flow) => [flow.fromStop, flow.unitsPerDay])
			).toStrictEqual([
				[SOURCE_PLANET, 25],
				["ZV-307c", 75],
			]);
		});

		/*
		 * Review finding 3: two producers on ONE planet give two flows with
		 * the same ticker and the same endpoints. Sharing an id would make
		 * the chain pass charge each of them the cost of both.
		 */
		it("keeps two same planet aggregate origins apart", () => {
			const flows = buildPlanChainFlows(
				cargo(),
				{
					...lookups(),
					originOf: (ticker: string) =>
						ticker === "ORE"
							? [
									{ planUuid: "source", share: 0.5 },
									{ planUuid: "other", share: 0.5 },
								]
							: [],
					planetOf: () => SOURCE_PLANET,
				} as IRaukkFlowLookups,
				config
			);

			const ore = flows.filter((flow) => flow.ticker === "ORE");

			expect(ore.map((flow) => flow.unitsPerDay)).toStrictEqual([50, 50]);
			expect(ore[0].flowId).not.toBe(ore[1].flowId);
			expect(new Set(flows.map((flow) => flow.flowId)).size).toBe(
				flows.length
			);
			expect(flows.every((flow) => flow.ownerPlanUuid === "own")).toBe(
				true
			);
		});

		it("is empty while shipping is disabled", () => {
			expect(
				buildPlanChainFlows(
					cargo(),
					lookups() as IRaukkFlowLookups,
					raukkDefaultShippingConfig()
				)
			).toStrictEqual([]);
		});
	});

	describe("claimed flow exclusion", () => {
		const claimed: IRaukkClaimedFlowCost[] = [
			{
				ticker: "ORE",
				fromStop: SOURCE_PLANET,
				toStop: OWN_PLANET,
				unitsPerDay: 100,
				costPerUnit: 3,
			},
			{
				ticker: "ALO",
				fromStop: OWN_PLANET,
				toStop: "AI1",
				unitsPerDay: 20,
				costPerUnit: 5,
			},
		];

		const lookup = raukkClaimedUnitsLookup(claimed, OWN_PLANET);

		function claimedUnitsOf(
			ticker: string,
			counterpart: string | undefined,
			inbound: boolean
		): number {
			return lookup(ticker, counterpart ?? "AI1", inbound);
		}

		it("indexes by ticker, counterpart and direction", () => {
			expect(lookup("ORE", SOURCE_PLANET, true)).toBe(100);
			expect(lookup("ORE", SOURCE_PLANET, false)).toBe(0);
			expect(lookup("ORE", "AI1", true)).toBe(0);
			expect(lookup("ALO", "AI1", false)).toBe(20);
		});

		it("removes a fully claimed lane and shrinks a partial one", () => {
			const pairs = buildShippingPairs(
				cargo(),
				lookups(claimedUnitsOf),
				config
			);

			// the sourcing lane is gone, all 100 ORE ride the chain
			expect(pairs.map((pair) => pair.pairKey)).toStrictEqual(["own>CX"]);
			// 50 ALO were left after the subscriber draw, 20 of them are
			// claimed; the market bought DW is untouched
			expect(pairs[0].out).toStrictEqual([
				{
					ticker: "ALO",
					unitsPerDay: 30,
					weightPerUnit: 1,
					volumePerUnit: 0,
				},
			]);
			expect(pairs[0].back[0].unitsPerDay).toBe(20);
		});

		it("changes nothing without a chain", () => {
			const pairs = buildShippingPairs(cargo(), lookups(), config);

			expect(pairs.map((pair) => pair.pairKey)).toStrictEqual([
				"own>source",
				"own>CX",
			]);
			expect(pairs[0].back[0].unitsPerDay).toBe(100);
			expect(pairs[1].out[0].unitsPerDay).toBe(50);
		});
	});

	describe("mergeClaimedShipping", () => {
		const result: IRaukkShippingResult = {
			pairs: [],
			shippingFraction: 0.5,
			inbound: { ORE: 2 },
			outbound: { ALO: 4 },
		};

		const pairs = buildShippingPairs(cargo(), lookups(), config);

		it("merges chain and pair ȼ per unit weighted by units", () => {
			const merged = mergeClaimedShipping(
				result,
				pairs,
				[
					{
						ticker: "ORE",
						fromStop: SOURCE_PLANET,
						toStop: OWN_PLANET,
						unitsPerDay: 100,
						costPerUnit: 6,
					},
				],
				OWN_PLANET
			);

			// 100 units at 2 ȼ on the pairs, 100 at 6 ȼ on the chain
			expect(merged.inbound.ORE).toBeCloseTo(4, 10);
			// the fraction stays the plans own lanes only
			expect(merged.shippingFraction).toBe(0.5);
		});

		it("prices a fully claimed ticker from the chain alone", () => {
			const merged = mergeClaimedShipping(
				{ ...result, inbound: {} },
				[],
				[
					{
						ticker: "ORE",
						fromStop: SOURCE_PLANET,
						toStop: OWN_PLANET,
						unitsPerDay: 100,
						costPerUnit: 6,
					},
				],
				OWN_PLANET
			);

			expect(merged.inbound.ORE).toBe(6);
		});

		it("returns the result untouched without any claim", () => {
			expect(mergeClaimedShipping(result, pairs, [], OWN_PLANET)).toBe(
				result
			);
		});
	});
});
