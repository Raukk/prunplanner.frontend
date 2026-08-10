// Account wide sourcing of everything the FLEET consumes: the two ship
// fuels and the ship repair bill. Both were priced per COLONY before —
// fuel through the consuming plans own source entry, the repair bill
// through whatever resolver happened to be at hand — which is the wrong
// axis: one fleet serves every base, and a hull is refuelled and repaired
// where it happens to be, not where its cargo came from.
// Group defaults with per ticker overrides, the same shape the input
// bucket defaults have, minus the per base axis. Pure functions, no store
// and no Vue.
// See docs/raukk_sourcing/ship-sourcing.md.

// Calculations
import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";
import {
	RAUKK_REPAIR_AT_DAMAGE,
	RAUKK_REPAIR_TICKERS,
} from "@/features/raukk_sourcing/calculations/shippingRepair";
import { RAUKK_FUEL_TICKERS } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkMaterialUnits } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { IRaukkFleetLoadEntry } from "@/features/raukk_sourcing/calculations/shippingFleet";
import {
	IRaukkShipSourcing,
	IRaukkShipTickerSource,
	IRaukkSnapshot,
	IRaukkTickerSource,
	RAUKK_SHIP_SOURCE_GROUP,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Groups a ship sourcing default can be set for, in display order */
export const RAUKK_SHIP_SOURCE_GROUPS: RAUKK_SHIP_SOURCE_GROUP[] = [
	"fuel",
	"shipRepair",
];

/** The two fuels every ship burns, FTL first */
export const RAUKK_SHIP_FUEL_TICKERS: string[] = [
	RAUKK_FUEL_TICKERS.ftl,
	RAUKK_FUEL_TICKERS.stl,
];

/**
 * Tickers of one ship sourcing group.
 *
 * The repair group is every ticker a bill can possibly contain, not the
 * ones the DEFAULT hull happens to need: a user who fits a whipple array
 * must be able to source the array before the bill asks for it, the same
 * reason {@link RAUKK_REPAIR_TICKERS} exists.
 *
 * @author raukk
 *
 * @param {RAUKK_SHIP_SOURCE_GROUP} group Ship sourcing group
 * @returns {string[]} Material tickers of the group
 */
export function raukkShipGroupTickers(
	group: RAUKK_SHIP_SOURCE_GROUP
): string[] {
	return group === "fuel"
		? [...RAUKK_SHIP_FUEL_TICKERS]
		: [...RAUKK_REPAIR_TICKERS];
}

/**
 * Group a ticker is sourced through, `undefined` for everything the
 * fleet does not consume.
 *
 * Fuel wins a collision. The two lists are disjoint today and nothing
 * plans to change that, but a bill that ever picked up a fuel would be
 * charged at the price the ships really burn it at.
 *
 * @author raukk
 *
 * @param {string} ticker Material ticker
 * @returns {RAUKK_SHIP_SOURCE_GROUP | undefined} Group of the ticker
 */
export function raukkShipSourceGroupOf(
	ticker: string
): RAUKK_SHIP_SOURCE_GROUP | undefined {
	if (RAUKK_SHIP_FUEL_TICKERS.includes(ticker)) return "fuel";

	return RAUKK_REPAIR_TICKERS.includes(ticker) ? "shipRepair" : undefined;
}

/**
 * Every ticker the ship sourcing covers, fuel first then the repair bill.
 *
 * @author raukk
 *
 * @returns {string[]} Material tickers, in display order
 */
export function raukkShipSourcingTickers(): string[] {
	return RAUKK_SHIP_SOURCE_GROUPS.flatMap((group) =>
		raukkShipGroupTickers(group)
	);
}

/** The empty configuration: no group default, no override */
export function raukkEmptyShipSourcing(): IRaukkShipSourcing {
	return { defaults: {}, sources: {} };
}

/**
 * Source of one ship ticker: its own entry, else the default of its
 * group.
 *
 * A ticker outside both groups has none — nothing else in the app is
 * sourced account wide, and answering for it would let a caller price a
 * plans production input at the fleets setting.
 *
 * @author raukk
 *
 * @param {string} ticker Material ticker
 * @param {IRaukkShipSourcing} sourcing Account wide ship sourcing
 * @returns {IRaukkShipTickerSource | undefined} Effective source
 */
export function raukkShipTickerSource(
	ticker: string,
	sourcing: IRaukkShipSourcing
): IRaukkShipTickerSource | undefined {
	const group: RAUKK_SHIP_SOURCE_GROUP | undefined =
		raukkShipSourceGroupOf(ticker);

	if (group === undefined) return undefined;

	return sourcing.sources[ticker] ?? sourcing.defaults[group];
}

/**
 * The ship sourcing as the price resolver consumes it: one entry per
 * covered ticker, group defaults expanded, own entries kept.
 *
 * Tickers the configuration says nothing about stay ABSENT rather than
 * being written out as `cx`, which is what makes them fall through to the
 * exchange price of the caller — a plans CX preference in the snapshot
 * pipeline, the universe average on the account level pages.
 *
 * @author raukk
 *
 * @param {IRaukkShipSourcing} sourcing Account wide ship sourcing
 * @returns {Record<string, IRaukkTickerSource>} Sources per ticker
 */
export function raukkEffectiveShipSources(
	sourcing: IRaukkShipSourcing
): Record<string, IRaukkTickerSource> {
	const effective: Record<string, IRaukkTickerSource> = {};

	raukkShipSourcingTickers().forEach((ticker) => {
		const source: IRaukkShipTickerSource | undefined =
			raukkShipTickerSource(ticker, sourcing);

		if (source !== undefined) effective[ticker] = source;
	});

	return effective;
}

/**
 * Tickers following their group default rather than an own entry, the
 * "(default)" marker of the sourcing table.
 *
 * @author raukk
 *
 * @param {IRaukkShipSourcing} sourcing Account wide ship sourcing
 * @returns {Set<string>} Tickers following a group default
 */
export function raukkShipDefaultedTickers(
	sourcing: IRaukkShipSourcing
): Set<string> {
	const followed: Set<string> = new Set();

	raukkShipSourcingTickers().forEach((ticker) => {
		if (sourcing.sources[ticker] !== undefined) return;
		if (raukkShipTickerSource(ticker, sourcing) === undefined) return;

		followed.add(ticker);
	});

	return followed;
}

/**
 * Fuel every plan burns per day, summed over their frozen snapshots.
 *
 * The burn of the plans own lanes, which is the same scope the per plan
 * fuel rows have always stated. Chain carried freight is deliberately
 * absent for the reason it is absent from the plan rows: a chain is flown
 * for the whole account and no plan owns its burn (see
 * docs/raukk_sourcing/shipping-cadence-plan.md).
 *
 * Snapshots frozen before the burn was stored contribute nothing rather
 * than zero — the demand column then understates until they recompute,
 * which the section says out loud.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots by plan uuid
 * @returns {IRaukkMaterialUnits} Fuel units per day, keyed by ticker
 */
export function raukkShipFuelDemand(
	snapshots: Record<string, IRaukkSnapshot>
): IRaukkMaterialUnits {
	const demand: IRaukkMaterialUnits = {};

	Object.values(snapshots).forEach((snapshot: IRaukkSnapshot) =>
		Object.entries(snapshot.fuelUnitsPerDay ?? {}).forEach(
			([ticker, unitsPerDay]) => {
				if (!(unitsPerDay > 0)) return;

				demand[ticker] = (demand[ticker] ?? 0) + unitsPerDay;
			}
		)
	);

	return demand;
}

/**
 * Repair materials the fleet consumes per day.
 *
 * Every hull wears towards the repair threshold at its own rate, so the
 * daily material demand is what the accumulated damage buys in repairs:
 * `damage per day / {@link RAUKK_REPAIR_AT_DAMAGE}` full bills, times the
 * units one bill contains. The very same charge the cost model already
 * bills per trip, stated in units instead of ȼ — never a second formula.
 *
 * Hired work is skipped by {@link raukkFleetLoadEntries} already: someone
 * elses hull takes that damage. Work frozen before the wear rollup
 * carries no damage and contributes nothing.
 *
 * @author raukk
 *
 * @param {IRaukkFleetLoadEntry[]} entries Assigned fleet work
 * @returns {IRaukkMaterialUnits} Repair units per day, keyed by ticker
 */
export function raukkShipRepairDemand(
	entries: IRaukkFleetLoadEntry[]
): IRaukkMaterialUnits {
	const damagePerDay: number = entries.reduce(
		(sum, entry) => sum + Math.max(entry.damagePerDay ?? 0, 0),
		0
	);

	if (!(damagePerDay > 0)) return {};

	const repairsPerDay: number = damagePerDay / RAUKK_REPAIR_AT_DAMAGE;

	const demand: IRaukkMaterialUnits = {};

	Object.entries(RAUKK_REPAIR_BILL).forEach(([ticker, units]) => {
		if (!(units > 0)) return;

		demand[ticker] = repairsPerDay * units;
	});

	return demand;
}

/**
 * Everything the fleet consumes per day, fuel and repair materials in one
 * map. The prospective draw the source dropdown states its percentages
 * against.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkSnapshot>} snapshots Snapshots by plan uuid
 * @param {IRaukkFleetLoadEntry[]} entries Assigned fleet work
 * @returns {IRaukkMaterialUnits} Units per day, keyed by ticker
 */
export function raukkShipSourcingDemand(
	snapshots: Record<string, IRaukkSnapshot>,
	entries: IRaukkFleetLoadEntry[]
): IRaukkMaterialUnits {
	return {
		...raukkShipFuelDemand(snapshots),
		...raukkShipRepairDemand(entries),
	};
}
