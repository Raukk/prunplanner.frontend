// Types of the raukk hull damage model.
// See docs/raukk_sourcing/star-heat-damage.md for the model itself.

/** Leg kinds the BTF panel prints, in flight order */
export type RAUKK_DAMAGE_LEG_TYPE =
	| "TO"
	| "DEP"
	| "TRA"
	| "JMP"
	| "CHRG"
	| "APP"
	| "LND";

/**
 * Raw asset shape: system natural id to
 * `[luminosity, meteoroidDensity, starMassKg]`
 */
export type RAUKK_STELLAR_JSON = Record<string, [number, number, number]>;

/** Stellar and meteoroid properties of one system */
export interface IRaukkStellarSystem {
	/** Luminosity, `Sunlight x orbitAU^2` — constant within a system */
	luminosity: number;
	/** FIO meteoroid density */
	meteoroidDensity: number;
	/** Star mass in kg, from FIO `systemstars/star` */
	starMassKg: number;
}

/**
 * A damage figure with the geometry band around it.
 *
 * `low` and `high` are TRUE BOUNDS over the warp point's unknown
 * direction — the exact extremes, not percentiles — and they collapse
 * onto `expected` for terms that carry no geometry. `expected` is the
 * mean over one orbital period, which is what a lane flown repeatedly
 * converges to.
 */
export interface IRaukkDamageBand {
	low: number;
	expected: number;
	high: number;
}

/** One leg to price */
export interface IRaukkDamageLeg {
	type: RAUKK_DAMAGE_LEG_TYPE;
	/** Planet the leg is anchored on: its origin for DEP, target for APP/LND */
	anchorPlanetNaturalId: string;
	/**
	 * System override for anchors whose id does not carry their system,
	 * i.e. stations: `ANT` sits in `ZV-307`.
	 */
	anchorSystemNaturalId?: string;
	/** Flown distance, transit and landing legs only */
	km?: number;
	/** Parsecs as the panel prints them, JMP legs only */
	parsecs?: number;
	/** Orbit radius override in AU, for anchors absent from the asset */
	anchorOrbitAu?: number;
}

/** How a trip is priced beyond its legs */
export interface IRaukkDamageOptions {
	shielding?: IRaukkDamageShielding;
	/**
	 * Stellar coefficients measured for individual anchor planets,
	 * keyed by planet natural id, overriding the fitted default.
	 *
	 * The default carries the scatter of an unknown warp direction;
	 * one observed leg at an anchor pins that anchor's geometry and
	 * takes the rest of its lane to a few percent. Build entries with
	 * `raukkCalibrateStellar`.
	 */
	stellarCoefficients?: Record<string, number>;
}

/** Damage-relevant components fitted to the ship */
export interface IRaukkDamageShielding {
	/**
	 * Fitted tickers, hull plate included, e.g. `["LHP", "AWH", "APT"]`.
	 * Unknown tickers are ignored; an empty list is the unshielded
	 * baseline every constant of the model was fitted against.
	 */
	shields: string[];
}

/** Damage in percent, split by term */
export interface IRaukkDamageBreakdown {
	wear: number;
	meteoroid: number;
	stellar: IRaukkDamageBand;
	jump: number;
	charge: number;
	landing: number;
	total: IRaukkDamageBand;
}
