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
		raukkPlannedGateLabel,
		raukkPlannedGateRangeUpgrades,
		raukkPlannedGateUpgrades,
	} from "@/features/raukk_sourcing/calculations/gatePlanning";
	import {
		IRaukkGateSpecs,
		IRaukkGateUpgrades,
		RAUKK_GATE_NO_UPGRADES,
		RAUKK_GATE_UPGRADE,
		RAUKK_GATE_UPGRADE_BUDGET,
		raukkGateSpecs,
		raukkGateUpgradeBudgetLeft,
		raukkGateUpgradeCeiling,
	} from "@/features/raukk_sourcing/calculations/gateCosts";
	import {
		resolveSystemId,
		straightLineParsecs,
	} from "@/features/raukk_sourcing/calculations/routeDistance";

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

	const { rows, totals, pricesLoaded } = useRaukkGatePlanning();

	/**
	 * Upgrade levels one track may take on one gate, as options.
	 *
	 * Bounded by the SHARED budget, not only by the track's own maximum:
	 * a gate holds five levels over all three tracks, so what is on offer
	 * for one track depends on what the other two already spent.
	 */
	function levelOptions(
		track: RAUKK_GATE_UPGRADE,
		gate: IRaukkPlannedGate
	): { label: string; value: number }[] {
		const upgrades: IRaukkGateUpgrades = raukkPlannedGateUpgrades(gate);
		const ceiling: number = raukkGateUpgradeCeiling(track, upgrades);

		return Array.from({ length: ceiling + 1 }, (_, level) => ({
			label: `${level} — ${trackEffect(track, level)}`,
			value: level,
		}));
	}

	/** What `level` levels of one track buy, in that track's own unit */
	function trackEffect(track: RAUKK_GATE_UPGRADE, level: number): string {
		const specs: IRaukkGateSpecs = raukkGateSpecs({
			...RAUKK_GATE_NO_UPGRADES,
			[track]: level,
		});

		if (track === "volume")
			return `${formatNumber(specs.maxShipVolumeM3)} m³`;
		if (track === "range")
			return `${formatNumber(specs.linkingRangeParsecs)} pc`;

		return `${formatNumber(specs.usesPerDay)}/d`;
	}

	/** Levels of the five-level budget this gate has left */
	function budgetLeft(gate: IRaukkPlannedGate): number {
		return raukkGateUpgradeBudgetLeft(raukkPlannedGateUpgrades(gate));
	}

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

		// a gap no gate can span, however upgraded, is worth saying before
		// the row is added rather than after
		const gap: number | null = straightLineParsecs(systemA, systemB);

		if (gap !== null && raukkPlannedGateRangeUpgrades(gap) === null)
			return "unreachable_range";

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
				// the gap decides the range upgrades: a gate that cannot
				// reach its own far end is not a plan, it is a typo
				rangeUpgrades: minimumRange(enteredA.value, enteredB.value),
				enabled: false,
				status: refAddStatus.value,
			}
		);

		refAddA.value = null;
		refAddB.value = null;
		refAddName.value = null;
	}

	/** Fewest range upgrades the gap between two planets needs */
	function minimumRange(planetA: string, planetB: string): number {
		const systemA: string | null = resolveSystemId(planetA);
		const systemB: string | null = resolveSystemId(planetB);

		if (systemA === null || systemB === null) return 0;

		const gap: number | null = straightLineParsecs(systemA, systemB);

		return gap === null ? 0 : (raukkPlannedGateRangeUpgrades(gap) ?? 0);
	}

	function patchGate(
		gateId: string,
		patch: Partial<IRaukkPlannedGate>
	): void {
		sourcingStore.setPlannedGate(gateId, patch);
	}

	/** The three tracks, in the order the GTWI panel lists them */
	const UPGRADE_TRACKS: RAUKK_GATE_UPGRADE[] = [
		"capacity",
		"volume",
		"range",
	];

	/** Stored level of one track */
	function upgradeLevel(
		gate: IRaukkPlannedGate,
		track: RAUKK_GATE_UPGRADE
	): number {
		return raukkPlannedGateUpgrades(gate)[track];
	}

	/** Stores one upgrade level; the store owns the budget clamping */
	function patchUpgrade(
		gateId: string,
		track: RAUKK_GATE_UPGRADE,
		value: unknown
	): void {
		const level: number = Number(value);

		if (track === "capacity")
			patchGate(gateId, { capacityUpgrades: level });
		else if (track === "volume")
			patchGate(gateId, { volumeUpgrades: level });
		else patchGate(gateId, { rangeUpgrades: level });
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

	/**
	 * The material bill of one link, biggest positions first.
	 *
	 * Only the head of it: the full bill is 28 tickers and reads as noise,
	 * while the handful that dominate it are the whole story.
	 */
	function materialsLabel(row: IRaukkGatePlanningRow): string {
		return Object.entries(row.materials)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 8)
			.map(([ticker, amount]) => `${formatNumber(amount)} ${ticker}`)
			.join(", ");
	}

	/** Range upgrades a row still needs, or null when it is fine */
	function rangeShortfall(row: IRaukkGatePlanningRow): number | null {
		return row.value.issue === "out_of_range"
			? row.value.rangeUpgradesNeeded
			: null;
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
				<th>{{ $t("raukk_sourcing.gates.upgrades") }}</th>
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
				<th class="text-right!">
					{{ $t("raukk_sourcing.gates.build_cost") }}
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
									{{
										rangeShortfall(row) === null
											? $t(
													"raukk_sourcing.gates.unrouted"
												)
											: $t(
													"raukk_sourcing.gates.out_of_range_tag"
												)
									}}
								</PTag>
							</template>
							{{
								$t(
									`raukk_sourcing.gates.issue.${row.value.issue}`,
									{
										needed:
											row.value.rangeUpgradesNeeded ?? 0,
									}
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
				<td>
					<div class="flex flex-col gap-y-1">
						<div
							v-for="track in UPGRADE_TRACKS"
							:key="`RAUKKGATEUP#${row.gate.id}#${track}`"
							class="flex flex-row gap-x-2 child:my-auto">
							<span class="w-14 text-white/60 text-xs">
								{{ $t(`raukk_sourcing.gates.track.${track}`) }}
							</span>
							<PSelect
								class="w-33!"
								:value="upgradeLevel(row.gate, track)"
								:options="levelOptions(track, row.gate)"
								@update:value="
									(v) => patchUpgrade(row.gate.id, track, v)
								" />
						</div>
						<span class="text-xs text-white/40">
							{{
								$t("raukk_sourcing.gates.budget_left", {
									left: budgetLeft(row.gate),
									total: RAUKK_GATE_UPGRADE_BUDGET,
								})
							}}
						</span>
					</div>
				</td>
				<td class="text-right">
					{{
						row.value.parsecs === null
							? "—"
							: formatNumber(row.value.parsecs)
					}}
				</td>
				<td class="text-right">
					{{ hours(row.value.traversalMinutes) }}
				</td>
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
				<td class="text-right">
					<PTooltip>
						<template #trigger>
							<span class="hover:cursor-help">
								{{
									pricesLoaded
										? formatNumber(row.buildCostAic)
										: "…"
								}}
							</span>
						</template>
						{{
							$t("raukk_sourcing.gates.build_cost_tooltip", {
								materials: materialsLabel(row),
							})
						}}
					</PTooltip>
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
				<td colspan="11" class="text-center text-white/50">
					{{ $t("raukk_sourcing.gates.empty") }}
				</td>
			</tr>
			<tr>
				<td colspan="11">
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

	<div class="pt-3 text-white/50">
		{{
			$t("raukk_sourcing.gates.cost_note", {
				budget: RAUKK_GATE_UPGRADE_BUDGET,
			})
		}}
	</div>

	<div
		v-if="rows.length > 0"
		class="pt-3 flex flex-row gap-x-2 child:my-auto font-bold">
		<span class="w-60">
			{{ $t("raukk_sourcing.gates.rollup_build") }}
		</span>
		<span>
			{{ pricesLoaded ? formatNumber(totals.buildCostAic) : "…" }}
		</span>
	</div>

	<div v-if="totals.enabled > 0" class="pt-3 text-amber-400">
		{{
			$t("raukk_sourcing.gates.planning_warning", {
				count: totals.enabled,
			})
		}}
	</div>
</template>
