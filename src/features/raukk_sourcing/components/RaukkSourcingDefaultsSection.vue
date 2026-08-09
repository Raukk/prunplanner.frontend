<script setup lang="ts">
	// Components
	import RaukkSourcingDefaults from "@/features/raukk_sourcing/components/RaukkSourcingDefaults.vue";

	// Section shell of the account-wide sourcing defaults: heading, info
	// line and the framed editor, in the anatomy every other section of
	// the Shipping page uses. A component rather than inline markup
	// because the page's tab strip is a KeepAlive, which caches component
	// children only.
	//
	// Deliberately reachable while shipping is switched off — the
	// defaults price inputs, they fly nothing.
</script>

<template>
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.defaults.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.defaults.info") }}
		</div>

		<div class="border rounded-[3px] border-white/20 p-3">
			<RaukkSourcingDefaults />
		</div>
	</div>
</template>
