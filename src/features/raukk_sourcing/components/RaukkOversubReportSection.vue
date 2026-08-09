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
	import { useRaukkChainRecompute } from "@/features/raukk_sourcing/useRaukkChainRecompute";
	import {
		computeChainResults,
		IRaukkChainComputeError,
	} from "@/features/raukk_sourcing/useRaukkChainCompute";
	import { provideRaukkOversubSelection } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubSelection";
	import { provideRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";
	import { provideRaukkOversubNav } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubNav";

	// Components
	import ComputingProgress from "@/layout/components/ComputingProgress.vue";
	import RaukkOversubTable from "@/features/raukk_sourcing/components/RaukkOversubTable.vue";
	import RaukkOversubLedgerTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubLedgerTab.vue";
	import RaukkOversubMatrixTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubMatrixTab.vue";
	import RaukkOversubBeeswarmTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubBeeswarmTab.vue";
	import RaukkOversubDumbbellTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubDumbbellTab.vue";
	import RaukkOversubWaffleTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubWaffleTab.vue";
	import RaukkOversubGridTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubGridTab.vue";
	import RaukkOversubBlocksTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubBlocksTab.vue";
	import RaukkOversubBubblesTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubBubblesTab.vue";
	import RaukkOversubMapTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubMapTab.vue";
	import RaukkOversubStarMapTab from "@/features/raukk_sourcing/components/oversub/RaukkOversubStarMapTab.vue";
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
	import {
		PButton,
		PButtonGroup,
		PCheckbox,
		PInput,
		PProgressBar,
		PSelect,
	} from "@/ui";
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
		/** The empire snapshot upkeep is in flight, recompute waits */
		autoSnapshotRunning: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const { tickerRows, fleetRows } = useRaukkOversubReport(
		toRef(props, "planUuids")
	);

	/** Read directly, the getter clones and would not track */
	const shippingEnabled: ComputedRef<boolean> = computed(
		() => sourcingStore.shippingConfig.enabled
	);

	// ------------------------------------------------------------------
	// recompute wiring: ONE shared chain recompute instance, the fleet
	// chain-results action and the shared busy gate over both plus the
	// empire auto snapshot upkeep
	// ------------------------------------------------------------------

	const {
		running: recomputeRunning,
		current: recomputeCurrent,
		done: recomputeDone,
		total: recomputeTotal,
		errors: recomputeErrors,
		recomputeChain,
	} = useRaukkChainRecompute();

	/** The fleet chain-results recompute is in flight */
	const refFleetRecomputing: Ref<boolean> = ref(false);
	/** Failed chains of the last fleet chain-results recompute */
	const refFleetChainErrors: Ref<IRaukkChainComputeError[]> = ref([]);

	/** Any sourcing recompute in flight — buttons gate on this, the
	 * report content freezes under the overlay while it is true */
	const sourcingBusy: ComputedRef<boolean> = computed(
		() =>
			props.autoSnapshotRunning ||
			recomputeRunning.value ||
			refFleetRecomputing.value
	);

	/**
	 * Recomputes the sourcing chain of one producer row through the
	 * shared instance. The buttons disable while anything runs — this
	 * guard only backs them up, the composable's own silent re-entry
	 * guard never surfaces to the user.
	 *
	 * @author raukk
	 *
	 * @param {string} planUuid Producer Plan Uuid
	 */
	function onRecomputePlan(planUuid: string): void {
		if (sourcingBusy.value) return;

		void recomputeChain(planUuid);
	}

	/**
	 * Recomputes every shipping chain RESULT from the stored snapshot
	 * flows — the same `computeChainResults` call as the Shipping page
	 * button, the snapshots themselves stay untouched.
	 *
	 * @author raukk
	 */
	async function onRecomputeFleet(): Promise<void> {
		if (sourcingBusy.value) return;

		refFleetRecomputing.value = true;

		try {
			refFleetChainErrors.value = await computeChainResults();
		} finally {
			refFleetRecomputing.value = false;
		}
	}

	/** Progress numbers of the overlay; the fleet action and the auto
	 * snapshot upkeep carry no counts, they show an empty bar */
	const busyProgress: ComputedRef<{ step: number; total: number }> = computed(
		() =>
			recomputeRunning.value
				? {
						step: recomputeDone.value,
						total: Math.max(recomputeTotal.value, 1),
					}
				: { step: 0, total: 1 }
	);

	/** Message line of the overlay, naming what is running */
	const busyMessage: ComputedRef<string> = computed(() => {
		if (recomputeRunning.value)
			return recomputeCurrent.value !== undefined
				? t("raukk_sourcing.oversub_report.recompute.strip_current", {
						name: recomputeCurrent.value,
					})
				: t("raukk_sourcing.oversub_report.recompute.strip_scope");

		if (refFleetRecomputing.value)
			return t("raukk_sourcing.oversub_report.recompute.fleet_running");

		return t(
			"raukk_sourcing.oversub_report.recompute.auto_snapshot_running"
		);
	});

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

	// component-scoped cross-highlight, the one tooltip host and the
	// modifier-click navigation, all provided to every tab — never
	// store state
	const selection = provideRaukkOversubSelection();
	provideRaukkOversubTooltip();
	provideRaukkOversubNav();

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
		{
			key: "matrix",
			labelKey: "raukk_sourcing.oversub_report.tabs.matrix",
			component: RaukkOversubMatrixTab,
		},
		{
			key: "beeswarm",
			labelKey: "raukk_sourcing.oversub_report.tabs.beeswarm",
			component: RaukkOversubBeeswarmTab,
		},
		{
			key: "dumbbell",
			labelKey: "raukk_sourcing.oversub_report.tabs.dumbbell",
			component: RaukkOversubDumbbellTab,
		},
		{
			key: "waffle",
			labelKey: "raukk_sourcing.oversub_report.tabs.waffle",
			component: RaukkOversubWaffleTab,
		},
		{
			key: "grid",
			labelKey: "raukk_sourcing.oversub_report.tabs.grid",
			component: RaukkOversubGridTab,
		},
		{
			key: "blocks",
			labelKey: "raukk_sourcing.oversub_report.tabs.blocks",
			component: RaukkOversubBlocksTab,
		},
		{
			key: "bubbles",
			labelKey: "raukk_sourcing.oversub_report.tabs.bubbles",
			component: RaukkOversubBubblesTab,
		},
		{
			key: "map",
			labelKey: "raukk_sourcing.oversub_report.tabs.map",
			component: RaukkOversubMapTab,
		},
		{
			key: "starmap",
			labelKey: "raukk_sourcing.oversub_report.tabs.starmap",
			component: RaukkOversubStarMapTab,
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

		<!-- recompute strip: progress while the shared chain recompute
		 runs, the errors of the last runs afterwards -->
		<div
			v-if="recomputeRunning"
			class="pb-3 flex flex-col gap-y-1 text-xs text-white/60">
			<PProgressBar
				:step="recomputeDone"
				:total="Math.max(recomputeTotal, 1)" />
			<span v-if="recomputeCurrent !== undefined">
				{{
					$t(
						"raukk_sourcing.oversub_report.recompute.strip_current",
						{ name: recomputeCurrent }
					)
				}}
			</span>
			<span>
				{{ $t("raukk_sourcing.oversub_report.recompute.strip_scope") }}
			</span>
		</div>
		<div
			v-if="recomputeErrors.length > 0 || refFleetChainErrors.length > 0"
			class="pb-3 flex flex-col">
			<span
				v-for="chainError in recomputeErrors"
				:key="`RAUKKOVERSUBRECOMPUTEERROR#${chainError.planUuid}`"
				class="text-negative">
				{{
					$t("raukk_sourcing.oversub_report.recompute.error", {
						name: chainError.planName,
						message: chainError.message,
					})
				}}
			</span>
			<span
				v-for="chainError in refFleetChainErrors"
				:key="`RAUKKOVERSUBFLEETERROR#${chainError.chainId}`"
				class="text-negative">
				{{
					$t("raukk_sourcing.oversub_report.recompute.error", {
						name:
							chainError.chainId !== ""
								? chainError.chainId
								: $t(
										"raukk_sourcing.oversub_report.recompute.fleet_error_name"
									),
						message: chainError.message,
					})
				}}
			</span>
		</div>

		<!-- while a run streams snapshot writes the report freezes under
		 the overlay instead of animating intermediate states -->
		<div v-if="sourcingBusy" class="min-h-96">
			<ComputingProgress
				:step="busyProgress.step"
				:total="busyProgress.total"
				:message="busyMessage" />
		</div>
		<template v-else>
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
				:ship-type-labels="shipTypeLabels"
				:recompute-busy="sourcingBusy"
				@recompute-plan="onRecomputePlan"
				@recompute-fleet="onRecomputeFleet" />
			<template v-for="tab in vizTabs" :key="tab.key">
				<component
					:is="tab.component"
					v-if="refActiveTab === tab.key"
					v-bind="vizTabProps"
					@flip-problems-only="() => (refProblemsOnly = false)" />
			</template>
		</template>

		<!-- the one tooltip host every tab drives -->
		<RaukkOversubTooltip />
	</div>
</template>
