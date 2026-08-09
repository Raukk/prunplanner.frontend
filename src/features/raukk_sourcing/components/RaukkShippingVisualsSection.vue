<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Components
	import RaukkShippingMapSection from "@/features/raukk_sourcing/components/RaukkShippingMapSection.vue";
	import RaukkCapacityPlaneSection from "@/features/raukk_sourcing/components/RaukkCapacityPlaneSection.vue";

	// Calculations
	import {
		IRaukkMapLane,
		raukkMapLanes,
	} from "@/features/raukk_sourcing/calculations/shippingMapDisplay";
	import { RAUKK_DEFAULT_CADENCE_IN_OUT_DAYS } from "@/features/raukk_sourcing/calculations/shippingCadence";

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
	}

	const TABS: IRaukkVisualTab[] = [
		{ key: "map", labelKey: "raukk_sourcing.visuals.tab_map" },
		{ key: "plane", labelKey: "raukk_sourcing.visuals.tab_plane" },
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
</script>

<template>
	<div class="pt-6">
		<h3 class="pb-3 text-white/80 font-bold">
			{{ $t("raukk_sourcing.visuals.title") }}
		</h3>

		<div class="pb-3">
			<PButtonGroup>
				<PButton
					v-for="tab in TABS"
					:key="`RAUKKVISUALTAB#${tab.key}`"
					:type="refActiveTab === tab.key ? 'primary' : 'secondary'"
					size="sm"
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
	</div>
</template>
