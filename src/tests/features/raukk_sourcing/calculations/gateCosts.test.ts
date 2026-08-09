import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkGateSpecs,
	IRaukkGateUpgrades,
	IRaukkMaterialAmounts,
	RAUKK_GATE_BASE_COST,
	RAUKK_GATE_BASE_SPECS,
	RAUKK_GATE_NO_UPGRADES,
	RAUKK_GATE_UPGRADE_BUDGET,
	RAUKK_GATE_UPGRADE_CAPS,
	RAUKK_GATE_UPKEEP,
	raukkGateBuildCost,
	raukkGateCostAic,
	raukkGateCostTickers,
	raukkGateLinkBuildCost,
	raukkGateSpecs,
	raukkGateUpgradeBudgetLeft,
	raukkGateUpgradeCeiling,
	raukkGateUpgradeTotal,
	raukkGateUpgradeUnits,
	raukkGateUpgradesFit,
} from "@/features/raukk_sourcing/calculations/gateCosts";

function upgrades(
	capacity: number,
	volume: number,
	range: number
): IRaukkGateUpgrades {
	return { capacity, volume, range };
}

/**
 * The `Total` row of one transcribed GTWI panel.
 *
 * Every configuration the user transcribed, with the specifications the
 * panel reported beside it. These ARE the model's ground truth: the
 * triangular cost law and the linear effects were both derived from them,
 * and a change that breaks any one of these rows is a change that no
 * longer describes the game.
 */
interface IRaukkGateFixture {
	gate: string;
	upgrades: IRaukkGateUpgrades;
	specs: IRaukkGateSpecs;
	total: IRaukkMaterialAmounts;
}

const BASE_TOTAL: IRaukkMaterialAmounts = {
	SEA: 5000,
	LIT: 200,
	PSH: 1000,
	RSH: 600,
	TSH: 600,
	TRU: 4000,
	ABH: 160,
	ADE: 80,
	ASE: 120,
	ATA: 80,
	HSE: 160,
	LBH: 400,
	LDE: 160,
	LSE: 400,
	LTA: 80,
	RBH: 320,
	RDE: 80,
	RSE: 320,
	RTA: 80,
	ADS: 2,
	COM: 2,
	CBL: 240,
	SP: 8000,
	GWS: 4,
	SST: 1,
	SPT: 2000,
	TRS: 80,
	IMM: 2,
};

/** Base totals patched by the upgrade positions of one panel */
function total(patch: IRaukkMaterialAmounts): IRaukkMaterialAmounts {
	return { ...BASE_TOTAL, ...patch };
}

