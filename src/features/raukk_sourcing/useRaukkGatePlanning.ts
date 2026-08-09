import { computed, ComputedRef, onMounted, Ref, ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import { usePrice } from "@/features/cx/usePrice";

// Calculations
import {
	IRaukkPlannedGate,
	IRaukkPlannedGateValue,
	raukkPlannedGateUpgrades,
	raukkPlannedGateValue,
} from "@/features/raukk_sourcing/calculations/gatePlanning";
import {
	IRaukkMaterialAmounts,
	raukkGateCostAic,
	raukkGateCostTickers,
	raukkGateLinkBuildCost,
} from "@/features/raukk_sourcing/calculations/gateCosts";
import { RAUKK_DEFAULT_CHAIN_ROUTES } from "@/features/raukk_sourcing/calculations/shippingChains";

/** One planned gate, what it would be worth and what it would cost */
export interface IRaukkGatePlanningRow {
	gate: IRaukkPlannedGate;
	value: IRaukkPlannedGateValue;
	/** Materials BOTH ends of the link come to */
	materials: IRaukkMaterialAmounts;
	/** ȼ those materials come to, 0 while prices are still loading */
	buildCostAic: number;
}

/** Rollup of the gate planning table */
export interface IRaukkGatePlanningTotals {
	/** Planned gates that are edges of the route graph right now */
	enabled: number;
	/** Planned gates the routing could not place */
	broken: number;
	/** Minutes the enabled gates save on their own endpoints, summed */
	savedMinutes: number;
	/** ȼ every planned gate on the table would cost to build */
	buildCostAic: number;
}

/**
 * Planned gates of the account, each measured and each costed.
 *
 * Reads `store.plannedGates` DIRECTLY rather than through a cloning
 * getter: `inertClone` calls `toRaw`, so a nested read would never
 * re-run this computed when a single field of one gate changes (the
 * reactivity rule of this feature).
 *
 * The value of a gate is measured with the SHIPPED time model, not with
 * the account's own hull calibration: the question a planned gate answers
 * is whether the link is worth having at all, and pinning that on
 * whichever hull happens to fly it today would make the answer move for
 * reasons that have nothing to do with the gate.
 *
 * Prices are fetched once on mount, universe priced — a gate belongs to
 * no plan and no exchange. Until they arrive every bill reads 0 rather
 * than a wrong number.
 *
 * @author raukk
 *
 * @returns Rows and their rollup
 */
export function useRaukkGatePlanning(): {
	rows: ComputedRef<IRaukkGatePlanningRow[]>;
	totals: ComputedRef<IRaukkGatePlanningTotals>;
	pricesLoaded: Ref<boolean>;
} {
	const sourcingStore = useRaukkSourcingStore();

	const refPrices: Ref<Record<string, number>> = ref({});
	const pricesLoaded: Ref<boolean> = ref(false);

	onMounted(async () => {
		const { getPrice } = await usePrice(ref(undefined), ref(undefined));

		const prices: Record<string, number> = {};

		await Promise.all(
			raukkGateCostTickers().map(async (ticker) => {
				try {
					prices[ticker] = await getPrice(ticker, "BUY");
				} catch {
					// a ticker no exchange prices contributes nothing, the
					// rule the chain price loader follows
					prices[ticker] = 0;
				}
			})
		);

		refPrices.value = prices;
		pricesLoaded.value = true;
	});

	const rows: ComputedRef<IRaukkGatePlanningRow[]> = computed(() =>
		Object.values(sourcingStore.plannedGates).map((gate) => {
			const materials: IRaukkMaterialAmounts = raukkGateLinkBuildCost(
				raukkPlannedGateUpgrades(gate)
			);

			return {
				gate,
				value: raukkPlannedGateValue(gate, RAUKK_DEFAULT_CHAIN_ROUTES),
				materials,
				buildCostAic: raukkGateCostAic(
					materials,
					(ticker) => refPrices.value[ticker] ?? 0
				),
			};
		})
	);

	const totals: ComputedRef<IRaukkGatePlanningTotals> = computed(() => ({
		enabled: rows.value.filter((row) => row.gate.enabled).length,
		broken: rows.value.filter((row) => row.value.issue !== "").length,
		savedMinutes: rows.value
			.filter((row) => row.gate.enabled)
			.reduce((sum, row) => sum + row.value.savedMinutes, 0),
		buildCostAic: rows.value.reduce(
			(sum, row) => sum + row.buildCostAic,
			0
		),
	}));

	return { rows, totals, pricesLoaded };
}
