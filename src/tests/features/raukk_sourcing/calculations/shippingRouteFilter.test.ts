import { describe, expect, it } from "vitest";

// Calculations
import {
	raukkFilterChainRows,
	raukkFilterTransportRows,
	raukkLaneShipTypes,
} from "@/features/raukk_sourcing/calculations/shippingRouteFilter";
import { raukkSourcingPairKey } from "@/features/raukk_sourcing/calculations/shippingPairs";

// Types & Interfaces
import { IRaukkChainListRow } from "@/features/raukk_sourcing/calculations/shippingChainDisplay";
import {
	IRaukkTransportLeg,
	IRaukkTransportRow,
} from "@/features/raukk_sourcing/calculations/shippingDisplay";

/** One frozen leg, only the fields the filter reads carry meaning */
function leg(shipTypeId: string): IRaukkTransportLeg {
	return {
		bucket: "production",
		shipTypeId,
		visitDays: 14,
		tripsPerDay: 0.07,
	};
}

/** One transport row of the given legs */
function row(
	pairKey: string,
	shipTypeIds: string[],
	hired: boolean = false
): IRaukkTransportRow {
	return {
		pairKey,
		identity: {
			planUuid: "consumer",
			sourcePlanUuid: "source",
			kind: "plan",
		},
		stale: false,
		legs: shipTypeIds.map(leg),
		tripsPerDay: 0.07,
		roundTripMinutes: 600,
		hired,
		unitsPerDay: 100,
		ownCostPerTrip: 200,
		ownCostPerUnit: 2,
		lmRatePerTrip: undefined,
		hiredCostPerUnit: undefined,
		differencePerUnit: undefined,
		ownWear: undefined,
	};
}

/** One chain list row, only its hull and hired flag matter here */
function chainRow(
	chainId: string,
	profileId: string | null,
	hired: boolean = false
): IRaukkChainListRow {
	return {
		chainId,
		name: chainId,
		stopsSummary: "A → B",
		stopCount: 2,
		computed: profileId !== null,
		stale: false,
		splitApplied: false,
		hired,
		profileId,
		tripsPerDay: 0.5,
		dailyCost: 1000,
		shippingFraction: 0.2,
		shippingFractionPercent: 20,
		over: false,
		shipDaysPerDay: 0.2,
		auto: false,
		capDays: null,
		autoReason: null,
		autoBucket: null,
	};
}

const WCB: string = "3000x1000-quick-charge";
const HCB: string = "5000x5000-quick-charge";

describe("raukkLaneShipTypes", () => {
	it("reports the distinct hulls of a lane, in leg order", () => {
		expect(
			raukkLaneShipTypes(row(raukkSourcingPairKey("a", "b"), [HCB, WCB]))
		).toStrictEqual([HCB, WCB]);
	});

	it("counts a hull flying two legs once", () => {
		expect(
			raukkLaneShipTypes(row(raukkSourcingPairKey("a", "b"), [WCB, WCB]))
		).toStrictEqual([WCB]);
	});

	it("reports nothing for a lane without legs", () => {
		expect(
			raukkLaneShipTypes(row(raukkSourcingPairKey("a", "b"), []))
		).toStrictEqual([]);
	});
});

describe("raukkFilterTransportRows", () => {
	const wcbLane: IRaukkTransportRow = row(raukkSourcingPairKey("a", "b"), [
		WCB,
	]);
	const hcbLane: IRaukkTransportRow = row(raukkSourcingPairKey("c", "d"), [
		HCB,
	]);
	const mixedLane: IRaukkTransportRow = row(raukkSourcingPairKey("e", "f"), [
		WCB,
		HCB,
	]);
	const hiredLane: IRaukkTransportRow = row(
		raukkSourcingPairKey("g", "h"),
		[WCB],
		true
	);

	const rows: IRaukkTransportRow[] = [wcbLane, hcbLane, mixedLane, hiredLane];

	it("filters nothing without a ship type", () => {
		expect(raukkFilterTransportRows(rows, null)).toStrictEqual(rows);
	});

	it("keeps the lanes one hull flies, a mixed lane included", () => {
		expect(raukkFilterTransportRows(rows, WCB)).toStrictEqual([
			wcbLane,
			mixedLane,
		]);
		expect(raukkFilterTransportRows(rows, HCB)).toStrictEqual([
			hcbLane,
			mixedLane,
		]);
	});

	it("never matches a hired lane, its hull is a comparison", () => {
		expect(raukkFilterTransportRows([hiredLane], WCB)).toStrictEqual([]);
	});

	it("returns nothing for a hull that flies no lane", () => {
		expect(
			raukkFilterTransportRows(rows, "500x500-stl-only")
		).toStrictEqual([]);
	});
});

describe("raukkFilterChainRows", () => {
	const wcbChain: IRaukkChainListRow = chainRow("wcb", WCB);
	const hcbChain: IRaukkChainListRow = chainRow("hcb", HCB);
	const uncomputed: IRaukkChainListRow = chainRow("new", null);
	const hiredChain: IRaukkChainListRow = chainRow("hired", WCB, true);

	const rows: IRaukkChainListRow[] = [
		wcbChain,
		hcbChain,
		uncomputed,
		hiredChain,
	];

	it("filters nothing without a ship type", () => {
		expect(raukkFilterChainRows(rows, null)).toStrictEqual(rows);
	});

	it("keeps the chains costed with the hull", () => {
		expect(raukkFilterChainRows(rows, WCB)).toStrictEqual([wcbChain]);
	});

	it("never matches an uncomputed or a hired chain", () => {
		expect(
			raukkFilterChainRows([uncomputed, hiredChain], WCB)
		).toStrictEqual([]);
	});
});
