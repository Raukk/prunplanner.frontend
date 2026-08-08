// Calibration of a ship profile from two observed in-game flights.
// See docs/raukk_sourcing/shipping-fleet.md, section "Calibration by
// observed flight": users do not know abstract constants, the game shows
// them real flights, so the flow asks for one EMPTY and one LOADED
// flight between two known planets and solves the profile constants from
// them. Pure module — no store, no Vue, no UI; the route graph and the
// static system data arrive injectable, exactly as the chain math takes
// them.

// Calculations
import { RAUKK_DEFAULT_CHAIN_ROUTES } from "@/features/raukk_sourcing/calculations/shippingChains";
import { RAUKK_DEFAULT_CHAIN_DATA } from "@/features/raukk_sourcing/calculations/shippingChainData";
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkRouteDistance,
	IRaukkRoutePath,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkShipHull,
	IRaukkTimeCalibration,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkChainStaticData } from "@/features/raukk_sourcing/calculations/shippingChainData";

/**
 * Meteoroid density the damage rate is expressed at.
 *
 * Same anchor the chain math uses (`IRaukkChainConfig.densityRef`), so a
 * profile calibrated here and applied there speaks about the same
 * density normalized damage.
 *
 * @author raukk
 */
export const RAUKK_CALIBRATION_DENSITY_REF: number = 3.28;

/** One flight the user read off the game, as it is entered */
export interface IRaukkObservedFlight {
	originPlanetNaturalId: string;
	destinationPlanetNaturalId: string;
	/** Cargo carried, tonnes; the empty flight enters zero */
	cargoTons: number;
	totalDurationMinutes: number;
	stlFuelUsed: number;
	ftlFuelUsed: number;
	/** Hull damage taken, in PERCENT as the game reports it (0.088) */
	damagePercent: number;
}

/** Everything one calibration run needs */
export interface IRaukkCalibrationInput {
	hull: IRaukkShipHull;
	ftlReactor: RAUKK_FTL_REACTOR;
	/** The unloaded reference flight */
	empty: IRaukkObservedFlight;
	/** The loaded reference flight, ideally the same lane */
	loaded: IRaukkObservedFlight;
	/** Route lookups, defaults to the real systems graph */
	routes?: IRaukkRouteDistance;
	/** Density lookups, defaults to the shipped assets */
	data?: IRaukkChainStaticData;
	/** Density the damage rate is normalized to */
	densityRef?: number;
	/** Overrides the reactor seed of the charge time */
	chargeMinutes?: number;
	/**
	 * Overrides the reference seed of the empty sublight block.
	 *
	 * Two flights cannot separate the block from the jump speed, so one
	 * of the two has to be seeded (see the solver notes). A blueprint
	 * seeded profile knows a better block than the nearest reference
	 * flight does — the design's own acceleration — and hands it in
	 * here, which is what makes the documented order blueprint seed →
	 * BTF refine work at all rather than the refine silently discarding
	 * the seed.
	 */
	stlBlockMinutesEmpty?: number;
}

/** Geometry one observed flight resolves to */
export interface IRaukkCalibrationGeometry {
	parsecs: number;
	jumps: number;
	sameSystem: boolean;
	/** Parsec weighted mean density of the flown path, null if unknown */
	pathMeanDensity: number | null;
	/** `pathMeanDensity / densityRef`, 1 when the density is unknown */
	densityFactor: number;
	/** Cargo share of the hull, 0 to 1 */
	loadFactor: number;
	/** False when the flight cannot constrain anything, see warnings */
	usable: boolean;
}

/**
 * Spread of the estimates one field was solved from.
 *
 * Overdetermined fields — the FTL burn, the block burn and the damage
 * rate are each constrained by BOTH flights — are averaged, and the
 * spread of the estimates is what makes a mistyped flight visible: a
 * field whose two estimates disagree by half is not a calibration, it is
 * a typo.
 */
export interface IRaukkCalibrationResidual {
	field: string;
	estimates: number[];
	/** The value that was adopted, the mean of the estimates */
	mean: number;
	/** Largest distance of an estimate from the mean */
	maxAbsoluteDeviation: number;
	/** The same, relative to the mean; 0 when the mean is 0 */
	maxRelativeDeviation: number;
}

/** The profile constants a calibration produces */
export interface IRaukkCalibrationConstants {
	minutesPerParsec: number;
	chargeMinutes: number;
	stlBlockMinutesEmpty: number;
	stlBlockMinutesLoaded: number;
	ftlFuelPerParsec: number;
	stlFuelPerBlock: number;
	damagePerParsec: number;
	/** Never identifiable from two single block flights, always 0 */
	damagePerStlBlock: number;
}

