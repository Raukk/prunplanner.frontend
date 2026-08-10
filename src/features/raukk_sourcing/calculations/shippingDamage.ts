// Per-leg hull damage of a flight, summed into a trip estimate. Five
// independent terms, each sourced in docs/raukk_sourcing/
// star-heat-damage.md and shipping-calibration.md section 6: base
// wear and meteoroid impacts over the flown km, the stellar
// (heat + radiation) dose of an inverse-square flux integrated along
// the leg, a flat per-parsec cost on jumps, a flat cost per reactor
// recharge, and an atmospheric term on landing.
//
// The stellar term returns TRUE BOUNDS, not a margin of error. How
// much dose a leg takes depends on the angle it makes to the star,
// which the planet's orbital position sets and the Blueprint Test
// Flight panel does not print — but that angle has a hard best case
// (straight out) and a hard worst case, so `low` and `high` bracket
// every flight the lane can ever produce rather than buffering a
// guess. `expected` is the mean over one orbital period, which is
// what a lane flown repeatedly converges to.
//
// Measured against the 33 transcribed flights: see star-heat-damage.md
// section 7.2 for the containment rate, which `shippingDamage.test.ts`
// asserts so it cannot drift.
//
// `expected` averages a lane lying IN the anchor's orbital plane, which
// sweeps the widest range of angles there is. A lane tilted out of that
// plane never reaches the extremes, so it converges BELOW `expected` by
// a fixed amount that flying more never erodes — orbital phase averages
// away, inclination does not. The path integral is convex in the angle,
// so `expected` bounds every tilt from above: it over-budgets damage,
// never under-budgets it.
//
// For PLANNING, which is what this is for, `expected` is the number.
// A plan prices a steady state months out, nobody knows where a planet
// will sit on the day, and a lane flown regularly resamples its whole
// orbit long before the horizon is up. Per-anchor residuals are wide
// (17.7% sd) but centred (+0.66% mean, -0.70% median over 19 anchors),
// so they read as phase draws rather than per-lane bias. Do NOT add the
// band to a budget: it is volatility, useful for repair scheduling and
// for spotting erratic lanes. See star-heat-damage.md section 7.6.
//
// Pure functions, no store and no Vue.

// Types & Interfaces
import {
	IRaukkDamageBand,
	IRaukkDamageBreakdown,
	IRaukkDamageLeg,
	IRaukkDamageOptions,
	IRaukkDamageShielding,
	IRaukkStellarSystem,
	RAUKK_STELLAR_JSON,
} from "@/features/raukk_sourcing/calculations/shippingDamage.types";

// Static assets
import pressureJson from "@/features/raukk_sourcing/assets/raukk_pressure.json";
import stellarJson from "@/features/raukk_sourcing/assets/raukk_stellar.json";
import orbitsJson from "@/features/raukk_sourcing/assets/raukk_orbits.json";

/** Kilometres in one astronomical unit */
export const RAUKK_DAMAGE_AU_KM: number = 149597870.7;

/** Base hull wear, percent per km. Survives full whipple shielding */
export const RAUKK_DAMAGE_WEAR_PER_KM: number = 2.2e-10;

/** Meteoroid impacts, percent per km per unit of system density */
export const RAUKK_DAMAGE_METEOROID_PER_KM_DENSITY: number = 5.5e-10;

/** FTL jump cost, percent per parsec. Reactor-independent */
export const RAUKK_DAMAGE_JUMP_PER_PARSEC: number = 0.001;

/** Reactor recharge cost, percent per event, at the 65% setting */
export const RAUKK_DAMAGE_CHARGE_PER_EVENT: number = 0.017;

/**
 * Stellar dose coefficient, percent per unit of
 * `luminosity x integral(ds / r^2)` with `r` in AU. Unshielded hulls.
 */
export const RAUKK_DAMAGE_STELLAR_C: number = 3.25e-6;

/**
 * Smallest approach to the star a leg is assumed to make, as a
 * fraction of the anchor planet's orbit radius.
 *
 * Only binds on legs LONGER than that radius, which are the only ones
 * that can cross the star at all; shorter legs stop short of it and
 * their bounds are exact. Replacing it with a flat 0.005 AU widens the
 * median trip band from 2.0x to 2.4x and the widest from 8.4x to 32.1x,
 * so this is the value that keeps the wide end useful.
 */
