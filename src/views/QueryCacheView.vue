<script setup lang="ts">
	import { computed } from "vue";
	import { useQueryStore } from "@/lib/query_cache/queryStore";

	// i18n
	import { i18n } from "@/lib/i18n";

	const toggleKeyMode = () => {
		const { locale } = i18n.global;
		locale.value = locale.value === "keymode" ? "en_US" : "keymode";
	};

	import { PButton, PTag, PTable } from "@/ui";

	// Grab the Pinia store
	const queryStore = useQueryStore();

	// Build a list of all cache entries
	const entries = computed(() => {
		return Object.entries(queryStore.cacheState).map(([key, state]) => ({
			key,
			state,
			// Prettify JSON or show placeholder
			jsonData:
				state.data !== null
					? JSON.stringify(state.data, null, 2)
					: "null",
			expireAt: state.expireTime
				? state.timestamp + state.expireTime
				: null,
		}));
	});
</script>

<template>
	<div class="p-3 flex flex-col gap-6">
		<div>
			<h2 class="text-2xl pb-3">Translations</h2>
			<div class="flex flex-row gap-3 items-center">
				<PButton @click="toggleKeyMode">Toogle Key Mode</PButton>
				<div>
					To switch back to your selected language, please reload the
					page.
				</div>
			</div>
		</div>
		<div class="flex flex-row gap-3 items-center">
			<h2 class="text-2xl">Query Cache</h2>
			<PButton
				size="sm"
				:loading="queryStore.refreshing"
				@click="queryStore.refreshAll()">
				Refresh All
			</PButton>
			<div class="text-white/60 text-sm">
				{{ Object.keys(queryStore.cacheMeta).length }} persisted meta
				entries, generation {{ queryStore.refreshGeneration }}
			</div>
		</div>
		<PTable striped>
			<thead>
				<tr>
					<th>Key</th>
					<th>Loading</th>
					<th>Source</th>
					<th>Error</th>
					<th>Timestamp</th>
					<th>ExpireMs</th>
					<th>ExpireAt</th>
					<th>Refetch</th>
					<th>Data</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="entry in entries"
					:key="`${entry.key}`"
					class="child:text-nowrap">
					<td class="!text-wrap break-all">
						{{ entry.key }}
					</td>
					<td>
						<PTag
							v-if="entry.state.loading"
							:bordered="false"
							type="success">
							yes
						</PTag>
						<PTag v-else :bordered="false">no</PTag>
					</td>
					<td>
						<PTag
							v-if="entry.state.revalidating"
							:bordered="false"
							type="warning">
							revalidating
						</PTag>
						<PTag
							v-else-if="entry.state.hydrated"
							:bordered="false"
							type="success">
							local
						</PTag>
						<PTag v-else :bordered="false">network</PTag>
					</td>
					<td>
						<span v-if="entry.state.error">{{
							entry.state.error.message
						}}</span>
						<span v-else>—</span>
					</td>
					<td>
						<span v-if="entry.state.timestamp">
							{{
								new Date(entry.state.timestamp).toLocaleString()
							}}
						</span>
						<span v-else>—</span>
					</td>
					<td>
						<pre>{{ entry.state.expireTime }}</pre>
					</td>
					<td>
						{{
							entry.expireAt
								? new Date(entry.expireAt).toLocaleString()
								: "—"
						}}
					</td>
					<td>
						<PTag
							v-if="entry.state.autoRefetch"
							:bordered="false"
							type="success">
							yes
						</PTag>
						<PTag v-else :bordered="false" type="error"> no </PTag>
					</td>
					<td>
						<pre>{{ entry.jsonData?.length }}</pre>
					</td>
					<td>
						<PButton
							size="sm"
							type="error"
							@click="
								async () => {
									await queryStore.invalidateKey(
										JSON.parse(entry.key),
										{ skipRefetch: true }
									);
								}
							">
							Invalidate
						</PButton>
					</td>
				</tr>
				<tr v-if="entries.length === 0">
					<td colspan="10">No queries in cache.</td>
				</tr>
			</tbody>
		</PTable>
	</div>
</template>
