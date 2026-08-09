<script setup lang="ts">
	import { computed, ComputedRef, ref, Ref } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkGatePlanning } from "@/features/raukk_sourcing/useRaukkGatePlanning";

	// Calculations
	import {
		RAUKK_PLANNED_GATE_DEFAULT_FEE,
		RAUKK_PLANNED_GATE_DEFAULT_M3,
		raukkPlannedGateLabel,
	} from "@/features/raukk_sourcing/calculations/gatePlanning";
	import { resolveSystemId } from "@/features/raukk_sourcing/calculations/routeDistance";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import {
		PButton,
		PCheckbox,
		PInput,
		PInputNumber,
		PSelect,
		PTable,
		PTag,
		PTooltip,
	} from "@/ui";

	// Types & Interfaces
	import {
		IRaukkPlannedGate,
		RAUKK_PLANNED_GATE_STATUS,
	} from "@/features/raukk_sourcing/calculations/gatePlanning";
	import { IRaukkGatePlanningRow } from "@/features/raukk_sourcing/useRaukkGatePlanning";

	const { rows, totals } = useRaukkGatePlanning();

	const statusOptions: ComputedRef<
		{ label: string; value: RAUKK_PLANNED_GATE_STATUS }[]
	> = computed(() => [
		{
			label: t("raukk_sourcing.gates.status.construction"),
			value: "construction",
		},
		{
			label: t("raukk_sourcing.gates.status.proposed"),
			value: "proposed",
		},
	]);

	/*
	 * Add form. Endpoints are set once: a gate between two other planets
	 * is another gate, not an edit of this one, and letting them be typed
	 * over would silently re-route the account under a name that still
	 * reads like the old link.
	 */
	const refAddA: Ref<string | null> = ref(null);
	const refAddB: Ref<string | null> = ref(null);
	const refAddName: Ref<string | null> = ref(null);
	const refAddStatus: Ref<RAUKK_PLANNED_GATE_STATUS> = ref("proposed");

	const enteredA: ComputedRef<string> = computed(() =>
		(refAddA.value ?? "").trim()
	);
	const enteredB: ComputedRef<string> = computed(() =>
		(refAddB.value ?? "").trim()
	);

	const canAdd: ComputedRef<boolean> = computed(
		() => enteredA.value !== "" && enteredB.value !== ""
	);

	/** Why the add button is off, or what the entry will not do */
	const addHint: ComputedRef<string> = computed(() => {
		if (!canAdd.value) return "empty";

		const systemA: string | null = resolveSystemId(enteredA.value);
		const systemB: string | null = resolveSystemId(enteredB.value);

		if (systemA === null || systemB === null) return "unknown";
		if (systemA === systemB) return "same_system";

		return "";
	});

	function addGate(): void {
		if (!canAdd.value) return;

		sourcingStore.setPlannedGate(
			`gate-${Date.now().toString(36)}-${Math.random()
				.toString(36)
				.slice(2, 7)}`,
			{
				name: (refAddName.value ?? "").trim() || undefined,
				planetA: enteredA.value,
				planetB: enteredB.value,
				fee: RAUKK_PLANNED_GATE_DEFAULT_FEE,
				maxM3: RAUKK_PLANNED_GATE_DEFAULT_M3,
				enabled: false,
				status: refAddStatus.value,
			}
		);

		refAddA.value = null;
		refAddB.value = null;
		refAddName.value = null;
	}

	function patchGate(
		gateId: string,
		patch: Partial<IRaukkPlannedGate>
	): void {
		sourcingStore.setPlannedGate(gateId, patch);
	}

	function removeGate(gateId: string): void {
		sourcingStore.deletePlannedGate(gateId);
	}

	/** Hours one traversal takes, the unit every chain leg is stated in */
	function hours(minutes: number | null): string {
		return minutes === null ? "—" : formatNumber(minutes / 60);
	}

	/** Saving of one row, minus sign and all, `—` when there is none */
	function savedLabel(row: IRaukkGatePlanningRow): string {
		if (row.value.unreachableToday)
			return t("raukk_sourcing.gates.opens_route");
		if (row.value.savedMinutes <= 0) return "—";

		return `${formatNumber(row.value.savedMinutes / 60)} h (${formatNumber(
			row.value.savedShare * 100
		)}%)`;
	}

	function label(gate: IRaukkPlannedGate): string {
		return raukkPlannedGateLabel(gate);
	}
</script>

