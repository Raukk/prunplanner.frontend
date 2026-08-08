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
import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

// Types & Interfaces
import {
	IRaukkFleetAdvisory,
	IRaukkShipHull,
	IRaukkShipProfile,
	RAUKK_FTL_REACTOR,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";

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
 * The rollup already reports every type the fleet owns AND every type
 * work is assigned to, so this only dresses those rows: the bay code and
 * the hull figures come from the ship PROFILE of the same id — a ship
 * type is a profile id — and the over-ration flag is `utilization`
 * past 1 by more than {@link RAUKK_EPSILON_EQUAL}, never clamped: a
 * fleet a hundredth of a percent over is not over. A null utilization
 * is carried
 * through untouched: no hull means no denominator, and a zero there
 * would read as infinite capacity.
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
 * hull for.
 *
 * @author raukk
 *
 * @param {IRaukkFleetAdvisory[]} advisories Advisories, in any order
 * @returns {IRaukkFleetAdvisoryRow[]} One row per advised swap
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
				assignmentCount: 1,
			});

			return;
		}

		known.assignmentCount += 1;

		if (advisory.tripsPerDay > known.tripsPerDay) {
			known.tripsPerDay = advisory.tripsPerDay;
			known.suggestedTripsPerDay = advisory.suggestedTripsPerDay;
		}
	});

	return Array.from(rows.values()).sort(
		(left, right) =>
			left.shipTypeId.localeCompare(right.shipTypeId) ||
			left.suggestedShipTypeId.localeCompare(right.suggestedShipTypeId)
	);
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
