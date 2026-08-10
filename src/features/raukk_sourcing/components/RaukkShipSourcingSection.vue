<script setup lang="ts">
	// Components
	import RaukkShipSourcing from "@/features/raukk_sourcing/components/RaukkShipSourcing.vue";

	// Section shell of the account-wide ship sourcing: heading, info line
	// and the framed table, in the anatomy every other section of the
	// Shipping page uses. A component rather than inline markup because
	// the page's tab strip is a KeepAlive, which caches component children
	// only.
	//
	// Gated behind the shipping switch, unlike the input bucket defaults
	// next to it: fuel and the ship repair bill are charged by the
	// shipping model alone, so with shipping off every number here is
	// zero.
</script>

<template>
	<div>
		<h4 class="font-bold py-3">
			{{ $t("raukk_sourcing.ship_sourcing.title") }}
		</h4>
		<div class="text-white/50 pb-3">
			{{ $t("raukk_sourcing.ship_sourcing.info") }}
		</div>

		<div class="border rounded-[3px] border-white/20 p-3">
			<RaukkShipSourcing />
		</div>
	</div>
</template>
