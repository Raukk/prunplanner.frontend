// Ship hull presets and their calibration defaults.
// Everything here is a pre-fill for the calibration table: the values
// come from the reference flights recorded in
// docs/raukk_sourcing/shipping-decisions.md, no physics is derived
// beyond what those logs state.

// Types & Interfaces
import {
	IRaukkResolvedShipProfile,
	IRaukkShipHull,
	IRaukkShipProfile,
	IRaukkShippingConfig,
	IRaukkShippingPriceResolver,
	IRaukkTimeCalibration,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/**
 * The six hulls players actually fly, lifted out of
 * `PlanVisitationFrequency.vue` (`shipVariants`). The 250/250 hull
 * exists in game but is unused and therefore omitted.
 *
 * @author raukk
 */
export const RAUKK_SHIP_HULLS: IRaukkShipHull[] = [
	{ cargoWeight: 500, cargoVolume: 500 },
	{ cargoWeight: 1000, cargoVolume: 1000 },
	{ cargoWeight: 2000, cargoVolume: 2000 },
	{ cargoWeight: 1000, cargoVolume: 3000 },
	{ cargoWeight: 3000, cargoVolume: 1000 },
	{ cargoWeight: 5000, cargoVolume: 5000 },
];

export const RAUKK_FTL_REACTORS: RAUKK_FTL_REACTOR[] = [
	"standard",
	"quick-charge",
];

/**
 * Cost per parsec and per sublight block are DERIVED, not free.
 *
 * Round 5 decision 2 refines round 1: instead of a shipped zero, a
 * preset leaves both ȼ constants at `null` and the effective value is
 * the fuel burn times the current market price of that fuel — FF for the
 * FTL parsecs, SF for the sublight block. Any number the user types,
 * zero included, is a manual override and always wins.
 */
const DEFAULT_COST_PER_PARSEC: number | null = null;
const DEFAULT_STL_BLOCK_COST: number | null = null;

/**
 * Fuel tickers the derived ȼ constants are priced with.
 *
 * FF is the FTL fuel burnt per parsec, SF the sublight fuel of one
 * block. Both join the snapshots relevant-ticker set while shipping is
 * enabled — an unpriced fuel would silently derive a cost of zero.
 *
 * @author raukk
 */
export const RAUKK_FUEL_TICKERS: { ftl: string; stl: string } = {
	ftl: "FF",
	stl: "SF",
};

/**
 * Hull damage of the reference flights: 0.088% over a 4 parsec leg.
 *
 * The logs cannot separate the per parsec from the per sublight block
 * term — every recorded run flew exactly one block per leg — so the
 * whole observed damage is attributed to the distance term and the
 * block term starts at zero. Both are user editable.
 */
const DEFAULT_DAMAGE_PER_PARSEC: number = 0.00088 / 4;
const DEFAULT_DAMAGE_PER_STL_BLOCK: number = 0;

/** One ship available per profile, per the implementer default */
const DEFAULT_SHIPS_AVAILABLE: number = 1;

/**
 * The two profiles the reference flights actually cover, basis fuel MIN
 * and a practical reactor setting of roughly two thirds.
 *
 * 3000t class, standard reactor: 4 pc in 1h50m at 69% reactor, CHRG 52s,
 * sublight block ~70 min empty and roughly six times that loaded.
 * 5000/5000 quick-charge: ~33 min per parsec at 60% reactor, CHRG 1m14s,
 * block ~150 min empty and ~2.4 times that loaded.
 *
 * Fuel burn, derived from the very same flights (a one way flight is
 * exactly ONE sublight block in this model — the block is its whole
 * DEP/APP/LND portion, which is how the block MINUTES above were read
 * off as well):
 *
 * - 3000t class, standard (BP-TLRI-1286, 18 pc empty): 73 FTL units,
 *   4.06 per parsec. Block fuel from the ANT → ZV-759c pair of the same
 *   class: 108 STL units loaded with 3000 t, 72 empty, so 90 per block
 *   as the mean of the pair — the same empty/loaded average the
 *   calibration solver produces from two observed flights, and the lower
 *   bound the round 5 decision quotes. The 211 STL units of the BP-TLRI
 *   flight itself come from its much higher reactor setting and are not
 *   used.
 * - 5000/5000, quick-charge (18 pc): 105 FTL units either way, 5.83 per
 *   parsec — FTL burn is load independent, exactly as its jump times
 *   are. Block fuel 285 STL units loaded and 237 empty, mean 261.
 *
 * The uncovered ten profiles copy the nearest of these two, see
 * {@link raukkNearestCalibration}. No burn rate is inter- or
 * extrapolated, no physics is invented.
 */
const TIME_CALIBRATIONS: IRaukkTimeCalibration[] = [
	{
		hull: { cargoWeight: 3000, cargoVolume: 1000 },
		ftlReactor: "standard",
		minutesPerParsec: 27.5,
		chargeMinutes: 52 / 60,
		stlBlockMinutesEmpty: 70,
		stlBlockMinutesLoaded: 70 * 6,
		ftlFuelPerParsec: 73 / 18,
		stlFuelPerBlock: (72 + 108) / 2,
	},
	{
		hull: { cargoWeight: 5000, cargoVolume: 5000 },
		ftlReactor: "quick-charge",
		minutesPerParsec: 33,
		chargeMinutes: 74 / 60,
		stlBlockMinutesEmpty: 150,
		stlBlockMinutesLoaded: 150 * 2.4,
		ftlFuelPerParsec: 105 / 18,
		stlFuelPerBlock: (237 + 285) / 2,
	},
];

/**
 * Profile id of a hull and reactor combination.
 *
 * @author raukk
 *
 * @param {IRaukkShipHull} hull Cargo hold
 * @param {RAUKK_FTL_REACTOR} ftlReactor FTL reactor
 * @returns {string} Profile id, e.g. `5000x5000-quick-charge`
 */
export function raukkShipProfileId(
	hull: IRaukkShipHull,
	ftlReactor: RAUKK_FTL_REACTOR
): string {
	return `${hull.cargoWeight}x${hull.cargoVolume}-${ftlReactor}`;
}

/**
 * Time calibration of an arbitrary hull and reactor combination.
 *
 * Only two combinations are covered by measured flights. Everything else
 * copies the nearest covered one, nearest meaning the smallest hull
 * volume difference and, on a tie, the same reactor flag. No values are
 * inter- or extrapolated: copying keeps the pre-fill honest about being
 * a starting point rather than physics.
 *
 * @author raukk
 *
 * @param {IRaukkShipHull} hull Cargo hold
 * @param {RAUKK_FTL_REACTOR} ftlReactor FTL reactor
 * @returns {IRaukkTimeCalibration} Nearest covered calibration
 */
export function raukkNearestCalibration(
	hull: IRaukkShipHull,
	ftlReactor: RAUKK_FTL_REACTOR
): IRaukkTimeCalibration {
	return TIME_CALIBRATIONS.reduce((best, candidate) => {
		const bestDistance: number = Math.abs(
			best.hull.cargoVolume - hull.cargoVolume
		);
		const candidateDistance: number = Math.abs(
			candidate.hull.cargoVolume - hull.cargoVolume
		);

		if (candidateDistance < bestDistance) return candidate;

		if (
			candidateDistance === bestDistance &&
			candidate.ftlReactor === ftlReactor &&
			best.ftlReactor !== ftlReactor
		) {
			return candidate;
		}

		return best;
	});
}

/**
 * Preset ship profile of one hull and reactor combination.
 *
 * @author raukk
 *
 * @param {IRaukkShipHull} hull Cargo hold
 * @param {RAUKK_FTL_REACTOR} ftlReactor FTL reactor
 * @returns {IRaukkShipProfile} Pre-filled profile
 */
export function raukkShipProfilePreset(
	hull: IRaukkShipHull,
	ftlReactor: RAUKK_FTL_REACTOR
): IRaukkShipProfile {
	const calibration: IRaukkTimeCalibration = raukkNearestCalibration(
		hull,
		ftlReactor
	);

	return {
		id: raukkShipProfileId(hull, ftlReactor),
		name: `${hull.cargoWeight}t / ${hull.cargoVolume}m³ ${ftlReactor}`,
		cargoWeight: hull.cargoWeight,
		cargoVolume: hull.cargoVolume,
		ftlReactor,
		costPerParsec: DEFAULT_COST_PER_PARSEC,
		stlBlockCost: DEFAULT_STL_BLOCK_COST,
		ftlFuelPerParsec: calibration.ftlFuelPerParsec,
		stlFuelPerBlock: calibration.stlFuelPerBlock,
		minutesPerParsec: calibration.minutesPerParsec,
		stlBlockMinutesEmpty: calibration.stlBlockMinutesEmpty,
		stlBlockMinutesLoaded: calibration.stlBlockMinutesLoaded,
		chargeMinutes: calibration.chargeMinutes,
		damagePerParsec: DEFAULT_DAMAGE_PER_PARSEC,
		damagePerStlBlock: DEFAULT_DAMAGE_PER_STL_BLOCK,
		shipsAvailable: DEFAULT_SHIPS_AVAILABLE,
	};
}

/**
 * All twelve preset profiles, six hulls times two reactor flags.
 *
 * @author raukk
 *
 * @returns {IRaukkShipProfile[]} Preset profiles
 */
export function raukkShipProfilePresets(): IRaukkShipProfile[] {
	return RAUKK_SHIP_HULLS.flatMap((hull) =>
		RAUKK_FTL_REACTORS.map((reactor) =>
			raukkShipProfilePreset(hull, reactor)
		)
	);
}

/**
 * A ship profile as older payloads and local storage blobs carry it:
 * everything of {@link IRaukkShipProfile}, but the two fuel burn rates
 * of round 5 may still be missing.
 */
export type RAUKK_STORED_SHIP_PROFILE = Omit<
	IRaukkShipProfile,
	"ftlFuelPerParsec" | "stlFuelPerBlock"
> &
	Partial<Pick<IRaukkShipProfile, "ftlFuelPerParsec" | "stlFuelPerBlock">>;

/**
 * Fills the fuel burn rates a pre round 5 profile does not carry.
 *
 * Missing rates fall back to the nearest covered reference flight of the
 * profiles own hull and reactor — the same pre-fill a fresh preset gets,
 * so an old override keeps deriving from real numbers instead of burning
 * nothing. Present rates, zero included, are left alone.
 *
 * @author raukk
 *
 * @param {RAUKK_STORED_SHIP_PROFILE} profile Stored ship profile
 * @returns {IRaukkShipProfile} Complete ship profile
 */
export function raukkCompleteShipProfile(
	profile: RAUKK_STORED_SHIP_PROFILE
): IRaukkShipProfile {
	const calibration: IRaukkTimeCalibration = raukkNearestCalibration(
		{ cargoWeight: profile.cargoWeight, cargoVolume: profile.cargoVolume },
		profile.ftlReactor
	);

	return {
		...profile,
		ftlFuelPerParsec:
			profile.ftlFuelPerParsec ?? calibration.ftlFuelPerParsec,
		stlFuelPerBlock: profile.stlFuelPerBlock ?? calibration.stlFuelPerBlock,
	};
}

/**
 * Derived ȼ per parsec of a profile: FTL burn times the FF price.
 *
 * @author raukk
 *
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {IRaukkShippingPriceResolver} resolvePrice Unit price lookup
 * @returns {number} ȼ per parsec
 */
export function raukkDerivedCostPerParsec(
	profile: IRaukkShipProfile,
	resolvePrice: IRaukkShippingPriceResolver
): number {
	return (
		Math.max(profile.ftlFuelPerParsec, 0) *
		resolvePrice(RAUKK_FUEL_TICKERS.ftl)
	);
}

/**
 * Derived ȼ per sublight block of a profile: STL burn times the SF
 * price.
 *
 * @author raukk
 *
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {IRaukkShippingPriceResolver} resolvePrice Unit price lookup
 * @returns {number} ȼ per sublight block
 */
export function raukkDerivedStlBlockCost(
	profile: IRaukkShipProfile,
	resolvePrice: IRaukkShippingPriceResolver
): number {
	return (
		Math.max(profile.stlFuelPerBlock, 0) *
		resolvePrice(RAUKK_FUEL_TICKERS.stl)
	);
}

/**
 * Resolves a profiles ȼ constants for the pure shipping math.
 *
 * A manually set value wins, whatever it is: a user who types a zero
 * means free freight and gets free freight. Only `null` — the preset
 * state and what an emptied field writes back — derives from the fuel
 * burn and the current market price. Nothing else about the profile is
 * touched, and no price ever reaches the calculation layer.
 *
 * @author raukk
 *
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {IRaukkShippingPriceResolver} resolvePrice Unit price lookup
 * @returns {IRaukkResolvedShipProfile} Profile with resolved ȼ constants
 */
export function raukkResolveShipProfile(
	profile: IRaukkShipProfile,
	resolvePrice: IRaukkShippingPriceResolver
): IRaukkResolvedShipProfile {
	return {
		...profile,
		costPerParsec:
			profile.costPerParsec ??
			raukkDerivedCostPerParsec(profile, resolvePrice),
		stlBlockCost:
			profile.stlBlockCost ??
			raukkDerivedStlBlockCost(profile, resolvePrice),
	};
}

/** Default profile: the plain 1000t / 1000m³ hauler */
export const RAUKK_DEFAULT_SHIP_PROFILE_ID: string = raukkShipProfileId(
	{ cargoWeight: 1000, cargoVolume: 1000 },
	"standard"
);

/**
 * Shipping off, direct routing, same system trips free — the state in
 * which snapshots produce exactly the numbers they did before shipping
 * existed.
 *
 * @author raukk
 *
 * @returns {IRaukkShippingConfig} Default configuration
 */
export function raukkDefaultShippingConfig(): IRaukkShippingConfig {
	return {
		enabled: false,
		defaultProfileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
		routingMode: "direct",
		sameSystemFlatCost: 0,
	};
}
