<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkDepotCosts } from "@/features/raukk_sourcing/useRaukkDepotCosts";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Calculations
	import {
		raukkHasGate,
		resolveSystemId,
	} from "@/features/raukk_sourcing/calculations/routeDistance";
	import {
		raukkDepotCandidates,
		raukkDepotStopKey,
	} from "@/features/raukk_sourcing/calculations/shippingDepots";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PButton, PInput, PInputNumber, PSelect, PTable, PTag } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkDepotCandidate,
		IRaukkDepotDailyCost,
	} from "@/features/raukk_sourcing/calculations/shippingDepots";
	import { IRaukkSnapshot } from "@/features/raukk_sourcing/raukkSourcing.types";

	const { rows, depotDailyCost, chainDailyCost, totalDailyCost } =
		useRaukkDepotCosts();

	const refAddPlanet: Ref<string | null> = ref(null);
	const refPickedPlanet: Ref<string | null> = ref(null);

	/**
	 * Whether the add row is typing an id instead of picking one.
	 *
	 * The escape hatch of the suggestion list: the gate transcription is
	 * a snapshot of the map, so a gate built since it was taken has to
	 * stay reachable — by hand, with a warning, never not at all.
	 */
	const refManual: Ref<boolean> = ref(false);

	/**
	 * Planets the account plans on, as the candidate search takes them.
	 * Read from the stored snapshots, the same source the chain editor
	 * builds its stop list from.
	 */
	const candidates: ComputedRef<IRaukkDepotCandidate[]> = computed(() =>
		raukkDepotCandidates(
			Object.values(sourcingStore.snapshots).map(
				(snapshot: IRaukkSnapshot) => ({
					planetNaturalId: snapshot.planetNaturalId,
					planName: snapshot.planName,
				})
			),
			rows.value.map((row) => row.planetNaturalId)
		)
	);

	const candidateOptions: ComputedRef<PSelectOption[]> = computed(() =>
		candidates.value.map((candidate) => ({
			label: t("raukk_sourcing.depots.candidate_label", {
				plan: candidate.planName,
				planet: candidate.planetNaturalId,
			}),
			value: candidate.planetNaturalId,
		}))
	);

	/** What the add row holds, trimmed as the store would store it */
	const entered: ComputedRef<string> = computed(() =>
		refManual.value
			? (refAddPlanet.value ?? "").trim()
			: (refPickedPlanet.value ?? "").trim()
	);

	function toggleManual(): void {
		refManual.value = !refManual.value;
		refAddPlanet.value = null;
		refPickedPlanet.value = null;
	}

	/**
	 * Planet ids already marked, the add field refuses them again.
	 *
	 * Keyed exactly as the store keys them: `ZV-307c` and `zv-307c` are one
	 * depot, so the second spelling has to be refused rather than silently
	 * patch the first one and leave the row count unchanged.
	 */
	const known: ComputedRef<Set<string>> = computed(
		() =>
			new Set(
				rows.value.map((row) => raukkDepotStopKey(row.planetNaturalId))
			)
	);

	const isKnown: ComputedRef<boolean> = computed(
		() =>
			entered.value !== "" &&
			known.value.has(raukkDepotStopKey(entered.value))
	);

	const canAdd: ComputedRef<boolean> = computed(
		() => entered.value !== "" && !isKnown.value
	);

	/**
	 * Whether the routing index knows the planet at all.
	 *
	 * A depot it cannot place is no anchor — `raukkChainAnchors` drops it
	 * silently — so a typo would otherwise sit in the table looking marked
	 * while no chain ever cuts there.
	 */
	function isRouted(stopRef: string): boolean {
		return resolveSystemId(stopRef) !== null;
	}

	/**
	 * Why the add button is off, or what the entry will not do.
	 *
	 * A missing gate WARNS rather than blocks, exactly as an unplaceable
	 * id does: the transcription is not the map, and a user standing on
	 * a gate it has never heard of is right and it is wrong.
	 */
	const addHint: ComputedRef<string> = computed(() => {
		if (entered.value === "") return refManual.value ? "empty" : "unpicked";
		if (isKnown.value) return "known";
		if (!isRouted(entered.value)) return "unrouted";

		return raukkHasGate(entered.value) ? "" : "nogate";
	});

	function addDepot(): void {
		if (!canAdd.value) return;

		sourcingStore.setDepot(entered.value);
		refAddPlanet.value = null;
		refPickedPlanet.value = null;
	}

	/**
	 * Stores the weekly warehouse rent of one depot. An empty or non
	 * positive input clears it, which is a FREE depot — a bare handover
	 * point — rather than a missing number.
	 *
	 * @author raukk
	 *
	 * @param {string} planetNaturalId Planet Natural Id
	 * @param {number | null | undefined} value ȼ per week
	 */
	function changeWeeklyCost(
		planetNaturalId: string,
		value: number | null | undefined
	): void {
		sourcingStore.setDepot(planetNaturalId, {
			weeklyCostAic: value ?? 0,
		});
	}

	function removeDepot(planetNaturalId: string): void {
		sourcingStore.deleteDepot(planetNaturalId);
	}

	/** Loops calling at one depot, as the row states them */
	function chainsLabel(row: IRaukkDepotDailyCost): string {
		return row.chainIds.length === 0 ? "—" : `${row.chainIds.length}`;
	}
