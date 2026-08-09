// Types & Interfaces
import { WORKFORCE_TYPE } from "@/features/planning/usePlanCalculation.types";

/**
 * Per-industry production fee rates by workforce tier, in the
 * planet's local currency per 24h of full-time employment per worker.
 */
export type IFIOProductionFeeTable = Record<
	string,
	Partial<Record<WORKFORCE_TYPE, number>>
>;

/**
 * Planet fee data sourced directly from the FIO REST API
 * (government-set local rules: production, market, warehouse and
 * establishment fees).
 */
export interface IFIOPlanetFees {
	planet_natural_id: string;
	currency_code: string | null;
	governing_entity: string | null;
	base_local_market_fee: number | null;
	local_market_fee_factor: number | null;
	warehouse_fee: number | null;
	establishment_fee: number | null;
	production_fees: IFIOProductionFeeTable;
}
