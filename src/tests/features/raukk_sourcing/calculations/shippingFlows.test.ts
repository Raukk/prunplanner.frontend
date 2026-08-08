import { describe, it, expect } from "vitest";

// Calculations
import {
	RAUKK_CX_ANCHOR_NEAREST,
	buildPlanChainFlows,
	mergeClaimedShipping,
	raukkClaimedUnitsLookup,
	raukkCxAnchorCode,
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
				bucket: "production",
				unitsPerDay: 100,
				weightPerUnit: 1,
				volumePerUnit: 0,
			},
			{
				ticker: "DW",
				bucket: "workforce",
				unitsPerDay: 20,
				weightPerUnit: 1,
				volumePerUnit: 0,
			},
		],
		outputs: [
			{
				ticker: "ALO",
				bucket: "production",
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

	describe("raukkCxAnchorCode", () => {
		it("anchors at the nearest exchange by default", () => {
			expect(raukkCxAnchorCode(OWN_PLANET)).toBe("AI1");
			expect(raukkCxAnchorCode(OWN_PLANET, RAUKK_CX_ANCHOR_NEAREST)).toBe(
				"AI1"
			);
		});

		it("takes the account wide fixed exchange", () => {
			expect(raukkCxAnchorCode(OWN_PLANET, "NC1")).toBe("NC1");
		});

		it("lets the per plan override win over the account mode", () => {
			expect(raukkCxAnchorCode(OWN_PLANET, "NC1", "CI1")).toBe("CI1");
			expect(
				raukkCxAnchorCode(OWN_PLANET, RAUKK_CX_ANCHOR_NEAREST, "CI1")
			).toBe("CI1");
		});

		it("degrades an unknown code to the nearest exchange", () => {
			expect(raukkCxAnchorCode(OWN_PLANET, "XX9", "YY9")).toBe("AI1");
		});

		it("lets a plan opt back into the nearest exchange", () => {
			expect(
				raukkCxAnchorCode(OWN_PLANET, "NC1", RAUKK_CX_ANCHOR_NEAREST)
			).toBe("AI1");
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
					// a plan to plan lane names its producing plan, the
					// planet alone cannot tell two of them apart
					sourcePlanUuid: "source",
					ticker: "ORE",
					bucket: "production",
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
					bucket: "workforce",
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
					bucket: "production",
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
				buildPlanChainFlows(cargo(), lookups() as IRaukkFlowLookups, {
					...raukkDefaultShippingConfig(),
					enabled: false,
				})
			).toStrictEqual([]);
		});
	});

	describe("anchored exchange", () => {
		it("names the anchored exchange on the market flows", () => {
			const flows = buildPlanChainFlows(
				cargo(),
				{
					...lookups(),
					anchorCxCode: "NC1",
				} as IRaukkFlowLookups,
				config
			);

			expect(
				flows
					.filter((flow) => flow.ticker !== "ORE")
					.map((flow) => [flow.fromStop, flow.toStop])
			).toStrictEqual([
				["NC1", OWN_PLANET],
				[OWN_PLANET, "NC1"],
			]);
		});
	});

	describe("local market", () => {
		/** The flows of one plan, as `[ticker, from, to, units]` tuples */
		function tuples(
			overrides: Partial<IRaukkPairLookups>,
			flowCargo: IRaukkPairPlanFlows = cargo()
		): (string | number)[][] {
			return buildPlanChainFlows(
				flowCargo,
				{ ...lookups(), ...overrides } as IRaukkFlowLookups,
				config
			).map((flow) => [
				flow.ticker,
				flow.fromStop,
				flow.toStop,
				flow.unitsPerDay,
			]);
		}

		it("emits no own to exchange flow for an LM sold output", () => {
			// the own→CX flow IS the market bound excess here: the 10 ALO
			// a counterpart draws are ITS inbound flow, not this one
			expect(
				tuples({ localSaleOf: (ticker: string) => ticker === "ALO" })
			).toStrictEqual([
				["ORE", SOURCE_PLANET, OWN_PLANET, 100],
				["DW", "AI1", OWN_PLANET, 20],
			]);
		});

		it("emits no exchange to own flow for an LM bought input", () => {
			expect(
				tuples({ localBuyOf: (ticker: string) => ticker === "DW" })
			).toStrictEqual([
				["ORE", SOURCE_PLANET, OWN_PLANET, 100],
				["ALO", OWN_PLANET, "AI1", 50],
			]);
		});

		it("drops an LM bought repair or workforce ticker alike", () => {
			const withRepair: IRaukkPairPlanFlows = {
				...cargo(),
				inputs: [
					...cargo().inputs,
					{
						ticker: "BSE",
						bucket: "repair",
						unitsPerDay: 10,
						weightPerUnit: 0.3,
						volumePerUnit: 0.5,
					},
				],
			};

			// the exclusion is per TICKER and bucket agnostic
			expect(
				tuples(
					{
						localBuyOf: (ticker: string) =>
							ticker === "BSE" || ticker === "DW",
					},
					withRepair
				)
			).toStrictEqual([
				["ORE", SOURCE_PLANET, OWN_PLANET, 100],
				["ALO", OWN_PLANET, "AI1", 50],
			]);

			// and the unflagged control still ships both of them
			expect(tuples({}, withRepair)).toStrictEqual([
				["ORE", SOURCE_PLANET, OWN_PLANET, 100],
				["DW", "AI1", OWN_PLANET, 20],
				["BSE", "AI1", OWN_PLANET, 10],
				["ALO", OWN_PLANET, "AI1", 50],
			]);
		});

		it("leaves a plan sourced input untouched", () => {
			// ORE comes from another plan, so no local flag of this plan
			// can reach it — the lane stays exactly as it was
			expect(
				tuples({
					localBuyOf: () => true,
					localSaleOf: () => true,
				})
			).toStrictEqual([["ORE", SOURCE_PLANET, OWN_PLANET, 100]]);
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
					bucket: "production",
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

	describe("claims of two producers on one planet", () => {
		/** The 100 ORE are drawn half from each of two same planet plans */
		function twoProducers(
			claimedUnitsOf?: IRaukkPairLookups["claimedUnitsOf"]
		): IRaukkPairLookups {
			return {
				...lookups(claimedUnitsOf),
				originOf: (ticker: string) =>
					ticker === "ORE"
						? [
								{ planUuid: "sourceA", share: 0.5 },
								{ planUuid: "sourceB", share: 0.5 },
							]
						: [],
				planetOf: (planUuid: string) =>
					planUuid === "sourceA" || planUuid === "sourceB"
						? SOURCE_PLANET
						: undefined,
			};
		}

		/** A claim of `units` ORE, optionally naming its producing plan */
		function oreClaim(
			units: number,
			sourcePlanUuid?: string
		): IRaukkClaimedFlowCost[] {
			return [
				{
					...(sourcePlanUuid !== undefined ? { sourcePlanUuid } : {}),
					ticker: "ORE",
					fromStop: SOURCE_PLANET,
					toStop: OWN_PLANET,
					unitsPerDay: units,
					costPerUnit: 3,
				},
			];
		}

		/** `claimedUnitsOf` over one claim list, the exchange named */
		function lookupOf(
			claimed: IRaukkClaimedFlowCost[]
		): IRaukkPairLookups["claimedUnitsOf"] {
			const lookup = raukkClaimedUnitsLookup(claimed, OWN_PLANET);

			return (
				ticker: string,
				counterpart: string | undefined,
				inbound: boolean,
				sourcePlanUuid?: string
			) => lookup(ticker, counterpart ?? "AI1", inbound, sourcePlanUuid);
		}

		/** Daily ORE units of one sourcing lane */
		function laneUnits(
			pairs: ReturnType<typeof buildShippingPairs>,
			pairKey: string
		): number {
			const pair = pairs.find((entry) => entry.pairKey === pairKey);

			return pair?.back[0]?.unitsPerDay ?? 0;
		}

		it("takes a partial claim off its own lane only", () => {
			const pairs = buildShippingPairs(
				cargo(),
				twoProducers(lookupOf(oreClaim(20, "sourceA"))),
				config
			);

			// 50 units per lane, 20 of A's ride the chain
			expect(laneUnits(pairs, "own>sourceA")).toBeCloseTo(30, 10);
			// the sibling keeps its whole freight, it was never claimed
			expect(laneUnits(pairs, "own>sourceB")).toBeCloseTo(50, 10);
		});

		it("empties the claimed lane and leaves the sibling whole", () => {
			const pairs = buildShippingPairs(
				cargo(),
				twoProducers(lookupOf(oreClaim(50, "sourceA"))),
				config
			);

			expect(
				pairs.map((pair) => pair.pairKey).includes("own>sourceA")
			).toBe(false);
			expect(laneUnits(pairs, "own>sourceB")).toBeCloseTo(50, 10);
		});

		it("keeps the planet level behaviour for a legacy claim", () => {
			// a result frozen before `sourcePlanUuid` existed names no
			// producer: it must still match, and it matches every plan on
			// its origin planet exactly as it always did
			const pairs = buildShippingPairs(
				cargo(),
				twoProducers(lookupOf(oreClaim(20))),
				config
			);

			expect(laneUnits(pairs, "own>sourceA")).toBeCloseTo(30, 10);
			expect(laneUnits(pairs, "own>sourceB")).toBeCloseTo(30, 10);
		});

		it("adds a legacy claim to a named one on the same lane", () => {
			const pairs = buildShippingPairs(
				cargo(),
				twoProducers(
					lookupOf([...oreClaim(20, "sourceA"), ...oreClaim(10)])
				),
				config
			);

			expect(laneUnits(pairs, "own>sourceA")).toBeCloseTo(20, 10);
			expect(laneUnits(pairs, "own>sourceB")).toBeCloseTo(40, 10);
		});

		it("answers the whole lane claim to a caller naming no plan", () => {
			const lookup = raukkClaimedUnitsLookup(
				[...oreClaim(20, "sourceA"), ...oreClaim(30, "sourceB")],
				OWN_PLANET
			);

			expect(lookup("ORE", SOURCE_PLANET, true)).toBe(50);
			expect(lookup("ORE", SOURCE_PLANET, true, "sourceA")).toBe(20);
			expect(lookup("ORE", SOURCE_PLANET, true, "sourceB")).toBe(30);
			expect(lookup("ORE", SOURCE_PLANET, true, "sourceC")).toBe(0);
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
