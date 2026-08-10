import { describe, expect, it } from "vitest";

// Calculations
import {
	buildTransportRows,
	raukkPairIdentity,
} from "@/features/raukk_sourcing/calculations/shippingDisplay";
import {
	raukkCxPairKey,
	raukkSourcingPairKey,
} from "@/features/raukk_sourcing/calculations/shippingPairs";

// Types & Interfaces
import { IRaukkShippingConfig } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkSnapshot,
	IRaukkSnapshotLane,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkTransportRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "test",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

const PAIR_KEY: string = raukkSourcingPairKey("consumer", "source");

/** One frozen leg, the fields the transport table reads */
function lane(patch: Partial<IRaukkSnapshotLane> = {}): IRaukkSnapshotLane {
	return {
		pairKey: PAIR_KEY,
		bucket: "production",
		shipTypeId: "test",
		visitDays: 2,
		tripsPerDay: 0.5,
		roundTripMinutes: 600,
		hired: false,
		damagePerTrip: 0.1,
		ownCostPerTrip: 200,
		ownDamagePerTrip: 0.1,
		unitsPerDay: 500,
		...patch,
	};
}

/** One stored snapshot owning the given lanes */
function snapshot(
	lanes: IRaukkSnapshotLane[],
	stale: boolean = false
): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale,
		planName: "Consumer",
		planetNaturalId: "ZV-759c",
		outputs: {},
		draws: {},
		lanes,
	};
}

