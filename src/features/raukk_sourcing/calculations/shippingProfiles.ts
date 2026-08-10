// Ship hull presets and their calibration defaults.
// Everything here is a pre-fill for the calibration table: the values
// come from the recorded reference flights, no physics is derived
// beyond what those logs state.

// Calculations
import {
	RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
	RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
} from "@/features/raukk_sourcing/calculations/shippingCadence";
import { RAUKK_CX_ANCHOR_NEAREST } from "@/features/raukk_sourcing/calculations/shippingFlows";
import {
	IRaukkStlBlock,
	RAUKK_DEFAULT_G_FACTOR,
	RAUKK_DEFAULT_STL_ENGINE,
	RAUKK_DEFAULT_STL_SLIDER,
	RAUKK_FTL_FUEL_UNITS_PER_PARSEC,
	RAUKK_REFERENCE_METEOROID_DENSITY,
	RAUKK_STL_ENGINES,
	RAUKK_STL_TANKS,
	raukkAccelerationMax,
	raukkFtlDamagePerParsec,
	raukkStlBlock,
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
 * The one reactor a preset is OFFERED under.
 *
 * Both reactors fly at about the same speed and burn about the same
 * fuel, so two rows per hull only ever asked the user a question whose
 * answer changed nothing. The add row therefore offers the quick-charge
 * build alone and a user who wants the standard one calibrates a profile
 * for it. Presets for both keep being BUILT — a stored fleet, chain
 * assignment or snapshot naming a `-standard` id has to keep resolving
 * to a real profile — they are simply no longer suggested.
 *
 * @author raukk
 */
export const RAUKK_OFFERED_FTL_REACTOR: RAUKK_FTL_REACTOR = "quick-charge";

/**
 * Drive marker an STL-only preset id carries in place of a reactor.
 *
 * A hull without an FTL drive has no reactor to name, and naming one
 * anyway would collide with the FTL build of the same hull — which is
 * the whole point of a separate id: `stlOnly` used to be a flag ON the
 * shared profile, so ticking it on the LCB turned EVERY LCB in the
 * account into an STL hull. The two builds are different ship types and
 * now say so.
 *
 * @author raukk
 */
export const RAUKK_STL_DRIVE: string = "stl";

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
 * calibration campaign measures the two independently and they turn
 * out to be nothing alike: a jump costs a flat 0.0011 % per parsec
 * whatever the reactor does, while the sublight block carries the
 * meteoroid law over both its transit legs and dominates every FTL trip.
 * Both stay user editable.
 */
const DEFAULT_DAMAGE_PER_PARSEC: number = raukkFtlDamagePerParsec();

/** One ship available per profile, per the implementer default */
const DEFAULT_SHIPS_AVAILABLE: number = 1;

/**
 * A build the campaign actually flew, as the preset table derives from.
 *
 * The three time constants below are MEASURED per build; everything a
 * sublight block costs is DERIVED from the §11 laws for the same build
 * on the app's default engine and plate, so that changing a physical
 * constant moves the presets with it instead of leaving them stranded
 * at a number nobody can re-derive.
 */
interface IRaukkReferenceBuild {
	hull: IRaukkShipHull;
	ftlReactor: RAUKK_FTL_REACTOR;
	/** Operating empty mass of the FTL build, tonnes */
	emptyMassTons: number;
	/** Sublight tank the build carries, fuel units */
	stlTankCapacity: number;
	minutesPerParsec: number;
	chargeMinutes: number;
	ftlFuelPerParsec: number;
}

/**
 * The three hull classes the campaign covers, on the app's default
 * build.
 *
 * A one way flight is exactly ONE sublight block in this model, and
 * §11.6 settles what that block contains: a surface hop, a planet side
 * transit leg and a station side transit leg. USER DECISION
 * (2026-08-09): every preset is derived on the fuel-saving engine and
 * the Lightweight Hull Plate, because that is what the user's fleet
 * flies — so the ENG builds the campaign happened to fly appear here
 * only through their measured FTL constants and their empty mass.
 *
 * - 500/500, the SCB of batch 9 (BP-WWKM-6763 masses, §intro: 638 t as
 *   an FTL build; the batch flew a 1,500 u SSL tank). Its FTL constants
 *   are that batch's own eight-hop fit: 22.51 min and 4.687 units per
 *   REAL parsec, and 4m53s of charge measured seven times.
 * - 3000/1000, the WCB the campaign flew as BP-EXRX-5540 and §10 flew
 *   live. 26.5 min per parsec is that flight's own (4 pc in 1h44m over
 *   3.93 real parsecs); the burn is batch 3's 168 units over 36 parsecs,
 *   which agrees with batch 9's 4.687 to within a percent. Empty mass
 *   925 t: the measured 931 t ENG build with the lighter engine.
 * - 5000/5000, the HCB of batches 1 and 7. 33 min per parsec is batch
 *   7's 14 pc in 7h44m, and 5.83 units per parsec its 268 over 46 — the
 *   one burn the campaign finds ABOVE the flat rate, on a loaded
 *   5,831 m³ hull, which is why it stays per profile.
 *
 * Charge times: the standard reactor rows take batch 9's 4m53s, which
 * §3's 6m06s on a 5,831 m³ hull corroborates as the same order. The
 * quick-charge row keeps its round 5 reading — nothing in the campaign
 * isolates a QCR charge — and is the last unmeasured constant here.
 *
 * The uncovered profiles copy the nearest of these three, see
 * {@link raukkNearestCalibration}.
 */
const REFERENCE_BUILDS: IRaukkReferenceBuild[] = [
	{
		hull: { cargoWeight: 500, cargoVolume: 500 },
		ftlReactor: "standard",
		emptyMassTons: 638,
		stlTankCapacity: RAUKK_STL_TANKS.SSL,
		minutesPerParsec: 22.51,
		chargeMinutes: 293 / 60,
		ftlFuelPerParsec: RAUKK_FTL_FUEL_UNITS_PER_PARSEC,
	},
	{
		hull: { cargoWeight: 3000, cargoVolume: 1000 },
		ftlReactor: "standard",
		emptyMassTons: 925,
		stlTankCapacity: RAUKK_STL_TANKS.MSL,
		minutesPerParsec: 26.5,
		chargeMinutes: 293 / 60,
		ftlFuelPerParsec: 168 / 36,
	},
	{
		hull: { cargoWeight: 5000, cargoVolume: 5000 },
		ftlReactor: "quick-charge",
		emptyMassTons: 1850,
		stlTankCapacity: RAUKK_STL_TANKS.MSL,
		minutesPerParsec: 33,
		chargeMinutes: 74 / 60,
		ftlFuelPerParsec: 105 / 18,
	},
];

/**
 * One sublight block of a reference build at a given cargo load.
 *
 * @author raukk
 *
 * @param {IRaukkReferenceBuild} build Reference build
 * @param {number} cargoTons Cargo aboard
 * @returns {IRaukkStlBlock} Time, fuel and damage of one block
 */
function referenceBlock(
	build: IRaukkReferenceBuild,
	cargoTons: number
): IRaukkStlBlock {
	const engine = RAUKK_STL_ENGINES[RAUKK_DEFAULT_STL_ENGINE];

	return raukkStlBlock({
		accelerationMax: raukkAccelerationMax(
			engine.thrustTonneMetersPerSecondSquared,
			build.emptyMassTons + cargoTons,
			RAUKK_DEFAULT_G_FACTOR
		),
		fuelRatePerSecond: engine.fuelRatePerSecond,
		topSpeedKmPerSecond: engine.topSpeedKmPerSecond,
		tankCapacity: build.stlTankCapacity,
		sliderFraction: RAUKK_DEFAULT_STL_SLIDER,
		meteoroidDensity: RAUKK_REFERENCE_METEOROID_DENSITY,
	});
}

/** Hull damage of one block at the reference density, a FRACTION */
const DEFAULT_DAMAGE_PER_STL_BLOCK: number = referenceBlock(
	REFERENCE_BUILDS[0],
	0
).damage;

const TIME_CALIBRATIONS: IRaukkTimeCalibration[] = REFERENCE_BUILDS.map(
	(build) => {
		const empty: IRaukkStlBlock = referenceBlock(build, 0);
		const loaded: IRaukkStlBlock = referenceBlock(
			build,
			build.hull.cargoWeight
		);

		return {
			hull: build.hull,
			ftlReactor: build.ftlReactor,
			minutesPerParsec: build.minutesPerParsec,
			chargeMinutes: build.chargeMinutes,
			stlBlockMinutesEmpty: empty.seconds / 60,
			stlBlockMinutesLoaded: loaded.seconds / 60,
			ftlFuelPerParsec: build.ftlFuelPerParsec,
			stlFuelPerBlock: (empty.fuel + loaded.fuel) / 2,
		};
	}
);

/**
 * Profile id of a hull and reactor combination.
 *
 * @author raukk
 *
 * An STL-only build names {@link RAUKK_STL_DRIVE} instead of a reactor:
 * it carries none, and the FTL build of the same hull already holds the
 * reactor spelling.
 *
 * @param {IRaukkShipHull} hull Cargo hold
 * @param {RAUKK_FTL_REACTOR} ftlReactor FTL reactor
 * @param {boolean} stlOnly Whether the build carries no FTL drive
 * @returns {string} Profile id, e.g. `5000x5000-quick-charge`
 */
export function raukkShipProfileId(
	hull: IRaukkShipHull,
	ftlReactor: RAUKK_FTL_REACTOR,
	stlOnly: boolean = false
): string {
	return `${hull.cargoWeight}x${hull.cargoVolume}-${
		stlOnly ? RAUKK_STL_DRIVE : ftlReactor
	}`;
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
 * @param {boolean} stlOnly Whether the build carries no FTL drive
 * @returns {IRaukkShipProfile} Pre-filled profile
 */
export function raukkShipProfilePreset(
	hull: IRaukkShipHull,
	ftlReactor: RAUKK_FTL_REACTOR,
	stlOnly: boolean = false
): IRaukkShipProfile {
	const calibration: IRaukkTimeCalibration = raukkNearestCalibration(
		hull,
		ftlReactor
	);

	return {
		id: raukkShipProfileId(hull, ftlReactor, stlOnly),
		name: `${hull.cargoWeight}t / ${hull.cargoVolume}m³ ${
			stlOnly ? RAUKK_STL_DRIVE : ftlReactor
		}`,
		cargoWeight: hull.cargoWeight,
		cargoVolume: hull.cargoVolume,
		/*
		 * An STL-only preset still names a reactor it does not carry:
		 * the field is part of the stored shape, the sublight constants
		 * are what the build actually flies on, and keeping the FTL ones
		 * filled means un-ticking the flag restores a working FTL hull
		 * rather than a profile of zeroes.
		 */
		ftlReactor,
		/*
		 * No STL-only run is calibrated — the reference flights are all
		 * FTL flights — so an STL preset copies the sublight half of the
		 * nearest FTL calibration of its own hull. That half is the half
		 * it flies: a gate drops the ship in the destination orbit, and
		 * everything either side of the traversal is a sublight block.
		 */
		stlOnly,
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
		 * A fresh game account starts with TWO SCB ships, so that preset
		 * assumes both; every other hull is bought one at a time. The
		 * game hands out the standard reactor build, but the offered
		 * preset is the quick-charge one — the two are within noise of
		 * each other on speed and fuel — and the assumption follows the
		 * hull the user is actually given a row for.
		 */
		shipsAvailable:
			hull.cargoWeight === 500 &&
			hull.cargoVolume === 500 &&
			ftlReactor === RAUKK_OFFERED_FTL_REACTOR &&
			!stlOnly
				? 2
				: DEFAULT_SHIPS_AVAILABLE,
	};
}

/**
 * Every preset profile: six hulls times two reactor flags, plus the
 * STL-only build of each hull — eighteen.
 *
 * BUILT is not the same as OFFERED. The add row shows one FTL row per
 * hull ({@link RAUKK_OFFERED_FTL_REACTOR}) and its STL-only sibling,
 * while the standard-reactor presets stay here so that every id ever
 * written into a fleet, a chain assignment or a snapshot still resolves
 * to the profile it was costed with.
 *
 * @author raukk
 *
 * @returns {IRaukkShipProfile[]} Preset profiles
 */
export function raukkShipProfilePresets(): IRaukkShipProfile[] {
	return RAUKK_SHIP_HULLS.flatMap((hull) => [
		...RAUKK_FTL_REACTORS.map((reactor) =>
			raukkShipProfilePreset(hull, reactor)
		),
		raukkShipProfilePreset(hull, RAUKK_OFFERED_FTL_REACTOR, true),
	]);
}

/**
 * A ship profile as older payloads and local storage blobs carry it:
 * everything of {@link IRaukkShipProfile}, but the two fuel burn rates
 * of round 5 and the STL-only flag may still be missing.
 */
export type RAUKK_STORED_SHIP_PROFILE = Omit<
	IRaukkShipProfile,
	"ftlFuelPerParsec" | "stlFuelPerBlock" | "stlOnly"
> &
	Partial<
		Pick<
			IRaukkShipProfile,
			"ftlFuelPerParsec" | "stlFuelPerBlock" | "stlOnly"
		>
	>;

/**
 * Fills the fuel burn rates a pre round 5 profile does not carry.
 *
 * Missing rates fall back to the nearest covered reference flight of the
 * profiles own hull and reactor — the same pre-fill a fresh preset gets,
 * so an old override keeps deriving from real numbers instead of burning
 * nothing. Present rates, zero included, are left alone.
 *
 * An absent `stlOnly` is an FTL ship, which is what every profile
 * written before the flag existed was.
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
		stlOnly: profile.stlOnly ?? false,
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
 * Default profile: the SCB 500t / 500m³ starter hull — what every
 * account flies before it configures anything, because it is what the
 * game hands a new player. Quick-charge, like every offered preset.
 */
export const RAUKK_DEFAULT_SHIP_PROFILE_ID: string = raukkShipProfileId(
	{ cargoWeight: 500, cargoVolume: 500 },
	RAUKK_OFFERED_FTL_REACTOR
);

/**
 * Calculation-only assumption for an account that never configured a
 * fleet: the two SCB starter ships of a fresh game account. The hull
 * pick then runs against this instead of a phantom bigger hull.
 *
 * It is never stored and never shown: the fleet slice stays empty and
 * the fleet table lists only the types the user added, so no row ever
 * claims the account owns these ships.
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
		allowUnassignedSources: false,
	};
}