/** Result of one calibration run */
export interface IRaukkCalibrationResult {
	constants: IRaukkCalibrationConstants;
	residuals: IRaukkCalibrationResidual[];
	/** Warning codes of {@link RAUKK_CALIBRATION_WARNINGS} */
	warnings: string[];
	empty: IRaukkCalibrationGeometry;
	loaded: IRaukkCalibrationGeometry;
	/** False when nothing could be solved and the seed is returned */
	solved: boolean;
}

/**
 * Every warning the solver can raise.
 *
 * Codes, not sentences: the module is pure and the UI owns the wording.
 *
 * @author raukk
 */
export const RAUKK_CALIBRATION_WARNINGS: Record<string, string> = {
	/** A flights planet pair could not be resolved on the map */
	unresolvedRoute: "unresolved-route",
	/** A flight that never leaves its system constrains no parsec */
	sameSystemRoute: "same-system-route",
	/** Neither flight was usable, the constants are the plain seed */
	notSolvable: "not-solvable",
	/** The charge time stays at its reactor seed, see the solver notes */
	chargeMinutesSeeded: "charge-minutes-seeded",
	/** The empty block time stays at its seed, see the solver notes */
	stlBlockMinutesEmptySeeded: "stl-block-minutes-empty-seeded",
	/** The "loaded" flight carries nothing, its block cannot be scaled */
	loadedFlightEmpty: "loaded-flight-empty",
	/** More cargo than the hull holds, the load factor was clamped */
	cargoExceedsHull: "cargo-exceeds-hull",
	/** A solved time came out negative, the entry contradicts the model */
	negativeSolvedTime: "negative-solved-time",
	/** No density known for the path, damage is left un-normalized */
	unknownDensity: "unknown-density",
};

/**
 * Parsec weighted mean density of a flown path.
 *
 * Same weighting the chain math applies, so calibration and application
 * normalize damage identically.
 *
 * @author raukk
 *
 * @param {IRaukkRoutePath} path Flown path
 * @param {IRaukkChainStaticData} data Static lookups
 * @returns {(number | null)} Mean density, null when nothing is known
 */
function pathMeanDensity(
	path: IRaukkRoutePath,
	data: IRaukkChainStaticData
): number | null {
	let weighted: number = 0;
	let parsecs: number = 0;
	let known: boolean = false;

	path.hopParsecs.forEach((hop, index) => {
		if (hop <= 0) return;

		const from: number | null = data.densityOf(path.systemIds[index]);
		const to: number | null = data.densityOf(path.systemIds[index + 1]);

		if (from === null && to === null) return;

		known = true;
		weighted += hop * (((from ?? to)! + (to ?? from)!) / 2);
		parsecs += hop;
	});

	return known && parsecs > 0 ? weighted / parsecs : null;
}

/** Resolves one observed flight onto the map */
function geometryOf(
	flight: IRaukkObservedFlight,
	hull: IRaukkShipHull,
	routes: IRaukkRouteDistance,
	data: IRaukkChainStaticData,
	densityRef: number,
	warnings: Set<string>
): IRaukkCalibrationGeometry {
	const rawLoadFactor: number =
		hull.cargoWeight > 0 ? flight.cargoTons / hull.cargoWeight : 0;

	if (rawLoadFactor > 1)
		warnings.add(RAUKK_CALIBRATION_WARNINGS.cargoExceedsHull);

	const loadFactor: number = Math.min(Math.max(rawLoadFactor, 0), 1);

	const empty: IRaukkCalibrationGeometry = {
		parsecs: 0,
		jumps: 0,
		sameSystem: false,
		pathMeanDensity: null,
		densityFactor: 1,
		loadFactor,
		usable: false,
	};

	const fromSystemId: string | null = routes.resolveSystemId(
		flight.originPlanetNaturalId
	);
	const toSystemId: string | null = routes.resolveSystemId(
		flight.destinationPlanetNaturalId
	);

	if (fromSystemId === null || toSystemId === null) {
		warnings.add(RAUKK_CALIBRATION_WARNINGS.unresolvedRoute);
		return empty;
	}

	const path: IRaukkRoutePath | null =
		routes.path?.(fromSystemId, toSystemId) ?? null;

	if (path === null) {
		warnings.add(RAUKK_CALIBRATION_WARNINGS.unresolvedRoute);
		return empty;
	}

	if (path.sameSystem || path.parsecs <= 0) {
		// a flight inside one system flies no parsec and no jump: it
		// cannot separate speed, burn or damage from the sublight block
		warnings.add(RAUKK_CALIBRATION_WARNINGS.sameSystemRoute);
		return { ...empty, sameSystem: true };
	}

	const density: number | null = pathMeanDensity(path, data);
	if (density === null)
		warnings.add(RAUKK_CALIBRATION_WARNINGS.unknownDensity);

	return {
		parsecs: path.parsecs,
		jumps: path.jumps,
		sameSystem: false,
		pathMeanDensity: density,
		densityFactor:
			density !== null && densityRef > 0 ? density / densityRef : 1,
		loadFactor,
		usable: true,
	};
}

