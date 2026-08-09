// Display shapes of the weight/volume capacity plane: every lane of the
// account as a point in (tonnes × m³) per trip, against the six cargo
// bays drawn as rectangles.
//
// The plane exists because a hold is limited by weight AND volume, and
// the two are independent. A lane is a point, a hull is a box, and
// "does this hull serve this lane in one trip" is the question of
// whether the point lies inside the box — which needs no arithmetic from
// the reader.
//
// Cadence is an INPUT, not a constant: cargo per trip is throughput
// times days between visits, so the same lane wants a different hull at
// a 3 day rhythm than at 30. Every function below therefore takes the
// days per visit rather than assuming one.
//
// Pure functions with no store and no Vue.

// Calculations
import {
	RAUKK_SHIP_HULLS,
	raukkShipProfileId,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";
import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

// Types & Interfaces
import {
	IRaukkShipHull,
	RAUKK_CARGO_BUCKET,
	RAUKK_LOAD_DIMENSION,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkMapLane } from "@/features/raukk_sourcing/calculations/shippingMapDisplay";

/** Shortest cadence the slider offers, days per visit */
export const RAUKK_CAPACITY_MIN_DAYS: number = 1;

/** Longest cadence the slider offers, days per visit */
export const RAUKK_CAPACITY_MAX_DAYS: number = 90;

/** One lane placed on the plane at a given cadence */
export interface IRaukkCapacityPoint {
	key: string;
	fromStop: string;
	toStop: string;
	bucket: RAUKK_CARGO_BUCKET;
	/** Tonnes accumulated between two visits */
	weightPerTrip: number;
	/** m³ accumulated between two visits */
	volumePerTrip: number;
	/** Which dimension is the larger share of the smallest fitting hull */
	binding: RAUKK_LOAD_DIMENSION;
	tickers: string[];
}

/** One cargo bay, as the plane draws its box */
export interface IRaukkCapacityHull {
	shipTypeId: string;
	/** In-game bay code, undefined for a hold outside the six presets */
	bayCode: string | undefined;
	cargoWeight: number;
	cargoVolume: number;
}

/** How one hull serves the whole account at a given cadence */
export interface IRaukkCapacityFit {
	hull: IRaukkCapacityHull;
	/** Lanes one trip of this hull carries whole */
	fitting: number;
	/** Lanes it cannot, which need more trips or a bigger hull */
	overflowing: number;
	/** Largest hold share any FITTING lane uses, null without one */
	worstFittingShare: number | null;
	/** True when every lane fits */
	fitsAll: boolean;
}

/**
 * The six cargo bays as plane boxes, smallest hold first.
 *
 * The hull list is the one `shippingProfiles.ts` already owns; the
 * reactor flag is irrelevant here — a bay's dimensions do not depend on
 * what pushes it — so the standard reactor's profile id names each box.
 *
 * @author raukk
 *
 * @returns {IRaukkCapacityHull[]} Cargo bays, smallest first
 */
export function raukkCapacityHulls(): IRaukkCapacityHull[] {
	return RAUKK_SHIP_HULLS.map((hull: IRaukkShipHull) => ({
		shipTypeId: raukkShipProfileId(hull, "standard"),
		bayCode: raukkBayCode(hull.cargoWeight, hull.cargoVolume),
		cargoWeight: hull.cargoWeight,
		cargoVolume: hull.cargoVolume,
	})).sort(
		(left, right) =>
			left.cargoWeight * left.cargoVolume -
				right.cargoWeight * right.cargoVolume ||
			left.cargoWeight - right.cargoWeight
	);
}

/**
 * Places every lane on the plane at one cadence.
 *
 * Per trip cargo is the daily amount times the days between visits: a
 * lane moving 40 t/day presents 280 t to a ship that calls weekly and
 * 1 200 t to one that calls monthly. That multiplication is the whole
 * model, and it is why the cadence has to be stated rather than assumed.
 *
 * A lane carrying nothing is dropped — a point at the origin says
 * nothing about any hull.
 *
 * @author raukk
 *
 * @param {IRaukkMapLane[]} lanes Aggregated lanes
 * @param {number} cadenceDays Days between two visits
 * @returns {IRaukkCapacityPoint[]} Points, largest hold demand first
 */
export function raukkCapacityPoints(
	lanes: IRaukkMapLane[],
	cadenceDays: number
): IRaukkCapacityPoint[] {
	const days: number = Math.max(cadenceDays, 0);

	return lanes
		.filter((lane) => lane.weightPerDay > 0 || lane.volumePerDay > 0)
		.map((lane) => {
			const weightPerTrip: number = lane.weightPerDay * days;
			const volumePerTrip: number = lane.volumePerDay * days;

			return {
				key: lane.key,
				fromStop: lane.fromStop,
				toStop: lane.toStop,
				bucket: lane.bucket,
				weightPerTrip,
				volumePerTrip,
				binding: raukkCapacityBinding(weightPerTrip, volumePerTrip),
				tickers: lane.tickers,
			};
		})
		.sort(
			(left, right) =>
				right.weightPerTrip * right.volumePerTrip -
					left.weightPerTrip * left.volumePerTrip ||
				left.key.localeCompare(right.key)
		);
}

/**
 * Dimension a shipment is bound by, measured against the SQUAREST hull
 * shape there is — equal tonnes and m³.
 *
 * A cargo denser than 1 t per m³ runs out of weight allowance before it
 * runs out of room in any bay whose two dimensions are equal, and the
 * reverse for a lighter one. That is the reading the plane's diagonal
 * draws, so the label has to agree with it.
 *
 * @author raukk
 *
 * @param {number} weightPerTrip Tonnes per trip
 * @param {number} volumePerTrip m³ per trip
 * @returns {RAUKK_LOAD_DIMENSION} Binding dimension
 */
export function raukkCapacityBinding(
	weightPerTrip: number,
	volumePerTrip: number
): RAUKK_LOAD_DIMENSION {
	return volumePerTrip > weightPerTrip ? "volume" : "weight";
}

/**
 * Share of a hull one shipment occupies: the larger of both dimensions,
 * uncapped.
 *
 * Uncapped on purpose — 1.8 means the lane needs two trips of this hull,
 * and clamping it to "full" would hide exactly that.
 *
 * @author raukk
 *
 * @param {IRaukkCapacityHull} hull Cargo bay
 * @param {number} weightPerTrip Tonnes per trip
 * @param {number} volumePerTrip m³ per trip
 * @returns {number} Hold share, 1 = exactly full
 */
export function raukkCapacityShare(
	hull: IRaukkCapacityHull,
	weightPerTrip: number,
	volumePerTrip: number
): number {
	const byWeight: number =
		hull.cargoWeight > 0 ? weightPerTrip / hull.cargoWeight : Infinity;
	const byVolume: number =
		hull.cargoVolume > 0 ? volumePerTrip / hull.cargoVolume : Infinity;

	return Math.max(byWeight, byVolume);
}

/**
 * The smallest bay carrying one shipment whole, null when none does.
 *
 * Smallest rather than any: a hull bigger than the cargo costs the same
 * trip and flies the surplus as air, so the useful answer to "which hull
 * for this lane" is always the tightest one that still fits.
 *
 * @author raukk
 *
 * @param {IRaukkCapacityHull[]} hulls Cargo bays, any order
 * @param {number} weightPerTrip Tonnes per trip
 * @param {number} volumePerTrip m³ per trip
 * @returns {(IRaukkCapacityHull | null)} Smallest fitting bay
 */
export function raukkCapacitySmallestFit(
	hulls: IRaukkCapacityHull[],
	weightPerTrip: number,
	volumePerTrip: number
): IRaukkCapacityHull | null {
	const fitting: IRaukkCapacityHull[] = hulls
		.filter(
			(hull) =>
				weightPerTrip <= hull.cargoWeight &&
				volumePerTrip <= hull.cargoVolume
		)
		.sort(
			(left, right) =>
				left.cargoWeight * left.cargoVolume -
				right.cargoWeight * right.cargoVolume
		);

	return fitting.length === 0 ? null : fitting[0];
}

/**
 * How every bay serves the account at one cadence.
 *
 * This is the reading that answers "do I need a bigger hull": a bay
 * fitting every lane with its worst lane at 40% of the hold is oversized
 * for this account, and one leaving lanes overflowing is undersized.
 *
 * @author raukk
 *
 * @param {IRaukkCapacityPoint[]} points Lanes placed at the cadence
 * @param {IRaukkCapacityHull[]} hulls Cargo bays
 * @returns {IRaukkCapacityFit[]} One verdict per bay, smallest first
 */
export function raukkCapacityFits(
	points: IRaukkCapacityPoint[],
	hulls: IRaukkCapacityHull[]
): IRaukkCapacityFit[] {
	return hulls.map((hull) => {
		let fitting: number = 0;
		let worstFittingShare: number | null = null;

		points.forEach((point) => {
			const share: number = raukkCapacityShare(
				hull,
				point.weightPerTrip,
				point.volumePerTrip
			);

			if (share > 1) return;

			fitting += 1;
			if (worstFittingShare === null || share > worstFittingShare)
				worstFittingShare = share;
		});

		return {
			hull,
			fitting,
			overflowing: points.length - fitting,
			worstFittingShare,
			fitsAll: points.length > 0 && fitting === points.length,
		};
	});
}

/**
 * Longest cadence every lane still fits one trip of a bay at, in whole
 * days, or 0 when even a single day overflows it.
 *
 * The inverse of the plane, and the number the cadence slider exists to
 * find: cargo per trip grows linearly with the days between visits, so
 * the answer is the smallest per lane limit of hold over daily amount.
 *
 * @author raukk
 *
 * @param {IRaukkMapLane[]} lanes Aggregated lanes
 * @param {IRaukkCapacityHull} hull Cargo bay
 * @returns {number} Days per visit, whole, capped at the slider maximum
 */
export function raukkCapacityMaxCadenceDays(
	lanes: IRaukkMapLane[],
	hull: IRaukkCapacityHull
): number {
	const moving: IRaukkMapLane[] = lanes.filter(
		(lane) => lane.weightPerDay > 0 || lane.volumePerDay > 0
	);

	if (moving.length === 0) return RAUKK_CAPACITY_MAX_DAYS;

	const limit: number = moving.reduce((smallest, lane) => {
		const byWeight: number =
			lane.weightPerDay > 0
				? hull.cargoWeight / lane.weightPerDay
				: Infinity;
		const byVolume: number =
			lane.volumePerDay > 0
				? hull.cargoVolume / lane.volumePerDay
				: Infinity;

		return Math.min(smallest, byWeight, byVolume);
	}, Infinity);

	if (!Number.isFinite(limit)) return RAUKK_CAPACITY_MAX_DAYS;

	return Math.min(Math.floor(limit), RAUKK_CAPACITY_MAX_DAYS);
}