export const RAUKK_DAMAGE_CLOSEST_FRACTION: number = 0.05;

/** Gravitational constant, m^3 kg^-1 s^-2 */
export const RAUKK_DAMAGE_GRAVITATIONAL_G: number = 6.6743e-11;

/**
 * Game seconds per real second.
 *
 * The universe runs 20x faster than real time, so an orbit of one
 * in-game year comes round every 365.25 / 20 = 18.26 real days.
 * Confirmed to 0.1% against a 74-flight community log: Kepler puts the
 * KI-439b/d synodic period at 5.72 real days and their series fits
 * 5.71.
 */
export const RAUKK_DAMAGE_GAME_TIME_RATIO: number = 20;

/**
 * Real-time anchor of the simulation clock, in epoch milliseconds.
 *
 * At this instant the universe stood at
 * `RAUKK_DAMAGE_SIM_EPOCH_YEARS`. Both constants come from the
 * community orbit visualiser at https://orbit.em32.site/.
 */
export const RAUKK_DAMAGE_SIM_CALIBRATION_MS: number = 1743599009468;

/** Simulation age in game years at the calibration instant */
export const RAUKK_DAMAGE_SIM_CALIBRATION_YEARS: number = 231.0;

/** Landing term scale, percent per sqrt(km) at saturating pressure */
export const RAUKK_DAMAGE_LANDING_SCALE: number = 0.01192;

/** Pressure exponent of the landing term */
export const RAUKK_DAMAGE_LANDING_PRESSURE_EXPONENT: number = 1.15;

/** Pressure at which the landing term reaches half its scale */
export const RAUKK_DAMAGE_LANDING_PRESSURE_HALF: number = 38.0;

/** Directions sampled when bounding the stellar path integral */
const STELLAR_DIRECTION_SAMPLES: number = 1200;

/** An all-zero band, for legs a term does not apply to */
const ZERO_BAND: IRaukkDamageBand = { low: 0, expected: 0, high: 0 };

/**
 * Damage reduction of every shield component, per damage type.
 *
 * Source: `docs/raukk_sourcing/repair_and_damage.json`. `general`
 * applies to the whole leg (hull plates, repair drones; LHP is
 * negative, it RAISES damage). `stellar` merges the heat and
 * radiation entries, which the game shields SEPARATELY.
 *
 * KNOWN WRONG for shielded hulls, see star-heat-damage.md section 7.5.
 * Merging is exact on a bare hull, which is what every constant here
 * was fitted against, but `reliefOf` then adds a heat relief to a
 * radiation one: APT alone reads as 1.0 and zeroes the whole term, on
 * lanes the community sheet measures as 99% radiation. The sheet has
 * the per-lane split for 36 lanes and it runs the full 0 to 1, so this
 * needs a second term rather than a constant.
 *
 * @author raukk
 */
export const RAUKK_DAMAGE_SHIELD_RELIEF = {
	general: {
		BHP: 0,
		LHP: -0.1,
		RHP: 0.1,
		HHP: 0.15,
		AHP: 0.3,
		RDS: 0.05,
		RDL: 0.1,
	},
	meteoroid: { BWH: 0.5, AWH: 1.0 },
	stellar: { BPT: 0.5, APT: 1.0, BRP: 0.15, ARP: 0.35, SRP: 0.7 },
} as const;

/**
 * Looks up a system's luminosity and meteoroid density.
 *
 * @param {string} systemNaturalId System natural id, e.g. `NL-534`
 * @returns {IRaukkStellarSystem | null} Data, null when unknown
 * @author raukk
 */
export function raukkStellarSystem(
	systemNaturalId: string
): IRaukkStellarSystem | null {
	const raw: [number, number, number] | undefined = (
		stellarJson as unknown as RAUKK_STELLAR_JSON
	)[systemNaturalId.toUpperCase()];

	if (raw === undefined) return null;

	return {
		luminosity: raw[0],
		meteoroidDensity: raw[1],
		starMassKg: raw[2],
	};
}

