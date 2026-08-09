// Zod schemas of the raukk sourcing store's persisted shape. Used to
// validate JSON import payloads before they replace the store state.

import { z } from "zod";

// Calculations
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
	RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
} from "@/features/raukk_sourcing/calculations/shippingCadence";
import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";

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

/**
 * Price of one local market ad. `MANUAL` states the absolute ȼ per unit,
 * a market basis states an offset subtracted from that basis price; the
 * offset may carry any sign and any magnitude, only the resolved price is
 * clamped at >= 0 (see `resolveLocalPrice`).
 *
 * The value must be finite: `NaN` and the infinities compare false
 * against every bound, so they would travel unchecked into every margin
 * the plan reports and re-export as JSON `null`, which no longer
 * imports.
 */
export const RaukkLocalPriceSchema = z.object({
	basis: z.enum(["MANUAL", "BID", "ASK", "MID", "AVG7D", "AVG30D"]),
	value: z.number().finite(),
});

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
	z.object({
		// bought on the local market of the consuming planet
		mode: z.literal("local"),
		price: RaukkLocalPriceSchema,
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
 *
 * `stlOnly` defaults to false: everything persisted before STL-only
 * hulls existed is an FTL ship, and reading an absent flag as anything
 * else would silently un-route half a fleet.
 */
export const RaukkShipProfileSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	cargoWeight: z.number().positive(),
	cargoVolume: z.number().positive(),
	ftlReactor: RaukkFtlReactorSchema,
	// raukk: STL-only hulls carry no FTL drive and route over gates
	// alone. Defaulted, so every profile persisted before the flag
	// existed parses as the FTL ship it was.
	stlOnly: z.boolean().default(false),
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
 * parse into the default state. Shipping defaults to ON, so such
 * payloads come up charging freight; their snapshots predate shipping
 * and keep their freight-free numbers until something marks them stale
 * (a config edit, a plan save, an upstream recompute).
 */
export const RaukkShippingConfigSchema = z.object({
	enabled: z.boolean().default(true),
	defaultProfileId: z.string().default(RAUKK_DEFAULT_SHIP_PROFILE_ID),
	routingMode: RaukkRoutingModeSchema.default("direct"),
	sameSystemFlatCost: z.number().default(0),
	// cadence caps, days per visit: positive day counts only, a zero or
	// negative cap would mean "visit infinitely often"
	cadenceInOutDays: z
		.number()
		.positive()
		.default(RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS),
	cadenceWorkforceDays: z
		.number()
		.positive()
		.default(RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS),
	// "nearest" or a fixed exchange code; an unknown code degrades to the
	// nearest exchange at read time rather than failing the import
	cxAnchorMode: z.string().min(1).default(RAUKK_CX_ANCHOR_NEAREST),
	perEdgeProfile: z.record(z.string(), z.string()).optional(),
	lmRates: z.record(z.string(), z.number()).optional(),
});

/**
 * Per plan cadence overrides. Every bucket is optional — an absent one
 * follows the account default — and any positive day count is legal, 365
 * included: a base whose repair materials weigh a few tonnes is honestly
 * visited once a year. The repair bucket without an override follows the
 * plans own repair day.
 */
export const RaukkCadenceOverridesSchema = z.object({
	production: z.number().positive().optional(),
	workforce: z.number().positive().optional(),
	repair: z.number().positive().optional(),
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
	// raukk: ship profile per SIDE of a split, keyed by the sub chain
	// suffix. Optional: every chain authored before sides existed flies
	// one hull all the way round.
	sideProfiles: z.record(z.string(), z.string()).optional(),
	lmRatePerTrip: z.number().optional(),
	autoCxSplit: z.boolean().optional(),
});

/**
 * One planet marked as a DEPOT: a routing anchor with a warehouse rent,
 * and no market semantics of any kind.
 *
 * raukk: `weeklyCostAic` is optional and non negative — an absent or zero
 * rent is a free handover point, which is a legal depot, while a negative
 * one would pay the user for shipping.
 */
export const RaukkDepotSchema = z.object({
	planetNaturalId: z.string().min(1),
	weeklyCostAic: z.number().nonnegative().optional(),
});

/**
 * One gate the user PLANNED: one going up, or one they wish existed.
 *
 * raukk: fee and clearance are non negative and default to the shipped
 * gut numbers, so a payload written by a future version that drops one of
 * them still imports. `enabled` defaults OFF — importing a backup must
 * never silently re-route an account over gates that do not exist.
 */
export const RaukkPlannedGateSchema = z.object({
	id: z.string().min(1),
	name: z.string().optional(),
	planetA: z.string().min(1),
	planetB: z.string().min(1),
	fee: z.number().nonnegative().default(4000),
	// raukk: upgrade levels of EACH end, capped as the game caps them.
	// They replace the free-form clearance the first version stored, which
	// stays readable as an optional legacy field
	capacityUpgrades: z.number().int().min(0).max(5).default(0),
	volumeUpgrades: z.number().int().min(0).max(3).default(0),
	rangeUpgrades: z.number().int().min(0).max(3).default(0),
	maxM3: z.number().nonnegative().optional(),
	enabled: z.boolean().default(false),
	status: z.enum(["construction", "proposed"]).default("proposed"),
	note: z.string().optional(),
});

/** Account wide chain knobs, every field defaulted like the v1 config */
export const RaukkChainConfigSchema = z.object({
	cxSplitDetourParsecs: z.number().default(6),
	legUtilizationSplitThreshold: z.number().default(0.25),
	densityRef: z.number().positive().default(3.28),
	stlCostPerMegameter: z.number().default(0),
	autoCxSplit: z.boolean().default(true),
	sameSystemPricing: z.enum(["average", "worst"]).default("average"),
	// automatic chains: a share of the shipment and two detour budgets,
	// all three documented gut numbers of shipping-cadence-plan.md phase 2
	autoChainMinShare: z.number().min(0).max(1).default(0.05),
	autoChainDetourInOutParsecs: z.number().nonnegative().default(2),
	autoChainDetourLooseParsecs: z.number().nonnegative().default(6),
});

/** Cargo class of one shipped flow, see `RAUKK_CARGO_BUCKET` */
export const RaukkCargoBucketSchema = z.enum([
	"production",
	"workforce",
	"repair",
]);

/**
 * One frozen plan flow. `ownerPlanUuid` is additive and optional: flows
 * frozen before ownership was carried know no owner, and the reader
 * degrades them conservatively rather than guessing one. `bucket` is
 * optional for the very same reason — a flow frozen before the cargo
 * classes existed reads as `production`, the in/out class it carried.
 */
export const RaukkChainFlowSchema = z.object({
	flowId: z.string().optional(),
	ownerPlanUuid: z.string().optional(),
	sourcePlanUuid: z.string().optional(),
	ticker: z.string(),
	bucket: RaukkCargoBucketSchema.optional(),
	fromStop: z.string(),
	toStop: z.string(),
	unitsPerDay: z.number(),
	weightPerUnit: z.number(),
	volumePerUnit: z.number(),
});

/**
 * ȼ per unit one chain charged one claimed flow. `sourcePlanUuid` is
 * additive and optional for the same reason `ownerPlanUuid` is: a result
 * frozen before it existed names no producing plan and degrades to the
 * old per PLANET claim, see `RaukkChainFlowSchema`.
 */
export const RaukkChainFlowCostSchema = z.object({
	ownerPlanUuid: z.string().optional(),
	sourcePlanUuid: z.string().optional(),
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
 * One unowned hull that would serve a leg — or a whole derived chain —
 * better, see the fleet page. Declared above the chain result because
 * that one embeds it.
 */
export const RaukkFleetAdvisorySchema = z.object({
	pairKey: z.string(),
	bucket: RaukkCargoBucketSchema,
	shipTypeId: z.string(),
	tripsPerDay: z.number(),
	suggestedShipTypeId: z.string(),
	suggestedTripsPerDay: z.number(),
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
			// raukk: absent on every result written before depots anchored
			anchorKind: z.enum(["cx", "depot"]).optional(),
		})
		.nullable()
		.default(null),
	tripsPerDay: z.number(),
	roundTripMinutes: z.number(),
	bindingLegIndex: z.number(),
	dailyCost: z.number(),
	shippingFraction: z.number(),
	shipMinutesPerDay: z.number(),
	// absent on results computed before the wear rollup
	damagePerDay: z.number().optional(),
	flows: z.array(RaukkChainFlowCostSchema).default([]),
	perUnit: z.record(z.string(), z.number()).default({}),
	memberPlanUuids: z.array(z.string()).default([]),
	config: RaukkChainConfigSchema.prefault({}),
	// derived chains: absent on every result written before phase 2 and
	// on every user authored chain
	auto: z.boolean().optional(),
	// absent on every result written before the reason existed; an
	// unknown value simply reads as "no reason stated" rather than
	// failing the users whole import
	autoReason: z.enum(["supply", "partial", "neighbours"]).optional(),
	capDays: z.number().positive().optional(),
	advisories: z.array(RaukkFleetAdvisorySchema).default([]),
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

/**
 * One leg of a lane. `bucket` and `visitDays` are optional: a snapshot
 * frozen before the cadence model carried one row per LANE and knew
 * neither.
 */
export const RaukkSnapshotLaneSchema = z.object({
	pairKey: z.string(),
	bucket: RaukkCargoBucketSchema.optional(),
	shipTypeId: z.string(),
	visitDays: z.number().optional(),
	tripsPerDay: z.number(),
	roundTripMinutes: z.number(),
	hired: z.boolean(),
	// absent on snapshots frozen before the wear rollup
	damagePerTrip: z.number().optional(),
});

export const RaukkPlanConfigSchema = z.object({
	repairDay: RaukkRepairDaySchema,
	sources: z.record(z.string(), RaukkTickerSourceSchema),
	// output tickers sold on the local market, absent in every payload
	// predating the local market model
	localSales: z.record(z.string(), RaukkLocalPriceSchema).optional(),
	// absent in every payload predating the cadence model
	cadence: RaukkCadenceOverridesSchema.optional(),
	// exchange this plan is anchored at, absent means the account mode
	cxAnchor: z.string().min(1).optional(),
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
	// frozen alongside the numbers they priced, they back the read only
	// sourced cost notes; absent in payloads predating those notes
	inputPrices: z.record(z.string(), z.number()).optional(),
	sellPrices: z.record(z.string(), z.number()).optional(),
	// v2: only written while shipping is enabled, absent in every payload
	// written before the chain and fleet slices existed
	flows: z.array(RaukkChainFlowSchema).optional(),
	lanes: z.array(RaukkSnapshotLaneSchema).optional(),
	// cadence model: absent in every payload written before it
	advisories: z.array(RaukkFleetAdvisorySchema).optional(),
	// null: the profile of a pair claims no ship at all, so the fraction
	// has no denominator and is displayed as an em-dash
	shippingFraction: z.number().nullable().optional(),
	// storage cross-check input of the shipping page; null when the plan
	// result carried no storage block, absent in payloads predating it
	storageFilledDays: z.number().nullable().optional(),
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
	// raukk: fleet page spillover display flag, defaulted on — every
	// payload written before the display existed knows nothing of it,
	// while an explicitly persisted false always wins over the default
	fleetSpillover: z.boolean().default(true),
	chainConfig: RaukkChainConfigSchema.prefault({}),
	// raukk: depots, keyed by planet natural id. Defaulted for the very
	// same reason the five v2 slices are: every payload written before
	// depots existed knows none.
	depots: z.record(z.string(), RaukkDepotSchema).default({}),
	// raukk: planned gates, keyed by their own id. Same rule as depots —
	// every payload written before the gate planning tool knows none.
	plannedGates: z.record(z.string(), RaukkPlannedGateSchema).default({}),
});

export type RaukkSourcingExportType = z.infer<typeof RaukkSourcingExportSchema>;

/** Payload version written by the current implementation */
export const RAUKK_SOURCING_EXPORT_VERSION: number = 1;
