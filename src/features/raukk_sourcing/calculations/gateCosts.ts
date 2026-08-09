// What a gate COSTS to put up: materials, specifications and the ȼ they
// come to. Transcribed from the in-game GATEWAY INFORMATION (GTWI) panel
// into `assets/raukk_gate_costs.json`, see that file's comment for the
// provenance.
//
// Two shapes of the model are worth stating up front, because both are
// easy to get wrong from a single observation:
//
//   1. Costs are per GATE, one END of a link. A link is two gates, and
//      both ends pay the full base cost.
//   2. Upgrade cost is TRIANGULAR, not linear. The n-th level costs
//      n x unit, so n levels cost unit * n(n+1)/2 — level 3 of an
//      upgrade costs three times what level 1 did. Effects, in contrast,
//      ARE linear: every level adds the same capacity, volume or range.
//
// Pure functions over plain data, like the rest of the calculation
// layer: no store, no Vue, no price fetching — a price resolver is
// injected, exactly as the shipping math takes one.

// in-game GTWI build cost transcription, raukk owned asset
import costsJson from "@/features/raukk_sourcing/assets/raukk_gate_costs.json";

// Types & Interfaces
import { IRaukkShippingPriceResolver } from "@/features/raukk_sourcing/calculations/shipping.types";

/** Material amounts by ticker */
export type IRaukkMaterialAmounts = Record<string, number>;

/** The three upgrade tracks a gate has */
export type RAUKK_GATE_UPGRADE = "capacity" | "volume" | "range";

/** Upgrade levels of one gate, one entry per track */
export interface IRaukkGateUpgrades {
	capacity: number;
	volume: number;
	range: number;
}

/** What a gate of given upgrade levels can do */
export interface IRaukkGateSpecs {
	/** Traversals the gate admits per 24h */
	usesPerDay: number;
	/** Largest ship volume the gate passes, m³ */
	maxShipVolumeM3: number;
	fuelStorage: number;
	/** Farthest system the gate may link to, parsecs */
	linkingRangeParsecs: number;
}

/** One upgrade track, as the asset states it */
interface IRaukkGateUpgradeAsset {
	maxLevel: number;
	observedLevels: number[];
	/** Cost of the FIRST level; level n costs n times this */
	unit: IRaukkMaterialAmounts;
	perLevel: Partial<IRaukkGateSpecs>;
}

/** Shape of `raukk_gate_costs.json` */
interface IRaukkGateCostAsset {
	comment: string;
	base: IRaukkMaterialAmounts;
	baseSpecs: IRaukkGateSpecs;
	totalUpgradeBudget: number;
	upgrades: Record<RAUKK_GATE_UPGRADE, IRaukkGateUpgradeAsset>;
	upkeep: IRaukkMaterialAmounts;
}

const ASSET: IRaukkGateCostAsset = costsJson as IRaukkGateCostAsset;

/**
 * Materials one gate costs at zero upgrades.
 *
 * @author raukk
 */
export const RAUKK_GATE_BASE_COST: IRaukkMaterialAmounts = ASSET.base;

/**
 * Specifications of a gate at zero upgrades.
 *
 * @author raukk
 */
export const RAUKK_GATE_BASE_SPECS: IRaukkGateSpecs = ASSET.baseSpecs;

/**
 * Upkeep line of the GTWI panel: per gate, per DAY.
 *
 * Flat across all 13 transcribed configurations — upgrading a gate does
 * not raise what it costs to keep. The FLATNESS is observed; the daily
 * period is not, the panel never states one. It is the user's reading
 * (2026-08-09) and a sound one at this scale: a few dozen ships paying
 * 4,000–6,000 ȼ of gate fees a day cover it several times over, which a
 * weekly or monthly bill would make nonsensical.
 *
 * Worth stating because the two costs answer different questions: the
 * build bill decides whether a gate is worth STARTING, the upkeep
 * decides whether a quiet one is worth KEEPING.
 *
 * @author raukk
 */
