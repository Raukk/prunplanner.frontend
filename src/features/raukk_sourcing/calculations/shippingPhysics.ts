// The physical flight model of the game, as it was measured.
// Every constant and every law in this file comes from the Blueprint
// Test Flight campaign, and the calibration section it was read from is
// named at each one. Nothing here is fitted, guessed or rounded beyond
// the range those measurements state.
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
	 * Top cruising speed of the engine in km/s, the ceiling a transit
	 * leg cannot beat however much fuel the slider spends.
	 *
	 * Read off the §1.2 engine sweep as `distance / time` — 11,880 for
	 * the glass engine, 18,740 standard, 26,490 advanced, 35,490
	 * hyperthrust and 9,550 for the fuel saver, whose famous "1.9×
	 * slower" is exactly this number being 0.51× the standard engine's.
	 *
	 * It is MASS INDEPENDENT, which is the whole reason it has to be a
	 * separate term: batch 1 flew the same 43m47s transit empty and with
	 * 5,000 t aboard, at 9,548 km/s both times.
	 */
	topSpeedKmPerSecond: number;
}

/**
 * The five sublight engines and their flight constants.
 *
 * Thrust from calibration §2.1 (derived there from observed
 * `accelMax × emptyMass` over the campaign's builds and verified against
 * three of them), burn rates from §2.1 and the drydock component table
 * of §2.3, top speeds from the §1.2 engine sweep as §11.2 reads it.
 *
 * @author raukk
 */
export const RAUKK_STL_ENGINES: Record<RAUKK_STL_ENGINE, IRaukkStlEngine> = {
	GEN: {
		thrustTonneMetersPerSecondSquared: 50_000,
		fuelRatePerSecond: 0.015,
		topSpeedKmPerSecond: 11_880,
	},
	FSE: {
		thrustTonneMetersPerSecondSquared: 100_000,
		fuelRatePerSecond: 0.0075,
		topSpeedKmPerSecond: 9_550,
	},
	ENG: {
		thrustTonneMetersPerSecondSquared: 125_000,
		fuelRatePerSecond: 0.015,
		topSpeedKmPerSecond: 18_740,
	},
	AEN: {
		thrustTonneMetersPerSecondSquared: 250_000,
		fuelRatePerSecond: 0.02,
		topSpeedKmPerSecond: 26_490,
	},
	HTE: {
		thrustTonneMetersPerSecondSquared: 405_000,
		fuelRatePerSecond: 0.03,
		topSpeedKmPerSecond: 35_490,
	},
};

/**
 * Sublight engine every profile is derived on unless it says otherwise.
 *
 * USER DECISION (2026-08-09): the fuel saver is what the user's fleet
 * flies, so it — not the starter ship's standard engine — is what the
 * app assumes.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_STL_ENGINE: RAUKK_STL_ENGINE = "FSE";

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
 * Hull plate g ratings (calibration §2.2, drydock `MAX_G_FACTOR`).
 *
 * @author raukk
 */
export const RAUKK_HULL_PLATE_G_FACTORS: Record<string, number> = {
	BHP: 8,
	LHP: 10,
	RHP: 11,
	HHP: 13,
	AHP: 15,
};

/**
 * Hull plate g rating every profile is derived on unless it says
 * otherwise.
 *
 * USER DECISION (2026-08-09): Lightweight Hull Plate, which is what the
 * user's fleet wears and, at the time of writing, cheaper than the basic
 * plate anyway. Note that the campaign's damage constants are the LHP
 * baseline too (§6 preamble), so the two agree.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_G_FACTOR: number = RAUKK_HULL_PLATE_G_FACTORS.LHP;

/**
 * Fuel of a takeoff or landing leg, as a multiple of what the engine's
 * RATED burn would spend over the leg (calibration §1.3, §11.1).
 *
 * `fuel = 7.55 × ratedBurn × seconds`, reproducing all fifteen surface
 * legs of batch 9 to a mean absolute error of 0.32 units. It is a
 * per-leg constant: unlike a transit leg, TO and LND ignore the fuel
 * slider entirely.
 *
 * @author raukk
 */
export const RAUKK_SURFACE_LEG_FUEL_FACTOR: number = 7.55;

