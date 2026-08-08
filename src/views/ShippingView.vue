<script setup lang="ts">
	import { useI18n } from "vue-i18n";
	const { t } = useI18n();

	// Unhead
	import { useHead } from "@unhead/vue";
	useHead({
		title: `${t("raukk_sourcing.shipping_page.view_title")} | PRUNplanner`,
	});

	// Components
	import WrapperGameDataLoader from "@/features/wrapper/components/WrapperGameDataLoader.vue";
	import RaukkShippingPage from "@/features/raukk_sourcing/components/RaukkShippingPage.vue";
</script>

<template>
	<WrapperGameDataLoader load-materials load-exchanges load-buildings>
		<div class="min-h-screen px-6 py-3">
			<RaukkShippingPage />
		</div>
	</WrapperGameDataLoader>
</template>
