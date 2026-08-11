import {
	reactive,
	computed,
	ComputedRef,
	Reactive,
	ref,
	Ref,
	onScopeDispose,
} from "vue";
import { defineStore } from "pinia";
import pLimit from "p-limit";

import { userActivity } from "@/features/user_activity/userActivityStore";
import { useQueryRepository } from "@/lib/query_cache/queryRepository";
import { isSubset, toCacheKey } from "@/lib/query_cache/cacheKeys";
import { beginHttpCacheBypass } from "@/lib/httpCacheBypass";

import {
	IQueryCacheMeta,
	IQueryDefinition,
	IQueryState,
	JSONValue,
} from "@/lib/query_cache/queryCache.types";
import {
	DataOfDefinition,
	IQueryRepository,
	ParamsOfDefinition,
} from "@/lib/query_cache/queryRepository.types";

/**
 * Bumped whenever the persisted meta shape changes, a mismatch drops
 * all persisted meta on load.
 */
export const CACHE_META_VERSION: number = 1;

/**
 * Upper bound of persisted meta entries, oldest are pruned first.
 * Meta holds no payloads, so this is only a guard against unbounded
 * localStorage growth from parameterized keys (planets, searches).
 */
export const CACHE_META_MAX_ENTRIES: number = 500;

/**
 * Entries whose data outlived their expiry by this much are dropped
 * from memory entirely, even though stale data is normally kept and
 * revalidated in the background.
 */
export const CACHE_GC_MS: number = 24 * 60 * 60 * 1000;

/**
 * Parallel requests a manual full refresh is allowed to fire. A cache
 * holding many planets would otherwise burst dozens of calls at once.
 */
export const REFRESH_CONCURRENCY: number = 6;

/**
 * Cooldown after a failed background revalidation. A background failure
 * deliberately keeps the cached payload and records no error, so without
 * this the entry stays expired and would be retried on every watcher
 * tick and every read for as long as the backend is down.
 */
export const REVALIDATE_RETRY_MS: number = 60_000;

/**
 * Channel other tabs of this browser listen on. Tabs share localStorage
 * and IndexedDB but not memory, so an invalidation performed by the tab
 * that saved would otherwise be invisible everywhere else — leaving the
 * other tabs serving, and hydrating, the pre-save plan.
 */
export const CACHE_CHANNEL_NAME: string = "prunplanner_query_cache";

/**
 * Message a tab publishes after a mutation invalidated cache keys, or
 * after a fetch refreshed durable local storage the other tabs read
 * from too.
 */
export interface IQueryCacheMessage {
	type: "invalidate" | "reset" | "refreshed";
	key?: JSONValue;
	exact?: boolean;
	/** `refreshed` only: when the publishing tab fetched the payload. */
	timestamp?: number;
	/** `refreshed` only: the ttl that fetch resolved to. */
	expireTime?: number;
}