/**
 * Fuel a transit leg burns per unit of `cruiseSpeed / accelMax`
 * (calibration §11.2).
 *
 * `fuel = 34 × ratedBurn × cruiseSpeed / accelMax`, holding across the
 * thirty transit legs of batch 9 at 33.4 to 35.2 and reproducing
 * batches 1 and 4 and the section 10 flight on two further ships, three
 * masses and two engines. Fuel tracks the Δv a leg buys; the distance
 * never enters it, which is why §7's MIN legs of 148 M, 416 M and
 * 832 M km all cost 37 to 46 units.
 *
 * @author raukk
 */
export const RAUKK_TRANSIT_FUEL_FACTOR: number = 34;

/**
 * Highest fuel slider fraction the model honours (calibration §1.1).
 *
 * The slider is a BUDGET spent per powered transit leg, and the
 * campaign's user practice is 1 % to 10 %, at most 20 % loaded and never
 * beyond 25 %. Anything above is clamped here rather than priced.
 *
 * @author raukk
 */
export const RAUKK_STL_SLIDER_MAX: number = 0.25;

/**
 * Fuel slider position every profile is derived on unless it says
 * otherwise.
 *
 * The GAME'S OWN DEFAULT, which is what a player who does not go looking
 * for the slider is flying (user, 2026-08-09), and batch 10 confirms the
 * budget it buys: a same-system transit leg on a 1,500 unit tank burned
 * 78 to 89 units, against the 75 this fraction of that tank states.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_STL_SLIDER: number = 0.05;

/**
 * What a transit leg spends, as a share of the slider's budget, by the
 * KIND of leg it is (calibration §13.2).
 *
 * A same-system TRA leg is a whole point-to-point flight and spends the
 * whole budget — batch 10's six runs come out at 1.04 to 1.19 times it,
 * drifting up with mass. A DEP or an APP is half such a flight, one end
 * of it, and spends accordingly: batch 9's fifteen DEP legs burned
 * 36.87 units on average against a 75 unit budget, and its fifteen APP
 * legs 47.27. Those two shares ARE the DEP/APP asymmetry §11.2 could not
 * explain — an outbound leg leaves from rest and an inbound one arrives
 * at it, and the game charges them differently.
 *
 * @author raukk
 */
export const RAUKK_TRANSIT_BUDGET_SHARE: Record<
	"transit" | "departure" | "approach",
	number
> = {
	transit: 1,
	departure: 0.49,
	approach: 0.63,
};

/** Which end of a flight a transit leg is, see the budget shares */
export type RAUKK_TRANSIT_LEG = keyof typeof RAUKK_TRANSIT_BUDGET_SHARE;

/**
 * Fuel a transit leg burns at the MIN slider position, units
 * (calibration §1.1, §7 and the batch 9 legs).
 *
 * MIN is its own regime: the leg costs 37 to 49 units whatever the tank,
 * the mass and — most of all — the distance. The midpoint stands in.
 *
 * @author raukk
 */
export const RAUKK_STL_MIN_REGIME_FUEL: number = 40;

/**
 * Surface-to-orbit distance of a typical planet, km (calibration §11.6).
 *
 * The TO and LND legs of batch 9 run 679 km to 34,044 km with a median
 * of 5,300; the leg connects the ship's base to whichever orbit point
 * faces the departure direction, so it is planet-scale but not a planet
 * constant. This is the stand-in until a per-planet term exists.
 *
 * @author raukk
 */
export const RAUKK_REFERENCE_SURFACE_LEG_KM: number = 5_300;

/**
 * In-system transit distance between a PLANET and its warp point, km
 * (calibration §11.6).
 *
 * Batch 9's fifteen planet-side DEP and APP legs: mean 67.3 M km,
 * standard deviation 16.1 M, range 38.4 M to 105.0 M. The body's own
 * orbital radius does NOT predict it (r = +0.10 over those legs) — the
 * warp point is fixed per neighbouring system and the body orbits
 * relative to it — so an average is the honest estimator until warp
 * point positions are known.
 *
 * @author raukk
 */
export const RAUKK_REFERENCE_PLANET_TRANSIT_KM: number = 67_300_000;