/**
 * Strips the planet letter off a planet natural id.
 *
 * @param {string} planetNaturalId Planet natural id, e.g. `NL-534a`
 * @returns {string} System natural id, e.g. `NL-534`
 * @author raukk
 */
export function raukkSystemOf(planetNaturalId: string): string {
	return planetNaturalId.toUpperCase().replace(/[A-Z]+$/, "");
}

/**
 * Orbit elements of a planet, from the shipped asset.
 *
 * The asset is keyed the way the game writes a natural id — system
 * upper case, planet letter lower, `NL-534a` — while the other two
 * lookups here normalise to upper case. Reading it raw made an
 * upper-cased id miss, which silently zeroed the stellar term rather
 * than failing, so the key is normalised to the asset's own casing.
 *
 * @param {string} planetNaturalId Planet natural id, any casing
 * @returns {[number, number] | undefined} `[semiMajorMegameters,
 *   eccentricity]`, undefined when the planet is unknown
 * @author raukk
 */
function orbitElements(planetNaturalId: string): [number, number] | undefined {
	const key: string = planetNaturalId
		.toUpperCase()
		.replace(/[A-Z]+$/, (letters) => letters.toLowerCase());

	return (orbitsJson as unknown as Record<string, [number, number]>)[key];
}

/**
 * Orbit radius of a planet in AU.
 *
 * @param {string} planetNaturalId Planet natural id
 * @returns {number | null} Semi major axis in AU, null when unknown
 * @author raukk
 */
export function raukkOrbitAu(planetNaturalId: string): number | null {
	const raw: [number, number] | undefined = orbitElements(planetNaturalId);

	if (raw === undefined) return null;

	return (raw[0] * 1e3) / RAUKK_DAMAGE_AU_KM;
}

/**
 * Surface pressure of a planet, the landing term's driver.
 *
 * @param {string} planetNaturalId Planet natural id
 * @returns {number | null} Pressure, null when unknown
 * @author raukk
 */
export function raukkPressureOf(planetNaturalId: string): number | null {
	const raw: number | undefined = (
		pressureJson as unknown as Record<string, number>
	)[planetNaturalId.toUpperCase()];

	return raw === undefined ? null : raw;
}

/**
 * Path integral of `1 / r^2` over one leg, for a single direction.
 *
 * The leg is a straight line of length `legAu` starting at radius
 * `orbitAu` from the star, leaving at direction cosine `cosine`
 * (+1 straight out, -1 straight at the star).
 *
 * @param {number} orbitAu Orbit radius of the anchor planet, in AU
 * @param {number} legAu Leg length in AU
 * @param {number} cosine Direction cosine, -1 to +1
 * @returns {number} Integral value, per AU
 * @author raukk
 */
export function raukkStellarPathIntegral(
	orbitAu: number,
	legAu: number,
	cosine: number
): number {
	const along: number = orbitAu * cosine;
	const perpendicularSquared: number = orbitAu * orbitAu - along * along;

	// Collinear with the star: integrate along the radius directly
	if (perpendicularSquared < 1e-12) {
		// straight out, r runs a -> a + d
		if (cosine > 0) return 1 / orbitAu - 1 / (orbitAu + legAu);

		// straight in and stopping short, r runs a - d -> a
		if (legAu < orbitAu) return 1 / (orbitAu - legAu) - 1 / orbitAu;

		// straight in and reaching the star: the dose diverges
		return Number.POSITIVE_INFINITY;
	}

	const perpendicular: number = Math.sqrt(perpendicularSquared);

	return (
		(Math.atan((legAu + along) / perpendicular) -
			Math.atan(along / perpendicular)) /
		perpendicular
	);
}

/**
 * Closest approach to the star along one leg.
 *
 * The perpendicular foot lies on the segment only for a leg angled
 * inwards and not overshooting; otherwise the nearer endpoint wins.
 *
 * @param {number} orbitAu Orbit radius of the anchor planet, in AU
 * @param {number} legAu Leg length in AU
 * @param {number} cosine Direction cosine, -1 to +1
 * @returns {number} Closest approach in AU
 * @author raukk
 */