export const useQueryStore = defineStore(
	"prunplanner_query_store",
	() => {
		const inFlight = new Map<string, Promise<unknown>>();

		const queryRepository = useQueryRepository();

		/**
		 * Cross tab channel. Absent in environments without
		 * BroadcastChannel, in which case the cache simply behaves as a
		 * single tab one.
		 */
		let channel: BroadcastChannel | null = null;
		try {
			channel =
				typeof BroadcastChannel !== "undefined"
					? new BroadcastChannel(CACHE_CHANNEL_NAME)
					: null;
		} catch {
			channel = null;
		}

		function publish(message: IQueryCacheMessage): void {
			try {
				channel?.postMessage(message);
			} catch (err) {
				console.error("Query cache broadcast failed", err);
			}
		}

		const cacheState: Reactive<
			Record<string, IQueryState<unknown, unknown>>
		> = reactive({});

		/**
		 * Persisted, payload-free description of what was cached and
		 * when. Rehydrating a payload uses the definitions `hydrateFn`
		 * against IndexedDB or the persisted planning store, so the
		 * megabytes of game data are never duplicated into
		 * localStorage.
		 */
		const cacheMeta: Reactive<Record<string, IQueryCacheMeta>> = reactive(
			{}
		);

		const cacheMetaVersion: Ref<number> = ref(CACHE_META_VERSION);
		const cacheAppVersion: Ref<string> = ref(
			typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""
		);

		/**
		 * Hydration attempt per key, successful or not. Holding the
		 * promise rather than a flag lets concurrent callers await the
		 * same attempt instead of racing into a duplicate fetch.
		 */
		const hydrationAttempted = new Map<string, Promise<boolean>>();

		/** True while a user triggered full refresh is running. */
		const refreshing: Ref<boolean> = ref(false);

		/**
		 * Views holding unsaved work register here. Remounting is not a
		 * route navigation, so `onBeforeRouteLeave` cannot protect them
		 * and a refresh would silently discard the edits.
		 */
		const remountGuards = new Set<() => boolean>();

		/**
		 * Registers a guard that blocks the post refresh remount while
		 * it returns true.
		 *
		 * @author jplacht
		 *
		 * @param {() => boolean} guard Blocks remount while true
		 * @returns {() => void} Unregister callback
		 */
		function registerRemountGuard(guard: () => boolean): () => void {
			remountGuards.add(guard);
			return () => {
				remountGuards.delete(guard);
			};
		}

		/**
		 * Per key counter, bumped whenever an entry is dropped. Work that
		 * started before a drop must not write its result back into the
		 * entry, otherwise an invalidation triggered by a mutation is
		 * silently undone by an older in-flight read.
		 */
		const invalidationEpoch = new Map<string, number>();

		/**
		 * Key prefixes invalidated during this session. A mutation makes
		 * the local stores behind the backend for its whole key space,
		 * not just for keys that happen to be cached right now, so
		 * hydration must stop trusting them — including keys read for the
		 * first time after the mutation. Game data is never invalidated
		 * by a mutation, so it keeps hydrating.
		 */
		const invalidatedPrefixes = new Map<string, JSONValue>();

		function blockHydration(key: JSONValue): void {
			invalidatedPrefixes.set(toCacheKey(key), key);
		}

		function isHydrationBlocked(key: JSONValue): boolean {
			for (const prefix of invalidatedPrefixes.values()) {
				if (isSubset(prefix, key)) return true;
			}
			return false;
		}

		function epochOf(key: string): number {
			return invalidationEpoch.get(key) ?? 0;
		}

		function bumpEpoch(key: string): void {
			invalidationEpoch.set(key, epochOf(key) + 1);
		}

		/**
		 * Incremented after every completed manual refresh. Views key
		 * their data wrappers on it so a refresh re-reads the cache
		 * without a page reload.
		 */
		const refreshGeneration: Ref<number> = ref(0);

		/**
		 * Incremented by `$reset`, i.e. on logout. A fetch that started
		 * for the previous user seeds sibling entries from inside its
		 * fetchFn, which the per key epoch cannot cover because those
		 * keys were never in the cache to be bumped. Callers capture this
		 * before fetching and hand it back so those writes can be
		 * dropped.
		 */
		const sessionGeneration: Ref<number> = ref(0);

		function deleteState(key: string) {
			delete cacheState[key];
			delete cacheMeta[key];
			hydrationAttempted.delete(key);
			bumpEpoch(key);

			/*
				Clearing the hydration attempt is safe because staleness is
				tracked separately: a mutation records its key prefix in
				`invalidatedPrefixes` and hydration refuses anything under
				it. An eviction records nothing, so the entry may be
				rebuilt from local storage — which is what keeps an offline
				user's data reachable after the stale GC drops it.
			*/
		}

		/**
		 * Applies an invalidation another tab performed. Never refetches:
		 * a background tab has nothing on screen to refresh, and N tabs
		 * stampeding the backend after one save would be worse than
		 * letting each fetch lazily on its next read.
		 *
		 * @author jplacht
		 *
		 * @param {MessageEvent<IQueryCacheMessage>} event Channel message
		 */
		function onChannelMessage(event: MessageEvent<IQueryCacheMessage>) {
			const message = event.data;
			if (!message) return;

			if (message.type === "reset") {
				$reset(true);
				return;
			}

			if (message.type === "invalidate" && message.key !== undefined) {
				invalidateKey(message.key, {
					exact: message.exact ?? true,
					skipRefetch: true,
					fromRemote: true,
				});
			}

			if (message.type === "refreshed" && message.key !== undefined) {
				adoptRemoteRefresh(message);
			}
		}

		/**
		 * Adopts a refresh another tab already performed.
		 *
		 * Game data lands in IndexedDB, which every tab of this browser
		 * shares, so by the time this message arrives the new payload is
		 * readable here too — only this tab's memory and its idea of how
		 * old the data is are behind. Taking the other tab's fetch time
		 * and dropping the in-memory copy makes the next read rebuild
		 * from local storage, which is the whole point: N tabs then cost
		 * one fetch between them rather than one each.
		 *
		 * Deliberately does not refetch and does not touch an entry that
		 * is mid-flight here, which would race the fetch this tab is
		 * already running.
		 *
		 * @author raukk
		 *
		 * @param {IQueryCacheMessage} message Channel message
		 */
		function adoptRemoteRefresh(message: IQueryCacheMessage): void {
			const keyHash: string = toCacheKey(message.key as JSONValue);

			const state = cacheState[keyHash];
			const meta = cacheMeta[keyHash];

			// nothing known about this key here, there is no entry whose
			// age could be corrected and nothing to drop
			const definitionName: string | undefined =
				state?.definitionName || meta?.definitionName;
			if (!definitionName) return;

			if (state?.loading || state?.revalidating) return;

			const params = state?.params ?? meta?.params ?? null;

			// deleteState clears the meta too, so record it afterwards
			if (state) deleteState(keyHash);

			cacheMeta[keyHash] = {
				definitionName,
				params,
				timestamp: message.timestamp ?? 0,
				expireTime: message.expireTime,
			};
		}

		if (channel) channel.onmessage = onChannelMessage;

		// an open channel is a live handle; leaving it dangling keeps the
		// store's scope reachable and, in tests, every torn down
		// environment behind
		onScopeDispose(() => {
			try {
				channel?.close();
			} catch {
				/* already closed */
			}
			channel = null;
		});

		/**
		 * Clears the whole cache, e.g. on logout.
		 *
		 * @author jplacht
		 *
		 * @param {boolean} [fromRemote=false] Set when another tab asked
		 * 		for this, which must not be echoed back to it
		 */
		function $reset(fromRemote: boolean = false): void {
			if (!fromRemote) publish({ type: "reset" });

			Object.keys(cacheState).forEach((key) => {
				delete cacheState[key];
				bumpEpoch(key);
			});
			Object.keys(cacheMeta).forEach((key) => delete cacheMeta[key]);
			hydrationAttempted.clear();
			invalidatedPrefixes.clear();
			sessionGeneration.value += 1;
			// note: invalidationEpoch is deliberately NOT cleared, the
			// bumps above are what stop a request still in flight for the
			// previous user from writing its result back
			inFlight.clear();
		}

		function updateState<TParams, TData>(
			cacheKey: string,
			updateData: Partial<IQueryState<unknown, unknown>>
		): void {
			const existing = cacheState[cacheKey] as
				| IQueryState<TParams, TData>
				| undefined;
			// update existing
			if (existing) cacheState[cacheKey] = { ...existing, ...updateData };
			// set new with data
			else
				cacheState[cacheKey] = {
					definitionName: "",
					params: null,
					data: null,
					loading: false,
					error: null,
					timestamp: 0,
					autoRefetch: false,
					revalidating: false,
					hasData: false,
					...updateData,
				};
		}

		/**
		 * Records a cache entry in the persisted meta so a later session
		 * knows the payload exists locally and how old it is.
		 *
		 * @author jplacht
		 *
		 * @param {string} keyHash Cache Key hash
		 * @param {string} definitionName Query definition name
		 * @param {unknown} params Query params
		 * @param {number} timestamp Fetch timestamp
		 * @param {(number | undefined)} expireTime Definition expiry
		 */
		function writeMeta(
			keyHash: string,
			definitionName: string,
			params: unknown,
			timestamp: number,
			expireTime: number | undefined
		): void {
			cacheMeta[keyHash] = {
				definitionName,
				params: params ?? null,
				timestamp,
				expireTime,
			};

			pruneMeta();
		}

		/**
		 * Keeps persisted meta bounded by dropping the oldest entries.
		 *
		 * @author jplacht
		 */
		function pruneMeta(): void {
			const keys = Object.keys(cacheMeta);
			if (keys.length <= CACHE_META_MAX_ENTRIES) return;

			keys.sort(
				(a, b) =>
					(cacheMeta[a]?.timestamp ?? 0) -
					(cacheMeta[b]?.timestamp ?? 0)
			)
				.slice(0, keys.length - CACHE_META_MAX_ENTRIES)
				.forEach((key) => delete cacheMeta[key]);
		}

		/**
		 * Drops all persisted meta if it was written by a different app
		 * or meta version. Payloads live in IndexedDB and the planning
		 * store, both of which are versioned separately, so a mismatch
		 * only means "do not trust these timestamps".
		 *
		 * @author jplacht
		 */
		function validateMetaVersion(): void {
			const appVersion =
				typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

			if (
				cacheMetaVersion.value === CACHE_META_VERSION &&
				cacheAppVersion.value === appVersion
			) {
				return;
			}

			Object.keys(cacheMeta).forEach((key) => delete cacheMeta[key]);
			cacheMetaVersion.value = CACHE_META_VERSION;
			cacheAppVersion.value = appVersion;
		}

		function getCachedData<K extends keyof IQueryRepository>(
			keyHash: string
		): DataOfDefinition<IQueryRepository[K]> | null {
			const state = cacheState[keyHash];
			return state?.data as DataOfDefinition<IQueryRepository[K]> | null;
		}

		/**
		 * True if the entry holds a usable payload. Tracked separately
		 * from `data !== null` so a definition that legitimately caches
		 * null is not refetched forever.
		 *
		 * @author jplacht
		 *
		 * @param {string} keyHash Cache Key hash
		 * @returns {boolean} Entry holds a payload
		 */
		function hasCachedData(keyHash: string): boolean {
			const state = cacheState[keyHash];
			if (!state) return false;
			return state.hasData === true || state.data !== null;
		}

		/**
		 * Resolves a definitions expiry to a concrete duration.
		 *
		 * A derived expiry is a function of the payload, so before the
		 * first fetch there is nothing to resolve it against: the value
		 * this key last resolved to, persisted in the meta, is the best
		 * guess available and keeps a hydrated entry from looking like it
		 * carries no ttl at all.
		 *
		 * @author raukk
		 *
		 * @template TParams Query Params Type
		 * @template TData Query Data Type
		 * @param {IQueryDefinition<TParams, TData>} definition Definition
		 * @param {string} keyHash Cache Key hash
		 * @param {?TData} [data] Payload, when one is at hand
		 * @param {?number} [since] Timestamp the ttl is measured from
		 * @returns {(number | undefined)} Ttl in ms, undefined if endless
		 */
		function resolveExpireTime<TParams, TData>(
			definition: IQueryDefinition<TParams, TData> | undefined,
			keyHash: string,
			data?: TData,
			since?: number
		): number | undefined {
			const expire = definition?.expireTime;

			if (typeof expire === "number") return expire;
			if (typeof expire !== "function") return undefined;

			if (data === undefined || data === null) {
				return (
					cacheState[keyHash]?.expireTime ??
					cacheMeta[keyHash]?.expireTime
				);
			}

			try {
				const resolved: number = expire(data, since ?? Date.now());
				return Number.isFinite(resolved) ? resolved : undefined;
			} catch (err) {
				console.error(
					"Query cache expiry resolution failed",
					keyHash,
					err
				);
				return undefined;
			}
		}

		/**
		 * Attempts to rebuild a queries payload from local durable
		 * storage instead of the network. Silently gives up on any
		 * failure, the caller then falls back to fetching.
		 *
		 * @author jplacht
		 *
		 * @async
		 * @template K Query definition key
		 * @param {string} keyHash Cache Key hash
		 * @param {K} definitionName Query definition name
		 * @param {ParamsOfDefinition<IQueryRepository[K]>} params Params
		 * @returns {Promise<boolean>} Hydration provided data
		 */
		async function hydrateEntry<K extends keyof IQueryRepository>(
			keyHash: string,
			definitionName: K,
			params: ParamsOfDefinition<IQueryRepository[K]>
		): Promise<boolean> {
			const definition = queryRepository.repository[
				definitionName
			] as IQueryDefinition<
				ParamsOfDefinition<IQueryRepository[K]>,
				DataOfDefinition<IQueryRepository[K]>
			>;

			if (!definition?.hydrateFn || definition.persist === false) {
				return false;
			}

			// a mutation already made local storage stale for this key
			// space, only the backend can be trusted for it now
			if (isHydrationBlocked(definition.key(params))) return false;

			const startEpoch = epochOf(keyHash);

			try {
				const data = await definition.hydrateFn(params);

				// the entry was invalidated while we read local storage,
				// resurrecting it here would undo that invalidation
				if (epochOf(keyHash) !== startEpoch) return false;

				// nothing stored locally
				if (data === null || data === undefined) return false;
				if (Array.isArray(data) && data.length === 0) return false;

				// a known meta timestamp keeps the entry fresh for the
				// remainder of its ttl, an unknown one marks it stale so
				// it renders instantly and revalidates in background
				const meta = cacheMeta[keyHash];
				const timestamp: number = meta?.timestamp ?? 0;

				updateState(keyHash, {
					definitionName,
					params: params ?? undefined,
					data,
					hasData: true,
					hydrated: true,
					error: null,
					timestamp,
					// resolved against the payload just restored, so a
					// derived expiry lands on the same boundary it would
					// have had when it was fetched
					expireTime: resolveExpireTime(
						definition,
						keyHash,
						data,
						timestamp
					),
					autoRefetch: definition.autoRefetch,
				});

				return true;
			} catch (err) {
				console.error("Query cache hydration failed", keyHash, err);
				return false;
			}
		}

		/**
		 * Hydrates a key at most once per session, sharing one attempt
		 * between concurrent callers so a second consumer cannot slip
		 * past an unfinished hydration into a duplicate fetch.
		 *
		 * @author jplacht
		 *
		 * @async
		 * @template K Query definition key
		 * @param {string} keyHash Cache Key hash
		 * @param {K} definitionName Query definition name
		 * @param {ParamsOfDefinition<IQueryRepository[K]>} params Params
		 * @returns {Promise<boolean>} Hydration provided data
		 */
		function ensureHydrated<K extends keyof IQueryRepository>(
			keyHash: string,
			definitionName: K,
			params: ParamsOfDefinition<IQueryRepository[K]>
		): Promise<boolean> {
			let attempt = hydrationAttempted.get(keyHash);

			if (!attempt) {
				attempt = hydrateEntry(keyHash, definitionName, params);
				hydrationAttempted.set(keyHash, attempt);
			}

			return attempt;
		}

		/**
		 * Runs a definitions fetchFn and writes the result into the
		 * cache. A background run keeps any existing payload visible and
		 * flags `revalidating` instead of `loading`.
		 *
		 * @author jplacht
		 *
		 * @template K Query definition key
		 * @param {string} keyHash Cache Key hash
		 * @param {K} definitionName Query definition name
		 * @param {ParamsOfDefinition<IQueryRepository[K]>} params Params
		 * @param {boolean} background Run as background revalidation
		 * @returns {Promise<DataOfDefinition<IQueryRepository[K]>>} Data
		 */
		function runFetch<K extends keyof IQueryRepository>(
			keyHash: string,
			definitionName: K,
			params: ParamsOfDefinition<IQueryRepository[K]>,
			background: boolean
		): Promise<DataOfDefinition<IQueryRepository[K]>> {
			const definition = queryRepository.repository[
				definitionName
			] as IQueryDefinition<
				ParamsOfDefinition<IQueryRepository[K]>,
				DataOfDefinition<IQueryRepository[K]>
			>;

			const shouldCache = definition.persist !== false;
			const startEpoch = epochOf(keyHash);

			updateState(keyHash, {
				definitionName,
				params: params ?? undefined,
				loading: background
					? (cacheState[keyHash]?.loading ?? false)
					: true,
				revalidating: background,
				error: background ? (cacheState[keyHash]?.error ?? null) : null,
				autoRefetch: definition.autoRefetch,
				expireTime: resolveExpireTime(definition, keyHash),
			});

			/*
				Held in an object rather than a plain binding so the body
				can tell whether this run is still the one registered in
				`inFlight`. A fetchFn that throws before its first await
				runs the `finally` while the initializer is still on the
				stack, where `run.promise` simply reads undefined instead
				of hitting a temporal dead zone.
			*/
			const run: {
				promise?: Promise<DataOfDefinition<IQueryRepository[K]>>;
			} = {};

			run.promise = (async () => {
				try {
					const result: DataOfDefinition<IQueryRepository[K]> =
						await definition.fetchFn(
							params as ParamsOfDefinition<IQueryRepository[K]>
						);

					// invalidated mid-flight: hand the result to the
					// caller but do not write it back, it is already
					// known to be outdated
					if (epochOf(keyHash) !== startEpoch) {
						return result as DataOfDefinition<IQueryRepository[K]>;
					}

					if (shouldCache) {
						const timestamp = Date.now();
						const expireTime: number | undefined =
							resolveExpireTime(
								definition,
								keyHash,
								result,
								timestamp
							);

						updateState(keyHash, {
							data: result,
							hasData: true,
							hydrated: false,
							error: null,
							timestamp,
							expireTime,
							// the backend answered, drop any backoff
							revalidateFailedAt: undefined,
						});

						writeMeta(
							keyHash,
							definitionName as string,
							params,
							timestamp,
							expireTime
						);

						/*
							The payload also went into IndexedDB, which the
							other tabs share. Tell them, so they adopt this
							fetch time and rebuild from local storage on
							their next read instead of each fetching the
							same megabyte for themselves. Only for
							definitions that can rebuild that way: dropping
							an entry the other tab cannot hydrate would
							force exactly the fetch this avoids.
						*/
						if (definition.hydrateFn) {
							publish({
								type: "refreshed",
								key: definition.key(params),
								timestamp,
								expireTime,
							});
						}
					}

					return result as DataOfDefinition<IQueryRepository[K]>;
				} catch (err) {
					const error =
						err instanceof Error ? err : new Error(String(err));

					const superseded = epochOf(keyHash) !== startEpoch;

					// a failed background refresh must not destroy the
					// cached payload the user is currently looking at,
					// nor may either case revive an invalidated entry
					if (background || superseded) {
						/*
							A background failure records no error so the
							cached payload stays usable, so note the
							attempt instead or the entry stays expired and
							is retried on every tick and every read. Only
							while this run still owns the entry: a
							superseded run must not back off the
							replacement that took its place.
						*/
						if (cacheState[keyHash] && !superseded) {
							updateState(keyHash, {
								revalidateFailedAt: Date.now(),
							});
						}
						console.error(err);
					} else if (hasCachedData(keyHash)) {
						// a forced refresh that failed, e.g. the manual
						// "refresh data" action: the caller is told, but
						// the payload on screen survives it
						updateState(keyHash, {
							revalidateFailedAt: Date.now(),
						});
						console.error(err);
					} else {
						/*
							Nothing usable came back and nothing usable was
							there before, so keeping the entry only leaves a
							record of the failure behind: it holds no data,
							`checkEntryStatusAndRefresh` skips anything
							carrying an error, and the recorded hydration
							attempt would stop local storage being consulted
							on the next try. Drop it instead — the caller
							still gets the rejection, and the next read
							starts clean, hydration included, so a retry can
							fall back to local data when the backend is the
							thing that is broken.
						*/
						deleteState(keyHash);
						console.error(err);
					}

					throw error;
				} finally {
					/*
						Only tidy up what this run still owns. A run that
						was superseded — by an invalidation, or by a
						replacement fetch for the same key — must not
						clear the flags of, or drop the in-flight entry
						of, whatever took its place.
					*/
					const superseded = epochOf(keyHash) !== startEpoch;

					if (!superseded && cacheState[keyHash]) {
						updateState(keyHash, {
							loading: background
								? (cacheState[keyHash]?.loading ?? false)
								: false,
							revalidating: false,
						});
					}

					if (inFlight.get(keyHash) === run.promise) {
						inFlight.delete(keyHash);
					}

					if (!shouldCache && !superseded) deleteState(keyHash);
				}
			})();

			inFlight.set(keyHash, run.promise);

			return run.promise as Promise<
				DataOfDefinition<IQueryRepository[K]>
			>;
		}

		/**
		 * Kicks off a background revalidation, swallowing failures. The
		 * caller keeps serving the cached payload either way.
		 *
		 * @author jplacht
		 *
		 * @template K Query definition key
		 * @param {string} keyHash Cache Key hash
		 * @param {K} definitionName Query definition name
		 * @param {ParamsOfDefinition<IQueryRepository[K]>} params Params
		 */
		function revalidate<K extends keyof IQueryRepository>(
			keyHash: string,
			definitionName: K,
			params: ParamsOfDefinition<IQueryRepository[K]>
		): void {
			if (inFlight.has(keyHash)) return;

			// back off after a failure, an entry serving stale data is
			// not worth hammering an unreachable backend for
			const failedAt = cacheState[keyHash]?.revalidateFailedAt ?? 0;
			if (failedAt && Date.now() - failedAt < REVALIDATE_RETRY_MS) {
				return;
			}

			runFetch(keyHash, definitionName, params, true).catch(() => {
				/* handled in runFetch, cached data stays valid */
			});
		}

		async function execute<K extends keyof IQueryRepository>(
			definitionName: K,
			params: ParamsOfDefinition<IQueryRepository[K]>,
			options?: { forceRefetch?: boolean }
		): Promise<DataOfDefinition<IQueryRepository[K]>> {
			const definition = queryRepository.repository[
				definitionName
			] as IQueryDefinition<
				ParamsOfDefinition<IQueryRepository[K]>,
				DataOfDefinition<IQueryRepository[K]>
			>;

			const keyHash = toCacheKey(definition.key(params));

			// initialize entry if missing
			if (!cacheState[keyHash]) {
				updateState(keyHash, { definitionName });
			}

			updateState(keyHash, {
				expireTime: resolveExpireTime(definition, keyHash),
			});

			const startEpoch = epochOf(keyHash);

			// no payload in memory yet: try local storage before the
			// network, this is what removes the loading screen after a
			// hard refresh
			if (!options?.forceRefetch && !hasCachedData(keyHash)) {
				await ensureHydrated(keyHash, definitionName, params);
			}

			/*
				Awaiting hydration gives an invalidation the chance to drop
				this entry, so the invariant established above no longer
				holds. Rebuild a clean entry and let it fall through to a
				fetch rather than trusting anything from before the drop.
			*/
			if (epochOf(keyHash) !== startEpoch) {
				delete cacheState[keyHash];
			}

			if (!cacheState[keyHash]) {
				updateState(keyHash, {
					definitionName,
					expireTime: resolveExpireTime(definition, keyHash),
				});
			}

			const state = cacheState[keyHash]!;

			const now = Date.now();
			// the entry's own resolved ttl, not the definitions: a derived
			// expiry only has a value once a payload has been seen
			const ttl = state.expireTime;
			const expired = ttl !== undefined && now - state.timestamp > ttl;

			/*
				Data restored from local storage for a definition without
				an expiry is user owned (plans, empires, cx) and may have
				been changed from another browser. It paints instantly,
				but is always confirmed against the backend once per
				session. Game data carries a ttl and is trusted until it
				runs out.
			*/
			const unconfirmed = state.hydrated === true && ttl === undefined;

			// serve cached data, revalidating in the background when it
			// aged past its expiry
			if (hasCachedData(keyHash) && !options?.forceRefetch) {
				if (expired || unconfirmed) {
					revalidate(keyHash, definitionName, params);
				}

				return getCachedData<K>(keyHash) as DataOfDefinition<
					IQueryRepository[K]
				>;
			}

			// return in-flight promise if exists
			if (inFlight.has(keyHash) && !options?.forceRefetch) {
				return inFlight.get(keyHash)! as Promise<
					DataOfDefinition<IQueryRepository[K]>
				>;
			}

			if (!options?.forceRefetch) {
				return runFetch(keyHash, definitionName, params, false);
			}

			// forced means the caller wants the backend, not whatever the
			// browser happens to be holding for an endpoint that opted
			// into the HTTP cache
			const releaseBypass = beginHttpCacheBypass();

			try {
				return await runFetch(keyHash, definitionName, params, false);
			} finally {
				releaseBypass();
			}
		}

		/**
		 * Peaks a queries state readonly without ever creating it on call.
		 * Will take into account existance as well as "fresh" state, will
		 * return undefined if the state is not existing or stale.
		 *
		 * @author jplacht
		 *
		 * @readonly
		 * @template TParams Query Params Type
		 * @template TData Query Data Type
		 * @param {JSONValue} key Query Key
		 * @returns {(QueryState<TParams, TData> | undefined)} QueryState or Undefined
		 */
		function peekQueryState<TParams, TData>(
			key: JSONValue
		): IQueryState<TParams, TData> | undefined {
			return isKnownAndFresh(key).value
				? (cacheState[toCacheKey(key)] as IQueryState<TParams, TData>)
				: undefined;
		}

		/**
		 * Checks a given query key for existance and if still fresh.
		 * Freshness is given if:
		 * - Key must exist
		 * - Key does not have an expiry time, it is always fresh
		 * - Or key has an expiry time that is still valid now
		 *
		 * @author jplacht
		 *
		 * @param {JSONValue} key Query Key
		 * @returns {ComputedRef<boolean>} Existing and fresh state
		 */
		function isKnownAndFresh(key: JSONValue): ComputedRef<boolean> {
			return computed(() => {
				const keyHash: string = toCacheKey(key);
				const state = cacheState[keyHash];

				// state is undefined => false
				if (!state) return false;

				// state is known
				// if no expireTime, its fresh => true
				if (!state.expireTime) return true;

				// check the expire time

				const now = Date.now();
				const expired = now - state.timestamp > state.expireTime;

				if (expired) {
					return false;
				} else {
					return true;
				}
			});
		}

		/**
		 * Invalidates given key in the store
		 *
		 * @author jplacht
		 *
		 * @async
		 * @template TParams Query Params Type
		 * @template TData Query Data Type
		 * @param {JSONValue} key Query Key
		 * @param {{ exact?: boolean; forceRefetch?: boolean; skipRefetch?: boolean; keepHydration?: boolean }} [options={
		 * 			exact: true,
		 * 			forceRefetch: false,
		 * 			skipRefetch: false,
		 * 		}] Options, by default will check for exact matches and doesn't force refresh.
		 * 		`keepHydration` marks the call as eviction rather than a
		 * 		mutation, leaving local storage trusted for the key.
		 * @returns {Promise<void>}
		 */
		async function invalidateKey<K extends keyof IQueryRepository, TParams>(
			key: JSONValue,
			options: {
				keepHydration?: boolean;
				exact?: boolean;
				forceRefetch?: boolean;
				skipRefetch?: boolean;
				fromRemote?: boolean;
			} = {
				exact: true,
				forceRefetch: false,
				skipRefetch: false,
			}
		): Promise<void> {
			const keyHash: string = toCacheKey(key);

			/*
				Everything under this key is now known to be behind the
				backend, whether or not it is currently cached. Eviction
				(stale GC, dropping FIO data on sign-out) is not a
				mutation and must not disable hydration for the key.
			*/
			if (!options.keepHydration) blockHydration(key);

			/*
				Tell the other tabs. They hold their own copy of this key
				in their own memory, and their own planningStore that
				hydration reads from, neither of which this mutation
				touched. `fromRemote` stops a received message being
				echoed straight back out.
			*/
			if (!options.keepHydration && !options.fromRemote) {
				publish({
					type: "invalidate",
					key,
					exact: options.exact ?? true,
				});
			}

			const toRefetch: {
				definitionKey: K;
				params: TParams | null;
			}[] = [];

			if (options.exact) {
				const existingEntry = cacheState[keyHash];
				if (existingEntry) {
					toRefetch.push({
						definitionKey: existingEntry.definitionName as K,
						params: existingEntry.params as TParams | null,
					});
				}

				// delete exact matched key and inflight
				deleteState(keyHash);
				inFlight.delete(keyHash);
			} else {
				for (const existingKey of Object.keys(cacheState)) {
					// Note: as keys are strings, need to parse them to JSONValue
					if (isSubset(key, JSON.parse(existingKey) as JSONValue)) {
						// add subset query
						const existingEntry = cacheState[existingKey];
						toRefetch.push({
							definitionKey: existingEntry.definitionName as K,
							params: existingEntry.params as TParams | null,
						});

						// delete non-exact matched key and inflight
						deleteState(existingKey);
						inFlight.delete(existingKey);
					}
				}
			}

			// check and trigger refetches if defined or forced
			toRefetch.map(async (refetchEntry) => {
				// get definition
				const definition: IQueryRepository[K] =
					queryRepository.repository[refetchEntry.definitionKey];
				// refetch can be forced from invalidate options or set
				// in the query definition itself

				if (
					!options.skipRefetch &&
					(options.forceRefetch || definition!.autoRefetch)
				) {
					// if params are null, no params required, pass undefined
					await execute(
						refetchEntry.definitionKey as K,
						refetchEntry.params as ParamsOfDefinition<
							IQueryRepository[K]
						>
					);
				}
			});
		}

		/**
		 * Allows manually creating a cache state
		 *
		 * @author jplacht
		 *
		 * @async
		 * @template TParams Params
		 * @template TData Data
		 * @param {JSONValue} key Key Value
		 * @param {QueryDefinition<TParams, TData>} definition Query Definition
		 * @param {TParams} params Query Params
		 * @param {TData} data Result Data
		 * @returns {Promise<void>} void
		 */
		async function addCacheState<
			K extends keyof IQueryRepository,
			TParams,
			TData,
		>(
			key: JSONValue,
			definitionName: K,
			params: TParams,
			data: TData,
			sessionGuard?: number
		): Promise<void> {
			// seeded by a fetch that belonged to a previous session, e.g.
			// one still in flight when the user logged out
			if (
				sessionGuard !== undefined &&
				sessionGuard !== sessionGeneration.value
			) {
				return;
			}

			const keyHash: string = toCacheKey(key);
			// identify correct definition
			const definition: IQueryRepository[K] =
				queryRepository.repository[definitionName];

			// do not overwrite existing state for key
			if (!cacheState[keyHash]) {
				const timestamp = Date.now();
				const expireTime: number | undefined = resolveExpireTime(
					definition as IQueryDefinition<TParams, TData>,
					keyHash,
					data,
					timestamp
				);

				updateState(keyHash, {
					definitionName,
					params: params,
					data: data,
					hasData: true,
					hydrated: false,
					loading: false,
					error: null,
					timestamp,
					expireTime,
				});

				if (definition.persist !== false) {
					writeMeta(
						keyHash,
						definitionName as string,
						params,
						timestamp,
						expireTime
					);
				}
			}
		}

		/**
		 * True, if any cache state is currently blocking-loading. A
		 * background revalidation of already usable data is explicitly
		 * not counted, it must never gate rendering.
		 *
		 * @author jplacht
		 *
		 * @type {ComputedRef<boolean>}
		 */
		const isAnythingLoading: ComputedRef<boolean> = computed(() =>
			Object.values(cacheState).some((s) => s.loading)
		);

		/**
		 * True, if any cache entry is refreshing in the background.
		 *
		 * @author jplacht
		 *
		 * @type {ComputedRef<boolean>}
		 */
		const isAnythingRevalidating: ComputedRef<boolean> = computed(() =>
			Object.values(cacheState).some((s) => s.revalidating)
		);

		/**
		 * Timestamp of the oldest still cached payload, i.e. the age the
		 * displayed data is at worst. Null while nothing is cached.
		 *
		 * @author jplacht
		 *
		 * @type {ComputedRef<number | null>}
		 */
		const oldestDataTimestamp: ComputedRef<number | null> = computed(() => {
			const withData = Object.values(cacheState).filter(
				(s) => s.hasData === true || s.data !== null
			);

			/*
				An entry restored from local storage without a persisted
				timestamp has an unknown, potentially very old age.
				Reporting the minimum of the others would claim the data on
				screen is fresher than it is, so say nothing instead.
			*/
			if (withData.some((s) => s.timestamp <= 0)) return null;

			return withData.length > 0
				? Math.min(...withData.map((s) => s.timestamp))
				: null;
		});

		/**
		 * True while something on screen came from local storage with no
		 * recorded fetch time, i.e. its age cannot be stated. Lets the UI
		 * say "unknown" rather than silently show nothing, which matters
		 * for a cache whose whole purpose is serving data that is old.
		 *
		 * @author jplacht
		 *
		 * @type {ComputedRef<boolean>}
		 */
		const hasUnknownDataAge: ComputedRef<boolean> = computed(() =>
			Object.values(cacheState).some(
				(s) =>
					(s.hasData === true || s.data !== null) && s.timestamp <= 0
			)
		);

		/**
		 * Forces a refetch of every cached entry that holds data,
		 * keeping the current payload visible while it runs. This backs
		 * the manual "refresh data" action, letting a user pull fresh
		 * prices without a page reload.
		 *
		 * @author jplacht
		 *
		 * @async
		 * @template K Query definition key
		 * @param {JSONValue} [key] Optional key prefix, refreshes all when omitted
		 * @returns {Promise<void>}
		 */
		async function refreshAll<K extends keyof IQueryRepository>(
			key?: JSONValue
		): Promise<void> {
			// a second pass would double every request and its finally
			// would clear `refreshing` while the first is still running
			if (refreshing.value) return;

			refreshing.value = true;

			const targets: {
				definitionName: K;
				params: ParamsOfDefinition<IQueryRepository[K]>;
			}[] = [];

			for (const [existingKey, entry] of Object.entries(cacheState)) {
				if (!entry.definitionName) continue;
				if (entry.loading || entry.revalidating) continue;

				const definition =
					queryRepository.repository[entry.definitionName as K];
				if (!definition || definition.persist === false) continue;

				if (
					key !== undefined &&
					!isSubset(key, JSON.parse(existingKey) as JSONValue)
				) {
					continue;
				}

				targets.push({
					definitionName: entry.definitionName as K,
					params: entry.params as ParamsOfDefinition<
						IQueryRepository[K]
					>,
				});
			}

			// a full refresh can touch every cached planet, keep the
			// burst off the backends throat
			const limit = pLimit(REFRESH_CONCURRENCY);

			// held across the whole run rather than per request: the
			// point of the button is that nothing in it comes from a
			// cache, and each `execute` opens its own window anyway
			const releaseBypass = beginHttpCacheBypass();

			try {
				await Promise.allSettled(
					targets.map((t) =>
						limit(() =>
							execute(t.definitionName, t.params, {
								forceRefetch: true,
							})
						)
					)
				);
			} finally {
				releaseBypass();
				refreshing.value = false;

				/*
					Views hold snapshots of their query results taken when
					they mounted, bumping the generation lets the app
					remount them against the now current cache. A view
					carrying unsaved work blocks that: the cache is still
					refreshed, it just keeps its own state until the user
					navigates.
				*/
				let blocked = false;
				for (const guard of remountGuards) {
					try {
						if (guard()) blocked = true;
					} catch (err) {
						console.error("Remount guard failed", err);
					}
				}

				if (!blocked) refreshGeneration.value += 1;
			}
		}

		// Regular status watcher
		let intervalId: ReturnType<typeof setInterval> | null = null;

		/**
		 * Caps the fetches one watcher tick may run at once. Schedule
		 * anchored expiry deliberately lines entries up on shared
		 * boundaries — every exchange at its rollover, planets on a
		 * common COGC program end — so a tick can find dozens expired
		 * together, and without a limit it would burst them all at the
		 * backend in one go. Duplicate queueing across ticks is harmless:
		 * `execute` dedupes against in-flight work when the slot runs.
		 */
		const statusRefreshLimit = pLimit(REFRESH_CONCURRENCY);

		/**
		 * Iterates over cache entries and triggers refresh if
		 * marked as to be automatically refetched.
		 *
		 * Stale entries that still hold a usable payload are kept: they
		 * are served immediately and revalidated on next access, so the
		 * user never waits on a loading screen for data that only just
		 * aged out. Only entries without data, or long past their
		 * expiry, are dropped.
		 *
		 * @author jplacht
		 */
		function checkEntryStatusAndRefresh<
			K extends keyof IQueryRepository,
		>() {
			// inactivity check, skip if true
			if (userActivity.shouldDelay()) return;

			const now = Date.now();

			for (const [key, entry] of Object.entries(cacheState)) {
				if (
					entry.expireTime &&
					!entry.loading &&
					!entry.revalidating &&
					entry.error === null &&
					entry.timestamp &&
					entry.expireTime &&
					now - entry.timestamp > entry.expireTime
				) {
					// identify correct definition
					const definition: IQueryRepository[K] =
						queryRepository.repository[entry.definitionName as K];

					if (definition && definition.autoRefetch) {
						statusRefreshLimit(() =>
							execute(
								entry.definitionName as K,
								entry.params as ParamsOfDefinition<
									IQueryRepository[K]
								>
							)
						).catch((err) => console.error(err));
					} else if (
						!(entry.hasData === true || entry.data !== null) ||
						now - entry.timestamp > CACHE_GC_MS
					) {
						// nothing usable to serve, or far beyond any
						// reasonable staleness => drop it
						// eviction, not a mutation: local storage is
						// still a valid source for this key
						invalidateKey(JSON.parse(key) as JSONValue, {
							exact: true,
							keepHydration: true,
						});
					}
				}
			}
		}

		/**
		 * Starts the entry status watcher, prevents multiple watchers
		 * to be running in parallel.
		 *
		 * @author jplacht
		 */
		function startStatusWatcher() {
			// prevent multiple invervals running
			if (intervalId !== null) return;

			intervalId = setInterval(
				() => checkEntryStatusAndRefresh(),
				10_000
			);
		}

		// start the status watcher
		startStatusWatcher();

		return {
			$reset,
			cacheState,
			cacheMeta,
			cacheMetaVersion,
			cacheAppVersion,
			peekQueryState,
			execute,
			invalidateKey,
			addCacheState,
			refreshAll,
			refreshing,
			refreshGeneration,
			sessionGeneration,
			registerRemountGuard,
			isAnythingLoading,
			isAnythingRevalidating,
			oldestDataTimestamp,
			hasUnknownDataAge,
			// only exposed for testing
			checkEntryStatusAndRefresh,
			startStatusWatcher,
			validateMetaVersion,
		};
	},
	{
		persist: {
			pick: ["cacheMeta", "cacheMetaVersion", "cacheAppVersion"],
			// runs after localStorage was read back into the store,
			// dropping meta that a different app version wrote
			afterHydrate: (ctx) => {
				(
					ctx.store as unknown as {
						validateMetaVersion: () => void;
					}
				).validateMetaVersion();
			},
		},
		// broadcast: {
		// 	enable: true,
		// 	persisted: false,
		// 	pick: ["cacheState"],
		// 	debounce: 1_000,
		// 	channel: "prunplanner_query_data",
		// },
	}
);
