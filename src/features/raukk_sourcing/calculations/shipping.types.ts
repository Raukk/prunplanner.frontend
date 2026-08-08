// Types of the raukk shipping cost model.
// See docs/raukk_sourcing/shipping-plan.md for the model itself; the
// persisted store slice of Phase 3 reuses these shapes.

// Types & Interfaces
import { IRaukkRoute } from "@/features/raukk_sourcing/calculations/routeDistance";

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
	/** Key: edge key, value: profile id overriding the default */
	perEdgeProfile?: Record<string, string>;
	/** Key: pair key, value: hired ȼ per trip replacing own fleet cost */
	lmRates?: Record<string, number>;
}

/** Daily cargo of one ticker on one direction of a route pair */
export interface IRaukkShippedTicker {
	ticker: string;
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
 * sourcing pair only ever fills `back` — the cycle guard forbids the
 * reverse edge, so its backhaul is structurally empty and the imports
 * carry the full round trip. A CX pair fills `out` with the plans CX
 * sells and `back` with its market buys.
 */
export interface IRaukkShippingPair {
	/** Stable key, also the lookup key of a hired LM rate */
	pairKey: string;
	profile: IRaukkResolvedShipProfile;
	/** One way route, already hub substituted where applicable */
	route: IRaukkRoute;
	out: IRaukkShippedTicker[];
	back: IRaukkShippedTicker[];
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

/** Shipping result of one route pair */
export interface IRaukkPairShipping {
	pairKey: string;
	/** True when a manual LM rate replaced the own fleet cost */
	hired: boolean;
	tripsPerDay: number;
	costPerTrip: number;
	repairCostPerTrip: number;
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
}

/** Unit price lookup for the repair bill tickers */
export type IRaukkShippingPriceResolver = (ticker: string) => number;
