import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkBaseChainRows,
	raukkBaseLaneRows,
	raukkChainTouchesBase,
	raukkParsePairKey,
} from "@/features/raukk_sourcing/calculations/shippingBaseScope";
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";

// Types & Interfaces
import {
	IRaukkBaseChainRow,
	IRaukkBaseLaneRow,
} from "@/features/raukk_sourcing/calculations/shippingBaseScope.types";
import {
	IRaukkChain,
	IRaukkChainCosting,
	IRaukkChainResult,
	IRaukkSnapshot,
	IRaukkSnapshotLane,
} from "@/features/raukk_sourcing/raukkSourcing.types";

const STOP_NAMES: Record<string, string> = {
	"ZV-759c": "Extractor",
	ANT: "Smelter",
};

function lane(overrides: Partial<IRaukkSnapshotLane> = {}): IRaukkSnapshotLane {
	return {
		pairKey: "p1>p2",
		bucket: "production",
		shipTypeId: "3000x1000-standard",
		visitDays: 4,
		tripsPerDay: 0.25,
		roundTripMinutes: 480,
		hired: false,
		...overrides,
	};
}

function snapshot(
	planetNaturalId: string,
	lanes: IRaukkSnapshotLane[] | undefined
): IRaukkSnapshot {
	return {
		computedAt: "2026-08-08T00:00:00.000Z",
		stale: false,
		planName: `Plan ${planetNaturalId}`,
		planetNaturalId,
		outputs: {},
		draws: {},
		lanes,
	};
}

function costing(stops: string[]): IRaukkChainCosting {
	return {
		stops,
		tripsPerDay: 0.5,
		roundTripMinutes: 240,
		bindingLegIndex: 0,
		dailyCost: 100,
		shippingFraction: 0.08,
	};
}

function chainResult(
	overrides: Partial<IRaukkChainResult> = {}
): IRaukkChainResult {
	return {
		chainId: "c1",
		computedAt: "2026-08-08T00:00:00.000Z",
		stale: false,
		profileId: "3000x1000-standard",
		hired: false,
		splitApplied: false,
		unsplit: costing(["ZV-759c", "ANT"]),
		split: [],
		splitTrigger: null,
		tripsPerDay: 0.5,
		roundTripMinutes: 240,
		bindingLegIndex: 0,
		dailyCost: 100,
		shippingFraction: 0.08,
		shipMinutesPerDay: 120,
		flows: [],
		perUnit: {},
		memberPlanUuids: ["p1"],
		config: raukkDefaultChainConfig(),
		advisories: [],
		...overrides,
	};
}

