// Calculation Utils
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";

// Types & Interfaces
import { IBuilding } from "@/features/api/gameData.types";
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
 * Sums a buildings production fee rate per 24h of nominal runtime:
 * worker count x per-worker daily fee rate of the buildings industry,
 * over all workforce tiers. Fees are set per planet by its government.
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

	return Object.entries(WORKFORCE_BUILDING_FIELD_MAP).reduce(
		(sum, [workforce, field]) =>
			sum +
			building[field] * (feeTable[workforce as WORKFORCE_TYPE] ?? 0),
		0
	);
}

/**
 * Calculates the production fee of a single order batch. The game
 * charges fees on the recipes nominal worker-time when an order is
 * started: efficiency shortens the wall-clock duration but scales the
 * fee right back up, so the batch fee uses the unmodified recipe time.
 * @author raukk
 *
 * @export
 * @param {IBuilding} building Building Data
 * @param {IFIOPlanetFees | null} fees Planet Fee Data, null if unknown
 * @param {number} recipeTimeMs Unmodified recipe time in ms
 * @returns {number} Fee per batch, 0 if unknown
 */
export function calculateProductionFeeBatch(
	building: IBuilding,
	fees: IFIOPlanetFees | null,
	recipeTimeMs: number
): number {
	return (
		calculateProductionFeeRate(building, fees) * (recipeTimeMs / TOTALMSDAY)
	);
}

/**
 * Calculates the daily production fee of one continuously producing
 * building. Higher efficiency runs more batches per day, each charged
 * on nominal time, so the daily fee scales with efficiency and is
 * independent of the recipe mix.
 * @author raukk
 *
 * @export
 * @param {IBuilding} building Building Data
 * @param {IFIOPlanetFees | null} fees Planet Fee Data, null if unknown
 * @param {number} efficiency Total Building Efficiency
 * @returns {number} Daily fee as negative cost, 0 if unknown
 */
export function calculateProductionFeeDaily(
	building: IBuilding,
	fees: IFIOPlanetFees | null,
	efficiency: number
): number {
	const feeRate: number = calculateProductionFeeRate(building, fees);
	return feeRate === 0 ? 0 : -1 * feeRate * efficiency;
}
