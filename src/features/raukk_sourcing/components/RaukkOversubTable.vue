<script setup lang="ts">
	import { PropType, ref, Ref } from "vue";
	import { RouteLocationRaw } from "vue-router";

	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Calculations
	import { raukkUtilizationBarWidth } from "@/features/raukk_sourcing/calculations/shippingFleetDisplay";

	// Util
	import { formatNumber } from "@/util/numbers";

	// UI
	import { PButton, PTable, PTag, PTooltip } from "@/ui";

	// Types & Interfaces
	import {
		IRaukkOversubFleetRow,
		IRaukkOversubRow,
		IRaukkOversubSegment,
		IRaukkOversubTickerRow,
	} from "@/features/raukk_sourcing/calculations/oversubReport.types";

	defineProps({
		/** Materials group rows, filtered and sorted by the section */
		tickerRows: {
			type: Array as PropType<IRaukkOversubTickerRow[]>,
			required: true,
		},
		/** Fleet group rows, filtered and sorted by the section */
		fleetRows: {
			type: Array as PropType<IRaukkOversubFleetRow[]>,
			required: true,
		},
		/** The fleet group only exists while shipping is charged */
		shippingEnabled: {
			type: Boolean,
			required: true,
		},
		/** Ship type label per ship type id, resolved by the section */
		shipTypeLabels: {
			type: Object as PropType<Record<string, string>>,
			required: true,
		},
		/** A sourcing recompute is in flight, every recompute button
		 * disables and its tooltip states the reason */
		recomputeBusy: {
			type: Boolean,
			required: true,
		},
	});

	// the table stays dumb: it emits the recompute intents, the section
	// owns the shared recompute instance and the busy gating
	const emit = defineEmits<{
		(e: "recompute-plan", planUuid: string): void;
		(e: "recompute-fleet"): void;
	}>();

	/** Keys of the rows whose subscriber breakdown is open */
	const refExpanded: Ref<Set<string>> = ref(new Set());

	/** Stable key of one row, either group */
	function rowKey(row: IRaukkOversubRow): string {
		return row.kind === "ticker"
			? `RAUKKOVERSUB#${row.producerPlanUuid}#${row.ticker}`
			: `RAUKKOVERSUBFLEET#${row.shipTypeId}`;
	}

	function toggle(row: IRaukkOversubRow): void {
		const key: string = rowKey(row);
		const next: Set<string> = new Set(refExpanded.value);

		if (next.has(key)) next.delete(key);
		else next.add(key);

		refExpanded.value = next;
	}

	/**
	 * Display label of one segment. An external segment's stored label is
	 * the builder's English string — the count is parsed back out of it
	 * and restated through i18n instead of trusting that string.
	 *
	 * @author raukk
	 *
	 * @param {IRaukkOversubSegment} segment One consumer claim
	 * @returns {string} Label the breakdown row shows
	 */
	function segmentLabel(segment: IRaukkOversubSegment): string {
		if (segment.segmentKind !== "external") return segment.label;

		const match: RegExpMatchArray | null =
			segment.label.match(/\((\d+) plans?\)/);
		if (match === null) return segment.label;

		return t("raukk_sourcing.oversub_report.breakdown.external", {
			count: match[1],
		});
	}

	/**
	 * Router target of one plan link, opening the sourcing tool via the
	 * PlanView `?tool=` deep link. Non-plan paths (fleet → /shipping)
	 * pass through untouched.
	 *
	 * @author raukk
	 *
	 * @param {string} path Plain path the report built
	 * @returns {RouteLocationRaw} Target the RouterLink navigates to
	 */
	function planLinkTarget(path: string): RouteLocationRaw {
		return path.startsWith("/plan/")
			? { path, query: { tool: "raukk-sourcing" } }
			: path;
	}

	/** Share of one claim against the row's net, "—" without one */
	function shareLabel(row: IRaukkOversubRow, amountPerDay: number): string {
		if (row.netPerDay <= 0)
			return t("raukk_sourcing.oversub_report.breakdown.share_na");

		return t("raukk_sourcing.oversub_report.breakdown.share", {
			share: formatNumber((amountPerDay / row.netPerDay) * 100),
		});
	}
