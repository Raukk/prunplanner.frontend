// The physical flight model of the game, as it was measured.
// Every constant and every law in this file is sourced from
// docs/raukk_sourcing/shipping-calibration.md — the record of the
// Blueprint Test Flight campaign — and the section it comes from is
// named at each one. Nothing here is fitted, guessed or rounded beyond
// the range that document states.
// Pure functions over plain numbers: no store, no Vue, no assets.

/**
 * Standard gravity in m/s², the factor a hull's g rating is expressed
 * in (calibration §2.2: `accelMax = min(thrust / grossMass, gCap ×
 * 9.81)`).
 *
 * @author raukk
 */
export const RAUKK_STANDARD_GRAVITY: number = 9.81;

/** Sublight engine of a blueprint, by its in-game three letter code */
export type RAUKK_STL_ENGINE = "GEN" | "FSE" | "ENG" | "AEN" | "HTE";

/** What one sublight engine contributes to the flight model */
export interface IRaukkStlEngine {
	/**
	 * Thrust in tonne × m/s², so that `thrust / grossMassTons` is an
	 * acceleration in m/s² (calibration §2.1).
	 */
	thrustTonneMetersPerSecondSquared: number;
	/** Rated burn in fuel units per second (calibration §2.1, §2.3) */
	fuelRatePerSecond: number;
	/**
	 * Factor by which the engine's own TOP SPEED stretches a transit leg
	 * beyond what {@link RAUKK_TRANSIT_TIME_CONSTANT} predicts from the
	 * design's empty acceleration.
	 *
	 * One is the rule: calibration §1.2 finds `√accel × time` constant
	 * across Glass, Standard, Advanced and Hyperthrust. The fuel saver is
	 * the documented EXCEPTION — it trades cap speed for economy and
	 * comes out "~1.9× slower than its accel predicts".
	 *
	 * It is a FLOOR, not a multiplier, because a cap on speed cannot
	 * depend on the load: batch 1 flew the same 43m47s transit empty and
	 * with 5,000 t aboard. See {@link raukkTransitCapSeconds}.
	 */
	speedCapFactor: number;
}

/**
 * The five sublight engines and their flight constants.
 *
 * Thrust from calibration §2.1 (derived there from observed
 * `accelMax × emptyMass` over the campaign's builds and verified against
 * three of them), burn rates from §2.1 and the drydock component table
 * of §2.3, the fuel saver's speed cap penalty from §1.2.
 *
 * @author raukk
 */
export const RAUKK_STL_ENGINES: Record<RAUKK_STL_ENGINE, IRaukkStlEngine> = {
	GEN: {
		thrustTonneMetersPerSecondSquared: 50_000,
		fuelRatePerSecond: 0.015,
		speedCapFactor: 1,
	},
	FSE: {
		thrustTonneMetersPerSecondSquared: 100_000,
		fuelRatePerSecond: 0.0075,
		speedCapFactor: 1.9,
	},
	ENG: {
		thrustTonneMetersPerSecondSquared: 125_000,
		fuelRatePerSecond: 0.015,
		speedCapFactor: 1,
	},
	AEN: {
		thrustTonneMetersPerSecondSquared: 250_000,
		fuelRatePerSecond: 0.02,
		speedCapFactor: 1,
	},
	HTE: {
		thrustTonneMetersPerSecondSquared: 405_000,
		fuelRatePerSecond: 0.03,
		speedCapFactor: 1,
	},
};

/**
 * Sublight tank capacities in fuel units (calibration §2.3).
 *
 * The tank is what the fuel-usage slider is a FRACTION OF, so it — not
 * the engine — sets what a fast transit leg costs.
 *
 * @author raukk
 */
export const RAUKK_STL_TANKS: Record<string, number> = {
	SSL: 1_500,
	MSL: 3_500,
	LSL: 8_000,
};

