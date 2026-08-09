// Multi stop shipping chains: pure math over an ordered LOOP of stops.
// See docs/raukk_sourcing/shipping-chains-v2.md — a v1 route pair is the
// two stop degenerate case of this model and every primitive is reused
// from shipping.ts rather than reimplemented. No store, no Vue, no
// price fetching: the repair bill price arrives pre-computed.

// Calculations
import {
	fastestRoutePath,
	jumpCount,
	nearestCx,
	nearestNeighbor,
	parsecDistance,
	resolveSystemId,
	routeBetween,
	routePath,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { RAUKK_CX_SYSTEM_IDS } from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	RAUKK_REPAIR_AT_DAMAGE,
	calculatePairShipping,
	stlBlockMinutes,
} from "@/features/raukk_sourcing/calculations/shipping";
import { RAUKK_DEFAULT_CHAIN_DATA } from "@/features/raukk_sourcing/calculations/shippingChainData";
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";
import {
	RAUKK_DEFAULT_CADENCE_REPAIR_DAYS,
	raukkCadenceCaps,
	raukkCadenceOf,
} from "@/features/raukk_sourcing/calculations/shippingCadence";
// raukk: depots anchor a split exactly as an exchange does
import { raukkDepotStopKey } from "@/features/raukk_sourcing/calculations/shippingDepots";

