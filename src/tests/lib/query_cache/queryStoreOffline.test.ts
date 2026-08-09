import { setActivePinia, createPinia } from "pinia";
import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	vi,
	MockInstance,
} from "vitest";

import {
	useQueryStore,
	CACHE_META_VERSION,
	CACHE_META_MAX_ENTRIES,
	CACHE_GC_MS,
	REVALIDATE_RETRY_MS,
} from "@/lib/query_cache/queryStore";
import { toCacheKey } from "@/lib/query_cache/cacheKeys";

// Types & Interfaces
import { IQueryState, JSONValue } from "@/lib/query_cache/queryCache.types";

/*
	Fake repository. Definitions deliberately cover the whole matrix the
	offline cache branches on:

	- ttlQuery      expiry + hydrateFn        (game data)
	- plainQuery    expiry, NO hydrateFn      (regression guard, the
	                                           hydrateFn is optional)
	- userQuery     NO expiry + hydrateFn     (user owned, must always
	                                           be confirmed once)
	- nullQuery     resolves null             (hasData vs data !== null)
	- volatileQuery persist: false            (never cached, no meta)
	- autoQuery     autoRefetch               (status watcher)
*/
const mocks = vi.hoisted(() => ({
	fetchTtl: vi.fn(),
	hydrateTtl: vi.fn(),
	fetchPlain: vi.fn(),
	fetchUser: vi.fn(),
	hydrateUser: vi.fn(),
	fetchNull: vi.fn(),
	fetchVolatile: vi.fn(),
	fetchAuto: vi.fn(),
	shouldDelay: vi.fn(),
}));

vi.mock("@/lib/query_cache/queryRepository", () => ({
	useQueryRepository: () => ({
		repository: {
			ttlQuery: {
				key: (params: unknown) => ["ttlQuery", params],
				expireTime: 1000,
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchTtl,
				hydrateFn: mocks.hydrateTtl,
			},
			plainQuery: {
				key: (params: unknown) => ["plainQuery", params],
				expireTime: 1000,
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchPlain,
			},
			userQuery: {
				key: (params: unknown) => ["userQuery", params],
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchUser,
				hydrateFn: mocks.hydrateUser,
			},
			nullQuery: {
				key: (params: unknown) => ["nullQuery", params],
				expireTime: 1000,
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchNull,
			},
			volatileQuery: {
				key: (params: unknown) => ["volatileQuery", params],
				persist: false,
				autoRefetch: false,
				fetchFn: mocks.fetchVolatile,
			},
			autoQuery: {
				key: (params: unknown) => ["autoQuery", params],
				expireTime: 1000,
				persist: true,
				autoRefetch: true,
				fetchFn: mocks.fetchAuto,
			},
		},
	}),
}));

// queryStore imports the already constructed singleton, spying on the
// useUserActivity factory would have no effect
vi.mock("@/features/user_activity/userActivityStore", () => ({
	userActivity: { shouldDelay: mocks.shouldDelay },
}));

/** Fixed "now", far enough from 0 to make CACHE_GC_MS offsets positive. */
const NOW: number = 1_000_000_000;

let store: ReturnType<typeof useQueryStore>;
let consoleErrorSpy: MockInstance;

type ExecuteOptions = { forceRefetch?: boolean };

/**
 * Calls the stores execute with the fake repositorys definition names.
 *
 * @param {string} definitionName Fake definition name
 * @param {unknown} [params] Query params
 * @param {ExecuteOptions} [options] Execute options
 * @returns {Promise<unknown>} Query data
 */
function exec(
	definitionName: string,
	params?: unknown,
	options?: ExecuteOptions
): Promise<unknown> {
	return (
		store.execute as unknown as (
			name: string,
			params?: unknown,
			options?: ExecuteOptions
		) => Promise<unknown>
	)(definitionName, params, options);
}

/**
 * Writes a cache entry directly, bypassing execute.
 *
 * @param {JSONValue} key Cache key
 * @param {Partial<IQueryState<unknown, unknown>>} entry Entry overrides
 * @returns {string} Cache key hash
 */
function seedEntry(
	key: JSONValue,
	entry: Partial<IQueryState<unknown, unknown>>
): string {
	const hash: string = toCacheKey(key);

	store.cacheState[hash] = {
		definitionName: "",
		params: null,
		data: null,
		loading: false,
		error: null,
		timestamp: 0,
		autoRefetch: false,
		revalidating: false,
		hasData: false,
		...entry,
	};

	return hash;
}

/**
 * Drains the microtask queue so background revalidations settle.
 *
 * @returns {Promise<void>} void
 */
async function flushPromises(): Promise<void> {
	for (let i = 0; i < 20; i++) {
		await Promise.resolve();
	}
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.shouldDelay.mockReturnValue(false);
	consoleErrorSpy = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);

	setActivePinia(createPinia());
	store = useQueryStore();

	// note: the store is created before the fake timers so its status
	// watcher interval stays on real timers and never self triggers
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	consoleErrorSpy.mockRestore();
	vi.useRealTimers();
});