export const RAUKK_GATE_UPKEEP: IRaukkMaterialAmounts = ASSET.upkeep;

/**
 * Daily upkeep of a whole LINK: both gates, since both are yours.
 *
 * Independent of the upgrade levels, unlike the build bill.
 *
 * @author raukk
 *
 * @returns {IRaukkMaterialAmounts} Materials per day
 */
export function raukkGateLinkUpkeep(): IRaukkMaterialAmounts {
	const total: IRaukkMaterialAmounts = {};

	add(total, ASSET.upkeep, 2);

	return total;
}

/**
 * Highest level each upgrade track admits.
 *
 * @author raukk
 */
export const RAUKK_GATE_UPGRADE_CAPS: IRaukkGateUpgrades = {
	capacity: ASSET.upgrades.capacity.maxLevel,
	volume: ASSET.upgrades.volume.maxLevel,
	range: ASSET.upgrades.range.maxLevel,
};

/** No upgrades at all, the state a fresh gate is planned in */
export const RAUKK_GATE_NO_UPGRADES: IRaukkGateUpgrades = {
	capacity: 0,
	volume: 0,
	range: 0,
};

/**
 * Upgrade levels ONE gate may hold across all three tracks together.
 *
 * The binding cap in practice, and the one the per-track maxima hide: the
 * tracks stop at 5, 3 and 3, which would sum to eleven, while a gate only
 * ever gets five. Every real build is therefore a trade — range bought is
 * clearance not bought — which is exactly the decision this tool exists
 * to put in front of the user.
 *
 * @author raukk
 */
export const RAUKK_GATE_UPGRADE_BUDGET: number = ASSET.totalUpgradeBudget;

/**
 * Upgrade levels spent, over all three tracks.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Upgrade levels
 * @returns {number} Levels spent
 */
export function raukkGateUpgradeTotal(upgrades: IRaukkGateUpgrades): number {
	return (
		raukkGateUpgradeLevel("capacity", upgrades.capacity) +
		raukkGateUpgradeLevel("volume", upgrades.volume) +
		raukkGateUpgradeLevel("range", upgrades.range)
	);
}

/**
 * Levels still unspent of the budget.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Upgrade levels
 * @returns {number} Levels left, never below zero
 */
export function raukkGateUpgradeBudgetLeft(
	upgrades: IRaukkGateUpgrades
): number {
	return Math.max(
		RAUKK_GATE_UPGRADE_BUDGET - raukkGateUpgradeTotal(upgrades),
		0
	);
}

/**
 * Highest level one track may reach beside the other two.
 *
 * What the UI offers and what the store clamps to: raising a track is
 * capped by its own maximum AND by whatever the other two tracks left of
 * the shared budget.
 *
 * @author raukk
 *
 * @param {RAUKK_GATE_UPGRADE} track Upgrade track
 * @param {IRaukkGateUpgrades} beside Levels of all three tracks
 * @returns {number} Highest level that track may take
 */
export function raukkGateUpgradeCeiling(
	track: RAUKK_GATE_UPGRADE,
	beside: IRaukkGateUpgrades
): number {
	const others: number =
		raukkGateUpgradeTotal(beside) -
		raukkGateUpgradeLevel(track, beside[track]);

	return Math.max(
		Math.min(
			RAUKK_GATE_UPGRADE_CAPS[track],
			RAUKK_GATE_UPGRADE_BUDGET - others
		),
		0
	);
}

/**
 * Upgrade levels clamped into what one gate may actually hold.
 *
 * The track being CHANGED is the one that gives way when the budget is
 * overspent — clamping the others instead would silently undo a choice
 * the user made earlier and did not touch.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Wanted levels
 * @param {RAUKK_GATE_UPGRADE} changed Track the caller just raised
 * @returns {IRaukkGateUpgrades} Levels the game would allow
 */
