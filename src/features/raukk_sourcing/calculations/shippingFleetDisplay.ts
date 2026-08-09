// Display shapes of the fleet page: which bay code a hull is, what one
// fleet row states, and which ship types can still be added.
// See docs/raukk_sourcing/shipping-fleet.md, section "Fleet page". Pure
// functions with no store and no Vue — the components stay thin wiring
// and everything testable lives here.

// Calculations
import {
	RAUKK_FTL_REACTORS,
	RAUKK_SHIP_HULLS,
	raukkShipProfileId,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";
import {
	RAUKK_EPSILON_EQUAL,
	raukkEqualWithin,
} from "@/features/raukk_sourcing/calculations/raukkEpsilon";
import { raukkVisitCadence } from "@/features/raukk_sourcing/calculations/shippingCadenceDisplay";

// Types & Interfaces
import {
	IRaukkFleetAdvisory,
	IRaukkShipHull,
	IRaukkShipProfile,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";
import { IRaukkFleetSpillover } from "@/features/raukk_sourcing/calculations/shippingFleetSpillover";

/**
 * Bay code of every hull the model knows, by cargo hold.
 *
 * Round 6 decision 3 (USER, authoritative): these are in-game PART
 * designations — SCB small, MCB medium, LCB large, HCB huge, WCB weight,
 * VCB volume — and therefore never editable. The editable label of a
 * ship type is its blueprint DESIGN name, e.g. `FSE_WCB_QCR`. The
 * unused VSC and TCB bays are omitted exactly as the decision says.
 *
 * @author raukk
 */
export const RAUKK_BAY_CODE_BY_HULL: Record<string, string> = {
	"500x500": "SCB",
	"1000x1000": "MCB",
	"2000x2000": "LCB",
	"5000x5000": "HCB",
	"3000x1000": "WCB",
	"1000x3000": "VCB",
};

/**
 * Spillover overlay of one fleet row, present only while the spillover
 * display is on and the row owns at least one hull.
 *
 * All percentages are UNCAPPED readings — the bar width helpers cap
 * separately, exactly as the base row splits number and bar.
 */
export interface IRaukkFleetRowSpill {
	/** Own load in percent, the base (green) bar segment */
	ownPercent: number;
	/** Notionally received share in percent, the amber appended segment */
	spilledInPercent: number;
	/** The number the row prints: combined for a recipient, residual for a donor */
	printedPercent: number;
	/** Red + bold: only a donor whose residual is still past 100% */
	over: boolean;
	/** The row received spilled work and states "own X % + spilled Y %" */
	received: boolean;
}

/** One ship type as the fleet table renders it */
export interface IRaukkFleetRow {
	shipTypeId: string;
	/** In-game bay code, undefined for a hull outside the six presets */
	bayCode: string | undefined;
	ftlReactor: RAUKK_FTL_REACTOR;
	cargoWeight: number;
	cargoVolume: number;
	/** Editable blueprint design label, empty when never set */
	designName: string;
	count: number;
	/** Null when the type owns no hull, see {@link IRaukkFleetUtilization} */
	utilization: number | null;
	/** The same as a percentage, null carried through */
	utilizationPercent: number | null;
	/** Over-rationed: more work assigned than the hulls can fly */
	over: boolean;
	/** Number of lanes and chains assigned to this type */
	assignedCount: number;
	/** Spillover overlay, absent with the display off or no hull owned */
	spill?: IRaukkFleetRowSpill;
}

/** One piece of fleet advice, rolled up over the whole account */
export interface IRaukkFleetAdvisoryRow {
	/** Ship type the work flies today */
	shipTypeId: string;
	/** Ship type the fleet does not own that would serve it better */
	suggestedShipTypeId: string;
	/** Trips per day of the worst affected assignment */
	tripsPerDay: number;
	/** Trips per day the suggested hull would fly the same work */
	suggestedTripsPerDay: number;
	/** Days per visit of the worst affected assignment, null where none */
	visitDays: number | null;
	/** Days per visit the suggested hull would serve it at */
	suggestedVisitDays: number | null;
	/** Lanes and chains this advice was raised on */
	assignmentCount: number;
}

/** One selectable ship type of the add row */
export interface IRaukkShipTypeOption {
	shipTypeId: string;
	bayCode: string | undefined;
	hull: IRaukkShipHull;
	ftlReactor: RAUKK_FTL_REACTOR;
}

/**
 * Bay code of one hull, undefined for a hold the game has no bay for.
 *
 * @author raukk
 *
 * @param {number} cargoWeight Cargo hold, tonnes
 * @param {number} cargoVolume Cargo hold, m³
 * @returns {(string | undefined)} Bay code
 */
export function raukkBayCode(
	cargoWeight: number,
	cargoVolume: number
): string | undefined {
	return RAUKK_BAY_CODE_BY_HULL[`${cargoWeight}x${cargoVolume}`];
}

/**
 * Every hull times reactor flag, as the add row offers them.
 *
 * @author raukk
 *
 * @returns {IRaukkShipTypeOption[]} Selectable ship types
 */
export function raukkShipTypeOptions(): IRaukkShipTypeOption[] {
	return RAUKK_SHIP_HULLS.flatMap((hull) =>
		RAUKK_FTL_REACTORS.map((ftlReactor) => ({
			shipTypeId: raukkShipProfileId(hull, ftlReactor),
			bayCode: raukkBayCode(hull.cargoWeight, hull.cargoVolume),
			hull,
			ftlReactor,
		}))
	);
}

/**
 * One fleet table row per ship type of the utilization rollup.
 *
 * The rollup already reports exactly the types the fleet holds — work
 * assigned to a type the account does not own is an advisory, never a
 * row — so this only dresses those rows: the bay code and the hull
 * figures come from the ship PROFILE of the same id — a ship type is a
 * profile id — and the over-ration flag is `utilization` past 1 by more
 * than {@link RAUKK_EPSILON_EQUAL}, never clamped: a fleet a hundredth
 * of a percent over is not over. A null utilization is carried through
 * untouched: a held type at count zero has no denominator, and a zero
 * there would read as infinite capacity.
 *
 * @author raukk
 *
 * @param {IRaukkFleetUtilization[]} utilization Rollup per ship type
 * @param {(shipTypeId: string) => IRaukkShipProfile} profileOf Profiles
 * @returns {IRaukkFleetRow[]} Fleet rows
 */
export function raukkFleetRows(
	utilization: IRaukkFleetUtilization[],
	profileOf: (shipTypeId: string) => IRaukkShipProfile
): IRaukkFleetRow[] {
	return utilization.map((entry) => {
		const profile: IRaukkShipProfile = profileOf(entry.shipTypeId);

		return {
			shipTypeId: entry.shipTypeId,
			bayCode: raukkBayCode(profile.cargoWeight, profile.cargoVolume),
			ftlReactor: profile.ftlReactor,
			cargoWeight: profile.cargoWeight,
			cargoVolume: profile.cargoVolume,
			designName: entry.designName ?? "",
			count: entry.count,
			utilization: entry.utilization,
			utilizationPercent:
				entry.utilization === null ? null : entry.utilization * 100,
			over:
				entry.utilization !== null &&
				entry.utilization > 1 + RAUKK_EPSILON_EQUAL,
			assignedCount: entry.keys.length,
		};
	});
}

/**
 * Rolls every fleet advisory of the account up into one line per advice.
 *
 * Advisories are raised per LEG of a lane and per chain, so the same
 * sentence — "a bigger hull would fly this less often" — arrives dozens of
 * times over an account. They are therefore deduplicated twice: an
 * identical advisory on the same assignment and cargo bucket is one
 * advisory, and everything advising the same swap is one line stating how
 * many assignments raised it.
 *
 * The trip figures of that line are the WORST affected assignment, the
 * one flying most often today, together with the rate the suggested hull
 * would fly the very same work at: averaging over assignments would
 * describe none of them, and the strongest case is the one worth buying a
 * hull for. Both rates are inverted into days per visit through
 * `raukkVisitCadence`, because that is the pair the sentence compares —
 * two rates of "0.01 trips/day" are the same sentence twice, "every 90
 * days" against "every 143 days" is an argument.
 *
 * A row whose two cadences READ the same is dropped: rounded to what the
 * page shows, "every 30.00 days" against "every 30.00 days" argues
 * nothing, and a line that argues nothing is noise on a page the user
 * scans for the swaps worth paying for. Same means equal within
 * {@link raukkEqualWithin}, or both rates too slow to state a cadence at
 * all.
 *
 * @author raukk
 *
 * @param {IRaukkFleetAdvisory[]} advisories Advisories, in any order
 * @returns {IRaukkFleetAdvisoryRow[]} One row per advised swap worth
 * stating
 */
export function raukkFleetAdvisoryRows(
	advisories: IRaukkFleetAdvisory[]
): IRaukkFleetAdvisoryRow[] {
	const seen: Set<string> = new Set();
	const rows: Map<string, IRaukkFleetAdvisoryRow> = new Map();

	advisories.forEach((advisory) => {
		const assignment: string = [
			advisory.pairKey,
			advisory.bucket,
			advisory.shipTypeId,
			advisory.suggestedShipTypeId,
		].join("#");

		if (seen.has(assignment)) return;
		seen.add(assignment);

		const key: string = `${advisory.shipTypeId}#${advisory.suggestedShipTypeId}`;
		const known: IRaukkFleetAdvisoryRow | undefined = rows.get(key);

		if (known === undefined) {
			rows.set(key, {
				shipTypeId: advisory.shipTypeId,
				suggestedShipTypeId: advisory.suggestedShipTypeId,
				tripsPerDay: advisory.tripsPerDay,
				suggestedTripsPerDay: advisory.suggestedTripsPerDay,
				visitDays: raukkVisitCadence(advisory.tripsPerDay).visitDays,
				suggestedVisitDays: raukkVisitCadence(
					advisory.suggestedTripsPerDay
				).visitDays,
				assignmentCount: 1,
			});

			return;
		}

		known.assignmentCount += 1;

		if (advisory.tripsPerDay > known.tripsPerDay) {
			known.tripsPerDay = advisory.tripsPerDay;
			known.suggestedTripsPerDay = advisory.suggestedTripsPerDay;
			known.visitDays = raukkVisitCadence(advisory.tripsPerDay).visitDays;
			known.suggestedVisitDays = raukkVisitCadence(
				advisory.suggestedTripsPerDay
			).visitDays;
		}
	});

	return Array.from(rows.values())
		.filter((row) => statesAChange(row))
		.sort(
			(left, right) =>
				left.shipTypeId.localeCompare(right.shipTypeId) ||
				left.suggestedShipTypeId.localeCompare(
					right.suggestedShipTypeId
				)
		);
}

/**
 * Whether an advisory row actually promises a different cadence.
 *
 * @author raukk
 *
 * @param {IRaukkFleetAdvisoryRow} row One rolled up advisory
 * @returns {boolean} The two cadences differ readably
 */
function statesAChange(row: IRaukkFleetAdvisoryRow): boolean {
	if (row.visitDays === null && row.suggestedVisitDays === null) return false;
	if (row.visitDays === null || row.suggestedVisitDays === null) return true;

	return !raukkEqualWithin(row.visitDays, row.suggestedVisitDays);
}

/**
 * Width of a utilization bar in percent, capped at the full bar.
 *
 * The NUMBER next to the bar is never capped — 134% is the reading the
 * fleet page exists to give — but a bar cannot draw past its track, so
 * the two are computed separately and on purpose.
 *
 * @author raukk
 *
 * @param {number | null} utilization Share of the daily capacity
 * @returns {number} Bar width, 0 to 100
 */
export function raukkUtilizationBarWidth(utilization: number | null): number {
	if (utilization === null || !Number.isFinite(utilization)) return 0;

	return Math.min(Math.max(utilization, 0), 1) * 100;
}

/**
 * Dresses the fleet rows with their spillover overlay.
 *
 * A DONOR — a type that handed overflow away or kept a residual — draws
 * a full bar and prints its RESIDUAL percentage: 100% when everything
 * fit elsewhere, its uncapped remainder in red when the fleet as a
 * whole is short. A RECIPIENT prints the combined percentage and states
 * the split; every other row prints exactly what it prints today. A
 * count-0 row gets no overlay at all — no hull, no denominator, the
 * null convention carries through.
 *
 * @author raukk
 *
 * @param {IRaukkFleetRow[]} rows Fleet rows, spillover off
 * @param {IRaukkFleetSpillover[]} spillover Redistribution per ship type
 * @returns {IRaukkFleetRow[]} The same rows, overlay attached
 */
export function raukkFleetSpilloverRows(
	rows: IRaukkFleetRow[],
	spillover: IRaukkFleetSpillover[]
): IRaukkFleetRow[] {
	const byType: Map<string, IRaukkFleetSpillover> = new Map(
		spillover.map((entry) => [entry.shipTypeId, entry])
	);

	return rows.map((row) => {
		const entry: IRaukkFleetSpillover | undefined = byType.get(
			row.shipTypeId
		);

		if (
			entry === undefined ||
			entry.capacityMinutes <= 0 ||
			row.utilizationPercent === null
		)
			return row;

		if (
			entry.spilledOutMinutes > 0 ||
			entry.residualOverflowMinutes > 0
		) {
			const printedPercent: number =
				((entry.capacityMinutes + entry.residualOverflowMinutes) /
					entry.capacityMinutes) *
				100;

			return {
				...row,
				spill: {
					ownPercent: 100,
					spilledInPercent: 0,
					printedPercent,
					over: printedPercent / 100 > 1 + RAUKK_EPSILON_EQUAL,
					received: false,
				},
			};
		}

		const spilledInPercent: number =
			(entry.spilledInMinutes / entry.capacityMinutes) * 100;

		return {
			...row,
			spill: {
				ownPercent: row.utilizationPercent,
				spilledInPercent,
				printedPercent: row.utilizationPercent + spilledInPercent,
				over: row.over,
				received: entry.spilledInMinutes > 0,
			},
		};
	});
}

/**
 * Widths of the two spillover bar segments, together never past the
 * track: the own segment caps at the full bar, the spilled one at
 * whatever the own segment left over — the same "a bar cannot draw past
 * its track" rule {@link raukkUtilizationBarWidth} states, applied to
 * the pair.
 *
 * @author raukk
 *
 * @param {number} ownPercent Own load in percent, uncapped
 * @param {number} spilledInPercent Spilled-in share in percent, uncapped
 * @returns {{ own: number; spilled: number }} Segment widths, 0 to 100
 */
export function raukkSpilloverBarWidths(
	ownPercent: number,
	spilledInPercent: number
): { own: number; spilled: number } {
	const own: number = Math.min(Math.max(ownPercent, 0), 100);

	return {
		own,
		spilled: Math.min(Math.max(spilledInPercent, 0), 100 - own),
	};
}