// Types & Interfaces
import {
	IRaukkMultiModalPath,
	IRaukkNearestNeighbor,
	IRaukkRoute,
	IRaukkRouteDistance,
	IRaukkRoutePath,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkGateLegCost,
	raukkGateLegCost,
	raukkGateOnlyPath,
} from "@/features/raukk_sourcing/calculations/shippingStl";
import {
	IRaukkPairShipping,
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	RAUKK_LOAD_DIMENSION,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainStaticData,
	IRaukkOrbitBand,
} from "@/features/raukk_sourcing/calculations/shippingChainData";
import {
	IRaukkChainAnchor,
	IRaukkChainClaim,
	IRaukkChainConfig,
	IRaukkChainDropEvaluation,
	IRaukkChainFlow,
	IRaukkChainFlowResult,
	IRaukkChainInput,
	IRaukkChainLeg,
	IRaukkChainLegResult,
	IRaukkChainShipping,
	IRaukkClaimedFlow,
	IRaukkCxSplitResult,
	IRaukkCxSplitTrigger,
	IRaukkCxSubChain,
	RAUKK_CHAIN_ANCHOR_KIND,
	RAUKK_SAME_SYSTEM_MODE,
	RAUKK_STOP_REF,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/** Minutes of a day, denominator of the shipping fraction */
const MINUTES_PER_DAY: number = 24 * 60;

/**
 * The route lookups over the real systems JSON, including the two v2
 * additions `path` and `nearestNeighbor`.
 *
 * `RAUKK_DEFAULT_ROUTES` of shippingPairs.ts stays as it is — it is the
 * v1 surface and must not gain members mid-phase — so the chain math
 * carries its own default of the same interface.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_CHAIN_ROUTES: IRaukkRouteDistance = {
	route: routeBetween,
	parsecDistance,
	jumpCount,
	nearestCx,
	resolveSystemId,
	path: routePath,
	nearestNeighbor,
	// raukk: the gate aware metric, needed by the STL-only routing
	fastestPath: fastestRoutePath,
};

/**
 * Exchange code to system id of the four real exchanges.
 *
 * Chains address an exchange by its code, which is what the user types
 * and what the persisted `stops` array carries.
 *
 * @author raukk
 */
export const RAUKK_CX_SYSTEM_ID_BY_CODE: Record<string, string> = {
	NC1: RAUKK_CX_SYSTEM_IDS[0],
	AI1: RAUKK_CX_SYSTEM_IDS[1],
	CI1: RAUKK_CX_SYSTEM_IDS[2],
	IC1: RAUKK_CX_SYSTEM_IDS[3],
};

/**
 * Share of a shipments weight or volume a base carries before an
 * automatic loop stops there.
 *
 * The three `RAUKK_DEFAULT_AUTO_CHAIN_*` constants are the ONE home of
 * the automatic chain knob defaults: {@link raukkDefaultChainConfig}, the
 * `?? fallback` of every reader and the picker defaults of the chain
 * section all take them from here. The zod defaults in
 * `raukkSourcingStore.schemas.ts` must MIRROR these three literals — a
 * schema cannot import from the calculations layer without a cycle — so a
 * change here is a change there.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE: number = 0.05;

/**
 * Parsecs a stop may add to the round trip of an in/out loop, the
 * fortnightly class that pays every parsec often.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS: number = 2;

/**
 * Parsecs a stop may add to the round trip of a workforce or repair
 * loop, the 30 and 90 day classes that can afford a short extra jump.
 *
 * @author raukk
 */
export const RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS: number = 6;

/**
 * Defaults of the chain knobs, every one of them from
 * shipping-chains-v2.md.
 *
 * `stlCostPerMegameter` is the one value the document leaves to the
 * implementation: nothing in the v1 profile calibration prices sublight
 * DISTANCE, so it starts at 0 exactly like `costPerParsec` does and the
 * same system leg then costs whatever the two jump alternative costs.
 *
 * The three `autoChain*` knobs come from shipping-cadence-plan.md phase 2
 * instead and are documented gut numbers: a stop is worth 5% of a
 * shipment, and a stop may add 2 parsecs of detour on the fortnightly
 * in/out class and 6 on the monthly and quarterly ones.
 *
 * @author raukk
 *
 * @returns {IRaukkChainConfig} Default chain configuration
 */
export function raukkDefaultChainConfig(): IRaukkChainConfig {
	return {
		cxSplitDetourParsecs: 6,
		legUtilizationSplitThreshold: 0.25,
		densityRef: 3.28,
		stlCostPerMegameter: 0,
		autoCxSplit: true,
		sameSystemPricing: "average",
		autoChainMinShare: RAUKK_DEFAULT_AUTO_CHAIN_MIN_SHARE,
		autoChainDetourInOutParsecs:
			RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_IN_OUT_PARSECS,
		autoChainDetourLooseParsecs:
			RAUKK_DEFAULT_AUTO_CHAIN_DETOUR_LOOSE_PARSECS,
	};
}

/**
 * Side keys of a split, in the order the sub chains are built.
 *
 * raukk: the two halves of a split are addressed by these keys — in the
 * persisted `sideProfiles` of a chain, and as the suffix of the sub chain
 * ids (`<chainId>#a`).
 *
 * @author raukk
 */
export const RAUKK_CHAIN_SIDE_KEYS: string[] = ["a", "b"];

/**
 * Side key of one sub chain id, `undefined` for a whole chain.
 *
 * @author raukk
 *
 * @param {string} chainId Chain id of a sub chain, `<chainId>#a`
 * @returns {(string | undefined)} Side key, undefined without one
 */
export function raukkChainSideKey(chainId: string): string | undefined {
	const marker: number = chainId.lastIndexOf("#");

	if (marker < 0) return undefined;

	const side: string = chainId.slice(marker + 1);

	return RAUKK_CHAIN_SIDE_KEYS.includes(side) ? side : undefined;
}

/**
 * The same loop, flown backwards.
 *
 * The first stop stays the anchor, everything behind it is reversed:
 * `[A, B, C, D]` becomes `[A, D, C, B]`.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @returns {RAUKK_STOP_REF[]} Reversed loop
 */
export function reverseChainStops(stops: RAUKK_STOP_REF[]): RAUKK_STOP_REF[] {
	if (stops.length <= 2) return [...stops];

	return [stops[0], ...stops.slice(1).reverse()];
}

/**
 * System id of one stop reference.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF} stopRef Planet natural id or exchange code
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {(string | null)} System id, null if unknown
 */
export function chainStopSystemId(
	stopRef: RAUKK_STOP_REF,
	routes: IRaukkRouteDistance,
	cxSystems: Record<string, string>
): string | null {
	const code: string = stopRef.trim().toUpperCase();
	const exchange: string | undefined = cxSystems[code];

	if (exchange !== undefined) return exchange;

	return routes.resolveSystemId(stopRef);
}

/**
 * The ship a loop is flown with, as far as ROUTING cares about it.
 *
 * @author raukk
 */
export interface IRaukkChainLegShip {
	/** True for a hull without an FTL drive, see `IRaukkShipProfile` */
	stlOnly: boolean;
	/** Hull volume in m³, gate links below it do not admit the ship */
	shipVolumeM3: number;
}

/**
 * The routing relevant half of a resolved ship profile.
 *
 * @author raukk
 *
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @returns {IRaukkChainLegShip} Routing relevant ship data
 */
export function raukkChainLegShip(
	profile: IRaukkResolvedShipProfile
): IRaukkChainLegShip {
	return { stlOnly: profile.stlOnly, shipVolumeM3: profile.cargoVolume };
}

/**
 * Builds the legs of a chain loop.
 *
 * A leg is identified by its POSITION, never by its stops: repeated
 * stops are legal — `A→B→C→B→A` is how an out and back path is
 * expressed — so nothing here may assume stop uniqueness. A loop of n
 * stops has n legs, the last one closing back to the first stop.
 *
 * An STL-only `ship` changes what "routable" means, and nothing else: a
 * same system leg stays fine, an inter-system leg needs a path whose
 * every hop is a GATE traversal, and a leg without one comes back
 * `routable: false` with the reason `"stl-only-no-gate"` rather than
 * quietly priced as an FTL flight the ship cannot make. Absent `ship` —
 * every caller predating STL-only hulls — is the pure FTL behaviour.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @param {IRaukkChainLegShip} [ship] Ship the loop is flown with
 * @returns {IRaukkChainLeg[]} Legs, in travel order
 */
export function buildChainLegs(
	stops: RAUKK_STOP_REF[],
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE,
	ship?: IRaukkChainLegShip
): IRaukkChainLeg[] {
	if (stops.length < 2) return [];

	const systemIds: (string | null)[] = stops.map((stopRef) =>
		chainStopSystemId(stopRef, routes, cxSystems)
	);

	return stops.map((stopRef, index) => {
		const toIndex: number = (index + 1) % stops.length;

		const fromSystemId: string | null = systemIds[index];
		const toSystemId: string | null = systemIds[toIndex];

		const route: IRaukkRoute | null =
			fromSystemId !== null && toSystemId !== null
				? routes.route(fromSystemId, toSystemId)
				: null;

		const leg: IRaukkChainLeg = {
			index,
			fromIndex: index,
			toIndex,
			fromStop: stopRef,
			toStop: stops[toIndex],
			fromSystemId,
			toSystemId,
			route,
			sameSystem: route?.sameSystem ?? false,
			routable: route !== null,
		};

		if (!leg.routable) return { ...leg, reason: "unresolved" };

		if (ship?.stlOnly !== true || leg.sameSystem) return leg;

		const gatePath: IRaukkMultiModalPath | null = raukkGateOnlyPath(
			routes,
			fromSystemId!,
			toSystemId!,
			ship.shipVolumeM3
		);

		if (gatePath === null) {
			return { ...leg, routable: false, reason: "stl-only-no-gate" };
		}

		return { ...leg, gatePath };
	});
}

/**
 * Whether an STL-only hull could fly the WHOLE loop.
 *
 * Every leg has to be same system or gate served; one leg that is not
 * makes the loop unservable, because a loop is flown as one trip and a
 * ship cannot be swapped halfway round it. This is what the automatic
 * hull pick asks before it is allowed to offer an STL-only hull at all.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @param {number} shipVolumeM3 Hull volume in m³, 0 skips the gate cap
 * @returns {boolean} Whether an STL-only hull may fly the loop
 */
export function raukkChainGateServable(
	stops: RAUKK_STOP_REF[],
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE,
	shipVolumeM3: number = 0
): boolean {
	const legs: IRaukkChainLeg[] = buildChainLegs(stops, routes, cxSystems, {
		stlOnly: true,
		shipVolumeM3,
	});

	return legs.length > 0 && legs.every((leg) => leg.routable);
}

/**
 * Claims the flows a chain can carry.
 *
 * A flow is claimed when BOTH its endpoints are stops of the chain; it
 * then rides every leg from its origin forward around the loop to its
 * destination. With repeated stops several boarding positions exist —
 * the pair with the FEWEST ridden legs wins, ties towards the earlier
 * boarding position, which is the shortest ride a dispatcher would
 * pick. Flows starting and ending at the same stop are never claimed.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @param {IRaukkChainFlow[]} flows Candidate flows
 * @returns {IRaukkChainClaim} Claimed and unclaimed flows
 */
export function claimChainFlows(
	stops: RAUKK_STOP_REF[],
	flows: IRaukkChainFlow[]
): IRaukkChainClaim {
	const claimed: IRaukkClaimedFlow[] = [];
	const unclaimed: IRaukkChainFlow[] = [];

	const count: number = stops.length;

	flows.forEach((flow, flowIndex) => {
		if (count < 2 || flow.fromStop === flow.toStop) {
			unclaimed.push(flow);
			return;
		}

		let bestFrom: number = -1;
		let bestTo: number = -1;
		let bestLegs: number = Number.POSITIVE_INFINITY;

		stops.forEach((fromStop, fromIndex) => {
			if (fromStop !== flow.fromStop) return;

			stops.forEach((toStop, toIndex) => {
				if (toStop !== flow.toStop) return;

				const legs: number = (toIndex - fromIndex + count) % count;
				if (legs <= 0) return;

				if (legs < bestLegs) {
					bestLegs = legs;
					bestFrom = fromIndex;
					bestTo = toIndex;
				}
			});
		});

		if (bestFrom < 0) {
			unclaimed.push(flow);
			return;
		}

		const legIndexes: number[] = [];
		for (let step = 0; step < bestLegs; step++) {
			legIndexes.push((bestFrom + step) % count);
		}

		claimed.push({
			flowIndex,
			flow,
			fromIndex: bestFrom,
			toIndex: bestTo,
			legIndexes,
		});
	});

	return { claimed, unclaimed };
}

/** Pricing of one legs distance term, damage included */
interface ILegPricing {
	effectiveParsecs: number;
	effectiveJumps: number;
	distanceCost: number;
	sameSystemMode: RAUKK_SAME_SYSTEM_MODE | null;
	sameSystemBand: IRaukkOrbitBand | null;
	pathMeanDensity: number | null;
	/**
	 * Flat per parsec hull damage. NOT density scaled: calibration §6
	 * measures the jump term reactor AND density independent, and §11.3
	 * reproduces it at 0.001 % per parsec over eight hops through
	 * systems of density 0.20 to 2.97.
	 */
	damagePerParsec: number;
	/**
	 * What the profiles per block damage is multiplied by on this leg,
	 * `pathMeanDensity / densityRef` and 1 when the density is unknown.
	 *
	 * The BLOCK is what carries the meteoroid law (§6, §11.4), so it is
	 * the block — not the parsecs — that a dense path makes expensive.
	 * Until §11.4 this was the wrong way round.
	 */
	blockDamageFactor: number;
	/**
	 * Gate terms of an STL-only leg, null on every FTL leg. Present, its
	 * fees and fuel ARE `distanceCost` and its damage replaces the
	 * `effectiveParsecs * damagePerParsec` term outright.
	 */
	gate: IRaukkGateLegCost | null;
}

/**
 * Parsec weighted mean meteoroid density of one path.
 *
 * Every hop is weighted by its own parsecs and takes the mean density
 * of both its systems; a system missing from the asset falls back to
 * `densityRef`, which makes that hop damage neutral.
 *
 * @author raukk
 *
 * @param {IRaukkRoutePath} path Flown path
 * @param {IRaukkChainStaticData} data Static lookups
 * @param {number} densityRef Reference density, also the fallback
 * @returns {(number | null)} Mean density, null without any distance
 */
function pathMeanDensity(
	path: IRaukkRoutePath,
	data: IRaukkChainStaticData,
	densityRef: number
): number | null {
	let weighted: number = 0;
	let parsecs: number = 0;

	path.hopParsecs.forEach((hop, index) => {
		if (hop <= 0) return;

		const from: number =
			data.densityOf(path.systemIds[index]) ?? densityRef;
		const to: number =
			data.densityOf(path.systemIds[index + 1]) ?? densityRef;

		weighted += hop * ((from + to) / 2);
		parsecs += hop;
	});

	return parsecs > 0 ? weighted / parsecs : null;
}

/**
 * Prices the distance term and the damage rate of one leg.
 *
 * Ordinary legs pay one way parsecs times the profiles ȼ per parsec.
 * Same system legs replace v1s flat cost with the cheaper of two real
 * options: the sublight crossing of the orbital separation band, priced
 * at the band point `sameSystemPricing` selects — midpoint `max(a1, a2)`
 * by default, opposition `a1 + a2` in "worst" — with
 * `stlCostPerMegameter`, and a two
 * jump out and back over the nearest connected system, priced with the
 * normal parsec math. `sameSystemFlatCost` still overrides both when it
 * is set to a non zero value.
 *
 * Hull damage is scaled per leg by the meteoroid density actually
 * flown through, anchored at `densityRef`, and falls back to the flat
 * profile rate whenever the path or a density is unknown. The scaling
 * lands on the SUBLIGHT BLOCK, which is what the meteoroid law belongs
 * to (calibration §6, §11.4); the per parsec jump term is flat.
 *
 * A same system leg priced by the manual `sameSystemFlatCost` override
 * pays HALF of it: the v1 constant is a per ROUND TRIP figure and a
 * round trip is two legs here.
 *
 * @author raukk
 *
 * @param {IRaukkChainLeg} leg Leg
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {IRaukkChainConfig} chainConfig Chain configuration
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {IRaukkChainStaticData} data Static lookups
 * @returns {ILegPricing} Distance cost and damage rate
 */
function priceLeg(
	leg: IRaukkChainLeg,
	profile: IRaukkResolvedShipProfile,
	config: IRaukkShippingConfig,
	chainConfig: IRaukkChainConfig,
	routes: IRaukkRouteDistance,
	data: IRaukkChainStaticData
): ILegPricing {
	const flat: ILegPricing = {
		effectiveParsecs: 0,
		effectiveJumps: 0,
		distanceCost: 0,
		sameSystemMode: null,
		sameSystemBand: null,
		pathMeanDensity: null,
		damagePerParsec: profile.damagePerParsec,
		blockDamageFactor: 1,
		gate: null,
	};

	if (leg.route === null || leg.fromSystemId === null) return flat;

	/*
	 * An STL-only ship gate hopping to the next system: the gate terms
	 * of shipping-calibration.md section 4 REPLACE the parsec terms —
	 * no FTL fuel is burnt, no jump is charged and no per parsec damage
	 * is taken. The one sublight block the caller charges per leg stays,
	 * it is the planet↔gate flying the ship still does.
	 *
	 * SEAM: the distance a gate route covers is reported as
	 * `effectiveParsecs` so the per flow allocation keeps weighting by
	 * distance ridden, but nothing is priced off it.
	 */
	if (leg.gatePath !== undefined) {
		const gate: IRaukkGateLegCost = raukkGateLegCost(leg.gatePath, profile);

		return {
			...flat,
			effectiveParsecs: leg.gatePath.parsecs,
			effectiveJumps: 0,
			distanceCost: gate.fees + gate.fuelCost,
			gate,
		};
	}

	if (!leg.sameSystem) {
		const path: IRaukkRoutePath | null =
			routes.path?.(leg.fromSystemId, leg.toSystemId!) ?? null;
		const density: number | null =
			path !== null
				? pathMeanDensity(path, data, chainConfig.densityRef)
				: null;

		return {
			effectiveParsecs: leg.route.parsecs,
			effectiveJumps: leg.route.jumps,
			distanceCost: leg.route.parsecs * profile.costPerParsec,
			sameSystemMode: null,
			sameSystemBand: null,
			pathMeanDensity: density,
			gate: null,
			damagePerParsec: profile.damagePerParsec,
			blockDamageFactor:
				density !== null && chainConfig.densityRef > 0
					? density / chainConfig.densityRef
					: 1,
		};
	}

	/*
	 * Same system: the manual override still wins when it is set, HALVED
	 * per leg. v1 charges `sameSystemFlatCost` once per ROUND TRIP
	 * (`calculateCostPerTrip`), and the round trip of a two stop loop is
	 * two legs — charging it whole per leg would double it and break the
	 * documented v1 parity of a degenerate chain.
	 */
	if (config.sameSystemFlatCost > 0) {
		return {
			...flat,
			distanceCost: config.sameSystemFlatCost / 2,
			sameSystemMode: "flat",
		};
	}

	const band: IRaukkOrbitBand | null =
		leg.fromStop === leg.toStop
			? { bestMegameters: 0, worstMegameters: 0, midpointMegameters: 0 }
			: data.bandBetween(leg.fromStop, leg.toStop);

	/*
	 * Round 5 decision 1: a single point of the separation band is
	 * priced, never a range. "average" is the band midpoint, "worst" its
	 * opposition distance; an absent setting is the shipped average.
	 */
	const bandMegameters: number | null =
		band !== null
			? chainConfig.sameSystemPricing === "worst"
				? band.worstMegameters
				: band.midpointMegameters
			: null;

	const stlCost: number | null =
		bandMegameters !== null
			? bandMegameters * chainConfig.stlCostPerMegameter
			: null;

	const neighbor: IRaukkNearestNeighbor | null =
		routes.nearestNeighbor?.(leg.fromSystemId) ?? null;
	const twoJumpParsecs: number | null =
		neighbor !== null ? 2 * neighbor.parsecs : null;
	const twoJumpCost: number | null =
		twoJumpParsecs !== null ? twoJumpParsecs * profile.costPerParsec : null;

	if (stlCost === null && twoJumpCost === null) {
		return { ...flat, sameSystemMode: "free", sameSystemBand: band };
	}

	// ties go to the sublight crossing: it burns no jump damage at all
	const flySublight: boolean =
		stlCost !== null && (twoJumpCost === null || stlCost <= twoJumpCost);

	if (flySublight) {
		return {
			...flat,
			distanceCost: stlCost!,
			sameSystemMode: "stl",
			sameSystemBand: band,
		};
	}

	const neighborDensity: number =
		((data.densityOf(leg.fromSystemId) ?? chainConfig.densityRef) +
			(data.densityOf(neighbor!.systemId) ?? chainConfig.densityRef)) /
		2;

	return {
		effectiveParsecs: twoJumpParsecs!,
		effectiveJumps: 2,
		distanceCost: twoJumpCost!,
		sameSystemMode: "two-jump",
		sameSystemBand: band,
		pathMeanDensity: neighborDensity,
		gate: null,
		damagePerParsec: profile.damagePerParsec,
		blockDamageFactor:
			chainConfig.densityRef > 0
				? neighborDensity / chainConfig.densityRef
				: 1,
	};
}

/** Zero result of a chain that ships nothing */
function emptyChainShipping(
	chainId: string,
	unclaimed: IRaukkChainFlow[],
	legs: IRaukkChainLegResult[] = []
): IRaukkChainShipping {
	return {
		chainId,
		hired: false,
		tripsPerDay: 0,
		costPerTrip: 0,
		repairCostPerTrip: 0,
		damagePerTrip: 0,
		dailyCost: 0,
		roundTripMinutes: 0,
		shippingFraction: 0,
		legs,
		bindingLegIndex: -1,
		flows: [],
		unclaimed,
		perUnit: {},
	};
}

/**
 * Shipping of one chain loop.
 *
 * Every leg carries the flows riding it; the busiest leg — the weakest
 * link — sets `tripsPerDay`, and every other leg flies at that same
 * frequency, which is exactly what the low utilization drop rule later
 * questions. One trip pays every legs distance term, one sublight block
 * per stop visit and the repair share of the damage taken, so the two
 * stop degenerate case reproduces the v1 round trip cost exactly.
 *
 * Cost allocation is per leg: a legs daily cost goes to the flows
 * riding it, split by their share of that legs binding dimension. Legs
 * without a load spread over ALL the chains flows by flow parsecs
 * (units times parsecs ridden), so a deadhead leg is paid for by the
 * cargo it exists for.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @returns {IRaukkChainShipping} Chain shipping result
 */
export function calculateChainShipping(
	input: IRaukkChainInput
): IRaukkChainShipping {
	const { chain, profile, config, chainConfig, repairBillCost } = input;

	if (!config.enabled) {
		return emptyChainShipping(chain.chainId, [...input.flows]);
	}

	const routes: IRaukkRouteDistance =
		input.routes ?? RAUKK_DEFAULT_CHAIN_ROUTES;
	const data: IRaukkChainStaticData = input.data ?? RAUKK_DEFAULT_CHAIN_DATA;
	const cxSystems: Record<string, string> =
		input.cxSystems ?? RAUKK_CX_SYSTEM_ID_BY_CODE;

	const legs: IRaukkChainLeg[] = buildChainLegs(
		chain.stops,
		routes,
		cxSystems,
		raukkChainLegShip(profile)
	);
	const claim: IRaukkChainClaim = claimChainFlows(chain.stops, input.flows);

	if (legs.length === 0) {
		return emptyChainShipping(chain.chainId, [...input.flows]);
	}

	/** Per leg cargo, summed over the flows riding that leg */
	const weightPerDay: number[] = legs.map(() => 0);
	const volumePerDay: number[] = legs.map(() => 0);
	const riders: IRaukkClaimedFlow[][] = legs.map(() => []);

	claim.claimed.forEach((entry) => {
		const units: number = Math.max(entry.flow.unitsPerDay, 0);

		entry.legIndexes.forEach((legIndex) => {
			riders[legIndex].push(entry);

			if (units <= 0) return;

			weightPerDay[legIndex] +=
				units * Math.max(entry.flow.weightPerUnit, 0);
			volumePerDay[legIndex] +=
				units * Math.max(entry.flow.volumePerUnit, 0);
		});
	});

	const pricing: ILegPricing[] = legs.map((leg) =>
		priceLeg(leg, profile, config, chainConfig, routes, data)
	);

	const loads: number[] = legs.map((leg, index) => {
		const weightLoads: number =
			profile.cargoWeight > 0
				? weightPerDay[index] / profile.cargoWeight
				: 0;
		const volumeLoads: number =
			profile.cargoVolume > 0
				? volumePerDay[index] / profile.cargoVolume
				: 0;

		return Math.max(weightLoads, volumeLoads);
	});

	const bindingLoads: number = loads.reduce(
		(best, value) => Math.max(best, value),
		0
	);

	if (bindingLoads <= 0) {
		return emptyChainShipping(chain.chainId, claim.unclaimed);
	}

	const bindingLegIndex: number = loads.indexOf(bindingLoads);

	/*
	 * The cadence cap only ever SHORTENS the interval: a loop whose
	 * binding leg needs 28 days to fill under a 14 day cap flies half full
	 * every 14 days, and that partial trip pays a full trip. Without a cap
	 * — every user authored chain — the loop flies exactly as often as its
	 * binding leg fills, which is the pre cadence behaviour.
	 */
	const tripsPerDay: number = raukkCadenceOf(
		bindingLoads,
		input.capDays ?? 0
	).tripsPerDay;

	const hired: boolean = chain.lmRatePerTrip !== undefined;

	/** Hull damage per trip, per leg; a hired chain wears no own hull */
	const legDamage: number[] = legs.map((leg, index) => {
		if (hired) return 0;

		const gate: IRaukkGateLegCost | null = pricing[index].gate;

		/*
		 * A gate served leg takes the flat per traversal damage of
		 * shipping-calibration.md section 4 and NO per parsec damage:
		 * the ship never flies those parsecs, the gate does.
		 */
		return (
			(gate !== null
				? gate.damage
				: pricing[index].effectiveParsecs *
					pricing[index].damagePerParsec) +
			profile.damagePerStlBlock * pricing[index].blockDamageFactor
		);
	});

	/** Own fleet repair cost per trip, per leg */
	const legRepair: number[] = legDamage.map(
		(damage) => (damage / RAUKK_REPAIR_AT_DAMAGE) * repairBillCost
	);

	const ownLegCost: number[] = legs.map(
		(leg, index) =>
			pricing[index].distanceCost +
			profile.stlBlockCost +
			legRepair[index]
	);
	const ownCostPerTrip: number = ownLegCost.reduce(
		(sum, value) => sum + value,
		0
	);

	/*
	 * A hired chain pays the LM rate instead of the own fleet cost. The
	 * rate is a per TRIP figure with no leg structure, so it is spread
	 * over the legs by their own cost share — equally when the own cost
	 * is zero — purely so the per flow allocation below keeps working.
	 */
	const costPerTrip: number = hired ? chain.lmRatePerTrip! : ownCostPerTrip;
	const legCostPerTrip: number[] = legs.map((leg, index) => {
		if (!hired) return ownLegCost[index];

		return ownCostPerTrip > 0
			? costPerTrip * (ownLegCost[index] / ownCostPerTrip)
			: costPerTrip / legs.length;
	});

	const dailyCost: number = tripsPerDay * costPerTrip;

	const binding: RAUKK_LOAD_DIMENSION[] = legs.map((leg, index) =>
		profile.cargoWeight > 0 &&
		weightPerDay[index] / profile.cargoWeight >=
			(profile.cargoVolume > 0
				? volumePerDay[index] / profile.cargoVolume
				: 0)
			? "weight"
			: "volume"
	);

	const bindingPerDay: number[] = legs.map((leg, index) =>
		binding[index] === "weight" ? weightPerDay[index] : volumePerDay[index]
	);

	const legMinutes: number[] = legs.map((leg, index) => {
		const gate: IRaukkGateLegCost | null = pricing[index].gate;

		// gate minutes are the measured traversal time and replace the
		// hulls own FTL speed, which an STL-only ship does not have
		const flight: number =
			gate !== null
				? gate.minutes
				: pricing[index].effectiveParsecs * profile.minutesPerParsec +
					pricing[index].effectiveJumps * profile.chargeMinutes;

		return flight + stlBlockMinutes(profile, loads[index] / tripsPerDay);
	});

	const roundTripMinutes: number = legMinutes.reduce(
		(sum, value) => sum + value,
		0
	);

	const shippingFraction: number =
		hired || profile.shipsAvailable <= 0
			? 0
			: (tripsPerDay * roundTripMinutes) /
				(MINUTES_PER_DAY * profile.shipsAvailable);

	/** ȼ per day per claimed flow */
	const flowDaily: number[] = claim.claimed.map(() => 0);

	/** Cost of legs nothing rides, spread over every flow below */
	let spread: number = 0;

	legs.forEach((leg, index) => {
		const legDaily: number = tripsPerDay * legCostPerTrip[index];
		if (legDaily === 0) return;

		if (bindingPerDay[index] <= 0) {
			spread += legDaily;
			return;
		}

		riders[index].forEach((entry) => {
			const units: number = Math.max(entry.flow.unitsPerDay, 0);
			if (units <= 0) return;

			const perUnitBinding: number = Math.max(
				binding[index] === "weight"
					? entry.flow.weightPerUnit
					: entry.flow.volumePerUnit,
				0
			);

			const contribution: number = units * perUnitBinding;
			if (contribution <= 0) return;

			const position: number = claim.claimed.indexOf(entry);
			flowDaily[position] +=
				legDaily * (contribution / bindingPerDay[index]);
		});
	});

	const flowParsecs: number[] = claim.claimed.map((entry) => {
		const parsecs: number = entry.legIndexes.reduce(
			(sum, legIndex) => sum + pricing[legIndex].effectiveParsecs,
			0
		);

		return Math.max(entry.flow.unitsPerDay, 0) * parsecs;
	});

	if (spread > 0) {
		const totalParsecs: number = flowParsecs.reduce(
			(sum, value) => sum + value,
			0
		);
		const totalUnits: number = claim.claimed.reduce(
			(sum, entry) => sum + Math.max(entry.flow.unitsPerDay, 0),
			0
		);

		claim.claimed.forEach((entry, position) => {
			if (totalParsecs > 0) {
				flowDaily[position] +=
					spread * (flowParsecs[position] / totalParsecs);
				return;
			}

			// every flow rides zero parsecs: fall back to plain units
			if (totalUnits > 0) {
				flowDaily[position] +=
					spread * (Math.max(entry.flow.unitsPerDay, 0) / totalUnits);
			}
		});
	}

	const flows: IRaukkChainFlowResult[] = claim.claimed.map(
		(entry, position) => {
			const units: number = Math.max(entry.flow.unitsPerDay, 0);

			return {
				flowIndex: entry.flowIndex,
				flowId: entry.flow.flowId ?? `${entry.flowIndex}`,
				ticker: entry.flow.ticker,
				fromStop: entry.flow.fromStop,
				toStop: entry.flow.toStop,
				unitsPerDay: entry.flow.unitsPerDay,
				legIndexes: entry.legIndexes,
				parsecs: entry.legIndexes.reduce(
					(sum, legIndex) => sum + pricing[legIndex].effectiveParsecs,
					0
				),
				dailyCost: flowDaily[position],
				costPerUnit: units > 0 ? flowDaily[position] / units : 0,
			};
		}
	);

	const perUnitCost: Record<string, number> = {};
	const perUnitUnits: Record<string, number> = {};

	flows.forEach((flow) => {
		const units: number = Math.max(flow.unitsPerDay, 0);
		if (units <= 0) return;

		perUnitCost[flow.ticker] =
			(perUnitCost[flow.ticker] ?? 0) + flow.dailyCost;
		perUnitUnits[flow.ticker] = (perUnitUnits[flow.ticker] ?? 0) + units;
	});

	const perUnit: Record<string, number> = {};
	Object.entries(perUnitUnits).forEach(([ticker, units]) => {
		perUnit[ticker] = (perUnitCost[ticker] ?? 0) / units;
	});

	const legResults: IRaukkChainLegResult[] = legs.map((leg, index) => ({
		...leg,
		weightPerDay: weightPerDay[index],
		volumePerDay: volumePerDay[index],
		loads: loads[index],
		binding: binding[index],
		bindingPerDay: bindingPerDay[index],
		utilization: loads[index] / tripsPerDay,
		effectiveParsecs: pricing[index].effectiveParsecs,
		effectiveJumps: pricing[index].effectiveJumps,
		sameSystemMode: pricing[index].sameSystemMode,
		sameSystemBand: pricing[index].sameSystemBand,
		pathMeanDensity: pricing[index].pathMeanDensity,
		damagePerParsec: pricing[index].damagePerParsec,
		gate: pricing[index].gate,
		costPerTrip: legCostPerTrip[index],
		repairCostPerTrip: legRepair[index],
		damagePerTrip: legDamage[index],
		dailyCost: tripsPerDay * legCostPerTrip[index],
		roundTripMinutes: legMinutes[index],
	}));

	return {
		chainId: chain.chainId,
		hired,
		tripsPerDay,
		costPerTrip,
		repairCostPerTrip: legRepair.reduce((sum, value) => sum + value, 0),
		damagePerTrip: legDamage.reduce((sum, value) => sum + value, 0),
		dailyCost,
		roundTripMinutes,
		shippingFraction,
		legs: legResults,
		bindingLegIndex,
		flows,
		unclaimed: claim.unclaimed,
		perUnit,
	};
}

/**
 * The same chain, flown backwards.
 *
 * Flying the wrong way round is the easiest authoring mistake of the
 * whole model, and it is cheap to check: same stops, same flows, other
 * direction — the flows simply ride the complementary legs.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @returns {IRaukkChainShipping} Result of the reversed loop
 */
export function calculateReversedChainShipping(
	input: IRaukkChainInput
): IRaukkChainShipping {
	return calculateChainShipping({
		...input,
		chain: {
			...input.chain,
			stops: reverseChainStops(input.chain.stops),
		},
	});
}

/** Detour of one leg over one anchor system, `null` when not computable */
function anchorDetour(
	leg: IRaukkChainLeg,
	anchorSystemId: string,
	routes: IRaukkRouteDistance
): number | null {
	if (
		leg.route === null ||
		leg.fromSystemId === null ||
		leg.toSystemId === null
	) {
		return null;
	}

	// an anchor the leg already ends at is no detour candidate
	if (
		leg.fromSystemId === anchorSystemId ||
		leg.toSystemId === anchorSystemId
	) {
		return null;
	}

	const toAnchor: IRaukkRoute | null = routes.route(
		leg.fromSystemId,
		anchorSystemId
	);
	const fromAnchor: IRaukkRoute | null = routes.route(
		anchorSystemId,
		leg.toSystemId
	);

	if (toAnchor === null || fromAnchor === null) return null;

	return toAnchor.parsecs + fromAnchor.parsecs - leg.route.parsecs;
}

/**
 * Every point a loop may be cut at: the exchanges, plus the planets the
 * account marked as depots.
 *
 * raukk: a depot anchors for ROUTING alone — it is where a gate side ship
 * and an FTL hauler hand cargo over — and carries no market semantics of
 * any kind. Exchanges come first, so a tie between the two kinds still
 * goes to the exchange, which is the behaviour of every chain authored
 * before depots existed. A depot that resolves to no system is silently
 * no anchor: an unroutable handover point is not one.
 *
 * @author raukk
 *
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @param {RAUKK_STOP_REF[]} depots Depot planet natural ids
 * @returns {IRaukkChainAnchor[]} Candidate anchors, exchanges first
 */
export function raukkChainAnchors(
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE,
	depots: RAUKK_STOP_REF[] = []
): IRaukkChainAnchor[] {
	const anchors: IRaukkChainAnchor[] = Object.entries(cxSystems).map(
		([cxCode, systemId]) => ({
			kind: "cx" as RAUKK_CHAIN_ANCHOR_KIND,
			stopRef: cxCode,
			systemId,
		})
	);

	depots.forEach((stopRef) => {
		const systemId: string | null = routes.resolveSystemId(stopRef);
		if (systemId === null) return;

		anchors.push({ kind: "depot", stopRef, systemId });
	});

	return anchors;
}

/** Cheapest anchor detour of one leg */
function bestAnchorDetour(
	leg: IRaukkChainLeg,
	routes: IRaukkRouteDistance,
	anchors: IRaukkChainAnchor[]
): IRaukkCxSplitTrigger | null {
	let best: IRaukkCxSplitTrigger | null = null;

	anchors.forEach((anchor) => {
		const detour: number | null = anchorDetour(
			leg,
			anchor.systemId,
			routes
		);
		if (detour === null) return;

		if (best === null || detour < best.detourParsecs) {
			best = {
				legIndex: leg.index,
				cxCode: anchor.stopRef,
				cxSystemId: anchor.systemId,
				detourParsecs: detour,
				anchorKind: anchor.kind,
			};
		}
	});

	return best;
}

/**
 * Whether one stop of the loop IS the anchor the trigger names.
 *
 * An exchange is matched by SYSTEM: every stop in the exchanges system
 * sits where the ship passes it anyway, which is what the rule has always
 * meant. A depot is matched by the stop reference itself — the warehouse
 * stands on one planet, and a neighbouring base in the same system is no
 * handover point at all.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF} stopRef Stop reference
 * @param {IRaukkCxSplitTrigger} trigger Triggering leg and anchor
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {boolean} True when the stop is the anchor
 */
function isAnchorStop(
	stopRef: RAUKK_STOP_REF,
	trigger: IRaukkCxSplitTrigger,
	routes: IRaukkRouteDistance,
	cxSystems: Record<string, string>
): boolean {
	if (trigger.anchorKind === "depot") {
		return raukkDepotStopKey(stopRef) === raukkDepotStopKey(trigger.cxCode);
	}

	return chainStopSystemId(stopRef, routes, cxSystems) === trigger.cxSystemId;
}

/**
 * The leg whose shortest path all but touches an anchor.
 *
 * Trigger of the split rule: `parsecs(via anchor) − parsecs(direct)` at
 * or below `cxSplitDetourParsecs` on any leg. The cheapest detour of the
 * whole loop wins, ties towards the earlier leg — and, at equal detour,
 * towards the exchange over the depot.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @returns {(IRaukkCxSplitTrigger | null)} Trigger, null if none fires
 */
export function detectCxSplit(
	input: IRaukkChainInput
): IRaukkCxSplitTrigger | null {
	const routes: IRaukkRouteDistance =
		input.routes ?? RAUKK_DEFAULT_CHAIN_ROUTES;
	const cxSystems: Record<string, string> =
		input.cxSystems ?? RAUKK_CX_SYSTEM_ID_BY_CODE;

	const legs: IRaukkChainLeg[] = buildChainLegs(
		input.chain.stops,
		routes,
		cxSystems
	);

	const anchors: IRaukkChainAnchor[] = raukkChainAnchors(
		routes,
		cxSystems,
		input.depots ?? []
	);

	let best: IRaukkCxSplitTrigger | null = null;

	legs.forEach((leg) => {
		const candidate: IRaukkCxSplitTrigger | null = bestAnchorDetour(
			leg,
			routes,
			anchors
		);
		if (candidate === null) return;

		if (best === null || candidate.detourParsecs < best.detourParsecs) {
			best = candidate;
		}
	});

	if (best === null) return null;

	return (best as IRaukkCxSplitTrigger).detourParsecs <=
		input.chainConfig.cxSplitDetourParsecs
		? best
		: null;
}

/**
 * Cuts a chain into two anchor anchored sub chains.
 *
 * The loop is cut at TWO positions, both of them the anchor: cutting
 * a cycle at a single vertex would only produce the same cycle again.
 * The first cut is the triggering leg, where the anchor is inserted;
 * the second is an anchor stop the loop already has — the canonical
 * `CX → extractor → smelter → CX` case — or, when there is none, the
 * next best leg of the same anchor by detour, so both cuts sit where
 * the ship passes the anchor anyway.
 *
 * Flows staying inside one sub chain are handed over untouched; flows
 * crossing the cut become two flows, origin → anchor and anchor →
 * destination, trans-shipped through the exchanges infinite storage or,
 * at a depot, through the warehouse the user keeps there.
 *
 * raukk: each half may be flown by its OWN ship — the gate side hopper
 * and the FTL hauler of the depot case — so a sub chain carries the side
 * profile the chain named for it, falling back to the chains own hull.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @param {IRaukkCxSplitTrigger} trigger Triggering leg and anchor
 * @returns {IRaukkCxSubChain[]} Two sub chains, empty when not splittable
 */
export function buildCxSplitChains(
	input: IRaukkChainInput,
	trigger: IRaukkCxSplitTrigger
): IRaukkCxSubChain[] {
	const routes: IRaukkRouteDistance =
		input.routes ?? RAUKK_DEFAULT_CHAIN_ROUTES;
	const cxSystems: Record<string, string> =
		input.cxSystems ?? RAUKK_CX_SYSTEM_ID_BY_CODE;

	const stops: RAUKK_STOP_REF[] = input.chain.stops;
	if (stops.length < 2) return [];

	const existing: number[] = stops
		.map((stopRef, index) =>
			isAnchorStop(stopRef, trigger, routes, cxSystems) ? index : -1
		)
		.filter((index) => index >= 0);

	/** Insert positions in the ORIGINAL loop, ascending */
	const insertions: number[] = [trigger.legIndex + 1];

	if (existing.length === 0) {
		const legs: IRaukkChainLeg[] = buildChainLegs(stops, routes, cxSystems);

		let second: IRaukkCxSplitTrigger | null = null;

		legs.forEach((leg) => {
			if (leg.index === trigger.legIndex) return;

			const detour: number | null = anchorDetour(
				leg,
				trigger.cxSystemId,
				routes
			);
			if (detour === null) return;

			if (second === null || detour < second.detourParsecs) {
				second = {
					...trigger,
					legIndex: leg.index,
					detourParsecs: detour,
				};
			}
		});

		if (second === null) return [];

		insertions.push((second as IRaukkCxSplitTrigger).legIndex + 1);
	}

	const augmented: RAUKK_STOP_REF[] = [...stops];
	[...insertions]
		.sort((a, b) => b - a)
		.forEach((position) => augmented.splice(position, 0, trigger.cxCode));

	const anchors: number[] = augmented
		.map((stopRef, index) =>
			isAnchorStop(stopRef, trigger, routes, cxSystems) ? index : -1
		)
		.filter((index) => index >= 0);

	if (anchors.length < 2) return [];

	const first: number = anchors[0];
	const second: number = anchors[1];

	const stopsA: RAUKK_STOP_REF[] = augmented.slice(first, second);
	const stopsB: RAUKK_STOP_REF[] = [
		...augmented.slice(second),
		...augmented.slice(0, first),
	];

	/** One half, carrying the side profile the chain named for it */
	function subChainOf(
		side: string,
		sideStops: RAUKK_STOP_REF[]
	): IRaukkCxSubChain {
		return {
			chain: {
				...input.chain,
				chainId: `${input.chain.chainId}#${side}`,
				stops: sideStops,
				profileId:
					input.chain.sideProfiles?.[side] ?? input.chain.profileId,
			},
			flows: [],
		};
	}

	const subChains: IRaukkCxSubChain[] = [
		subChainOf(RAUKK_CHAIN_SIDE_KEYS[0], stopsA),
		subChainOf(RAUKK_CHAIN_SIDE_KEYS[1], stopsB),
	];

	function subOf(stopRef: RAUKK_STOP_REF): number {
		if (stopsA.includes(stopRef)) return 0;
		if (stopsB.includes(stopRef)) return 1;

		return -1;
	}

	input.flows.forEach((flow) => {
		const from: number = subOf(flow.fromStop);
		const to: number = subOf(flow.toStop);

		if (from < 0 && to < 0) {
			// touches neither sub chain, surfaces as unclaimed
			subChains[0].flows.push(flow);
			return;
		}

		if (from === to || from < 0 || to < 0) {
			subChains[Math.max(from, to)].flows.push(flow);
			return;
		}

		/*
		 * Both halves are trans-shipped through the exchange. A half
		 * that starts and ends at the exchange itself is no cargo run
		 * at all — that happens whenever one endpoint IS the exchange —
		 * and is dropped instead of emitted as a self flow.
		 */
		const toCx: IRaukkChainFlow = {
			...flow,
			flowId: `${flow.flowId ?? flow.ticker}>cx`,
			toStop: subChains[from].chain.stops[0],
		};
		const fromCx: IRaukkChainFlow = {
			...flow,
			flowId: `cx>${flow.flowId ?? flow.ticker}`,
			fromStop: subChains[to].chain.stops[0],
		};

		if (toCx.fromStop !== toCx.toStop) subChains[from].flows.push(toCx);
		if (fromCx.fromStop !== fromCx.toStop) subChains[to].flows.push(fromCx);
	});

	return subChains;
}

/**
 * Split versus unsplit costing of one chain.
 *
 * Both numbers are always produced, whether or not auto splitting is
 * on: the sublight premium of the split has to stay visible.
 *
 * raukk: each half flies its OWN side profile where the caller resolved
 * one, so an STL-only gate hopper on the depot side and an FTL hauler on
 * the exchange side are one chain rather than two.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @returns {IRaukkCxSplitResult} Comparison of both costings
 */
export function calculateChainCxSplit(
	input: IRaukkChainInput
): IRaukkCxSplitResult {
	const unsplit: IRaukkChainShipping = calculateChainShipping(input);
	const trigger: IRaukkCxSplitTrigger | null = detectCxSplit(input);

	const subChainInputs: IRaukkCxSubChain[] =
		trigger !== null ? buildCxSplitChains(input, trigger) : [];

	const subChains: IRaukkChainShipping[] = subChainInputs.map((sub) => {
		const side: string | undefined = raukkChainSideKey(sub.chain.chainId);

		const profile: IRaukkResolvedShipProfile =
			(side !== undefined ? input.sideProfiles?.[side] : undefined) ??
			input.profile;

		return calculateChainShipping({
			...input,
			chain: sub.chain,
			profile,
			flows: sub.flows,
		});
	});

	const splitDailyCost: number =
		subChains.length > 0
			? subChains.reduce((sum, result) => sum + result.dailyCost, 0)
			: unsplit.dailyCost;

	return {
		trigger,
		unsplit,
		subChains,
		unsplitDailyCost: unsplit.dailyCost,
		splitDailyCost,
		splitCheaper: splitDailyCost < unsplit.dailyCost,
	};
}

/** Flows of a claimed chain result touching one stop */
function flowsTouching(
	flows: IRaukkChainFlow[],
	stopRef: RAUKK_STOP_REF
): IRaukkChainFlow[] {
	return flows.filter(
		(flow) => flow.fromStop === stopRef || flow.toStop === stopRef
	);
}

/** One flow as the v1 shipped ticker shape, `production` by default */
function shippedTicker(flow: IRaukkChainFlow): IRaukkShippedTicker {
	return {
		ticker: flow.ticker,
		bucket: flow.bucket ?? "production",
		unitsPerDay: flow.unitsPerDay,
		weightPerUnit: flow.weightPerUnit,
		volumePerUnit: flow.volumePerUnit,
	};
}

/**
 * The dropped flows priced as standalone v1 pairs.
 *
 * One pair per counterparty stop, run at ITS OWN frequency — which is
 * the whole point of the drop rule: a stop that only needs a fraction
 * of a hull per trip does not have to ride along on every chain trip.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF} stopRef Dropped stop
 * @param {IRaukkChainFlow[]} dropped Flows of that stop
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @returns {IRaukkPairShipping[]} One pair result per counterparty
 */
function standalonePairs(
	stopRef: RAUKK_STOP_REF,
	dropped: IRaukkChainFlow[],
	input: IRaukkChainInput
): IRaukkPairShipping[] {
	const routes: IRaukkRouteDistance =
		input.routes ?? RAUKK_DEFAULT_CHAIN_ROUTES;
	const cxSystems: Record<string, string> =
		input.cxSystems ?? RAUKK_CX_SYSTEM_ID_BY_CODE;

	const systemId: string | null = chainStopSystemId(
		stopRef,
		routes,
		cxSystems
	);
	if (systemId === null) return [];

	/** Counterparty stop to the flows leaving and arriving there */
	const partners: Map<string, IRaukkChainFlow[]> = new Map();

	dropped.forEach((flow) => {
		const partner: string =
			flow.fromStop === stopRef ? flow.toStop : flow.fromStop;

		partners.set(partner, [...(partners.get(partner) ?? []), flow]);
	});

	const results: IRaukkPairShipping[] = [];

	partners.forEach((flows, partner) => {
		const partnerSystemId: string | null = chainStopSystemId(
			partner,
			routes,
			cxSystems
		);
		if (partnerSystemId === null) return;

		const route: IRaukkRoute | null = routes.route(
			systemId,
			partnerSystemId
		);
		if (route === null) return;

		const pair: IRaukkShippingPair = {
			pairKey: `${stopRef}>${partner}`,
			profile: input.profile,
			route,
			out: flows
				.filter((flow) => flow.fromStop === stopRef)
				.map(shippedTicker),
			back: flows
				.filter((flow) => flow.toStop === stopRef)
				.map(shippedTicker),
		};

		/*
		 * The dropped flows are costed as the standalone lanes they
		 * would become. A chain is account level and knows no consuming
		 * plan, so the cadence caps are the ACCOUNT defaults with the
		 * shipped repair cadence — the same answer a plan without any
		 * override gets. Chains themselves stay one loop and are never
		 * split per bucket (shipping-decisions.md round 10).
		 */
		results.push(
			calculatePairShipping(
				pair,
				input.config,
				input.repairBillCost,
				raukkCadenceCaps(
					input.config,
					RAUKK_DEFAULT_CADENCE_REPAIR_DAYS
				)
			)
		);
	});

	return results;
}

/**
 * Three way comparison for every low utilization stop of a chain.
 *
 * A chain forces every leg to the binding legs frequency, so a leg at
 * five percent of the hull rides nearly empty on every single trip. The
 * threshold only decides WHAT is evaluated; the recommendation is the
 * honest cost comparison the rule prescribes:
 *
 *   cost(chain as is) versus cost(chain without the stop) + cost(the
 *   dropped flows as standalone pairs at their own frequency)
 *
 * Nothing is mutated — the caller, and ultimately the user, decides.
 * Stops appearing more than once in the loop are skipped: removing one
 * occurrence of a repeated stop is a different edit than dropping it.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @returns {IRaukkChainDropEvaluation[]} One entry per evaluated stop
 */
export function evaluateChainDrops(
	input: IRaukkChainInput
): IRaukkChainDropEvaluation[] {
	const asIs: IRaukkChainShipping = calculateChainShipping(input);

	if (asIs.tripsPerDay <= 0 || input.chain.stops.length <= 2) return [];

	const stops: RAUKK_STOP_REF[] = input.chain.stops;
	const count: number = stops.length;

	const evaluations: IRaukkChainDropEvaluation[] = [];

	stops.forEach((stopRef, stopIndex) => {
		if (stops.filter((entry) => entry === stopRef).length > 1) return;

		const incoming: IRaukkChainLegResult =
			asIs.legs[(stopIndex - 1 + count) % count];
		const outgoing: IRaukkChainLegResult = asIs.legs[stopIndex];

		const utilization: number = Math.min(
			incoming.utilization,
			outgoing.utilization
		);

		if (utilization >= input.chainConfig.legUtilizationSplitThreshold) {
			return;
		}

		const claimedFlows: IRaukkChainFlow[] = asIs.flows.map(
			(flow) => input.flows[flow.flowIndex]
		);

		const dropped: IRaukkChainFlow[] = flowsTouching(claimedFlows, stopRef);

		const without: IRaukkChainShipping = calculateChainShipping({
			...input,
			chain: {
				...input.chain,
				stops: stops.filter((entry, index) => index !== stopIndex),
			},
			flows: input.flows.filter((flow) => !dropped.includes(flow)),
		});

		const pairs: IRaukkPairShipping[] = standalonePairs(
			stopRef,
			dropped,
			input
		);

		const standaloneDaily: number = pairs.reduce(
			(sum, result) => sum + result.dailyCost,
			0
		);

		const droppedDaily: number = without.dailyCost + standaloneDaily;

		evaluations.push({
			stopIndex,
			stopRef,
			utilization,
			dailyCostAsIs: asIs.dailyCost,
			dailyCostWithoutStop: without.dailyCost,
			dailyCostStandalone: standaloneDaily,
			standalonePairs: pairs,
			savingPerDay: asIs.dailyCost - droppedDaily,
			// a saving of less than a cent is not a saving: the deadband
			// keeps a hair-width difference from recommending an edit
			recommendDrop: asIs.dailyCost - droppedDaily > RAUKK_EPSILON_EQUAL,
		});
	});

	return evaluations;
}
