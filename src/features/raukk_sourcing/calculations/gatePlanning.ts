// Planned gates: gate links that do NOT exist. One is either a gate the
// user watched go up in the game and wants to route over before it opens,
// or one nobody is building and the user wants to know the worth of.
//
// A planned gate is a WHAT-IF, but not a free one: it is specified the
// way the game specifies a gate, by its three upgrade tracks, and what
// those buy it — clearance, linking range, traversals a day — comes from
// the transcribed GTWI panel in `gateCosts.ts` rather than from a number
// the user is free to type. Both of its ends are assumed identical, since
// nobody planning a link knows which side will end up the narrower one,
// and the fee is the one thing the user does state: the operator sets it.
// Currencies are not modelled at all, the four trade ~1:1 and the cost
// math treats them as one unit.
//
// The hard constraint that falls out of the panel is LINKING RANGE: a
// gate reaches 10 parsecs, 5 more per range upgrade, and a gap wider than
// that is not an expensive gate but an impossible one.
//
// Pure functions over plain data, like the rest of the calculation layer:
// no store, no Vue, no price fetching. The routing surface is injected.

// Calculations
import {
	IRaukkGateSpecs,
	IRaukkGateUpgrades,
	RAUKK_GATE_NO_UPGRADES,
	RAUKK_GATE_UPGRADE_CAPS,
	raukkGateSpecs,
	raukkGateUpgradeLevel,
} from "@/features/raukk_sourcing/calculations/gateCosts";

// Types & Interfaces
import {
	IRaukkGateLink,
	IRaukkGateSide,
	IRaukkMultiModalPath,
	IRaukkRouteDistance,
	IRaukkRouteTimeOptions,
	RAUKK_GATE_TRAVERSAL,
	resolveSystemId,
	straightLineParsecs,
} from "@/features/raukk_sourcing/calculations/routeDistance";
import { RAUKK_STOP_REF } from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * Hull volume of an HCB, m³, from the gate assets own comment.
 *
 * A planned gate is called HCB capable when it clears this — the check
 * the transcribed asset precomputes per link, restated here so a planned
 * gate answers the same question a real one does.
 *
 * @author raukk
 */
export const RAUKK_HCB_HULL_M3: number = 5825;

/**
 * Traversal fee a planned gate gets when the user states none.
 *
 * Mid range of the transcribed fees, which run 1,000 to 6,000 ȼ.
 *
 * @author raukk
 */
export const RAUKK_PLANNED_GATE_DEFAULT_FEE: number = 4000;

/**
 * What the user is planning: a gate going up, or one they wish existed.
 *
 * DISPLAY only — the routing treats both alike, since a gate that is half
 * built flies exactly as little as one nobody started.
 *
 * @author raukk
 */
export type RAUKK_PLANNED_GATE_STATUS = "construction" | "proposed";

/**
 * One gate the user planned, as the store persists it.
 *
 * `enabled` is the switch that matters: while it is off the gate is a
 * note, and every route in the application is routed as it is today.
 * While it is on the gate is an edge of the graph, and the shipping
 * numbers of the whole account are planned over a gate that does not
 * exist yet — which is why switching it stales them.
 *
 * @author raukk
 */
export interface IRaukkPlannedGate {
	/** Stable id, the store key */
	id: string;
	/** Free text label, empty falls back to the two planet ids */
	name?: string;
	/** Planet natural id of the a side, e.g. `ZV-307c` */
	planetA: RAUKK_STOP_REF;
	/** Planet natural id of the b side */
	planetB: RAUKK_STOP_REF;
	/** Usage fee ONE traversal pays, ȼ, same on both sides */
	fee: number;
	/** Capacity upgrade levels of EACH end, 0 to 5 */
	capacityUpgrades: number;
	/** Volume upgrade levels of each end, 0 to 3 — sets the clearance */
	volumeUpgrades: number;
	/** Range upgrade levels of each end, 0 to 3 — sets how far it links */
	rangeUpgrades: number;
	/** Fed into the route graph while on */
	enabled: boolean;
	status: RAUKK_PLANNED_GATE_STATUS;
	/** Free text, e.g. an ETA or who is building it */
	note?: string;
	/**
	 * Clearance as a bare number, m³.
	 *
	 * The shape the very first version of this tool persisted, before the
	 * GTWI transcription made clear that a gate's clearance is not free
	 * to choose — it is 1,500 m³ plus 1,500 per volume upgrade. Read only
	 * when the upgrade levels are absent, which is exactly the blob that
	 * version wrote; nothing writes it any more.
	 */
	maxM3?: number;
}

