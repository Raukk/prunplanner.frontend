<script setup lang="ts">
	import { computed, ComputedRef, CSSProperties, ref, Ref } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Components
	import RaukkShippingMapSection from "@/features/raukk_sourcing/components/RaukkShippingMapSection.vue";
	import RaukkCapacityPlaneSection from "@/features/raukk_sourcing/components/RaukkCapacityPlaneSection.vue";
	import RaukkOversubTooltip from "@/features/raukk_sourcing/components/oversub/RaukkOversubTooltip.vue";

	// Composables
	import { provideRaukkOversubTooltip } from "@/features/raukk_sourcing/components/oversub/useRaukkOversubTooltip";

	// the one hover host of both views — an SVG `<title>` cannot say
	// which of two piled marks it belongs to and cannot be styled, and
	// the oversubscription report already solved this
	provideRaukkOversubTooltip();

	// Calculations
	import {
		IRaukkMapLane,
		raukkMapLanes,
	} from "@/features/raukk_sourcing/calculations/shippingMapDisplay";
	import { RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS } from "@/features/raukk_sourcing/calculations/shippingCadence";
	import { RAUKK_VIZ_CSS_VARS } from "@/features/raukk_sourcing/calculations/raukkVizPalette";

	// UI
	import { PButton, PButtonGroup } from "@/ui";

	// Types & Interfaces
	import { IRaukkChainFlow } from "@/features/raukk_sourcing/calculations/shippingChains.types";
	import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

	/**
	 * One visualization tab. Only the active one mounts, so a store write
	 * never re-renders a view nobody is looking at — the same contract the
	 * oversubscription report's tab registry follows.
	 */
	interface IRaukkVisualTab {
		key: string;
		labelKey: string;
		/** Hover line saying what this view answers — the label alone
		 * does not tell you which of the two to open */
		tooltipKey: string;
	}

	const TABS: IRaukkVisualTab[] = [
		{
			key: "map",
			labelKey: "raukk_sourcing.visuals.tab_map",
			tooltipKey: "raukk_sourcing.visuals.tab_map_tooltip",
		},
		{
			key: "plane",
			labelKey: "raukk_sourcing.visuals.tab_plane",
			tooltipKey: "raukk_sourcing.visuals.tab_plane_tooltip",
		},
	];

	const refActiveTab: Ref<string> = ref("map");

	/**
	 * Every frozen flow of the account.
	 *
	 * Scoped: a plan assigned to no empire ships nothing account wide,
	 * exactly as the chain section reads them.
	 */
	const accountFlows: ComputedRef<IRaukkChainFlow[]> = computed(() =>
		Object.values(sourcingStore.scopedSnapshots()).flatMap(
			(snapshot: IRaukkSnapshot) => snapshot.flows ?? []
		)
	);

	/** The flows reduced to drawable lanes, shared by both views */
	const lanes: ComputedRef<IRaukkMapLane[]> = computed(() =>
		raukkMapLanes(accountFlows.value)
	);

	/** Planet natural id to plan name, over every stored snapshot */
	const stopNames: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.values(sourcingStore.snapshots).map(
				(snapshot: IRaukkSnapshot) => [
					snapshot.planetNaturalId,
					snapshot.planName,
				]
			)
		)
	);

	const depotPlanets: ComputedRef<string[]> = computed(() =>
		Object.values(sourcingStore.depots).map(
			(depot) => depot.planetNaturalId
		)
	);

	const defaultCadenceDays: ComputedRef<number> = computed(
		() =>
			sourcingStore.shippingConfig.cadenceInOutDays ??
			RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS
	);

	/** The shared viz palette as CSS vars, for both child views */
	const sectionStyle: CSSProperties = RAUKK_VIZ_CSS_VARS;
</script>

<template>
	<div :style="sectionStyle">
		<!-- heading anatomy of every other section of this page: h4,
		 font-bold py-3, muted info line -->
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.visuals.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.visuals.info") }}
		</div>

		<div class="pb-3">
			<PButtonGroup class="flex-wrap">
				<PButton
					v-for="tab in TABS"
					:key="`RAUKKVISUALTAB#${tab.key}`"
					:type="refActiveTab === tab.key ? 'primary' : 'secondary'"
					size="sm"
					:title="$t(tab.tooltipKey)"
					@click="() => (refActiveTab = tab.key)">
					{{ $t(tab.labelKey) }}
				</PButton>
			</PButtonGroup>
		</div>

		<div v-if="lanes.length === 0" class="text-white/50">
			{{ $t("raukk_sourcing.visuals.empty") }}
		</div>

		<template v-else>
			<RaukkShippingMapSection
				v-if="refActiveTab === 'map'"
				:lanes="lanes"
				:depot-planets="depotPlanets"
				:stop-names="stopNames" />

			<RaukkCapacityPlaneSection
				v-else-if="refActiveTab === 'plane'"
				:lanes="lanes"
				:stop-names="stopNames"
				:default-cadence-days="defaultCadenceDays" />
		</template>

		<RaukkOversubTooltip />
	</div>
</template>
