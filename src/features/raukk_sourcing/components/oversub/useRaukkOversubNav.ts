// Modifier-click navigation of the oversubscription report, one scheme
// across every tab: Shift+click opens the producer (source) plan,
// Alt+click and double-click open the consumer (destination) — falling
// back to the producer on elements without a single consumer — and
// Ctrl (Cmd on macOS, Chrome's link instinct) is the new-tab modifier:
// alone it opens the element's primary target in a new browser tab,
// on top of Shift/Alt/double-click it sends that gesture's target to a
// new tab instead. Provided by the section and injected by tabs, like
// the shared selection and tooltip. The decision logic is pure and
// exported for tests; only the provided object touches the router.

import { inject, InjectionKey, provide } from "vue";
import { RouteLocationRaw, Router, useRouter } from "vue-router";

// Types & Interfaces
import { IRaukkOversubRow } from "@/features/raukk_sourcing/calculations/oversubReport.types";

/** Anything segment-shaped the report renders: raw or display segment */
export interface IRaukkOversubNavSegmentLike {
	/** Path to navigate to, null on non-navigable segments */
	navTarget: string | null;
	/** Raw segment discriminator, external = never a nav element */
	segmentKind?: "plan" | "chain" | "external";
	/** Display segment key, "external" = never a nav element */
	key?: string;
}

/** The two possible destinations of one clicked element */
export interface IRaukkOversubNavTargets {
	/** The producer (source) plan, null on fleet rows without a plan */
	producer: RouteLocationRaw | null;
	/** The consumer (destination), null without a single consumer */
	consumer: RouteLocationRaw | null;
}

/** The modifier state of one click, plain data for the pure decision */
export interface IRaukkOversubNavModifiers {
	shift: boolean;
	alt: boolean;
	/** The new-tab modifier: Ctrl (Windows/Linux) or Cmd (macOS, where
	 * Ctrl+click fires the context menu instead) */
	ctrlOrMeta: boolean;
}

/** What one gesture resolved to */
export interface IRaukkOversubNavDecision {
	/** A nav gesture was made — the caller must not also toggle its
	 * selection / drill, even when `target` stays null (no-op) */
	consumed: boolean;
	target: RouteLocationRaw | null;
	/** Open in a new browser tab instead of an in-app push */
	newTab: boolean;
}

/**
 * Router target of one report path: plan paths open the sourcing tool
 * via the PlanView `?tool=` deep link, non-plan paths (fleet →
 * /shipping) pass through untouched. Null stays null.
 *
 * @author raukk
 *
 * @param {(string | null)} path Plain path the report built
 * @returns {(RouteLocationRaw | null)} Target to navigate to
 */
export function raukkOversubNavPath(
	path: string | null
): RouteLocationRaw | null {
	if (path === null) return null;

	return path.startsWith("/plan/")
		? { path, query: { tool: "raukk-sourcing" } }
		: path;
}

/**
 * Plain plan path of one producer, the report's `/plan/...` shape.
 *
 * @author raukk
 *
 * @param {string} planetNaturalId Planet natural id
 * @param {string} planUuid Plan uuid
 * @returns {string} Plan path
 */
export function raukkOversubPlanPath(
	planetNaturalId: string,
	planUuid: string
): string {
	return `/plan/${planetNaturalId}/${planUuid}`;
}

/**
 * The two nav targets of one row element, optionally with the clicked
 * segment: the producer plan of a ticker row (fleet rows carry no plan
 * and stay null — never a nav target) and the segment's own consumer
 * destination (plan segments → their plan, chain segments → /shipping,
 * folded segments → null). An external segment is outside this empire
 * and never a nav element: both targets stay null, no hint renders.
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow} row The clicked element's row
 * @param {IRaukkOversubNavSegmentLike} segment The clicked segment,
 * omitted on producer-level elements (labels, tracks, dots, boxes)
 * @returns {IRaukkOversubNavTargets} Producer and consumer targets
 */