/**
 * In-system transit distance between a CX STATION and its warp point, km
 * (calibration §11.6).
 *
 * Batch 9's fifteen station-side legs: mean 20.8 M km, standard
 * deviation 3.2 M, range 14.5 M to 27.4 M — far tighter than the planet
 * legs, because Antares Station orbits close in. A station endpoint is
 * therefore about a third of a planet endpoint, which is the structural
 * reason a CX anchored lane is cheap.
 *
 * @author raukk
 */
export const RAUKK_REFERENCE_STATION_TRANSIT_KM: number = 20_800_000;

/**
 * Hull damage of one landing, PERCENT (calibration §6, §11.7).
 *
 * PLACEHOLDER. §6 finds landing damage a planetary property — 0.001 % to
 * 0.184 % observed — and no law for it; batch 9's six landings average
 * 0.018 % and that mean stands in. Takeoff is always zero. Replace with
 * the per-planet term once the planetary data is fitted.
 *
 * @author raukk
 */
export const RAUKK_LANDING_DAMAGE_PERCENT: number = 0.018;

/**
 * Sublight hull damage in PERCENT per km at zero meteoroid density
 * (calibration §6, confirmed §11.4).
 *
 * `damage% = km × (2.2e-10 + 5.5e-10 × meteoroidDensity)`. Batch 9
 * re-tests it on eleven legs across six systems from density 1.79 to
 * 2.93 and lands at 0.91 to 1.19 times the law; refitting both constants
 * on that data returns 2.67e-10 and 5.47e-10, which is these values
 * inside the noise. Unshielded baseline: Lightweight Hull Plate and
 * nothing else.
 *
 * @author raukk
 */
export const RAUKK_STL_DAMAGE_PERCENT_PER_KM: number = 2.2e-10;

/**
 * The meteoroid density term of the same law, PERCENT per km per unit
 * of density (calibration §6, confirmed §11.4).
 *
 * @author raukk
 */
export const RAUKK_STL_DAMAGE_PERCENT_PER_KM_PER_DENSITY: number = 5.5e-10;

/**
 * FTL jump damage in PERCENT per REAL parsec, reactor independent
 * (calibration §6; §11.3 fits 0.0010 over eight hops of 3.1 to 9.9 pc,
 * which is this value at the panel's three-decimal resolution).
 *
 * @author raukk
 */
export const RAUKK_FTL_DAMAGE_PERCENT_PER_PARSEC: number = 0.0011;

/**
 * FTL fuel burnt per REAL parsec (calibration §11.3).
 *
 * Fitted over the same eight hops at 4.687 units per parsec with a
 * −0.38 unit intercept and a 0.33 unit maximum residual. §3 finds the
 * burn hull independent across 560 to 1,632 m³ but higher on a loaded
 * 5,831 m³ hull, so a profile may still override it.
 *
 * @author raukk
 */
export const RAUKK_FTL_FUEL_UNITS_PER_PARSEC: number = 4.687;

/**
 * Floor and slope of the panel's `FTL speed (max)` against the jump
 * speed a ship actually flies, minutes per REAL parsec (§3, §11.3).
 *
 *     minutesPerParsec = 9.6 + 45.9 / panelParsecsPerHour
 *
 * The panel stat is a ceiling, not a speed: §3's three hulls fly 4 pc in
 * 59m49s, 1h29m and 1h44m at 8.6, 3.9 and 2.8 pc/h, which is 2.14×,
 * 1.45× and 1.21× slower than `60 / speed` — the seed this replaces.
 * Fitted on those three points, worst error 5 %. It is a two parameter
 * fit to three observations, so treat a seeded value as a starting point
 * and let a reference flight beat it; §11.3's own 22.51 min/pc for an
 * 833 m³ hull is what the middle point above is.
 *
 * @author raukk
 */
export const RAUKK_FTL_PANEL_FLOOR_MINUTES_PER_PARSEC: number = 9.6;

