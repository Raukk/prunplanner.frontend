// Calculation Utils
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";

// Types & Interfaces
import { IBuilding, IRecipeMaterial } from "@/features/api/gameData.types";
import { IFIOPlanetFees } from "@/features/api/fioData.types";
import { WORKFORCE_TYPE } from "@/features/planning/usePlanCalculation.types";

const WORKFORCE_BUILDING_FIELD_MAP: Record<
	WORKFORCE_TYPE,
	"pioneers" | "settlers" | "technicians" | "engineers" | "scientists"
> = {
	pioneer: "pioneers",
	settler: "settlers",
	technician: "technicians",
	engineer: "engineers",
	scientist: "scientists",
};

/**
 * A buildings production fee rate per 24h of nominal runtime. The rate
 * is charged per BUILDING, not per employee: a building staffed by one
 * workforce tier pays that tiers daily rate flat, and a building mixing
 * tiers pays their workforce-weighted average — more employees of a tier
 * only shift the mix, they never multiply the bill. Fees are set per
 * planet by its government, per industry and tier.
 * @author raukk
 *
 * @export
 * @param {IBuilding} building Building Data
 * @param {IFIOPlanetFees | null} fees Planet Fee Data, null if unknown
 * @returns {number} Fee rate per nominal 24h runtime, 0 if unknown
 */
export function calculateProductionFeeRate(
	building: IBuilding,
	fees: IFIOPlanetFees | null
): number {
	if (!fees || building.expertise === null) return 0;

	const feeTable = fees.production_fees[building.expertise];
	if (!feeTable) return 0;

	const { weighted, workers } = Object.entries(
		WORKFORCE_BUILDING_FIELD_MAP
	).reduce(
		(acc, [workforce, field]) => ({
			weighted:
				acc.weighted +
				building[field] * (feeTable[workforce as WORKFORCE_TYPE] ?? 0),
			workers: acc.workers + building[field],
		}),
		{ weighted: 0, workers: 0 }
	);

	return workers > 0 ? weighted / workers : 0;
}

/**
 * Calculates the production fee of a single order batch. The fee is
 * charged on the orders REAL duration, so efficiency shortens the batch
 * and shrinks its fee by the same factor: the recipe time is divided by
 * the buildings total efficiency before the daily rate is applied.
 * @author raukk
 *
 * @export
 * @param {IBuilding} building Building Data
 * @param {IFIOPlanetFees | null} fees Planet Fee Data, null if unknown
 * @param {number} recipeTimeMs Unmodified recipe time in ms
 * @param {number} efficiency Total Building Efficiency
 * @returns {number} Fee per batch, 0 if unknown
 */
export function calculateProductionFeeBatch(
	building: IBuilding,
	fees: IFIOPlanetFees | null,
	recipeTimeMs: number,
	efficiency: number
): number {
	if (efficiency <= 0) return 0;

	return (
		calculateProductionFeeRate(building, fees) *
		(recipeTimeMs / efficiency / TOTALMSDAY)
	);
}

/**
 * Splits a batch fee over the units the batch produces.
 *
 * A recipe with several outputs splits the fee evenly over all produced
 * units, the same even split the COGM table charges its cost with
 * (`costSplit`): the fee is charged on the order, not on any one of its
 * materials, so no output can claim a smaller share than another.
 * @author raukk
 *
 * @export
 * @param {number} feeBatch Fee of one batch
 * @param {IRecipeMaterial[]} outputs Recipe Outputs
 * @returns {number} Fee per produced unit, 0 without any output
 */
export function calculateProductionFeePerUnit(
	feeBatch: number,
	outputs: IRecipeMaterial[]
): number {
	const unitsPerBatch: number = outputs.reduce(
		(sum, output) => sum + output.material_amount,
		0
	);

	return unitsPerBatch > 0 ? feeBatch / unitsPerBatch : 0;
}

/**
 * Calculates the daily production fee of one continuously producing
 * building. Each batch is charged on its real duration, so a day of
 * production always costs exactly one day of the buildings fee rate:
 * independent of both efficiency and the recipe mix.
 * @author raukk
 *
 * @export
 * @param {IBuilding} building Building Data
 * @param {IFIOPlanetFees | null} fees Planet Fee Data, null if unknown
 * @returns {number} Daily fee as negative cost, 0 if unknown
 */
export function calculateProductionFeeDaily(
	building: IBuilding,
	fees: IFIOPlanetFees | null
): number {
	const feeRate: number = calculateProductionFeeRate(building, fees);
	return feeRate === 0 ? 0 : -1 * feeRate;
}
