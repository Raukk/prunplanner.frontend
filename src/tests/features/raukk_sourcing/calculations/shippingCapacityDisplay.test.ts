import { describe, expect, it } from "vitest";

// Calculations
import {
	IRaukkCapacityFit,
	IRaukkCapacityHull,
	IRaukkCapacityPoint,
	RAUKK_CAPACITY_MAX_DAYS,
	raukkCapacityBinding,
	raukkCapacityDrivingPoint,
	raukkCapacityFits,
	raukkCapacityHulls,
	raukkCapacityMaxCadenceDays,
	raukkCapacityPoints,
	raukkCapacityShare,
	raukkCapacitySmallestFit,
} from "@/features/raukk_sourcing/calculations/shippingCapacityDisplay";

// Types & Interfaces
import { IRaukkMapLane } from "@/features/raukk_sourcing/calculations/shippingMapDisplay";

/** One aggregated lane, everything but the overrides defaulted */
function lane(patch: Partial<IRaukkMapLane> = {}): IRaukkMapLane {
	return {
		key: "NC1>OT-580b#production",
		fromStop: "NC1",
		toStop: "OT-580b",
		bucket: "production",
		weightPerDay: 100,
		volumePerDay: 50,
		unitsPerDay: 20,
		tickers: ["RAT"],
		...patch,
	};
}

const MCB: IRaukkCapacityHull = {
	shipTypeId: "1000x1000-standard",
	bayCode: "MCB",
	cargoWeight: 1000,
	cargoVolume: 1000,
};

const WCB: IRaukkCapacityHull = {
	shipTypeId: "3000x1000-standard",
	bayCode: "WCB",
	cargoWeight: 3000,
	cargoVolume: 1000,
};

const VCB: IRaukkCapacityHull = {
	shipTypeId: "1000x3000-standard",
	bayCode: "VCB",
	cargoWeight: 1000,
	cargoVolume: 3000,
};

describe("raukkCapacityHulls", () => {
	it("offers the six in-game bays, smallest hold first", () => {
		const hulls: IRaukkCapacityHull[] = raukkCapacityHulls();

		expect(hulls).toHaveLength(6);
		expect(hulls[0].bayCode).toBe("SCB");
		expect(hulls[hulls.length - 1].bayCode).toBe("HCB");
	});

	it("names every bay with its in-game code", () => {
		expect(
			raukkCapacityHulls().every((hull) => hull.bayCode !== undefined)
		).toBe(true);
	});
});

describe("raukkCapacityPoints", () => {
	it("multiplies the daily amount by the days between visits", () => {
		const points: IRaukkCapacityPoint[] = raukkCapacityPoints([lane()], 7);

		expect(points[0].weightPerTrip).toBe(700);
		expect(points[0].volumePerTrip).toBe(350);
	});

	it("scales linearly with the cadence — the whole model", () => {
		const seven: IRaukkCapacityPoint[] = raukkCapacityPoints([lane()], 7);
		const fourteen: IRaukkCapacityPoint[] = raukkCapacityPoints(
			[lane()],
			14
		);

		expect(fourteen[0].weightPerTrip).toBe(seven[0].weightPerTrip * 2);
	});

	it("drops a lane carrying nothing", () => {
		expect(
			raukkCapacityPoints([lane({ weightPerDay: 0, volumePerDay: 0 })], 7)
		).toStrictEqual([]);
	});

	it("treats a negative cadence as zero rather than inverting cargo", () => {
		expect(raukkCapacityPoints([lane()], -5)[0].weightPerTrip).toBe(0);
	});

	it("states the binding dimension of each point", () => {
		expect(raukkCapacityPoints([lane()], 7)[0].binding).toBe("weight");
		expect(
			raukkCapacityPoints([lane({ volumePerDay: 400 })], 7)[0].binding
		).toBe("volume");
	});
});

describe("raukkCapacityBinding", () => {
	it("calls a denser than 1 t/m³ cargo weight bound", () => {
		expect(raukkCapacityBinding(100, 50)).toBe("weight");
	});

	it("calls a lighter cargo volume bound", () => {
		expect(raukkCapacityBinding(50, 100)).toBe("volume");
	});

	it("resolves an exact tie to weight", () => {
		expect(raukkCapacityBinding(100, 100)).toBe("weight");
	});
});

describe("raukkCapacityShare", () => {
	it("takes the larger of both dimensions", () => {
		expect(raukkCapacityShare(MCB, 500, 900)).toBeCloseTo(0.9, 10);
	});

	it("does not cap a shipment needing more than one trip", () => {
		expect(raukkCapacityShare(MCB, 1800, 100)).toBeCloseTo(1.8, 10);
	});
});

describe("raukkCapacitySmallestFit", () => {
	it("picks the tightest bay that still carries the shipment", () => {
		expect(
			raukkCapacitySmallestFit(raukkCapacityHulls(), 400, 400)!.bayCode
		).toBe("SCB");
	});

	it("picks a weight shaped bay for a dense shipment", () => {
		expect(
			raukkCapacitySmallestFit([MCB, WCB, VCB], 2500, 900)!.bayCode
		).toBe("WCB");
	});

	it("picks a volume shaped bay for a bulky one", () => {
		expect(
			raukkCapacitySmallestFit([MCB, WCB, VCB], 900, 2500)!.bayCode
		).toBe("VCB");
	});

	it("is null when nothing carries it whole", () => {
		expect(
			raukkCapacitySmallestFit(raukkCapacityHulls(), 99000, 99000)
		).toBeNull();
	});
});

