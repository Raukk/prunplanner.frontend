// Row model of the empire oversubscription report. One shape, built
// pure in `oversubReport.ts`, consumed by the table and every
// visualization tab. See docs/raukk_sourcing/oversubscription-report.md,
// "Row model". No Vue and no router import — a nav target is a plain
// path string here, resolved by the rendering layer.

/**
 * Reserved seam for the later CX top-up cost of an oversubscribed row:
 * what covering the deficit at the exchange would cost. Filled in by
 * the empire coverage engine, never computed here.
 */
interface IRaukkOversubCxTopUp {
	/** Units per day the exchange would have to cover */
	unitsPerDay: number;
	/** ȼ per day of buying that deficit at the exchange */
	costPerDay: number;
}

/**
 * One consumer claim on a row: a plan segment, a chain-level claim, or
 * the single collapsed segment of every consumer outside the empire.
 *
 * @author raukk
 */
export interface IRaukkOversubSegment {
	segmentKind: "plan" | "chain" | "external";
	/** Consuming plan of a plan segment */
	planUuid?: string;
	/** Chain of a chain segment — a chain-level claim, never
	 * attributed to a single plan */
	chainId?: string;
	label: string;
	/** u/d on ticker rows, ship-min/d on fleet rows */
	amountPerDay: number;
	/** Derived: consumer snapshot, owning snapshot or chain result */
	stale: boolean;
	/** Path to navigate to, null on non-navigable segments */
	navTarget: string | null;
}

/**
 * Fields every report row carries, ticker and fleet rows alike.
 *
 * @author raukk
 */
export interface IRaukkOversubRowBase {
	unit: "u/d" | "ship-min/d";
	/** Output u/d, or count × 1440 on fleet rows */
	grossPerDay: number;
	/** Self draw `draws[p][p][ticker]`, 0 on fleet rows */
	selfPerDay: number;
	/** `gross − self`, may be ≤ 0 */
	netPerDay: number;
	/** Σ ALL non-self draws, external consumers included */
	subscribedPerDay: number;
	segments: IRaukkOversubSegment[];
	/** `subscribed / net`, null when the denominator is not positive */
	utilization: number | null;
	over: boolean;
	/** Producer snapshot staleness; always false on fleet rows */
	producerStale: boolean;
	/** `producerStale || any segment stale` */
	anyStale: boolean;
	/** Reserved: later CX top-up cost of the deficit */
	cxTopUp?: IRaukkOversubCxTopUp;
}

/**
 * One producer × ticker row.
 *
 * @author raukk
 */
export interface IRaukkOversubTickerRow extends IRaukkOversubRowBase {
	kind: "ticker";
	producerPlanUuid: string;
	producerPlanName: string;
	planetNaturalId: string;
	ticker: string;
	computedAt: string;
}

/**
 * One ship type row of the account-wide fleet group.
 *
 * @author raukk
 */
export interface IRaukkOversubFleetRow extends IRaukkOversubRowBase {
	kind: "fleet";
	shipTypeId: string;
	designName?: string;
	/** Hulls of the type; no computedAt — many sources feed a row */
	count: number;
}

/**
 * Any row of the report, discriminated by `kind`.
 *
 * @author raukk
 */
export type IRaukkOversubRow = IRaukkOversubTickerRow | IRaukkOversubFleetRow;
