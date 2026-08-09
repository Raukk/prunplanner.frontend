import { SupportedLocale } from "@/lib/i18n";

export interface IPreferencePerPlan {
	includeCM?: boolean;
	visitationMaterialExclusions?: string[];
	autoOptimizeHabs: boolean;
}

export interface IPreference {
	locale: SupportedLocale;
	defaultEmpireUuid: string | undefined;
	defaultCXUuid: string | undefined;
	defaultBuyItemsFromCX: boolean;
	burnDaysRed: number;
	burnDaysYellow: number;
	burnResupplyDays: number;
	burnOrigin: string;
	layoutNavigationStyle: "full" | "collapsed";
	/**
	 * Hands the "Auto-Optimize Habs" decision back to the individual plan
	 * checkbox. While false or absent — the default — habitation
	 * optimization is forced on for every plan and runs the AREA goal, see
	 * `useHabOptimization`.
	 *
	 * Optional because it is client side only: it is deliberately absent
	 * from `UserPreferenceSchema`, so it never reaches the backend and a
	 * preference fetch never carries it back.
	 */
	habOptimizePerPlan?: boolean;

	// seeding per plan defaults
	planOverrides: Record<string, Partial<IPreferencePerPlan>>;

	[key: string]:
		| string
		| undefined
		| number
		| boolean
		| Record<string, Partial<IPreferencePerPlan>>
		| IPreferencePerPlan;
}

export interface IPreferenceDefault extends IPreference {
	planDefaults: IPreferencePerPlan;
}

export interface IPlanPreferenceOverview {
	planUuid: string;
	planetId: string;
	planName: string;
	preferences: string[];
}