export function raukkStellarClosestApproach(
	orbitAu: number,
	legAu: number,
	cosine: number
): number {
	const foot: number = -orbitAu * cosine;

	if (foot >= 0 && foot <= legAu) {
		return orbitAu * Math.sqrt(Math.max(0, 1 - cosine * cosine));
	}

	const far: number = Math.sqrt(
		Math.max(
			0,
			orbitAu * orbitAu + legAu * legAu + 2 * orbitAu * legAu * cosine
		)
	);

	return Math.min(orbitAu, far);
}

/**
 * Most inward direction a leg is allowed to take.
 *
 * The dose rises monotonically as the leg turns towards the star, so
 * the worst allowed case sits exactly ON the closest-approach floor and
 * nowhere else. Scanning a grid of directions for it does not work: the
 * integrand is steepest precisely there, so whichever sample lands
 * nearest the boundary understates the maximum by whatever the grid
 * spacing costs — 16% at 1,200 samples on the lanes where the floor
 * binds at all.
 *
 * Closest approach is monotone in the direction cosine, so a bisection
 * lands on the boundary to machine precision in 80 cheap steps, and
 * returns the ALLOWED side of it.
 *
 * @param {number} orbitAu Orbit radius of the anchor planet, in AU
 * @param {number} legAu Leg length in AU
 * @returns {number} Direction cosine, -1 when nothing binds
 * @author raukk
 */
export function raukkStellarMinimumCosine(
	orbitAu: number,
	legAu: number
): number {
	const floor: number = RAUKK_DAMAGE_CLOSEST_FRACTION * orbitAu;

	// straight in already clears the floor: the leg stops short of it
	if (raukkStellarClosestApproach(orbitAu, legAu, -1) >= floor) return -1;

	let disallowed: number = -1;
	let allowed: number = 1;

	for (let i = 0; i < 80; i++) {
		const middle: number = (disallowed + allowed) / 2;

		if (raukkStellarClosestApproach(orbitAu, legAu, middle) >= floor) {
			allowed = middle;
		} else {
			disallowed = middle;
		}
	}

	return allowed;
}

/**
 * True bounds of the stellar path integral, with its orbital mean.
 *
 * The warp point sits a fixed distance from the planet in the
 * direction of the target system, so the leg's angle to the star is
 * set by where the planet sits in its orbit at departure — unknown
 * per flight, but fully swept over an orbital period.
 *
 * `low` is a leg heading straight out (the minimum, always exact),
 * `high` a leg angled as far inwards as `RAUKK_DAMAGE_CLOSEST_FRACTION`
 * allows, and `expected` the mean over one orbit. Orbital phase is
 * uniform in time, so the direction cosine follows `cos(phase)` and
 * is arcsine-distributed rather than uniform — it favours the
 * extremes, and using it in place of a uniform average tightens the
 * fitted coefficient's spread from 9.2x to 5.7x.
 *
 * Legs shorter than the anchor's orbit radius cannot reach the star,
 * so their bounds are exact and carry no assumption at all.
 *
 * @param {number} orbitAu Orbit radius of the anchor planet, in AU
 * @param {number} legAu Leg length in AU
 * @returns {IRaukkDamageBand} Integral bounds, per AU
 * @author raukk
 */
export function raukkStellarGeometry(
	orbitAu: number,
	legAu: number
): IRaukkDamageBand {
	if (orbitAu <= 0 || legAu <= 0) return { ...ZERO_BAND };

	const floor: number = RAUKK_DAMAGE_CLOSEST_FRACTION * orbitAu;
	const worstCosine: number = raukkStellarMinimumCosine(orbitAu, legAu);

	// Both extremes are exact: the integral is monotone in the cosine,
	// so they sit at the ends of the allowed range and nowhere else
	const low: number = raukkStellarPathIntegral(orbitAu, legAu, 1);
	const high: number = raukkStellarPathIntegral(orbitAu, legAu, worstCosine);

	// Mean over one orbit: phase uniform in time, cosine = cos(phase).
	// Quadrature, not a bound — 1,200 samples converge to a 200,000
	// sample reference to rounding.
	let total: number = 0;
	let counted: number = 0;

	for (let i = 0; i < STELLAR_DIRECTION_SAMPLES; i++) {
		const phase: number =
			(2 * Math.PI * (i + 0.5)) / STELLAR_DIRECTION_SAMPLES;
		const cosine: number = Math.cos(phase);
		const allowed: boolean =
			raukkStellarClosestApproach(orbitAu, legAu, cosine) >= floor;
		const value: number = raukkStellarPathIntegral(
			orbitAu,
			legAu,
			allowed ? cosine : worstCosine
		);

		if (!Number.isFinite(value)) continue;

		total += value;
		counted++;
	}

	return {
		low,
		expected: counted > 0 ? total / counted : low,
		high: Number.isFinite(high) ? high : low,
	};
}

