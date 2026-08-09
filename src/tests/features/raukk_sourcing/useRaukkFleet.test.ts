import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Composables
import { useRaukkFleet } from "@/features/raukk_sourcing/useRaukkFleet";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkFleetAdvisory } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainResult,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

function makeAdvisory(
	pairKey: string,
	suggestedShipTypeId: string
): IRaukkFleetAdvisory {
	return {
		pairKey,
		bucket: "production",
		shipTypeId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
		tripsPerDay: 0.5,
		suggestedShipTypeId,
		suggestedTripsPerDay: 0.25,
	};
}

function makeSnapshot(advisories: IRaukkFleetAdvisory[]): IRaukkSnapshot {
	return {
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		planName: "Source",
		planetNaturalId: "ZV-194a",
		outputs: {},
		draws: {},
		lanes: [
			{
				pairKey: "source>CX",
				shipTypeId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
				tripsPerDay: 0.5,
				roundTripMinutes: 100,
				hired: false,
			},
		],
		advisories,
	};
}

function makeChainResult(
	chainId: string,
	advisories: IRaukkFleetAdvisory[]
): IRaukkChainResult {
	const costing = {
		stops: ["ZV-194a", "ZV-759b"],
		tripsPerDay: 1,
		roundTripMinutes: 100,
		bindingLegIndex: 0,
		dailyCost: 500,
		shippingFraction: 0.1,
	};

	return {
		chainId,
		computedAt: "2026-01-01T00:00:00.000Z",
		stale: false,
		profileId: RAUKK_DEFAULT_SHIP_PROFILE_ID,
		hired: false,
		splitApplied: false,
		unsplit: costing,
		split: [],
		splitTrigger: null,
		tripsPerDay: 1,
		roundTripMinutes: 100,
		bindingLegIndex: 0,
		dailyCost: 500,
		shippingFraction: 0.1,
		shipMinutesPerDay: 100,
		flows: [],
		perUnit: {},
		memberPlanUuids: ["source"],
		config: raukkDefaultChainConfig(),
		advisories,
	};
}

describe("useRaukkFleet", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();
	});

	describe("advisories", () => {
		beforeEach(() => {
			store.setSnapshot(
				"source",
				makeSnapshot([makeAdvisory("source>CX", "WCB")])
			);
			store.setChainResult(
				"c1",
				makeChainResult("c1", [
					makeAdvisory("chain:c1", "5000x5000-standard"),
				])
			);
		});

		it("rolls the stored lane and chain advice up together", () => {
			const { advisories } = useRaukkFleet();

			expect(
				advisories.value.map(
					(advisory) => advisory.suggestedShipTypeId
				)
			).toStrictEqual(["WCB", "5000x5000-standard"]);
		});

		/*
		 * An advisory's whole meaning is "a hull the fleet does NOT own
		 * would serve this better": frozen advice must vanish the moment
		 * the user buys the suggested type, without waiting for the
		 * stored snapshots to recompute.
		 */
		it("drops the advice for a suggested type the fleet owns", () => {
			store.setFleetShip("WCB", { count: 1 });

			const { advisories } = useRaukkFleet();

			expect(
				advisories.value.map(
					(advisory) => advisory.suggestedShipTypeId
				)
			).toStrictEqual(["5000x5000-standard"]);
		});

		it("keeps the advice while the suggested type has no hull", () => {
			// a fleet row at count 0 is not ownership: no hull can fly it
			store.setFleetShip("WCB", { count: 0 });

			const { advisories } = useRaukkFleet();

			expect(
				advisories.value.map(
					(advisory) => advisory.suggestedShipTypeId
				)
			).toStrictEqual(["WCB", "5000x5000-standard"]);
		});

		it("returns the advice once the owned hull is deleted again", () => {
			store.setFleetShip("WCB", { count: 1 });
			store.deleteFleetShip("WCB");

			const { advisories } = useRaukkFleet();

			expect(
				advisories.value.map(
					(advisory) => advisory.suggestedShipTypeId
				)
			).toStrictEqual(["WCB", "5000x5000-standard"]);
		});
	});
});
