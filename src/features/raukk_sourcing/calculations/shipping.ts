// Shipping cost model: pure math over the route pairs a plan owns.
// No store, no Vue, no price fetching — repair bill prices arrive
// through the callers resolver.

// Calculations
import {
	IRaukkCadence,
	raukkCadenceOf,
} from "@/features/raukk_sourcing/calculations/shippingCadence";
import {
	raukkHullLoads,
	raukkPickHull,
	raukkSmallestCandidate,
} from "@/features/raukk_sourcing/calculations/shippingHull";
import {
	raukkFasterGatePath,
	raukkFtlParsecsOf,
	raukkGateLegCost,
	raukkGateOnlyPath,
	raukkStlOnlyCandidates,
} from "@/features/raukk_sourcing/calculations/shippingStl";
// raukk: a gate measures the SHIP, not its cargo hold
import { raukkHullVolumeM3 } from "@/features/raukk_sourcing/calculations/shippingHullVolume";
import {
	RAUKK_DEFAULT_REPAIR_BOM,
	RAUKK_REPAIR_AT_DAMAGE,
	raukkRepairBill,
	raukkRepairBillCost,
} from "@/features/raukk_sourcing/calculations/shippingRepair";

/*
 * The threshold's definition moved to `shippingRepair.ts` — a leaf
 * module the bill law needs it in too, and importing it back from here
 * would be a cycle. Re-exported so its historical import site still
 * works; the reasoning behind the 0.2 is unchanged and lives with it.
 */
export { RAUKK_REPAIR_AT_DAMAGE };