/**
 * Default sublight tank, the medium one the campaign flew on
 * (calibration §1.1: the slider sweep is quoted against a 3,500 unit
 * MSL).
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_STL_TANK: number = RAUKK_STL_TANKS.MSL;

/**
 * `√(m/s²) × s` of a takeoff or a landing leg (calibration §1.3).
 *
 * The campaign measured 3,130 to 3,300 across all five engines and the
 * whole mass range of batch 1; the midpoint stands in for the law
 * `t = K / √accelMax`. TO and LND share it — §1.3 covers both with one
 * mechanism — and the observed growth of the leg with cargo needs no
 * separate term: gross mass enters through `accelMax` itself.
 *
 * @author raukk
 */
export const RAUKK_TAKEOFF_TIME_CONSTANT: number = 3_200;

/**
 * `√(m/s²) × s` of a transit leg over the campaign's reference distance
 * (calibration §1.2).
 *
 * Measured at 10,400 to 11,000 across the engine sweep on the ~25 M km
 * VH-331a → HRT leg; the midpoint stands in. The constant is tied to
 * that distance, which is exactly what the model's fixed "sublight
 * block" is: see {@link RAUKK_REFERENCE_STL_LEG_KM}.
 *
 * @author raukk
 */
export const RAUKK_TRANSIT_TIME_CONSTANT: number = 10_800;

/**
 * Fuel of a takeoff or landing leg, as a multiple of what the engine's
 * RATED burn would spend over the leg (calibration §1.3).
 *
 * `fuel = 7.55 × ratedBurn × seconds`, verified there on every ship of
 * the campaign including a back-prediction of batch 1. It is a per-trip
 * constant: unlike a transit leg, TO and LND ignore the fuel slider
 * entirely.
 *
 * @author raukk
 */
export const RAUKK_TAKEOFF_FUEL_FACTOR: number = 7.55;

/**
 * Highest fuel slider fraction the model honours (calibration §1.1).
 *
 * The slider is a BUDGET spent per powered transit leg, not a throttle,
 * and the campaign's user practice is 1 % to 10 %, at most 20 % loaded
 * and never beyond 25 %. Anything above is clamped here rather than
 * priced, because a quarter tank per leg already reaches the speed cap.
 *
 * @author raukk
 */
export const RAUKK_STL_SLIDER_MAX: number = 0.25;

/**
 * Reference in-system leg of one sublight block, in km.
 *
 * Batch 1 of the campaign flew VH-331a → HRT at 24.1 to 25.1 M km, and
 * both time constants above are anchored on it. The model's block is a
 * fixed, distance-blind portion of a trip, so it needs one such
 * reference length — this is it.
 *
 * @author raukk
 */
export const RAUKK_REFERENCE_STL_LEG_KM: number = 25_000_000;

/**
 * Sublight hull damage in PERCENT per km at zero meteoroid density
 * (calibration §6).
 *
 * `damage% = km × (2.2e-10 + 5.5e-10 × meteoroidDensity)`, fitted over
 * seven of the eight systems flown. Unshielded baseline: the campaign's
 * ships wore Lightweight Hull Plate and nothing else.
 *
 * @author raukk
 */
export const RAUKK_STL_DAMAGE_PERCENT_PER_KM: number = 2.2e-10;

/**
 * The meteoroid density term of the same law, PERCENT per km per unit
 * of density (calibration §6).
 *
 * @author raukk
 */
export const RAUKK_STL_DAMAGE_PERCENT_PER_KM_PER_DENSITY: number = 5.5e-10;

/**
 * FTL jump damage in PERCENT per parsec, reactor independent
 * (calibration §6: 0.007 % over 6 pc, 0.012 over 11, 0.015 over 14 and
 * 0.009 over 9, across every reactor setting flown).
 *
 * @author raukk
 */
export const RAUKK_FTL_DAMAGE_PERCENT_PER_PARSEC: number = 0.0011;

/**
 * Meteoroid density every density-normalized damage constant of the
 * model is expressed at.
 *
 * Not a calibration finding — it is the anchor the chain math has
 * always normalized towards (`IRaukkChainConfig.densityRef`) — but it
 * belongs next to the damage law, because a per-block damage figure is
 * only meaningful together with the density it was stated at.
 *
 * @author raukk
 */
export const RAUKK_REFERENCE_METEOROID_DENSITY: number = 3.28;