/**
 * Total relief of the fitted shields for one damage type.
 *
 * @param {string[]} shields Fitted shield tickers
 * @param {"general" | "meteoroid" | "stellar"} type Damage type
 * @returns {number} Relief fraction, capped at 1
 * @author raukk
 */
function reliefOf(
	shields: string[],
	type: "general" | "meteoroid" | "stellar"
): number {
	const table: Record<string, number> = RAUKK_DAMAGE_SHIELD_RELIEF[type];
	const total: number = shields.reduce(
		(sum, ticker) => sum + (table[ticker] ?? 0),
		0
	);

	return Math.min(total, 1);
}

/**
 * Multiplier a ship's fitted components apply to one damage type.
 *
 * @param {IRaukkDamageShielding | undefined} shielding Fitted components
 * @param {"meteoroid" | "stellar"} type Damage type
 * @returns {number} Multiplier, never negative
 * @author raukk
 */
export function raukkDamageMultiplier(
	shielding: IRaukkDamageShielding | undefined,
	type: "meteoroid" | "stellar"
): number {
	const shields: string[] = shielding?.shields ?? [];
	const general: number = reliefOf(shields, "general");

	return Math.max(0, (1 - general) * (1 - reliefOf(shields, type)));
}

/**
 * Damage one leg of a flight takes, split by term.
 *
 * DEP and APP legs carry wear, meteoroid and stellar damage; the
 * stellar term is anchored on the planet the leg departs from or
 * arrives at. TRA legs are treated the same way with their own
 * anchor. JMP legs cost per parsec, CHRG a flat amount, LND the
 * atmospheric term, and TO nothing at all.
 *
 * @param {IRaukkDamageLeg} leg Leg to price
 * @param {IRaukkDamageOptions} [options] Shielding and calibrations
 * @returns {IRaukkDamageBreakdown} Damage in percent, per term
 * @author raukk
 */
