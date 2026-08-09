import { z } from "zod";

// Types & Interfaces
import {
	IFIOPlanetFees,
	IFIOProductionFeeTable,
} from "@/features/api/fioData.types";
import { WORKFORCE_TYPE } from "@/features/planning/usePlanCalculation.types";

/**
 * FIO workforce level names mapped to internal workforce types.
 * Unknown levels are skipped instead of failing the whole payload.
 */
const FIO_WORKFORCE_LEVEL_MAP: Record<string, WORKFORCE_TYPE> = {
	PIONEER: "pioneer",
	SETTLER: "settler",
	TECHNICIAN: "technician",
	ENGINEER: "engineer",
	SCIENTIST: "scientist",
};

const FIOProductionFeeSchema = z.object({
	Category: z.string(),
	WorkforceLevel: z.string(),
	FeeAmount: z.number(),
	FeeCurrency: z.string().nullable(),
});

/**
 * Parses the relevant fee subset of the FIO /planet/{id} payload and
 * transforms it to the internal planet fee representation.
 */
export const FIOPlanetFeeSchema = z
	.object({
		PlanetNaturalId: z.string(),
		GoverningEntity: z.string().nullable(),
		CurrencyCode: z.string().nullable(),
		BaseLocalMarketFee: z.number().nullable(),
		LocalMarketFeeFactor: z.number().nullable(),
		WarehouseFee: z.number().nullable(),
		EstablishmentFee: z.number().nullable(),
		ProductionFees: z.array(FIOProductionFeeSchema).nullable(),
	})
	.transform((raw): IFIOPlanetFees => {
		const productionFees: IFIOProductionFeeTable = {};

		(raw.ProductionFees ?? []).forEach((fee) => {
			const workforce: WORKFORCE_TYPE | undefined =
				FIO_WORKFORCE_LEVEL_MAP[fee.WorkforceLevel];

			if (!workforce) return;

			if (!productionFees[fee.Category]) {
				productionFees[fee.Category] = {};
			}
			productionFees[fee.Category][workforce] = fee.FeeAmount;
		});

		return {
			planet_natural_id: raw.PlanetNaturalId,
			currency_code: raw.CurrencyCode,
			governing_entity: raw.GoverningEntity,
			base_local_market_fee: raw.BaseLocalMarketFee,
			local_market_fee_factor: raw.LocalMarketFeeFactor,
			warehouse_fee: raw.WarehouseFee,
			establishment_fee: raw.EstablishmentFee,
			production_fees: productionFees,
		};
	});

export type FIOPlanetFeePayloadType = z.infer<typeof FIOPlanetFeeSchema>;
