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
	IRaukkStlBlock,
	RAUKK_DEFAULT_G_FACTOR,
	RAUKK_DEFAULT_STL_ENGINE,
	RAUKK_DEFAULT_STL_SLIDER,
	RAUKK_DEFAULT_STL_TANK,
	RAUKK_FTL_FUEL_UNITS_PER_PARSEC,
	RAUKK_FTL_PANEL_FLOOR_MINUTES_PER_PARSEC,
	RAUKK_FTL_PANEL_MINUTES_PER_PARSEC_HOUR,
	RAUKK_REFERENCE_METEOROID_DENSITY,
	RAUKK_STANDARD_GRAVITY,
	RAUKK_STL_ENGINE,
	RAUKK_STL_ENGINES,
	raukkAccelerationMax,
	raukkFtlDamagePerParsec,
	raukkInferStlEngine,
	raukkStlBlock,
} from "@/features/raukk_sourcing/calculations/shippingPhysics";

// Types & Interfaces
import {
	IRaukkShipHull,
	IRaukkTimeCalibration,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Fuel rate of the default sublight engine, units per second */
export const RAUKK_DEFAULT_FUEL_RATE_PER_SECOND: number =
	RAUKK_STL_ENGINES[RAUKK_DEFAULT_STL_ENGINE].fuelRatePerSecond;

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
	/** Sublight engine fuel rate, units per second */
	stlFuelRatePerSecond?: number;
	/** Engine code; inferred from the fuel rate, else the default */
	stlEngine?: RAUKK_STL_ENGINE;
	/** `Max g`, the hull plate and seat rating; inferred when omitted */
	maxGFactor?: number;
	/** Sublight tank capacity, fuel units; the MSL is the default */
	stlTankCapacity?: number;
	/** Fuel-usage slider as a fraction, 0 being MIN */
	stlFuelSliderFraction?: number;
	/** Meteoroid density the block damage is stated at */
	meteoroidDensity?: number;
	/** Surface hop of the planet end, km */
	surfaceLegKm?: number;
	/** Planet side in-system transit leg, km */
	planetTransitKm?: number;
	/** Station side in-system transit leg, km */
	stationTransitKm?: number;
}

