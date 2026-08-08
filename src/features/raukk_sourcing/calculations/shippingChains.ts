// Multi stop shipping chains: pure math over an ordered LOOP of stops.
// See docs/raukk_sourcing/shipping-chains-v2.md — a v1 route pair is the
// two stop degenerate case of this model and every primitive is reused
// from shipping.ts rather than reimplemented. No store, no Vue, no
// price fetching: the repair bill price arrives pre-computed.

// Calculations
import {
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

// Types & Interfaces
import {
	IRaukkNearestNeighbor,
	IRaukkRoute,
	IRaukkRouteDistance,
	IRaukkRoutePath,
} from "@/features/raukk_sourcing/calculations/routeDistance";
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
 * Defaults of the chain knobs, every one of them from
 * shipping-chains-v2.md.
 *
 * `stlCostPerMegameter` is the one value the document leaves to the
 * implementation: nothing in the v1 profile calibration prices sublight
 * DISTANCE, so it starts at 0 exactly like `costPerParsec` does and the
 * same system leg then costs whatever the two jump alternative costs.
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
	};
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
 * Builds the legs of a chain loop.
 *
 * A leg is identified by its POSITION, never by its stops: repeated
 * stops are legal — `A→B→C→B→A` is how an out and back path is
 * expressed — so nothing here may assume stop uniqueness. A loop of n
 * stops has n legs, the last one closing back to the first stop.
 *
 * @author raukk
 *
 * @param {RAUKK_STOP_REF[]} stops Ordered loop
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Record<string, string>} cxSystems Exchange code to system id
 * @returns {IRaukkChainLeg[]} Legs, in travel order
 */