/**
 * Maximum acceleration of a design, m/s² (calibration §2.1).
 *
 * Thrust is fixed, so acceleration falls as cargo is loaded — until the
 * hull's g rating caps it, above which loading cargo costs nothing at
 * all. That cap is the reason a loaded block cannot simply be the empty
 * one times `√(gross / empty)`.
 *
 * @author raukk
 *
 * @param {number} thrust Engine thrust, tonne × m/s²
 * @param {number} grossMassTons Operating empty mass plus cargo
 * @param {number} [gCapFactor] Hull g rating, uncapped when omitted
 * @returns {number} Maximum acceleration, m/s²
 */
export function raukkAccelerationMax(
	thrust: number,
	grossMassTons: number,
	gCapFactor?: number
): number {
	if (grossMassTons <= 0 || thrust <= 0) return 0;

	const unconstrained: number = thrust / grossMassTons;

	if (gCapFactor === undefined || gCapFactor <= 0) return unconstrained;

	return Math.min(unconstrained, gCapFactor * RAUKK_STANDARD_GRAVITY);
}

/**
 * Seconds of one takeoff or landing leg (calibration §1.3).
 *
 * @author raukk
 *
 * @param {number} accelerationMax Maximum acceleration, m/s²
 * @returns {number} Seconds, zero when the design cannot accelerate
 */
export function raukkTakeoffSeconds(accelerationMax: number): number {
	if (accelerationMax <= 0) return 0;

	return RAUKK_TAKEOFF_TIME_CONSTANT / Math.sqrt(accelerationMax);
}

/**
 * Shortest transit leg an engine's top speed allows, in seconds.
 *
 * Anchored on the EMPTY acceleration of the design, which is the only
 * thing calibration §1.2 states the fuel saver's penalty against ("FSE
 * floor 43m47s at 59.8 m/s² and 1,672 t vs ~1,416 s the law predicts").
 * For every other engine the factor is one and the floor never binds,
 * since a loaded ship accelerates less and therefore flies longer than
 * its own empty prediction anyway.
 *
 * @author raukk
 *
 * @param {number} emptyAccelerationMax Empty acceleration, m/s²
 * @param {number} speedCapFactor Engine top speed penalty
 * @returns {number} Seconds, zero when the design cannot accelerate
 */
export function raukkTransitCapSeconds(
	emptyAccelerationMax: number,
	speedCapFactor: number
): number {
	if (emptyAccelerationMax <= 0) return 0;

	return (
		(Math.max(speedCapFactor, 1) * RAUKK_TRANSIT_TIME_CONSTANT) /
		Math.sqrt(emptyAccelerationMax)
	);
}

/**
 * Seconds of one transit leg over the reference distance
 * (calibration §1.2).
 *
 * @author raukk
 *
 * @param {number} accelerationMax Maximum acceleration, m/s²
 * @param {number} [capSeconds] Top speed floor, see the cap above
 * @returns {number} Seconds, zero when the design cannot accelerate
 */
export function raukkTransitSeconds(
	accelerationMax: number,
	capSeconds: number = 0
): number {
	if (accelerationMax <= 0) return 0;

	return Math.max(
		RAUKK_TRANSIT_TIME_CONSTANT / Math.sqrt(accelerationMax),
		Math.max(capSeconds, 0)
	);
}

/**
 * Fuel of one takeoff or landing leg (calibration §1.3).
 *
 * @author raukk
 *
 * @param {number} fuelRatePerSecond Rated engine burn, units per second
 * @param {number} seconds Length of the leg
 * @returns {number} Fuel units
 */
export function raukkTakeoffFuel(
	fuelRatePerSecond: number,
	seconds: number
): number {
	return RAUKK_TAKEOFF_FUEL_FACTOR * fuelRatePerSecond * Math.max(seconds, 0);
}

