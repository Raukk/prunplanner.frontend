// Blueprint-seeded ship profiles: the Performance block of the in-game
// BLUEPRINT panel, turned into the profile constants a ship starts with
// BEFORE a single test flight was entered.
// See docs/raukk_sourcing/shipping-fleet.md, section "Blueprint-seeded
// profiles" — calibration order is blueprint seed → BTF flights refine →
// manual override wins. Pure functions, no store and no Vue.

// Calculations
import { raukkNearestCalibration } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkShipHull,
	IRaukkTimeCalibration,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Fuel rate of the fuel-save sublight engine, units per second (USER) */
export const RAUKK_FSE_FUEL_RATE_PER_SECOND: number = 0.0075;

/** Performance stats of one reference blueprint, keyed by cargo hold */
interface IRaukkReferenceBlueprint {
	accelerationMax: number;
	operatingEmptyMassTons: number;
}

/**
 * The two blueprints the recorded test flights were flown with.
 *
 * BP-TLRI-1286 (WCB, 3000 t / 1000 m³) and BP-CNLC-4387 (HCB, 5000 t /
 * 5000 m³), both FSE with a quick-charge reactor, as recorded in
 * docs/raukk_sourcing/shipping-fleet.md. They anchor the sublight
 * scaling: the block MINUTES of a new design are the nearest reference
 * block scaled by that design's acceleration.
 *
 * @author raukk
 */
const REFERENCE_BLUEPRINTS: Record<string, IRaukkReferenceBlueprint> = {
	"3000x1000": { accelerationMax: 98.1, operatingEmptyMassTons: 936 },
	"5000x5000": { accelerationMax: 55.3, operatingEmptyMassTons: 1808 },
};

/** Blueprint Performance stats as the user reads them off the panel */
export interface IRaukkBlueprintStats {
	hull: IRaukkShipHull;
	ftlReactor: RAUKK_FTL_REACTOR;
	/** `FTL speed (max)`, parsec per hour */
	ftlSpeedMaxParsecPerHour?: number;
	/** `Acceleration (max)`, m/s² */
	accelerationMax?: number;
	/** `Operating empty mass`, tonnes */
	operatingEmptyMassTons?: number;
	/** Sublight engine fuel rate, units per second; FSE is the default */
	stlFuelRatePerSecond?: number;
}

/** Constants a blueprint seed can state, plus why it could state them */
export interface IRaukkBlueprintSeed {
	minutesPerParsec: number;
	stlBlockMinutesEmpty: number;
	stlBlockMinutesLoaded: number;
	stlFuelPerBlock: number;
	/** Codes of the fields the blueprint actually determined */
	seededFields: string[];
	/** Codes of the stats that were missing, see the UI wording */
	missing: string[];
}

/**
 * Profile constants seeded from one blueprint's Performance block.
 *
 * Three of the four are honest readings, one is a scaling:
 *
 *  - `minutesPerParsec` is `60 / FTL speed (max)`, definitional at a
 *    full reactor — the user's own numbers show the achieved speed
 *    dropping towards a floor at lower settings, which is exactly what
 *    the test flights are for.
 *  - the sublight block times scale with constant-thrust kinematics over
 *    a fixed departure/approach distance: `t ∝ 1/√a`, so a design is the
 *    nearest reference block times `√(a_ref / a)`, and the loaded block
 *    is the empty one times `√(gross mass / empty mass)` because thrust
 *    is fixed and acceleration therefore falls with mass. This is the
 *    one MODELLED step here: the recorded flights bracket it rather than
 *    confirm it (the WCB pair suggests a steeper loaded penalty), which
 *    is precisely why a seed is a starting point and the BTF flights
 *    overwrite it.
 *  - `stlFuelPerBlock` is the engine rate times the block seconds, the
 *    relation the user recorded (FSE 0.0075 units/s).
 *
 * `ftlFuelPerParsec` is deliberately NOT seeded: the user's data shows
 * the FTL burn tracking the speed actually achieved and capping out per
 * hull, so no blueprint number determines it.
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

	const reference: IRaukkReferenceBlueprint | undefined =
		REFERENCE_BLUEPRINTS[
			`${nearest.hull.cargoWeight}x${nearest.hull.cargoVolume}`
		];

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

	const acceleration: number | undefined = stats.accelerationMax;
	let stlBlockMinutesEmpty: number = nearest.stlBlockMinutesEmpty;

	if (acceleration !== undefined && acceleration > 0 && reference) {
		stlBlockMinutesEmpty =
			nearest.stlBlockMinutesEmpty *
			Math.sqrt(reference.accelerationMax / acceleration);
		seededFields.push("stlBlockMinutesEmpty");
	} else if (acceleration === undefined || acceleration <= 0) {
		missing.push("accelerationMax");
	}

	const emptyMass: number | undefined = stats.operatingEmptyMassTons;
	let stlBlockMinutesLoaded: number = nearest.stlBlockMinutesLoaded;

	if (emptyMass !== undefined && emptyMass > 0) {
		stlBlockMinutesLoaded =
			stlBlockMinutesEmpty *
			Math.sqrt((emptyMass + stats.hull.cargoWeight) / emptyMass);
		seededFields.push("stlBlockMinutesLoaded");
	} else {
		missing.push("operatingEmptyMassTons");
	}

	const rate: number =
		stats.stlFuelRatePerSecond ?? RAUKK_FSE_FUEL_RATE_PER_SECOND;

	/*
	 * The flat per block burn of the model is the mean of the empty and
	 * the fully loaded block — the same figure the two flight solver
	 * averages out of its pair of observations.
	 */
	const stlFuelPerBlock: number =
		rate * ((stlBlockMinutesEmpty + stlBlockMinutesLoaded) / 2) * 60;

	seededFields.push("stlFuelPerBlock");

	return {
		minutesPerParsec,
		stlBlockMinutesEmpty,
		stlBlockMinutesLoaded,
		stlFuelPerBlock,
		seededFields,
		missing,
	};
}
