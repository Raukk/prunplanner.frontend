import { describe, expect, it } from "vitest";

// Calculations
import {
	RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
	RAUKK_DEFAULT_CADENCE_REPAIR_DAYS,
	RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
	raukkCadenceCaps,
	raukkCadenceOf,
	raukkCapDaysOf,
} from "@/features/raukk_sourcing/calculations/shippingCadence";

// Types & Interfaces
import { IRaukkCadence } from "@/features/raukk_sourcing/calculations/shippingCadence";
import {
	IRaukkCadenceCaps,
	IRaukkShippingConfig,
} from "@/features/raukk_sourcing/calculations/shipping.types";

const config: IRaukkShippingConfig = {
	enabled: true,
	defaultProfileId: "test",
	routingMode: "direct",
	sameSystemFlatCost: 0,
};

describe("Raukk Sourcing: Shipping Cadence", () => {
	describe("raukkCadenceCaps", () => {
		it("falls back to the shipped defaults", () => {
			expect(raukkCadenceCaps(config, 90)).toStrictEqual({
				production: RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
				workforce: RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
				repair: 90,
			});

			expect(RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS).toBe(14);
			expect(RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS).toBe(30);
			expect(RAUKK_DEFAULT_CADENCE_REPAIR_DAYS).toBe(90);
		});

		it("takes the account defaults where they are set", () => {
			expect(
				raukkCadenceCaps(
					{
						...config,
						cadenceInOutDays: 7,
						cadenceWorkforceDays: 60,
					},
					30
				)
			).toStrictEqual({ production: 7, workforce: 60, repair: 30 });
		});

		it("follows the consuming plans repair day", () => {
			expect(raukkCadenceCaps(config, 120).repair).toBe(120);
			expect(raukkCadenceCaps(config, 30).repair).toBe(30);
		});

		it("replaces an account default by the plans override", () => {
			expect(
				raukkCadenceCaps({ ...config, cadenceInOutDays: 7 }, 90, {
					production: 365,
					repair: 365,
				})
			).toStrictEqual({
				production: 365,
				workforce: RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
				repair: 365,
			});
		});

		it("ignores a non positive cap on every level", () => {
			expect(
				raukkCadenceCaps(
					{
						...config,
						cadenceInOutDays: 0,
						cadenceWorkforceDays: -5,
					},
					0,
					{ production: 0 }
				)
			).toStrictEqual({
				production: RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS,
				workforce: RAUKK_DEFAULT_CADENCE_WORKFORCE_DAYS,
				repair: RAUKK_DEFAULT_CADENCE_REPAIR_DAYS,
			});
		});

		it("reads one bucket back", () => {
			const caps: IRaukkCadenceCaps = raukkCadenceCaps(config, 60);

			expect(raukkCapDaysOf(caps, "production")).toBe(14);
			expect(raukkCapDaysOf(caps, "workforce")).toBe(30);
			expect(raukkCapDaysOf(caps, "repair")).toBe(60);
		});
	});

	describe("raukkCadenceOf", () => {
		it("visits as soon as the hull is full, inside the cap", () => {
			// half a hull a day: full after two days, the cap never applies
			const cadence: IRaukkCadence = raukkCadenceOf(0.5, 14);

			expect(cadence.fillDays).toBeCloseTo(2, 10);
			expect(cadence.visitDays).toBeCloseTo(2, 10);
			expect(cadence.tripsPerDay).toBeCloseTo(0.5, 10);
		});

		it("flies a partial hull once the cap binds", () => {
			// a hull that takes 28 days to fill runs half full every 14
			const cadence: IRaukkCadence = raukkCadenceOf(1 / 28, 14);

			expect(cadence.fillDays).toBeCloseTo(28, 10);
			expect(cadence.visitDays).toBe(14);
			expect(cadence.tripsPerDay).toBeCloseTo(1 / 14, 10);
		});

		it("keeps more than one trip a day when the cargo demands it", () => {
			expect(raukkCadenceOf(3, 14).tripsPerDay).toBeCloseTo(3, 10);
		});

		it("never visits a leg without cargo", () => {
			expect(raukkCadenceOf(0, 14)).toStrictEqual({
				fillDays: Infinity,
				visitDays: Infinity,
				tripsPerDay: 0,
			});
			expect(raukkCadenceOf(-1, 14).tripsPerDay).toBe(0);
		});

		it("degrades a non positive cap to the fill time", () => {
			expect(raukkCadenceOf(0.25, 0).visitDays).toBeCloseTo(4, 10);
		});
	});
});