/**
 * Upgrade levels of one planned gate, clamped to what the game allows.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate} gate Planned gate
 * @returns {IRaukkGateUpgrades} Upgrade levels
 */
export function raukkPlannedGateUpgrades(
	gate: IRaukkPlannedGate
): IRaukkGateUpgrades {
	return {
		capacity: raukkGateUpgradeLevel("capacity", gate.capacityUpgrades ?? 0),
		volume: raukkGateUpgradeLevel("volume", gate.volumeUpgrades ?? 0),
		range: raukkGateUpgradeLevel("range", gate.rangeUpgrades ?? 0),
	};
}

/**
 * Specifications a planned gate would have once built.
 *
 * Falls back to the legacy `maxM3` for the clearance alone, and only
 * when the upgrade levels are absent entirely: a gate stored by the
 * pre-transcription version knew a clearance and nothing else.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate} gate Planned gate
 * @returns {IRaukkGateSpecs} Specifications
 */
export function raukkPlannedGateSpecs(
	gate: IRaukkPlannedGate
): IRaukkGateSpecs {
	const specs: IRaukkGateSpecs = raukkGateSpecs(
		raukkPlannedGateUpgrades(gate)
	);

	if (
		gate.volumeUpgrades === undefined &&
		gate.maxM3 !== undefined &&
		Number.isFinite(gate.maxM3)
	) {
		specs.maxShipVolumeM3 = Math.max(gate.maxM3, 0);
	}

	return specs;
}

/**
 * Why a planned gate cannot be routed, `""` when it can.
 *
 * `same_system` is not a typo guard but a real case: two planets of one
 * system need no gate between them, and the graph is a system graph, so
 * such a link would be an edge from a node to itself.
 *
 * @author raukk
 */
export type RAUKK_PLANNED_GATE_ISSUE =
	| ""
	| "no_endpoints"
	| "unknown_a"
	| "unknown_b"
	| "same_system"
	| "out_of_range"
	| "unreachable_range";

/** What one planned gate would be worth, measured against today */
export interface IRaukkPlannedGateValue {
	gateId: string;
	/** Why it routes nothing, `""` when it routes */
	issue: RAUKK_PLANNED_GATE_ISSUE;
	systemIdA: string | null;
	systemIdB: string | null;
	/** Straight line the gate would bridge, parsecs */
	parsecs: number | null;
	/** Minutes one traversal takes, distance term plus overhead */
	traversalMinutes: number | null;
	/**
	 * Minutes the same trip takes on the network as it stands TODAY,
	 * null when nothing gets there at all for such a hull.
	 */
	todayMinutes: number | null;
	/** Gate traversals of that current best route, planned ones excluded */
	todayGateHops: number;
	/** Minutes once the gate is built: the better of both */
	plannedMinutes: number | null;
	/** Minutes the gate saves per trip, 0 when it saves nothing */
	savedMinutes: number;
	/** Saved share of today's trip, 0 to 1, 0 when it saves nothing */
	savedShare: number;
	/** Nothing reaches the far side today, for a hull this size */
	unreachableToday: boolean;
	/** The link would clear an HCB */
	hcbCapable: boolean;
	/** Ship volume the link would admit, m³ */
	maxM3: number;
	/** How far each end could link at its range upgrades, parsecs */
	linkingRangeParsecs: number;
	/**
	 * Range upgrades the gap needs, null when even a fully upgraded gate
	 * cannot reach. `0` means the base gate already spans it.
	 */
	rangeUpgradesNeeded: number | null;
}