/** Slope of the same relation, see the floor above */
export const RAUKK_FTL_PANEL_MINUTES_PER_PARSEC_HOUR: number = 45.9;

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
 * all.
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
 * Seconds of one takeoff or landing leg (calibration §11.1).
 *
 * `distance = ½ × accelMax × seconds²` — the leg is plain constant
 * acceleration over its own length, nothing else. Inverting batch 9's
 * fifteen surface legs for the acceleration returns 77.94 to 78.47 m/s²
 * against the 78.48 their blueprint's 8 g plate caps them at, and TO and
 * LND on the same planet agree to three digits.
 *
 * This replaces the campaign's `3200 / √accelMax`: that constant was
 * `√(2 × distance)` for the one planet it was measured at, which is
 * exactly why it appeared to drift with mass.
 *
 * @author raukk
 *
 * @param {number} km Length of the leg
 * @param {number} accelerationMax Maximum acceleration, m/s²
 * @returns {number} Seconds, zero when the design cannot accelerate
 */
export function raukkSurfaceLegSeconds(
	km: number,
	accelerationMax: number
): number {
	if (accelerationMax <= 0 || km <= 0) return 0;

	return Math.sqrt((2 * km * 1_000) / accelerationMax);
}

/**
 * Fuel of one takeoff or landing leg (calibration §1.3, §11.1).
 *
 * @author raukk
 *
 * @param {number} fuelRatePerSecond Rated engine burn, units per second
 * @param {number} seconds Length of the leg
 * @returns {number} Fuel units
 */
export function raukkSurfaceLegFuel(
	fuelRatePerSecond: number,
	seconds: number
): number {
	return (
		RAUKK_SURFACE_LEG_FUEL_FACTOR * fuelRatePerSecond * Math.max(seconds, 0)
	);
}

/**
 * Fuel budget of one powered transit leg (calibration §1.1, §11.2).
 *
 * The slider spends a fraction of the TANK per leg — 25 % of a 3,500
 * unit tank burned 874 units, 50 % burned 1,734 — and MIN is a separate
 * economy regime of a flat ~40 units. The whole budget is spent even
 * when the engine's top speed makes the last of it useless, which is
 * what batch 1 shows at 25, 50 and 100 %: three prices, one duration.
 *
 * @author raukk
 *
 * A DEP or an APP leg is half a flight and spends a smaller share of it,
 * see {@link RAUKK_TRANSIT_BUDGET_SHARE}.
 *
 * @author raukk
 *
 * @param {number} tankCapacity Sublight tank, fuel units
 * @param {number} sliderFraction Slider, 0 for MIN
 * @param {RAUKK_TRANSIT_LEG} [leg] Kind of leg, a whole flight by default
 * @returns {number} Fuel units spent on the leg
 */
export function raukkTransitFuel(
	tankCapacity: number,
	sliderFraction: number,
	leg: RAUKK_TRANSIT_LEG = "transit"
): number {
	const share: number = RAUKK_TRANSIT_BUDGET_SHARE[leg];

	/*
	 * MIN is its own regime and the share does not apply to it: batch 1
	 * spent 38 to 49 units on whole TRA legs there and batches 4 and 9
	 * spent 37 to 46 on half legs. One flat budget covers both.
	 */
	if (sliderFraction <= 0) return RAUKK_STL_MIN_REGIME_FUEL;

	return (
		share *
		Math.min(sliderFraction, RAUKK_STL_SLIDER_MAX) *
		Math.max(tankCapacity, 0)
	);
}

/**
 * Cruising speed of one transit leg, km/s (calibration §11.2).
 *
 * The leg's fuel buys speed at the rate {@link RAUKK_TRANSIT_FUEL_FACTOR}
 * states, until the engine's own top speed stops it:
 *
 *     cruise = min(topSpeed, fuel × accelMax / (34 × ratedBurn))
 *
 * Both branches are measured. Batch 9's standard engine at 37 units and
 * 78.48 m/s² comes out at 5,693 km/s against 5,790 observed; batch 1's
 * fuel saver at 874 units is far past its ceiling and flies at 9,548
 * against the 9,550 the ceiling states — empty and with 5,000 t aboard
 * alike, which is why the ceiling cannot be a function of mass.
 *
 * @author raukk
 *
 * @param {number} transitFuel Fuel the leg spends, units
 * @param {number} accelerationMax Maximum acceleration, m/s²
 * @param {number} fuelRatePerSecond Rated engine burn, units per second
 * @param {number} topSpeedKmPerSecond Engine ceiling, km/s
 * @returns {number} Cruising speed, km/s
 */