/** Mean and spread of the estimates of one field */
function residualOf(
	field: string,
	estimates: number[]
): IRaukkCalibrationResidual {
	const mean: number =
		estimates.length > 0
			? estimates.reduce((sum, value) => sum + value, 0) /
				estimates.length
			: 0;

	const maxAbsoluteDeviation: number = estimates.reduce(
		(worst, value) => Math.max(worst, Math.abs(value - mean)),
		0
	);

	return {
		field,
		estimates,
		mean,
		maxAbsoluteDeviation,
		maxRelativeDeviation:
			mean !== 0 ? maxAbsoluteDeviation / Math.abs(mean) : 0,
	};
}

/**
 * Solves the constants of one ship profile from two observed flights.
 *
 * The model of a one way flight is
 *
 * ```
 * minutes = parsecs × minutesPerParsec
 *         + jumps   × chargeMinutes
 *         + stlBlockMinutes(loadFactor)
 * ```
 *
 * with `stlBlockMinutes` linear between the empty and the fully loaded
 * block. Two flights give two equations, and the unknowns are four —
 * speed, charge time and both block times — so exactly two of them have
 * to be seeded, and the solver says which:
 *
 *  - `chargeMinutes` is seeded per reactor flag (observed 52 s to
 *    2m21s). No pair of flights can separate it from the speed as long
 *    as both block times are unknown, so "refine if solvable" never
 *    fires here; the caller may hand in a measured value instead.
 *  - `stlBlockMinutesEmpty` is seeded from the nearest covered reference
 *    flight of the same hull class.
 *
 * Everything else IS solved:
 *
 *  - `minutesPerParsec` from the empty flight, after the seeded charge
 *    and block time are subtracted;
 *  - `stlBlockMinutesLoaded` from the loaded flight, its excess block
 *    time divided by the load factor so a half loaded run still yields
 *    the FULL hull figure;
 *  - `ftlFuelPerParsec` and the damage rate from BOTH flights — FTL burn
 *    and hull damage do not depend on the load — averaged, with their
 *    spread reported as the residual;
 *  - `stlFuelPerBlock` as the mean of both flights block burn, which is
 *    what the flat per block cost of the model charges.
 *
 * Damage is density normalized exactly as the chain math applies it:
 * `damagePerParsec = damage / (parsecs × pathMeanDensity / densityRef)`.
 *
 * Nothing here writes anywhere: the result is a plain struct the caller
 * copies into a profile after showing the residuals.
 *
 * @author raukk
 *
 * @param {IRaukkCalibrationInput} input Ship, both flights, lookups
 * @returns {IRaukkCalibrationResult} Constants, residuals and warnings
 */