export function raukkLegDamage(
	leg: IRaukkDamageLeg,
	options?: IRaukkDamageOptions
): IRaukkDamageBreakdown {
	const shielding: IRaukkDamageShielding | undefined = options?.shielding;
	const zero: IRaukkDamageBreakdown = {
		wear: 0,
		meteoroid: 0,
		stellar: { ...ZERO_BAND },
		jump: 0,
		charge: 0,
		landing: 0,
		total: { ...ZERO_BAND },
	};

	if (leg.type === "TO") return zero;

	if (leg.type === "JMP") {
		const jump: number = RAUKK_DAMAGE_JUMP_PER_PARSEC * (leg.parsecs ?? 0);
		const scaled: number =
			jump * (1 - reliefOf(shielding?.shields ?? [], "general"));

		return {
			...zero,
			jump: scaled,
			total: { low: scaled, expected: scaled, high: scaled },
		};
	}

	if (leg.type === "CHRG") {
		const charge: number =
			RAUKK_DAMAGE_CHARGE_PER_EVENT *
			(1 - reliefOf(shielding?.shields ?? [], "general"));

		return {
			...zero,
			charge,
			total: { low: charge, expected: charge, high: charge },
		};
	}

	if (leg.type === "LND") {
		const landing: number = raukkLandingDamage(
			leg.anchorPlanetNaturalId,
			leg.km ?? 0
		);
		const scaled: number =
			landing * (1 - reliefOf(shielding?.shields ?? [], "general"));

		return {
			...zero,
			landing: scaled,
			total: { low: scaled, expected: scaled, high: scaled },
		};
	}

	// DEP / APP / TRA — the transit terms
	const km: number = leg.km ?? 0;
	const system: IRaukkStellarSystem | null = raukkStellarSystem(
		leg.anchorSystemNaturalId ?? raukkSystemOf(leg.anchorPlanetNaturalId)
	);
	const density: number = system?.meteoroidDensity ?? 0;

	const generalKept: number =
		1 - reliefOf(shielding?.shields ?? [], "general");
	const wear: number = km * RAUKK_DAMAGE_WEAR_PER_KM * generalKept;
	const meteoroid: number =
		km *
		RAUKK_DAMAGE_METEOROID_PER_KM_DENSITY *
		density *
		raukkDamageMultiplier(shielding, "meteoroid");

	const orbitAu: number =
		leg.anchorOrbitAu ?? raukkOrbitAu(leg.anchorPlanetNaturalId) ?? 0;
	const geometry: IRaukkDamageBand = raukkStellarGeometry(
		orbitAu,
		km / RAUKK_DAMAGE_AU_KM
	);
	const coefficient: number =
		options?.stellarCoefficients?.[
			leg.anchorPlanetNaturalId.toUpperCase()
		] ?? RAUKK_DAMAGE_STELLAR_C;
	const stellarScale: number =
		coefficient *
		(system?.luminosity ?? 0) *
		raukkDamageMultiplier(shielding, "stellar");

	const stellar: IRaukkDamageBand = {
		low: geometry.low * stellarScale,
		expected: geometry.expected * stellarScale,
		high: geometry.high * stellarScale,
	};
	const base: number = wear + meteoroid;

	return {
		wear,
		meteoroid,
		stellar,
		jump: 0,
		charge: 0,
		landing: 0,
		total: {
			low: base + stellar.low,
			expected: base + stellar.expected,
			high: base + stellar.high,
		},
	};
}

/**
 * Atmospheric damage of landing on a planet.
 *
 * `LND% = scale x sqrt(km) x P^n / (P^n + half^n)` — the landing
 * length carries the exposure and pressure saturates. Fitted on
 * fifteen BTF landings across thirteen planets, median error 4%.
 *
 * @param {string} planetNaturalId Planet being landed on
 * @param {number} km Landing leg length in km
 * @returns {number} Damage in percent, 0 when the planet is unknown
 * @author raukk
 */
export function raukkLandingDamage(
	planetNaturalId: string,
	km: number
): number {
	const pressure: number | null = raukkPressureOf(planetNaturalId);

	if (pressure === null || km <= 0 || pressure <= 0) return 0;

	const powered: number = Math.pow(
		pressure,
		RAUKK_DAMAGE_LANDING_PRESSURE_EXPONENT
	);
	const half: number = Math.pow(
		RAUKK_DAMAGE_LANDING_PRESSURE_HALF,
		RAUKK_DAMAGE_LANDING_PRESSURE_EXPONENT
	);

	return (
		(RAUKK_DAMAGE_LANDING_SCALE * Math.sqrt(km) * powered) /
		(powered + half)
	);
}

/**
 * Damage a whole trip takes, summed over its legs.
 *
 * @param {IRaukkDamageLeg[]} legs Legs of the trip, in order
 * @param {IRaukkDamageOptions} [options] Shielding and calibrations
 * @returns {IRaukkDamageBreakdown} Damage in percent, per term
 * @author raukk
 */
export function raukkTripDamage(
	legs: IRaukkDamageLeg[],
	options?: IRaukkDamageOptions
): IRaukkDamageBreakdown {
	return legs.reduce<IRaukkDamageBreakdown>(
		(sum, leg) => {
			const one: IRaukkDamageBreakdown = raukkLegDamage(leg, options);

			return {
				wear: sum.wear + one.wear,
				meteoroid: sum.meteoroid + one.meteoroid,
				stellar: {
					low: sum.stellar.low + one.stellar.low,
					expected: sum.stellar.expected + one.stellar.expected,
					high: sum.stellar.high + one.stellar.high,
				},
				jump: sum.jump + one.jump,
				charge: sum.charge + one.charge,
				landing: sum.landing + one.landing,
				total: {
					low: sum.total.low + one.total.low,
					expected: sum.total.expected + one.total.expected,
					high: sum.total.high + one.total.high,
				},
			};
		},
		{
			wear: 0,
			meteoroid: 0,
			stellar: { ...ZERO_BAND },
			jump: 0,
			charge: 0,
			landing: 0,
			total: { ...ZERO_BAND },
		}
	);
}