const FIXTURES: IRaukkGateFixture[] = [
	{
		gate: "ZV-307c",
		upgrades: upgrades(0, 0, 0),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 1500,
			fuelStorage: 25000,
			linkingRangeParsecs: 10,
		},
		total: total({}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(1, 0, 0),
		specs: {
			usesPerDay: 400,
			maxShipVolumeM3: 1500,
			fuelStorage: 40000,
			linkingRangeParsecs: 10,
		},
		total: total({
			RSH: 700,
			TSH: 700,
			LBH: 500,
			LDE: 200,
			LSE: 500,
			LTA: 100,
			CBL: 280,
			SP: 8400,
			SPT: 2100,
			TRS: 90,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(2, 0, 0),
		specs: {
			usesPerDay: 550,
			maxShipVolumeM3: 1500,
			fuelStorage: 55000,
			linkingRangeParsecs: 10,
		},
		total: total({
			RSH: 900,
			TSH: 900,
			LBH: 700,
			LDE: 280,
			LSE: 700,
			LTA: 140,
			CBL: 360,
			SP: 9200,
			SPT: 2300,
			TRS: 110,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(5, 0, 0),
		specs: {
			usesPerDay: 1000,
			maxShipVolumeM3: 1500,
			fuelStorage: 100000,
			linkingRangeParsecs: 10,
		},
		total: total({
			RSH: 2100,
			TSH: 2100,
			LBH: 1900,
			LDE: 760,
			LSE: 1900,
			LTA: 380,
			CBL: 840,
			SP: 14000,
			SPT: 3500,
			TRS: 230,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(0, 1, 0),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 3000,
			fuelStorage: 25000,
			linkingRangeParsecs: 10,
		},
		total: total({
			PSH: 1200,
			RBH: 360,
			RDE: 100,
			RSE: 360,
			RTA: 100,
			GWS: 5,
			SPT: 2100,
			TRS: 90,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(0, 2, 0),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 4500,
			fuelStorage: 25000,
			linkingRangeParsecs: 10,
		},
		total: total({
			PSH: 1600,
			RBH: 440,
			RDE: 140,
			RSE: 440,
			RTA: 140,
			GWS: 7,
			SPT: 2300,
			TRS: 110,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(0, 3, 0),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 6000,
			fuelStorage: 25000,
			linkingRangeParsecs: 10,
		},
		total: total({
			PSH: 2200,
			RBH: 560,
			RDE: 200,
			RSE: 560,
			RTA: 200,
			GWS: 10,
			SPT: 2600,
			TRS: 140,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(0, 0, 2),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 1500,
			fuelStorage: 25000,
			linkingRangeParsecs: 20,
		},
		total: total({
			LIT: 440,
			ABH: 400,
			ADE: 260,
			ASE: 360,
			ATA: 260,
			ADS: 5,
			COM: 5,
			IMM: 5,
		}),
	},
	{
		gate: "ZV-307c",
		upgrades: upgrades(0, 0, 3),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 1500,
			fuelStorage: 25000,
			linkingRangeParsecs: 25,
		},
		total: total({
			LIT: 680,
			ABH: 640,
			ADE: 440,
			ASE: 600,
			ATA: 440,
			ADS: 8,
			COM: 8,
			IMM: 8,
		}),
	},
	// the mixed five-point builds, on a SECOND gate: the cross-check that
	// the model is the game's and not one planet's
	{
		gate: "SE-648c",
		upgrades: upgrades(0, 3, 2),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 6000,
			fuelStorage: 25000,
			linkingRangeParsecs: 20,
		},
		total: total({
			LIT: 440,
			PSH: 2200,
			ABH: 400,
			ADE: 260,
			ASE: 360,
			ATA: 260,
			RBH: 560,
			RDE: 200,
			RSE: 560,
			RTA: 200,
			ADS: 5,
			COM: 5,
			GWS: 10,
			SPT: 2600,
			TRS: 140,
			IMM: 5,
		}),
	},
	{
		gate: "SE-648c",
		upgrades: upgrades(1, 3, 1),
		specs: {
			usesPerDay: 400,
			maxShipVolumeM3: 6000,
			fuelStorage: 40000,
			linkingRangeParsecs: 15,
		},
		total: total({
			LIT: 280,
			PSH: 2200,
			RSH: 700,
			TSH: 700,
			ABH: 240,
			ADE: 140,
			ASE: 200,
			ATA: 140,
			LBH: 500,
			LDE: 200,
			LSE: 500,
			LTA: 100,
			RBH: 560,
			RDE: 200,
			RSE: 560,
			RTA: 200,
			ADS: 3,
			COM: 3,
			CBL: 280,
			SP: 8400,
			GWS: 10,
			SPT: 2700,
			TRS: 150,
			IMM: 3,
		}),
	},
	{
		gate: "SE-648c",
		upgrades: upgrades(0, 2, 3),
		specs: {
			usesPerDay: 250,
			maxShipVolumeM3: 4500,
			fuelStorage: 25000,
			linkingRangeParsecs: 25,
		},
		total: total({
			LIT: 680,
			PSH: 1600,
			ABH: 640,
			ADE: 440,
			ASE: 600,
			ATA: 440,
			RBH: 440,
			RDE: 140,
			RSE: 440,
			RTA: 140,
			ADS: 8,
			COM: 8,
			GWS: 7,
			SPT: 2300,
			TRS: 110,
			IMM: 8,
		}),
	},
	{
		gate: "SE-648c",
		upgrades: upgrades(1, 2, 2),
		specs: {
			usesPerDay: 400,
			maxShipVolumeM3: 4500,
			fuelStorage: 40000,
			linkingRangeParsecs: 20,
		},
		total: total({
			LIT: 440,
			PSH: 1600,
			RSH: 700,
			TSH: 700,
			ABH: 400,
			ADE: 260,
			ASE: 360,
			ATA: 260,
			LBH: 500,
			LDE: 200,
			LSE: 500,
			LTA: 100,
			RBH: 440,
			RDE: 140,
			RSE: 440,
			RTA: 140,
			ADS: 5,
			COM: 5,
			CBL: 280,
			SP: 8400,
			GWS: 7,
			SPT: 2400,
			TRS: 120,
			IMM: 5,
		}),
	},
	{
		gate: "SE-648c",
		upgrades: upgrades(2, 2, 1),
		specs: {
			usesPerDay: 550,
			maxShipVolumeM3: 4500,
			fuelStorage: 55000,
			linkingRangeParsecs: 15,
		},
		total: total({
			LIT: 280,
			PSH: 1600,
			RSH: 900,
			TSH: 900,
			ABH: 240,
			ADE: 140,
			ASE: 200,
			ATA: 140,
			LBH: 700,
			LDE: 280,
			LSE: 700,
			LTA: 140,
			RBH: 440,
			RDE: 140,
			RSE: 440,
			RTA: 140,
			ADS: 3,
			COM: 3,
			CBL: 360,
			SP: 9200,
			GWS: 7,
			SPT: 2600,
			TRS: 140,
			IMM: 3,
		}),
	},
];

describe("Raukk Sourcing: gate costs", () => {
	describe("the transcribed GTWI panels", () => {
		FIXTURES.forEach((fixture) => {
			const { capacity, volume, range } = fixture.upgrades;
			const name: string = `${fixture.gate} capacity ${capacity}, volume ${volume}, range ${range}`;

			it(`reproduces the material bill of ${name}`, () => {
				expect(raukkGateBuildCost(fixture.upgrades)).toStrictEqual(
					fixture.total
				);
			});

			it(`reproduces the specifications of ${name}`, () => {
				expect(raukkGateSpecs(fixture.upgrades)).toStrictEqual(
					fixture.specs
				);
			});
		});

		it("never transcribed a build over the upgrade budget", () => {
			FIXTURES.forEach((fixture) => {
				expect(
					raukkGateUpgradeTotal(fixture.upgrades)
				).toBeLessThanOrEqual(RAUKK_GATE_UPGRADE_BUDGET);
			});
		});
	});

	describe("the cost law", () => {
		it("is triangular, the n-th level costing n units", () => {
			expect(raukkGateUpgradeUnits(0)).toBe(0);
			expect(raukkGateUpgradeUnits(1)).toBe(1);
			expect(raukkGateUpgradeUnits(2)).toBe(3);
			expect(raukkGateUpgradeUnits(3)).toBe(6);
			expect(raukkGateUpgradeUnits(5)).toBe(15);
		});

		it("is NOT linear, which one panel alone would suggest", () => {
			// the trap: 3 range levels cost 480 LIT, and 480/3 = 160 reads
			// like a per level price. It is not — level 1 costs 80.
			const one: IRaukkMaterialAmounts = raukkGateBuildCost(
				upgrades(0, 0, 1)
			);
			const three: IRaukkMaterialAmounts = raukkGateBuildCost(
				upgrades(0, 0, 3)
			);

			const first: number = one.LIT - RAUKK_GATE_BASE_COST.LIT;
			const third: number = three.LIT - RAUKK_GATE_BASE_COST.LIT;

			expect(first).toBe(80);
			expect(third).toBe(480);
			// a linear reading of the 3-level panel alone would price the
			// first level at 480 / 3 = 160, exactly twice what it costs
			expect(third / 3).toBe(160);
			expect(first).not.toBe(third / 3);
		});

		it("leaves a gate with no upgrades at its base bill", () => {
			expect(raukkGateBuildCost()).toStrictEqual({
				...RAUKK_GATE_BASE_COST,
			});
			expect(raukkGateSpecs()).toStrictEqual({
				...RAUKK_GATE_BASE_SPECS,
			});
		});

		it("charges a LINK twice, one gate at each end", () => {
			const one: IRaukkMaterialAmounts = raukkGateBuildCost(
				upgrades(1, 2, 2)
			);
			const link: IRaukkMaterialAmounts = raukkGateLinkBuildCost(
				upgrades(1, 2, 2)
			);

			Object.entries(one).forEach(([ticker, amount]) => {
				expect(link[ticker]).toBe(amount * 2);
			});
			expect(Object.keys(link).sort()).toStrictEqual(
				Object.keys(one).sort()
			);
		});
	});

	describe("the upgrade budget", () => {
		it("is five levels over all three tracks", () => {
			expect(RAUKK_GATE_UPGRADE_BUDGET).toBe(5);
			// the per track maxima alone would allow eleven
			expect(
				RAUKK_GATE_UPGRADE_CAPS.capacity +
					RAUKK_GATE_UPGRADE_CAPS.volume +
					RAUKK_GATE_UPGRADE_CAPS.range
			).toBeGreaterThan(RAUKK_GATE_UPGRADE_BUDGET);
		});

		it("counts what is spent and what is left", () => {
			expect(raukkGateUpgradeTotal(upgrades(1, 2, 1))).toBe(4);
			expect(raukkGateUpgradeBudgetLeft(upgrades(1, 2, 1))).toBe(1);
			expect(raukkGateUpgradeBudgetLeft(upgrades(5, 0, 0))).toBe(0);
			// a level over the track's own cap does not count twice
			expect(raukkGateUpgradeTotal(upgrades(0, 9, 0))).toBe(3);
		});

		it("ceilings one track by its cap AND by what is left", () => {
			// range caps at 3 and nothing else is spent
			expect(
				raukkGateUpgradeCeiling("range", RAUKK_GATE_NO_UPGRADES)
			).toBe(3);
			// four levels spent elsewhere leave room for exactly one
			expect(raukkGateUpgradeCeiling("range", upgrades(1, 3, 0))).toBe(1);
			expect(raukkGateUpgradeCeiling("range", upgrades(5, 0, 0))).toBe(0);
			// the track's own level does not count against itself
			expect(raukkGateUpgradeCeiling("capacity", upgrades(5, 0, 0))).toBe(
				5
			);
		});

		it("clamps the track that was raised, not the untouched ones", () => {
			// the user had volume 3 and range 2, and now asks for capacity 5
			const fitted: IRaukkGateUpgrades = raukkGateUpgradesFit(
				upgrades(5, 3, 2),
				"capacity"
			);

			expect(fitted).toStrictEqual(upgrades(0, 3, 2));
		});

		it("leaves a build inside the budget alone", () => {
			expect(
				raukkGateUpgradesFit(upgrades(1, 2, 2), "volume")
			).toStrictEqual(upgrades(1, 2, 2));
		});

		it("gives way in a fixed order when one track cannot absorb it", () => {
			// eleven levels wanted: zeroing the changed track leaves eight,
			// so capacity gives way next, in the fixed capacity-then-volume
			// order rather than by iteration luck
			const fitted: IRaukkGateUpgrades = raukkGateUpgradesFit(
				upgrades(5, 3, 3),
				"range"
			);

			expect(raukkGateUpgradeTotal(fitted)).toBe(
				RAUKK_GATE_UPGRADE_BUDGET
			);
			expect(fitted).toStrictEqual(upgrades(2, 3, 0));
			// same input, a different track raised, a different survivor
			expect(
				raukkGateUpgradesFit(upgrades(5, 3, 3), "capacity")
			).toStrictEqual(upgrades(0, 2, 3));
		});
	});

	describe("pricing", () => {
		it("sums the bill at the given prices", () => {
			expect(
				raukkGateCostAic({ SEA: 10, SP: 5 }, (ticker) =>
					ticker === "SEA" ? 100 : 20
				)
			).toBe(10 * 100 + 5 * 20);
		});

		it("treats an unpriceable ticker as free rather than throwing", () => {
			expect(
				raukkGateCostAic({ SEA: 10, NOPE: 5 }, (ticker) =>
					ticker === "SEA" ? 100 : Number.NaN
				)
			).toBe(1000);
		});

		it("lists every ticker a bill can name, upkeep included", () => {
			const tickers: string[] = raukkGateCostTickers();

			Object.keys(RAUKK_GATE_BASE_COST).forEach((ticker) =>
				expect(tickers).toContain(ticker)
			);
			Object.keys(RAUKK_GATE_UPKEEP).forEach((ticker) =>
				expect(tickers).toContain(ticker)
			);
			// every upgrade position too, e.g. the range track's own
			expect(tickers).toContain("IMM");
			expect(tickers).toStrictEqual([...tickers].sort());
			expect(new Set(tickers).size).toBe(tickers.length);
		});
	});
});
