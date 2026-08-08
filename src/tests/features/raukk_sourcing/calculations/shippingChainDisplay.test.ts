import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkChainDropSuggestions,
	raukkChainLegRows,
	raukkChainListRows,
	raukkChainReversedComparison,
	raukkChainSplitComparison,
	raukkChainStopsSummary,
	raukkChainStorageWarnings,
	raukkIsCxStop,
	raukkStopLabel,
	raukkStorageFilledDays,
} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import { IMaterialIO } from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkChain,
	IRaukkChainDropEvaluation,
	IRaukkChainLegResult,
	IRaukkChainShipping,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";
import {
	IRaukkChainCosting,
	IRaukkChainResult,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkChainListRow,
	IRaukkChainStorageWarning,
} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";

const STOP_NAMES: Record<string, string> = {
	"ZV-759c": "Extractor",
	ANT: "Smelter",
};

function leg(
	index: number,
	overrides: Partial<IRaukkChainLegResult> = {}
): IRaukkChainLegResult {
	return {
		index,
		fromIndex: index,
		toIndex: index + 1,
		fromStop: "ZV-759c",
		toStop: "ANT",
		fromSystemId: "s1",
		toSystemId: "s2",
		route: null,
		sameSystem: false,
		routable: true,
		weightPerDay: 300,
		volumePerDay: 100,
		loads: 0.1,
		binding: "weight",
		bindingPerDay: 300,
		utilization: 0.1,
		effectiveParsecs: 4,
		effectiveJumps: 1,
		sameSystemMode: null,
		sameSystemBand: null,
		pathMeanDensity: 3.28,
		damagePerParsec: 0.0002,
		costPerTrip: 100,
		repairCostPerTrip: 10,
		dailyCost: 50,
		roundTripMinutes: 120,
		...overrides,
	};
}

function shipping(
	overrides: Partial<IRaukkChainShipping> = {}
): IRaukkChainShipping {
	return {
		chainId: "c1",
		hired: false,
		tripsPerDay: 0.5,
		costPerTrip: 200,
		repairCostPerTrip: 20,
		dailyCost: 100,
		roundTripMinutes: 240,
		shippingFraction: 0.08,
		legs: [leg(0), leg(1, { fromStop: "ANT", toStop: "ZV-759c" })],
		bindingLegIndex: 1,
		flows: [],
		unclaimed: [],
		perUnit: {},
		...overrides,
	};
}

function costing(dailyCost: number): IRaukkChainCosting {
	return {
		stops: ["ZV-759c", "ANT"],
		tripsPerDay: 0.5,
		roundTripMinutes: 240,
		bindingLegIndex: 0,
		dailyCost,
		shippingFraction: 0.08,
	};
}

function chainResult(
	overrides: Partial<IRaukkChainResult> = {}
): IRaukkChainResult {
	return {
		chainId: "c1",
		computedAt: "2026-08-08T00:00:00.000Z",
		stale: false,
		profileId: "3000x1000-standard",
		hired: false,
		splitApplied: false,
		unsplit: costing(100),
		split: [],
		splitTrigger: null,
		tripsPerDay: 0.5,
		roundTripMinutes: 240,
		bindingLegIndex: 0,
		dailyCost: 100,
		shippingFraction: 0.08,
		shipMinutesPerDay: 120,
		flows: [],
		perUnit: {},
		memberPlanUuids: ["p1"],
		config: raukkDefaultChainConfig(),
		...overrides,
	};
}

function materialIO(
	ticker: string,
	weight: number,
	volume: number,
	delta: number
): IMaterialIO {
	return {
		ticker,
		input: delta < 0 ? -delta : 0,
		output: delta > 0 ? delta : 0,
		delta,
		individualWeight: 1,
		individualVolume: 1,
		totalWeight: weight,
		totalVolume: volume,
		price: 0,
	};
}