/**
 * Back-solves an anchor's stellar coefficient from one observed leg.
 *
 * Subtracts the wear and meteoroid terms from the damage the panel
 * printed and divides by the leg's geometry factor, giving the `C`
 * that reproduces it. Feed the result to `raukkTripDamage` through
 * `stellarCoefficients` to pin that anchor's lane.
 *
 * @param {IRaukkDamageLeg} leg Leg as flown, DEP/APP/TRA only
 * @param {number} observedPercent Damage the panel printed for it
 * @param {IRaukkDamageShielding} [shielding] Fitted components
 * @returns {number | null} Coefficient, null when it cannot be solved
 * @author raukk
 */
export function raukkCalibrateStellar(
	leg: IRaukkDamageLeg,
	observedPercent: number,
	shielding?: IRaukkDamageShielding
): number | null {
	if (leg.type !== "DEP" && leg.type !== "APP" && leg.type !== "TRA") {
		return null;
	}

	const bare: IRaukkDamageBreakdown = raukkLegDamage(
		{ ...leg },
		{
			shielding,
			stellarCoefficients: {
				[leg.anchorPlanetNaturalId.toUpperCase()]: 1,
			},
		}
	);
	const excess: number = observedPercent - bare.wear - bare.meteoroid;

	if (!Number.isFinite(excess) || bare.stellar.expected <= 0) return null;

	return Math.max(0, excess / bare.stellar.expected);
}

/**
 * Orbital period of a planet, in REAL days.
 *
 * Kepler's third law on the FIO star mass, converted out of game time.
 * This is how long the anchor takes to present every angle to a given
 * lane, and therefore how far apart repeat observations have to be
 * spaced to sample the geometry rather than resample one point of it.
 *
 * @param {string} planetNaturalId Planet natural id
 * @param {number} [orbitAuOverride] Orbit radius for anchors absent
 *   from the asset, i.e. stations
 * @param {string} [systemNaturalIdOverride] System for the same
 * @returns {number | null} Period in real days, null when unknown
 * @author raukk
 */
export function raukkOrbitalPeriodDays(
	planetNaturalId: string,
	orbitAuOverride?: number,
	systemNaturalIdOverride?: string
): number | null {
	const system: IRaukkStellarSystem | null = raukkStellarSystem(
		systemNaturalIdOverride ?? raukkSystemOf(planetNaturalId)
	);
	const orbitAu: number | null =
		orbitAuOverride ?? raukkOrbitAu(planetNaturalId);

	if (system === null || orbitAu === null || orbitAu <= 0) return null;
	if (!system.starMassKg || system.starMassKg <= 0) return null;

	const metres: number = orbitAu * RAUKK_DAMAGE_AU_KM * 1e3;
	const gameSeconds: number = Math.sqrt(
		((2 * Math.PI) ** 2 * metres ** 3) /
			(RAUKK_DAMAGE_GRAVITATIONAL_G * system.starMassKg)
	);

	return gameSeconds / 86400 / RAUKK_DAMAGE_GAME_TIME_RATIO;
}

/**
 * Time for two bodies of one system to return to the same relative
 * angle, in REAL days.
 *
 * @param {string} planetA First planet natural id
 * @param {string} planetB Second planet natural id
 * @returns {number | null} Synodic period, null when unknown or equal
 * @author raukk
 */
export function raukkSynodicPeriodDays(
	planetA: string,
	planetB: string
): number | null {
	const a: number | null = raukkOrbitalPeriodDays(planetA);
	const b: number | null = raukkOrbitalPeriodDays(planetB);

	if (a === null || b === null) return null;

	const difference: number = Math.abs(1 / a - 1 / b);

	return difference > 0 ? 1 / difference : null;
}

