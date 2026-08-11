import { IQueryDefinition } from "@/lib/query_cache/queryCache.types";
import {
	untilEarliestBoundary,
	untilNextUtcMidnight,
	untilRolloverAfter,
} from "@/lib/query_cache/expiry";

// i18n
import { i18n } from "@/lib/i18n";

// config
import config from "@/lib/config";

import { trackEvent } from "@/lib/analytics/useAnalytics";

// util
import { inertClone } from "@/util/data";

// stores
import { useQueryStore } from "@/lib/query_cache/queryStore";
import { usePlanningStore } from "@/stores/planningStore";
import { useUserStore } from "@/stores/userStore";
// raukk: sourcing snapshots follow plan saves and deletions
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { planContentFingerprint } from "@/features/planning_data/usePlan";

// indexeddb
import {
	materialsStore,
	planetsStore,
	exchangesStore,
	recipesStore,
	buildingsStore,
} from "@/database/stores";
import { useDB } from "@/database/composables/useDB";
import { useIndexedDBStore } from "@/database/composables/useIndexedDBStore";

/**
 * Rebuilds a full game data payload from its IndexedDB store instead of
 * the network and warms the in-memory read cache the database services
 * read through. Returns null when nothing is stored locally, the caller
 * then falls back to fetching.
 *
 * @author jplacht
 *
 * @async
 * @template T Record type
 * @template K Key path
 * @param {ReturnType<typeof useIndexedDBStore<T, K>>} store IndexedDB store
 * @returns {Promise<T[] | null>} Stored records or null
 */
async function hydrateFromStore<T extends object, K extends keyof T & string>(
	store: ReturnType<typeof useIndexedDBStore<T, K>>
): Promise<T[] | null> {
	const data = await store.getAll();
	if (data.length === 0) return null;

	await useDB(store).preload(true);
	return data;
}

/**
 * Expiry for game data that changes once a day.
 *
 * Anchors to the rollover the payload itself names where it names one,
 * falling back to the next midnight UTC. The configured staleness stays
 * an upper bound, so the `VITE_GAME_DATA_STALE_MINUTES_*` overrides keep
 * meaning "never older than this" and a shorter one still wins.
 *
 * @author raukk
 *
 * @param {number} capMinutes Configured maximum staleness in minutes
 * @param {number} since Timestamp the ttl is measured from
 * @param {?(Date | number | null)} [anchor] Day the payload describes
 * @returns {number} Ttl in ms
 */
function dailyGameDataExpiry(
	capMinutes: number,
	since: number,
	anchor?: Date | number | null
): number {
	const rollover: number =
		untilRolloverAfter(anchor, since) ?? untilNextUtcMidnight(since);

	return Math.min(60_000 * capMinutes, rollover);
}

/**
 * Fallback expiry for a planet whose COGC schedule has run out.
 *
 * Every program in the payload having already ended does not mean the
 * planet is idle — on a populated planet the programs run back to back,
 * so it means the backend has not re-ingested this planet since the last
 * one lapsed and its copy is behind. Asking again reasonably soon is the
 * right response; asking every twelve hours is also as fast as it is
 * worth going, since nothing here makes the backend ingest any sooner.
 */
const PLANET_UNSCHEDULED_MS: number = 12 * 60 * 60_000;

/**
 * Expiry for planet data, anchored to its COGC schedule.
 *
 * Everything else the payload carries is fixed: geology, resources, the
 * system it sits in. Habitation buildings only ever get added and only
 * rarely. The COGC program is the one field that turns over on a clock,
 * and the payload states when — programs run in seven day windows and a
 * populated planet carries the next one already scheduled, so the
 * earliest end still ahead is precisely when this copy stops being
 * current. Refetching before then learns nothing; refetching on a fixed
 * twelve hour timer both wastes most of those requests and still lands
 * up to twelve hours late on the one change that matters.
 *
 * Each path keeps its own configured upper bound.
 *
 * @author raukk
 *
 * @param {IPlanet[]} planets Planets in this payload
 * @param {number} since Timestamp the ttl is measured from
 * @returns {number} Ttl in ms
 */
function planetExpiry(planets: IPlanet[], since: number): number {
	// the earliest across a multi planet payload: the whole entry stops
	// being current as soon as any one of its planets does
	const boundaries: number[] = planets.flatMap((planet) =>
		(planet?.cogc_programs ?? []).map((program) => program.end_epochms)
	);

	const scheduled: number | undefined = untilEarliestBoundary(
		boundaries,
		since
	);

	return scheduled !== undefined
		? Math.min(
				60_000 * config.GAME_DATA_STALE_MINUTES_PLANET_SCHEDULED,
				scheduled
			)
		: Math.min(
				60_000 * config.GAME_DATA_STALE_MINUTES_PLANETS,
				PLANET_UNSCHEDULED_MS
			);
}

/**
 * Writes a fetched game data payload to its IndexedDB store and reloads
 * the in-memory read cache, skipping both when the payload is byte for
 * byte the one already stored.
 *
 * @author raukk
 *
 * @async
 * @template T Record type
 * @template K Key path
 * @param {ReturnType<typeof useIndexedDBStore<T, K>>} store IndexedDB store
 * @param {T[]} data Fetched records
 * @returns {Promise<void>}
 */
