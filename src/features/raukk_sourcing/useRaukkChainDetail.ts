import { computed, ComputedRef, Ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Calculations
import {
	calculateChainCxSplit,
	calculateChainShipping,
	calculateReversedChainShipping,
	evaluateChainDrops,
} from "@/features/raukk_sourcing/calculations/shippingChains";
import { raukkResolveShipProfile } from "@/features/raukk_sourcing/calculations/shippingProfiles";
import { raukkChainAssignmentKey } from "@/features/raukk_sourcing/calculations/shippingFleet";

// Types & Interfaces
import {
	IRaukkChain,
	IRaukkChainConfig,
	IRaukkChainFlow,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { IRaukkShippingPriceResolver } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkChainDropEvaluation,
	IRaukkChainInput,
	IRaukkChainShipping,
	IRaukkCxSplitResult,
} from "@/features/raukk_sourcing/calculations/shippingChains.types";

/**
 * The per leg planning detail of ONE chain, recomputed for the display.
 *
 * The stored chain result keeps only what the cost pipeline consumes —
 * trips, round trip time, the binding leg and the daily costs of both
 * costings — because a per leg dump would bloat local storage for
 * numbers no snapshot reads. The planning surfaces need those legs, the
 * reversed loop and the drop rule evaluations, so they are recomputed
 * here from exactly the same inputs the account level pass used: the
 * authored chain, the FROZEN flows of its member plans' snapshots, and
 * the profile the chain is assigned.
 *
 * Two honest differences to the stored numbers, both display only:
 *
 *  - freight is priced at the OPEN plan's exchange preference rather
 *    than at the chain's anchor planet, because the tool has that
 *    resolver at hand and rendering must not fire network requests;
 *  - flows are as stale as the member snapshots are, which is exactly
 *    what the stale flag on the chain row states.
 *
 * @author raukk
 *
 * @param {Ref<string | undefined>} chainId Chain to detail
 * @param {Ref<Record<string, number>>} fuelPrices Unit price per fuel
 * @param {Ref<number>} repairBillCost ȼ of one full repair bill
 * @returns Applied costings, the reversed loop and the drop evaluations
 */
export function useRaukkChainDetail(
	chainId: Ref<string | undefined>,
	fuelPrices: Ref<Record<string, number>>,
	repairBillCost: Ref<number>
) {
	const sourcingStore = useRaukkSourcingStore();

	const chain: ComputedRef<IRaukkChain | undefined> = computed(() =>
		chainId.value ? sourcingStore.chains[chainId.value] : undefined
	);

	/** Ship type the chain flies with: assignment, chain, account default */
	const profileId: ComputedRef<string | undefined> = computed(() => {
		if (!chain.value) return undefined;

		return (
			sourcingStore.assignments[
				raukkChainAssignmentKey(chain.value.chainId)
			] ??
			chain.value.profileId ??
			sourcingStore.shippingConfig.defaultProfileId
		);
	});

	const input: ComputedRef<IRaukkChainInput | undefined> = computed(() => {
		if (!chain.value || !profileId.value) return undefined;

		const resolvePrice: IRaukkShippingPriceResolver = (ticker: string) =>
			fuelPrices.value[ticker] ?? 0;

		const flows: IRaukkChainFlow[] = sourcingStore
			.chainMemberPlans(chain.value.stops)
			.flatMap((planUuid: string) => {
				const snapshot: IRaukkSnapshot | undefined =
					sourcingStore.snapshots[planUuid];

				return snapshot?.flows ?? [];
			});

		const chainConfig: IRaukkChainConfig = sourcingStore.chainConfig;

		return {
			chain: chain.value,
			profile: raukkResolveShipProfile(
				sourcingStore.getShipProfile(profileId.value),
				resolvePrice
			),
			flows,
			config: sourcingStore.shippingConfig,
			chainConfig,
			repairBillCost: repairBillCost.value,
		};
	});

	const comparison: ComputedRef<IRaukkCxSplitResult | undefined> = computed(
		() => (input.value ? calculateChainCxSplit(input.value) : undefined)
	);

	/** True when the split is what the stored numbers were built from */
	const splitApplied: ComputedRef<boolean> = computed(() => {
		if (!chain.value || !comparison.value) return false;

		const autoSplit: boolean =
			chain.value.autoCxSplit ?? sourcingStore.chainConfig.autoCxSplit;

		return (
			autoSplit &&
			comparison.value.trigger !== null &&
			comparison.value.subChains.length > 0
		);
	});

	/** The costings actually flown: the sub chains, or the authored loop */
	const applied: ComputedRef<IRaukkChainShipping[]> = computed(() => {
		if (!comparison.value) return [];

		return splitApplied.value
			? comparison.value.subChains
			: [comparison.value.unsplit];
	});

	/** The authored loop, always computed, split or not */
	const forward: ComputedRef<IRaukkChainShipping | undefined> = computed(
		() => (input.value ? calculateChainShipping(input.value) : undefined)
	);

	const reversed: ComputedRef<IRaukkChainShipping | undefined> = computed(
		() =>
			input.value
				? calculateReversedChainShipping(input.value)
				: undefined
	);

	const drops: ComputedRef<IRaukkChainDropEvaluation[]> = computed(() =>
		input.value ? evaluateChainDrops(input.value) : []
	);

	return {
		chain,
		profileId,
		applied,
		splitApplied,
		forward,
		reversed,
		drops,
	};
}