/**
 * Display label of a planned gate: its name, else its two endpoints.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate} gate Planned gate
 * @returns {string} Label
 */
export function raukkPlannedGateLabel(gate: IRaukkPlannedGate): string {
	const name: string = (gate.name ?? "").trim();

	return name !== "" ? name : `${gate.planetA} ⇄ ${gate.planetB}`;
}

/**
 * One side of a planned gate, the transcription fields left blank.
 *
 * @author raukk
 *
 * @param {string} id Side id
 * @param {number} fee Usage fee, ȼ
 * @param {number} maxM3 Volume clearance, m³
 * @returns {IRaukkGateSide} Gate side
 */
function plannedSide(id: string, fee: number, maxM3: number): IRaukkGateSide {
	return {
		id,
		fee,
		// planned gates carry no currency, all four trade ~1:1
		cur: "AIC",
		maxM3,
		// capacity, upgrade levels and age are transcription facts; a gate
		// that does not exist has none of them, and the model reads none
		jumps24h: 0,
		up: "",
		est: "",
	};
}

/**
 * Turns one planned gate into the graph edge the routing understands.
 *
 * Both sides get the stated fee and clearance: the user plans a link, not
 * two independently upgraded ends. The result is flagged `planned`, so
 * every route over it stays distinguishable from a route that flies.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate} gate Planned gate
 * @returns {IRaukkGateLink} Gate link
 */
export function raukkPlannedGateLink(gate: IRaukkPlannedGate): IRaukkGateLink {
	const fee: number = Math.max(gate.fee, 0);
	const maxM3: number = raukkPlannedGateSpecs(gate).maxShipVolumeM3;
	const label: string = raukkPlannedGateLabel(gate);

	return {
		a: gate.planetA.trim(),
		aName: label,
		b: gate.planetB.trim(),
		bName: label,
		aGate: plannedSide(`${gate.id}-a`, fee, maxM3),
		bGate: plannedSide(`${gate.id}-b`, fee, maxM3),
		maxTraversalM3: maxM3,
		hcbCapable: maxM3 >= RAUKK_HCB_HULL_M3,
		planned: true,
	};
}

/**
 * What the buildability check needs of a routing surface.
 *
 * Deliberately the two CHEAP lookups: whether a gate could exist is a
 * question about two coordinates, and answering it must not cost a
 * shortest path search — the store asks it on every keystroke.
 *
 * @author raukk
 */
export type IRaukkPlannedGateRoutes = Pick<
	IRaukkRouteDistance,
	"resolveSystemId"
> &
	Pick<Required<IRaukkRouteDistance>, "straightLineParsecs">;

/** The real systems JSON, what every caller means unless it says otherwise */
const DEFAULT_ROUTES: IRaukkPlannedGateRoutes = {
	resolveSystemId,
	straightLineParsecs,
};

/**
 * Whether a planned gate could be BUILT as configured.
 *
 * Both ends have to resolve to two different systems, and the gap
 * between them has to fall inside the linking range the gate's range
 * upgrades buy. Everything else about a gate — its fee, its clearance,
 * whether it saves a minute — is a question of worth; this is the prior
 * question of possibility.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate} gate Planned gate
 * @param {IRaukkPlannedGateRoutes} routes Route lookups
 * @returns {boolean} Whether the gate could exist
 */
export function raukkPlannedGateBuildable(
	gate: IRaukkPlannedGate,
	routes: IRaukkPlannedGateRoutes = DEFAULT_ROUTES
): boolean {
	if (gate.planetA.trim() === "" || gate.planetB.trim() === "") return false;

	const systemIdA: string | null = routes.resolveSystemId(gate.planetA);
	const systemIdB: string | null = routes.resolveSystemId(gate.planetB);

	if (systemIdA === null || systemIdB === null) return false;
	if (systemIdA === systemIdB) return false;

	const parsecs: number | null = routes.straightLineParsecs(
		systemIdA,
		systemIdB
	);

	if (parsecs === null) return false;

	return parsecs <= raukkPlannedGateSpecs(gate).linkingRangeParsecs;
}

