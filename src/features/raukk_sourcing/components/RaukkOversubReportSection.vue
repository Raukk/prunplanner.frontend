<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref, toRef } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkOversubReport } from "@/features/raukk_sourcing/useRaukkOversubReport";

	// Components
	import RaukkOversubTable from "@/features/raukk_sourcing/components/RaukkOversubTable.vue";

	// Calculations
	import { RAUKK_EPSILON_EQUAL } from "@/features/raukk_sourcing/calculations/raukkEpsilon";
	import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// UI
	import { PButton, PButtonGroup, PCheckbox, PInput, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubRow,
		IRaukkOversubTickerRow,
	} from "@/features/raukk_sourcing/calculations/oversubReport.types";
	import { IRaukkShipProfile } from "@/features/raukk_sourcing/raukkSourcing.types";

	/** Sort choices of the filter bar */
	type OversubSortKey = "utilization" | "producer" | "ticker";

	const props = defineProps({
		/** Plan uuids of the loaded empire, the producer scope */
		planUuids: {
			type: Array as PropType<(string | undefined)[]>,
			required: true,
		},
	});

	const { tickerRows, fleetRows } = useRaukkOversubReport(
		toRef(props, "planUuids")
	);

	/** Read directly, the getter clones and would not track */
	const shippingEnabled: ComputedRef<boolean> = computed(
		() => sourcingStore.shippingConfig.enabled
	);

	// filter bar state, component-local on purpose: the store persists
	// domain data, never UI selection
	const refProblemsOnly: Ref<boolean> = ref(true);
	const refTickerFilter: Ref<string | null> = ref(null);
	const refStaleOnly: Ref<boolean> = ref(false);
	const refSort: Ref<OversubSortKey> = ref("utilization");

	const sortOptions: ComputedRef<PSelectOption[]> = computed(() =>
		(["utilization", "producer", "ticker"] as OversubSortKey[]).map(
			(key) => ({
				label: t(
					`raukk_sourcing.oversub_report.filters.sort_options.${key}`
				),
				value: key,
			})
		)
	);

	/**
	 * Problems membership per the report spec: over rows, plus rows whose
	 * net is beyond epsilon below zero even without subscribers — the row
	 * builder flags those over already, the second clause states the rule.
	 */
	function isProblem(row: IRaukkOversubRow): boolean {
		return row.over || row.netPerDay < -RAUKK_EPSILON_EQUAL;
	}

	/** Filter bar verdict of one row; stale-only intersects */
	function matchesFilters(row: IRaukkOversubRow): boolean {
		if (refProblemsOnly.value && !isProblem(row)) return false;
		if (refStaleOnly.value && !row.anyStale) return false;

		const query: string = (refTickerFilter.value ?? "")
			.trim()
			.toUpperCase();
		if (query === "") return true;

		if (row.kind === "ticker")
			return row.ticker.toUpperCase().includes(query);

		return (
			row.shipTypeId.toUpperCase().includes(query) ||
			(row.designName ?? "").toUpperCase().includes(query)
		);
	}

	/** Producer-ish label of one row, the producer sort key */
	function producerOf(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? row.producerPlanName
			: (row.designName ?? row.shipTypeId);
	}

	/** Ticker-ish label of one row, the ticker sort key */
	function tickerOf(row: IRaukkOversubRow): string {
		return row.kind === "ticker" ? row.ticker : row.shipTypeId;
	}

	/** Rows in the chosen order; "utilization" keeps the delivered sort */
	function applySort<T extends IRaukkOversubRow>(rows: T[]): T[] {
		if (refSort.value === "utilization") return rows;

		const sorted: T[] = [...rows];

		if (refSort.value === "producer")
			sorted.sort(
				(first, second) =>
					producerOf(first).localeCompare(producerOf(second)) ||
					tickerOf(first).localeCompare(tickerOf(second))
			);
		else
			sorted.sort(
				(first, second) =>
					tickerOf(first).localeCompare(tickerOf(second)) ||
					producerOf(first).localeCompare(producerOf(second))
			);

		return sorted;
	}

	const filteredTickerRows: ComputedRef<IRaukkOversubTickerRow[]> = computed(
		() => applySort(tickerRows.value.filter(matchesFilters))
	);

	const filteredFleetRows: ComputedRef<IRaukkOversubFleetRow[]> = computed(
		() => applySort(fleetRows.value.filter(matchesFilters))
	);

	/** Ship type label per id, the fleet page's bay code · profile name */
	const shipTypeLabels: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			fleetRows.value.map((row) => {
				const profile: IRaukkShipProfile = sourcingStore.getShipProfile(
					row.shipTypeId
				);

				return [
					row.shipTypeId,
					`${
						raukkBayCode(
							profile.cargoWeight,
							profile.cargoVolume
						) ?? "—"
					} · ${profile.name}`,
				];
			})
		)
	);
</script>

<template>
	<div class="p-3 sm:p-6">
		<h3 class="text-xl font-bold pb-3">
			{{ $t("raukk_sourcing.oversub_report.title") }}
		</h3>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.oversub_report.info") }}
		</div>

		<div class="flex flex-row flex-wrap gap-3 pb-3 child:my-auto">
			<div class="flex flex-row gap-x-2 child:my-auto">
				<PCheckbox v-model:checked="refProblemsOnly" />
				<span>
					{{
						$t(
							"raukk_sourcing.oversub_report.filters.problems_only"
						)
					}}
				</span>
			</div>
			<div class="flex flex-row gap-x-2 child:my-auto">
				<PCheckbox v-model:checked="refStaleOnly" />
				<span>
					{{ $t("raukk_sourcing.oversub_report.filters.stale_only") }}
				</span>
			</div>
			<PInput
				v-model:value="refTickerFilter"
				class="w-40"
				size="sm"
				:placeholder="
					$t(
						'raukk_sourcing.oversub_report.filters.ticker_placeholder'
					)
				" />
			<div class="flex flex-row gap-x-2 child:my-auto">
				<span class="text-white/50">
					{{ $t("raukk_sourcing.oversub_report.filters.sort") }}
				</span>
				<PSelect
					class="w-40!"
					:value="refSort"
					:options="sortOptions"
					@update:value="(v) => (refSort = v as OversubSortKey)" />
			</div>
		</div>

		<!-- tab strip: Table only for now, the visualization tabs arrive
		 in a later slice -->
		<div class="pb-3">
			<PButtonGroup>
				<PButton type="primary" size="sm">
					{{ $t("raukk_sourcing.oversub_report.tabs.table") }}
				</PButton>
			</PButtonGroup>
		</div>

		<RaukkOversubTable
			:ticker-rows="filteredTickerRows"
			:fleet-rows="filteredFleetRows"
			:shipping-enabled="shippingEnabled"
			:ship-type-labels="shipTypeLabels" />
	</div>
</template>