export function raukkOversubNavTargets(
	row: IRaukkOversubRow,
	segment?: IRaukkOversubNavSegmentLike
): IRaukkOversubNavTargets {
	if (
		segment !== undefined &&
		(segment.segmentKind === "external" || segment.key === "external")
	)
		return { producer: null, consumer: null };

	return {
		producer:
			row.kind === "ticker"
				? raukkOversubNavPath(
						raukkOversubPlanPath(
							row.planetNaturalId,
							row.producerPlanUuid
						)
					)
				: null,
		consumer:
			segment !== undefined
				? raukkOversubNavPath(segment.navTarget)
				: null,
	};
}

/**
 * Consumer plan navigation paths keyed by consumer plan uuid, scanned
 * off the rendered rows' plan segments — the lookup of elements that
 * carry only a consumer uuid (matrix / grid columns, map consumer
 * nodes, star map edges).
 *
 * @author raukk
 *
 * @param {IRaukkOversubRow[]} rows Rendered rows, either group
 * @returns {Record<string, string>} Plain nav path per consumer uuid
 */
export function raukkOversubConsumerNavByUuid(
	rows: IRaukkOversubRow[]
): Record<string, string> {
	const result: Record<string, string> = {};

	rows.forEach((row) =>
		row.segments.forEach((segment) => {
			if (segment.segmentKind !== "plan") return;
			if (segment.planUuid === undefined) return;
			if (segment.navTarget === null) return;
			if (result[segment.planUuid] !== undefined) return;

			result[segment.planUuid] = segment.navTarget;
		})
	);

	return result;
}

/**
 * The pure gesture decision of the uniform scheme. Click: Shift → the
 * producer (source); Alt → the consumer (destination), falling back to
 * the producer on elements without a single consumer; Ctrl/Cmd alone →
 * the element's primary target (consumer where one exists, producer
 * else); no nav modifier → not consumed, the caller keeps its
 * plain-click behavior. Double-click: always consumed, same target as
 * Alt+click. Ctrl/Cmd on any consumed gesture flips the new-tab flag.
 * A consumed gesture with a null target is a deliberate no-op — never
 * a selection toggle.
 *
 * @author raukk
 *
 * @param {IRaukkOversubNavTargets} targets The element's two targets
 * @param {IRaukkOversubNavModifiers} modifiers Held modifier keys
 * @param {("click" | "dblclick")} gesture The gesture kind
 * @returns {IRaukkOversubNavDecision} Consumption, target, new tab
 */
export function raukkOversubNavDecision(
	targets: IRaukkOversubNavTargets,
	modifiers: IRaukkOversubNavModifiers,
	gesture: "click" | "dblclick"
): IRaukkOversubNavDecision {
	const newTab: boolean = modifiers.ctrlOrMeta;

	if (gesture === "dblclick")
		return {
			consumed: true,
			target: targets.consumer ?? targets.producer,
			newTab,
		};

	if (modifiers.shift)
		return { consumed: true, target: targets.producer, newTab };

	if (modifiers.alt || modifiers.ctrlOrMeta)
		return {
			consumed: true,
			target: targets.consumer ?? targets.producer,
			newTab,
		};

	return { consumed: false, target: null, newTab: false };
}

/**
 * The tooltip hint key of one element's targets, under the report's
 * `nav` i18n subtree: elements with both a source and a destination
 * get the full scheme line, a chain destination (/shipping) its own
 * wording, single-plan elements (row surfaces, consumer columns and
 * nodes) the shorter "open this plan" line, and elements without any
 * target no hint at all (external segments, fleet ship-type rows).
 *
 * @author raukk
 *
 * @param {IRaukkOversubNavTargets} targets The element's two targets
 * @returns {("hint_consumer" | "hint_producer" | "hint_chain" | null)}
 * Key under `oversub_report.nav`, null = no hint line
 */
export function raukkOversubNavHintKey(
	targets: IRaukkOversubNavTargets
): "hint_consumer" | "hint_producer" | "hint_chain" | null {
	if (targets.consumer === null)
		return targets.producer === null ? null : "hint_producer";

	if (typeof targets.consumer === "string") return "hint_chain";

	return targets.producer === null ? "hint_producer" : "hint_consumer";
}