export function buildChainLegs(
	stops: RAUKK_STOP_REF[],
	routes: IRaukkRouteDistance = RAUKK_DEFAULT_CHAIN_ROUTES,
	cxSystems: Record<string, string> = RAUKK_CX_SYSTEM_ID_BY_CODE
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

		return {
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
	});
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
	damagePerParsec: number;
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
 * profile rate whenever the path or a density is unknown.
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
	};

	if (leg.route === null || leg.fromSystemId === null) return flat;

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
			damagePerParsec:
				density !== null && chainConfig.densityRef > 0
					? (profile.damagePerParsec * density) /
						chainConfig.densityRef
					: profile.damagePerParsec,
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
		damagePerParsec:
			chainConfig.densityRef > 0
				? (profile.damagePerParsec * neighborDensity) /
					chainConfig.densityRef
				: profile.damagePerParsec,
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
		cxSystems
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

	const tripsPerDay: number = loads.reduce(
		(best, value) => Math.max(best, value),
		0
	);

	if (tripsPerDay <= 0) {
		return emptyChainShipping(chain.chainId, claim.unclaimed);
	}

	const bindingLegIndex: number = loads.indexOf(tripsPerDay);

	const hired: boolean = chain.lmRatePerTrip !== undefined;

	/** Own fleet cost per trip, per leg */
	const legRepair: number[] = legs.map((leg, index) => {
		if (hired) return 0;

		const damage: number =
			pricing[index].effectiveParsecs * pricing[index].damagePerParsec +
			profile.damagePerStlBlock;

		return (damage / RAUKK_REPAIR_AT_DAMAGE) * repairBillCost;
	});

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

	const legMinutes: number[] = legs.map(
		(leg, index) =>
			pricing[index].effectiveParsecs * profile.minutesPerParsec +
			pricing[index].effectiveJumps * profile.chargeMinutes +
			stlBlockMinutes(profile, loads[index] / tripsPerDay)
	);

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
		costPerTrip: legCostPerTrip[index],
		repairCostPerTrip: legRepair[index],
		dailyCost: tripsPerDay * legCostPerTrip[index],
		roundTripMinutes: legMinutes[index],
	}));

	return {
		chainId: chain.chainId,
		hired,
		tripsPerDay,
		costPerTrip,
		repairCostPerTrip: legRepair.reduce((sum, value) => sum + value, 0),
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

/** Detour of one leg over one exchange, `null` when not computable */
function cxDetour(
	leg: IRaukkChainLeg,
	cxSystemId: string,
	routes: IRaukkRouteDistance
): number | null {
	if (
		leg.route === null ||
		leg.fromSystemId === null ||
		leg.toSystemId === null
	) {
		return null;
	}

	// an exchange the leg already ends at is no detour candidate
	if (leg.fromSystemId === cxSystemId || leg.toSystemId === cxSystemId) {
		return null;
	}

	const toCx: IRaukkRoute | null = routes.route(leg.fromSystemId, cxSystemId);
	const fromCx: IRaukkRoute | null = routes.route(cxSystemId, leg.toSystemId);

	if (toCx === null || fromCx === null) return null;

	return toCx.parsecs + fromCx.parsecs - leg.route.parsecs;
}

/** Cheapest exchange detour of one leg */
function bestCxDetour(
	leg: IRaukkChainLeg,
	routes: IRaukkRouteDistance,
	cxSystems: Record<string, string>
): IRaukkCxSplitTrigger | null {
	let best: IRaukkCxSplitTrigger | null = null;

	Object.entries(cxSystems).forEach(([cxCode, cxSystemId]) => {
		const detour: number | null = cxDetour(leg, cxSystemId, routes);
		if (detour === null) return;

		if (best === null || detour < best.detourParsecs) {
			best = {
				legIndex: leg.index,
				cxCode,
				cxSystemId,
				detourParsecs: detour,
			};
		}
	});

	return best;
}

/**
 * The leg whose shortest path all but touches an exchange.
 *
 * Trigger of the CX split rule: `parsecs(via CX) − parsecs(direct)` at
 * or below `cxSplitDetourParsecs` on any leg. The cheapest detour of
 * the whole loop wins, ties towards the earlier leg.
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

	let best: IRaukkCxSplitTrigger | null = null;

	legs.forEach((leg) => {
		const candidate: IRaukkCxSplitTrigger | null = bestCxDetour(
			leg,
			routes,
			cxSystems
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
 * Cuts a chain into two exchange anchored sub chains.
 *
 * The loop is cut at TWO positions, both of them the exchange: cutting
 * a cycle at a single vertex would only produce the same cycle again.
 * The first cut is the triggering leg, where the exchange is inserted;
 * the second is an exchange stop the loop already has — the canonical
 * `CX → extractor → smelter → CX` case — or, when there is none, the
 * next best leg of the same exchange by detour, so both cuts sit where
 * the ship passes the exchange anyway.
 *
 * Flows staying inside one sub chain are handed over untouched; flows
 * crossing the cut become two flows, origin → CX and CX → destination,
 * trans-shipped through the exchanges infinite storage.
 *
 * @author raukk
 *
 * @param {IRaukkChainInput} input Chain, profile, flows, configuration
 * @param {IRaukkCxSplitTrigger} trigger Triggering leg and exchange
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
			chainStopSystemId(stopRef, routes, cxSystems) === trigger.cxSystemId
				? index
				: -1
		)
		.filter((index) => index >= 0);

	/** Insert positions in the ORIGINAL loop, ascending */
	const insertions: number[] = [trigger.legIndex + 1];

	if (existing.length === 0) {
		const legs: IRaukkChainLeg[] = buildChainLegs(stops, routes, cxSystems);

		let second: IRaukkCxSplitTrigger | null = null;

		legs.forEach((leg) => {
			if (leg.index === trigger.legIndex) return;

			const detour: number | null = cxDetour(
				leg,
				trigger.cxSystemId,
				routes
			);
			if (detour === null) return;

			if (second === null || detour < second.detourParsecs) {
				second = {
					legIndex: leg.index,
					cxCode: trigger.cxCode,
					cxSystemId: trigger.cxSystemId,
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
			chainStopSystemId(stopRef, routes, cxSystems) === trigger.cxSystemId
				? index
				: -1
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

	const subChains: IRaukkCxSubChain[] = [
		{
			chain: {
				...input.chain,
				chainId: `${input.chain.chainId}#a`,
				stops: stopsA,
			},
			flows: [],
		},
		{
			chain: {
				...input.chain,
				chainId: `${input.chain.chainId}#b`,
				stops: stopsB,
			},
			flows: [],
		},
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

	const subChains: IRaukkChainShipping[] = subChainInputs.map((sub) =>
		calculateChainShipping({
			...input,
			chain: sub.chain,
			flows: sub.flows,
		})
	);

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

/** One flow as the v1 shipped ticker shape */
function shippedTicker(flow: IRaukkChainFlow): IRaukkShippedTicker {
	return {
		ticker: flow.ticker,
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

		results.push(
			calculatePairShipping(pair, input.config, input.repairBillCost)
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
			recommendDrop: droppedDaily < asIs.dailyCost,
		});
	});

	return evaluations;
}
