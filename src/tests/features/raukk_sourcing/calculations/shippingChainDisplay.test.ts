import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkChainDropSuggestions,
	raukkChainLegRows,
	raukkAutoChainListRows,
	raukkChainListRows,
	raukkChainReversedComparison,
	raukkChainSplitComparison,
	raukkChainStopsSummary,
	raukkChainStorageWarnings,
	raukkIsCxStop,
	raukkShipTimeOver,
	raukkShipTimePercent,
	raukkStopLabel,
	raukkStorageFilledDays,
} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkShipProfilePreset } from "@/features/raukk_sourcing/calculations/shippingProfiles";

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
import { IRaukkShipProfile } from "@/features/raukk_sourcing/calculations/shipping.types";

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

/** A hull with round fuel burn rates, so the fuel math stays readable */
function fuelProfile(): IRaukkShipProfile {
	return {
		...raukkShipProfilePreset(
			{ cargoWeight: 3000, cargoVolume: 1000 },
			"standard"
		),
		ftlFuelPerParsec: 5,
		stlFuelPerBlock: 72,
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
		advisories: [],
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
			expect(row.auto).toBe(false);
			expect(row.shippingFractionPercent).toBeCloseTo(8);
			expect(row.over).toBe(false);
		});

		it("flags a loop booking more ship time than its type has", () => {
			const rows: IRaukkChainListRow[] = raukkChainListRows(
				chains,
				{ c1: chainResult({ shippingFraction: 5.34 }) },
				STOP_NAMES
			);

			const row: IRaukkChainListRow = rows.find(
				(entry) => entry.chainId === "c1"
			)!;

			expect(row.shippingFractionPercent).toBeCloseTo(534);
			expect(row.over).toBe(true);
		});

		it("does not flag a hair over one as over-booked", () => {
			const rows: IRaukkChainListRow[] = raukkChainListRows(
				chains,
				{ c1: chainResult({ shippingFraction: 1.005 }) },
				STOP_NAMES
			);

			expect(rows.find((entry) => entry.chainId === "c1")!.over).toBe(
				false
			);
		});

		it("has no percentage for an uncomputed chain", () => {
			const rows: IRaukkChainListRow[] = raukkChainListRows(
				chains,
				{},
				STOP_NAMES
			);

			expect(rows[0].shippingFractionPercent).toBeNull();
			expect(rows[0].over).toBe(false);
		});
	});

	describe("raukkAutoChainListRows", () => {
		it("lists the derived chains and nothing else", () => {
			const rows: IRaukkChainListRow[] = raukkAutoChainListRows(
				{
					c1: chainResult(),
					"auto:production:NC1:1": chainResult({
						chainId: "auto:production:NC1:1",
						auto: true,
						capDays: 14,
						shipMinutesPerDay: 720,
					}),
				},
				STOP_NAMES
			);

			expect(rows.map((row) => row.chainId)).toStrictEqual([
				"auto:production:NC1:1",
			]);
			expect(rows[0].auto).toBe(true);
			expect(rows[0].capDays).toBe(14);
			expect(rows[0].computed).toBe(true);
			expect(rows[0].shipDaysPerDay).toBeCloseTo(0.5);
			expect(rows[0].stopsSummary).toBe(
				"Extractor → Smelter → Extractor"
			);
			expect(rows[0].shippingFractionPercent).toBeCloseTo(8);
			expect(rows[0].over).toBe(false);
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

		it("reads the leg duration off the calibrated flight minutes", () => {
			const rows = raukkChainLegRows(
				shipping({ legs: [leg(0, { roundTripMinutes: 150 })] }),
				STOP_NAMES
			);

			expect(rows[0].durationHours).toBeCloseTo(2.5);
		});

		it("prices the fuel burn of a leg at the current FF and SF price", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: fuelProfile(),
				prices: { FF: 100, SF: 10 },
			});

			// 4 pc * 5 FF * 100 + 72 SF * 10
			expect(rows[0].fuelCost).toBeCloseTo(2720);
		});

		it("states no fuel estimate without a profile to burn it", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES);

			expect(rows[0].fuelCost).toBeNull();
		});

		it("states no fuel estimate while a fuel price is unknown", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: fuelProfile(),
				prices: { FF: 100 },
			});

			expect(rows[0].fuelCost).toBeNull();
		});

		it("marks a burn priced estimate as not overridden", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: fuelProfile(),
				prices: { FF: 100, SF: 10 },
			});

			expect(rows[0].fuelOverridden).toBe(false);
		});

		it("charges a manual ȼ per parsec instead of the FTL burn", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: { ...fuelProfile(), costPerParsec: 50 },
				prices: { FF: 100, SF: 10 },
			});

			// 4 pc * 50 ȼ + 72 SF * 10
			expect(rows[0].fuelCost).toBeCloseTo(920);
			expect(rows[0].fuelOverridden).toBe(true);
		});

		it("charges a manual sublight block cost instead of the STL burn", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: { ...fuelProfile(), stlBlockCost: 20 },
				prices: { FF: 100, SF: 10 },
			});

			// 4 pc * 5 FF * 100 + 20 ȼ
			expect(rows[0].fuelCost).toBeCloseTo(2020);
			expect(rows[0].fuelOverridden).toBe(true);
		});

		it("honours a manual zero, which is free freight and not a burn", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: {
					...fuelProfile(),
					costPerParsec: 0,
					stlBlockCost: 0,
				},
				prices: { FF: 100, SF: 10 },
			});

			expect(rows[0].fuelCost).toBe(0);
			expect(rows[0].fuelOverridden).toBe(true);
		});

		it("needs no price for a term a manual override already states", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: {
					...fuelProfile(),
					costPerParsec: 50,
					stlBlockCost: 20,
				},
				prices: {},
			});

			expect(rows[0].fuelCost).toBeCloseTo(220);
		});

		it("still needs the price of the term left derived", () => {
			const rows = raukkChainLegRows(shipping(), STOP_NAMES, {
				profile: { ...fuelProfile(), costPerParsec: 50 },
				prices: { FF: 100 },
			});

			expect(rows[0].fuelCost).toBeNull();
			expect(rows[0].fuelOverridden).toBe(true);
		});
	});

	describe("raukkShipTimePercent", () => {
		it("states a share as the percentage every surface reads", () => {
			expect(raukkShipTimePercent(0.42)).toBeCloseTo(42);
			expect(raukkShipTimePercent(1)).toBeCloseTo(100);
		});

		it("carries an unknown share through untouched", () => {
			expect(raukkShipTimePercent(null)).toBeNull();
			expect(raukkShipTimePercent(undefined)).toBeNull();
		});
	});

	describe("raukkShipTimeOver", () => {
		it("is over only past a full day plus the equality deadband", () => {
			expect(raukkShipTimeOver(1)).toBe(false);
			expect(raukkShipTimeOver(1.005)).toBe(false);
			expect(raukkShipTimeOver(1.5)).toBe(true);
		});

		it("is never over on an unknown share", () => {
			expect(raukkShipTimeOver(null)).toBe(false);
			expect(raukkShipTimeOver(undefined)).toBe(false);
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