/**
 * Mean anomaly of every body at the simulation epoch.
 *
 * The universe places all planets at zero: position is
 * `meanMotion x t` with no per-planet offset, so the whole geometry is
 * a closed-form function of real time carrying no free parameters at
 * all. Verified against 74 timestamped community flights (r = 0.974,
 * see `star-heat-damage.md` section 9).
 */
const MEAN_ANOMALY_AT_EPOCH: number = 0;

/**
 * Solves Kepler's equation `M = E - e sin E` for the eccentric anomaly.
 *
 * @param {number} meanAnomaly Mean anomaly in radians
 * @param {number} eccentricity Orbit eccentricity
 * @returns {number} Eccentric anomaly in radians
 * @author raukk
 */
export function raukkEccentricAnomaly(
	meanAnomaly: number,
	eccentricity: number
): number {
	let e: number = meanAnomaly;

	for (let i = 0; i < 40; i++) {
		const delta: number =
			(e - eccentricity * Math.sin(e) - meanAnomaly) /
			(1 - eccentricity * Math.cos(e));

		e -= delta;

		if (Math.abs(delta) < 1e-12) break;
	}

	return e;
}

/**
 * Position of a planet in its own orbital plane, at a real instant.
 *
 * Returns AU in the system's own frame — exact for anything WITHIN a
 * system (separations, conjunctions). Pointing it at another system
 * additionally needs that orbital plane's orientation in the galactic
 * frame, which no data source carries; see `star-heat-damage.md`
 * section 9.
 *
 * @param {string} planetNaturalId Planet natural id
 * @param {number} atEpochMs Real time, in epoch milliseconds
 * @returns {{ xAu: number; yAu: number } | null} Position, null when
 *   the planet or its star is unknown
 * @author raukk
 */
export function raukkPlanetPosition(
	planetNaturalId: string,
	atEpochMs: number
): { xAu: number; yAu: number } | null {
	const raw: [number, number] | undefined = orbitElements(planetNaturalId);
	const periodDays: number | null = raukkOrbitalPeriodDays(planetNaturalId);

	if (raw === undefined || periodDays === null) return null;

	const semiMajorAu: number = (raw[0] * 1e3) / RAUKK_DAMAGE_AU_KM;
	const eccentricity: number = raw[1];

	// game years elapsed since the simulation epoch
	const yearSeconds: number = 365.25 * 86400;
	const gameYears: number =
		RAUKK_DAMAGE_SIM_CALIBRATION_YEARS +
		((atEpochMs - RAUKK_DAMAGE_SIM_CALIBRATION_MS) *
			RAUKK_DAMAGE_GAME_TIME_RATIO) /
			(1000 * yearSeconds);

	// the period is in REAL days, so scale it back into game years
	const periodGameYears: number =
		(periodDays * RAUKK_DAMAGE_GAME_TIME_RATIO * 86400) / yearSeconds;
	const meanAnomaly: number =
		(MEAN_ANOMALY_AT_EPOCH + (2 * Math.PI * gameYears) / periodGameYears) %
		(2 * Math.PI);
	const eccentric: number = raukkEccentricAnomaly(
		meanAnomaly < 0 ? meanAnomaly + 2 * Math.PI : meanAnomaly,
		eccentricity
	);

	return {
		xAu: semiMajorAu * (Math.cos(eccentric) - eccentricity),
		yAu:
			semiMajorAu *
			Math.sqrt(1 - eccentricity * eccentricity) *
			Math.sin(eccentric),
	};
}

/**
 * Straight-line separation of two planets of one system, in AU.
 *
 * @param {string} planetA First planet natural id
 * @param {string} planetB Second planet natural id
 * @param {number} atEpochMs Real time, in epoch milliseconds
 * @returns {number | null} Separation in AU, null when either is
 *   unknown or they sit in different systems
 * @author raukk
 */
export function raukkPlanetSeparationAu(
	planetA: string,
	planetB: string,
	atEpochMs: number
): number | null {
	if (raukkSystemOf(planetA) !== raukkSystemOf(planetB)) return null;

	const a = raukkPlanetPosition(planetA, atEpochMs);
	const b = raukkPlanetPosition(planetB, atEpochMs);

	if (a === null || b === null) return null;

	return Math.hypot(a.xAu - b.xAu, a.yAu - b.yAu);
}
