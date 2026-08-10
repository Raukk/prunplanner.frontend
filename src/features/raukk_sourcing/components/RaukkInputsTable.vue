<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";
	import RaukkLocalPriceInput from "@/features/raukk_sourcing/components/RaukkLocalPriceInput.vue";
	import RaukkSourceCell from "@/features/raukk_sourcing/components/RaukkSourceCell.vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PTable, PTag, PTooltip } from "@/ui";

	// Types & Interfaces
	import {
		IRaukkLocalPrice,
		IRaukkTickerSource,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import {
		IRaukkInputRow,
		IRaukkSourceOption,
	} from "@/features/raukk_sourcing/raukkSourcingUi.types";
	import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

	const props = defineProps({
		rows: {
			type: Array as PropType<IRaukkInputRow[]>,
			required: true,
		},
		sourceOptions: {
			type: Function as PropType<
				(ticker: string, unitsPerDay: number) => IRaukkSourceOption[]
			>,
			required: true,
		},
		repairCostPerDay: {
			type: Number,
			required: true,
		},
		/** Shows the freight column; while off every row ships for 0 and
		 * the table renders exactly as it did before shipping existed */
		shippingEnabled: {
			type: Boolean,
			required: false,
			default: false,
		},
		/** Exchange data per ticker, backs the LM buy market bases */
		exchangePrices: {
			type: Object as PropType<Record<string, IRaukkExchangePrices>>,
			required: false,
			default: () => ({}),
		},
		/** Exchange those market bases read, e.g. `AI1` or `UNIVERSE` */
		exchangeCode: {
			type: String,
			required: false,
			default: "",
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const emit = defineEmits<{
		(
			e: "update:source",
			ticker: string,
			source: IRaukkTickerSource | undefined
		): void;
	}>();

	/**
	 * Ad price of a locally bought input, undefined while the ticker is
	 * bought at the exchange or drawn from another plan.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkInputRow} row Input Row
	 * @returns {IRaukkLocalPrice | undefined} Ad Price
	 */
	function localPrice(row: IRaukkInputRow): IRaukkLocalPrice | undefined {
		return row.source?.mode === "local" ? row.source.price : undefined;
	}

	const totalCostPerDay: ComputedRef<number> = computed(() =>
		props.rows.reduce((sum, row) => sum + row.costPerDay, 0)
	);

	const totalShippingPerDay: ComputedRef<number> = computed(() =>
		props.rows.reduce(
			(sum, row) => sum + row.shippedUnitsPerDay * row.shippingPerUnit,
			0
		)
	);

	/** Columns left of the value column, drives the footer colspans */
	const labelColumns: ComputedRef<number> = computed(() =>
		props.shippingEnabled ? 6 : 5
	);

	/** One display group of input rows */
	interface IRaukkInputRowGroup {
		key: "workforce" | "repair" | "production";
		rows: IRaukkInputRow[];
	}

	/**
	 * Rows grouped for display: workforce consumables, then repair
	 * materials, then production inputs. A ticker belonging to several
	 * buckets — rare, e.g. a prefab that is also a recipe input — repeats
	 * in every matching group; both rows show the tickers total daily
	 * need and share one source configuration. Within a group the
	 * incoming sort order stays.
	 */
	const rowGroups: ComputedRef<IRaukkInputRowGroup[]> = computed(() => {
		const workforce: IRaukkInputRowGroup = { key: "workforce", rows: [] };
		const repair: IRaukkInputRowGroup = { key: "repair", rows: [] };
		const production: IRaukkInputRowGroup = { key: "production", rows: [] };

		props.rows.forEach((row) => {
			if (row.buckets.workforce) workforce.rows.push(row);
			if (row.buckets.repair) repair.rows.push(row);

			// rows without any bucket flag must not vanish
			if (
				row.buckets.production ||
				(!row.buckets.workforce && !row.buckets.repair)
			)
				production.rows.push(row);
		});

		return [workforce, repair, production].filter(
			(group) => group.rows.length > 0
		);
	});
</script>

<template>
	<PTable striped>
		<thead>
			<tr>
				<th>{{ $t("raukk_sourcing.inputs.ticker") }}</th>
				<th>{{ $t("raukk_sourcing.inputs.buckets") }}</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.inputs.daily_need") }}
				</th>
				<th>
					{{ $t("raukk_sourcing.inputs.source") }}
					<PTooltip>
						<template #trigger>
							<span class="pl-1 text-white/40 hover:cursor-help">
								(i)
							</span>
						</template>
						{{ $t("raukk_sourcing.inputs.lm_buy_tooltip") }}
					</PTooltip>
				</th>
				<th v-if="shippingEnabled" class="text-right!">
					{{ $t("raukk_sourcing.inputs.shipping_price") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.inputs.effective_price") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.inputs.line_cost") }}
				</th>
			</tr>
		</thead>
		<tbody>
			<template
				v-for="group in rowGroups"
				:key="`RAUKKINPUTGROUP#${group.key}`">
				<tr>
					<td
						:colspan="labelColumns + 1"
						class="font-bold text-white/60">
						{{ $t(`raukk_sourcing.inputs.groups.${group.key}`) }}
					</td>
				</tr>
				<tr
					v-for="row in group.rows"
					:key="`RAUKKINPUT#${group.key}#${row.ticker}`">
					<td>
						<MaterialTile
							:key="`RAUKKSOURCING#Material#${row.ticker}`"
							:ticker="row.ticker" />
					</td>
					<td>
						<div class="flex flex-row gap-x-1">
							<PTag v-if="row.buckets.production" size="sm">
								{{ $t("raukk_sourcing.buckets.production") }}
							</PTag>
							<PTag
								v-if="row.buckets.workforce"
								size="sm"
								type="secondary">
								{{ $t("raukk_sourcing.buckets.workforce") }}
							</PTag>
							<PTag
								v-if="row.buckets.repair"
								size="sm"
								type="warning">
								{{ $t("raukk_sourcing.buckets.repair") }}
							</PTag>
						</div>
					</td>
					<td class="text-right">
						{{ formatNumber(row.unitsPerDay) }}
					</td>
					<td>
						<div class="flex flex-col gap-y-1">
							<RaukkSourceCell
								:source="row.source"
								:from-default="row.fromDefault"
								:options="
									sourceOptions(row.ticker, row.unitsPerDay)
								"
								:disabled="disabled"
								@update:source="
									(source) =>
										emit('update:source', row.ticker, source)
								" />
							<RaukkLocalPriceInput
								:price="localPrice(row)"
								:exchange="exchangePrices[row.ticker]"
								:exchange-code="exchangeCode"
								:disabled="disabled"
								@update:price="
									(price) =>
										emit('update:source', row.ticker, {
											mode: 'local',
											price,
										})
								" />
						</div>
					</td>
					<td v-if="shippingEnabled" class="text-right text-white/60">
						{{ formatNumber(row.shippingPerUnit) }}
					</td>
					<td class="text-right">
						{{ formatNumber(row.effectivePrice) }}
					</td>
					<td class="text-right">
						{{ formatNumber(row.costPerDay) }}
					</td>
				</tr>
			</template>
			<tr v-if="rows.length === 0">
				<td
					:colspan="labelColumns + 1"
					class="text-center text-white/50">
					{{ $t("raukk_sourcing.inputs.empty") }}
				</td>
			</tr>
		</tbody>
		<tfoot v-if="rows.length > 0">
			<tr class="font-bold">
				<td :colspan="labelColumns">
					{{ $t("raukk_sourcing.inputs.total_cost") }}
				</td>
				<td class="text-right">
					{{ formatNumber(totalCostPerDay) }}
				</td>
			</tr>
			<tr v-if="shippingEnabled">
				<td :colspan="labelColumns">
					{{ $t("raukk_sourcing.inputs.shipping_cost") }}
					<!-- freight and the fuel burnt flying it are a FLEET
					 cost: one fleet serves every base, so it is priced and
					 sourced once on the shipping page instead of base by
					 base -->
					<RouterLink
						to="/shipping?section=sourcing"
						class="pl-1 font-normal text-white/50 hover:underline">
						{{ $t("raukk_sourcing.inputs.shipping_cost_link") }}
					</RouterLink>
				</td>
				<td class="text-right">
					{{ formatNumber(totalShippingPerDay) }}
				</td>
			</tr>
			<tr>
				<td :colspan="labelColumns">
					{{ $t("raukk_sourcing.inputs.repair_cost") }}
				</td>
				<td class="text-right">
					{{ formatNumber(repairCostPerDay) }}
				</td>
			</tr>
		</tfoot>
	</PTable>
</template>