// Types & Interfaces
import {
	IRaukkMultiModalPath,
	IRaukkRoute,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { IRaukkGateLegCost } from "@/features/raukk_sourcing/calculations/shippingStl";
import {
	IRaukkCadenceCaps,
	IRaukkDirectionLoad,
	IRaukkFleetAdvisory,
	IRaukkHullCandidate,
	IRaukkHullPick,
	IRaukkLaneLeg,
	IRaukkLegDemand,
	IRaukkLegShipping,
	IRaukkPairShipping,
	IRaukkResolvedShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	IRaukkShippingPriceResolver,
	IRaukkShippingResult,
	RAUKK_CARGO_BUCKET,
	RAUKK_LOAD_DIMENSION,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** The cargo buckets, in the order the legs of a lane are reported */
const CARGO_BUCKETS: RAUKK_CARGO_BUCKET[] = [
	"production",
	"workforce",
	"repair",
];

/** Minutes of a day, denominator of the shipping fraction */
const MINUTES_PER_DAY: number = 24 * 60;

/**
 * Repair bill of one full repair cycle, in units per ticker.
 *
 * Observed at 80% condition — the {@link RAUKK_REPAIR_AT_DAMAGE} cycle
 * this bill belongs to — and now DERIVED from that same cycle through
 * the BOM law of `shippingRepair.ts` rather than carried as four fixed
 * numbers. It reproduces the observation exactly: `ceil(71 × 0.20 ×
 * 0.75)` is the eleven LHP and eleven SSC seen on a hull whose panel
 * states 71 structural elements, and MFK and FLP are fixed components
 * paid whatever the damage.
 *
 * Deliberate v1 limitation, unchanged: these tickers are priced through
 * the snapshots resolver but their quantities are NOT booked into draws
 * or edges, so they take part in neither the cycle guard nor the base
 * fraction.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_BILL: Record<string, number> = raukkRepairBill(
	RAUKK_DEFAULT_REPAIR_BOM
);

/** Empty load, used for empty directions and every short circuit */
function emptyLoad(): IRaukkDirectionLoad {
	return {
		weightPerDay: 0,
		volumePerDay: 0,
		loads: 0,
		binding: "weight",
		bindingPerDay: 0,
	};
}

/**
 * Reduces one directions daily cargo to ship loads.
 *
 * A direction needs as many loads as its more demanding dimension
 * requires: 40 tonnes of a 20 tonne hull are two loads even if the
 * volume would fit in one. Negative daily amounts are clamped to zero —
 * CX sells turn negative as soon as subscribers draw more than the plan
 * produces, which is allowed by design (oversubscription) and simply
 * means nothing is left to ship.
 *
 * @author raukk
 *
 * @param {IRaukkShippedTicker[]} tickers Daily cargo of the direction
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @returns {IRaukkDirectionLoad} Loads and binding dimension
 */
export function calculateDirectionLoad(
	tickers: IRaukkShippedTicker[],
	profile: IRaukkResolvedShipProfile
): IRaukkDirectionLoad {
	let weightPerDay: number = 0;
	let volumePerDay: number = 0;

	tickers.forEach((entry) => {
		const units: number = Math.max(entry.unitsPerDay, 0);
		if (units <= 0) return;

		weightPerDay += units * Math.max(entry.weightPerUnit, 0);
		volumePerDay += units * Math.max(entry.volumePerUnit, 0);
	});

	const weightLoads: number =
		profile.cargoWeight > 0 ? weightPerDay / profile.cargoWeight : 0;
	const volumeLoads: number =
		profile.cargoVolume > 0 ? volumePerDay / profile.cargoVolume : 0;

	const binding: RAUKK_LOAD_DIMENSION =
		weightLoads >= volumeLoads ? "weight" : "volume";

	return {
		weightPerDay,
		volumePerDay,
		loads: Math.max(weightLoads, volumeLoads),
		binding,
		bindingPerDay: binding === "weight" ? weightPerDay : volumePerDay,
	};
}

/**
 * Prices one full repair bill.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPriceResolver} resolvePrice Unit price lookup
 * @returns {number} ȼ of a repair at the repair threshold
 */
export function calculateRepairBillCost(
	resolvePrice: IRaukkShippingPriceResolver
): number {
	return raukkRepairBillCost(RAUKK_REPAIR_BILL, resolvePrice);
}

/**
 * Hull damage of one round trip, as a fraction of full condition.
 *
 * Damage accrues per parsec flown and per sublight block, both legs of
 * the round trip counted. The single damage figure the repair cost
 * charges and every wear display states — never a second formula.
 *
 * @author raukk
 *
 * @param {IRaukkRoute} route One way route
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @returns {number} Damage fraction per round trip
 */
export function calculateTripDamage(
	route: IRaukkRoute,
	profile: IRaukkResolvedShipProfile,
	mixedPath?: IRaukkMultiModalPath
): number {
	/*
	 * A gate hop covers its distance without flying it: no per parsec
	 * damage, a flat hit per traversal instead. Only the FTL hops of the
	 * path may be multiplied by the per parsec rate.
	 */
	if (mixedPath !== undefined) {
		const gate: IRaukkGateLegCost = raukkGateLegCost(mixedPath, profile);

		return (
			2 * raukkFtlParsecsOf(mixedPath) * profile.damagePerParsec +
			2 * gate.damage +
			2 * profile.damagePerStlBlock
		);
	}

	return (
		2 * route.parsecs * profile.damagePerParsec +
		2 * profile.damagePerStlBlock
	);
}

/**
 * The gate route a lane should be flown on, `null` when the FTL network
 * still wins.
 *
 * Same question {@link raukkFasterGatePath} answers for a chain leg, put
 * where a lane can ask it: a lane carries its endpoints and its lookups
 * for exactly this reason. Absent endpoints — every caller predating
 * gates, the test literals included — means the lane keeps its pure FTL
 * routing, which is the safe reading of "no gate network known".
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Lane
 * @param {IRaukkResolvedShipProfile} profile Hull flying it
 * @returns {(IRaukkMultiModalPath | null)} Faster gate path, or null
 */
export function raukkPairGatePath(
	pair: IRaukkShippingPair,
	profile: IRaukkResolvedShipProfile
): IRaukkMultiModalPath | null {
	if (
		pair.route.sameSystem ||
		profile.stlOnly ||
		pair.fromSystemId === undefined ||
		pair.toSystemId === undefined ||
		pair.routes === undefined
	)
		return null;

	return raukkFasterGatePath(
		pair.routes,
		pair.fromSystemId,
		pair.toSystemId,
		pair.route,
		{
			shipVolumeM3: raukkHullVolumeM3(
				profile,
				profile.stlOnly,
				profile.ftlReactor
			),
			minutesPerParsec: profile.minutesPerParsec,
			chargeMinutes: profile.chargeMinutes,
		}
	);
}

/**
 * Ship repair cost of one round trip.
 *
 * The trips damage ({@link calculateTripDamage}) burns its share of the
 * repair budget and is charged as that share of a full bill.
 *
 * @author raukk
 *
 * @param {IRaukkRoute} route One way route
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {number} ȼ per round trip
 */
export function calculateRepairCostPerTrip(
	route: IRaukkRoute,
	profile: IRaukkResolvedShipProfile,
	repairBillCost: number,
	mixedPath?: IRaukkMultiModalPath
): number {
	return (
		(calculateTripDamage(route, profile, mixedPath) /
			RAUKK_REPAIR_AT_DAMAGE) *
		repairBillCost
	);
}

/**
 * Cost of one round trip on a route pair.
 *
 * Both legs pay the distance and the sublight block; a pair that never
 * leaves its system pays the configured flat cost instead of the
 * distance term, its sublight blocks still apply.
 *
 * @author raukk
 *
 * @param {IRaukkRoute} route One way route
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {number} ȼ per round trip
 */
export function calculateCostPerTrip(
	route: IRaukkRoute,
	profile: IRaukkResolvedShipProfile,
	config: IRaukkShippingConfig,
	repairBillCost: number,
	mixedPath?: IRaukkMultiModalPath
): number {
	/*
	 * Both modes pay for what each does: the FTL hops burn fuel per
	 * parsec, the gate hops pay their fee and the sublight fuel of the
	 * traversal overhead, and neither pays the other's bill. Both
	 * directions of the round trip, so both fees are charged.
	 */
	const gate: IRaukkGateLegCost | null =
		mixedPath !== undefined ? raukkGateLegCost(mixedPath, profile) : null;

	const distanceCost: number = route.sameSystem
		? config.sameSystemFlatCost
		: mixedPath !== undefined && gate !== null
			? 2 *
				(raukkFtlParsecsOf(mixedPath) * profile.costPerParsec +
					gate.fees +
					gate.fuelCost)
			: 2 * route.parsecs * profile.costPerParsec;

	return (
		distanceCost +
		2 * profile.stlBlockCost +
		calculateRepairCostPerTrip(route, profile, repairBillCost, mixedPath)
	);
}

/**
 * Sublight block time of one direction, linear in its load factor.
 *
 * Exported unchanged for the v2 chain math, which times one block per
 * stop visit with that stops own load factor.
 *
 * @author raukk
 *
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @param {number} loadFactor Capacity used on that direction, 0 to 1
 * @returns {number} Minutes
 */
export function stlBlockMinutes(
	profile: IRaukkResolvedShipProfile,
	loadFactor: number
): number {
	const factor: number = Math.min(Math.max(loadFactor, 0), 1);

	return (
		profile.stlBlockMinutesEmpty +
		(profile.stlBlockMinutesLoaded - profile.stlBlockMinutesEmpty) * factor
	);
}

/**
 * Round trip time of a route pair.
 *
 * FTL time depends on distance and on the reactor charge between jumps,
 * never on the cargo; the sublight blocks do depend on it, so both
 * directions are timed with their own load factor.
 *
 * @author raukk
 *
 * @param {IRaukkRoute} route One way route
 * @param {IRaukkResolvedShipProfile} profile Ship profile
 * @param {number} loadFactorOut Load factor leaving the plan
 * @param {number} loadFactorBack Load factor returning to the plan
 * @returns {number} Minutes per round trip
 */
export function calculateRoundTripMinutes(
	route: IRaukkRoute,
	profile: IRaukkResolvedShipProfile,
	loadFactorOut: number,
	loadFactorBack: number,
	mixedPath?: IRaukkMultiModalPath
): number {
	// a mixed path already timed both of its modes on this hull's speed
	const flight: number =
		mixedPath !== undefined
			? 2 * mixedPath.minutes
			: 2 * route.parsecs * profile.minutesPerParsec +
				2 * route.jumps * profile.chargeMinutes;

	return (
		flight +
		stlBlockMinutes(profile, loadFactorOut) +
		stlBlockMinutes(profile, loadFactorBack)
	);
}

/**
 * Route of a hub mode leg: source to the consumers exchange and on to
 * the consumer.
 *
 * Pure distance substitution, the pair stays a single consumer owned
 * pair on the consumers profile.
 *
 * UNREACHED by the snapshot pipeline since the hub/spoke rewrite: every
 * source now routes through the exchanges (`viaCxSourceOf` is true for
 * all of them), so no sourcing pair is ever built from a combined route
 * and the `routingMode` switch that selected this never fires. Kept with
 * its unit tests for the pairing layer alone.
 *
 * @author raukk
 *
 * @param {IRaukkRoute} sourceToCx Source to the exchange
 * @param {IRaukkRoute} cxToConsumer Exchange to the consumer
 * @returns {IRaukkRoute} Combined route
 */
export function combineHubRoute(
	sourceToCx: IRaukkRoute,
	cxToConsumer: IRaukkRoute
): IRaukkRoute {
	const parsecs: number = sourceToCx.parsecs + cxToConsumer.parsecs;

	return {
		parsecs,
		jumps: sourceToCx.jumps + cxToConsumer.jumps,
		sameSystem: parsecs === 0,
	};
}

/**
 * Daily units of one leg, both directions summed.
 *
 * Deliberately mixes tickers: a lane is hired as a whole, so it is the
 * denominator of a lane wide ȼ per unit and never a per ticker freight
 * rate — those live in the inputs table.
 *
 * @author raukk
 *
 * @param {IRaukkShippedTicker[]} out Daily cargo leaving the plan
 * @param {IRaukkShippedTicker[]} back Daily cargo returning to it
 * @returns {number} Units per day
 */
function legUnits(
	out: IRaukkShippedTicker[],
	back: IRaukkShippedTicker[]
): number {
	return [...out, ...back].reduce(
		(sum, entry) => sum + Math.max(entry.unitsPerDay, 0),
		0
	);
}

/** Daily weight and volume of one leg, per direction */
function legDemand(
	out: IRaukkShippedTicker[],
	back: IRaukkShippedTicker[]
): IRaukkLegDemand {
	function sum(
		tickers: IRaukkShippedTicker[],
		dimension: "weightPerUnit" | "volumePerUnit"
	): number {
		return tickers.reduce(
			(total, entry) =>
				total +
				Math.max(entry.unitsPerDay, 0) * Math.max(entry[dimension], 0),
			0
		);
	}

	return {
		weightOutPerDay: sum(out, "weightPerUnit"),
		volumeOutPerDay: sum(out, "volumePerUnit"),
		weightBackPerDay: sum(back, "weightPerUnit"),
		volumeBackPerDay: sum(back, "volumePerUnit"),
	};
}

/** Trips per day one candidate would fly on one leg */
function tripsOf(
	candidate: IRaukkHullCandidate,
	demand: IRaukkLegDemand,
	capDays: number
): number {
	return raukkCadenceOf(raukkHullLoads(candidate, demand), capDays)
		.tripsPerDay;
}

/** Hull of one leg and, when a better unowned one exists, the advice */
interface IRaukkLegHull {
	candidate: IRaukkHullCandidate;
	advisory: IRaukkFleetAdvisory | null;
}

/**
 * Whether an STL-only hull can fly this lane at all.
 *
 * A same system lane always can — it never leaves the system, which is
 * exactly what an STL-only ship is built for. An inter-system lane needs
 * a path whose every hop is a gate traversal; without the system ids and
 * the route lookups nothing can be established and the answer is no,
 * which keeps an unverifiable assignment out of the automatic pick.
 *
 * SEAM: the gate search runs WITHOUT a volume cap. Establishing the cap
 * needs a hull, and the hull is what this answer selects; a link too
 * narrow for the chosen hull is therefore not caught here. The chain
 * model, which knows its profile up front, does pass the hull volume.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Route pair the plan owns
 * @returns {boolean} Whether an STL-only hull may fly the lane
 */
function stlOnlyServes(pair: IRaukkShippingPair): boolean {
	if (pair.route.sameSystem) return true;

	if (
		pair.routes === undefined ||
		pair.fromSystemId === undefined ||
		pair.toSystemId === undefined
	) {
		return false;
	}

	return (
		raukkGateOnlyPath(pair.routes, pair.fromSystemId, pair.toSystemId) !==
		null
	);
}

/**
 * Picks the hull of one leg.
 *
 * A MANUAL assignment wins outright and is never argued with — "Auto" is
 * what the heuristic answers, an assignment is what the user answered.
 * Auto chooses from the OWNED hulls only ({@link raukkPickHull}); a
 * better unowned one never becomes an assignment, it becomes a fleet
 * advisory. Without any fleet data at all the pairs own profile flies the
 * leg, which is the behaviour of every caller that knows no fleet.
 *
 * A pick that finds NOTHING to choose from — every owned hull filtered
 * out as non-FTL on a leg no gate serves or no depot bases — falls back
 * to the smallest OWNED hull rather than to the pairs profile: the pair
 * profile is the account default, and defaulting there assigns work to a
 * hull the account may own none of, which then draws a fleet row with a
 * capacity of zero. The leg still fails its own STL validation, but it
 * fails on a ship that exists. Only an account whose every hull is
 * non-FTL reaches this at all, and for such an account there is no
 * better OWNED answer to give.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Route pair the leg belongs to
 * @param {RAUKK_CARGO_BUCKET} bucket Cargo bucket of the leg
 * @param {IRaukkLegDemand} demand Daily cargo of the leg
 * @param {number} capDays Days per visit the bucket may not exceed
 * @returns {IRaukkLegHull} Hull and fleet advisory
 */
function legHull(
	pair: IRaukkShippingPair,
	bucket: RAUKK_CARGO_BUCKET,
	demand: IRaukkLegDemand,
	capDays: number,
	gateServable: boolean
): IRaukkLegHull {
	const fallback: IRaukkHullCandidate = {
		shipTypeId: pair.profile.id,
		profile: pair.profile,
	};

	if (pair.hulls === undefined)
		return { candidate: fallback, advisory: null };
	if (pair.hulls.manual !== undefined)
		return { candidate: pair.hulls.manual, advisory: null };

	// raukk: an STL-only hull is never picked for a lane it cannot fly or
	// is not based on, neither as an assignment nor as an advisory —
	// advising a ship that would fail validation, or that would have to
	// live away from its depot, is worse than advising nothing
	const depotServed: boolean = pair.depotServed === true;

	const owned: IRaukkHullPick | null = raukkPickHull(
		raukkStlOnlyCandidates(pair.hulls.owned, gateServable, depotServed),
		demand,
		capDays
	);
	const candidate: IRaukkHullCandidate =
		owned?.candidate ??
		raukkSmallestCandidate(pair.hulls.owned) ??
		fallback;

	const ideal: IRaukkHullPick | null = raukkPickHull(
		raukkStlOnlyCandidates(pair.hulls.all, gateServable, depotServed),
		demand,
		capDays
	);

	if (ideal === null || ideal.candidate.shipTypeId === candidate.shipTypeId)
		return { candidate, advisory: null };

	return {
		candidate,
		advisory: {
			pairKey: pair.pairKey,
			bucket,
			shipTypeId: candidate.shipTypeId,
			tripsPerDay: tripsOf(candidate, demand, capDays),
			suggestedShipTypeId: ideal.candidate.shipTypeId,
			suggestedTripsPerDay: ideal.tripsPerDay,
		},
	};
}

/**
 * Splits one lane into its legs, one per cargo bucket riding it.
 *
 * The three buckets travel on three different rhythms — production in
 * and out every two weeks, workforce consumables monthly, repair
 * materials once per repair cycle — so charging them one shared trip
 * count would either fly the consumables far too often or starve the
 * production line. Each leg therefore picks its own hull, fills it at
 * its own pace and visits at `min(capDays, fillDays)`.
 *
 * A leg carrying nothing is not a leg: buckets without positive cargo
 * are absent from the result, and so is a lane that ships nothing at all.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Route pair the plan owns
 * @param {IRaukkCadenceCaps} caps Cadence caps of the consuming plan
 * @returns {IRaukkLaneLeg[]} Legs of the lane, in bucket order
 */
export function raukkLaneLegs(
	pair: IRaukkShippingPair,
	caps: IRaukkCadenceCaps
): IRaukkLaneLeg[] {
	const legs: IRaukkLaneLeg[] = [];

	/*
	 * Resolved ONCE per lane, not per leg: the answer is a property of
	 * the lane and of the gate network, never of the cargo riding it,
	 * and the gate search is the expensive part.
	 */
	const gateServable: boolean = stlOnlyServes(pair);

	function cargoOf(
		tickers: IRaukkShippedTicker[],
		bucket: RAUKK_CARGO_BUCKET
	): IRaukkShippedTicker[] {
		// an entry frozen before the cargo classes existed reads as
		// `production`, the in/out class it carried
		return tickers.filter(
			(entry) =>
				(entry.bucket ?? "production") === bucket &&
				entry.unitsPerDay > 0
		);
	}

	CARGO_BUCKETS.forEach((bucket) => {
		const out: IRaukkShippedTicker[] = cargoOf(pair.out, bucket);
		const back: IRaukkShippedTicker[] = cargoOf(pair.back, bucket);

		if (out.length === 0 && back.length === 0) return;

		const capDays: number = caps[bucket];
		const demand: IRaukkLegDemand = legDemand(out, back);
		const hull: IRaukkLegHull = legHull(
			pair,
			bucket,
			demand,
			capDays,
			gateServable
		);

		const loadOut: IRaukkDirectionLoad = calculateDirectionLoad(
			out,
			hull.candidate.profile
		);
		const loadBack: IRaukkDirectionLoad = calculateDirectionLoad(
			back,
			hull.candidate.profile
		);

		const cadence: IRaukkCadence = raukkCadenceOf(
			Math.max(loadOut.loads, loadBack.loads),
			capDays
		);

		// weightless and volumeless cargo fills no hull and flies no trip
		if (cadence.tripsPerDay <= 0) return;

		legs.push({
			bucket,
			shipTypeId: hull.candidate.shipTypeId,
			profile: hull.candidate.profile,
			capDays,
			fillDays: cadence.fillDays,
			visitDays: cadence.visitDays,
			tripsPerDay: cadence.tripsPerDay,
			out,
			back,
			loadOut,
			loadBack,
			advisory: hull.advisory,
			/*
			 * A MANUAL assignment reaches this point unfiltered, and so
			 * does the pairs own profile when no fleet is known: an
			 * STL-only ship on a lane with no gate route is exactly the
			 * validation error the user has to see.
			 */
			unservableReason:
				hull.candidate.profile.stlOnly && !gateServable
					? "stl-only-no-gate"
					: null,
		});
	});

	return legs;
}

/** Zero result of a pair that ships nothing */
function emptyPairShipping(pairKey: string): IRaukkPairShipping {
	return {
		pairKey,
		hired: false,
		legs: [],
		unservable: false,
		tripsPerDay: 0,
		costPerTrip: 0,
		repairCostPerTrip: 0,
		damagePerTrip: 0,
		dailyCost: 0,
		roundTripMinutes: 0,
		shippingFraction: 0,
		loadOut: emptyLoad(),
		loadBack: emptyLoad(),
		perUnitOut: {},
		perUnitBack: {},
	};
}

/**
 * Splits one directions cost across its tickers.
 *
 * The share of a ticker is its contribution to the dimension that
 * produced the directions load count: a heavy ore pays for the tonnage
 * it forces, a bulky but light good for the volume. Dividing by the
 * daily units turns the share into ȼ per unit. A ticker without any
 * weight or volume rides along for free.
 *
 * The result is keyed by TICKER alone, so the rows of a ticker riding
 * in several cargo buckets are pooled first: the ȼ per unit of a ticker
 * is the same wherever on the lane it sits, and dividing each row by
 * its own units would charge that ticker once per bucket.
 *
 * @author raukk
 *
 * @param {IRaukkShippedTicker[]} tickers Daily cargo of the direction
 * @param {IRaukkDirectionLoad} load Direction load
 * @param {number} directionCost ȼ per day of the direction
 * @returns {Record<string, number>} ȼ per unit per ticker
 */
function allocateDirection(
	tickers: IRaukkShippedTicker[],
	load: IRaukkDirectionLoad,
	directionCost: number
): Record<string, number> {
	const perUnit: Record<string, number> = {};

	if (directionCost === 0 || load.bindingPerDay <= 0) return perUnit;

	/** Daily units and binding dimension contribution, per ticker */
	const units: Record<string, number> = {};
	const contribution: Record<string, number> = {};

	tickers.forEach((entry) => {
		const daily: number = Math.max(entry.unitsPerDay, 0);
		if (daily <= 0) return;

		const perUnitBinding: number = Math.max(
			load.binding === "weight"
				? entry.weightPerUnit
				: entry.volumePerUnit,
			0
		);
		if (perUnitBinding <= 0) return;

		units[entry.ticker] = (units[entry.ticker] ?? 0) + daily;
		contribution[entry.ticker] =
			(contribution[entry.ticker] ?? 0) + daily * perUnitBinding;
	});

	Object.entries(units).forEach(([ticker, daily]) => {
		perUnit[ticker] =
			(directionCost * (contribution[ticker] / load.bindingPerDay)) /
			daily;
	});

	return perUnit;
}

/** Daily units of one ticker over a set of cargo rows */
function unitsPerTicker(
	tickers: IRaukkShippedTicker[]
): Record<string, number> {
	const units: Record<string, number> = {};

	tickers.forEach((entry) => {
		const daily: number = Math.max(entry.unitsPerDay, 0);
		if (daily <= 0) return;

		units[entry.ticker] = (units[entry.ticker] ?? 0) + daily;
	});

	return units;
}

/**
 * Merges the ȼ per unit of several legs into one figure per ticker.
 *
 * A ticker riding two legs — the same food feeding production and the
 * workforce — pays two different freight rates, on two different
 * cadences. What it really costs the plan is the units weighted mean of
 * both, exactly as {@link calculateShipping} merges a ticker riding
 * several pairs.
 */
function mergeLegPerUnit(
	entries: {
		perUnit: Record<string, number>;
		units: Record<string, number>;
	}[]
): Record<string, number> {
	const cost: Record<string, number> = {};
	const total: Record<string, number> = {};

	entries.forEach((entry) => {
		Object.entries(entry.units).forEach(([ticker, daily]) => {
			cost[ticker] =
				(cost[ticker] ?? 0) + (entry.perUnit[ticker] ?? 0) * daily;
			total[ticker] = (total[ticker] ?? 0) + daily;
		});
	});

	const merged: Record<string, number> = {};

	Object.entries(total).forEach(([ticker, daily]) => {
		if (daily <= 0) return;
		merged[ticker] = (cost[ticker] ?? 0) / daily;
	});

	return merged;
}

/**
 * Shipping of a single route pair.
 *
 * The lane is flown as up to three LEGS, one per cargo bucket riding it
 * ({@link raukkLaneLegs}). Each leg has its own hull, its own cadence cap
 * and therefore its own trip count: `1 / min(capDays, fillDays)`. A trip
 * flown before the hold is full is still a whole trip and pays a whole
 * trip — the ship makes the same round trip half loaded.
 *
 * Within a leg the round trip cost is amortized between both directions
 * by their load share, and an empty backhaul therefore leaves the loaded
 * direction paying the full round trip — exactly the sourcing pair case,
 * where a reverse flow either lost the mutual verdict and routes via the
 * exchanges, or won it and owns the only lane.
 *
 * A hired LM rate replaces the own fleet cost per trip of EVERY leg and
 * takes the pair out of the shipping fraction: someone elses ship is
 * doing the flying.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Route pair the plan owns
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {number} repairBillCost ȼ of a full repair bill
 * @param {IRaukkCadenceCaps} caps Cadence caps of the consuming plan
 * @returns {IRaukkPairShipping} Pair shipping result
 */
export function calculatePairShipping(
	pair: IRaukkShippingPair,
	config: IRaukkShippingConfig,
	repairBillCost: number,
	caps: IRaukkCadenceCaps
): IRaukkPairShipping {
	if (!config.enabled) return emptyPairShipping(pair.pairKey);

	const legs: IRaukkLaneLeg[] = raukkLaneLegs(pair, caps);

	// nothing moves in any bucket, no trip is ever flown
	if (legs.length === 0) return emptyPairShipping(pair.pairKey);

	const lmRatePerTrip: number | undefined = config.lmRates?.[pair.pairKey];
	const hired: boolean = lmRatePerTrip !== undefined;

	const costed: IRaukkLegShipping[] = [];
	const outPerUnit: {
		perUnit: Record<string, number>;
		units: Record<string, number>;
	}[] = [];
	const backPerUnit: typeof outPerUnit = [];

	let tripsPerDay: number = 0;
	let dailyCost: number = 0;
	let repairCost: number = 0;
	let damage: number = 0;
	let shipMinutes: number = 0;
	let shippingFraction: number | null = 0;

	legs.forEach((leg) => {
		/*
		 * Per LEG, because the hull is: the automatic pick may put a
		 * different profile on each cadence class, and a gate that a
		 * quick WCB beats is one a slow HCB gladly takes.
		 */
		const mixedPath: IRaukkMultiModalPath | undefined =
			raukkPairGatePath(pair, leg.profile) ?? undefined;

		/*
		 * What the own fleet would charge and suffer on this leg,
		 * computed whether or not the lane is hired: the hire
		 * comparison needs the counterfactual, and freezing it onto the
		 * snapshot is what lets the account wide transport table state
		 * the same ȼ the plan does. Both take the leg's own gate path,
		 * exactly as the charged figures below do — a counterfactual
		 * flown on a different route is not one.
		 */
		const ownCostPerTrip: number = calculateCostPerTrip(
			pair.route,
			leg.profile,
			config,
			repairBillCost,
			mixedPath
		);
		const ownDamagePerTrip: number = calculateTripDamage(
			pair.route,
			leg.profile,
			mixedPath
		);

		// a hired lane wears someone elses hull, that is a hard zero —
		// the same reasoning that zeroes its shipping fraction below
		const damagePerTrip: number = hired ? 0 : ownDamagePerTrip;
		const repairCostPerTrip: number = hired
			? 0
			: calculateRepairCostPerTrip(
					pair.route,
					leg.profile,
					repairBillCost,
					mixedPath
				);
		const costPerTrip: number =
			lmRatePerTrip !== undefined ? lmRatePerTrip : ownCostPerTrip;

		const legDailyCost: number = leg.tripsPerDay * costPerTrip;

		const roundTripMinutes: number = calculateRoundTripMinutes(
			pair.route,
			leg.profile,
			leg.loadOut.loads / leg.tripsPerDay,
			leg.loadBack.loads / leg.tripsPerDay,
			mixedPath
		);

		/*
		 * A hired lane occupies none of the own fleets time, that is a
		 * hard zero. A profile without a single ship is a different
		 * thing: its denominator does not exist, so the fraction is
		 * UNDEFINED and says so. Reporting zero there would read as
		 * infinite capacity — the exact opposite of what an empty ship
		 * count means.
		 */
		const legFraction: number | null = hired
			? 0
			: leg.profile.shipsAvailable > 0
				? (leg.tripsPerDay * roundTripMinutes) /
					(MINUTES_PER_DAY * leg.profile.shipsAvailable)
				: null;

		const legLoads: number = leg.loadOut.loads + leg.loadBack.loads;

		if (legLoads > 0) {
			outPerUnit.push({
				perUnit: allocateDirection(
					leg.out,
					leg.loadOut,
					legDailyCost * (leg.loadOut.loads / legLoads)
				),
				units: unitsPerTicker(leg.out),
			});
			backPerUnit.push({
				perUnit: allocateDirection(
					leg.back,
					leg.loadBack,
					legDailyCost * (leg.loadBack.loads / legLoads)
				),
				units: unitsPerTicker(leg.back),
			});
		}

		tripsPerDay += leg.tripsPerDay;
		dailyCost += legDailyCost;
		repairCost += leg.tripsPerDay * repairCostPerTrip;
		damage += leg.tripsPerDay * damagePerTrip;
		shipMinutes += leg.tripsPerDay * roundTripMinutes;
		shippingFraction =
			shippingFraction === null || legFraction === null
				? null
				: shippingFraction + legFraction;

		costed.push({
			bucket: leg.bucket,
			shipTypeId: leg.shipTypeId,
			capDays: leg.capDays,
			fillDays: leg.fillDays,
			visitDays: leg.visitDays,
			tripsPerDay: leg.tripsPerDay,
			costPerTrip,
			repairCostPerTrip,
			damagePerTrip,
			ownCostPerTrip,
			ownDamagePerTrip,
			unitsPerDay: legUnits(leg.out, leg.back),
			dailyCost: legDailyCost,
			roundTripMinutes,
			shippingFraction: legFraction,
			advisory: leg.advisory,
			unservableReason: leg.unservableReason,
		});
	});

	return {
		pairKey: pair.pairKey,
		hired,
		legs: costed,
		unservable: costed.some((leg) => leg.unservableReason !== null),
		tripsPerDay,
		costPerTrip: tripsPerDay > 0 ? dailyCost / tripsPerDay : 0,
		repairCostPerTrip: tripsPerDay > 0 ? repairCost / tripsPerDay : 0,
		damagePerTrip: tripsPerDay > 0 ? damage / tripsPerDay : 0,
		dailyCost,
		// trip weighted, so `trips × minutes` stays the ship time of the
		// whole lane however many hulls its legs put on it
		roundTripMinutes: tripsPerDay > 0 ? shipMinutes / tripsPerDay : 0,
		shippingFraction,
		loadOut: calculateDirectionLoad(pair.out, pair.profile),
		loadBack: calculateDirectionLoad(pair.back, pair.profile),
		perUnitOut: mergeLegPerUnit(outPerUnit),
		perUnitBack: mergeLegPerUnit(backPerUnit),
	};
}

/**
 * Shipping of every route pair a plan owns.
 *
 * Each pair is owned by exactly one plan and computed from that plans
 * own flows only, so summing over the pairs never double counts and
 * never needs another plans snapshot. Per unit costs of a ticker
 * appearing on several pairs are merged weighted by their daily units.
 *
 * With `enabled` false the whole model short circuits to zeros and the
 * snapshot behaves exactly as it did before shipping existed.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair[]} pairs Route pairs the plan owns
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {IRaukkShippingPriceResolver} resolvePrice Unit price lookup
 * @param {IRaukkCadenceCaps} caps Cadence caps of the consuming plan
 * @returns {IRaukkShippingResult} Per pair and per ticker shipping
 */
export function calculateShipping(
	pairs: IRaukkShippingPair[],
	config: IRaukkShippingConfig,
	resolvePrice: IRaukkShippingPriceResolver,
	caps: IRaukkCadenceCaps
): IRaukkShippingResult {
	if (!config.enabled) {
		return {
			pairs: [],
			shippingFraction: 0,
			inbound: {},
			outbound: {},
			advisories: [],
		};
	}

	const repairBillCost: number = calculateRepairBillCost(resolvePrice);

	const results: IRaukkPairShipping[] = pairs.map((pair) =>
		calculatePairShipping(pair, config, repairBillCost, caps)
	);

	/** Daily ȼ and daily units per ticker, per direction */
	const inboundCost: Record<string, number> = {};
	const inboundUnits: Record<string, number> = {};
	const outboundCost: Record<string, number> = {};
	const outboundUnits: Record<string, number> = {};

	function accumulate(
		tickers: IRaukkShippedTicker[],
		perUnit: Record<string, number>,
		cost: Record<string, number>,
		units: Record<string, number>
	): void {
		tickers.forEach((entry) => {
			const daily: number = Math.max(entry.unitsPerDay, 0);
			if (daily <= 0) return;

			cost[entry.ticker] =
				(cost[entry.ticker] ?? 0) +
				(perUnit[entry.ticker] ?? 0) * daily;
			units[entry.ticker] = (units[entry.ticker] ?? 0) + daily;
		});
	}

	pairs.forEach((pair, index) => {
		accumulate(
			pair.back,
			results[index].perUnitBack,
			inboundCost,
			inboundUnits
		);
		accumulate(
			pair.out,
			results[index].perUnitOut,
			outboundCost,
			outboundUnits
		);
	});

	function perUnitOf(
		cost: Record<string, number>,
		units: Record<string, number>
	): Record<string, number> {
		const result: Record<string, number> = {};

		Object.entries(units).forEach(([ticker, daily]) => {
			if (daily <= 0) return;
			result[ticker] = (cost[ticker] ?? 0) / daily;
		});

		return result;
	}

	/** Undefined as soon as one pair has no defined fraction */
	const shippingFraction: number | null = results.reduce(
		(sum: number | null, result) =>
			sum === null || result.shippingFraction === null
				? null
				: sum + result.shippingFraction,
		0 as number | null
	);

	return {
		pairs: results,
		shippingFraction,
		inbound: perUnitOf(inboundCost, inboundUnits),
		outbound: perUnitOf(outboundCost, outboundUnits),
		advisories: results.flatMap((result) =>
			result.legs
				.map((leg) => leg.advisory)
				.filter(
					(advisory): advisory is IRaukkFleetAdvisory =>
						advisory !== null
				)
		),
	};
}
