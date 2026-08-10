<script setup lang="ts">
	import { computed } from "vue";

	// Composables
	import { useRaukkLease } from "@/features/raukk_sourcing/useRaukkLease";

	// UI
	import { PTag } from "@/ui";

	const props = defineProps({
		planUuid: {
			type: String,
			required: true,
		},
	});

	const { host, leases, isLease, isHost } = useRaukkLease(
		computed((): string | undefined => props.planUuid)
	);
</script>

<template>
	<PTag v-if="isLease" size="sm" type="secondary">
		{{
			$t("raukk_sourcing.lease.badge_lease", {
				host: host?.planName ?? $t("raukk_sourcing.lease.unknown_plan"),
			})
		}}
	</PTag>
	<PTag v-else-if="isHost" size="sm" type="secondary">
		{{
			$t("raukk_sourcing.lease.badge_host", {
				count: leases.length,
			})
		}}
	</PTag>
</template>
