<script setup lang="ts">
	import { computed, ComputedRef, PropType } from "vue";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Components
	import MaterialTile from "@/features/material_tile/components/MaterialTile.vue";
	import RaukkLocalPriceInput from "@/features/raukk_sourcing/components/RaukkLocalPriceInput.vue";
	import RaukkSourceCell from "@/features/raukk_sourcing/components/RaukkSourceCell.vue";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PSelect, PTable, PTag, PTooltip } from "@/ui";
	import { PSelectOption } from "@/ui/ui.types";

	// Types & Interfaces
	import {
		IRaukkLocalPrice,
		IRaukkTickerSource,
		RAUKK_PRICE_MODE,
	} from "@/features/raukk_sourcing/raukkSourcing.types";
	import {
		IRaukkInputRow,
		IRaukkSourceOption,
	} from "@/features/raukk_sourcing/raukkSourcingUi.types";
	import { IRaukkExchangePrices } from "@/features/raukk_sourcing/calculations/raukkCalculations.types";

	/** Sentinel of the "no configuration, use CX preference" entry */
	const DEFAULT_MODE: string = "DEFAULT";

	/** Sentinel of the "CX preference, ignore the account default" entry */
	const CX_MODE: string = "CX";

	/** Sentinel of the "bought on the local market here" entry */
	const LOCAL_MODE: string = "LOCAL";

	/** Ad price a freshly picked local buy starts from */
	const DEFAULT_LOCAL_PRICE: IRaukkLocalPrice = { basis: "BID", value: 0 };

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

	const priceModeOptions: ComputedRef<PSelectOption[]> = computed(() => [
		{ label: t("raukk_sourcing.price_modes.default"), value: DEFAULT_MODE },
		{ label: t("raukk_sourcing.price_modes.cx"), value: CX_MODE },
		{ label: t("raukk_sourcing.price_modes.BID"), value: "BID" },
		{ label: t("raukk_sourcing.price_modes.ASK"), value: "ASK" },
		{ label: t("raukk_sourcing.price_modes.MID"), value: "MID" },
		{ label: t("raukk_sourcing.price_modes.AVG7D"), value: "AVG7D" },
		{ label: t("raukk_sourcing.price_modes.AVG30D"), value: "AVG30D" },
		{ label: t("raukk_sourcing.inputs.lm_buy"), value: LOCAL_MODE },
	]);

	function priceModeValue(row: IRaukkInputRow): string {
		if (row.source?.mode === "local") return LOCAL_MODE;
		if (row.source?.mode === "cx") return CX_MODE;

		return row.source?.mode === "market"
			? row.source.priceMode
			: DEFAULT_MODE;
	}

	function changePriceMode(row: IRaukkInputRow, value: string): void {
		if (value === DEFAULT_MODE) {
			emit("update:source", row.ticker, undefined);
			return;
		}

		if (value === CX_MODE) {
			emit("update:source", row.ticker, { mode: "cx" });
			return;
		}

		if (value === LOCAL_MODE) {
			emit("update:source", row.ticker, {
				mode: "local",
				price: { ...DEFAULT_LOCAL_PRICE },
			});
			return;
		}

		emit("update:source", row.ticker, {
			mode: "market",
			priceMode: value as RAUKK_PRICE_MODE,
		});
	}

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

	/**
	 * Rows the input total is summed over.
	 *
	 * Ship fuel is EXCLUDED: its ȼ is already inside the shipping daily
	 * cost — the resolved ship profile prices every parsec and every
	 * sublight block with it — so summing the fuel rows on top would
	 * charge the plans fuel twice. The rows exist to source and to read.
	 */
	const costedRows: ComputedRef<IRaukkInputRow[]> = computed(() =>
		props.rows.filter((row) => !row.buckets.shipFuel)
	);

	const totalCostPerDay: ComputedRef<number> = computed(() =>
		costedRows.value.reduce((sum, row) => sum + row.costPerDay, 0)
	);

	const totalShippingPerDay: ComputedRef<number> = computed(() =>
		costedRows.value.reduce(
			(sum, row) => sum + row.shippedUnitsPerDay * row.shippingPerUnit,
			0
		)
	);

	/** Columns left of the value column, drives the footer colspans */
	const labelColumns: ComputedRef<number> = computed(() =>
		props.shippingEnabled ? 7 : 6
	);

	/** One display group of input rows */
	interface IRaukkInputRowGroup {
		key: "workforce" | "repair" | "production" | "shipFuel";
		rows: IRaukkInputRow[];
	}

	/**
	 * Rows grouped for display: workforce consumables, then repair
	 * materials, then production inputs, and last the ship fuel the plans
	 * lanes burn. A ticker belonging to several buckets — rare, e.g. a
	 * prefab that is also a recipe input — repeats in every matching
	 * group; both rows show the tickers total daily need and share one
	 * source configuration. Within a group the incoming sort order stays.
	 */
	const rowGroups: ComputedRef<IRaukkInputRowGroup[]> = computed(() => {
		const workforce: IRaukkInputRowGroup = { key: "workforce", rows: [] };
		const repair: IRaukkInputRowGroup = { key: "repair", rows: [] };
		const production: IRaukkInputRowGroup = { key: "production", rows: [] };
		const shipFuel: IRaukkInputRowGroup = { key: "shipFuel", rows: [] };

		props.rows.forEach((row) => {
			if (row.buckets.shipFuel) {
				shipFuel.rows.push(row);
				return;
			}

			if (row.buckets.workforce) workforce.rows.push(row);
			if (row.buckets.repair) repair.rows.push(row);

			// rows without any bucket flag must not vanish
			if (
				row.buckets.production ||
				(!row.buckets.workforce && !row.buckets.repair)
			)
				production.rows.push(row);
		});

		return [workforce, repair, production, shipFuel].filter(
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
					{{ $t("raukk_sourcing.inputs.price_mode") }}
					<PTooltip>
						<template #trigger>
							<span class="pl-1 text-white/40 hover:cursor-help">
								(i)
							</span>
						</template>
						{{ $t("raukk_sourcing.inputs.lm_buy_tooltip") }}
					</PTooltip>
				</th>
				<th>{{ $t("raukk_sourcing.inputs.source") }}</th>
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
							<PTag
								v-if="row.buckets.shipFuel"
								size="sm"
								type="success">
								{{ $t("raukk_sourcing.buckets.shipFuel") }}
							</PTag>
						</div>
					</td>
					<td class="text-right">
						{{ formatNumber(row.unitsPerDay) }}
					</td>
					<td>
						<div class="flex flex-col gap-y-1">
							<PSelect
								class="w-37.5!"
								:value="priceModeValue(row)"
								:options="priceModeOptions"
								:disabled="
									disabled || row.source?.mode === 'plan'
								"
								@update:value="
									(v) =>
										changePriceMode(
											row,
											String(v ?? DEFAULT_MODE)
										)
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
					<td>
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