describe("queryStore: stale-while-revalidate", () => {
	it("serves the stale payload and revalidates in the background", async () => {
		let resolveSecond: (value: unknown) => void = () => {};

		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveSecond = resolve;
				})
		);

		const hash: string = toCacheKey(["ttlQuery", "swr"]);

		const first = await exec("ttlQuery", "swr");
		expect(first).toStrictEqual({ v: 1 });
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(1);

		// age the entry past its expiry
		vi.setSystemTime(NOW + 5000);

		const stale = await exec("ttlQuery", "swr");

		// old value, synchronously, while the refetch is still pending
		expect(stale).toStrictEqual({ v: 1 });
		expect(store.cacheState[hash].data).toStrictEqual({ v: 1 });
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);

		resolveSecond({ v: 2 });
		await flushPromises();

		// fresh value landed
		expect(store.cacheState[hash].data).toStrictEqual({ v: 2 });
		expect(store.cacheState[hash].timestamp).toBe(NOW + 5000);

		const third = await exec("ttlQuery", "swr");
		expect(third).toStrictEqual({ v: 2 });
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);
	});

	it("flags revalidating, not loading, during a background run", async () => {
		let resolveSecond: (value: unknown) => void = () => {};

		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveSecond = resolve;
				})
		);

		const hash: string = toCacheKey(["ttlQuery", "flags"]);

		await exec("ttlQuery", "flags");
		expect(store.cacheState[hash].revalidating).toBe(false);

		vi.setSystemTime(NOW + 5000);
		await exec("ttlQuery", "flags");

		expect(store.cacheState[hash].revalidating).toBe(true);
		expect(store.cacheState[hash].loading).toBe(false);
		expect(store.isAnythingLoading).toBe(false);
		expect(store.isAnythingRevalidating).toBe(true);

		resolveSecond({ v: 2 });
		await flushPromises();

		expect(store.cacheState[hash].revalidating).toBe(false);
		expect(store.isAnythingRevalidating).toBe(false);
		expect(store.isAnythingLoading).toBe(false);
	});

	it("keeps cached data and no error when a background run rejects", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockRejectedValueOnce(new Error("network down"));

		const hash: string = toCacheKey(["ttlQuery", "reject"]);

		await exec("ttlQuery", "reject");

		vi.setSystemTime(NOW + 5000);
		const stale = await exec("ttlQuery", "reject");
		expect(stale).toStrictEqual({ v: 1 });

		await flushPromises();

		expect(store.cacheState[hash].data).toStrictEqual({ v: 1 });
		expect(store.cacheState[hash].error).toBeNull();
		expect(store.cacheState[hash].hasData).toBe(true);
		expect(store.cacheState[hash].revalidating).toBe(false);
		expect(store.cacheState[hash].timestamp).toBe(NOW);
	});

	it("sets error and rejects when a foreground fetch fails", async () => {
		mocks.fetchTtl.mockRejectedValueOnce(new Error("boom"));

		const hash: string = toCacheKey(["ttlQuery", "fgfail"]);

		await expect(exec("ttlQuery", "fgfail")).rejects.toThrow("boom");

		expect(store.cacheState[hash].error).toBeInstanceOf(Error);
		expect(store.cacheState[hash].data).toBeNull();
		expect(store.cacheState[hash].loading).toBe(false);
	});

	it("awaits the network and returns fresh data on forceRefetch", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockResolvedValueOnce({ v: 2 });

		const first = await exec("ttlQuery", "force");
		expect(first).toStrictEqual({ v: 1 });

		const forced = await exec("ttlQuery", "force", { forceRefetch: true });

		expect(forced).toStrictEqual({ v: 2 });
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);
		expect(
			store.cacheState[toCacheKey(["ttlQuery", "force"])].data
		).toStrictEqual({ v: 2 });
	});
});

