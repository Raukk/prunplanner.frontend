// Types of the raukk shipping cost model.
// The persisted store slice of Phase 3 reuses these shapes.

// Types & Interfaces
import {
	IRaukkRoute,
	IRaukkRouteDistance,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { RAUKK_LEG_UNROUTABLE } from "@/features/raukk_sourcing/calculations/shippingStl";

/** Slower standard reactor versus the quick-charge one */
export type RAUKK_FTL_REACTOR = "standard" | "quick-charge";

/** Direct route between both planets, or every leg via the nearest CX */
export type RAUKK_ROUTING_MODE = "direct" | "cx-hub";

/** Cargo dimension a direction is limited by */
export type RAUKK_LOAD_DIMENSION = "weight" | "volume";

/** Cargo hold of one of the six real world hulls */
export interface IRaukkShipHull {
	/** Cargo weight capacity in tonnes */
	cargoWeight: number;
	/** Cargo volume capacity in m³ */
	cargoVolume: number;
	/**
	 * Volume of the SHIP, m³ — not of its cargo hold.
	 *
	 * The figure a gate measures: the in-game blueprint screen states it
	 * as "SHIP OVERVIEW → VOLUME", separately from "CARGO → VOLUME
	 * CAPACITY", and a gate's clearance is compared against this one. A
	 * 5,000 m³ hold rides in a ship of about 5,837 m³.
	 *
	 * Absent means DERIVE, see `raukkHullVolumeM3`: the derivation is a
	 * fit against real blueprints and a good default, while this field is
	 * the figure the user read off their own ship and is always believed
	 * over it.
	 */
	hullVolumeM3?: number;
}

/**
 * One named ship configuration: a hull, its FTL reactor and the
 * calibration constants of that combination.
 *
 * Every value is user editable in the calibration table; the presets of
 * `shippingProfiles.ts` only pre-fill them.
 */
export interface IRaukkShipProfile extends IRaukkShipHull {
	id: string;
	name: string;
	ftlReactor: RAUKK_FTL_REACTOR;
	/**
	 * True for a hull built WITHOUT an FTL drive and reactor.
	 *
	 * Such a ship is roughly a quarter cheaper and can still reach any
	 * planet a GATE leads to — gates drop a ship straight into the
	 * destination orbit — but it cannot jump. It therefore serves
	 * same-system legs and legs whose every inter-system hop is a gate
	 * traversal, and NOTHING else: a leg without such a route is a
	 * validation error, never a silent fallback onto the FTL network.
	 *
	 * The FTL constants below (`minutesPerParsec`, `chargeMinutes`,
	 * `ftlFuelPerParsec`, `ftlReactor`, `damagePerParsec`) are then
	 * meaningless. They are kept in the stored shape all the same, so
	 * turning the flag off restores the profile exactly as it was.
	 */
	stlOnly: boolean;
	/**
	 * ȼ per parsec flown, one way. `null` means DERIVE: the effective
	 * value is `ftlFuelPerParsec` times the current FF market price. Any
	 * number — zero included — is a manual override and always wins.
	 */
	costPerParsec: number | null;
	/**
	 * ȼ per sublight block, one per trip direction. `null` means DERIVE
	 * from `stlFuelPerBlock` and the current SF market price.
	 */
	stlBlockCost: number | null;
	/** FTL fuel units burnt per parsec, basis of the derived ȼ/parsec */
	ftlFuelPerParsec: number;
	/** STL fuel units burnt per sublight block, basis of the derived ȼ */
	stlFuelPerBlock: number;
	/** Minutes per parsec flown */
	minutesPerParsec: number;
	/** Minutes of an empty sublight block */
	stlBlockMinutesEmpty: number;
	/** Minutes of a fully loaded sublight block */
	stlBlockMinutesLoaded: number;
	/** Minutes the FTL reactor charges between jumps */
	chargeMinutes: number;
	/** Hull damage per parsec, as a fraction (0.001 = 0.1%) */
	damagePerParsec: number;
	/** Hull damage per sublight block, as a fraction */
	damagePerStlBlock: number;
	/** Ships of this profile available, shipping fraction denominator */
	shipsAvailable: number;
}

/** Time and fuel constants one covered reference flight provides */
export interface IRaukkTimeCalibration {
	hull: IRaukkShipHull;
	ftlReactor: RAUKK_FTL_REACTOR;
	minutesPerParsec: number;
	chargeMinutes: number;
	stlBlockMinutesEmpty: number;
	stlBlockMinutesLoaded: number;
	/** FTL fuel units per parsec of that flight */
	ftlFuelPerParsec: number;
	/** STL fuel units of one sublight block of that flight */
	stlFuelPerBlock: number;
}

/**
 * A ship profile whose ȼ constants are resolved to plain numbers.
 *
 * The persisted {@link IRaukkShipProfile} may leave `costPerParsec` and
 * `stlBlockCost` at `null`, meaning "derive from the fuel burn and the
 * current market price". Every pure calculation consumes THIS shape
 * instead: resolution happens once, in the snapshot layer, through
 * `raukkResolveShipProfile` — the math never sees a price.
 */
export interface IRaukkResolvedShipProfile extends Omit<
	IRaukkShipProfile,
	"costPerParsec" | "stlBlockCost"
> {
	costPerParsec: number;
	stlBlockCost: number;
}

/** Account global shipping configuration */
export interface IRaukkShippingConfig {
	/** Off by default: snapshots then behave exactly as before */
	enabled: boolean;
	defaultProfileId: string;
	routingMode: RAUKK_ROUTING_MODE;
	/** ȼ per trip that stays inside one system, free by default */
	sameSystemFlatCost: number;
	/**
	 * Account default of the production in/out cadence cap, days per
	 * visit. Optional for the one reason every shipping field is: a local
	 * storage blob written before the cadence model has none, and the
	 * resolver defaults it rather than shipping on an undefined cadence.
	 */
	cadenceInOutDays?: number;
	/** Account default of the workforce cadence cap, days per visit */
	cadenceWorkforceDays?: number;
	/**
	 * Exchange every base is anchored at: `"nearest"` — the default — or
	 * the code of one fixed exchange the whole account ships through. A
	 * single plan overrides it with `IRaukkPlanConfig.cxAnchor`.
	 *
	 * The anchor is what makes a REGION: bases sharing one are the bases an
	 * automatic chain may serve in a single loop.
	 */
	cxAnchorMode?: string;
	/**
	 * Whether a plan assigned to NO empire may still act as a source for
	 * the plans that are. Off by default: a base the account does not
	 * operate produces nothing it can hand over, so a configuration still
	 * pointing at one degrades to the market default price and books no
	 * draw — exactly the path a vanished snapshot takes.
	 *
	 * Switched on, the old behaviour returns for the PRICE only: an
	 * unassigned plan is offered in the source dropdown and its cost per
	 * unit is charged again. The account level steps — chains, the fleet
	 * rollup, hub/spoke — ignore its lanes either way, they speak for the
	 * bases the account really runs.
	 *
	 * Optional for the reason every shipping field is: a local storage
	 * blob written before the rule existed has none.
	 */
	allowUnassignedSources?: boolean;
	/** Key: edge key, value: profile id overriding the default */
	perEdgeProfile?: Record<string, string>;
	/** Key: pair key, value: hired ȼ per trip replacing own fleet cost */
	lmRates?: Record<string, number>;
}

/**
 * Cadence caps of one CONSUMING plan, days per visit per cargo bucket.
 *
 * The cap binds the SHIPPING, not the user: a hold that takes 28 days to
 * fill under a 14 day cap flies half full every 14 days, and that partial
 * trip pays a full trip.
 */
export interface IRaukkCadenceCaps {
	production: number;
	workforce: number;
	repair: number;
}

/**
 * Per consuming plan cadence overrides. Any positive day count is legal
 * — 365 included — and REPLACES the account default outright.
 */
export interface IRaukkCadenceOverrides {
	production?: number;
	workforce?: number;
	repair?: number;
}

/**
 * Cargo class one shipped ticker belongs to.
 *
 * The three buckets of the input table (`IRaukkInputBuckets`) as a
 * single valued CARGO identity: production covers the in/out class —
 * production inputs, own outputs and everything sold at an exchange —
 * workforce the consumable demand of the workforce, repair the building
 * repair materials. Cadence caps are set per bucket, so every shipped
 * unit has to name exactly one.
 */
export type RAUKK_CARGO_BUCKET = "production" | "workforce" | "repair";

/** Daily units of one ticker attributed to a single cargo bucket */
export interface IRaukkBucketUnits {
	bucket: RAUKK_CARGO_BUCKET;
	unitsPerDay: number;
}

/** Minimal plan result shape the cargo bucket split reads */
export interface IRaukkBucketSource {
	workforceMaterialIO: { ticker: string; input: number }[];
	productionMaterialIO: { ticker: string; input: number }[];
}

/**
 * Daily cargo of one ticker on one direction of a route pair.
 *
 * Identity is the ticker AND its bucket: a ticker consumed by both
 * production and workforce rides as two rows, so a consumer can
 * attribute cargo per ticker and per class instead of "from base X".
 * Aggregation to weight and volume totals happens at the last moment,
 * in the cost math and the display.
 */
export interface IRaukkShippedTicker {
	ticker: string;
	bucket: RAUKK_CARGO_BUCKET;
	unitsPerDay: number;
	/** Tonnes per unit */
	weightPerUnit: number;
	/** m³ per unit */
	volumePerUnit: number;
}

/**
 * One route pair owned by a plan.
 *
 * `out` is cargo leaving the plan, `back` cargo arriving at it. A
 * sourcing pair only ever fills `back` — a mutual A⇄B relationship keeps
 * at most one direct lane, so its backhaul is structurally empty and the
 * imports carry the full round trip. A CX pair fills `out` with the
 * plans CX sells and `back` with its market buys.
 */
export interface IRaukkShippingPair {
	/** Stable key, also the lookup key of a hired LM rate */
	pairKey: string;
	profile: IRaukkResolvedShipProfile;
	/** One way route, already hub substituted where applicable */
	route: IRaukkRoute;
	/**
	 * Systems the lane connects, and the lookups to route between them.
	 *
	 * All three are optional and carried for ONE purpose: an STL-only
	 * hull has to be checked against the gate network, which `route`
	 * alone cannot answer. Absent — every caller predating STL-only
	 * hulls, the test literals included — an STL-only profile on an
	 * inter-system lane simply cannot be validated and is reported
	 * unservable, which is the safe reading of "no gate route known".
	 */
	fromSystemId?: string;
	toSystemId?: string;
	routes?: IRaukkRouteDistance;
	/**
	 * True when one END of the lane is a marked depot.
	 *
	 * The home an STL-only hull is based at, and therefore the second
	 * condition of offering one automatically — see
	 * `raukkStlOnlyCandidates`. Resolved where the lane is BUILT, the
	 * only place that knows the two PLANETS: everything downstream sees
	 * systems, and a depot is a planet.
	 *
	 * Absent reads as no depot, which is what every lane predating them
	 * was.
	 */
	depotServed?: boolean;
	out: IRaukkShippedTicker[];
	back: IRaukkShippedTicker[];
	/**
	 * Hulls the automatic per leg selection may choose from. Absent — the
	 * state of every caller that knows no fleet — puts `profile` on every
	 * leg, which is exactly what "auto" meant before the cadence model.
	 */
	hulls?: IRaukkHullSelection;
}

/** Cargo of one direction reduced to ship loads */
export interface IRaukkDirectionLoad {
	weightPerDay: number;
	volumePerDay: number;
	/** Ship loads per day, the larger of both dimensions */
	loads: number;
	binding: RAUKK_LOAD_DIMENSION;
	/** Daily amount of the binding dimension, t or m³ */
	bindingPerDay: number;
}

/** One hull the automatic selection may put on a leg */
export interface IRaukkHullCandidate {
	/** Ship type id, which is a ship profile id */
	shipTypeId: string;
	profile: IRaukkResolvedShipProfile;
}

/**
 * The hulls one lane may be flown with.
 *
 * `owned` are the types the fleet holds at least one hull of — the ONLY
 * ones the automatic selection ever assigns. `all` is every known type
 * and exists purely to answer "what would be better", the fleet advisory.
 * A manual assignment wins over both.
 */
export interface IRaukkHullSelection {
	owned: IRaukkHullCandidate[];
	all: IRaukkHullCandidate[];
	/** Ship type the user pinned to this lane, if any */
	manual?: IRaukkHullCandidate;
}

/** Daily cargo of one leg, both directions, reduced to totals */
export interface IRaukkLegDemand {
	weightOutPerDay: number;
	volumeOutPerDay: number;
	weightBackPerDay: number;
	volumeBackPerDay: number;
}

/** One hull measured against the cadence of one leg */
export interface IRaukkHullPick {
	candidate: IRaukkHullCandidate;
	/** Days one hull load takes to accumulate, `Infinity` without cargo */
	fillDays: number;
	/** Days between two visits, `min(capDays, fillDays)` */
	visitDays: number;
	tripsPerDay: number;
}

/**
 * A hull the fleet does NOT own that would serve one leg better.
 *
 * The automatic selection never assigns an unowned hull; it keeps the
 * best owned pick and states the better one here instead, so the fleet
 * page can advise buying it.
 */
export interface IRaukkFleetAdvisory {
	pairKey: string;
	bucket: RAUKK_CARGO_BUCKET;
	/** Ship type the leg flies today */
	shipTypeId: string;
	tripsPerDay: number;
	/** Ship type that would serve it better */
	suggestedShipTypeId: string;
	suggestedTripsPerDay: number;
}

/**
 * One cargo bucket of a lane, flown on its own cadence.
 *
 * A lane splits into up to three legs, one per bucket present on it, and
 * each leg picks its own hull and visits on its own rhythm — the workforce
 * consumables of a base are not worth the trips its production inputs
 * need. Chains are deliberately NOT split this way, they stay one loop.
 */
export interface IRaukkLaneLeg {
	bucket: RAUKK_CARGO_BUCKET;
	shipTypeId: string;
	profile: IRaukkResolvedShipProfile;
	/** Days per visit this bucket may not exceed */
	capDays: number;
	/** Days one hull load takes to accumulate */
	fillDays: number;
	/** Days between two visits, `min(capDays, fillDays)` */
	visitDays: number;
	/** `1 / visitDays`, a partial trip counting as a full one */
	tripsPerDay: number;
	out: IRaukkShippedTicker[];
	back: IRaukkShippedTicker[];
	loadOut: IRaukkDirectionLoad;
	loadBack: IRaukkDirectionLoad;
	/** Unowned hull that would serve this leg better, null when none */
	advisory: IRaukkFleetAdvisory | null;
	/** Why the assigned ship cannot fly this leg, null when it can */
	unservableReason: RAUKK_LEG_UNROUTABLE | null;
}

/** Costed leg of a route pair, see {@link IRaukkLaneLeg} */
export interface IRaukkLegShipping {
	bucket: RAUKK_CARGO_BUCKET;
	shipTypeId: string;
	capDays: number;
	fillDays: number;
	visitDays: number;
	tripsPerDay: number;
	costPerTrip: number;
	repairCostPerTrip: number;
	/** Hull damage per round trip as a fraction, 0 when hired */
	damagePerTrip: number;
	/**
	 * ȼ per trip the OWN fleet would charge for this leg, stated even
	 * while the lane is hired: the hire comparison is what hiring buys,
	 * so it needs the counterfactual and not the rate that replaced it.
	 */
	ownCostPerTrip: number;
	/**
	 * Hull damage per round trip the OWN fleet would take, stated even
	 * while hired, for the same reason as {@link ownCostPerTrip} — part
	 * of what hiring buys is the wear the own hulls are spared.
	 */
	ownDamagePerTrip: number;
	/** Units this leg moves per day, both directions summed */
	unitsPerDay: number;
	dailyCost: number;
	roundTripMinutes: number;
	/** Ship time share of this leg, `null` without a ship count */
	shippingFraction: number | null;
	advisory: IRaukkFleetAdvisory | null;
	/**
	 * Why the assigned ship cannot fly this leg, `null` when it can.
	 *
	 * Only ever `"stl-only-no-gate"` today: an STL-only hull was
	 * assigned to an inter-system lane with no gate route. The leg is
	 * still costed — the cargo does have to move — so the number stays
	 * comparable, and the reason says the assignment is wrong.
	 */
	unservableReason: RAUKK_LEG_UNROUTABLE | null;
}

/** Shipping result of one route pair */
export interface IRaukkPairShipping {
	pairKey: string;
	/** True when a manual LM rate replaced the own fleet cost */
	hired: boolean;
	/** The legs of the pair, one per cargo bucket riding it */
	legs: IRaukkLegShipping[];
	/**
	 * True when at least one leg carries an `unservableReason`: the lane
	 * is priced, but the ship assigned to it cannot fly it.
	 */
	unservable: boolean;
	/** Trips of ALL legs summed, each leg on its own cadence */
	tripsPerDay: number;
	/** Trip weighted mean over the legs: `dailyCost / tripsPerDay` */
	costPerTrip: number;
	/** Trip weighted mean over the legs */
	repairCostPerTrip: number;
	/** Hull damage per trip, trip weighted mean over the legs */
	damagePerTrip: number;
	/** ȼ per day of the whole round trip */
	dailyCost: number;
	roundTripMinutes: number;
	/**
	 * Ship time share of this pair, 0 when hired.
	 *
	 * `null` signals an UNDEFINED fraction: the profile claims a non
	 * positive ship count, so the denominator does not exist. Zero would
	 * read as "no ship time at all", i.e. infinite capacity, which is the
	 * opposite of what an empty ship count means. The schema forbids such
	 * a profile; the signal remains for legacy local storage state.
	 */
	shippingFraction: number | null;
	loadOut: IRaukkDirectionLoad;
	loadBack: IRaukkDirectionLoad;
	/** ȼ per unit leaving the plan, keyed by ticker */
	perUnitOut: Record<string, number>;
	/** ȼ per unit arriving at the plan, keyed by ticker */
	perUnitBack: Record<string, number>;
}

/** Shipping result of all pairs one plan owns */
export interface IRaukkShippingResult {
	pairs: IRaukkPairShipping[];
	/**
	 * Summed ship time utilization over all owned pairs, `null` as soon
	 * as ONE pair has no defined fraction — a sum that silently skips an
	 * unknown term would understate the fleet load.
	 */
	shippingFraction: number | null;
	/** ȼ per unit arriving at the plan, keyed by ticker */
	inbound: Record<string, number>;
	/** ȼ per unit leaving the plan, keyed by ticker */
	outbound: Record<string, number>;
	/** Unowned hulls that would serve one of the legs better */
	advisories: IRaukkFleetAdvisory[];
}

/** Unit price lookup for the repair bill tickers */
export type IRaukkShippingPriceResolver = (ticker: string) => number;
