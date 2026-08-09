// Component-scoped cross-highlight selection of the oversubscription
// report: which consumer is highlighted across every tab. Provided by
// the section and injected by tabs and the legend — never stored in
// `raukkSourcingStore`, the store persists domain data, not UI
// selection (report spec, "Components & mount").

import { inject, InjectionKey, provide, ref, Ref } from "vue";

/** The selection every tab and the legend share */
export interface IRaukkOversubSelection {
	/** Selected consumer: a plan uuid or the "other" fold, null = none */
	selected: Ref<string | null>;
	/** Select a consumer, or clear when it already is the selection */
	toggle: (key: string) => void;
	/** Clear the selection, the section's Esc handler */
	clear: () => void;
}

const RAUKK_OVERSUB_SELECTION_KEY: InjectionKey<IRaukkOversubSelection> =
	Symbol("RaukkOversubSelection");

/**
 * Creates the report's selection state and provides it to the section's
 * subtree. Called once by `RaukkOversubReportSection`.
 *
 * @author raukk
 *
 * @returns {IRaukkOversubSelection} The selection, for the section's
 * own Esc handling
 */
export function provideRaukkOversubSelection(): IRaukkOversubSelection {
	const selected: Ref<string | null> = ref(null);

	const selection: IRaukkOversubSelection = {
		selected,
		toggle: (key: string) => {
			selected.value = selected.value === key ? null : key;
		},
		clear: () => {
			selected.value = null;
		},
	};

	provide(RAUKK_OVERSUB_SELECTION_KEY, selection);
	return selection;
}

/**
 * The section's selection, from any component below it.
 *
 * @author raukk
 *
 * @returns {IRaukkOversubSelection} The shared selection
 */
export function useRaukkOversubSelection(): IRaukkOversubSelection {
	const selection: IRaukkOversubSelection | undefined = inject(
		RAUKK_OVERSUB_SELECTION_KEY
	);

	if (selection === undefined)
		throw new Error(
			"useRaukkOversubSelection outside RaukkOversubReportSection"
		);

	return selection;
}