describe("raukk shipping display helpers", () => {
	describe("raukkPairIdentity", () => {
		it("reads a sourcing pair key", () => {
			expect(
				raukkPairIdentity(raukkSourcingPairKey("consumer", "source"))
			).toStrictEqual({
				kind: "sourcing",
				planUuid: "consumer",
				sourcePlanUuid: "source",
			});
		});

		it("reads the exchange pair key", () => {
			expect(raukkPairIdentity(raukkCxPairKey("plan"))).toStrictEqual({
				kind: "cx",
				planUuid: "plan",
				sourcePlanUuid: undefined,
			});
		});

		it("degrades a key without a separator", () => {
			expect(raukkPairIdentity("plain")).toStrictEqual({
				kind: "sourcing",
				planUuid: "plain",
				sourcePlanUuid: undefined,
			});
		});
	});

	describe("buildTransportRows", () => {
		it("prices the own fleet per trip and per unit", () => {
			const [row] = buildTransportRows(
				{ consumer: snapshot([lane()]) },
				config,
				0
			);

			expect(row.ownCostPerTrip).toBe(200);
			expect(row.tripsPerDay).toBe(0.5);
			expect(row.unitsPerDay).toBe(500);
			// 0.5 trips a day at 200 ȼ over 500 units
			expect(row.ownCostPerUnit).toBeCloseTo(0.2, 10);
			expect(row.lmRatePerTrip).toBeUndefined();
			expect(row.hiredCostPerUnit).toBeUndefined();
			expect(row.differencePerUnit).toBeUndefined();
			expect(row.identity.planUuid).toBe("consumer");
			expect(row.hired).toBe(false);
			expect(row.stale).toBe(false);
		});

		it("states the own fleet wear of the lane", () => {
			const [row] = buildTransportRows(
				{ consumer: snapshot([lane()]) },
				config,
				800
			);

			expect(row.ownWear?.damagePerTrip).toBeCloseTo(0.1, 10);
			// 0.2 damage budget over 0.1 a trip, at 0.5 trips a day
			expect(row.ownWear?.tripsUntilRepair).toBeCloseTo(2, 10);
			expect(row.ownWear?.daysUntilRepair).toBeCloseTo(4, 10);
			expect(row.ownWear?.repairCostPerTrip).toBeCloseTo(400, 10);
		});

		it("compares a hired rate against the own fleet", () => {
			const [row] = buildTransportRows(
				{ consumer: snapshot([lane({ hired: true })]) },
				{ ...config, lmRates: { [PAIR_KEY]: 100 } },
				0
			);

			expect(row.hired).toBe(true);
			expect(row.lmRatePerTrip).toBe(100);
			expect(row.hiredCostPerUnit).toBeCloseTo(0.1, 10);
			// hired 0.1 minus own 0.2: the ad runs half as dear
			expect(row.differencePerUnit).toBeCloseTo(-0.1, 10);
		});

		it("reports a positive difference when hiring is dearer", () => {
			const [row] = buildTransportRows(
				{ consumer: snapshot([lane()]) },
				{ ...config, lmRates: { [PAIR_KEY]: 1000 } },
				0
			);

			expect(row.differencePerUnit).toBeGreaterThan(0);
		});

		it("still states the own cost of a hired lane", () => {
			// the comparison is what hiring buys, so the counterfactual
			// has to survive being hired
			const [row] = buildTransportRows(
				{ consumer: snapshot([lane({ hired: true, damagePerTrip: 0 })]) },
				{ ...config, lmRates: { [PAIR_KEY]: 100 } },
				800
			);

			expect(row.ownCostPerTrip).toBe(200);
			expect(row.ownWear?.damagePerTrip).toBeCloseTo(0.1, 10);
		});

		it("trip weights the own cost over legs flying different hulls", () => {
			const rows: IRaukkTransportRow[] = buildTransportRows(
				{
					consumer: snapshot([
						lane({
							bucket: "production",
							tripsPerDay: 0.5,
							ownCostPerTrip: 200,
							unitsPerDay: 400,
							roundTripMinutes: 600,
						}),
						lane({
							bucket: "workforce",
							shipTypeId: "big",
							tripsPerDay: 1.5,
							ownCostPerTrip: 400,
							unitsPerDay: 600,
							roundTripMinutes: 200,
						}),
					]),
				},
				config,
				0
			);

			expect(rows).toHaveLength(1);
			expect(rows[0].tripsPerDay).toBe(2);
			expect(rows[0].unitsPerDay).toBe(1000);
			// (0.5 * 200 + 1.5 * 400) / 2
			expect(rows[0].ownCostPerTrip).toBeCloseTo(350, 10);
			// (0.5 * 600 + 1.5 * 200) / 2
			expect(rows[0].roundTripMinutes).toBeCloseTo(300, 10);
			expect(rows[0].legs.map((leg) => leg.bucket)).toStrictEqual([
				"production",
				"workforce",
			]);
			expect(rows[0].legs[1].shipTypeId).toBe("big");
		});

		it("reports a figure the snapshot never froze as unknown", () => {
			// a zero would read as free freight and make the whole
			// hired rate look like a surcharge
			const [row] = buildTransportRows(
				{
					consumer: snapshot([
						lane({
							ownCostPerTrip: undefined,
							ownDamagePerTrip: undefined,
							unitsPerDay: undefined,
						}),
					]),
				},
				{ ...config, lmRates: { [PAIR_KEY]: 100 } },
				0
			);

			expect(row.ownCostPerTrip).toBeUndefined();
			expect(row.ownCostPerUnit).toBeUndefined();
			expect(row.unitsPerDay).toBeUndefined();
			expect(row.ownWear).toBeUndefined();
			expect(row.hiredCostPerUnit).toBeUndefined();
			expect(row.differencePerUnit).toBeUndefined();
			// the rate itself was entered, not frozen, so it survives
			expect(row.lmRatePerTrip).toBe(100);
		});

		it("holds a whole lane unknown when one leg predates the figure", () => {
			const [row] = buildTransportRows(
				{
					consumer: snapshot([
						lane({ ownCostPerTrip: 200 }),
						lane({
							bucket: "workforce",
							ownCostPerTrip: undefined,
						}),
					]),
				},
				config,
				0
			);

			expect(row.ownCostPerTrip).toBeUndefined();
		});

		it("degrades a lane frozen before the cadence model", () => {
			const [row] = buildTransportRows(
				{
					consumer: snapshot([
						lane({ bucket: undefined, visitDays: undefined }),
					]),
				},
				config,
				0
			);

			expect(row.legs[0].bucket).toBeNull();
			expect(row.legs[0].visitDays).toBeNull();
		});

		it("carries the staleness of the snapshot holding the lane", () => {
			const [row] = buildTransportRows(
				{ consumer: snapshot([lane()], true) },
				config,
				0
			);

			expect(row.stale).toBe(true);
		});

		it("reads the exchange lane of a plan", () => {
			const [row] = buildTransportRows(
				{
					plan: snapshot([lane({ pairKey: raukkCxPairKey("plan") })]),
				},
				config,
				0
			);

			expect(row.identity.kind).toBe("cx");
			expect(row.identity.planUuid).toBe("plan");
		});

		it("lists the lanes of every plan, ordered stably", () => {
			const rows: IRaukkTransportRow[] = buildTransportRows(
				{
					b: snapshot([lane({ pairKey: "b>source" })]),
					a: snapshot([lane({ pairKey: "a>source" })]),
				},
				config,
				0
			);

			expect(rows.map((row) => row.pairKey)).toStrictEqual([
				"a>source",
				"b>source",
			]);
		});

		it("reads a snapshot without any stored lanes as none", () => {
			expect(
				buildTransportRows({ consumer: snapshot([]) }, config, 0)
			).toStrictEqual([]);
			expect(buildTransportRows({}, config, 0)).toStrictEqual([]);
		});
	});
});