async function writeThroughStore<T extends object, K extends keyof T & string>(
	store: ReturnType<typeof useIndexedDBStore<T, K>>,
	data: T[]
): Promise<void> {
	const changed: boolean = await store.setManyIfChanged(data, true);

	// an unchanged payload leaves the loaded map correct as it stands,
	// and forcing a reload would swap it for an equal one — invalidating
	// every computed that reads through it for nothing. The unforced
	// call still covers the case where nothing loaded the map yet, where
	// skipping outright would leave every reader looking at an empty one
	await useDB(store).preload(changed);
}

/**
 * Writes fetched planets to IndexedDB and reloads the shared in-memory
 * planet map only when one of them actually changed.
 *
 * `setManyIfChanged` cannot serve here: its fingerprint describes one
 * whole-store payload per store, while planets arrive one or a few at a
 * time. Comparing each fetched planet against the stored copy instead
 * keeps an unchanged refetch — the common case, planet data turns over
 * on its COGC schedule — from force-swapping the map every reader
 * resolves through and invalidating every computed built on it.
 *
 * @author raukk
 *
 * @async
 * @param {IPlanet[]} data Fetched planets
 * @returns {Promise<void>}
 */
async function writeThroughPlanets(data: IPlanet[]): Promise<void> {
	const db = useDB(planetsStore);
	await db.preload();

	let changed: boolean = false;
	for (const planet of data) {
		const existing = await db.get(planet.planet_natural_id);
		if (!existing || JSON.stringify(existing) !== JSON.stringify(planet)) {
			changed = true;
			break;
		}
	}

	if (!changed) return;

	await planetsStore.setMany(data);
	await db.preload(true);
}

/**
 * Rebuilds a payload from IndexedDB, falling back to the snapshot
 * bundled at build time when nothing is stored yet.
 *
 * Only materials, recipes and buildings ship a snapshot: they change on
 * a game update, so they change between deploys, and a build is exactly
 * when a fresh copy is available. A first visit then paints from the
 * bundle instead of blocking on the network, and the cache still
 * confirms it against the backend in the background — the entry carries
 * no known fetch time, which marks it stale on arrival.
 *
 * The import is dynamic so returning visitors, whose data is already in
 * IndexedDB, never download the chunk at all.
 *
 * @author raukk
 *
 * @async
 * @template T Record type
 * @template K Key path
 * @param {ReturnType<typeof useIndexedDBStore<T, K>>} store IndexedDB store
 * @param {() => Promise<unknown>} loadSnapshot Bundled snapshot loader
 * @returns {Promise<T[] | null>} Records, or null if neither source has any
 */
async function hydrateFromStoreOrSnapshot<
	T extends object,
	K extends keyof T & string,
>(
	store: ReturnType<typeof useIndexedDBStore<T, K>>,
	loadSnapshot: () => Promise<unknown>
): Promise<T[] | null> {
	const stored = await hydrateFromStore(store);
	if (stored) return stored;

	try {
		const snapshot = (await loadSnapshot()) as T[];
		if (!Array.isArray(snapshot) || snapshot.length === 0) return null;

		await writeThroughStore(store, snapshot);
		return snapshot;
	} catch (err) {
		console.error("Bundled game data snapshot unavailable", err);
		return null;
	}
}

// API Calls
import {
	callDataBuildings,
	callDataExchanges,
	callDataFIOStorage,
	callDataMaterials,
	callDataMultiplePlanets,
	callDataPlanet,
	callDataPlanetSearch,
	callDataPlanetSearchSingle,
	callDataRecipes,
	callExplorationData,
	callPlanetLastPOPR,
} from "@/features/api/gameData.api";
// raukk: direct FIO REST API access (planet fee data)
import { callFIOPlanetFees } from "@/features/api/fioData.api";
import { IFIOPlanetFees } from "@/features/api/fioData.types";
import {
	callClonePlan,
	callCreatePlan,
	callDeletePlan,
	callGetPlan,
	callGetPlanlist,
	callGetShared,
	callSavePlan,
} from "@/features/api/planData.api";
import {
	callCreateEmpire,
	callDeleteEmpire,
	callGetEmpireList,
	callGetEmpirePlans,
	callPatchEmpire,
	callPatchEmpirePlanJunctions,
	callPatchEmpireState,
} from "@/features/api/empireData.api";
import {
	callCreateCX,
	callDeleteCX,
	callGetCXList,
	callPatchCX,
	callUpdateCXJunctions,
} from "@/features/api/cxData.api";
import {
	callCloneSharedPlan,
	callCreateSharing,
	callDeleteSharing,
	callGetSharedList,
} from "@/features/api/sharingData.api";

// Types & Interfaces
import { IQueryRepository } from "@/lib/query_cache/queryRepository.types";

// raukk: the build time snapshots are raw endpoint JSON and have never
// been through zod, so they are parsed on the same schemas the network
// path uses — both to reject a drifted shape and so the records match
// field for field, which is what lets the store fingerprint recognise
// the fetched payload as unchanged
import {
	BuildingPayloadSchema,
	MaterialPayloadSchema,
	RecipePayloadSchema,
} from "@/features/api/schemas/gameData.schemas";

import {
	IBuilding,
	IExchange,
	IFIOStorage,
	IMaterial,
	IPlanet,
	IPlanetSearchAdvanced,
	IPopulationReport,
	IRecipe,
} from "@/features/api/gameData.types";

