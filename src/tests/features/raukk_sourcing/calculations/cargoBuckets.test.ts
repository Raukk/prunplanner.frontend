import { describe, expect, it } from "vitest";

// Functions
import { raukkSplitCargoBuckets } from "@/features/raukk_sourcing/calculations/cargoBuckets";

// Types & Interfaces
import { IRaukkBucketSource } from "@/features/raukk_sourcing/calculations/shipping.types";

/** ORE is production only, DW workforce only, H2O both */
const planResult: IRaukkBucketSource = {
	productionMaterialIO: [
		{ ticker: "ORE", input: 100 },
		{ ticker: "H2O", input: 30 },
	],
	workforceMaterialIO: [
		{ ticker: "DW", input: 20 },
		{ ticker: "H2O", input: 10 },
	],
};

describe("Raukk Sourcing: Cargo Buckets", () => {
	it("keeps a production only ticker whole", () => {
		expect(raukkSplitCargoBuckets("ORE", 80, planResult)).toStrictEqual([
			{ bucket: "production", unitsPerDay: 80 },
		]);
	});

	it("keeps a workforce only ticker whole", () => {
		expect(raukkSplitCargoBuckets("DW", 20, planResult)).toStrictEqual([
			{ bucket: "workforce", unitsPerDay: 20 },
		]);
	});

	it("splits a shared ticker in the ratio of its gross demands", () => {
		// 30 production against 10 workforce: three quarters of the net
		// input serve production
		const split = raukkSplitCargoBuckets("H2O", 40, planResult);

		expect(split.map((entry) => entry.bucket)).toStrictEqual([
			"production",
			"workforce",
		]);
		expect(split[0].unitsPerDay).toBeCloseTo(30, 10);
		expect(split[1].unitsPerDay).toBeCloseTo(10, 10);
		expect(
			split.reduce((sum, entry) => sum + entry.unitsPerDay, 0)
		).toBeCloseTo(40, 10);
	});

	it("calls a ticker neither list claims production", () => {
		expect(raukkSplitCargoBuckets("MET", 5, planResult)).toStrictEqual([
			{ bucket: "production", unitsPerDay: 5 },
		]);
	});

	it("ignores a negative or zero input row", () => {
		expect(
			raukkSplitCargoBuckets("H2O", 10, {
				productionMaterialIO: [{ ticker: "H2O", input: 0 }],
				workforceMaterialIO: [{ ticker: "H2O", input: 10 }],
			})
		).toStrictEqual([{ bucket: "workforce", unitsPerDay: 10 }]);
	});
});