/** Constants a blueprint seed can state, plus why it could state them */
export interface IRaukkBlueprintSeed {
	minutesPerParsec: number;
	stlBlockMinutesEmpty: number;
	stlBlockMinutesLoaded: number;
	stlFuelPerBlock: number;
	ftlFuelPerParsec: number;
	damagePerParsec: number;
	damagePerStlBlock: number;
	/** Cruising speed the empty block was timed at, km/s */
	cruiseSpeedKmPerSecond: number;
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
	/** m/s² with an empty hold */
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
 *  - a stated `Max g` gives the cap directly, and where nothing is
 *    stated the default plate stands in ({@link RAUKK_DEFAULT_G_FACTOR});
 *  - and a panel acceleration BELOW what the engine's thrust would give
 *    at the empty mass is itself a capped reading, so the panel value IS
 *    the cap and beats the default.
 *
 * @author raukk
 *
 * @param {IRaukkBlueprintStats} stats Blueprint Performance block
 * @param {number} thrust Engine thrust, tonne × m/s²
 * @returns {IRaukkDesignAcceleration} Empty and loaded acceleration
 */
function accelerationOf(
	stats: IRaukkBlueprintStats,
	thrust: number
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

	if (emptyMass === undefined) return { empty: panel, loaded: undefined };

	/** g rating: stated, else the one the panel implies, else the plate */
	const gCapFactor: number =
		stats.maxGFactor !== undefined && stats.maxGFactor > 0
			? stats.maxGFactor
			: panel !== undefined &&
				  thrust / emptyMass > panel * RAUKK_G_CAP_MARGIN
				? panel / RAUKK_STANDARD_GRAVITY
				: RAUKK_DEFAULT_G_FACTOR;

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
 * The sublight BLOCK of this model is the powered portion of ONE ONE-WAY
 * FLIGHT between a planet and a CX station — a surface hop, a planet
 * side transit leg and a station side transit leg — and every term of it
 * comes from the calibration campaign:
 *
 *  - TIME. The surface hop is `√(2 × km / accelMax)` (§11.1) and each
 *    transit leg `km / cruiseSpeed` (§11.2), where the cruise speed is
 *    what the slider's fuel budget buys, capped by the engine's own top
 *    speed. Cargo enters ONLY through `accelMax`, and on a design whose
 *    slider already reaches the engine ceiling it does not enter the
 *    transit legs at all — which is exactly what batch 1 measured when
 *    it flew the same 43m47s empty and with 5,000 t aboard.
 *  - FUEL. The surface hop burns `7.55 × rated rate × seconds` (§1.3),
 *    each transit leg the slider's whole budget (§1.1).
 *  - DAMAGE. The meteoroid law over both transit legs plus one landing
 *    (§6, §11.4).
 *  - `minutesPerParsec` from the panel's `FTL speed (max)`, through the
 *    measured relation of §11.3 rather than the `60 / speed` this seed
 *    used to assume — that reading runs 1.2× to 2.1× optimistic.
 *  - `ftlFuelPerParsec` at the flat 4.687 units §11.3 fits over eight
 *    hops. §3 finds it higher on a loaded 5,831 m³ hull, so a reference
 *    flight still beats it.
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
		minutesPerParsec =
			RAUKK_FTL_PANEL_FLOOR_MINUTES_PER_PARSEC +
			RAUKK_FTL_PANEL_MINUTES_PER_PARSEC_HOUR / speed;
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
		stats.stlFuelRatePerSecond ?? RAUKK_DEFAULT_FUEL_RATE_PER_SECOND;
	const engine: RAUKK_STL_ENGINE =
		stats.stlEngine ??
		raukkInferStlEngine(
			rate,
			stats.accelerationMax,
			stats.operatingEmptyMassTons
		) ??
		RAUKK_DEFAULT_STL_ENGINE;
	const thrust: number =
		RAUKK_STL_ENGINES[engine].thrustTonneMetersPerSecondSquared;

	const acceleration: IRaukkDesignAcceleration = accelerationOf(
		stats,
		thrust
	);

	const density: number =
		stats.meteoroidDensity ?? RAUKK_REFERENCE_METEOROID_DENSITY;

	/** One whole sublight block at a given acceleration */
	function block(accelerationMax: number): IRaukkStlBlock {
		return raukkStlBlock({
			accelerationMax,
			fuelRatePerSecond: rate,
			topSpeedKmPerSecond: RAUKK_STL_ENGINES[engine].topSpeedKmPerSecond,
			tankCapacity: stats.stlTankCapacity ?? RAUKK_DEFAULT_STL_TANK,
			sliderFraction:
				stats.stlFuelSliderFraction ?? RAUKK_DEFAULT_STL_SLIDER,
			meteoroidDensity: density,
			surfaceLegKm: stats.surfaceLegKm,
			planetTransitKm: stats.planetTransitKm,
			stationTransitKm: stats.stationTransitKm,
		});
	}

	let stlBlockMinutesEmpty: number = nearest.stlBlockMinutesEmpty;
	let stlBlockMinutesLoaded: number = nearest.stlBlockMinutesLoaded;
	let stlFuelPerBlock: number = nearest.stlFuelPerBlock;
	let cruiseSpeedKmPerSecond: number = 0;

	/*
	 * The damage terms are laws, not readings: they need no blueprint
	 * stat at all — the block's two transit legs and its landing have
	 * their damage whatever the design's acceleration — so they are
	 * always seeded and always beat a reference flight that could not
	 * tell the two terms apart.
	 */
	const damagePerStlBlock: number = block(0).damage;

	if (acceleration.empty !== undefined) {
		const empty: IRaukkStlBlock = block(acceleration.empty);
		const loaded: IRaukkStlBlock =
			acceleration.loaded !== undefined
				? block(acceleration.loaded)
				: empty;

		stlBlockMinutesEmpty = empty.seconds / 60;
		cruiseSpeedKmPerSecond = empty.cruiseSpeedKmPerSecond;
		seededFields.push("stlBlockMinutesEmpty");

		/*
		 * A design whose loaded acceleration is unknown — no mass on the
		 * panel — keeps the reference ratio between its two blocks rather
		 * than pretending cargo were free.
		 */
		stlBlockMinutesLoaded =
			acceleration.loaded !== undefined
				? loaded.seconds / 60
				: (stlBlockMinutesEmpty * nearest.stlBlockMinutesLoaded) /
					nearest.stlBlockMinutesEmpty;

		if (acceleration.loaded !== undefined)
			seededFields.push("stlBlockMinutesLoaded");

		/*
		 * The flat per block burn of the model is the mean of the empty and
		 * the fully loaded block — the same figure the two flight solver
		 * averages out of its pair of observations.
		 */
		stlFuelPerBlock = (empty.fuel + loaded.fuel) / 2;

		seededFields.push("stlFuelPerBlock");
	}

	seededFields.push(
		"ftlFuelPerParsec",
		"damagePerParsec",
		"damagePerStlBlock"
	);

	return {
		minutesPerParsec,
		stlBlockMinutesEmpty,
		stlBlockMinutesLoaded,
		stlFuelPerBlock,
		ftlFuelPerParsec: RAUKK_FTL_FUEL_UNITS_PER_PARSEC,
		damagePerParsec: raukkFtlDamagePerParsec(),
		damagePerStlBlock,
		cruiseSpeedKmPerSecond,
		seededFields,
		missing,
	};
}