import {
	ICXEmpireJunction,
	IPlanCloneResponse,
	IPlanEmpireJunction,
} from "@/features/manage/manage.types";
import {
	ICX,
	ICXData,
	ICXPut,
	IPlan,
	IPlanEmpire,
	IPlanEmpireElement,
	IPlanShare,
} from "@/stores/planningStore.types";

import {
	IShared,
	ISharedCloneResponse,
	ISharedCreateResponse,
} from "@/features/api/sharingData.types";

import { IExploration } from "@/features/market_exploration/marketExploration.types";
import {
	IEmpireCreatePayload,
	IEmpireMaterialIOState,
	IEmpirePatchPayload,
} from "@/features/empire/empire.types";
import {
	IPlanCreateData,
	IPlanSaveData,
} from "@/features/planning_data/usePlan.types";
import { PlanSaveCreateResponseType } from "@/features/api/schemas/planningData.schemas";
import {
	callChangePassword,
	callGetUserPreferences,
	callPasswordReset,
	callPatchProfile,
	callPatchUserPreferences,
	callRegisterUser,
	callRequestPasswordReset,
	callResendEmailVerification,
	callVerifyEmail,
} from "@/features/api/userData.api";
import {
	IUserChangePasswordPayload,
	IUserRequestPasswordResetPayload,
	IUserRequestPasswordResetResponse,
	IUserProfile,
	IUserProfilePatch,
	IUserRegistrationPayload,
	IUserVerifyEmailPayload,
	IUserPasswordResetPayload,
	IUserPasswordResetResponse,
	IUserResponseDetail,
	IUserRegistrationResponse,
} from "@/features/api/userData.types";
import { IPreference } from "@/features/preferences/userPreferences.types";
import { UserPreferenceType } from "@/features/api/schemas/user.schemas";
import { AnalyticsPlanetInsightsPayloadType } from "@/features/api/schemas/analyticsData.schemas";
import { callAnalyticsPlanetInsights } from "@/features/api/analyticsData.api";
import {
	callDeleteAPIKey,
	callGetAPIKeys,
	callPostCreateAPIKey,
} from "@/features/api/apiKeysData.api";
import {
	APIKeyCreatePayloadType,
	APIKeyCreateResponseType,
	APIKeyListType,
} from "@/features/api/schemas/apiKeysData.schema";
import { Composer } from "vue-i18n";

