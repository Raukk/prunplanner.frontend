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

	/**
	 * Share of an exchange's daily traded volume, in percent, at which a
	 * plan's sale of a material is flagged amber respectively red — the
	 * point where selling the surplus starts moving the price you priced
	 * the plan with. See `cxVolumeShare.ts`.
	 *
	 * Optional and client side only, like `habOptimizePerPlan`: both are
	 * absent from `UserPreferenceSchema` and never reach the backend.
	 */
	cxVolumeYellowPercent?: number;
	cxVolumeRedPercent?: number;

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
