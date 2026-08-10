import { useIndexedDBStore } from "@/database/composables/useIndexedDBStore";
import { useDB } from "@/database/composables/useDB";

// Types & Interfaces
import {
	IBuilding,
	IExchange,
	IMaterial,
	IPlanet,
	IRecipe,
} from "@/features/api/gameData.types";

export const materialsStore = useIndexedDBStore<IMaterial, "ticker">(
	"gamedata_materials",
	"ticker" as const
);

export const planetsStore = useIndexedDBStore<IPlanet, "planet_natural_id">(
	"gamedata_planets",
	"planet_natural_id" as const
);

export const exchangesStore = useIndexedDBStore<IExchange, "ticker_id">(
	"gamedata_exchanges",
	"ticker_id" as const
);

export const recipesStore = useIndexedDBStore<IRecipe, "recipe_id">(
	"gamedata_recipes",
	"recipe_id" as const
);

export const buildingsStore = useIndexedDBStore<IBuilding, "building_ticker">(
	"gamedata_buildings",
	"building_ticker" as const
);

/**
 * Pins every game data store for the duration of a multi step
 * calculation, so a background refresh cannot swap prices, recipes or
 * planet data between one step and the next and leave the totals a mix
 * of two snapshots. Returns the release, which applies whatever
 * refreshes arrived while held.
 *
 * @author jplacht
 *
 * @returns {() => Promise<void>} Release the hold
 */
export function holdGameData(): () => Promise<void> {
	const releases: Array<() => Promise<void>> = [
		useDB(materialsStore).hold(),
		useDB(exchangesStore).hold(),
		useDB(recipesStore).hold(),
		useDB(buildingsStore).hold(),
		useDB(planetsStore).hold(),
	];

	return async () => {
		await Promise.all(releases.map((release) => release()));
	};
}