describe("queryStore: hydration", () => {
	it("rebuilds a payload from local storage without hitting the network", async () => {
		const hash: string = toCacheKey(["ttlQuery", "h1"]);

		// a known meta timestamp keeps the hydrated entry fresh
		store.cacheMeta[hash] = {
			definitionName: "ttlQuery",
			params: "h1",
			timestamp: NOW - 500,
			expireTime: 1000,
		};

		mocks.hydrateTtl.mockResolvedValueOnce({ v: "local" });

		const data = await exec("ttlQuery", "h1");

		expect(data).toStrictEqual({ v: "local" });
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
		expect(mocks.fetchTtl).not.toHaveBeenCalled();

		expect(store.cacheState[hash].hydrated).toBe(true);
		expect(store.cacheState[hash].hasData).toBe(true);
		expect(store.cacheState[hash].timestamp).toBe(NOW - 500);
	});

	it("treats a hydrated entry without meta as stale and revalidates", async () => {
		const hash: string = toCacheKey(["ttlQuery", "h2"]);

		let resolveFetch: (value: unknown) => void = () => {};

		mocks.hydrateTtl.mockResolvedValueOnce({ v: "local" });
		mocks.fetchTtl.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
		);

		const data = await exec("ttlQuery", "h2");

		// paints instantly from local storage
		expect(data).toStrictEqual({ v: "local" });
		expect(store.cacheState[hash].timestamp).toBe(0);
		expect(store.cacheState[hash].hydrated).toBe(true);
		expect(store.cacheState[hash].revalidating).toBe(true);
		expect(store.cacheState[hash].loading).toBe(false);
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(1);

		resolveFetch({ v: "network" });
		await flushPromises();

		expect(store.cacheState[hash].data).toStrictEqual({ v: "network" });
		expect(store.cacheState[hash].hydrated).toBe(false);
		expect(store.cacheState[hash].timestamp).toBe(NOW);
	});

	it("attempts hydration only once per key, even when it yields nothing", async () => {
		mocks.hydrateTtl.mockResolvedValue(null);
		mocks.fetchTtl.mockRejectedValueOnce(new Error("offline"));
		mocks.fetchTtl.mockResolvedValueOnce({ v: "network" });

		await expect(exec("ttlQuery", "h3")).rejects.toThrow("offline");
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);

		// second attempt: still no cached payload, but hydration is not
		// retried
		const data = await exec("ttlQuery", "h3");

		expect(data).toStrictEqual({ v: "network" });
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);
	});

	it("shares one hydration attempt between concurrent callers", async () => {
		let resolveHydrate: (value: unknown) => void = () => {};

		// fresh meta, so a successful hydration needs no revalidation
		// and any fetch would be a duplicate caused by the race
		store.cacheMeta[toCacheKey(["ttlQuery", "h6"])] = {
			definitionName: "ttlQuery",
			params: "h6",
			timestamp: NOW - 500,
			expireTime: 1000,
		};

		mocks.hydrateTtl.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveHydrate = resolve;
				})
		);

		const first: Promise<unknown> = exec("ttlQuery", "h6");
		const second: Promise<unknown> = exec("ttlQuery", "h6");

		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);

		resolveHydrate({ v: "local" });
		const results = await Promise.all([first, second]);

		expect(results).toStrictEqual([{ v: "local" }, { v: "local" }]);
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
		// the second caller must not slip past the unfinished hydration
		expect(mocks.fetchTtl).not.toHaveBeenCalled();
	});

	it("does not re-hydrate after the key was invalidated", async () => {
		/*
			An invalidation means a mutation made this key stale. Mutations
			do not write through to the stores hydration reads from, so a
			second hydration would rebuild the pre-mutation payload and
			silently undo the invalidation.
		*/
		mocks.hydrateTtl.mockResolvedValueOnce({ v: "local-1" });
		mocks.hydrateTtl.mockResolvedValueOnce({ v: "local-2" });
		mocks.fetchTtl.mockResolvedValue({ v: "server" });

		const key: JSONValue = ["ttlQuery", "h7"];

		expect(await exec("ttlQuery", "h7")).toStrictEqual({ v: "local-1" });

		await store.invalidateKey(key, { skipRefetch: true });

		expect(await exec("ttlQuery", "h7")).toStrictEqual({ v: "server" });
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
	});

	it("falls back to the network when hydration throws", async () => {
		mocks.hydrateTtl.mockRejectedValueOnce(new Error("db gone"));
		mocks.fetchTtl.mockResolvedValueOnce({ v: "network" });

		const data = await exec("ttlQuery", "h4");

		expect(data).toStrictEqual({ v: "network" });
		expect(store.cacheState[toCacheKey(["ttlQuery", "h4"])].hydrated).toBe(
			false
		);
	});

	it("ignores an empty array from hydration", async () => {
		mocks.hydrateTtl.mockResolvedValueOnce([]);
		mocks.fetchTtl.mockResolvedValueOnce({ v: "network" });

		const data = await exec("ttlQuery", "h5");

		expect(data).toStrictEqual({ v: "network" });
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(1);
	});

	it("works for a definition without a hydrateFn", async () => {
		mocks.fetchPlain.mockResolvedValueOnce({ v: "plain" });

		const hash: string = toCacheKey(["plainQuery", "p1"]);
		const data = await exec("plainQuery", "p1");

		expect(data).toStrictEqual({ v: "plain" });
		expect(store.cacheState[hash].hasData).toBe(true);
		expect(store.cacheState[hash].hydrated).toBe(false);

		// cached, so a second call must not fetch again
		const again = await exec("plainQuery", "p1");
		expect(again).toStrictEqual({ v: "plain" });
		expect(mocks.fetchPlain).toHaveBeenCalledTimes(1);
	});

	it("confirms hydrated data of an expiry-less definition exactly once", async () => {
		const hash: string = toCacheKey(["userQuery", "u1"]);

		let resolveFetch: (value: unknown) => void = () => {};

		mocks.hydrateUser.mockResolvedValueOnce({ v: "local" });
		mocks.fetchUser.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
		);

		const data = await exec("userQuery", "u1");

		// served from local storage, confirmed in the background
		expect(data).toStrictEqual({ v: "local" });
		expect(mocks.fetchUser).toHaveBeenCalledTimes(1);
		expect(store.cacheState[hash].revalidating).toBe(true);
		expect(store.cacheState[hash].loading).toBe(false);

		resolveFetch({ v: "remote" });
		await flushPromises();

		expect(store.cacheState[hash].data).toStrictEqual({ v: "remote" });
		expect(store.cacheState[hash].hydrated).toBe(false);

		// confirmation happens once per hydration, not on every access
		const second = await exec("userQuery", "u1");
		expect(second).toStrictEqual({ v: "remote" });
		expect(mocks.fetchUser).toHaveBeenCalledTimes(1);
	});

	it("does not revalidate a fetched expiry-less definition", async () => {
		mocks.hydrateUser.mockResolvedValueOnce(null);
		mocks.fetchUser.mockResolvedValueOnce({ v: "remote" });

		const first = await exec("userQuery", "u2");
		expect(first).toStrictEqual({ v: "remote" });

		vi.setSystemTime(NOW + 10_000_000);

		const second = await exec("userQuery", "u2");
		expect(second).toStrictEqual({ v: "remote" });
		expect(mocks.fetchUser).toHaveBeenCalledTimes(1);
	});
});