/**
 * Fuel of one powered transit leg, at either operating point
 * (calibration §1.1).
 *
 * The campaign found two regimes and nothing in between:
 *
 *  - ECONOMY, the slider at MIN. The engine burns at roughly its rated
 *    rate and the leg costs 40 to 90 units whatever its length.
 *  - FAST, any slider setting at all. The slider is a fraction of the
 *    TANK spent per leg — 25 % of a 3,500 unit tank burned 874 units —
 *    independent of engine, mass and distance, and 25 % already reaches
 *    the speed cap, so every setting a player actually uses buys the
 *    same speed at a price they choose.
 *
 * @author raukk
 *
 * @param {number} fuelRatePerSecond Rated engine burn, units per second
 * @param {number} seconds Length of the leg
 * @param {number} tankCapacity Sublight tank, fuel units
 * @param {number} sliderFraction Slider, 0 for MIN
 * @returns {number} Fuel units
 */
export function raukkTransitFuel(
	fuelRatePerSecond: number,
	seconds: number,
	tankCapacity: number,
	sliderFraction: number
): number {
	if (sliderFraction <= 0) return fuelRatePerSecond * Math.max(seconds, 0);

	return (
		Math.min(sliderFraction, RAUKK_STL_SLIDER_MAX) *
		Math.max(tankCapacity, 0)
	);
}

/**
 * Sublight hull damage of one leg, as a FRACTION (0.001 = 0.1 %).
 *
 * @author raukk
 *
 * @param {number} km Length of the leg
 * @param {number} meteoroidDensity Density of the system flown through
 * @returns {number} Damage fraction
 */
export function raukkStlDamage(km: number, meteoroidDensity: number): number {
	return (
		(Math.max(km, 0) *
			(RAUKK_STL_DAMAGE_PERCENT_PER_KM +
				RAUKK_STL_DAMAGE_PERCENT_PER_KM_PER_DENSITY *
					Math.max(meteoroidDensity, 0))) /
		100
	);
}

/**
 * FTL jump damage per parsec, as a FRACTION (calibration §6).
 *
 * @author raukk
 *
 * @returns {number} Damage fraction per parsec
 */
export function raukkFtlDamagePerParsec(): number {
	return RAUKK_FTL_DAMAGE_PERCENT_PER_PARSEC / 100;
}

/**
 * The engine a blueprint flies, inferred from what its Performance
 * block states.
 *
 * The fuel rate alone identifies the fuel saver, the advanced and the
 * hyperthrust engine; 0.015 units per second is shared by the glass and
 * the standard engine, and there the design's own numbers separate them:
 * an engine whose `thrust / emptyMass` falls SHORT of the acceleration
 * the panel reports cannot be the one installed, so the weakest engine
 * that still explains the reading wins. This is the same consistency
 * check calibration §2.1 runs by hand when it verifies GEN at 753 t and
 * ENG at 931 t.
 *
 * @author raukk
 *
 * @param {number} fuelRatePerSecond Rated burn off the panel
 * @param {number} [accelerationMax] Panel acceleration, m/s²
 * @param {number} [emptyMassTons] Operating empty mass
 * @returns {(RAUKK_STL_ENGINE | null)} Engine, null when nothing matches
 */
export function raukkInferStlEngine(
	fuelRatePerSecond: number,
	accelerationMax?: number,
	emptyMassTons?: number
): RAUKK_STL_ENGINE | null {
	const codes: RAUKK_STL_ENGINE[] = (
		Object.keys(RAUKK_STL_ENGINES) as RAUKK_STL_ENGINE[]
	)
		.filter(
			(code) =>
				Math.abs(
					RAUKK_STL_ENGINES[code].fuelRatePerSecond -
						fuelRatePerSecond
				) < 1e-9
		)
		.sort(
			(a, b) =>
				RAUKK_STL_ENGINES[a].thrustTonneMetersPerSecondSquared -
				RAUKK_STL_ENGINES[b].thrustTonneMetersPerSecondSquared
		);

	if (codes.length === 0) return null;
	if (
		codes.length === 1 ||
		accelerationMax === undefined ||
		accelerationMax <= 0 ||
		emptyMassTons === undefined ||
		emptyMassTons <= 0
	)
		return codes[0];

	return (
		codes.find(
			(code) =>
				RAUKK_STL_ENGINES[code].thrustTonneMetersPerSecondSquared /
					emptyMassTons >=
				accelerationMax - 1e-6
		) ?? codes[codes.length - 1]
	);
}
