// Fleet math of the shipping model: which ship type serves a lane or a
// chain, and how much of that types capacity the assigned work claims.
// See docs/raukk_sourcing/shipping-fleet.md, sections "Fleet page" and
// "Blueprint-seeded profiles". Pure functions, no store and no Vue — the
// fleet counts, the assignments and the per lane numbers arrive as plain
// data from the caller.

// Calculations
import { RAUKK_STARTER_FLEET } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkHullCandidate,
	IRaukkShippingConfig,
} from "@/features/raukk_sourcing/calculations/shipping.types";

/** Minutes of a day, denominator of every utilization */
const MINUTES_PER_DAY: number = 24 * 60;

/** Prefix separating chain assignment keys from lane (pair) keys */
const CHAIN_KEY_PREFIX: string = "chain:";

/**
 * One ship type of the users fleet.
 *
 * A ship type IS a profile id — hull times reactor flag — so the fleet
 * slice never invents a second identity for the same ship. `count` is the
 * account wide number of hulls of that type, `designName` the editable
 * label of the blueprint they were built from (e.g. `FSE_WCB_QCR`); the
 * bay codes themselves are in-game part designations and stay fixed.
 */
export interface IRaukkFleetShip {
	count: number;
	designName?: string;
}

/** One piece of assigned work, a lane or one costing of a chain */
export interface IRaukkFleetLoadEntry {
	/** Lane pair key or chain assignment key */
	key: string;
	shipTypeId: string;
	tripsPerDay: number;
	roundTripMinutes: number;
	/** Hull damage per day this work inflicts, `undefined` on stored
	 * results frozen before the wear rollup existed */
	damagePerDay?: number;
}

/** Capacity claim on one ship type */
export interface IRaukkFleetUtilization {
	shipTypeId: string;
	count: number;
	designName: string | undefined;
	/** Ship minutes per day the assigned work claims */
	shipMinutesPerDay: number;
	/**
	 * Share of the types daily capacity, 1 = fully booked.
	 *
	 * `null` when the fleet holds the type but not a single hull of it,
	 * a count of zero: the denominator does not exist then, and
	 * reporting zero would read as infinite capacity — the same null
	 * convention the per plan shipping fraction uses. Values above 1 are
	 * legal and mean "more ships or a bigger ship".
	 */
	utilization: number | null;
	/**
	 * Hull damage per day over ALL assigned work of the type.
	 *
	 * `null` as soon as ONE assigned entry predates the wear rollup and
	 * carries no damage figure — a sum that silently skips an unknown
	 * term would understate the wear, the exact reasoning of the plan
	 * wide shipping fraction. A type without any assigned work knows its
	 * wear perfectly: zero.
	 */
	damagePerDay: number | null;
	/** Keys of the work assigned to this type */
	keys: string[];
}

/**
 * Assignment key of a whole chain.
 *
 * Lane keys are pair keys (`owner>counterpart`), so a chain key is
 * prefixed instead of split by `>` — the two name spaces must never
 * collide, a chain id is not a plan uuid.
 *
 * @author raukk
 *
 * @param {string} chainId Chain Id
 * @returns {string} Assignment Key
 */
export function raukkChainAssignmentKey(chainId: string): string {
	return `${CHAIN_KEY_PREFIX}${chainId}`;
}

/**
 * Chain id of an assignment key, undefined for a lane key.
 *
 * @author raukk
 *
 * @param {string} key Assignment Key
 * @returns {(string | undefined)} Chain Id
 */
export function raukkChainIdOfAssignmentKey(key: string): string | undefined {
	return key.startsWith(CHAIN_KEY_PREFIX)
		? key.slice(CHAIN_KEY_PREFIX.length)
		: undefined;
}

/**
 * Ship type serving one lane or chain.
 *
 * Three sources, in this order: the fleet assignment, the v1 per edge
 * profile override and the account default. The fleet page is the newer
 * and primary surface of round 6, so an assignment wins over the older
 * per edge override; absent both, the lane runs on the default profile,
 * which is what "auto" means in the picker.
 *
 * @author raukk
 *
 * @param {string} key Lane pair key or chain assignment key
 * @param {Record<string, string> | undefined} assignments Assignments
 * @param {IRaukkShippingConfig} config Shipping configuration
 * @returns {string} Ship type id, which is a ship profile id
 */