/**
 * Graph edges of every enabled planned gate that could actually EXIST.
 *
 * Two filters, and both matter. A disabled gate is a note the user
 * keeps, not an edge: it is measured exactly like an enabled one, it
 * just moves no route. And a gate that CANNOT BE BUILT is never an edge
 * however switched on it is — a user who switches a gate on and then
 * spends its range upgrades elsewhere has stopped describing a gate, and
 * the route graph must stop carrying one rather than quietly plan the
 * whole account over something the game would refuse to construct.
 *
 * The stored `enabled` flag is left alone: it is the user's intent, and
 * restoring the range restores the edge without them having to remember
 * to switch it back on.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate[]} gates Planned gates
 * @param {IRaukkPlannedGateRoutes} routes Route lookups
 * @returns {IRaukkGateLink[]} Gate links of the enabled, buildable ones
 */
export function raukkPlannedGateLinks(
	gates: IRaukkPlannedGate[],
	routes: IRaukkPlannedGateRoutes = DEFAULT_ROUTES
): IRaukkGateLink[] {
	return gates
		.filter(
			(gate) => gate.enabled && raukkPlannedGateBuildable(gate, routes)
		)
		.map(raukkPlannedGateLink);
}

/**
 * Minutes one traversal of a gate of that length takes.
 *
 * The calibrated model of a real traversal, applied unchanged to a
 * planned one: a distance term plus a flat, ship independent overhead.
 *
 * @author raukk
 *
 * @param {number} parsecs Straight line the gate bridges
 * @param {Partial<IRaukkRouteTimeOptions>} options Time model overrides
 * @returns {number} Minutes
 */
export function raukkPlannedGateTraversalMinutes(
	parsecs: number,
	options: Partial<IRaukkRouteTimeOptions> = {}
): number {
	const perParsec: number =
		options.gateMinutesPerParsec ?? RAUKK_GATE_TRAVERSAL.minutesPerParsec;
	const overhead: number =
		options.gateOverheadMinutes ?? RAUKK_GATE_TRAVERSAL.overheadMinutes;

	return parsecs * perParsec + overhead;
}

/**
 * What one planned gate would be worth on its own endpoints.
 *
 * Measured as the hop the gate itself is against the best the network
 * manages TODAY between the same two systems — planned gates barred, the
 * user's own included, so every row answers "what does THIS gate add"
 * rather than "what do all my plans together add".
 *
 * The reference hull is the gates own clearance: today's route is asked
 * for a ship exactly as big as the one the new gate would pass, so a
 * narrow existing gate that could not take that hull does not get to
 * count against the plan. Both sides of the comparison therefore fly the
 * same ship, which is the only way the saving means anything.
 *
 * A gate never routes worse than not having it: the ship may always
 * ignore it, so the planned trip is the better of both. A gate that
 * saves nothing reports zero rather than a negative saving.
 *
 * @author raukk
 *
 * @param {IRaukkPlannedGate} gate Planned gate
 * @param {IRaukkRouteDistance} routes Route lookups
 * @param {Partial<IRaukkRouteTimeOptions>} options Time model overrides
 * @returns {IRaukkPlannedGateValue} Value of the gate
 */
