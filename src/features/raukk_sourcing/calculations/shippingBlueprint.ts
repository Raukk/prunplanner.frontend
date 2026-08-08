// Blueprint-seeded ship profiles: the Performance block of the in-game
// BLUEPRINT panel, turned into the profile constants a ship starts with
// BEFORE a single test flight was entered.
// See docs/raukk_sourcing/shipping-fleet.md, section "Blueprint-seeded
// profiles" — calibration order is blueprint seed → BTF flights refine →
// manual override wins. The physics itself lives in shippingPhysics.ts
// and is sourced from docs/raukk_sourcing/shipping-calibration.md.
// Pure functions, no store and no Vue.

// Calculations
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	RAUKK_DEFAULT_STL_TANK,
	RAUKK_REFERENCE_METEOROID_DENSITY,
	RAUKK_REFERENCE_STL_LEG_KM,
	RAUKK_STANDARD_GRAVITY,
	RAUKK_STL_ENGINE,
	RAUKK_STL_ENGINES,
	raukkAccelerationMax,
	raukkFtlDamagePerParsec,
	raukkInferStlEngine,
	raukkStlDamage,
	raukkTakeoffFuel,
	raukkTakeoffSeconds,
	raukkTransitCapSeconds,
	raukkTransitFuel,
	raukkTransitSeconds,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

