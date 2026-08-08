// Ship hull presets and their calibration defaults.
// Everything here is a pre-fill for the calibration table: the values
// come from the reference flights recorded in
// docs/raukk_sourcing/shipping-decisions.md, no physics is derived
// beyond what those logs state.

// Calculations
import {
	RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
	RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
} from "@/features/raukk_sourcing/calculations/shippingCadence";
import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";
import {
	RAUKK_REFERENCE_METEOROID_DENSITY,
	RAUKK_REFERENCE_STL_LEG_KM,
	raukkFtlDamagePerParsec,
	raukkStlDamage,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

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
 * Hull damage, split into its two physical terms.
 *
 * The round 5 logs could not separate them — every recorded run flew
 * exactly one block per leg — and so attributed the whole observed
 * damage to the distance term and started the block term at zero. The
 * calibration campaign measures the two independently
 * (docs/raukk_sourcing/shipping-calibration.md §6) and they turn out to
 * be nothing alike: a jump costs a flat 0.0011 % per parsec whatever
 * the reactor does, while the sublight block carries the meteoroid law
 * and dominates every FTL trip. Both stay user editable.
 */
const DEFAULT_DAMAGE_PER_PARSEC: number = raukkFtlDamagePerParsec();
const DEFAULT_DAMAGE_PER_STL_BLOCK: number = raukkStlDamage(
	RAUKK_REFERENCE_STL_LEG_KM,
	RAUKK_REFERENCE_METEOROID_DENSITY
);

/** One ship available per profile, per the implementer default */
const DEFAULT_SHIPS_AVAILABLE: number = 1;

/**
 * The two hull classes the reference flights cover, restated on the
 * calibration campaign's numbers.
 *
 * A one way flight is exactly ONE sublight block in this model: a
 * takeoff, a transit leg and a landing. Where the campaign
 * (docs/raukk_sourcing/shipping-calibration.md) and the round 5 logs
 * disagree the campaign wins, because it flew the Blueprint Test Flight
 * simulator and read exact per-leg tables instead of timing a real trip.
 *
 * - 5000/5000, the HCB of batch 1 (§7, FSE at 1,672 t, VH-331a → HRT at
 *   MIN): TO 6m59s / 24 u and TRA 53m48s / 38 u empty, TO 13m20s / 46 u
 *   and TRA 2h24m / 49 u with 5,000 t aboard. The observed leg ended at
 *   a station and so had no landing; the block adds one at the takeoff's
 *   own cost, since §1.3 covers TO and LND with one mechanism. That
 *   gives 67.8 min / 86 u empty and 170.7 min / 141 u loaded. The jump
 *   speed of 33 min per parsec survives round 5 — batch 7 flies 14 pc in
 *   7h44m — and so does the 5.83 units per parsec, which batch 7
 *   reproduces at 268 u over 46 pc.
 * - 3000/1000, the WCB the campaign flew as BP-EXRX-5540 (§ intro: ENG,
 *   931 t, acceleration capped at 98.1 m/s²). The campaign has no
 *   in-system leg for this hull, so its block is DERIVED from that build
 *   through the §1.2/§1.3 laws rather than read off — 28.9 min / 89 u
 *   empty and 50.8 min / 157 u loaded. Batch 3 corroborates the empty
 *   figure: the same WCB spent 98 sublight units on a one way trip. Its
 *   FTL burn is batch 3's own, 168 units over 36 parsecs.
 *
 * Charge times stay at the round 5 readings: the campaign measures CHRG
 * only on a standard reactor in a 5,831 m³ hull (§3), which is neither
 * of these two rows, and copying it across would be an extrapolation.
 *
 * The uncovered ten profiles copy the nearest of these two, see
 * {@link raukkNearestCalibration}.
 */
const TIME_CALIBRATIONS: IRaukkTimeCalibration[] = [
	{
		hull: { cargoWeight: 3000, cargoVolume: 1000 },
		ftlReactor: "standard",
		minutesPerParsec: 27.5,
		chargeMinutes: 52 / 60,
		stlBlockMinutesEmpty: 28.9,
		stlBlockMinutesLoaded: 50.8,
		ftlFuelPerParsec: 168 / 36,
		stlFuelPerBlock: (89 + 157) / 2,
	},
	{
		hull: { cargoWeight: 5000, cargoVolume: 5000 },
		ftlReactor: "quick-charge",
		minutesPerParsec: 33,
		chargeMinutes: 74 / 60,
		stlBlockMinutesEmpty: 2 * (6 + 59 / 60) + 53.8,
		stlBlockMinutesLoaded: 2 * (13 + 20 / 60) + 144,
		ftlFuelPerParsec: 105 / 18,
		stlFuelPerBlock: (2 * 24 + 38 + (2 * 46 + 49)) / 2,
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
		/*
		 * A fresh game account starts with TWO SCB standard ships, so
		 * that preset assumes both; every other hull is bought one at
		 * a time.
		 */
		shipsAvailable:
			hull.cargoWeight === 500 &&
			hull.cargoVolume === 500 &&
			ftlReactor === "standard"
				? 2
				: DEFAULT_SHIPS_AVAILABLE,
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

/**
 * Default profile: the SCB 500t / 500m³ starter hull, standard
 * reactor — what every account flies before it configures anything,
 * because it is what the game hands a new player.
 */
export const RAUKK_DEFAULT_SHIP_PROFILE_ID: string = raukkShipProfileId(
	{ cargoWeight: 500, cargoVolume: 500 },
	"standard"
);

/**
 * The fleet an unconfigured account is assumed to own: the two SCB
 * starter ships of a fresh game account. Used wherever the fleet
 * store is empty — the hull pick and utilization then run against
 * these instead of a phantom bigger hull.
 *
 * @author raukk
 */
export const RAUKK_STARTER_FLEET: { shipTypeId: string; count: number } = {
	shipTypeId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
	count: 2,
};

/**
 * Shipping on, direct routing, same system trips free — freight is
 * charged out of the box; turning it off restores the numbers snapshots
 * produced before shipping existed. Cadence starts at the shipped caps:
 * production in and out every two weeks, workforce consumables monthly.
 *
 * @author raukk
 *
 * @returns {IRaukkShippingConfig} Default configuration
 */
export function raukkDefaultShippingConfig(): IRaukkShippingConfig {
	return {
		enabled: true,
		defaultProfileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
		routingMode: "direct",
		sameSystemFlatCost: 0,
		cadenceInOutDays: RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
		cadenceWorkforceDays: RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
		cxAnchorMode: RAUKK_CX_ANCHOR_NEAREST,
	};
}