export function calibrateShipProfile(
	input: IRaukkCalibrationInput
): IRaukkCalibrationResult {
	const routes: IRaukkRouteDistance =
		input.routes ?? RAUKK_DEFAULT_CHAIN_ROUTES;
	const data: IRaukkChainStaticData = input.data ?? RAUKK_DEFAULT_CHAIN_DATA;
	const densityRef: number =
		input.densityRef ?? RAUKK_CALIBRATION_DENSITY_REF;

	const seed: IRaukkTimeCalibration = raukkNearestCalibration(
		input.hull,
		input.ftlReactor
	);

	const warnings: Set<string> = new Set([
		RAUKK_CALIBRATION_WARNINGS.chargeMinutesSeeded,
		RAUKK_CALIBRATION_WARNINGS.stlBlockMinutesEmptySeeded,
	]);

	const empty: IRaukkCalibrationGeometry = geometryOf(
		input.empty,
		input.hull,
		routes,
		data,
		densityRef,
		warnings
	);
	const loaded: IRaukkCalibrationGeometry = geometryOf(
		input.loaded,
		input.hull,
		routes,
		data,
		densityRef,
		warnings
	);

	const chargeMinutes: number = input.chargeMinutes ?? seed.chargeMinutes;
	const stlBlockMinutesEmpty: number =
		input.stlBlockMinutesEmpty ?? seed.stlBlockMinutesEmpty;

	const constants: IRaukkCalibrationConstants = {
		minutesPerParsec: seed.minutesPerParsec,
		chargeMinutes,
		stlBlockMinutesEmpty,
		stlBlockMinutesLoaded: seed.stlBlockMinutesLoaded,
		ftlFuelPerParsec: seed.ftlFuelPerParsec,
		stlFuelPerBlock: seed.stlFuelPerBlock,
		damagePerParsec: 0,
		damagePerStlBlock: 0,
	};

	const residuals: IRaukkCalibrationResidual[] = [];

	if (!empty.usable && !loaded.usable) {
		warnings.add(RAUKK_CALIBRATION_WARNINGS.notSolvable);

		return {
			constants: {
				...constants,
				damagePerParsec: 0,
			},
			residuals,
			warnings: Array.from(warnings),
			empty,
			loaded,
			solved: false,
		};
	}

	/** Both flights and their observations, usable ones only */
	const usable: {
		flight: IRaukkObservedFlight;
		geometry: IRaukkCalibrationGeometry;
	}[] = [
		{ flight: input.empty, geometry: empty },
		{ flight: input.loaded, geometry: loaded },
	].filter((entry) => entry.geometry.usable);

	// FTL burn: load independent, one estimate per flight
	const ftlEstimates: number[] = usable.map(
		(entry) => entry.flight.ftlFuelUsed / entry.geometry.parsecs
	);
	const ftlResidual: IRaukkCalibrationResidual = residualOf(
		"ftlFuelPerParsec",
		ftlEstimates
	);
	residuals.push(ftlResidual);
	constants.ftlFuelPerParsec = ftlResidual.mean;

	// one one way flight is exactly one sublight block
	const stlEstimates: number[] = usable.map(
		(entry) => entry.flight.stlFuelUsed
	);
	const stlResidual: IRaukkCalibrationResidual = residualOf(
		"stlFuelPerBlock",
		stlEstimates
	);
	residuals.push(stlResidual);
	constants.stlFuelPerBlock = stlResidual.mean;

	// damage, density normalized towards the reference density
	const damageEstimates: number[] = usable.map(
		(entry) =>
			entry.flight.damagePercent /
			100 /
			(entry.geometry.parsecs * entry.geometry.densityFactor)
	);
	const damageResidual: IRaukkCalibrationResidual = residualOf(
		"damagePerParsec",
		damageEstimates
	);
	residuals.push(damageResidual);
	constants.damagePerParsec = damageResidual.mean;

	/** FTL time of one flight at a given speed */
	function ftlMinutes(
		geometry: IRaukkCalibrationGeometry,
		minutesPerParsec: number
	): number {
		return (
			geometry.parsecs * minutesPerParsec + geometry.jumps * chargeMinutes
		);
	}

	if (empty.usable) {
		const speed: number =
			(input.empty.totalDurationMinutes -
				chargeMinutes * empty.jumps -
				stlBlockMinutesEmpty) /
			empty.parsecs;

		if (speed <= 0)
			warnings.add(RAUKK_CALIBRATION_WARNINGS.negativeSolvedTime);

		constants.minutesPerParsec = speed;
	}

	residuals.push(
		residualOf("minutesPerParsec", [constants.minutesPerParsec])
	);

	if (loaded.usable) {
		if (loaded.loadFactor <= 0) {
			warnings.add(RAUKK_CALIBRATION_WARNINGS.loadedFlightEmpty);
		} else {
			const observedBlock: number =
				input.loaded.totalDurationMinutes -
				ftlMinutes(loaded, constants.minutesPerParsec);

			const fullBlock: number =
				stlBlockMinutesEmpty +
				(observedBlock - stlBlockMinutesEmpty) / loaded.loadFactor;

			if (fullBlock < 0)
				warnings.add(RAUKK_CALIBRATION_WARNINGS.negativeSolvedTime);

			constants.stlBlockMinutesLoaded = fullBlock;
		}
	}

	residuals.push(
		residualOf("stlBlockMinutesLoaded", [constants.stlBlockMinutesLoaded])
	);

	return {
		constants,
		residuals,
		warnings: Array.from(warnings),
		empty,
		loaded,
		solved: true,
	};
}