/** The nav API every tab injects */
export interface IRaukkOversubNav {
	/** The two targets of one row element, `raukkOversubNavTargets` */
	resolveTarget: (
		row: IRaukkOversubRow,
		segment?: IRaukkOversubNavSegmentLike
	) => IRaukkOversubNavTargets;
	/** Handles a click on a row element; true = the event was a nav
	 * gesture and the caller must skip its plain-click behavior */
	handleClick: (
		event: MouseEvent,
		row: IRaukkOversubRow,
		segment?: IRaukkOversubNavSegmentLike
	) => boolean;
	/** Handles a double-click on a row element, same contract */
	handleDblClick: (
		event: MouseEvent,
		row: IRaukkOversubRow,
		segment?: IRaukkOversubNavSegmentLike
	) => boolean;
	/** Click entry of elements without a row model (columns, pairs,
	 * map nodes) — the caller resolves the targets itself */
	handleClickTargets: (
		event: MouseEvent,
		targets: IRaukkOversubNavTargets
	) => boolean;
	/** Double-click entry of elements without a row model */
	handleDblClickTargets: (
		event: MouseEvent,
		targets: IRaukkOversubNavTargets
	) => boolean;
}

const RAUKK_OVERSUB_NAV_KEY: InjectionKey<IRaukkOversubNav> =
	Symbol("RaukkOversubNav");

/** Modifier state of one mouse event */
function modifiersOf(event: MouseEvent): IRaukkOversubNavModifiers {
	return {
		shift: event.shiftKey,
		alt: event.altKey,
		ctrlOrMeta: event.ctrlKey || event.metaKey,
	};
}

/**
 * Creates the report's modifier-click navigation and provides it to
 * the section's subtree. Called once by `RaukkOversubReportSection`.
 *
 * @author raukk
 *
 * @returns {IRaukkOversubNav} The nav API, also injected by tabs
 */
export function provideRaukkOversubNav(): IRaukkOversubNav {
	const router: Router = useRouter();

	/** Runs one decided gesture: no-op, in-app push or a new tab */
	function run(
		event: MouseEvent,
		targets: IRaukkOversubNavTargets,
		gesture: "click" | "dblclick"
	): boolean {
		// clicks on real links and buttons keep their native semantics
		// (a RouterLink's own Ctrl+click already opens a new tab, a
		// recompute button must never navigate)
		if (
			event.target instanceof Element &&
			event.target.closest("a, button") !== null
		)
			return false;

		const decision: IRaukkOversubNavDecision = raukkOversubNavDecision(
			targets,
			modifiersOf(event),
			gesture
		);

		if (!decision.consumed) return false;

		event.preventDefault();
		event.stopPropagation();

		if (decision.target !== null) {
			if (decision.newTab)
				window.open(router.resolve(decision.target).href, "_blank");
			else void router.push(decision.target);
		}

		return true;
	}

	const nav: IRaukkOversubNav = {
		resolveTarget: raukkOversubNavTargets,
		handleClick: (event, row, segment) =>
			run(event, raukkOversubNavTargets(row, segment), "click"),
		handleDblClick: (event, row, segment) =>
			run(event, raukkOversubNavTargets(row, segment), "dblclick"),
		handleClickTargets: (event, targets) => run(event, targets, "click"),
		handleDblClickTargets: (event, targets) =>
			run(event, targets, "dblclick"),
	};

	provide(RAUKK_OVERSUB_NAV_KEY, nav);
	return nav;
}

/**
 * The section's modifier-click navigation, from any component below it.
 *
 * @author raukk
 *
 * @returns {IRaukkOversubNav} The shared nav API
 */
export function useRaukkOversubNav(): IRaukkOversubNav {
	const nav: IRaukkOversubNav | undefined = inject(RAUKK_OVERSUB_NAV_KEY);

	if (nav === undefined)
		throw new Error("useRaukkOversubNav outside RaukkOversubReportSection");

	return nav;
}