export function useQueryRepository() {
	const queryStore = useQueryStore();
	const planningStore = usePlanningStore();
	const userStore = useUserStore();
	// raukk: sourcing store, snapshot staleness follows plan mutations
	const raukkSourcingStore = useRaukkSourcingStore();

	/**
	 * True while the session a request started in is still the current
	 * one. A response that arrives after logout must not write the
	 * previous user's data into the persisted planning store, where the
	 * next session would hydrate it straight back out.
	 *
	 * @author jplacht
	 *
	 * @param {number} session Session generation captured before fetching
	 * @returns {boolean} Safe to write through
	 */
	function isCurrentSession(session: number): boolean {
		return queryStore.sessionGeneration === session;
	}

	const repository: IQueryRepository = {
		GetMaterials: {
			key: () => ["gamedata", "materials"],
			fetchFn: async () => {
				const data: IMaterial[] = await callDataMaterials();
				await writeThroughStore(materialsStore, data);

				return data;
			},
			hydrateFn: () =>
				hydrateFromStoreOrSnapshot(materialsStore, async () =>
					MaterialPayloadSchema.parse(
						(
							await import(
								"@/assets/static/gamedata/materials.json"
							)
						).default
					)
				),
			autoRefetch: true,
			expireTime: (_data: IMaterial[], since: number) =>
				dailyGameDataExpiry(
					config.GAME_DATA_STALE_MINUTES_MATERIALS,
					since
				),
			persist: true,
		} as IQueryDefinition<undefined, IMaterial[]>,
		GetExchanges: {
			key: () => ["gamedata", "exchanges"],
			fetchFn: async () => {
				const data: IExchange[] = await callDataExchanges();
				await writeThroughStore(exchangesStore, data);

				return data;
			},
			hydrateFn: () => hydrateFromStore(exchangesStore),
			autoRefetch: true,
			/*
				Every row of this payload is a daily close of the same
				calendar day — the ask and bid columns are the only part
				that moves intraday, and the live market view reads those
				off the SSE stream, not from here. So it expires on the
				day it describes rolling over, not an hour after whenever
				the tab happened to load it.
			*/
			expireTime: (data: IExchange[], since: number) =>
				dailyGameDataExpiry(
					config.GAME_DATA_STALE_MINUTES_EXCHANGES,
					since,
					data[0]?.calendar_date
				),
			persist: true,
		} as IQueryDefinition<undefined, IExchange[]>,
		GetRecipes: {
			key: () => ["gamedata", "recipes"],
			fetchFn: async () => {
				const data: IRecipe[] = await callDataRecipes();
				await writeThroughStore(recipesStore, data);

				return data;
			},
			hydrateFn: () =>
				hydrateFromStoreOrSnapshot(recipesStore, async () =>
					RecipePayloadSchema.parse(
						(
							await import(
								"@/assets/static/gamedata/recipes.json"
							)
						).default
					)
				),
			autoRefetch: true,
			expireTime: (_data: IRecipe[], since: number) =>
				dailyGameDataExpiry(
					config.GAME_DATA_STALE_MINUTES_RECIPES,
					since
				),
			persist: true,
		} as IQueryDefinition<undefined, IRecipe[]>,
		GetBuildings: {
			key: () => ["gamedata", "buildings"],
			fetchFn: async () => {
				const data: IBuilding[] = await callDataBuildings();
				await writeThroughStore(buildingsStore, data);

				return data;
			},
			hydrateFn: () =>
				hydrateFromStoreOrSnapshot(buildingsStore, async () =>
					BuildingPayloadSchema.parse(
						(
							await import(
								"@/assets/static/gamedata/buildings.json"
							)
						).default
					)
				),
			autoRefetch: true,
			expireTime: (_data: IBuilding[], since: number) =>
				dailyGameDataExpiry(
					config.GAME_DATA_STALE_MINUTES_BUILDINGS,
					since
				),
			persist: true,
		} as IQueryDefinition<undefined, IBuilding[]>,
		GetPlanet: {
			key: (params: { planetNaturalId: string }) => [
				"gamedata",
				"planet",
				params.planetNaturalId,
			],
			fetchFn: async (params: { planetNaturalId: string }) => {
				const data: IPlanet = await callDataPlanet(
					params.planetNaturalId
				);
				await writeThroughPlanets([data]);

				return data;
			},
			hydrateFn: async (params: { planetNaturalId: string }) => {
				const db = useDB(planetsStore);
				await db.preload();

				return (await db.get(params.planetNaturalId)) ?? null;
			},
			expireTime: (data: IPlanet, since: number) =>
				planetExpiry([data], since),
			autoRefetch: true,
			persist: true,
		} as IQueryDefinition<{ planetNaturalId: string }, IPlanet>,
		GetMultiplePlanets: {
			key: (params: { planetNaturalIds: string[] }) => [
				"gamedata",
				"planet",
				"multiple",
				params.planetNaturalIds,
			],
			fetchFn: async (params: { planetNaturalIds: string[] }) => {
				// dropped if the session ends while this is in flight
				const session: number = queryStore.sessionGeneration;
				try {
					const data: IPlanet[] = await callDataMultiplePlanets(
						params.planetNaturalIds
					);

					// set in indexeddb
					await writeThroughPlanets(data);

					// set plans individually
					data.forEach((p) => {
						queryStore.addCacheState(
							["gamedata", "planet", p.planet_natural_id],
							"GetPlanet",
							{ planetNaturalId: p.planet_natural_id },
							p,
							session
						);
					});

					return data;
				} catch {
					return [];
				}
			},
			hydrateFn: async (params: { planetNaturalIds: string[] }) => {
				if (params.planetNaturalIds.length === 0) return null;

				const db = useDB(planetsStore);
				await db.preload();

				const planets = await Promise.all(
					params.planetNaturalIds.map((id) => db.get(id))
				);

				// all-or-nothing: a partial set would silently hide
				// planets from empire views until the refetch lands
				if (planets.some((p) => !p)) return null;

				return planets as IPlanet[];
			},
			expireTime: (data: IPlanet[], since: number) =>
				planetExpiry(data, since),
			autoRefetch: true,
			persist: true,
		} as IQueryDefinition<{ planetNaturalIds: string[] }, IPlanet[]>,
		GetPlanetSearchSingle: {
			key: (params: { searchId: string }) => [
				"gamedata",
				"planet",
				"search",
				params.searchId,
			],
			fetchFn: async (params: { searchId: string }) => {
				const data = await callDataPlanetSearchSingle(params.searchId);

				await writeThroughPlanets(data);

				return data;
			},
			expireTime: 60_000 * config.GAME_DATA_STALE_MINUTES_PLANETS,
			persist: true,
			autoRefetch: false,
		} as IQueryDefinition<{ searchId: string }, IPlanet[]>,
		PostPlanetSearch: {
			key: (params: { searchData: IPlanetSearchAdvanced }) => [
				"gamedata",
				"planet",
				"search",
				params.searchData,
			],
			fetchFn: async (params: { searchData: IPlanetSearchAdvanced }) => {
				const data = await callDataPlanetSearch(params.searchData);

				await writeThroughPlanets(data);

				return data;
			},
			expireTime: 60_000 * config.GAME_DATA_STALE_MINUTES_PLANETS,
			persist: true,
			autoRefetch: false,
		} as IQueryDefinition<{ searchData: IPlanetSearchAdvanced }, IPlanet[]>,
		GetSharedPlan: {
			key: (params: { sharedPlanUuid: string }) => [
				"planningdata",
				"shared",
				params.sharedPlanUuid,
			],
			fetchFn: async (params: { sharedPlanUuid: string }) => {
				return await callGetShared(params.sharedPlanUuid);
			},
			persist: true,
			autoRefetch: false,
			expireTime: 10_000,
		} as IQueryDefinition<{ sharedPlanUuid: string }, IPlanShare>,
		GetAllShared: {
			key: () => ["planningdata", "shared", "list"],
			fetchFn: async () => {
				const session: number = queryStore.sessionGeneration;
				const data = await callGetSharedList();
				if (isCurrentSession(session))
					planningStore.setSharedList(data);
				return data;
			},
			hydrateFn: async () => {
				const data = planningStore.getSharedList();
				return data.length > 0 ? (data as unknown as IShared[]) : null;
			},
			persist: true,
			autoRefetch: true,
			expireTime: 60_000 * 60,
		} as IQueryDefinition<void, IShared[]>,
		DeleteSharedPlan: {
			key: (params: { sharedUuid: string }) => [
				"planningdata",
				"shared",
				"delete",
				params.sharedUuid,
			],
			fetchFn: async (params: { sharedUuid: string }) => {
				const data = await callDeleteSharing(params.sharedUuid);
				await queryStore.invalidateKey(["planningdata", "shared"], {
					exact: false,
					skipRefetch: true,
				});
				return data;
			},
			persist: false,
			autoRefetch: false,
		} as IQueryDefinition<{ sharedUuid: string }, boolean>,
		CreateSharedPlan: {
			key: (params: { planUuid: string }) => [
				"planningdata",
				"shared",
				"create",
				params.planUuid,
			],
			fetchFn: async (params: { planUuid: string }) => {
				await queryStore.invalidateKey(["planningdata", "shared"], {
					exact: false,
					skipRefetch: true,
				});
				return await callCreateSharing(params.planUuid);
			},
			persist: false,
			autoRefetch: false,
		} as IQueryDefinition<{ planUuid: string }, ISharedCreateResponse>,
		PostCloneSharedPlan: {
			key: (params: { sharedUuid: string }) => [
				"planningdata",
				"shared",
				"clone",
				params.sharedUuid,
			],
			fetchFn: async (params: { sharedUuid: string }) => {
				await queryStore.invalidateKey(["planningdata", "shared"], {
					exact: false,
					skipRefetch: true,
				});
				return await callCloneSharedPlan(params.sharedUuid);
			},
			persist: false,
			autoRefetch: false,
		} as IQueryDefinition<{ sharedUuid: string }, ISharedCloneResponse>,
		CreateEmpire: {
			key: () => ["planningdata", "empire", "create"],
			fetchFn: async (params: { data: IEmpireCreatePayload }) => {
				const data = await callCreateEmpire(params.data);
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ data: IEmpireCreatePayload }, IPlanEmpire>,
		DeleteEmpire: {
			key: (params: { empireUuid: string }) => [
				"planningdata",
				"empire",
				"delete",
				params.empireUuid,
			],
			fetchFn: async (params: { empireUuid: string }) => {
				const data = await callDeleteEmpire(params.empireUuid);
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ empireUuid: string }, boolean>,
		PatchEmpireCXJunctions: {
			key: () => ["planningdata", "empire", "cx", "junctions"],
			fetchFn: async (params: { junctions: ICXEmpireJunction[] }) => {
				const data = await callUpdateCXJunctions(params.junctions);
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				await queryStore.invalidateKey(["planningdata", "cx"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ junctions: ICXEmpireJunction[] }, ICX[]>,
		PatchEmpireState: {
			key: (params: { empireUuid: string }) => [
				"planningdata",
				"empire",
				"state",
				params.empireUuid,
			],
			fetchFn: async (params: {
				empireUuid: string;
				empireState: IEmpireMaterialIOState;
			}) => {
				return await callPatchEmpireState(
					params.empireUuid,
					params.empireState
				);
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ empireUuid: string; empireState: IEmpireMaterialIOState },
			IPlanEmpire
		>,
		PatchCX: {
			key: (params: { cxUuid: string }) => [
				"planningdata",
				"cx",
				"patch",
				params.cxUuid,
			],
			fetchFn: async (params: {
				cxName: string;
				cxUuid: string;
				data: ICXData;
			}) => {
				const data = await callPatchCX(
					params.cxName,
					params.cxUuid,
					params.data
				);
				await queryStore.invalidateKey(["planningdata", "cx"], {
					exact: false,
				});

				planningStore.setCX(params.cxUuid, data.cx_name, data.cx_data);

				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ cxName: string; cxUuid: string; data: ICXData },
			ICXPut
		>,
		GetAllEmpires: {
			key: () => ["planningdata", "empire", "list"],
			fetchFn: async () => {
				const session: number = queryStore.sessionGeneration;
				const data = await callGetEmpireList();
				if (isCurrentSession(session)) planningStore.setEmpires(data);
				return data;
			},
			hydrateFn: async () => {
				// inertClone: the record holds reactive proxies, a cached
				// payload must be detached from the store
				const data = Object.values(planningStore.empires).map((e) =>
					inertClone(e)
				);
				return data.length > 0 ? data : null;
			},
			autoRefetch: false,
			persist: true,
		} as IQueryDefinition<void, IPlanEmpireElement[]>,
		GetEmpirePlans: {
			key: (params: { empireUuid: string }) => [
				"planningdata",
				"empire",
				"plans",
				params.empireUuid,
			],
			fetchFn: async (params: { empireUuid: string }) => {
				// dropped if the session ends while this is in flight
				const session: number = queryStore.sessionGeneration;

				// see GetAllPlans: a failure must not masquerade as an
				// empire with no plans
				const data = await callGetEmpirePlans(params.empireUuid);

				if (isCurrentSession(session)) planningStore.setPlans(data);

				// manually set individual plans
				data.forEach((p) =>
					queryStore.addCacheState(
						["planningdata", "plan", p.uuid],
						"GetPlan",
						{ planUuid: p.uuid! },
						p,
						session
					)
				);

				return data;
			},
			hydrateFn: async (params: { empireUuid: string }) => {
				const empire = planningStore.empires[params.empireUuid];
				if (!empire) return null;

				// see GetAllEmpires
				const plans = empire.plans.map((p) =>
					inertClone(planningStore.plans[p.uuid])
				);

				// a plan of the empire was never stored individually =>
				// the rebuilt list would be incomplete
				if (plans.length === 0 || plans.some((p) => !p)) return null;

				return plans;
			},
			autoRefetch: false,
			persist: true,
		} as IQueryDefinition<{ empireUuid: string }, IPlan[]>,
		PatchEmpire: {
			key: (params: { empireUuid: string }) => [
				"planningdata",
				"empire",
				"patch",
				params.empireUuid,
			],
			fetchFn: async (params: {
				empireUuid: string;
				data: IEmpirePatchPayload;
			}) => {
				const data = await callPatchEmpire(
					params.empireUuid,
					params.data
				);
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ empireUuid: string; data: IEmpirePatchPayload },
			IPlanEmpire
		>,
		PatchEmpirePlanJunctions: {
			key: () => ["planningdata", "empire", "plan", "junctions"],
			fetchFn: async (params: { junctions: IPlanEmpireJunction[] }) => {
				const data = await callPatchEmpirePlanJunctions(
					params.junctions
				);

				// invalidate empires + all plans as junctions might have changed
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				await queryStore.invalidateKey(["planningdata", "plan"], {
					exact: false,
				});

				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ junctions: IPlanEmpireJunction[] },
			IPlanEmpireElement[]
		>,
		CreateCX: {
			key: () => ["planningdata", "cx", "create"],
			fetchFn: async (params: { cxName: string }) => {
				const data = await callCreateCX(params.cxName);
				await queryStore.invalidateKey(["planningdata", "cx"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ cxName: string }, ICX>,
		DeleteCX: {
			key: (params: { cxUuid: string }) => [
				"planningdata",
				"cx",
				"delete",
				params.cxUuid,
			],
			fetchFn: async (params: { cxUuid: string }) => {
				const data = await callDeleteCX(params.cxUuid);
				await queryStore.invalidateKey(["planningdata", "cx"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ cxUuid: string }, boolean>,
		GetAllCX: {
			key: () => ["planningdata", "cx"],
			fetchFn: async () => {
				const session: number = queryStore.sessionGeneration;
				const data = await callGetCXList();
				if (isCurrentSession(session)) planningStore.setCXs(data);
				return data;
			},
			hydrateFn: async () => {
				const data = planningStore.getAllCX();
				return data.length > 0 ? data : null;
			},
			autoRefetch: false,
			persist: true,
		} as IQueryDefinition<void, ICX[]>,
		GetPlan: {
			key: (params: { planUuid: string }) => [
				"planningdata",
				"plan",
				params.planUuid,
			],
			fetchFn: async (params: { planUuid: string }) => {
				const session: number = queryStore.sessionGeneration;
				const data = await callGetPlan(params.planUuid);
				if (isCurrentSession(session)) {
					planningStore.setPlan(data);

					/*
						raukk: the backend just told us what this plan
						really looks like. If a sourcing snapshot was
						computed against a different version — an edit
						made on another machine, which no local save hook
						can see — its numbers no longer describe this
						plan and it has to be flagged.
					*/
					raukkSourcingStore.markStaleIfPlanChanged(
						params.planUuid,
						planContentFingerprint(data)
					);
				}
				return data;
			},
			hydrateFn: async (params: { planUuid: string }) => {
				// getPlan throws when the plan was never stored
				try {
					return await planningStore.getPlan(params.planUuid);
				} catch {
					return null;
				}
			},
			autoRefetch: false,
			persist: true,
		} as IQueryDefinition<{ planUuid: string }, IPlan>,
		GetAllPlans: {
			key: () => ["planningdata", "plan", "list"],
			fetchFn: async () => {
				// dropped if the session ends while this is in flight
				const session: number = queryStore.sessionGeneration;

				/*
					Deliberately not caught: swallowing the failure into an
					empty list told every caller the user owns no plans,
					which renders as an empty planning screen instead of an
					error, and cached that emptiness as a success.
				*/
				const data = await callGetPlanlist();

				// authoritative list: drop plans it does not contain,
				// otherwise the record accumulates every plan ever
				// loaded and hydration rebuilds a superset
				if (isCurrentSession(session)) planningStore.setPlans(data, true);

				// manually set individual plans
				data.forEach((p) =>
					queryStore.addCacheState(
						["planningdata", "plan", p.uuid],
						"GetPlan",
						{ planUuid: p.uuid! },
						p,
						session
					)
				);

				return data;
			},
			hydrateFn: async () => {
				// see GetAllEmpires
				const data = Object.values(planningStore.plans).map((p) =>
					inertClone(p)
				);
				return data.length > 0 ? data : null;
			},
			autoRefetch: false,
			persist: true,
		} as IQueryDefinition<void, IPlan[]>,
		ClonePlan: {
			key: (params: { planUuid: string; cloneName: string }) => [
				"planningdata",
				"plan",
				"clone",
				params.planUuid,
			],
			fetchFn: async (params: {
				planUuid: string;
				cloneName: string;
			}) => {
				return await callClonePlan(
					params.planUuid,
					params.cloneName
				).then(async () => {
					await queryStore.invalidateKey(["planningdata", "empire"], {
						exact: false,
					});
					await queryStore.invalidateKey([
						"planningdata",
						"plan",
						"list",
					]);
				});
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ planUuid: string; cloneName: string },
			IPlanCloneResponse
		>,
		DeletePlan: {
			key: (params: { planUuid: string }) => [
				"planningdata",
				"plan",
				"delete",
				params.planUuid,
			],
			fetchFn: async (params: { planUuid: string }) => {
				return await callDeletePlan(params.planUuid).then(async () => {
					await queryStore.invalidateKey(["planningdata", "empire"], {
						exact: false,
					});
					await queryStore.invalidateKey([
						"planningdata",
						"plan",
						"list",
					]);
					await queryStore.invalidateKey([
						"planningdata",
						"plan",
						params.planUuid,
					]);
					planningStore.deletePlan(params.planUuid);
					// raukk: drop sourcing data, flag its dependents
					raukkSourcingStore.deletePlanData(params.planUuid);
				});
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ planUuid: string }, boolean>,
		CreatePlan: {
			key: () => ["planningdata", "plan", "create"],
			fetchFn: async (params: { data: IPlanCreateData }) => {
				const data = await callCreatePlan(params.data);
				await queryStore.invalidateKey(["planningdata", "plan"], {
					exact: false,
				});
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ data: IPlanCreateData },
			PlanSaveCreateResponseType
		>,
		PatchPlan: {
			key: (params: { planUuid: string }) => [
				"planningdata",
				"plan",
				"patch",
				params.planUuid,
			],
			fetchFn: async (params: {
				planUuid: string;
				data: IPlanSaveData;
			}) => {
				const data = await callSavePlan(params.planUuid, params.data);
				// raukk: saved plan invalidates its own and all
				// downstream snapshots
				raukkSourcingStore.markStale(params.planUuid);
				await queryStore.invalidateKey(["planningdata", "plan"], {
					exact: false,
				});
				await queryStore.invalidateKey(["planningdata", "empire"], {
					exact: false,
				});
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			{ planUuid: string; data: IPlanSaveData },
			PlanSaveCreateResponseType
		>,
		GetExplorationData: {
			key: (params: {
				exchangeTicker: string;
				materialTicker: string;
			}) => [
				"gamedata",
				"marketexploration",
				params.exchangeTicker,
				params.materialTicker,
			],
			fetchFn: async (params: {
				exchangeTicker: string;
				materialTicker: string;
			}) => {
				return await callExplorationData(
					params.exchangeTicker,
					params.materialTicker
				);
			},
			autoRefetch: false,
			persist: true,
			expireTime: 60_000 * 15, // 15 minutes,
		} as IQueryDefinition<
			{
				exchangeTicker: string;
				materialTicker: string;
			},
			IExploration[]
		>,
		GetFIOStorage: {
			key: () => ["gamedata", "fio", "storage"],
			fetchFn: async () => {
				const session: number = queryStore.sessionGeneration;
				return await callDataFIOStorage().then((data: IFIOStorage) => {
					if (isCurrentSession(session))
						planningStore.setFIOStorageData(data);
					return data;
				});
			},
			hydrateFn: async () => {
				const lastModified = planningStore.fio_storage_timestamp;
				if (!lastModified) return null;

				// inverse of planningStore.setFIOStorageData, the pieces
				// are persisted separately. Dates come back as strings
				// from the JSON round trip and need coercing.
				return {
					storage_data: {
						planets: planningStore.fio_storage_planets,
						warehouses: planningStore.fio_storage_warehouses,
						ships: planningStore.fio_storage_ships,
					},
					sites_data: planningStore.fio_sites_planets,
					last_modified: new Date(lastModified),
				} as IFIOStorage;
			},
			autoRefetch: true,
			persist: true,
			expireTime: 60_000 * 5, // 5 minutes
		} as IQueryDefinition<void, IFIOStorage>,
		// GetFIOSites: {
		// 	key: () => ["gamedata", "fio", "sites"],
		// 	fetchFn: async () => {
		// 		return await callDataFIOSites().then((data: IFIOSites) => {
		// 			planningStore.setFIOSitesData(data);
		// 			return data;
		// 		});
		// 	},
		// 	autoRefetch: true,
		// 	persist: true,
		// 	expireTime: 60_000 * 15, // 15 minutes
		// } as IQueryDefinition<void, IFIOSites>,
		GetFIOPlanetFees: {
			key: (params: { planetNaturalId: string }) => [
				"gamedata",
				"fio",
				"planetfees",
				params.planetNaturalId,
			],
			fetchFn: async (params: { planetNaturalId: string }) => {
				// raukk: FIO is a third-party service, a failing call
				// must not break plan loading — fees are then unknown
				try {
					return await callFIOPlanetFees(params.planetNaturalId);
				} catch {
					return null;
				}
			},
			autoRefetch: false,
			persist: true,
			expireTime: 60_000 * config.GAME_DATA_STALE_MINUTES_PLANETS,
		} as IQueryDefinition<
			{ planetNaturalId: string },
			IFIOPlanetFees | null
		>,
		GetPlanetLastPOPR: {
			key: (params: { planetNaturalId: string }) => [
				"gamedata",
				"planet",
				"popr",
				"last",
				params.planetNaturalId,
			],
			fetchFn: async (params: { planetNaturalId: string }) => {
				return await callPlanetLastPOPR(params.planetNaturalId);
			},
			autoRefetch: false,
			persist: true,
			expireTime: 60_000 * config.GAME_DATA_STALE_MINUTES_PLANETS,
		} as IQueryDefinition<{ planetNaturalId: string }, IPopulationReport>,
		PatchUserProfile: {
			key: () => ["user", "profile", "patch"],
			fetchFn: async (params: IUserProfilePatch) => {
				const data = await callPatchProfile(params);
				await userStore.performGetProfile();
				return data;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<IUserProfilePatch, IUserProfile>,
		PostUserResendEmailVerification: {
			key: () => ["user", "verification", "resend"],
			fetchFn: async () => {
				return await callResendEmailVerification();
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<null, IUserResponseDetail>,
		PatchUserChangePassword: {
			key: () => ["user", "password", "patch"],
			fetchFn: async (params: IUserChangePasswordPayload) => {
				// we skip the actual message just to have a boolean
				try {
					await callChangePassword(params);
					return true;
				} catch {
					return false;
				}
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<IUserChangePasswordPayload, boolean>,
		PostUserVerifyEmail: {
			key: () => ["user", "verification", "check"],
			fetchFn: async (params: IUserVerifyEmailPayload) => {
				try {
					return await callVerifyEmail(params);
				} catch {
					return false;
				}
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<IUserVerifyEmailPayload, boolean>,
		PostUserRegistration: {
			key: () => ["user", "account", "registration"],
			fetchFn: async (params: IUserRegistrationPayload) => {
				trackEvent("user_registration", {
					username: params.username,
				});
				try {
					const response = await callRegisterUser(params);
					return response;
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
				} catch (error: any) {
					const apiErrors = error.responseData;

					if (apiErrors && typeof apiErrors === "object") {
						const firstKey = Object.keys(apiErrors)[0];
						const messages = apiErrors[firstKey];
						const userFriendlyMessage = Array.isArray(messages)
							? messages[0]
							: messages;

						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(error as any).validationFields = userFriendlyMessage;
					}

					throw error;
				}
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			IUserRegistrationPayload,
			IUserRegistrationResponse
		>,
		PostUserRequestPasswordReset: {
			key: () => ["user", "account", "request_password_reset"],
			fetchFn: async (params: IUserRequestPasswordResetPayload) => {
				return await callRequestPasswordReset(params.email);
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			IUserRequestPasswordResetPayload,
			IUserRequestPasswordResetResponse
		>,
		PostUserPasswordReset: {
			key: () => ["user", "account", "password_reset"],
			fetchFn: async (params: IUserPasswordResetPayload) => {
				try {
					return await callPasswordReset(
						params.email,
						params.code,
						params.new_password
					);
				} catch {
					return {
						detail: "An error occured. Check your Email, Code and Password. Make sure your password is secure.",
					};
				}
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			IUserPasswordResetPayload,
			IUserPasswordResetResponse
		>,
		PatchPreferences: {
			key: () => ["user", "profile", "patch"],
			fetchFn: async (prefs: IPreference) => {
				// dont try to patch if not logged in, d'oh!
				if (!userStore.isLoggedIn) return;

				return await callPatchUserPreferences(prefs);
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<UserPreferenceType, UserPreferenceType>,
		GetPreferences: {
			key: () => ["user", "profile"],
			fetchFn: async () => {
				const prefs = await callGetUserPreferences();
				Object.assign(userStore.preferences, prefs);

				// handle locale
				const userLocale = userStore.preferences.locale || "en_US";
				userStore
					.setLocale(userLocale, i18n.global as unknown as Composer)
					.catch(console.error);

				return prefs;
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<undefined, UserPreferenceType>,
		GetAnalyticsPlanetInsights: {
			key: (params: { planetNaturalId: string }) => [
				"analytics",
				"planet_insights",
				params.planetNaturalId,
			],
			fetchFn: async (params: { planetNaturalId: string }) => {
				return await callAnalyticsPlanetInsights(
					params.planetNaturalId
				);
			},
			autoRefetch: false,
			persist: true,
			expireTime: 60_000 * config.GAME_DATA_STALE_MINUTES_PLANETS,
		} as IQueryDefinition<
			{ planetNaturalId: string },
			AnalyticsPlanetInsightsPayloadType
		>,
		GetAPIKeys: {
			key: () => ["user", "api", "keys"],
			fetchFn: async () => {
				return await callGetAPIKeys();
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<undefined, APIKeyListType>,
		PostCreateAPIKey: {
			key: () => ["user", "api", "keys", "create"],
			fetchFn: async (params: { name: string }) => {
				return await callPostCreateAPIKey(params.name);
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<
			APIKeyCreatePayloadType,
			APIKeyCreateResponseType
		>,
		DeleteAPIKey: {
			key: () => ["user", "api", "keys", "delete"],
			fetchFn: async (params: { id: string }) => {
				return callDeleteAPIKey(params.id);
			},
			autoRefetch: false,
			persist: false,
		} as IQueryDefinition<{ id: string }, boolean>,
	};

	return {
		repository,
	};
}