</script>

<template>
	<!-- single root: this section is a KeepAlive child of the
	 Shipping page's tab strip, which caches component children
	 only when they have one root node -->
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.depots.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.depots.info") }}
		</div>

		<PTable striped>
			<thead>
				<tr>
					<th>{{ $t("raukk_sourcing.depots.planet") }}</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.depots.weekly_cost") }}
					</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.depots.daily_cost") }}
					</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.depots.chains") }}
					</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="row in rows"
					:key="`RAUKKDEPOT#${row.planetNaturalId}`">
					<td>
						<div class="flex flex-row gap-x-1 child:my-auto">
							<span class="font-bold">{{
								row.planetNaturalId
							}}</span>
							<PTag
								v-if="row.chainIds.length === 0"
								size="sm"
								type="secondary">
								{{ $t("raukk_sourcing.depots.unused") }}
							</PTag>
							<PTag
								v-if="!isRouted(row.planetNaturalId)"
								size="sm"
								type="error">
								{{ $t("raukk_sourcing.depots.unrouted") }}
							</PTag>
							<PTag
								v-else-if="!raukkHasGate(row.planetNaturalId)"
								size="sm"
								type="warning">
								{{ $t("raukk_sourcing.depots.nogate") }}
							</PTag>
						</div>
					</td>
					<td class="text-right">
						<PInputNumber
							class="min-w-30"
							size="sm"
							decimals
							:min="0"
							:value="row.weeklyCostAic"
							@update:value="
								(v) => changeWeeklyCost(row.planetNaturalId, v)
							" />
					</td>
					<td class="text-right">
						{{ formatNumber(row.dailyCost) }}
					</td>
					<td class="text-right text-white/60">
						{{ chainsLabel(row) }}
					</td>
					<td>
						<div class="flex flex-row justify-end">
							<PButton
								size="sm"
								type="error"
								@click="removeDepot(row.planetNaturalId)">
								{{ $t("raukk_sourcing.depots.remove") }}
							</PButton>
						</div>
					</td>
				</tr>
				<tr v-if="rows.length === 0">
					<td colspan="5" class="text-center text-white/50">
						{{ $t("raukk_sourcing.depots.empty") }}
					</td>
				</tr>
				<tr>
					<td colspan="5">
						<div
							class="flex flex-row flex-wrap gap-3 child:my-auto">
							<PInput
								v-if="refManual"
								v-model:value="refAddPlanet"
								class="w-60!"
								size="sm"
								:placeholder="
									$t('raukk_sourcing.depots.add_placeholder')
								" />
							<PSelect
								v-else
								class="w-80!"
								:value="refPickedPlanet"
								:options="candidateOptions"
								:placeholder="
									$t('raukk_sourcing.depots.pick_placeholder')
								"
								@update:value="
									(v) => (refPickedPlanet = v as string)
								" />
							<PButton
								size="sm"
								type="primary"
								:disabled="!canAdd"
								@click="addDepot">
								{{ $t("raukk_sourcing.depots.add") }}
							</PButton>
							<PButton
								size="sm"
								type="secondary"
								@click="toggleManual">
								{{
									$t(
										refManual
											? "raukk_sourcing.depots.pick_instead"
											: "raukk_sourcing.depots.enter_instead"
									)
								}}
							</PButton>
							<span
								v-if="addHint !== ''"
								:class="
									addHint === 'empty' ||
									addHint === 'unpicked'
										? 'text-white/50'
										: 'text-red-400'
								">
								{{
									$t(`raukk_sourcing.depots.hint.${addHint}`)
								}}
							</span>
						</div>
					</td>
				</tr>
			</tbody>
		</PTable>

		<div class="pt-3 flex flex-col gap-y-1">
			<div class="flex flex-row gap-x-2 child:my-auto">
				<span class="w-60 text-white/60">
					{{ $t("raukk_sourcing.depots.rollup.chains") }}
				</span>
				<span>{{ formatNumber(chainDailyCost) }}</span>
			</div>
			<div class="flex flex-row gap-x-2 child:my-auto">
				<span class="w-60 text-white/60">
					{{ $t("raukk_sourcing.depots.rollup.rent") }}
				</span>
				<span>{{ formatNumber(depotDailyCost) }}</span>
			</div>
			<div class="flex flex-row gap-x-2 child:my-auto font-bold">
				<span class="w-60">
					{{ $t("raukk_sourcing.depots.rollup.total") }}
				</span>
				<span>{{ formatNumber(totalDailyCost) }}</span>
			</div>
		</div>
	</div>
</template>
