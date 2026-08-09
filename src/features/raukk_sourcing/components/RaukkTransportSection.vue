<script setup lang="ts">
	import { computed, ComputedRef, toRef } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkTransport } from "@/features/raukk_sourcing/useRaukkTransport";
	import { useRaukkShippingOptions } from "@/features/raukk_sourcing/useRaukkShippingOptions";

	// Components
	import RaukkTransportTable from "@/features/raukk_sourcing/components/RaukkTransportTable.vue";

	// Types & Interfaces
	import { IRaukkShippingConfig } from "@/features/raukk_sourcing/raukkSourcing.types";

	const props = defineProps({
		/** ȼ of a full repair bill, prices the wear column */
		repairBillCost: {
			type: Number,
			required: true,
		},
	});

	const config: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	const { rows, planNames } = useRaukkTransport(toRef(props, "repairBillCost"));
	const { shipTypeOptions } = useRaukkShippingOptions();

	const assignments: ComputedRef<Record<string, string>> = computed(
		() => sourcingStore.assignments
	);

	/**
	 * Stores or clears the hired rate of one lane. Clearing removes the
	 * key entirely, an absent rate is what the shipping math reads as
	 * "flown with the own fleet".
	 *
	 * @author raukk
	 *
	 * @param {string} pairKey Pair Key
	 * @param {number | undefined} rate ȼ per trip, undefined clears
	 */
	function changeLmRate(pairKey: string, rate: number | undefined): void {
		const lmRates: Record<string, number> = {
			...(config.value.lmRates ?? {}),
		};

		if (rate === undefined) delete lmRates[pairKey];
		else lmRates[pairKey] = rate;

		sourcingStore.setShippingConfig({ lmRates });
	}

	/**
	 * Assigns a ship type to one lane, or puts it back to auto — which is
	 * the account default profile, or a v1 per edge override where one
	 * exists.
	 *
	 * @author raukk
	 *
	 * @param {string} pairKey Pair Key
	 * @param {string | undefined} shipTypeId Ship Type Id
	 */
	function changeAssignment(
		pairKey: string,
		shipTypeId: string | undefined
	): void {
		sourcingStore.setAssignment(pairKey, shipTypeId);
	}
</script>

<template>
	<div class="pt-6">
		<h3 class="pb-3 text-white/80 font-bold">
			{{ $t("raukk_sourcing.transport.title") }}
		</h3>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.transport.info") }}
		</div>

		<RaukkTransportTable
			:rows="rows"
			:plan-names="planNames"
			:ship-type-options="shipTypeOptions"
			:assignments="assignments"
			@update:rate="changeLmRate"
			@update:assignment="changeAssignment" />
	</div>
</template>