export function raukkCruiseSpeed(
	transitFuel: number,
	accelerationMax: number,
	fuelRatePerSecond: number,
	topSpeedKmPerSecond: number
): number {
	if (accelerationMax <= 0 || fuelRatePerSecond <= 0) return 0;

	const bought: number =
		(Math.max(transitFuel, 0) * accelerationMax) /
		(RAUKK_TRANSIT_FUEL_FACTOR * fuelRatePerSecond);

	return Math.min(bought, Math.max(topSpeedKmPerSecond, 0));
}

/**
 * Seconds of one transit leg (calibration §11.2).
 *
 * A transit leg is `distance / cruiseSpeed` and nothing more: batch 9's
 * thirty legs, 18 M to 105 M km, each hold a single speed end to end.
 *
 * @author raukk
 *
 * @param {number} km Length of the leg
 * @param {number} cruiseSpeedKmPerSecond Cruising speed
 * @returns {number} Seconds, zero when the design cannot move
 */
export function raukkTransitSeconds(
	km: number,
	cruiseSpeedKmPerSecond: number
): number {
	if (cruiseSpeedKmPerSecond <= 0 || km <= 0) return 0;

	return km / cruiseSpeedKmPerSecond;
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
 * FTL jump damage per parsec, as a FRACTION (calibration §6, §11.3).
 *
 * @author raukk
 *
 * @returns {number} Damage fraction per parsec
 */
export function raukkFtlDamagePerParsec(): number {
	return RAUKK_FTL_DAMAGE_PERCENT_PER_PARSEC / 100;
}

/**
 * Hull damage of one landing, as a FRACTION (calibration §6, §11.7).
 *
 * @author raukk
 *
 * @returns {number} Damage fraction
 */
export function raukkLandingDamage(): number {
	return RAUKK_LANDING_DAMAGE_PERCENT / 100;
}

/**
 * Hull damage of one whole sublight block, as a FRACTION.
 *
 * Both transit legs under the meteoroid law plus the one landing a
 * one-way flight ends with. It needs no design at all — damage is a
 * property of the path — which is why the solver and the presets can ask
 * for it without knowing what is flying.
 *
 * @author raukk
 *
 * @param {number} meteoroidDensity Density of the systems flown
 * @param {number} [planetTransitKm] Planet side leg
 * @param {number} [stationTransitKm] Station side leg
 * @returns {number} Damage fraction of one block
 */
export function raukkStlBlockDamage(
	meteoroidDensity: number,
	planetTransitKm: number = RAUKK_REFERENCE_PLANET_TRANSIT_KM,
	stationTransitKm: number = RAUKK_REFERENCE_STATION_TRANSIT_KM
): number {
	return (
		raukkStlDamage(
			Math.max(planetTransitKm, 0) + Math.max(stationTransitKm, 0),
			meteoroidDensity
		) + raukkLandingDamage()
	);
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

/** One whole sublight block, broken out so the seed can explain it */
export interface IRaukkStlBlock {
	/** Seconds of the surface hop, zero for a station endpoint */
	surfaceSeconds: number;
	/** Seconds of the planet side transit leg */
	planetTransitSeconds: number;
	/** Seconds of the station side transit leg */
	stationTransitSeconds: number;
	/** Whole block, seconds */
	seconds: number;
	/** Whole block, sublight fuel units */
	fuel: number;
	/** Whole block, hull damage FRACTION at the given density */
	damage: number;
	/** Cruising speed both transit legs were flown at, km/s */
	cruiseSpeedKmPerSecond: number;
}

/** What one block costs, beyond the design itself */
export interface IRaukkStlBlockInput {
	/** Maximum acceleration at the load being timed, m/s² */
	accelerationMax: number;
	/** Rated engine burn, units per second */
	fuelRatePerSecond: number;
	/** Engine ceiling, km/s */
	topSpeedKmPerSecond: number;
	/** Sublight tank, fuel units */
	tankCapacity: number;
	/** Fuel slider as a fraction, 0 being MIN */
	sliderFraction: number;
	/** Meteoroid density of the systems flown */
	meteoroidDensity: number;
	/** Surface hop, km; zero when the planet end is a station too */
	surfaceLegKm?: number;
	/** Planet side transit leg, km */
	planetTransitKm?: number;
	/** Station side transit leg, km */
	stationTransitKm?: number;
}

/**
 * One whole sublight block: the powered portion of ONE ONE-WAY FLIGHT
 * between a planet and a CX station (calibration §11.1 to §11.6).
 *
 * The shape is what the panels actually print, not what the v1 model
 * assumed. A planet-to-station flight is
 *
 *     TO (surface → orbit) + DEP (orbit → warp point)
 *     + APP (warp point → orbit) [+ LND]
 *
 * and the return leg is its mirror, so BOTH directions carry exactly one
 * surface hop, one planet side transit and one station side transit —
 * which is why a single block can stand for either. The old block —
 * two surface hops and ONE fixed 25 M km transit — was both the wrong
 * shape and, at 25 M km against the measured 67 M and 21 M, far too
 * short: §11.7 measures the resulting model at 0.59× the observed time.
 *
 * The landing's damage is counted once per block for the same reason:
 * one of the two directions ends on a surface.
 *
 * @author raukk
 *
 * @param {IRaukkStlBlockInput} input Design, slider and distances
 * @returns {IRaukkStlBlock} Time, fuel and damage of one block
 */
export function raukkStlBlock(input: IRaukkStlBlockInput): IRaukkStlBlock {
	const surfaceKm: number =
		input.surfaceLegKm ?? RAUKK_REFERENCE_SURFACE_LEG_KM;
	const planetKm: number =
		input.planetTransitKm ?? RAUKK_REFERENCE_PLANET_TRANSIT_KM;
	const stationKm: number =
		input.stationTransitKm ?? RAUKK_REFERENCE_STATION_TRANSIT_KM;

	/**
	 * Seconds and fuel of one transit leg of a given kind and length.
	 *
	 * Both ends of the block are HALF flights — a departure out of one
	 * system and an approach into the other — and the game charges the
	 * two differently, so each carries its own budget share.
	 */
	function transit(km: number, leg: RAUKK_TRANSIT_LEG): [number, number] {
		const fuel: number = raukkTransitFuel(
			input.tankCapacity,
			input.sliderFraction,
			leg
		);

		return [
			raukkTransitSeconds(
				km,
				raukkCruiseSpeed(
					fuel,
					input.accelerationMax,
					input.fuelRatePerSecond,
					input.topSpeedKmPerSecond
				)
			),
			fuel,
		];
	}

	/*
	 * Which end is which depends on the direction flown: outbound the
	 * planet leg is the departure and the station leg the approach,
	 * inbound the other way round. One block stands for either, so it
	 * takes the mean of the two — which is exactly right for the round
	 * trip the chain math prices, and unbiased for a single leg.
	 */
	const [planetOut, fuelOut] = transit(planetKm, "departure");
	const [planetIn] = transit(planetKm, "approach");
	const [stationOut, fuelIn] = transit(stationKm, "approach");
	const [stationIn] = transit(stationKm, "departure");

	const planetTransitSeconds: number = (planetOut + planetIn) / 2;
	const stationTransitSeconds: number = (stationOut + stationIn) / 2;

	const surfaceSeconds: number = raukkSurfaceLegSeconds(
		surfaceKm,
		input.accelerationMax
	);

	const cruise: number = raukkCruiseSpeed(
		raukkTransitFuel(input.tankCapacity, input.sliderFraction),
		input.accelerationMax,
		input.fuelRatePerSecond,
		input.topSpeedKmPerSecond
	);

	return {
		surfaceSeconds,
		planetTransitSeconds,
		stationTransitSeconds,
		seconds: surfaceSeconds + planetTransitSeconds + stationTransitSeconds,
		fuel:
			raukkSurfaceLegFuel(input.fuelRatePerSecond, surfaceSeconds) +
			fuelOut +
			fuelIn,
		damage: raukkStlBlockDamage(
			input.meteoroidDensity,
			planetKm,
			stationKm
		),
		cruiseSpeedKmPerSecond: cruise,
	};
}