export function raukkAssignedShipTypeId(
	key: string,
	assignments: Record<string, string> | undefined,
	config: IRaukkShippingConfig
): string {
	return (
		assignments?.[key] ??
		config.perEdgeProfile?.[key] ??
		config.defaultProfileId
	);
}

/**
 * Capacity claim per ship type over all assigned work.
 *
 * ```
 * utilization = Σ assigned (tripsPerDay × roundTripMinutes)
 *               / (24 × 60 × count)
 * ```
 *
 * The fleet is the ONLY row source: exactly the types the user added
 * are reported, idle ones included, and work assigned to a type the
 * fleet does not hold contributes nothing — a hull nobody owns is a
 * fleet advisory, never a fleet row. A held type with a count of zero
 * still gets its row, with a null utilization: no hull, no denominator.
 * Nothing is clamped: 134% is a valid reading and the whole point of
 * the display.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkFleetShip>} fleet Ships per type
 * @param {IRaukkFleetLoadEntry[]} entries Assigned work
 * @returns {IRaukkFleetUtilization[]} One row per ship type
 */
export function raukkFleetUtilization(
	fleet: Record<string, IRaukkFleetShip>,
	entries: IRaukkFleetLoadEntry[]
): IRaukkFleetUtilization[] {
	const minutes: Record<string, number> = {};
	const keys: Record<string, string[]> = {};
	const damage: Record<string, number> = {};
	const damageUnknown: Set<string> = new Set();

	entries.forEach((entry) => {
		const claimed: number =
			Math.max(entry.tripsPerDay, 0) *
			Math.max(entry.roundTripMinutes, 0);

		minutes[entry.shipTypeId] = (minutes[entry.shipTypeId] ?? 0) + claimed;
		keys[entry.shipTypeId] = [...(keys[entry.shipTypeId] ?? []), entry.key];

		if (entry.damagePerDay === undefined)
			damageUnknown.add(entry.shipTypeId);
		else
			damage[entry.shipTypeId] =
				(damage[entry.shipTypeId] ?? 0) +
				Math.max(entry.damagePerDay, 0);
	});

	const shipTypeIds: string[] = Object.keys(fleet).sort();

	return shipTypeIds.map((shipTypeId) => {
		const count: number = Math.max(fleet[shipTypeId]?.count ?? 0, 0);
		const shipMinutesPerDay: number = minutes[shipTypeId] ?? 0;

		return {
			shipTypeId,
			count,
			designName: fleet[shipTypeId]?.designName,
			shipMinutesPerDay,
			utilization:
				count > 0
					? shipMinutesPerDay / (MINUTES_PER_DAY * count)
					: null,
			damagePerDay: damageUnknown.has(shipTypeId)
				? null
				: (damage[shipTypeId] ?? 0),
			// one lane contributes one entry per LEG since the cadence
			// model, and several legs may fly the same type
			keys: Array.from(new Set(keys[shipTypeId] ?? [])),
		};
	});
}

/**
 * Hull candidates the automatic pick may assign: the OWNED types.
 *
 * A type the fleet holds no hull of is an advisory at best, so only
 * counts above zero become candidates. An account that never configured
 * a fleet falls back to the starter ship every new game account owns —
 * see {@link RAUKK_STARTER_FLEET} — rather than to a phantom bigger
 * hull; that fallback is math only and never becomes a fleet entry.
 *
 * @author raukk
 *
 * @param {Record<string, IRaukkFleetShip>} fleet Ships per type
 * @param {(shipTypeId: string) => IRaukkHullCandidate} candidateOf
 *   Resolves one ship type into a priced hull candidate
 * @returns {IRaukkHullCandidate[]} Assignable hull candidates
 */
export function raukkOwnedHullCandidates(
	fleet: Record<string, IRaukkFleetShip>,
	candidateOf: (shipTypeId: string) => IRaukkHullCandidate
): IRaukkHullCandidate[] {
	const configured: IRaukkHullCandidate[] = Object.entries(fleet)
		.filter(([, ship]) => ship.count > 0)
		.map(([shipTypeId]) => candidateOf(shipTypeId));

	return configured.length > 0
		? configured
		: [candidateOf(RAUKK_STARTER_FLEET.shipTypeId)];
}
