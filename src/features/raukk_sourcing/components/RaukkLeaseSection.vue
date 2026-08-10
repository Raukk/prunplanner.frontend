<script setup lang="ts">
	import { toRef } from "vue";

	// Composables
	import { useRaukkLease } from "@/features/raukk_sourcing/useRaukkLease";

	// UI
	import { PButton, PSelect } from "@/ui";

	const props = defineProps({
		/** Open plan, undefined on an unsaved one: a lease link is stored
		 * per plan uuid and needs a plan to belong to */
		planUuid: {
			type: String,
			required: false,
			default: undefined,
		},
		disabled: {
			type: Boolean,
			required: false,
			default: false,
		},
	});

	const { host, leases, isLease, isHost, candidates, error, link, unlink } =
		useRaukkLease(toRef(props, "planUuid"));
</script>

<template>
	<h3 class="font-bold py-3">
		{{ $t("raukk_sourcing.lease.title") }}
	</h3>
	<div class="text-white/50 pb-3">
		{{ $t("raukk_sourcing.lease.info") }}
	</div>

	<div
		class="border rounded-[3px] border-white/20 p-3 flex flex-row flex-wrap gap-3 child:my-auto">
		<template v-if="isLease">
			<div class="font-bold">
				{{
					$t("raukk_sourcing.lease.linked", {
						host:
							host?.planName ??
							$t("raukk_sourcing.lease.unknown_plan"),
					})
				}}
			</div>
			<router-link
				v-if="host?.route"
				:to="host.route"
				class="text-link-primary hover:underline">
				{{ host.planName ?? host.planUuid }}
			</router-link>
			<PButton type="secondary" :disabled="disabled" @click="unlink">
				{{ $t("raukk_sourcing.lease.unlink") }}
			</PButton>
		</template>

		<template v-else-if="isHost">
			<div class="font-bold">
				{{
					$t("raukk_sourcing.lease.hosting", {
						count: leases.length,
					})
				}}
			</div>
			<template v-for="lease in leases" :key="lease.planUuid">
				<router-link
					v-if="lease.route"
					:to="lease.route"
					class="text-link-primary hover:underline">
					{{ lease.planName ?? lease.planUuid }}
				</router-link>
				<span v-else class="text-white/60">
					{{ lease.planName ?? lease.planUuid }}
				</span>
			</template>
		</template>

		<template v-else-if="candidates.length > 0">
			<div class="font-bold">
				{{ $t("raukk_sourcing.lease.select_label") }}
			</div>
			<PSelect
				class="w-60!"
				:value="null"
				:disabled="disabled"
				:options="candidates"
				:placeholder="$t('raukk_sourcing.lease.select_placeholder')"
				@update:value="(v) => link(String(v))" />
		</template>

		<div v-else class="text-white/50">
			{{ $t("raukk_sourcing.lease.no_candidates") }}
		</div>
	</div>

	<div v-if="error" class="pt-3">
		<span class="text-negative">{{ error }}</span>
	</div>
</template>