describe("Raukk Shipping: Chain Display", () => {
	describe("stop labels", () => {
		it("recognizes the four exchange codes", () => {
			expect(raukkIsCxStop("NC1")).toBe(true);
			expect(raukkIsCxStop("IC1")).toBe(true);
			expect(raukkIsCxStop("ANT")).toBe(false);
		});

		it("names a planet after its plan, an exchange after itself", () => {
			expect(raukkStopLabel("ANT", STOP_NAMES)).toBe("Smelter");
			expect(raukkStopLabel("NC1", STOP_NAMES)).toBe("NC1");
			expect(raukkStopLabel("XY-123a", STOP_NAMES)).toBe("XY-123a");
		});

		it("closes the summary back to the first stop", () => {
			expect(
				raukkChainStopsSummary(["ZV-759c", "NC1", "ANT"], STOP_NAMES)
			).toBe("Extractor → NC1 → Smelter → Extractor");
			expect(raukkChainStopsSummary([], STOP_NAMES)).toBe("");
		});
	});

	describe("raukkChainListRows", () => {
		const chains: Record<string, IRaukkChain> = {
			c1: {
				chainId: "c1",
				name: "Metals",
				stops: ["ZV-759c", "ANT"],
			},
			c2: { chainId: "c2", stops: ["ANT", "NC1"] },
		};

		it("states an uncomputed chain as uncomputed, never as free", () => {
			const rows: IRaukkChainListRow[] = raukkChainListRows(
				chains,
				{},
				STOP_NAMES
			);

			// sorted by name, an unnamed chain falls back to its id
			expect(rows.map((row) => row.name)).toEqual(["c2", "Metals"]);

			const metals: IRaukkChainListRow = rows.find(
				(entry) => entry.chainId === "c1"
			)!;

			expect(metals.computed).toBe(false);
			expect(metals.stale).toBe(true);
			expect(metals.dailyCost).toBeNull();
			expect(metals.shipDaysPerDay).toBeNull();
		});

		it("reports the ship days a computed chain claims", () => {
			const rows: IRaukkChainListRow[] = raukkChainListRows(
				chains,
				{ c1: chainResult({ shipMinutesPerDay: 720 }) },
				STOP_NAMES
			);

			const row: IRaukkChainListRow = rows.find(
				(entry) => entry.chainId === "c1"
			)!;

			expect(row.computed).toBe(true);
			expect(row.stale).toBe(false);
			expect(row.shipDaysPerDay).toBeCloseTo(0.5);
			expect(row.stopsSummary).toBe("Extractor → Smelter → Extractor");
		});
	});

	describe("raukkChainLegRows", () => {
		it("states loads per trip and marks the weakest link", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES);

			expect(rows[0].weightPerTrip).toBeCloseTo(600);
			expect(rows[0].volumePerTrip).toBeCloseTo(200);
			expect(rows[0].isBinding).toBe(false);
			expect(rows[1].isBinding).toBe(true);
			expect(rows[0].utilizationPercent).toBeCloseTo(10);
			expect(rows[0].fromLabel).toBe("Extractor");
		});

		it("does not divide by a chain that never flies", () => {
			const rows = raukkChainLegRows(
				shipping({ tripsPerDay: 0 }),
				STOP_NAMES
			);

			expect(rows[0].weightPerTrip).toBe(0);
			expect(rows[0].volumePerTrip).toBe(0);
		});
	});

	describe("raukkChainSplitComparison", () => {
		it("is absent while no exchange ever triggered", () => {
			expect(raukkChainSplitComparison(chainResult())).toBeNull();
		});

		it("prices the durability premium of an applied split", () => {
			const comparison = raukkChainSplitComparison(
				chainResult({
					splitApplied: true,
					splitTrigger: {
						legIndex: 1,
						cxCode: "NC1",
						detourParsecs: 2,
					},
					split: [costing(70), costing(50)],
				})
			)!;

			expect(comparison.splitDailyCost).toBeCloseTo(120);
			expect(comparison.unsplitDailyCost).toBeCloseTo(100);
			expect(comparison.premiumPerDay).toBeCloseTo(20);
			expect(comparison.splitCheaper).toBe(false);
			expect(comparison.splitApplied).toBe(true);
		});
	});

	describe("raukkChainReversedComparison", () => {
		it("flags the cheaper direction", () => {
			const comparison = raukkChainReversedComparison(
				shipping({ dailyCost: 120 }),
				shipping({ dailyCost: 90 })
			);

			expect(comparison.savingPerDay).toBeCloseTo(30);
			expect(comparison.reversedCheaper).toBe(true);
		});

		it("leaves an authored loop that is already best alone", () => {
			expect(
				raukkChainReversedComparison(
					shipping({ dailyCost: 90 }),
					shipping({ dailyCost: 120 })
				).reversedCheaper
			).toBe(false);
		});
	});

	describe("raukkChainDropSuggestions", () => {
		it("carries the honest comparison into the chip", () => {
			const evaluation: IRaukkChainDropEvaluation = {
				stopIndex: 1,
				stopRef: "ANT",
				utilization: 0.05,
				dailyCostAsIs: 100,
				dailyCostWithoutStop: 60,
				dailyCostStandalone: 20,
				standalonePairs: [],
				savingPerDay: 20,
				recommendDrop: true,
			};

			const [chip] = raukkChainDropSuggestions([evaluation], STOP_NAMES);

			expect(chip.label).toBe("Smelter");
			expect(chip.utilizationPercent).toBeCloseTo(5);
			expect(chip.savingPerDay).toBeCloseTo(20);
			expect(chip.recommendDrop).toBe(true);
		});
	});

	describe("raukkStorageFilledDays", () => {
		it("takes the tighter of weight and volume over the whole flow", () => {
			const io: IMaterialIO[] = [
				materialIO("ORE", 100, 50, -100),
				materialIO("MET", 50, 25, 50),
			];

			// 150 t and 75 m³ per day
			expect(raukkStorageFilledDays(300, 750, io)).toBeCloseTo(2);
			expect(raukkStorageFilledDays(3000, 75, io)).toBeCloseTo(1);
		});

		it("has no answer for a plan that moves nothing", () => {
			expect(raukkStorageFilledDays(300, 300, [])).toBeNull();
		});
	});

	describe("raukkChainStorageWarnings", () => {
		it("warns exactly when the visit is later than the fill", () => {
			const warnings: IRaukkChainStorageWarning[] =
				raukkChainStorageWarnings(
					0.25,
					[
						{ stopRef: "ANT", filledDays: 3.1 },
						{ stopRef: "ZV-759c", filledDays: 9 },
					],
					STOP_NAMES
				);

			expect(warnings).toHaveLength(1);
			expect(warnings[0].label).toBe("Smelter");
			expect(warnings[0].visitDays).toBeCloseTo(4);
			expect(warnings[0].filledDays).toBeCloseTo(3.1);
		});

		it("never warns about an exchange or an unknown storage", () => {
			expect(
				raukkChainStorageWarnings(
					0.25,
					[
						{ stopRef: "NC1", filledDays: 0.5 },
						{ stopRef: "ANT", filledDays: null },
					],
					STOP_NAMES
				)
			).toHaveLength(0);
		});

		it("says nothing about a chain that never flies", () => {
			expect(
				raukkChainStorageWarnings(
					0,
					[{ stopRef: "ANT", filledDays: 1 }],
					STOP_NAMES
				)
			).toHaveLength(0);
		});
	});
});