<template>
	<h4 class="font-bold py-3">
		{{ $t("raukk_sourcing.gates.title") }}
	</h4>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.gates.info") }}
	</div>

	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.gates.gate") }}</th>
				<th>{{ $t("raukk_sourcing.gates.link") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.fee") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.volume") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.parsecs") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.traversal") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.today") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.saves") }}
				</th>
				<th class="text-center!">
					{{ $t("raukk_sourcing.gates.enabled") }}
				</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<tr v-for="row in rows" :key="`RAUKKGATE#${row.gate.id}`">
				<td>
					<div class="flex flex-col gap-y-1">
						<PInput
							:value="row.gate.name ?? ''"
							class="w-45!"
							size="sm"
							:placeholder="label(row.gate)"
							@update:value="
								(v) => patchGate(row.gate.id, { name: v ?? '' })
							" />
						<PSelect
							class="w-45!"
							:value="row.gate.status"
							:options="statusOptions"
							@update:value="
								(v) =>
									patchGate(row.gate.id, {
										status: v as RAUKK_PLANNED_GATE_STATUS,
									})
							" />
					</div>
				</td>
				<td>
					<div class="flex flex-row gap-x-1 child:my-auto">
						<span class="font-bold">
							{{ row.gate.planetA }} ⇄ {{ row.gate.planetB }}
						</span>
						<PTooltip v-if="row.value.issue !== ''">
							<template #trigger>
								<PTag
									size="sm"
									type="error"
									class="hover:cursor-help">
									{{ $t("raukk_sourcing.gates.unrouted") }}
								</PTag>
							</template>
							{{
								$t(
									`raukk_sourcing.gates.issue.${row.value.issue}`
								)
							}}
						</PTooltip>
						<PTag
							v-else-if="row.value.hcbCapable"
							size="sm"
							type="secondary">
							{{ $t("raukk_sourcing.gates.hcb") }}
						</PTag>
					</div>
				</td>
				<td class="text-right">
					<PInputNumber
						class="min-w-25"
						size="sm"
						:min="0"
						:value="row.gate.fee"
						@update:value="
							(v) => patchGate(row.gate.id, { fee: v ?? 0 })
						" />
				</td>
				<td class="text-right">
					<PInputNumber
						class="min-w-25"
						size="sm"
						:min="0"
						:value="row.gate.maxM3"
						@update:value="
							(v) => patchGate(row.gate.id, { maxM3: v ?? 0 })
						" />
				</td>
				<td class="text-right">
					{{
						row.value.parsecs === null
							? "—"
							: formatNumber(row.value.parsecs)
					}}
				</td>
				<td class="text-right">{{ hours(row.value.traversalMinutes) }}</td>
				<td class="text-right">
					{{ hours(row.value.todayMinutes) }}
				</td>
				<td
					class="text-right"
					:class="
						row.value.savedMinutes > 0 || row.value.unreachableToday
							? 'text-positive'
							: 'text-white/50'
					">
					{{ savedLabel(row) }}
				</td>
				<td class="text-center">
					<PCheckbox
						:checked="row.gate.enabled"
						:disabled="row.value.issue !== ''"
						@update:checked="
							(v) =>
								patchGate(row.gate.id, { enabled: v === true })
						" />
				</td>
				<td>
					<div class="flex flex-row justify-end">
						<PButton
							size="sm"
							type="error"
							@click="removeGate(row.gate.id)">
							{{ $t("raukk_sourcing.gates.remove") }}
						</PButton>
					</div>
				</td>
			</tr>
			<tr v-if="rows.length === 0">
				<td colspan="10" class="text-center text-white/50">
					{{ $t("raukk_sourcing.gates.empty") }}
				</td>
			</tr>
			<tr>
				<td colspan="10">
					<div class="flex flex-row flex-wrap gap-3 child:my-auto">
						<PInput
							v-model:value="refAddName"
							class="w-45!"
							size="sm"
							:placeholder="
								$t('raukk_sourcing.gates.name_placeholder')
							" />
						<PInput
							v-model:value="refAddA"
							class="w-40!"
							size="sm"
							:placeholder="
								$t('raukk_sourcing.gates.planet_a_placeholder')
							" />
						<PInput
							v-model:value="refAddB"
							class="w-40!"
							size="sm"
							:placeholder="
								$t('raukk_sourcing.gates.planet_b_placeholder')
							" />
						<PSelect
							class="w-45!"
							:value="refAddStatus"
							:options="statusOptions"
							@update:value="
								(v) =>
									(refAddStatus =
										v as RAUKK_PLANNED_GATE_STATUS)
							" />
						<PButton
							size="sm"
							type="primary"
							:disabled="!canAdd"
							@click="addGate">
							{{ $t("raukk_sourcing.gates.add") }}
						</PButton>
						<span
							v-if="addHint !== ''"
							:class="
								addHint === 'empty'
									? 'text-white/50'
									: 'text-red-400'
							">
							{{ $t(`raukk_sourcing.gates.hint.${addHint}`) }}
						</span>
					</div>
				</td>
			</tr>
		</tbody>
	</PTable>

	<div v-if="totals.enabled > 0" class="pt-3 text-amber-400">
		{{
			$t("raukk_sourcing.gates.planning_warning", {
				count: totals.enabled,
			})
		}}
	</div>
</template>