describe("queryStore: hasData", () => {
	it("caches a null payload and does not refetch it", async () => {
		const hash: string = toCacheKey(["nullQuery", "n1"]);

		mocks.fetchNull.mockResolvedValueOnce(null);

		const first = await exec("nullQuery", "n1");

		expect(first).toBeNull();
		expect(store.cacheState[hash].data).toBeNull();
		expect(store.cacheState[hash].hasData).toBe(true);

		const second = await exec("nullQuery", "n1");

		expect(second).toBeNull();
		expect(mocks.fetchNull).toHaveBeenCalledTimes(1);
	});

	it("serves a cached null while revalidating it in the background", async () => {
		const hash: string = toCacheKey(["nullQuery", "n2"]);

		mocks.fetchNull.mockResolvedValueOnce(null);
		mocks.fetchNull.mockResolvedValueOnce({ v: "found" });

		await exec("nullQuery", "n2");

		vi.setSystemTime(NOW + 5000);
		const stale = await exec("nullQuery", "n2");

		expect(stale).toBeNull();
		expect(mocks.fetchNull).toHaveBeenCalledTimes(2);

		await flushPromises();
		expect(store.cacheState[hash].data).toStrictEqual({ v: "found" });
	});
});

describe("queryStore: checkEntryStatusAndRefresh", () => {
	it("keeps a stale entry that still holds usable data", () => {
		const hash: string = seedEntry(["plainQuery", "keep"], {
			definitionName: "plainQuery",
			params: "keep",
			data: { v: 1 },
			hasData: true,
			timestamp: NOW - 10_000,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();

		expect(store.cacheState[hash]).toBeDefined();
		expect(store.cacheState[hash].data).toStrictEqual({ v: 1 });
		expect(mocks.fetchPlain).not.toHaveBeenCalled();
	});

	it("drops a stale entry that holds no data", () => {
		const hash: string = seedEntry(["plainQuery", "empty"], {
			definitionName: "plainQuery",
			params: "empty",
			data: null,
			hasData: false,
			timestamp: NOW - 10_000,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();

		expect(store.cacheState[hash]).toBeUndefined();
	});

	it("drops an entry staler than CACHE_GC_MS despite holding data", () => {
		const hash: string = seedEntry(["plainQuery", "ancient"], {
			definitionName: "plainQuery",
			params: "ancient",
			data: { v: 1 },
			hasData: true,
			timestamp: NOW - CACHE_GC_MS - 1,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();

		expect(store.cacheState[hash]).toBeUndefined();
	});

	it("refreshes a stale autoRefetch entry", async () => {
		mocks.fetchAuto.mockResolvedValueOnce({ v: "auto-fresh" });

		const hash: string = seedEntry(["autoQuery", "a1"], {
			definitionName: "autoQuery",
			params: "a1",
			data: { v: "auto-old" },
			hasData: true,
			autoRefetch: true,
			timestamp: NOW - 10_000,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();
		await flushPromises();

		expect(mocks.fetchAuto).toHaveBeenCalledTimes(1);
		expect(store.cacheState[hash]).toBeDefined();
		expect(store.cacheState[hash].data).toStrictEqual({ v: "auto-fresh" });
	});

	it("leaves a fresh entry untouched", () => {
		const hash: string = seedEntry(["autoQuery", "a2"], {
			definitionName: "autoQuery",
			params: "a2",
			data: { v: "auto-old" },
			hasData: true,
			autoRefetch: true,
			timestamp: NOW - 100,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();

		expect(store.cacheState[hash]).toBeDefined();
		expect(mocks.fetchAuto).not.toHaveBeenCalled();
	});

	it("does nothing at all while the user is inactive", () => {
		mocks.shouldDelay.mockReturnValue(true);

		const dropHash: string = seedEntry(["plainQuery", "idle-empty"], {
			definitionName: "plainQuery",
			params: "idle-empty",
			data: null,
			hasData: false,
			timestamp: NOW - 10_000,
			expireTime: 1000,
		});
		const autoHash: string = seedEntry(["autoQuery", "idle-auto"], {
			definitionName: "autoQuery",
			params: "idle-auto",
			data: { v: 1 },
			hasData: true,
			autoRefetch: true,
			timestamp: NOW - 10_000,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();

		expect(store.cacheState[dropHash]).toBeDefined();
		expect(store.cacheState[autoHash]).toBeDefined();
		expect(mocks.fetchAuto).not.toHaveBeenCalled();
	});
});

describe("queryStore: cacheMeta", () => {
	it("writes meta on a successful fetch", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });

		const hash: string = toCacheKey(["ttlQuery", "m1"]);
		await exec("ttlQuery", "m1");

		expect(store.cacheMeta[hash]).toStrictEqual({
			definitionName: "ttlQuery",
			params: "m1",
			timestamp: NOW,
			expireTime: 1000,
		});
	});

	it("writes meta for a manually added cache state", async () => {
		const key: JSONValue = ["ttlQuery", "m2"];

		await (
			store.addCacheState as unknown as (
				key: JSONValue,
				name: string,
				params: unknown,
				data: unknown
			) => Promise<void>
		)(key, "ttlQuery", "m2", { v: "manual" });

		expect(store.cacheMeta[toCacheKey(key)]).toStrictEqual({
			definitionName: "ttlQuery",
			params: "m2",
			timestamp: NOW,
			expireTime: 1000,
		});
	});

	it("writes no meta for a persist:false definition", async () => {
		mocks.fetchVolatile.mockResolvedValueOnce({ v: "volatile" });

		const hash: string = toCacheKey(["volatileQuery", "v1"]);
		const data = await exec("volatileQuery", "v1");

		expect(data).toStrictEqual({ v: "volatile" });
		expect(store.cacheMeta[hash]).toBeUndefined();
		expect(store.cacheState[hash]).toBeUndefined();
	});

	it("prunes meta to CACHE_META_MAX_ENTRIES, oldest first", async () => {
		for (let i = 0; i < CACHE_META_MAX_ENTRIES; i++) {
			store.cacheMeta[`meta-seed-${i}`] = {
				definitionName: "ttlQuery",
				params: i,
				// oldest first, seed 0 is the one that must go
				timestamp: i + 1,
				expireTime: 1000,
			};
		}

		expect(Object.keys(store.cacheMeta)).toHaveLength(
			CACHE_META_MAX_ENTRIES
		);

		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		const hash: string = toCacheKey(["ttlQuery", "prune"]);
		await exec("ttlQuery", "prune");

		expect(Object.keys(store.cacheMeta)).toHaveLength(
			CACHE_META_MAX_ENTRIES
		);
		expect(store.cacheMeta["meta-seed-0"]).toBeUndefined();
		expect(store.cacheMeta["meta-seed-1"]).toBeDefined();
		expect(store.cacheMeta[hash]).toBeDefined();
	});

	it("drops meta on invalidateKey and $reset", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });

		const key: JSONValue = ["ttlQuery", "m3"];
		await exec("ttlQuery", "m3");
		expect(store.cacheMeta[toCacheKey(key)]).toBeDefined();

		await store.invalidateKey(key);
		expect(store.cacheMeta[toCacheKey(key)]).toBeUndefined();

		mocks.fetchTtl.mockResolvedValueOnce({ v: 2 });
		await exec("ttlQuery", "m3");
		expect(store.cacheMeta[toCacheKey(key)]).toBeDefined();

		store.$reset();
		expect(Object.keys(store.cacheMeta)).toHaveLength(0);
	});
});

describe("queryStore: validateMetaVersion", () => {
	beforeEach(() => {
		store.cacheMeta["kept"] = {
			definitionName: "ttlQuery",
			params: "kept",
			timestamp: NOW,
			expireTime: 1000,
		};
	});

	it("keeps meta when both versions match", () => {
		store.validateMetaVersion();

		expect(store.cacheMeta["kept"]).toBeDefined();
		expect(store.cacheMetaVersion).toBe(CACHE_META_VERSION);
	});

	it("wipes meta on a meta version mismatch", () => {
		store.cacheMetaVersion = CACHE_META_VERSION + 1;

		store.validateMetaVersion();

		expect(store.cacheMeta["kept"]).toBeUndefined();
		expect(Object.keys(store.cacheMeta)).toHaveLength(0);
		expect(store.cacheMetaVersion).toBe(CACHE_META_VERSION);
	});

	it("wipes meta on an app version mismatch and stores the new one", () => {
		const currentAppVersion: string = store.cacheAppVersion;
		store.cacheAppVersion = "0.0.0-stale";

		store.validateMetaVersion();

		expect(store.cacheMeta["kept"]).toBeUndefined();
		expect(store.cacheAppVersion).toBe(currentAppVersion);
	});
});

describe("queryStore: refreshAll", () => {
	it("force-refetches cached entries and bumps the generation", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockResolvedValueOnce({ v: 2 });

		const hash: string = toCacheKey(["ttlQuery", "r1"]);
		await exec("ttlQuery", "r1");

		const generationBefore: number = store.refreshGeneration;
		expect(store.refreshing).toBe(false);

		const running: Promise<void> = store.refreshAll();
		expect(store.refreshing).toBe(true);

		await running;

		expect(store.refreshing).toBe(false);
		expect(store.refreshGeneration).toBe(generationBefore + 1);
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);
		expect(store.cacheState[hash].data).toStrictEqual({ v: 2 });
	});

	it("skips persist:false definitions", async () => {
		seedEntry(["volatileQuery", "v2"], {
			definitionName: "volatileQuery",
			params: "v2",
			data: { v: "volatile" },
			hasData: true,
			timestamp: NOW,
		});

		await store.refreshAll();

		expect(mocks.fetchVolatile).not.toHaveBeenCalled();
	});

	it("skips entries that are already loading or revalidating", async () => {
		seedEntry(["ttlQuery", "busy"], {
			definitionName: "ttlQuery",
			params: "busy",
			data: { v: 1 },
			hasData: true,
			loading: true,
			timestamp: NOW,
		});
		seedEntry(["plainQuery", "busy"], {
			definitionName: "plainQuery",
			params: "busy",
			data: { v: 1 },
			hasData: true,
			revalidating: true,
			timestamp: NOW,
		});

		await store.refreshAll();

		expect(mocks.fetchTtl).not.toHaveBeenCalled();
		expect(mocks.fetchPlain).not.toHaveBeenCalled();
	});

	it("only refreshes entries matching a given key prefix", async () => {
		mocks.fetchTtl.mockResolvedValue({ v: "ttl-fresh" });
		mocks.fetchPlain.mockResolvedValue({ v: "plain-fresh" });

		seedEntry(["ttlQuery", "k1"], {
			definitionName: "ttlQuery",
			params: "k1",
			data: { v: "ttl-old" },
			hasData: true,
			timestamp: NOW,
		});
		seedEntry(["plainQuery", "k1"], {
			definitionName: "plainQuery",
			params: "k1",
			data: { v: "plain-old" },
			hasData: true,
			timestamp: NOW,
		});

		await store.refreshAll(["ttlQuery"]);

		expect(mocks.fetchTtl).toHaveBeenCalledTimes(1);
		expect(mocks.fetchPlain).not.toHaveBeenCalled();
		expect(
			store.cacheState[toCacheKey(["ttlQuery", "k1"])].data
		).toStrictEqual({ v: "ttl-fresh" });
		expect(
			store.cacheState[toCacheKey(["plainQuery", "k1"])].data
		).toStrictEqual({ v: "plain-old" });
	});

	it("still settles and bumps the generation when a refetch fails", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockRejectedValueOnce(new Error("nope"));

		const hash: string = toCacheKey(["ttlQuery", "r2"]);
		await exec("ttlQuery", "r2");

		const generationBefore: number = store.refreshGeneration;
		await store.refreshAll();

		expect(store.refreshing).toBe(false);
		expect(store.refreshGeneration).toBe(generationBefore + 1);
		expect(store.cacheState[hash].error).toBeInstanceOf(Error);
	});
});

describe("queryStore: oldestDataTimestamp", () => {
	it("is null while nothing is cached", () => {
		expect(store.oldestDataTimestamp).toBeNull();
	});

	it("returns the minimum timestamp of entries holding data", () => {
		seedEntry(["ttlQuery", "o1"], {
			definitionName: "ttlQuery",
			params: "o1",
			data: { v: 1 },
			hasData: true,
			timestamp: NOW - 9000,
		});
		seedEntry(["ttlQuery", "o2"], {
			definitionName: "ttlQuery",
			params: "o2",
			data: { v: 2 },
			hasData: true,
			timestamp: NOW - 5000,
		});
		// no data, must be ignored
		seedEntry(["ttlQuery", "o3"], {
			definitionName: "ttlQuery",
			params: "o3",
			data: null,
			hasData: false,
			timestamp: NOW - 100_000,
		});
		expect(store.oldestDataTimestamp).toBe(NOW - 9000);
	});

	it("reports nothing while any cached payload has an unknown age", () => {
		seedEntry(["ttlQuery", "o5"], {
			definitionName: "ttlQuery",
			params: "o5",
			data: { v: 1 },
			hasData: true,
			timestamp: NOW - 5000,
		});
		// hydrated without persisted meta: age unknown, possibly ancient
		seedEntry(["ttlQuery", "o6"], {
			definitionName: "ttlQuery",
			params: "o6",
			data: { v: 2 },
			hasData: true,
			hydrated: true,
			timestamp: 0,
		});

		// claiming "5 seconds old" would be a lie
		expect(store.oldestDataTimestamp).toBeNull();
	});

	it("tracks the timestamp written by a real fetch", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		await exec("ttlQuery", "o5");

		expect(store.oldestDataTimestamp).toBe(NOW);
	});
});

describe("queryStore: remount guards", () => {
	it("refreshes the cache but holds the generation while a guard blocks", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockResolvedValueOnce({ v: 2 });
		mocks.fetchTtl.mockResolvedValueOnce({ v: 3 });

		const hash: string = toCacheKey(["ttlQuery", "g1"]);
		await exec("ttlQuery", "g1");

		const unregister: () => void = store.registerRemountGuard(() => true);
		const generationBefore: number = store.refreshGeneration;

		await store.refreshAll();

		// data is current, the views just keep their own state
		expect(store.cacheState[hash].data).toStrictEqual({ v: 2 });
		expect(store.refreshGeneration).toBe(generationBefore);

		unregister();
		await store.refreshAll();

		expect(store.cacheState[hash].data).toStrictEqual({ v: 3 });
		expect(store.refreshGeneration).toBe(generationBefore + 1);
	});

	it("ignores a guard that throws", async () => {
		store.registerRemountGuard(() => {
			throw new Error("guard exploded");
		});

		const generationBefore: number = store.refreshGeneration;
		await store.refreshAll();

		expect(store.refreshGeneration).toBe(generationBefore + 1);
	});
});

describe("queryStore: invalidation during an in-flight execute", () => {
	it("does not crash when an entry without hydrateFn is dropped mid-await", async () => {
		let resolveFetch: (value: unknown) => void = () => {};

		mocks.fetchPlain.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
		);

		const pending = exec("plainQuery", "inv1");

		// a mutation invalidates the key while execute awaits hydration
		await store.invalidateKey(["plainQuery", "inv1"], {
			skipRefetch: true,
		});

		resolveFetch({ v: "late" });

		await expect(pending).resolves.toStrictEqual({ v: "late" });
	});

	it("does not let hydration revive an invalidated entry", async () => {
		let resolveHydration: (value: unknown) => void = () => {};

		mocks.hydrateTtl.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveHydration = resolve;
				})
		);
		mocks.fetchTtl.mockResolvedValue({ v: "network" });

		const hash: string = toCacheKey(["ttlQuery", "inv2"]);
		const pending = exec("ttlQuery", "inv2");

		await Promise.resolve();
		await store.invalidateKey(["ttlQuery", "inv2"], { skipRefetch: true });

		resolveHydration({ v: "stale-local" });

		// the invalidated local payload must never reach the caller
		await expect(pending).resolves.toStrictEqual({ v: "network" });
		expect(store.cacheState[hash].data).toStrictEqual({ v: "network" });
		expect(store.cacheState[hash].hydrated).toBe(false);
	});

	it("does not write a fetch result back into an invalidated entry", async () => {
		let resolveFetch: (value: unknown) => void = () => {};

		mocks.fetchPlain.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
		);

		const hash: string = toCacheKey(["plainQuery", "inv3"]);
		const pending = exec("plainQuery", "inv3");

		// let execute get past hydration and into the fetch
		await flushPromises();
		await store.invalidateKey(["plainQuery", "inv3"], {
			skipRefetch: true,
		});

		resolveFetch({ v: "pre-mutation" });
		await pending;

		// the entry stays dropped, the next read starts clean
		expect(store.cacheState[hash]).toBeUndefined();
		expect(store.cacheMeta[hash]).toBeUndefined();
	});
});