export function raukkPlannedGateValue(
	gate: IRaukkPlannedGate,
	routes: IRaukkRouteDistance,
	options: Partial<IRaukkRouteTimeOptions> = {}
): IRaukkPlannedGateValue {
	const specs: IRaukkGateSpecs = raukkPlannedGateSpecs(gate);
	const maxM3: number = specs.maxShipVolumeM3;

	const blank: IRaukkPlannedGateValue = {
		gateId: gate.id,
		issue: "",
		systemIdA: null,
		systemIdB: null,
		parsecs: null,
		traversalMinutes: null,
		todayMinutes: null,
		todayGateHops: 0,
		plannedMinutes: null,
		savedMinutes: 0,
		savedShare: 0,
		unreachableToday: false,
		hcbCapable: maxM3 >= RAUKK_HCB_HULL_M3,
		maxM3,
		linkingRangeParsecs: specs.linkingRangeParsecs,
		rangeUpgradesNeeded: 0,
	};

	if (gate.planetA.trim() === "" || gate.planetB.trim() === "")
		return { ...blank, issue: "no_endpoints" };

	const systemIdA: string | null = routes.resolveSystemId(gate.planetA);
	const systemIdB: string | null = routes.resolveSystemId(gate.planetB);

	if (systemIdA === null) return { ...blank, issue: "unknown_a" };
	if (systemIdB === null) return { ...blank, systemIdA, issue: "unknown_b" };
	if (systemIdA === systemIdB)
		return { ...blank, systemIdA, systemIdB, issue: "same_system" };

	const parsecs: number | null =
		routes.straightLineParsecs?.(systemIdA, systemIdB) ?? null;

	if (parsecs === null) return { ...blank, systemIdA, systemIdB };

	/*
	 * A gate only links as far as its LINKING RANGE, and that range is
	 * measured in exactly these parsecs — the GTWI "Reachable Systems"
	 * distances match this straight line to three decimals. A gap wider
	 * than the range is not an expensive gate, it is no gate at all, so
	 * it is reported as an issue rather than as a slow route.
	 */
	const rangeUpgradesNeeded: number | null =
		raukkPlannedGateRangeUpgrades(parsecs);

	const traversalMinutes: number = raukkPlannedGateTraversalMinutes(
		parsecs,
		options
	);

	if (parsecs > specs.linkingRangeParsecs) {
		return {
			...blank,
			systemIdA,
			systemIdB,
			parsecs,
			traversalMinutes,
			rangeUpgradesNeeded,
			issue:
				rangeUpgradesNeeded === null
					? "unreachable_range"
					: "out_of_range",
		};
	}

	/*
	 * Today's best, planned gates barred. `shipVolumeM3` is the planned
	 * clearance so both sides of the comparison fly one hull; a gate
	 * without a stated clearance asks for the network any ship may use.
	 */
	const today: IRaukkMultiModalPath | null | undefined = routes.fastestPath?.(
		systemIdA,
		systemIdB,
		{
			...options,
			usePlannedGates: false,
			gatesOnly: false,
			shipVolumeM3: maxM3,
		}
	);

	const todayMinutes: number | null = today?.minutes ?? null;

	if (todayMinutes === null) {
		return {
			...blank,
			systemIdA,
			systemIdB,
			parsecs,
			traversalMinutes,
			plannedMinutes: traversalMinutes,
			unreachableToday: true,
		};
	}

	const plannedMinutes: number = Math.min(todayMinutes, traversalMinutes);
	const savedMinutes: number = Math.max(todayMinutes - plannedMinutes, 0);

	return {
		...blank,
		systemIdA,
		systemIdB,
		parsecs,
		traversalMinutes,
		todayMinutes,
		todayGateHops: today?.gateHops ?? 0,
		plannedMinutes,
		savedMinutes,
		savedShare: todayMinutes > 0 ? savedMinutes / todayMinutes : 0,
		rangeUpgradesNeeded,
	};
}

/**
 * Fewest range upgrades a gap of that width needs.
 *
 * `0` when the base gate already spans it, `null` when even a fully
 * upgraded gate does not reach — no amount of building bridges that gap,
 * which is a planning answer in its own right.
 *
 * @author raukk
 *
 * @param {number} parsecs Gap the gate would bridge
 * @returns {(number | null)} Range upgrade levels, null if out of reach
 */
export function raukkPlannedGateRangeUpgrades(parsecs: number): number | null {
	for (let level = 0; level <= RAUKK_GATE_UPGRADE_CAPS.range; level++) {
		if (
			parsecs <=
			raukkGateSpecs({ ...RAUKK_GATE_NO_UPGRADES, range: level })
				.linkingRangeParsecs
		)
			return level;
	}

	return null;
}
