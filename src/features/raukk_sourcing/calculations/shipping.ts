// Shipping cost model: pure math over the route pairs a plan owns.
// See docs/raukk_sourcing/shipping-plan.md, sections "Ownership rule"
// and "Model math". No store, no Vue, no price fetching — repair bill
// prices arrive through the callers resolver.

// Types & Interfaces
import { IRaukkRoute } from "@/features/raukk_sourcing/calculations/routeDistance";
import {
	IRaukkDirectionLoad,
	IRaukkPairShipping,
	IRaukkShipProfile,
	IRaukkShippedTicker,
	IRaukkShippingConfig,
	IRaukkShippingPair,
	IRaukkShippingPriceResolver,
	IRaukkShippingResult,
	RAUKK_LOAD_DIMENSION,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Minutes of a day, denominator of the shipping fraction */
const MINUTES_PER_DAY: number = 24 * 60;

/**
 * Damage share at which players repair their ships.
 *
 * A trip costs the fraction of a full repair bill it burns of this
 * budget: half a percent of damage on a 80% repair cycle is 1/160th of
 * the bill.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_AT_DAMAGE: number = 0.8;

/**
 * Repair bill of one full repair cycle, in units per ticker.
 *
 * Observed at ~80% damage: MFK and FLP are fixed components, LHP and SSC
 * scale with damage and land at roughly eleven each. Deliberate v1
 * limitation: these tickers are priced through the snapshots resolver
 * but their quantities are NOT booked into draws or edges, so they take
 * part in neither the cycle guard nor the base fraction.
 *
 * @author raukk
 */
export const RAUKK_REPAIR_BILL: Record<string, number> = {
	LHP: 11,
	SSC: 11,
	MFK: 12,
	FLP: 8,
};

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
 * @param {IRaukkShipProfile} profile Ship profile
 * @returns {IRaukkDirectionLoad} Loads and binding dimension
 */
export function calculateDirectionLoad(
	tickers: IRaukkShippedTicker[],
	profile: IRaukkShipProfile
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
	return Object.entries(RAUKK_REPAIR_BILL).reduce(
		(sum, [ticker, units]) => sum + units * resolvePrice(ticker),
		0
	);
}

/**
 * Ship repair cost of one round trip.
 *
 * Damage accrues per parsec flown and per sublight block, both legs of
 * the round trip counted; the resulting share of the repair budget is
 * charged as that share of a full bill.
 *
 * @author raukk
 *
 * @param {IRaukkRoute} route One way route
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {number} ȼ per round trip
 */
export function calculateRepairCostPerTrip(
	route: IRaukkRoute,
	profile: IRaukkShipProfile,
	repairBillCost: number
): number {
	const tripDamage: number =
		2 * route.parsecs * profile.damagePerParsec +
		2 * profile.damagePerStlBlock;

	return (tripDamage / RAUKK_REPAIR_AT_DAMAGE) * repairBillCost;
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
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {number} ȼ per round trip
 */
export function calculateCostPerTrip(
	route: IRaukkRoute,
	profile: IRaukkShipProfile,
	config: IRaukkShippingConfig,
	repairBillCost: number
): number {
	const distanceCost: number = route.sameSystem
		? config.sameSystemFlatCost
		: 2 * route.parsecs * profile.costPerParsec;

	return (
		distanceCost +
		2 * profile.stlBlockCost +
		calculateRepairCostPerTrip(route, profile, repairBillCost)
	);
}

/**
 * Sublight block time of one direction, linear in its load factor.
 *
 * @author raukk
 *
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {number} loadFactor Capacity used on that direction, 0 to 1
 * @returns {number} Minutes
 */
function stlBlockMinutes(
	profile: IRaukkShipProfile,
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
 * @param {IRaukkShipProfile} profile Ship profile
 * @param {number} loadFactorOut Load factor leaving the plan
 * @param {number} loadFactorBack Load factor returning to the plan
 * @returns {number} Minutes per round trip
 */
export function calculateRoundTripMinutes(
	route: IRaukkRoute,
	profile: IRaukkShipProfile,
	loadFactorOut: number,
	loadFactorBack: number
): number {
	return (
		2 * route.parsecs * profile.minutesPerParsec +
		2 * route.jumps * profile.chargeMinutes +
		stlBlockMinutes(profile, loadFactorOut) +
		stlBlockMinutes(profile, loadFactorBack)
	);
}

/**
 * Route of a hub mode leg: source to the consumers exchange and on to
 * the consumer.
 *
 * Pure distance substitution, the pair stays a single consumer owned
 * pair on the consumers profile. Known v1 approximation: the same lane
 * is not pooled with the plans own CX pair and can be charged twice.
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

/** Zero result of a pair that ships nothing */
function emptyPairShipping(pairKey: string): IRaukkPairShipping {
	return {
		pairKey,
		hired: false,
		tripsPerDay: 0,
		costPerTrip: 0,
		repairCostPerTrip: 0,
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

	tickers.forEach((entry) => {
		const units: number = Math.max(entry.unitsPerDay, 0);
		if (units <= 0) return;

		const perUnitBinding: number = Math.max(
			load.binding === "weight"
				? entry.weightPerUnit
				: entry.volumePerUnit,
			0
		);
		const contribution: number = units * perUnitBinding;
		if (contribution <= 0) return;

		perUnit[entry.ticker] =
			(perUnit[entry.ticker] ?? 0) +
			(directionCost * (contribution / load.bindingPerDay)) / units;
	});

	return perUnit;
}

/**
 * Shipping of a single route pair.
 *
 * Trips per day are driven by the busier direction, the round trip cost
 * is amortized between both directions by their load share, and an empty
 * backhaul therefore leaves the loaded direction paying the full round
 * trip — exactly the sourcing pair case, where the cycle guard forbids
 * any reverse flow.
 *
 * A hired LM rate replaces the own fleet cost per trip and takes the
 * pair out of the shipping fraction: someone elses ship is doing the
 * flying.
 *
 * @author raukk
 *
 * @param {IRaukkShippingPair} pair Route pair the plan owns
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @param {number} repairBillCost ȼ of a full repair bill
 * @returns {IRaukkPairShipping} Pair shipping result
 */
export function calculatePairShipping(
	pair: IRaukkShippingPair,
	config: IRaukkShippingConfig,
	repairBillCost: number
): IRaukkPairShipping {
	if (!config.enabled) return emptyPairShipping(pair.pairKey);

	const loadOut: IRaukkDirectionLoad = calculateDirectionLoad(
		pair.out,
		pair.profile
	);
	const loadBack: IRaukkDirectionLoad = calculateDirectionLoad(
		pair.back,
		pair.profile
	);

	const loadTotal: number = loadOut.loads + loadBack.loads;

	// nothing moves in either direction, no trip is ever flown
	if (loadTotal <= 0) return emptyPairShipping(pair.pairKey);

	const tripsPerDay: number = Math.max(loadOut.loads, loadBack.loads);

	const lmRatePerTrip: number | undefined = config.lmRates?.[pair.pairKey];
	const hired: boolean = lmRatePerTrip !== undefined;

	const repairCostPerTrip: number = hired
		? 0
		: calculateRepairCostPerTrip(pair.route, pair.profile, repairBillCost);
	const costPerTrip: number =
		lmRatePerTrip !== undefined
			? lmRatePerTrip
			: calculateCostPerTrip(
					pair.route,
					pair.profile,
					config,
					repairBillCost
				);

	const dailyCost: number = tripsPerDay * costPerTrip;

	const roundTripMinutes: number = calculateRoundTripMinutes(
		pair.route,
		pair.profile,
		loadOut.loads / tripsPerDay,
		loadBack.loads / tripsPerDay
	);

	const shippingFraction: number =
		hired || pair.profile.shipsAvailable <= 0
			? 0
			: (tripsPerDay * roundTripMinutes) /
				(MINUTES_PER_DAY * pair.profile.shipsAvailable);

	return {
		pairKey: pair.pairKey,
		hired,
		tripsPerDay,
		costPerTrip,
		repairCostPerTrip,
		dailyCost,
		roundTripMinutes,
		shippingFraction,
		loadOut,
		loadBack,
		perUnitOut: allocateDirection(
			pair.out,
			loadOut,
			dailyCost * (loadOut.loads / loadTotal)
		),
		perUnitBack: allocateDirection(
			pair.back,
			loadBack,
			dailyCost * (loadBack.loads / loadTotal)
		),
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
 * @returns {IRaukkShippingResult} Per pair and per ticker shipping
 */
export function calculateShipping(
	pairs: IRaukkShippingPair[],
	config: IRaukkShippingConfig,
	resolvePrice: IRaukkShippingPriceResolver
): IRaukkShippingResult {
	if (!config.enabled) {
		return { pairs: [], shippingFraction: 0, inbound: {}, outbound: {} };
	}

	const repairBillCost: number = calculateRepairBillCost(resolvePrice);

	const results: IRaukkPairShipping[] = pairs.map((pair) =>
		calculatePairShipping(pair, config, repairBillCost)
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

	return {
		pairs: results,
		shippingFraction: results.reduce(
			(sum, result) => sum + result.shippingFraction,
			0
		),
		inbound: perUnitOf(inboundCost, inboundUnits),
		outbound: perUnitOf(outboundCost, outboundUnits),
	};
}
