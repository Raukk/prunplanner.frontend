import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkBayCode,
	raukkFleetAdvisoryRows,
	raukkFleetRows,
	raukkFleetSpilloverRows,
	raukkShipTypeOptions,
	raukkSpilloverBarWidths,
	raukkUtilizationBarWidth,
} from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
import { raukkFleetSpillover } from "@/features/raukk_sourcing/calculations/shippingFleetSpillover";
import {
	raukkShipProfilePreset,
	raukkShipProfilePresets,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkFleetAdvisory,
	IRaukkShipProfile,
} from "@/features/raukk_sourcing/calculations/shipping.types";
import { IRaukkFleetUtilization } from "@/features/raukk_sourcing/calculations/shippingFleet";

function profileOf(shipTypeId: string): IRaukkShipProfile {
	const found: IRaukkShipProfile | undefined = raukkShipProfilePresets().find(
		(profile) => profile.id === shipTypeId
	);

	return (
		found ??
		raukkShipProfilePreset(
			{ cargoWeight: 500, cargoVolume: 500 },
			"standard"
		)
	);
}

describe("Raukk Shipping: Fleet Display", () => {
	describe("raukkBayCode", () => {
		it("maps every hull of the user's authoritative table", () => {
			expect(raukkBayCode(500, 500)).toBe("SCB");
			expect(raukkBayCode(1000, 1000)).toBe("MCB");
			expect(raukkBayCode(2000, 2000)).toBe("LCB");
			expect(raukkBayCode(5000, 5000)).toBe("HCB");
			expect(raukkBayCode(3000, 1000)).toBe("WCB");
			expect(raukkBayCode(1000, 3000)).toBe("VCB");
		});

		it("has no code for a hull the game does not ship", () => {
			expect(raukkBayCode(250, 250)).toBeUndefined();
		});
	});

	describe("raukkShipTypeOptions", () => {
		it("offers every hull times both reactor flags, all with a bay", () => {
			const options = raukkShipTypeOptions();

			expect(options).toHaveLength(12);
			expect(
				options.every((option) => option.bayCode !== undefined)
			).toBe(true);
			expect(new Set(options.map((o) => o.shipTypeId)).size).toBe(12);
		});
	});

	describe("raukkFleetRows", () => {
		it("dresses a utilized type with its bay code and percentage", () => {
			const utilization: IRaukkFleetUtilization[] = [
				{
					shipTypeId: "3000x1000-standard",
					count: 2,
					designName: "FSE_WCB_QCR",
					shipMinutesPerDay: 1440,
					utilization: 0.5,
					keys: ["a>CX", "chain:c1"],
				},
			];

			const [row] = raukkFleetRows(utilization, profileOf);

			expect(row.bayCode).toBe("WCB");
			expect(row.cargoWeight).toBe(3000);
			expect(row.designName).toBe("FSE_WCB_QCR");
			expect(row.count).toBe(2);
			expect(row.utilizationPercent).toBe(50);
			expect(row.over).toBe(false);
			expect(row.assignedCount).toBe(2);
		});

		it("flags an over-rationed type without clamping it", () => {
			const [row] = raukkFleetRows(
				[
					{
						shipTypeId: "5000x5000-quick-charge",
						count: 1,
						designName: undefined,
						shipMinutesPerDay: 1930,
						utilization: 1.34,
						keys: [],
					},
				],
				profileOf
			);

			expect(row.over).toBe(true);
			expect(row.utilizationPercent).toBeCloseTo(134);
			expect(row.designName).toBe("");
		});

		it("does not flag a hair over one as over-rationed", () => {
			const [row] = raukkFleetRows(
				[
					{
						shipTypeId: "5000x5000-quick-charge",
						count: 1,
						designName: undefined,
						shipMinutesPerDay: 1444,
						utilization: 1.005,
						keys: [],
					},
				],
				profileOf
			);

			expect(row.over).toBe(false);
		});

		// a type the fleet holds but has no hull of, count 0: no
		// denominator, so the rollup reports null and the row keeps it
		it("carries a null utilization through as null", () => {
			const [row] = raukkFleetRows(
				[
					{
						shipTypeId: "2000x2000-standard",
						count: 0,
						designName: undefined,
						shipMinutesPerDay: 720,
						utilization: null,
						keys: ["a>CX"],
					},
				],
				profileOf
			);

			expect(row.utilization).toBeNull();
			expect(row.utilizationPercent).toBeNull();
			expect(row.over).toBe(false);
		});
	});

	describe("raukkFleetAdvisoryRows", () => {
		function advisory(
			overrides: Partial<IRaukkFleetAdvisory> = {}
		): IRaukkFleetAdvisory {
			return {
				pairKey: "p1>CX",
				bucket: "production",
				shipTypeId: "1000x1000-standard",
				tripsPerDay: 2,
				suggestedShipTypeId: "5000x5000-standard",
				suggestedTripsPerDay: 0.4,
				...overrides,
			};
		}

		it("states one advised swap with its trip comparison", () => {
			const [row] = raukkFleetAdvisoryRows([advisory()]);

			expect(row.shipTypeId).toBe("1000x1000-standard");
			expect(row.suggestedShipTypeId).toBe("5000x5000-standard");
			expect(row.tripsPerDay).toBe(2);
			expect(row.suggestedTripsPerDay).toBe(0.4);
			expect(row.assignmentCount).toBe(1);
		});

		it("states both rates as days per visit, the readable comparison", () => {
			const [row] = raukkFleetAdvisoryRows([advisory()]);

			expect(row.visitDays).toBe(0.5);
			expect(row.suggestedVisitDays).toBe(2.5);
		});

		it("separates the two intervals at a quarterly repair cadence", () => {
			const [row] = raukkFleetAdvisoryRows([
				advisory({
					tripsPerDay: 1 / 90,
					suggestedTripsPerDay: 1 / 143,
				}),
			]);

			expect(row.visitDays).toBeCloseTo(90, 10);
			expect(row.suggestedVisitDays).toBeCloseTo(143, 10);
		});

		it("has no interval where a rate states none", () => {
			const [row] = raukkFleetAdvisoryRows([
				advisory({ tripsPerDay: 0, suggestedTripsPerDay: 0.4 }),
			]);

			expect(row.visitDays).toBeNull();
			expect(row.suggestedVisitDays).toBe(2.5);
		});

		it("advises nothing where neither side states an interval", () => {
			expect(
				raukkFleetAdvisoryRows([
					advisory({ tripsPerDay: 0, suggestedTripsPerDay: 0 }),
				])
			).toStrictEqual([]);
		});

		it("drops the swap that promises the very same cadence", () => {
			const rows = raukkFleetAdvisoryRows([
				advisory({
					suggestedShipTypeId: "1000x3000-standard",
					tripsPerDay: 1 / 30,
					suggestedTripsPerDay: 1 / 30,
				}),
				advisory({ tripsPerDay: 1 / 30, suggestedTripsPerDay: 1 / 45 }),
			]);

			expect(rows.map((row) => row.suggestedShipTypeId)).toStrictEqual([
				"5000x5000-standard",
			]);
			expect(rows[0].visitDays).toBeCloseTo(30, 10);
			expect(rows[0].suggestedVisitDays).toBeCloseTo(45, 10);
		});

		it("counts the very same advisory only once", () => {
			const rows = raukkFleetAdvisoryRows([advisory(), advisory()]);

			expect(rows).toHaveLength(1);
			expect(rows[0].assignmentCount).toBe(1);
		});

		it("counts one assignment per lane and cargo bucket", () => {
			const rows = raukkFleetAdvisoryRows([
				advisory(),
				advisory({ bucket: "workforce", tripsPerDay: 1 }),
				advisory({ pairKey: "p2>CX", tripsPerDay: 1 }),
			]);

			expect(rows).toHaveLength(1);
			expect(rows[0].assignmentCount).toBe(3);
		});

		it("keeps the worst affected assignment of a rolled up advice", () => {
			const [row] = raukkFleetAdvisoryRows([
				advisory({ tripsPerDay: 1, suggestedTripsPerDay: 0.2 }),
				advisory({
					pairKey: "p2>CX",
					tripsPerDay: 6,
					suggestedTripsPerDay: 1.2,
				}),
				advisory({
					pairKey: "p3>CX",
					tripsPerDay: 3,
					suggestedTripsPerDay: 0.6,
				}),
			]);

			expect(row.tripsPerDay).toBe(6);
			expect(row.suggestedTripsPerDay).toBe(1.2);
			expect(row.visitDays).toBeCloseTo(1 / 6, 10);
			expect(row.suggestedVisitDays).toBeCloseTo(1 / 1.2, 10);
		});

		it("keeps two different swaps apart, ordered by ship type", () => {
			const rows = raukkFleetAdvisoryRows([
				advisory({
					shipTypeId: "3000x1000-standard",
					suggestedShipTypeId: "5000x5000-standard",
				}),
				advisory({ suggestedShipTypeId: "1000x3000-standard" }),
				advisory(),
			]);

			expect(
				rows.map(
					(row) => `${row.shipTypeId}>${row.suggestedShipTypeId}`
				)
			).toStrictEqual([
				"1000x1000-standard>1000x3000-standard",
				"1000x1000-standard>5000x5000-standard",
				"3000x1000-standard>5000x5000-standard",
			]);
		});

		it("advises nothing when nothing was raised", () => {
			expect(raukkFleetAdvisoryRows([])).toStrictEqual([]);
		});
	});

	describe("raukkUtilizationBarWidth", () => {
		it("caps the bar while the number stays honest", () => {
			expect(raukkUtilizationBarWidth(0.25)).toBe(25);
			expect(raukkUtilizationBarWidth(1.34)).toBe(100);
			expect(raukkUtilizationBarWidth(-1)).toBe(0);
			expect(raukkUtilizationBarWidth(null)).toBe(0);
			expect(raukkUtilizationBarWidth(Infinity)).toBe(0);
		});
	});

	describe("raukkFleetSpilloverRows", () => {
		const MINUTES_PER_DAY: number = 24 * 60;

		/** Utilization fixture of one preset ship type */
		function utilizationOf(
			shipTypeId: string,
			count: number,
			shipMinutesPerDay: number
		): IRaukkFleetUtilization {
			return {
				shipTypeId,
				count,
				designName: undefined,
				shipMinutesPerDay,
				utilization:
					count > 0
						? shipMinutesPerDay / (MINUTES_PER_DAY * count)
						: null,
				keys: [],
			};
		}

		it("prints the donors residual over a full bar", () => {
			// HCB is 50% over, LCB absorbs a fifth of the overflow
			const utilization: IRaukkFleetUtilization[] = [
				utilizationOf(
					"5000x5000-quick-charge",
					1,
					MINUTES_PER_DAY * 1.5
				),
				utilizationOf(
					"2000x2000-standard",
					1,
					MINUTES_PER_DAY - 0.1 * MINUTES_PER_DAY
				),
			];

			const [donor, recipient] = raukkFleetSpilloverRows(
				raukkFleetRows(utilization, profileOf),
				raukkFleetSpillover(utilization)
			);

			expect(donor.spill?.ownPercent).toBe(100);
			expect(donor.spill?.spilledInPercent).toBe(0);
			// 50 points over, 10 absorbed: 140 stays on the donor, red
			expect(donor.spill?.printedPercent).toBeCloseTo(140, 8);
			expect(donor.spill?.over).toBe(true);
			expect(donor.spill?.received).toBe(false);

			expect(recipient.spill?.ownPercent).toBeCloseTo(90, 8);
			expect(recipient.spill?.spilledInPercent).toBeCloseTo(10, 8);
			expect(recipient.spill?.printedPercent).toBeCloseTo(100, 8);
			expect(recipient.spill?.over).toBe(false);
			expect(recipient.spill?.received).toBe(true);
		});

		it("prints a fully relieved donor at 100 without the red", () => {
			const utilization: IRaukkFleetUtilization[] = [
				utilizationOf(
					"5000x5000-quick-charge",
					1,
					MINUTES_PER_DAY * 1.2
				),
				utilizationOf("2000x2000-standard", 1, 0),
			];

			const [donor] = raukkFleetSpilloverRows(
				raukkFleetRows(utilization, profileOf),
				raukkFleetSpillover(utilization)
			);

			expect(donor.spill?.printedPercent).toBeCloseTo(100, 8);
			expect(donor.spill?.over).toBe(false);
			// the base row keeps its uncapped reading, only the overlay
			// states the residual
			expect(donor.utilizationPercent).toBeCloseTo(120, 8);
			expect(donor.over).toBe(true);
		});

		it("carries a count-0 row through without an overlay", () => {
			const utilization: IRaukkFleetUtilization[] = [
				utilizationOf("5000x5000-quick-charge", 0, 5000),
			];

			const [row] = raukkFleetSpilloverRows(
				raukkFleetRows(utilization, profileOf),
				raukkFleetSpillover(utilization)
			);

			expect(row.spill).toBeUndefined();
			expect(row.utilizationPercent).toBeNull();
		});

		it("leaves an uninvolved row printing exactly its own number", () => {
			const utilization: IRaukkFleetUtilization[] = [
				utilizationOf("3000x1000-standard", 1, MINUTES_PER_DAY / 2),
			];

			const [row] = raukkFleetSpilloverRows(
				raukkFleetRows(utilization, profileOf),
				raukkFleetSpillover(utilization)
			);

			expect(row.spill?.printedPercent).toBe(50);
			expect(row.spill?.spilledInPercent).toBe(0);
			expect(row.spill?.received).toBe(false);
			expect(row.spill?.over).toBe(false);
		});
	});

	describe("raukkSpilloverBarWidths", () => {
		it("never draws the pair past the track", () => {
			expect(raukkSpilloverBarWidths(60, 30)).toStrictEqual({
				own: 60,
				spilled: 30,
			});
			expect(raukkSpilloverBarWidths(90, 30)).toStrictEqual({
				own: 90,
				spilled: 10,
			});
			expect(raukkSpilloverBarWidths(140, 30)).toStrictEqual({
				own: 100,
				spilled: 0,
			});
			expect(raukkSpilloverBarWidths(-5, 30)).toStrictEqual({
				own: 0,
				spilled: 30,
			});
			expect(raukkSpilloverBarWidths(50, -5)).toStrictEqual({
				own: 50,
				spilled: 0,
			});
		});
	});
});