describe("queryStore: mutation invalidation beats local storage", () => {
	it("re-reads from the network after an invalidation, not from hydration", async () => {
		// hydration mirrors the local planning store, which mutations
		// never write to
		mocks.hydrateTtl.mockResolvedValue({ v: "local-pre-mutation" });
		mocks.fetchTtl.mockResolvedValue({ v: "server-post-mutation" });

		const first = await exec("ttlQuery", "mut");
		expect(first).toStrictEqual({ v: "local-pre-mutation" });

		// a mutation drops the read key
		await store.invalidateKey(["ttlQuery", "mut"], { skipRefetch: true });

		// the view re-reads and must see the mutation
		const second = await exec("ttlQuery", "mut");
		expect(second).toStrictEqual({ v: "server-post-mutation" });
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
	});
});

describe("queryStore: failed background revalidation backs off", () => {
	it("does not retry a failed revalidation on every read", async () => {
		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		mocks.fetchTtl.mockRejectedValue(new Error("backend down"));

		await exec("ttlQuery", "backoff");
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(1);

		vi.setSystemTime(NOW + 5000);

		// first stale read revalidates and fails
		await exec("ttlQuery", "backoff");
		await flushPromises();
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);

		// subsequent reads inside the cooldown must not re-fire
		await exec("ttlQuery", "backoff");
		await exec("ttlQuery", "backoff");
		store.checkEntryStatusAndRefresh();
		await flushPromises();
		expect(mocks.fetchTtl).toHaveBeenCalledTimes(2);
	});
});