describe("raukkCapacityFits", () => {
	const points: IRaukkCapacityPoint[] = raukkCapacityPoints(
		[
			lane({ key: "a", weightPerDay: 100, volumePerDay: 50 }),
			lane({ key: "b", weightPerDay: 400, volumePerDay: 20 }),
		],
		7
	);

	it("counts what fits and what overflows", () => {
		const fit: IRaukkCapacityFit = raukkCapacityFits(points, [MCB])[0];

		// 700 t and 2 800 t against a 1 000 t hold
		expect(fit.fitting).toBe(1);
		expect(fit.overflowing).toBe(1);
		expect(fit.fitsAll).toBe(false);
	});

	it("reports fitsAll and the worst fitting share when all fit", () => {
		const fit: IRaukkCapacityFit = raukkCapacityFits(points, [
			{ ...MCB, cargoWeight: 5000, cargoVolume: 5000 },
		])[0];

		expect(fit.fitsAll).toBe(true);
		expect(fit.overflowing).toBe(0);
		expect(fit.worstFittingShare).toBeCloseTo(2800 / 5000, 10);
	});

	it("does not claim fitsAll without any lane at all", () => {
		expect(raukkCapacityFits([], [MCB])[0].fitsAll).toBe(false);
	});

	it("leaves the worst share null when nothing fits", () => {
		expect(
			raukkCapacityFits(points, [
				{ ...MCB, cargoWeight: 1, cargoVolume: 1 },
			])[0].worstFittingShare
		).toBeNull();
	});
});

describe("raukkCapacityMaxCadenceDays", () => {
	it("inverts the hold against the daily amount", () => {
		// 1 000 t hold, 100 t/day, 50 m³/day against 1 000 m³ -> 10 days
		expect(raukkCapacityMaxCadenceDays([lane()], MCB)).toBe(10);
	});

	it("is bound by the tighter of weight and volume", () => {
		expect(
			raukkCapacityMaxCadenceDays(
				[lane({ weightPerDay: 10, volumePerDay: 500 })],
				MCB
			)
		).toBe(2);
	});

	it("takes the tightest lane of several", () => {
		expect(
			raukkCapacityMaxCadenceDays(
				[lane({ key: "a" }), lane({ key: "b", weightPerDay: 500 })],
				MCB
			)
		).toBe(2);
	});

	it("returns whole days, never a fraction of a visit", () => {
		expect(
			Number.isInteger(
				raukkCapacityMaxCadenceDays([lane({ weightPerDay: 300 })], MCB)
			)
		).toBe(true);
	});

	it("caps at the slider maximum when nothing constrains it", () => {
		expect(raukkCapacityMaxCadenceDays([], MCB)).toBe(
			RAUKK_CAPACITY_MAX_DAYS
		);
		expect(
			raukkCapacityMaxCadenceDays(
				[lane({ weightPerDay: 0, volumePerDay: 0 })],
				MCB
			)
		).toBe(RAUKK_CAPACITY_MAX_DAYS);
	});

	it("is zero when even a single day overflows the hold", () => {
		expect(
			raukkCapacityMaxCadenceDays([lane({ weightPerDay: 5000 })], MCB)
		).toBe(0);
	});
});

describe("raukkCapacityDrivingPoint", () => {
	/** One placed lane, everything but the overrides defaulted */
	function point(
		patch: Partial<IRaukkCapacityPoint> = {}
	): IRaukkCapacityPoint {
		return {
			key: "a",
			fromStop: "NC1",
			toStop: "OT-580b",
			bucket: "production",
			weightPerTrip: 100,
			volumePerTrip: 100,
			binding: "weight",
			tickers: ["RAT"],
			...patch,
		};
	}

	// smallest hold first, the order the plane hands them over in
	const HULLS: IRaukkCapacityHull[] = [MCB, VCB, WCB];

	it("names the lane needing the biggest bay", () => {
		const driving = raukkCapacityDrivingPoint(
			[
				point({ key: "small", weightPerTrip: 10, volumePerTrip: 10 }),
				point({
					key: "wide",
					weightPerTrip: 2500,
					volumePerTrip: 100,
				}),
			],
			HULLS
		);

		expect(driving!.key).toBe("wide");
	});

	it("ranks a lane fitting no bay above every lane that fits one", () => {
		const driving = raukkCapacityDrivingPoint(
			[
				point({
					key: "biggest-fitting",
					weightPerTrip: 2900,
					volumePerTrip: 900,
				}),
				point({
					key: "fits-nothing",
					weightPerTrip: 9000,
					volumePerTrip: 9000,
				}),
			],
			HULLS
		);

		expect(driving!.key).toBe("fits-nothing");
	});

	it("breaks a tie on the share of the largest bay", () => {
		const driving = raukkCapacityDrivingPoint(
			[
				point({
					key: "lighter",
					weightPerTrip: 400,
					volumePerTrip: 400,
				}),
				point({
					key: "heavier",
					weightPerTrip: 900,
					volumePerTrip: 900,
				}),
			],
			HULLS
		);

		expect(driving!.key).toBe("heavier");
	});

	it("is null without lanes or without bays", () => {
		expect(raukkCapacityDrivingPoint([], HULLS)).toBeNull();
		expect(raukkCapacityDrivingPoint([point()], [])).toBeNull();
	});

	it("leaves the caller's array alone", () => {
		const points: IRaukkCapacityPoint[] = [
			point({ key: "small", weightPerTrip: 10, volumePerTrip: 10 }),
			point({ key: "wide", weightPerTrip: 2500, volumePerTrip: 100 }),
		];

		raukkCapacityDrivingPoint(points, HULLS);

		expect(points.map((entry) => entry.key)).toStrictEqual([
			"small",
			"wide",
		]);
	});
});
