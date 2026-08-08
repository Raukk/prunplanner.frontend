// Ship hull presets and their calibration defaults.
// Everything here is a pre-fill for the calibration table: the values
// come from the reference flights recorded in
// docs/raukk_sourcing/shipping-decisions.md, no physics is derived
// beyond what those logs state.

// Types & Interfaces
import {
	IRaukkShipHull,
	IRaukkShipProfile,
	IRaukkShippingConfig,
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
 * Cost per parsec and per sublight block default to free.
 *
 * Decision 2 rules out deriving them from fuel prices, so any shipped
 * number would be invented; the user enters the ȼ figures measured on
 * their own runs.
 */
const DEFAULT_COST_PER_PARSEC: number = 0;
const DEFAULT_STL_BLOCK_COST: number = 0;

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
 */
const TIME_CALIBRATIONS: IRaukkTimeCalibration[] = [
	{
		hull: { cargoWeight: 3000, cargoVolume: 1000 },
		ftlReactor: "standard",
		minutesPerParsec: 27.5,
		chargeMinutes: 52 / 60,
		stlBlockMinutesEmpty: 70,
		stlBlockMinutesLoaded: 70 * 6,
	},
	{
		hull: { cargoWeight: 5000, cargoVolume: 5000 },
		ftlReactor: "quick-charge",
		minutesPerParsec: 33,
		chargeMinutes: 74 / 60,
		stlBlockMinutesEmpty: 150,
		stlBlockMinutesLoaded: 150 * 2.4,
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
