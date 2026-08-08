// Typed accessors over the two static chain assets: planet orbits and
// per system meteoroid density. See docs/raukk_sourcing/
// shipping-chains-v2.md, sections "Same-system legs" and "Per-system
// damage". Both files were fetched from the open FIO API on 2026-08-08
// (rest.fnar.net/planet/allplanets/full and
// rest.fnar.net/systemstars/star/*). Lazy singleton, same shape as
// routeDistance: the JSON is only parsed once something asks for it.

// static assets
import meteoroidJson from "@/features/raukk_sourcing/assets/raukk_meteoroid.json";
import orbitsJson from "@/features/raukk_sourcing/assets/raukk_orbits.json";

/** Orbital elements of one planet, only what pricing needs */
export interface IRaukkPlanetOrbit {
	/** Semi major axis in megameters */
	semiMajorAxisMegameters: number;
	eccentricity: number;
}

/**
 * Separation band of two planets of the same system.
 *
 * Best case is the conjunction distance `|a1 − a2|`, worst case the
 * opposition distance `a1 + a2`; their average — and the price point of
 * the model — is `max(a1, a2)`.
 */
export interface IRaukkOrbitBand {
	bestMegameters: number;
	worstMegameters: number;
	/** Band midpoint, the priced distance */
	midpointMegameters: number;
}

/** Static lookups the chain math needs beyond the system graph */
export interface IRaukkChainStaticData {
	orbitOf(planetNaturalId: string): IRaukkPlanetOrbit | null;
	densityOf(systemId: string): number | null;
	bandBetween(
		planetNaturalIdA: string,
		planetNaturalIdB: string
	): IRaukkOrbitBand | null;
}

/** Raw asset shape: `[semiMajorAxisMegameters, eccentricity]` */
export type RAUKK_ORBITS_JSON = Record<string, [number, number]>;

/** Raw asset shape: system id to meteoroid density */
export type RAUKK_METEOROID_JSON = Record<string, number>;

/**
 * Creates orbit and density lookups over given raw assets.
 *
 * Exported for testing with fixture data; application code takes
 * {@link RAUKK_DEFAULT_CHAIN_DATA}, which runs on the shipped files.
 *
 * @author raukk
 *
 * @param {RAUKK_ORBITS_JSON} orbits Planet orbits
 * @param {RAUKK_METEOROID_JSON} densities Per system meteoroid density
 * @returns {IRaukkChainStaticData} Static lookups
 */
export function createChainStaticData(
	orbits: RAUKK_ORBITS_JSON,
	densities: RAUKK_METEOROID_JSON
): IRaukkChainStaticData {
	/** Case folded index: the asset keys carry a lower case planet
	 * letter (`AJ-120a`), user input does not have to */
	const byUpperId: Map<string, [number, number]> = new Map(
		Object.entries(orbits).map(([key, value]) => [key.toUpperCase(), value])
	);

	function orbitOf(planetNaturalId: string): IRaukkPlanetOrbit | null {
		const entry: [number, number] | undefined = byUpperId.get(
			planetNaturalId.trim().toUpperCase()
		);

		if (entry === undefined) return null;

		return {
			semiMajorAxisMegameters: entry[0],
			eccentricity: entry[1],
		};
	}

	function densityOf(systemId: string): number | null {
		const value: number | undefined = densities[systemId];

		return value === undefined ? null : value;
	}

	function bandBetween(
		planetNaturalIdA: string,
		planetNaturalIdB: string
	): IRaukkOrbitBand | null {
		const a: IRaukkPlanetOrbit | null = orbitOf(planetNaturalIdA);
		const b: IRaukkPlanetOrbit | null = orbitOf(planetNaturalIdB);

		if (a === null || b === null) return null;

		const first: number = Math.max(a.semiMajorAxisMegameters, 0);
		const second: number = Math.max(b.semiMajorAxisMegameters, 0);

		return {
			bestMegameters: Math.abs(first - second),
			worstMegameters: first + second,
			midpointMegameters: Math.max(first, second),
		};
	}

	return { orbitOf, densityOf, bandBetween };
}

/** Session singleton over the static assets, built on first use */
let defaultData: IRaukkChainStaticData | undefined = undefined;

function data(): IRaukkChainStaticData {
	if (defaultData === undefined) {
		defaultData = createChainStaticData(
			orbitsJson as unknown as RAUKK_ORBITS_JSON,
			meteoroidJson as RAUKK_METEOROID_JSON
		);
	}

	return defaultData;
}

/**
 * The shipped orbit and density assets, parsed on first access.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_CHAIN_DATA: IRaukkChainStaticData = {
	orbitOf: (planetNaturalId: string) => data().orbitOf(planetNaturalId),
	densityOf: (systemId: string) => data().densityOf(systemId),
	bandBetween: (planetNaturalIdA: string, planetNaturalIdB: string) =>
		data().bandBetween(planetNaturalIdA, planetNaturalIdB),
};