describe("queryStore: refreshAll re-entrancy", () => {
	it("ignores a second refresh while one is running", async () => {
		mocks.fetchTtl.mockResolvedValue({ v: 1 });
		await exec("ttlQuery", "reentry");

		const generationBefore: number = store.refreshGeneration;
		const callsBefore: number = mocks.fetchTtl.mock.calls.length;

		await Promise.all([store.refreshAll(), store.refreshAll()]);

		expect(mocks.fetchTtl.mock.calls.length).toBe(callsBefore + 1);
		expect(store.refreshGeneration).toBe(generationBefore + 1);
		expect(store.refreshing).toBe(false);
	});
});

describe("queryStore: invalidation blocks hydration for the whole key space", () => {
	it("does not hydrate a key first read after a mutation invalidated it", async () => {
		/*
			The key was never cached, so there was nothing to delete. The
			local stores are still behind the backend for that key space,
			so hydration must not be trusted for it either.
		*/
		mocks.hydrateTtl.mockResolvedValue({ v: "local-pre-mutation" });
		mocks.fetchTtl.mockResolvedValue({ v: "server-post-mutation" });

		await store.invalidateKey(["ttlQuery"], {
			exact: false,
			skipRefetch: true,
		});

		const got = await exec("ttlQuery", "never-read-before");

		expect(got).toStrictEqual({ v: "server-post-mutation" });
		expect(mocks.hydrateTtl).not.toHaveBeenCalled();
	});

	it("keeps hydrating an unrelated key space", async () => {
		mocks.hydrateUser.mockResolvedValue({ v: "local" });
		mocks.fetchUser.mockResolvedValue({ v: "server" });

		await store.invalidateKey(["ttlQuery"], {
			exact: false,
			skipRefetch: true,
		});

		const got = await exec("userQuery", "other");

		// still painted from local storage, the mutation was elsewhere
		expect(got).toStrictEqual({ v: "local" });
		expect(mocks.hydrateUser).toHaveBeenCalledTimes(1);
	});
});

