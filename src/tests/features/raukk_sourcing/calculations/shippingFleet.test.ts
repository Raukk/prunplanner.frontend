import { describe, it, expect } from "vitest";

// Calculations
import {
	raukkAssignedShipTypeId,
	raukkChainAssignmentKey,
	raukkChainIdOfAssignmentKey,
	raukkFleetUtilization,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import { raukkDefaultShippingConfig } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkShippingConfig } from "@/features/raukk_sourcing/calculations/shipping.types";

const MINUTES_PER_DAY: number = 24 * 60;

describe("Raukk Shipping: Fleet", () => {
	describe("assignment keys", () => {
		it("round trips a chain key and rejects a lane key", () => {
			const key: string = raukkChainAssignmentKey("c1");

			expect(raukkChainIdOfAssignmentKey(key)).toBe("c1");
			expect(raukkChainIdOfAssignmentKey("plan>CX")).toBeUndefined();
			expect(raukkChainIdOfAssignmentKey("plan>source")).toBeUndefined();
		});
	});

	describe("raukkAssignedShipTypeId", () => {
		const config: IRaukkShippingConfig = {
			...raukkDefaultShippingConfig(),
			perEdgeProfile: { "a>CX": "2000x2000-standard" },
		};

		it("falls back to the account default", () => {
			expect(raukkAssignedShipTypeId("b>CX", {}, config)).toBe(
				config.defaultProfileId
			);
		});

		it("takes the v1 per edge override", () => {
			expect(raukkAssignedShipTypeId("a>CX", {}, config)).toBe(
				"2000x2000-standard"
			);
		});

		it("lets the fleet assignment win over the override", () => {
			expect(
				raukkAssignedShipTypeId(
					"a>CX",
					{ "a>CX": "5000x5000-quick-charge" },
					config
				)
			).toBe("5000x5000-quick-charge");
		});
	});

	describe("raukkFleetUtilization", () => {
		it("sums the assigned work per ship type", () => {
			const rows = raukkFleetUtilization(
				{ WCB: { count: 2, designName: "FSE_WCB_QCR" } },
				[
					{
						key: "a>CX",
						shipTypeId: "WCB",
						tripsPerDay: 2,
						roundTripMinutes: 600,
					},
					{
						key: "chain:c1",
						shipTypeId: "WCB",
						tripsPerDay: 1,
						roundTripMinutes: 240,
					},
				]
			);

			expect(rows.length).toBe(1);
			expect(rows[0].shipMinutesPerDay).toBe(2 * 600 + 240);
			expect(rows[0].utilization).toBeCloseTo(
				1440 / (MINUTES_PER_DAY * 2),
				10
			);
			expect(rows[0].designName).toBe("FSE_WCB_QCR");
			expect(rows[0].keys).toStrictEqual(["a>CX", "chain:c1"]);
		});

		it("reports an idle ship type at zero", () => {
			const rows = raukkFleetUtilization({ LCB: { count: 1 } }, []);

			expect(rows[0].utilization).toBe(0);
			expect(rows[0].keys).toStrictEqual([]);
		});

		it("reports an unowned ship type as undefined, never as free", () => {
			const rows = raukkFleetUtilization({}, [
				{
					key: "a>CX",
					shipTypeId: "HCB",
					tripsPerDay: 1,
					roundTripMinutes: 100,
				},
			]);

			// zero would read as infinite capacity, the opposite of
			// "there is no such ship"
			expect(rows[0].count).toBe(0);
			expect(rows[0].utilization).toBeNull();
			expect(rows[0].shipMinutesPerDay).toBe(100);
		});

		it("does not clamp an over-rationed type", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: 2,
					roundTripMinutes: MINUTES_PER_DAY,
				},
			]);

			expect(rows[0].utilization).toBe(2);
		});

		it("lists every type of the fleet and of the work, sorted", () => {
			const rows = raukkFleetUtilization(
				{ WCB: { count: 1 }, LCB: { count: 0 } },
				[
					{
						key: "a>CX",
						shipTypeId: "HCB",
						tripsPerDay: 1,
						roundTripMinutes: 10,
					},
				]
			);

			expect(rows.map((row) => row.shipTypeId)).toStrictEqual([
				"HCB",
				"LCB",
				"WCB",
			]);
			expect(
				rows.find((row) => row.shipTypeId === "LCB")?.utilization
			).toBeNull();
		});

		it("ignores negative trips and times", () => {
			const rows = raukkFleetUtilization({ WCB: { count: 1 } }, [
				{
					key: "a>CX",
					shipTypeId: "WCB",
					tripsPerDay: -5,
					roundTripMinutes: 100,
				},
			]);

			expect(rows[0].shipMinutesPerDay).toBe(0);
		});
	});
});
