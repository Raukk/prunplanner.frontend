import { describe, it, expect, beforeEach } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { ref } from "vue";

// Composables
import { useRaukkChainDetail } from "@/features/raukk_sourcing/useRaukkChainDetail";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { usePlanningStore } from "@/stores/planningStore";

// Calculations
import { RAUKK_DEFAULT_SHIP_PROFILE_ID } from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";
import { IPlanEmpireElement } from "@/stores/planningStore.types";

/** Antares III */
const SOURCE_PLANET: string = "ZV-194a";
/** Antares II */
const CONSUMER_PLANET: string = "ZV-759b";

/** Everything but the distance is free, so the numbers stay checkable */
const flatProfile: Partial<IRaukkShipProfile> = {
	cargoWeight: 1000,
	cargoVolume: 1000,
	costPerParsec: 10,
	stlBlockCost: 0,
	damagePerParsec: 0,
	damagePerStlBlock: 0,
	minutesPerParsec: 30,
	stlBlockMinutesEmpty: 60,
	stlBlockMinutesLoaded: 120,
	chargeMinutes: 1,
	shipsAvailable: 1,
};

/** One plan to plan flow the loop can claim */
function flow(ownerPlanUuid: string, ticker: string): IRaukkChainFlow {
	return {
		flowId: `${ownerPlanUuid}#${ticker}`,
		ownerPlanUuid,
		sourcePlanUuid: "source",
		ticker,
		bucket: "production",
		fromStop: SOURCE_PLANET,
		toStop: CONSUMER_PLANET,
		unitsPerDay: 100,
		weightPerUnit: 1,
		volumePerUnit: 0,
	};
}

describe("useRaukkChainDetail", () => {
	let store: ReturnType<typeof useRaukkSourcingStore>;

	beforeEach(() => {
		setActivePinia(createPinia());
		store = useRaukkSourcingStore();

		store.setShippingConfig({ enabled: true });
		store.setShipProfile(RAUKK_DEFAULT_SHIP_PROFILE_ID, flatProfile);

		store.setChain({
			chainId: "c1",
			stops: [SOURCE_PLANET, CONSUMER_PLANET],
		});

		// two bases on the loop, each authoring one flow of its own
		store.setSnapshot("consumer", {
			computedAt: "2026-01-01T00:00:00.000Z",
			stale: false,
			planName: "Consumer",
			planetNaturalId: CONSUMER_PLANET,
			outputs: {},
			draws: {},
			flows: [flow("consumer", "ORE")],
		});

		store.setSnapshot("neighbour", {
			computedAt: "2026-01-01T00:00:00.000Z",
			stale: false,
			planName: "Neighbour",
			planetNaturalId: CONSUMER_PLANET,
			outputs: {},
			draws: {},
			flows: [flow("neighbour", "LST")],
		});
	});

	/** Tickers the detail preview says the loop carries */
	function carried(): string[] {
		const { forward } = useRaukkChainDetail(ref("c1"), ref({}), ref(0));

		return (forward.value?.flows ?? [])
			.map((claimed) => claimed.ticker)
			.sort();
	}

	it("carries every member's flows while nothing is assigned", () => {
		// an empty assigned set means the empires are not loaded yet, and
		// nothing is filtered at all
		expect(carried()).toStrictEqual(["LST", "ORE"]);
	});

	it("drops the flows of a member the account does not operate", () => {
		usePlanningStore().empires = {
			e1: {
				uuid: "e1",
				name: "E1",
				plans: [
					{
						uuid: "consumer",
						plan_name: "consumer",
						planet_natural_id: CONSUMER_PLANET,
					},
					{
						uuid: "source",
						plan_name: "source",
						planet_natural_id: SOURCE_PLANET,
					},
				],
			},
		} as unknown as Record<string, IPlanEmpireElement>;

		// the neighbour belongs to no empire: its cargo is not on the
		// loop the chain pass costs, so the preview must not show it
		// either — the two are the same numbers or neither is trustworthy
		expect(carried()).toStrictEqual(["ORE"]);
	});
});
