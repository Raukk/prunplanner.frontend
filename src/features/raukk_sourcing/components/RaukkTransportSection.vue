<script setup lang="ts">
	import { computed, ComputedRef, PropType, toRef } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkTransport } from "@/features/raukk_sourcing/useRaukkTransport";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Components
	import RaukkShipFilterBar from "@/features/raukk_sourcing/components/RaukkShipFilterBar.vue";
	import RaukkTransportTable from "@/features/raukk_sourcing/components/RaukkTransportTable.vue";

	// Calculations
	import { raukkFilterTransportRows } from "@/features/raukk_sourcing/calculations/shippingRouteFilter";

	// Types & Interfaces
	import { IRaukkTransportRow } from "@/features/raukk_sourcing/calculations/shippingDisplay";
	import { IRaukkShippingConfig } from "@/features/raukk_sourcing/raukkSourcing.types";
	import { PSelectOption } from "@/ui/ui.types";

	const props = defineProps({
		/** ȼ of a full repair bill, prices the wear column */
		repairBillCost: {
			type: Number,
			required: true,
		},
		/** Ship types a lane can be assigned to, the page's shared set */
		shipTypeOptions: {
			type: Array as PropType<PSelectOption[]>,
			required: false,
			default: () => [],
		},
		/**
		 * Show only the lanes this ship type flies, null shows every
		 * lane. Owned by the page: the fleet table's Routes column jumps
		 * here with it set, which is the whole point of it living a level
		 * up rather than in this section.
		 */
		shipFilter: {
			type: String as PropType<string | null>,
			required: false,
			default: null,
		},
	});

	const emit = defineEmits<{
		(e: "update:shipFilter", shipTypeId: string | null): void;
	}>();

	const config: ComputedRef<IRaukkShippingConfig> = computed(
		() => sourcingStore.shippingConfig
	);

	const { rows, planNames, planPlanets } = useRaukkTransport(
		toRef(props, "repairBillCost")
	);

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

	/** The lanes shown: every one, or the ones the filtered hull flies */
	const shownRows: ComputedRef<IRaukkTransportRow[]> = computed(() =>
		raukkFilterTransportRows(rows.value, props.shipFilter)
	);

	/** Label of the filtered ship type, its bare id where none names it */
	const filterLabel: ComputedRef<string> = computed(
		() =>
			props.shipTypeOptions.find(
				(option) => option.value === props.shipFilter
			)?.label ?? String(props.shipFilter)
	);

	/** What the filter bar states, empty while nothing is filtered */
	const countLabel: ComputedRef<string> = computed(() =>
		props.shipFilter === null
			? ""
			: t("raukk_sourcing.ship_filter.lanes", {
					shown: shownRows.value.length,
					total: rows.value.length,
					ship: filterLabel.value,
				})
	);
</script>

<template>
	<div class="pt-6">
		<h3 class="pb-3 text-white/80 font-bold">
			{{ $t("raukk_sourcing.transport.title") }}
		</h3>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.transport.info") }}
		</div>

		<RaukkShipFilterBar
			:ship-filter="props.shipFilter"
			:ship-type-options="props.shipTypeOptions"
			:count-label="countLabel"
			@update:ship-filter="(v) => emit('update:shipFilter', v)" />

		<RaukkTransportTable
			:rows="shownRows"
			:empty-label="
				props.shipFilter === null
					? ''
					: $t('raukk_sourcing.ship_filter.lanes_empty', {
							ship: filterLabel,
						})
			"
			:plan-names="planNames"
			:plan-planets="planPlanets"
			:ship-type-options="props.shipTypeOptions"
			:assignments="assignments"
			@update:rate="changeLmRate"
			@update:assignment="changeAssignment" />
	</div>
</template>