// Types & Interfaces
import {
	IRaukkShipHull,
	IRaukkTimeCalibration,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Fuel rate of the fuel-save sublight engine, units per second */
export const RAUKK_FSE_FUEL_RATE_PER_SECOND: number =
	RAUKK_STL_ENGINES.FSE.fuelRatePerSecond;

/** Blueprint Performance stats as the user reads them off the panel */
export interface IRaukkBlueprintStats {
	hull: IRaukkShipHull;
	ftlReactor: RAUKK_FTL_REACTOR;
	/** `FTL speed (max)`, parsec per hour */
	ftlSpeedMaxParsecPerHour?: number;
	/** `Acceleration (max)`, m/s² — the EMPTY design, cap included */
	accelerationMax?: number;
	/** `Operating empty mass`, tonnes */
	operatingEmptyMassTons?: number;
	/** Sublight engine fuel rate, units per second; FSE is the default */
	stlFuelRatePerSecond?: number;
	/** Engine code, inferred from the fuel rate when omitted */
	stlEngine?: RAUKK_STL_ENGINE;
	/** `Max g`, the hull plate and seat rating; inferred when omitted */
	maxGFactor?: number;
	/** Sublight tank capacity, fuel units; the MSL is the default */
	stlTankCapacity?: number;
	/** Fuel-usage slider as a fraction, 0 — the default — being MIN */
	stlFuelSliderFraction?: number;
	/** Meteoroid density the block damage is stated at */
	meteoroidDensity?: number;
}

/** Constants a blueprint seed can state, plus why it could state them */
export interface IRaukkBlueprintSeed {
	minutesPerParsec: number;
	stlBlockMinutesEmpty: number;
	stlBlockMinutesLoaded: number;
	stlFuelPerBlock: number;
	damagePerParsec: number;
	damagePerStlBlock: number;
	/** Codes of the fields the blueprint actually determined */
	seededFields: string[];
	/** Codes of the stats that were missing, see the UI wording */
	missing: string[];
}

/**
 * Margin by which the thrust of an engine has to EXCEED the panel's
 * acceleration before that reading counts as g-capped rather than as a
 * rounded thrust limit.
 *
 * Two percent: an in-game panel reports 59.8 m/s² for a design whose
 * thrust gives 59.81, and reading that as a 6.1 g cap would be wrong.
 * A real cap is nowhere near that close — the campaign's ENG at 931 t
 * shows 98.1 against a thrust limit of 134.3 (calibration §2.1, §2.2).
 */
const RAUKK_G_CAP_MARGIN: number = 1.02;

/** The two acceleration figures a sublight block is timed from */
interface IRaukkDesignAcceleration {
	/** m/s² with an empty hold, undefined when the panel stated nothing */
	empty: number | undefined;
	/** m/s² with the hold full, undefined when the mass is unknown */
	loaded: number | undefined;
}

/**
 * Empty and fully loaded acceleration of a design.
 *
 * `accelMax = min(thrust / grossMass, gCap × 9.81)` (calibration §2.1),
 * and the whole difficulty is that a blueprint panel reports the LEFT
 * side of that minimum only for the empty ship. Three readings resolve
 * it:
 *
 *  - the engine gives thrust, so `thrust / grossMass` is known at any
 *    load;
 *  - a stated `Max g` gives the cap directly;
 *  - and when it is not stated, the panel itself reveals it: an
 *    acceleration BELOW what the engine's thrust would give at the empty
 *    mass is a capped reading, so the panel value IS the cap.
 *
 * Without the engine there is no thrust and no cap to find, and the
 * model falls back to the constant-thrust reading of the panel figure —
 * `thrust = accelerationMax × emptyMass` — which reproduces the plain
 * `√(gross / empty)` scaling the seed used before this file knew any
 * engine constants.
 *
 * @author raukk
 *
 * @param {IRaukkBlueprintStats} stats Blueprint Performance block
 * @param {(RAUKK_STL_ENGINE | null)} engine Engine, null when unknown
 * @returns {IRaukkDesignAcceleration} Empty and loaded acceleration
 */
function accelerationOf(
	stats: IRaukkBlueprintStats,
	engine: RAUKK_STL_ENGINE | null
): IRaukkDesignAcceleration {
	const panel: number | undefined =
		stats.accelerationMax !== undefined && stats.accelerationMax > 0
			? stats.accelerationMax
			: undefined;
	const emptyMass: number | undefined =
		stats.operatingEmptyMassTons !== undefined &&
		stats.operatingEmptyMassTons > 0
			? stats.operatingEmptyMassTons
			: undefined;

	const thrust: number | undefined =
		engine !== null
			? RAUKK_STL_ENGINES[engine].thrustTonneMetersPerSecondSquared
			: panel !== undefined && emptyMass !== undefined
				? panel * emptyMass
				: undefined;

	if (thrust === undefined || emptyMass === undefined)
		return { empty: panel, loaded: undefined };

	/** g rating: stated, else the one the panel reading implies */
	const gCapFactor: number | undefined =
		stats.maxGFactor !== undefined && stats.maxGFactor > 0
			? stats.maxGFactor
			: panel !== undefined &&
				  thrust / emptyMass > panel * RAUKK_G_CAP_MARGIN
				? panel / RAUKK_STANDARD_GRAVITY
				: undefined;

	return {
		empty: panel ?? raukkAccelerationMax(thrust, emptyMass, gCapFactor),
		loaded: raukkAccelerationMax(
			thrust,
			emptyMass + Math.max(stats.hull.cargoWeight, 0),
			gCapFactor
		),
	};
}

/**
 * Profile constants seeded from one blueprint's Performance block.
 *
 * The sublight BLOCK of this model is one one-way flight's powered
 * portion — a takeoff, a transit leg and a landing — and every term of
 * it comes from the calibration campaign:
 *
 *  - TIME. Takeoff and landing each run `3200 / √accelMax` seconds and
 *    the transit leg `10800 / √accelMax` over the campaign's reference
 *    distance (calibration §1.2, §1.3), the fuel saver's transit
 *    stretched by its documented cap-speed penalty. Cargo enters ONLY
 *    through `accelMax`, which is why a g-capped design loses nothing at
 *    all by loading up while a thrust-limited one slows by
 *    `√(gross / empty)`.
 *  - FUEL. Takeoff and landing burn `7.55 × rated rate × seconds`
 *    each, a per-trip constant the slider does not touch (§1.3). The
 *    transit leg has the campaign's two operating points (§1.1): at MIN
 *    it burns at roughly the rated rate, and at any slider setting it
 *    spends that FRACTION OF THE TANK, engine, mass and distance
 *    independent.
 *  - DAMAGE. The jump term is the flat 0.0011 % per parsec, the block
 *    term the meteoroid law over the reference leg (§6).
 *  - `minutesPerParsec` stays `60 / FTL speed (max)`, definitional off
 *    the panel.
 *
 * `ftlFuelPerParsec` is deliberately NOT seeded: calibration §3 finds
 * the FTL burn hull-independent but per-profile — "keep per-profile
 * calibrated burn, not a universal constant" — so no blueprint number
 * determines it and the reference flight keeps it.
 *
 * @author raukk
 *
 * @param {IRaukkBlueprintStats} stats Blueprint Performance block
 * @returns {IRaukkBlueprintSeed} Seeded constants and their provenance
 */
export function raukkBlueprintSeed(
	stats: IRaukkBlueprintStats
): IRaukkBlueprintSeed {
	const nearest: IRaukkTimeCalibration = raukkNearestCalibration(
		stats.hull,
		stats.ftlReactor
	);

	const seededFields: string[] = [];
	const missing: string[] = [];

	const speed: number | undefined = stats.ftlSpeedMaxParsecPerHour;
	let minutesPerParsec: number = nearest.minutesPerParsec;

	if (speed !== undefined && speed > 0) {
		minutesPerParsec = 60 / speed;
		seededFields.push("minutesPerParsec");
	} else {
		missing.push("ftlSpeedMaxParsecPerHour");
	}

	if (stats.accelerationMax === undefined || stats.accelerationMax <= 0)
		missing.push("accelerationMax");

	if (
		stats.operatingEmptyMassTons === undefined ||
		stats.operatingEmptyMassTons <= 0
	)
		missing.push("operatingEmptyMassTons");

	const rate: number =
		stats.stlFuelRatePerSecond ?? RAUKK_FSE_FUEL_RATE_PER_SECOND;
	const engine: RAUKK_STL_ENGINE | null =
		stats.stlEngine ??
		raukkInferStlEngine(
			rate,
			stats.accelerationMax,
			stats.operatingEmptyMassTons
		);
	const speedCapFactor: number =
		engine !== null ? RAUKK_STL_ENGINES[engine].speedCapFactor : 1;

	const acceleration: IRaukkDesignAcceleration = accelerationOf(
		stats,
		engine
	);

	const tank: number = stats.stlTankCapacity ?? RAUKK_DEFAULT_STL_TANK;
	const slider: number = Math.max(stats.stlFuelSliderFraction ?? 0, 0);
	const capSeconds: number = raukkTransitCapSeconds(
		acceleration.empty ?? 0,
		speedCapFactor
	);

	/** Minutes of one whole sublight block at a given acceleration */
	function blockMinutes(accelerationMax: number): number {
		return (
			(2 * raukkTakeoffSeconds(accelerationMax) +
				raukkTransitSeconds(accelerationMax, capSeconds)) /
			60
		);
	}

	/** Fuel units of one whole sublight block at a given acceleration */
	function blockFuel(accelerationMax: number): number {
		return (
			2 * raukkTakeoffFuel(rate, raukkTakeoffSeconds(accelerationMax)) +
			raukkTransitFuel(
				rate,
				raukkTransitSeconds(accelerationMax, capSeconds),
				tank,
				slider
			)
		);
	}

	let stlBlockMinutesEmpty: number = nearest.stlBlockMinutesEmpty;
	let stlBlockMinutesLoaded: number = nearest.stlBlockMinutesLoaded;
	let stlFuelPerBlock: number = nearest.stlFuelPerBlock;

	if (acceleration.empty !== undefined) {
		stlBlockMinutesEmpty = blockMinutes(acceleration.empty);
		seededFields.push("stlBlockMinutesEmpty");

		/*
		 * A design whose loaded acceleration is unknown — no mass on the
		 * panel — keeps the reference ratio between its two blocks rather
		 * than pretending cargo were free.
		 */
		stlBlockMinutesLoaded =
			acceleration.loaded !== undefined
				? blockMinutes(acceleration.loaded)
				: (stlBlockMinutesEmpty * nearest.stlBlockMinutesLoaded) /
					nearest.stlBlockMinutesEmpty;

		if (acceleration.loaded !== undefined)
			seededFields.push("stlBlockMinutesLoaded");

		/*
		 * The flat per block burn of the model is the mean of the empty and
		 * the fully loaded block — the same figure the two flight solver
		 * averages out of its pair of observations.
		 */
		stlFuelPerBlock =
			(blockFuel(acceleration.empty) +
				blockFuel(acceleration.loaded ?? acceleration.empty)) /
			2;

		seededFields.push("stlFuelPerBlock");
	}

	/*
	 * Both damage terms are laws, not readings: they need no blueprint
	 * stat at all, so they are always seeded and always beat a reference
	 * flight that could not tell the two terms apart.
	 */
	const damagePerParsec: number = raukkFtlDamagePerParsec();
	const damagePerStlBlock: number = raukkStlDamage(
		RAUKK_REFERENCE_STL_LEG_KM,
		stats.meteoroidDensity ?? RAUKK_REFERENCE_METEOROID_DENSITY
	);

	seededFields.push("damagePerParsec", "damagePerStlBlock");

	return {
		minutesPerParsec,
		stlBlockMinutesEmpty,
		stlBlockMinutesLoaded,
		stlFuelPerBlock,
		damagePerParsec,
		damagePerStlBlock,
		seededFields,
		missing,
	};
}