describe("Raukk Shipping: Base Scope", () => {
	describe("raukkParsePairKey", () => {
		it("splits a sourcing pair into owner and counterpart", () => {
			expect(raukkParsePairKey("p1>p2")).toStrictEqual({
				ownerPlanUuid: "p1",
				counterpartPlanUuid: "p2",
			});
		});

		it("reads the exchange lane as having no counterpart plan", () => {
			expect(raukkParsePairKey("p1>CX")).toStrictEqual({
				ownerPlanUuid: "p1",
				counterpartPlanUuid: null,
			});
		});

		it("keeps a plan named CX apart from the exchange suffix", () => {
			// the suffix test is on the WHOLE key, so only the exact
			// `raukkCxPairKey` shape reads as the exchange lane
			expect(raukkParsePairKey("CX>p2")).toStrictEqual({
				ownerPlanUuid: "CX",
				counterpartPlanUuid: "p2",
			});
		});

		it("treats a key without a separator as owner only", () => {
			expect(raukkParsePairKey("p1")).toStrictEqual({
				ownerPlanUuid: "p1",
				counterpartPlanUuid: null,
			});
		});
	});

	describe("raukkBaseLaneRows", () => {
		const snapshots: Record<string, IRaukkSnapshot> = {
			p1: snapshot("ZV-759c", [
				lane({ pairKey: "p1>p2" }),
				lane({ pairKey: "p1>CX", bucket: "workforce" }),
			]),
			p2: snapshot("ANT", [lane({ pairKey: "p2>CX" })]),
			p3: snapshot("XY-123a", [
				lane({ pairKey: "p3>p1", hired: true }),
				lane({ pairKey: "p3>p2" }),
			]),
		};

		it("lists the lanes the base owns", () => {
			const rows: IRaukkBaseLaneRow[] = raukkBaseLaneRows(
				"p2",
				snapshots
			);

			expect(rows.map((row) => row.pairKey)).toEqual([
				"p2>CX",
				"p1>p2",
				"p3>p2",
			]);
		});

		it("flags ownership per row, owned lanes first", () => {
			const rows: IRaukkBaseLaneRow[] = raukkBaseLaneRows(
				"p1",
				snapshots
			);

			expect(rows.map((row) => [row.pairKey, row.owned])).toEqual([
				["p1>p2", true],
				["p1>CX", true],
				["p3>p1", false],
			]);
		});

		it("keeps the stored figures untouched, hired included", () => {
			const rows: IRaukkBaseLaneRow[] = raukkBaseLaneRows(
				"p1",
				snapshots
			);
			const foreign: IRaukkBaseLaneRow = rows.find(
				(row) => row.pairKey === "p3>p1"
			)!;

			expect(foreign).toStrictEqual({
				pairKey: "p3>p1",
				ownerPlanUuid: "p3",
				counterpartPlanUuid: "p1",
				owned: false,
				bucket: "production",
				shipTypeId: "3000x1000-standard",
				visitDays: 4,
				tripsPerDay: 0.25,
				roundTripMinutes: 480,
				hired: true,
			});
		});

		it("never lists another base's exchange lane", () => {
			const rows: IRaukkBaseLaneRow[] = raukkBaseLaneRows(
				"p1",
				snapshots
			);

			expect(rows.map((row) => row.pairKey)).not.toContain("p2>CX");
		});

		it("lists nothing for a base no lane touches", () => {
			expect(raukkBaseLaneRows("p9", snapshots)).toEqual([]);
		});

		it("survives snapshots without lanes and empty stores", () => {
			expect(
				raukkBaseLaneRows("p1", { p1: snapshot("ZV-759c", undefined) })
			).toEqual([]);
			expect(raukkBaseLaneRows("p1", {})).toEqual([]);
		});

		it("reads pre cadence lanes with null bucket and visit days", () => {
			const rows: IRaukkBaseLaneRow[] = raukkBaseLaneRows("p1", {
				p1: snapshot("ZV-759c", [
					lane({
						pairKey: "p1>CX",
						bucket: undefined,
						visitDays: undefined,
					}),
				]),
			});

			expect(rows[0].bucket).toBeNull();
			expect(rows[0].visitDays).toBeNull();
		});
	});

	describe("raukkChainTouchesBase", () => {
		it("touches over the authored stops", () => {
			expect(
				raukkChainTouchesBase(
					"p1",
					"ANT",
					["ZV-759c", "ANT"],
					undefined
				)
			).toBe(true);
			expect(
				raukkChainTouchesBase(
					"p1",
					"OT-580b",
					["ZV-759c", "ANT"],
					undefined
				)
			).toBe(false);
		});

		it("touches over the computed unsplit stops", () => {
			expect(raukkChainTouchesBase("p1", "ANT", [], chainResult())).toBe(
				true
			);
		});

		it("touches over a sub chain of a split", () => {
			const result: IRaukkChainResult = chainResult({
				unsplit: costing(["OT-580b", "NC1"]),
				split: [costing(["OT-580b", "NC1"]), costing(["NC1", "ANT"])],
				memberPlanUuids: [],
			});

			expect(raukkChainTouchesBase("p1", "ANT", [], result)).toBe(true);
		});

		it("falls back to the member plan list", () => {
			const result: IRaukkChainResult = chainResult({
				unsplit: costing(["OT-580b", "NC1"]),
				memberPlanUuids: ["p1"],
			});

			expect(raukkChainTouchesBase("p1", "ANT", [], result)).toBe(true);
			expect(raukkChainTouchesBase("p2", "ANT", [], result)).toBe(false);
		});
	});

	describe("raukkBaseChainRows", () => {
		const chains: Record<string, IRaukkChain> = {
			c1: {
				chainId: "c1",
				name: "Metals",
				stops: ["ZV-759c", "ANT"],
			},
			c2: { chainId: "c2", stops: ["OT-580b", "NC1"] },
		};

		it("lists only the chains touching the base's planet", () => {
			const rows: IRaukkBaseChainRow[] = raukkBaseChainRows(
				"p1",
				"ANT",
				chains,
				{},
				STOP_NAMES
			);

			expect(rows.map((row) => row.chainId)).toEqual(["c1"]);
			expect(rows[0].stopsSummary).toBe(
				"Extractor → Smelter → Extractor"
			);
		});

		it("states an uncomputed chain as uncomputed, never as free", () => {
			const rows: IRaukkBaseChainRow[] = raukkBaseChainRows(
				"p1",
				"ANT",
				chains,
				{},
				STOP_NAMES
			);

			expect(rows[0].computed).toBe(false);
			expect(rows[0].stale).toBe(true);
			expect(rows[0].tripsPerDay).toBeNull();
			expect(rows[0].roundTripMinutes).toBeNull();
			expect(rows[0].shipTypeId).toBeNull();
		});

		it("carries the stored figures of a computed chain", () => {
			const rows: IRaukkBaseChainRow[] = raukkBaseChainRows(
				"p1",
				"ANT",
				chains,
				{ c1: chainResult({ hired: true, stale: true }) },
				STOP_NAMES
			);

			expect(rows[0]).toMatchObject({
				chainId: "c1",
				computed: true,
				stale: true,
				hired: true,
				shipTypeId: "3000x1000-standard",
				tripsPerDay: 0.5,
				roundTripMinutes: 240,
			});
		});

		it("lists a derived chain touching the base, read only tagged", () => {
			const chainId: string = "auto:production:NC1:ANT+ZV-759c";
			const rows: IRaukkBaseChainRow[] = raukkBaseChainRows(
				"p1",
				"ANT",
				{},
				{ [chainId]: chainResult({ chainId, auto: true }) },
				STOP_NAMES
			);

			expect(rows).toHaveLength(1);
			expect(rows[0].auto).toBe(true);
			expect(rows[0].computed).toBe(true);
		});

		it("skips a derived chain that misses the base", () => {
			const chainId: string = "auto:production:NC1:OT-580b";
			const rows: IRaukkBaseChainRow[] = raukkBaseChainRows(
				"p1",
				"XY-123a",
				{},
				{
					[chainId]: chainResult({
						chainId,
						auto: true,
						unsplit: costing(["OT-580b", "NC1"]),
						memberPlanUuids: ["p9"],
					}),
				},
				STOP_NAMES
			);

			expect(rows).toEqual([]);
		});

		it("lists nothing on an empty store", () => {
			expect(raukkBaseChainRows("p1", "ANT", {}, {}, STOP_NAMES)).toEqual(
				[]
			);
		});
	});
});
