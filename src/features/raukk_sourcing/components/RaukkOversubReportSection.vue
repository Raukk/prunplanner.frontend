<script setup lang="ts">
	import {
		Component,
		computed,
		ComputedRef,
		CSSProperties,
		onBeforeUnmount,
		onMounted,
		PropType,
		ref,
		Ref,
		toRef,
	} from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkOversubReport } from "@/features/raukk_sourcing/useRaukkOversubReport";
	import { provideRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";
	import { provideRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	// Components
	import RaukkOversubTable from "@/features/raukk_sourcing/components/RaukkOversubTable.vue";
	import RaukkOversubLedgerTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubLedgerTab.vue";
	import RaukkOversubLegend from "@/features/raukk_sourcing/components/oversub/RaukkOversubLegend.vue";
	import RaukkOversubTooltip from "@/features/raukk_sourcing/components/oversub/RaukkOversubTooltip.vue";

	// Calculations
	import {
		RAUKK_OVERSUB_STATUS_COLORS,
		raukkOversubAxisMax,
		raukkOversubConsumerSlots,
		raukkOversubFilter,
	} from "@/features/raukk_sourcing/calculations/oversubDisplay";
	import { raukkBayCode } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// UI
	import { PButton, PButtonGroup, PCheckbox, PInput, PSelect } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IRaukkOversubConsumerSlots } from "@/features/raukk_sourcing/calculations/oversubDisplay";
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
		() =>
			applySort(
				raukkOversubFilter(tickerRows.value, {
					problemsOnly: refProblemsOnly.value,
					tickerQuery: refTickerFilter.value,
					staleOnly: refStaleOnly.value,
				})
			)
	);

	const filteredFleetRows: ComputedRef<IRaukkOversubFleetRow[]> = computed(
		() =>
			applySort(
				raukkOversubFilter(fleetRows.value, {
					problemsOnly: refProblemsOnly.value,
					tickerQuery: refTickerFilter.value,
					staleOnly: refStaleOnly.value,
				})
			)
	);

	// the "soft" slices pass every filter EXCEPT problems-only: the
	// empty state points at the worst row the toggle is hiding
	const softTickerRows: ComputedRef<IRaukkOversubTickerRow[]> = computed(() =>
		applySort(
			raukkOversubFilter(tickerRows.value, {
				problemsOnly: false,
				tickerQuery: refTickerFilter.value,
				staleOnly: refStaleOnly.value,
			})
		)
	);

	const softFleetRows: ComputedRef<IRaukkOversubFleetRow[]> = computed(() =>
		applySort(
			raukkOversubFilter(fleetRows.value, {
				problemsOnly: false,
				tickerQuery: refTickerFilter.value,
				staleOnly: refStaleOnly.value,
			})
		)
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

	// ------------------------------------------------------------------
	// visualization scaffolding: color registry, axis domain, selection,
	// tooltip and the tab registry
	// ------------------------------------------------------------------

	/** Registry over the UNFILTERED rows — filters never recolor */
	const consumerSlots: ComputedRef<IRaukkOversubConsumerSlots> = computed(
		() =>
			raukkOversubConsumerSlots([...tickerRows.value, ...fleetRows.value])
	);

	/** Shared axis domain of every viz tab, over the rendered rows */
	const axisMax: ComputedRef<number> = computed(() =>
		raukkOversubAxisMax([
			...filteredTickerRows.value,
			...filteredFleetRows.value,
		])
	);

	// component-scoped cross-highlight and the one tooltip host, both
	// provided to every tab — never store state
	const selection = provideRaukkOversubSelection();
	provideRaukkOversubTooltip();

	/** Esc anywhere clears the cross-highlight selection */
	function onKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") selection.clear();
	}

	onMounted(() => document.addEventListener("keydown", onKeydown));
	onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

	/**
	 * One visualization tab of the registry. CONTRACT — every viz tab
	 * component mounts only while active (`v-if`, never v-show), takes
	 * exactly the props of `vizTabProps`:
	 *   tickerRows / fleetRows        filtered + sorted rows to render
	 *   softTickerRows / softFleetRows  same minus problems-only, the
	 *                                 empty state's worst-row figure
	 *   shippingEnabled               render the fleet group at all
	 *   consumerSlots                 deterministic color registry
	 *   axisMax                       shared percent axis domain
	 * emits "flip-problems-only" (empty state), reads selection through
	 * `useRaukkOversubSelection()` and drives the shared tooltip through
	 * `useRaukkOversubTooltip()`. Adding a tab is one import plus one
	 * entry here.
	 */
	interface IRaukkOversubVizTab {
		key: string;
		labelKey: string;
		component: Component;
	}

	const vizTabs: IRaukkOversubVizTab[] = [
		{
			key: "ledger",
			labelKey: "raukk_sourcing.oversub_report.tabs.ledger",
			component: RaukkOversubLedgerTab,
		},
	];

	/** Active tab: "table" or a viz tab key. Only it mounts. */
	const refActiveTab: Ref<string> = ref("table");

	/** The props every viz tab receives, the registry contract */
	const vizTabProps = computed(() => ({
		tickerRows: filteredTickerRows.value,
		fleetRows: filteredFleetRows.value,
		softTickerRows: softTickerRows.value,
		softFleetRows: softFleetRows.value,
		shippingEnabled: shippingEnabled.value,
		consumerSlots: consumerSlots.value,
		axisMax: axisMax.value,
	}));

	/** Status color tokens as CSS vars on the section root */
	const sectionStyle: CSSProperties = {
		"--roversub-over": RAUKK_OVERSUB_STATUS_COLORS.over,
		"--roversub-over-text": RAUKK_OVERSUB_STATUS_COLORS.overText,
		"--roversub-stale": RAUKK_OVERSUB_STATUS_COLORS.stale,
		"--roversub-other": RAUKK_OVERSUB_STATUS_COLORS.other,
		"--roversub-external": RAUKK_OVERSUB_STATUS_COLORS.external,
	} as CSSProperties;
</script>

<template>
	<div class="p-3 sm:p-6" :style="sectionStyle">
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

		<!-- tab strip: Table plus the viz tab registry; only the active
		 tab mounts (v-if), so recompute writes never re-render hidden
		 views -->
		<div class="pb-3">
			<PButtonGroup>
				<PButton
					:type="refActiveTab === 'table' ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refActiveTab = 'table')">
					{{ $t("raukk_sourcing.oversub_report.tabs.table") }}
				</PButton>
				<PButton
					v-for="tab in vizTabs"
					:key="tab.key"
					:type="refActiveTab === tab.key ? 'primary' : 'secondary'"
					size="sm"
					@click="() => (refActiveTab = tab.key)">
					{{ $t(tab.labelKey) }}
				</PButton>
			</PButtonGroup>
		</div>

		<!-- the shared legend belongs to the viz tabs, the table names
		 its consumers inline -->
		<RaukkOversubLegend
			v-if="refActiveTab !== 'table'"
			:consumer-slots="consumerSlots" />

		<RaukkOversubTable
			v-if="refActiveTab === 'table'"
			:ticker-rows="filteredTickerRows"
			:fleet-rows="filteredFleetRows"
			:shipping-enabled="shippingEnabled"
			:ship-type-labels="shipTypeLabels" />
		<template v-for="tab in vizTabs" :key="tab.key">
			<component
				:is="tab.component"
				v-if="refActiveTab === tab.key"
				v-bind="vizTabProps"
				@flip-problems-only="() => (refProblemsOnly = false)" />
		</template>

		<!-- the one tooltip host every tab drives -->
		<RaukkOversubTooltip />
	</div>
</template>