export function raukkGateUpgradesFit(
	upgrades: IRaukkGateUpgrades,
	changed: RAUKK_GATE_UPGRADE = "capacity"
): IRaukkGateUpgrades {
	const fitted: IRaukkGateUpgrades = {
		capacity: raukkGateUpgradeLevel("capacity", upgrades.capacity),
		volume: raukkGateUpgradeLevel("volume", upgrades.volume),
		range: raukkGateUpgradeLevel("range", upgrades.range),
	};

	if (raukkGateUpgradeTotal(fitted) <= RAUKK_GATE_UPGRADE_BUDGET)
		return fitted;

	fitted[changed] = raukkGateUpgradeCeiling(changed, fitted);

	// an overspend the changed track alone cannot absorb — an import of a
	// payload from a future game with a wider budget — gives way in a
	// fixed order, so the result never depends on iteration luck
	const order: RAUKK_GATE_UPGRADE[] = (
		["capacity", "volume", "range"] as RAUKK_GATE_UPGRADE[]
	).filter((track) => track !== changed);

	order.forEach((track) => {
		if (raukkGateUpgradeTotal(fitted) > RAUKK_GATE_UPGRADE_BUDGET)
			fitted[track] = raukkGateUpgradeCeiling(track, fitted);
	});

	return fitted;
}

/**
 * Clamps one upgrade level into what the track admits.
 *
 * @author raukk
 *
 * @param {RAUKK_GATE_UPGRADE} track Upgrade track
 * @param {number} level Wanted level
 * @returns {number} Level the game would allow
 */
export function raukkGateUpgradeLevel(
	track: RAUKK_GATE_UPGRADE,
	level: number
): number {
	if (!Number.isFinite(level)) return 0;

	return Math.min(
		Math.max(Math.floor(level), 0),
		RAUKK_GATE_UPGRADE_CAPS[track]
	);
}

/**
 * Adds material amounts into an accumulator, in place.
 *
 * @author raukk
 *
 * @param {IRaukkMaterialAmounts} into Accumulator
 * @param {IRaukkMaterialAmounts} what Amounts to add
 * @param {number} times Multiplier
 */
function add(
	into: IRaukkMaterialAmounts,
	what: IRaukkMaterialAmounts,
	times: number
): void {
	if (times === 0) return;

	Object.entries(what).forEach(([ticker, amount]) => {
		into[ticker] = (into[ticker] ?? 0) + amount * times;
	});
}

/**
 * Triangular multiplier of `level` upgrade levels: `n * (n + 1) / 2`.
 *
 * The n-th level costs n units, so reaching level n costs the sum of the
 * first n integers. Verified against the transcribed configurations at
 * capacity 1, 2 and 5, volume 1, 2 and 3, and range 2 and 3 — all eight
 * divide out to the very same integer unit vectors.
 *
 * @author raukk
 *
 * @param {number} level Upgrade level
 * @returns {number} Units of the first level's cost
 */
export function raukkGateUpgradeUnits(level: number): number {
	const n: number = Math.max(Math.floor(level), 0);

	return (n * (n + 1)) / 2;
}

/**
 * Materials the upgrades of ONE gate cost, base excluded.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Upgrade levels
 * @returns {IRaukkMaterialAmounts} Materials
 */
export function raukkGateUpgradeCost(
	upgrades: IRaukkGateUpgrades
): IRaukkMaterialAmounts {
	const total: IRaukkMaterialAmounts = {};

	(Object.keys(ASSET.upgrades) as RAUKK_GATE_UPGRADE[]).forEach((track) => {
		add(
			total,
			ASSET.upgrades[track].unit,
			raukkGateUpgradeUnits(raukkGateUpgradeLevel(track, upgrades[track]))
		);
	});

	return total;
}

/**
 * Materials ONE gate costs: its base plus its upgrades.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Upgrade levels
 * @returns {IRaukkMaterialAmounts} Materials
 */
