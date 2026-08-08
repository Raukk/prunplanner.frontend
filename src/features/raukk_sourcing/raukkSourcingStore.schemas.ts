// Zod schemas of the raukk sourcing store's persisted shape. Used to
// validate JSON import payloads before they replace the store state.

import { z } from "zod";

// Calculations
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

export const RaukkPriceModeSchema = z.enum([
	"BID",
	"ASK",
	"MID",
	"AVG7D",
	"AVG30D",
]);

export const RaukkRepairDaySchema = z.union([
	z.literal(30),
	z.literal(60),
	z.literal(90),
	z.literal(120),
]);

export const RaukkTickerSourceSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("market"),
		priceMode: RaukkPriceModeSchema,
	}),
	z.object({
		mode: z.literal("plan"),
		// concrete plan uuid or one of the synthetic aggregates
		sourcePlanUuid: z.string().min(1),
	}),
]);

export const RaukkFtlReactorSchema = z.enum(["standard", "quick-charge"]);

export const RaukkRoutingModeSchema = z.enum(["direct", "cx-hub"]);

/**
 * A user edited ship profile. Only overridden profiles are persisted,
 * everything else comes from the presets of `shippingProfiles.ts`, so
 * this schema never has to parse anything a v1 payload could contain.
 */
export const RaukkShipProfileSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	cargoWeight: z.number(),
	cargoVolume: z.number(),
	ftlReactor: RaukkFtlReactorSchema,
	costPerParsec: z.number(),
	stlBlockCost: z.number(),
	minutesPerParsec: z.number(),
	stlBlockMinutesEmpty: z.number(),
	stlBlockMinutesLoaded: z.number(),
	chargeMinutes: z.number(),
	damagePerParsec: z.number(),
	damagePerStlBlock: z.number(),
	shipsAvailable: z.number(),
});

/**
 * Account global shipping configuration. Every field carries a default:
 * there is no migration mechanism, so a v1 export and an existing local
 * storage blob — neither of which knows shipping at all — must still
 * parse into the shipped-off default state.
 */
export const RaukkShippingConfigSchema = z.object({
	enabled: z.boolean().default(false),
	defaultProfileId: z.string().default(RAUKK_DEFAULT_SHIP_PROFILE_ID),
	routingMode: RaukkRoutingModeSchema.default("direct"),
	sameSystemFlatCost: z.number().default(0),
	perEdgeProfile: z.record(z.string(), z.string()).optional(),
	lmRates: z.record(z.string(), z.number()).optional(),
});

export const RaukkPlanConfigSchema = z.object({
	repairDay: RaukkRepairDaySchema,
	sources: z.record(z.string(), RaukkTickerSourceSchema),
	// only ever set on the copy a snapshot embeds, and only while
	// shipping is enabled
	shipping: RaukkShippingConfigSchema.optional(),
});

export const RaukkCostBreakdownSchema = z.object({
	workforce: z.number(),
	repair: z.number(),
	inputs: z.number(),
	shipping: z.number(),
});

export const RaukkOutputCostSchema = z.object({
	ticker: z.string(),
	unitsPerDay: z.number(),
	costPerUnit: z.number(),
	breakdown: RaukkCostBreakdownSchema,
});

export const RaukkSnapshotSchema = z.object({
	computedAt: z.string(),
	stale: z.boolean(),
	planName: z.string(),
	planetNaturalId: z.string(),
	outputs: z.record(z.string(), RaukkOutputCostSchema),
	draws: z.record(z.string(), z.record(z.string(), z.number())),
	config: RaukkPlanConfigSchema.optional(),
	baseFraction: z.number().optional(),
	shippingFraction: z.number().optional(),
});

/**
 * Whole store payload as written by exportJSON.
 *
 * `shipProfiles` and `shippingConfig` are defaulted, not required: a v1
 * payload predates shipping entirely and has to import into the
 * shipped-off default state instead of failing validation.
 */
export const RaukkSourcingExportSchema = z.object({
	version: z.number().int().positive().default(1),
	configs: z.record(z.string(), RaukkPlanConfigSchema),
	snapshots: z.record(z.string(), RaukkSnapshotSchema),
	shipProfiles: z.record(z.string(), RaukkShipProfileSchema).default({}),
	shippingConfig: RaukkShippingConfigSchema.prefault({}),
});

export type RaukkSourcingExportType = z.infer<typeof RaukkSourcingExportSchema>;

/** Payload version written by the current implementation */
export const RAUKK_SOURCING_EXPORT_VERSION: number = 1;