describe("queryStore: revalidation backoff clears on success", () => {
	it("drops revalidateFailedAt once the backend answers", async () => {
		const hash: string = toCacheKey(["ttlQuery", "clr"]);

		mocks.fetchTtl.mockResolvedValueOnce({ v: 1 });
		await exec("ttlQuery", "clr");

		// background revalidation fails
		mocks.fetchTtl.mockRejectedValueOnce(new Error("down"));
		vi.setSystemTime(NOW + 5000);
		await exec("ttlQuery", "clr");
		await flushPromises();

		expect(store.cacheState[hash].revalidateFailedAt).toBe(NOW + 5000);

		// past the cooldown the next read retries and succeeds
		mocks.fetchTtl.mockResolvedValueOnce({ v: 2 });
		vi.setSystemTime(NOW + 5000 + REVALIDATE_RETRY_MS + 1);
		await exec("ttlQuery", "clr");
		await flushPromises();

		expect(store.cacheState[hash].data).toStrictEqual({ v: 2 });
		expect(store.cacheState[hash].revalidateFailedAt).toBeUndefined();
	});
});

describe("queryStore: eviction must not disable hydration", () => {
	it("keeps hydration available after the stale GC drops an entry", async () => {
		const key: JSONValue = ["ttlQuery", "gc"];
		const hash: string = toCacheKey(key);

		// far beyond CACHE_GC_MS, so the watcher evicts it
		seedEntry(key, {
			definitionName: "ttlQuery",
			params: "gc",
			data: { v: "old" },
			hasData: true,
			timestamp: NOW - CACHE_GC_MS - 1,
			expireTime: 1000,
		});

		store.checkEntryStatusAndRefresh();
		expect(store.cacheState[hash]).toBeUndefined();

		// eviction is not a mutation, local storage stays trusted
		mocks.hydrateTtl.mockResolvedValueOnce({ v: "local" });
		const got = await exec("ttlQuery", "gc");

		expect(got).toStrictEqual({ v: "local" });
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
	});

	it("keeps hydration available after an explicit keepHydration evict", async () => {
		mocks.hydrateTtl.mockResolvedValue({ v: "local" });
		mocks.fetchTtl.mockResolvedValue({ v: "server" });

		await store.invalidateKey(["ttlQuery"], {
			exact: false,
			skipRefetch: true,
			keepHydration: true,
		});

		const got = await exec("ttlQuery", "evicted");

		expect(got).toStrictEqual({ v: "local" });
		expect(mocks.hydrateTtl).toHaveBeenCalledTimes(1);
	});
});