export function raukkGateBuildCost(
	upgrades: IRaukkGateUpgrades = RAUKK_GATE_NO_UPGRADES
): IRaukkMaterialAmounts {
	const total: IRaukkMaterialAmounts = {};

	add(total, ASSET.base, 1);
	add(total, raukkGateUpgradeCost(upgrades), 1);

	return total;
}

/**
 * Materials a whole LINK costs: two gates, one at each end.
 *
 * Both ends are assumed identically upgraded, which is what the planning
 * model states a planned link to be — one fee, one clearance, two equal
 * ends.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Upgrade levels of each end
 * @returns {IRaukkMaterialAmounts} Materials
 */
export function raukkGateLinkBuildCost(
	upgrades: IRaukkGateUpgrades = RAUKK_GATE_NO_UPGRADES
): IRaukkMaterialAmounts {
	const total: IRaukkMaterialAmounts = {};

	add(total, raukkGateBuildCost(upgrades), 2);

	return total;
}

/**
 * What a gate of those upgrade levels can do.
 *
 * Effects are LINEAR in the level, unlike the costs: every capacity
 * level adds the same 150 traversals a day, every volume level the same
 * 1,500 m³, every range level the same 5 parsecs.
 *
 * @author raukk
 *
 * @param {IRaukkGateUpgrades} upgrades Upgrade levels
 * @returns {IRaukkGateSpecs} Specifications
 */
export function raukkGateSpecs(
	upgrades: IRaukkGateUpgrades = RAUKK_GATE_NO_UPGRADES
): IRaukkGateSpecs {
	const specs: IRaukkGateSpecs = { ...ASSET.baseSpecs };

	(Object.keys(ASSET.upgrades) as RAUKK_GATE_UPGRADE[]).forEach((track) => {
		const levels: number = raukkGateUpgradeLevel(track, upgrades[track]);

		Object.entries(ASSET.upgrades[track].perLevel).forEach(
			([key, perLevel]) => {
				const field: keyof IRaukkGateSpecs =
					key as keyof IRaukkGateSpecs;

				specs[field] += (perLevel as number) * levels;
			}
		);
	});

	return specs;
}

/**
 * ȼ a material bill comes to at the given prices.
 *
 * The caller owns which prices those are; a ticker the resolver cannot
 * price contributes nothing rather than throwing, the rule the rest of
 * the shipping pricing follows.
 *
 * A gate bill is DOMINATED by a handful of enormous positions — 5,000
 * SEA, 8,000 SP, 4,000 TRU per gate — and those are thin markets. The
 * number this returns is what the exchange says today, not what buying
 * that much would actually cost.
 *
 * @author raukk
 *
 * @param {IRaukkMaterialAmounts} materials Materials
 * @param {IRaukkShippingPriceResolver} resolvePrice Price resolver
 * @returns {number} ȼ
 */
export function raukkGateCostAic(
	materials: IRaukkMaterialAmounts,
	resolvePrice: IRaukkShippingPriceResolver
): number {
	return Object.entries(materials).reduce((sum, [ticker, amount]) => {
		const price: number = resolvePrice(ticker);

		return sum + (Number.isFinite(price) ? price * amount : 0);
	}, 0);
}

/**
 * Every material ticker a gate bill can name, upkeep included.
 *
 * The list a price loader has to fetch before {@link raukkGateCostAic}
 * can price anything.
 *
 * @author raukk
 *
 * @returns {string[]} Material tickers
 */
export function raukkGateCostTickers(): string[] {
	const tickers: Set<string> = new Set([
		...Object.keys(ASSET.base),
		...Object.keys(ASSET.upkeep),
	]);

	(Object.keys(ASSET.upgrades) as RAUKK_GATE_UPGRADE[]).forEach((track) =>
		Object.keys(ASSET.upgrades[track].unit).forEach((ticker) =>
			tickers.add(ticker)
		)
	);

	return [...tickers].sort();
}
