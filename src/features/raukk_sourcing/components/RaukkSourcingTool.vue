<script setup lang="ts">
	import { computed, ComputedRef, PropType, ref, Ref, toRef } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Stores
	import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
	const sourcingStore = useRaukkSourcingStore();

	// Composables
	import { useRaukkSnapshot } from "@/features/raukk_sourcing/useRaukkSnapshot";
	import { useRaukkChainRecompute } from "@/features/raukk_sourcing/useRaukkChainRecompute";

	// Components
	import RaukkBaseTransportSection from "@/features/raukk_sourcing/components/RaukkBaseTransportSection.vue";
	import RaukkInputsTable from "@/features/raukk_sourcing/components/RaukkInputsTable.vue";
	import RaukkOutputsTable from "@/features/raukk_sourcing/components/RaukkOutputsTable.vue";
	import RaukkSourcingDefaults from "@/features/raukk_sourcing/components/RaukkSourcingDefaults.vue";
	import RaukkShippingSection from "@/features/raukk_sourcing/components/RaukkShippingSection.vue";

	// Calculations
	import {
		raukkShipTimeOver,
		raukkShipTimePercent,
	} from "@/features/raukk_sourcing/calculations/shippingChainDisplay";

	// Util
	import { formatDate } from "@/util/date";
	import { formatNumber } from "@/util/numbers";

	// UI
	import {
		PButton,
		PInputNumber,
		PSelect,
		PTag,
		PTooltip,
		PInput,
	} from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import { IPlanResult } from "@/features/planning/usePlanCalculation.types";
	import {
		IRaukkLocalPrice,
		IRaukkTickerSource,
		RAUKK_REPAIR_DAY,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";

	const props = defineProps({
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		planName: {
			type: String,
			required: false,
			default: "",
		},
		planetNaturalId: {
			type: String,
			required: true,
		},
		cxUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		planResult: {
			type: Object as PropType<IPlanResult>,
			required: true,
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const {
		config,
		shippingConfig,
		caps,
		shippingPairs,
		repairBillCost,
		inputRows,
		outputRows,
		exchangePrices,
		cxExchangeCode,
		repairCost,
		snapshot,
		staleSources,
		sourceOptions,
		computeSnapshot,
	} = await useRaukkSnapshot({
		planUuid: toRef(props, "planUuid"),
		planName: toRef(props, "planName"),
		planetNaturalId: toRef(props, "planetNaturalId"),
		cxUuid: toRef(props, "cxUuid"),
		planResult: computed(() => props.planResult),
	});

	/** Configuration is read only without a stored plan uuid as well */
	const readOnly: ComputedRef<boolean> = computed(
		() => props.disabled || props.planUuid === undefined
	);

	/** Plan names of every stored snapshot, labels the shipping lanes */
	const planNames: ComputedRef<Record<string, string>> = computed(() =>
		Object.fromEntries(
			Object.entries(sourcingStore.snapshots).map(([uuid, stored]) => [
				uuid,
				stored.planName,
			])
		)
	);

	/**
	 * Ship time of this plan as the percentage every other shipping
	 * surface reads it in — the chain tables and the fleet table both show
	 * this share as a percentage, and one quantity gets one unit.
	 *
	 * @author raukk
	 *
	 * @param {number | null} shippingFraction Ship time share
	 * @returns {string} Percentage label, an em-dash where unknown
	 */
	function shipTimeLabel(shippingFraction: number | null): string {
		const percent: number | null = raukkShipTimePercent(shippingFraction);

		return percent === null ? "—" : `${formatNumber(percent)} %`;
	}

	const repairDayOptions: ComputedRef<PSelectOption[]> = computed(() =>
		[30, 60, 90, 120].map((day) => ({ label: `${day}`, value: day }))
	);

	function changeRepairDay(day: RAUKK_REPAIR_DAY): void {
		if (readOnly.value || !props.planUuid) return;

		sourcingStore.setRepairDay(props.planUuid, day);
	}

	/**
	 * Stores or clears one cadence override of the open plan, days per
	 * visit. An empty field clears the override and the account default
	 * applies again — which is exactly what the placeholder shows.
	 *
	 * @author raukk
	 *
	 * @param {RAUKK_CARGO_BUCKET} bucket Cargo Bucket
	 * @param {number | null} days Days per visit, null clears
	 */
	function changeCadence(
		bucket: RAUKK_CARGO_BUCKET,
		days: number | null
	): void {
		if (readOnly.value || !props.planUuid) return;

		sourcingStore.setPlanCadence(props.planUuid, bucket, days ?? undefined);
	}

	function changeSource(
		ticker: string,
		source: IRaukkTickerSource | undefined
	): void {
		if (readOnly.value || !props.planUuid) return;

		if (source === undefined) {
			sourcingStore.clearTickerSource(props.planUuid, ticker);
			return;
		}

		sourcingStore.setTickerSource(props.planUuid, ticker, source);
	}

	/**
	 * Local market sale ads of the open plan, keyed by output ticker.
	 * Read straight from the stored configuration rather than from the
	 * output rows: the flag is configuration, not a computed result.
	 */
	const localSales: ComputedRef<Record<string, IRaukkLocalPrice>> = computed(
		() =>
			props.planUuid
				? (sourcingStore.configs[props.planUuid]?.localSales ?? {})
				: {}
	);

	/**
	 * Flags or unflags one output ticker of the open plan as sold on the
	 * local market of its own planet.
	 *
	 * @author raukk
	 *
	 * @param {string} ticker Output Material Ticker
	 * @param {IRaukkLocalPrice | undefined} price Ad price, undefined clears
	 */
	function changeLocalSale(
		ticker: string,
		price: IRaukkLocalPrice | undefined
	): void {
		if (readOnly.value || !props.planUuid) return;

		if (price === undefined) {
			sourcingStore.clearLocalSale(props.planUuid, ticker);
			return;
		}

		sourcingStore.setLocalSale(props.planUuid, ticker, price);
	}

	/*
	 * Snapshot actions
	 */

	const refIsComputing: Ref<boolean> = ref(false);
	const refComputeError: Ref<string | undefined> = ref(undefined);

	async function compute(): Promise<void> {
		refIsComputing.value = true;
		refComputeError.value = undefined;

		try {
			await computeSnapshot();
		} catch (error) {
			refComputeError.value = t("raukk_sourcing.controls.compute_error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		} finally {
			refIsComputing.value = false;
		}
	}

	/*
	 * Chain recomputation
	 */

	const {
		running: chainRunning,
		current: chainCurrent,
		done: chainDone,
		total: chainTotal,
		errors: chainErrors,
		recomputeChain,
	} = useRaukkChainRecompute();

	/** Any snapshot action is blocked while a chain run is going on */
	const busy: ComputedRef<boolean> = computed(
		() => refIsComputing.value || chainRunning.value
	);

	/** 1 based position of the plan currently being recomputed */
	const chainStep: ComputedRef<number> = computed(() =>
		Math.min(chainDone.value + 1, chainTotal.value)
	);

	async function recompute(): Promise<void> {
		if (readOnly.value || !props.planUuid) return;

		await recomputeChain(props.planUuid);
	}

	/*
	 * Import & Export
	 */

	const refShowImport: Ref<boolean> = ref(false);
	const refImportPayload: Ref<string | null> = ref(null);
	const refImportMessage: Ref<string | undefined> = ref(undefined);
	const refImportFailed: Ref<boolean> = ref(false);
	const refFileInput: Ref<HTMLInputElement | null> = ref(null);

	function exportJSON(): void {
		const blob: Blob = new Blob([sourcingStore.exportJSON()], {
			type: "application/json;charset=utf-8;",
		});

		const url: string = URL.createObjectURL(blob);
		const link: HTMLAnchorElement = document.createElement("a");
		link.href = url;
		link.setAttribute("download", "PRUNplannerSourcing.json");

		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		URL.revokeObjectURL(url);
	}

	function applyImport(payload: string): void {
		try {
			sourcingStore.importJSON(payload);

			refImportFailed.value = false;
			refImportMessage.value = t(
				"raukk_sourcing.controls.import_success"
			);
			refShowImport.value = false;
			refImportPayload.value = null;
		} catch (error) {
			refImportFailed.value = true;
			refImportMessage.value = t("raukk_sourcing.controls.import_error", {
				message: error instanceof Error ? error.message : "unknown",
			});
		}
	}

	async function handleFileChange(event: Event): Promise<void> {
		const target: HTMLInputElement = event.target as HTMLInputElement;
		const file: File | undefined = target.files?.[0];

		if (file) applyImport(await file.text());

		target.value = "";
	}
</script>

<template>
	<h2 class="pb-3 text-white/80 font-bold text-lg">
		{{ $t("raukk_sourcing.title") }}
	</h2>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.info") }}
	</div>

	<div
		class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-3 justify-between">
		<div class="flex flex-row flex-wrap gap-3 child:my-auto">
			<div class="font-bold">
				{{ $t("raukk_sourcing.controls.repair_day") }}
			</div>
			<PSelect
				class="w-25!"
				:value="config.repairDay"
				:options="repairDayOptions"
				:disabled="readOnly"
				@update:value="
					(v) => changeRepairDay(Number(v) as RAUKK_REPAIR_DAY)
				" />

			<PTooltip>
				<template #trigger>
					<div class="font-bold pl-3 hover:cursor-help">
						{{ $t("raukk_sourcing.controls.cadence") }}
					</div>
				</template>
				{{ $t("raukk_sourcing.controls.cadence_tooltip") }}
			</PTooltip>
			<PInputNumber
				class="min-w-25"
				:min="1"
				:disabled="readOnly"
				:placeholder="String(caps.production)"
				:value="config.cadence?.production ?? null"
				@update:value="(v) => changeCadence('production', v ?? null)" />
			<PInputNumber
				class="min-w-25"
				:min="1"
				:disabled="readOnly"
				:placeholder="String(caps.workforce)"
				:value="config.cadence?.workforce ?? null"
				@update:value="(v) => changeCadence('workforce', v ?? null)" />
			<PInputNumber
				class="min-w-25"
				:min="1"
				:disabled="readOnly"
				:placeholder="String(caps.repair)"
				:value="config.cadence?.repair ?? null"
				@update:value="(v) => changeCadence('repair', v ?? null)" />

			<PButton
				type="primary"
				:loading="refIsComputing"
				:disabled="readOnly || busy"
				@click="compute">
				{{ $t("raukk_sourcing.controls.compute") }}
			</PButton>

			<PTooltip>
				<template #trigger>
					<PButton
						:loading="chainRunning"
						:disabled="readOnly || busy"
						@click="recompute">
						{{ $t("raukk_sourcing.controls.recompute_chain") }}
					</PButton>
				</template>
				{{ $t("raukk_sourcing.controls.recompute_chain_tooltip") }}
			</PTooltip>

			<span v-if="chainRunning" class="text-white/60">
				{{
					$t("raukk_sourcing.controls.recompute_chain_progress", {
						done: chainStep,
						total: chainTotal,
						name: chainCurrent ?? "",
					})
				}}
			</span>
		</div>

		<div class="flex flex-row flex-wrap gap-3 child:my-auto">
			<PButton type="secondary" @click="exportJSON">
				{{ $t("raukk_sourcing.controls.export") }}
			</PButton>
			<PButton type="secondary" @click="refShowImport = !refShowImport">
				{{ $t("raukk_sourcing.controls.import") }}
			</PButton>
		</div>
	</div>

	<!-- account wide and therefore always editable: the defaults belong to
	the users own account, not to the plan that happens to be open -->
	<div class="mt-3 border rounded-[3px] border-white/20 p-3">
		<RaukkSourcingDefaults />
	</div>

	<div v-if="refShowImport" class="pt-3 flex flex-col gap-3">
		<PInput
			v-model:value="refImportPayload"
			type="textarea"
			:rows="4"
			:placeholder="$t('raukk_sourcing.controls.import_placeholder')" />
		<div class="flex flex-row gap-3">
			<PButton
				type="primary"
				:disabled="!refImportPayload"
				@click="applyImport(refImportPayload ?? '')">
				{{ $t("raukk_sourcing.controls.import_apply") }}
			</PButton>
			<input
				ref="refFileInput"
				type="file"
				accept=".json"
				style="display: none"
				@change="handleFileChange" />
			<PButton type="secondary" @click="refFileInput?.click()">
				{{ $t("raukk_sourcing.controls.import_file") }}
			</PButton>
			<PButton type="secondary" @click="refShowImport = false">
				{{ $t("raukk_sourcing.controls.import_cancel") }}
			</PButton>
		</div>
	</div>

	<div v-if="refComputeError" class="pt-3">
		<span class="text-negative">{{ refComputeError }}</span>
	</div>

	<div v-if="chainErrors.length > 0" class="pt-3 flex flex-col">
		<span
			v-for="chainError in chainErrors"
			:key="chainError.planUuid"
			class="text-negative">
			{{
				$t("raukk_sourcing.controls.recompute_chain_error", {
					name: chainError.planName,
					message: chainError.message,
				})
			}}
		</span>
	</div>

	<div v-if="refImportMessage" class="pt-3">
		<span :class="refImportFailed ? 'text-negative' : 'text-positive'">
			{{ refImportMessage }}
		</span>
	</div>

	<div class="pt-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<template v-if="snapshot">
			<span class="text-white/60">
				{{
					$t("raukk_sourcing.snapshot.computed_at", {
						timestamp: formatDate(
							new Date(snapshot.computedAt),
							"YYYY-MM-DD HH:mm"
						),
					})
				}}
			</span>
			<PTag size="sm" :type="snapshot.stale ? 'error' : 'success'">
				{{
					snapshot.stale
						? $t("raukk_sourcing.snapshot.stale")
						: $t("raukk_sourcing.snapshot.current")
				}}
			</PTag>
			<PTooltip v-if="snapshot.baseFraction !== undefined">
				<template #trigger>
					<span class="text-white/60 hover:cursor-help">
						{{
							$t("raukk_sourcing.snapshot.base_fraction", {
								value: formatNumber(snapshot.baseFraction),
							})
						}}
					</span>
				</template>
				{{ $t("raukk_sourcing.snapshot.base_fraction_tooltip") }}
			</PTooltip>
			<PTooltip v-if="snapshot.shippingFraction !== undefined">
				<template #trigger>
					<RouterLink to="/shipping">
						<span
							class="hover:underline"
							:class="
								raukkShipTimeOver(snapshot.shippingFraction)
									? 'text-negative font-bold'
									: 'text-white/60'
							">
							{{
								$t(
									"raukk_sourcing.snapshot.shipping_fraction",
									{
										value: shipTimeLabel(
											snapshot.shippingFraction
										),
									}
								)
							}}
						</span>
					</RouterLink>
				</template>
				{{ $t("raukk_sourcing.snapshot.shipping_fraction_tooltip") }}
				{{ $t("raukk_sourcing.snapshot.shipping_fraction_link_hint") }}
			</PTooltip>
		</template>
		<span v-else class="text-white/60">
			{{ $t("raukk_sourcing.snapshot.never") }}
		</span>

		<PTag v-if="staleSources.length > 0" size="sm" type="warning">
			{{
				$t("raukk_sourcing.snapshot.stale_sources", {
					count: staleSources.length,
				})
			}}
		</PTag>
	</div>

	<div v-if="props.planUuid === undefined" class="pt-3 text-white/50">
		{{ $t("raukk_sourcing.unsaved_plan") }}
	</div>
	<div v-else-if="props.disabled" class="pt-3 text-white/50">
		{{ $t("raukk_sourcing.read_only") }}
	</div>

	<RaukkShippingSection
		:plan-uuid="planUuid"
		:pairs="shippingPairs"
		:repair-bill-cost="repairBillCost"
		:caps="caps"
		:plan-names="planNames"
		:disabled="readOnly" />

	<RaukkBaseTransportSection
		v-if="shippingConfig.enabled && planUuid !== undefined"
		:plan-uuid="planUuid"
		:planet-natural-id="planetNaturalId" />

	<h3 class="font-bold py-3">
		{{ $t("raukk_sourcing.inputs_title") }}
	</h3>
	<RaukkInputsTable
		:rows="inputRows"
		:source-options="sourceOptions"
		:repair-cost-per-day="repairCost.total"
		:shipping-enabled="shippingConfig.enabled"
		:exchange-prices="exchangePrices"
		:exchange-code="cxExchangeCode"
		:disabled="readOnly"
		@update:source="changeSource" />

	<h3 class="font-bold py-3">
		{{ $t("raukk_sourcing.outputs_title") }}
	</h3>
	<RaukkOutputsTable
		:rows="outputRows"
		:local-sales="localSales"
		:exchange-prices="exchangePrices"
		:exchange-code="cxExchangeCode"
		:read-only="readOnly"
		@update:local-sale="changeLocalSale" />
</template>
