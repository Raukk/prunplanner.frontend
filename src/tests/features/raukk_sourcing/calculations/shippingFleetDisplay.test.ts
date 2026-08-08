import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkBayCode,
	raukkFleetRows,
	raukkShipTypeOptions,
	raukkUtilizationBarWidth,
} from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";
import {
	raukkShipProfilePreset,
	raukkShipProfilePresets,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkShipProfile } from "@/features/raukk_sourcing/calculations/shipping.types";
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

	describe("raukkUtilizationBarWidth", () => {
		it("caps the bar while the number stays honest", () => {
			expect(raukkUtilizationBarWidth(0.25)).toBe(25);
			expect(raukkUtilizationBarWidth(1.34)).toBe(100);
			expect(raukkUtilizationBarWidth(-1)).toBe(0);
			expect(raukkUtilizationBarWidth(null)).toBe(0);
			expect(raukkUtilizationBarWidth(Infinity)).toBe(0);
		});
	});
});
