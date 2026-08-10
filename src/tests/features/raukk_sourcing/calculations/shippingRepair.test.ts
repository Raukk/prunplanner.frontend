import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_DEFAULT_REPAIR_BOM,
	RAUKK_REPAIR_AT_DAMAGE,
	RAUKK_REPAIR_TICKERS,
	raukkRepairBill,
	raukkRepairBillCost,
	raukkRepairShieldRelief,
} from "@/features/raukk_sourcing/calculations/shippingRepair";
import { RAUKK_REPAIR_BILL } from "@/features/raukk_sourcing/calculations/shipping";

// Types & Interfaces
import { IRaukkShipRepairBom } from "@/features/raukk_sourcing/calculations/shippingRepair";

/*
 * Every expectation is one of the community calculator's own worked
 * examples. Its two reference ships are a 90 plate LHP hull with no
 * shielding and a 90 plate AHP hull carrying an advanced whipple, an
 * advanced thermal and a specialized anti-rad.
 */

/** The calculator's unshielded reference ship */
const PLAIN: IRaukkShipRepairBom = {
	hullPlate: "LHP",
	hullPlateCount: 90,
	structuralElements: 0,
	shields: [],
};

/** Its fully shielded one */
const SHIELDED: IRaukkShipRepairBom = {
	...PLAIN,
	hullPlate: "AHP",
	shields: ["AWH", "APT", "SRP"],
};

/** The sheet's price snapshot, standing in for the API resolver */
const prices: Record<string, number> = {
	LHP: 4000,
	BHP: 4500,
	AHP: 8000,
	AWH: 9000,
	APT: 7500,
	SRP: 4000,
	MFK: 180,
	FLP: 400,
	SSC: 100,
};

function resolvePrice(ticker: string): number {
	return prices[ticker] ?? 0;
}

describe("Raukk Shipping: Repair", () => {
	it("repairs at a fifth of condition lost, not four fifths", () => {
		/*
		 * The in-game repair screen and the calculator both say "80 %",
		 * meaning 80 % CONDITION. Rounds 2 and 3 read it as 80 % DAMAGE
		 * and divided the trip's share by four times too much.
		 */
		expect(RAUKK_REPAIR_AT_DAMAGE).toBe(0.2);
	});

	it("reproduces the calculator's unshielded reference bill", () => {
		const bill: Record<string, number> = raukkRepairBill(PLAIN);

		// ceil(90 × 0.2 × 0.75) = 14 plates, plus the flat pair
		expect(bill.LHP).toBe(14);
		expect(bill.MFK).toBe(12);
		expect(bill.FLP).toBe(8);
		// 14 × 4000 + 12 × 180 + 8 × 400
		expect(raukkRepairBillCost(bill, resolvePrice)).toBe(61_360);
	});

	it("reproduces the shielded reference bill, shields and all", () => {
		const bill: Record<string, number> = raukkRepairBill(SHIELDED);

		// three 15 % reliefs leave the hull at 0.55: ceil(90 × .2 × .75 × .55)
		expect(bill.AHP).toBe(8);
		// every shield wears against the flat 0.662 instead
		expect(bill.AWH).toBe(9);
		expect(bill.APT).toBe(9);
		expect(bill.SRP).toBe(9);
		expect(raukkRepairBillCost(bill, resolvePrice)).toBe(253_860);
	});

	it("keeps the bill round 3 observed on the 3000 t hull", () => {
		/*
		 * The reason the threshold could move without the quantities
		 * moving: `ceil(71 × 0.2 × 0.75)` is 11, and 71 is what that
		 * hull's blueprint panel states for its structural elements.
		 */
		expect(RAUKK_REPAIR_BILL).toStrictEqual({
			LHP: 11,
			SSC: 11,
			MFK: 12,
			FLP: 8,
		});
		expect(RAUKK_DEFAULT_REPAIR_BOM.structuralElements).toBe(71);
	});

	it("scales with the damage actually repaired", () => {
		const half: Record<string, number> = raukkRepairBill(PLAIN, 0.1);
		const full: Record<string, number> = raukkRepairBill(PLAIN, 0.2);

		expect(half.LHP).toBe(7);
		expect(full.LHP).toBe(14);
		// the flat pair does not move with it
		expect(half.MFK).toBe(full.MFK);
	});

	it("charges nothing but the flat pair for an untouched hull", () => {
		expect(raukkRepairBill(PLAIN, 0)).toStrictEqual({ MFK: 12, FLP: 8 });
	});

	it("relieves the hull by the shields it carries", () => {
		expect(raukkRepairShieldRelief([])).toBe(1);
		expect(raukkRepairShieldRelief(["AWH"])).toBeCloseTo(0.85, 10);
		expect(raukkRepairShieldRelief(["AWH", "APT", "SRP"])).toBeCloseTo(
			0.55,
			10
		);
		// an unknown ticker relieves nothing rather than throwing
		expect(raukkRepairShieldRelief(["NOPE"])).toBe(1);
	});

	it("offers every ticker a bill could ever contain for pricing", () => {
		// a profile with a whipple array must not go unpriced because no
		// OTHER profile carries one
		["LHP", "AHP", "AWH", "APT", "SRP", "SSC", "MFK", "FLP"].forEach(
			(ticker) => expect(RAUKK_REPAIR_TICKERS).toContain(ticker)
		);
		expect(new Set(RAUKK_REPAIR_TICKERS).size).toBe(
			RAUKK_REPAIR_TICKERS.length
		);
	});

	it("prices only through the resolver it is handed", () => {
		// no price is hardcoded: an empty resolver makes every bill free
		expect(raukkRepairBillCost(raukkRepairBill(SHIELDED), () => 0)).toBe(0);
	});
});