</script>

<template>
	<h4 class="font-bold pb-3">
		{{ $t("raukk_sourcing.oversub_report.groups.materials") }}
	</h4>
	<PTable striped>
		<thead>
			<tr>
				<th></th>
				<th>
					{{ $t("raukk_sourcing.oversub_report.columns.ticker") }}
				</th>
				<th>
					{{ $t("raukk_sourcing.oversub_report.columns.producer") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.oversub_report.columns.gross") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.oversub_report.columns.self") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.oversub_report.columns.net") }}
				</th>
				<th class="text-right!">
					{{ $t("raukk_sourcing.oversub_report.columns.subscribed") }}
				</th>
				<th>
					{{
						$t("raukk_sourcing.oversub_report.columns.utilization")
					}}
				</th>
				<th>{{ $t("raukk_sourcing.oversub_report.columns.flags") }}</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			<template v-for="row in tickerRows" :key="rowKey(row)">
				<tr>
					<td>
						<span
							v-if="row.segments.length > 0"
							class="hover:cursor-pointer select-none text-white/50"
							@click="toggle(row)">
							{{ refExpanded.has(rowKey(row)) ? "▾" : "▸" }}
						</span>
					</td>
					<td class="font-bold">{{ row.ticker }}</td>
					<td>
						<RouterLink
							class="text-prunplanner hover:underline"
							:to="
								planLinkTarget(
									`/plan/${row.planetNaturalId}/${row.producerPlanUuid}`
								)
							">
							{{ row.producerPlanName }}
						</RouterLink>
					</td>
					<td class="text-right text-white/60">
						{{ formatNumber(row.grossPerDay) }}
					</td>
					<td class="text-right text-white/60">
						{{ formatNumber(row.selfPerDay)
						}}<span
							v-if="row.selfPerDay > 0"
							:title="
								$t(
									'raukk_sourcing.oversub_report.self_marker_tooltip'
								)
							">
							⌂</span
						>
					</td>
					<td class="text-right">
						{{ formatNumber(row.netPerDay) }}
					</td>
					<td class="text-right">
						{{ formatNumber(row.subscribedPerDay) }}
					</td>
					<td>
						<div
							class="flex flex-row gap-x-2 child:my-auto min-w-40">
							<div
								class="w-full bg-gray-800 size-2 rounded-full overflow-hidden">
								<div
									class="h-full transition-all duration-300 ease-out"
									:class="
										row.over
											? 'bg-negative'
											: 'bg-prunplanner'
									"
									:style="{
										width: `${raukkUtilizationBarWidth(row.utilization)}%`,
									}"></div>
							</div>
							<span
								class="text-nowrap"
								:class="
									row.over ? 'text-negative font-bold' : ''
								">
								{{
									row.utilization === null
										? $t(
												"raukk_sourcing.oversub_report.utilization_na"
											)
										: `${row.over ? "▲ " : ""}${formatNumber(row.utilization * 100)} %`
								}}
							</span>
						</div>
					</td>
					<td>
						<div class="flex flex-row gap-x-1">
							<PTag v-if="row.anyStale" size="sm" type="warning">
								{{
									$t(
										"raukk_sourcing.oversub_report.badges.stale"
									)
								}}
							</PTag>
							<PTag
								v-if="row.utilization === null"
								size="sm"
								type="secondary">
								{{
									$t(
										"raukk_sourcing.oversub_report.badges.no_net_capacity"
									)
								}}
							</PTag>
						</div>
					</td>
					<td class="text-right">
						<PTooltip>
							<template #trigger>
								<PButton
									size="sm"
									type="secondary"
									:disabled="recomputeBusy"
									@click="
										emit(
											'recompute-plan',
											row.producerPlanUuid
										)
									">
									{{
										$t(
											"raukk_sourcing.oversub_report.recompute.row"
										)
									}}
								</PButton>
							</template>
							{{
								recomputeBusy
									? $t(
											"raukk_sourcing.oversub_report.recompute.busy_tooltip"
										)
									: $t(
											"raukk_sourcing.oversub_report.recompute.row_tooltip"
										)
							}}
						</PTooltip>
					</td>
				</tr>
				<template v-if="refExpanded.has(rowKey(row))">
					<tr
						v-for="(segment, index) in row.segments"
						:key="`${rowKey(row)}#SEG#${index}`">
						<td></td>
						<td colspan="2">
							<RouterLink
								v-if="
									segment.segmentKind !== 'external' &&
									segment.navTarget !== null
								"
								class="text-prunplanner hover:underline"
								:to="planLinkTarget(segment.navTarget)">
								{{ segmentLabel(segment) }}
							</RouterLink>
							<span v-else class="text-white/50">
								{{ segmentLabel(segment) }}
							</span>
						</td>
						<td colspan="2" class="text-right text-white/60">
							{{ formatNumber(segment.amountPerDay) }}
							{{ row.unit }}
						</td>
						<td colspan="2" class="text-right text-white/60">
							{{ shareLabel(row, segment.amountPerDay) }}
						</td>
						<td colspan="3">
							<PTag v-if="segment.stale" size="sm" type="warning">
								{{
									$t(
										"raukk_sourcing.oversub_report.badges.stale"
									)
								}}
							</PTag>
						</td>
					</tr>
				</template>
			</template>
			<tr v-if="tickerRows.length === 0">
				<td colspan="10" class="text-center text-white/50">
					{{ $t("raukk_sourcing.oversub_report.empty.materials") }}
				</td>
			</tr>
		</tbody>
	</PTable>

	<template v-if="shippingEnabled">
		<div class="flex flex-row justify-between gap-x-3 child:my-auto">
			<h4 class="font-bold py-3">
				{{ $t("raukk_sourcing.oversub_report.groups.fleet") }}
				<span class="text-white/50 font-normal pl-1">
					{{ $t("raukk_sourcing.oversub_report.groups.fleet_note") }}
				</span>
			</h4>
			<PTooltip>
				<template #trigger>
					<PButton
						size="sm"
						type="secondary"
						:disabled="recomputeBusy"
						@click="emit('recompute-fleet')">
						{{
							$t("raukk_sourcing.oversub_report.recompute.fleet")
						}}
					</PButton>
				</template>
				{{
					recomputeBusy
						? $t(
								"raukk_sourcing.oversub_report.recompute.busy_tooltip"
							)
						: $t(
								"raukk_sourcing.oversub_report.recompute.fleet_tooltip"
							)
				}}
			</PTooltip>
		</div>
		<PTable striped>
			<thead>
				<tr>
					<th></th>
					<th>
						{{
							$t(
								"raukk_sourcing.oversub_report.columns.ship_type"
							)
						}}
					</th>
					<th>
						{{ $t("raukk_sourcing.oversub_report.columns.design") }}
					</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.oversub_report.columns.gross") }}
					</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.oversub_report.columns.self") }}
					</th>
					<th class="text-right!">
						{{ $t("raukk_sourcing.oversub_report.columns.net") }}
					</th>
					<th class="text-right!">
						{{
							$t(
								"raukk_sourcing.oversub_report.columns.subscribed"
							)
						}}
					</th>
					<th>
						{{
							$t(
								"raukk_sourcing.oversub_report.columns.utilization"
							)
						}}
					</th>
					<th>
						{{ $t("raukk_sourcing.oversub_report.columns.flags") }}
					</th>
				</tr>
			</thead>
			<tbody>
				<template v-for="row in fleetRows" :key="rowKey(row)">
					<tr>
						<td>
							<span
								v-if="row.segments.length > 0"
								class="hover:cursor-pointer select-none text-white/50"
								@click="toggle(row)">
								{{ refExpanded.has(rowKey(row)) ? "▾" : "▸" }}
							</span>
						</td>
						<td>
							<RouterLink
								class="text-prunplanner hover:underline"
								to="/shipping">
								{{
									shipTypeLabels[row.shipTypeId] ??
									row.shipTypeId
								}}
							</RouterLink>
						</td>
						<td class="text-white/60">
							{{ row.designName ?? "—" }}
						</td>
						<td class="text-right text-white/60">
							{{ formatNumber(row.grossPerDay) }}
						</td>
						<td class="text-right text-white/60">
							{{ formatNumber(row.selfPerDay) }}
						</td>
						<td class="text-right">
							{{ formatNumber(row.netPerDay) }}
						</td>
						<td class="text-right">
							{{ formatNumber(row.subscribedPerDay) }}
						</td>
						<td>
							<div
								class="flex flex-row gap-x-2 child:my-auto min-w-40">
								<div
									class="w-full bg-gray-800 size-2 rounded-full overflow-hidden">
									<div
										class="h-full transition-all duration-300 ease-out"
										:class="
											row.over
												? 'bg-negative'
												: 'bg-prunplanner'
										"
										:style="{
											width: `${raukkUtilizationBarWidth(row.utilization)}%`,
										}"></div>
								</div>
								<span
									class="text-nowrap"
									:class="
										row.over
											? 'text-negative font-bold'
											: ''
									">
									{{
										row.utilization === null
											? $t(
													"raukk_sourcing.oversub_report.utilization_na"
												)
											: `${row.over ? "▲ " : ""}${formatNumber(row.utilization * 100)} %`
									}}
								</span>
							</div>
						</td>
						<td>
							<div class="flex flex-row gap-x-1">
								<PTag
									v-if="row.anyStale"
									size="sm"
									type="warning">
									{{
										$t(
											"raukk_sourcing.oversub_report.badges.stale"
										)
									}}
								</PTag>
								<PTag
									v-if="row.count === 0"
									size="sm"
									type="secondary">
									{{
										$t(
											"raukk_sourcing.oversub_report.badges.no_ships"
										)
									}}
								</PTag>
							</div>
						</td>
					</tr>
					<template v-if="refExpanded.has(rowKey(row))">
						<tr
							v-for="(segment, index) in row.segments"
							:key="`${rowKey(row)}#SEG#${index}`">
							<td></td>
							<td colspan="2">
								<RouterLink
									v-if="
										segment.segmentKind !== 'external' &&
										segment.navTarget !== null
									"
									class="text-prunplanner hover:underline"
									:to="planLinkTarget(segment.navTarget)">
									{{ segmentLabel(segment) }}
								</RouterLink>
								<span v-else class="text-white/50">
									{{ segmentLabel(segment) }}
								</span>
							</td>
							<td colspan="2" class="text-right text-white/60">
								{{ formatNumber(segment.amountPerDay) }}
								{{ row.unit }}
							</td>
							<td colspan="2" class="text-right text-white/60">
								{{ shareLabel(row, segment.amountPerDay) }}
							</td>
							<td colspan="2">
								<PTag
									v-if="segment.stale"
									size="sm"
									type="warning">
									{{
										$t(
											"raukk_sourcing.oversub_report.badges.stale"
										)
									}}
								</PTag>
							</td>
						</tr>
					</template>
				</template>
				<tr v-if="fleetRows.length === 0">
					<td colspan="9" class="text-center text-white/50">
						{{ $t("raukk_sourcing.oversub_report.empty.fleet") }}
					</td>
				</tr>
			</tbody>
		</PTable>
	</template>
</template>
