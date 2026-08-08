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
 *
 * Capacity rules, deliberately strict: a hull without weight or volume
 * capacity and a fleet without a single ship are not configurations, they
 * are broken data. A hand edited zero capacity used to sail through
 * validation and then produce FREE freight (no load ever fills a hull of
 * size zero) and an undefined shipping fraction; both now fail the
 * import instead. `shipsAvailable` is therefore an integer of at least
 * ONE — the null fraction path of `shipping.ts` stays as the signal for
 * legacy local storage state, which never passes through this schema.
 *
 * Cost rules, round 5: `costPerParsec` and `stlBlockCost` may be null —
 * "derive from the fuel burn and the current market price". Migration of
 * older payloads is deliberately non guessing: an ABSENT value becomes
 * null (derive), a PRESENT one stays exactly what it says, zero
 * included, because a stored zero is indistinguishable from a user who
 * really wants free freight. The two fuel burn rates are optional and
 * fall back to the preset of the same profile id at read time.
 */
export const RaukkShipProfileSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	cargoWeight: z.number().positive(),
	cargoVolume: z.number().positive(),
	ftlReactor: RaukkFtlReactorSchema,
	costPerParsec: z.number().nullable().default(null),
	stlBlockCost: z.number().nullable().default(null),
	ftlFuelPerParsec: z.number().nonnegative().optional(),
	stlFuelPerBlock: z.number().nonnegative().optional(),
	minutesPerParsec: z.number(),
	stlBlockMinutesEmpty: z.number(),
	stlBlockMinutesLoaded: z.number(),
	chargeMinutes: z.number(),
	damagePerParsec: z.number(),
	damagePerStlBlock: z.number(),
	shipsAvailable: z.number().int().min(1),
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

/**
 * One chain: an ordered LOOP of stops, repeats allowed.
 *
 * `stops` is deliberately NOT length checked here — the store action
 * refuses a loop of fewer than two stops with a message the editor can
 * show, while an import of a hand edited payload should not lose the
 * whole store over one broken chain. Everything optional is optional for
 * the usual reason: a v1 or v2.0 payload knows no chains at all.
 */
export const RaukkChainSchema = z.object({
	chainId: z.string().min(1),
	name: z.string().optional(),
	stops: z.array(z.string().min(1)),
	profileId: z.string().optional(),
	lmRatePerTrip: z.number().optional(),
	autoCxSplit: z.boolean().optional(),
});

/** Account wide chain knobs, every field defaulted like the v1 config */
export const RaukkChainConfigSchema = z.object({
	cxSplitDetourParsecs: z.number().default(6),
	legUtilizationSplitThreshold: z.number().default(0.25),
	densityRef: z.number().positive().default(3.28),
	stlCostPerMegameter: z.number().default(0),
	autoCxSplit: z.boolean().default(true),
	sameSystemPricing: z.enum(["average", "worst"]).default("average"),
});

/**
 * One frozen plan flow. `ownerPlanUuid` is additive and optional: flows
 * frozen before ownership was carried know no owner, and the reader
 * degrades them conservatively rather than guessing one.
 */
export const RaukkChainFlowSchema = z.object({
	flowId: z.string().optional(),
	ownerPlanUuid: z.string().optional(),
	ticker: z.string(),
	fromStop: z.string(),
	toStop: z.string(),
	unitsPerDay: z.number(),
	weightPerUnit: z.number(),
	volumePerUnit: z.number(),
});

export const RaukkChainFlowCostSchema = z.object({
	ownerPlanUuid: z.string().optional(),
	ticker: z.string(),
	fromStop: z.string(),
	toStop: z.string(),
	unitsPerDay: z.number(),
	costPerUnit: z.number(),
});

export const RaukkChainCostingSchema = z.object({
	stops: z.array(z.string()),
	tripsPerDay: z.number(),
	roundTripMinutes: z.number(),
	bindingLegIndex: z.number(),
	dailyCost: z.number(),
	shippingFraction: z.number(),
});

/**
 * Stored computation output of one chain. Recomputed by the chain pass,
 * never hand edited, so the shape is validated but nothing is guessed:
 * an incomplete result is broken data, not an old payload.
 */
export const RaukkChainResultSchema = z.object({
	chainId: z.string().min(1),
	computedAt: z.string(),
	stale: z.boolean(),
	profileId: z.string(),
	hired: z.boolean(),
	splitApplied: z.boolean(),
	unsplit: RaukkChainCostingSchema,
	split: z.array(RaukkChainCostingSchema).default([]),
	splitTrigger: z
		.object({
			legIndex: z.number(),
			cxCode: z.string(),
			detourParsecs: z.number(),
		})
		.nullable()
		.default(null),
	tripsPerDay: z.number(),
	roundTripMinutes: z.number(),
	bindingLegIndex: z.number(),
	dailyCost: z.number(),
	shippingFraction: z.number(),
	shipMinutesPerDay: z.number(),
	flows: z.array(RaukkChainFlowCostSchema).default([]),
	perUnit: z.record(z.string(), z.number()).default({}),
	memberPlanUuids: z.array(z.string()).default([]),
	config: RaukkChainConfigSchema.prefault({}),
});

/**
 * One ship type of the fleet. A count of zero is legal and means "none
 * of these any more" — the utilization then has no denominator and is
 * reported as unknown rather than as free capacity.
 */
export const RaukkFleetShipSchema = z.object({
	count: z.number().int().nonnegative(),
	designName: z.string().optional(),
});

export const RaukkSnapshotLaneSchema = z.object({
	pairKey: z.string(),
	shipTypeId: z.string(),
	tripsPerDay: z.number(),
	roundTripMinutes: z.number(),
	hired: z.boolean(),
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
	// v2: only written while shipping is enabled, absent in every payload
	// written before the chain and fleet slices existed
	flows: z.array(RaukkChainFlowSchema).optional(),
	lanes: z.array(RaukkSnapshotLaneSchema).optional(),
	// null: the profile of a pair claims no ship at all, so the fraction
	// has no denominator and is displayed as an em-dash
	shippingFraction: z.number().nullable().optional(),
});

/**
 * Whole store payload as written by exportJSON.
 *
 * `shipProfiles` and `shippingConfig` are defaulted, not required: a v1
 * payload predates shipping entirely and has to import into the
 * shipped-off default state instead of failing validation. The five v2
 * slices — chains, their results, the fleet, the assignments and the
 * chain configuration — follow the very same rule for the very same
 * reason: a v2.0 export knows none of them.
 */
export const RaukkSourcingExportSchema = z.object({
	version: z.number().int().positive().default(1),
	configs: z.record(z.string(), RaukkPlanConfigSchema),
	snapshots: z.record(z.string(), RaukkSnapshotSchema),
	shipProfiles: z.record(z.string(), RaukkShipProfileSchema).default({}),
	shippingConfig: RaukkShippingConfigSchema.prefault({}),
	chains: z.record(z.string(), RaukkChainSchema).default({}),
	chainResults: z.record(z.string(), RaukkChainResultSchema).default({}),
	fleet: z.record(z.string(), RaukkFleetShipSchema).default({}),
	assignments: z.record(z.string(), z.string()).default({}),
	chainConfig: RaukkChainConfigSchema.prefault({}),
});

export type RaukkSourcingExportType = z.infer<typeof RaukkSourcingExportSchema>;

/** Payload version written by the current implementation */
export const RAUKK_SOURCING_EXPORT_VERSION: number = 1;
